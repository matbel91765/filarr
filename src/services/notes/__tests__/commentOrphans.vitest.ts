import { describe, it, expect } from 'vitest';

/**
 * LA RÉPARATION DES COMMENTAIRES — les deux moitiés pures.
 *
 * Le texte des commentaires vivait dans un état d'écran jamais persisté ; les
 * MARQUES, elles, étaient persistées avec le document. Deux conséquences à
 * verrouiller : les mutations passent désormais par le slice et bousculent
 * l'horloge de fusion (`updatedAt`), et les marques d'avant la réparation —
 * orphelines par construction — sont détectées pour être nettoyées.
 */

import { collectCommentMarkIds, findOrphanCommentIds } from '../commentOrphans';
import notesReducer, {
  addNote,
  upsertNoteComment,
  resolveNoteComment,
  deleteNoteComment,
} from '../../../store/slices/notesSlice';
import type { Note, NoteComment } from '../../../types/notes';

const doc = (contenu: unknown[]) => ({ type: 'doc', content: contenu });
const texteMarque = (texte: string, commentId: string) => ({
  type: 'text',
  text: texte,
  marks: [{ type: 'comment', attrs: { commentId } }],
});

describe('collectCommentMarkIds — le parcours du document', () => {
  it('trouve les marques au premier niveau et EN PROFONDEUR (tableaux, listes)', () => {
    const d = doc([
      { type: 'paragraph', content: [texteMarque('surface', 'c1')] },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [texteMarque('profond', 'c2')] }],
              },
            ],
          },
        ],
      },
    ]);

    expect([...collectCommentMarkIds(d)].sort()).toEqual(['c1', 'c2']);
  });

  it('ignore les autres marques et les documents difformes', () => {
    const d = doc([
      { type: 'paragraph', content: [{ type: 'text', text: 'gras', marks: [{ type: 'bold' }] }] },
    ]);
    expect(collectCommentMarkIds(d).size).toBe(0);
    expect(collectCommentMarkIds(null).size).toBe(0);
    expect(collectCommentMarkIds({ pas: 'un doc' }).size).toBe(0);
  });
});

describe('findOrphanCommentIds — ce qui doit partir, et rien d’autre', () => {
  const d = doc([{ type: 'paragraph', content: [texteMarque('a', 'c1'), texteMarque('b', 'c2')] }]);

  it('une marque SANS texte est orpheline ; une marque avec texte survit', () => {
    expect(findOrphanCommentIds(d, { c1: { id: 'c1' } })).toEqual(['c2']);
  });

  it('protège le commentaire EN COURS DE SAISIE — sa marque existe, son texte pas encore', () => {
    expect(findOrphanCommentIds(d, { c1: { id: 'c1' } }, ['c2'])).toEqual([]);
  });
});

describe('les commentaires dans le slice — des données, avec une horloge', () => {
  const note = (): Note =>
    ({
      id: 'n1',
      title: 'T',
      content: '{}',
      plainText: '',
      parentId: null,
      linkedNoteIds: [],
      linkedFileIds: [],
      linkedFolderIds: [],
      isDaily: false,
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      wordCount: 0,
    }) as unknown as Note;

  const commentaire = (id: string): NoteComment => ({
    id,
    text: 'à relire',
    author: 'Mathis',
    createdAt: '2026-08-20T10:00:00.000Z',
    resolved: false,
  });

  const etatAvec = () => {
    let state = notesReducer(undefined, { type: '@@init' });
    state = notesReducer(state, addNote(note()));
    return state;
  };

  it('poser un commentaire l’écrit sur la note ET bouscule updatedAt', () => {
    // Sans le bump, la fusion nuage — qui compare les horloges au grain de la
    // note — écraserait le commentaire au cycle suivant : la perte de données
    // qu'on vient de réparer, recréée par la synchronisation.
    let state = etatAvec();
    const avant = state.byId['n1'].updatedAt;
    state = notesReducer(state, upsertNoteComment({ noteId: 'n1', comment: commentaire('c1') }));

    expect(state.byId['n1'].comments?.['c1']?.text).toBe('à relire');
    expect(state.byId['n1'].updatedAt >= avant).toBe(true);
    expect(state.byId['n1'].updatedAt).not.toBe(avant);
  });

  it('résoudre marque resolved sans rien perdre du texte', () => {
    let state = etatAvec();
    state = notesReducer(state, upsertNoteComment({ noteId: 'n1', comment: commentaire('c1') }));
    state = notesReducer(state, resolveNoteComment({ noteId: 'n1', commentId: 'c1' }));

    expect(state.byId['n1'].comments?.['c1']).toMatchObject({ resolved: true, text: 'à relire' });
  });

  it('supprimer retire l’entrée, et une cible inconnue ne casse rien', () => {
    let state = etatAvec();
    state = notesReducer(state, upsertNoteComment({ noteId: 'n1', comment: commentaire('c1') }));
    state = notesReducer(state, deleteNoteComment({ noteId: 'n1', commentId: 'c1' }));
    expect(state.byId['n1'].comments?.['c1']).toBeUndefined();

    // Idempotent : rejouer, ou viser une note absente, est un non-évènement.
    state = notesReducer(state, deleteNoteComment({ noteId: 'n1', commentId: 'c1' }));
    state = notesReducer(state, resolveNoteComment({ noteId: 'fantome', commentId: 'x' }));
  });
});
