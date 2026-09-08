/**
 * Miroir LÉGER des notes en session vivante.
 *
 * Le registre des sessions vit dans `collabSession.ts`, qui traîne Yjs, la
 * persistance IndexedDB et le transport chiffré derrière lui. Le chemin de
 * FUSION, lui, doit pouvoir demander « cette note est-elle vivante ? » à chaque
 * cycle sans rien charger de tout cela — d'où ce module, qui ne contient qu'un
 * `Set` de chaînes.
 *
 * La session en est la seule source : elle le met à jour à chaque démarrage et
 * à chaque arrêt (`publishLiveSessions`). Vide = garde neutre, comportement
 * strictement identique à celui d'avant.
 */

let _live: ReadonlySet<string> = new Set();

/** Remplace la liste ENTIÈRE — c'est un instantané, jamais un ajout. */
export function setLiveNotes(noteIds: readonly string[]): void {
  _live = new Set(noteIds);
}

export function isNoteLive(noteId: string): boolean {
  return _live.has(noteId);
}

export function liveNotes(): string[] {
  return Array.from(_live);
}

export function clearLiveNotes(): void {
  _live = new Set();
}
