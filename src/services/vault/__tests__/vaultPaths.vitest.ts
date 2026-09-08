/**
 * vaultPaths — la grammaire des dossiers chiffrés, prouvée sans mock.
 *
 * Les trois propriétés qui coûteraient des données si elles cassaient :
 *   · NFC : macOS livre du NFD au drag-drop — sans normalisation, 'café' existe
 *     deux fois et chaque client range dans le sien ;
 *   · le test de préfixe : un startsWith nu emporterait 'AB' en renommant 'A' ;
 *   · la reprise d'un renommage : replanifier depuis l'état partiel ne doit
 *     produire QUE le reste (idempotence), jamais rejouer les déjà-déplacés.
 */

import { describe, it, expect } from 'vitest';
import type { PathedMeta } from '../vaultPaths';
import {
  planFolderDelete,
  normalizeFolderName,
  normalizePath,
  joinPath,
  parentOf,
  lastSegment,
  isDescendantOrSelf,
  assertPathWithinBounds,
  deriveFolders,
  sortFoldersFirst,
  planFolderRename,
  planMoveInto,
  MAX_SEGMENT_LEN,
} from '../vaultPaths';

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

describe('normalizeFolderName', () => {
  it('accepte un nom ordinaire et le règle en NFC trimé', () => {
    const nfd = 'café'; // e + accent combinant (NFD)
    expect(nfd).toHaveLength(5); // garde du garde : un éditeur qui renormalise ce fichier casserait le test
    expect(normalizeFolderName(`  ${nfd}  `)).toBe('café');
  });

  it.each(['/', 'a/b', '.', '..', '', '   ', 'x\u0007y'])('rejette %j', (bad) => {
    expect(() => normalizeFolderName(bad)).toThrow('folder_name_invalid');
  });

  it('rejette au-delà de la borne de segment', () => {
    expect(() => normalizeFolderName('x'.repeat(MAX_SEGMENT_LEN + 1))).toThrow(
      'folder_name_too_long'
    );
  });
});

describe('normalizePath / joinPath / parentOf / lastSegment', () => {
  it('tolère en lecture : NFC, segments vides, séparateurs de tête et de queue', () => {
    expect(normalizePath('/Contrats//2026/')).toBe('Contrats/2026');
    expect(normalizePath('café/x')).toBe('café/x');
    expect(normalizePath(undefined)).toBe('');
  });

  it('compose et décompose sans cas particulier caché', () => {
    expect(joinPath('', 'A')).toBe('A');
    expect(joinPath('A', 'B')).toBe('A/B');
    expect(parentOf('A/B/C')).toBe('A/B');
    expect(parentOf('A')).toBe('');
    expect(lastSegment('A/B/C')).toBe('C');
    expect(lastSegment('A')).toBe('A');
  });
});

describe('isDescendantOrSelf — LE test de préfixe', () => {
  it("ne confond jamais 'AB' avec un enfant de 'A'", () => {
    expect(isDescendantOrSelf('AB', 'A')).toBe(false);
    expect(isDescendantOrSelf('A/B', 'A')).toBe(true);
    expect(isDescendantOrSelf('A', 'A')).toBe(true);
    expect(isDescendantOrSelf('n’importe/quoi', '')).toBe(true);
  });
});

describe('assertPathWithinBounds', () => {
  it('refuse la profondeur 13 et la longueur 1001', () => {
    expect(() => assertPathWithinBounds(Array(13).fill('a').join('/'))).toThrow('folder_too_deep');
    expect(() => assertPathWithinBounds('a'.repeat(1001))).toThrow('folder_path_too_long');
    expect(() => assertPathWithinBounds(Array(12).fill('a').join('/'))).not.toThrow();
  });
});

