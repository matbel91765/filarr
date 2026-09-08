/**
 * Fidélité des données web ↔ desktop.
 *
 * Patron de panne verrouillé ici : un handler web qui RE-SÉRIALISE une liste
 * blanche de champs efface en silence tout ce qu'il ne connaît pas — c'est
 * ainsi que les CARNETS du store notes disparaissaient à chaque sauvegarde web
 * (le desktop, lui, écrit l'objet entier), et que la remontée effaçait ceux du
 * desktop. Même exigence côté lecture : un champ correctement stocké mais non
 * renvoyé au renderer produit le même symptôme visible.
 *
 * Le stockage et le chiffrement sont neutralisés (des doublures en mémoire) :
 * ce test porte sur la FORME des données, la crypto est couverte ailleurs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, pushAllowed } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  /** Garde d'activation de la remontée des notes (readSync.isNotesPushAllowed). */
  pushAllowed: { value: true },
}));

vi.mock('../webStore', () => ({
  storeGet: async (key: string) => (store.has(key) ? store.get(key) : null),
  storePut: async (key: string, value: unknown) => {
    store.set(key, value);
  },
  storeDelete: async (key: string) => {
    store.delete(key);
  },
  getActiveProfileId: async () => 'profil-test',
}));

vi.mock('../../../services/auth/hybridCrypto', () => ({
  encryptFileContent: async (buf: ArrayBuffer) => new Uint8Array(buf),
  decryptFileContent: async (bytes: Uint8Array) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
}));

vi.mock('../sync/readSync', () => ({
  deriveFileId: async (folderId: string, fileName: string) => `f:${folderId}/${fileName}`,
  fetchCloudFile: async () => null,
  getSyncState: async () => null,
  getCachedManifest: () => null,
  pullFromCloud: async () => ({ state: 'idle' }),
  isNotesPushAllowed: async () => pushAllowed.value,
}));

import { webFileHandlers } from '../handlers/webFileHandlers';
import { webStorageHandlers } from '../handlers/webStorageHandlers';

type Row = Record<string, unknown>;

const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = webFileHandlers[channel] ?? webStorageHandlers[channel];
  if (!handler) throw new Error(`handler ${channel} absent`);
  return handler(...args);
};

/** Les handlers rendent `unknown` — ces deux lectures typent le résultat. */
const row = async (channel: string, ...args: unknown[]): Promise<Row> =>
  (await invoke(channel, ...args)) as Row;
const rows = async (channel: string, ...args: unknown[]): Promise<Row[]> =>
  (await invoke(channel, ...args)) as Row[];
const itemsOf = (folder: Row): Row[] => (folder.items ?? []) as Row[];

/** Les dossiers tels qu'ils sont PERSISTÉS (donc tels qu'ils partiront au nuage). */
const persistedFolders = (): Record<string, Row> =>
  (store.get('folders') as Record<string, Row>) ?? {};

beforeEach(() => {
  store.clear();
  pushAllowed.value = true;
});

