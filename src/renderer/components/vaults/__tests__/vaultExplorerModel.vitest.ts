/**
 * Le modèle pur du navigateur de coffre — ici, LE FIL des badges « Partagé ».
 *
 * Ce que ces tests défendent : que la donnée (l'index des grants) ATTEINT la
 * carte. `offlineStatus` a été une prop de `FileCard` que personne ne passait,
 * et rien ne l'a dit pendant des mois — parce qu'aucun test ne reliait la
 * source à la prop. `buildSharedCardProps` est exactement le calcul du
 * `useMemo` de `VaultFolderView` ; s'il cesse de produire `sharedCount` pour un
 * fichier qui a un grant, ou le cumul pour son dossier parent, c'est ici que ça
 * tombe, sans DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  folderGrantRollup,
  buildSharedCardProps,
  toVaultDisplayItems,
  vaultItemKind,
  VAULT_ITEM_PREFIX,
  VAULT_DIR_PREFIX,
  type VaultItemLike,
  type SharedCardLabels,
} from '../vaultExplorerModel';

function item(
  id: string,
  path: string | undefined,
  extra: Partial<VaultItemLike['meta']> = {}
): VaultItemLike {
  return {
    id,
    ownerUserId: 'u1',
    itemType: 'file',
    sizeBytes: 10,
    updatedAt: '2026-08-27T00:00:00Z',
    meta: { fileName: `${id}.pdf`, path, ...extra },
  };
}

/** Le jeu de données : deux dossiers imbriqués, un fichier à la racine, un marqueur. */
const ITEMS: VaultItemLike[] = [
  item('root', ''),
  item('a1', 'Contrats'),
  item('a2', 'Contrats'),
  item('b1', 'Contrats/2026'),
  item('c1', 'Photos'),
  item('marker', 'Contrats', { folderMarker: true, title: 'Vide' }),
  item('thread', 'Contrats', { threadFor: 'a1' }),
];

const labels: SharedCardLabels = {
  sharedWith: (n) => `partagé avec ${n}`,
  folderContains: (n) => `contient ${n}`,
};

describe('folderGrantRollup', () => {
  it('compte les ÉLÉMENTS partagés (pas la somme des grants) d’un dossier et de ses sous-dossiers', () => {
    const grants = new Map([
      ['a1', 3],
      ['b1', 1],
      ['c1', 2],
    ]);
    // a1 (Contrats) + b1 (Contrats/2026) — c1 est dans Photos.
    expect(folderGrantRollup(ITEMS, grants, 'Contrats')).toBe(2);
    // Le sous-dossier seul.
    expect(folderGrantRollup(ITEMS, grants, 'Contrats/2026')).toBe(1);
    expect(folderGrantRollup(ITEMS, grants, 'Photos')).toBe(1);
  });

  it('vaut 0 pour un dossier sans partage, un index vide ou un chemin hors de tout', () => {
    expect(folderGrantRollup(ITEMS, new Map(), 'Contrats')).toBe(0);
    expect(folderGrantRollup(ITEMS, new Map([['c1', 2]]), 'Contrats')).toBe(0);
    expect(folderGrantRollup(ITEMS, new Map([['a1', 1]]), 'Inexistant')).toBe(0);
    // « Contrats » n’est pas un préfixe de « ContratsBis » : la frontière est le « / ».
    expect(folderGrantRollup([item('x', 'ContratsBis')], new Map([['x', 1]]), 'Contrats')).toBe(0);
  });

  it('ignore les marqueurs de dossier et les fils de discussion, même s’ils avaient un grant', () => {
    const grants = new Map([
      ['marker', 1],
      ['thread', 1],
    ]);
    expect(folderGrantRollup(ITEMS, grants, 'Contrats')).toBe(0);
  });

  it('ignore une entrée à zéro (un serveur ou un reducer qui laisserait un 0 ne crée pas de badge)', () => {
    expect(folderGrantRollup(ITEMS, new Map([['a1', 0]]), 'Contrats')).toBe(0);
  });
});

