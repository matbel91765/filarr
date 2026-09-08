import { describe, it, expect } from 'vitest';
import reducer, { updateNote, updateNoteContent } from '../notesSlice';

/**
 * L'HORLOGE NE BOUGE QUE SI QUELQUE CHOSE BOUGE.
 *
 * `updatedAt` est ce que la fusion nuage compare, appareil contre appareil.
 * Une note ré-estampillée sans changement gagne l'arbitrage contre une vraie
 * modification d'en face : un vieux contenu daté d'aujourd'hui écrase une
 * version plus récente, sans conflit ni trace (incident du 2026-09-03).
 */

const T0 = '2026-09-01T04:33:00.000Z';

function stateWithNote() {
  const base = reducer(undefined, { type: '@@init' });
  const note = {
    ...(Object.values(base.byId)[0] ?? {}),
    id: 'n1',
    title: 'Liens Filarr',
    content: '{"type":"doc"}',
    plainText: 'liens',
    wordCount: 1,
    createdAt: T0,
    updatedAt: T0,
  };
  return { ...base, byId: { n1: note as never }, allIds: ['n1'] };
}

describe('updateNoteContent', () => {
  it('ne date pas une note dont le contenu et le texte sont identiques', () => {
    const s = stateWithNote();
    const next = reducer(
      s,
      updateNoteContent({ id: 'n1', content: '{"type":"doc"}', plainText: 'liens' })
    );
    expect(next.byId.n1.updatedAt).toBe(T0);
  });

  it('date une note dont le contenu change', () => {
    const s = stateWithNote();
    const next = reducer(
      s,
      updateNoteContent({ id: 'n1', content: '{"type":"doc","x":1}', plainText: 'liens' })
    );
    expect(next.byId.n1.updatedAt).not.toBe(T0);
  });
});

describe('updateNote', () => {
  it('ne date pas une note dont les changements sont ceux qu’elle porte déjà', () => {
    const s = stateWithNote();
    const next = reducer(s, updateNote({ id: 'n1', changes: { title: 'Liens Filarr' } }));
    expect(next.byId.n1.updatedAt).toBe(T0);
  });

  it('date une note dont le titre change', () => {
    const s = stateWithNote();
    const next = reducer(s, updateNote({ id: 'n1', changes: { title: 'Autre' } }));
    expect(next.byId.n1.updatedAt).not.toBe(T0);
    expect(next.byId.n1.title).toBe('Autre');
  });
});
