/**
 * Primitives du protocole d'appairage Filarr — VERSION 2. Module PUR.
 *
 * « Pur » veut dire ici : aucune entrée/sortie, aucun réseau, aucun disque,
 * aucun journal, aucun état global. Uniquement des octets en entrée, des
 * octets en sortie. La cérémonie (qui parle à qui, dans quel ordre, et quand
 * l'humain confirme) vit dans `pairingService.ts` ; ce fichier ne connaît que
 * les formules. C'est ce qui le rend rejouable contre les VECTEURS DORÉS de
 * la spécification (§8) depuis un simple test unitaire — et les vecteurs dorés
 * sont le seul point de rendez-vous entre trois implémentations qui ne se
 * parlent pas (bureau, mobile, worker).
 *
 * CE QUE v2 CORRIGE
 * -----------------
 * v1 dérivait la clé d'emballage de la FEK ainsi :
 *     K_wrap = HKDF(IKM = Z_ECDH, salt = code6, info = "…wrap.v1")
 * Le sel était le code à six chiffres — qui est AUSSI la clé d'index KV du
 * serveur (`pairing:{code}:pubkey-a`). Le serveur connaissait donc toutes les
 * entrées sauf `Z`, et `Z` il l'obtenait en substituant sa propre clé publique
 * à celle de B : il déballait la FEK, puis la ré-emballait vers le vrai B qui
 * ne voyait rien. Un ECDH NON AUTHENTIFIÉ ne protège que d'un écoutant
 * passif, jamais du porteur du canal. Ce n'était pas un défaut de chiffrement
 * mais d'AUTHENTIFICATION, et il valait aussi bien mobile↔bureau que
 * bureau↔bureau : un défaut de protocole.
 *
 * v2 applique quatre remèdes indissociables :
 *
 *  (2) SECRET `S` DANS LE QR — 32 octets engendrés par A, transportés par
 *      l'image, JAMAIS par le serveur, utilisés comme sel HKDF. Le serveur
 *      garde le pouvoir de substituer les clés ; il perd celui de dériver la
 *      clé d'emballage. Protection cryptographique, sans humain.
 *
 *  (1) SAS NUMÉRIQUE — six chiffres dérivés de `Z` ET des deux clés publiques,
 *      comparés à l'œil. Indispensable en mode MANUEL, qui n'a aucun secret :
 *      un intercepteur y tient deux secrets distincts et ne peut pas faire
 *      coïncider les deux écrans.
 *
 *  (3) SESSION LIÉE AU COMPTE — vérifiée côté worker sur chaque route.
 *
 *  (4) ENGAGEMENT (`commitA`) — non optionnel, et c'est le point le moins
 *      intuitif. Sans lui, le SAS à six chiffres ne vaut RIEN : l'intercepteur
 *      publie sa clé vers B, attend de voir `pubB`, puis choisit la clé qu'il
 *      livrera à A en broyant hors ligne ~10⁶ candidats jusqu'à faire
 *      coïncider les deux SAS — quelques secondes sur une machine ordinaire.
 *      En publiant `commitA = SHA-256(étiquette ‖ pubA)` À L'INITIATION et en
 *      ne révélant `pubA` qu'APRÈS avoir reçu `pubB`, on fige chaque camp
 *      avant que l'autre ne soit connu : les deux SAS deviennent indépendants
 *      et imprévisibles. La probabilité de réussite retombe à 10⁻⁶, sur une
 *      tentative UNIQUE, en ligne et destructrice. C'est la structure de ZRTP
 *      (RFC 6189 §7.1) ; le nombre de chiffres et l'engagement sont une seule
 *      décision, pas deux.
 *
 * CE QUI N'A PAS CHANGÉ (§0.4) : la courbe P-256, le format brut non
 * compressé des clés publiques (65 octets, `0x04 ‖ X ‖ Y`), HKDF-SHA-256,
 * AES-256-GCM avec IV de 12 octets et tag de 16, l'emballage
 * `IV ‖ ciphertext ‖ tag` = 60 octets, et le base64 standard AVEC
 * remplissage sur le fil. Aucune primitive n'est remplacée : seuls changent
 * l'ordre des messages et les ENTRÉES de la dérivation.
 */

