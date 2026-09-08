/**
 * Présence — dérivation pure d'un état d'awareness vers une liste affichable.
 *
 * Aucune dépendance à Yjs ni au fournisseur : on reçoit la Map brute
 * (`awareness.getStates()`) et on en sort ce que la barre d'avatars affiche.
 * C'est ce qui rend la barre testable sans réseau.
 */

import type { AwarenessUserState, CollabIdentity, CollabParticipant } from './collabTypes';

/**
 * Teintes des curseurs et des pastilles. Elles voyagent dans l'awareness
 * (donc en clair côté client, chiffrées sur le réseau) et ne peuvent pas être
 * des variables CSS : ce sont des valeurs inline posées par CollaborationCaret.
 * Choisies assez sombres pour porter du texte blanc et assez vives pour rester
 * visibles sur les thèmes sombres.
 */
export const COLLAB_PALETTE = [
  '#2563eb',
  '#059669',
  '#db2777',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#e5484d',
  '#65a30d',
] as const;

/** Hachage stable (FNV-1a 32 bits) — même graine, même couleur sur tous les appareils. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickCollabColor(seed: string): string {
  return COLLAB_PALETTE[hashSeed(seed) % COLLAB_PALETTE.length];
}

/** Première lettre visible d'un nom, en majuscule ; « ? » si le nom est vide. */
export function collabInitial(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  // Intl.Segmenter n'est pas garanti partout : on prend le premier point de
  // code, ce qui garde les emoji et les lettres accentuées intacts.
  const first = Array.from(trimmed)[0];
  return first.toLocaleUpperCase();
}

const DEVICE_SEED_KEY = 'filarr-collab-device-seed';

/**
 * Graine locale, stable d'une session à l'autre sur cet appareil. Elle ne sert
 * qu'à choisir une couleur : elle n'est jamais envoyée telle quelle.
 */
export function getDeviceSeed(): string {
  try {
    const existing = localStorage.getItem(DEVICE_SEED_KEY);
    if (existing) return existing;
    const generated = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEVICE_SEED_KEY, generated);
    return generated;
  } catch {
    return 'local';
  }
}

/** Compose l'identité publiée dans l'awareness. */
export function buildCollabIdentity(baseName: string, seed: string): CollabIdentity {
  const name = (baseName ?? '').trim() || 'Filarr';
  return { name, color: pickCollabColor(seed) };
}

/**
 * Nom d'appareil affiché aux autres participants. En phase 1 tous les
 * participants sont les appareils d'un même compte : le suffixe de plateforme
 * est ce qui les distingue réellement.
 */
export function composeDisplayName(base: string, platformLabel: string): string {
  const trimmed = (base ?? '').trim();
  const platform = (platformLabel ?? '').trim();
  if (!trimmed) return platform || 'Filarr';
  if (!platform) return trimmed;
  return `${trimmed} · ${platform}`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Transforme `awareness.getStates()` en liste de participants.
 *
 * - l'appareil courant vient toujours en tête, les autres par clientId croissant ;
 * - un pair qui n'a pas encore publié son `user` compte quand même (il est
 *   bien connecté) et reçoit le nom de repli et une couleur dérivée de son id.
 */
export function derivePresence(
  states: ReadonlyMap<number, AwarenessUserState | undefined>,
  localClientId: number,
  fallbackName: string
): CollabParticipant[] {
  const participants: CollabParticipant[] = [];

  states.forEach((state, clientId) => {
    const user = state?.user ?? null;
    const name = readString(user?.name) ?? fallbackName;
    const color = readString(user?.color) ?? pickCollabColor(String(clientId));
    participants.push({
      clientId,
      name,
      color,
      initial: collabInitial(name),
      isLocal: clientId === localClientId,
    });
  });

  participants.sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    return a.clientId - b.clientId;
  });

  return participants;
}

/**
 * Deux listes affichent-elles exactement la même chose ?
 *
 * L'awareness change à chaque mouvement de curseur distant. Sans cette
 * comparaison, chaque frappe d'un autre appareil re-rendrait tout l'éditeur
 * alors que la barre, elle, est identique.
 */
export function samePresence(a: CollabParticipant[], b: CollabParticipant[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].clientId !== b[i].clientId ||
      a[i].name !== b[i].name ||
      a[i].color !== b[i].color ||
      a[i].isLocal !== b[i].isLocal
    ) {
      return false;
    }
  }
  return true;
}
