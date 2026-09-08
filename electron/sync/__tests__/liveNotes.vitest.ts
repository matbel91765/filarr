/**
 * Registre des notes en session vivante, côté processus principal.
 *
 * Il porte la garde qui empêche la fusion d'écraser une note en cours
 * d'édition collaborative. Deux propriétés comptent autant que la garde
 * elle-même : elle démarre INACTIVE, et elle PÉRIME — une garde oubliée
 * gèlerait une note pour toujours.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  LIVE_NOTES_TTL_MS,
  isNoteInLiveSession,
  liveNoteIds,
  resetLiveNotes,
  setLiveNotes,
} from '../liveNotes';

const T0 = 1_000_000;

afterEach(() => resetLiveNotes());

describe('registre des notes vivantes', () => {
  it('démarre vide : aucune garde héritée d’une exécution précédente', () => {
    expect(isNoteInLiveSession('note-1')).toBe(false);
    expect(liveNoteIds()).toEqual([]);
  });

  it('applique l’instantané publié par le renderer', () => {
    setLiveNotes(['note-1', 'note-2'], T0);
    expect(isNoteInLiveSession('note-1', T0 + 1000)).toBe(true);
    expect(isNoteInLiveSession('note-3', T0 + 1000)).toBe(false);
    expect(liveNoteIds(T0 + 1000).sort()).toEqual(['note-1', 'note-2']);
  });

  it('REMPLACE la liste : une note refermée n’est plus vivante', () => {
    setLiveNotes(['note-1', 'note-2'], T0);
    setLiveNotes(['note-2'], T0);
    expect(isNoteInLiveSession('note-1', T0)).toBe(false);
    expect(isNoteInLiveSession('note-2', T0)).toBe(true);
  });

  it('périme si le renderer cesse de publier', () => {
    // Un renderer qui meurt en cours d'édition laisserait sinon la fusion
    // bloquée sur cette note indéfiniment.
    setLiveNotes(['note-1'], T0);
    expect(isNoteInLiveSession('note-1', T0 + LIVE_NOTES_TTL_MS - 1)).toBe(true);
    expect(isNoteInLiveSession('note-1', T0 + LIVE_NOTES_TTL_MS + 1)).toBe(false);
    expect(liveNoteIds(T0 + LIVE_NOTES_TTL_MS + 1)).toEqual([]);
  });

  it('la remise à zéro coupe la garde tout de suite (verrouillage, démarrage)', () => {
    setLiveNotes(['note-1'], T0);
    resetLiveNotes();
    expect(isNoteInLiveSession('note-1', T0)).toBe(false);
  });

  it('ignore ce qui n’est pas un identifiant plausible', () => {
    setLiveNotes(['note-1', '', 42, null, 'x'.repeat(300)] as unknown[], T0);
    expect(liveNoteIds(T0)).toEqual(['note-1']);
  });
});