import * as crypto from 'crypto';
import { PAIRING_SECRET_BYTES } from './pairingQr';

const subtle = crypto.webcrypto.subtle;

/** Types WebCrypto tels que Node les expose au process principal. */
export type WebCryptoKey = crypto.webcrypto.CryptoKey;
export type WebCryptoKeyUsage = 'encrypt' | 'decrypt' | 'wrapKey' | 'unwrapKey';

// ── Constantes de format (§0.4) ─────────────────────────────────────────────

export const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' } as const;
export const AES_GCM_PARAMS = { name: 'AES-GCM', length: 256 } as const;

/** IV AES-GCM : 12 octets. Valeur du produit, pas un choix rejouable ici. */
export const IV_LENGTH = 12;

/** Clé publique brute non compressée : `0x04 ‖ X(32) ‖ Y(32)`. */
export const RAW_PUBKEY_LENGTH = 65;
const UNCOMPRESSED_POINT_TAG = 0x04;

/** `IV(12) ‖ ciphertext(32) ‖ tag(16)`. Longueur FIXE : elle est vérifiable. */
export const WRAPPED_FEK_LENGTH = IV_LENGTH + 32 + 16;

/** Secret ECDH brut (coordonnée x de P-256) : 32 octets. */
const ECDH_SHARED_BITS = 256;

// ── Étiquettes de séparation de domaine (§8.1) ──────────────────────────────

/**
 * Ces trois chaînes ASCII sont des CONSTANTES DE PROTOCOLE. En modifier une
 * seule change tous les vecteurs dorés et rend cette implémentation
 * incompatible avec le mobile et le worker — sans qu'aucun test local ne s'en
 * plaigne, puisqu'ils changeraient ensemble ici. Leur seule autorité est la
 * spécification.
 */
const LABEL_COMMIT = asciiBytes('filarr.pairing.v2.commit'); // 24 octets
const LABEL_WRAP = asciiBytes('filarr.pairing.wrap.v2'); //  22 octets
const LABEL_SAS = asciiBytes('filarr.pairing.sas.v2'); //   21 octets

/** Longueurs INVARIANTES des transcripts. Vérifiées à chaque construction. */
export const INFO_WRAP_LENGTH = 159; // 22 + 1 + 6 + 65 + 65
export const INFO_SAS_LENGTH = 158; // 21 + 1 + 6 + 65 + 65

export type PairingMode = 'qr' | 'manual';

/**
 * L'octet de mode entre dans les DEUX transcripts (emballage et SAS). C'est
 * ce qui rend une rétrogradation `qr → manual` — la seule manipulation
 * intéressante pour un serveur hostile, puisque `mode` transite par lui —
 * VISIBLE À L'ÉCRAN : A dériverait avec le sel nul, B (qui a scanné) avec
 * `S`, les deux SAS divergeraient, l'utilisateur refuserait, et la FEK ne
 * serait jamais emballée. Le mode n'est pas authentifié par le réseau ; il
 * est authentifié par les yeux de l'utilisateur. C'est la seule autorité
 * disponible quand le serveur est l'adversaire. (Vecteur doré V2-4.)
 */
const MODE_BYTE: Record<PairingMode, number> = { qr: 0x51 /* 'Q' */, manual: 0x4d /* 'M' */ };

/**
 * Sel du mode manuel : 32 octets nuls ÉCRITS EXPLICITEMENT.
 *
 * HKDF-Extract avec 32 zéros est identique à HKDF-Extract avec un sel vide
 * (RFC 5869 §2.2) — la forme explicite ne change donc rien au résultat. On
 * l'impose parce que les trois piles traitent le sel vide différemment
 * (WebCrypto exige le champ, `hkdfSync` accepte un Buffer vide, un HMAC écrit
 * à la main doit bourrer lui-même) : un zéro explicite supprime le débat
 * avant qu'il n'ait lieu.
 */
const ZERO_SALT = new Uint8Array(32);

