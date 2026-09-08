/**
 * Modèle pur du partage de notes — la matrice de DÉGRADATION de `shareRefState`
 * est ce qui est verrouillé ici : chaque ligne est un moment réel de la vie de
 * l'app (avant `loadVaults`, coffre verrouillé, éléments pas chargés, élément
 * indéchiffrable sauté) où un verdict définitif serait un mensonge.
 */

import { describe, expect, it } from 'vitest';

import { removeShareRef, shareBadgeState, shareRefState, upsertShareRef } from '../noteShareModel';
import type { VaultsLite } from '../noteShareModel';
import type { NoteShareRef } from '../../../types/notes';

const ref = (vaultId: string, itemId: string, extra: Partial<NoteShareRef> = {}): NoteShareRef => ({
  vaultId,
  itemId,
  mode: 'copy',
  at: '2026-08-01T00:00:00.000Z',
  ...extra,
});

const lite = (over: Partial<VaultsLite> = {}): VaultsLite => ({
  vaultsLoaded: true,
  vaults: { v1: { name: 'Équipe', unlocked: true } },
  itemIdsByVault: { v1: new Set(['i1']) },
  undecryptableByVault: { v1: 0 },
  ...over,
});

describe('shareRefState — matrice de dégradation', () => {
  it('1a. coffre inconnu, liste chargée → vaultGone', () => {
    expect(shareRefState(ref('v9', 'i1'), lite())).toBe('vaultGone');
  });

  it('1b. coffre inconnu, liste PAS chargée → unknown (jamais un verdict au démarrage)', () => {
    expect(shareRefState(ref('v9', 'i1'), lite({ vaultsLoaded: false, vaults: {} }))).toBe(
      'unknown'
    );
  });

  it('2. coffre connu mais verrouillé → locked, même si les éléments disent « absent »', () => {
    const l = lite({
      vaults: { v1: { name: 'Équipe', unlocked: false } },
      itemIdsByVault: { v1: new Set() },
    });
    expect(shareRefState(ref('v1', 'i1'), l)).toBe('locked');
  });

  it('3. coffre déverrouillé, éléments pas encore chargés → unknown', () => {
    expect(shareRefState(ref('v1', 'i1'), lite({ itemIdsByVault: {} }))).toBe('unknown');
    expect(shareRefState(ref('v1', 'i1'), lite({ itemIdsByVault: undefined }))).toBe('unknown');
  });

  it('4. éléments chargés, copie présente → live', () => {
    expect(shareRefState(ref('v1', 'i1'), lite())).toBe('live');
  });

  it('5. copie absente MAIS des éléments indéchiffrables ont été sautés → locked', () => {
    const l = lite({ itemIdsByVault: { v1: new Set(['autre']) }, undecryptableByVault: { v1: 2 } });
    expect(shareRefState(ref('v1', 'i1'), l)).toBe('locked');
  });

  it('6. copie absente, tout déchiffré → copyMissing (le seul chemin vers ce verdict)', () => {
    const l = lite({ itemIdsByVault: { v1: new Set(['autre']) } });
    expect(shareRefState(ref('v1', 'i1'), l)).toBe('copyMissing');
  });

  it('6b. copie absente, liste d’éléments chargée mais VIDE et sans statut de déchiffrement → copyMissing', () => {
    const l = lite({ itemIdsByVault: { v1: new Set() }, undecryptableByVault: undefined });
    expect(shareRefState(ref('v1', 'i1'), l)).toBe('copyMissing');
  });

  it('7. la liste chargée ne rend pas « vaultGone » un coffre connu mais verrouillé', () => {
    const l = lite({ vaults: { v1: { name: 'Équipe', unlocked: false } }, itemIdsByVault: {} });
    expect(shareRefState(ref('v1', 'i1'), l)).toBe('locked');
  });
});

describe('cycle de vie d’une copie soft-supprimée — le verdict se recalcule, il ne se persiste pas', () => {
  it('corbeille du coffre (l’élément quitte la liste) → copyMissing ; restauration → live, même marqueur', () => {
    const marqueur = ref('v1', 'i1');
    expect(shareRefState(marqueur, lite())).toBe('live');
    // Le soft-delete retire l'élément de `itemsByVault` (et le serveur ne le
    // liste plus tant qu'il est en corbeille). Rien d'indéchiffrable : le
    // verdict est copyMissing — SANS que le marqueur de la note ne bouge.
    const corbeille = lite({ itemIdsByVault: { v1: new Set() } });
    expect(shareRefState(marqueur, corbeille)).toBe('copyMissing');
    // La restauration ramène l'élément par loadVaultItems : le MÊME marqueur
    // redevient « visible ». C'est ce qui interdit tout retrait automatique.
    expect(shareRefState(marqueur, lite())).toBe('live');
  });

  it('en corbeille dans un coffre, visible dans un autre → le badge dit live', () => {
    const l = lite({
      vaults: { v1: { name: 'Équipe', unlocked: true }, v2: { name: 'Client', unlocked: true } },
      itemIdsByVault: { v1: new Set(), v2: new Set(['i2']) },
    });
    expect(shareBadgeState({ sharedTo: [ref('v1', 'i1'), ref('v2', 'i2')] }, l)).toBe('live');
  });
});

