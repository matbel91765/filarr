/**
 * La sélection multiple de l'explorateur de coffre — la grammaire et la
 * résolution, en pur.
 *
 * Ce que ces tests défendent : que Shift+clic suit l'ordre AFFICHÉ et non
 * l'ordre du store ; que les identifiants sont ceux d'AFFICHAGE (préfixés) et
 * qu'un id nu ne traverse jamais ; qu'un dossier coché vaut tous ses
 * descendants (marqueurs et fils exclus) sans compter deux fois ce qui est
 * coché directement ou emboîté ; et que le plan de suppression applique la
 * matrice élément par élément et DIT combien il a sautés.
 */

import { describe, it, expect } from 'vitest';
import {
  toggleSelection,
  rangeSelection,
  extendSelectionWithRange,
  selectAllIds,
  pruneSelection,
  folderDescendantFiles,
  resolveSelection,
  planSelectionDelete,
} from '../vaultSelection';
import { VAULT_DIR_PREFIX, VAULT_ITEM_PREFIX, type VaultItemLike } from '../vaultExplorerModel';

function item(
  id: string,
  path: string | undefined,
  extra: Partial<VaultItemLike['meta']> = {},
  ownerUserId = 'me'
): VaultItemLike {
  return {
    id,
    ownerUserId,
    itemType: extra.folderMarker ? 'note' : 'file',
    sizeBytes: 10,
    updatedAt: '2026-08-27T10:00:00Z',
    meta: { fileName: `${id}.pdf`, path, ...extra },
  };
}

const fileId = (id: string) => VAULT_ITEM_PREFIX + id;
const dirId = (p: string) => VAULT_DIR_PREFIX + p;

/**
 * Le coffre de référence :
 *   racine : a, b
 *   Contrats/ : c, d (d appartient à « autre ») + marqueur mC
 *   Contrats/2026/ : e + marqueur m2026
 *   Photos/ : f + fil de discussion de f
 */
const ITEMS: VaultItemLike[] = [
  item('a', undefined),
  item('b', ''),
  item('c', 'Contrats'),
  item('d', 'Contrats', {}, 'autre'),
  item('mC', '', { folderMarker: true, title: 'Contrats' }),
  item('e', 'Contrats/2026'),
  item('m2026', 'Contrats', { folderMarker: true, title: '2026' }),
  item('f', 'Photos'),
  item('tf', 'Photos', { threadFor: 'f' }),
];

describe('la grammaire — Ctrl, Shift, Ctrl+A', () => {
  it('toggle : entre puis sort, sans toucher le reste, ensemble NEUF à chaque fois', () => {
    const s0 = new Set(['x']);
    const s1 = toggleSelection(s0, 'y');
    expect([...s1]).toEqual(['x', 'y']);
    expect(s0.size).toBe(1); // jamais muté
    const s2 = toggleSelection(s1, 'x');
    expect([...s2]).toEqual(['y']);
    expect(s2).not.toBe(s1);
  });

  it('plage : dans l’ordre affiché, bornes comprises, dans les deux sens', () => {
    const order = ['d1', 'd2', 'f1', 'f2', 'f3'];
    expect(rangeSelection(order, 'd2', 'f2')).toEqual(['d2', 'f1', 'f2']);
    expect(rangeSelection(order, 'f3', 'd1')).toEqual(order);
    expect(rangeSelection(order, 'f1', 'f1')).toEqual(['f1']);
  });

  it('plage sans ancre valable (jamais cliqué, ou l’ancre a quitté l’écran) = la cible seule', () => {
    const order = ['d1', 'f1', 'f2'];
    expect(rangeSelection(order, null, 'f1')).toEqual(['f1']);
    expect(rangeSelection(order, 'parti', 'f2')).toEqual(['f2']);
    // Une cible hors écran ne sélectionne rien : pas de fantôme.
    expect(rangeSelection(order, 'd1', 'ailleurs')).toEqual([]);
  });

  it('Shift+clic AJOUTE la plage à ce qui était coché', () => {
    const order = ['d1', 'f1', 'f2', 'f3'];
    const next = extendSelectionWithRange(new Set(['d1']), order, 'f1', 'f3');
    expect([...next]).toEqual(['d1', 'f1', 'f2', 'f3']);
  });

  it('Ctrl+A : tout ce qui est affiché — dossiers ET fichiers', () => {
    expect([...selectAllIds([dirId('Contrats'), fileId('a')])]).toEqual([
      dirId('Contrats'),
      fileId('a'),
    ]);
  });

  it('prune : ce qui a quitté l’écran ne compte plus', () => {
    const pruned = pruneSelection(new Set([fileId('a'), fileId('parti')]), [fileId('a')]);
    expect([...pruned]).toEqual([fileId('a')]);
  });
});

