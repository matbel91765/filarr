/**
 * Le filtre « Partagées » de la liste des notes — ce qui est verrouillé ici :
 *  1. l'EXCLUSIVITÉ des trois vues de la barre latérale (carnet, sans dossier,
 *     partagées) : la palette pose « partagées » seule, sans défaire les autres
 *     filtres avant — c'est donc au réducteur de le faire, dans les deux sens ;
 *  2. `selectFilteredNotes` sous `filterShared` : le MÊME critère que le compte
 *     de la barre latérale (`selectSharedNoteIds`), corbeille exclue.
 */

import { describe, expect, it } from 'vitest';

import notesReducer, {
  selectFilteredNotes,
  setNotesFilterNotebook,
  setNotesFilterShared,
  setNotesFilterUnfiled,
} from '../notesSlice';
import { selectSharedNoteIds } from '../../selectors/noteShareSelectors';
import type { RootState } from '../../index';
import type { Note, NoteShareRef, NotesState } from '../../../types/notes';

const T0 = '2026-01-01T00:00:00.000Z';

const ref = (vaultId = 'v1'): NoteShareRef => ({
  vaultId,
  itemId: `i-${vaultId}`,
  mode: 'copy',
  at: T0,
});

const note = (id: string, extra: Partial<Note> = {}): Note =>
  ({
    id,
    title: id,
    content: '',
    plainText: '',
    wordCount: 0,
    tagIds: [],
    isPinned: false,
    parentId: null,
    createdAt: T0,
    updatedAt: T0,
    ...extra,
  }) as Note;

const stateWith = (notes: Note[], over: Partial<NotesState> = {}): NotesState =>
  ({
    ...(notesReducer(undefined, { type: '@@init' }) as NotesState),
    byId: Object.fromEntries(notes.map((n) => [n.id, n])),
    allIds: notes.map((n) => n.id),
    ...over,
  }) as NotesState;

const root = (notes: NotesState): RootState => ({ notes }) as unknown as RootState;

describe('setNotesFilterShared — exclusivité des vues de la barre latérale', () => {
  it('est faux au départ', () => {
    expect(stateWith([]).filterShared).toBe(false);
  });

  it('activer « partagées » quitte le carnet ET la vue « sans dossier »', () => {
    const s0 = stateWith([], { filterNotebookId: 'nb', filterUnfiled: true });
    const s1 = notesReducer(s0, setNotesFilterShared(true));
    expect(s1.filterShared).toBe(true);
    expect(s1.filterNotebookId).toBeNull();
    expect(s1.filterUnfiled).toBe(false);
  });

  it('désactiver « partagées » ne touche pas aux autres filtres', () => {
    const s0 = stateWith([], { filterNotebookId: 'nb', filterShared: true });
    const s1 = notesReducer(s0, setNotesFilterShared(false));
    expect(s1.filterShared).toBe(false);
    expect(s1.filterNotebookId).toBe('nb');
  });

  it('choisir un carnet quitte « partagées »', () => {
    const s0 = stateWith([], { filterShared: true });
    const s1 = notesReducer(s0, setNotesFilterNotebook('nb'));
    expect(s1.filterShared).toBe(false);
    expect(s1.filterNotebookId).toBe('nb');
  });

  it('« Toutes les notes » (carnet null) quitte aussi « partagées »', () => {
    const s0 = stateWith([], { filterShared: true });
    expect(notesReducer(s0, setNotesFilterNotebook(null)).filterShared).toBe(false);
  });

  it('activer « sans dossier » quitte « partagées », la désactiver ne la rallume pas', () => {
    const s0 = stateWith([], { filterShared: true });
    const s1 = notesReducer(s0, setNotesFilterUnfiled(true));
    expect(s1.filterShared).toBe(false);
    expect(s1.filterUnfiled).toBe(true);
    const s2 = notesReducer(s1, setNotesFilterUnfiled(false));
    expect(s2.filterShared).toBe(false);
  });
});

describe('selectFilteredNotes sous filterShared', () => {
  const partagee = note('p', { sharedTo: [ref()] });
  const deuxCoffres = note('d', { sharedTo: [ref('v1'), ref('v2')] });
  const jamais = note('j');
  const videExplicite = note('e', { sharedTo: [] });
  const corbeille = note('c', { sharedTo: [ref()], deletedAt: T0 });

  it('ne garde que les notes vivantes portant au moins un dépôt', () => {
    const s = stateWith([partagee, deuxCoffres, jamais, videExplicite, corbeille], {
      filterShared: true,
    });
    const ids = selectFilteredNotes(root(s))
      .map((n) => n.id)
      .sort();
    expect(ids).toEqual(['d', 'p']);
  });

  it('dit le même nombre que le compte de la barre latérale (selectSharedNoteIds)', () => {
    const s = stateWith([partagee, deuxCoffres, jamais, videExplicite, corbeille], {
      filterShared: true,
    });
    expect(selectFilteredNotes(root(s)).length).toBe(selectSharedNoteIds(root(s)).size);
  });

  it('sans le filtre, les notes non déposées restent visibles', () => {
    const s = stateWith([partagee, jamais]);
    expect(
      selectFilteredNotes(root(s))
        .map((n) => n.id)
        .sort()
    ).toEqual(['j', 'p']);
  });

  it('se combine avec la recherche', () => {
    const s = stateWith(
      [note('alpha', { sharedTo: [ref()] }), note('beta', { sharedTo: [ref()] })],
      {
        filterShared: true,
        searchQuery: 'alp',
      }
    );
    expect(selectFilteredNotes(root(s)).map((n) => n.id)).toEqual(['alpha']);
  });
});
