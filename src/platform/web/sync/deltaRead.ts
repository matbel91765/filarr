/**
 * deltaRead.ts — Lecture des fichiers DELTA (≥ 64 Mio) sur le web.
 *
 * ── CE QUE C'EST ─────────────────────────────────────────────────────────────
 * Au-delà de 64 Mio, le bureau ne téléverse plus un fichier en tranches
 * (`chunk_N`) mais en BLOCS adressés par leur contenu (`blocks/{hash}.enc`),
 * décrits par un manifeste delta scellé sous la FEK (`fek:` / `fkz:`). Deux
 * versions du manifeste coexistent et se lisent toutes deux, sans drapeau :
 *
 *   · v4 — blocs fixes de 8 Mio, objet `nonce(12) ‖ chiffré ‖ tag(16)`, AAD =
 *     `"FILRDLT4" ‖ 0x04 ‖ u16BE(len fileId) ‖ fileId ‖ u32BE(0) ‖ hash(32) ‖ u32BE(taille)` ;
 *   · v5 — découpage par le contenu (FastCDC), compression `deflate-raw`
 *     facultative, objet `en-tête(1) ‖ nonce(12) ‖ chiffré ‖ tag(16)`, AAD liant
 *     l'en-tête entier (voir `blockFormat.buildAadV2`). Lu par
 *     `portableBlockCrypto.decryptBlockV2`, la copie web du module bureau.
 *
 * La clé de fichier est la même pour les deux : HKDF-SHA-256(FEK, sel du
 * manifeste, "filarr-delta-v4", 32). L'`info` reste « v4 » en v5 à dessein —
 * changer le contexte de dérivation rendrait illisible tout ce qui est déjà
 * écrit (même règle que `filarr-share-v1`, voir `deltaShared.ts` côté bureau).
 *
 * L'index de position vaut 0 dans TOUTES les AAD : un objet adressé par son
 * contenu peut être cité à plusieurs positions sans que ses octets changent.
 * L'ordre est porté par le manifeste, dont l'intégrité tient au scellement FEK.
 *
 * ── CE QU'ON VÉRIFIE ─────────────────────────────────────────────────────────
 * Chaque bloc : tag GCM + AAD, longueur exacte, SHA-256 du clair égal au hash
 * du manifeste. Le fichier entier : longueur totale et `plaintextChecksum`.
 * Toute anomalie lève la même erreur de corruption que le bureau — jamais un
 * clair douteux.
 *
 * ── CE QUE ÇA COÛTE ──────────────────────────────────────────────────────────
 * Le fichier entier est assemblé en mémoire (comme les autres téléchargements
 * du web) puis rechiffré pour le cache IndexedDB par l'appelant : compter
 * deux fois sa taille. Les blocs sont demandés quatre à la fois.
 */
import {
  AAD_CONSTANT_INDEX,
  ERR_CORRUPT,
  HASH_BYTES,
  KEY_SIZE,
  NONCE_SIZE,
  TAG_SIZE,
  hexToBytes,
} from './blockFormat';
import { CODEC_DEFLATE_RAW } from './blockCodec';
import { decryptBlockV2, sha256Hex } from './portableBlockCrypto';
import { apiFetch, ensureAccessToken, refreshViaCookie, resolveApiBase } from '../webApiBase';
import { decryptFekContainer } from './containerCrypto';

export const DELTA_MANIFEST_FMT = 'filarr-delta-manifest';
export const DELTA_HKDF_INFO = 'filarr-delta-v4';
export const MANIFEST_V4 = 4;
export const MANIFEST_V5 = 5;
/** Magie et version liées dans l'AAD des blocs v4 (`deltaChunkCrypto.ts`). */
export const V4_BLOCK_MAGIC = 'FILRDLT4';
export const V4_BLOCK_VERSION = 0x04;
export const OVERHEAD_V4 = NONCE_SIZE + TAG_SIZE;
export const DELTA_READ_CONCURRENCY = 4;
export const ERR_DELTA_MANIFEST_ABSENT = 'Fichier delta sans index sur le nuage';
export const ERR_DELTA_BLOCK_MISSING = 'Bloc delta introuvable sur le nuage';
const ERR_MANIFEST_PARSE = 'Manifeste delta illisible (JSON invalide)';
const ERR_MANIFEST_INVALID = 'Manifeste delta invalide';
const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_U32 = 0xffffffff;

export interface DeltaBlockRef {
  i: number;
  h: string;
  s: number;
  /** Taille stockée : déclarée en v5, `s + 28` en v4. */
  e: number;
}