describe('notes:save / notes:load — le payload entier survit', () => {
  it('persiste le payload EXACTEMENT tel que reçu, miroir strict du desktop', async () => {
    await invoke('notes:save', {
      byId: { n1: { id: 'n1', title: 'Note', notebookId: 'carnet-1' } },
      allIds: ['n1'],
      templates: [{ id: 't1' }],
      notebooks: { 'carnet-1': { id: 'carnet-1', name: 'Recherche', noteIds: ['n1'] } },
      // Champ que ce handler ne connaît pas : il doit traverser intact.
      champInconnuDuFutur: { valeur: 42 },
      skipVersioning: true,
    });

    const loaded = await row('notes:load');
    expect(loaded.notebooks).toEqual({
      'carnet-1': { id: 'carnet-1', name: 'Recherche', noteIds: ['n1'] },
    });
    expect(loaded.champInconnuDuFutur).toEqual({ valeur: 42 });
    expect(loaded.allIds).toEqual(['n1']);
    expect(loaded.templates).toEqual([{ id: 't1' }]);
    // `skipVersioning` est PERSISTÉ, comme sur le desktop (encryptToFile écrit
    // l'objet entier). Le retirer ici faisait diverger les deux payloads d'un
    // champ : chaque côté voyait une différence chez l'autre et la fusion
    // renvoyait le store indéfiniment (ping-pong perpétuel).
    expect(loaded.skipVersioning).toBe(true);
  });

  it('refuse une écriture vide par-dessus un store non vide (garde du desktop)', async () => {
    await invoke('notes:save', {
      byId: { n1: { id: 'n1' } },
      allIds: ['n1'],
      templates: [],
      notebooks: { c1: { id: 'c1' } },
    });
    const refus = await invoke('notes:save', { byId: {}, allIds: [], templates: [] });
    expect(refus).toEqual({ success: false, guarded: true });

    // `skipVersioning` (import bulk) ne court-circuite JAMAIS la garde côté
    // desktop : un import qui échoue et rend zéro note ne vide rien ici non plus.
    const refusBulk = await invoke('notes:save', {
      byId: {},
      allIds: [],
      templates: [],
      skipVersioning: true,
    });
    expect(refusBulk).toEqual({ success: false, guarded: true });

    const loaded = await row('notes:load');
    expect(loaded.allIds).toEqual(['n1']);
    expect(loaded.notebooks).toEqual({ c1: { id: 'c1' } });
  });

  it('marque `meta:notes` en attente de remontée — sinon tout reste dans le navigateur', async () => {
    await invoke('notes:save', { byId: { n1: { id: 'n1' } }, allIds: ['n1'], templates: [] });

    // Forme EXACTE attendue par pushToCloud (readSync) : sans elle, la note
    // écrite sur le web n'atteint jamais le nuage.
    const pending = store.get('pending_uploads') as Record<string, Record<string, unknown>>;
    expect(pending['meta:notes']).toMatchObject({ kind: 'meta', folderId: 'notes' });
    expect(typeof pending['meta:notes'].markedAt).toBe('string');
  });

  it('une écriture vide REFUSÉE ne marque aucune remontée', async () => {
    await invoke('notes:save', { byId: { n1: { id: 'n1' } }, allIds: ['n1'], templates: [] });
    store.set('pending_uploads', {});
    await invoke('notes:save', { byId: {}, allIds: [], templates: [] });
    expect(store.get('pending_uploads')).toEqual({});
  });

  it('remontée refusée par la garde d’activation : on écrit sans marquer', async () => {
    // Marquer ce que `pushToCloud` refusera laisse l'entrée au registre pour
    // toute la session : badge « non synchronisé » et avertissement de
    // fermeture d'onglet perpétuels, alors que rien ne partira. Le cycle
    // reposera la marque de lui-même quand la capacité apparaîtra.
    pushAllowed.value = false;
    const resultat = await invoke('notes:save', {
      byId: { n1: { id: 'n1' } },
      allIds: ['n1'],
      templates: [],
    });

    expect(resultat).toEqual({ success: true });
    expect((await row('notes:load')).allIds).toEqual(['n1']); // écrit quand même
    expect(store.get('pending_uploads') ?? {}).toEqual({});
  });

  it('ALLER-RETOUR IDENTIQUE : un onglet qui recharge puis ré-enregistre ne marque rien', async () => {
    // Le rejeu de `notes-updated` chez un onglet SUIVEUR lui fait recharger le
    // store puis le ré-enregistrer tel quel. Marquer là-dessus, c'était faire
    // pousser depuis un onglet qui n'a rien écrit — et réveiller les autres,
    // qui rechargeaient, qui ré-enregistraient…
    const payload = {
      byId: { n1: { id: 'n1', title: 'Note' } },
      allIds: ['n1'],
      templates: [],
      notebooks: {},
    };
    await invoke('notes:save', payload);
    store.set('pending_uploads', {});

    // Exactement ce que `notes:load` vient de rendre, ré-enregistré.
    await invoke('notes:save', JSON.parse(JSON.stringify(payload)));
    expect(store.get('pending_uploads')).toEqual({});
    // Le store, lui, reste juste.
    expect((await row('notes:load')).allIds).toEqual(['n1']);
  });

  it('…mais la moindre VRAIE modification marque toujours', async () => {
    const payload = {
      byId: { n1: { id: 'n1', title: 'Note' } },
      allIds: ['n1'],
      templates: [],
      notebooks: {},
    };
    await invoke('notes:save', payload);
    store.set('pending_uploads', {});

    await invoke('notes:save', {
      ...payload,
      byId: { n1: { id: 'n1', title: 'Note modifiée' } },
    });
    expect(store.get('pending_uploads')).toHaveProperty('meta:notes');
  });
});

