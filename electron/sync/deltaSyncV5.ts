/**
 * deltaSyncV5.ts — Téléversement et rassemblement au format v5.
 *
 * ── UN MODULE A COTE, PAS UNE REECRITURE ─────────────────────────────────────
 * `deltaSync.ts` pilote le chemin v4 en production. Il n'est PAS touché : le
 * v5 vit ici, et `deltaSync` n'y renvoie que sur décision explicite. Un défaut
 * du v5 ne peut donc pas casser le v4, et éteindre le drapeau suffit à revenir
 * en arrière — sans migration, sans réécriture, sans perte.
 *
 * ── CE QUI CHANGE PAR RAPPORT AU v4 ──────────────────────────────────────────
 *  1. Les frontières viennent du CONTENU (`cdc-v1`), plus de la position.
 *  2. Chaque bloc est compressé si — et seulement si — ça gagne franchement.
 *  3. L'objet stocké porte un octet d'en-tête versionné, lié dans l'AAD.
 *  4. Le manifeste porte la taille RÉELLE de chaque objet (`blocks[].e`).
 *
 * ── ET CE QUI NE CHANGE PAS, SURTOUT PAS ─────────────────────────────────────
 * La dérivation de la clé de fichier. `kdf.info` reste `filarr-delta-v4` même
 * en manifeste v5 : le contexte de dérivation n'est pas versionné avec la
 * disposition des blocs, sans quoi tout fichier delta existant deviendrait
 * indéchiffrable. Même règle que `filarr-share-v1` côté Send.
 *
 * ── L'OBSTACLE QUE PERSONNE N'AVAIT VU ───────────────────────────────────────
 * En v4, une frontière delta valait exactement un tronçon V3, si bien que le
 * rassemblage pouvait exiger `bloc.taille === tronçon.taille`. Le découpage par
 * contenu détruit cette coïncidence : un bloc mesure entre 256 Kio et 4 Mio et
 * chevauche librement les tronçons de 8 Mio. D'où `BlockStreamReader`, qui rend
 * les deux découpages indépendants. Sans lui, le v5 est tout simplement
 * illisible — et rien de cela n'apparaissait dans le dossier d'origine.
 */

import { createHash } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';
import { V3FileReader, encryptStreamToFileV3 } from '../streamCrypto';
import { CDC_V1, CdcSplitter } from './cdc';
import { BlockStreamReader, type StreamBlockRef } from './blockStream';
import { decryptBlockV2, encryptBlockV2 } from './portableBlockCrypto';
import { CODEC_DEFLATE_RAW } from './blockCodec';
import { ERR_CORRUPT } from './blockFormat';
import {
  buildManifestV5,
  readManifest,
  type NormalizedBlock,
  type NormalizedManifest,
} from './deltaManifestV5';
import { MANIFEST_V5 } from './deltaManifestShared';
import {
  DeltaBlockMissingError,
  deriveDeltaKeyShared as deriveDeltaKey,
  deterministicSaltB64Shared as deterministicSaltB64,
  type DeltaCryptoShared as DeltaCrypto,
  type DeltaTransportShared as DeltaTransport,
} from './deltaShared';

/** Taille de lecture du fichier local. Sans rapport avec les frontières. */
const READ_WINDOW = 4 * 1024 * 1024;

export interface UploadV5Params {
  profileId: string;
  fileId: string;
  localPath: string;
  transport: DeltaTransport;
  crypto: DeltaCrypto;
  device?: string;
  concurrency?: number;
}

export interface UploadV5Result {
  version: number;
  blockCount: number;
  totalSize: number;
  plaintextChecksum: string;
  transferredBytes: number;
  blocksUploaded: number;
  blocksReused: number;
  /** Octets évités par la compression, cumulés sur les blocs compressés. */
  compressionSavedBytes: number;
}

/**
 * Découpe le clair local en blocs `cdc-v1` et rend leur description.
 *
 * Une seule passe : on lit, on découpe, on hache. Le clair ne touche jamais le
 * disque — la lecture se fait à travers le conteneur V3, et l'accumulateur du
 * découpeur ne dépasse jamais deux blocs.
 */
