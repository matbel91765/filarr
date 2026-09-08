/**
 * Notes en SESSION VIVANTE, vues du processus principal.
 *
 * La collaboration temps réel vit entièrement dans le renderer (CRDT, clé de
 * salle, WebSocket) ; la fusion des notes, elle, tourne ici. Le renderer pousse
 * donc l'instantané de ses sessions par `collab:setLiveNotes`, et
 * `syncService` s'en sert pour ne JAMAIS remplacer une note en cours d'édition
 * par le résultat d'une fusion.
 *
 * DEUX RÈGLES DE SÛRETÉ, parce qu'une garde oubliée est pire qu'une garde
 * absente (elle gèlerait une note pour toujours) :
 *
 *  1. le registre démarre VIDE à chaque démarrage du processus principal, et
 *     `resetLiveNotes()` le remet à zéro explicitement au moment où le canal
 *     est installé — un rechargement du renderer republie de toute façon ;
 *  2. une publication PÉRIME. Le renderer republie périodiquement tant qu'une
 *     session vit ; s'il meurt en cours d'édition, la garde s'efface d'elle-même
 *     après `LIVE_NOTES_TTL_MS` au lieu de bloquer la fusion indéfiniment.
 */

/**
 * Péremption d'une publication. Confortablement au-dessus du battement du
 * renderer (45 s) pour qu'un onglet ralenti ne perde pas sa garde.
 */
export const LIVE_NOTES_TTL_MS = 150_000;

let liveNotes: ReadonlySet<string> = new Set();
let publishedAt = 0;

/** Remplace la liste ENTIÈRE : c'est un instantané, jamais un ajout. */
export function setLiveNotes(noteIds: readonly unknown[], nowMs: number = Date.now()): void {
  const clean: string[] = [];
  for (const id of noteIds ?? []) {
    if (typeof id === 'string' && id.length > 0 && id.length <= 256) clean.push(id);
  }
  liveNotes = new Set(clean);
  publishedAt = nowMs;
}

/** Remise à zéro (démarrage du main, verrouillage, changement de profil). */
export function resetLiveNotes(): void {
  liveNotes = new Set();
  publishedAt = 0;
}

export function isNoteInLiveSession(noteId: string, nowMs: number = Date.now()): boolean {
  if (liveNotes.size === 0) return false;
  if (nowMs - publishedAt > LIVE_NOTES_TTL_MS) return false;
  return liveNotes.has(noteId);
}

/** Instantané courant, péremption comprise (diagnostic et tests). */
export function liveNoteIds(nowMs: number = Date.now()): string[] {
  if (nowMs - publishedAt > LIVE_NOTES_TTL_MS) return [];
  return Array.from(liveNotes);
}
