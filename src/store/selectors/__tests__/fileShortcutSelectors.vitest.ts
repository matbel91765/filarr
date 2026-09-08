/**
 * fileShortcutSelectors — la matrice d'état d'un raccourci vers un coffre.
 *
 *   npx vitest run src/store/selectors/__tests__/fileShortcutSelectors.vitest.ts
 *
 * Ce qu'on éprouve : chaque case du CONTRAT (live / locked / missing / gone /
 * unknown), la lecture structurelle de `vaultRef`, le libellé de repli, et la
 * STABILITÉ des sélecteurs mémoïsés (même Map tant que rien n'a bougé — c'est
 * ce qui protège les cartes `React.memo`).
 */

import { describe, it, expect } from 'vitest';
import {
  buildShortcutCardProps,
  selectFileShortcutState,
  selectShortcutCardProps,
  selectVaultsLite,
  shortcutLabel,
  shortcutState,
  vaultRefOf,
  type VaultsLite,
  type WithVaultsLite,
} from '../fileShortcutSelectors';

const REF = { vaultId: 'v1', itemId: 'i1', movedAt: '2026-08-28T10:00:00.000Z' };

const lite = (over: Partial<VaultsLite> = {}): VaultsLite => ({
  vaultsLoaded: true,
  vaultsAuthoritative: true,
  vaults: { v1: { name: 'Contrats' } },
  unlockedVaultIds: ['v1'],
  itemsByVault: { v1: [{ id: 'i1' }, { id: 'i2' }] },
  decryptStatusByVault: {},
  ...over,
});

describe('shortcutState — la matrice du contrat', () => {
  it('live : coffre connu, déverrouillé, élément présent', () => {
    expect(shortcutState(REF, lite())).toBe('live');
  });

  it('unknown : la liste des coffres n est pas encore chargée', () => {
    expect(shortcutState(REF, lite({ vaultsLoaded: false }))).toBe('unknown');
    // Même si tout le reste dirait « live » : sans liste, on n'affirme rien.
    expect(shortcutState(REF, lite({ vaultsLoaded: false, vaults: {} }))).toBe('unknown');
  });

  it('gone : liste chargée et fiable, coffre absent', () => {
    expect(shortcutState(REF, lite({ vaults: {} }))).toBe('gone');
    expect(shortcutState(REF, lite({ vaults: { autre: { name: 'X' } } }))).toBe('gone');
  });

  it('unknown plutôt que gone quand la liste a été chargée SANS paire de clés', () => {
    expect(shortcutState(REF, lite({ vaults: {}, vaultsAuthoritative: false }))).toBe('unknown');
    // Mais un coffre PRÉSENT dans une liste non fiable reste exploitable.
    expect(shortcutState(REF, lite({ vaultsAuthoritative: false }))).toBe('live');
  });

  it('locked : coffre connu mais verrouillé', () => {
    expect(shortcutState(REF, lite({ unlockedVaultIds: [] }))).toBe('locked');
    expect(shortcutState(REF, lite({ unlockedVaultIds: ['v2'] }))).toBe('locked');
  });

  it('locked : déverrouillé mais éléments jamais chargés', () => {
    expect(shortcutState(REF, lite({ itemsByVault: {} }))).toBe('locked');
    expect(shortcutState(REF, lite({ itemsByVault: { v1: undefined } }))).toBe('locked');
  });

  it('locked : éléments chargés, le nôtre absent, mais des indéchiffrables', () => {
    expect(
      shortcutState(
        REF,
        lite({
          itemsByVault: { v1: [{ id: 'i2' }] },
          decryptStatusByVault: { v1: { undecryptable: 3 } },
        })
      )
    ).toBe('locked');
  });

  it('live prime sur les indéchiffrables quand le nôtre EST présent', () => {
    expect(shortcutState(REF, lite({ decryptStatusByVault: { v1: { undecryptable: 3 } } }))).toBe(
      'live'
    );
  });

  it('missing : éléments chargés et lisibles, le nôtre absent', () => {
    expect(shortcutState(REF, lite({ itemsByVault: { v1: [{ id: 'i2' }] } }))).toBe('missing');
    expect(shortcutState(REF, lite({ itemsByVault: { v1: [] } }))).toBe('missing');
    expect(
      shortcutState(
        REF,
        lite({ itemsByVault: { v1: [] }, decryptStatusByVault: { v1: { undecryptable: 0 } } })
      )
    ).toBe('missing');
  });
});

describe('shortcutLabel', () => {
  it('le nom du coffre quand il est déchiffré', () => {
    expect(shortcutLabel(REF, lite(), 'Coffre partagé')).toBe('Contrats');
  });

  it('le repli quand le coffre est verrouillé (nom vide), absent, ou blanc', () => {
    expect(shortcutLabel(REF, lite({ vaults: { v1: { name: '' } } }), 'Coffre partagé')).toBe(
      'Coffre partagé'
    );
    expect(shortcutLabel(REF, lite({ vaults: { v1: { name: '   ' } } }), 'Coffre partagé')).toBe(
      'Coffre partagé'
    );
    expect(shortcutLabel(REF, lite({ vaults: {} }), 'Coffre partagé')).toBe('Coffre partagé');
  });
});

