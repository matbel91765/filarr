/**
 * Réducteurs de suppression / restauration des notes — vus depuis la SYNCHRO.
 *
 * Deux patrons de panne verrouillés ici, tous deux invisibles hors ligne et
 * fatals dès qu'un second appareil existe :
 *  1. une mutation qui touche `deletedAt` sans bousculer `updatedAt` : l'état
 *     d'en face garde une horloge plus récente et ANNULE la mutation au cycle
 *     suivant (restaurer une note la renvoyait à la corbeille, en boucle) ;
 *  2. une suppression DÉFINITIVE sans trace : la fusion réunit les deux stores
 *     et la note revient du nuage, indéfiniment.
 */

import { describe, expect, it } from 'vitest';

import notesReducer, {
  deleteNote,
  deleteNotesBatch,
  deleteNotesByFolder,
  deleteNotebook,
  loadNotesFromDisk,
  markNoteSharedToVault,
  permanentlyDeleteNote,
  permanentlyDeleteNotesBatch,
  permanentlyDeleteNotesByFolder,
  removeNoteShareRef,
  restoreNote,
} from './notesSlice';
import type { Note, NoteShareRef, NotesState } from '../../types/notes';

const T_ANCIEN = '2020-01-01T00:00:00.000Z';

const note = (id: string, extra: Partial<Note> = {}): Note =>
  ({
    id,
    title: id,
    content: '',
    plainText: '',
    createdAt: T_ANCIEN,
    updatedAt: T_ANCIEN,
    ...extra,
  }) as Note;

/** État minimal : le réducteur ne lit que ces champs. */
const stateWith = (notes: Note[], over: Partial<NotesState> = {}): NotesState =>
  ({
    ...(notesReducer(undefined, { type: '@@init' }) as NotesState),
    byId: Object.fromEntries(notes.map((n) => [n.id, n])),
    allIds: notes.map((n) => n.id),
    ...over,
  }) as NotesState;

const isRecent = (iso: unknown): boolean =>
  typeof iso === 'string' && Date.now() - Date.parse(iso) < 60_000;

describe('horloge de synchronisation — toute mutation de `deletedAt` bouscule `updatedAt`', () => {
  it('deleteNote', () => {
    const next = notesReducer(stateWith([note('a')]), deleteNote('a'));
    expect(isRecent(next.byId.a.deletedAt)).toBe(true);
    expect(next.byId.a.updatedAt).toBe(next.byId.a.deletedAt);
  });

  it('deleteNotesBatch', () => {
    const next = notesReducer(stateWith([note('a'), note('b')]), deleteNotesBatch(['a', 'b']));
    for (const id of ['a', 'b']) {
      expect(isRecent(next.byId[id].updatedAt)).toBe(true);
      expect(next.byId[id].updatedAt).toBe(next.byId[id].deletedAt);
    }
  });

  it('deleteNotesByFolder', () => {
    const state = stateWith([note('a', { parentId: 'd1' }), note('b', { parentId: 'd2' })]);
    const next = notesReducer(state, deleteNotesByFolder('d1'));
    expect(isRecent(next.byId.a.updatedAt)).toBe(true);
    expect(next.byId.b.updatedAt).toBe(T_ANCIEN); // intacte
  });

  it('restoreNote — sans ce coup d’horloge, la tombstone d’en face regagne', () => {
    const state = stateWith([note('a', { deletedAt: '2026-08-02T10:00:00.000Z' })]);
    const next = notesReducer(state, restoreNote('a'));
    expect(next.byId.a.deletedAt).toBeUndefined();
    expect(isRecent(next.byId.a.updatedAt)).toBe(true);
  });
});

