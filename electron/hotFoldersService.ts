/**
 * Hot Folders Service
 *
 * Watches N user-defined OS folders ("hot folders") and forwards file events
 * to the renderer, which imports/updates/deletes files in the active Filarr
 * vault via the regular addFileToFolder pipeline. Each rule has its own
 * source, target Filarr folder, filters and post-import action.
 *
 * v1 is one-way OS → vault. The watcher never decrypts vault content to disk,
 * so we can't loop and can't leak plaintext.
 */

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import chokidar, { FSWatcher } from 'chokidar';
import type { BrowserWindow } from 'electron';
import StorageService from './storageService';
import { secureDeleteFile } from './secureDelete';

export type PostImportAction = 'keep' | 'secure-delete' | 'move-to-subfolder';

export interface HotFolderRule {
  id: string;
  enabled: boolean;
  name: string;
  sourcePath: string;
  targetFolderId: string;
  recursive: boolean;
  extensionAllowList: string[];
  maxFileSizeBytes: number;
  postImportAction: PostImportAction;
  postImportSubfolderPath?: string;
  autoTagIds: string[];
  watchDeletes: boolean;
  safetyThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export type HotFolderState =
  | 'disabled'
  | 'starting'
  | 'active'
  | 'error'
  | 'paused-safety';

export interface HotFolderStatus {
  ruleId: string;
  state: HotFolderState;
  watchedPath: string;
  importedCount: number;
  deletedCount: number;
  lastEventAt: string | null;
  lastEventName: string | null;
  lastError: string | null;
}

export interface HotFolderAddOrChangeEvent {
  kind: 'add' | 'change';
  ruleId: string;
  sourcePath: string;
  targetFolderId: string;
  name: string;
  size: number;
  type: string;
  /**
   * Inline file content, only present for files <= INLINE_CONTENT_MAX_BYTES.
   * Larger files omit it: the renderer must import them via the path-based
   * streaming IPC ("saveEncryptedFileFromPath") using sourcePath, which keeps
   * memory flat instead of marshalling a number[] (~8x file size in V8).
   */
  contentBytes?: number[];
  autoTagIds: string[];
  postImportAction: PostImportAction;
  postImportSubfolderPath?: string;
}

export interface HotFolderUnlinkEvent {
  kind: 'unlink';
  ruleId: string;
  sourcePath: string;
  targetFolderId: string;
  vaultFileId: string;
}

export type HotFolderFileEvent =
  | HotFolderAddOrChangeEvent
  | HotFolderUnlinkEvent;

export const DEFAULT_HOT_FOLDER_MAX_BYTES = 500 * 1024 * 1024;
export const DEFAULT_HOT_FOLDER_SAFETY_THRESHOLD = 50;

// Files up to this size are shipped inline as contentBytes (legacy renderer
// pipeline). Bigger files are announced WITHOUT content — the renderer
// imports them from sourcePath via the V3 streaming IPC.
export const HOT_FOLDER_INLINE_CONTENT_MAX_BYTES = 500 * 1024 * 1024;

// Hard per-file ceiling for configurable rules — matches the V3 streaming
// import cap (5 GiB) so a rule can never announce a file the vault cannot
// ingest.
export const HOT_FOLDER_MAX_RULE_BYTES = 5 * 1024 * 1024 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf',
  'wsh', 'scr', 'lnk', 'com', 'pif', 'reg', 'cpl', 'jar', 'app', 'dmg',
]);

const FORBIDDEN_PATH_PREFIXES = [
  'c:/windows',
  'c:/program files',
  'c:/program files (x86)',
  'c:/programdata',
  '/etc',
  '/sys',
  '/proc',
  '/usr/bin',
  '/usr/sbin',
  '/bin',
  '/sbin',
];

interface RuleRuntime {
  rule: HotFolderRule;
  watcher: FSWatcher | null;
  status: HotFolderStatus;
  /** Map OS absolute path → vault file id (for delete mirroring). */
  seen: Map<string, string>;
}

function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function emptyStatus(rule: HotFolderRule): HotFolderStatus {
  return {
    ruleId: rule.id,
    state: rule.enabled ? 'starting' : 'disabled',
    watchedPath: rule.sourcePath,
    importedCount: 0,
    deletedCount: 0,
    lastEventAt: null,
    lastEventName: null,
    lastError: null,
  };
}

