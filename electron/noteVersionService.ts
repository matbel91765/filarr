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
import { secureDeleteFile, secureDeleteDir } from './secureDelete';
import { DIR_VERSIONS_NOTES } from './profileDirs';
import {
  applyRetention,
  buildVersionId,
  decideSnapshot,
  effectiveRetentionDays,
  isValidVersionId,
  serializeForHash,
  MAX_VERSION_AGE_MS,
  type NoteSnapshotInput,
  type NoteVersionContent,
  type NoteVersionMeta,
} from './noteVersionLogic';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Personal default version-retention window (days), overridden by an org policy (E9-2). */
const DEFAULT_VERSION_RETENTION_DAYS = MAX_VERSION_AGE_MS / DAY_MS;

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

/**
 * Serializes index writes per note.
 *
 * `recordSnapshots` is fire-and-forget from `notes:save`, so several passes
 * can overlap — during a bulk delete the debounced auto-save fires again
 * while the previous pass is still working. Two overlapping passes used to
 * write the same `index.enc.tmp` and then both rename it: the first rename
 * consumed the file, the second failed with ENOENT (or EPERM on Windows,
 * when the loser still held the handle). Worse than the noise, the
 * read-modify-write of the index was racy, so one pass's version entry could
 * be silently dropped.
 */
const indexLocks = new Map<string, Promise<void>>();

function withIndexLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = indexLocks.get(lockKey) ?? Promise.resolve();
  // Run on both settle paths: a failed predecessor must not wedge the chain.
  const run = previous.then(fn, fn);
  const tail: Promise<void> = run.then(
    () => {
      if (indexLocks.get(lockKey) === tail) indexLocks.delete(lockKey);
    },
    () => {
      if (indexLocks.get(lockKey) === tail) indexLocks.delete(lockKey);
    }
  );
  indexLocks.set(lockKey, tail);
  return run;
}

/**
 * In-flight snapshot pass per profile, plus the arguments of a pass that was
 * requested while one was already running.
 *
 * Every `notes:save` asks for a full pass over every note. Without this,
 * a burst of saves stacks N concurrent passes that all walk the same notes
 * and fight over the same files. We run one at a time and coalesce the
 * requests that arrive meanwhile into a single follow-up pass, so the last
 * state always gets snapshotted without ever running two passes at once.
 */
interface PendingPass {
  profileDataDir: string;
  notes: NoteSnapshotInput[];
  versionRetentionDays: number | null;
}
const passInFlight = new Map<string, Promise<RecordResult>>();
const passQueued = new Map<string, PendingPass>();

// ── Paths ───────────────────────────────────────────────────────────────────

// Le nom vient du module qui tient AUSSI la liste des répertoires que le
// recensement des dossiers doit ignorer : les deux ne peuvent plus diverger.
const VERSIONS_DIRNAME = DIR_VERSIONS_NOTES;
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

/**
 * Nombre de notes hachées d'affilée avant de rendre la main au processus
 * principal.
 *
 * Le cas ORDINAIRE de `runSnapshotPass` ne prend aucun `await` : le manifeste
 * répond pour chaque note et la décision est « inchangée ». La boucle devient
 * alors un bloc synchrone qui concatène puis hache le contenu de TOUTES les
 * notes — sur un coffre de plusieurs dizaines de Mo (une image collée en
 * data-URL suffit), c'est le processus principal figé d'un seul tenant, à
 * chaque sauvegarde automatique. Pendant ce temps, plus une seule IPC ne
 * répond : le rendu paraît gelé pile après avoir lâché une note collante.
 *
 * On découpe donc en tranches. Le travail total est le même ; ce qui change,
 * c'est qu'il redevient interruptible.
 */
const HASH_YIELD_EVERY = 25;

