/**
 * deltaManifestV5.ts — Lecture et écriture du manifeste delta v5. PORTABLE.
 *
 * Lots 13-16, 18 et 21. Le manifeste v4 décrit des blocs à frontière FIXE de
 * 8 Mio ; le v5 décrit des blocs découpés sur le CONTENU, éventuellement
 * compressés, et porte leur taille stockée réelle.
 *
 * ── POURQUOI UN MODULE À CÔTÉ ET NON UNE RÉÉCRITURE ──────────────────────────
 * `deltaManifest.ts` pilote le chemin de production v4 et importe `node:crypto`.
 * Le lot 8 exige que la LECTURE soit portable — l'app web et le mobile doivent
 * lire ces manifestes. Ce module est donc sans aucun import, et lit les DEUX
 * versions. Le chemin d'écriture v4 existant reste intact tant qu'il n'a pas
 * basculé ; rien de ce fichier ne le déstabilise.
 *
 * ── UN LECTEUR v5 LIT LE v4, JAMAIS L'INVERSE ────────────────────────────────
 * Les deux formats coexistent indéfiniment : aucun fichier n'est migré, un
 * fichier reste en v4 jusqu'à sa prochaine réécriture complète. `readManifest`
 * normalise les deux vers une seule forme en mémoire, pour que le reste du code
 * n'ait pas à savoir laquelle il manipule.
 *
 * ── LA TAILLE STOCKÉE NE SE RECALCULE PLUS ───────────────────────────────────
 * En v5, chaque bloc porte `e`, sa taille réellement stockée. C'est la seule
 * source de vérité pour le quota et pour l'estimation de transfert.
 *
 * Ce n'est pas une commodité, c'est la correction d'un bogue : `deltaManifest`
 * déclarait `DELTA_BLOCK_OVERHEAD = 29` pour un format qui en faisait 28
 * (`deltaSync` disait 28, et le format réel lui donnait raison). Le quota
 * sur-comptait donc un octet par bloc depuis mars 2026. Avec la compression, la
 * taille stockée devient de toute façon imprévisible : aucune constante ne peut
 * plus la reconstituer. On la stocke.
 *
 * En v4, `e` est absent et vaut `s + OVERHEAD_V1` — 28, la valeur RÉELLE.
 */

import {
  DELTA_MANIFEST_FMT,
  MANIFEST_V4,
  MANIFEST_V5,
  ERR_MANIFEST_INVALID,
  ERR_MANIFEST_PARSE,
} from './deltaManifestShared';
import { OVERHEAD_V1 } from './blockFormat';
import { CDC_V1, type CdcParams } from './cdc';
import { CODEC_DEFLATE_RAW } from './blockCodec';

const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_U32 = 0xffffffff;

// ── Formes ───────────────────────────────────────────────────────────────────

/** Description du découpage, présente en v5 et absente en v4. */
export interface ChunkingSpec extends CdcParams {
  /** Nom de l'algorithme de découpage. Seul `cdc-v1` existe. */
  name: string;
  /** Domaine de dérivation de la table Gear. */
  gear: string;
  /** Codec de compression, ou `null` si aucun bloc n'est compressé. */
  codec: string | null;
}

/** Un bloc, forme normalisée : `e` est toujours renseigné après lecture. */
export interface NormalizedBlock {
  /** Position ordonnée dans le clair. */
  i: number;
  /** SHA-256 hexadécimal du CLAIR. L'adresse de contenu. */
  h: string;
  /** Taille du clair. */
  s: number;
  /** Taille RÉELLE de l'objet stocké. */
  e: number;
}

/** Manifeste normalisé : la forme que le reste du code manipule. */
export interface NormalizedManifest {
  /** 4 ou 5. Le reste du code ne devrait presque jamais avoir à le regarder. */
  version: number;
  fileId: string;
  algo: string;
  /** Présent en v5 ; en v4 on synthétise un découpage à frontière fixe. */
  chunking: ChunkingSpec | null;
  /** v4 seulement : la frontière fixe. `null` en v5. */
  blockSize: number | null;
  totalSize: number;
  blockCount: number;
  kdf: { name: string; salt: string; info: string };
  plaintextChecksum: string;
  blocks: NormalizedBlock[];
  createdAt: string;
  device?: string;
  /** Champs inconnus, préservés tels quels — un client plus récent peut en ajouter. */
  extra: Record<string, unknown>;
}

