/**
 * vaultKeyCache.ts (E3-3b / E3-5) — in-memory store of UNLOCKED vault keys.
 *
 * K_vault is recovered by opening the caller's own per-member wrap with the
 * private key loaded in userKeypair.ts (E2). Unlocking is asymmetric and not free,
 * so we cache the raw K_vault for the session — exactly like the FEK / keypair
 * private keys live in module memory, NEVER in Redux (serialized, devtools-visible,
 * possibly persisted). Decrypting an item's K_item from its wrapped_item_key is a
 * cheap symmetric op done on demand, so K_item is not cached.
 *
 * EPOCH-AWARE (E3-5): a lazy re-key (member removal) bumps the vault to a new
 * epoch; NEW content is encrypted under K_vault'(epoch+1) while OLD items keep
 * their original K_item under the OLD epoch's K_vault (we never re-encrypt the
 * past). A member therefore holds MULTIPLE K_vault — one per epoch they've seen —
 * so the cache is keyed by (vaultId, epoch). The current-epoch key comes from the
 * membership wrap; older epochs from the key-wrap history (GET /vaults/:id/key-wraps).
 *
 * SECURITY: raw secret bytes. Purged on lock (clearVaultKeys, wired into
 * clearHybridCrypto + the duress branch); buffers zeroed on clear.
 *
 * CE QUI DÉRIVE DE K_vault PART AVEC LUI, ET C'EST D'ICI QUE ÇA SE DÉCIDE. Un
 * cache de clés qui se vide en laissant derrière lui du CLAIR déchiffré sous ces
 * clés-là n'a rien purgé du tout. La description courte des coffres
 * (`vaultDescriptionIndex`, lue par les cartes de l'accueil) est exactement ce
 * cas : elle arrive chiffrée sous K_vault, et elle survivait au verrouillage, à
 * la déconnexion et à la session LEURRE — les cartes affichaient en clair la
 * description d'un coffre réel sur une session de contrainte. L'oubli est donc
 * appelé ICI, dans les deux purges, plutôt qu'à côté de chacun de leurs
 * appelants : posé à côté, il tient tant qu'on y pense ; posé dedans, il tient
 * par construction. C'est la règle que `collabKeys` énonce pour ses clés de
 * salle (« le cache module suit les secrets dont il dérive »).
 */

import { unwrapVaultKey } from './vaultCrypto';
import { forgetVaultDescription, forgetVaultDescriptions } from './vaultDescriptionIndex';

const _vaultKeys = new Map<string, Uint8Array>(); // key = `${vaultId}:${epoch}`

function cacheKey(vaultId: string, epoch: number): string {
  return `${vaultId}:${epoch}`;
}

/**
 * Unlock and cache K_vault for (vaultId, epoch) from one of the caller's wraps.
 * Idempotent. Requires the user keypair to be loaded; throws otherwise (the
 * caller surfaces that as "unlock your vault").
 */
export async function unlockVault(
  vaultId: string,
  epoch: number,
  wrappedVaultKey: string,
  keyAlgo?: string
): Promise<Uint8Array> {
  const key = cacheKey(vaultId, epoch);
  const cached = _vaultKeys.get(key);
  if (cached) return cached;
  const kVault = await unwrapVaultKey(wrappedVaultKey, keyAlgo);
  _vaultKeys.set(key, kVault);
  return kVault;
}

/** The cached K_vault for a specific epoch, or null if not unlocked this session. */
export function getVaultKey(vaultId: string, epoch: number): Uint8Array | null {
  return _vaultKeys.get(cacheKey(vaultId, epoch)) ?? null;
}

export function isVaultUnlocked(vaultId: string, epoch: number): boolean {
  return _vaultKeys.has(cacheKey(vaultId, epoch));
}

/** Purge ALL epochs of one vault (zeroing the buffers) — e.g. on leave. */
export function lockVault(vaultId: string): void {
  const prefix = `${vaultId}:`;
  for (const [key, buf] of _vaultKeys) {
    if (key.startsWith(prefix)) {
      buf.fill(0);
      _vaultKeys.delete(key);
    }
  }
  // Le clair dérivé de CE coffre part avec sa clé — ciblé, les autres coffres
  // gardent la leur (voir l'en-tête).
  forgetVaultDescription(vaultId);
}

/** Purge ALL cached vault keys (called on session lock, mirrors the FEK purge). */
export function clearVaultKeys(): void {
  for (const k of _vaultKeys.values()) k.fill(0);
  _vaultKeys.clear();
  // Idem, pour tous les coffres à la fois : verrouillage, déconnexion,
  // changement de profil, branche de contrainte.
  forgetVaultDescriptions();
}
