/**
 * Tests for note version history pure logic.
 *
 * The goal is to pin down the invariants that the stateful service
 * relies on: dedup decisions, retention behavior, id shape. Keeping
 * these in a separate file means the stateful service can be thin
 * and most of the risky logic stays unit-tested without mocks.
 */

import {
  applyRetention,
  buildVersionId,
  decideSnapshot,
  isValidVersionId,
  MAX_VERSIONS_PER_NOTE,
  MAX_VERSION_AGE_MS,
  MIN_SNAPSHOT_INTERVAL_MS,
  parseVersionId,
  serializeForHash,
  type NoteVersionMeta,
} from '../noteVersionLogic';

// ── Fixtures ─────────────────────────────────────────────────────────────

function meta(partial: Partial<NoteVersionMeta>): NoteVersionMeta {
  return {
    id: partial.id ?? 'v_20260418T100000000Z_aaaaaa',
    savedAt: partial.savedAt ?? '2026-04-18T10:00:00.000Z',
    title: partial.title ?? 'Note',
    wordCount: partial.wordCount ?? 10,
    contentHash: partial.contentHash ?? 'deadbeef',
  };
}

// ── serializeForHash ─────────────────────────────────────────────────────

describe('serializeForHash', () => {
  it('produces different strings when title changes', () => {
    const a = serializeForHash({ title: 'A', content: 'same' });
    const b = serializeForHash({ title: 'B', content: 'same' });
    expect(a).not.toBe(b);
  });

  it('produces different strings when content changes', () => {
    const a = serializeForHash({ title: 'T', content: 'foo' });
    const b = serializeForHash({ title: 'T', content: 'bar' });
    expect(a).not.toBe(b);
  });

  it('is not vulnerable to the classic concat ambiguity', () => {
    // Without a delimiter, ('ab','cd') and ('a','bcd') would collide.
    const a = serializeForHash({ title: 'ab', content: 'cd' });
    const b = serializeForHash({ title: 'a', content: 'bcd' });
    expect(a).not.toBe(b);
  });
});

// ── decideSnapshot ───────────────────────────────────────────────────────

describe('decideSnapshot', () => {
  it('snapshots the very first save', () => {
    const d = decideSnapshot(null, 'h1', 1000);
    expect(d).toEqual({ snapshot: true, reason: 'first' });
  });

  it('skips when the hash is identical', () => {
    const d = decideSnapshot({ hash: 'h1', atMs: 0 }, 'h1', 10_000_000);
    expect(d).toEqual({ snapshot: false, reason: 'unchanged' });
  });

  it('skips when the previous snapshot is too recent', () => {
    const now = 10_000;
    const d = decideSnapshot({ hash: 'h1', atMs: now - 1000 }, 'h2', now);
    expect(d).toEqual({ snapshot: false, reason: 'too-recent' });
  });

  it('snapshots once the interval has passed and the hash differs', () => {
    const now = MIN_SNAPSHOT_INTERVAL_MS + 10;
    const d = decideSnapshot({ hash: 'h1', atMs: 0 }, 'h2', now);
    expect(d).toEqual({ snapshot: true, reason: 'content-changed' });
  });

  it('respects a custom interval override', () => {
    const d1 = decideSnapshot({ hash: 'h1', atMs: 0 }, 'h2', 500, 1000);
    expect(d1.snapshot).toBe(false);
    const d2 = decideSnapshot({ hash: 'h1', atMs: 0 }, 'h2', 1500, 1000);
    expect(d2.snapshot).toBe(true);
  });

  it('"unchanged" dominates "too-recent"', () => {
    // If the content is identical AND the interval is short, we still
    // say unchanged — it's the more informative reason for the caller.
    const d = decideSnapshot({ hash: 'h1', atMs: 0 }, 'h1', 500);
    expect(d.reason).toBe('unchanged');
  });
});

// ── applyRetention ───────────────────────────────────────────────────────

