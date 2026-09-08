/**
 * Le badge « Partagée » : ce qu'il DIT et où il MÈNE, par état.
 *
 * Ce qui est verrouillé ici, c'est ce qui casse en silence : un badge qui
 * nomme le MAUVAIS coffre quand la note est déposée à plusieurs endroits, un
 * clic qui mène vers une copie manquante (et se lit « elle est bien là »), et
 * le vocabulaire — le mot « synchronisée » n'a pas le droit d'apparaître, sous
 * aucune forme, dans aucun texte que le badge peut rendre.
 */

import { describe, it, expect } from 'vitest';
import type { NoteShareBadgeState } from '../../../../services/notes/noteShareModel';
import type { NoteShareEntry, NoteShareInfo } from '../../../../store/selectors/noteShareSelectors';
import { vaultShareDestination } from '../noteShareNavigation';
import {
  formatShareDate,
  isShareBadgeNavigable,
  primaryShareEntry,
  shareBadgeChipLabel,
  shareBadgeDestination,
  shareBadgeExtraCount,
  shareBadgeLabel,
  shareBadgeMoreTooltip,
  shareBadgeTooltip,
} from '../noteSharedBadgeModel';

const entry = (
  vaultId: string,
  state: NoteShareBadgeState,
  vaultName: string | null = `Nom ${vaultId}`,
  at = '2026-08-20T10:00:00.000Z'
): NoteShareEntry => ({
  ref: { vaultId, itemId: `item-${vaultId}`, mode: 'copy', at },
  state,
  vaultName,
});

const info = (badge: NoteShareBadgeState, ...entries: NoteShareEntry[]): NoteShareInfo => ({
  badge,
  entries,
});

const ALL_STATES: NoteShareBadgeState[] = ['live', 'locked', 'copyMissing', 'vaultGone', 'unknown'];