describe('suppressions définitives — une pierre tombale durable est posée', () => {
  it('permanentlyDeleteNote', () => {
    const next = notesReducer(stateWith([note('a'), note('b')]), permanentlyDeleteNote('a'));
    expect(next.byId.a).toBeUndefined();
    expect(next.allIds).toEqual(['b']);
    expect(isRecent(next.purged?.a)).toBe(true);
  });

  it('permanentlyDeleteNotesBatch', () => {
    const next = notesReducer(
      stateWith([note('a'), note('b'), note('c')]),
      permanentlyDeleteNotesBatch(['a', 'c'])
    );
    expect(Object.keys(next.byId)).toEqual(['b']);
    expect(Object.keys(next.purged ?? {}).sort()).toEqual(['a', 'c']);
  });

  it('permanentlyDeleteNotesByFolder', () => {
    const state = stateWith([note('a', { parentId: 'd1' }), note('b', { parentId: 'd2' })]);
    const next = notesReducer(state, permanentlyDeleteNotesByFolder('d1'));
    expect(Object.keys(next.byId)).toEqual(['b']);
    expect(Object.keys(next.purged ?? {})).toEqual(['a']);
  });

  it('deleteNotebook (les carnets n’ont pas de corbeille)', () => {
    const state = stateWith([note('a', { notebookId: 'nb1' })], {
      notebooks: { nb1: { id: 'nb1', name: 'Carnet', createdAt: T_ANCIEN, updatedAt: T_ANCIEN } },
    });
    const next = notesReducer(state, deleteNotebook('nb1'));
    expect(next.notebooks.nb1).toBeUndefined();
    expect(next.byId.a.notebookId).toBeUndefined();
    expect(isRecent(next.purgedNotebooks?.nb1)).toBe(true);
  });

  it('les pierres de plus de 90 jours sont oubliées à la purge suivante', () => {
    const vieille = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const recente = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const state = stateWith([note('a')], { purged: { perimee: vieille, gardee: recente } });

    const next = notesReducer(state, permanentlyDeleteNote('a'));
    expect(Object.keys(next.purged ?? {}).sort()).toEqual(['a', 'gardee']);
  });

  it('deleteNotebook déclasse les notes AVEC coup d’horloge', () => {
    // Sans lui, le déclassement ne traverse jamais la synchronisation : la
    // version d'en face, encore rangée dans le carnet, garde l'horloge la plus
    // récente et le rangement revient au cycle suivant.
    const state = stateWith([note('a', { notebookId: 'nb1' }), note('b')], {
      notebooks: { nb1: { id: 'nb1', name: 'Carnet', createdAt: T_ANCIEN, updatedAt: T_ANCIEN } },
    });
    const next = notesReducer(state, deleteNotebook('nb1'));

    expect(next.byId.a.notebookId).toBeUndefined();
    expect(isRecent(next.byId.a.updatedAt)).toBe(true);
    expect(next.byId.b.updatedAt).toBe(T_ANCIEN); // note d'un autre carnet : intacte
  });
});

describe('rechargement depuis le disque — les registres de purge sont adoptés', () => {
  // Dernier maillon du chemin fusion → `notes-updated` → loadNotesFromDisk →
  // réducteur. S'il manque, le store Redux ignore les pierres rapatriées et sa
  // prochaine sauvegarde les efface du disque.
  const recharge = (payload: Record<string, unknown> | null, state = stateWith([note('a')])) =>
    notesReducer(state, { type: loadNotesFromDisk.fulfilled.type, payload });

  it('adopte `purged` et `purgedNotebooks` venus du disque', () => {
    const next = recharge({
      byId: { a: note('a') },
      allIds: ['a'],
      purged: { z: '2026-08-10T00:00:00.000Z' },
      purgedNotebooks: { nb9: '2026-08-10T00:00:00.000Z' },
    });

    expect(next.purged).toEqual({ z: '2026-08-10T00:00:00.000Z' });
    expect(next.purgedNotebooks).toEqual({ nb9: '2026-08-10T00:00:00.000Z' });
  });

  it('un payload sans registre ne détruit pas celui que l’état porte déjà', () => {
    const state = stateWith([note('a')], { purged: { z: '2026-08-10T00:00:00.000Z' } });
    const next = recharge({ byId: { a: note('a') }, allIds: ['a'] }, state);
    expect(next.purged).toEqual({ z: '2026-08-10T00:00:00.000Z' });
  });
});