describe('la résolution — des ids d’affichage aux éléments réels', () => {
  it('les descendants d’un dossier : contenus seulement, ni marqueurs ni fils, tous les niveaux', () => {
    expect(folderDescendantFiles(ITEMS, 'Contrats').map((i) => i.id)).toEqual(['c', 'd', 'e']);
    expect(folderDescendantFiles(ITEMS, 'Photos').map((i) => i.id)).toEqual(['f']);
    expect(folderDescendantFiles(ITEMS, 'Contrats/2026').map((i) => i.id)).toEqual(['e']);
  });

  it('un id d’élément PRÉFIXÉ résout ; un id nu ou un préfixe inconnu est ignoré, jamais inventé', () => {
    const r = resolveSelection(new Set([fileId('a'), 'a', 'note:a', fileId('inconnu')]), ITEMS);
    expect(r.items.map((i) => i.id)).toEqual(['a']);
    expect(r.folderPaths).toEqual([]);
    expect(r.allFiles.map((i) => i.id)).toEqual(['a']);
  });

  it('un marqueur ou un fil coché par erreur n’est pas un contenu', () => {
    const r = resolveSelection(new Set([fileId('mC'), fileId('tf')]), ITEMS);
    expect(r.items).toEqual([]);
  });

  it('un dossier coché = ses descendants ; un fichier coché dedans ne compte qu’une fois', () => {
    const r = resolveSelection(new Set([dirId('Contrats'), fileId('c'), fileId('a')]), ITEMS);
    expect(r.items.map((i) => i.id)).toEqual(['c', 'a']);
    expect(r.folderPaths).toEqual(['Contrats']);
    expect(r.descendants.map((i) => i.id)).toEqual(['d', 'e']);
    expect(r.allFiles.map((i) => i.id)).toEqual(['c', 'a', 'd', 'e']);
  });

  it('deux dossiers emboîtés : seul le plus haut tient, quel que soit l’ordre du clic', () => {
    const a = resolveSelection(new Set([dirId('Contrats/2026'), dirId('Contrats')]), ITEMS);
    const b = resolveSelection(new Set([dirId('Contrats'), dirId('Contrats/2026')]), ITEMS);
    expect(a.folderPaths).toEqual(['Contrats']);
    expect(b.folderPaths).toEqual(['Contrats']);
    expect(a.descendants.map((i) => i.id)).toEqual(['c', 'd', 'e']);
    expect(a.moveSources).toEqual([{ kind: 'folder', path: 'Contrats' }]);
  });

  it('la racine et les doublons de dossier ne produisent rien', () => {
    const r = resolveSelection(new Set([dirId(''), dirId('Photos'), dirId('Photos/')]), ITEMS);
    expect(r.folderPaths).toEqual(['Photos']);
  });

  it('les sources d’un « Déplacer » : les éléments nommés puis les dossiers entiers', () => {
    const r = resolveSelection(new Set([fileId('a'), dirId('Photos')]), ITEMS);
    expect(r.moveSources).toEqual([
      { kind: 'item', id: 'a' },
      { kind: 'folder', path: 'Photos' },
    ]);
  });
});

describe('le plan de suppression d’une sélection — la matrice, élément par élément', () => {
  const asMe = (i: VaultItemLike) => i.ownerUserId === 'me';
  const asAdmin = () => true;

  it('un admin supprime tout ce qui est coché ; le fil suit son fichier', () => {
    const plan = planSelectionDelete(
      ITEMS,
      resolveSelection(new Set([fileId('a'), fileId('f')]), ITEMS),
      asAdmin
    );
    expect(plan.deletions).toEqual(['a', 'f', 'tf']);
    expect(plan.skipped).toBe(0);
    expect(plan.totalContent).toBe(2);
  });

  it('un membre : ce qu’il ne possède pas est SAUTÉ, et compté', () => {
    const plan = planSelectionDelete(
      ITEMS,
      resolveSelection(new Set([fileId('c'), fileId('d')]), ITEMS),
      asMe
    );
    expect(plan.deletions).toEqual(['c']);
    expect(plan.skipped).toBe(1);
    expect(plan.totalContent).toBe(2);
  });

  it('un dossier coché : le plan récursif (marqueurs profond → racine), sans doublon avec les fichiers cochés', () => {
    const plan = planSelectionDelete(
      ITEMS,
      resolveSelection(new Set([dirId('Contrats'), fileId('c')]), ITEMS),
      asAdmin
    );
    // c d’abord (coché directement), puis le plan du dossier : contenus
    // restants, marqueurs du plus profond au moins profond.
    expect(plan.deletions).toEqual(['c', 'd', 'e', 'm2026', 'mC']);
    expect(plan.totalContent).toBe(3);
    expect(plan.skipped).toBe(0);
  });

  it('un dossier coché par un membre : le contenu d’autrui survit, son dossier aussi, compté UNE fois', () => {
    const plan = planSelectionDelete(
      ITEMS,
      resolveSelection(new Set([dirId('Contrats'), fileId('d')]), ITEMS),
      asMe
    );
    // d (refusé) coché directement ET sous le dossier : un seul « sauté ».
    expect(plan.skipped).toBe(1);
    expect(plan.totalContent).toBe(3);
    expect(plan.deletions).toContain('c');
    expect(plan.deletions).toContain('e');
    expect(plan.deletions).not.toContain('d');
    // Le marqueur « Contrats » abrite d : il survit ; « 2026 » n’abrite rien.
    expect(plan.deletions).toContain('m2026');
    expect(plan.deletions).not.toContain('mC');
  });

  it('rien de supprimable : plan vide, tout est dit sauté', () => {
    const plan = planSelectionDelete(ITEMS, resolveSelection(new Set([fileId('d')]), ITEMS), asMe);
    expect(plan.deletions).toEqual([]);
    expect(plan.skipped).toBe(1);
  });
});