// ── Petits utilitaires d'octets ─────────────────────────────────────────────

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Remplit les tampons de zéros. Appelé sur `Z`, `S` et les octets de clé dès
 * la fin de la cérémonie — succès, refus, expiration ou erreur.
 *
 * CE QUE CELA NE FAIT PAS. Une `CryptoKey` non extractible ne peut pas être
 * effacée depuis JS : seul le moteur détient ses octets. On s'en remet au
 * ramasse-miettes en lâchant la référence. La zéroïsation ici ne couvre donc
 * que les tampons que NOUS tenons — c'est exactement pour cela que la clé
 * d'emballage est dérivée non extractible : les octets qu'on ne peut pas
 * effacer, on préfère ne jamais les posséder.
 */
export function zeroize(...buffers: Array<Uint8Array | ArrayBuffer | null | undefined>): void {
  for (const b of buffers) {
    if (!b) continue;
    // On NE teste PAS `b instanceof ArrayBuffer`. Les tampons rendus par
    // WebCrypto peuvent venir d'un autre « realm » que celui du module (deux
    // contextes JS distincts ont chacun leur `ArrayBuffer`), et `instanceof`
    // y répond faux sur un objet pourtant parfaitement valide. Un
    // `zeroize` qui échoue en silence sur `Z` serait le pire des bugs de ce
    // fichier : la seule chose qu'il a à faire, il ne la ferait pas.
    // `ArrayBuffer.isView` est, elle, insensible au realm.
    if (ArrayBuffer.isView(b)) {
      new Uint8Array(b.buffer, b.byteOffset, b.byteLength).fill(0);
    } else {
      new Uint8Array(b as ArrayBuffer).fill(0);
    }
  }
}

/**
 * Comparaison à TEMPS CONSTANT. Utilisée pour la vérification de `commitA` :
 * une comparaison qui s'arrête au premier octet différent laisse fuir, par le
 * temps de réponse, combien d'octets de tête coïncident — ce qui permettrait
 * de construire un engagement acceptable octet par octet.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ── Engendrement ────────────────────────────────────────────────────────────

/**
 * Le code d'appairage : six chiffres, `100000`–`999999` inclus.
 *
 * `randomInt(min, max)` de Node est borné à DROITE EXCLUE : la borne haute
 * est donc `1_000_000`, pas `999_999`. La v1 écrivait `999_999` et n'a jamais
 * pu tirer le code `999999` — inoffensif, mais c'est un espace de codes
 * amputé d'une valeur et la spécification donne explicitement `999999` comme
 * borne haute (vecteur doré V2-3).
 */
export function generatePairingCode(): string {
  return crypto.randomInt(100_000, 1_000_000).toString();
}

/**
 * Le secret `S` du QR : 32 octets de CSPRNG.
 *
 * POURQUOI 32 ET NON 16. `S` est le sel d'un HKDF qui doit rester hors de
 * portée d'une recherche exhaustive MÊME SI l'intercepteur possède `Z` — ce
 * qui est précisément son cas quand il a substitué sa propre clé. 256 bits,
 * alignés sur toutes les autres clés du produit.
 *
 * `S` DOIT être régénéré à chaque session, y compris à chaque réessai après
 * échec ou expiration, et ne doit JAMAIS être écrit sur disque, en journal,
 * dans le presse-papiers, en télémétrie, ni transmis à une route serveur.
 * Il vit en mémoire, le temps de la cérémonie.
 */
export function generatePairingSecret(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(PAIRING_SECRET_BYTES));
}

/** Paire ECDH éphémère P-256. La privée reste NON extractible. */
export async function generateEphemeralKeyPair(): Promise<{
  privateKey: WebCryptoKey;
  publicKeyRaw: Uint8Array;
}> {
  const pair = await subtle.generateKey(ECDH_PARAMS, false, ['deriveBits']);
  const raw = await subtle.exportKey('raw', pair.publicKey);
  return { privateKey: pair.privateKey, publicKeyRaw: new Uint8Array(raw) };
}

// ── Engagement (§0.3) ───────────────────────────────────────────────────────