describe('buildSharedCardProps — le fil entre l’index et les cartes', () => {
  // Ce que l'écran voit à la racine : les dossiers dérivés + le fichier racine.
  const display = toVaultDisplayItems({
    allItems: ITEMS,
    folderNames: ['Contrats', 'Photos'],
    visibleItems: ITEMS.filter((i) => !i.meta.path),
    currentPath: '',
    untitled: 'Sans titre',
  });

  it('donne à la carte d’un fichier partagé SON compte et SON infobulle, sous son id d’affichage', () => {
    const grants = new Map([['root', 3]]);
    const out = buildSharedCardProps({
      allItems: ITEMS,
      files: display.files,
      folders: display.folders,
      grantMap: grants,
      labels,
    });
    expect(out.byFileId.get(`${VAULT_ITEM_PREFIX}root`)).toEqual({
      sharedCount: 3,
      sharedTitle: 'partagé avec 3',
    });
  });

  it('donne à la tuile d’un dossier le cumul de ses descendants, sous son id d’affichage', () => {
    const grants = new Map([
      ['a1', 2],
      ['b1', 1],
    ]);
    const out = buildSharedCardProps({
      allItems: ITEMS,
      files: display.files,
      folders: display.folders,
      grantMap: grants,
      labels,
    });
    expect(out.byFolderId.get(`${VAULT_DIR_PREFIX}Contrats`)).toEqual({
      count: 2,
      title: 'contient 2',
    });
    // Photos n'a rien : PAS d'entrée (la tuile lit `undefined` → pas de badge).
    expect(out.byFolderId.has(`${VAULT_DIR_PREFIX}Photos`)).toBe(false);
    // Le fichier racine non plus.
    expect(out.byFileId.size).toBe(0);
  });

  it('ne fabrique aucun zéro : sans grant, les deux tables sont vides', () => {
    const out = buildSharedCardProps({
      allItems: ITEMS,
      files: display.files,
      folders: display.folders,
      grantMap: new Map(),
      labels,
    });
    expect(out.byFileId.size).toBe(0);
    expect(out.byFolderId.size).toBe(0);
  });

  it('un grant sur un élément hors du dossier courant ne touche pas les cartes affichées', () => {
    const out = buildSharedCardProps({
      allItems: ITEMS,
      files: display.files,
      folders: display.folders,
      grantMap: new Map([['ghost', 5]]),
      labels,
    });
    expect(out.byFileId.size).toBe(0);
    expect(out.byFolderId.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LE GENRE D'UN ÉLÉMENT — reconnaître une note d'un coup d'œil
// ─────────────────────────────────────────────────────────────────────────────

describe('vaultItemKind — une note n’est pas un fichier, et l’inconnu n’est pas une note', () => {
  it('rend le genre des trois types que le serveur connaît', () => {
    expect(vaultItemKind({ itemType: 'note' })).toBe('note');
    expect(vaultItemKind({ itemType: 'transclusion' })).toBe('transclusion');
    expect(vaultItemKind({ itemType: 'file' })).toBe('file');
  });

  it('TOUT LE RESTE EST UN FICHIER — jamais une note par défaut', () => {
    // `itemType` arrive du serveur comme une chaîne libre : un type d'une
    // version future, une valeur vide, une casse inattendue. Le seul repli sûr
    // est « fichier ordinaire » : promettre une note ouvrirait un éditeur de
    // texte sur des octets qui n'en sont pas.
    expect(vaultItemKind({ itemType: 'quelque-chose-de-neuf' })).toBe('file');
    expect(vaultItemKind({ itemType: '' })).toBe('file');
    expect(vaultItemKind({ itemType: 'Note' })).toBe('file');
  });
});

describe('toVaultDisplayItems — le genre ATTEINT la carte', () => {
  it('chaque carte porte le genre de son élément', () => {
    // Le fil que ce test tend : `itemType` vit dans le modèle de coffre, la
    // carte ne lit ni Redux ni le réseau. S'il cesse d'être recopié ici, une
    // note redevient une carte de fichier — et c'est exactement la plainte.
    const items: VaultItemLike[] = [
      { ...item('f1', ''), itemType: 'file' },
      { ...item('n1', ''), itemType: 'note', meta: { title: 'Compte rendu', path: '' } },
      { ...item('t1', ''), itemType: 'transclusion', meta: { title: 'Extrait', path: '' } },
    ];
    const model = toVaultDisplayItems({
      allItems: items,
      folderNames: [],
      visibleItems: items,
      currentPath: '',
      untitled: 'Sans titre',
    });
    expect(model.files.map((f) => f.kind)).toEqual(['file', 'note', 'transclusion']);
  });
});
