/**
 * noteEditorRegistry — Filarr Notes
 *
 * Registre des notes réellement TENUES par un éditeur monté.
 *
 * Pourquoi ce registre plutôt que `state.notes.editingNoteId` : l'application
 * ouvre plusieurs notes à la fois (vue scindée, panneaux, notes atteintes par
 * une route), et `editingNoteId` n'en désigne QU'UNE. Or dès qu'un éditeur tient
 * une note, c'est son document ProseMirror en mémoire qui fait foi : une
 * écriture venue d'ailleurs (ligne créée depuis une relation, colonne miroir
 * posée par une base voisine) serait réécrite à la frappe suivante, sans un mot.
 *
 * Le registre COMPTE les occupations au lieu de garder un drapeau : la même note
 * peut être montée par deux panneaux, et le démontage du premier ne doit pas
 * déclarer la note libre alors que le second la tient encore.
 *
 * Module volontairement sans React ni Redux : il est alimenté par le montage du
 * composant d'édition et lu par qui veut, y compris hors composant — et il se
 * teste sans monter quoi que ce soit.
 */

/** Note → nombre d'éditeurs qui la tiennent (une entrée disparaît à zéro) */
const held = new Map<string, number>();

const listeners = new Set<() => void>();

/**
 * Instantané STABLE des notes tenues. Recalculé au seul changement du registre :
 * `useSyncExternalStore` exige une valeur dont l'identité ne bouge pas tant que
 * la source ne bouge pas, faute de quoi React re-rend sans fin.
 */
let snapshot: ReadonlySet<string> = new Set<string>();

function publish(): void {
  snapshot = new Set(held.keys());
  for (const listener of listeners) listener();
}

/**
 * Déclare qu'un éditeur monte sur cette note. Rend la fonction de libération —
 * à appeler au démontage, et une seule fois (les appels suivants sont inertes,
 * pour qu'un double nettoyage ne libère pas l'occupation d'un autre panneau).
 */
export function acquireNoteEditor(noteId: string): () => void {
  if (noteId === '') return () => undefined;
  held.set(noteId, (held.get(noteId) ?? 0) + 1);
  publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = held.get(noteId);
    if (count === undefined) return;
    if (count <= 1) held.delete(noteId);
    else held.set(noteId, count - 1);
    publish();
  };
}

/** Cette note est-elle montée dans un éditeur en ce moment ? */
export function isNoteHeldByEditor(noteId: string): boolean {
  return noteId !== '' && held.has(noteId);
}

/**
 * Une écriture DIRECTE dans le contenu de cette note peut-elle tenir ?
 * Non tant qu'un éditeur la tient : son document en mémoire gagnerait.
 */
export function canWriteNoteContent(noteId: string): boolean {
  return noteId !== '' && !held.has(noteId);
}

/** Instantané pour `useSyncExternalStore` (identité stable entre deux changements) */
export function heldNoteIds(): ReadonlySet<string> {
  return snapshot;
}

export function subscribeNoteEditors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Remise à zéro — tests uniquement */
export function resetNoteEditorRegistry(): void {
  held.clear();
  publish();
}
