/**
 * LA PREUVE AVANT BASCULE.
 *
 * « On n'abandonne l'ancienne clé qu'après avoir CONSTATÉ — pas supposé — que
 * chaque élément est monté et relisible sous la nouvelle. » L'échantillon est
 * le compromis qui rend ce constat abordable ; ces tests verrouillent sa
 * composition exacte, sa reproductibilité, et le fait qu'il ne rogne jamais ce
 * dont la perte serait silencieuse.
 */

import {
  buildVerifyPlan,
  shouldDefaultToFullVerify,
  VERIFY_MAX_ITEMS,
  VERIFY_SMALL_BLOB_CAP,
} from '../../../../electron/publish/verifyPlan';
import type { PublishItem } from '../../../../electron/publish/types';
import { describe, it, expect } from 'vitest';

const NOW = '2026-08-11T10:00:00.000Z';

function item(key: string, size: number, extra: Partial<PublishItem> = {}): PublishItem {
  return {
    key,
    kind: 'blob',
    localProfileId: 'p1',
    localPath: `f/${key}`,
    size,
    updatedAt: NOW,
    keyClass: 'active',
    ...extra,
  };
}

function metaItem(key: string): PublishItem {
  return {
    key,
    kind: key === 'meta:notes' ? 'notes-bundle' : 'folder-meta',
    localProfileId: 'p1',
    localPath: key,
    size: 500,
    updatedAt: NOW,
    keyClass: 'machine',
  };
}

/** 300 blobs de tailles variées, plus trois `meta:` — un coffre plausible. */
function corpus(): PublishItem[] {
  const items: PublishItem[] = [
    metaItem('meta:folder-a'),
    metaItem('meta:folder-b'),
    metaItem('meta:notes'),
  ];
  for (let i = 0; i < 300; i++) {
    items.push(
      item(`blob-${String(i).padStart(3, '0')}`, i < 50 ? 1000 : 5 * 1024 * 1024, {
        updatedAt: i === 137 ? '2019-01-01T00:00:00.000Z' : NOW,
      })
    );
  }
  items.push(item('blob-huge', 40 * 1024 * 1024));
  return items;
}

describe('buildVerifyPlan', () => {
  it('G5 — l échantillon contient TOUTES les `meta:`, le plus gros, le plus ancien et ≤ 20 petits', () => {
    const items = corpus();
    const plan = buildVerifyPlan({ publishedItems: items, migrationId: 'mig-1', full: false });
    const set = new Set(plan);

    // (1) jamais rognées : leur perte serait silencieuse.
    expect(set.has('meta:folder-a')).toBe(true);
    expect(set.has('meta:folder-b')).toBe(true);
    expect(set.has('meta:notes')).toBe(true);
    // (3) le plus volumineux du profil.
    expect(set.has('blob-huge')).toBe(true);
    // (4) le plus ancien.
    expect(set.has('blob-137')).toBe(true);
    // (2) au plus 20 petits (≤ 1 Mio).
    const smalls = plan.filter((k) => k.startsWith('blob-') && Number(k.slice(5)) < 50);
    expect(smalls.length).toBeLessThanOrEqual(VERIFY_SMALL_BLOB_CAP);
  });

  it('G6 — même migrationId ⇒ MÊME plan ; migrationId différent ⇒ plan différent', () => {
    const items = corpus();
    const a = buildVerifyPlan({ publishedItems: items, migrationId: 'mig-1', full: false });
    const b = buildVerifyPlan({ publishedItems: items, migrationId: 'mig-1', full: false });
    const c = buildVerifyPlan({ publishedItems: items, migrationId: 'mig-2', full: false });

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('G7 — le plafond de 200 éléments s applique SANS rogner les `meta:`', () => {
    const items: PublishItem[] = [];
    for (let i = 0; i < 40; i++) items.push(metaItem(`meta:folder-${i}`));
    for (let i = 0; i < 5000; i++) items.push(item(`blob-${String(i).padStart(4, '0')}`, 2048));

    const plan = buildVerifyPlan({ publishedItems: items, migrationId: 'mig-x', full: false });
    expect(plan.length).toBeLessThanOrEqual(VERIFY_MAX_ITEMS + 40);
    for (let i = 0; i < 40; i++) {
      expect(plan).toContain(`meta:folder-${i}`);
    }
  });

  it('G7 — le plafond de 2 Gio écarte un blob que le budget ne permet pas', () => {
    const items = [
      metaItem('meta:folder-a'),
      item('petit', 1024),
      item('geant', 3 * 1024 * 1024 * 1024),
    ];
    const plan = buildVerifyPlan({ publishedItems: items, migrationId: 'mig-y', full: false });
    expect(plan).toContain('meta:folder-a');
    expect(plan).toContain('petit');
    expect(plan).not.toContain('geant');
  });

  it('G10 — seuls les éléments RÉELLEMENT montés entrent au plan (on ne prouve pas l illisible)', () => {
    // L'appelant ne passe que les `done` : un `damaged` n'a pas de représentant
    // côté compte, il ne peut donc pas être « vérifié ».
    const plan = buildVerifyPlan({
      publishedItems: [item('monté', 10)],
      migrationId: 'mig-z',
      full: false,
    });
    expect(plan).toEqual(['monté']);
  });

  it('palier 3 — l échantillon vaut 100 %, dans l ordre canonique', () => {
    const items = [metaItem('meta:folder-a'), item('a', 10), item('b', 20)];
    expect(buildVerifyPlan({ publishedItems: items, migrationId: 'm', full: true })).toEqual([
      'meta:folder-a',
      'a',
      'b',
    ]);
  });
});

describe('shouldDefaultToFullVerify', () => {
  it('G9 — sous 200 Mio, la preuve complète devient le défaut (le coût a disparu)', () => {
    expect(shouldDefaultToFullVerify(150 * 1024 * 1024)).toBe(true);
    expect(shouldDefaultToFullVerify(7.4 * 1024 * 1024 * 1024)).toBe(false);
  });
});
