/**
 * LE PLAN DE MIGRATION.
 *
 * Ce que ces tests protègent : la FEK est GLOBALE à l'appareil. Un plan qui
 * couvrirait un seul profil puis autoriserait la bascule casserait tous les
 * autres d'un coup — une destruction déguisée en succès. L'ordre, lui, décide
 * de ce qui est sauvé quand l'utilisateur ferme l'application au bout de deux
 * minutes.
 */

import {
  acceptsAbandonConfirmation,
  buildPublishPlan,
  verifyProfileCoverage,
} from '../../../../electron/publish/plan';
import type { PublishItem, PublishLocalProfile } from '../../../../electron/publish/types';
import { describe, it, expect } from 'vitest';

const NOW = '2026-08-11T10:00:00.000Z';

function profile(
  id: string,
  order: number,
  extra: Partial<PublishLocalProfile> = {}
): PublishLocalProfile {
  return {
    id,
    name: id,
    order,
    isDefault: false,
    createdAt: NOW,
    ...extra,
  };
}

function blob(
  profileId: string,
  key: string,
  size: number,
  extra: Partial<PublishItem> = {}
): PublishItem {
  return {
    key,
    kind: 'blob',
    localProfileId: profileId,
    localPath: `folder-1/${key}.bin`,
    size,
    updatedAt: NOW,
    keyClass: 'active',
    folderId: 'folder-1',
    ...extra,
  };
}

function meta(profileId: string, folderId: string): PublishItem {
  return {
    key: `meta:${folderId}`,
    kind: 'folder-meta',
    localProfileId: profileId,
    localPath: `${folderId}/metadata.json`,
    size: 400,
    updatedAt: NOW,
    keyClass: 'machine',
    folderId,
  };
}

function notes(profileId: string): PublishItem {
  return {
    key: 'meta:notes',
    kind: 'notes-bundle',
    localProfileId: profileId,
    localPath: 'notes.enc',
    size: 900,
    updatedAt: NOW,
    keyClass: 'machine',
  };
}

const TARGETS = {
  p1: { targetProfileId: 'p1', targetName: 'Mathis (2)' },
  p2: { targetProfileId: 'target-2', targetName: 'Perso' },
};

describe('buildPublishPlan — ordre canonique', () => {
  it('E5/E6 — folder-meta, puis notes, puis blobs par TAILLE CROISSANTE', () => {
    const plan = buildPublishPlan({
      profiles: [profile('p1', 0)],
      items: [
        blob('p1', 'bbb', 9_000_000),
        blob('p1', 'aaa', 12),
        notes('p1'),
        meta('p1', 'folder-b'),
        meta('p1', 'folder-a'),
        blob('p1', 'ccc', 5_000),
      ],
      abandonedProfileIds: [],
      targets: { p1: TARGETS.p1 },
      maxItemBytes: null,
      now: NOW,
    });

    expect(plan.order.map((i) => i.key)).toEqual([
      'meta:folder-a',
      'meta:folder-b',
      'meta:notes',
      'aaa',
      'ccc',
      'bbb',
    ]);
  });

  it('E5 — deux constructions successives donnent EXACTEMENT le même ordre', () => {
    const items = [
      blob('p2', 'zz', 10),
      blob('p1', 'yy', 10),
      blob('p1', 'xx', 10),
      meta('p2', 'f9'),
    ];
    const input = {
      profiles: [profile('p2', 1), profile('p1', 0)],
      items,
      abandonedProfileIds: [],
      targets: TARGETS,
      maxItemBytes: null,
      now: NOW,
    };
    const a = buildPublishPlan(input).order.map((i) => i.key);
    const b = buildPublishPlan({ ...input, items: [...items].reverse() }).order.map((i) => i.key);
    expect(a).toEqual(b);
    // Profils par `order` croissant : p1 avant p2, quel que soit l'ordre d'arrivée.
    expect(a[0]).toBe('xx');
  });
});