export interface DeltaManifestView {
  version: number;
  fileId: string;
  totalSize: number;
  blockCount: number;
  kdf: { name: string; salt: string; info: string };
  plaintextChecksum: string;
  blocks: DeltaBlockRef[];
  codec: string | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function u32(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_U32 ? v : null;
}

/**
 * Lit et VALIDE un manifeste delta, v4 ou v5 — miroir de
 * `deltaManifestV5.readManifest` côté bureau : mêmes refus, même forme rendue.
 * Un v4 qui porte `chunking`/`codec`, un v5 qui porte `blockSize`, des blocs
 * non contigus ou une somme qui ne tombe pas sur `totalSize` sont rejetés.
 */
export function parseDeltaManifest(json: string): DeltaManifestView {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(ERR_MANIFEST_PARSE);
  }
  if (!isObject(raw) || raw.fmt !== DELTA_MANIFEST_FMT) throw new Error(ERR_MANIFEST_INVALID);
  const version = u32(raw.v);
  if (version !== MANIFEST_V4 && version !== MANIFEST_V5) throw new Error(ERR_MANIFEST_INVALID);
  const totalSize = u32(raw.totalSize);
  const blockCount = u32(raw.blockCount);
  if (totalSize === null || blockCount === null) throw new Error(ERR_MANIFEST_INVALID);
  if (
    typeof raw.fileId !== 'string' ||
    typeof raw.algo !== 'string' ||
    typeof raw.plaintextChecksum !== 'string' ||
    !HASH_RE.test(raw.plaintextChecksum) ||
    typeof raw.createdAt !== 'string' ||
    !Array.isArray(raw.blocks) ||
    !isObject(raw.kdf) ||
    typeof raw.kdf.name !== 'string' ||
    typeof raw.kdf.salt !== 'string' ||
    typeof raw.kdf.info !== 'string'
  ) {
    throw new Error(ERR_MANIFEST_INVALID);
  }
  let codec: string | null = null;
  if (version === MANIFEST_V5) {
    const chunking = raw.chunking;
    if (!isObject(chunking)) throw new Error(ERR_MANIFEST_INVALID);
    const min = u32(chunking.min);
    const avg = u32(chunking.avg);
    const max = u32(chunking.max);
    const maskBits = u32(chunking.maskBits);
    const normalization = u32(chunking.normalization);
    if (
      min === null ||
      avg === null ||
      max === null ||
      maskBits === null ||
      normalization === null
    ) {
      throw new Error(ERR_MANIFEST_INVALID);
    }
    if (!(min > 0 && avg >= min && max >= avg)) throw new Error(ERR_MANIFEST_INVALID);
    if (maskBits + normalization > 31 || maskBits - normalization < 1) {
      throw new Error(ERR_MANIFEST_INVALID);
    }
    if (typeof chunking.name !== 'string' || typeof chunking.gear !== 'string') {
      throw new Error(ERR_MANIFEST_INVALID);
    }
    codec =
      chunking.codec === null || chunking.codec === undefined ? null : (chunking.codec as string);
    if (codec !== null && codec !== CODEC_DEFLATE_RAW) throw new Error(ERR_MANIFEST_INVALID);
    if (raw.blockSize !== undefined) throw new Error(ERR_MANIFEST_INVALID);
  } else {
    const blockSize = u32(raw.blockSize);
    if (blockSize === null || blockSize <= 0) throw new Error(ERR_MANIFEST_INVALID);
    if (raw.chunking !== undefined || raw.codec !== undefined)
      throw new Error(ERR_MANIFEST_INVALID);
  }
  if (raw.blocks.length !== blockCount) throw new Error(ERR_MANIFEST_INVALID);
  const blocks: DeltaBlockRef[] = [];
  let sum = 0;
  for (let n = 0; n < raw.blocks.length; n++) {
    const b: unknown = raw.blocks[n];
    if (!isObject(b)) throw new Error(ERR_MANIFEST_INVALID);
    const i = u32(b.i);
    const s = u32(b.s);
    if (i === null || s === null || typeof b.h !== 'string' || !HASH_RE.test(b.h)) {
      throw new Error(ERR_MANIFEST_INVALID);
    }
    if (i !== n) throw new Error(ERR_MANIFEST_INVALID);
    let e: number;
    if (version === MANIFEST_V5) {
      const declared = u32(b.e);
      if (declared === null) throw new Error(ERR_MANIFEST_INVALID);
      e = declared;
    } else {
      e = s + OVERHEAD_V4;
    }
    blocks.push({ i, h: b.h, s, e });
    sum += s;
  }
  if (sum !== totalSize) throw new Error(ERR_MANIFEST_INVALID);
  return {
    version,
    fileId: raw.fileId,
    totalSize,
    blockCount,
    kdf: { name: raw.kdf.name, salt: raw.kdf.salt, info: raw.kdf.info },
    plaintextChecksum: raw.plaintextChecksum,
    blocks,
    codec,
  };
}

