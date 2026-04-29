/**
 * Downloads Watcher Service
 *
 * Watches one or more OS folders (typically the user's Downloads folder) and
 * notifies the renderer whenever a new file appears. The renderer then imports
 * the file into Filarr via the regular addFileToFolder pipeline, which fires
 * the automation engine — so users can write rules with the
 * `file_imported_from_os` trigger to route specific files automatically.
 *
 * Limitations (V1):
 * - No catch-up scan. Files added while the app is closed are not imported.
 * - In-memory de-duplication only (lost on restart).
 */

import path from 'path';
import fs from 'fs/promises';
import chokidar, { FSWatcher } from 'chokidar';
import type { BrowserWindow } from 'electron';

export interface DownloadsWatcherConfig {
  enabled: boolean;
  sourceFolders: string[];
  inboxFolderId: string;
  deleteOriginal: boolean;
  /**
   * If non-empty, only files whose extension (lowercase, without leading dot)
   * matches one of these are imported. Empty array = import everything (the
   * security blocklist still applies on top).
   */
  extensionAllowList: string[];
}

export const DEFAULT_DOWNLOADS_WATCHER_CONFIG: DownloadsWatcherConfig = {
  enabled: false,
  sourceFolders: [],
  inboxFolderId: '',
  deleteOriginal: false,
  extensionAllowList: [],
};

export type DownloadsWatcherState = 'disabled' | 'starting' | 'active' | 'error';

export interface DownloadsWatcherStatus {
  state: DownloadsWatcherState;
  /** Folders chokidar is actually watching right now (post-validation). */
  watchedPaths: string[];
  /** Folders that were configured but rejected (don't exist, forbidden, etc.). */
  invalidPaths: string[];
  lastImportName: string | null;
  lastImportAt: string | null;
  lastError: string | null;
  importedCount: number;
}

// Hard-coded blocklist of executable / dangerous extensions. Defense-in-depth
// on top of the renderer's isExtensionAllowed check — we never want the
// watcher to silently import a script that could execute on the user's
// machine, even if the renderer rules are misconfigured.
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf',
  'wsh', 'scr', 'lnk', 'com', 'pif', 'reg', 'cpl', 'jar', 'app', 'dmg',
]);

// System paths we refuse to watch — protects against config tampering.
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

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB — matches MAX_FILE_SIZE in renderer

class DownloadsWatcherService {
  private watcher: FSWatcher | null = null;
  private config: DownloadsWatcherConfig = { ...DEFAULT_DOWNLOADS_WATCHER_CONFIG };
  private mainWindow: BrowserWindow | null = null;
  private seen = new Set<string>();
  private readyAt = 0;
  private status: DownloadsWatcherStatus = {
    state: 'disabled',
    watchedPaths: [],
    invalidPaths: [],
    lastImportName: null,
    lastImportAt: null,
    lastError: null,
    importedCount: 0,
  };

  /** Provide the main window so we can send IPC events to the renderer. */
  attachWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getConfig(): DownloadsWatcherConfig {
    return { ...this.config };
  }

  getStatus(): DownloadsWatcherStatus {
    return { ...this.status, watchedPaths: [...this.status.watchedPaths], invalidPaths: [...this.status.invalidPaths] };
  }

  /**
   * Called by the bridge after a file has been successfully imported into
   * Filarr. Updates the status counter so the UI can show "X files imported".
   */
  notifyImportSucceeded(name: string): void {
    this.status.lastImportName = name;
    this.status.lastImportAt = new Date().toISOString();
    this.status.importedCount += 1;
    this.pushStatus();
  }