async function splitLocal(
  fek: Buffer,
  localPath: string
): Promise<{ blocks: Array<{ hash: string; size: number; plain: Uint8Array }>; totalSize: number; plaintextChecksum: string }> {
  const reader = await V3FileReader.open(fek, localPath);
  try {
    const splitter = new CdcSplitter(CDC_V1);
    const wholeHash = createHash('sha256');
    const out: Array<{ hash: string; size: number; plain: Uint8Array }> = [];

    const absorb = (blocs: Uint8Array[]): void => {
      for (const b of blocs) {
        out.push({ hash: createHash('sha256').update(b).digest('hex'), size: b.length, plain: b });
      }
    };

    const total = reader.origSize;
    for (let offset = 0; offset < total; offset += READ_WINDOW) {
      const morceau = await reader.read(offset, Math.min(READ_WINDOW, total - offset));
      wholeHash.update(morceau);
      absorb(splitter.push(morceau));
    }
    absorb(splitter.flush());

    return { blocks: out, totalSize: total, plaintextChecksum: wholeHash.digest('hex') };
  } finally {
    await reader.close();
  }
}

/**
 * Téléverse un fichier au format v5.
 *
 * Pas de boucle de reprise sur conflit ici : la gestion du verrou optimiste
 * reste celle de `deltaSync`, qui appelle cette fonction. Dupliquer une logique
 * de reprise ferait deux comportements à maintenir sur le même verrou.
 */
export async function uploadDeltaV5(params: UploadV5Params): Promise<UploadV5Result> {
  const { profileId, fileId, transport, crypto } = params;
  const fek = await crypto.getFek();

  const { blocks, totalSize, plaintextChecksum } = await splitLocal(fek, params.localPath);
  const saltB64 = deterministicSaltB64(fek, fileId);
  const deltaKey = deriveDeltaKey(fek, saltB64);

  try {
    // Un hachage identique à plusieurs positions ne se chiffre et ne se
    // téléverse qu'UNE fois — c'est toute la déduplication.
    const uniques = new Map<string, Uint8Array>();
    for (const b of blocks) if (!uniques.has(b.hash)) uniques.set(b.hash, b.plain);

    const dejaPresents = new Set(
      await transport.blocksExist(profileId, fileId, [...uniques.keys()])
    );

    const storedByHash = new Map<string, number>();
    let transferredBytes = 0;
    let blocksUploaded = 0;
    let blocksReused = 0;
    let compressionSavedBytes = 0;

    for (const [hash, plain] of uniques) {
      const chiffre = await encryptBlockV2(deltaKey, fileId, plain);
      if (chiffre.hash !== hash) {
        // Le découpeur et le chiffreur doivent voir le même clair. S'ils
        // divergent, mieux vaut refuser que téléverser sous une adresse fausse.
        throw new Error(ERR_CORRUPT);
      }
      storedByHash.set(hash, chiffre.storedSize);
      if (chiffre.compressed) compressionSavedBytes += Math.max(0, plain.length - chiffre.storedSize);

      if (dejaPresents.has(hash)) {
        blocksReused++;
        continue;
      }
      const res = await transport.putBlock(profileId, fileId, hash, Buffer.from(chiffre.blob));
      if (res.deduped) {
        blocksReused++;
      } else {
        blocksUploaded++;
        transferredBytes += chiffre.storedSize;
      }
    }

    const entrees: NormalizedBlock[] = blocks.map((b, i) => ({
      i,
      h: b.hash,
      s: b.size,
      e: storedByHash.get(b.hash) ?? 0,
    }));

    const compresse = compressionSavedBytes > 0;
    const manifeste = buildManifestV5({
      fileId,
      algo: 'AES-256-GCM',
      blocks: entrees,
      kdf: { name: 'HKDF-SHA256', salt: saltB64, info: 'filarr-delta-v4' },
      plaintextChecksum,
      device: params.device,
      // `null` quand aucun bloc n'est compressé : annoncer un codec qu'aucun
      // bloc n'utilise obligerait un lecteur à le supporter pour rien.
      codec: compresse ? CODEC_DEFLATE_RAW : null,
    });

    const remote = await transport.getDeltaManifest(profileId, fileId);
    const chiffreManifeste = await crypto.encryptManifest(
      Buffer.from(JSON.stringify(manifeste), 'utf-8')
    );
    const { version } = await transport.putDeltaManifest(
      profileId,
      fileId,
      chiffreManifeste,
      [...uniques.keys()],
      remote.version
    );

    return {
      version,
      blockCount: entrees.length,
      totalSize,
      plaintextChecksum,
      transferredBytes,
      blocksUploaded,
      blocksReused,
      compressionSavedBytes,
    };
  } finally {
    deltaKey.fill(0);
  }
}