class HotFoldersService {
  private runtimes = new Map<string, RuleRuntime>();
  private mainWindow: BrowserWindow | null = null;

  attachWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getRules(): HotFolderRule[] {
    return [...this.runtimes.values()].map((r) => ({ ...r.rule }));
  }

  getStatuses(): HotFolderStatus[] {
    return [...this.runtimes.values()].map((r) => ({ ...r.status }));
  }

  getRule(ruleId: string): HotFolderRule | null {
    const r = this.runtimes.get(ruleId);
    return r ? { ...r.rule } : null;
  }

  /**
   * Replace the entire rules set. Stops removed rules, starts new ones,
   * restarts changed ones. The caller persists to disk separately.
   */
  async setRules(nextRules: HotFolderRule[]): Promise<HotFolderRule[]> {
    const sanitized = await this.sanitizeRules(nextRules);
    const nextIds = new Set(sanitized.map((r) => r.id));

    // Stop watchers for rules that disappeared
    for (const [id, runtime] of this.runtimes) {
      if (!nextIds.has(id)) {
        await this.stopWatcher(runtime);
        this.runtimes.delete(id);
      }
    }

    // Diff existing rules and (re)start as needed
    for (const rule of sanitized) {
      const existing = this.runtimes.get(rule.id);
      if (!existing) {
        const runtime: RuleRuntime = {
          rule,
          watcher: null,
          status: emptyStatus(rule),
          seen: new Map(),
        };
        this.runtimes.set(rule.id, runtime);
        await this.startWatcher(runtime);
        continue;
      }

      const requiresRestart =
        existing.rule.enabled !== rule.enabled ||
        existing.rule.sourcePath !== rule.sourcePath ||
        existing.rule.recursive !== rule.recursive;

      existing.rule = rule;

      if (requiresRestart) {
        await this.stopWatcher(existing);
        await this.startWatcher(existing);
      } else {
        this.pushStatus(existing);
      }
    }

    return this.getRules();
  }

