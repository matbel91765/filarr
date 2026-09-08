/**
 * Jointure notes × coffres pour le badge de partage.
 *
 * Ce qui est verrouillé : la projection `VaultsState → VaultsLite` (notamment
 * ce que « chargé » veut dire : le drapeau de session `initialLoadRequested`,
 * pas le contenu de la liste), le périmètre « notes vivantes seulement », le
 * cycle corbeille → restauration d'une copie, et la mémoïsation — une action
 * étrangère ne doit pas refaire la jointure ni rendre une nouvelle identité
 * (sinon chaque ligne de liste re-rend à chaque frappe).
 */

import { describe, expect, it } from 'vitest';

import {
  selectSharedNoteIds,
  selectShareInfoByNoteId,
  selectVaultsLite,
} from '../noteShareSelectors';
import type { RootState } from '../../index';
import type { Note, NoteShareRef } from '../../../types/notes';

const ref = (vaultId: string, itemId: string): NoteShareRef => ({
  vaultId,
  itemId,
  mode: 'copy',
  at: '2026-08-01T00:00:00.000Z',
});

const note = (id: string, extra: Partial<Note> = {}): Note =>
  ({ id, title: id, createdAt: 'x', updatedAt: 'x', ...extra }) as Note;

interface VaultsOpts {
  vaults?: Array<{ id: string; name: string; unlocked?: boolean }>;
  items?: Record<string, string[]>;
  undecryptable?: Record<string, number>;
  /** `initialLoadRequested` — par défaut, « des coffres connus » vaut « demandé ». */
  loaded?: boolean;
  loading?: boolean;
  error?: string | null;
}

/** Fragment de RootState : ces sélecteurs ne lisent que notes + vaults. */
const state = (notes: Note[], v: VaultsOpts = {}): RootState => {
  const vaults = v.vaults ?? [];
  return {
    notes: {
      byId: Object.fromEntries(notes.map((n) => [n.id, n])),
      allIds: notes.map((n) => n.id),
    },
    vaults: {
      initialLoadRequested: v.loaded ?? vaults.length > 0,
      loading: v.loading ?? false,
      error: v.error ?? null,
      vaults: Object.fromEntries(vaults.map((x) => [x.id, { id: x.id, name: x.name }])),
      vaultIds: vaults.map((x) => x.id),
      unlockedVaultIds: vaults.filter((x) => x.unlocked).map((x) => x.id),
      itemsByVault: Object.fromEntries(
        Object.entries(v.items ?? {}).map(([vid, ids]) => [vid, ids.map((id) => ({ id }))])
      ),
      decryptStatusByVault: Object.fromEntries(
        Object.entries(v.undecryptable ?? {}).map(([vid, n]) => [
          vid,
          { undecryptable: n, historyAvailable: true },
        ])
      ),
    },
  } as unknown as RootState;
};

describe('selectSharedNoteIds', () => {
  it('les notes vivantes avec au moins un dépôt ; ni corbeille, ni tableau vide, ni champ absent', () => {
    const s = state([
      note('a', { sharedTo: [ref('v1', 'i1')] }),
      note('b', { sharedTo: [ref('v1', 'i2')], deletedAt: '2026-08-02T00:00:00.000Z' }),
      note('c', { sharedTo: [] }),
      note('d'),
    ]);
    expect([...selectSharedNoteIds(s)]).toEqual(['a']);
  });
});

describe('selectVaultsLite — projection de VaultsState', () => {
  it('vaultsLoaded = demandé, terminé, réussi (initialLoadRequested && !loading && !error)', () => {
    // Jamais demandé : rien ne prouve rien.
    expect(selectVaultsLite(state([])).vaultsLoaded).toBe(false);
    // Demandé mais encore en cours : une liste vide n'est pas une liste chargée.
    expect(selectVaultsLite(state([], { loaded: true, loading: true })).vaultsLoaded).toBe(false);
    // Demandé, terminé, liste VIDE : chargée quand même — l'ancienne
    // approximation « au moins un coffre connu » ne savait pas le dire.
    expect(selectVaultsLite(state([], { loaded: true })).vaultsLoaded).toBe(true);
    // Terminé sur un ÉCHEC : une liste qu'on n'a pas pu lire n'est pas vide.
    expect(
      selectVaultsLite(state([], { loaded: true, error: 'network_unavailable' })).vaultsLoaded
    ).toBe(false);
    expect(
      selectVaultsLite(state([], { vaults: [{ id: 'v1', name: 'Équipe' }] })).vaultsLoaded
    ).toBe(true);
  });

  it('tous les coffres disparus, liste chargée → vaultGone (et plus « unknown » à jamais)', () => {
    const s = state([note('c', { sharedTo: [ref('v9', 'i9')] })], { loaded: true });
    expect(selectShareInfoByNoteId(s).c.badge).toBe('vaultGone');
    // Le même compte, hors ligne : le verdict retombe à « je ne sais pas ».
    const horsLigne = state([note('c', { sharedTo: [ref('v9', 'i9')] })], {
      loaded: true,
      error: 'network_unavailable',
    });
    expect(selectShareInfoByNoteId(horsLigne).c.badge).toBe('unknown');
  });

  it('nom, déverrouillage, identifiants d’éléments et compte d’indéchiffrables', () => {
    const l = selectVaultsLite(
      state([], {
        vaults: [
          { id: 'v1', name: 'Équipe', unlocked: true },
          { id: 'v2', name: 'Client' },
        ],
        items: { v1: ['i1', 'i2'] },
        undecryptable: { v1: 3 },
      })
    );
    expect(l.vaults).toEqual({
      v1: { name: 'Équipe', unlocked: true },
      v2: { name: 'Client', unlocked: false },
    });
    expect([...(l.itemIdsByVault?.v1 ?? [])]).toEqual(['i1', 'i2']);
    expect(l.itemIdsByVault?.v2).toBeUndefined(); // pas chargé ≠ vide
    expect(l.undecryptableByVault).toEqual({ v1: 3 });
  });
});

