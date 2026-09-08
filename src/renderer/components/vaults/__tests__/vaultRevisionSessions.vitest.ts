/**
 * groupRevisionsBySession — le groupement CONSÉCUTIF de l'historique.
 *
 * La règle dure : jamais de réordonnancement — une session qui réapparaît
 * après une restauration intercalée fait DEUX groupes, avec deux clés React
 * distinctes.
 */

import { describe, it, expect } from 'vitest';
import { groupRevisionsBySession } from '../vaultRevisionSessions';
import type { VaultRevisionSummary } from '../../../../store/slices/vaultsSlice';

function rev(
  id: string,
  createdAt: number,
  editSession?: { id: string; at: number; participants: string[] } | unknown
): VaultRevisionSummary {
  return {
    id,
    itemVersion: 1,
    meta: { title: 'n', ...(editSession !== undefined ? { editSession } : {}) } as never,
    totalChunks: 1,
    sizeBytes: 10,
    createdAt,
    wrappedItemKey: 'W',
    wrappedUnderEpoch: 1,
    readable: true,
  };
}

const S = (id: string, participants: string[] = []) => ({ id, at: 0, participants });

describe('groupRevisionsBySession', () => {
  it('consécutives même id → UN groupe, participants dédupliqués, bornes exactes', () => {
    const groups = groupRevisionsBySession([
      rev('r3', 3000, S('sess-1', ['alice@x.com'])),
      rev('r2', 2000, S('sess-1', ['bob@x.com', 'alice@x.com'])),
      rev('r1', 1000),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].sessionId).toBe('sess-1');
    expect(groups[0].revisions.map((r) => r.id)).toEqual(['r3', 'r2']);
    expect(groups[0].participants.sort()).toEqual(['alice@x.com', 'bob@x.com']);
    expect(groups[0].newestAt).toBe(3000);
    expect(groups[0].oldestAt).toBe(2000);
    expect(groups[1].sessionId).toBeNull();
  });

  it('A,B,A → TROIS groupes (jamais réordonné), clés React distinctes', () => {
    const groups = groupRevisionsBySession([
      rev('r4', 4000, S('A')),
      rev('r3', 3000, S('B')),
      rev('r2', 2000, S('A')),
    ]);
    expect(groups.map((g) => g.sessionId)).toEqual(['A', 'B', 'A']);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });

  it('sans session → singleton (compat pré-fonctionnalité)', () => {
    const groups = groupRevisionsBySession([rev('r2', 2000), rev('r1', 1000)]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.sessionId === null && g.revisions.length === 1)).toBe(true);
  });

  it('editSession malformé (id non-string, objet cassé) → traité comme absent', () => {
    const groups = groupRevisionsBySession([
      rev('r2', 2000, { id: 42, at: 0, participants: [] }),
      rev('r1', 1000, 'pas un objet'),
    ]);
    expect(groups.every((g) => g.sessionId === null)).toBe(true);
  });

  it('l’union des participants est plafonnée à 8', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@x.com`);
    const groups = groupRevisionsBySession([
      rev('r2', 2000, S('sess', many(6))),
      rev('r1', 1000, S('sess', many(12))),
    ]);
    expect(groups[0].participants.length).toBe(8);
  });
});