  async stopAll(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await this.stopWatcher(runtime);
    }
    this.runtimes.clear();
  }

  notifyImportSucceeded(ruleId: string, sourcePath: string, vaultFileId: string): void {
    const runtime = this.runtimes.get(ruleId);
    if (!runtime) return;
    const key = normalizePath(sourcePath);
    runtime.seen.set(key, vaultFileId);
    runtime.status.importedCount += 1;
    runtime.status.lastEventAt = new Date().toISOString();
    runtime.status.lastEventName = path.basename(sourcePath);
    this.pushStatus(runtime);
  }

  async deleteSource(ruleId: string, sourcePath: string): Promise<void> {
    const runtime = this.runtimes.get(ruleId);
    if (!runtime) throw new Error('Unknown rule');
    const resolved = path.resolve(sourcePath);
    const key = normalizePath(resolved);
    if (!runtime.seen.has(key)) {
      throw new Error('Refusing to delete a path the watcher did not surface');
    }
    if (!this.isPathInsideRule(runtime.rule, resolved)) {
      throw new Error('Refusing to delete a path outside the rule source folder');
    }
    // The rule option is literally named 'secure-delete' — honor it with the
    // overwrite-then-unlink wipe instead of the plain unlink it used to be
    // (same best-effort SSD caveats as secureDelete.ts documents).
    await secureDeleteFile(resolved);
    runtime.seen.delete(key);
  }

  async moveSource(
    ruleId: string,
    sourcePath: string,
    targetSubfolder: string
  ): Promise<void> {
    const runtime = this.runtimes.get(ruleId);
    if (!runtime) throw new Error('Unknown rule');
    const resolved = path.resolve(sourcePath);
    if (!this.isPathInsideRule(runtime.rule, resolved)) {
      throw new Error('Refusing to move a path outside the rule source folder');
    }
    const targetDir = path.resolve(runtime.rule.sourcePath, targetSubfolder);
    if (!this.isPathInsideRule(runtime.rule, targetDir)) {
      throw new Error('Move target must stay inside the rule source folder');
    }
    await fs.mkdir(targetDir, { recursive: true });
    const dest = path.join(targetDir, path.basename(resolved));
    await fs.rename(resolved, dest);
    const oldKey = normalizePath(resolved);
    const vaultId = runtime.seen.get(oldKey);
    if (vaultId) {
      runtime.seen.delete(oldKey);
      runtime.seen.set(normalizePath(dest), vaultId);
    }
  }

  async pauseRule(ruleId: string): Promise<void> {
    const runtime = this.runtimes.get(ruleId);
    if (!runtime) return;
    runtime.rule.enabled = false;
    await this.stopWatcher(runtime);
    runtime.status.state = 'disabled';
    this.pushStatus(runtime);
  }

  async resumeRule(ruleId: string): Promise<void> {
    const runtime = this.runtimes.get(ruleId);
    if (!runtime) return;
    runtime.rule.enabled = true;
    await this.startWatcher(runtime);
  }

  /**
   * Acknowledge a paused-safety state. The user has confirmed that the
   * missing files are intentional (or the drive is back). We clear the
   * paused-safety status and let chokidar's next event flow through the
   * guard-rail again — if the ratio is still high, it'll re-trigger.
   */
  clearSafetyPause(ruleId: string): void {
    const runtime = this.runtimes.get(ruleId);
    if (!runtime) return;
    if (runtime.status.state !== 'paused-safety') return;
    runtime.status.state = runtime.watcher ? 'active' : 'disabled';
    runtime.status.lastError = null;
    this.pushStatus(runtime);
  }

  async scanNow(ruleId: string): Promise<{ queued: number; skipped: number }> {
    const runtime = this.runtimes.get(ruleId);
    if (!runtime) throw new Error('Unknown rule');
    if (runtime.status.state !== 'active') {
      throw new Error('Rule must be active before scanning');
    }
    let queued = 0;
    let skipped = 0;
    const visit = async (dir: string, depth: number): Promise<void> => {
      let entries: import('fs').Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        console.warn(`[hotFolders] scanNow: cannot read ${dir}:`, err);
        return;
      }
      for (const entry of entries) {
        const full = path.resolve(path.join(dir, entry.name));
        if (entry.isDirectory()) {
          if (runtime.rule.recursive && depth < 16) {
            // eslint-disable-next-line no-await-in-loop
            await visit(full, depth + 1);
          }
          continue;
        }
        if (!entry.isFile()) {
          skipped++;
          continue;
        }
        if (runtime.seen.has(normalizePath(full))) {
          skipped++;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const fired = await this.handleAddOrChange(runtime, full, 'add');
        if (fired) queued++;
        else skipped++;
      }
    };
    await visit(runtime.rule.sourcePath, 0);
    return { queued, skipped };
  }

  // ───────────────────────── private ─────────────────────────

  private async sanitizeRules(rules: HotFolderRule[]): Promise<HotFolderRule[]> {
    const vaultDir = normalizePath(StorageService.getBaseDir());
    const seenSources = new Set<string>();
    const out: HotFolderRule[] = [];

    for (const raw of rules) {
      if (!raw || typeof raw !== 'object') continue;

      const sourcePath = typeof raw.sourcePath === 'string'
        ? path.resolve(raw.sourcePath)
        : '';
      const normalized = normalizePath(sourcePath);

      // Reject hot folders sitting inside the encrypted vault (would loop:
      // chokidar would see the encrypted blobs being written and try to
      // re-import them).
      if (
        normalized === vaultDir ||
        normalized.startsWith(vaultDir + '/') ||
        vaultDir.startsWith(normalized + '/')
      ) {
        console.warn('[hotFolders] rejecting rule pointing inside the vault:', sourcePath);
        continue;
      }

      // Reject forbidden system paths
      const forbidden = FORBIDDEN_PATH_PREFIXES.some(
        (p) => normalized === p || normalized.startsWith(p + '/')
      );
      if (forbidden) {
        console.warn('[hotFolders] rejecting forbidden system path:', sourcePath);
        continue;
      }

      // Reject overlapping rules (one source contained in another). First
      // accepted rule wins; this avoids fighting watchers and double-imports.
      const overlaps = [...seenSources].some(
        (s) =>
          normalized === s ||
          normalized.startsWith(s + '/') ||
          s.startsWith(normalized + '/')
      );
      if (overlaps) {
        console.warn('[hotFolders] rejecting overlapping source:', sourcePath);
        continue;
      }
      seenSources.add(normalized);

      out.push({
        id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : randomUUID(),
        enabled: !!raw.enabled,
        name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : 'Untitled',
        sourcePath,
        targetFolderId: typeof raw.targetFolderId === 'string' ? raw.targetFolderId : '',
        recursive: !!raw.recursive,
        extensionAllowList: Array.isArray(raw.extensionAllowList)
          ? raw.extensionAllowList
              .map((e) => String(e).trim().toLowerCase().replace(/^\./, ''))
              .filter((e) => e.length > 0 && /^[a-z0-9]+$/.test(e))
          : [],
        maxFileSizeBytes:
          typeof raw.maxFileSizeBytes === 'number' && raw.maxFileSizeBytes > 0
            ? Math.min(raw.maxFileSizeBytes, HOT_FOLDER_MAX_RULE_BYTES)
            : DEFAULT_HOT_FOLDER_MAX_BYTES,
        postImportAction:
          raw.postImportAction === 'secure-delete' ||
          raw.postImportAction === 'move-to-subfolder'
            ? raw.postImportAction
            : 'keep',
        postImportSubfolderPath:
          typeof raw.postImportSubfolderPath === 'string'
            ? raw.postImportSubfolderPath
            : undefined,
        autoTagIds: Array.isArray(raw.autoTagIds)
          ? raw.autoTagIds.filter((t) => typeof t === 'string')
          : [],
        watchDeletes: !!raw.watchDeletes,
        safetyThreshold:
          typeof raw.safetyThreshold === 'number' &&
          raw.safetyThreshold > 0 &&
          raw.safetyThreshold <= 100
            ? raw.safetyThreshold
            : DEFAULT_HOT_FOLDER_SAFETY_THRESHOLD,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return out;
  }

  private async startWatcher(runtime: RuleRuntime): Promise<void> {
    await this.stopWatcher(runtime);

    if (!runtime.rule.enabled) {
      runtime.status.state = 'disabled';
      this.pushStatus(runtime);
      return;
    }
    if (!runtime.rule.targetFolderId) {
      runtime.status.state = 'error';
      runtime.status.lastError = 'No target Filarr folder selected';
      this.pushStatus(runtime);
      return;
    }

    try {
      const stat = await fs.stat(runtime.rule.sourcePath);
      if (!stat.isDirectory()) {
        runtime.status.state = 'error';
        runtime.status.lastError = 'Source path is not a directory';
        this.pushStatus(runtime);
        return;
      }
    } catch {
      runtime.status.state = 'error';
      runtime.status.lastError = 'Source folder unavailable';
      this.pushStatus(runtime);
      return;
    }

    runtime.status.state = 'starting';
    runtime.status.lastError = null;
    this.pushStatus(runtime);

    const watcher = chokidar.watch(runtime.rule.sourcePath, {
      persistent: true,
      ignoreInitial: true,
      depth: runtime.rule.recursive ? undefined : 0,
      followSymlinks: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
      ignored: [/(^|[/\\])\../, /node_modules/],
    });

    watcher.on('ready', () => {
      runtime.status.state = 'active';
      this.pushStatus(runtime);
      console.info('[hotFolders] watching:', runtime.rule.sourcePath, `(rule ${runtime.rule.id})`);
    });
    watcher.on('add', (filePath: string) => {
      void this.handleAddOrChange(runtime, filePath, 'add');
    });
    watcher.on('change', (filePath: string) => {
      void this.handleAddOrChange(runtime, filePath, 'change');
    });
    watcher.on('unlink', (filePath: string) => {
      if (!runtime.rule.watchDeletes) return;
      void this.handleUnlink(runtime, filePath);
    });
    watcher.on('error', (error: Error) => {
      console.error('[hotFolders] watcher error:', error);
      runtime.status.state = 'error';
      runtime.status.lastError = error.message;
      this.pushStatus(runtime);
    });

    runtime.watcher = watcher;
  }

  private async stopWatcher(runtime: RuleRuntime): Promise<void> {
    if (runtime.watcher) {
      try {
        await runtime.watcher.close();
      } catch (e) {
        console.warn('[hotFolders] error closing watcher:', e);
      }
      runtime.watcher = null;
    }
  }

  private async handleAddOrChange(
    runtime: RuleRuntime,
    filePath: string,
    kind: 'add' | 'change'
  ): Promise<boolean> {
    const resolved = path.resolve(filePath);
    const key = normalizePath(resolved);

    if (kind === 'add' && runtime.seen.has(key)) return false;

    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) return false;
      if (stat.size > runtime.rule.maxFileSizeBytes) {
        runtime.status.lastError = `File too large: ${path.basename(resolved)} (${formatBytes(stat.size)} > ${formatBytes(runtime.rule.maxFileSizeBytes)})`;
        this.pushStatus(runtime);
        return false;
      }

      const name = path.basename(resolved);
      const ext = path.extname(name).slice(1).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        console.warn(`[hotFolders] skipping ${resolved}: blocked extension .${ext}`);
        return false;
      }
      if (
        runtime.rule.extensionAllowList.length > 0 &&
        !runtime.rule.extensionAllowList.includes(ext)
      ) {
        return false;
      }

      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        console.warn('[hotFolders] no main window — dropping event for', resolved);
        return false;
      }

      const payload: HotFolderAddOrChangeEvent = {
        kind,
        ruleId: runtime.rule.id,
        sourcePath: resolved,
        targetFolderId: runtime.rule.targetFolderId,
        name,
        size: stat.size,
        type: guessMimeType(ext),
        autoTagIds: [...runtime.rule.autoTagIds],
        postImportAction: runtime.rule.postImportAction,
        postImportSubfolderPath: runtime.rule.postImportSubfolderPath,
      };
      // Small files keep the legacy inline pipeline; big files (up to 5 GiB)
      // are imported by the renderer from sourcePath via the V3 streaming IPC
      // and never exist as a whole buffer here.
      if (stat.size <= HOT_FOLDER_INLINE_CONTENT_MAX_BYTES) {
        const bytes = await fs.readFile(resolved);
        payload.contentBytes = Array.from(new Uint8Array(bytes));
      }
      this.mainWindow.webContents.send('hot-folders:file-event', payload);
      return true;
    } catch (error) {
      console.error(`[hotFolders] failed to handle ${resolved}:`, error);
      return false;
    }
  }

  private async handleUnlink(runtime: RuleRuntime, filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    const key = normalizePath(resolved);
    const vaultFileId = runtime.seen.get(key);
    if (!vaultFileId) return;

    // Guard-rail: refuse to cascade deletes when most tracked files vanish
    // at once (likely a drive disconnection rather than a real cleanup).
    // We sample by checking how many of the tracked files still exist.
    const tracked = [...runtime.seen.keys()];
    if (tracked.length >= 4) {
      let missing = 0;
      for (const trackedKey of tracked) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await fs.access(trackedKey);
        } catch {
          missing++;
        }
      }
      const ratio = (missing / tracked.length) * 100;
      if (ratio >= runtime.rule.safetyThreshold) {
        runtime.status.state = 'paused-safety';
        runtime.status.lastError = `Auto-deletion paused: ${ratio.toFixed(0)}% of tracked files missing.`;
        this.pushStatus(runtime);
        return;
      }
    }

    runtime.seen.delete(key);
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const payload: HotFolderFileEvent = {
      kind: 'unlink',
      ruleId: runtime.rule.id,
      sourcePath: resolved,
      targetFolderId: runtime.rule.targetFolderId,
      vaultFileId,
    };
    this.mainWindow.webContents.send('hot-folders:file-event', payload);

    runtime.status.deletedCount += 1;
    runtime.status.lastEventAt = new Date().toISOString();
    runtime.status.lastEventName = path.basename(resolved);
    this.pushStatus(runtime);
  }

  private pushStatus(runtime: RuleRuntime): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('hot-folders:status-changed', { ...runtime.status });
  }

  private isPathInsideRule(rule: HotFolderRule, absPath: string): boolean {
    const file = normalizePath(absPath);
    const root = normalizePath(rule.sourcePath);
    return file === root || file.startsWith(root + '/');
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] || 'application/octet-stream';
}

const hotFoldersService = new HotFoldersService();
export default hotFoldersService;
