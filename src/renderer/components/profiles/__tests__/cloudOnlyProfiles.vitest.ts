/**
 * cloudOnlyProfiles.vitest.ts — La sélection des profils « dans le nuage
 * seulement », et le câblage du bouton qui les supprime.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloudOnlyProfiles, megabytes } from '../cloudOnlyProfiles';

describe('cloudOnlyProfiles', () => {
  const rows = [
    {
      profileId: 'aaaaaaaa-local',
      manifestVersion: 12,
      storageUsed: 100,
      lastSyncAt: '2026-09-06T00:00:00Z',
    },
    {
      profileId: 'bbbbbbbb-fantome-recent',
      manifestVersion: 3,
      storageUsed: 1028473,
      lastSyncAt: '2026-08-09T17:16:11Z',
    },
    {
      profileId: 'cccccccc-fantome-vieux',
      manifestVersion: 5,
      storageUsed: 105575,
      lastSyncAt: '2026-03-22T22:20:51Z',
    },
    {
      profileId: 'dddddddd-supprime',
      manifestVersion: 0,
      storageUsed: 0,
      lastSyncAt: '2026-08-30T20:16:17Z',
      deletedAt: '2026-08-30T23:43:04Z',
    },
    { profileId: 'eeeeeeee-jamais', manifestVersion: 0, storageUsed: 0, lastSyncAt: null },
  ];

  it('exclut les profils locaux et les pierres tombales, trie du plus récent au jamais synchronisé', () => {
    const out = cloudOnlyProfiles(rows, ['aaaaaaaa-local']);
    expect(out.map((r) => r.profileId)).toEqual([
      'bbbbbbbb-fantome-recent',
      'cccccccc-fantome-vieux',
      'eeeeeeee-jamais',
    ]);
    expect(out[0].shortId).toBe('bbbbbbbb');
    expect(out[0].storageUsed).toBe(1028473);
    expect(out[2].lastSyncAt).toBeNull();
    expect(out[2].storageUsed).toBe(0);
  });

  it('nuage injoignable (null) → rien à proposer ; tout local → rien', () => {
    expect(cloudOnlyProfiles(null, [])).toEqual([]);
    expect(cloudOnlyProfiles(undefined, [])).toEqual([]);
    expect(cloudOnlyProfiles(rows.slice(0, 1), ['aaaaaaaa-local'])).toEqual([]);
  });

  it('une taille absente ou négative vaut zéro, et les mégaoctets ont une décimale', () => {
    const out = cloudOnlyProfiles([{ profileId: 'ffffffff-sans-taille', storageUsed: -5 }], []);
    expect(out[0].storageUsed).toBe(0);
    expect(megabytes(1028473)).toBe('1.0');
    expect(megabytes(0)).toBe('0.0');
  });
});

describe('câblage — la fenêtre Gérer les profils propose la suppression du nuage', () => {
  const ROOT = process.cwd();
  const modal = readFileSync(
    join(ROOT, 'src', 'renderer', 'components', 'profiles', 'ManageProfilesModal.tsx'),
    'utf8'
  );

  it('liste les profils du nuage seulement et appelle sync:deleteCloudProfile sur confirmation', () => {
    expect(modal).toContain('cloudOnlyProfiles(');
    expect(modal).toContain("invoke('sync:deleteCloudProfile', cloudDeletingId)");
    expect(modal).toContain("t('profiles.deleteFromCloudConfirm')");
    expect(modal).toContain("t('profiles.deleteFromCloud')");
  });

  it('les deux langues portent toutes les clés', () => {
    for (const lang of ['fr', 'en']) {
      const json = JSON.parse(
        readFileSync(join(ROOT, 'src', 'i18n', 'locales', lang, 'translation.json'), 'utf8')
      ) as { profiles: Record<string, string> };
      for (const key of [
        'cloudOnlyTitle',
        'cloudOnlyHint',
        'cloudOnlyLastSync',
        'cloudOnlyNeverSynced',
        'cloudOnlySize',
        'deleteFromCloud',
        'deleteFromCloudConfirm',
        'deleteFromCloudError',
      ]) {
        expect(typeof json.profiles[key], `${lang}.profiles.${key}`).toBe('string');
      }
    }
  });
});