describe('applyRetention', () => {
  const now = Date.parse('2026-04-18T10:00:00.000Z');

  it('keeps everything when under caps', () => {
    const versions = [
      meta({ id: 'v_a', savedAt: '2026-04-18T09:00:00.000Z' }),
      meta({ id: 'v_b', savedAt: '2026-04-17T09:00:00.000Z' }),
    ];
    const { keep, discard } = applyRetention(versions, now);
    expect(keep.map((v) => v.id)).toEqual(['v_a', 'v_b']);
    expect(discard).toEqual([]);
  });

  it('drops entries beyond the count cap, oldest first', () => {
    const versions = Array.from({ length: 5 }, (_, i) =>
      meta({
        id: `v_${i}`,
        // Descending timestamps → v_0 newest, v_4 oldest
        savedAt: new Date(now - i * 60_000).toISOString(),
      })
    );
    const { keep, discard } = applyRetention(versions, now, 3);
    expect(keep.map((v) => v.id)).toEqual(['v_0', 'v_1', 'v_2']);
    expect(discard.map((v) => v.id)).toEqual(['v_3', 'v_4']);
  });

  it('drops entries older than maxAgeMs even if under count', () => {
    const versions = [
      meta({ id: 'recent', savedAt: new Date(now - 1000).toISOString() }),
      meta({ id: 'old', savedAt: new Date(now - 2000).toISOString() }),
    ];
    const { keep, discard } = applyRetention(versions, now, 100, 1500);
    expect(keep.map((v) => v.id)).toEqual(['recent']);
    expect(discard.map((v) => v.id)).toEqual(['old']);
  });

  it('works with an unsorted input', () => {
    const versions = [
      meta({ id: 'mid', savedAt: '2026-04-18T08:00:00.000Z' }),
      meta({ id: 'new', savedAt: '2026-04-18T09:00:00.000Z' }),
      meta({ id: 'old', savedAt: '2026-04-18T07:00:00.000Z' }),
    ];
    const { keep } = applyRetention(versions, now);
    expect(keep.map((v) => v.id)).toEqual(['new', 'mid', 'old']);
  });

  it('uses default caps when none provided', () => {
    // Build MAX_VERSIONS_PER_NOTE + 5 recent versions, all within age window.
    const versions = Array.from({ length: MAX_VERSIONS_PER_NOTE + 5 }, (_, i) =>
      meta({ id: `v_${i}`, savedAt: new Date(now - i * 60_000).toISOString() })
    );
    const { keep, discard } = applyRetention(versions, now);
    expect(keep).toHaveLength(MAX_VERSIONS_PER_NOTE);
    expect(discard).toHaveLength(5);
  });

  it('prunes any version past MAX_VERSION_AGE_MS', () => {
    const versions = [
      meta({ id: 'fresh', savedAt: new Date(now - 1000).toISOString() }),
      meta({
        id: 'ancient',
        savedAt: new Date(now - MAX_VERSION_AGE_MS - 1000).toISOString(),
      }),
    ];
    const { keep, discard } = applyRetention(versions, now);
    expect(keep.map((v) => v.id)).toEqual(['fresh']);
    expect(discard.map((v) => v.id)).toEqual(['ancient']);
  });
});

// ── buildVersionId / parseVersionId ──────────────────────────────────────

describe('buildVersionId', () => {
  it('produces the expected shape', () => {
    const id = buildVersionId(Date.parse('2026-04-18T10:05:23.123Z'), 'a1b2c3d4');
    expect(id).toBe('v_20260418T100523123Z_a1b2c3');
  });

  it('truncates the random tail to 6 chars', () => {
    const id = buildVersionId(0, 'ffffffffffffffff');
    expect(id.endsWith('_ffffff')).toBe(true);
  });

  it('is monotonic when sorted lexicographically', () => {
    const earlier = buildVersionId(Date.parse('2026-04-18T10:00:00.000Z'), 'aaaaaa');
    const later = buildVersionId(Date.parse('2026-04-18T10:00:00.001Z'), 'aaaaaa');
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});

describe('parseVersionId', () => {
  it('round-trips with buildVersionId', () => {
    const at = Date.parse('2026-04-18T10:00:00.000Z');
    const id = buildVersionId(at, 'abcdef');
    expect(parseVersionId(id)).toEqual({ atMs: at });
  });

  it('rejects malformed ids', () => {
    expect(parseVersionId('not-a-version')).toBeNull();
    expect(parseVersionId('v_20260418T_abcdef')).toBeNull();
    expect(parseVersionId('../etc/passwd')).toBeNull();
  });
});

describe('isValidVersionId', () => {
  it('accepts valid ids', () => {
    const id = buildVersionId(Date.now(), '123abc');
    expect(isValidVersionId(id)).toBe(true);
  });

  it('rejects path traversal attempts', () => {
    expect(isValidVersionId('../../../etc/passwd')).toBe(false);
    expect(isValidVersionId('..\\..\\windows\\system32')).toBe(false);
    expect(isValidVersionId('v_20260418T100000000Z_abc/../evil')).toBe(false);
  });

  it('rejects empty and whitespace strings', () => {
    expect(isValidVersionId('')).toBe(false);
    expect(isValidVersionId('   ')).toBe(false);
  });
});