/** Rend la main à la boucle d'événements (macro-tâche, donc après les IPC). */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
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
  // Unique temp name: a shared `index.enc.tmp` let two concurrent writers
  // clobber each other's staging file, so whichever renamed second hit
  // ENOENT (the file was already consumed) or EPERM (the other handle was
  // still open). The suffix makes each writer's staging file its own.
  const tmp = `${target}.${process.pid.toString(36)}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, encrypted, 'utf-8');
    await fs.rename(tmp, target);
  } catch (err) {
    // Never leave a staging file behind on a failed write.
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

// ── Hash manifest ───────────────────────────────────────────────────────────

const MANIFEST_FILENAME = 'hashes.enc';

/**
 * Warm-up reads allowed per pass.
 *
 * Every `StorageService` decrypt runs PBKDF2 at 600 000 iterations — about
 * 275 ms of CPU each. The old code read one encrypted index PER NOTE to warm
 * its dedup cache, so the first save of a session cost `notes × 275 ms`: half
 * an hour of key derivation for a 6 400-note vault, saturating the crypto
 * thread pool and starving every other file operation. The manifest below
 * replaces those N reads with a single one; this cap bounds the remaining
 * cost while an existing install migrates onto it.
 */
const MAX_WARMUP_READS_PER_PASS = 25;

interface HashManifest {
  version: 1;
  notes: Record<string, { hash: string; atMs: number }>;
}

/** profileDataDir → manifest, loaded once per session. */
const manifestCache = new Map<string, HashManifest>();

function manifestPath(profileDataDir: string): string {
  return path.join(versionsDirForProfile(profileDataDir), MANIFEST_FILENAME);
}

/**
 * The newest-snapshot hash of every note, in ONE encrypted file.
 *
 * This exists purely to make the dedup check cheap. It is a cache, not a
 * source of truth: losing it costs a bounded re-warm from the per-note
 * indexes, never a lost version.
 */
async function loadManifest(profileDataDir: string): Promise<HashManifest> {
  const cached = manifestCache.get(profileDataDir);
  if (cached) return cached;

  let manifest: HashManifest = { version: 1, notes: {} };
  try {
    const raw = await fs.readFile(manifestPath(profileDataDir), 'utf-8');
    const decrypted = await StorageService.decrypt(raw);
    if (decrypted && typeof decrypted === 'object' && decrypted.notes) {
      manifest = { version: 1, notes: decrypted.notes as HashManifest['notes'] };
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('[noteVersionService] loadManifest failed, starting empty:', err);
    }
  }
  manifestCache.set(profileDataDir, manifest);
  return manifest;
}

async function saveManifest(profileDataDir: string, manifest: HashManifest): Promise<void> {
  try {
    await fs.mkdir(versionsDirForProfile(profileDataDir), { recursive: true });
    const encrypted = await StorageService.encrypt(manifest);
    const target = manifestPath(profileDataDir);
    const tmp = `${target}.${process.pid.toString(36)}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, encrypted, 'utf-8');
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    // A missing manifest only costs a re-warm next session — never fail the pass.
    log.warn('[noteVersionService] saveManifest failed:', (err as Error).message);
  }
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
export function recordSnapshots(
  profileId: string,
  profileDataDir: string,
  notes: NoteSnapshotInput[],
  // E9-2: org governance versionRetentionDays (when an org policy is active); null = personal default.
  versionRetentionDays: number | null = null
): Promise<RecordResult> {
  const running = passInFlight.get(profileId);
  if (running) {
    // A pass is already walking these notes. Stacking another one would
    // double the disk contention for no benefit, so remember the newest
    // request and replay it once — the last state always gets snapshotted.
    passQueued.set(profileId, { profileDataDir, notes, versionRetentionDays });
    // Never propagate the running pass's failure to this caller — snapshotting
    // is best-effort and must not surface as a rejected notes:save.
    return running.catch(() => undefined).then(() => ({
      snapshotted: [],
      skipped: [{ noteId: '*', reason: 'coalesced-into-running-pass' }],
      pruned: 0,
    }));
  }

  const pass = runSnapshotPass(profileId, profileDataDir, notes, versionRetentionDays).finally(
    () => {
      passInFlight.delete(profileId);
      const queued = passQueued.get(profileId);
      if (queued) {
        passQueued.delete(profileId);
        void recordSnapshots(
          profileId,
          queued.profileDataDir,
          queued.notes,
          queued.versionRetentionDays
        ).catch((err) => {
          log.warn('[noteVersionService] Coalesced pass failed:', (err as Error).message);
        });
      }
    }
  );
  passInFlight.set(profileId, pass);
  return pass;
}

