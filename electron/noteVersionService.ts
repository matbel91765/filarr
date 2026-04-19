/**
 * Note Version Service — Electron Main Process
 *
 * Persists per-note history snapshots on disk, encrypted with the
 * profile FEK via StorageService. Each note gets its own directory
 * under `note-versions/{noteId}/`; the directory holds:
 *
 *   - index.enc  — encrypted JSON array of NoteVersionMeta (newest first)
 *   - v_<id>.enc — one encrypted blob per version (content + plainText)
 *
 * The service is dedup-aware and interval-throttled via the pure logic
 * in `src/services/notes/noteVersionLogic.ts`. Snapshot creation is
 * fire-and-forget from the caller's perspective — a failure here must
 * never break the primary `notes:save` flow.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import log from 'electron-log';

import StorageService from './storageService';
import {
  applyRetention,
  buildVersionId,
  decideSnapshot,
  isValidVersionId,
  serializeForHash,
  type NoteSnapshotInput,
  type NoteVersionContent,
  type NoteVersionMeta,
} from './noteVersionLogic';

// ── Module state ────────────────────────────────────────────────────────────

/**
 * Hash + timestamp of the most recent snapshot we made, keyed by
 * `${profileId}:${noteId}`. Only held in memory — on restart the first
 * save will look "changed" and trigger a snapshot, which is fine
 * (re-snapshotting an unchanged note is caught by the index dedup
 * below, so worst case we waste a single disk write).
 */
const lastSnapshotByNote = new Map<string, { hash: string; atMs: number }>();

function snapshotKey(profileId: string, noteId: string): string {
  return `${profileId}:${noteId}`;
}

// ── Paths ───────────────────────────────────────────────────────────────────

const VERSIONS_DIRNAME = 'note-versions';
const INDEX_FILENAME = 'index.enc';

function versionsDirForProfile(profileDataDir: string): string {
  return path.join(profileDataDir, VERSIONS_DIRNAME);
}

function versionsDirForNote(profileDataDir: string, noteId: string): string {
  // Sanitize: note ids are UUID v4 in this codebase, so strict hex+hyphen.
  const safe = noteId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (safe !== noteId || safe.length === 0) {
    throw new Error('Invalid noteId');
  }
  return path.join(versionsDirForProfile(profileDataDir), safe);
}

function indexPath(profileDataDir: string, noteId: string): string {
  return path.join(versionsDirForNote(profileDataDir, noteId), INDEX_FILENAME);
}

function versionContentPath(
  profileDataDir: string,
  noteId: string,
  versionId: string
): string {
  if (!isValidVersionId(versionId)) {
    throw new Error('Invalid versionId');
  }
  return path.join(versionsDirForNote(profileDataDir, noteId), `${versionId}.enc`);
}

// ── Hashing ─────────────────────────────────────────────────────────────────

function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

// ── Index I/O ───────────────────────────────────────────────────────────────

