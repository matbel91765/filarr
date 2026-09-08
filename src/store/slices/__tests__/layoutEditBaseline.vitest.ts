/**
 * layoutSlice — la session d'édition d'un dossier qui HÉRITE.
 *
 * Le brouillon part d'une copie prise en main (portée « propre ») alors que le
 * stocké est autre chose ; c'est le stocké que « Annuler » doit rendre, et un
 * brouillon sans geste ne doit rien écrire.
 *
 *   npx vitest run src/store/slices/__tests__/layoutEditBaseline.vitest.ts
 */

import { describe, expect, it } from 'vitest';

import layoutReducer, {
  beginLayoutEdit,
  commitLayoutEdit,
  pushLayoutDraft,
  revertLayoutCommit,
  undoLayoutDraft,
} from '../layoutSlice';
import type { LayoutSlot } from '../../../services/layout/layoutTypes';

const inheritConfig: LayoutSlot = {
  id: 'folder:config',
  role: 'folder-config',
  type: 'folder-config',
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  options: { scope: 'inherit' },
};

const ownedCopy: LayoutSlot[] = [
  { ...inheritConfig, options: { scope: 'own' } },
  { id: 'copy-1', role: 'recents', type: 'folder-recents', x: 0, y: 0, w: 6, h: 2 },
];

describe('beginLayoutEdit avec une baseline distincte', () => {
  it('le brouillon porte la copie, la baseline porte le stocké', () => {
    const state = layoutReducer(
      undefined,
      beginLayoutEdit({ viewId: 'folder:semestre', slots: ownedCopy, baseline: [inheritConfig] })
    );
    expect(state.edit?.slots).toEqual(ownedCopy);
    expect(state.edit?.baseline).toEqual([inheritConfig]);
    expect(state.edit?.past).toEqual([]);
  });

  it('sans baseline, elle vaut les emplacements (le contrat de l’accueil)', () => {
    const state = layoutReducer(undefined, beginLayoutEdit({ viewId: 'home', slots: ownedCopy }));
    expect(state.edit?.baseline).toEqual(ownedCopy);
  });

  it('« past » vide ⇔ aucun geste net : un geste puis son annulation le vident', () => {
    let state = layoutReducer(
      undefined,
      beginLayoutEdit({ viewId: 'folder:semestre', slots: ownedCopy, baseline: [inheritConfig] })
    );
    state = layoutReducer(state, pushLayoutDraft({ slots: ownedCopy.slice(0, 1) }));
    expect(state.edit?.past).toHaveLength(1);
    state = layoutReducer(state, undoLayoutDraft());
    expect(state.edit?.past).toHaveLength(0);
    expect(state.edit?.slots).toEqual(ownedCopy);
  });

  it('« Annuler » après commit rend le STOCKÉ, pas la copie', () => {
    let state = layoutReducer(
      undefined,
      beginLayoutEdit({ viewId: 'folder:semestre', slots: ownedCopy, baseline: [inheritConfig] })
    );
    state = layoutReducer(state, pushLayoutDraft({ slots: [...ownedCopy] }));
    state = layoutReducer(state, commitLayoutEdit());
    expect(state.document.views['folder:semestre'].slots).toEqual(ownedCopy);
    state = layoutReducer(state, revertLayoutCommit());
    expect(state.document.views['folder:semestre'].slots).toEqual([inheritConfig]);
  });
});
