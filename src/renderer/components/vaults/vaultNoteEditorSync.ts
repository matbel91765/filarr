/**
 * The three decisions that keep the vault-note editor from overwriting someone
 * else's save (E3-12), kept OUT of the component so they can be tested — and so
 * they exist in exactly one place.
 *
 * The bug these encode against: the editor used to reload (and re-base its save)
 * on the item's VERSION. A background list refresh advanced that version without
 * touching the document on screen, so the next save carried a version the user had
 * never seen — the compare-and-set passed, and the other member's work was silently
 * overwritten. The guard has to hang off the DOCUMENT THAT IS LOADED, never off the
 * item metadata that flows through the list.
 */

/** What identifies a LOAD of a body. A change here — and only here — re-reads it. */
export interface LoadKeyInput {
  isOpen: boolean;
  vaultId: string;
  itemId: string;
  /** Bumped by an explicit user-driven reload. Nothing else may trigger one. */
  reloadNonce: number;
}

/**
 * The editor's load identity. Deliberately does NOT include the item's version:
 * a newer version arriving in the list must be ANNOUNCED, never applied under the
 * user's cursor (and never while they have unsaved edits).
 */
export function loadKey(input: LoadKeyInput): string {
  return `${input.isOpen ? 1 : 0}:${input.vaultId}:${input.itemId}:${input.reloadNonce}`;
}

/** Whether moving from one load identity to the other must re-read the body. */
export function shouldReload(prev: LoadKeyInput, next: LoadKeyInput): boolean {
  return loadKey(prev) !== loadKey(next);
}

/**
 * The version a save must send as `expectedVersion`: the one the loaded document
 * was read at. Null when nothing is loaded — there is nothing to re-base onto, so
 * the save must not be offered at all.
 */
export function saveGuardVersion(s: { loadedVersion: number | null }): number | null {
  return s.loadedVersion;
}

export type RemoteState = 'in-sync' | 'newer-available';

/**
 * Whether the item list is reporting a version beyond the one on screen. Purely
 * informational: it drives a banner, never a reload. During an unresolved conflict
 * the conflict UI already owns the message, so this stays quiet.
 */
export function remoteState(s: {
  loadedVersion: number | null;
  remoteVersion: number;
  hasConflict: boolean;
}): RemoteState {
  if (s.hasConflict || s.loadedVersion === null) return 'in-sync';
  return s.remoteVersion > s.loadedVersion ? 'newer-available' : 'in-sync';
}

/**
 * Faut-il ANNONCER qu'une version plus récente existe ?
 *
 * `remoteState` dit le FAIT (la liste rapporte plus haut que l'écran) ; ceci dit
 * s'il faut en parler. Une seule chose autorise le silence : une salle vivante
 * QUI CONVERGE — l'élu vient d'écrire le texte que tout le monde regarde déjà,
 * et proposer de « recharger » rejouerait la même chose en re-cléfiant la salle.
 *
 * LA NUANCE QUI MANQUAIT, et elle coûtait le seul avertissement doux du parcours :
 * la condition était « une salle est ouverte », pas « une salle converge ». Or une
 * salle OUVERTE MAIS HORS LIGNE ne fait converger personne — c'est même le cas où
 * l'autre membre enregistre sans que rien ne nous parvienne. On taisait donc
 * l'avis exactement quand il fallait le donner, et la personne apprenait la
 * nouvelle version par un 409 au lieu d'un bandeau.
 */
export function shouldAnnounceNewerVersion(s: {
  /** Le corps est-il monté ? Rien à comparer avant. */
  ready: boolean;
  /** Salle vivante ET rejouée (voir `vaultRoomSettled`), pas simplement ouverte. */
  roomConverging: boolean;
  loadedVersion: number | null;
  remoteVersion: number;
  hasConflict: boolean;
}): boolean {
  if (!s.ready) return false;
  if (s.roomConverging) return false;
  return (
    remoteState({
      loadedVersion: s.loadedVersion,
      remoteVersion: s.remoteVersion,
      hasConflict: s.hasConflict,
    }) === 'newer-available'
  );
}

/**
 * Key for the editing surface: it must remount per LOADED DOCUMENT (tiptap takes
 * `content` as an initial value only, so a reload that reuses the key would keep
 * showing the old text), and must not remount on anything else.
 */
export function surfaceKey(itemId: string, docToken: number): string {
  return `${itemId}:${docToken}`;
}