  async setConfig(next: Partial<DownloadsWatcherConfig>): Promise<DownloadsWatcherConfig> {
    const sanitizedSourceFolders = (next.sourceFolders ?? this.config.sourceFolders)
      .map((p) => path.resolve(p))
      .filter((p) => this.isPathAllowed(p));

    const sanitizedExtensions = (
      next.extensionAllowList ?? this.config.extensionAllowList
    )
      .map((e) => String(e).trim().toLowerCase().replace(/^\./, ''))
      .filter((e) => e.length > 0 && /^[a-z0-9]+$/.test(e));

    this.config = {
      enabled: next.enabled ?? this.config.enabled,
      sourceFolders: sanitizedSourceFolders,
      inboxFolderId: (next.inboxFolderId ?? this.config.inboxFolderId).toString(),
      deleteOriginal: next.deleteOriginal ?? this.config.deleteOriginal,
      extensionAllowList: sanitizedExtensions,
    };

    await this.restart();
    return this.getConfig();
  }

  async start(): Promise<void> {
    await this.stop();

    if (!this.config.enabled) {
      this.setStatus({ state: 'disabled', watchedPaths: [], invalidPaths: [], lastError: null });
      return;
    }
    if (!this.config.inboxFolderId) {
      this.setStatus({
        state: 'error',
        watchedPaths: [],
        invalidPaths: [],
        lastError: 'No Filarr inbox folder selected',
      });
      console.warn('[downloadsWatcher] enabled but no inbox folder set — skipping start');
      return;
    }

    this.setStatus({ state: 'starting', lastError: null });

    const { valid, invalid } = await this.partitionExistingPaths(this.config.sourceFolders);
    if (valid.length === 0) {
      this.setStatus({
        state: 'error',
        watchedPaths: [],
        invalidPaths: invalid,
        lastError:
          this.config.sourceFolders.length === 0
            ? 'No source folders configured'
            : 'None of the configured source folders exist on disk',
      });
      console.warn('[downloadsWatcher] no valid source folders — skipping start');
      return;
    }

    this.seen.clear();
    this.readyAt = 0;

    this.watcher = chokidar.watch(valid, {
      persistent: true,
      ignoreInitial: true, // Don't fire for pre-existing files (avoids re-importing on every app start)
      depth: 0, // Top-level only — don't recurse into subfolders
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    });

    this.watcher.on('ready', () => {
      this.readyAt = Date.now();
      this.setStatus({
        state: 'active',
        watchedPaths: valid,
        invalidPaths: invalid,
        lastError: null,
      });
      console.info('[downloadsWatcher] watching:', valid.join(', '));
    });

    this.watcher.on('add', (filePath: string) => {
      void this.handleNewFile(filePath);
    });

    this.watcher.on('error', (error: Error) => {
      console.error('[downloadsWatcher] error:', error);
      this.setStatus({ state: 'error', lastError: error.message });
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      try {
        await this.watcher.close();
      } catch (e) {
        console.warn('[downloadsWatcher] error closing watcher:', e);
      }
      this.watcher = null;
    }
    this.seen.clear();
    if (this.status.state !== 'disabled' && this.status.state !== 'error') {
      this.setStatus({ state: 'disabled', watchedPaths: [] });
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Delete the OS source file (called by IPC after renderer confirms import). */
  async deleteSource(sourcePath: string): Promise<void> {
    const resolved = path.resolve(sourcePath);
    // Only allow deletion of files we previously announced — prevents abuse
    // via a renderer-side message asking us to delete arbitrary paths.
    if (!this.seen.has(resolved)) {
      throw new Error('Refusing to delete a path the watcher did not surface');
    }
    if (!this.isPathInWatchedFolders(resolved)) {
      throw new Error('Refusing to delete a path outside the watched folders');
    }
    await fs.unlink(resolved);
    this.seen.delete(resolved);
  }

  /**
   * One-shot catch-up scan. Lists every existing file in the currently watched
   * folders (top-level only) and surfaces them as if chokidar had detected
   * them. Used for the "Scan now" button — imports files the user wants to
   * reconcile without waiting for new downloads.
   *
   * Returns counts so the UI can show how many files were queued.
   */
  async scanNow(): Promise<{ queued: number; skipped: number }> {
    if (this.status.state !== 'active') {
      throw new Error(
        'Watcher is not active — enable watching with a valid configuration before running a scan.'
      );
    }
    let queued = 0;
    let skipped = 0;

    for (const folder of this.status.watchedPaths) {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(folder);
      } catch (err) {
        console.warn(`[downloadsWatcher] scanNow: cannot read ${folder}:`, err);
        continue;
      }
      for (const entry of entries) {
        const full = path.resolve(path.join(folder, entry));
        if (this.seen.has(full)) {
          skipped++;
          continue;
        }
        try {
          const stat = await fs.stat(full);
          if (!stat.isFile()) {
            skipped++;
            continue;
          }
        } catch {
          skipped++;
          continue;
        }
        // Defer to handleNewFile so the same blocklist / size / extension /
        // dedup logic applies. It will increment `seen` itself.
        // eslint-disable-next-line no-await-in-loop
        await this.handleNewFile(full);
        queued++;
      }
    }

    return { queued, skipped };
  }

  // ───────────────────────── private ─────────────────────────

  private async handleNewFile(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);

    if (this.seen.has(resolved)) return;
    this.seen.add(resolved);

    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) return;
      if (stat.size > MAX_FILE_SIZE) {
        console.warn(`[downloadsWatcher] skipping ${resolved}: too large (${stat.size} bytes)`);
        return;
      }

      const name = path.basename(resolved);
      const ext = path.extname(name).slice(1).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        console.warn(`[downloadsWatcher] skipping ${resolved}: blocked extension .${ext}`);
        return;
      }
      if (
        this.config.extensionAllowList.length > 0 &&
        !this.config.extensionAllowList.includes(ext)
      ) {
        // User-configured allow-list filter: silently skip non-matching files.
        return;
      }

