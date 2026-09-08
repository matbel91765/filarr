/**
 * deltaShared.ts — Contrats et dérivations partagés par les chemins delta v4 et v5.
 *
 * ── POURQUOI CE MODULE EXISTE ────────────────────────────────────────────────
 * `deltaSync.ts` (chemin v4) et `deltaSyncV5.ts` ont besoin des mêmes types de
 * transport, de la même dérivation de clé et de la même erreur de bloc absent.
 * Les faire vivre dans `deltaSync.ts` créerait un CYCLE : le v5 importerait le
 * v4, et le v4 importerait le v5 pour lui déléguer.
 *
 * Un cycle d'import en CommonJS ne casse pas toujours — il rend parfois un
 * module à moitié initialisé, et le symptôme est un `undefined` inexplicable à
 * l'exécution, loin de sa cause. On l'évite par construction plutôt que d'en
 * dépendre.
 *
 * `deltaSync.ts` réexporte tout ce qui suit : son interface publique ne change
 * pas d'un caractère, et rien de ce qui l'importe déjà n'a à bouger.
 */

import { hkdfSync } from 'node:crypto';
import { DELTA_HKDF_INFO } from './deltaManifest';

/** Sel par fichier, en octets. */
export const DELTA_SALT_BYTES = 16;
/** Domaine de dérivation du sel — distinct de celui de la clé. */
export const DELTA_SALT_INFO = 'filarr-delta-salt';
/** Message d'erreur unique de toute la chaîne delta. */
export const ERR_CORRUPT_DELTA = 'Fichier chiffre corrompu - dechiffrement impossible';

/** Un bloc que le stockage ne rend pas. Distinguée d'une corruption. */
export class DeltaBlockMissingError extends Error {
  hash: string;
  constructor(hash: string) {
    super(`Bloc delta introuvable sur le cloud (${hash.slice(0, 12)}...)`);
    this.name = 'DeltaBlockMissingError';
    this.hash = hash;
  }
}

/**
 * Clé de fichier = HKDF-SHA256(FEK, sel, "filarr-delta-v4", 32).
 *
 * ⚠ `DELTA_HKDF_INFO` VAUT ENCORE `filarr-delta-v4` EN MANIFESTE v5, et ce
 * n'est pas un oubli. Le contexte de dérivation n'est pas versionné avec la
 * disposition des blocs : le changer rendrait indéchiffrable tout fichier delta
 * déjà écrit. Même règle que `filarr-share-v1` côté Send, et pour la même
 * raison. Tous les blocs d'un fichier partagent cette clé ; le sel est par
 * fichier et n'est JAMAIS tourné pour la vie du magasin de blocs — le tourner
 * orphelinerait les blocs sautés par la déduplication.
 */
export function deriveDeltaKeyShared(fek: Buffer, saltB64: string): Buffer {
  const salt = Buffer.from(saltB64, 'base64');
  if (salt.length === 0) {
    throw new Error(ERR_CORRUPT_DELTA);
  }
  return Buffer.from(hkdfSync('sha256', fek, salt, DELTA_HKDF_INFO, 32));
}

/**
 * Sel DÉTERMINISTE = HKDF-SHA256(FEK, fileId, "filarr-delta-salt", 16).
 *
 * Dérivé de la FEK et non tiré au hasard, pour qu'il soit reproductible après
 * un plantage survenu APRÈS le téléversement de blocs mais AVANT le commit du
 * manifeste : la reprise régénère la même clé et les blocs d'avant le plantage
 * restent déchiffrables. Le sel de HKDF n'a besoin d'être ni secret ni
 * aléatoire pour la sécurité, et il reste privé de toute façon.
 */
export function deterministicSaltB64Shared(fek: Buffer, fileId: string): string {
  const salt = hkdfSync('sha256', fek, Buffer.from(fileId, 'utf-8'), DELTA_SALT_INFO, DELTA_SALT_BYTES);
  return Buffer.from(salt).toString('base64');
}

// ── Contrats de transport ────────────────────────────────────────────────────

/** Accès au stockage des blocs et du manifeste. Injecté, jamais construit ici. */
export interface DeltaTransportShared {
  blocksExist(profileId: string, fileId: string, hashes: string[]): Promise<string[]>;
  putBlock(
    profileId: string,
    fileId: string,
    hash: string,
    body: Buffer
  ): Promise<{ deduped: boolean; size: number }>;
  getBlock(profileId: string, fileId: string, hash: string): Promise<Buffer>;
  getDeltaManifest(
    profileId: string,
    fileId: string
  ): Promise<{ manifest: Buffer | null; version: number }>;
  putDeltaManifest(
    profileId: string,
    fileId: string,
    encryptedManifest: Buffer,
    liveHashes: string[],
    expectedVersion: number
  ): Promise<{ version: number }>;
  gc(
    profileId: string,
    fileId: string,
    liveHashes: string[],
    committedVersion: number
  ): Promise<{ skipped: boolean; deletedBytes: number }>;
}

/** Accès à la FEK et au scellement du manifeste. */
export interface DeltaCryptoShared {
  getFek(): Promise<Buffer>;
  encryptManifest(plain: Buffer): Promise<Buffer>;
  decryptManifest(encrypted: Buffer): Promise<Buffer>;
}
