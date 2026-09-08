/**
 * Mémoire des commandes « / » récemment utilisées.
 *
 * Une préférence d'affichage, rien de plus : elle vit en `localStorage` (pas
 * dans la note, jamais synchronisée) et une lecture qui échoue rend une liste
 * vide plutôt que de casser l'ouverture du menu.
 */

import { mergeRecent } from './slashCommandSort';

const STORAGE_KEY = 'filarr.notes.slashRecents';
const MAX_RECENTS = 8;

/** Copie en mémoire : sert de repli quand `localStorage` est absent (tests, SSR). */
let cache: string[] | null = null;

function readStorage(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Identifiants récemment utilisés, du plus récent au plus ancien. */
export function getRecentSlashCommands(): string[] {
  if (cache === null) cache = readStorage();
  return cache;
}

/** Enregistre un usage réussi. Une écriture qui échoue ne remonte jamais. */
export function recordSlashCommandUse(id: string): void {
  cache = mergeRecent(getRecentSlashCommands(), id, MAX_RECENTS);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* quota plein / stockage refusé : la mémoire de session suffit */
  }
}

/** Réinitialise (tests, et changement de profil si un jour c'est branché). */
export function resetSlashCommandRecents(): void {
  cache = [];
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* rien à faire */
  }
}