describe('selectShareInfoByNoteId — la jointure', () => {
  const s = state(
    [
      note('a', { sharedTo: [ref('v1', 'i1')] }),
      note('b', { sharedTo: [ref('v1', 'zzz'), ref('v2', 'i2')] }),
      note('c', { sharedTo: [ref('v9', 'i9')] }),
      note('d'),
    ],
    {
      vaults: [
        { id: 'v1', name: 'Équipe', unlocked: true },
        { id: 'v2', name: 'Client' },
      ],
      items: { v1: ['i1'] },
    }
  );

  it('badge résumé + détail par coffre, avec le nom du coffre', () => {
    const info = selectShareInfoByNoteId(s);
    expect(Object.keys(info).sort()).toEqual(['a', 'b', 'c']);
    expect(info.a.badge).toBe('live');
    expect(info.a.entries).toEqual([{ ref: ref('v1', 'i1'), state: 'live', vaultName: 'Équipe' }]);
    // b : copie absente d'un coffre ouvert + coffre verrouillé → locked domine
    expect(info.b.badge).toBe('locked');
    expect(info.b.entries.map((e) => e.state)).toEqual(['copyMissing', 'locked']);
    expect(info.b.entries[1].vaultName).toBe('Client');
    // c : coffre inconnu, liste chargée → vaultGone, sans nom
    expect(info.c).toEqual({
      badge: 'vaultGone',
      entries: [{ ref: ref('v9', 'i9'), state: 'vaultGone', vaultName: null }],
    });
  });

  it('avant loadVaults, un coffre inconnu est « unknown », pas « vaultGone »', () => {
    const froid = state([note('c', { sharedTo: [ref('v9', 'i9')] })]);
    expect(selectShareInfoByNoteId(froid).c.badge).toBe('unknown');
  });

  it('mémoïsé : même identité tant que ni les notes ni les coffres ne changent', () => {
    const first = selectShareInfoByNoteId(s);
    // Une action étrangère renouvelle l'objet racine sans toucher aux entrées.
    const again = { ...s, ui: { foo: 1 } } as unknown as RootState;
    expect(selectShareInfoByNoteId(again)).toBe(first);
    expect(selectSharedNoteIds(again)).toBe(selectSharedNoteIds(s));
  });

  it('corbeille du coffre : la copie quitte itemsByVault → copyMissing ; restaurée → live, même marqueur', () => {
    const base = state([note('a', { sharedTo: [ref('v1', 'i1')] })], {
      vaults: [{ id: 'v1', name: 'Équipe', unlocked: true }],
      items: { v1: ['i1'] },
    });
    expect(selectShareInfoByNoteId(base).a.badge).toBe('live');
    // `deleteVaultItem.fulfilled` retire l'élément de la liste (soft-delete
    // serveur, corbeille 30 j) ; la note, elle, n'est PAS touchée.
    const corbeille = {
      ...base,
      vaults: { ...base.vaults, itemsByVault: { v1: [] } },
    } as unknown as RootState;
    expect(selectShareInfoByNoteId(corbeille).a.badge).toBe('copyMissing');
    // `loadVaultItems` après `apiRestoreVaultItem` le ramène : même marqueur, live.
    const restaure = {
      ...base,
      vaults: { ...base.vaults, itemsByVault: { v1: [{ id: 'i1' }] } },
    } as unknown as RootState;
    expect(selectShareInfoByNoteId(restaure).a.badge).toBe('live');
  });

  it('se recalcule quand un coffre se déverrouille', () => {
    const first = selectShareInfoByNoteId(s);
    const ouvert = {
      ...s,
      vaults: {
        ...s.vaults,
        unlockedVaultIds: ['v1', 'v2'],
        itemsByVault: { v1: [{ id: 'i1' }], v2: [{ id: 'i2' }] },
      },
    } as unknown as RootState;
    const next = selectShareInfoByNoteId(ouvert);
    expect(next).not.toBe(first);
    expect(next.b.badge).toBe('live');
  });
});