/** `commitA = SHA-256("filarr.pairing.v2.commit" ‖ pubA)`, 32 octets. */
export function computeCommitA(publicKeyARaw: Uint8Array): Uint8Array {
  assertRawPublicKey(publicKeyARaw);
  return new Uint8Array(
    crypto.createHash('sha256').update(concatBytes([LABEL_COMMIT, publicKeyARaw])).digest()
  );
}

/**
 * Vérification de l'engagement, côté B, AVANT toute exploitation de l'ECDH.
 * Un échec signifie que l'autre appareil n'a pas présenté la clé qu'il avait
 * annoncée : quelqu'un s'est interposé. Abandon immédiat, jamais de réessai
 * automatique.
 */
export function verifyCommitA(publicKeyARaw: Uint8Array, expectedCommit: Uint8Array): boolean {
  if (expectedCommit.length !== 32) return false;
  return timingSafeEqualBytes(computeCommitA(publicKeyARaw), expectedCommit);
}

// ── Validation des clés publiques distantes ─────────────────────────────────

/**
 * Longueur et marqueur de point non compressé, AVANT tout ECDH. L'import
 * WebCrypto valide ensuite l'appartenance à la courbe. Un point invalide DOIT
 * faire échouer la session, jamais produire un `Z` de repli : accepter un
 * point hors courbe est l'attaque classique qui laisse fuir la clé privée
 * bit par bit.
 */
export function assertRawPublicKey(raw: Uint8Array): void {
  if (raw.length !== RAW_PUBKEY_LENGTH) {
    throw new Error(`Invalid public key length: ${raw.length} (expected ${RAW_PUBKEY_LENGTH})`);
  }
  if (raw[0] !== UNCOMPRESSED_POINT_TAG) {
    throw new Error('Invalid public key: not an uncompressed P-256 point');
  }
}

export async function importRemotePublicKey(raw: Uint8Array): Promise<WebCryptoKey> {
  assertRawPublicKey(raw);
  // `importKey` rejette un point hors courbe : c'est la validation réelle.
  return subtle.importKey('raw', raw, ECDH_PARAMS, false, []);
}

// ── Transcripts (§2.1, §3.1) ────────────────────────────────────────────────

/**
 * `INFO = étiquette ‖ modeByte(1) ‖ ASCII(code)(6) ‖ pubA(65) ‖ pubB(65)`.
 *
 * ORDRE DES CLÉS : `pubA` PUIS `pubB`, fixé par les RÔLES et jamais trié.
 * Trier par valeur d'octets rendrait le transcript invariant par échange des
 * rôles et masquerait une confusion de rôle (un adversaire présentant B à A
 * comme un second A). Les deux implémentations savent sans ambiguïté quel
 * rôle elles jouent : A est celui qui a exécuté `initiate` et publié
 * `commitA`.
 *
 * Tous les champs sont de LONGUEUR FIXE : la concaténation est non ambiguë,
 * aucun séparateur ni préfixe de longueur n'est requis — et il ne doit pas en
 * être ajouté. `ASCII(code)` est la suite des six octets décimaux, pas la
 * valeur entière du code.
 *
 * POURQUOI LES DEUX CLÉS PUBLIQUES ENTRENT DANS `info`. En mode QR, `S` fait
 * déjà tout le travail cryptographique et le liage des clés est de la
 * ceinture-bretelles (il interdit tout partage de clé inconnu). En mode
 * MANUEL il est essentiel pour une autre raison : il rend `K_wrap` et le SAS
 * fonctions du MÊME transcript, de sorte qu'une divergence de transcript se
 * voit à l'écran avant de se traduire par un déballage silencieux.
 */
function buildTranscriptInfo(
  label: Uint8Array,
  mode: PairingMode,
  code: string,
  publicKeyARaw: Uint8Array,
  publicKeyBRaw: Uint8Array
): Uint8Array {
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid pairing code in transcript');
  assertRawPublicKey(publicKeyARaw);
  assertRawPublicKey(publicKeyBRaw);
  return concatBytes([
    label,
    Uint8Array.of(MODE_BYTE[mode]),
    asciiBytes(code),
    publicKeyARaw,
    publicKeyBRaw,
  ]);
}