describe('shareBadgeState — résumé de plusieurs dépôts', () => {
  it('sans dépôt → null (pas de badge), champ absent ou tableau vide', () => {
    expect(shareBadgeState({}, lite())).toBeNull();
    expect(shareBadgeState({ sharedTo: [] }, lite())).toBeNull();
  });

  it('un seul dépôt → son état', () => {
    expect(shareBadgeState({ sharedTo: [ref('v1', 'i1')] }, lite())).toBe('live');
  });

  it('une copie visible domine tout le reste', () => {
    const note = { sharedTo: [ref('v9', 'i1'), ref('v1', 'i1')] };
    expect(shareBadgeState(note, lite())).toBe('live');
  });

  it('l’incertitude (locked/unknown) passe avant les verdicts définitifs', () => {
    const l = lite({
      vaults: { v1: { name: 'Équipe', unlocked: true }, v2: { name: 'Client', unlocked: false } },
      itemIdsByVault: { v1: new Set() },
    });
    // v1 : copyMissing ; v2 : locked → locked l'emporte
    expect(shareBadgeState({ sharedTo: [ref('v1', 'i1'), ref('v2', 'i2')] }, l)).toBe('locked');
    // v1 : copyMissing ; v3 : inconnu, liste non chargée → unknown l'emporte
    const l2 = lite({ vaultsLoaded: false, itemIdsByVault: { v1: new Set() } });
    expect(shareBadgeState({ sharedTo: [ref('v1', 'i1'), ref('v3', 'i3')] }, l2)).toBe('unknown');
  });

  it('entre deux verdicts définitifs, copyMissing avant vaultGone', () => {
    const l = lite({ itemIdsByVault: { v1: new Set() } });
    expect(shareBadgeState({ sharedTo: [ref('v9', 'i9'), ref('v1', 'i1')] }, l)).toBe(
      'copyMissing'
    );
    expect(shareBadgeState({ sharedTo: [ref('v9', 'i9')] }, l)).toBe('vaultGone');
  });
});

describe('upsertShareRef / removeShareRef', () => {
  it('ajoute à une liste absente', () => {
    expect(upsertShareRef(undefined, ref('v1', 'i1'))).toEqual([ref('v1', 'i1')]);
  });

  it('dédoublonne par (vaultId, itemId) et adopte les champs frais, à la même place', () => {
    const base = [ref('v1', 'i1'), ref('v2', 'i2')];
    const next = upsertShareRef(
      base,
      ref('v1', 'i1', { mode: 'move', at: '2026-08-02T00:00:00.000Z' })
    );
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(ref('v1', 'i1', { mode: 'move', at: '2026-08-02T00:00:00.000Z' }));
    expect(next[1]).toEqual(ref('v2', 'i2'));
  });

  it('même coffre, autre élément = deux dépôts distincts', () => {
    const next = upsertShareRef([ref('v1', 'i1')], ref('v1', 'i2'));
    expect(next.map((r) => r.itemId)).toEqual(['i1', 'i2']);
  });

  it('ne mute jamais l’entrée (elle peut être gelée par Redux)', () => {
    const base = Object.freeze([ref('v1', 'i1')]) as readonly NoteShareRef[];
    expect(() => upsertShareRef(base, ref('v2', 'i2'))).not.toThrow();
    expect(() => removeShareRef(base, { vaultId: 'v1', itemId: 'i1' })).not.toThrow();
    expect(base).toHaveLength(1);
  });

  it('retire par (vaultId, itemId) ; liste vide si c’était le dernier ; absent → inchangé', () => {
    expect(
      removeShareRef([ref('v1', 'i1'), ref('v2', 'i2')], { vaultId: 'v1', itemId: 'i1' })
    ).toEqual([ref('v2', 'i2')]);
    expect(removeShareRef([ref('v1', 'i1')], { vaultId: 'v1', itemId: 'i1' })).toEqual([]);
    expect(removeShareRef([ref('v1', 'i1')], { vaultId: 'v1', itemId: 'zzz' })).toEqual([
      ref('v1', 'i1'),
    ]);
    expect(removeShareRef(undefined, { vaultId: 'v1', itemId: 'i1' })).toEqual([]);
  });
});
