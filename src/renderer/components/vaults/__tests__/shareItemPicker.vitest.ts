/**
 * Le choix des éléments d'un lot à partager — groupement par sous-dossier
 * RELATIF, case de groupe, Tout/Aucun, comptes, filtre.
 *
 * Ce que ces tests défendent : que le chemin de base est bien retiré (le
 * dossier partagé est le groupe de tête, pas « Contrats/… » répété partout) ;
 * qu'une case de groupe inverse ce qu'elle MONTRE (pleine → vide, partielle →
 * pleine) ; que le filtre cache sans jamais décocher ; et que le compteur
 * dit N sur M sur le lot entier.
 */

import { describe, it, expect } from 'vitest';
import {
  commonBasePath,
  relativeTo,
  groupBySubfolder,
  groupCheckState,
  toggleGroup,
  toggleItem,
  checkAll,
  checkNone,
  checkedItems,
  pickerCounts,
  filterGroups,
  PICKER_SEARCH_THRESHOLD,
} from '../shareItemPicker';
import type { VaultItemLike } from '../vaultExplorerModel';

function item(id: string, path: string | undefined, name = `${id}.pdf`): VaultItemLike {
  return {
    id,
    ownerUserId: 'me',
    itemType: 'file',
    sizeBytes: 1,
    updatedAt: '2026-08-27T10:00:00Z',
    meta: { fileName: name, path },
  };
}

const lot = [
  item('a', 'Contrats', 'b.pdf'),
  item('b', 'Contrats', 'a.pdf'),
  item('c', 'Contrats/2026', 'q1.pdf'),
  item('d', 'Contrats/2026/Q2', 'q2.pdf'),
  item('e', 'Contrats/2025', 'old.pdf'),
];

describe('commonBasePath / relativeTo', () => {
  it('trouve le préfixe commun par SEGMENT, pas par caractère', () => {
    expect(commonBasePath(lot)).toBe('Contrats');
    expect(commonBasePath([item('x', 'AB/1'), item('y', 'A/2')])).toBe('');
    expect(commonBasePath([item('x', 'A/B/C'), item('y', 'A/B')])).toBe('A/B');
  });
  it('un élément à la racine ramène la base à la racine ; lot vide = racine', () => {
    expect(commonBasePath([...lot, item('r', undefined)])).toBe('');
    expect(commonBasePath([])).toBe('');
  });
  it('relativeTo retire la base et tolère les chemins hors base', () => {
    expect(relativeTo('Contrats/2026', 'Contrats')).toBe('2026');
    expect(relativeTo('Contrats', 'Contrats')).toBe('');
    expect(relativeTo('Contrats', '')).toBe('Contrats');
    expect(relativeTo('Autre/x', 'Contrats')).toBe('Autre/x');
    expect(relativeTo(undefined, 'Contrats')).toBe('');
  });
});

describe('groupBySubfolder', () => {
  it('le dossier partagé en tête, puis les sous-dossiers triés ; éléments par nom', () => {
    const groups = groupBySubfolder(lot, 'Contrats');
    expect(groups.map((g) => g.relativePath)).toEqual(['', '2025', '2026', '2026/Q2']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('sans base fournie, la base est le préfixe commun', () => {
    const groups = groupBySubfolder(lot, undefined);
    expect(groups[0].relativePath).toBe('');
    expect(groups[0].items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });
  it('aucun groupe vide, et une sélection éparse garde des chemins entiers depuis la base', () => {
    const groups = groupBySubfolder([lot[2], lot[3]], '');
    expect(groups.map((g) => g.relativePath)).toEqual(['Contrats/2026', 'Contrats/2026/Q2']);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
});

describe('cases de groupe et d élément', () => {
  const groups = groupBySubfolder(lot, 'Contrats');
  const root = groups[0]; // a, b

  it('l état d un groupe se déduit de ses éléments', () => {
    expect(groupCheckState(root, checkAll(lot))).toBe('all');
    expect(groupCheckState(root, checkNone())).toBe('none');
    expect(groupCheckState(root, new Set(['a']))).toBe('some');
  });

  it('plein → vide ; partiel ou vide → plein ; le reste du lot ne bouge pas', () => {
    const all = checkAll(lot);
    const after = toggleGroup(all, root);
    expect(after.has('a')).toBe(false);
    expect(after.has('b')).toBe(false);
    expect(after.has('c')).toBe(true);
    expect(toggleGroup(after, root).has('a')).toBe(true);
    const partial = new Set(['a', 'c']);
    const filled = toggleGroup(partial, root);
    expect(filled.has('a') && filled.has('b') && filled.has('c')).toBe(true);
  });

  it('toggleItem rend un ensemble NEUF', () => {
    const before = new Set(['a']);
    const after = toggleItem(before, 'a');
    expect(after.size).toBe(0);
    expect(before.size).toBe(1);
    expect(toggleItem(after, 'z').has('z')).toBe(true);
  });
});

describe('Tout / Aucun / comptes', () => {
  it('checkAll couvre le lot, checkNone est vide, checkedItems garde l ordre du lot', () => {
    const all = checkAll(lot);
    expect(pickerCounts(lot, all)).toEqual({ checked: 5, total: 5 });
    expect(pickerCounts(lot, checkNone())).toEqual({ checked: 0, total: 5 });
    expect(checkedItems(lot, new Set(['d', 'a'])).map((i) => i.id)).toEqual(['a', 'd']);
  });
  it('un id coché qui n est plus dans le lot ne compte pas', () => {
    expect(pickerCounts(lot, new Set(['a', 'fantôme']))).toEqual({ checked: 1, total: 5 });
  });
});

describe('filterGroups', () => {
  const groups = groupBySubfolder(lot, 'Contrats');
  it('filtre par nom sans casse, cache les groupes vides, ne touche pas au coché', () => {
    const f = filterGroups(groups, 'Q1');
    expect(f.map((g) => g.relativePath)).toEqual(['2026']);
    expect(f[0].items.map((i) => i.id)).toEqual(['c']);
    // Le coché est un état à part : le filtre n'a aucune prise dessus.
    const checked = checkAll(lot);
    expect(pickerCounts(lot, checked).checked).toBe(5);
  });
  it('un chemin qui correspond garde tout son groupe ; vide = tout', () => {
    expect(filterGroups(groups, '2026').map((g) => g.relativePath)).toEqual(['2026', '2026/Q2']);
    expect(filterGroups(groups, '  ').length).toBe(groups.length);
  });
  it('le seuil de la recherche rapide est 20', () => {
    expect(PICKER_SEARCH_THRESHOLD).toBe(20);
  });
});