describe('buildPublishPlan — compteurs et classement', () => {
  it('E4 — totalItems ne compte QUE les profils non abandonnés', () => {
    const plan = buildPublishPlan({
      profiles: [profile('p1', 0), profile('p2', 1, { name: 'Perso' })],
      items: [blob('p1', 'a', 100), blob('p2', 'b', 200), blob('p2', 'c', 300)],
      abandonedProfileIds: ['p2'],
      targets: { p1: TARGETS.p1 },
      maxItemBytes: null,
      now: NOW,
    });

    expect(plan.counters.totalItems).toBe(1);
    expect(plan.counters.totalBytes).toBe(100);
    // Le profil abandonné reste NOMMÉ et CHIFFRÉ — jamais « et le reste ».
    expect(plan.abandonedProfiles).toEqual([
      {
        localProfileId: 'p2',
        name: 'Perso',
        itemCount: 2,
        byteCount: 500,
        acceptedAt: NOW,
      },
    ]);
  });

  it('E10 — un blob qu aucune clé n ouvre est `damaged`, jamais « à migrer »', () => {
    const plan = buildPublishPlan({
      profiles: [profile('p1', 0)],
      items: [blob('p1', 'ok', 10), blob('p1', 'lost', 20, { keyClass: 'none' })],
      abandonedProfileIds: [],
      targets: { p1: TARGETS.p1 },
      maxItemBytes: null,
      now: NOW,
    });

    expect(plan.order.map((i) => i.key)).toEqual(['ok']);
    expect(plan.damagedAtScan.map((i) => i.key)).toEqual(['lost']);
    // Il est compté : le total ne doit pas mentir sur ce qui reste à faire.
    expect(plan.counters.totalItems).toBe(2);
  });

  it('E9 — un blob sous la clé MACHINE reste publiable (il n est simplement pas menacé)', () => {
    const plan = buildPublishPlan({
      profiles: [profile('p1', 0)],
      items: [blob('p1', 'machine', 10, { keyClass: 'machine' })],
      abandonedProfileIds: [],
      targets: { p1: TARGETS.p1 },
      maxItemBytes: null,
      now: NOW,
    });
    expect(plan.order.map((i) => i.key)).toEqual(['machine']);
  });

  it('F7 — au-delà du plafond, un blob devient un BLOCAGE nommé, jamais un abandon', () => {
    const plan = buildPublishPlan({
      profiles: [profile('p1', 0)],
      items: [
        blob('p1', 'huge', 2_147_483_648, { localPath: 'folder-1/film.mkv' }),
        blob('p1', 'small', 10),
      ],
      abandonedProfileIds: [],
      targets: { p1: TARGETS.p1 },
      maxItemBytes: 64 * 1024 * 1024,
      now: NOW,
    });

    expect(plan.blockers).toEqual([
      {
        kind: 'oversize',
        localProfileId: 'p1',
        itemKey: 'huge',
        name: 'film.mkv',
        size: 2_147_483_648,
      },
    ]);
    expect(plan.order.map((i) => i.key)).toEqual(['small']);
  });

  it('E2 — un profil déclaré SANS aucun élément est inventorié à zéro et ne bloque rien', () => {
    const plan = buildPublishPlan({
      profiles: [profile('p1', 0), profile('empty', 1)],
      items: [blob('p1', 'a', 10)],
      abandonedProfileIds: [],
      targets: { ...TARGETS, empty: { targetProfileId: 'empty', targetName: 'Vide' } },
      maxItemBytes: null,
      now: NOW,
    });
    const target = plan.targetProfiles.find((t) => t.localProfileId === 'empty');
    expect(target?.itemCount).toBe(0);
    expect(verifyProfileCoverage([profile('p1', 0), profile('empty', 1)], plan).ok).toBe(true);
  });

  it('E1 — un profil ORPHELIN (sur le disque, absent du manifeste) est inventorié, pas ignoré', () => {
    const orphan = profile('a3f9beef', 10_000, { name: '', orphan: true });
    const plan = buildPublishPlan({
      profiles: [profile('p1', 0), orphan],
      items: [blob('p1', 'a', 10), blob('a3f9beef', 'orph', 12_000)],
      abandonedProfileIds: [],
      targets: {
        ...TARGETS,
        a3f9beef: { targetProfileId: 'a3f9beef', targetName: 'Coffre retrouvé' },
      },
      maxItemBytes: null,
      now: NOW,
    });
    expect(plan.targetProfiles.map((t) => t.localProfileId)).toContain('a3f9beef');
    expect(plan.order.map((i) => i.key)).toContain('orph');
  });

  it('R2 — un profil ni couvert ni abandonné fait ÉCHOUER la construction du plan', () => {
    expect(() =>
      buildPublishPlan({
        profiles: [profile('p1', 0), profile('oublié', 1)],
        items: [],
        abandonedProfileIds: [],
        targets: { p1: TARGETS.p1 },
        maxItemBytes: null,
        now: NOW,
      })
    ).toThrow(/oublié/);
  });
});

describe('verifyProfileCoverage — le verdict qui garde [R2]', () => {
  it('refuse et NOMME les profils non traités', () => {
    const verdict = verifyProfileCoverage([profile('p1', 0), profile('p2', 1), profile('p3', 2)], {
      targetProfiles: [
        {
          localProfileId: 'p1',
          targetProfileId: 'p1',
          targetName: 'Mathis (2)',
          itemCount: 1,
          byteCount: 1,
          notesBundle: false,
          relocated: false,
        },
      ],
      abandonedProfiles: [
        { localProfileId: 'p2', name: 'Perso', itemCount: 2, byteCount: 2, acceptedAt: NOW },
      ],
    });
    expect(verdict).toEqual({ ok: false, uncoveredProfileIds: ['p3'] });
  });
});

describe('acceptsAbandonConfirmation', () => {
  it('I8 — l abandon exige le nom EXACT du profil, retapé', () => {
    expect(acceptsAbandonConfirmation('Perso', 'Perso')).toBe(true);
    expect(acceptsAbandonConfirmation('Perso', '  Perso  ')).toBe(true);
    expect(acceptsAbandonConfirmation('Perso', 'perso')).toBe(false);
    expect(acceptsAbandonConfirmation('Perso', 'Pers')).toBe(false);
  });
});
