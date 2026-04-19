/**
 * Note Version Service — Renderer Facade
 *
 * Thin IPC shim over the main-process `electron/noteVersionService.ts`.
 * Snapshots themselves are produced by the main process inside the
 * `notes:save` handler — the renderer no longer owns the write path.
 *
 * Only the read/delete API and the diff helper live here. Keeping the
 * shared types in `noteVersionLogic.ts` means the renderer and main
 * process cannot drift in their understanding of a version record.
 */

import type { NoteVersionContent, NoteVersionMeta } from './noteVersionLogic';

export type { NoteVersionContent, NoteVersionMeta };

// Legacy re-export: keeps the existing `NoteVersion` name compiling
// while we migrate the UI to distinguish meta vs full content.
export type NoteVersion = NoteVersionContent;

export interface VersionDiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
  lineNumber: number;
}

// ── IPC helpers ─────────────────────────────────────────────────────────────

/**
 * Thin wrapper around `window.electron.ipcRenderer.invoke` with a
 * graceful fallback when the bridge is unavailable (storybook, tests,
 * accidental import from a pure-Node script). Returning a neutral
 * value keeps the UI from crashing on a missing bridge.
 */
async function invoke<T>(channel: string, args: unknown[], fallback: T): Promise<T> {
  const bridge = (window as any).electron?.ipcRenderer;
  if (!bridge || typeof bridge.invoke !== 'function') return fallback;
  try {
    const result = await bridge.invoke(channel, ...args);
    return (result ?? fallback) as T;
  } catch {
    return fallback;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** List metadata for the versions of a note, newest first. */
export async function listVersions(noteId: string): Promise<NoteVersionMeta[]> {
  if (!noteId) return [];
  const list = await invoke<NoteVersionMeta[]>('note-versions:list', [noteId], []);
  return Array.isArray(list) ? list : [];
}

/** Fetch the full content of one version (title, TipTap JSON, plainText). */
export async function getVersion(
  noteId: string,
  versionId: string
): Promise<NoteVersionContent | null> {
  if (!noteId || !versionId) return null;
  return await invoke<NoteVersionContent | null>('note-versions:get', [noteId, versionId], null);
}

/** Delete a single version. */
export async function deleteVersion(noteId: string, versionId: string): Promise<boolean> {
  if (!noteId || !versionId) return false;
  return await invoke<boolean>('note-versions:delete', [noteId, versionId], false);
}

/** Wipe every stored version for a note — used when a note is permanently deleted. */
export async function clearVersions(noteId: string): Promise<boolean> {
  if (!noteId) return false;
  return await invoke<boolean>('note-versions:clear', [noteId], false);
}

// ── Diff ────────────────────────────────────────────────────────────────────

/**
 * Line-based diff between two plain-text strings. Greedy lookahead
 * handles most edits correctly without paying for a full LCS; if a
 * move exceeds the lookahead window it falls back to remove+add.
 *
 * Used for UI preview only — the stored content hash is what actually
 * decides whether a snapshot is redundant.
 */
export function diffVersions(oldText: string, newText: string): VersionDiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: VersionDiffLine[] = [];

  let oi = 0;
  let ni = 0;
  let lineNum = 1;
  const LOOKAHEAD = 5;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      result.push({ type: 'added', text: newLines[ni], lineNumber: lineNum++ });
      ni++;
      continue;
    }
    if (ni >= newLines.length) {
      result.push({ type: 'removed', text: oldLines[oi], lineNumber: lineNum++ });
      oi++;
      continue;
    }
    if (oldLines[oi] === newLines[ni]) {
      result.push({ type: 'same', text: newLines[ni], lineNumber: lineNum++ });
      oi++;
      ni++;
      continue;
    }

    let foundInNew = -1;
    for (let j = ni + 1; j < Math.min(ni + LOOKAHEAD, newLines.length); j++) {
      if (newLines[j] === oldLines[oi]) {
        foundInNew = j;
        break;
      }
    }

    let foundInOld = -1;
    for (let j = oi + 1; j < Math.min(oi + LOOKAHEAD, oldLines.length); j++) {
      if (oldLines[j] === newLines[ni]) {
        foundInOld = j;
        break;
      }
    }

    if (foundInNew !== -1 && (foundInOld === -1 || foundInNew - ni <= foundInOld - oi)) {
      while (ni < foundInNew) {
        result.push({ type: 'added', text: newLines[ni], lineNumber: lineNum++ });
        ni++;
      }
    } else if (foundInOld !== -1) {
      while (oi < foundInOld) {
        result.push({ type: 'removed', text: oldLines[oi], lineNumber: lineNum++ });
        oi++;
      }
    } else {
      result.push({ type: 'removed', text: oldLines[oi], lineNumber: lineNum++ });
      result.push({ type: 'added', text: newLines[ni], lineNumber: lineNum++ });
      oi++;
      ni++;
    }
  }

  return result;
}
