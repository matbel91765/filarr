/**
 * Pure logic for note version history — CANONICAL COPY.
 *
 * A byte-for-byte duplicate lives in `electron/noteVersionLogic.ts`
 * because electron and renderer can't share source files without
 * breaking the `dist-electron/main.js` layout. Edit both together —
 * the tests in this folder pin the invariants for both copies.
 *
 * Contains ONLY pure functions: no fs, no IPC, no Electron, no crypto
 * that requires Node APIs. This keeps the rules (dedup, retention,
 * timestamps, ids) testable in isolation. The stateful service
 * composes these primitives in `electron/noteVersionService.ts`.
 *
 * Dedup strategy:
 *   - Each snapshot carries a content hash (SHA-256 of title + content).
 *   - A new snapshot is skipped when either (a) the content hash matches
 *     the previous snapshot (no real change) or (b) the previous snapshot
 *     is more recent than MIN_SNAPSHOT_INTERVAL_MS (avoid flooding on
 *     rapid auto-save).
 *
 * Retention strategy:
 *   - Keep at most MAX_VERSIONS_PER_NOTE versions.
 *   - Drop anything older than MAX_VERSION_AGE_MS even if count is low —
 *     avoids accidentally resurrecting a 3-month-old draft after a long
 *     quiet period.
 */

// ── Constants ───────────────────────────────────────────────────────────────

/** Minimum gap between two snapshots for the same note, in ms. */
export const MIN_SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/** Hard cap on the number of versions kept per note. */
export const MAX_VERSIONS_PER_NOTE = 50;

/** Age cap — versions older than this are pruned regardless of count. */
export const MAX_VERSION_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Lightweight metadata for a single version — cheap to load, used for
 * the version list UI. Never contains note content.
 */
export interface NoteVersionMeta {
  /** Opaque stable id (also used as filename stem). */
  id: string;
  /** ISO-8601 timestamp of when the snapshot was taken. */
  savedAt: string;
  /** Title at the time of the snapshot — shown in the list. */
  title: string;
  /** Word count at the time of the snapshot. */
  wordCount: number;
  /** Full SHA-256 hex of the content used to dedup back-to-back saves. */
  contentHash: string;
}

/**
 * Full contents of a version — what a restore/diff operation consumes.
 * Extends the metadata so the UI can show title and word count alongside.
 */
export interface NoteVersionContent extends NoteVersionMeta {
  noteId: string;
  /** TipTap JSON serialized as a string, matching `Note.content`. */
  content: string;
  /** Plain text used for search / diff, matching `Note.plainText`. */
  plainText: string;
}

/** Subset of Note fields needed to compute a version snapshot. */
export interface NoteSnapshotInput {
  id: string;
  title: string;
  content: string;
  plainText: string;
  wordCount: number;
}

/** Result of the dedup/interval decision. */
export type SnapshotDecision =
  | { snapshot: true; reason: 'first' | 'content-changed' }
  | { snapshot: false; reason: 'unchanged' | 'too-recent' };

// ── Hashing ─────────────────────────────────────────────────────────────────

/**
 * Serialize the fields that matter for dedup into a stable string.
 * Kept separate from the hashing call so tests can assert the input
 * without needing a real SHA implementation.
 */
export function serializeForHash(note: Pick<NoteSnapshotInput, 'title' | 'content'>): string {
  // Use a delimiter that cannot appear in a JSON-encoded TipTap doc so
  // collisions between title/content boundaries are structurally impossible.
  return `${note.title}\u0000${note.content}`;
}

// ── Decision logic ──────────────────────────────────────────────────────────

/**
 * Decide whether a new snapshot should be created given the previous one.
 *
 * @param previous       Previous snapshot hash and timestamp, or `null`
 *                       if the note has never been snapshotted.
 * @param newHash        Hex SHA-256 of the current content (computed by
 *                       the caller with the available crypto primitive).
 * @param nowMs          Current time in ms since epoch.
 * @param minIntervalMs  Minimum gap. Defaults to `MIN_SNAPSHOT_INTERVAL_MS`.
 */
export function decideSnapshot(
  previous: { hash: string; atMs: number } | null,
  newHash: string,
  nowMs: number,
  minIntervalMs: number = MIN_SNAPSHOT_INTERVAL_MS
): SnapshotDecision {
  if (!previous) {
    return { snapshot: true, reason: 'first' };
  }
  if (previous.hash === newHash) {
    return { snapshot: false, reason: 'unchanged' };
  }
  if (nowMs - previous.atMs < minIntervalMs) {
    return { snapshot: false, reason: 'too-recent' };
  }
  return { snapshot: true, reason: 'content-changed' };
}

// ── Retention ───────────────────────────────────────────────────────────────

export interface RetentionOutcome {
  /** Versions to keep, newest first. */
  keep: NoteVersionMeta[];
  /** Versions to delete from disk. */
  discard: NoteVersionMeta[];
}

/**
 * Apply retention rules to an ordered (newest-first) list of versions.
 * Pure — does not touch disk. The caller is responsible for deleting
 * the files listed in `discard`.
 */
export function applyRetention(
  versions: NoteVersionMeta[],
  nowMs: number,
  maxCount: number = MAX_VERSIONS_PER_NOTE,
  maxAgeMs: number = MAX_VERSION_AGE_MS
): RetentionOutcome {
  // Defensive sort: the caller may hand us an unsorted list.
  const sorted = [...versions].sort((a, b) => b.savedAt.localeCompare(a.savedAt));

  const keep: NoteVersionMeta[] = [];
  const discard: NoteVersionMeta[] = [];

  for (const v of sorted) {
    const ageMs = nowMs - Date.parse(v.savedAt);
    const countFull = keep.length >= maxCount;
    const tooOld = ageMs > maxAgeMs;

    if (countFull || tooOld) {
      discard.push(v);
    } else {
      keep.push(v);
    }
  }

  return { keep, discard };
}

// ── IDs / filenames ─────────────────────────────────────────────────────────

/**
 * Build a version id that sorts lexicographically by time and embeds a
 * random tail to avoid collisions when two snapshots land in the same
 * millisecond (rare but possible).
 *
 * Example: `v_20260418T100523123Z_a1b2c3`.
 */
export function buildVersionId(atMs: number, randomHex: string): string {
  const iso = new Date(atMs).toISOString();
  // Strip punctuation so the id is filesystem-safe.
  const stamp = iso.replace(/[-:.]/g, '').replace(/Z$/, 'Z');
  // Truncate random to 6 chars — 16M combinations per millisecond is enough.
  const tail = randomHex.slice(0, 6);
  return `v_${stamp}_${tail}`;
}

/** Reverse of `buildVersionId`. Returns `null` on malformed input. */
export function parseVersionId(id: string): { atMs: number } | null {
  const match = /^v_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z_[0-9a-f]{1,}$/.exec(id);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, ms] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return { atMs: parsed };
}

/**
 * Validate that a string looks like a version id we generated. Used to
 * reject IPC arguments before they reach `fs.*` calls — prevents path
 * traversal if a compromised renderer sends a crafted id.
 */
export function isValidVersionId(id: string): boolean {
  return parseVersionId(id) !== null;
}