// ==================== Dépôt en coffre partagé ====================

const T_DEPOT = '2026-08-20T12:00:00.000Z';
const ref = (
  vaultId: string,
  itemId: string,
  mode: NoteShareRef['mode'] = 'copy'
): NoteShareRef => ({
  vaultId,
  itemId,
  mode,
  at: T_DEPOT,
});

describe('markNoteSharedToVault / removeNoteShareRef', () => {
  it('inscrit le dépôt ET bouscule l’horloge — sans elle le marqueur ne se propage jamais', () => {
    const next = notesReducer(
      stateWith([note('a')]),
      markNoteSharedToVault({ noteId: 'a', ...ref('v1', 'i1') })
    );
    expect(next.byId.a.sharedTo).toEqual([ref('v1', 'i1')]);
    expect(isRecent(next.byId.a.updatedAt)).toBe(true);
  });

  it('dédoublonne par (vaultId, itemId) : un re-dépôt remplace, n’empile pas', () => {
    let s = notesReducer(
      stateWith([note('a')]),
      markNoteSharedToVault({ noteId: 'a', ...ref('v1', 'i1') })
    );
    s = notesReducer(s, markNoteSharedToVault({ noteId: 'a', ...ref('v1', 'i1', 'move') }));
    s = notesReducer(s, markNoteSharedToVault({ noteId: 'a', ...ref('v2', 'i2') }));
    expect(s.byId.a.sharedTo).toEqual([ref('v1', 'i1', 'move'), ref('v2', 'i2')]);
  });

  it('note inconnue : rien ne change', () => {
    const state = stateWith([note('a')]);
    const next = notesReducer(state, markNoteSharedToVault({ noteId: 'zzz', ...ref('v1', 'i1') }));
    expect(next).toBe(state);
  });

  it('retire un dépôt avec coup d’horloge ; le dernier retiré efface le champ', () => {
    const state = stateWith([note('a', { sharedTo: [ref('v1', 'i1'), ref('v2', 'i2')] })]);
    const un = notesReducer(
      state,
      removeNoteShareRef({ noteId: 'a', vaultId: 'v1', itemId: 'i1' })
    );
    expect(un.byId.a.sharedTo).toEqual([ref('v2', 'i2')]);
    expect(isRecent(un.byId.a.updatedAt)).toBe(true);

    const zero = notesReducer(un, removeNoteShareRef({ noteId: 'a', vaultId: 'v2', itemId: 'i2' }));
    expect('sharedTo' in zero.byId.a).toBe(false);
  });

  it('retrait d’un dépôt absent : pas de coup d’horloge (rien n’a changé)', () => {
    const state = stateWith([note('a', { sharedTo: [ref('v1', 'i1')] })]);
    const next = notesReducer(
      state,
      removeNoteShareRef({ noteId: 'a', vaultId: 'v1', itemId: 'nope' })
    );
    expect(next.byId.a.updatedAt).toBe(T_ANCIEN);
    expect(next.byId.a.sharedTo).toEqual([ref('v1', 'i1')]);
  });
});

