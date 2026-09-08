/**
 * buildItemContextMenu — l'entrée « Gérer l'accès » (lot B, étape 6).
 *
 * Ce qu'on éprouve : elle n'existe que si la capacité ET le geste sont posés ;
 * elle ouvre le groupe partage (séparateur juste avant, en TÊTE, avant le lien,
 * la personne et l'ajout au coffre) ; et elle ne fait pas doubler le
 * séparateur que les autres entrées du groupe posaient jusque-là.
 *
 * `t` rend la CLÉ : les libellés sont alors des identifiants stables, ce qui
 * permet de lire l'ordre sans dépendre d'une langue.
 */

import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../../ui/ContextMenu';
import { buildItemContextMenu } from '../itemContextMenu';

const t = ((key: string) => key) as unknown as TFunction;
const item = { id: 'x' };
const noop = () => {};

/** L'ordre lisible : `label` pour une entrée, `---` pour un séparateur. */
const shape = (items: ContextMenuItem[]): string[] =>
  items.map((i) =>
    'divider' in i && i.divider ? '---' : ((i as { label?: string }).label ?? '?')
  );

describe('buildItemContextMenu — « Gérer l accès »', () => {
  it('absente sans capacité, absente sans geste', () => {
    expect(shape(buildItemContextMenu(item, { open: true }, { onOpen: noop }, t))).toEqual([
      'contextMenu.open',
    ]);
    expect(
      shape(buildItemContextMenu(item, { open: true, manageAccess: true }, { onOpen: noop }, t))
    ).toEqual(['contextMenu.open']);
    expect(
      shape(buildItemContextMenu(item, { open: true }, { onOpen: noop, onManageAccess: noop }, t))
    ).toEqual(['contextMenu.open']);
  });

  it('présente : ouvre le groupe partage, séparateur juste avant', () => {
    const items = buildItemContextMenu(
      item,
      { open: true, manageAccess: true },
      { onOpen: noop, onManageAccess: noop },
      t
    );
    expect(shape(items)).toEqual(['contextMenu.open', '---', 'contextMenu.manageAccess']);
    const entry = items[2] as { onClick?: () => void; danger?: boolean; icon?: unknown };
    expect(typeof entry.onClick).toBe('function');
    expect(entry.danger).toBeFalsy();
    expect(entry.icon).toBeTruthy();
  });

  it('en TÊTE du groupe partage, avant lien / personne / ajout au coffre, sans doubler le séparateur', () => {
    const items = buildItemContextMenu(
      item,
      {
        rename: true,
        manageAccess: true,
        share: true,
        shareWithPerson: true,
        addToVault: true,
        delete: true,
      },
      {
        onRename: noop,
        onManageAccess: noop,
        onShare: noop,
        onShareWithPerson: noop,
        onAddToVault: noop,
        onDelete: noop,
      },
      t
    );
    expect(shape(items)).toEqual([
      'contextMenu.rename',
      '---',
      'contextMenu.manageAccess',
      'contextMenu.shareLink',
      'teamVaults.grants.shareWithPerson',
      'teamVaults.addToVault.menu',
      '---',
      'contextMenu.delete',
    ]);
  });

  it('avec la seule entrée « personne » ou « ajout » derrière elle : un seul séparateur, toujours en tête', () => {
    const avecPersonne = buildItemContextMenu(
      item,
      { manageAccess: true, shareWithPerson: true },
      { onManageAccess: noop, onShareWithPerson: noop },
      t
    );
    expect(shape(avecPersonne)).toEqual([
      '---',
      'contextMenu.manageAccess',
      'teamVaults.grants.shareWithPerson',
    ]);
    const avecAjout = buildItemContextMenu(
      item,
      { manageAccess: true, addToVault: true },
      { onManageAccess: noop, onAddToVault: noop },
      t
    );
    expect(shape(avecAjout)).toEqual([
      '---',
      'contextMenu.manageAccess',
      'teamVaults.addToVault.menu',
    ]);
  });

  it('sans elle, le groupe partage garde exactement sa mécanique d avant', () => {
    const items = buildItemContextMenu(
      item,
      { rename: true, share: true, shareWithPerson: true, addToVault: true },
      { onRename: noop, onShare: noop, onShareWithPerson: noop, onAddToVault: noop },
      t
    );
    expect(shape(items)).toEqual([
      'contextMenu.rename',
      '---',
      'contextMenu.shareLink',
      'teamVaults.grants.shareWithPerson',
      'teamVaults.addToVault.menu',
    ]);
    const seulAjout = buildItemContextMenu(
      item,
      { rename: true, addToVault: true },
      { onRename: noop, onAddToVault: noop },
      t
    );
    expect(shape(seulAjout)).toEqual(['contextMenu.rename', '---', 'teamVaults.addToVault.menu']);
  });
});