// ── Lecture ──────────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function u32(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_U32 ? v : null;
}

function readChunking(raw: unknown): ChunkingSpec | null {
  if (!isObject(raw)) return null;
  const min = u32(raw.min);
  const avg = u32(raw.avg);
  const max = u32(raw.max);
  const maskBits = u32(raw.maskBits);
  const normalization = u32(raw.normalization);
  if (min === null || avg === null || max === null || maskBits === null || normalization === null) return null;
  if (!(min > 0 && avg >= min && max >= avg)) return null;
  // Les masques se construisent sur 32 bits : au-delà, `highMask` refuserait au
  // premier octet plutôt qu'ici, avec un message qui désignerait le découpage
  // alors que la faute est dans le manifeste.
  if (maskBits + normalization > 31 || maskBits - normalization < 1) return null;
  if (typeof raw.name !== 'string' || typeof raw.gear !== 'string') return null;
  const codec = raw.codec === null || raw.codec === undefined ? null : raw.codec;
  if (codec !== null && codec !== CODEC_DEFLATE_RAW) return null;
  return { name: raw.name, gear: raw.gear, codec, min, avg, max, maskBits, normalization };
}

/**
 * Lit un manifeste v4 OU v5 et le normalise.
 *
 * Toute anomalie lève plutôt que de rendre une forme approximative : un
 * manifeste est authentifié par la FEK, donc s'il est mal formé c'est un
 * problème réel — jamais quelque chose à rattraper au mieux.
 */
export function readManifest(json: string): NormalizedManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(ERR_MANIFEST_PARSE);
  }
  if (!isObject(raw)) throw new Error(ERR_MANIFEST_INVALID);
  if (raw.fmt !== DELTA_MANIFEST_FMT) throw new Error(ERR_MANIFEST_INVALID);

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

  const chunking = version === MANIFEST_V5 ? readChunking(raw.chunking) : null;
  if (version === MANIFEST_V5 && chunking === null) throw new Error(ERR_MANIFEST_INVALID);

  let blockSize: number | null = null;
  if (version === MANIFEST_V4) {
    blockSize = u32(raw.blockSize);
    if (blockSize === null || blockSize <= 0) throw new Error(ERR_MANIFEST_INVALID);
  } else if (raw.blockSize !== undefined) {
    // Interdit en v5, et non pas ignoré : un manifeste qui porte les deux
    // descriptions est ambigu, et un lecteur pourrait suivre la mauvaise.
    throw new Error(ERR_MANIFEST_INVALID);
  }

  // SYMETRIE : un v4 ne porte JAMAIS de description de découpage.
  //
  // Le constructeur v4 (`buildManifest`) n'écrit que
  // `fmt, v, fileId, algo, blockSize, totalSize, blockCount, kdf,
  // plaintextChecksum, blocks, createdAt, device?` — jamais `chunking`, jamais
  // `codec`. On refuse donc la combinaison au lieu de l'ignorer, exactement
  // comme le v5 refuse `blockSize`.
  //
  // C'est ce qui rend les deux formats MUTUELLEMENT EXCLUSIFS par
  // construction : un portage n'a pas à prévoir « un v4 qui aurait aussi du
  // découpage », parce que ce manifeste-là est refusé, pas interprété.
  if (version === MANIFEST_V4 && (raw.chunking !== undefined || raw.codec !== undefined)) {
    throw new Error(ERR_MANIFEST_INVALID);
  }

  if (raw.blocks.length !== blockCount) throw new Error(ERR_MANIFEST_INVALID);

  const blocks: NormalizedBlock[] = [];
  let sum = 0;
  for (let n = 0; n < raw.blocks.length; n++) {
    const b = raw.blocks[n];
    if (!isObject(b)) throw new Error(ERR_MANIFEST_INVALID);
    const i = u32(b.i);
    const s = u32(b.s);
    if (i === null || s === null || typeof b.h !== 'string' || !HASH_RE.test(b.h)) {
      throw new Error(ERR_MANIFEST_INVALID);
    }
    // Ordonnés ET contigus : un trou dans les index rendrait un fichier
    // reconstitué silencieusement tronqué.
    if (i !== n) throw new Error(ERR_MANIFEST_INVALID);

    let e: number;
    if (version === MANIFEST_V5) {
      const declared = u32(b.e);
      if (declared === null) throw new Error(ERR_MANIFEST_INVALID);
      e = declared;
    } else {
      e = s + OVERHEAD_V1;
    }
    blocks.push({ i, h: b.h, s, e });
    sum += s;
  }
  if (sum !== totalSize) throw new Error(ERR_MANIFEST_INVALID);

  const known = new Set([
    'fmt', 'v', 'fileId', 'algo', 'chunking', 'blockSize', 'totalSize',
    'blockCount', 'kdf', 'plaintextChecksum', 'blocks', 'createdAt', 'device',
  ]);
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (!known.has(k)) extra[k] = raw[k];

  return {
    version,
    fileId: raw.fileId,
    algo: raw.algo,
    chunking,
    blockSize,
    totalSize,
    blockCount,
    kdf: { name: raw.kdf.name, salt: raw.kdf.salt, info: raw.kdf.info },
    plaintextChecksum: raw.plaintextChecksum,
    blocks,
    createdAt: raw.createdAt,
    ...(typeof raw.device === 'string' ? { device: raw.device } : {}),
    extra,
  };
}

