/**
 * Charge utile du QR d'appairage — PROTOCOLE v2 — COPIE PROCESS PRINCIPAL.
 *
 * IMPORTANT : le corps de ce fichier est un DUPLICATA À L'OCTET PRÈS de
 * `src/services/auth/pairingQr.ts` — tout ce qui suit le présent bloc de
 * commentaire est identique, caractère pour caractère. Le renderer et le
 * process principal ne peuvent pas partager un seul fichier source sans
 * étendre le `rootDir` d'electron, ce qui casserait la mise en page
 * `dist-electron/main.js` attendue par le champ `main` de `package.json`.
 * Même arbitrage, mêmes raisons, que `electron/noteVersionLogic.ts`.
 *
 * SI VOUS ÉDITEZ L'UN, ÉDITEZ L'AUTRE. Sur un chemin cryptographique une
 * divergence silencieuse ne se voit pas : elle produit deux secrets `S`
 * différents et un appairage qui échoue sans dire pourquoi. C'est pourquoi la
 * consigne ne repose pas sur ce commentaire — le test
 * `src/services/auth/__tests__/pairingQr.test.ts` importe LES DEUX copies,
 * compare leurs corps octet pour octet et rejoue sur chacune la table de
 * conformité §1.4 de la spécification.
 *
 * Le POURQUOI du format (secret dans le QR, marqueur `v=2`, motif ancré,
 * canonicité base64url) est documenté en tête de la copie canonique dans
 * `src/`. On ne le recopie pas ici : deux exposés du même raisonnement
 * divergent tôt ou tard, et c'est le raisonnement qu'il faut garder unique.
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