describe('vaultShareDestination', () => {
  it("mène à la route canonique du coffre, pas à l'élément (pas encore d'adresse profonde)", () => {
    expect(vaultShareDestination({ vaultId: 'v1', itemId: 'i1' })).toBe('/vault-folder/v1');
  });

  it("n'utilise pas l'orthographe legacy /vaults/<id>", () => {
    expect(vaultShareDestination({ vaultId: 'v1', itemId: 'i1' })).not.toMatch(/^\/vaults\//);
  });
});

describe('isShareBadgeNavigable', () => {
  it('mène quelque part seulement quand il y a quelque chose à voir (live, locked)', () => {
    expect(isShareBadgeNavigable('live')).toBe(true);
    expect(isShareBadgeNavigable('locked')).toBe(true);
    expect(isShareBadgeNavigable('copyMissing')).toBe(false);
    expect(isShareBadgeNavigable('vaultGone')).toBe(false);
    expect(isShareBadgeNavigable('unknown')).toBe(false);
  });
});

describe('primaryShareEntry / shareBadgeDestination — plusieurs dépôts', () => {
  it("représente le dépôt dont l'état égale le résumé, pas le premier de la liste", () => {
    const i = info('live', entry('B', 'copyMissing'), entry('A', 'live'));
    expect(primaryShareEntry(i).ref.vaultId).toBe('A');
    expect(shareBadgeDestination(i)).toBe('/vault-folder/A');
  });

  it('avec un seul dépôt, le représente tel quel', () => {
    const i = info('locked', entry('A', 'locked'));
    expect(primaryShareEntry(i).ref.vaultId).toBe('A');
    expect(shareBadgeDestination(i)).toBe('/vault-folder/A');
  });

  it('ne mène nulle part quand le résumé est copyMissing, vaultGone ou unknown', () => {
    expect(shareBadgeDestination(info('copyMissing', entry('A', 'copyMissing')))).toBeNull();
    expect(shareBadgeDestination(info('vaultGone', entry('A', 'vaultGone', null)))).toBeNull();
    expect(shareBadgeDestination(info('unknown', entry('A', 'unknown', null)))).toBeNull();
  });

  it('se replie sur la première entrée si aucune ne porte le résumé (défensif)', () => {
    const i = info('live', entry('B', 'locked'), entry('C', 'locked'));
    expect(primaryShareEntry(i).ref.vaultId).toBe('B');
  });
});

describe('shareBadgeExtraCount / shareBadgeMoreTooltip — le « +N »', () => {
  it('compte les dépôts autres que celui représenté', () => {
    expect(shareBadgeExtraCount(info('live', entry('A', 'live')))).toBe(0);
    expect(shareBadgeExtraCount(info('live', entry('A', 'live'), entry('B', 'locked')))).toBe(1);
    expect(
      shareBadgeExtraCount(
        info('live', entry('A', 'live'), entry('B', 'locked'), entry('C', 'vaultGone', null))
      )
    ).toBe(2);
  });

  it("n'ajoute pas de ligne « aussi dans » pour un dépôt unique", () => {
    expect(shareBadgeMoreTooltip(info('live', entry('A', 'live')))).toBeNull();
  });

  it('ajoute la ligne avec le bon compte quand il y en a plusieurs', () => {
    const more = shareBadgeMoreTooltip(info('live', entry('A', 'live'), entry('B', 'locked')));
    expect(more?.key).toBe('notes.sharedBadge.moreVaults');
    expect(more?.params).toEqual({ count: 1 });
  });
});

describe('shareBadgeTooltip — honnête par état', () => {
  it("live : nomme le coffre, date l'envoi, et dit que les modifications ne se propagent pas", () => {
    const tip = shareBadgeTooltip(
      entry('A', 'live', 'Équipe', '2026-08-20T10:00:00.000Z'),
      'en-US'
    );
    expect(tip.key).toBe('notes.sharedBadge.live');
    expect(tip.params?.vault).toBe('Équipe');
    expect(tip.params?.date).toBe(formatShareDate('2026-08-20T10:00:00.000Z', 'en-US'));
    expect(String(tip.params?.date)).not.toBe('');
    expect(tip.fallback).toMatch(/do not propagate/);
  });

  it('locked : parle de déverrouiller, sans nommer le coffre ni promettre la copie', () => {
    const tip = shareBadgeTooltip(entry('A', 'locked'));
    expect(tip.key).toBe('notes.sharedBadge.locked');
    expect(tip.fallback).toMatch(/unlock/);
    expect(tip.params).toBeUndefined();
  });

  it('copyMissing : nomme le coffre et évoque la suppression, pas un état définitif de la note', () => {
    const tip = shareBadgeTooltip(entry('A', 'copyMissing', 'Clients'));
    expect(tip.key).toBe('notes.sharedBadge.copyMissing');
    expect(tip.params?.vault).toBe('Clients');
    expect(tip.fallback).toMatch(/probably deleted/);
  });

  it("vaultGone : ne nomme rien (il n'y a plus de nom)", () => {
    const tip = shareBadgeTooltip(entry('A', 'vaultGone', null));
    expect(tip.key).toBe('notes.sharedBadge.vaultGone');
    expect(tip.params).toBeUndefined();
  });

  it('unknown : « Partagée » sec', () => {
    const tip = shareBadgeTooltip(entry('A', 'unknown', null));
    expect(tip.key).toBe('notes.sharedBadge.unknown');
    expect(tip.fallback).toBe('Shared');
  });

  it("ne rend jamais le mot « synchronisée » (ni « synced »), quel que soit l'état", () => {
    for (const state of ALL_STATES) {
      const texts = [
        shareBadgeTooltip(entry('A', state)).fallback,
        shareBadgeLabel(state).fallback,
      ];
      for (const text of texts) {
        expect(text.toLowerCase()).not.toMatch(/sync/);
      }
    }
  });
});

describe("shareBadgeLabel — le libellé court de la variante full suit l'état", () => {
  it('live et unknown disent « Shared », les autres nomment le problème', () => {
    expect(shareBadgeLabel('live').fallback).toBe('Shared');
    expect(shareBadgeLabel('unknown').fallback).toBe('Shared');
    expect(shareBadgeLabel('locked').key).toBe('notes.sharedBadge.labelLocked');
    expect(shareBadgeLabel('copyMissing').key).toBe('notes.sharedBadge.labelCopyMissing');
    expect(shareBadgeLabel('vaultGone').key).toBe('notes.sharedBadge.labelVaultGone');
  });
});

describe('shareBadgeChipLabel', () => {
  it('« Coffre <Nom> » quand le nom est connu', () => {
    const chip = shareBadgeChipLabel(entry('A', 'live', 'Équipe'));
    expect(chip.key).toBe('notes.sharedBadge.chip');
    expect(chip.params).toEqual({ vault: 'Équipe' });
  });

  it('« Coffre » nu quand le nom est inconnu (disparu ou pas encore chargé)', () => {
    const chip = shareBadgeChipLabel(entry('A', 'vaultGone', null));
    expect(chip.key).toBe('notes.sharedBadge.chipNoVault');
    expect(chip.params).toBeUndefined();
  });
});

describe('formatShareDate', () => {
  it("rend une chaîne vide pour un horodatage illisible plutôt qu'« Invalid Date »", () => {
    expect(formatShareDate('pas-une-date')).toBe('');
    expect(formatShareDate('')).toBe('');
  });

  it('rend une date lisible pour un ISO valide', () => {
    const s = formatShareDate('2026-08-20T10:00:00.000Z', 'en-US');
    expect(s).toMatch(/2026/);
    expect(s).not.toMatch(/Invalid/);
  });
});