async function runSnapshotPass(
  profileId: string,
  profileDataDir: string,
  notes: NoteSnapshotInput[],
  versionRetentionDays: number | null
): Promise<RecordResult> {
  const result: RecordResult = { snapshotted: [], skipped: [], pruned: 0 };
  const now = Date.now();
  const maxAgeMs =
    effectiveRetentionDays(versionRetentionDays, DEFAULT_VERSION_RETENTION_DAYS) * DAY_MS;

  const manifest = await loadManifest(profileDataDir);
  let manifestDirty = false;
  let warmupReads = 0;

  let walked = 0;
  for (const note of notes) {
    // Tranche : voir `HASH_YIELD_EVERY`. Placé AVANT tout `continue` pour que
    // le rythme tienne même quand chaque note est écartée d'entrée.
    if (walked > 0 && walked % HASH_YIELD_EVERY === 0) await yieldToEventLoop();
    walked++;

    if (!note || !note.id || typeof note.content !== 'string') {
      result.skipped.push({ noteId: note?.id ?? '<missing>', reason: 'invalid-input' });
      continue;
    }

    const key = snapshotKey(profileId, note.id);
    const hash = sha256Hex(serializeForHash(note));

    // Warm the dedup state without touching disk when possible. On the first
    // save of a note in a new session the in-memory cache is empty, and
    // treating the note as "first seen" would produce a duplicate snapshot
    // identical to the one already stored. The manifest answers that from a
    // single decrypt for the whole profile.
    let previous = lastSnapshotByNote.get(key) ?? null;
    if (!previous) {
      const fromManifest = manifest.notes[note.id];
      if (fromManifest) {
        previous = fromManifest;
        lastSnapshotByNote.set(key, previous);
      }
    }
    if (!previous && warmupReads < MAX_WARMUP_READS_PER_PASS) {
      // Not in the manifest: either a pre-manifest install or a note whose
      // entry was lost. Fall back to the per-note index, but only a bounded
      // number per pass — each of these costs ~275 ms of key derivation.
      warmupReads++;
      const existing = await readIndex(profileDataDir, note.id);
      if (existing.length > 0) {
        const newest = existing[0]; // index is kept sorted newest-first
        previous = { hash: newest.contentHash, atMs: Date.parse(newest.savedAt) };
        lastSnapshotByNote.set(key, previous);
        manifest.notes[note.id] = previous;
        manifestDirty = true;
      }
    } else if (!previous) {
      // Warm-up budget spent. Defer rather than risk a duplicate snapshot;
      // the next pass picks this note up.
      result.skipped.push({ noteId: note.id, reason: 'warmup-deferred' });
      continue;
    }

    const decision = decideSnapshot(previous, hash, now);
    if (!decision.snapshot) {
      result.skipped.push({ noteId: note.id, reason: decision.reason });
      continue;
    }

    try {
      const pruned = await snapshotOne(profileDataDir, note, hash, now, maxAgeMs);
      lastSnapshotByNote.set(key, { hash, atMs: now });
      manifest.notes[note.id] = { hash, atMs: now };
      manifestDirty = true;
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

  // Drop manifest entries for notes that no longer exist, so a vault that was
  // imported and deleted does not leave thousands of stale rows behind.
  const liveIds = new Set(notes.map((n) => n?.id).filter(Boolean) as string[]);
  for (const staleId of Object.keys(manifest.notes)) {
    if (!liveIds.has(staleId)) {
      delete manifest.notes[staleId];
      manifestDirty = true;
    }
  }

  if (manifestDirty) {
    await saveManifest(profileDataDir, manifest);
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
  nowMs: number,
  maxAgeMs: number = MAX_VERSION_AGE_MS
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

  // Then update the index and prune — under the per-note lock, so a
  // concurrent writer cannot read the same "existing" list and drop one of
  // the two new entries when it writes its own version back.
  const { discard } = await withIndexLock(`${profileDataDir}:${note.id}`, async () => {
    const existing = await readIndex(profileDataDir, note.id);
    const updated = [meta, ...existing];
    const retention = applyRetention(updated, nowMs, undefined, maxAgeMs);
    await writeIndex(profileDataDir, note.id, retention.keep);
    return retention;
  });

  // Best-effort secure-wipe of pruned content blobs — never throws.
  for (const old of discard) {
    try {
      await secureDeleteFile(versionContentPath(profileDataDir, note.id, old.id));
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

  const removed = await withIndexLock(`${profileDataDir}:${noteId}`, async () => {
    const existing = await readIndex(profileDataDir, noteId);
    const next = existing.filter((v) => v.id !== versionId);
    if (next.length === existing.length) return false;
    await writeIndex(profileDataDir, noteId, next);
    return true;
  });
  if (!removed) return false;

  try {
    await secureDeleteFile(versionContentPath(profileDataDir, noteId, versionId));
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
    await secureDeleteDir(dir);
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
  manifestCache.clear();
  passQueued.clear();
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