export function buildWrapInfo(
  mode: PairingMode,
  code: string,
  publicKeyARaw: Uint8Array,
  publicKeyBRaw: Uint8Array
): Uint8Array {
  const info = buildTranscriptInfo(LABEL_WRAP, mode, code, publicKeyARaw, publicKeyBRaw);
  /* istanbul ignore next — invariant structurel, il ne peut échouer qu'à la
     suite d'une édition fautive d'une étiquette ou d'une longueur. */
  if (info.length !== INFO_WRAP_LENGTH) throw new Error('INFO_WRAP length invariant broken');
  return info;
}

export function buildSasInfo(
  mode: PairingMode,
  code: string,
  publicKeyARaw: Uint8Array,
  publicKeyBRaw: Uint8Array
): Uint8Array {
  const info = buildTranscriptInfo(LABEL_SAS, mode, code, publicKeyARaw, publicKeyBRaw);
  /* istanbul ignore next — même invariant que ci-dessus. */
  if (info.length !== INFO_SAS_LENGTH) throw new Error('INFO_SAS length invariant broken');
  return info;
}

/**
 * Le sel HKDF : `S` en mode QR, 32 octets nuls en mode manuel.
 *
 * A DÉTIENT TOUJOURS `S` (il l'a engendré) : il ne le demande à personne, il
 * choisit seulement de s'en servir ou non, selon le mode DÉCLARÉ par B.
 * B, lui, sait mécaniquement dans quel mode il est — il a scanné, ou il a
 * tapé. Le mode se déduit de la PRÉSENCE de `S`, jamais d'une case à cocher.
 */
export function saltForMode(mode: PairingMode, secret: Uint8Array | null): Uint8Array {
  if (mode === 'manual') return ZERO_SALT;
  if (!secret || secret.length !== PAIRING_SECRET_BYTES) {
    throw new Error('QR pairing mode requires a 32-byte secret');
  }
  return secret;
}

/** Déduit le mode de la seule chose qui compte : a-t-on un secret, oui ou non. */
export function modeFromSecret(secret: Uint8Array | null): PairingMode {
  return secret !== null ? 'qr' : 'manual';
}

// ── ECDH + HKDF ─────────────────────────────────────────────────────────────

/** `Z = ECDH_P256(privLocal, pubDistant)` — 32 octets (coordonnée x). */
export async function computeSharedSecret(
  privateKey: WebCryptoKey,
  remotePublicKeyRaw: Uint8Array
): Promise<Uint8Array> {
  const remote = await importRemotePublicKey(remotePublicKeyRaw);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: remote }, privateKey, ECDH_SHARED_BITS);
  return new Uint8Array(bits);
}

async function importHkdfIkm(ikm: Uint8Array): Promise<WebCryptoKey> {
  return subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveKey', 'deriveBits']);
}

/**
 * La clé d'emballage, dérivée NON EXTRACTIBLE et cantonnée à un seul usage
 * (`wrapKey` côté A, `unwrapKey` côté B).
 *
 * On garde `deriveKey` plutôt que `deriveBits` + `importKey` parce que les
 * octets de cette clé n'ont aucune raison d'exister dans le tas JS : ce qu'on
 * ne possède pas ne fuit pas dans un vidage mémoire, une trace d'erreur ou un
 * journal. L'équivalence à l'octet près avec le chemin `deriveBits` (celui du
 * worker) et avec `hkdfSync` (celui du script de référence) est VÉRIFIÉE par
 * les vecteurs dorés — c'est `deriveWrapKeyBits` ci-dessous qui sert de
 * témoin, et le test emballe en plus la FEK dorée avec CETTE clé-ci pour
 * confirmer que les deux chemins produisent le même chiffré.
 */
export async function deriveWrapKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  usages: WebCryptoKeyUsage[]
): Promise<WebCryptoKey> {
  const ikm = await importHkdfIkm(sharedSecret);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    ikm,
    AES_GCM_PARAMS,
    false,
    usages
  );
}

