/**
 * Charge utile du QR d'appairage — PROTOCOLE v2. Logique PURE, sans React,
 * sans crypto de plateforme : uniquement de la mise en forme et de l'analyse
 * d'octets. C'est le CONTRAT DE FORMAT que les trois implémentations
 * (bureau, mobile, worker) doivent lire à l'identique.
 *
 * CE QUI A CHANGÉ PAR RAPPORT À v1, ET POURQUOI
 * --------------------------------------------
 * En v1 le QR ne portait QUE le code à six chiffres, au motif que le canal
 * visuel ne devait rien ajouter au protocole. C'était une erreur d'analyse :
 * la clé d'emballage de la FEK était dérivée avec ce même code à six chiffres
 * comme sel — or ce code est la CLÉ D'INDEX du serveur (`pairing:{code}:…`).
 * Le serveur connaissait donc toutes les entrées de la dérivation sauf le
 * secret ECDH, et ce secret il l'obtenait en substituant sa propre clé
 * publique à celle de B. Un ECDH non authentifié ne protège que d'un écoutant
 * PASSIF, jamais de celui qui achemine les messages. Le serveur pouvait lire
 * la FEK : le « zero-knowledge » revendiqué était faux.
 *
 * v2 met donc dans le QR un SECRET DE HAUTE ENTROPIE (`S`, 32 octets) qui ne
 * transite JAMAIS par le serveur et qui sert de sel HKDF. Le serveur garde le
 * pouvoir de substituer les clés publiques — il perd celui de dériver la clé
 * d'emballage. Le canal visuel devient une VRAIE seconde voie, et c'est
 * précisément parce qu'il en est une qu'on y met quelque chose.
 *
 * Ce que le QR ne porte toujours PAS : ni la FEK, ni un jeton de session, ni
 * un identifiant de compte. `S` n'est utile qu'associé à un ECDH vivant et à
 * une session de 300 s ; photographié seul il ne déchiffre rien.
 *
 * FORME EXACTE (§1.1 de la spec, l'ordre des paramètres est FIXE) :
 *   filarr://pair?v=2&code=<6 chiffres>&s=<43 caractères base64url>
 *
 * `v=2` est un marqueur littéral EN TÊTE : un QR v1 (`filarr://pair?code=…`)
 * ne peut pas être confondu avec un QR v2, ni l'inverse. C'est ce qui rend
 * possible le refus FERMÉ d'un pair trop ancien (§7) — un repli silencieux
 * vers v1 serait un repli vers « le serveur peut lire la FEK », et
 * l'attaquant qui manipule le réseau choisirait toujours v1.
 *
 * POURQUOI UN MOTIF ANCRÉ ET NON `URLSearchParams`. Un analyseur permissif
 * accepterait `?code=…&s=…&next=evil` : on ouvrirait une surface de
 * redirection sur le chemin même qui transporte la clé du coffre. Ce n'est
 * pas une URL routée, c'est une chaîne comparée à un motif.
 *
 * DUPLICATION ASSUMÉE : `electron/pairingQr.ts` est la copie process
 * principal de ce fichier (même raison que `noteVersionLogic.ts` — le
 * `rootDir` d'electron ne peut pas remonter dans `src/` sans casser la mise
 * en page de `dist-electron/main.js`). Si vous éditez l'un, éditez l'autre.
 * Le test `src/services/auth/__tests__/pairingQr.test.ts` importe LES DEUX et
 * les confronte à la même table de conformité : une divergence tombe en test,
 * pas chez un utilisateur dont le téléphone ne s'appaire plus.
 */

/** Version du protocole d'appairage portée par le QR. Littérale, jamais négociée. */
export const PAIRING_PROTOCOL_VERSION = 2;

/** Le code d'appairage : exactement six chiffres décimaux, rien de plus. */
const CODE_PATTERN = /^\d{6}$/;

/** Longueur imposée du secret `S`, en octets (§1.1). */
export const PAIRING_SECRET_BYTES = 32;

/** Longueur du secret encodé en base64url sans remplissage : 32 o → 43 car. */
export const PAIRING_SECRET_B64URL_LENGTH = 43;

/**
 * Préfixe comparé SANS TENIR COMPTE DE LA CASSE. RFC 3986 §3.1 : le schéma
 * d'une URI est insensible à la casse. Un QR gravé `FILARR://PAIR?…` par un
 * outil tiers désigne le même lien et doit être accepté.
 */
const QR_PREFIX = 'filarr://pair';

/**
 * La requête, elle, est comparée EN RESPECTANT LA CASSE : `s` est du
 * base64url, où `M` et `m` sont deux secrets différents. Une comparaison
 * insensible à la casse ici produirait silencieusement un mauvais `S`, donc
 * une clé d'emballage fausse, donc un échec de déballage sans explication.
 */
const QR_QUERY_PATTERN = /^v=2&code=(\d{6})&s=([A-Za-z0-9_-]{43})$/;