      const bytes = await fs.readFile(resolved);

      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        console.warn('[downloadsWatcher] no main window — dropping event for', resolved);
        return;
      }

      // Send Uint8Array (transferred efficiently across IPC). The renderer
      // converts to Buffer in fileService before encryption.
      this.mainWindow.webContents.send('downloads-watcher:file-detected', {
        sourcePath: resolved,
        name,
        size: stat.size,
        type: this.guessMimeType(ext),
        contentBytes: Array.from(new Uint8Array(bytes)),
        inboxFolderId: this.config.inboxFolderId,
        deleteOriginal: this.config.deleteOriginal,
      });
    } catch (error) {
      console.error(`[downloadsWatcher] failed to handle ${resolved}:`, error);
      // Allow retry on next event by removing from seen
      this.seen.delete(resolved);
    }
  }

  private async partitionExistingPaths(
    paths: string[]
  ): Promise<{ valid: string[]; invalid: string[] }> {
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const p of paths) {
      try {
        const stat = await fs.stat(p);
        if (stat.isDirectory()) {
          valid.push(p);
        } else {
          invalid.push(p);
        }
      } catch {
        invalid.push(p);
        console.warn(`[downloadsWatcher] source folder unavailable: ${p}`);
      }
    }
    return { valid, invalid };
  }

  private setStatus(patch: Partial<DownloadsWatcherStatus>): void {
    this.status = { ...this.status, ...patch };
    this.pushStatus();
  }

  private pushStatus(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('downloads-watcher:status-changed', this.getStatus());
  }

  private isPathAllowed(absPath: string): boolean {
    const normalized = absPath.replace(/\\/g, '/').toLowerCase();
    for (const forbidden of FORBIDDEN_PATH_PREFIXES) {
      if (normalized === forbidden || normalized.startsWith(forbidden + '/')) {
        console.warn(`[downloadsWatcher] refusing forbidden path: ${absPath}`);
        return false;
      }
    }
    return true;
  }

  private isPathInWatchedFolders(absPath: string): boolean {
    const normalizedFile = absPath.replace(/\\/g, '/').toLowerCase();
    return this.config.sourceFolders.some((folder) => {
      const normalizedFolder = path.resolve(folder).replace(/\\/g, '/').toLowerCase();
      return (
        normalizedFile === normalizedFolder ||
        normalizedFile.startsWith(normalizedFolder + '/')
      );
    });
  }

  private guessMimeType(ext: string): string {
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
}

const downloadsWatcherService = new DownloadsWatcherService();
export default downloadsWatcherService;
