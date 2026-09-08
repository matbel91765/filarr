/**
 * folderGridOrder — l'ordre de l'accueil mêlé (lot A, C4) : dossiers d'abord,
 * puis coffres par nom, verrouillés en dernier.
 *
 *   npx vitest run src/renderer/components/home/widgets/__tests__/folderGridOrder.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import { mixHomeCards, orderVaultCards } from '../folderGridOrder';
import type { VaultSummary } from '../../../../../store/slices/vaultsSlice';
import type { Folder } from '../../../../../types';

function vault(id: string, name: string): VaultSummary {
  return {
    id,
    organizationId: 'org',
    ownerUserId: null,
    name,
    currentKeyEpoch: 1,
    wrappedVaultKeyEpoch: 1,
    role: 'member',
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function folder(id: string, name: string): Folder {
  return { id, name } as unknown as Folder;
}

describe('orderVaultCards', () => {
  it('range les déverrouillés par nom (casse et accents ignorés), les verrouillés en queue', () => {
    const vaults = [
      vault('v-z', 'zèbre'),
      vault('v-locked-b', ''),
      vault('v-a', 'Alpha'),
      vault('v-locked-a', ''),
      vault('v-e', 'école'),
    ];
    const out = orderVaultCards(vaults, ['v-z', 'v-a', 'v-e']);
    expect(out.map((c) => c.vault.id)).toEqual(['v-a', 'v-e', 'v-z', 'v-locked-a', 'v-locked-b']);
    expect(out.map((c) => c.unlocked)).toEqual([true, true, true, false, false]);
  });

  it('accepte un Set comme une liste pour les identifiants déverrouillés', () => {
    const vaults = [vault('b', 'B'), vault('a', 'A')];
    expect(orderVaultCards(vaults, new Set(['a', 'b'])).map((c) => c.vault.id)).toEqual(['a', 'b']);
    expect(orderVaultCards(vaults, ['a']).map((c) => c.vault.id)).toEqual(['a', 'b']);
  });

  it('un coffre verrouillé dont le nom est vide ne passe JAMAIS devant un coffre ouvrable', () => {
    // Un tri naïf par nom mettrait '' en tête : c'est exactement le piège.
    const out = orderVaultCards([vault('locked', ''), vault('open', 'Zzz')], ['open']);
    expect(out[0].vault.id).toBe('open');
    expect(out[1].unlocked).toBe(false);
  });

  it('ordre naturel des nombres : « Projet 2 » avant « Projet 10 »', () => {
    const out = orderVaultCards(
      [vault('p10', 'Projet 10'), vault('p2', 'Projet 2')],
      ['p10', 'p2']
    );
    expect(out.map((c) => c.vault.name)).toEqual(['Projet 2', 'Projet 10']);
  });
});

describe('mixHomeCards', () => {
  it('dossiers d’abord, dans l’ordre reçu, puis les coffres rangés', () => {
    const folders = [folder('f2', 'Zed'), folder('f1', 'Alpha')];
    const vaults = [vault('v-locked', ''), vault('v-b', 'Bravo'), vault('v-a', 'Alpha')];
    const out = mixHomeCards(folders, vaults, ['v-a', 'v-b']);
    expect(out.map((c) => (c.kind === 'folder' ? `F:${c.folder.id}` : `V:${c.vault.id}`))).toEqual([
      'F:f2',
      'F:f1',
      'V:v-a',
      'V:v-b',
      'V:v-locked',
    ]);
  });

  it('sans coffre, la grille est exactement la liste des dossiers', () => {
    const folders = [folder('f1', 'A')];
    const out = mixHomeCards(folders, [], []);
    expect(out).toEqual([{ kind: 'folder', folder: folders[0] }]);
  });

  it('sans dossier, la grille est la liste des coffres', () => {
    const out = mixHomeCards([], [vault('v', 'V')], []);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('vault');
  });
});
