/**
 * vaultActivitySeen — « vu jusqu'ici », par (utilisateur, coffre), en
 * localStorage.
 *
 * PAS une slice persistée, et c'est structurel : vaultsSlice est blacklistée
 * de redux-persist exprès (la méta déchiffrée ne touche jamais le disque), et
 * un couple d'entiers (timestamp, rowid) opaque ne divulgue rien — il peut
 * vivre dans le stockage nu. Chaque accès est gardé : pas de localStorage en
 * environnement de test (vitest = node) ni dans certains contextes navigateur
 * — un stockage absent rend null / no-op, jamais une exception.
 */

import type { SeenCursor } from './vaultActivityModel';

const key = (userId: string, vaultId: string) => `filarr-vault-activity-seen:${userId}:${vaultId}`;

export function getSeenCursor(userId: string, vaultId: string): SeenCursor | null {
  try {
    const raw = localStorage.getItem(key(userId, vaultId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { occurredAt?: unknown; id?: unknown };
    if (typeof parsed.occurredAt !== 'number' || typeof parsed.id !== 'number') return null;
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    return null; // pas de stockage (tests / non-navigateur) ou JSON corrompu
  }
}

export function setSeenCursor(userId: string, vaultId: string, cur: SeenCursor): void {
  try {
    localStorage.setItem(key(userId, vaultId), JSON.stringify(cur));
  } catch {
    /* stockage absent ou plein : le badge repartira du dernier état lisible */
  }
}
