/**
 * buildItemContextMenu — le menu d'un RACCOURCI vers un coffre partagé.
 *
 *   npx vitest run src/renderer/components/files/__tests__/itemContextMenuShortcut.vitest.ts
 *
 * Ce qu'on éprouve : « Ouvrir dans le coffre » n'existe que si la capacité ET
 * le geste sont posés, et se place en TÊTE (avant « Ouvrir ») ; « Retirer le
 * raccourci » occupe la place de « Supprimer » (séparateur juste avant,
 * `danger`, même raccourci clavier) ; et le menu complet d'un raccourci tel
 * que l'hôte le déclare ne contient AUCUNE entrée qui supposerait des octets
 * ici (renommer, télécharger, partager, versions, protéger…) — absentes, pas
 * grisées.
 *
 * `t` rend la CLÉ : les libellés sont alors des identifiants stables.
 */

import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../../ui/ContextMenu';
import { buildItemContextMenu } from '../itemContextMenu';

const t = ((key: string) => key) as unknown as TFunction;
const item = { id: 'x' };
const noop = () => {};

const shape = (items: ContextMenuItem[]): string[] =>
  items.map((i) =>
    'divider' in i && i.divider ? '---' : ((i as { label?: string }).label ?? '?')
  );

describe('buildItemContextMenu — raccourci vers un coffre', () => {
  it('« Ouvrir dans le coffre » : absente sans capacité, absente sans geste', () => {
    expect(
      shape(buildItemContextMenu(item, { openInVault: true }, { onDetails: noop }, t))
    ).toEqual([]);
    expect(
      shape(
        buildItemContextMenu(item, { details: true }, { onOpenInVault: noop, onDetails: noop }, t)
      )
    ).toEqual(['contextMenu.details']);
  });

  it('« Ouvrir dans le coffre » se place en TÊTE, avant « Ouvrir »', () => {
    const items = buildItemContextMenu(
      item,
      { openInVault: true, open: true, details: true },
      { onOpenInVault: noop, onOpen: noop, onDetails: noop },
      t
    );
    expect(shape(items)).toEqual([
      'teamVaults.shortcut.openInVault',
      'contextMenu.open',
      'contextMenu.details',
    ]);
    const entry = items[0] as { onClick?: () => void; danger?: boolean; icon?: unknown };
    expect(typeof entry.onClick).toBe('function');
    expect(entry.danger).toBeFalsy();
    expect(entry.icon).toBeTruthy();
  });

  it('« Retirer le raccourci » occupe la place de « Supprimer » : séparateur, danger, même touche', () => {
    const items = buildItemContextMenu(
      item,
      { details: true, removeShortcut: true },
      { onDetails: noop, onRemoveShortcut: noop },
      t
    );
    expect(shape(items)).toEqual(['contextMenu.details', '---', 'teamVaults.shortcut.remove']);
    const entry = items[2] as { danger?: boolean; shortcut?: string };
    expect(entry.danger).toBe(true);
    expect(entry.shortcut).toBe('contextMenu.deleteShortcut');
    // Sans geste, pas d'entrée — et pas de séparateur orphelin.
    expect(
      shape(
        buildItemContextMenu(item, { details: true, removeShortcut: true }, { onDetails: noop }, t)
      )
    ).toEqual(['contextMenu.details']);
  });

  it('le menu complet d un raccourci, tel que la vue dossier le déclare', () => {
    const items = buildItemContextMenu(
      item,
      { openInVault: true, details: true, favorite: true, reminder: true, removeShortcut: true },
      {
        onOpenInVault: noop,
        onDetails: noop,
        onFavorite: noop,
        onReminder: noop,
        onRemoveShortcut: noop,
      },
      t
    );
    expect(shape(items)).toEqual([
      'teamVaults.shortcut.openInVault',
      'contextMenu.details',
      'contextMenu.addToFavorites',
      'contextMenu.addReminder',
      '---',
      'teamVaults.shortcut.remove',
    ]);
    // Rien qui supposerait des octets ici.
    const labels = shape(items);
    for (const interdit of [
      'contextMenu.rename',
      'contextMenu.download',
      'contextMenu.shareLink',
      'contextMenu.copy',
      'contextMenu.move',
      'contextMenu.versions',
      'contextMenu.protect',
      'contextMenu.sync',
      'contextMenu.openWith',
      'contextMenu.showInExplorer',
      'contextMenu.delete',
      'teamVaults.addToVault.menu',
    ]) {
      expect(labels).not.toContain(interdit);
    }
  });

  it('un fichier ORDINAIRE ne voit ni l une ni l autre, même si l hôte fournit les gestes', () => {
    const items = buildItemContextMenu(
      item,
      { details: true, delete: true },
      { onDetails: noop, onDelete: noop, onOpenInVault: noop, onRemoveShortcut: noop },
      t
    );
    expect(shape(items)).toEqual(['contextMenu.details', '---', 'contextMenu.delete']);
  });
});
