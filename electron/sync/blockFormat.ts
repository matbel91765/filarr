/**
 * blockFormat.ts — En-tête et AAD des objets bloc delta. PUR ET PORTABLE.
 *
 * Lot 21 du chantier synchronisation. Ce module ne chiffre rien : il décrit la
 * FORME de l'objet stocké et construit les données authentifiées associées.
 * Le chiffrement vit dans `deltaChunkCrypto.ts` (bureau, `node:crypto`) et dans
 * `portableBlockCrypto.ts` (web + mobile, WebCrypto).
 *
 * ── LES DEUX FORMATS QUI COEXISTENT ──────────────────────────────────────────
 *
 * v1 — écrit depuis mars 2026, décrit par un manifeste `v: 4`
 *   nonce(12) || chiffré || tag(16)                         surcoût 28
 *   Pas d'en-tête. La version n'est liée que dans l'AAD (magic `FILRDLT4`).
 *
 * v2 — NOUVEAU, décrit par un manifeste `v: 5`
 *   flags(1) || nonce(12) || chiffré || tag(16)              surcoût 29
 *   bits 0-3 : version de format du bloc, = 2
 *   bit  4   : 1 = le clair a été compressé AVANT chiffrement
 *   bits 5-7 : réservés, DOIVENT valoir 0
 *
 * C'est le MANIFESTE qui dit lequel on lit, jamais une heuristique de longueur :
 * une heuristique se tromperait sur un bloc dont la taille tombe juste, et se
 * tromperait en silence.
 *
 * ── POURQUOI UN OCTET SUR LE FIL ALORS QUE L'AAD PORTE DÉJÀ LA VERSION ───────
 * Parce que pour construire l'AAD il faut connaître les drapeaux, et pour
 * connaître les drapeaux il faut les avoir lus. Lier la version dans l'AAD
 * suffisait tant qu'aucun drapeau ne changeait le traitement du clair. La
 * compression change ce traitement : sans octet lisible avant déchiffrement, on
 * ne saurait pas s'il faut décompresser. C'est ce qui rend ce lot nécessaire.
 *
 * ── ET POURQUOI IL EST QUAND MÊME LIÉ DANS L'AAD ─────────────────────────────
 * Un octet en clair devant un chiffré est modifiable par qui stocke l'objet.
 * Sans liaison, un serveur pourrait allumer le bit de compression et faire
 * décompresser des octets qui ne l'ont jamais été. L'octet ENTIER entre donc
 * dans l'AAD : le tag GCM refuse alors tout octet retourné.
 *
 * ── ZÉRO IMPORT ──────────────────────────────────────────────────────────────
 * Recopié par le mobile, importé par l'app web. Pas de `Buffer`, pas de
 * `node:crypto`, pas d'Electron — `Uint8Array`, `DataView` et `TextEncoder`
 * existent dans les trois environnements.
 */

// ── Constantes de format ─────────────────────────────────────────────────────

/** Magic lié dans l'AAD des blocs v1 (manifeste v4). Ne pas réutiliser. */
export const BLOCK_MAGIC_V1 = 'FILRDLT4';
/** Magic lié dans l'AAD des blocs v2 (manifeste v5). */
export const BLOCK_MAGIC_V2 = 'FILRDLT5';

/** Version portée par les bits 0-3 de l'octet d'en-tête v2. */
export const BLOCK_FORMAT_V2 = 2;

/** Bit 4 : le clair a été compressé avant chiffrement. */
export const FLAG_COMPRESSED = 0x10;
/** Bits 5-7 : réservés. Tout objet qui en allume un est REFUSÉ. */
export const FLAG_RESERVED_MASK = 0xe0;
/** Bits 0-3 : version. */
export const FLAG_VERSION_MASK = 0x0f;

export const NONCE_SIZE = 12;
export const TAG_SIZE = 16;
export const KEY_SIZE = 32;
export const HASH_BYTES = 32;

