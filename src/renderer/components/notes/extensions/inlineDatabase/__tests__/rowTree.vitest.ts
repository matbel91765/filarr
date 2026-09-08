/**
 * Sous-éléments.
 *
 * Chaque test ci-dessous fige une décision de conception prise avec
 * l'utilisateur, et toutes découlent du même principe : **rien ne disparaît en
 * silence**. Un enfant dont le parent est filtré, une ligne prise dans un
 * cycle, les enfants d'une ligne supprimée — dans les trois cas la ligne
 * reparaît à la racine, elle n'est jamais avalée.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRowTree,
  eligibleParents,
  isDescendantOf,
  MAX_DEPTH,
  parentIdOf,
  removeRowKeepingChildren,
  withParent,
} from '../rowTree';
import type { DbRow } from '../types';

const row = (id: string, parentId?: string): DbRow =>
  ({ id, cells: {}, ...(parentId ? { parentId } : {}) }) as DbRow;

const ids = (tree: ReturnType<typeof buildRowTree>) => tree.map((entry) => entry.row.id);
const depths = (tree: ReturnType<typeof buildRowTree>) => tree.map((entry) => entry.depth);

describe('buildRowTree', () => {
  it('range les enfants sous leur parent', () => {
    const rows = [row('a'), row('a1', 'a'), row('a2', 'a'), row('b')];
    const tree = buildRowTree(rows);
    expect(ids(tree)).toEqual(['a', 'a1', 'a2', 'b']);
    expect(depths(tree)).toEqual([0, 1, 1, 0]);
  });

  it('respecte l ORDRE que la vue a décidé, à chaque niveau', () => {
    // `visibleRows` arrive déjà filtré puis trié : on ne le recalcule pas.
    const rows = [row('b'), row('a'), row('a2', 'a'), row('a1', 'a')];
    expect(ids(buildRowTree(rows))).toEqual(['b', 'a', 'a2', 'a1']);
  });

  it('imbrique sur plusieurs niveaux', () => {
    const rows = [row('a'), row('b', 'a'), row('c', 'b')];
    expect(depths(buildRowTree(rows))).toEqual([0, 1, 2]);
  });

  it('REMONTE À LA RACINE un enfant dont le parent est filtré', () => {
    // Le parent « a » n'est pas dans la vue : « a1 » y répond pourtant, il ne
    // doit pas disparaître à cause d'une AUTRE ligne.
    const tree = buildRowTree([row('a1', 'a'), row('b')]);
    expect(ids(tree)).toEqual(['a1', 'b']);
    expect(depths(tree)).toEqual([0, 0]);
  });

  it('ne perd rien : autant de lignes en sortie qu en entrée', () => {
    const rows = [row('a'), row('a1', 'a'), row('orphelin', 'disparu'), row('b')];
    expect(buildRowTree(rows)).toHaveLength(rows.length);
  });

  it('ne boucle pas sur un CYCLE, et n avale pas les lignes prises dedans', () => {
    const rows = [row('a', 'b'), row('b', 'a')];
    const tree = buildRowTree(rows);
    expect(tree).toHaveLength(2);
    // Aucune des deux n'est perdue ; elles reviennent à la racine.
    expect(depths(tree).every((depth) => depth === 0)).toBe(true);
  });

  it('ignore une ligne qui se déclare son propre parent', () => {
    const tree = buildRowTree([row('a', 'a')]);
    expect(ids(tree)).toEqual(['a']);
    expect(depths(tree)).toEqual([0]);
  });

  it('replie une branche sans effacer son chevron', () => {
    const rows = [row('a'), row('a1', 'a'), row('b')];
    const tree = buildRowTree(rows, new Set(['a']));
    expect(ids(tree)).toEqual(['a', 'b']);
    // `hasChildren` reste vrai : sinon le chevron disparaîtrait au moment même
    // où l'on veut rouvrir la branche.
    expect(tree[0].hasChildren).toBe(true);
  });

  it('borne la profondeur affichée sans perdre les lignes profondes', () => {
    const rows: DbRow[] = [row('r0')];
    for (let i = 1; i <= MAX_DEPTH + 3; i += 1) rows.push(row(`r${i}`, `r${i - 1}`));
    const tree = buildRowTree(rows);
    expect(tree).toHaveLength(rows.length);
    expect(Math.max(...depths(tree))).toBe(MAX_DEPTH);
  });
});

describe('garde-fous de cycle', () => {
  const rows = [row('a'), row('b', 'a'), row('c', 'b'), row('autre')];

  it('reconnaît une descendance, même lointaine', () => {
    expect(isDescendantOf(rows, 'c', 'a')).toBe(true);
    expect(isDescendantOf(rows, 'autre', 'a')).toBe(false);
  });

  it('ne propose jamais un parent qui créerait un cycle', () => {
    const candidates = eligibleParents(rows, 'a').map((entry) => entry.id);
    expect(candidates).toEqual(['autre']);
  });
});

describe('suppression', () => {
  it('REMONTE les enfants d un cran plutôt que de les supprimer', () => {
    const rows = [row('a'), row('b', 'a'), row('c', 'b')];
    const after = removeRowKeepingChildren(rows, 'b');
    expect(after.map((entry) => entry.id)).toEqual(['a', 'c']);
    // « c » suivait « b », qui suivait « a » : il rejoint « a ».
    expect(parentIdOf(after[1])).toBe('a');
  });

  it('les enfants d une ligne racine deviennent racines', () => {
    const after = removeRowKeepingChildren([row('a'), row('b', 'a')], 'a');
    expect(parentIdOf(after[0])).toBeUndefined();
  });

  it('supprimer une ligne absente ne change rien', () => {
    const rows = [row('a')];
    expect(removeRowKeepingChildren(rows, 'zzz')).toBe(rows);
  });
});

describe('withParent', () => {
  it('pose et retire le parent', () => {
    expect(parentIdOf(withParent(row('a'), 'b'))).toBe('b');
    expect(parentIdOf(withParent(row('a', 'b'), undefined))).toBeUndefined();
  });

  it('ne laisse pas de champ vide derrière lui', () => {
    // Un `parentId: undefined` traînant se sérialiserait et ferait diverger
    // deux documents identiques.
    expect(Object.keys(withParent(row('a', 'b'), undefined))).not.toContain('parentId');
  });
});

describe('persistance du parent', () => {
  it('le rattachement survit à un aller-retour de sérialisation', async () => {
    const { parseDbData, serializeDbData } = await import('../types');
    const data = {
      properties: [],
      rows: [row('a'), row('b', 'a')],
    };
    const round = parseDbData(serializeDbData(data));
    expect(parentIdOf(round.rows[1])).toBe('a');
  });

  it('un parent vide ou mal typé est ignoré, la ligne reste', async () => {
    const { parseDbData } = await import('../types');
    const raw = JSON.stringify({
      properties: [],
      rows: [
        { id: 'a', cells: {}, parentId: '' },
        { id: 'b', cells: {}, parentId: 42 },
      ],
    });
    const round = parseDbData(raw);
    expect(round.rows).toHaveLength(2);
    expect(parentIdOf(round.rows[0])).toBeUndefined();
    expect(parentIdOf(round.rows[1])).toBeUndefined();
  });
});