const toBufferSource = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Clé de fichier = HKDF-SHA-256(FEK, sel, "filarr-delta-v4", 32). Le sel vient
 * du manifeste (base64) ; vide, il est refusé — comme côté bureau.
 */
export async function deriveDeltaKey(fekRaw: Uint8Array, saltB64: string): Promise<Uint8Array> {
  const salt = base64ToBytes(saltB64);
  if (salt.length === 0) throw new Error(ERR_CORRUPT);
  const base = await crypto.subtle.importKey('raw', toBufferSource(fekRaw), 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toBufferSource(salt),
      info: toBufferSource(new TextEncoder().encode(DELTA_HKDF_INFO)),
    },
    base,
    KEY_SIZE * 8
  );
  return new Uint8Array(bits);
}

/** AAD d'un bloc v4 — octet pour octet celle de `deltaChunkCrypto.buildBlockAad`. */
export function buildAadV1(fileId: string, hashHex: string, size: number): Uint8Array {
  if (u32(size) === null) throw new Error(ERR_CORRUPT);
  if (!HASH_RE.test(hashHex.toLowerCase())) throw new Error(ERR_CORRUPT);
  const fileIdBytes = new TextEncoder().encode(fileId);
  if (fileIdBytes.length > 0xffff) throw new Error(ERR_CORRUPT);
  const magic = new TextEncoder().encode(V4_BLOCK_MAGIC);
  const aad = new Uint8Array(magic.length + 1 + 2 + fileIdBytes.length + 4 + HASH_BYTES + 4);
  const view = new DataView(aad.buffer);
  let o = 0;
  aad.set(magic, o);
  o += magic.length;
  view.setUint8(o, V4_BLOCK_VERSION);
  o += 1;
  view.setUint16(o, fileIdBytes.length, false);
  o += 2;
  aad.set(fileIdBytes, o);
  o += fileIdBytes.length;
  view.setUint32(o, AAD_CONSTANT_INDEX, false);
  o += 4;
  aad.set(hexToBytes(hashHex.toLowerCase()), o);
  o += HASH_BYTES;
  view.setUint32(o, size, false);
  return aad;
}

/** Déchiffre un bloc v4 : `nonce(12) ‖ chiffré ‖ tag(16)`, longueur et hash vérifiés. */
export async function decryptBlockV1(
  key: Uint8Array,
  fileId: string,
  hashHex: string,
  expectedSize: number,
  blob: Uint8Array
): Promise<Uint8Array> {
  if (key.length !== KEY_SIZE) throw new Error(ERR_CORRUPT);
  if (blob.length < OVERHEAD_V4 || blob.length - OVERHEAD_V4 !== expectedSize) {
    throw new Error(ERR_CORRUPT);
  }
  const aad = buildAadV1(fileId, hashHex, expectedSize);
  const nonce = blob.subarray(0, NONCE_SIZE);
  const ciphertextAndTag = blob.subarray(NONCE_SIZE);
  let plain: Uint8Array;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      toBufferSource(key),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toBufferSource(nonce),
          additionalData: toBufferSource(aad),
          tagLength: TAG_SIZE * 8,
        },
        cryptoKey,
        toBufferSource(ciphertextAndTag)
      )
    );
  } catch {
    throw new Error(ERR_CORRUPT);
  }
  if (plain.length !== expectedSize) throw new Error(ERR_CORRUPT);
  if ((await sha256Hex(plain)) !== hashHex.toLowerCase()) throw new Error(ERR_CORRUPT);
  return plain;
}

export interface DeltaTransport {
  /** Le manifeste scellé (`fek:`/`fkz:`), ou `null` s'il n'existe pas là-haut. */
  getManifest(): Promise<Uint8Array | null>;
  /** Les octets d'un bloc. Rejette avec `ERR_DELTA_BLOCK_MISSING` s'il est absent. */
  getBlock(hash: string): Promise<Uint8Array>;
}

export interface ReadDeltaOptions {
  fekRaw: Uint8Array;
  fileId: string;
  transport: DeltaTransport;
  decryptManifest: (sealed: Uint8Array) => Promise<Uint8Array>;
  concurrency?: number;
  onProgress?: (doneBlocks: number, totalBlocks: number) => void;
}

/** Applique `fn` avec au plus `limit` appels en vol ; le premier échec rejette. */
async function mapBounded<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/**
 * Lit un fichier delta entier : manifeste → clé → blocs (déchiffrés, vérifiés,
 * déduits par empreinte) → assemblage dans l'ordre du manifeste → vérification
 * de la longueur totale et de l'empreinte du fichier.
 */