export interface DownloadV5Params {
  profileId: string;
  fileId: string;
  destPath: string;
  tmpPath: string;
  transport: DeltaTransport;
  crypto: DeltaCrypto;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
}

export interface DownloadV5Result {
  version: number;
  blockCount: number;
  totalSize: number;
  plaintextChecksum: string;
}

/** Le manifeste déchiffré est-il un v5 ? Décide vers quel chemin renvoyer. */
export function isV5Manifest(json: string): boolean {
  try {
    return readManifest(json).version === MANIFEST_V5;
  } catch {
    return false;
  }
}

/**
 * Rassemble un fichier décrit par un manifeste v5.
 *
 * Le clair ne touche jamais le disque : les blocs sont déchiffrés en mémoire,
 * enfilés par `BlockStreamReader`, et rechiffrés directement dans un conteneur
 * V3 neuf.
 */
export async function downloadDeltaV5(
  params: DownloadV5Params,
  manifest: NormalizedManifest,
  serverVersion: number
): Promise<DownloadV5Result> {
  const { profileId, fileId, destPath, tmpPath, transport, crypto } = params;
  const fek = await crypto.getFek();
  const deltaKey = deriveDeltaKey(fek, manifest.kdf.salt);

  try {
    const refs: StreamBlockRef[] = manifest.blocks.map((b) => ({ hash: b.h, size: b.s }));

    // Un bloc référencé à plusieurs positions n'est cherché et déchiffré
    // qu'une fois. Le cache est borné par le nombre de hachages DISTINCTS, pas
    // par la taille du fichier ; sur un fichier sans répétition il ne retient
    // rien de plus que ce que le flux consomme.
    const cache = new Map<string, Uint8Array>();

    const reader = new BlockStreamReader(refs, async (ref) => {
      const dejaLa = cache.get(ref.hash);
      if (dejaLa) return dejaLa;
      let chiffre: Buffer;
      try {
        chiffre = await transport.getBlock(profileId, fileId, ref.hash);
      } catch {
        throw new DeltaBlockMissingError(ref.hash);
      }
      // Vérifie le tag GCM, l'AAD, la taille du clair, ET que
      // SHA-256(clair) === l'adresse attendue.
      const plain = await decryptBlockV2(deltaKey, fileId, new Uint8Array(chiffre), {
        hash: ref.hash,
        plaintextSize: ref.size,
      });
      cache.set(ref.hash, plain);
      return plain;
    });

    const wholeHash = createHash('sha256');
    await encryptStreamToFileV3(
      fek,
      manifest.totalSize,
      tmpPath,
      async (_index, plainLen) => {
        // `plainLen` vient du conteneur V3, pas du manifeste : c'est
        // exactement l'indépendance que `BlockStreamReader` apporte.
        const morceau = await reader.read(plainLen);
        wholeHash.update(morceau);
        return Buffer.from(morceau);
      },
      params.onProgress
    );

    if (!reader.exhausted) {
      // Le manifeste décrit plus de contenu que le conteneur n'en a réclamé :
      // l'un des deux ment, et un fichier écrit dans ce cas serait tronqué.
      await unlink(tmpPath).catch(() => undefined);
      throw new Error(ERR_CORRUPT);
    }
    if (wholeHash.digest('hex') !== manifest.plaintextChecksum) {
      await unlink(tmpPath).catch(() => undefined);
      throw new Error(ERR_CORRUPT);
    }

    await rename(tmpPath, destPath);

    return {
      version: serverVersion,
      blockCount: manifest.blockCount,
      totalSize: manifest.totalSize,
      plaintextChecksum: manifest.plaintextChecksum,
    };
  } finally {
    deltaKey.fill(0);
  }
}