describe('vaultRefOf — lecture structurelle', () => {
  it('lit une référence complète', () => {
    expect(vaultRefOf({ id: 'f', vaultRef: REF })).toEqual(REF);
  });

  it('tolère un movedAt absent (chaîne vide), refuse un vaultId / itemId manquant', () => {
    expect(vaultRefOf({ vaultRef: { vaultId: 'v', itemId: 'i' } })).toEqual({
      vaultId: 'v',
      itemId: 'i',
      movedAt: '',
    });
    expect(vaultRefOf({ vaultRef: { vaultId: 'v' } })).toBeUndefined();
    expect(vaultRefOf({ vaultRef: { itemId: 'i' } })).toBeUndefined();
    expect(vaultRefOf({ vaultRef: { vaultId: '', itemId: 'i' } })).toBeUndefined();
    expect(vaultRefOf({ vaultRef: { vaultId: 1, itemId: 'i' } })).toBeUndefined();
  });

  it('rend undefined pour tout ce qui n est pas un raccourci', () => {
    expect(vaultRefOf(undefined)).toBeUndefined();
    expect(vaultRefOf(null)).toBeUndefined();
    expect(vaultRefOf('x')).toBeUndefined();
    expect(vaultRefOf({ id: 'f', name: 'a.pdf' })).toBeUndefined();
    expect(vaultRefOf({ vaultRef: null })).toBeUndefined();
    expect(vaultRefOf({ vaultRef: 'v1:i1' })).toBeUndefined();
    // Un dossier n'est jamais un raccourci.
    expect(vaultRefOf({ id: 'd', items: [] })).toBeUndefined();
  });
});

describe('buildShortcutCardProps', () => {
  it('ne retient que les fichiers-raccourcis, avec libellé et état', () => {
    const files = [
      { id: 'a', name: 'a.pdf' },
      { id: 'b', name: 'b.pdf', vaultRef: REF },
      { id: 'c', name: 'c.pdf', vaultRef: { vaultId: 'nope', itemId: 'x', movedAt: '' } },
      { id: 'd', name: 'd.pdf', vaultRef: { vaultId: 'v1' } },
    ];
    const map = buildShortcutCardProps(files, lite(), 'Coffre partagé');
    expect([...map.keys()]).toEqual(['b', 'c']);
    expect(map.get('b')).toEqual({ label: 'Contrats', state: 'live' });
    expect(map.get('c')).toEqual({ label: 'Coffre partagé', state: 'gone' });
  });

  it('rend une Map vide pour une liste sans raccourci', () => {
    expect(buildShortcutCardProps([{ id: 'a' }], lite(), 'x').size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const state = (over: Partial<WithVaultsLite['vaults']> = {}): WithVaultsLite => ({
  vaults: {
    vaults: { v1: { name: 'Contrats' } },
    unlockedVaultIds: ['v1'],
    itemsByVault: { v1: [{ id: 'i1' }] },
    decryptStatusByVault: {},
    initialLoadRequested: true,
    lastLoadHadKeypair: true,
    loading: false,
    ...over,
  },
});

describe('selectVaultsLite / selectFileShortcutState', () => {
  it('« chargé » = demandé ET retombé : en vol, c est unknown', () => {
    expect(selectFileShortcutState(state(), REF)).toBe('live');
    expect(selectFileShortcutState(state({ initialLoadRequested: false }), REF)).toBe('unknown');
    expect(selectFileShortcutState(state({ loading: true }), REF)).toBe('unknown');
  });

  it('sans paire de clés au dernier chargement, un coffre absent reste unknown', () => {
    expect(selectFileShortcutState(state({ vaults: {}, lastLoadHadKeypair: false }), REF)).toBe(
      'unknown'
    );
    expect(selectFileShortcutState(state({ vaults: {} }), REF)).toBe('gone');
  });

  it('même extrait tant que les sept champs n ont pas bougé', () => {
    const s = state();
    expect(selectVaultsLite(s)).toBe(selectVaultsLite({ vaults: { ...s.vaults } }));
    const moved = state({ unlockedVaultIds: [] });
    expect(selectVaultsLite(moved)).not.toBe(selectVaultsLite(s));
  });
});

describe('selectShortcutCardProps — mémoïsation', () => {
  it('même Map (et mêmes valeurs) pour le même store, la même liste et le même repli', () => {
    const s = state();
    const files = [{ id: 'b', vaultRef: REF }];
    const a = selectShortcutCardProps(s, files, 'Coffre partagé');
    const b = selectShortcutCardProps(s, files, 'Coffre partagé');
    expect(b).toBe(a);
    expect(b.get('b')).toBe(a.get('b'));
  });

  it('nouvelle Map quand l état des coffres change', () => {
    const files = [{ id: 'b', vaultRef: REF }];
    const a = selectShortcutCardProps(state(), files, 'Coffre partagé');
    const b = selectShortcutCardProps(state({ unlockedVaultIds: [] }), files, 'Coffre partagé');
    expect(b).not.toBe(a);
    expect(b.get('b')?.state).toBe('locked');
  });

  it('nouvelle Map quand la liste change', () => {
    const s = state();
    const a = selectShortcutCardProps(s, [{ id: 'b', vaultRef: REF }], 'Coffre partagé');
    const b = selectShortcutCardProps(s, [{ id: 'z', vaultRef: REF }], 'Coffre partagé');
    expect(b).not.toBe(a);
    expect(b.has('b')).toBe(false);
    expect(b.get('z')?.state).toBe('live');
  });
});