async function readIndex(
  profileDataDir: string,
  noteId: string
): Promise<NoteVersionMeta[]> {
  try {
    const raw = await fs.readFile(indexPath(profileDataDir, noteId), 'utf-8');
    const decrypted = await StorageService.decrypt(raw);
    if (!Array.isArray(decrypted)) return [];
    return decrypted as NoteVersionMeta[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    log.warn(`[noteVersionService] readIndex failed for ${noteId}:`, err);
    return [];
  }
}

async function writeIndex(
  profileDataDir: string,
  noteId: string,
  versions: NoteVersionMeta[]
): Promise<void> {
  const dir = versionsDirForNote(profileDataDir, noteId);
  await fs.mkdir(dir, { recursive: true });

  const encrypted = await StorageService.encrypt(versions);
  const target = indexPath(profileDataDir, noteId);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, encrypted, 'utf-8');
  await fs.rename(tmp, target);
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface RecordResult {
  snapshotted: string[]; // noteIds that produced a new version
  skipped: Array<{ noteId: string; reason: string }>;
  pruned: number; // total count of pruned versions across all touched notes
}

/**
 * Walk a batch of notes (as delivered by the renderer) and snapshot
 * the ones whose content changed. Safe to call on every notes:save —
 * dedup and interval gate prevent runaway disk writes.
 *
 * This method is best-effort: individual note failures are logged
 * but never thrown, so a corrupt index for one note cannot block
 * snapshots for the others.
 */
export async function recordSnapshots(
  profileId: string,
  profileDataDir: string,
  notes: NoteSnapshotInput[]
): Promise<RecordResult> {
  const result: RecordResult = { snapshotted: [], skipped: [], pruned: 0 };
  const now = Date.now();

  for (const note of notes) {
    if (!note || !note.id || typeof note.content !== 'string') {
      result.skipped.push({ noteId: note?.id ?? '<missing>', reason: 'invalid-input' });
      continue;
    }

    const key = snapshotKey(profileId, note.id);
    const hash = sha256Hex(serializeForHash(note));

    // Lazy warm-up of the in-memory dedup cache. On the first save of a
    // note in a new app session, the cache is empty and a naive check
    // would treat every note as "first seen" — producing a duplicate
    // snapshot identical to the one already on disk. We peek at the
    // newest stored version first; its hash is the real predecessor.
    let previous = lastSnapshotByNote.get(key) ?? null;
    if (!previous) {
      const existing = await readIndex(profileDataDir, note.id);
      if (existing.length > 0) {
        const newest = existing[0]; // index is kept sorted newest-first
        previous = {
          hash: newest.contentHash,
          atMs: Date.parse(newest.savedAt),
        };
        lastSnapshotByNote.set(key, previous);
      }
    }

    const decision = decideSnapshot(previous, hash, now);
    if (!decision.snapshot) {
      result.skipped.push({ noteId: note.id, reason: decision.reason });
      continue;
    }

    try {
      const pruned = await snapshotOne(profileDataDir, note, hash, now);
      lastSnapshotByNote.set(key, { hash, atMs: now });
      result.snapshotted.push(note.id);
      result.pruned += pruned;
    } catch (err) {
      log.warn(
        `[noteVersionService] Snapshot failed for ${note.id}:`,
        (err as Error).message
      );
      result.skipped.push({ noteId: note.id, reason: 'write-failed' });
    }
  }

  return result;
}

/**
 * Create a single version on disk. Assumes the dedup/interval check
 * has already passed — returns the number of versions pruned by the
 * retention pass.
 */
async function snapshotOne(
  profileDataDir: string,
  note: NoteSnapshotInput,
  hash: string,
  nowMs: number
): Promise<number> {
  const versionId = buildVersionId(nowMs, crypto.randomBytes(4).toString('hex'));
  const savedAt = new Date(nowMs).toISOString();

  const meta: NoteVersionMeta = {
    id: versionId,
    savedAt,
    title: note.title,
    wordCount: note.wordCount,
    contentHash: hash,
  };

  const payload: NoteVersionContent = {
    ...meta,
    noteId: note.id,
    content: note.content,
    plainText: note.plainText,
  };

  const dir = versionsDirForNote(profileDataDir, note.id);
  await fs.mkdir(dir, { recursive: true });

  // Write the content blob first. If this fails we bail without
  // touching the index — callers only ever see consistent state.
  const encryptedContent = await StorageService.encrypt(payload);
  const contentPath = versionContentPath(profileDataDir, note.id, versionId);
  await fs.writeFile(contentPath, encryptedContent, 'utf-8');

  // Then update the index and prune.
  const existing = await readIndex(profileDataDir, note.id);
  const updated = [meta, ...existing];
  const { keep, discard } = applyRetention(updated, nowMs);

  await writeIndex(profileDataDir, note.id, keep);

  // Best-effort delete of pruned content blobs — never throws.
  for (const old of discard) {
    try {
      await fs.unlink(versionContentPath(profileDataDir, note.id, old.id));
    } catch {
      /* missing or inaccessible — ignore */
    }
  }

  return discard.length;
}

/**
 * List the stored versions for a note (newest first). Returns an empty
 * array if no versions exist — never throws on missing directory.
 */
export async function listVersions(
  profileDataDir: string,
  noteId: string
): Promise<NoteVersionMeta[]> {
  return readIndex(profileDataDir, noteId);
}

/**
 * Fetch a single version's content. Returns `null` if the version is
 * unknown or its content blob is missing (e.g. pruned).
 */
export async function getVersion(
  profileDataDir: string,
  noteId: string,
  versionId: string
): Promise<NoteVersionContent | null> {
  if (!isValidVersionId(versionId)) return null;

  try {
    const raw = await fs.readFile(
      versionContentPath(profileDataDir, noteId, versionId),
      'utf-8'
    );
    const decrypted = await StorageService.decrypt(raw);
    if (!decrypted || typeof decrypted !== 'object') return null;
    return decrypted as NoteVersionContent;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    log.warn(`[noteVersionService] getVersion failed for ${noteId}/${versionId}:`, err);
    return null;
  }
}

/**
 * Delete a single version. Removes both the index entry and the content
 * blob. Returns `true` if the version existed, `false` otherwise.
 */
export async function deleteVersion(
  profileDataDir: string,
  noteId: string,
  versionId: string
): Promise<boolean> {
  if (!isValidVersionId(versionId)) return false;

  const existing = await readIndex(profileDataDir, noteId);
  const next = existing.filter((v) => v.id !== versionId);
  if (next.length === existing.length) return false;

  await writeIndex(profileDataDir, noteId, next);
  try {
    await fs.unlink(versionContentPath(profileDataDir, noteId, versionId));
  } catch {
    /* already gone — the index update is still valuable */
  }

  return true;
}

/**
 * Wipe all versions for a note. Used when a note is permanently deleted.
 */
export async function clearVersions(
  profileDataDir: string,
  noteId: string
): Promise<void> {
  const dir = versionsDirForNote(profileDataDir, noteId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    log.warn(`[noteVersionService] clearVersions failed for ${noteId}:`, err);
  }
}

/**
 * Called when the active profile changes. Drops in-memory dedup state
 * so we don't leak cross-profile information.
 */
export function resetSnapshotState(): void {
  lastSnapshotByNote.clear();
}

// ── Testing hook ────────────────────────────────────────────────────────────

/**
 * Only exported for tests — do not call from production code.
 */
export const __internal = {
  snapshotKey,
  versionsDirForNote,
  versionContentPath,
  indexPath,
  lastSnapshotByNote,
};