describe('deriveFolders — implicites + marqueurs, dédoublonnés', () => {
  const item = (path?: string, extra?: { folderMarker?: boolean; title?: string }) => ({
    meta: { path, ...extra },
  });

  it("un item dans 'A/B/C' rend 'A' visible à la racine sans aucun marqueur", () => {
    expect(deriveFolders([item('A/B/C')], '')).toEqual(['A']);
    expect(deriveFolders([item('A/B/C')], 'A')).toEqual(['B']);
  });

  it('NFC : le composé et le décomposé font UN dossier', () => {
    const folders = deriveFolders([item('café/x'), item('café/y')], '');
    expect(folders).toEqual(['café']);
  });

  it('union marqueurs + implicites, sans doublon', () => {
    const folders = deriveFolders(
      [
        item('Docs/a'),
        item('', { folderMarker: true, title: 'Docs' }),
        item('', { folderMarker: true, title: 'Vide' }),
      ],
      ''
    );
    expect([...folders].sort()).toEqual(['Docs', 'Vide']);
  });

  it('un marqueur rangé AILLEURS ne crée pas de dossier ici', () => {
    expect(deriveFolders([item('X', { folderMarker: true, title: 'Sous' })], '')).toEqual(['X']);
  });
});

describe('sortFoldersFirst', () => {
  it("ordre humain : 'Dossier 2' avant 'Dossier 10'", () => {
    expect(sortFoldersFirst(['Dossier 10', 'Dossier 2'], collator)).toEqual([
      'Dossier 2',
      'Dossier 10',
    ]);
  });
});

describe('planFolderRename', () => {
  const items: Array<{ id: string; meta: PathedMeta }> = [
    { id: 'marker', meta: { folderMarker: true, title: 'A' } },
    { id: 'i1', meta: { title: 'un', path: 'A' } },
    { id: 'i2', meta: { title: 'deux', path: 'A/B' } },
    { id: 'i3', meta: { title: 'piège', path: 'AB' } },
    { id: 'i4', meta: { title: 'ailleurs', path: 'C' } },
  ];

  it('réécrit le préfixe des descendants ET le titre du marqueur — jamais AB', () => {
    const moves = planFolderRename(items, 'A', 'Z');
    const byId = Object.fromEntries(moves.map((m) => [m.itemId, m.meta]));
    expect(Object.keys(byId).sort()).toEqual(['i1', 'i2', 'marker']);
    expect(byId.marker.title).toBe('Z');
    expect(byId.i1.path).toBe('Z');
    expect(byId.i2.path).toBe('Z/B');
  });

  it('la REPRISE replanifie depuis l’état partiel et ne produit que le reste', () => {
    const first = planFolderRename(items, 'A', 'Z');
    // Panne à mi-chemin : seul i1 est passé. L'état du store après reload :
    const partial = items.map((i) =>
      i.id === 'i1' ? { ...i, meta: first.find((m) => m.itemId === 'i1')!.meta } : i
    );
    const resume = planFolderRename(partial, 'A', 'Z');
    expect(resume.map((m) => m.itemId).sort()).toEqual(['i2', 'marker']);
  });

  it('la racine ne se renomme pas', () => {
    expect(() => planFolderRename(items, '', 'Z')).toThrow('folder_name_invalid');
  });
});

