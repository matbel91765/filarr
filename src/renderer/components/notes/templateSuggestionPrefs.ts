/**
 * « Proposer les modèles dans une note vierge » — préférence d'affichage.
 *
 * Proposer un modèle est utile la première fois et pesant la centième : celui
 * qui veut juste écrire doit pouvoir faire taire la bande DÉFINITIVEMENT, en un
 * geste, sans aller chercher un réglage.
 *
 * Le refus est donc réversible depuis la bibliothèque de modèles (c'est là
 * qu'on retourne quand on en veut un) — sans quoi ce serait un interrupteur à
 * sens unique, planqué dans une note qu'on ne reverra pas.
 */

const STORAGE_KEY = 'filarr.notes.suggestTemplates';

/** Copie en mémoire : repli quand `localStorage` manque (tests, environnement web restreint). */
let cached: boolean | null = null;

/** Vrai par défaut : la bande existe pour être découverte. */
export function areTemplateSuggestionsEnabled(): boolean {
  if (cached !== null) return cached;
  try {
    cached = globalThis.localStorage?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    cached = true;
  }
  return cached;
}

export function setTemplateSuggestionsEnabled(enabled: boolean): void {
  cached = enabled;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* stockage refusé : la préférence ne tient que le temps de la session */
  }
}

/**
 * Notes auxquelles la fenetre a DEJA ete proposee, pour cette session.
 *
 * En memoire seulement : c'est une politesse d'affichage, pas un reglage.
 * Relancer l'application et rouvrir une note qui n'a jamais recu de contenu
 * peut legitimement reproposer — mais fermer la fenetre puis revenir sur la
 * note dans la foulee, non.
 */
const offered = new Set<string>();

export function wasTemplatesOffered(noteId: string): boolean {
  return offered.has(noteId);
}

export function markTemplatesOffered(noteId: string): void {
  offered.add(noteId);
}
