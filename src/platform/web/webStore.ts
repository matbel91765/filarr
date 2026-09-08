/**
 * Accès au store IndexedDB CLOISONNÉ PAR PROFIL — exigence de correction
 * apparue avec la restauration des profils cloud (plusieurs profils sur un
 * même navigateur ne doivent jamais partager dossiers/notes/blobs), miroir du
 * répertoire par profil du desktop (`profiles/{id}/`).
 *
 * Clés : `p:{profileId}:{clé}`. Les données d'avant le cloisonnement (un seul
 * profil) sont migrées UNE FOIS vers le premier profil actif qui les lit,
 * puis les clés héritées sont supprimées.
 */

import { idbDelete, idbGet, idbKeys, idbPut } from './idb';

const LEGACY_SIMPLE_KEYS = [
  'folders',
  'notes_enc',
  'trash',
  'password_hashes_enc',
  'cloud_sync_state',
];

export async function getActiveProfileId(): Promise<string | null> {
  const manifest = await idbGet<{ activeProfileId: string | null }>('profiles_manifest');
  return manifest?.activeProfileId ?? null;
}

async function activeProfileOrThrow(): Promise<string> {
  const pid = await getActiveProfileId();
  if (!pid) throw new Error('Aucun profil actif');
  return pid;
}

function scoped(pid: string, key: string): string {
  return `p:${pid}:${key}`;
}

/** Migration one-shot des clés d'avant le cloisonnement vers ce profil. */
async function migrateLegacyOnce(pid: string): Promise<void> {
  const flag = scoped(pid, '__migrated');
  if (await idbGet(flag)) return;
  const allKeys = await idbKeys();
  const hasScoped = allKeys.some((k) => k.startsWith('p:'));
  const legacyPresent = allKeys.some(
    (k) => LEGACY_SIMPLE_KEYS.includes(k) || k.startsWith('file:')
  );
  if (legacyPresent && !hasScoped) {
    for (const k of allKeys) {
      if (LEGACY_SIMPLE_KEYS.includes(k) || k.startsWith('file:')) {
        const value = await idbGet(k);
        if (value !== null) await idbPut(scoped(pid, k), value);
        await idbDelete(k);
      }
    }
  }
  await idbPut(flag, true);
}

export async function storeGet<T>(key: string): Promise<T | null> {
  const pid = await activeProfileOrThrow();
  await migrateLegacyOnce(pid);
  return idbGet<T>(scoped(pid, key));
}

export async function storePut(key: string, value: unknown): Promise<void> {
  const pid = await activeProfileOrThrow();
  await migrateLegacyOnce(pid);
  await idbPut(scoped(pid, key), value);
}

export async function storeDelete(key: string): Promise<void> {
  const pid = await activeProfileOrThrow();
  await idbDelete(scoped(pid, key));
}

/** Variante à profil EXPLICITE (readSync opère sur des profils non actifs). */
/**
 * EFFACER TOUT CE QUI APPARTIENT À UN PROFIL, sur cet appareil.
 *
 * Le bureau fait `fs.rm(profileDir, { recursive: true })` : le répertoire du
 * profil part en entier. Le web, lui, ne retirait que l'entrée du manifeste, et
 * laissait derrière chaque clé `p:<pid>:*` — dossiers, notes chiffrées,
 * corbeille, empreintes de mots de passe, blobs de fichiers.
 *
 * Tant que la ligne `profiles_sync` survivait à la suppression, ce résidu était
 * rattrapable : le profil revenait avec le MÊME identifiant et readoptait ses
 * clés. Depuis que la purge distante réussit, il devient orphelin définitif —
 * de l'espace occupé dans le navigateur, sans profil pour l'atteindre ni geste
 * pour l'effacer.
 */
export async function purgeProfileScope(pid: string): Promise<number> {
  if (!pid) return 0;
  const prefixe = `p:${pid}:`;
  const toutes = await idbKeys();
  const siennes = toutes.filter((k) => k.startsWith(prefixe));
  for (const k of siennes) await idbDelete(k);
  return siennes.length;
}

export const forProfile = (pid: string) => ({
  get: <T>(key: string) => idbGet<T>(scoped(pid, key)),
  put: (key: string, value: unknown) => idbPut(scoped(pid, key), value),
  delete: (key: string) => idbDelete(scoped(pid, key)),
});