describe('dossiers — écriture et lecture gardent le modèle desktop', () => {
  it('saveFolder persiste les champs inconnus du handler (emoji, propriétés custom)', async () => {
    await invoke('saveFolder', {
      id: 'd1',
      name: 'Dossier',
      color: '#ff0000',
      emoji: '📁',
      items: [],
      proprieteMaison: { tri: 'nom' },
    });

    const relu = await row('getFolder', 'd1');
    expect(relu.emoji).toBe('📁');
    expect(relu.proprieteMaison).toEqual({ tri: 'nom' });
  });

  it('getFolder masque les items en corbeille et fait hériter la couleur du dossier', async () => {
    await invoke('saveFolder', {
      id: 'd1',
      name: 'Dossier',
      color: '#ff0000',
      items: [
        { id: 'i1', name: 'vivant.txt', type: 'file' },
        { id: 'i2', name: 'supprime.txt', type: 'file', deletedAt: '2026-08-01T00:00:00.000Z' },
        { id: 'i3', name: 'perso.txt', type: 'file', color: '#00ff00' },
      ],
    });

    const relu = itemsOf(await row('getFolder', 'd1'));
    expect(relu.map((i) => i.id)).toEqual(['i1', 'i3']);
    expect(relu[0].color).toBe('#ff0000');
    expect(relu[1].color).toBe('#00ff00');

    const items = await rows('getFolderItems', 'd1');
    expect(items.map((i) => i.id)).toEqual(['i1', 'i3']);

    const tous = await rows('getFolders');
    expect(tous).toHaveLength(1);
    expect(itemsOf(tous[0]).map((i) => i.id)).toEqual(['i1', 'i3']);
  });

  it('un aller-retour lecture → sauvegarde ne perd pas les items en corbeille', async () => {
    await invoke('saveFolder', {
      id: 'd1',
      name: 'Dossier',
      color: '#ff0000',
      items: [
        { id: 'i1', name: 'vivant.txt', type: 'file' },
        { id: 'i2', name: 'supprime.txt', type: 'file', deletedAt: '2026-08-01T00:00:00.000Z' },
      ],
    });

    // Ce que fait un appelant naïf : relire (i2 masqué), muter, réécrire.
    const relu = await row('getFolder', 'd1');
    relu.name = 'Renommé';
    await invoke('saveFolder', relu);

    const stocke = persistedFolders().d1;
    expect(stocke.name).toBe('Renommé');
    expect(itemsOf(stocke).map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('deleteFolder met à la corbeille au lieu de détruire (comme le desktop)', async () => {
    await invoke('saveFolder', { id: 'd1', name: 'Dossier', color: '#fff', items: [] });
    await invoke('deleteFolder', 'd1');

    // Le dossier existe TOUJOURS, marqué supprimé — donc restaurable, ici
    // comme sur les autres appareils.
    expect(persistedFolders().d1).toBeDefined();
    expect(persistedFolders().d1.deletedAt).toBeTruthy();
    expect(await invoke('getFolders')).toEqual([]);

    const corbeille = await rows('storage:getTrashItems');
    expect(corbeille.map((r) => [r.id, r.itemType])).toEqual([['d1', 'folder']]);
  });

  it('storage:deleteFolder avec permanent purge vraiment (dossier, blobs, marquage)', async () => {
    await invoke('saveFolder', { id: 'd1', name: 'Dossier', color: '#fff', items: [] });
    await invoke('addItemToFolder', 'd1', {
      id: 'i1',
      name: 'note.txt',
      type: 'file',
      content: 'contenu',
    });
    expect(store.has('file:d1/note.txt')).toBe(true);

    await invoke('storage:deleteFolder', 'd1', true);

    // Rien ne survit en local : ni la méta, ni le blob (l'ancien chemin laissait
    // les blobs indéfiniment dans IndexedDB).
    expect(persistedFolders().d1).toBeUndefined();
    expect(store.has('file:d1/note.txt')).toBe(false);
    expect(await invoke('storage:getTrashItems')).toEqual([]);

    // …et la suppression est marquée pour le manifeste (méta + blob).
    const pending = (store.get('pending_uploads') ?? {}) as Record<string, { kind: string }>;
    expect(pending['meta:d1']?.kind).toBe('delete');
    expect(pending['f:d1/note.txt']?.kind).toBe('delete');
  });
});

describe('corbeille — suppression douce EN PLACE, forme desktop', () => {
  const dossierAvecFichier = async () =>
    invoke('saveFolder', {
      id: 'd1',
      name: 'Dossier',
      color: '#fff',
      items: [{ id: 'i1', name: 'note.txt', type: 'file', tags: ['a'], isFavorite: true }],
    });

  it('storage:deleteFile garde l’item dans la méta du dossier avec son deletedAt', async () => {
    await dossierAvecFichier();
    await invoke('storage:deleteFile', 'd1', 'note.txt', false);

    // C'est CETTE structure qui part au nuage : l'item doit y rester, sinon le
    // desktop perd le fichier sans même le voir dans sa corbeille.
    const items = itemsOf(persistedFolders().d1);
    expect(items).toHaveLength(1);
    expect(items[0].deletedAt).toBeTruthy();
    expect(items[0].tags).toEqual(['a']);

    // …et le renderer ne le voit plus dans le dossier.
    expect(itemsOf(await row('getFolder', 'd1'))).toEqual([]);
  });

  it('storage:getTrashItems rend itemType / parentFolderId / parentFolderName', async () => {
    await dossierAvecFichier();
    await invoke('storage:deleteFile', 'd1', 'note.txt', false);

    const [entree] = await rows('storage:getTrashItems');
    expect(entree.itemType).toBe('file');
    expect(entree.parentFolderId).toBe('d1');
    expect(entree.parentFolderName).toBe('Dossier');
    expect(entree.deletedAt).toBeTruthy();
    expect(entree.isFavorite).toBe(true);
  });

  it('storage:restoreItem remet l’item en place sans rien perdre', async () => {
    await dossierAvecFichier();
    await invoke('storage:deleteFile', 'd1', 'note.txt', false);
    await invoke('storage:restoreItem', 'i1');

    const relu = itemsOf(await row('getFolder', 'd1'));
    expect(relu).toHaveLength(1);
    expect(relu[0].tags).toEqual(['a']);
    expect(relu[0].deletedAt).toBeUndefined();
    expect(await invoke('storage:getTrashItems')).toEqual([]);
  });

  it('storage:emptyTrash respecte olderThanDays et garde les dates illisibles', async () => {
    await invoke('saveFolder', {
      id: 'd1',
      name: 'Dossier',
      color: '#fff',
      items: [
        { id: 'vieux', name: 'vieux.txt', type: 'file', deletedAt: '2020-01-01T00:00:00.000Z' },
        { id: 'recent', name: 'recent.txt', type: 'file', deletedAt: new Date().toISOString() },
        { id: 'illisible', name: 'illisible.txt', type: 'file', deletedAt: 'pas-une-date' },
      ],
    });

    expect(await invoke('storage:emptyTrash', 30)).toBe(1);
    expect(itemsOf(persistedFolders().d1).map((i) => i.id)).toEqual(['recent', 'illisible']);
  });

  it('storage:emptyTrash compte les items d’un dossier lui aussi purgé', async () => {
    await invoke('saveFolder', {
      id: 'd1',
      name: 'Dossier',
      color: '#fff',
      // Le dossier est le plus récemment supprimé : trié par date décroissante,
      // il passait AVANT ses propres items, dont la ligne rendait alors `false`.
      deletedAt: '2020-06-01T00:00:00.000Z',
      items: [{ id: 'i1', name: 'note.txt', type: 'file', deletedAt: '2020-01-01T00:00:00.000Z' }],
    });

    expect(await invoke('storage:emptyTrash', 30)).toBe(2);
    expect(persistedFolders().d1).toBeUndefined();
  });
});