export async function readDeltaFile(opts: ReadDeltaOptions): Promise<Uint8Array> {
  const sealed = await opts.transport.getManifest();
  if (!sealed) throw new Error(ERR_DELTA_MANIFEST_ABSENT);
  const json = new TextDecoder().decode(await opts.decryptManifest(sealed));
  const manifest = parseDeltaManifest(json);
  const key = await deriveDeltaKey(opts.fekRaw, manifest.kdf.salt);

  // Une empreinte = un objet là-haut, quel que soit le nombre de positions qui
  // la citent : on ne la télécharge et ne la déchiffre qu'une fois.
  const sizeByHash = new Map<string, number>();
  for (const b of manifest.blocks) if (!sizeByHash.has(b.h)) sizeByHash.set(b.h, b.s);
  const plainByHash = new Map<string, Uint8Array>();
  const total = manifest.blocks.length;
  await mapBounded(
    [...sizeByHash.keys()],
    opts.concurrency ?? DELTA_READ_CONCURRENCY,
    async (hash) => {
      const size = sizeByHash.get(hash) ?? 0;
      const blob = await opts.transport.getBlock(hash);
      const plain =
        manifest.version === MANIFEST_V5
          ? await decryptBlockV2(key, opts.fileId, blob, { hash, plaintextSize: size })
          : await decryptBlockV1(key, opts.fileId, hash, size, blob);
      plainByHash.set(hash, plain);
      // Progression en POSITIONS couvertes, pas en objets : un doublon fait avancer
      // deux positions d'un coup, et la barre dit ce que l'utilisateur voit.
      let couvertes = 0;
      for (const b of manifest.blocks) if (plainByHash.has(b.h)) couvertes++;
      opts.onProgress?.(couvertes, total);
    }
  );

  const out = new Uint8Array(manifest.totalSize);
  let offset = 0;
  for (const b of manifest.blocks) {
    const plain = plainByHash.get(b.h);
    if (!plain || plain.length !== b.s || offset + b.s > out.length) throw new Error(ERR_CORRUPT);
    out.set(plain, offset);
    offset += b.s;
  }
  if (offset !== manifest.totalSize) throw new Error(ERR_CORRUPT);
  if ((await sha256Hex(out)) !== manifest.plaintextChecksum) throw new Error(ERR_CORRUPT);
  key.fill(0);
  return out;
}

export interface DeltaTransportDeps {
  apiFetch: typeof apiFetch;
  ensureAccessToken: typeof ensureAccessToken;
  refreshViaCookie: typeof refreshViaCookie;
  resolveApiBase: typeof resolveApiBase;
  fetch: typeof fetch;
}

const defaultDeps = (): DeltaTransportDeps => ({
  apiFetch,
  ensureAccessToken,
  refreshViaCookie,
  resolveApiBase,
  fetch: (...args) => fetch(...args),
});

/**
 * Transport réel : `GET /sync/delta/manifest/:profileId/:fileId` (JSON, manifeste
 * en base64) et `GET /sync/delta/block/:profileId/:fileId/:hash` (octets bruts,
 * authentifié, un rejeu après renouvellement de jeton sur 401).
 */
export function createDeltaTransport(
  profileId: string,
  fileId: string,
  deps: DeltaTransportDeps = defaultDeps()
): DeltaTransport {
  const enc = encodeURIComponent;
  const fetchBytes = async (path: string, retried = false): Promise<Response> => {
    const token = await deps.ensureAccessToken();
    const res = await deps.fetch(`${deps.resolveApiBase()}${path}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401 && !retried && (await deps.refreshViaCookie())) {
      return fetchBytes(path, true);
    }
    return res;
  };
  return {
    async getManifest() {
      const res = await deps.apiFetch<{ data?: { manifest?: string | null; version?: number } }>(
        `/sync/delta/manifest/${enc(profileId)}/${enc(fileId)}`
      );
      if (!res.body?.success) {
        throw new Error(res.body?.error || `Manifeste delta : HTTP ${res.status}`);
      }
      const b64 = res.body.data?.manifest;
      return b64 ? base64ToBytes(b64) : null;
    },
    async getBlock(hash: string) {
      if (!HASH_RE.test(hash)) throw new Error(ERR_CORRUPT);
      const res = await fetchBytes(`/sync/delta/block/${enc(profileId)}/${enc(fileId)}/${hash}`);
      if (res.status === 404) throw new Error(ERR_DELTA_BLOCK_MISSING);
      if (!res.ok) throw new Error(`Bloc delta : HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** Le chemin complet depuis `fetchCloudFile` : nuage → clair, FEK en main. */
export async function readDeltaFileFromCloud(
  profileId: string,
  fileId: string,
  fekRaw: Uint8Array,
  onProgress?: ReadDeltaOptions['onProgress']
): Promise<Uint8Array> {
  return readDeltaFile({
    fekRaw,
    fileId,
    transport: createDeltaTransport(profileId, fileId),
    decryptManifest: (sealed) => decryptFekContainer(sealed, fekRaw),
    onProgress,
  });
}