// ── Écriture ─────────────────────────────────────────────────────────────────

export interface BuildV5Input {
  fileId: string;
  algo: string;
  /** Blocs ordonnés, avec leur taille stockée réelle. */
  blocks: NormalizedBlock[];
  kdf: { name: string; salt: string; info: string };
  plaintextChecksum: string;
  createdAt?: string;
  device?: string;
  chunking?: Partial<ChunkingSpec>;
  /** `null` si aucun bloc du fichier n'est compressé. */
  codec?: string | null;
}

/**
 * Construit un manifeste v5.
 *
 * `kdf.info` n'est PAS dérivé de la version : il reste ce que l'appelant passe,
 * et le contrat impose `filarr-delta-v4` même en manifeste v5. La dérivation de
 * clé ne se versionne pas avec la disposition des blocs — la changer rendrait
 * indéchiffrable tout fichier delta existant. Même règle que côté Send.
 */
export function buildManifestV5(input: BuildV5Input): Record<string, unknown> {
  const blocks = input.blocks.map((b, n) => {
    if (b.i !== n) throw new Error(ERR_MANIFEST_INVALID);
    return { i: b.i, h: b.h, s: b.s, e: b.e };
  });
  const chunking: ChunkingSpec = {
    name: 'cdc-v1',
    gear: 'filarr-gear-v1',
    codec: input.codec === undefined ? CODEC_DEFLATE_RAW : input.codec,
    ...CDC_V1,
    ...(input.chunking ?? {}),
  };
  return {
    fmt: DELTA_MANIFEST_FMT,
    v: MANIFEST_V5,
    fileId: input.fileId,
    algo: input.algo,
    chunking,
    totalSize: blocks.reduce((n, b) => n + b.s, 0),
    blockCount: blocks.length,
    kdf: input.kdf,
    plaintextChecksum: input.plaintextChecksum,
    blocks,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.device ? { device: input.device } : {}),
  };
}

// ── Arithmétique ─────────────────────────────────────────────────────────────

/**
 * Octets réellement stockés par ce manifeste, doublons DÉDUPLIQUÉS.
 *
 * Un bloc référencé à plusieurs positions n'occupe R2 qu'une fois : compter
 * chaque position sur-facturerait un fichier très répétitif. C'est le chiffre
 * qui doit alimenter le quota.
 */
export function storedBytesOf(manifest: NormalizedManifest): number {
  const seen = new Map<string, number>();
  for (const b of manifest.blocks) if (!seen.has(b.h)) seen.set(b.h, b.e);
  let total = 0;
  for (const size of seen.values()) total += size;
  return total;
}

/** Hachages uniques référencés — ce que le ramasse-miettes doit préserver. */
export function referencedHashes(manifest: NormalizedManifest): Set<string> {
  return new Set(manifest.blocks.map((b) => b.h));
}
