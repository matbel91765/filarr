/**
 * LA CLÉ ENTRANTE — persistée, et JAMAIS active.
 *
 * Des semaines de données, c'est des heures de migration : réseau qui tombe,
 * mise en veille, application tuée par le système. La clé du compte doit donc
 * SURVIVRE à une mort de l'application — sinon une coupure obligerait à refaire
 * l'appairage, et l'inventaire déjà monté deviendrait un déchet.
 *
 * Elle est donc écrite sur le disque, emballée sous le mot de passe local,
 * exactement comme `wrapped_fek.json` — mais sous des noms qui ne sont lus par
 * AUCUN chemin d'activation :
 *
 *   {racine}/incoming_fek.json     ← la clé emballée
 *   {racine}/.incoming_fek_safe    ← son miroir safeStorage
 *
 * RACINE UNIQUEMENT. Il ne faut surtout pas répliquer la clé entrante dans les
 * répertoires de profil : `ensureFEKAvailable` y recopie des clés quand elles
 * manquent, et une copie de la clé entrante qui atterrirait sous le nom actif
 * serait exactement l'accident que tout ce parcours existe pour empêcher.
 *
 * `hybrid:loadFEK`, `hybrid:loadWrappedKey`, `loadFEKForPairing`,
 * `getFekRawForSync` et `ensureFEKAvailable` NE CONNAISSENT PAS ces deux
 * fichiers, et ne doivent jamais les connaître. Leur seul lecteur est le moteur
 * de migration. DEUX CLÉS EMBALLÉES COEXISTENT pendant la migration : c'est
 * voulu, et c'est nommé ici pour que personne ne « nettoie » l'une des deux.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { app, safeStorage } from 'electron';
import { writeFileAtomic } from './atomicWrite';

export const INCOMING_WRAPPED_FILE = 'incoming_fek.json';
export const INCOMING_SEALED_FILE = '.incoming_fek_safe';

function rootDir(): string {
  return path.join(app.getPath('userData'), 'FilarData');
}

export function incomingWrappedPath(): string {
  return path.join(rootDir(), INCOMING_WRAPPED_FILE);
}

export function incomingSealedPath(): string {
  return path.join(rootDir(), INCOMING_SEALED_FILE);
}

/**
 * Emballe la clé entrante sous le mot de passe local — mêmes paramètres que
 * `initWithExistingFEK` (PBKDF2-SHA-512, 600 000 tours, AES-GCM), pour que le
 * fichier promu par la bascule soit littéralement un `wrapped_fek.json` valide.
 * Toute divergence de paramètre ici produirait une clé active indéballable :
 * un coffre inaccessible avec le bon mot de passe.
 */
async function wrapUnderPassword(
  fekRaw: Uint8Array,
  password: string
): Promise<{ wrappedFek: string; kekSalt: string; version: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const kek = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-512' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey']
  );
  const fekKey = await crypto.subtle.importKey(
    'raw',
    fekRaw,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey('raw', fekKey, kek, { name: 'AES-GCM', iv });
  const packed = new Uint8Array(12 + wrapped.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(wrapped), 12);
  return {
    wrappedFek: Buffer.from(packed).toString('base64'),
    kekSalt: Buffer.from(salt).toString('base64'),
    version: 1,
  };
}

export interface StoredIncomingKey {
  /** Octets de `incoming_fek.json` — c'est ce que la bascule promeut tel quel. */
  wrapped: Buffer;
  sealed: Buffer | null;
  /** SHA-256 des octets emballés. Du CHIFFRÉ : publiable sans risque. */
  wrappedDigest: string;
  /**
   * Condensat À CLÉ de la clé brute (HMAC-SHA-256, clé = `migrationId`). Sert
   * uniquement à détecter `key-diverged`. Jamais un `sha256(clé)` nu : le
   * journal est un fichier, et un condensat nu d'un secret est un oracle.
   */
  keyDigest: string;
}

/** Le condensat à clé qui identifie la clé du compte sans la révéler. */
export function computeAccountKeyDigest(fekRaw: Uint8Array, migrationId: string): string {
  return crypto.createHmac('sha256', migrationId).update(Buffer.from(fekRaw)).digest('hex');
}

export async function storeIncomingFek(
  fekRaw: Uint8Array,
  password: string,
  migrationId: string
): Promise<StoredIncomingKey> {
  await fs.mkdir(rootDir(), { recursive: true });
  const wrappedData = await wrapUnderPassword(fekRaw, password);
  const wrapped = Buffer.from(JSON.stringify(wrappedData), 'utf-8');
  // ÉCRITURE ATOMIQUE, même ici. Ces octets sont EXACTEMENT ceux que la bascule
  // promeut ensuite sous le nom actif : un `incoming_fek.json` tronqué par une
  // coupure deviendrait, après promotion, un `wrapped_fek.json` tronqué —
  // c'est-à-dire un coffre qu'aucun mot de passe n'ouvre.
  await writeFileAtomic(incomingWrappedPath(), wrapped);

  let sealed: Buffer | null = null;
  if (safeStorage.isEncryptionAvailable()) {
    sealed = safeStorage.encryptString(Buffer.from(fekRaw).toString('base64'));
    await writeFileAtomic(incomingSealedPath(), sealed);
  }

  return {
    wrapped,
    sealed,
    wrappedDigest: crypto.createHash('sha256').update(wrapped).digest('hex'),
    keyDigest: computeAccountKeyDigest(fekRaw, migrationId),
  };
}

/** Relit le matériel entrant, sans jamais l'activer. */
export async function loadIncomingMaterial(): Promise<{
  wrapped: Buffer;
  sealed: Buffer | null;
} | null> {
  const wrapped = await fs.readFile(incomingWrappedPath()).catch(() => null);
  if (!wrapped) return null;
  const sealed = await fs.readFile(incomingSealedPath()).catch(() => null);
  return { wrapped, sealed };
}

/**
 * Octets bruts de la clé entrante — l'unique lecteur légitime est le moteur de
 * migration (rechiffrement, manifeste cible, candidates de lecture au repos).
 */
export async function loadIncomingFekRaw(): Promise<Buffer | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const sealed = await fs.readFile(incomingSealedPath()).catch(() => null);
  if (!sealed) return null;
  try {
    return Buffer.from(safeStorage.decryptString(sealed), 'base64');
  } catch {
    return null;
  }
}

export async function hasIncomingFek(): Promise<boolean> {
  return fs
    .access(incomingWrappedPath())
    .then(() => true)
    .catch(() => false);
}

/**
 * Efface la clé entrante. Appelé à l'abandon, à l'échec dur, et en S5 — c'est
 * à dire APRÈS que tous les emplacements actifs ont été promus, jamais avant.
 */
export async function clearIncomingFek(): Promise<void> {
  await fs.unlink(incomingWrappedPath()).catch(() => undefined);
  await fs.unlink(incomingSealedPath()).catch(() => undefined);
}