// ── Codec base64url, sans remplissage (RFC 4648 §5) ──────────────────────────

/**
 * On écrit le codec à la main plutôt que d'emprunter `Buffer` (absent du
 * renderer) ou `btoa`/`atob` (qui passent par des chaînes binaires et
 * traitent l'alphabet standard, pas l'alphabet URL). Trente lignes explicites
 * valent mieux qu'une conversion dont le comportement de bourrage varie d'une
 * pile à l'autre — et c'est exactement le genre d'écart que ce fichier existe
 * pour empêcher.
 */
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64UrlEncodeNoPad(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64URL_ALPHABET[(acc >> bits) & 0x3f];
    }
  }
  // Reste de 2 ou 4 bits : on complète par des zéros à DROITE, comme l'exige
  // le format. Ce sont ces bits de bourrage que `parsePairingQrV2` vérifie.
  if (bits > 0) {
    out += B64URL_ALPHABET[(acc << (6 - bits)) & 0x3f];
  }
  return out;
}

export function base64UrlDecodeNoPad(text: string): Uint8Array | null {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const v = B64URL_ALPHABET.indexOf(text[i]);
    if (v < 0) return null; // caractère hors alphabet — y compris `+`, `/`, `=`
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// ── Construction ────────────────────────────────────────────────────────────

/**
 * Construit la charge du QR v2, ou `null` si les entrées ne sont pas
 * exactement celles attendues.
 *
 * POURQUOI VALIDER ICI PLUTÔT QUE DE FAIRE CONFIANCE À L'APPELANT. Le code
 * arrive d'un aller-retour réseau, le secret d'un CSPRNG dont un appelant
 * distrait pourrait avoir demandé la mauvaise longueur. Rendre `null` laisse
 * l'interface afficher les six chiffres (le repli manuel existe déjà) au lieu
 * de graver un QR qui ne scannera jamais — ou pire, qui encoderait un secret
 * tronqué que l'autre appareil accepterait sans broncher.
 */
export function buildPairingQrPayloadV2(code: string, secret: Uint8Array): string | null {
  if (!CODE_PATTERN.test(code)) return null;
  if (secret.length !== PAIRING_SECRET_BYTES) return null;
  const s = base64UrlEncodeNoPad(secret);
  if (s.length !== PAIRING_SECRET_B64URL_LENGTH) return null;
  return `filarr://pair?v=${PAIRING_PROTOCOL_VERSION}&code=${code}&s=${s}`;
}

// ── Analyse ─────────────────────────────────────────────────────────────────

export interface ParsedPairingQrV2 {
  code: string;
  secret: Uint8Array;
}

/**
 * Analyse stricte d'un QR v2 (§1.3). Rend `null` sur TOUT écart — un QR v1,
 * un paramètre en plus, un ordre différent, un secret de mauvaise longueur.
 *
 * LE CONTRÔLE DE CANONICITÉ EST OBLIGATOIRE, et c'est le piège le moins
 * évident du format. 43 caractères base64url portent 258 bits pour 256 bits
 * utiles : les DEUX BITS DE POIDS FAIBLE DU DERNIER CARACTÈRE sont
 * structurellement nuls. Un décodeur laxiste accepte `…q61` et `…q60` comme
 * le même secret. Deux implémentations dont les décodeurs diffèrent
 * aboutissent alors à des `S` différents — donc à des clés d'emballage
 * différentes — et l'appairage échoue MUETTEMENT, sans que rien n'indique
 * lequel des deux appareils a tort. Ré-encoder et exiger la chaîne d'origine,
 * caractère pour caractère, supprime le débat.
 */
export function parsePairingQrV2(raw: string | null | undefined): ParsedPairingQrV2 | null {
  const text = (raw ?? '').trim();

  const q = text.indexOf('?');
  if (q < 0) return null;

  // Préfixe : insensible à la casse (schéma URI). Requête : sensible.
  if (text.slice(0, q).toLowerCase() !== QR_PREFIX) return null;

  const m = QR_QUERY_PATTERN.exec(text.slice(q + 1));
  if (!m) return null;

  const secret = base64UrlDecodeNoPad(m[2]);
  if (!secret || secret.length !== PAIRING_SECRET_BYTES) return null;

  // Canonicité : les bits de bourrage doivent être nuls.
  if (base64UrlEncodeNoPad(secret) !== m[2]) return null;

  return { code: m[1], secret };
}

/**
 * Vrai si la chaîne est un QR v2 bien formé. Utilisé par le renderer AVANT de
 * graver l'image : le renderer ne connaît pas le secret et n'a pas à le
 * connaître, mais il ne doit pas non plus graver aveuglément ce qu'on lui
 * tend. Une charge malformée fait retomber l'interface sur les six chiffres
 * au lieu d'afficher un QR mort.
 */
export function isPairingQrV2(raw: string | null | undefined): boolean {
  return parsePairingQrV2(raw) !== null;
}