describe('suppression DOUCE d’un élément de coffre — le dépôt est CONSERVÉ', () => {
  // Les actions `fulfilled` de `deleteVaultItem` / `deleteVaultItems`, fabriquées
  // avec leurs types en clair : le slice ne les écoute PLUS, et ce test verrouille
  // qu'il ne les écoute plus. Ces thunks mettent l'élément à la CORBEILLE du
  // coffre (30 j, restaurable) ; retirer le marqueur ici le perdrait pour un
  // geste réversible — la restauration ne le recréerait jamais. La purge
  // définitive est un cron serveur sans action Redux : il n'y a rien à écouter.
  const itemDeleted = (vaultId: string, itemId: string) => ({
    type: 'vaults/deleteItem/fulfilled',
    payload: { vaultId, itemId },
  });
  const itemsDeleted = (vaultId: string, applied: string[]) => ({
    type: 'vaults/deleteItems/fulfilled',
    payload: { vaultId, applied, failed: [] },
  });

  it('deleteItem/fulfilled : aucune note touchée, même identité d’état, pas de coup d’horloge', () => {
    const state = stateWith([
      note('a', { sharedTo: [ref('v1', 'i1')] }),
      note('b', { sharedTo: [ref('v1', 'autre')] }),
    ]);
    const next = notesReducer(state, itemDeleted('v1', 'i1'));
    expect(next).toBe(state);
    expect(next.byId.a.sharedTo).toEqual([ref('v1', 'i1')]);
    // Rien ne part vers le nuage : `updatedAt` n'a pas bougé.
    expect(next.byId.a.updatedAt).toBe(T_ANCIEN);
  });

  it('deleteItems/fulfilled : idem, `applied` en bloc', () => {
    const state = stateWith([
      note('a', { sharedTo: [ref('v1', 'i1')] }),
      note('b', { sharedTo: [ref('v1', 'i2'), ref('v1', 'i3')] }),
    ]);
    const next = notesReducer(state, itemsDeleted('v1', ['i1', 'i2']));
    expect(next).toBe(state);
    expect(next.byId.a.sharedTo).toEqual([ref('v1', 'i1')]);
    expect(next.byId.b.sharedTo).toEqual([ref('v1', 'i2'), ref('v1', 'i3')]);
  });

  it('une note à la corbeille garde aussi son dépôt (les deux corbeilles se restaurent indépendamment)', () => {
    const state = stateWith([note('a', { sharedTo: [ref('v1', 'i1')], deletedAt: T_ANCIEN })]);
    const next = notesReducer(state, itemDeleted('v1', 'i1'));
    expect(next.byId.a.sharedTo).toEqual([ref('v1', 'i1')]);
  });

  it('le seul chemin de retrait reste le geste manuel removeNoteShareRef', () => {
    let s = stateWith([note('a', { sharedTo: [ref('v1', 'i1')] })]);
    s = notesReducer(s, itemDeleted('v1', 'i1'));
    expect(s.byId.a.sharedTo).toEqual([ref('v1', 'i1')]);
    s = notesReducer(s, removeNoteShareRef({ noteId: 'a', vaultId: 'v1', itemId: 'i1' }));
    expect('sharedTo' in s.byId.a).toBe(false);
  });
});

describe('le marqueur survit au passage par la corbeille', () => {
  it('deleteNote puis restoreNote : sharedTo intact (mode `move` compris)', () => {
    let s = notesReducer(
      stateWith([note('a')]),
      markNoteSharedToVault({ noteId: 'a', ...ref('v1', 'i1', 'move') })
    );
    s = notesReducer(s, deleteNote('a'));
    expect(s.byId.a.deletedAt).toBeDefined();
    expect(s.byId.a.sharedTo).toEqual([ref('v1', 'i1', 'move')]);
    s = notesReducer(s, restoreNote('a'));
    expect(s.byId.a.deletedAt).toBeUndefined();
    expect(s.byId.a.sharedTo).toEqual([ref('v1', 'i1', 'move')]);
  });

  it('rechargement depuis le disque : le champ voyage tel quel', () => {
    const next = notesReducer(stateWith([]), {
      type: loadNotesFromDisk.fulfilled.type,
      payload: { byId: { a: note('a', { sharedTo: [ref('v1', 'i1')] }) }, allIds: ['a'] },
    });
    expect(next.byId.a.sharedTo).toEqual([ref('v1', 'i1')]);
  });
});
