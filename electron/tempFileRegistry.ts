/**
 * Temp plaintext registry — the single authority on decrypted temp files the
 * app has materialized (open-with-default-app, drag-out, reveal-in-explorer,
 * vault previews). Replaces the old ad-hoc timer Map in main.ts.
 *
 * Responsibilities:
 *  - schedule the delayed secure deletion of each temp path (5 min default);
 *  - track the chokidar re-encrypt watchers attached to those paths, so a
 *    purge can close them BEFORE wiping the file (an open watcher would
 *    otherwise race the delete or resurrect the file on editor save);
 *  - purge everything on demand (manual purge, vault lock, app quit), plus
 *    sweep the app-owned temp dirs for leftovers from crashed sessions.
 *
 * Honesty note (mirrors secureDelete.ts): overwrite-then-unlink is
 * best-effort on SSD/TRIM/CoW volumes — the UI copy must not promise
 * forensic-grade erasure and should suggest OS full-disk encryption.
 *
 * Pure Node module (no Electron imports) — unit-testable standalone.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import log from 'electron-log';
import { secureDeleteFile, secureDeleteDir } from './secureDelete';

/** Structural watcher type — matches chokidar's FSWatcher.close(). */
export interface TempWatcher {
  close(): Promise<void> | void;
}

interface TempEntry {
  timer: ReturnType<typeof setTimeout> | null;
  watchers: TempWatcher[];
}

export interface PurgeResult {
  /** Files + swept directories successfully secure-deleted. */
  deleted: number;
  /** Paths where deletion raised (file locked by another process, ...). */
  errors: number;
}

export const TEMP_CLEANUP_DELAY_MS = 5 * 60 * 1000;

const entries = new Map<string, TempEntry>();

function getOrCreateEntry(tempPath: string): TempEntry {
  let entry = entries.get(tempPath);
  if (!entry) {
    entry = { timer: null, watchers: [] };
    entries.set(tempPath, entry);
  }
  return entry;
}

async function closeWatchers(entry: TempEntry): Promise<void> {
  for (const watcher of entry.watchers) {
    try {
      await watcher.close();
    } catch {
      /* watcher already closed */
    }
  }
  entry.watchers = [];
}

/**
 * Schedules the secure deletion of a temp plaintext file after `delayMs`.
 * Re-scheduling an already-tracked path resets its timer (same semantics as
 * the previous main.ts implementation — callers unchanged).
 */
export function scheduleTempCleanup(tempPath: string, delayMs: number = TEMP_CLEANUP_DELAY_MS): void {
  const entry = getOrCreateEntry(tempPath);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    void (async () => {
      try {
        await closeWatchers(entry);
        await secureDeleteFile(tempPath);
      } catch {
        /* file may already be deleted */
      }
      entries.delete(tempPath);
    })();
  }, delayMs);
}

/**
 * Associates a re-encrypt watcher with a tracked temp path so purge/expiry
 * can close it before wiping the file. Untracked paths get an entry with no
 * timer (they are still purged by purgeAllTempFiles).
 */
export function attachTempWatcher(tempPath: string, watcher: TempWatcher): void {
  getOrCreateEntry(tempPath).watchers.push(watcher);
}

/** Number of temp plaintext files currently tracked (for UI display). */
export function trackedTempCount(): number {
  return entries.size;
}

export interface PurgeOptions {
  /** App-owned dirs swept entirely (filarr-drag/, filarr-reveal/). */
  sweepDirs?: string[];
  /**
   * Pattern sweeps for files the app writes into a SHARED directory (the OS
   * temp root): only entries matching the pattern are touched, never the
   * whole directory.
   */
  patternSweeps?: Array<{ dir: string; pattern: RegExp }>;
}

/**
 * Secure-deletes every tracked temp file NOW (cancelling timers, closing
 * watchers first) and sweeps the given app-owned locations for leftovers
 * from crashed sessions. Never throws — returns per-path success counts.
 */
export async function purgeAllTempFiles(options: PurgeOptions = {}): Promise<PurgeResult> {
  const result: PurgeResult = { deleted: 0, errors: 0 };

  // 1) Tracked live temp files — the authoritative list for this session.
  const tracked = Array.from(entries.entries());
  for (const [tempPath, entry] of tracked) {
    if (entry.timer) clearTimeout(entry.timer);
    await closeWatchers(entry);
    try {
      await secureDeleteFile(tempPath);
      result.deleted += 1;
    } catch (err) {
      result.errors += 1;
      log.warn('[tempPurge] failed to delete tracked temp file:', tempPath, err);
    }
    entries.delete(tempPath);
  }

  // 2) App-owned temp dirs (drag-out staging, reveal staging).
  for (const dir of options.sweepDirs ?? []) {
    try {
      await fs.access(dir);
    } catch {
      continue; // never created this session
    }
    try {
      await secureDeleteDir(dir);
      result.deleted += 1;
    } catch (err) {
      result.errors += 1;
      log.warn('[tempPurge] failed to sweep temp dir:', dir, err);
    }
  }

  // 3) Pattern sweeps in shared dirs (e.g. vault_<ts>_* files in temp root).
  for (const sweep of options.patternSweeps ?? []) {
    let names: string[] = [];
    try {
      names = await fs.readdir(sweep.dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!sweep.pattern.test(name)) continue;
      try {
        await secureDeleteFile(path.join(sweep.dir, name));
        result.deleted += 1;
      } catch (err) {
        result.errors += 1;
        log.warn('[tempPurge] failed to delete pattern-swept file:', name, err);
      }
    }
  }

  return result;
}