/** Surcoût stocké d'un bloc v1 : nonce + tag. */
export const OVERHEAD_V1 = NONCE_SIZE + TAG_SIZE; // 28
/** Surcoût stocké d'un bloc v2 : en-tête + nonce + tag. */
export const OVERHEAD_V2 = 1 + NONCE_SIZE + TAG_SIZE; // 29

/**
 * `index` lié dans l'AAD de TOUS les blocs, quelle que soit leur position.
 *
 * ⚠ NE JAMAIS remplacer par la position réelle. Un objet adressé par contenu
 * peut être référencé à plusieurs positions, et sa position peut changer d'une
 * version à l'autre alors que le chiffré stocké, lui, ne change pas (il est
 * sauté par la déduplication). Lier la position rendrait indéchiffrable tout
 * bloc qu'une modification a déplacé. L'ordre est porté par `blocks[]` du
 * manifeste, authentifié par la FEK. La suite `blockFormat.vitest.ts` échoue si
 * cette constante bouge.
 */
export const AAD_CONSTANT_INDEX = 0;

/** Message d'erreur unique — même formulation que `streamCrypto`. */
export const ERR_CORRUPT = 'Fichier chiffre corrompu - dechiffrement impossible';

const HEX_RE = /^[0-9a-f]{64}$/;
const MAX_U32 = 0xffffffff;

// ── En-tête ──────────────────────────────────────────────────────────────────

export interface BlockHeader {
  /** Version de format du bloc. Seule la 2 existe aujourd'hui. */
  version: number;
  /** Le clair a-t-il été compressé avant chiffrement ? */
  compressed: boolean;
}

/**
 * Compose l'octet d'en-tête v2.
 * Refuse toute version qui ne tient pas sur 4 bits — un dépassement silencieux
 * écrirait des bits dans la zone réservée.
 */
export function encodeHeader(header: BlockHeader): number {
  const { version, compressed } = header;
  if (!Number.isInteger(version) || version < 0 || version > FLAG_VERSION_MASK) {
    throw new Error(`blockFormat: version hors bornes (${version})`);
  }
  return (version & FLAG_VERSION_MASK) | (compressed ? FLAG_COMPRESSED : 0);
}

/**
 * Décode l'octet d'en-tête v2.
 *
 * REFUSE un octet dont un bit réservé est allumé, plutôt que de l'ignorer.
 * Ignorer les bits inconnus est le réflexe habituel, et c'est le mauvais ici :
 * un futur format pourrait s'en servir pour dire « ce bloc est chiffré
 * autrement ». Un lecteur d'aujourd'hui qui les ignorerait déchiffrerait de
 * travers en croyant réussir. Échouer franchement laisse la porte ouverte.
 */
export function decodeHeader(byte: number): BlockHeader {
  if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
    throw new Error(ERR_CORRUPT);
  }
  if ((byte & FLAG_RESERVED_MASK) !== 0) {
    throw new Error(ERR_CORRUPT);
  }
  return {
    version: byte & FLAG_VERSION_MASK,
    compressed: (byte & FLAG_COMPRESSED) !== 0,
  };
}

// ── AAD ──────────────────────────────────────────────────────────────────────

const TE = new TextEncoder();

function assertU32(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new Error(ERR_CORRUPT);
  }
}