/**
 * Les 32 octets bruts de la clé d'emballage. N'EXISTE QUE POUR LES TESTS :
 * c'est le témoin qui confronte `deriveKey` (chemin de production) aux
 * vecteurs dorés. Aucun appel de production ne doit l'utiliser — obtenir ces
 * octets, c'est exactement ce que `deriveWrapKey` s'emploie à éviter.
 */
export async function deriveWrapKeyBits(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array
): Promise<Uint8Array> {
  const ikm = await importHkdfIkm(sharedSecret);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikm, 256);
  return new Uint8Array(bits);
}

// ── SAS (§3) ────────────────────────────────────────────────────────────────

export interface Sas {
  /** Valeur canonique comparée par les tests : six chiffres, zéros de tête compris. */
  digits: string;
  /** Valeur AFFICHÉE : `NN NN NN`, huit caractères. */
  display: string;
  /**
   * L'entier gros-boutiste AVANT le modulo. Exposé pour que les vecteurs
   * dorés puissent épingler les quatre octets de sortie HKDF eux-mêmes, et
   * pas seulement leur réduction : un décalage d'endianness ou une longueur
   * `L` erronée donnerait souvent six chiffres d'allure normale. Ce n'est pas
   * un secret — le SAS est fait pour être affiché.
   */
  int: number;
}

/**
 * Le SAS : `HKDF(Z, SALT, INFO_SAS, L = 4)` → uint32 gros-boutiste → modulo
 * 10⁶ → complété à six caractères.
 *
 * `L = 4` ET NON `BigInt`, `% 1000000` ET NON un tirage par rejet. Le biais du
 * modulo est connu, mesuré et DÉLIBÉRÉMENT CONSERVÉ : 2³² mod 10⁶ = 967 296,
 * donc les valeurs `000000`–`967295` sortent avec probabilité 4295/2³² et les
 * autres 4294/2³² — un biais relatif maximal de 2,33 × 10⁻⁴, du bruit face à
 * la marge d'attaque de 10⁻⁶. Le « corriger » casserait l'interopérabilité
 * avec le mobile et le worker sans rien gagner.
 *
 * LE COMPLÉMENT À SIX CARACTÈRES N'EST PAS COSMÉTIQUE. Sans lui, un SAS de
 * valeur 41827 s'afficherait `41827` d'un côté et `041827` de l'autre si les
 * deux implémentations ne s'accordent pas : les deux appareils calculeraient
 * le MÊME entier et montreraient des chaînes DIFFÉRENTES. L'utilisateur
 * refuserait un appairage légitime — ou, pire, prendrait l'habitude de
 * valider des écarts. C'est le bug que le vecteur doré V2-2 attrape.
 *
 * Le groupement `NN NN NN` distingue le SAS du CODE d'appairage, affiché en
 * six chiffres accolés. Deux nombres à six chiffres coexistent à l'écran
 * pendant la cérémonie ; un groupement identique conduirait à saisir le SAS
 * dans le champ « code », ou à comparer le mauvais nombre.
 */
export async function computeSas(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array
): Promise<Sas> {
  const ikm = await importHkdfIkm(sharedSecret);
  const okm = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikm, 32);
  const view = new DataView(okm);
  const sasInt = view.getUint32(0, false); // gros-boutiste
  const digits = String(sasInt % 1_000_000).padStart(6, '0');
  zeroize(okm);
  return { digits, display: formatSasDisplay(digits), int: sasInt };
}