describe('planMoveInto', () => {
  const items: Array<{ id: string; meta: PathedMeta }> = [
    { id: 'marker', meta: { folderMarker: true, title: 'A' } },
    { id: 'i1', meta: { title: 'un', path: 'A' } },
    { id: 'i2', meta: { title: 'deux', path: 'A/B' } },
    { id: 'solo', meta: { title: 'seul', path: '' } },
  ];

  it('déplace un item — un seul PATCH', () => {
    const moves = planMoveInto(items, [{ kind: 'item', id: 'solo' }], 'A');
    expect(moves).toHaveLength(1);
    expect(moves[0].meta.path).toBe('A');
  });

  it('déplacer un item là où il est déjà ne produit RIEN', () => {
    expect(planMoveInto(items, [{ kind: 'item', id: 'i1' }], 'A')).toEqual([]);
  });

  it('déplace un dossier entier : marqueur + descendants, préfixe recalé', () => {
    const dest = 'C';
    const moves = planMoveInto(items, [{ kind: 'folder', path: 'A' }], dest);
    const byId = Object.fromEntries(moves.map((m) => [m.itemId, m.meta]));
    expect(byId.marker.path).toBe('C');
    expect(byId.i1.path).toBe('C/A');
    expect(byId.i2.path).toBe('C/A/B');
  });

  it('garde de cycle : un dossier ne rentre ni dans lui-même ni dans son descendant', () => {
    expect(() => planMoveInto(items, [{ kind: 'folder', path: 'A' }], 'A')).toThrow(
      'folder_move_into_self'
    );
    expect(() => planMoveInto(items, [{ kind: 'folder', path: 'A' }], 'A/B')).toThrow(
      'folder_move_into_self'
    );
  });
});

describe('planFolderDelete — la récursion planifiée, droits d’abord', () => {
  type It = { id: string; meta: PathedMeta; mine: boolean };
  const item = (id: string, path: string | undefined, mine = true): It => ({
    id,
    meta: { title: id, path },
    mine,
  });
  const marker = (id: string, path: string | undefined, title: string, mine = true): It => ({
    id,
    meta: { folderMarker: true, title, path },
    mine,
  });
  const canDelete = (i: It) => i.mine;

  it('tout supprimable : contenus d’abord, marqueurs du plus profond à la racine', () => {
    const items = [
      marker('mA', undefined, 'A'),
      marker('mAB', 'A', 'B'),
      item('f1', 'A'),
      item('f2', 'A/B'),
    ];
    const plan = planFolderDelete(items, 'A', canDelete);
    expect(plan.totalContent).toBe(2);
    expect(plan.deletions.slice(0, 2).sort()).toEqual(['f1', 'f2']);
    // Marqueurs : B (profond) avant A (racine du dossier supprimé).
    expect(plan.deletions.slice(2)).toEqual(['mAB', 'mA']);
    expect(plan.skippedContent).toBe(0);
    expect(plan.skippedMarkers).toBe(0);
  });

  it('un contenu sauté garde vivants SON marqueur ET ceux de ses ancêtres', () => {
    const items = [
      marker('mA', undefined, 'A'),
      marker('mAB', 'A', 'B'),
      item('mien', 'A'),
      item('autrui', 'A/B', false),
    ];
    const plan = planFolderDelete(items, 'A', canDelete);
    expect(plan.deletions).toEqual(['mien']); // ni mAB (abrite autrui) ni mA (ancêtre)
    expect(plan.skippedContent).toBe(1);
    expect(plan.skippedMarkers).toBe(2);
  });

  it('un marqueur sans droit est sauté et protège ses ancêtres', () => {
    const items = [marker('mA', undefined, 'A'), marker('mAB', 'A', 'B', false)];
    const plan = planFolderDelete(items, 'A', canDelete);
    expect(plan.deletions).toEqual([]); // mAB sans droit ⇒ mA doit survivre aussi
    expect(plan.skippedMarkers).toBe(2);
  });

  it('un dossier HOMONYME dans un autre parent n’est jamais touché', () => {
    const items = [
      marker('mA', undefined, 'A'),
      marker('mXB', 'X', 'A'), // « A » aussi, mais sous X
      item('fx', 'X/A'),
    ];
    const plan = planFolderDelete(items, 'A', canDelete);
    expect(plan.deletions).toEqual(['mA']);
  });

  it('la racine ne se supprime pas ; plan vide quand rien n’est supprimable', () => {
    expect(() => planFolderDelete([], '', canDelete)).toThrow('folder_name_invalid');
    const plan = planFolderDelete([item('x', 'A', false)], 'A', canDelete);
    expect(plan.deletions).toEqual([]);
    expect(plan.totalContent).toBe(1);
    expect(plan.skippedContent).toBe(1);
  });
});