/** 64 caractères hexadécimaux minuscules vers 32 octets. */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) {
    throw new Error(ERR_CORRUPT);
  }
  const out = new Uint8Array(HASH_BYTES);
  for (let i = 0; i < HASH_BYTES; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 32 octets vers 64 caractères hexadécimaux minuscules. */
export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export interface AadInput {
  fileId: string;
  /** SHA-256 hexadécimal du CLAIR — jamais du compressé. */
  plaintextHash: string;
  /** Longueur du clair, avant compression. */
  plaintextSize: number;
}

/**
 * AAD d'un bloc **v2**.
 *
 *   magic("FILRDLT5") || flags(1) || u16 longueurFileId || fileId
 *                     || u32 index(=0) || hashClair(32) || u32 tailleClair
 *
 * `flags` est l'octet d'en-tête ENTIER, version comprise : le lier séparément
 * serait redondant. `plaintextSize` est la taille AVANT compression — c'est ce
 * qui lie le bloc à son contenu réel et empêche qu'un chiffré compressé soit
 * présenté comme un clair d'une autre longueur.
 */
export function buildAadV2(input: AadInput, headerByte: number): Uint8Array {
  const { fileId, plaintextHash, plaintextSize } = input;
  assertU32(plaintextSize);
  if (!Number.isInteger(headerByte) || headerByte < 0 || headerByte > 0xff) {
    throw new Error(ERR_CORRUPT);
  }
  const magic = TE.encode(BLOCK_MAGIC_V2);
  const fileIdBytes = TE.encode(fileId);
  if (fileIdBytes.length > 0xffff) throw new Error(ERR_CORRUPT);
  const hash = hexToBytes(plaintextHash);

  const out = new Uint8Array(magic.length + 1 + 2 + fileIdBytes.length + 4 + HASH_BYTES + 4);
  const view = new DataView(out.buffer);
  let o = 0;
  out.set(magic, o); o += magic.length;
  out[o] = headerByte; o += 1;
  view.setUint16(o, fileIdBytes.length, false); o += 2;
  out.set(fileIdBytes, o); o += fileIdBytes.length;
  view.setUint32(o, AAD_CONSTANT_INDEX, false); o += 4;
  out.set(hash, o); o += HASH_BYTES;
  view.setUint32(o, plaintextSize, false);
  return out;
}

// ── Objet stocké ─────────────────────────────────────────────────────────────

export interface ParsedBlock {
  header: BlockHeader;
  nonce: Uint8Array;
  /** Chiffré + tag, tels que WebCrypto les attend concaténés. */
  ciphertextAndTag: Uint8Array;
  /** Octet d'en-tête brut, à relier dans l'AAD. */
  headerByte: number;
}

/** Assemble l'objet stocké v2 : `flags || nonce || chiffré || tag`. */
export function frameBlockV2(
  headerByte: number,
  nonce: Uint8Array,
  ciphertextAndTag: Uint8Array
): Uint8Array {
  if (nonce.length !== NONCE_SIZE) throw new Error(ERR_CORRUPT);
  const out = new Uint8Array(1 + nonce.length + ciphertextAndTag.length);
  out[0] = headerByte;
  out.set(nonce, 1);
  out.set(ciphertextAndTag, 1 + nonce.length);
  return out;
}

/**
 * Découpe un objet stocké **v2**.
 *
 * Un objet trop court pour contenir en-tête + nonce + tag est refusé avant
 * toute tentative de déchiffrement : sans ce garde-fou, `subarray` rendrait des
 * vues vides et l'échec surviendrait plus loin, avec un message trompeur.
 */
export function parseBlockV2(blob: Uint8Array): ParsedBlock {
  if (blob.length < OVERHEAD_V2) throw new Error(ERR_CORRUPT);
  const headerByte = blob[0];
  const header = decodeHeader(headerByte);
  if (header.version !== BLOCK_FORMAT_V2) throw new Error(ERR_CORRUPT);
  return {
    header,
    headerByte,
    nonce: blob.subarray(1, 1 + NONCE_SIZE),
    ciphertextAndTag: blob.subarray(1 + NONCE_SIZE),
  };
}

/**
 * Taille stockée attendue pour un bloc, à partir de la taille effectivement
 * transmise au chiffrement.
 *
 * ⚠ NE PAS s'en servir pour le quota. Le manifeste v5 porte la taille RÉELLE
 * dans `blocks[].e` et c'est la seule source de vérité — précisément parce que
 * deux constantes de surcoût (28 et 29) se contredisaient dans deux modules du
 * même composant, et que la compression rend de toute façon la taille stockée
 * imprévisible. Cette fonction ne sert qu'à VÉRIFIER un objet qu'on vient
 * d'écrire.
 */
export function storedSizeOf(payloadSize: number, version: number): number {
  if (version === BLOCK_FORMAT_V2) return payloadSize + OVERHEAD_V2;
  return payloadSize + OVERHEAD_V1;
}