export function formatSasDisplay(digits: string): string {
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}`;
}

// ── Emballage / déballage de la FEK ─────────────────────────────────────────

/**
 * `wrapped = IV(12) ‖ AES-256-GCM(K_wrap, IV, FEK)` = 60 octets.
 *
 * WebCrypto replie déjà le tag GCM dans le chiffré, donc `IV ‖ wrapKey(...)`
 * vaut exactement `IV ‖ ct ‖ tag` : le format d'emballage de v1 est conservé
 * sans un octet de différence, et c'est vérifié par les vecteurs dorés.
 *
 * L'IV est passé en paramètre UNIQUEMENT pour permettre aux vecteurs dorés de
 * rejouer un chiffré déterministe. En production l'appelant tire 12 octets de
 * CSPRNG à chaque emballage — un IV réutilisé sous la même clé effondre les
 * garanties de GCM.
 */
export async function wrapFek(
  fek: WebCryptoKey,
  wrapKey: WebCryptoKey,
  iv: Uint8Array
): Promise<Uint8Array> {
  if (iv.length !== IV_LENGTH) throw new Error('Invalid IV length');
  const sealed = await subtle.wrapKey('raw', fek, wrapKey, { name: 'AES-GCM', iv });
  const packed = concatBytes([iv, new Uint8Array(sealed)]);
  /* istanbul ignore next — dépend uniquement de la taille de la FEK (256 bits). */
  if (packed.length !== WRAPPED_FEK_LENGTH) throw new Error('Unexpected wrapped FEK length');
  return packed;
}

/**
 * Déballage côté B. La longueur est vérifiée AVANT tout appel cryptographique
 * : 60 octets, pas un de plus. L'échec du tag GCM n'est pas une erreur
 * réseau — c'est le signe que la clé reçue n'est pas celle attendue. Rien ne
 * doit être installé, et un événement de sécurité doit être journalisé
 * (l'appelant s'en charge : ce module ne journalise rien).
 */
export async function unwrapFek(
  wrapped: Uint8Array,
  unwrapKey: WebCryptoKey
): Promise<WebCryptoKey> {
  if (wrapped.length !== WRAPPED_FEK_LENGTH) {
    throw new Error(`Invalid wrapped FEK length: ${wrapped.length}`);
  }
  const iv = wrapped.subarray(0, IV_LENGTH);
  const sealed = wrapped.subarray(IV_LENGTH);
  return subtle.unwrapKey(
    'raw',
    sealed,
    unwrapKey,
    { name: 'AES-GCM', iv },
    AES_GCM_PARAMS,
    true,
    ['encrypt', 'decrypt']
  );
}

// ── Composition : tout ce qu'un camp dérive d'un coup ───────────────────────

export interface SessionMaterial {
  wrapKey: WebCryptoKey;
  sas: Sas;
}

/**
 * Le chemin de production, des deux côtés : à partir de la clé privée locale,
 * de la clé publique distante, du mode et du secret, produire la clé
 * d'emballage ET le SAS — dérivés du MÊME `Z`, du MÊME sel et du MÊME
 * transcript.
 *
 * Cette unicité est ce qui donne son sens à la comparaison humaine : si quoi
 * que ce soit diverge (clé substituée, mode rétrogradé, code différent), le
 * SAS diverge AVANT que la FEK ne bouge. Séparer les deux dérivations serait
 * rouvrir la porte à un SAS qui coïncide pendant qu'une clé d'emballage
 * diffère — ou l'inverse, bien pire.
 *
 * `Z` est zéroïsé ici même : il n'a aucune raison de survivre à l'appel.
 */
export async function deriveSessionMaterial(params: {
  privateKey: WebCryptoKey;
  remotePublicKeyRaw: Uint8Array;
  publicKeyARaw: Uint8Array;
  publicKeyBRaw: Uint8Array;
  mode: PairingMode;
  secret: Uint8Array | null;
  code: string;
  usages: WebCryptoKeyUsage[];
}): Promise<SessionMaterial> {
  const salt = saltForMode(params.mode, params.secret);
  const wrapInfo = buildWrapInfo(
    params.mode,
    params.code,
    params.publicKeyARaw,
    params.publicKeyBRaw
  );
  const sasInfo = buildSasInfo(
    params.mode,
    params.code,
    params.publicKeyARaw,
    params.publicKeyBRaw
  );

  const z = await computeSharedSecret(params.privateKey, params.remotePublicKeyRaw);
  try {
    const wrapKey = await deriveWrapKey(z, salt, wrapInfo, params.usages);
    const sas = await computeSas(z, salt, sasInfo);
    return { wrapKey, sas };
  } finally {
    zeroize(z);
  }
}
