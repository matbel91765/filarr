import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Notification,
  dialog,
  clipboard,
  nativeImage,
  IpcMainEvent,
  IpcMainInvokeEvent,
  Tray,
  Menu,
  net,
  safeStorage,
  protocol,
  powerMonitor,
  systemPreferences,
} from 'electron';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import type { Dirent } from 'fs';
import crypto from 'crypto';
import chokidar, { FSWatcher } from 'chokidar';
import StorageService from './storageService';
import profileManager from './profileManager';
import { migrateLegacyToDefaultProfile } from './profileMigration';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import * as authService from './authService';
import { startSsoLogin, cancelSsoLogin } from './ssoLogin';
import * as syncService from './sync/syncService';
import * as liveNotesRegistry from './sync/liveNotes';
import { withNotesLock } from './sync/notesLock';
import {
  applyNotesDelta,
  isEmptyNotesVault,
  isUsableNotesBase,
  isWellFormedNotesDelta,
  selectStaleDeltaEntries,
  snapshotInputsFromDelta,
  type NotesDeltaPayload,
  type NotesVaultPayload,
} from './sync/notesDelta';
import * as notesVault from './sync/notesVaultFacade';
import type { NotesIndex } from './sync/notesStoreV2';
import {
  loadOrSeedLayout,
  withLayoutLock,
  writeLayoutDocument,
  type LayoutLoadResult,
  type LayoutSeedHints,
} from './sync/layoutStore';
import {
  createEmptyLayoutDocument,
  normalizeLayoutDocument,
  LAYOUT_META_RESOURCE_ID,
} from './sync/layoutMergeCore';
import * as sessionKeyStore from './sessionKeyStore';
import { streamingSha256 } from './sync/multipartTransfer';
import * as pairingService from './pairingService';
import * as publishEngine from './publish/publishEngine';
import * as noteVersionService from './noteVersionService';
import * as fileVersionService from './fileVersionService';
import * as shareService from './shareService';
import downloadsWatcherService, {
  DEFAULT_DOWNLOADS_WATCHER_CONFIG,
  DownloadsWatcherConfig,
} from './downloadsWatcherService';
import { Readable } from 'stream';
// Pure decision logic for the filarr-stream:// media protocol (no Electron
// deps — unit-tested standalone). Imported BEFORE the
// registerSchemesAsPrivileged call below, which needs STREAM_SCHEME.
import {
  STREAM_SCHEME,
  MAX_CONCURRENT_STREAMS,
  LEGACY_STREAM_MAX_BYTES,
  LEGACY_CONTAINER_OVERHEAD,
  parseStreamUrl,
  resolveVaultFilePath,
  planStreamResponse,
  type StreamSource,
  type StreamResponsePlan,
} from './streamProtocol';

// ── app:// scheme (feature #7 prerequisite) ─────────────────────────────────
// In production the renderer used to load over file://, which has no valid
// origin — WebAuthn (hardware keys) refuses to run there. We serve the built
// renderer over a privileged custom scheme instead: app://filarr.app/...
// `standard` gives it real URL semantics (origin, relative paths), `secure`
// marks it potentially-trustworthy so secure-context APIs (WebAuthn, crypto)
// light up, and the hostname `filarr.app` becomes a valid WebAuthn rp.id.
// MUST run before app 'ready' — Chromium reads this list once at startup.
const APP_SCHEME = 'app';
const APP_HOST = 'filarr.app';
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  // filarr-stream://media/... — decrypted vault media with HTTP Range
  // semantics (V3 chunk-addressed seeking). `stream: true` lets Chromium's
  // media stack issue range requests and consume streaming bodies.
  {
    scheme: STREAM_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
import hotFoldersService, { type HotFolderRule } from './hotFoldersService';
import { clipperBridge, type ClipSaveResult } from './clipperBridge';
import * as reminderScheduler from './reminderScheduler';
import { secureDeleteFile, secureDeleteDir } from './secureDelete';
// Wave 1 — desktop protection surface (tray/mini-mode/auto-lock/purge/move)
import {
  scheduleTempCleanup,
  attachTempWatcher,
  purgeAllTempFiles,
  type PurgeResult,
} from './tempFileRegistry';
import {
  DESKTOP_SETTINGS_FLAG_KEY,
  DEFAULT_DESKTOP_PROTECTION_SETTINGS,
  parseDesktopSettings,
  mergeDesktopSettings,
  type DesktopProtectionSettings,
} from './desktopProtection';
import { applyHotkeys, unregisterAllHotkeys, type HotkeyStatus } from './globalHotkeys';
import {
  toggleMiniWindow,
  showMiniWindow,
  hideMiniWindow,
  getMiniWindow,
  isMiniWindowWebContents,
  applyMiniAlwaysOnTop,
  type MiniWindowConfig,
} from './miniWindow';
import { performMoveIntoVault, performVerifyThenDelete, sha256OfStream } from './moveIntoVault';
// Wave 2 — ".filarr" protected containers ("protéger sur place"): container
// format + read/write primitives (pure Node, filarrContainer.ts), protect/
// restore orchestration with verify-before-delete (filarrBox.ts), advisory
// encrypted registry of known containers (protectedRegistry.ts). IPC contract:
// src/services/features/filarrBoxBridge.ts.
import {
  sniffFilarrFile,
  readContainerHeader,
  readContainerMetadata,
  openContainerToTemp,
  listFolderContainer,
  extractOneEntryToTemp,
  BOX_KIND_FILE,
  BOX_KIND_FOLDER,
} from './filarrContainer';
import {
  ERR_BOX_LOCKED,
  performProtectInPlace,
  rewriteFileContainer,
  extractAllEntries,
  unprotectContainer,
  suffixedPlainPath,
} from './filarrBox';
import { ProtectedRegistry } from './protectedRegistry';
// Wave 2b — Explorer right-click « Protéger avec Filarr » (HKCU shell verbs
// written by buildResources/installer.nsh). Pure argv parsing + multi-select
// burst coalescing, no Electron deps (unit-tested standalone like
// streamProtocol.ts); the delivery wiring lives below near
// forwardFilarrFileOpen.
import { parseProtectPaths, createProtectCoalescer } from './shellProtectArgs';
import { parseInviteUri, findProtocolUriInArgv, type InviteUriPayload } from './inviteProtocol';
// Hoisted from the bottom of the file: TypeScript emits CommonJS
// `require` calls in source order, not hoisted to the top. With these
// imports living mid-file, the `const X_1 = require(…)` declarations
// landed AFTER `app.on('ready', startApp)`, so if Electron fired the
// ready event early (or before the rest of the module finished
// loading), startApp hit a TDZ for `extensionBridge_1`. Keeping all
// `./` imports up here makes the order deterministic.
import {
  argon2Hash,
  argon2Verify,
  argon2DeriveKey,
  argon2RawDerive,
  type Argon2RawRequest,
} from './argon2Service';
import * as custodyService from './custodyService';
import { extensionBridge, EXTENSION_BRIDGE_ENABLED } from './extensionBridge';
import * as credentialStore from './credentialStore';
import {
  buildConnectorRequest,
  CONNECTOR_MAX_RESPONSE_BYTES,
  CONNECTOR_TIMEOUT_MS,
} from './connectors/connectorSourcesCore';
import dotenv from 'dotenv';
import { auditGate, installVaultLockGate } from './vaultLockGate';
import {
  awaitRendererLockReport,
  isVaultLockedForDisplay,
  noteProfileSwitch,
  noteSessionKeyCleared,
  noteSessionKeySet,
  noteVaultLockedByMain,
  reportRendererLockState,
} from './vaultLockState';

dotenv.config({ path: path.join(__dirname, '.env') });

/**
 * LA PORTE, POSÉE AVANT TOUT LE RESTE.
 *
 * `installVaultLockGate` enrobe `ipcMain.handle` : seuls les canaux enregistrés
 * APRÈS cet appel sont gardés. Il doit donc rester la première instruction du
 * corps du module — le premier `ipcMain.handle` arrive quelques centaines de
 * lignes plus bas, et tout déplacement vers le bas rouvrirait silencieusement
 * ce qui aurait été enregistré entre-temps.
 */
installVaultLockGate(ipcMain);

const isDev = !app.isPackaged;

// Use separate userData in dev to avoid conflicts with installed production app
if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), 'filarr-dev'));
}

// Active profile tracking
let activeProfileId: string | null = null;

/**
 * Get the base data directory for the active profile.
 * Falls back to legacy FilarData/ if no profile is active (shouldn't happen).
 */
function getActiveProfileDataDir(): string {
  if (activeProfileId) {
    return profileManager.getProfileDataDir(activeProfileId);
  }
  return path.join(app.getPath('userData'), 'FilarData');
}

/**
 * Window state interface
 * @description Used by electron-store to persist window state
 * This interface is used indirectly by electron-store for type checking
 */
// @ts-ignore: WindowState is used by electron-store internally
interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

/**
 * Notification settings interface
 */
interface NotificationSettings {
  enabled: boolean;
  sound: boolean;
  delay: number;
}

/**
 * Notification messages structure
 */
interface NotificationMessages {
  reminderNotifications: {
    title: string[];
    missedReminder: string[];
  };
}

/**
 * Reminder interface
 */
interface Reminder {
  id: string;
  description?: string;
  message?: string;
  date: string;
  isRead?: boolean;
  read?: boolean;
  isCompleted?: boolean;
  completed?: boolean;
  itemId?: string;
  itemName?: string;
  itemType?: string;
  priority?: 'low' | 'normal' | 'high';
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly';
  snoozedUntil?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Folder interface
 */
interface Folder {
  id: string;
  name: string;
  items: Item[];
  color?: string;
  parentId?: string | null;
  protected?: boolean;
  password?: string;
  createdAt?: string;
  updatedAt?: string;
  reminders?: Reminder[];
  deletedAt?: string;
  /** Étiquettes des fichiers, à plat — voir `storageService.Folder.fileTags`. */
  fileTags?: Record<string, string[]>;
}

/**
 * Item interface
 */
interface Item {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  date?: string;
  description?: string;
  priority?: string;
  protected?: boolean;
  password?: string;
  parentId?: string | null;
  color?: string;
  items?: Item[];
  reminders?: Reminder[];
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  content?: Buffer | string;
}

/**
 * File upload interface
 */
interface FileUpload {
  name: string;
  content: Buffer | string;
}

/**
 * Download item request interface
 */
interface DownloadItemRequest {
  folderId: string;
  itemId: string;
  savePath: string;
  password?: string;
}

// Configure logging for autoUpdater
autoUpdater.logger = log;
(autoUpdater.logger as typeof log).transports.file.level = 'info';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let updateDownloaded = false;
// La derniere version vue par l'updater (disponible ou telechargee) : ce que
// le bouton « Rechercher une mise a jour » rend quand tout est deja fait.
let updateVersionSeen = '';

// ---- Window bounds persistence ----
interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}
const windowBoundsPath = path.join(app.getPath('userData'), 'window-bounds.json');

function loadWindowBounds(): Partial<WindowBounds> {
  try {
    return JSON.parse(fsSync.readFileSync(windowBoundsPath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveWindowBounds(): void {
  if (!mainWindow) return;
  const isMaximized = mainWindow.isMaximized();
  // Save the restored (non-maximized) bounds so we can restore to the right size
  const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  try {
    fsSync.writeFileSync(windowBoundsPath, JSON.stringify({ ...bounds, isMaximized }));
  } catch {
    /* non-critical */
  }
}
let notificationMessages: NotificationMessages | null = null;
let notificationSettings: NotificationSettings = {
  enabled: true,
  sound: true,
  delay: 15,
};

// ==================== TEMP FILE CLEANUP ====================
// Temp plaintext lifecycle now lives in tempFileRegistry.ts: same
// scheduleTempCleanup(tempPath) API as before (5 min delay), plus watcher
// tracking so a purge can close the chokidar re-encrypt watchers before
// wiping, plus purgeAllTempFiles() for the manual/lock-time purge.

/**
 * Secure-purges every known temp plaintext location:
 *  - all live tracked temp files (open-with-app, drag-out, reveal, previews);
 *  - the app-owned staging dirs (filarr-drag/, filarr-reveal/) — catches
 *    leftovers from crashed sessions;
 *  - vault_<timestamp>_* preview files in the OS temp root (openVaultFile
 *    naming pattern — specific enough to never touch foreign files).
 * Limitation (honest): openFile/openEncryptedFile write into the temp ROOT
 * under the file's original name; after a crash those cannot be recognized
 * and are only covered while tracked in the live registry.
 */
function purgeTempPlaintext(): Promise<PurgeResult> {
  const tempRoot = app.getPath('temp');
  return purgeAllTempFiles({
    sweepDirs: [
      path.join(tempRoot, 'filarr-drag'),
      path.join(tempRoot, 'filarr-reveal'),
      // Les temporaires d'« ouvrir avec l'application systeme ». Ils vivaient
      // dans la racine de %TEMP% sous le nom brut : hors de ce balayage, donc
      // survivants a un plantage, en clair, indefiniment.
      path.join(tempRoot, 'filarr-open'),
    ],
    patternSweeps: [
      { dir: tempRoot, pattern: /^vault_\d{10,}_/ },
      // Wave 2 protected-container temp copies (filarrbox_<ts>_<rand>_<name>)
      // — catches leftovers from crashed sessions like the vault_ pattern.
      { dir: tempRoot, pattern: /^filarrbox_\d{10,}_/ },
    ],
  });
}

// Cleanup all remaining temp files on app quit + release global hotkeys.
// Electron does NOT await async 'will-quit' handlers — without preventDefault
// the process can exit mid-purge and leave plaintext on disk. Same
// intercept-once-then-requit pattern as the Enhanced Lock cleanup in
// 'before-quit'; bounded so a wedged file handle can never block quit.
let quitTempPurgeDone = false;
app.on('will-quit', (event) => {
  unregisterAllHotkeys();
  if (quitTempPurgeDone) return;
  event.preventDefault();
  void (async () => {
    try {
      await Promise.race([
        purgeTempPlaintext(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 15_000).unref();
        }),
      ]);
    } catch {
      /* best-effort on quit */
    }
    quitTempPurgeDone = true;
    app.quit();
  })();
});

// ==================== DESKTOP PROTECTION STATE ====================
// Settings are mirrored by the renderer into filarr-flags.json under the
// 'desktop-protection' key (main cannot read Redux); loaded in startApp and
// re-applied live when the renderer writes that key via 'flag:set' (plus the
// dedicated 'app:setGlobalHotkey' fast path for shortcut changes).
let desktopSettings: DesktopProtectionSettings = { ...DEFAULT_DESKTOP_PROTECTION_SETTINGS };
let hotkeyStatus: HotkeyStatus | null = null;
// L'état de verrouillage a quitté ce fichier : il vit dans `vaultLockState`,
// parce qu'il a maintenant DEUX lecteurs aux exigences opposées — le tray, qui
// préfère un cadenas de trop, et la porte IPC, qui ne doit jamais refuser une
// lecture légitime au démarrage. Les deux lectures sont nommées là-bas
// (`isVaultLockedForDisplay` / `isVaultLocked`), avec la raison de leur écart.
// Sync status cache so the tray menu can be rebuilt from ANY trigger
// (lock change, recent-files update) without losing the sync info.
let cachedSyncStatus: { conflicts?: number; failedItems?: number; state?: string } = {};
// Recently protected vault items, recorded main-side on every path-based
// import (drag-in, mini-mode drop, tray picker, move-into-vault). Names
// only — no plaintext content is ever cached here. Cleared on profile
// switch; hidden from the tray while the vault is locked.
interface RecentProtectedEntry {
  id: string;
  name: string;
  folderId: string;
  size?: number;
  protectedAt: string; // ISO
}
const RECENT_PROTECTED_LIMIT = 8;
let recentFilesCache: RecentProtectedEntry[] = [];

/**
 * Validates that a folderId is a safe directory name (UUID or simple alphanumeric).
 * Prevents path traversal via folderId parameters in hybrid storage handlers.
 */
function sanitizeFolderId(folderId: string): string {
  if (!folderId || typeof folderId !== 'string') {
    throw new Error('Invalid folderId');
  }
  // Allow UUIDs, simple alphanumeric names, and hyphens/underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(folderId)) {
    throw new Error('Invalid folderId: contains disallowed characters');
  }
  return folderId;
}

/**
 * Sanitizes user input to prevent path traversal attacks
 */
function sanitizePath(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid path input');
  }

  // Remove any path traversal attempts
  const cleaned = input.replace(/\.\./g, '');

  // Get only the basename (filename) to prevent directory traversal
  const basename = path.basename(cleaned);

  // Additional security: reject if still contains suspicious characters
  if (basename.includes('/') || basename.includes('\\')) {
    throw new Error('Invalid characters in path');
  }

  return basename;
}

/**
 * Load notification messages
 */
async function loadNotificationMessages(): Promise<void> {
  // Try dist-electron/locales first (runtime), then electron/locales (dev source)
  const candidates = [
    path.join(__dirname, 'locales', 'notificationMessages.json'),
    path.join(__dirname, '..', 'electron', 'locales', 'notificationMessages.json'),
  ];

  for (const filePath of candidates) {
    try {
      const rawData = await fs.readFile(filePath, 'utf8');
      notificationMessages = JSON.parse(rawData);
      return;
    } catch {
      // Try next candidate
    }
  }

  // Fallback: getRandomMessage() already handles null notificationMessages
  log.warn('[main] notificationMessages.json not found, using fallback messages');
}

/**
 * Get random message from category
 */
function getRandomMessage(category: 'title' | 'missedReminder'): string {
  if (!notificationMessages) {
    return category === 'title' ? 'Filarr - Reminder' : 'Missed Reminder';
  }
  const messages = notificationMessages.reminderNotifications[category];
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Show notification
 */
// `showNotification` has moved to reminderScheduler.ts (per-reminder
// notifications fire from there with click → focus + IPC to renderer).

/**
 * Load notification settings
 */
async function loadNotificationSettings(): Promise<void> {
  try {
    const settings = await StorageService.getNotificationSettings();
    notificationSettings = settings;
  } catch (error) {
    console.error('Error loading notification settings:', error);
  }
}

/**
 * Send the upcoming reminders summary to the renderer (in-app badge, list).
 * Notification scheduling itself is owned by reminderScheduler.
 */
async function pushUpcomingRemindersToRenderer(): Promise<void> {
  try {
    const manifest = profileManager.getManifest();
    if (!manifest.activeProfileId || manifest.profiles.length === 0) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const reminders = await StorageService.getAllReminders();
    const now = Date.now();
    const horizon = 24 * 60 * 60 * 1000; // next 24h
    // Include all overdue reminders + the next-24h slice. Overdues
    // need to stay visible in the sidebar badge even if they're days
    // old, otherwise the count drifts away from the /reminders page.
    const upcoming = reminders.filter((r) => {
      if (r.completed || r.isCompleted) return false;
      const fireAt = new Date(r.snoozedUntil ?? r.date).getTime();
      if (Number.isNaN(fireAt)) return false;
      return fireAt - now <= horizon; // past or within 24h
    });

    mainWindow.webContents.send('upcomingReminders', upcoming);
  } catch (error) {
    console.error('Error pushing upcoming reminders:', error);
  }
}

/**
 * Setup auto updater
 */
function setupAutoUpdater(): void {
  autoUpdater.logger = log;
  (autoUpdater.logger as typeof log).transports.file.level = 'info';

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://releases.filarr.com/latest',
  });

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...');
  });

  autoUpdater.on('update-available', (info: any) => {
    log.info('Update available.', info);
    updateVersionSeen = info?.version ?? updateVersionSeen;
    if (mainWindow) {
      mainWindow.webContents.send('update_available', { version: info.version });
    }
  });

  autoUpdater.on('update-not-available', (info: any) => {
    log.info('No update available.', info);
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('Error during update:', err);
  });

  autoUpdater.on('download-progress', (progressObj: any) => {
    if (mainWindow) {
      mainWindow.webContents.send('update_download_progress', {
        percent: Math.round(progressObj.percent),
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    log.info('Update downloaded', info);
    updateDownloaded = true;
    updateVersionSeen = info?.version ?? updateVersionSeen;
    if (mainWindow) {
      mainWindow.webContents.send('update_downloaded', { version: info.version });
    }
  });
}

/**
 * Check for updates
 */
function checkForUpdates(): void {
  log.info('Checking for updates...');
  try {
    autoUpdater.checkForUpdates();
  } catch (err) {
    log.error('Error checking for updates:', err);
  }
}

/**
 * Legacy echo for folder mutations the RENDERER itself initiated (saveFolder,
 * updateFolder, reminders, moveItem…). The renderer already owns the resulting
 * state for those, so this stays a pure notification on the camelCase channel:
 * no store listener re-fetches on it, and turning it into a re-fetch would
 * clear the files slice and re-query the cloud on every item-level mutation.
 */
function emitFoldersUpdated(): void {
  if (mainWindow) {
    mainWindow.webContents.send('foldersUpdated');
  }
}

/**
 * The folder tree changed MAIN-side, behind the renderer's back (tray / mini
 * mode protect imports). Nothing in the store knows about it, so we have to
 * ask for a full re-fetch: 'folders-updated' with an EMPTY payload is exactly
 * that signal (see setupIpcListeners in store/middleware/electronMiddleware —
 * empty payload ⇒ clearAll + getFolders). The camelCase channel above has zero
 * subscribers, which is why a file protected from the tray stayed invisible
 * until a manual reload — clicking it in the tray's "Protégés récemment" list
 * landed on OrphanFolderFallback. Both channels are sent: the dashed one for
 * the store, the legacy one in case some listener still rides it.
 */
function emitFoldersNeedRefetch(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('foldersUpdated');
    mainWindow.webContents.send('folders-updated', {});
  }
}

// ==================== TRAY (status-aware) ====================
// One menu builder + one refresh path so EVERY trigger (sync tick, lock
// change, recent-files update) rebuilds the same rich menu — the old code
// had two divergent builders and sync events silently erased extra items.

/**
 * Effective lock state for the tray badge. Honesty note: with Enhanced Lock
 * off, .fek_safe persists on disk — "verrouillé" gates the UI/session keys,
 * it does not make data on this machine cryptographically unreachable.
 */
function isVaultLockedForTray(): boolean {
  return isVaultLockedForDisplay(sessionKeyStore.hasSessionKey());
}

// Hand-authored brand icons (dot-and-stroke F / padlock — see
// buildResources/tray-*.svg). @2x siblings are picked up automatically by
// nativeImage for hi-dpi. Falls back to the legacy favicon if missing.
let trayIconUnlocked: Electron.NativeImage | null = null;
let trayIconLocked: Electron.NativeImage | null = null;

function loadTrayIcons(): void {
  const baseDir = app.isPackaged
    ? path.join(process.resourcesPath, 'public', 'icons', 'tray')
    : path.join(__dirname, '..', 'public', 'icons', 'tray');
  const fallbackPath = app.isPackaged
    ? path.join(process.resourcesPath, 'public', 'favicon-64.png')
    : path.join(__dirname, '..', 'public', 'favicon-64.png');
  const load = (name: string): Electron.NativeImage => {
    const img = nativeImage.createFromPath(path.join(baseDir, name));
    if (!img.isEmpty()) return img;
    return nativeImage.createFromPath(fallbackPath).resize({ width: 16, height: 16 });
  };
  trayIconUnlocked = load('tray-unlocked.png');
  trayIconLocked = load('tray-locked.png');
}

function showMainWindowFromTray(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function miniWindowConfig(): MiniWindowConfig {
  return {
    preloadPath: path.join(__dirname, 'preload.js'),
    loadUrl: app.isPackaged
      ? `${APP_SCHEME}://${APP_HOST}/index.html#/mini`
      : 'http://localhost:3000/#/mini',
    isDev,
    alwaysOnTop: () => desktopSettings.miniAlwaysOnTop,
    autoHideOnBlur: () => desktopSettings.miniAutoHideOnBlur,
    isQuitting: () => isQuitting,
    isSafeExternalUrl,
  };
}

function toggleMini(): void {
  toggleMiniWindow(miniWindowConfig());
}

/**
 * Délai au-delà duquel on efface la clé sans attendre le renderer. Assez large
 * pour couvrir une purge d'écriture normale (le debounce de l'auto-save est à
 * 2 s, mais il est ANNULÉ par la purge : ce qui reste, c'est l'écriture
 * elle-même), assez court pour qu'un verrouillage reste un verrouillage.
 */
const LOCK_FLUSH_ACK_TIMEOUT_MS = 3_000;

/**
 * Les déclencheurs pour lesquels on attend la purge du renderer. Voir plus bas :
 * ce sont ceux où la personne vient d'agir, donc peut-être de taper.
 */
const LOCK_REASONS_WORTH_WAITING_FOR = new Set(['tray', 'hotkey']);

/**
 * Verrouillage décidé par le MAIN (tray, raccourci global, powerMonitor,
 * inactivité). Doit tenir même si le renderer dort.
 *
 * L'ORDRE A CHANGÉ, et c'est tout l'intérêt de cette fonction.
 *
 * Avant, on effaçait la clé de session PUIS on prévenait le renderer. Sur un
 * profil hybride, la sauvegarde de notes que le debounce de l'auto-save retenait
 * n'avait alors plus de clé pour s'écrire : jusqu'à deux secondes de frappe
 * partaient en silence, sans le moindre message. On demande donc d'abord, on
 * attend l'accusé, et on efface ensuite.
 *
 * ET ON N'ATTEND PAS TOUJOURS. Attendre a un coût que le gain ne justifie que
 * pour un verrouillage DEMANDÉ par la personne : le tray et le raccourci
 * global, seuls moments où l'on vient littéralement de taper. Sur `suspend` et
 * `os-lock`, attendre laisserait la clé en mémoire pendant que la machine
 * s'endort ou se verrouille — exactement ce contre quoi ces déclencheurs
 * existent. Et sur `idle`, il n'y a rien à sauver : le debounce de deux
 * secondes a fini depuis des minutes, par définition de l'inactivité.
 *
 * Ce qui rend cette attente SÛRE plutôt que dangereuse, dans l'ordre :
 *
 *   1. la porte se ferme AVANT tout le reste. Pendant qu'on attend, plus aucune
 *      lecture de contenu ne passe par IPC — le coffre est déjà verrouillé du
 *      point de vue de quiconque demande quelque chose ;
 *   2. `notes:save` est délibérément hors des canaux gardés (voir
 *      `vaultLockGate`), donc la purge, elle, passe encore. C'est exactement ce
 *      que cette exception achète ;
 *   3. l'attente est bornée ET l'effacement inconditionnel. Fenêtre fermée,
 *      renderer planté, fenêtre mini seule (elle ne rapporte pas) : le délai
 *      expire et la clé part quand même. Un verrouillage qui n'efface pas serait
 *      pire que la frappe qu'on cherche à sauver.
 */
async function lockVaultFromMain(reason: string): Promise<void> {
  log.info('[desktop-protection] locking vault, reason:', reason);

  // 1. La porte, d'abord. Le reste de cette fonction peut prendre son temps.
  noteVaultLockedByMain();
  refreshTray();
  notifyMiniRefresh();

  // 2. Armer l'attente AVANT de diffuser : un renderer rapide rapporterait
  //    sinon entre la diffusion et l'armement, et on attendrait un accusé déjà
  //    passé jusqu'à l'échéance.
  const waitForFlush = LOCK_REASONS_WORTH_WAITING_FOR.has(reason);
  const ack = waitForFlush ? awaitRendererLockReport(LOCK_FLUSH_ACK_TIMEOUT_MS) : null;

  for (const win of [mainWindow, getMiniWindow()]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('vault:lock-request', { reason });
    }
  }

  // 3. Le renderer purge son écriture en attente, puis verrouille, puis
  //    rapporte : son rapport EST la preuve que le disque porte le travail.
  if (ack && (await ack) === 'timeout') {
    log.warn(
      `[desktop-protection] aucun accusé de verrouillage du renderer en ${LOCK_FLUSH_ACK_TIMEOUT_MS} ms (${reason}) — effacement de la clé quand même`
    );
  }

  // 4. Et seulement maintenant, les secrets.
  sessionKeyStore.clearSessionKey();
  // Le coffre de notes EN CLAIR que le main garde pour la sauvegarde
  // incrémentale suit exactement le sort de la clé de session : verrouiller
  // sans l'effacer laisserait les notes lisibles en mémoire du processus.
  forgetNotesVault();

  if (desktopSettings.purgeTempOnLock) {
    try {
      await purgeTempPlaintext();
    } catch (err) {
      log.warn('[desktop-protection] temp purge on lock failed:', err);
    }
  }
}

/** Tells the mini window (if open) to re-query lock state + recents. */
function notifyMiniRefresh(): void {
  const win = getMiniWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('mini:refresh');
  }
}

// ── "Protégés récemment" across restarts ───────────────────────────────────
// The list used to die with the process, so the tray came back empty after
// every restart. Persisting it is NOT free: these are vault file NAMES, i.e.
// plaintext metadata. The rule we hold to is that persisting them must never
// weaken a configuration the user chose:
//   • Enhanced Lock OFF → the app already leaves a key at rest on this machine
//     (`.fek_safe` is not wiped on quit), so names add no meaningful exposure.
//   • Enhanced Lock ON  → the vault is meant to be unreachable once quit. We
//     write nothing, and purge anything already stored.
// What is written is sealed with the OS keychain (safeStorage — the same seal
// as `.fek_safe`, so it is unreadable by another OS user) and stamped with the
// profile id: a decoy/duress profile must never inherit another profile's
// names, so a blob belonging to someone else is dropped, not shown.
const RECENT_PROTECTED_FLAG_KEY = 'desktop-recents';
let recentsPersistTimer: NodeJS.Timeout | null = null;

/** Enhanced Lock on, or no OS keychain to seal with ⇒ nothing may be written. */
async function mayPersistRecents(profileId: string): Promise<boolean> {
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    return !(await StorageService.getEnhancedLock(profileManager.getProfileDataDir(profileId)));
  } catch {
    return false; // Unknown lock posture ⇒ assume the strict one.
  }
}

function purgeStoredRecents(): void {
  try {
    const flags = readFlags();
    if (!(RECENT_PROTECTED_FLAG_KEY in flags)) return;
    delete flags[RECENT_PROTECTED_FLAG_KEY];
    writeFlags(flags);
  } catch (err) {
    log.warn('[desktop-protection] recents purge failed:', err);
  }
}

/**
 * Debounced writer — a 100-file drop calls recordRecentProtected 100 times and
 * we want one seal+write, not a hundred. Unref'd so a pending write can never
 * hold the process open at quit (losing the last second of it is fine).
 */
function schedulePersistRecents(): void {
  if (recentsPersistTimer) clearTimeout(recentsPersistTimer);
  recentsPersistTimer = setTimeout(() => {
    recentsPersistTimer = null;
    // Snapshot both halves of the pair NOW: the list and the profile it
    // belongs to must not be able to drift apart across the awaits below.
    const profileId = activeProfileId;
    const entries = recentFilesCache.slice();
    void (async () => {
      try {
        if (!profileId || !(await mayPersistRecents(profileId))) {
          purgeStoredRecents();
          return;
        }
        // A profile switch may have landed during that await: this snapshot
        // belongs to the outgoing profile, so drop it rather than seal it
        // under the incoming profile's identity.
        if (activeProfileId !== profileId) return;
        const sealed = safeStorage
          .encryptString(JSON.stringify({ profileId, entries }))
          .toString('base64');
        const flags = readFlags();
        flags[RECENT_PROTECTED_FLAG_KEY] = sealed;
        writeFlags(flags);
      } catch (err) {
        log.warn('[desktop-protection] recents persist failed:', err);
      }
    })();
  }, 1000);
  recentsPersistTimer.unref();
}

/**
 * Reads the sealed list back for `profileId`. Anything that is not an exact,
 * well-formed match yields an empty list — and a blob stamped with ANOTHER
 * profile is deleted on the spot rather than left lying around as idle
 * metadata. Consequence, by design: only the last profile used keeps its list.
 * The file is user-writable, so every field is re-validated here.
 */
function loadStoredRecents(profileId: string | null): RecentProtectedEntry[] {
  if (!profileId) return [];
  try {
    const sealed = readFlags()[RECENT_PROTECTED_FLAG_KEY];
    if (!sealed || !safeStorage.isEncryptionAvailable()) return [];
    const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
    if (!parsed || parsed.profileId !== profileId) {
      purgeStoredRecents();
      return [];
    }
    const entries: unknown[] = Array.isArray(parsed.entries) ? parsed.entries : [];
    return entries
      .filter((e): e is RecentProtectedEntry => {
        const c = e as Partial<RecentProtectedEntry> | null;
        return (
          !!c &&
          typeof c.id === 'string' &&
          typeof c.name === 'string' &&
          typeof c.folderId === 'string'
        );
      })
      .slice(0, RECENT_PROTECTED_LIMIT)
      .map((e) => ({
        id: e.id,
        name: e.name,
        folderId: e.folderId,
        size: typeof e.size === 'number' ? e.size : undefined,
        protectedAt: typeof e.protectedAt === 'string' ? e.protectedAt : new Date().toISOString(),
      }));
  } catch (err) {
    log.warn('[desktop-protection] recents restore failed:', err);
    return [];
  }
}

/**
 * Cold start and profile switch: drop the outgoing list AND any write still
 * pending for it — that write would otherwise be sealed under the INCOMING
 * profile's id, which is exactly the cross-profile leak we refuse.
 */
function loadRecentsForProfile(profileId: string | null): void {
  if (recentsPersistTimer) {
    clearTimeout(recentsPersistTimer);
    recentsPersistTimer = null;
  }
  recentFilesCache = loadStoredRecents(profileId);
}

/**
 * Records a path-based import in the "Protégés récemment" cache (tray
 * submenu + mini window list). Called from every import that starts from an
 * OS path — genuine "protect a file" gestures — never from buffer saves
 * (note edits would flood the list).
 */
function recordRecentProtected(folderId: string, name: string, size?: number): void {
  const id = `${folderId}/${name}`;
  recentFilesCache = [
    { id, name, folderId, size, protectedAt: new Date().toISOString() },
    ...recentFilesCache.filter((e) => e.id !== id),
  ].slice(0, RECENT_PROTECTED_LIMIT);
  refreshTray();
  notifyMiniRefresh();
  schedulePersistRecents();
}

// ── Main-side protect import (mini-mode drop zone + tray picker) ────────────
// The mini window has no Redux store, no folder tree and no metadata access:
// protecting a file from it must be a complete MAIN-side import. Folder
// metadata for local/hybrid profiles lives in StorageService (the renderer's
// local adapter calls the same addItemToFolder), so main can do the full
// job: encrypt + metadata + quota + sync notify, then tell the main-window
// renderer to re-fetch ('folders-updated' with an empty payload — see
// emitFoldersNeedRefetch). Limitation (honest): pure-cloud profiles keep their
// metadata in the cloud adapter — for them the imported blob lands local-only
// until the renderer next reconciles. Hybrid profiles ARE covered: their
// getFolders unions the cloud list with local-only folders (storageAdapter).

const DESKTOP_INBOX_FOLDER_NAME = 'Boîte de réception';

/**
 * Finds (or creates) the root-level inbox folder that mini-mode/tray
 * imports land in. Root folders have parentId null/undefined/'root'.
 */
async function ensureDesktopInboxFolder(): Promise<{ id: string; name: string }> {
  const folders = await StorageService.getFolders();
  const existing = folders.find(
    (f) =>
      !f.deletedAt && (!f.parentId || f.parentId === 'root') && f.name === DESKTOP_INBOX_FOLDER_NAME
  );
  if (existing) return { id: existing.id, name: existing.name };

  const now = new Date().toISOString();
  const folder = {
    id: crypto.randomUUID(),
    name: DESKTOP_INBOX_FOLDER_NAME,
    // Folder.color is non-optional renderer-side; this inbox is now actually
    // rendered (it used to be invisible), so give it the same default the
    // store applies to folders arriving from sync instead of a colorless tile.
    color: '#87CEEB',
    items: [],
    parentId: null,
    createdAt: now,
    updatedAt: now,
    reminders: [],
  };
  await StorageService.saveFolder(folder);
  await fs.mkdir(path.join(getActiveProfileDataDir(), folder.id), { recursive: true });
  return { id: folder.id, name: folder.name };
}

/** "photo.jpg" → "photo (2).jpg" until no blob with that name exists. */
async function uniqueVaultName(folderPath: string, rawName: string): Promise<string> {
  const base = sanitizePath(rawName);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let candidate = base;
  for (let i = 2; i < 1000; i++) {
    const exists = await fs
      .access(path.join(folderPath, candidate))
      .then(() => true)
      .catch(() => false);
    if (!exists) return candidate;
    candidate = `${stem} (${i})${ext}`;
  }
  throw new Error('Impossible de trouver un nom de fichier libre dans le coffre');
}

interface ProtectPathsResult {
  imported: number;
  failed: number;
  errors: string[];
}

/**
 * Imports a list of OS paths into the desktop inbox folder of the active
 * profile: streaming encrypt (session-FEK when loaded, machine-key V3
 * otherwise — same authoritative routing as saveEncryptedFileFromPath),
 * collision-safe naming, folder metadata, quota accounting, sync notify.
 * Never throws — per-file failures are collected so a partial batch still
 * lands.
 */
async function protectPathsIntoVault(paths: string[]): Promise<ProtectPathsResult> {
  const result: ProtectPathsResult = { imported: 0, failed: 0, errors: [] };
  if (isVaultLockedForTray()) {
    result.failed = paths.length;
    result.errors.push('Coffre verrouillé — déverrouillez Filarr avant de protéger des fichiers');
    return result;
  }

  let inbox: { id: string; name: string };
  try {
    inbox = await ensureDesktopInboxFolder();
  } catch (err) {
    log.warn('[desktop-protection] inbox folder creation failed:', err);
    result.failed = paths.length;
    result.errors.push('Impossible de préparer le dossier de réception du coffre');
    return result;
  }
  const folderPath = path.join(getActiveProfileDataDir(), inbox.id);
  await fs.mkdir(folderPath, { recursive: true }).catch(() => {});

  for (const rawPath of paths) {
    try {
      const resolvedSource = path.resolve(String(rawPath || ''));
      const stat = await fs.stat(resolvedSource).catch(() => null);
      if (!stat || !stat.isFile()) {
        throw new Error(`Fichier introuvable : ${path.basename(resolvedSource)}`);
      }
      const sizeCheck = await StorageService.checkQuotaBeforeUploadFromPath(stat.size);
      if (!sizeCheck.allowed) {
        throw new Error(sizeCheck.reason || 'Fichier trop volumineux (max 5 Go)');
      }

      const name = await uniqueVaultName(folderPath, path.basename(resolvedSource));
      const destPath = path.join(folderPath, name);
      const useSessionFek = sessionKeyStore.hasSessionKey();
      const { origSize } = useSessionFek
        ? await StorageService.saveEncryptedFileFromPathFEK(resolvedSource, destPath)
        : await StorageService.saveEncryptedFileFromPathV3(resolvedSource, destPath);

      const now = new Date().toISOString();
      await StorageService.addItemToFolder(inbox.id, {
        id: crypto.randomUUID(),
        name,
        type: 'file',
        size: origSize,
        parentId: inbox.id,
        createdAt: now,
        updatedAt: now,
      });
      await StorageService.incrementStorageUsage(origSize);
      if (activeProfileId) {
        syncService.notifyFileChanged(activeProfileId, `${inbox.id}/${name}`);
      }
      recordRecentProtected(inbox.id, name, origSize);
      result.imported += 1;
    } catch (err) {
      result.failed += 1;
      const message = err instanceof Error ? err.message : 'Échec du chiffrement';
      result.errors.push(message);
      log.warn('[desktop-protection] protect import failed:', rawPath, message);
    }
  }

  if (result.imported > 0) {
    emitFoldersNeedRefetch();
    notifyMiniRefresh();
  }
  return result;
}

/** Tray "Protéger un fichier…": OS picker → full main-side import. */
async function protectFilesViaTray(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: 'Protéger des fichiers dans le coffre',
    buttonLabel: 'Protéger',
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  const res = await protectPathsIntoVault(result.filePaths);
  new Notification({
    title: 'Filarr',
    body:
      res.failed > 0
        ? `${res.imported} fichier(s) protégé(s), ${res.failed} en échec — ${res.errors[0] ?? ''}`
        : `${res.imported} fichier(s) protégé(s) dans « ${DESKTOP_INBOX_FOLDER_NAME} »`,
  }).show();
}

async function purgeTempFromTray(): Promise<void> {
  const res = await purgeTempPlaintext();
  new Notification({
    title: 'Filarr',
    body:
      res.errors > 0
        ? `Purge terminée : ${res.deleted} élément(s) supprimé(s), ${res.errors} en échec`
        : `Fichiers temporaires purgés (${res.deleted} élément(s))`,
  }).show();
}

function buildTrayMenu(): Electron.Menu {
  const locked = isVaultLockedForTray();
  const conflictCount = cachedSyncStatus.conflicts || 0;
  const hasIssues = conflictCount > 0 || (cachedSyncStatus.failedItems || 0) > 0;

  // No plaintext metadata (file names) on a locked tray menu.
  const recentItems: Electron.MenuItemConstructorOptions[] = locked
    ? [{ label: 'Coffre verrouillé', enabled: false }]
    : recentFilesCache.length === 0
      ? [{ label: 'Aucun fichier récent', enabled: false }]
      : recentFilesCache.map((item) => ({
          label: item.name.length > 40 ? `${item.name.slice(0, 37)}…` : item.name,
          click: () => {
            showMainWindowFromTray();
            mainWindow?.webContents.send('tray:open-recent', {
              id: item.id,
              name: item.name,
              folderId: item.folderId,
            });
          },
        }));

  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'Ouvrir Filarr', click: showMainWindowFromTray },
    { label: 'Mini-coffre', click: () => toggleMini() },
    { type: 'separator' },
    {
      label: 'Protéger un fichier…',
      enabled: !locked,
      click: () => {
        void protectFilesViaTray();
      },
    },
    { label: 'Fichiers récents', submenu: recentItems },
    { type: 'separator' },
    locked
      ? { label: 'Déverrouiller…', click: () => showMiniWindow(miniWindowConfig()) }
      : {
          label: 'Tout verrouiller',
          click: () => {
            void lockVaultFromMain('tray');
          },
        },
    {
      label: 'Purger les fichiers temporaires',
      click: () => {
        void purgeTempFromTray();
      },
    },
  ];

  if (hasIssues) {
    items.push({ type: 'separator' });
    items.push({
      label: `⚠ ${conflictCount} conflit(s) en attente`,
      click: showMainWindowFromTray,
    });
  }

  items.push({ type: 'separator' });
  items.push({
    label: 'Quitter',
    click: () => {
      isQuitting = true;
      app.quit();
    },
  });

  return Menu.buildFromTemplate(items);
}

/** Recomputes icon + tooltip + menu from the cached state. Idempotent. */
function refreshTray(): void {
  if (!tray) return;
  const locked = isVaultLockedForTray();
  const icon = locked ? trayIconLocked : trayIconUnlocked;
  if (icon) tray.setImage(icon);

  const conflictCount = cachedSyncStatus.conflicts || 0;
  const hasIssues = conflictCount > 0 || (cachedSyncStatus.failedItems || 0) > 0;
  const suffix = hasIssues
    ? ` · ${conflictCount} conflit(s)`
    : cachedSyncStatus.state === 'syncing'
      ? ' · Synchronisation…'
      : '';
  tray.setToolTip(`Filarr — ${locked ? 'Coffre verrouillé' : 'Coffre déverrouillé'}${suffix}`);
  tray.setContextMenu(buildTrayMenu());
}

/**
 * Create system tray icon with context menu.
 * Left-click toggles the mini-mode window; double-click opens the full app.
 */
function createTray(): void {
  loadTrayIcons();
  const initialIcon = isVaultLockedForTray() ? trayIconLocked : trayIconUnlocked;
  tray = new Tray(initialIcon ?? nativeImage.createEmpty());
  refreshTray();

  // Left-click → mini-mode. A double-click emits click first: the first
  // click toggles the mini window ON, the second toggles it OFF, then
  // double-click shows the main window — net effect is exactly "main
  // window shown, mini hidden", so both gestures stay coherent.
  tray.on('click', () => toggleMini());
  tray.on('double-click', () => showMainWindowFromTray());
}

function updateTrayForSync(status: {
  conflicts?: number;
  failedItems?: number;
  state?: string;
}): void {
  cachedSyncStatus = status;
  refreshTray();
}

/**
 * (Re)registers the two global shortcuts from the current settings.
 * Registration can fail silently at the OS level (combo owned by another
 * app) — the resulting status is returned by 'app:setGlobalHotkey' so the
 * Settings screen can tell the user instead of pretending it worked.
 */
function applyDesktopHotkeys(): void {
  hotkeyStatus = applyHotkeys(desktopSettings, {
    toggleMini: () => toggleMini(),
    lockVault: () => {
      if (!isVaultLockedForTray()) void lockVaultFromMain('hotkey');
    },
  });
}

/**
 * Routes a double-clicked .filarr file to the renderer ('filarr-file-opened').
 * The renderer decides what a .filarr container means (import/inspect) —
 * main only validates the extension and never touches the content.
 * macOS fires app.on('open-file') BEFORE the window exists on a cold start:
 * such paths are queued and flushed by flushPendingFilarrOpen() right after
 * createWindow().
 */
let pendingFilarrOpenPath: string | null = null;

function forwardFilarrFileOpen(filePath: string): void {
  const resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().endsWith('.filarr')) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingFilarrOpenPath = resolved;
    return;
  }
  const send = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindowFromTray();
      mainWindow.webContents.send('filarr-file-opened', { path: resolved });
    }
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

/**
 * Route un `.filarrlayout` double-cliqué vers le renderer, qui en montre
 * l'APERÇU — jamais une application automatique.
 *
 * MÊME MÉCANIQUE que `forwardFilarrFileOpen` ci-dessus, et pour la même raison :
 * un démarrage à froid livre le chemin AVANT que la fenêtre existe. Le chemin
 * attend donc dans `pendingLayoutOpenPath`, que le renderer réclame à
 * l'affichage de l'accueil (`layouts:takePendingOpen`) — l'attente ne peut pas
 * se résoudre par un simple `did-finish-load` comme pour `.filarr`, parce que
 * l'écran qui sait présenter un modèle n'est pas forcément celui qui est monté
 * au chargement.
 *
 * Le contenu n'est PAS lu ici : le principal ne connaît pas ce format, et il
 * n'a aucune raison de l'apprendre (voir les gestionnaires `layouts:*`).
 */
let pendingLayoutOpenPath: string | null = null;

function forwardLayoutFileOpen(filePath: string): void {
  const resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().endsWith('.filarrlayout')) return;
  pendingLayoutOpenPath = resolved;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const send = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindowFromTray();
      mainWindow.webContents.send('filarr-layout-opened', { path: resolved });
    }
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

/** Delivers a .filarr open that arrived before the window existed (macOS). */
function flushPendingFilarrOpen(): void {
  if (pendingFilarrOpenPath) {
    const pending = pendingFilarrOpenPath;
    pendingFilarrOpenPath = null;
    forwardFilarrFileOpen(pending);
  }
}

/**
 * Route une invitation reçue par `filarr://` vers le renderer.
 *
 * MÊME MÉCANIQUE QUE forwardFilarrFileOpen, et pour la même raison : une
 * activation à froid arrive AVANT que la fenêtre existe, si bien qu'un
 * `webContents.send` tomberait dans le vide. L'invitation attend donc dans
 * `pendingInviteUri` et part au premier flush — ce n'est pas un cas rare mais le
 * cas NOMINAL : on clique le lien de l'e-mail quand l'application est fermée.
 *
 * Le renderer, lui, ne fait qu'armer le porteur : accepter exige une session ET
 * la clé privée, et l'écran d'acceptation ne peut vivre qu'après déverrouillage.
 */
let pendingInviteUri: InviteUriPayload | null = null;

function forwardInvite(payload: InviteUriPayload): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingInviteUri = payload;
    return;
  }
  const send = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindowFromTray();
      mainWindow.webContents.send('deep-link-invite', payload);
    }
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

/** Délivre une invitation arrivée avant que la fenêtre n'existe. */
function flushPendingInvite(): void {
  if (pendingInviteUri) {
    const pending = pendingInviteUri;
    pendingInviteUri = null;
    forwardInvite(pending);
  }
}

// ── Wave 2b: Explorer right-click « Protéger avec Filarr » ──────────────────
// The NSIS installer writes HKCU shell verbs (buildResources/installer.nsh)
// that launch `Filarr.exe --protect "<path>"`. Windows runs a classic verb
// ONCE PER SELECTED ITEM, so a multi-select produces a burst of
// second-instance events each carrying one path — the coalescer debounces
// them (SHELL_PROTECT_DEBOUNCE_MS) so the renderer opens ONE
// ProtectInPlaceDialog listing all paths ('shell:protect-request').
// Flushed paths wait in pendingShellProtectPaths until the window exists AND
// the vault is unlocked; the unlock reporters (sync:setSessionKey /
// vault:renderer-lock-state below) replay them — same pattern as the pending
// .filarr open above.
let pendingShellProtectPaths: string[] = [];

const shellProtectCoalescer = createProtectCoalescer((paths) => {
  for (const p of paths) {
    const resolved = path.resolve(p);
    if (!pendingShellProtectPaths.includes(resolved)) {
      pendingShellProtectPaths.push(resolved);
    }
  }
  deliverPendingShellProtect();
});

function deliverPendingShellProtect(): void {
  if (pendingShellProtectPaths.length === 0) return;
  // No window yet (burst arrived mid-startup): keep pending — replayed by
  // the unlock reporters once the renderer is up and the vault opens.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => deliverPendingShellProtect());
    return;
  }
  // Pop the app up either way: unlocked → protect dialog; locked → the
  // unlock screen, and the paths replay on the unlock report.
  showMainWindowFromTray();
  if (isVaultLockedForTray()) return;
  const paths = pendingShellProtectPaths;
  pendingShellProtectPaths = [];
  mainWindow.webContents.send('shell:protect-request', { paths });
}

/**
 * La hauteur de la bande native de fenêtre.
 *
 * C'est le SEUL endroit du produit où ce nombre existe. Le renderer ne le
 * connaît plus : il le mesure par `env(titlebar-area-*)`, que cette option
 * active (voir src/renderer/styles/chrome.css). Le changer ici suffit.
 */
const TITLEBAR_HEIGHT = 40;

/**
 * Create main window
 */
function createWindow(): void {
  // Resolve icon path for both dev and packaged
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'public', 'logo512.png')
    : path.join(__dirname, '..', 'public', 'logo512.png');

  // Restore saved window position & size (or use defaults)
  const saved = loadWindowBounds();
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: saved.width || 900,
    height: saved.height || 680,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    // Frameless with native window controls overlay (like VS Code / Obsidian)
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 12, y: 12 },
          // `titleBarOverlay` ne PEINT rien ici — `color` et `symbolColor` sont
          // @platform win32,linux et macOS les ignore. Il n'active QUE la
          // mesure : sans lui, `env(titlebar-area-*)` n'existe pas sur macOS et
          // le renderer ne peut pas savoir que les feux sont à GAUCHE. On passe
          // un objet plutôt que `true` : la forme booléenne laisse la hauteur
          // au conteneur des feux (~26 px) et rétrécirait la bande de
          // déplacement, aujourd'hui de 40 px sur toutes les plateformes.
          titleBarOverlay: { height: TITLEBAR_HEIGHT },
        }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: 'rgba(0,0,0,0)',
            symbolColor: '#888888',
            height: TITLEBAR_HEIGHT,
          },
        }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    // Stay hidden when launched via the OS login item with the --hidden
    // flag, so the user doesn't get a window flash on every boot. The tray
    // icon still appears and reminders still fire from the background.
    // startInTray ("Démarrer réduit dans la zone de notification") extends
    // the same behavior to every launch — desktopSettings is loaded from
    // filarr-flags.json BEFORE createWindow() runs (see startApp).
    show: !process.argv.includes('--hidden') && !desktopSettings.startInTray,
  };

  // Only set position if we have saved coordinates (otherwise let OS center it)
  if (saved.x !== undefined && saved.y !== undefined) {
    windowOptions.x = saved.x;
    windowOptions.y = saved.y;
  } else {
    windowOptions.center = true;
  }

  mainWindow = new BrowserWindow(windowOptions);
  downloadsWatcherService.attachWindow(mainWindow);
  hotFoldersService.attachWindow(mainWindow);
  clipperBridge.setMainWindow(mainWindow);

  // Maximize if it was maximized when closed
  if (saved.isMaximized) {
    mainWindow.maximize();
  }

  // Packaged builds load over app://filarr.app instead of file:// so the
  // renderer has a real secure origin (WebAuthn for #7 hardware keys needs a
  // valid rp.id; file:// has none). The protocol handler is registered in
  // startApp() before createWindow() runs.
  mainWindow.loadURL(
    app.isPackaged ? `${APP_SCHEME}://${APP_HOST}/index.html` : 'http://localhost:3000'
  );

  // Security headers: Content Security Policy and other protections
  // `wss://api.filarr.com` est explicite : un WebSocket passe par connect-src, et
  // se reposer sur la correspondance https→wss de la spec CSP est un pari que
  // tous les moteurs ne tiennent pas. Sans lui, la salle de collaboration est
  // refusée en silence (le socket se ferme, la session reste « hors ligne »).
  const connectSrcDev =
    'http://localhost:3001 ws://localhost:3001 ws://127.0.0.1:28080 https://*.filarr-app.workers.dev https://api.filarr.com wss://api.filarr.com https://*.ingest.de.sentry.io';
  const connectSrcProd =
    'https://*.filarr-app.workers.dev https://api.filarr.com wss://api.filarr.com https://*.filarr.fr wss://*.filarr.fr https://*.ingest.de.sentry.io';
  const connectSrc = isDev ? connectSrcDev : connectSrcProd;

  // Allowed iframe embed domains — strip X-Frame-Options from their responses
  const allowedEmbedDomains = ['youtube-nocookie.com', 'youtube.com', 'player.vimeo.com'];

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url;
    const isEmbedDomain = allowedEmbedDomains.some((d) => url.includes(d));

    if (isEmbedDomain) {
      // Strip X-Frame-Options so iframes can render
      const headers = { ...details.responseHeaders };
      delete headers['X-Frame-Options'];
      delete headers['x-frame-options'];
      callback({ responseHeaders: headers });
      return;
    }

    // LA PAGE BAC À SABLE des greffons porte SES propres en-têtes — même
    // raison que worker.js côté web : DENY/frame-ancestors 'none' bloqueraient
    // l'encadrement même-origine, et élargir la CSP de l'APP ('unsafe-eval')
    // serait la mauvaise réponse. La meta-CSP de la page reste le filet de
    // fond si un chemin de service échappait au webRequest.
    if (new URL(url).pathname.endsWith('/plugin-sandbox.html')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; webrtc 'block'",
          ],
          'X-Content-Type-Options': ['nosniff'],
          'Referrer-Policy': ['no-referrer'],
        },
      });
      return;
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self';" +
            " script-src 'self' https://cdnjs.cloudflare.com;" +
            // unsafe-inline required for React inline style attributes — no nonce mechanism exists for style attrs
            // Mitigated by: contextIsolation + sandbox + DOMPurify on all dangerouslySetInnerHTML
            " style-src 'self' 'unsafe-inline';" +
            " img-src 'self' data: blob:;" +
            // blob:/data: keep the existing ArrayBuffer->objectURL previews
            // working; filarr-stream: is the ranged vault media protocol.
            " media-src 'self' blob: data: filarr-stream:;" +
            " font-src 'self' data: blob: *;" +
            ` connect-src 'self' ${connectSrc} https://www.googleapis.com https://gmail.googleapis.com;` +
            " worker-src 'self' blob: https://cdnjs.cloudflare.com;" +
            // 'self' : la page bac à sable des greffons (plugin-sandbox.html) —
            // sans lui, l'iframe est silencieusement bloquée sur desktop.
            " frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com;" +
            " object-src 'none';" +
            " base-uri 'self';" +
            " form-action 'self';" +
            " frame-ancestors 'none'",
        ],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
        'X-XSS-Protection': ['1; mode=block'],
        'Permissions-Policy': ['camera=(), microphone=(), geolocation=(), usb=()'],
        'Strict-Transport-Security': ['max-age=31536000; includeSubDomains'],
      },
    });
  });

  // ─── Security Hardening ───────────────────────────────────────────

  // Prevent navigation to external URLs (protects against XSS navigating away)
  /**
   * LE VERROU DESKTOP contre l'exfiltration par navigation du sous-cadre : la
   * CSP liste youtube/vimeo en frame-src (embeds média de l'hôte) — un greffon
   * bac à sable pourrait naviguer SON iframe vers une URL youtube porteuse de
   * données en query. La navigation des sous-cadres est bornée à l'app et aux
   * origines d'embed ; le cadre principal garde son propre garde will-navigate.
   */
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return;
    const u = details.url;
    const ok =
      u.startsWith(`${APP_SCHEME}://${APP_HOST}`) ||
      u.startsWith('http://localhost:3000') ||
      u.startsWith('https://www.youtube-nocookie.com') ||
      u.startsWith('https://www.youtube.com') ||
      u.startsWith('https://player.vimeo.com');
    if (!ok) {
      details.preventDefault();
      log.warn(`[sandbox] Blocked subframe navigation to: ${u.slice(0, 120)}`);
    }
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const allowedOrigins = [
      'file:',
      `${APP_SCHEME}://${APP_HOST}`,
      'http://localhost:3000',
      'http://localhost:3001',
    ];
    if (
      !allowedOrigins.some((origin) => navigationUrl.startsWith(origin)) &&
      parsedUrl.protocol !== 'file:'
    ) {
      event.preventDefault();
      log.warn(`Blocked navigation to: ${navigationUrl}`);
    }
  });

  // Block new window creation — open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    } else {
      log.warn(`[setWindowOpenHandler] Refused unsafe URL: ${String(url).slice(0, 120)}`);
    }
    return { action: 'deny' };
  });

  // Deny permission requests (camera, mic, geolocation, etc.)
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write', 'notifications'];
      callback(allowedPermissions.includes(permission));
    }
  );

  // Deny permission check requests
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write', 'notifications'];
    return allowedPermissions.includes(permission);
  });

  // ─── End Security Hardening ─────────────────────────────────────

  mainWindow.on('ready-to-show', async () => {
    await loadNotificationMessages();
    reminderScheduler.init({
      mainWindow,
      settings: { enabled: notificationSettings.enabled, sound: notificationSettings.sound },
      getDueTitle: () => getRandomMessage('title'),
      getMissedTitle: () => getRandomMessage('missedReminder'),
    });
    void pushUpcomingRemindersToRenderer();
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  if (!isDev) {
    mainWindow.setMenuBarVisibility(false);
  }

  // Persist window bounds on resize/move (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSaveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveWindowBounds, 500);
  };
  mainWindow.on('resize', debouncedSaveBounds);
  mainWindow.on('move', debouncedSaveBounds);

  mainWindow.on('close', (event) => {
    // Save bounds one last time before closing
    saveWindowBounds();
    // If an update is ready, quit fully so it installs silently (like VS Code / Obsidian)
    if (updateDownloaded) {
      isQuitting = true;
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    if (tray && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  syncService.setMainWindow(mainWindow);
  pairingService.setMainWindow(mainWindow);
  publishEngine.setMainWindow(mainWindow);

  // Reprise d'une migration de clé interrompue. Elle est déclenchée AVANT tout
  // déverrouillage de coffre : c'est le journal qui dit s'il faut reprendre, et
  // la reprise décide de la CLÉ. La lire après avoir chargé une clé serait la
  // lire trop tard — et un `*.next` trouvé sans journal est supprimé ici même,
  // parce que le journal fait foi, jamais le système de fichiers.
  void publishEngine
    .resumeOnStartup()
    .then((snapshot) => {
      if (snapshot) {
        log.info(`[publish] Migration reprise à l état ${snapshot.state}`);
      }
    })
    .catch((err) => log.error('[publish] Reprise impossible:', (err as Error).message));
}

// ── filarr-stream://media/<folderId>/<fileName> — vault media streaming ─────
// Serves decrypted vault bytes with HTTP Range semantics so <video>/<audio>
// can seek without materializing plaintext on disk. All decision logic
// (URL/range parsing, status/header computation, path containment) lives in
// ./streamProtocol.ts (pure, unit-tested); this handler only wires it to the
// filesystem and to StorageService (the master key never leaves that
// service). V3 files stream chunk-by-chunk with flat memory; legacy V1/V2
// blobs (<= 500 MB) are decrypted whole in RAM and served by slicing.
let activeMediaStreams = 0;

async function handleMediaStreamRequest(request: Request): Promise<Response> {
  const method = request.method;
  const rangeHeader = request.headers.get('range');

  const respond = (plan: StreamResponsePlan): Response =>
    new Response(null, { status: plan.status, headers: plan.headers });

  if (method !== 'GET') {
    return respond(
      planStreamResponse({
        method,
        fileName: '',
        rangeHeader,
        source: { state: 'unprobed' },
        activeStreams: activeMediaStreams,
      })
    );
  }

  const parsed = parseStreamUrl(request.url);
  if (!parsed.ok) {
    return new Response(null, { status: parsed.status });
  }

  // Cheap cap check BEFORE any decryption work (legacy probing below can
  // cost a full in-RAM decrypt).
  if (activeMediaStreams >= MAX_CONCURRENT_STREAMS) {
    return respond(
      planStreamResponse({
        method,
        fileName: parsed.fileName,
        rangeHeader,
        source: { state: 'unprobed' },
        activeStreams: activeMediaStreams,
      })
    );
  }

  // path.relative containment on top of the character validation done by
  // parseStreamUrl (same base dir resolution as readEncryptedFile).
  const resolved = resolveVaultFilePath(
    getActiveProfileDataDir(),
    parsed.folderId,
    parsed.fileName
  );
  if (!resolved) {
    return new Response(null, { status: 400 });
  }

  // Claim the slot SYNCHRONOUSLY after the cap check: with the increment
  // deferred past an await, a burst of parallel requests could all pass the
  // check while parked on the same await and blow past the cap (each V3
  // stream pins ~16 MiB of buffers). Every return below goes through the
  // finally-release unless the slot was handed to a live stream.
  activeMediaStreams++;
  let handedToStream = false;
  try {
    const exists = await fs
      .access(resolved)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return respond(
        planStreamResponse({
          method,
          fileName: parsed.fileName,
          rangeHeader,
          source: { state: 'missing' },
          activeStreams: activeMediaStreams - 1,
        })
      );
    }

    const meta = await StorageService.statDecryptedAuto(resolved);
    let source: StreamSource;
    let legacyPlain: Buffer | null = null;
    if (meta.format === 'v3') {
      source = { state: 'v3', plainSize: meta.plainSize };
    } else if (meta.encryptedSize > LEGACY_STREAM_MAX_BYTES + LEGACY_CONTAINER_OVERHEAD) {
      source = { state: 'legacy-too-large' };
    } else {
      legacyPlain = await StorageService.decryptFileAuto(resolved);
      source =
        legacyPlain.length > LEGACY_STREAM_MAX_BYTES
          ? { state: 'legacy-too-large' }
          : { state: 'legacy', plainSize: legacyPlain.length };
    }

    // activeStreams excludes this request (already counted above; the cap
    // itself was enforced before the increment).
    const plan = planStreamResponse({
      method,
      fileName: parsed.fileName,
      rangeHeader,
      source,
      activeStreams: activeMediaStreams - 1,
    });
    if ((plan.status !== 200 && plan.status !== 206) || !plan.window) {
      return respond(plan);
    }

    if (source.state === 'v3') {
      const nodeStream = await StorageService.createDecryptStreamAuto(resolved, {
        offset: plan.window.offset,
        length: plan.window.length,
      });
      let released = false;
      const release = (): void => {
        if (!released) {
          released = true;
          activeMediaStreams--;
        }
      };
      // 'close' always follows end/destroy (autoDestroy), so the slot is
      // freed on normal completion, client abort, and decrypt failure alike.
      nodeStream.once('close', release);
      nodeStream.once('error', (err) => {
        log.error('[filarr-stream] V3 decrypt stream failed:', (err as Error).message);
        release();
      });
      handedToStream = true;
      try {
        const body = Readable.toWeb(nodeStream) as unknown as ConstructorParameters<
          typeof Response
        >[0];
        return new Response(body, { status: plan.status, headers: plan.headers });
      } catch (err) {
        // toWeb/Response failed after the slot was handed over: destroy the
        // stream so 'close' fires and release() frees the slot.
        nodeStream.destroy();
        throw err;
      }
    }

    if (!legacyPlain) {
      // Unreachable: legacy sources always populate legacyPlain above.
      return new Response(null, { status: 500 });
    }
    const slice = legacyPlain.subarray(plan.window.offset, plan.window.offset + plan.window.length);
    return new Response(slice, { status: plan.status, headers: plan.headers });
  } catch (error) {
    log.error('[filarr-stream] request failed:', (error as Error).message);
    return new Response(null, { status: 500 });
  } finally {
    if (!handedToStream) {
      activeMediaStreams--;
    }
  }
}

/**
 * Start application
 */
async function startApp(): Promise<void> {
  try {
    // Tous les handlers du corps du module sont enregistrés à ce stade : c'est
    // le seul moment où l'audit de la porte a un sens. `missing` non vide = un
    // canal gardé sur le papier que personne ne porte (renommé, mal
    // orthographié) — donc un trou, et le seul garde-fou contre une liste qui
    // pourrit en silence.
    const gate = auditGate();
    if (gate.missing.length > 0) {
      log.warn(
        `[vault-gate] ${gate.missing.length} canal(aux) gardé(s) introuvable(s) — liste à corriger : ${gate.missing.join(', ')}`
      );
    } else {
      log.info(`[vault-gate] ${gate.guarded.length} canaux gardés, tous enregistrés`);
    }
    // Register filarr:// as a default protocol client so Windows toast
    // notification actions and macOS open-url events can route back into
    // the app (handled via second-instance / open-url above). In dev,
    // electron-builder hasn't installed the registry entries, so this
    // call wires the running electron.exe as the handler — best-effort.
    try {
      if (process.defaultApp && process.argv.length >= 2) {
        // dev-mode launch: pass the entry script so Windows can replay it
        app.setAsDefaultProtocolClient('filarr', process.execPath, [path.resolve(process.argv[1])]);
      } else {
        app.setAsDefaultProtocolClient('filarr');
      }
    } catch (err) {
      log.warn('[protocol] setAsDefaultProtocolClient failed (non-fatal):', (err as Error).message);
    }

    // Serve the packaged renderer over app://filarr.app (see the
    // registerSchemesAsPrivileged block at the top of this file). Maps
    // app://filarr.app/<path> → build/<path> with a path-traversal guard;
    // anything else 404s. Registered in dev too (harmless — dev loads
    // localhost:3000) so the scheme behaves identically in both modes.
    const buildRoot = path.join(__dirname, '../build');
    protocol.handle(APP_SCHEME, (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== APP_HOST) {
          return new Response('Not found', { status: 404 });
        }
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/' || pathname === '') pathname = '/index.html';
        const resolved = path.resolve(path.join(buildRoot, pathname));
        if (resolved !== buildRoot && !resolved.startsWith(buildRoot + path.sep)) {
          return new Response('Forbidden', { status: 403 });
        }
        // net.fetch on a file: URL streams the file with proper MIME sniffing.
        return net.fetch(`file://${resolved.replace(/\\/g, '/')}`);
      } catch (err) {
        log.warn('[app-protocol] failed to serve', request.url, (err as Error).message);
        return new Response('Internal error', { status: 500 });
      }
    });

    // filarr-stream://media/... — decrypted vault media with Range support
    // (scheme privileges registered top-of-file, before app ready).
    protocol.handle(STREAM_SCHEME, (request) => handleMediaStreamRequest(request));

    // ── Desktop protection settings (Wave 1) ───────────────────────────
    // Mirrored by the renderer into filarr-flags.json (main cannot read
    // Redux). Loaded BEFORE createWindow so startInTray can suppress the
    // initial show; re-applied live when the renderer rewrites the flag.
    desktopSettings = parseDesktopSettings(readFlags()[DESKTOP_SETTINGS_FLAG_KEY]);

    // Show window immediately so the user sees the app loading
    createWindow();
    createTray();
    applyDesktopHotkeys();
    // A .filarr double-click that arrived before the window existed
    // (macOS 'open-file' fires very early on cold start).
    flushPendingFilarrOpen();
    // Idem pour une invitation reçue par filarr:// : sur une activation à froid
    // l'URI est lue au tout début de startApp, bien avant createWindow().
    flushPendingInvite();

    // Auto-lock on OS lock/suspend. Runs entirely main-side (session FEK
    // cleared + temps purged) so a throttled/asleep renderer cannot skip it.
    // 'lock-screen' fires on Windows/macOS only; 'suspend' covers Linux.
    powerMonitor.on('lock-screen', () => {
      if (desktopSettings.lockOnOsLock && !isVaultLockedForTray()) {
        void lockVaultFromMain('os-lock');
      }
    });
    powerMonitor.on('suspend', () => {
      if (desktopSettings.lockOnSuspend && !isVaultLockedForTray()) {
        void lockVaultFromMain('suspend');
      }
    });

    // OS-level idle lock (complements the renderer's in-app idle timer,
    // which cannot observe system-wide input). 30 s poll is cheap.
    setInterval(() => {
      if (!desktopSettings.idleLockEnabled || isVaultLockedForTray()) return;
      const idleSeconds = powerMonitor.getSystemIdleTime();
      if (idleSeconds >= desktopSettings.idleLockMinutes * 60) {
        void lockVaultFromMain('idle');
      }
    }, 30_000);

    // .filarr double-click while the app was NOT running: the path arrives
    // in this first instance's argv (second-instance handles the running
    // case; macOS uses app.on('open-file')).
    const coldStartFilarrFile = process.argv.find(
      (a) => typeof a === 'string' && !a.startsWith('-') && a.toLowerCase().endsWith('.filarr')
    );
    if (coldStartFilarrFile) {
      forwardFilarrFileOpen(coldStartFilarrFile);
    }

    // Idem pour un MODÈLE DE MISE EN PAGE. Le test d'extension est distinct de
    // celui du dessus : « .filarr » ne préfixe pas « .filarrlayout » du bon
    // côté, et `endsWith('.filarr')` ne l'attrape donc pas — les deux routages
    // ne peuvent pas se voler un fichier.
    const coldStartLayoutFile = process.argv.find(
      (a) =>
        typeof a === 'string' && !a.startsWith('-') && a.toLowerCase().endsWith('.filarrlayout')
    );
    if (coldStartLayoutFile) {
      forwardLayoutFileOpen(coldStartLayoutFile);
    }

    // Explorer « Protéger avec Filarr » while the app was NOT running: the
    // selected path arrives as `--protect <path>` in this first instance's
    // argv. On multi-select the extra Explorer-spawned processes land in the
    // second-instance handler — the shared coalescer merges both sources
    // into one protect dialog.
    const coldStartProtectPaths = parseProtectPaths(process.argv);
    if (coldStartProtectPaths.length > 0) {
      shellProtectCoalescer.add(coldStartProtectPaths);
    }

    // Activation par protocole alors que l'application était FERMÉE : l'URI
    // arrive dans l'argv de CETTE première instance. 'second-instance' n'est
    // jamais émis (c'est nous qui tenons le verrou) et 'open-url' est macOS
    // seulement — sans cette reprise, un clic sur le lien de l'e-mail application
    // fermée, c'est-à-dire le cas le plus fréquent, était perdu sans journal.
    const coldStartUri = findProtocolUriInArgv(process.argv);
    if (coldStartUri) {
      void handleProtocolUri(coldStartUri);
    }

    // Initialize backend services in parallel with UI rendering
    const baseDir = path.join(app.getPath('userData'), 'FilarData');
    await fs.mkdir(baseDir, { recursive: true });

    // Initialize profile system BEFORE StorageService
    const manifest = await profileManager.initialize();

    // Legacy migration: move pre-profile data into a default profile
    if (!manifest.migratedFromLegacy && (await profileManager.hasLegacyData())) {
      const migratedId = await migrateLegacyToDefaultProfile(profileManager, baseDir);
      activeProfileId = migratedId;
    } else if (manifest.activeProfileId) {
      activeProfileId = manifest.activeProfileId;
    } else if (manifest.profiles.length > 0) {
      activeProfileId = manifest.profiles[0].id;
    }

    // Initialize StorageService scoped to the active profile (if any)
    if (activeProfileId) {
      const profileDataDir = profileManager.getProfileDataDir(activeProfileId);
      await StorageService.initialize(profileDataDir);
    } else {
      // No profiles yet — initialize with default base dir (onboarding will create a profile)
      await StorageService.initialize();
    }

    // Desktop protection: bring back this profile's "Protégés récemment" list
    // (sealed in filarr-flags.json). The tray was built before the profile was
    // known, so ask it to redraw — it still hides the list while locked, which
    // at cold start it always is, so the names only surface after unlock.
    loadRecentsForProfile(activeProfileId);
    if (recentFilesCache.length > 0) refreshTray();

    log.info(
      `Application started, version: ${app.getVersion()}, activeProfile: ${activeProfileId ?? 'none'}`
    );

    // Non-blocking: load settings and check for updates
    loadNotificationSettings().catch(() => {});
    setupAutoUpdater();
    // Delay first update check to let the renderer mount its IPC listeners
    setTimeout(checkForUpdates, 10_000);
    setInterval(checkForUpdates, 4 * 60 * 60 * 1000); // Check for updates every 4 hours
    // Reminders: precise per-reminder timers are managed by reminderScheduler
    // (started on ready-to-show). We still push the in-app summary on a
    // slower cadence so the renderer's badge / list stays fresh even without
    // user action.
    setInterval(pushUpcomingRemindersToRenderer, 15 * 60 * 1000);

    // Start extension bridge WebSocket server (disabled until Password Manager ships)
    if (EXTENSION_BRIDGE_ENABLED && mainWindow) {
      extensionBridge.setMainWindow(mainWindow);
      extensionBridge.start();
    }

    // Bind auth artifacts to the active profile BEFORE initAuth so token
    // paths are correct + legacy-global tokens get migrated on first launch.
    (async () => {
      try {
        // Zone d'attente laissée par un « ajouter un compte » interrompu (crash,
        // fermeture) : elle contient une session que plus personne n'adoptera.
        // On l'efface avant tout — hors zone ouverte, discard ne fait que ça.
        await authService.discardPendingSession();
        if (activeProfileId) {
          await authService.setProfile(activeProfileId);
        }
        await authService.initAuth();

        const authStatus = await authService.getAuthStatus();
        if (authStatus.isAuthenticated && authStatus.accountMode === 'cloud' && activeProfileId) {
          // Wire StorageService callbacks for sync notifications. These fire
          // regardless of pause state — syncService's own guard (init'd or
          // not) decides whether a triggerSync actually runs.
          StorageService.setOnFolderSaved((folderId) => {
            if (activeProfileId) syncService.notifyMetadataChanged(activeProfileId, folderId);
          });
          StorageService.setOnFolderDeleted((folderId) => {
            if (activeProfileId) syncService.notifyFolderDeleted(activeProfileId, folderId);
          });
          StorageService.setOnFileDeleted((folderId, fileName) => {
            if (activeProfileId)
              syncService.notifyFileDeleted(activeProfileId, `${folderId}/${fileName}`);
          });
          // Les DEUX fichiers de rappels racine — rappels de note et rappels
          // libres. Ils ne voyageaient pas du tout : le rappel accroche a une
          // note restait sur l'appareil qui l'avait cree. Voir `reminderMetaDoc`.
          StorageService.setOnReminderStoreChanged((resourceId) => {
            if (activeProfileId) syncService.notifyMetadataChanged(activeProfileId, resourceId);
          });

          // Respect the persisted pause preference. Read the profile-scoped
          // key first, then the legacy global key for users updating from
          // a single-account build.
          const flags = readFlags();
          const perProfileKey = `sync-paused-${activeProfileId}`;
          const paused =
            flags[perProfileKey] !== undefined
              ? flags[perProfileKey] === 'true'
              : flags['sync-paused'] === 'true';
          if (paused) {
            log.info('[startApp] Sync service NOT started — user paused it');
          } else {
            syncService.init(activeProfileId);
            syncService.onStatusChange((status) => updateTrayForSync(status));
            log.info('[startApp] Sync service started for profile', activeProfileId);
          }
        }
      } catch (err) {
        log.error('[startApp] Auth/sync init failed:', err);
      }
    })();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

// ─── Global Security Hardening ───────────────────────────────────
// Prevent new webContents from being created with insecure settings
app.on('web-contents-created', (_event, contents) => {
  // Disable navigation in all webContents (the mini window is a first-class
  // app window — its hash navigation must not be blocked here).
  contents.on('will-navigate', (event, navigationUrl) => {
    if (contents !== mainWindow?.webContents && !isMiniWindowWebContents(contents)) {
      event.preventDefault();
      log.warn(`Blocked navigation in sub-webContents to: ${navigationUrl}`);
    }
  });

  // Prevent opening new windows from all webContents
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    } else {
      log.warn(`[app.setWindowOpenHandler] Refused unsafe URL: ${String(url).slice(0, 120)}`);
    }
    return { action: 'deny' };
  });
});

// Single instance lock — prevent multiple Filarr processes
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Someone tried to launch a second instance — focus the existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
    // The new process may have been launched by Windows in response to
    // a Toast notification action (filarr://reminder?action=…). The URI
    // arrives as one of the argv entries.
    const protocolArg = argv.find((a) => typeof a === 'string' && a.startsWith('filarr://'));
    if (protocolArg) void handleProtocolUri(protocolArg);

    // A double-clicked .filarr file (registered via build.fileAssociations)
    // arrives as a PLAIN PATH in argv — not a filarr:// URI.
    const filarrFileArg = argv.find(
      (a) => typeof a === 'string' && !a.startsWith('-') && a.toLowerCase().endsWith('.filarr')
    );
    if (filarrFileArg) forwardFilarrFileOpen(filarrFileArg);

    // Un modèle de mise en page double-cliqué pendant que l'application tourne.
    const layoutFileArg = argv.find(
      (a) =>
        typeof a === 'string' && !a.startsWith('-') && a.toLowerCase().endsWith('.filarrlayout')
    );
    if (layoutFileArg) forwardLayoutFileOpen(layoutFileArg);

    // Explorer « Protéger avec Filarr » (Wave 2b, HKCU verb): Windows spawns
    // one `--protect <path>` process PER selected item — each forwards its
    // argv here, and the coalescer debounces the burst into one dialog.
    // parseProtectPaths only consumes `--protect` pairs, so the .filarr and
    // filarr:// routings above are untouched.
    const protectPaths = parseProtectPaths(argv);
    if (protectPaths.length > 0) shellProtectCoalescer.add(protectPaths);
  });

  // macOS protocol activation (Windows uses argv via second-instance above)
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url.startsWith('filarr://')) void handleProtocolUri(url);
  });

  // macOS .filarr / .filarrlayout double-click (Finder file association)
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    forwardFilarrFileOpen(filePath);
    forwardLayoutFileOpen(filePath);
  });
}

/**
 * Parse a filarr:// URI received from an OS toast action and dispatch.
 * Supported routes (more can be added later):
 *   filarr://reminder?action=open&id=<reminderId>
 *   filarr://reminder?action=snooze&id=<reminderId>&type=<itemType>&item=<itemId>&min=<minutes>
 *   filarr://reminder?action=done&id=<reminderId>&type=<itemType>&item=<itemId>
 */
async function handleProtocolUri(uri: string): Promise<void> {
  try {
    // Invitation reçue par lien profond — le SEUL automatisme possible sur le
    // bureau, où le renderer charge app://filarr.app/index.html et n'a aucune URL
    // à lire. Traité avant le filtre ci-dessous, qui rendait muet tout hôte autre
    // que « reminder ».
    const invite = parseInviteUri(uri);
    if (invite) {
      forwardInvite(invite);
      return;
    }

    const parsed = new URL(uri);
    if (parsed.hostname !== 'reminder') {
      log.warn('[protocol] URI ignorée (hôte inconnu):', parsed.hostname);
      return;
    }
    const action = parsed.searchParams.get('action') || 'open';
    const reminderId = parsed.searchParams.get('id') || '';
    const itemId = parsed.searchParams.get('item') || '';
    const itemType = parsed.searchParams.get('type') || '';

    if (action === 'snooze') {
      const minutes = parseInt(parsed.searchParams.get('min') || '10', 10);
      if (itemId && reminderId) {
        await reminderScheduler.snoozeReminder(
          itemId,
          reminderId,
          Number.isFinite(minutes) ? minutes : 10,
          itemType || undefined
        );
        void pushUpcomingRemindersToRenderer();
      }
    } else if (action === 'done') {
      if (itemId && reminderId) {
        const update = {
          completed: true,
          isCompleted: true,
          updatedAt: new Date().toISOString(),
        };
        if (itemType === 'note') {
          await StorageService.updateNoteReminder(itemId, reminderId, update);
        } else {
          await StorageService.updateReminder(itemId, reminderId, update);
        }
        void reminderScheduler.rescheduleAll();
        void pushUpcomingRemindersToRenderer();
      }
    } else {
      // Default: focus the app + jump to the reminders page
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('reminder-clicked', {
          reminderId,
          itemId,
          itemType,
        });
      }
    }
  } catch (err) {
    log.warn('[protocol] failed to handle filarr:// URI:', (err as Error).message);
  }
}

app.on('ready', startApp);

ipcMain.on('restart_app', () => {
  autoUpdater.quitAndInstall(true, true); // silent install + relaunch
});

/**
 * Strictly validate a URL destined for shell.openExternal. Only http(s) is
 * ever passed through — this refuses file://, javascript:, data:, vbscript:,
 * as well as malformed inputs that would have tricked a startsWith check
 * (e.g. leading whitespace, unicode homoglyphs on the scheme).
 */
function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > 8192) return false;
  // Reject control chars that could confuse downstream parsers
  if (/[\u0000-\u001f\u007f]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * mailto:/tel: acceptés sur CE canal uniquement (clic explicite du renderer) :
 * le garde will-navigate bloque déjà toute navigation, ce canal est le seul
 * chemin légitime pour ces schémas. isSafeExternalUrl reste http(s)-only car
 * il protège aussi setWindowOpenHandler.
 */
function isSafeMailtoTelUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length >= 2048) return false;
  if (/[\u0000-\u001f\u007f]/.test(url)) return false;
  return /^mailto:\S+$/.test(url) || /^tel:[+\d().#*\- ]{1,64}$/.test(url);
}

ipcMain.on('open-external', (_event, url: string) => {
  if (isSafeExternalUrl(url) || isSafeMailtoTelUrl(url)) {
    shell.openExternal(url);
  } else {
    log.warn(`[open-external] Refused unsafe URL: ${String(url).slice(0, 120)}`);
  }
});

/**
 * Whether we've completed the async cleanup and can let the app exit.
 * Electron's `before-quit` does NOT wait for async handlers — the process
 * can exit before the promise resolves. To guarantee `.fek_safe` is wiped
 * when Enhanced Lock is active, we intercept the first quit attempt,
 * `preventDefault`, run cleanup, then call `app.quit()` again.
 */
let quitCleanupDone = false;

/** Le renderer a-t-il le droit de nous faire attendre ? Au-delà, on part sans. */
const RENDERER_FLUSH_BUDGET_MS = 2500;

/**
 * Au-delà de ce délai, la fermeture est TUÉE, purge ou pas.
 *
 * Ce n'est pas de la prudence décorative : tant que ce processus vit, il tient
 * le verrou d'instance unique (`requestSingleInstanceLock`). Un nettoyage qui
 * se coince ne perdrait pas seulement la remontée — il empêcherait de rouvrir
 * Filarr, en donnant l'impression que l'application ne démarre plus.
 */
const QUIT_HARD_DEADLINE_MS = 15000;

/**
 * DEMANDE AU RENDERER D'ÉCRIRE CE QU'IL RETIENT, ET ATTEND.
 *
 * L'auto-save des notes vit dans `App.tsx` derrière un debounce de 2 s. Le
 * `beforeunload` du renderer le vidait déjà, mais SANS être attendu de personne :
 * l'écriture partait dans le vide pendant que le processus mourait. Ici, le main
 * demande et attend l'accusé — la seule façon d'être sûr que `notes.enc` porte
 * la dernière frappe AVANT que la synchronisation ne le remonte.
 *
 * Toujours tenue, jamais rejetée : une fenêtre déjà détruite, un renderer figé
 * ou un accusé qui n'arrive pas rendent la main au budget. On perd alors ce que
 * le debounce retenait — exactement ce qui se passait avant — mais on ne bloque
 * pas la fermeture pour autant.
 */
function flushRendererNotes(): Promise<void> {
  const wc = mainWindow?.webContents;
  if (!wc || wc.isDestroyed()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('app:flush-notes:done', done);
      resolve();
    };
    const timer = setTimeout(() => {
      log.warn('[quit] Purge du renderer : pas d\'accusé dans le budget, on continue');
      done();
    }, RENDERER_FLUSH_BUDGET_MS);
    ipcMain.once('app:flush-notes:done', done);
    try {
      wc.send('app:flush-notes');
    } catch {
      done();
    }
  });
}

app.on('before-quit', (event) => {
  isQuitting = true;

  // Wave 2b — disarm the Explorer-protect debounce timer: a flush firing
  // during the async quit cleanup below would try to pop the main window
  // mid-teardown. Idempotent, safe on the before-quit re-fire.
  shellProtectCoalescer.cancel();

  // If we've already run cleanup, let this quit through.
  if (quitCleanupDone) return;

  authService.cleanup();

  // Aucun profil actif : rien à purger, rien à effacer.
  //
  // ⚠ LA CLÉ DE SESSION N'EST ZÉROISÉE QUE SUR LES CHEMINS QUI NE PURGENT PAS.
  // Sur l'autre, elle part juste après la purge (plus bas) : le dernier cycle
  // peut avoir à rechiffrer un blob V3-FEK, et la lui retirer d'abord le ferait
  // échouer en silence. Le report se compte en secondes, sur un processus qui
  // détenait déjà cette clé depuis le début de la session.
  if (!activeProfileId) {
    sessionKeyStore.clearSessionKey();
    syncService.stop();
    quitCleanupDone = true;
    return;
  }

  // Block the quit and run the flush + Enhanced Lock cleanup to completion.
  event.preventDefault();

  const profileId = activeProfileId;

  // Filet de dernier recours : quoi qu'il arrive en dessous, le processus part.
  const hardDeadline = setTimeout(() => {
    log.error('[quit] Échéance dure atteinte — sortie forcée');
    app.exit(0);
  }, QUIT_HARD_DEADLINE_MS);
  hardDeadline.unref?.();

  (async () => {
    // La fenêtre disparaît TOUT DE SUITE : pour l'utilisateur, l'application est
    // fermée. Ce qui suit se joue en coulisses, sans fenêtre qui s'attarde.
    try {
      mainWindow?.hide();
    } catch {
      /* fenêtre déjà détruite */
    }

    try {
      // 1. Ce que le renderer retient encore (debounce d'auto-save de 2 s).
      await flushRendererNotes();
      // 2. Ce que la synchronisation retenait (debounce de 10 s) — borné.
      await syncService.flushBeforeQuit(profileId);
    } catch (err) {
      log.error('[quit] Purge finale échouée (non bloquant):', err);
    }

    // 3. SEULEMENT MAINTENANT la clé de session part et le démon s'arrête.
    try {
      sessionKeyStore.clearSessionKey();
    } catch {
      /* idempotent */
    }
    syncService.stop();

    try {
      const profileDir = profileManager.getProfileDataDir(profileId);
      const enhanced = await StorageService.getEnhancedLock(profileDir);
      if (enhanced) {
        await StorageService.deleteFEKSafe();
        log.info('[security] Enhanced lock: .fek_safe deleted on quit');
      } else {
        log.debug('[security] Enhanced lock: flag off, no cleanup needed');
      }
    } catch (err) {
      log.error('[security] Enhanced lock cleanup failed:', err);
    } finally {
      clearTimeout(hardDeadline);
      // Mark done and re-trigger quit — this time `before-quit` runs again
      // but returns early because `quitCleanupDone === true`.
      quitCleanupDone = true;
      app.quit();
    }
  })();
});

/**
 * The renderer dying leaves no trace of its own — an out-of-memory abort is
 * not a catchable exception, so the window simply vanishes and the log ends
 * mid-sentence. Recording the reason here is the only way to tell an OOM
 * ('oom' / 'crashed') apart from a clean shutdown after the fact.
 */
app.on('render-process-gone', (_event, _webContents, details) => {
  log.error(
    `[render-process-gone] reason=${details.reason} exitCode=${details.exitCode}. ` +
      'If reason is "oom" or "crashed", the renderer exhausted its heap — check ' +
      'whether a bulk operation (import, export, bulk move) was running.'
  );
});

app.on('child-process-gone', (_event, details) => {
  log.error(
    `[child-process-gone] type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
  );
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ============================================
// IPC HANDLERS
// ============================================

// --- App Config ---
function getAppConfigPath(): string {
  if (activeProfileId) {
    return path.join(profileManager.getProfileDataDir(activeProfileId), 'appConfig.json');
  }
  return path.join(app.getPath('userData'), 'FilarData', 'appConfig.json');
}

// Synchronous version handler (used by preload via sendSync)
ipcMain.on('get-app-version', (event) => {
  event.returnValue = app.getVersion();
});

/**
 * « RECHERCHER UNE MISE A JOUR » — la verification a la demande.
 *
 * L'updater cherche seul au demarrage (10 s) puis toutes les quatre heures,
 * telecharge en silence et installe a la fermeture ; entre deux, rien ne le
 * disait — l'utilisateur ne pouvait ni declencher ni savoir. Ce canal rend
 * un VERDICT plutot que des evenements : a jour, disponible (le telechargement
 * demarre, le bandeau prend le relais), deja prete (il ne reste qu'a
 * redemarrer), ou l'erreur en clair. `checkForUpdates` rend null quand
 * l'application n'est pas empaquetee : « non pris en charge », pas une
 * erreur.
 */
ipcMain.handle('app:checkForUpdates', async () => {
  const current = app.getVersion();
  if (updateDownloaded) return { status: 'ready', version: updateVersionSeen, current };
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) return { status: 'unsupported', current };
    const version = result.updateInfo?.version ?? current;
    if (result.isUpdateAvailable) {
      updateVersionSeen = version;
      return { status: 'available', version, current };
    }
    return { status: 'up-to-date', version, current };
  } catch (err) {
    log.error('Manual update check failed:', err);
    return { status: 'error', current, error: (err as Error).message };
  }
});

// Persistent flags — stored on disk, survives localStorage resets
const flagsFilePath = path.join(app.getPath('userData'), 'filarr-flags.json');

function readFlags(): Record<string, string> {
  try {
    return JSON.parse(fsSync.readFileSync(flagsFilePath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeFlags(flags: Record<string, string>): void {
  fsSync.writeFileSync(flagsFilePath, JSON.stringify(flags, null, 2));
}

ipcMain.handle('flag:get', async (_event, key: string) => {
  return readFlags()[key] ?? null;
});

ipcMain.handle('flag:set', async (_event, key: string, value: string) => {
  const flags = readFlags();
  flags[key] = value;
  writeFlags(flags);

  // The renderer mirrors its "Protection du bureau" settings through this
  // existing channel (key 'desktop-protection') — apply them LIVE instead of
  // waiting for the next boot: hotkeys, powerMonitor gates, purge-on-lock,
  // mini window behavior. mergeDesktopSettings keeps main-only fields
  // (idle lock, mini window flags) that the renderer subset doesn't carry.
  if (key === DESKTOP_SETTINGS_FLAG_KEY) {
    let patch: unknown = null;
    try {
      patch = JSON.parse(value);
    } catch {
      patch = null;
    }
    if (patch) {
      desktopSettings = mergeDesktopSettings(desktopSettings, patch);
      applyDesktopHotkeys();
      applyMiniAlwaysOnTop(desktopSettings.miniAlwaysOnTop);
      refreshTray();
    }
  }
});

ipcMain.handle('flag:remove', async (_event, key: string) => {
  const flags = readFlags();
  delete flags[key];
  writeFlags(flags);
});

ipcMain.handle('getConfig', async () => {
  try {
    const data = await fs.readFile(getAppConfigPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
});

ipcMain.handle('saveConfig', async (_event: IpcMainInvokeEvent, config: Record<string, any>) => {
  try {
    const configPath = getAppConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving config:', error);
    throw error;
  }
});

// ───────────────────── Downloads Watcher ─────────────────────

async function loadDownloadsWatcherConfigFromDisk(): Promise<DownloadsWatcherConfig> {
  try {
    const data = await fs.readFile(getAppConfigPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed?.downloadsWatcher && typeof parsed.downloadsWatcher === 'object') {
      return {
        ...DEFAULT_DOWNLOADS_WATCHER_CONFIG,
        ...parsed.downloadsWatcher,
        sourceFolders: Array.isArray(parsed.downloadsWatcher.sourceFolders)
          ? parsed.downloadsWatcher.sourceFolders.filter((p: unknown) => typeof p === 'string')
          : [],
        extensionAllowList: Array.isArray(parsed.downloadsWatcher.extensionAllowList)
          ? parsed.downloadsWatcher.extensionAllowList.filter((e: unknown) => typeof e === 'string')
          : [],
      };
    }
  } catch {
    // Config doesn't exist yet — use defaults
  }
  return { ...DEFAULT_DOWNLOADS_WATCHER_CONFIG };
}

async function persistDownloadsWatcherConfig(config: DownloadsWatcherConfig): Promise<void> {
  const configPath = getAppConfigPath();
  let existing: Record<string, any> = {};
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    existing = JSON.parse(data);
  } catch {
    // No existing config — start fresh
  }
  existing.downloadsWatcher = config;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf-8');
}

ipcMain.handle('downloads-watcher:get-config', async () => {
  // Return live in-memory config (which reflects whatever was last applied),
  // falling back to disk if the service hasn't been hydrated yet.
  const live = downloadsWatcherService.getConfig();
  if (live.sourceFolders.length === 0 && !live.enabled && !live.inboxFolderId) {
    const fromDisk = await loadDownloadsWatcherConfigFromDisk();
    await downloadsWatcherService.setConfig(fromDisk);
    return downloadsWatcherService.getConfig();
  }
  return live;
});

ipcMain.handle(
  'downloads-watcher:set-config',
  async (_event: IpcMainInvokeEvent, next: Partial<DownloadsWatcherConfig>) => {
    const applied = await downloadsWatcherService.setConfig(next);
    await persistDownloadsWatcherConfig(applied);
    return applied;
  }
);

ipcMain.handle(
  'downloads-watcher:delete-source',
  async (_event: IpcMainInvokeEvent, sourcePath: string) => {
    if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
      throw new Error('sourcePath is required');
    }
    await downloadsWatcherService.deleteSource(sourcePath);
  }
);

ipcMain.handle('downloads-watcher:get-status', async () => {
  return downloadsWatcherService.getStatus();
});

ipcMain.handle(
  'downloads-watcher:notify-import-success',
  async (_event: IpcMainInvokeEvent, name: string) => {
    if (typeof name !== 'string' || name.length === 0) return;
    downloadsWatcherService.notifyImportSucceeded(name);
  }
);

ipcMain.handle('downloads-watcher:scan-now', async () => {
  return downloadsWatcherService.scanNow();
});

// ───────────────────── Hot Folders ─────────────────────

async function loadHotFoldersFromDisk(): Promise<HotFolderRule[]> {
  try {
    const data = await fs.readFile(getAppConfigPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed?.hotFolders)) {
      return parsed.hotFolders as HotFolderRule[];
    }
  } catch {
    // Config doesn't exist yet
  }
  return [];
}

async function persistHotFolders(rules: HotFolderRule[]): Promise<void> {
  const configPath = getAppConfigPath();
  let existing: Record<string, any> = {};
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    existing = JSON.parse(data);
  } catch {
    // No existing config
  }
  existing.hotFolders = rules;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf-8');
}

ipcMain.handle('hot-folders:list', async () => {
  const live = hotFoldersService.getRules();
  if (live.length === 0) {
    const fromDisk = await loadHotFoldersFromDisk();
    if (fromDisk.length > 0) {
      await hotFoldersService.setRules(fromDisk);
      return hotFoldersService.getRules();
    }
  }
  return live;
});

ipcMain.handle('hot-folders:get-statuses', async () => {
  return hotFoldersService.getStatuses();
});

ipcMain.handle(
  'hot-folders:set-rules',
  async (_event: IpcMainInvokeEvent, rules: HotFolderRule[]) => {
    if (!Array.isArray(rules)) throw new Error('rules must be an array');
    const applied = await hotFoldersService.setRules(rules);
    await persistHotFolders(applied);
    return applied;
  }
);

ipcMain.handle(
  'hot-folders:notify-import-success',
  async (
    _event: IpcMainInvokeEvent,
    args: { ruleId: string; sourcePath: string; vaultFileId: string }
  ) => {
    if (
      !args ||
      typeof args.ruleId !== 'string' ||
      typeof args.sourcePath !== 'string' ||
      typeof args.vaultFileId !== 'string'
    ) {
      throw new Error('ruleId, sourcePath, vaultFileId are required');
    }
    hotFoldersService.notifyImportSucceeded(args.ruleId, args.sourcePath, args.vaultFileId);
  }
);

ipcMain.handle(
  'hot-folders:delete-source',
  async (_event: IpcMainInvokeEvent, args: { ruleId: string; sourcePath: string }) => {
    if (!args || typeof args.ruleId !== 'string' || typeof args.sourcePath !== 'string') {
      throw new Error('ruleId and sourcePath are required');
    }
    await hotFoldersService.deleteSource(args.ruleId, args.sourcePath);
  }
);

ipcMain.handle(
  'hot-folders:move-source',
  async (
    _event: IpcMainInvokeEvent,
    args: { ruleId: string; sourcePath: string; subfolder: string }
  ) => {
    if (
      !args ||
      typeof args.ruleId !== 'string' ||
      typeof args.sourcePath !== 'string' ||
      typeof args.subfolder !== 'string'
    ) {
      throw new Error('ruleId, sourcePath and subfolder are required');
    }
    await hotFoldersService.moveSource(args.ruleId, args.sourcePath, args.subfolder);
  }
);

ipcMain.handle('hot-folders:pause-rule', async (_event: IpcMainInvokeEvent, ruleId: string) => {
  if (typeof ruleId !== 'string') throw new Error('ruleId required');
  await hotFoldersService.pauseRule(ruleId);
});

ipcMain.handle('hot-folders:resume-rule', async (_event: IpcMainInvokeEvent, ruleId: string) => {
  if (typeof ruleId !== 'string') throw new Error('ruleId required');
  await hotFoldersService.resumeRule(ruleId);
});

ipcMain.handle(
  'hot-folders:clear-safety-pause',
  async (_event: IpcMainInvokeEvent, ruleId: string) => {
    if (typeof ruleId !== 'string') throw new Error('ruleId required');
    hotFoldersService.clearSafetyPause(ruleId);
  }
);

ipcMain.handle('hot-folders:scan-now', async (_event: IpcMainInvokeEvent, ruleId: string) => {
  if (typeof ruleId !== 'string') throw new Error('ruleId required');
  return hotFoldersService.scanNow(ruleId);
});

// --- Web Clipper (#9) ---
// Dedicated loopback WS bridge (clipperBridge.ts). The renderer toggles it on
// from Settings, generates a pairing code shown to the user, and the extension
// connects to send clips. Incoming clips are forwarded to the renderer on the
// `clipper:save` channel; the renderer reports back here via `clipper:saveResult`
// so the bridge can answer the extension.

ipcMain.handle('clipper:getStatus', async () => clipperBridge.getStatus());

ipcMain.handle('clipper:setEnabled', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
  clipperBridge.setEnabled(!!enabled);
  return clipperBridge.getStatus();
});

ipcMain.handle('clipper:generatePairingCode', async () => {
  const code = clipperBridge.generatePairingCode();
  return { code, port: clipperBridge.getPort() };
});

ipcMain.handle('clipper:listClients', async () => clipperBridge.getPairedClients());

ipcMain.handle('clipper:removeClient', async (_event: IpcMainInvokeEvent, clientId: string) => {
  if (typeof clientId !== 'string') throw new Error('clientId required');
  return clipperBridge.removePairedClient(clientId);
});

ipcMain.handle(
  'clipper:saveResult',
  async (_event: IpcMainInvokeEvent, result: { requestId: string } & ClipSaveResult) => {
    if (!result || typeof result.requestId !== 'string') return;
    const { requestId, ok, noteId, error } = result;
    clipperBridge.resolveSaveResult(requestId, { ok, noteId, error });
  }
);

// --- Hidden Vault (#6) ---
// Writes the decoy profile's own wrapped_fek.json WITHOUT activating it.
// During setup the real profile is active, so hybrid:saveWrappedKey (which
// targets the active profile's dir) can't reach the decoy dir. The renderer
// wraps the decoy FEK with the duress password and ships the opaque blob
// here; we only resolve the (sanitized) profile dir and write the file.
ipcMain.handle(
  'hidden-vault:seedDecoy',
  async (
    _event: IpcMainInvokeEvent,
    params: {
      profileId: string;
      wrappedKeyData: Record<string, unknown>;
      keypairData?: Record<string, unknown>;
    }
  ) => {
    if (!params || typeof params.profileId !== 'string' || !params.wrappedKeyData) {
      throw new Error('profileId and wrappedKeyData required');
    }
    const dir = profileManager.getProfileDataDir(params.profileId);
    await fs.mkdir(dir, { recursive: true });
    const keyPath = path.join(dir, 'wrapped_fek.json');
    await fs.writeFile(keyPath, JSON.stringify(params.wrappedKeyData), { mode: 0o600 });
    // E2-9: seed the decoy profile's OWN independent keypair (under the duress
    // password) so it unlocks like a normal profile once switched. Local-only.
    if (params.keypairData) {
      const kpPath = path.join(dir, 'user_keypair.json');
      await fs.writeFile(kpPath, JSON.stringify(params.keypairData), { mode: 0o600 });
    }
  }
);

// --- E2EE Share ---
// The renderer builds the encrypted payload (manifest + wrapped FEK) in
// shareCrypto.ts and passes opaque blobs here. Main forwards to the Worker
// with the user's bearer token, then returns the shareId + expiry. The
// renderer is responsible for composing the final URL with the K_share
// fragment — main never sees K_share, by design.

ipcMain.handle(
  'share:create',
  async (_event: IpcMainInvokeEvent, input: shareService.CreateShareInput) => {
    return shareService.createShare(input);
  }
);

ipcMain.handle('share:list', async () => {
  return shareService.listShares();
});

// Clé publique de custody du compte — le renderer scelle K_share avec avant de
// créer le partage, pour qu'il reste récupérable depuis un autre appareil.
// Lecture seule, partie publique uniquement : main ne déscelle jamais rien.
ipcMain.handle('share:custodyKey', async () => {
  return shareService.getCustodyPublicKey();
});

ipcMain.handle('share:revoke', async (_event: IpcMainInvokeEvent, shareId: string) => {
  return shareService.revokeShare(shareId);
});

// Upload one encrypted chunk for a draft share. The body is a Buffer
// (raw IV(12) || ciphertext+tag); Electron's IPC serializes Buffer
// efficiently as a typed-array transfer, no base64 dance needed.
ipcMain.handle(
  'share:uploadChunk',
  async (
    _event: IpcMainInvokeEvent,
    shareId: string,
    chunkIndex: number,
    encryptedBlob: Buffer | Uint8Array
  ) => {
    const buf = Buffer.isBuffer(encryptedBlob) ? encryptedBlob : Buffer.from(encryptedBlob);
    return shareService.uploadShareChunk(shareId, chunkIndex, buf);
  }
);

ipcMain.handle('share:finalize', async (_event: IpcMainInvokeEvent, shareId: string) => {
  return shareService.finalizeShare(shareId);
});

ipcMain.handle('share:listViews', async (_event: IpcMainInvokeEvent, shareId: string) => {
  return shareService.listShareViews(shareId);
});

// --- Profile Management ---

ipcMain.handle('profile:getManifest', async () => {
  try {
    return profileManager.getManifest();
  } catch (error) {
    console.error('Error in profile:getManifest:', error);
    throw error;
  }
});

ipcMain.handle(
  'profile:create',
  async (
    _event: IpcMainInvokeEvent,
    params: { name: string; avatarColor: string; pin?: string; allowPinReset?: boolean }
  ) => {
    try {
      return await profileManager.createProfile(
        params.name,
        params.avatarColor,
        params.pin,
        params.allowPinReset
      );
    } catch (error) {
      console.error('Error in profile:create:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'profile:update',
  async (
    _event: IpcMainInvokeEvent,
    profileId: string,
    updates: {
      name?: string;
      avatarColor?: string;
      avatarImage?: string | null;
      pin?: string | null;
      allowPinReset?: boolean;
    }
  ) => {
    try {
      const result = await profileManager.updateProfile(profileId, updates);
      // If the PIN changed, push the update to the cloud so other devices pick
      // it up. Fire-and-forget — the next regular sync cycle would also catch
      // it, but users expect PIN changes to propagate quickly.
      if (updates.pin !== undefined || updates.allowPinReset !== undefined) {
        syncService.triggerSync(profileId).catch((err) => {
          console.warn('[profile:update] Sync after PIN change failed:', err?.message || err);
        });
      }
      return result;
    } catch (error) {
      console.error('Error in profile:update:', error);
      throw error;
    }
  }
);

// Unlink a profile from its cloud account WITHOUT deleting tokens or data.
// The profile reverts to "local" appearance in the picker; subsequent login
// from Settings will rebind. Used by the group header menu's "Disconnect
// all profiles of this account" action.
ipcMain.handle('profile:unlinkCloud', async (_event: IpcMainInvokeEvent, profileId: string) => {
  try {
    await profileManager.setCloudAccount(profileId, null);
    return { success: true };
  } catch (error) {
    log.error('[profile:unlinkCloud] failed:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('profile:delete', async (_event: IpcMainInvokeEvent, profileId: string) => {
  try {
    await profileManager.deleteProfile(profileId);
    // If we deleted the active profile, switch to the new active
    const manifest = profileManager.getManifest();
    if (activeProfileId === profileId && manifest.activeProfileId) {
      activeProfileId = manifest.activeProfileId;
      // Même raison qu'à l'activation : le clair en mémoire est celui du profil
      // qu'on vient de supprimer.
      forgetNotesVault();
      const profileDataDir = profileManager.getProfileDataDir(activeProfileId);
      await StorageService.reinitialize(profileDataDir);
    }
    return { success: true };
  } catch (error) {
    console.error('Error in profile:delete:', error);
    throw error;
  }
});

ipcMain.handle('profile:fullReset', async () => {
  try {
    // Delete ALL profile data directories and reset the manifest
    const manifest = profileManager.getManifest();
    for (const profile of [...manifest.profiles]) {
      const profileDir = profileManager.getProfileDataDir(profile.id);
      try {
        await fs.rm(profileDir, { recursive: true, force: true });
      } catch {
        /* ignore if dir doesn't exist */
      }
    }
    // Reset manifest to empty state
    const freshManifest = {
      version: 1 as const,
      activeProfileId: null,
      profiles: [] as any[],
      maxProfiles: 10,
      migratedFromLegacy: false,
    };
    await profileManager.saveManifest(freshManifest);
    // La zone d'attente d'« ajouter un compte » vit HORS des dossiers de profil
    // et survivrait donc à la boucle ci-dessus : un « tout effacer » qui laisse
    // derrière lui une session vivante et ses jetons serait un mensonge.
    await authService.discardPendingSession();
    // The sealed tray recents live outside the profile dirs (filarr-flags.json)
    // — a "delete everything" that left vault file names on disk would be a lie.
    loadRecentsForProfile(null);
    purgeStoredRecents();
    refreshTray();
    log.info('[profile:fullReset] All profiles and data deleted');
    return { success: true };
  } catch (error) {
    log.error('Error in profile:fullReset:', error);
    throw error;
  }
});

ipcMain.handle('profile:activate', async (_event: IpcMainInvokeEvent, profileId: string) => {
  try {
    const prevProfile = activeProfileId;
    log.info(`[profile:activate] Switching from ${prevProfile ?? 'none'} to ${profileId}`);

    // Hard-stop sync for the outgoing profile BEFORE rewiring. The daemon
    // holds a reference to `activeProfileId` that it uses in triggerSync,
    // so any in-flight operations must be drained first.
    syncService.stop();

    // Stop the downloads watcher — the next profile may have its own config
    // (config is profile-scoped via appConfig.json).
    await downloadsWatcherService.stop();
    await hotFoldersService.stopAll();

    // Update last accessed + set as active in manifest
    await profileManager.updateLastAccessed(profileId);
    activeProfileId = profileId;

    // Drop in-memory snapshot dedup state so the new profile starts fresh
    // and we don't carry hashes from the previous profile's notes.
    noteVersionService.resetSnapshotState();

    // Le coffre de notes en clair appartient au profil SORTANT : le garder
    // ferait appliquer un delta du nouveau profil sur les notes de l'ancien.
    // L'entrée porte son profil et serait de toute façon rejetée, mais on ne
    // laisse pas traîner le clair d'un profil qu'on vient de quitter.
    forgetNotesVault();

    // Desktop protection: the tray recents belong to the outgoing profile
    // (metadata must not leak across profiles) and the lock report is stale.
    // The incoming profile gets its own persisted list back, or nothing.
    loadRecentsForProfile(profileId);
    noteProfileSwitch();
    refreshTray();
    notifyMiniRefresh();

    const profileDataDir = profileManager.getProfileDataDir(profileId);

    /**
     * ADOPTION D'UNE SESSION EN ATTENTE — « ajouter un compte cloud ».
     *
     * La connexion a eu lieu AVANT qu'un profil soit choisi : ses jetons et sa
     * FEK attendent dans `.pending-account/`. Entrer dans un profil est
     * précisément le moment où l'on sait où les ranger.
     *
     * PORTÉE AU COMPTE, sans exception : on n'adopte que dans un profil du même
     * compte, ou dans un profil qui n'est lié à aucun (celui qu'on vient de
     * créer). Un profil d'un AUTRE compte ne reçoit rien — et la session en
     * attente est alors abandonnée, parce que la personne a quitté la démarche
     * en entrant ailleurs, et qu'une session sans domicile ne doit pas survivre.
     *
     * L'estampille précède `reinitialize` : c'est elle qui dit à
     * `ensureFEKAvailable` de quel compte ce profil relève, donc chez qui il a
     * le droit d'emprunter une clé.
     */
    if (authService.hasPendingSession()) {
      const pendingAccount = await authService.getPendingAccount();
      const manifestNow = profileManager.getManifest();
      const target = manifestNow.profiles.find((p) => p.id === profileId);
      const boundTo = target?.cloudAccount?.email?.toLowerCase() ?? null;
      const incoming = pendingAccount?.email?.toLowerCase() ?? null;

      /**
       * Un profil NON LIÉ n'accueille la session que si le compte n'a encore
       * aucun profil ici — c'est-à-dire le profil qu'on vient de créer pour lui.
       *
       * Sans cette réserve, quelqu'un qui, revenu au sélecteur pour choisir
       * parmi les profils ramenés, ouvrirait plutôt un vieux profil local le
       * verrait rattaché au compte sans l'avoir demandé. Ici, ce geste vaut
       * abandon : on abandonne la session, pas le profil de la personne.
       */
      const accountHasProfilesHere =
        !!incoming &&
        manifestNow.profiles.some((p) => p.cloudAccount?.email?.toLowerCase() === incoming);
      const acceptable = boundTo === incoming || (boundTo === null && !accountHasProfilesHere);

      if (incoming && acceptable) {
        await StorageService.adoptPendingFEK(authService.getPendingRealmDir(), profileDataDir);
        await profileManager.setCloudAccount(profileId, pendingAccount!);
        await authService.adoptPendingSession(profileId);
        log.info(`[profile:activate] pending account ${incoming} adopted by ${profileId}`);
      } else {
        log.warn(
          `[profile:activate] pending session (${incoming ?? 'anonymous'}) does not belong to ` +
            `profile ${profileId} (${boundTo ?? 'local'}) — discarding it`
        );
        await authService.discardPendingSession();
      }
    }

    // Re-initialize StorageService with the new profile's data directory
    log.info(`[profile:activate] baseDir now: ${profileDataDir}`);
    await StorageService.reinitialize(profileDataDir);

    // Rebind auth to the new profile's tokens + re-init session. This loads
    // that profile's own cloud identity (or no identity = local mode).
    await authService.setProfile(profileId);
    await authService.initAuth();

    // Start sync for the new profile if it's cloud + not paused.
    const authStatus = await authService.getAuthStatus();
    if (
      authStatus.isAuthenticated &&
      authStatus.accountMode === 'cloud' &&
      !authStatus.syncPaused
    ) {
      syncService.init(profileId);
      syncService.onStatusChange((status) => updateTrayForSync(status));
      log.info('[profile:activate] Sync restarted for new profile');
    }

    // Notify renderer that folders + auth changed (new profile = different
    // data + potentially different identity).
    emitFoldersUpdated();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth-status-changed', authStatus);
    }

    // Hydrate the downloads watcher from this profile's config and start it
    // if enabled. Done last so the renderer is ready to receive events.
    try {
      const watcherConfig = await loadDownloadsWatcherConfigFromDisk();
      await downloadsWatcherService.setConfig(watcherConfig);
    } catch (err) {
      log.warn('[profile:activate] downloads watcher hydration failed:', err);
    }

    // Hydrate hot folders from this profile's config.
    try {
      const hotFolders = await loadHotFoldersFromDisk();
      await hotFoldersService.setRules(hotFolders);
    } catch (err) {
      log.warn('[profile:activate] hot folders hydration failed:', err);
    }

    return { success: true, profileId };
  } catch (error) {
    log.error('[profile:activate] Failed:', error);
    throw error;
  }
});

/**
 * Diagnostic IPC — returns the current active profile ID as seen by the
 * main process. Used by the renderer to detect mismatches between the
 * Redux state and the main's actual state.
 */
ipcMain.handle('profile:getActive', async () => {
  return {
    activeProfileId,
    baseDir: StorageService.getBaseDir(),
  };
});

ipcMain.handle('profile:reorder', async (_event: IpcMainInvokeEvent, orderedIds: string[]) => {
  try {
    await profileManager.reorderProfiles(orderedIds);
    return { success: true };
  } catch (error) {
    console.error('Error in profile:reorder:', error);
    throw error;
  }
});

ipcMain.handle(
  'profile:verifyPin',
  async (_event: IpcMainInvokeEvent, profileId: string, pin: string) => {
    try {
      return await profileManager.verifyPin(profileId, pin);
    } catch (error) {
      console.error('Error in profile:verifyPin:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'profile:resetPin',
  async (_event: IpcMainInvokeEvent, profileId: string, confirmName: string) => {
    try {
      await profileManager.resetPin(profileId, confirmName);
      return { success: true };
    } catch (error) {
      console.error('Error in profile:resetPin:', error);
      throw error;
    }
  }
);

// --- Hybrid Storage (local-first + cloud sync) ---

ipcMain.handle(
  'hybrid:writeRawBlob',
  async (
    _event: IpcMainInvokeEvent,
    folderId: string,
    fileName: string,
    data: number[] | Uint8Array | Buffer
  ) => {
    try {
      const dir = path.join(StorageService.getBaseDir(), sanitizeFolderId(folderId));
      await fs.mkdir(dir, { recursive: true });
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
      await fs.writeFile(path.join(dir, sanitizePath(fileName)), buf);

      // Notify sync service of file change
      if (activeProfileId) {
        syncService.notifyFileChanged(activeProfileId, `${folderId}/${fileName}`);
      }
    } catch (error) {
      console.error('Error in hybrid:writeRawBlob:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'hybrid:readRawBlob',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const filePath = path.join(
        StorageService.getBaseDir(),
        sanitizeFolderId(folderId),
        sanitizePath(fileName)
      );
      const data = await fs.readFile(filePath);
      return new Uint8Array(data);
    } catch (error) {
      console.error('Error in hybrid:readRawBlob:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'hybrid:fileExists',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const filePath = path.join(
        StorageService.getBaseDir(),
        sanitizeFolderId(folderId),
        sanitizePath(fileName)
      );
      return await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
    } catch {
      return false;
    }
  }
);

/**
 * DEPLACER LE BLOB, sans le lire.
 *
 * Le renommage hybride faisait un aller-retour COMPLET du contenu par IPC :
 * readRawBlob (fs.readFile entier) -> writeRawBlob -> deleteBlob. Sur un
 * fichier de plusieurs centaines de mega-octets, renommer coutait donc une
 * copie integrale en memoire du renderer, pour un geste qui ne change qu'un
 * nom. `fs.rename` est atomique sur le meme volume et ne lit rien.
 *
 * Il LEVE en cas d'echec, volontairement : l'appelant doit savoir. Un
 * renommage qui echoue en silence laisse les octets sous l'ancien nom, et la
 * sauvegarde suivante en cree un second sous le nouveau.
 */
ipcMain.handle(
  'hybrid:renameBlob',
  async (_event: IpcMainInvokeEvent, folderId: string, oldName: string, newName: string) => {
    const base = path.join(StorageService.getBaseDir(), sanitizeFolderId(folderId));
    const source = path.join(base, sanitizePath(oldName));
    const cible = path.join(base, sanitizePath(newName));
    // Absent = rien a deplacer. Ce n'est pas une erreur : le mode hybride ne
    // garde pas forcement une copie locale de chaque fichier.
    const existe = await fs
      .access(source)
      .then(() => true)
      .catch(() => false);
    if (!existe) return false;
    await fs.rename(source, cible);
    return true;
  }
);

ipcMain.handle(
  'hybrid:computeChecksum',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const filePath = path.join(
        StorageService.getBaseDir(),
        sanitizeFolderId(folderId),
        sanitizePath(fileName)
      );
      // Streaming sha256 — hybrid blobs can now reach 5 GiB (V3-FEK), whole-file
      // fs.readFile would blow RAM (and hard-fail above 2 GiB).
      return await streamingSha256(filePath);
    } catch (error) {
      console.error('Error in hybrid:computeChecksum:', error);
      throw error;
    }
  }
);

// --- V3-FEK hybrid large files (streamed in main, portable across devices) ---

// Mirrors hybrid:writeRawBlob (same dir layout + sync notification) except the
// content never crosses the renderer: main encrypts straight from the OS path
// into a V3 container keyed by the SESSION FEK (portable, unlike the
// machine-local key used by the local-mode streaming import). Emits the same
// throttled 'file:importProgress' events as saveEncryptedFileFromPath.
ipcMain.handle(
  'hybrid:saveFromPath',
  async (event: IpcMainInvokeEvent, folderId: string, fileName: string, sourcePath: string) => {
    try {
      if (!sourcePath || typeof sourcePath !== 'string') {
        throw new Error('Fichier source introuvable');
      }
      const resolvedSource = path.resolve(sourcePath);
      const sourceStat = await fs.stat(resolvedSource).catch(() => null);
      if (!sourceStat) {
        throw new Error('Fichier source introuvable');
      }
      if (!sourceStat.isFile()) {
        throw new Error("Le chemin source n'est pas un fichier");
      }

      const dir = path.join(StorageService.getBaseDir(), sanitizeFolderId(folderId));
      await fs.mkdir(dir, { recursive: true });
      const destPath = path.join(dir, sanitizePath(fileName));

      // Throttled progress: at most one event every ~200ms, plus the final one.
      const sender = event.sender;
      let lastEmit = 0;
      const { origSize } = await StorageService.saveEncryptedFileFromPathFEK(
        resolvedSource,
        destPath,
        (doneBytes, totalBytes) => {
          const now = Date.now();
          if (doneBytes < totalBytes && now - lastEmit < 200) return;
          lastEmit = now;
          const percent =
            totalBytes === 0 ? 100 : Math.min(100, Math.round((doneBytes / totalBytes) * 100));
          if (!sender.isDestroyed()) {
            sender.send('file:importProgress', { folderId, fileName, percent });
          }
        }
      );

      // Same sync notification as hybrid:writeRawBlob
      if (activeProfileId) {
        syncService.notifyFileChanged(activeProfileId, `${folderId}/${fileName}`);
      }

      // Path-based import = a "protect a file" gesture → tray/mini recents.
      recordRecentProtected(sanitizeFolderId(folderId), sanitizePath(fileName), origSize);

      return { size: origSize };
    } catch (error) {
      console.error('Error in hybrid:saveFromPath:', error);
      throw error;
    }
  }
);

// Cheap V3 magic probe (50-byte read) so the renderer read path can route
// V3-FEK blobs to main-side decryption instead of the legacy renderer path.
ipcMain.handle(
  'hybrid:isV3Blob',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const filePath = path.join(
        StorageService.getBaseDir(),
        sanitizeFolderId(folderId),
        sanitizePath(fileName)
      );
      return await StorageService.isV3VaultFile(filePath);
    } catch {
      return false;
    }
  }
);

// Decrypts a V3-FEK hybrid blob with the session FEK (GCM-verified chunks,
// 1 GiB preview cap — French errors from StorageService/streamCrypto).
ipcMain.handle(
  'hybrid:readDecryptedV3',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const filePath = path.join(
        StorageService.getBaseDir(),
        sanitizeFolderId(folderId),
        sanitizePath(fileName)
      );
      const plain = await StorageService.decryptV3FileWithSessionFEK(filePath);
      return new Uint8Array(plain);
    } catch (error) {
      console.error(
        'Error in hybrid:readDecryptedV3:',
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }
);

ipcMain.handle(
  'hybrid:deleteBlob',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const filePath = path.join(
        StorageService.getBaseDir(),
        sanitizeFolderId(folderId),
        sanitizePath(fileName)
      );
      await fs.unlink(filePath).catch(() => {});
    } catch (error) {
      console.error('Error in hybrid:deleteBlob:', error);
      throw error;
    }
  }
);

// ── Ranged vault-file reads for windowed previews ──────────────────────────
// The renderer preview layer (PDF via pdf.js range transport, ZIP via ranged
// central-directory listing) reads arbitrary plaintext byte windows WITHOUT
// buffering the whole file. This is the IPC twin of the filarr-stream://
// protocol handler: same path resolution (resolveVaultFilePath under the
// active profile dir) and the same decrypt path (createDecryptStreamAuto,
// which GCM-probes chunk 0 to pick the machine key OR the session FEK — so
// both local V3 and hybrid V3-FEK blobs work). Keeping this on IPC (not
// fetch) lets the renderer CSP stay tight (no filarr-stream: in connect-src).

/** Upper bound on a single ranged read so a preview cannot balloon main-process RAM. */
const MAX_STREAM_RANGE_BYTES = 128 * 1024 * 1024; // 128 MiB

ipcMain.handle(
  'stream:getSize',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string): Promise<number> => {
    const resolved = resolveVaultFilePath(getActiveProfileDataDir(), folderId, fileName);
    if (!resolved) {
      throw new Error('Chemin de fichier invalide.');
    }
    const exists = await fs
      .access(resolved)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new Error('Fichier introuvable.');
    }
    const meta = await StorageService.statDecryptedAuto(resolved);
    if (meta.format === 'v3') {
      return meta.plainSize;
    }
    // Legacy V1/V2: the plaintext size is unknowable without a full decrypt
    // (bounded to ~500 MB by the streaming cap). Windowed previews target V3
    // containers, so this only runs for small legacy blobs.
    const plain = await StorageService.decryptFileAuto(resolved);
    return plain.length;
  }
);

ipcMain.handle(
  'stream:readRange',
  async (
    _event: IpcMainInvokeEvent,
    folderId: string,
    fileName: string,
    offset: number,
    length: number
  ): Promise<Uint8Array> => {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      throw new Error('Plage de lecture invalide.');
    }
    if (length > MAX_STREAM_RANGE_BYTES) {
      throw new Error('Plage de lecture trop volumineuse.');
    }
    if (length === 0) {
      return new Uint8Array(0);
    }
    const resolved = resolveVaultFilePath(getActiveProfileDataDir(), folderId, fileName);
    if (!resolved) {
      throw new Error('Chemin de fichier invalide.');
    }
    const exists = await fs
      .access(resolved)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new Error('Fichier introuvable.');
    }
    const stream = await StorageService.createDecryptStreamAuto(resolved, { offset, length });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return new Uint8Array(Buffer.concat(chunks));
  }
);

ipcMain.handle(
  'hybrid:saveWrappedKey',
  async (_event: IpcMainInvokeEvent, wrappedKeyData: Record<string, unknown>) => {
    try {
      const keyPath = path.join(StorageService.getBaseDir(), 'wrapped_fek.json');
      await fs.writeFile(keyPath, JSON.stringify(wrappedKeyData), { mode: 0o600 });
    } catch (error) {
      log.error('Error in hybrid:saveWrappedKey:', error);
      throw error;
    }
  }
);

ipcMain.handle('hybrid:loadWrappedKey', async () => {
  try {
    const keyPath = path.join(StorageService.getBaseDir(), 'wrapped_fek.json');
    const data = await fs.readFile(keyPath, 'utf8').catch(() => null);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    log.error('Error in hybrid:loadWrappedKey:', error);
    return null;
  }
});

// Push the local wrapped FEK to the server so new devices can fetch it.
// Ciphertext-at-rest: the server cannot decrypt it without the user password.
// Best-effort — callers should not fail the local flow if this errors.
ipcMain.handle(
  'hybrid:pushWrappedKeyToCloud',
  async (_event: IpcMainInvokeEvent, wrappedKeyData: Record<string, unknown>) => {
    try {
      const result = await authService.authenticatedApiCall('/account/wrapped-key', {
        method: 'PUT',
        body: JSON.stringify(wrappedKeyData),
      });
      return result;
    } catch (error) {
      log.error('Error in hybrid:pushWrappedKeyToCloud:', error);
      return { success: false, error: error instanceof Error ? error.message : 'unknown' };
    }
  }
);

// Fetch the server-side wrapped FEK. Returns null if none stored, the caller
// falls back to first-time onboarding. Returned ciphertext still requires the
// user password to unwrap client-side.
ipcMain.handle('hybrid:fetchWrappedKeyFromCloud', async () => {
  try {
    const result = await authService.authenticatedApiCall<{
      wrappedFek: string;
      kekSalt: string;
      version: number;
      recoveryWrappedFek?: string;
      recoverySalt?: string;
    }>('/account/wrapped-key');
    if (result.success && result.data) {
      return result.data;
    }
    return null;
  } catch (error) {
    log.error('Error in hybrid:fetchWrappedKeyFromCloud:', error);
    return null;
  }
});

// --- Per-user keypair (E2-4), mirrors the hybrid:* wrapped-FEK handlers ---

ipcMain.handle(
  'keypair:saveLocal',
  async (_event: IpcMainInvokeEvent, keypairData: Record<string, unknown>) => {
    try {
      const keyPath = path.join(StorageService.getBaseDir(), 'user_keypair.json');
      await fs.writeFile(keyPath, JSON.stringify(keypairData), { mode: 0o600 });
    } catch (error) {
      log.error('Error in keypair:saveLocal:', error);
      throw error;
    }
  }
);

ipcMain.handle('keypair:loadLocal', async () => {
  try {
    const keyPath = path.join(StorageService.getBaseDir(), 'user_keypair.json');
    const data = await fs.readFile(keyPath, 'utf8').catch(() => null);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    log.error('Error in keypair:loadLocal:', error);
    return null;
  }
});

// Publish the wrapped keypair to the broker. The wrapped_private_key is opaque
// to the server (no master key). Best-effort.
ipcMain.handle(
  'keypair:pushToCloud',
  async (_event: IpcMainInvokeEvent, keypairData: Record<string, unknown>) => {
    try {
      return await authService.authenticatedApiCall('/account/user-key', {
        method: 'PUT',
        body: JSON.stringify(keypairData),
      });
    } catch (error) {
      log.error('Error in keypair:pushToCloud:', error);
      return { success: false, error: error instanceof Error ? error.message : 'unknown' };
    }
  }
);

// Fetch the server-side keypair (null if none → first-time onboarding).
ipcMain.handle('keypair:fetchFromCloud', async () => {
  try {
    const result = await authService.authenticatedApiCall('/account/user-key');
    if (result.success && result.data) {
      return result.data;
    }
    return null;
  } catch (error) {
    log.error('Error in keypair:fetchFromCloud:', error);
    return null;
  }
});

// --- Print Recovery Codes PDF ---

function generateRecoveryCodesHtml(words: string[], lang: string): string {
  const isFr = lang === 'fr';
  const date = new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const title = isFr ? 'Filarr — Codes de récupération' : 'Filarr — Recovery Codes';
  const warning = isFr
    ? 'Ne partagez jamais ces codes. Ils sont la seule façon de récupérer votre compte.'
    : 'Never share these codes. They are the only way to recover your account.';
  const dateLabel = isFr ? 'Date de génération' : 'Generated on';
  const neverShare = isFr ? 'Ne partagez jamais ces codes.' : 'Never share these codes.';

  const grid = words
    .map((w, i) => `<div class="word"><span class="num">${i + 1}.</span>${w}</div>`)
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #111; max-width: 600px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  .warning { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; padding: 12px 16px; border-radius: 8px; margin-bottom: 24px; font-size: 13px; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 24px; }
  .word { background: #f3f4f6; padding: 8px 12px; border-radius: 6px; font-size: 14px; font-weight: 500; }
  .num { color: #9ca3af; font-size: 12px; margin-right: 6px; font-family: monospace; }
  .footer { color: #6b7280; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  @media print { body { padding: 20px; } }
</style></head><body>
<h1>${title}</h1>
<div class="warning">\u26a0\ufe0f ${warning}</div>
<div class="grid">${grid}</div>
<div class="footer"><p>${dateLabel}: ${date}</p><p>${neverShare}</p></div>
</body></html>`;
}

ipcMain.handle(
  'pdf:printRecoveryCodes',
  async (_event: IpcMainInvokeEvent, words: string[], lang: string) => {
    const isFr = (lang || 'fr') === 'fr';
    const html = generateRecoveryCodesHtml(words, lang || 'fr');
    const printWin = new BrowserWindow({ show: false, width: 600, height: 800 });
    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    });
    printWin.close();

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `Filarr-Recovery-Codes.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      title: isFr ? 'Sauvegarder les codes de récupération' : 'Save recovery codes',
    });

    if (!canceled && filePath) {
      await fs.writeFile(filePath, pdfBuffer);
      return true;
    }
    return false;
  }
);

// --- Cloud Auth IPC handlers ---

/**
 * SE CONNECTER AVANT DE CHOISIR UN PROFIL — l'ouverture de la zone d'attente.
 *
 * Les deux domaines basculent ensemble, et c'est indispensable : les jetons
 * (authService) ET la clé de coffre (StorageService) doivent viser la même zone
 * neutre. Laisser la FEK sur le profil précédent ferait lire à
 * `initHybridCrypto` l'enveloppe de l'ANCIEN compte — qui ne s'ouvre pas avec
 * le mot de passe du nouveau, et qui empêche d'aller chercher la bonne copie
 * dans le nuage. `inheritFEK: false` garde donc la zone vierge.
 */
ipcMain.handle('auth:beginPendingSession', async () => {
  try {
    await authService.beginPendingSession();
    await StorageService.reinitialize(authService.getPendingRealmDir(), { inheritFEK: false });
    return { success: true };
  } catch (err) {
    log.error('[auth:beginPendingSession] failed:', (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
});

/**
 * Abandon : la session en attente est révoquée et effacée, et les deux domaines
 * retournent au profil actif — sans quoi l'application resterait à écrire dans
 * un dossier qu'on vient de supprimer.
 */
ipcMain.handle('auth:discardPendingSession', async () => {
  try {
    await authService.discardPendingSession();
    if (activeProfileId) {
      await StorageService.reinitialize(profileManager.getProfileDataDir(activeProfileId));
      await authService.setProfile(activeProfileId);
      await authService.initAuth();
    }
    return { success: true };
  } catch (err) {
    log.error('[auth:discardPendingSession] failed:', (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('auth:pendingSessionStatus', async () => {
  return {
    pending: authService.hasPendingSession(),
    account: await authService.getPendingAccount(),
  };
});

ipcMain.handle(
  'auth:login',
  async (
    _event: IpcMainInvokeEvent,
    email: string,
    password: string,
    revokeDeviceId?: string
  ) => {
    return authService.login(email, password, revokeDeviceId);
  }
);

ipcMain.handle(
  'auth:register',
  async (
    _event: IpcMainInvokeEvent,
    email: string,
    password: string,
    accountType?: 'personal' | 'enterprise'
  ) => {
    return authService.register(email, password, accountType);
  }
);

ipcMain.handle('auth:logout', async () => {
  return authService.logout();
});

ipcMain.handle('auth:getStatus', async () => {
  return authService.getAuthStatus();
});

ipcMain.handle(
  'auth:recoverPhraseVerify',
  async (_event: IpcMainInvokeEvent, email: string, recoveryPhrase: string) => {
    return authService.recoverPhraseVerify(email, recoveryPhrase);
  }
);

ipcMain.handle(
  'auth:recoverComplete',
  async (
    _event: IpcMainInvokeEvent,
    payload: {
      resetToken: string;
      newPassword: string;
      wrappedFek?: string;
      kekSalt?: string;
      version?: number;
      recoveryWrappedFek?: string;
      recoverySalt?: string;
      userKey?: authService.UserKeyFromServer;
    }
  ) => {
    return authService.recoverComplete(payload);
  }
);

ipcMain.handle('auth:verifyEmail', async (_event: IpcMainInvokeEvent, token: string) => {
  return authService.verifyEmail(token);
});

ipcMain.handle('auth:getMe', async () => {
  return authService.getMe();
});

// Expose the current (auto-refreshed) access token so the renderer apiClient can
// authenticate org/vault HTTP calls. The token is owned + refreshed here (the single
// source of truth); the renderer never persists it. Returns null when unauthenticated.
ipcMain.handle('auth:getAccessToken', async () => {
  return authService.getAccessToken();
});

ipcMain.handle('auth:getDevices', async () => {
  return authService.getDevices();
});

ipcMain.handle('auth:deleteDevice', async (_event: IpcMainInvokeEvent, deviceId: string) => {
  return authService.deleteDevice(deviceId);
});

ipcMain.handle('auth:revokeDormantDevices', async () => authService.revokeDormantDevices());

ipcMain.handle('auth:deleteAccountData', async () => {
  return authService.deleteAccountData();
});

ipcMain.handle('auth:deleteAccount', async () => {
  return authService.deleteAccount();
});

ipcMain.handle(
  'auth:changePassword',
  async (_event: IpcMainInvokeEvent, currentPassword: string, newPassword: string) => {
    return authService.changePassword(currentPassword, newPassword);
  }
);

// --- Organization IPC handlers (E1-6) ---

/**
 * DIAGNOSTIC — le renderer ecrit une ligne dans le journal.
 *
 * En production, `openDevTools` est refuse et refermé : sans ce canal, une
 * panne cote renderer est INVISIBLE. Elle l'a ete pour un chargement de coffres
 * qui ne laissait qu'une page sans coffres -- indiscernable d'un compte qui
 * n'en a pas.
 *
 * ⚠ Ce qui entre est traite comme du texte ETRANGER, meme s'il vient de notre
 * propre renderer : bornes de longueur, saut de ligne retire (une ligne
 * injectee falsifierait le journal qu'on lit ensuite pour diagnostiquer), et
 * prefixe fixe pour qu'on sache toujours d'ou ca vient.
 */
ipcMain.on('diag:log', (_event: IpcMainEvent, payload: unknown) => {
  const data = (payload ?? {}) as { scope?: unknown; message?: unknown };
  const clean = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, max) : '';
  const scope = clean(data.scope, 40) || 'renderer';
  const message = clean(data.message, 300);
  if (message) log.warn(`[renderer:${scope}] ${message}`);
});

ipcMain.handle('org:list', async () => {
  return authService.listOrgs();
});

ipcMain.handle('org:setCurrent', async (_event: IpcMainInvokeEvent, orgId: string | null) => {
  await authService.setCurrentOrg(orgId);
  return { success: true };
});

ipcMain.handle('org:getCurrent', async () => {
  return { success: true, data: { orgId: authService.getCurrentOrg() } };
});

// --- Workspace space (personal | enterprise) ---

ipcMain.handle('space:get', async () => {
  return { success: true, data: { space: authService.getSpace() } };
});

ipcMain.handle(
  'space:set',
  async (_event: IpcMainInvokeEvent, space: authService.WorkspaceSpace, orgId?: string | null) => {
    await authService.setSpace(space, orgId);
    return { success: true, data: { space, orgId: authService.getCurrentOrg() } };
  }
);

// E9-10: offline governance-policy cache. The renderer fetches the effective
// policy via apiClient (it holds the org context + token); main only owns the
// on-disk persistence (plain JSON, 0o600, profile-scoped) so the policy survives
// offline restarts and the grace clock can run.
ipcMain.handle(
  'org:policy:save',
  async (_e: IpcMainInvokeEvent, data: authService.CachedPolicy) => {
    await authService.savePolicyCache(data);
    return { success: true };
  }
);

ipcMain.handle('org:policy:load', async () => {
  return { success: true, data: await authService.loadPolicyCache() };
});

ipcMain.handle('org:policy:clear', async () => {
  await authService.clearPolicyCache();
  return { success: true };
});

// Org onboarding: create / join
ipcMain.handle('org:create', async (_e: IpcMainInvokeEvent, name: string) => {
  return authService.createOrg(name);
});

ipcMain.handle('org:acceptInvitation', async (_e: IpcMainInvokeEvent, token: string) => {
  return authService.acceptOrgInvitation(token);
});

// Admin console operations (E1-8)
ipcMain.handle('org:members:list', async (_e: IpcMainInvokeEvent, orgId: string) => {
  return authService.getOrgMembers(orgId);
});

ipcMain.handle(
  'org:members:updateRole',
  async (_e: IpcMainInvokeEvent, orgId: string, userId: string, role: string) => {
    return authService.updateOrgMemberRole(orgId, userId, role);
  }
);

ipcMain.handle(
  'org:members:remove',
  async (_e: IpcMainInvokeEvent, orgId: string, userId: string) => {
    return authService.removeOrgMember(orgId, userId);
  }
);

ipcMain.handle('org:invitations:list', async (_e: IpcMainInvokeEvent, orgId: string) => {
  return authService.listOrgInvitations(orgId);
});

ipcMain.handle(
  'org:invitations:create',
  async (_e: IpcMainInvokeEvent, orgId: string, email: string, role: string, lang?: string) => {
    return authService.createOrgInvitation(orgId, email, role, lang);
  }
);

ipcMain.handle(
  'org:invitations:revoke',
  async (_e: IpcMainInvokeEvent, orgId: string, invId: string) => {
    return authService.revokeOrgInvitation(orgId, invId);
  }
);

ipcMain.handle('org:billing:status', async (_e: IpcMainInvokeEvent, orgId: string) => {
  return authService.getOrgBillingStatus(orgId);
});

ipcMain.handle(
  'org:billing:checkout',
  async (
    _e: IpcMainInvokeEvent,
    orgId: string,
    plan: string,
    period: string,
    successUrl: string,
    cancelUrl: string
  ) => {
    return authService.createOrgBillingCheckout(orgId, plan, period, successUrl, cancelUrl);
  }
);

ipcMain.handle('org:billing:portal', async (_e: IpcMainInvokeEvent, orgId: string) => {
  return authService.createOrgBillingPortal(orgId);
});

ipcMain.handle(
  'org:billing:seats',
  async (_e: IpcMainInvokeEvent, orgId: string, seats: number) => {
    return authService.setOrgBillingSeats(orgId, seats);
  }
);

ipcMain.handle('org:update', async (_e: IpcMainInvokeEvent, orgId: string, name: string) => {
  return authService.updateOrg(orgId, name);
});

ipcMain.handle('org:delete', async (_e: IpcMainInvokeEvent, orgId: string) => {
  return authService.deleteOrg(orgId);
});

ipcMain.handle('org:restore', async (_e: IpcMainInvokeEvent, orgId: string) => {
  return authService.restoreOrg(orgId);
});

// --- 2FA IPC handlers ---

ipcMain.handle(
  'auth:completeMFALogin',
  async (
    _event: IpcMainInvokeEvent,
    code: string,
    rememberDevice?: boolean,
    revokeDeviceId?: unknown
  ) => {
    return authService.completeMFALogin(
      code,
      !!rememberDevice,
      typeof revokeDeviceId === 'string' && revokeDeviceId ? revokeDeviceId : undefined
    );
  }
);

// --- SSO (E5-1) : résolution par adresse, puis aller-retour par la boucle locale ---

ipcMain.handle('auth:ssoResolve', async (_event: IpcMainInvokeEvent, email: string) => {
  if (typeof email !== 'string' || email.length > 254) return { success: false, error: 'Invalid email' };
  return authService.apiCall<{ orgId: string; orgName: string }>(
    `/auth/sso/resolve?email=${encodeURIComponent(email.trim())}`
  );
});

ipcMain.handle('auth:ssoLogin', async (_event: IpcMainInvokeEvent, orgId: string) => {
  return startSsoLogin(String(orgId));
});

ipcMain.handle('auth:ssoCancel', async () => {
  cancelSsoLogin();
  return { success: true };
});

ipcMain.handle('auth:cancelMFALogin', () => {
  authService.cancelMFALogin();
  return { success: true };
});

// E5-7 forced 2FA enrolment (org requires MFA, user has none). The enrol token stays in main.
ipcMain.handle('auth:mfaEnrollSetup', async () => {
  return authService.mfaEnrollSetup();
});

ipcMain.handle('auth:mfaEnrollVerify', async (_event: IpcMainInvokeEvent, code: string) => {
  return authService.mfaEnrollVerify(code);
});

ipcMain.handle('auth:get2FAStatus', async () => {
  return authService.get2FAStatus();
});

ipcMain.handle('auth:setup2FA', async () => {
  return authService.setup2FA();
});

ipcMain.handle('auth:verifySetup2FA', async (_event: IpcMainInvokeEvent, code: string) => {
  return authService.verifySetup2FA(code);
});

ipcMain.handle(
  'auth:disable2FA',
  async (_event: IpcMainInvokeEvent, password: string, code: string) => {
    return authService.disable2FA(password, code);
  }
);

ipcMain.handle(
  'auth:regenerateBackupCodes',
  async (_event: IpcMainInvokeEvent, password: string, code: string) => {
    return authService.regenerateBackupCodes(password, code);
  }
);

ipcMain.handle(
  'auth:regenerateRecoveryPhrase',
  async (_event: IpcMainInvokeEvent, password: string, code?: string) => {
    return authService.regenerateRecoveryPhrase(password, code);
  }
);

// --- Billing IPC handlers ---

ipcMain.handle('billing:checkout', async (_event: IpcMainInvokeEvent, plan: string) => {
  const result = await authService.authenticatedApiCall<{ checkoutUrl: string }>(
    '/billing/checkout',
    {
      method: 'POST',
      body: JSON.stringify({
        plan,
        successUrl: `https://filarr.com/checkout/success?plan=${plan}`,
        cancelUrl: 'https://filarr.com/checkout/cancel',
      }),
    }
  );
  if (result.success && result.data?.checkoutUrl) {
    // Defence-in-depth: the checkout URL comes from our own backend, but a
    // compromised backend or MitM must not be able to push javascript:/file:.
    if (!isSafeExternalUrl(result.data.checkoutUrl)) {
      log.warn('[billing:checkout] Backend returned unsafe URL — refused');
      return { success: false, error: 'Unsafe checkout URL' };
    }
    shell.openExternal(result.data.checkoutUrl);

    // Poll for tier change after checkout (5s interval, 5 min max)
    const currentMe = await authService.getMe();
    const currentTier = currentMe.user?.subscriptionTier || 'free';
    let attempts = 0;
    const maxAttempts = 60; // 5 min / 5s
    const pollTimer = setInterval(async () => {
      attempts++;
      if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
        return;
      }
      try {
        const me = await authService.getMe();
        if (me.success && me.user && me.user.subscriptionTier !== currentTier) {
          clearInterval(pollTimer);
          // Notify renderer of tier change
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('billing-tier-changed', {
              tier: me.user.subscriptionTier,
              previousTier: currentTier,
            });
          }
          log.info(`[billing] Tier changed: ${currentTier} → ${me.user.subscriptionTier}`);
        }
      } catch {
        /* ignore polling errors */
      }
    }, 5000);

    return { success: true };
  }
  return { success: false, error: result.error || 'Failed to create checkout session' };
});

ipcMain.handle('billing:portal', async () => {
  const result = await authService.authenticatedApiCall<{ portalUrl: string }>('/billing/portal', {
    method: 'POST',
  });
  if (result.success && result.data?.portalUrl) {
    if (!isSafeExternalUrl(result.data.portalUrl)) {
      log.warn('[billing:portal] Backend returned unsafe URL — refused');
      return { success: false, error: 'Unsafe portal URL' };
    }
    shell.openExternal(result.data.portalUrl);
    return { success: true };
  }
  return { success: false, error: result.error || 'No billing account found' };
});

// --- Security IPC handlers ---

ipcMain.handle(
  'security:getEnhancedLock',
  async (_event: IpcMainInvokeEvent, profileId: string) => {
    const dir = profileId
      ? profileManager.getProfileDataDir(profileId)
      : StorageService.getBaseDir();
    return StorageService.getEnhancedLock(dir);
  }
);

ipcMain.handle(
  'security:setEnhancedLock',
  async (_event: IpcMainInvokeEvent, profileId: string, enabled: boolean) => {
    const dir = profileId
      ? profileManager.getProfileDataDir(profileId)
      : StorageService.getBaseDir();
    await StorageService.setEnhancedLock(dir, enabled);
    // Turning Enhanced Lock ON must take effect on what is ALREADY on disk, not
    // just on future writes: drop the sealed tray recents now, otherwise vault
    // file names would outlive the key the user just asked us to stop keeping.
    if (enabled) purgeStoredRecents();
    return { success: true };
  }
);

/**
 * Check whether `.fek_safe` exists on disk for the active profile.
 * Used by the launch screen logic to enforce Enhanced Lock: if the flag
 * is enabled and `.fek_safe` is missing, the vault password must be
 * re-entered before the app unlocks. Also used by the Settings UI to
 * display the true FEK status regardless of renderer memory state.
 */
ipcMain.handle('security:fekSafeExists', async () => {
  try {
    const candidates = [
      path.join(StorageService.getBaseDir(), '.fek_safe'),
      path.join(app.getPath('userData'), 'FilarData', '.fek_safe'),
    ];
    for (const p of candidates) {
      try {
        await fs.access(p);
        return true;
      } catch {
        /* next */
      }
    }
    return false;
  } catch {
    return false;
  }
});

/**
 * Canonical FEK availability check for UI indicators.
 * Returns true if either `.fek_safe` (OS keychain sealed) or
 * `wrapped_fek.json` (password-wrapped) exists for the active profile.
 * This is the source of truth — renderer-side `hasHybridKey()` can be
 * stale because the FEK may live in the main process (cloud mode) and
 * the renderer module variable `_fek` stays null.
 */
ipcMain.handle('security:fekStatus', async () => {
  try {
    const baseDir = StorageService.getBaseDir();
    const candidates = [
      path.join(baseDir, '.fek_safe'),
      path.join(baseDir, 'wrapped_fek.json'),
      path.join(app.getPath('userData'), 'FilarData', '.fek_safe'),
      path.join(app.getPath('userData'), 'FilarData', 'wrapped_fek.json'),
    ];
    for (const p of candidates) {
      try {
        await fs.access(p);
        return { active: true, source: p.includes('.fek_safe') ? 'keychain' : 'wrapped' };
      } catch {
        /* next */
      }
    }
    return { active: false, source: null };
  } catch {
    return { active: false, source: null };
  }
});

ipcMain.handle(
  'security:exportRecoveryKey',
  async (
    _event: IpcMainInvokeEvent,
    profileId: string,
    recoveryPassword: string,
    hint: string | null
  ) => {
    try {
      // 1. Load FEK
      const fek = await StorageService.loadFEKForPairing();
      if (!fek) {
        return { success: false, error: 'FEK not available — vault not unlocked' };
      }
      const fekRaw = await crypto.subtle.exportKey('raw', fek);

      // 2. Derive recovery KEK from password
      const salt = crypto.randomBytes(16);
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(recoveryPassword),
        'PBKDF2',
        false,
        ['deriveKey']
      );
      const kek = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-512' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['wrapKey']
      );

      // 3. Import FEK as wrappable key
      const fekKey = await crypto.subtle.importKey(
        'raw',
        fekRaw,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // 4. Wrap FEK with recovery KEK
      const iv = crypto.randomBytes(12);
      const wrappedBuffer = await crypto.subtle.wrapKey('raw', fekKey, kek, {
        name: 'AES-GCM',
        iv,
      });

      // 5. Pack IV + wrapped
      const packed = Buffer.concat([Buffer.from(iv), Buffer.from(wrappedBuffer)]);

      // 6. Get profile name
      const pm = profileManager.getManifest();
      const profile = pm.profiles.find((p) => p.id === profileId);
      const profileName = profile?.name || 'default';

      // 7. Build JSON
      const recoveryData = {
        version: 1,
        type: 'filarr-recovery-key',
        createdAt: new Date().toISOString(),
        profileName,
        wrappedFek: packed.toString('base64'),
        salt: Buffer.from(salt).toString('base64'),
        hint: hint || null,
        appVersion: app.getVersion(),
      };

      // 8. Save dialog
      const dateStr = new Date().toISOString().slice(0, 10);
      const safeName = profileName.replace(/[^a-zA-Z0-9-_]/g, '_');
      const { canceled, filePath: savePath } = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: `filarr-recovery-${safeName}-${dateStr}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (canceled || !savePath) {
        return { success: false, error: 'Cancelled' };
      }

      await fs.writeFile(savePath, JSON.stringify(recoveryData, null, 2), 'utf-8');
      return { success: true, path: savePath };
    } catch (err) {
      log.error('[security] exportRecoveryKey error:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  }
);

ipcMain.handle('security:previewRecoveryKey', async () => {
  try {
    // 1. Open file dialog
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (canceled || !filePaths[0]) {
      return { success: false, error: 'Cancelled' };
    }

    // 2. Read and parse — return metadata only
    const raw = await fs.readFile(filePaths[0], 'utf-8');
    const data = JSON.parse(raw);

    if (data.type !== 'filarr-recovery-key' || !data.wrappedFek || !data.salt) {
      return { success: false, error: 'Invalid recovery key file' };
    }

    return {
      success: true,
      filePath: filePaths[0],
      profileName: data.profileName || null,
      createdAt: data.createdAt || null,
      hint: data.hint || null,
      appVersion: data.appVersion || null,
    };
  } catch (err) {
    log.error('[security] previewRecoveryKey error:', (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle(
  'security:importRecoveryKey',
  async (
    _event: IpcMainInvokeEvent,
    filePath: string,
    recoveryPassword: string,
    newVaultPassword: string
  ) => {
    try {
      // 1. Read and parse
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);

      if (data.type !== 'filarr-recovery-key' || !data.wrappedFek || !data.salt) {
        return { success: false, error: 'Invalid recovery key file' };
      }

      // 2. Derive recovery KEK
      const salt = Buffer.from(data.salt, 'base64');
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(recoveryPassword),
        'PBKDF2',
        false,
        ['deriveKey']
      );
      const kek = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-512' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['unwrapKey']
      );

      // 3. Unwrap FEK
      const packed = Buffer.from(data.wrappedFek, 'base64');
      const iv = packed.subarray(0, 12);
      const wrappedBytes = packed.subarray(12);

      const fek = await crypto.subtle.unwrapKey(
        'raw',
        wrappedBytes,
        kek,
        { name: 'AES-GCM', iv },
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // 4. Export raw FEK and store with new vault password
      const fekRaw = await crypto.subtle.exportKey('raw', fek);
      await StorageService.initWithExistingFEK(new Uint8Array(fekRaw), newVaultPassword);

      return { success: true };
    } catch (err) {
      const msg = (err as Error).message;
      log.error('[security] importRecoveryKey error:', msg);
      if (msg.includes('authenticate') || msg.includes('decrypt') || msg.includes('unwrap')) {
        return { success: false, error: 'Wrong recovery password' };
      }
      return { success: false, error: msg };
    }
  }
);

// --- Pairing IPC handlers ---

ipcMain.handle('pairing:initiate', async (_event: IpcMainInvokeEvent, profileId: string) => {
  return pairingService.initiatePairing(profileId);
});

ipcMain.handle(
  'pairing:join',
  async (_event: IpcMainInvokeEvent, code: string, profileId: string, password: string) => {
    return pairingService.joinPairing(code, profileId, password);
  }
);

ipcMain.handle('pairing:cancel', async (_event: IpcMainInvokeEvent, code: string) => {
  return pairingService.cancelPairing(code);
});

ipcMain.handle('pairing:getCode', async () => {
  return pairingService.getCurrentCode();
});

/**
 * Confirmation humaine du SAS (protocole d'appairage v2).
 *
 * C'est le seul événement qui autorise A à emballer la FEK, et B à la
 * réclamer. Il DOIT venir d'un geste explicite et positif de l'utilisateur
 * après comparaison des deux nombres affichés : ni un délai, ni un focus, ni
 * une fermeture de fenêtre ne valent confirmation. Sans lui, la cérémonie
 * expire — c'est le comportement voulu, pas une régression.
 */
ipcMain.handle('pairing:confirmSas', async (_event: IpcMainInvokeEvent, code: string) => {
  pairingService.confirmSas(code);
});

/** Refus explicite : les deux nombres différaient. Détruit la session. */
ipcMain.handle('pairing:rejectSas', async (_event: IpcMainInvokeEvent, code: string) => {
  pairingService.rejectSas(code);
});

// --- « Publier ce coffre sur le compte » (migration de clé) ------------------
//
// Le parcours proposé au moment EXACT où la garde d'adoption refuse. Aucun de
// ces canaux ne transporte de clé ni de contenu : uniquement des compteurs, des
// noms de profil et des verdicts. La bascule elle-même est un appel séparé et
// explicite (`publish:commitSwitch`) — jamais un effet de bord d'un autre.

ipcMain.handle('publish:getState', async () => {
  return publishEngine.getSnapshot();
});

ipcMain.handle(
  'publish:buildInventory',
  async (_event: IpcMainInvokeEvent, options: publishEngine.InventoryOptions) => {
    try {
      return { success: true, data: await publishEngine.buildInventory(options ?? {}) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

ipcMain.handle('publish:start', async () => {
  try {
    await publishEngine.startPublishing();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

/** Pause, PAS abandon : rien n'est nettoyé, tout se reprend d'un bouton. */
ipcMain.handle('publish:pause', async () => {
  publishEngine.requestPause();
  return { success: true };
});

ipcMain.handle('publish:retry', async () => {
  try {
    await publishEngine.retryPublishing();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

/**
 * LA BASCULE. Le moteur revérifie les trois verrous avant de toucher le moindre
 * fichier de clé — ce canal ne fait qu'exprimer le geste de l'utilisateur.
 */
ipcMain.handle('publish:commitSwitch', async () => {
  try {
    return { success: true, data: await publishEngine.commitKeySwitch() };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('publish:abandon', async () => {
  try {
    return { success: true, data: await publishEngine.abandonMigration() };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

/**
 * CLÉS RETIRÉES — anciennes clés de coffre, LECTURE SEULE.
 *
 * Le renderer déchiffre lui-même les petits blobs de profil hybride ; après une
 * bascule, ces blobs dorment encore sous l'ancienne clé (la migration ne
 * rescelle rien localement — voir `publish/itemTransfer.ts`). Sans ce canal, un
 * coffre migré paraîtrait vide côté interface alors que tout est intact sur le
 * disque. Le renderer ne s'en sert QUE pour lire : `encryptFileContent` ignore
 * ces clés, donc aucun fichier neuf ne peut être scellé sous une clé retirée.
 */
ipcMain.handle('publish:getRetiredKeys', async () => {
  try {
    const keys = await publishEngine.getRetiredKeysForRenderer();
    return keys.map((k) => Array.from(k));
  } catch (error) {
    log.error('[publish] Clés retenues indisponibles:', (error as Error).message);
    return [];
  }
});

// --- Sync IPC handlers ---

ipcMain.handle('sync:getStatus', async () => {
  return syncService.getSyncStatus();
});

// --- Collaboration temps réel : notes en session vivante ---
//
// Les sessions vivent dans le renderer (CRDT, clé de salle, WebSocket) ; la
// FUSION des notes tourne ici. Le renderer pousse donc l'instantané de ses
// sessions — à chaque démarrage/arrêt de session et périodiquement tant qu'il
// en reste une — et `syncService` refuse de remplacer une note vivante par le
// résultat d'une fusion (l'arbitrage est reporté après la session).
//
// Le registre démarre VIDE à chaque lancement du processus principal : une
// garde héritée d'une exécution précédente gèlerait une note pour toujours.
// Il périme aussi de lui-même si le renderer cesse de publier (voir liveNotes).
liveNotesRegistry.resetLiveNotes();
ipcMain.handle('collab:setLiveNotes', async (_event: IpcMainInvokeEvent, noteIds: unknown) => {
  liveNotesRegistry.setLiveNotes(Array.isArray(noteIds) ? noteIds : []);
  return true;
});

// Toggle the background sync service without restarting the app. Enabling
// starts the periodic daemon + fires an initial sync; disabling stops the
// timer so no further triggerSync calls run (file-change notifications
// become no-ops because syncService.triggerSync guards on activeProfileId).
// The pause flag is keyed by profile (`sync-paused-<profileId>`) so each
// profile has its own pause preference. The legacy global `sync-paused`
// key is still read as a fallback at startup for users updating from a
// single-account build; first toggle after update migrates it away.
ipcMain.handle('sync:setEnabled', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
  try {
    const flags = readFlags();
    const key = activeProfileId ? `sync-paused-${activeProfileId}` : 'sync-paused';
    if (enabled) {
      delete flags[key];
      // Clean up any legacy global value shadowing this profile's new one.
      if (activeProfileId) delete flags['sync-paused'];
      writeFlags(flags);
      if (activeProfileId) {
        syncService.init(activeProfileId);
        syncService.onStatusChange((status) => updateTrayForSync(status));
      }
    } else {
      flags[key] = 'true';
      // Legacy global fallback no longer authoritative once per-profile is set.
      if (activeProfileId) delete flags['sync-paused'];
      writeFlags(flags);
      syncService.stop();
    }
    return { success: true };
  } catch (err) {
    log.error('[sync:setEnabled] failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

/**
 * RAMENER LES PROFILS DU NUAGE — hors de tout appairage.
 *
 * `restoreProfilesFromCloud` faisait déjà exactement ce travail : lister les
 * profils synchronisés, télécharger leurs manifestes, les déchiffrer et
 * recréer les entrées locales avec leur nom et leur couleur. Elle n'était
 * joignable que depuis le protocole d'appairage à six chiffres — que l'écran
 * de connexion saute désormais dès que le serveur détient une copie enveloppée
 * de la FEK. Le raccourci a donc emporté la restauration avec lui.
 *
 * Rend le nombre de profils ramenés, pour que l'appelant sache s'il doit se
 * rabattre sur la création d'un profil neuf — un repli qui ne devrait servir
 * qu'en dernier recours, et qui servait en réalité à chaque connexion.
 *
 * IDEMPOTENT : `profileManager.restoreProfileFromCloud` réécrit une entrée
 * existante plutôt que d'en ajouter une seconde, donc rappeler cette route ne
 * duplique rien.
 */
/**
 * RETIRER UN PROFIL DU NUAGE — sans quoi le supprimer ne veut rien dire.
 *
 * `profileManager.deleteProfile` n'efface que le disque local. Tant que rien ne
 * restaurait les profils, cela passait pour un simple gaspillage de stockage.
 * Depuis que la connexion les ramène, c'est devenu une boucle : on supprime, et
 * le profil revient à la connexion suivante.
 *
 * Best-effort et NON BLOQUANT : hors ligne ou compte déconnecté, la suppression
 * locale doit rester possible. Le profil reviendra alors à la prochaine
 * connexion — mieux vaut ce défaut connu qu'un profil qu'on ne peut plus retirer
 * de sa propre machine.
 */
ipcMain.handle('sync:deleteCloudProfile', async (_event: IpcMainInvokeEvent, profileId: string) => {
  if (!profileId) return { success: false, error: 'No profileId' };
  try {
    // Un profil volumineux dans un bucket perso ne se vide pas en une requête :
    // le Worker est borné par son budget de sous-requêtes et répond
    // `deletion_incomplete` plutôt que d'enterrer le profil en laissant des
    // octets derrière. On relance jusqu'à ce qu'il ait fini.
    const MAX_PASSES = 40;
    let deletedBytes = 0;
    let result!: Awaited<ReturnType<typeof authService.authenticatedApiCall<{ deletedBytes: number }>>>;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      result = await authService.authenticatedApiCall<{ deletedBytes: number }>(
        `/sync/profiles/${encodeURIComponent(profileId)}`,
        { method: 'DELETE' }
      );
      if (result.success) {
        deletedBytes += result.data?.deletedBytes ?? 0;
        return { success: true, deletedBytes };
      }
      if (result.code !== 'deletion_incomplete') break;
      deletedBytes += (result as { deletedBytes?: number }).deletedBytes ?? 0;
      log.info(`[sync:deleteCloudProfile] passe ${pass + 1} partielle, on continue`);
    }
    return result.success
      ? { success: true, deletedBytes }
      : { success: false, error: result.error };
  } catch (err) {
    log.error('[sync:deleteCloudProfile] failed:', (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('sync:restoreCloudProfiles', async () => {
  try {
    const { restoreProfilesFromCloud } = await import('./pairingService');
    const ids = await restoreProfilesFromCloud();
    return { success: true, restored: ids.length, profileIds: ids };
  } catch (err) {
    // Non fatal : l'appelant se rabat sur ce qu'il a en local. Une restauration
    // qui échoue ne doit pas empêcher d'entrer dans l'application.
    log.error('[sync:restoreCloudProfiles] failed:', (err as Error).message);
    return { success: false, restored: 0, profileIds: [], error: (err as Error).message };
  }
});

ipcMain.handle('sync:getCloudProfiles', async () => {
  const result = await authService.authenticatedApiCall<{
    profiles: Array<{
      profileId: string;
      manifestVersion: number;
      storageUsed: number;
      lastSyncAt: string | null;
    }>;
  }>('/sync/profiles');
  return result.success ? result.data : { profiles: [] };
});

ipcMain.handle('sync:triggerSync', async (_event: IpcMainInvokeEvent, profileId: string) => {
  const id = profileId || activeProfileId;
  if (!id) return { state: 'error', error: 'No active profile' };
  return syncService.triggerSync(id);
});

ipcMain.handle(
  'sync:resolveConflict',
  async (
    _event: IpcMainInvokeEvent,
    profileId: string,
    fileId: string,
    resolution: 'local' | 'remote'
  ) => {
    return syncService.resolveConflict(profileId, fileId, resolution);
  }
);

ipcMain.handle('sync:getConflicts', async (_event: IpcMainInvokeEvent, profileId: string) => {
  return syncService.getConflicts(profileId);
});

ipcMain.handle('sync:getAllFileStatuses', async (_event: IpcMainInvokeEvent, profileId: string) => {
  const { getAllFileStatuses } = await import('./sync/syncManifest');
  return getAllFileStatuses(profileId);
});

/**
 * ACTIVITÉ DE SYNC — ce que le moteur savait déjà mais ne disait à personne.
 *
 * Deux sources, jointes ici parce qu'elles vivent dans deux fichiers qui ne se
 * connaissent pas : le manifeste local (transferts aboutis, en attente,
 * conflits) et la file de retry (ce qui a échoué, avec sa raison). Les échecs
 * sont filtrés par profil — la file est partagée entre tous les profils.
 *
 * Lecture pure : aucun cycle déclenché, aucune écriture. Un profil inconnu rend
 * quatre listes vides.
 */
/**
 * LIBÉRER L'ESPACE QUE PLUS RIEN NE RÉFÉRENCE — inventaire, puis suppression
 * SEULEMENT si on la demande.
 *
 * ── POURQUOI CE GESTE EXISTE ────────────────────────────────────────────────
 *
 * `/sync/delta/gc` ramasse les blocs orphelins à l'intérieur d'un fichier
 * VIVANT ; `DELETE /sync/file` purge celui qu'on supprime. Aucun des deux ne
 * visite un `fileId` DISPARU du manifeste sans être passé par le DELETE — les
 * deux itèrent sur ce qui est encore là. Mesuré le 2026-09-07 sur un compte
 * ouvert depuis deux postes : 4,2 Go que plus rien ne référençait.
 *
 * ── L'ENSEMBLE VIVANT VIENT D'ICI, ET IL NE PEUT VENIR QUE D'ICI ────────────
 *
 * Le manifeste est chiffré de bout en bout : le serveur ne sait pas quels
 * fichiers existent encore. Le renderer non plus — il ne tient pas le manifeste
 * de synchro. Ce processus est le seul à pouvoir répondre, d'où l'assemblage
 * ici plutôt que côté écran.
 *
 * La VERSION accompagne l'ensemble : le serveur refuse d'agir si le manifeste a
 * bougé depuis, parce qu'un ensemble vivant périmé désignerait comme orphelins
 * des octets qu'un autre appareil vient de référencer.
 *
 * ── `execute` EST EXPLICITE, TOUJOURS ───────────────────────────────────────
 *
 * Sans lui, l'appel compte et ne supprime rien. C'est le bon sens de l'oubli :
 * un appel malformé inventorie. L'écran s'en sert pour montrer les chiffres
 * AVANT de proposer quoi que ce soit — on ne demande pas à quelqu'un
 * d'autoriser une suppression dont il ne connaît pas la taille.
 */
ipcMain.handle(
  'sync:gcProfile',
  async (_event: IpcMainInvokeEvent, profileId: string, execute?: boolean) => {
    const id = profileId || activeProfileId;
    if (!id) return { ok: false, code: 'no_profile' };

    const [manifestModule, r2] = await Promise.all([
      import('./sync/syncManifest'),
      import('./sync/syncR2Client'),
    ]);

    const localManifest = await manifestModule.load(id);
    if (!localManifest) return { ok: false, code: 'no_manifest' };

    /*
      TOUTES LES ENTRÉES, sans filtrer sur le statut.

      Une entrée `pending_upload`, `conflict` ou `local_only` désigne un fichier
      que le nuage porte peut-être déjà. L'écarter de l'ensemble vivant le
      ferait passer pour un orphelin — et supprimer les octets d'un conflit non
      arbitré est le seul geste vraiment irréparable de cette histoire. On erre
      donc du côté qui CONSERVE.
    */
    const liveFileIds = Object.keys(localManifest.files);
    const inventaire = await r2.gcProfile(
      id,
      liveFileIds,
      localManifest.version ?? 0,
      execute === true
    );
    if (!inventaire) return { ok: false, code: 'unavailable' };
    // Le refus porte SA raison jusqu'a l'ecran — voir `gcProfile`.
    if ('failed' in inventaire) {
      return { ok: false, code: inventaire.code, message: inventaire.message };
    }
    return { ok: true, ...inventaire };
  }
);

ipcMain.handle('sync:getActivity', async (_event: IpcMainInvokeEvent, profileId: string) => {
  const id = profileId || activeProfileId;
  if (!id) return { recent: [], pending: [], conflicts: [], failed: [] };

  const [manifestModule, queueModule] = await Promise.all([
    import('./sync/syncManifest'),
    import('./sync/syncQueue'),
  ]);

  const [activity, localManifest, queued] = await Promise.all([
    manifestModule.getActivity(id),
    manifestModule.load(id),
    queueModule.load().catch(() => []),
  ]);

  const attemptedAt = (iso: string | null): number => {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(ms) ? 0 : ms;
  };

  const failed = queued
    .filter((item) => item.profileId === id && item.attempts > 0 && item.error)
    .sort((a, b) => attemptedAt(b.lastAttempt) - attemptedAt(a.lastAttempt))
    .slice(0, 100)
    .map((item) => {
      const localPath = localManifest?.files[item.resourceId]?.localPath;
      return {
        id: item.id,
        fileId: item.resourceId,
        name: localPath?.split('/').pop() || item.resourceId,
        localPath,
        resourceType: item.resourceType,
        // `type` de la file EST le sens du transfert (upload/download/delete).
        direction: item.type,
        attempts: item.attempts,
        maxAttempts: item.maxAttempts,
        error: item.error,
        lastAttempt: item.lastAttempt,
        // Plus aucune tentative prévue : l'utilisateur doit relancer lui-même.
        exhausted: item.attempts >= item.maxAttempts,
      };
    });

  /*
    LE COTE DISTANT D'UN CONFLIT — sans quoi on demande de choisir a l'aveugle.

    Le panneau propose « Garder ma version » ou « Garder celle du nuage ». Sans
    rien dire de la seconde, la question est insoluble : l'utilisateur ne
    dispose que de la sienne, et clique au hasard.

    On ne peut PAS montrer un vrai comparatif de contenu — le manifeste distant
    est chiffre de bout en bout et l'objet ne se telecharge pas pour un survol.
    Mais la TAILLE et la DATE suffisent a trancher l'immense majorite des cas :
    « la mienne fait 2,6 Mo d'hier, celle du nuage 2,6 Mo d'il y a une heure ».

    UNE SEULE REQUETE, ET SEULEMENT S'IL Y A DES CONFLITS. Le panneau s'ouvre
    souvent et n'en a presque jamais.
  */
  let conflicts = activity.conflicts;
  if (conflicts.length > 0) {
    try {
      const r2 = await import('./sync/syncR2Client');
      const { manifest: chiffre } = await r2.getManifest(id);
      if (chiffre) {
        const clair = await StorageService.decryptManifestAuto(chiffre);
        const distant = JSON.parse(clair.toString('utf-8')) as {
          files: Record<string, { size?: number; updatedAt?: string }>;
        };
        conflicts = conflicts.map((c) => {
          const d = distant.files?.[c.fileId];
          return d ? { ...c, remoteSize: d.size ?? null, remoteUpdatedAt: d.updatedAt ?? null } : c;
        });
      }
    } catch (err) {
      // Le distant illisible n'empeche pas d'arbitrer : on rend le panneau sans
      // la colonne, plutot que de le faire echouer pour un enrichissement.
      log.warn('[sync:getActivity] cote distant indisponible:', (err as Error).message);
    }
  }

  return { ...activity, conflicts, failed };
});

/**
 * REESSAYER UN ECHEC EPUISE, a la demande.
 *
 * `sync:getActivity` annonçait deja « Plus aucune tentative prevue :
 * l'utilisateur doit relancer lui-meme » — sauf qu'aucun chemin ne le
 * permettait. La seule sortie etait de vider la file entiere, ce qui emporte
 * aussi le travail encore programme.
 *
 * Le cycle est declenche DANS LA FOULEE : sans lui, « Reessayer » ne ferait
 * que remettre un compteur a zero, et il faudrait attendre le prochain cycle
 * pour voir quoi que ce soit. L'attente est volontaire, pour que le panneau se
 * rafraichisse sur un etat vrai plutot que sur une promesse.
 */
ipcMain.handle('sync:retryFailed', async (_event: IpcMainInvokeEvent, itemId: string) => {
  if (!itemId) return { success: false, error: 'No itemId' };
  try {
    const queueModule = await import('./sync/syncQueue');
    // Rend `false` sur un element introuvable OU non epuise — celui-la n'a pas
    // echoue, il attend son essai, et lui rendre un budget de tentatives
    // viderait le plafond de son sens.
    const rearme = await queueModule.rearm(itemId);
    if (!rearme) return { success: false, error: 'not_exhausted' };
    if (activeProfileId) await syncService.triggerSync(activeProfileId);
    return { success: true };
  } catch (err) {
    log.error('[sync:retryFailed] failed:', (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
});

/**
 * ECARTER UN ECHEC EPUISE.
 *
 * Certains echecs ne se reparent pas — un objet distant reellement corrompu,
 * un fichier supprime ailleurs. Sans cette sortie, la seule option etait de
 * vivre avec un badge rouge permanent, ce qui apprend a ignorer l'indicateur.
 *
 * N'affirme RIEN sur l'etat de la ressource : c'est un geste de l'utilisateur,
 * pas un constat. Si le desaccord existe toujours, la fusion du prochain cycle
 * le reprogrammera — et c'est tres bien ainsi.
 */
ipcMain.handle('sync:dismissFailed', async (_event: IpcMainInvokeEvent, itemId: string) => {
  if (!itemId) return { success: false, error: 'No itemId' };
  try {
    const queueModule = await import('./sync/syncQueue');
    const ecarte = await queueModule.dismiss(itemId);
    return ecarte ? { success: true } : { success: false, error: 'not_exhausted' };
  } catch (err) {
    log.error('[sync:dismissFailed] failed:', (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
});

// --- Session FEK handover (renderer → main, memory only) ---
//
// The renderer pushes the hybrid FEK here on every unlock so main-process
// streaming crypto (hybrid:saveFromPath / hybrid:readDecryptedV3, sync
// portability probes) can key V3 containers with the ACCOUNT key instead of
// the machine-local one. The bytes live only in sessionKeyStore (zeroized on
// clear/replace/app-quit) — never written to disk, never logged.

ipcMain.handle(
  'sync:setSessionKey',
  async (_event: IpcMainInvokeEvent, rawBytes: Uint8Array | number[]) => {
    const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    sessionKeyStore.setSessionKey(bytes);
    // Hybrid unlock — reflect it on the tray badge + mini window immediately.
    noteSessionKeySet();
    refreshTray();
    notifyMiniRefresh();
    // Replay Explorer protect requests that were queued while locked (Wave 2b).
    deliverPendingShellProtect();
    return true;
  }
);

ipcMain.handle('sync:clearSessionKey', async () => {
  sessionKeyStore.clearSessionKey();
  // Coffre verrouillé : plus aucune session d'édition vivante ne peut tourner,
  // la garde de fusion n'a plus lieu d'être (le renderer republiera).
  liveNotesRegistry.resetLiveNotes();
  // Et le clair des notes gardé pour la sauvegarde incrémentale part avec.
  forgetNotesVault();
  // Hybrid lock — reflect it on the tray badge + mini window immediately.
  noteSessionKeyCleared();
  refreshTray();
  notifyMiniRefresh();
  return true;
});

// --- FEK persistence via OS keychain (safeStorage) ---

ipcMain.handle('hybrid:storeFEK', async (_event: IpcMainInvokeEvent, rawBytes: number[]) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      // Security: refuse rather than silently failing. A caller that ignores
      // the boolean return value would otherwise proceed thinking the FEK
      // was persisted when it wasn't — and a future `hybrid:storeFEK` with
      // fallback-to-plaintext would leak the master key. Throwing forces
      // the renderer to surface the error and prompt the user to unlock
      // on every launch.
      throw new Error(
        '[hybrid:storeFEK] OS keychain (safeStorage) is unavailable on this system. ' +
          'The File Encryption Key cannot be persisted securely. ' +
          'You will need to enter your vault password at each launch.'
      );
    }
    const plainBuffer = Buffer.from(rawBytes);
    const encrypted = safeStorage.encryptString(plainBuffer.toString('base64'));
    const fekPath = path.join(StorageService.getBaseDir(), '.fek_safe');
    await fs.writeFile(fekPath, encrypted, { mode: 0o600 });
    return true;
  } catch (error) {
    log.error('Error in hybrid:storeFEK:', error);
    return false;
  }
});

ipcMain.handle('hybrid:loadFEK', async () => {
  try {
    const baseDir = StorageService.getBaseDir();
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    const fekPath = path.join(baseDir, '.fek_safe');
    const encrypted = await fs.readFile(fekPath).catch(() => null);
    if (!encrypted) {
      return null;
    }
    const base64 = safeStorage.decryptString(encrypted);
    return Array.from(Buffer.from(base64, 'base64'));
  } catch (error) {
    log.error('Error in hybrid:loadFEK:', error);
    return null;
  }
});

ipcMain.handle('hybrid:hasKey', async () => {
  try {
    const keyPath = path.join(StorageService.getBaseDir(), 'wrapped_fek.json');
    await fs.access(keyPath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('hybrid:clearFEK', async () => {
  try {
    const fekPath = path.join(StorageService.getBaseDir(), '.fek_safe');
    await fs.unlink(fekPath).catch(() => {});
    return true;
  } catch {
    return false;
  }
});

// --- Device-bound key (E5-4): a random 256-bit key in the OS keychain that unlocks
// the FEK after an SSO login. Same safeStorage seal as the FEK; `.device_key_safe`. ---

ipcMain.handle('hybrid:storeDeviceKey', async (_event: IpcMainInvokeEvent, rawBytes: number[]) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      // Refuse rather than write the key in plaintext — the renderer surfaces this
      // and falls back to a password unlock.
      throw new Error('[hybrid:storeDeviceKey] OS keychain (safeStorage) is unavailable.');
    }
    const encrypted = safeStorage.encryptString(Buffer.from(rawBytes).toString('base64'));
    const keyPath = path.join(StorageService.getBaseDir(), '.device_key_safe');
    await fs.writeFile(keyPath, encrypted, { mode: 0o600 });
    return true;
  } catch (error) {
    log.error('Error in hybrid:storeDeviceKey:', error);
    return false;
  }
});

ipcMain.handle('hybrid:loadDeviceKey', async () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const keyPath = path.join(StorageService.getBaseDir(), '.device_key_safe');
    const encrypted = await fs.readFile(keyPath).catch(() => null);
    if (!encrypted) return null;
    const base64 = safeStorage.decryptString(encrypted);
    return Array.from(Buffer.from(base64, 'base64'));
  } catch (error) {
    log.error('Error in hybrid:loadDeviceKey:', error);
    return null;
  }
});

ipcMain.handle('hybrid:clearDeviceKey', async () => {
  try {
    const keyPath = path.join(StorageService.getBaseDir(), '.device_key_safe');
    await fs.unlink(keyPath).catch(() => {});
    return true;
  } catch {
    return false;
  }
});

// --- E9-11: remote device-wipe execution (crypto + content-cache scope) ---
//
// Triggered by authService when a /auth/refresh returns code 'device_wipe_required'. Deletes EVERY
// local key so all encrypted content (notes.db, file chunks) becomes undecryptable — the personal
// profile/settings are intentionally NOT destroyed (BYOD-safe). Best-effort proof of execution: ask
// the renderer (which holds the in-memory signing key) to sign + POST the ack BEFORE we lock; if the
// vault is locked or the window is gone, the wipe still happens and the server marks it
// wipe_pending_stale. Honest limit: a device that never reconnects is never wiped.
async function executeDeviceWipe(info: { wipeNonce: string | null }): Promise<void> {
  log.warn('[device-wipe] executing admin-requested remote wipe (crypto + content cache)');

  // Pin the ACTIVE profile's dir(s) SYNCHRONOUSLY, before any await — a concurrent profile switch
  // must never redirect the irreversible key deletion to a DIFFERENT profile's keys (review #8). We
  // wipe ONLY the active profile's directory, NEVER the legacy root FilarData: other profiles may
  // source/share the root-level FEK (ensureFEKAvailable copies it), so deleting it would orphan their
  // keys = irreversible data loss in a sibling vault (review #3).
  //
  // A separate hidden/decoy profile (E2-9, hidden vault #6) is INTENTIONALLY left untouched: it holds
  // the user's deniable PERSONAL data — not org data — under a duress password. Wiping it would both
  // destroy personal data (against the BYOD-safe scope) AND break plausible deniability by revealing
  // the decoy ever existed. The org wipe is scoped to the active account only.
  const dirs = Array.from(
    new Set([StorageService.getBaseDir(), authService.getProfileDir()].filter(Boolean))
  );
  const profileDir = dirs[0];

  // 1) Read the device id (from the pinned dir) BEFORE clearing it; ask the renderer to sign + POST.
  const deviceId = await authService.peekDeviceId(profileDir);
  const ts = Date.now();
  if (deviceId && info.wipeNonce && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('device-wipe-required', {
        deviceId,
        wipeNonce: info.wipeNonce,
        ts,
      });
    } catch {
      /* renderer gone — the wipe still proceeds; the proof is best-effort */
    }
  }

  // 2) Auth/session/identity artifacts (authService-owned), pinned to the captured profile dir.
  await authService.wipeAuthArtifacts(profileDir);

  // 3) Every local KEY in the active profile dir, best-effort per file. Once these are gone the
  //    encrypted content on disk (notes.db, file chunks) is unreadable.
  const keyFiles = [
    'encryption.key', // notes.db / local content key (plaintext legacy)
    'encryption.key.safe', // notes.db / local content key (keychain-sealed)
    '.fek_safe', // FEK, keychain-sealed
    'wrapped_fek.json', // FEK wrapped under the password (else the password re-derives it)
    '.device_key_safe', // device-bound / WebAuthn-PRF key (E5-4)
    'user_keypair.json', // per-user keypair blob (E2)
    'sync-manifest.json', // cloud sync state / content-cache manifest
  ];
  for (const dir of dirs) {
    for (const f of keyFiles) {
      await fs.unlink(path.join(dir, f)).catch(() => {});
    }
  }

  log.warn('[device-wipe] local keys + cache cleared — device neutralized');
}
authService.setDeviceWipeHandler(executeDeviceWipe);

// --- Vault Export ---

ipcMain.handle(
  'vault:exportZip',
  async (
    _event: IpcMainInvokeEvent,
    options: {
      entries: Array<{ path: string; data: string; encoding: string }>;
      encrypted?: boolean;
      password?: string;
      defaultFileName?: string;
    }
  ) => {
    try {
      const archiver = require('archiver');

      const defaultName =
        options.defaultFileName || `filarr-export-${new Date().toISOString().slice(0, 10)}.zip`;

      // Ask user where to save
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Vault',
        defaultPath: defaultName,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });

      if (result.canceled || !result.filePath) return false;

      const outputPath = result.filePath;

      // Step 1: Build the ZIP in a temp file (or directly if plain)
      const isEncrypted = options.encrypted && options.password;
      const tempZipPath = isEncrypted
        ? path.join(app.getPath('temp'), `filarr-export-temp-${Date.now()}.zip`)
        : outputPath;

      const fsSync = require('fs');
      const output = fsSync.createWriteStream(tempZipPath, { mode: 0o600 });
      const archive = archiver('zip', { zlib: { level: 9 } });

      const zipDone = await new Promise<boolean>((resolve) => {
        output.on('close', () => resolve(true));
        archive.on('error', (err: Error) => {
          log.error('[vault:exportZip] Archive error:', err);
          resolve(false);
        });

        archive.pipe(output);

        for (const entry of options.entries) {
          const buffer =
            entry.encoding === 'base64'
              ? Buffer.from(entry.data, 'base64')
              : Buffer.from(entry.data, 'utf8');
          archive.append(buffer, { name: entry.path });
        }

        archive.finalize();
      });

      if (!zipDone) return false;

      // Step 2: If encrypted, read the temp ZIP, encrypt with AES-256-GCM, write to final path
      if (isEncrypted) {
        try {
          const zipData = await fs.readFile(tempZipPath);

          // Derive key from password via PBKDF2
          const salt = crypto.randomBytes(16);
          const key = crypto.pbkdf2Sync(options.password!, salt, 600_000, 32, 'sha512');
          const iv = crypto.randomBytes(12);

          const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
          const encrypted = Buffer.concat([cipher.update(zipData), cipher.final()]);
          const tag = cipher.getAuthTag();

          // Format: FILARR_ENC_V2 (13 bytes) || salt (16) || iv (12) || tag (16) || ciphertext
          // V2: PBKDF2 600k iterations + SHA-512 (V1 used 100k + SHA-256)
          const header = Buffer.from('FILARR_ENC_V2');
          const finalBuffer = Buffer.concat([header, salt, iv, tag, encrypted]);

          await fs.writeFile(outputPath, finalBuffer);
          log.info(`[vault:exportZip] Encrypted export complete: ${finalBuffer.length} bytes`);
        } finally {
          // Always clean up the plaintext temp ZIP — even on error or crash
          await fs.unlink(tempZipPath).catch(() => {});
        }
      } else {
        log.info(`[vault:exportZip] Plain export complete`);
      }

      return true;
    } catch (error) {
      log.error('[vault:exportZip] Error:', error);
      return false;
    }
  }
);

// --- Vault Import ---

ipcMain.handle('vault:selectImportFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    filters: [{ name: 'ZIP / Encrypted', extensions: ['zip', 'enc', 'filarr'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  return {
    filePath: filePaths[0],
    isEncrypted: filePaths[0].endsWith('.enc'),
    fileName: path.basename(filePaths[0]),
  };
});

ipcMain.handle(
  'vault:importZip',
  async (
    _event: IpcMainInvokeEvent,
    options: {
      filePath?: string;
      password?: string;
    }
  ) => {
    try {
      let filePath = options.filePath;
      if (!filePath) {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
          filters: [{ name: 'ZIP / Encrypted', extensions: ['zip', 'enc', 'filarr'] }],
          properties: ['openFile'],
        });
        if (canceled || !filePaths[0]) return null;
        filePath = filePaths[0];
      }

      let zipBuffer = await fs.readFile(filePath);

      // If encrypted, decrypt first
      if (options.password && filePath.endsWith('.enc')) {
        try {
          const salt = zipBuffer.subarray(0, 16);
          const iv = zipBuffer.subarray(16, 28);
          const encrypted = zipBuffer.subarray(28);

          const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(options.password),
            'PBKDF2',
            false,
            ['deriveKey']
          );
          const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-512' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
          );
          const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
          zipBuffer = Buffer.from(decrypted);
        } catch {
          throw new Error('Invalid password or corrupted file');
        }
      }

      // Parse ZIP using JSZip (available as transitive dep from docx)
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(zipBuffer);

      // Security: ZIP-bomb defence — cap total decompressed size and entry count.
      const MAX_TOTAL_DECOMPRESSED = 500 * 1024 * 1024; // 500 MB
      const MAX_ENTRIES = 10_000;
      const MAX_ENTRY_SIZE = 50 * 1024 * 1024; // 50 MB per entry
      let totalDecompressed = 0;

      const fileEntries = Object.entries(zip.files);
      if (fileEntries.length > MAX_ENTRIES) {
        throw new Error(
          `Archive rejected: too many entries (${fileEntries.length} > ${MAX_ENTRIES})`
        );
      }

      const entries: Array<{ path: string; data: string; encoding: 'utf8' | 'base64' }> = [];

      for (const [entryPath, zipEntry] of fileEntries) {
        const entry = zipEntry as any;
        if (entry.dir) continue;

        // Reject absolute paths and traversal — entries are still passed to renderer
        // for later write through sanitizePath(), but defence-in-depth.
        if (
          entryPath.includes('..') ||
          path.isAbsolute(entryPath) ||
          /^[a-zA-Z]:[\\/]/.test(entryPath)
        ) {
          throw new Error(`Archive rejected: unsafe entry path "${entryPath.slice(0, 80)}"`);
        }

        // Pre-check the declared uncompressed size when available
        const declared = (entry._data?.uncompressedSize ?? 0) as number;
        if (declared > MAX_ENTRY_SIZE) {
          throw new Error(
            `Archive rejected: entry "${entryPath.slice(0, 80)}" exceeds ${MAX_ENTRY_SIZE} bytes`
          );
        }

        const isText = /\.(json|md|txt|yml|yaml|csv|html?)$/i.test(entryPath);
        const rawBytes = await entry.async('uint8array');

        if (rawBytes.byteLength > MAX_ENTRY_SIZE) {
          throw new Error(
            `Archive rejected: entry "${entryPath.slice(0, 80)}" exceeds ${MAX_ENTRY_SIZE} bytes after inflate`
          );
        }
        totalDecompressed += rawBytes.byteLength;
        if (totalDecompressed > MAX_TOTAL_DECOMPRESSED) {
          throw new Error(
            `Archive rejected: total uncompressed size exceeds ${MAX_TOTAL_DECOMPRESSED} bytes (ZIP bomb?)`
          );
        }

        const data = isText
          ? new TextDecoder('utf-8', { fatal: false }).decode(rawBytes)
          : Buffer.from(rawBytes).toString('base64');

        entries.push({
          path: entryPath,
          data,
          encoding: isText ? 'utf8' : 'base64',
        });
      }

      return { entries };
    } catch (error) {
      log.error('[vault:importZip] Error:', error);
      throw error;
    }
  }
);

ipcMain.handle('file:readForExport', async (_event: IpcMainInvokeEvent, fileId: string) => {
  try {
    const manifest = profileManager.getManifest();
    const profileId = manifest.activeProfileId;
    if (!profileId) return null;
    const profileDir = profileManager.getProfileDataDir(profileId);
    const filePath = path.join(profileDir, 'files', fileId);
    const data = await fs.readFile(filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } catch {
    return null;
  }
});

ipcMain.handle('file:getLocalPath', async (_event: IpcMainInvokeEvent, fileId: string) => {
  try {
    const manifest = profileManager.getManifest();
    const profileId = manifest.activeProfileId;
    if (!profileId) return null;
    const profileDir = profileManager.getProfileDataDir(profileId);
    const filePath = path.join(profileDir, 'files', fileId);
    // Check if file exists
    await fs.access(filePath);
    return filePath;
  } catch {
    return null;
  }
});

// --- Folders ---

ipcMain.handle('saveFolder', async (_event: IpcMainInvokeEvent, folder: Folder) => {
  try {
    const result = await StorageService.saveFolder(folder);
    emitFoldersUpdated();
    return result;
  } catch (error) {
    console.error('Error in saveFolder:', error);
    throw error;
  }
});

ipcMain.handle('getFolders', async () => {
  try {
    return await StorageService.getFolders();
  } catch (error) {
    console.error('Error in getFolders:', error);
    throw error;
  }
});

ipcMain.handle('getFolderItems', async (_event: IpcMainInvokeEvent, folderId: string) => {
  try {
    const folder = await StorageService.getFolder(folderId);
    return folder.items || [];
  } catch (error) {
    console.error('Error in getFolderItems:', error);
    throw error;
  }
});

ipcMain.handle('getFolder', async (_event: IpcMainInvokeEvent, id: string) => {
  try {
    // Ensure id is a string
    return await StorageService.getFolder(id.toString());
  } catch (error) {
    console.error('Error in getFolder:', error);
    throw error;
  }
});

ipcMain.handle(
  'updateFolder',
  async (_event: IpcMainInvokeEvent, id: string, updatedFolder: Partial<Folder>) => {
    try {
      const result = await StorageService.updateFolder(id, updatedFolder);
      emitFoldersUpdated();
      return result;
    } catch (error) {
      console.error('Error in updateFolder:', error);
      throw error;
    }
  }
);

ipcMain.handle('deleteFolder', async (_event: IpcMainInvokeEvent, id: string) => {
  try {
    await StorageService.deleteFolder(id);
    emitFoldersUpdated();
    return true;
  } catch (error) {
    console.error('Error in deleteFolder:', error);
    throw error;
  }
});

ipcMain.handle(
  'addItemToFolder',
  async (_event: IpcMainInvokeEvent, folderId: string, item: Item) => {
    try {
      const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
      const filePath = path.join(folderPath, sanitizePath(item.name));

      // Ensure parent folder exists
      await fs.mkdir(folderPath, { recursive: true });

      if (item.type === 'folder') {
        await fs.mkdir(filePath, { recursive: true });
        const newFolder: Folder = {
          id: item.id.toString(),
          name: item.name,
          parentId: folderId.toString(),
          items: [],
          color: item.color,
          protected: item.protected,
          password: item.password,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          reminders: [],
        };
        await StorageService.saveFolder(newFolder);
      } else if (item.content) {
        let contentBuffer: Buffer;
        if (Buffer.isBuffer(item.content)) {
          contentBuffer = item.content;
        } else if (Array.isArray(item.content)) {
          // Array of bytes from renderer (vault import)
          contentBuffer = Buffer.from(item.content as number[]);
        } else {
          contentBuffer = Buffer.from(item.content as string);
        }
        const encryptedContent = await StorageService.encryptBinary(contentBuffer);
        await fs.writeFile(filePath, encryptedContent);
      }

      const result = await StorageService.addItemToFolder(folderId.toString(), {
        id: item.id.toString(),
        name: item.name,
        type: item.type,
        size: item.content ? (item.content as Buffer).length : item.size,
        date: item.date,
        description: item.description,
        priority: item.priority,
        protected: item.protected,
        password: item.password,
        parentId: folderId.toString(),
        // Preserve creation/modification timestamps from the renderer.
        // Stripping them here previously caused the Timeline to "reset"
        // after each cloud sync: the encrypted metadata.json round-tripped
        // through the cloud lost these fields, so fetchFolders re-hydrated
        // state.files.byId with undefined dates and Timeline filtered them
        // out (see Timeline.tsx, `if (file.createdAt)`).
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });

      return result;
    } catch (error) {
      console.error('Error in addItemToFolder:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'readEncryptedFileForCopy',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
      const filePath = path.join(folderPath, sanitizePath(fileName));

      // V3 chunked files: decrypt via the streaming-aware wrapper (1 GiB
      // whole-buffer cap, French error beyond) and NEVER "migrate" them —
      // the v2-marker check below would otherwise downgrade V3 back to v2.
      if (await StorageService.isV3VaultFile(filePath)) {
        return await StorageService.decryptFileAuto(filePath);
      }

      const encryptedContent = await fs.readFile(filePath);

      // Check if migration is needed (no v2 marker detected)
      const needsMigration = StorageService.needsMachineRewrite(encryptedContent);

      const decryptedContent = await StorageService.decryptBinary(encryptedContent);

      // If the file was decrypted using v1 fallback, re-encrypt with v2
      if (needsMigration) {
        try {
          const reEncrypted = await StorageService.encryptBinary(decryptedContent);
          await fs.writeFile(filePath, reEncrypted);
        } catch (migrationError) {
          console.error(`[MIGRATION] Failed to migrate binary file ${fileName}:`, migrationError);
          // Continue anyway, the file was decrypted successfully
        }
      }

      return decryptedContent;
    } catch (error) {
      console.error('Error in readEncryptedFileForCopy:', error);
      throw error;
    }
  }
);

// Prépare un fichier pour le drag natif vers le bureau
ipcMain.handle(
  'prepareDragFile',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
      const filePath = path.join(folderPath, sanitizePath(fileName));

      const tempDir = path.join(app.getPath('temp'), 'filarr-drag');
      await fs.mkdir(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, sanitizePath(fileName));
      // V3-aware: V3 files stream chunk-by-chunk to the temp file (flat
      // memory); V1/V2 blobs decrypt whole-buffer exactly as before.
      await StorageService.decryptFileToFileAuto(filePath, tempPath);
      // Securely wipe the decrypted copy after a delay (and on quit). Important:
      // prewarmNativeDrag calls this on mousedown, so without cleanup a plaintext
      // copy would linger for every clicked file on this E2EE app.
      scheduleTempCleanup(tempPath);
      return tempPath;
    } catch (error) {
      console.error('Error in prepareDragFile:', error);
      throw error;
    }
  }
);

// Reveal a file in the OS file manager. Vault files are encrypted at rest, so we
// materialize a decrypted copy in a temp dir (auto-cleaned) and reveal that.
ipcMain.handle(
  'file:showInFolder',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
      const filePath = path.join(folderPath, sanitizePath(fileName));

      const tempDir = path.join(app.getPath('temp'), 'filarr-reveal');
      await fs.mkdir(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, sanitizePath(fileName));
      // V3-aware: streams V3 to temp with flat memory, legacy path unchanged.
      await StorageService.decryptFileToFileAuto(filePath, tempPath);
      scheduleTempCleanup(tempPath);
      shell.showItemInFolder(tempPath);
      return true;
    } catch (error) {
      console.error('Error in file:showInFolder:', error);
      return false;
    }
  }
);

// Lance le drag natif OS depuis le main process
ipcMain.on('ondragstart', (event, filePath: string) => {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABhSURBVFhH7c0xDQAwDASwov/PZS8+IMIqO93dvy0sLCwsLCz8y8LCwsLCwsK/LCwsLCwsLPzLwsLCwsLCwr8sLCwsLCws/MvCwsLCwsLCvywsLCwsLCz8y8LCwsLCwmcWvKZiRVJnxPEAAAAASUVORK5CYII='
  );
  event.sender.startDrag({ file: filePath, icon });
});

ipcMain.handle(
  'saveEncryptedFile',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string, content: any) => {
    try {
      const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
      const filePath = path.join(folderPath, sanitizePath(fileName));

      // Convert content to Buffer if it's an ArrayBuffer, Uint8Array, Array, or any TypedArray
      let bufferContent: Buffer;

      if (content instanceof ArrayBuffer) {
        bufferContent = Buffer.from(content);
      } else if (ArrayBuffer.isView(content)) {
        // Handles Uint8Array, Uint16Array, etc.
        bufferContent = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
      } else if (Buffer.isBuffer(content)) {
        bufferContent = content;
      } else if (Array.isArray(content)) {
        // Convert regular array (from serialized Uint8Array) to Buffer
        bufferContent = Buffer.from(content);
      } else {
        // If it's unknown type, try to create a Buffer from it
        bufferContent = Buffer.from(content);
      }

      // Check per-file size limit (500 MB) of the legacy whole-buffer path
      const sizeCheck = await StorageService.checkQuotaBeforeUpload(bufferContent.length);
      if (!sizeCheck.allowed) {
        throw new Error(sizeCheck.reason || 'Fichier trop volumineux (max 500 Mo)');
      }

      // PRESERVER LE CONTENEUR. Ce handler faisait `encryptBinary` + `writeFile`
      // sans jamais regarder ce qu'il ecrasait, alors que les deux chemins de
      // LECTURE reconnaissent le V3 et refusent explicitement de le migrer.
      // Editer un fichier V3 le rabaissait donc en v2 monobloc sous la cle
      // machine : plus portable, re-soumis au plafond de 500 Mo, et privé du
      // decoupage qui permet de le lire sans le charger entier.
      // Le quota se corrige d'un DELTA mesure sur le disque, avant et apres.
      // L'ancien appel ajoutait la longueur EN CLAIR a chaque enregistrement,
      // sans jamais rien retrancher : reenregistrer un fichier le comptait une
      // seconde fois, puis une troisieme. Et la verite (calculateStorageUsed)
      // somme les tailles SUR DISQUE — l'increment ne parlait meme pas de la
      // meme grandeur.
      const tailleAvant = await StorageService.onDiskSize(filePath);
      await StorageService.saveBinaryPreservingContainer(filePath, bufferContent);
      const tailleApres = await StorageService.onDiskSize(filePath);
      await StorageService.adjustStorageUsage(tailleApres - tailleAvant);

      // Notify sync service
      if (activeProfileId) {
        syncService.notifyFileChanged(activeProfileId, `${folderId}/${fileName}`);
      }
    } catch (error) {
      console.error('Error in saveEncryptedFile:', error);
      throw error;
    }
  }
);

// V3 streaming import: encrypts a file straight from its OS path into the
// vault (8 MiB chunks, flat memory), so files up to 5 GiB never transit the
// renderer or exist as a whole buffer. Emits throttled progress events on
// "file:importProgress" ({ folderId, fileName, percent }).
ipcMain.handle(
  'saveEncryptedFileFromPath',
  async (event: IpcMainInvokeEvent, folderId: string, fileName: string, sourcePath: string) => {
    try {
      if (!sourcePath || typeof sourcePath !== 'string') {
        throw new Error('Fichier source introuvable');
      }
      const resolvedSource = path.resolve(sourcePath);

      const sourceStat = await fs.stat(resolvedSource).catch(() => null);
      if (!sourceStat) {
        throw new Error('Fichier source introuvable');
      }
      if (!sourceStat.isFile()) {
        throw new Error("Le chemin source n'est pas un fichier");
      }

      // Per-file streaming cap (5 GiB) — French reason string
      const sizeCheck = await StorageService.checkQuotaBeforeUploadFromPath(sourceStat.size);
      if (!sizeCheck.allowed) {
        throw new Error(sizeCheck.reason || 'Fichier trop volumineux (max 5 Go)');
      }

      // Same destination resolution as saveEncryptedFile
      const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
      const filePath = path.join(folderPath, sanitizePath(fileName));
      await fs.mkdir(folderPath, { recursive: true });

      // Throttled progress: at most one event every ~200ms, plus the final one.
      const sender = event.sender;
      let lastEmit = 0;
      const onProgress = (doneBytes: number, totalBytes: number): void => {
        const now = Date.now();
        if (doneBytes < totalBytes && now - lastEmit < 200) return;
        lastEmit = now;
        const percent =
          totalBytes === 0 ? 100 : Math.min(100, Math.round((doneBytes / totalBytes) * 100));
        if (!sender.isDestroyed()) {
          sender.send('file:importProgress', { folderId, fileName, percent });
        }
      };

      // Key selection is authoritative on the MAIN side, not on the renderer's
      // (possibly stale) storage-mode config: whenever a session FEK is loaded
      // the profile is hybrid/cloud-synced, so a large import MUST become a
      // PORTABLE V3-FEK blob — otherwise it would be a machine-key blob that the
      // sync path can never ship (isPortableV3File === false → stuck local_only).
      // The session FEK is only ever set for hybrid profiles; a genuine
      // local-only profile has none and keeps the machine-key path unchanged.
      const useSessionFek = sessionKeyStore.hasSessionKey();
      const { origSize } = useSessionFek
        ? await StorageService.saveEncryptedFileFromPathFEK(resolvedSource, filePath, onProgress)
        : await StorageService.saveEncryptedFileFromPathV3(resolvedSource, filePath, onProgress);

      // Same accounting + sync notification as the buffer handler
      await StorageService.incrementStorageUsage(origSize);
      if (activeProfileId) {
        syncService.notifyFileChanged(activeProfileId, `${folderId}/${fileName}`);
      }

      // Path-based import = a "protect a file" gesture → tray/mini recents.
      recordRecentProtected(folderId.toString(), sanitizePath(fileName), origSize);

      return { size: origSize };
    } catch (error) {
      console.error('Error in saveEncryptedFileFromPath:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'renameItem',
  async (
    _event: IpcMainInvokeEvent,
    parentId: string | undefined,
    itemId: string,
    oldName: string,
    newName: string
  ) => {
    try {
      if (!itemId || !oldName || !newName) {
        throw new Error('Missing arguments for renaming');
      }

      let folderPath: string;
      if (parentId === 'root' || parentId === undefined) {
        folderPath = getActiveProfileDataDir();
      } else {
        folderPath = path.join(getActiveProfileDataDir(), parentId.toString());
      }

      const oldPath = path.join(folderPath, sanitizePath(oldName));
      const newPath = path.join(folderPath, sanitizePath(newName));

      // Check if old item exists and attempt rename
      if (
        await fs
          .access(oldPath)
          .then(() => true)
          .catch(() => false)
      ) {
        try {
          await fs.rename(oldPath, newPath);
        } catch (renameError: unknown) {
          console.error(
            `Error physically renaming file from ${oldName} to ${newName} in ${folderPath}:`,
            renameError
          );
          const renameMessage =
            renameError instanceof Error ? renameError.message : 'Unknown error';
          throw new Error(`Cannot physically rename file: ${renameMessage}`);
        }
      } else if (oldName !== newName) {
        // Physical file doesn't exist - still update metadata below
        console.warn(`Physical file ${oldName} not found in ${folderPath}, updating metadata only`);
      }

      // Update metadata in StorageService ONLY if physical rename succeeded (or was not necessary)
      if (parentId === 'root' || parentId === undefined) {
        const folder = await StorageService.getFolder(itemId);
        if (folder) {
          folder.name = newName;
          await StorageService.saveFolder(folder);
        }
      } else {
        const folder = await StorageService.getFolder(parentId);
        if (folder && folder.items) {
          const updatedItems = folder.items.map((item) =>
            item.id === itemId ? { ...item, name: newName } : item
          );
          await StorageService.updateFolder(parentId, { ...folder, items: updatedItems });
        }
      }

      return true;
    } catch (error) {
      console.error('Error in renameItem:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'removeItemFromFolder',
  async (_event: IpcMainInvokeEvent, folderId: string, itemId: string) => {
    try {
      const result = await StorageService.removeItemFromFolder(folderId, itemId);
      emitFoldersUpdated();
      return result;
    } catch (error) {
      console.error('Error in removeItemFromFolder:', error);
      throw error;
    }
  }
);

/**
 * « Déplacer vers le coffre en laissant un raccourci » : les octets sont déjà
 * dans le coffre ; ici on efface ceux de l'espace personnel et on garde la
 * fiche, transformée en raccourci (StorageService.convertFileToVaultShortcut).
 * Même sanitisation que `hybrid:deleteBlob` : le dossier est un segment de
 * chemin, on refuse tout ce qui n'en est pas un.
 */
ipcMain.handle(
  'convertFileToVaultShortcut',
  async (
    _event: IpcMainInvokeEvent,
    folderId: string,
    fileId: string,
    ref: { vaultId: string; itemId: string; movedAt: string }
  ) => {
    if (!folderId || !fileId || !ref) {
      throw new Error('folderId, fileId and vaultRef are required to convert a file into a vault shortcut.');
    }
    try {
      const result = await StorageService.convertFileToVaultShortcut(
        sanitizeFolderId(folderId.toString()),
        fileId.toString(),
        ref
      );
      emitFoldersUpdated();
      return result;
    } catch (error) {
      console.error('Error in convertFileToVaultShortcut:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'saveFile',
  async (_event: IpcMainInvokeEvent, folderId: string, file: FileUpload) => {
    try {
      return await StorageService.saveFile(folderId, file);
    } catch (error) {
      console.error('Error in saveFile:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'readFile',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      return await StorageService.readFile(folderId, fileName);
    } catch (error) {
      console.error('Error in readFile:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'deleteFile',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      return await StorageService.deleteFile(folderId, fileName);
    } catch (error) {
      console.error('Error in deleteFile:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'openFile',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
      const filePath = path.join(folderPath, sanitizePath(fileName));

      // Read encrypted file content
      const encryptedContent = await fs.readFile(filePath);

      // Decrypt content
      const decryptedContent = await StorageService.decrypt(encryptedContent.toString('utf8'));

      // Write decrypted content to temporary file
      const tempPath = cheminTemporaireOuverture(fileName);
      await fs.mkdir(path.dirname(tempPath), { recursive: true });
      await fs.writeFile(tempPath, decryptedContent);
      scheduleTempCleanup(tempPath);

      // Open temporary file
      await shell.openPath(tempPath);

      return true;
    } catch (error) {
      console.error('Error in openFile:', error);
      throw error;
    }
  }
);

ipcMain.handle('getItem', async (_event: IpcMainInvokeEvent, itemId: string) => {
  try {
    if (!itemId) {
      throw new Error('itemId is undefined or null');
    }
    const item = await StorageService.getItem(itemId.toString());
    if (item) {
      return item;
    }
    throw new Error('Item not found');
  } catch (error) {
    console.error('Error in getItem:', error);
    throw error;
  }
});

/**
 * UN DOSSIER PAR OUVERTURE — la collision qui reecrivait le mauvais fichier.
 *
 * Le temporaire etait ecrit dans la RACINE de %TEMP% sous le nom BRUT du
 * fichier. Deux `rapport.docx` ranges dans deux dossiers differents
 * partageaient donc un seul et meme temporaire : le surveillant du premier
 * re-chiffrait les octets du SECOND dans le coffre du premier. Corruption
 * silencieuse, sans le moindre message.
 *
 * Le nom reste lisible (l'application systeme l'affiche, et un
 * `rapport-a3f2.docx` deroute) ; c'est le DOSSIER qui porte l'unicite. Il vit
 * sous `filarr-open/`, desormais balaye au demarrage comme les autres — ces
 * temporaires echappaient aussi au menage d'apres-plantage.
 */
function cheminTemporaireOuverture(fileName: string): string {
  const dossier = path.join(
    app.getPath('temp'),
    'filarr-open',
    crypto.randomBytes(8).toString('hex')
  );
  return path.join(dossier, sanitizePath(fileName));
}

ipcMain.handle(
  'openEncryptedFile',
  async (
    _event: IpcMainInvokeEvent,
    folderId: string,
    fileName: string,
    shouldOpen: boolean = true
  ) => {
    try {
      let folderPath: string;
      if (folderId === 'root') {
        folderPath = getActiveProfileDataDir();
      } else {
        folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
      }
      const filePath = path.join(folderPath, sanitizePath(fileName));

      // V3 chunked files: stream-decrypt straight to the temp file (flat
      // memory) and skip the legacy migration check — the v2-marker test below
      // would otherwise silently downgrade V3 files back to whole-blob v2.
      const isV3 = await StorageService.isV3VaultFile(filePath);

      const tempPath = cheminTemporaireOuverture(fileName);
      await fs.mkdir(path.dirname(tempPath), { recursive: true });

      if (isV3) {
        try {
          await StorageService.decryptFileToFileAuto(filePath, tempPath);
        } catch (decryptError: unknown) {
          console.error('Detailed error during decryption:', decryptError);
          const decryptMessage =
            decryptError instanceof Error ? decryptError.message : 'Unknown error';
          throw new Error(`Cannot decrypt file: ${decryptMessage}`);
        }
      } else {
        const encryptedContent = await fs.readFile(filePath);

        // Check if migration is needed (no v2 marker detected)
        const needsMigration = StorageService.needsMachineRewrite(encryptedContent);

        let decryptedContent: Buffer;
        try {
          decryptedContent = await StorageService.decryptBinary(encryptedContent);
        } catch (decryptError: unknown) {
          console.error('Detailed error during decryption:', decryptError);
          const decryptMessage =
            decryptError instanceof Error ? decryptError.message : 'Unknown error';
          throw new Error(`Cannot decrypt file: ${decryptMessage}`);
        }

        // If the file was decrypted using v1 fallback, re-encrypt with v2
        if (needsMigration) {
          try {
            const reEncrypted = await StorageService.encryptBinary(decryptedContent);
            await fs.writeFile(filePath, reEncrypted);
          } catch (migrationError) {
            console.error(`[MIGRATION] Failed to migrate binary file ${fileName}:`, migrationError);
            // Continue anyway, the file was decrypted successfully
          }
        }

        await fs.writeFile(tempPath, decryptedContent);
      }

      scheduleTempCleanup(tempPath);

      if (shouldOpen) {
        // Watch temporary file for modifications
        const watcher: FSWatcher = chokidar.watch(tempPath, {
          persistent: true,
          awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100,
          },
        });

        watcher.on('change', async (_watchPath: string) => {
          // LE MINUTEUR REPART A CHAQUE ENREGISTREMENT.
          //
          // Le menage fermait le surveillant au bout d'un delai fixe compte
          // depuis l'OUVERTURE. Passe ce delai, enregistrer dans Word ne
          // revenait plus dans le coffre — sans un mot, et alors que le fichier
          // etait toujours ouvert a l'ecran. Ce n'est pas une fenetre de
          // securite qu'on allonge : c'est le meme delai, recompte depuis la
          // DERNIERE activite. Un fichier abandonne est purge exactement comme
          // avant ; un fichier qu'on edite cesse d'etre coupe en plein travail.
          scheduleTempCleanup(tempPath);
          try {
            if (isV3) {
              // Keep V3 files in V3: stream-encrypt the edited temp file back
              // into the vault (flat memory — no whole-buffer round trip).
              await StorageService.saveEncryptedFileFromPathV3(tempPath, filePath);
            } else {
              const updatedContent = await fs.readFile(tempPath);
              const reEncryptedContent = await StorageService.encryptBinary(updatedContent);
              await fs.writeFile(filePath, reEncryptedContent);
            }
          } catch (error) {
            console.error('Error updating file:', error);
          }
        });

        // Registry closes this watcher before the timed/manual purge wipes the
        // temp file — otherwise the delete would race the re-encrypt-on-save.
        attachTempWatcher(tempPath, watcher);

        shell.openPath(tempPath);
      }

      return tempPath;
    } catch (error) {
      console.error('Error in openEncryptedFile:', error);
      throw error;
    }
  }
);

// Open a vault file (already decrypted in the renderer) with the system default app
// In hybrid mode, watches for edits and notifies the renderer via file-changed event
ipcMain.handle(
  'openVaultFile',
  async (_event: IpcMainInvokeEvent, fileName: string, data: ArrayBuffer | Buffer | number[]) => {
    try {
      const safeName = sanitizePath(fileName);
      const tempPath = path.join(app.getPath('temp'), `vault_${Date.now()}_${safeName}`);
      const buffer = Buffer.from(data as any);
      await fs.writeFile(tempPath, buffer);
      scheduleTempCleanup(tempPath);

      // Watch for modifications so hybrid mode can re-encrypt + re-upload
      const watcher: FSWatcher = chokidar.watch(tempPath, {
        persistent: true,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100,
        },
      });

      watcher.on('change', () => {
        console.log(
          '[openVaultFile] chokidar detected change on:',
          tempPath,
          'fileName:',
          safeName
        );
        // Notify the renderer that this file was modified externally
        if (mainWindow) {
          mainWindow.webContents.send('file-changed', {
            fileName: safeName,
            tempPath,
          });
        }
      });

      // Track the watcher so purge/expiry closes it before wiping the file.
      attachTempWatcher(tempPath, watcher);

      watcher.on('error', (error: Error) => {
        console.error('[openVaultFile] chokidar watcher error:', error);
      });

      shell.openPath(tempPath);
      return tempPath;
    } catch (error) {
      console.error('Error in openVaultFile:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'updateItemInFolder',
  async (_event: IpcMainInvokeEvent, folderId: string, itemId: string, itemData: Partial<Item>) => {
    if (!folderId || !itemId || !itemData) {
      throw new Error('folderId, itemId, and itemData are required for updating an item metadata.');
    }
    try {
      const folder = await StorageService.getFolder(folderId.toString());
      if (!folder || !folder.items) {
        throw new Error(`Folder with id ${folderId} not found or has no items.`);
      }

      const itemIndex = folder.items.findIndex((item) => item.id === itemId.toString());
      if (itemIndex === -1) {
        throw new Error(`Item with id ${itemId} not found in folder ${folderId}.`);
      }

      folder.items[itemIndex] = { ...folder.items[itemIndex], ...itemData };

      await StorageService.saveFolder(folder);

      emitFoldersUpdated();

      return folder.items[itemIndex];
    } catch (error) {
      console.error(
        `Error in IPC handler 'updateItemInFolder' for item ${itemId} in folder ${folderId}:`,
        error
      );
      throw error;
    }
  }
);

ipcMain.handle(
  'readEncryptedFile',
  async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
    try {
      const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
      const filePath = path.join(folderPath, sanitizePath(fileName));

      if (
        !(await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false))
      ) {
        console.error(`File ${fileName} does not exist in folder ${folderId}`);
        throw new Error(`File ${fileName} does not exist in folder ${folderId}`);
      }

      // V3 chunked files: header-only size probe BEFORE loading the blob.
      // The whole-buffer return is kept for previews, but only up to 1 GiB of
      // plaintext — larger V3 files must go through the streaming paths.
      const v3OrigSize = await StorageService.getV3OrigSize(filePath);
      if (v3OrigSize !== null && v3OrigSize > StorageService.V3_PREVIEW_MAX_BYTES) {
        throw new Error('Fichier trop volumineux pour un apercu');
      }

      const encryptedContent = await fs.readFile(filePath);

      if (!encryptedContent || encryptedContent.length === 0) {
        console.error(`File ${fileName} is empty`);
        throw new Error(`File ${fileName} is empty`);
      }

      return encryptedContent;
    } catch (error) {
      console.error('Error in readEncryptedFile:', error);
      throw error;
    }
  }
);

ipcMain.handle('readTempFile', async (_event: IpcMainInvokeEvent, tempFilePath: string) => {
  try {
    const content = await fs.readFile(tempFilePath);
    // Return as number[] to ensure safe serialization across IPC
    // (Buffer serialization can be inconsistent)
    return Array.from(new Uint8Array(content));
  } catch (error) {
    console.error('Error reading temporary file:', error);
    throw error;
  }
});

ipcMain.handle('deleteTempFile', async (_event: IpcMainInvokeEvent, tempFilePath: string) => {
  try {
    await secureDeleteFile(tempFilePath);
  } catch (error) {
    console.error('Error deleting temporary file:', error);
    throw error;
  }
});

// ============================================
// REMINDERS IPC HANDLERS
// ============================================

ipcMain.handle(
  'addReminder',
  async (_event: IpcMainInvokeEvent, itemId: string, reminder: Reminder) => {
    try {
      const result = await StorageService.addReminder(itemId, reminder);
      emitFoldersUpdated();
      void reminderScheduler.rescheduleAll();
      void pushUpcomingRemindersToRenderer();
      return result;
    } catch (error) {
      console.error('Error in addReminder:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'updateReminder',
  async (
    _event: IpcMainInvokeEvent,
    itemId: string,
    reminderId: string,
    updatedReminder: Partial<Reminder>
  ) => {
    try {
      const result = await StorageService.updateReminder(itemId, reminderId, updatedReminder);
      emitFoldersUpdated();
      void reminderScheduler.rescheduleAll();
      void pushUpcomingRemindersToRenderer();
      return result;
    } catch (error) {
      console.error('Error in updateReminder:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'deleteReminder',
  async (_event: IpcMainInvokeEvent, itemId: string, reminderId: string) => {
    try {
      await StorageService.deleteReminder(itemId, reminderId);
      emitFoldersUpdated();
      void reminderScheduler.rescheduleAll();
      void pushUpcomingRemindersToRenderer();
      return true;
    } catch (error) {
      console.error('Error in deleteReminder:', error);
      throw error;
    }
  }
);

ipcMain.handle('getAllReminders', async () => {
  try {
    return await StorageService.getAllReminders();
  } catch (error) {
    console.error('Error in getAllReminders:', error);
    throw error;
  }
});

ipcMain.handle('getReminders', async (_event: IpcMainInvokeEvent, itemId: string) => {
  try {
    return await StorageService.getReminders(itemId);
  } catch (error) {
    console.error('Error in getReminders:', error);
    throw error;
  }
});

ipcMain.handle(
  'updateItem',
  async (
    _event: IpcMainInvokeEvent,
    folderId: string,
    itemId: string,
    updatedItem: Partial<Item>
  ) => {
    try {
      const folder = await StorageService.getFolder(folderId);
      if (folder && folder.items) {
        const itemIndex = folder.items.findIndex((item) => item.id === itemId);
        if (itemIndex !== -1) {
          // Update item
          folder.items[itemIndex] = { ...folder.items[itemIndex], ...updatedItem };
          // If updated item is a reminder, ensure it's properly integrated
          if (updatedItem.reminders) {
            if (!folder.items[itemIndex].reminders) {
              folder.items[itemIndex].reminders = [];
            }
            // Merge reminders
            updatedItem.reminders.forEach((reminder) => {
              const reminderIndex = folder.items[itemIndex].reminders!.findIndex(
                (r) => r.id === reminder.id
              );
              if (reminderIndex !== -1) {
                folder.items[itemIndex].reminders![reminderIndex] = reminder;
              } else {
                folder.items[itemIndex].reminders!.push(reminder);
              }
            });
          }
          await StorageService.saveFolder(folder);
          return folder.items[itemIndex];
        }
      }
      throw new Error('Item not found');
    } catch (error) {
      console.error('Error in updateItem:', error);
      throw error;
    }
  }
);

ipcMain.handle('markReminderAsRead', async (_event: IpcMainInvokeEvent, reminderId: string) => {
  try {
    const reminder = await StorageService.getReminder(reminderId);
    if (reminder) {
      const updatedReminder: Partial<Reminder> = { ...reminder, isRead: true };
      const result = await StorageService.updateReminder(
        reminder.itemId as string,
        reminderId,
        updatedReminder
      );
      return { success: true, reminder: result };
    }
    return { success: false, error: 'Reminder not found' };
  } catch (error: unknown) {
    console.error('Error marking reminder as read:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('markReminderAsDone', async (_event: IpcMainInvokeEvent, reminderId: string) => {
  try {
    const reminder = await StorageService.getReminder(reminderId);
    if (reminder) {
      const updatedReminder: Partial<Reminder> = { ...reminder, isCompleted: true };
      const result = await StorageService.updateReminder(
        reminder.itemId as string,
        reminderId,
        updatedReminder
      );
      return { success: true, reminder: result };
    }
    return { success: false, error: 'Reminder not found' };
  } catch (error: unknown) {
    console.error('Error marking reminder as done:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Legacy `snoozeReminder` handler removed — the new precise scheduler
// registers its own handler later with the (itemId, reminderId,
// minutes, itemType) object signature. The legacy one mutated the
// reminder's base `date` instead of setting `snoozedUntil`, which is
// the wrong semantics: a snooze should be a temporary postponement,
// not a permanent reschedule.

ipcMain.handle('getNotificationSettings', async () => {
  try {
    return await StorageService.getNotificationSettings();
  } catch (error: unknown) {
    console.error('Error getting notification settings:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Note-attached reminders live in noteReminders.json (sibling of
// calendarReminders.json) — see storageService.ts. The renderer creates
// them with the note id; they show up in getAllReminders alongside
// folder/file/calendar reminders with itemType: 'note'.
ipcMain.handle(
  'addReminderToNote',
  async (
    _event: IpcMainInvokeEvent,
    args: { noteId: string; noteName: string; reminder: Reminder }
  ) => {
    if (!args || typeof args.noteId !== 'string' || !args.reminder) {
      throw new Error('noteId and reminder are required');
    }
    const result = await StorageService.addNoteReminder(
      args.noteId,
      args.noteName || 'Note',
      args.reminder
    );
    void reminderScheduler.rescheduleAll();
    void pushUpcomingRemindersToRenderer();
    return result;
  }
);

ipcMain.handle(
  'updateReminderForNote',
  async (
    _event: IpcMainInvokeEvent,
    args: { noteId: string; reminderId: string; updates: Partial<Reminder> }
  ) => {
    if (!args || typeof args.noteId !== 'string' || typeof args.reminderId !== 'string') {
      throw new Error('noteId and reminderId are required');
    }
    const result = await StorageService.updateNoteReminder(
      args.noteId,
      args.reminderId,
      args.updates || {}
    );
    void reminderScheduler.rescheduleAll();
    void pushUpcomingRemindersToRenderer();
    return result;
  }
);

ipcMain.handle(
  'deleteReminderFromNote',
  async (_event: IpcMainInvokeEvent, args: { noteId: string; reminderId: string }) => {
    if (!args || typeof args.noteId !== 'string' || typeof args.reminderId !== 'string') {
      throw new Error('noteId and reminderId are required');
    }
    await StorageService.deleteNoteReminder(args.noteId, args.reminderId);
    void reminderScheduler.rescheduleAll();
    void pushUpcomingRemindersToRenderer();
    return true;
  }
);

// Snooze a reminder by N minutes from now. The renderer can offer "Snooze
// 10 min" / "Snooze 1h" buttons next to the reminder list.
ipcMain.handle(
  'snoozeReminder',
  async (
    _event: IpcMainInvokeEvent,
    args: { itemId: string; reminderId: string; minutes: number; itemType?: string }
  ) => {
    if (!args || typeof args.itemId !== 'string' || typeof args.reminderId !== 'string') {
      throw new Error('itemId and reminderId are required');
    }
    const minutes = typeof args.minutes === 'number' && args.minutes > 0 ? args.minutes : 10;
    await reminderScheduler.snoozeReminder(args.itemId, args.reminderId, minutes, args.itemType);
    void pushUpcomingRemindersToRenderer();
    return true;
  }
);

// Launch Filarr at OS login (Windows + macOS + Linux). Persisted by the
// OS itself via setLoginItemSettings; we just expose get/set.
ipcMain.handle('app:get-open-at-login', () => {
  if (process.platform === 'linux') {
    // setLoginItemSettings is a no-op on Linux. We could write a .desktop
    // autostart file later if the demand justifies it.
    return false;
  }
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('app:set-open-at-login', (_event: IpcMainInvokeEvent, enabled: boolean) => {
  if (process.platform === 'linux') return false;
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    // Start hidden so the tray-only behavior matches what users expect
    // (no flash of the main window on every boot).
    args: enabled ? ['--hidden'] : [],
  });
  return app.getLoginItemSettings().openAtLogin;
});

// ============================================
// DESKTOP PROTECTION IPC (Wave 1)
// ============================================
// Channel names follow the renderer's desktopProtectionBridge contract
// (src/services/features/desktopProtectionBridge.ts) — the bridge is the
// single point of truth for the renderer ↔ main surface.

// Renderer lock-state report, pushed (fire-and-forget send) on every
// lockApp/unlockApp transition. Essential for local-only profiles, whose
// machine-key crypto never loads a session key — without this report the
// tray badge could not know their real state.
ipcMain.on('vault:renderer-lock-state', (_event, payload: unknown) => {
  const locked =
    !!payload && typeof payload === 'object'
      ? !!(payload as { locked?: unknown }).locked
      : !!payload;
  reportRendererLockState(locked);
  refreshTray();
  notifyMiniRefresh();
  // Unlock (hybrid AND machine-key local profiles report through here):
  // replay Explorer protect requests queued while locked (Wave 2b).
  if (!locked) deliverPendingShellProtect();
});

// (Ré)applique les raccourcis globaux depuis l'écran Paramètres. Returns the
// per-shortcut registration outcome — globalShortcut.register returns false
// (no exception) when another app owns the combo, and the Settings screen
// tells the user instead of pretending it worked. Persistence happens via
// the renderer's flag:set mirror; this is the immediate-apply fast path.
ipcMain.handle('app:setGlobalHotkey', async (_event: IpcMainInvokeEvent, config: unknown) => {
  const c = (config && typeof config === 'object' ? config : {}) as {
    enabled?: unknown;
    mini?: unknown;
    lock?: unknown;
  };
  desktopSettings = mergeDesktopSettings(desktopSettings, {
    hotkeysEnabled: typeof c.enabled === 'boolean' ? c.enabled : desktopSettings.hotkeysEnabled,
    hotkeyMini: typeof c.mini === 'string' ? c.mini : desktopSettings.hotkeyMini,
    hotkeyLock: typeof c.lock === 'string' ? c.lock : desktopSettings.hotkeyLock,
  });
  applyDesktopHotkeys();
  return {
    registered: {
      mini: hotkeyStatus?.mini.ok ?? false,
      lock: hotkeyStatus?.lock.ok ?? false,
    },
  };
});

// Manual "Purger les fichiers temporaires" (Settings) + purge-on-lock from
// the renderer middleware. deletedCount feeds the French success toast.
ipcMain.handle('vault:purgeTemp', async (): Promise<{ deletedCount: number; errors: number }> => {
  const res: PurgeResult = await purgeTempPlaintext();
  return { deletedCount: res.deleted, errors: res.errors };
});

// ── "Déplacer dans le coffre", second half — VERIFY then secure-delete ──────
// The renderer has already run the NORMAL import (encrypted copy + folder
// metadata). This handler proves the vault copy stream-decrypts back to the
// exact source SHA-256 (no plaintext ever materialized) and ONLY then
// secure-deletes the original. Every failure path THROWS a French message —
// the bridge maps a rejection to { ok: false } and the UI reports "original
// conservé". The original is NEVER deleted on failure.
ipcMain.handle('file:secureDeleteOriginal', async (_event: IpcMainInvokeEvent, args: unknown) => {
  const a = (args && typeof args === 'object' ? args : {}) as {
    sourcePath?: unknown;
    folderId?: unknown;
    fileName?: unknown;
  };
  if (
    typeof a.sourcePath !== 'string' ||
    a.sourcePath.length === 0 ||
    typeof a.folderId !== 'string' ||
    typeof a.fileName !== 'string'
  ) {
    throw new Error('Paramètres invalides — le fichier original a été conservé');
  }
  const safeFolderId = sanitizeFolderId(a.folderId);
  const safeName = sanitizePath(a.fileName);
  const vaultFilePath = path.join(getActiveProfileDataDir(), safeFolderId, safeName);
  const resolvedSource = path.resolve(a.sourcePath);

  // Never let this delete anything inside Filarr's own data (the vault
  // blobs, profiles, config) — the "original" must be an outside file.
  const userDataRoot = path.resolve(app.getPath('userData'));
  if (resolvedSource === userDataRoot || resolvedSource.startsWith(userDataRoot + path.sep)) {
    throw new Error('Chemin source invalide — le fichier original a été conservé');
  }

  const result = await performVerifyThenDelete(
    {
      statSource: async (p) => {
        const s = await fs.stat(p).catch(() => null);
        return s ? { isFile: s.isFile(), size: s.size } : null;
      },
      vaultExists: () =>
        fs
          .access(vaultFilePath)
          .then(() => true)
          .catch(() => false),
      hashSource: (p) => streamingSha256(p),
      hashVaultPlaintext: async () => {
        // Stream-decrypt → SHA-256; plaintext never touches disk. The helper
        // auto-selects machine key vs session FEK (GCM probe) across EVERY
        // container the import can produce — including the renderer-encrypted
        // hybrid FEK blobs that hybrid profiles write for files below the
        // streaming threshold.
        const plainStream = await StorageService.createVerifyDecryptStream(vaultFilePath);
        return sha256OfStream(plainStream);
      },
      secureDeleteOriginal: (p) => secureDeleteFile(p),
    },
    resolvedSource
  );

  if (!result.deleted) {
    throw new Error(result.error || 'Suppression impossible — le fichier original a été conservé');
  }
  recordRecentProtected(safeFolderId, safeName);
  return { verified: result.verified };
});

// ── "Déplacer dans le coffre" — encrypt, VERIFY, then secure-delete ─────────
// The original plaintext is wiped ONLY after the vault copy stream-decrypts
// back to the exact source SHA-256 (no plaintext materialized during the
// check). Any failure keeps the original and reports a French message.
// Returns { success, verified, originalDeleted, size?, error? } — the
// renderer writes folder metadata only when success === true.
ipcMain.handle(
  'file:moveIntoVault',
  async (event: IpcMainInvokeEvent, folderId: string, fileName: string, sourcePath: string) => {
    const safeFolderId = sanitizeFolderId(String(folderId));
    const safeName = sanitizePath(fileName);
    const folderPath = path.join(getActiveProfileDataDir(), safeFolderId);
    const filePath = path.join(folderPath, safeName);
    const resolvedSource = path.resolve(String(sourcePath || ''));

    // Same throttled progress channel as the copy import.
    const sender = event.sender;
    let lastEmit = 0;
    const onProgress = (doneBytes: number, totalBytes: number): void => {
      const now = Date.now();
      if (doneBytes < totalBytes && now - lastEmit < 200) return;
      lastEmit = now;
      const percent =
        totalBytes === 0 ? 100 : Math.min(100, Math.round((doneBytes / totalBytes) * 100));
      if (!sender.isDestroyed()) {
        sender.send('file:importProgress', { folderId: safeFolderId, fileName: safeName, percent });
      }
    };

    // Key routing is authoritative main-side, exactly like
    // saveEncryptedFileFromPath: session FEK loaded → portable V3-FEK
    // container; otherwise machine-key V3.
    const useSessionFek = sessionKeyStore.hasSessionKey();

    return performMoveIntoVault(
      {
        statSource: async (p) => {
          const s = await fs.stat(p).catch(() => null);
          return s ? { isFile: s.isFile(), size: s.size } : null;
        },
        checkQuota: (size) => StorageService.checkQuotaBeforeUploadFromPath(size),
        destinationExists: () =>
          fs
            .access(filePath)
            .then(() => true)
            .catch(() => false),
        hashSource: (p) => streamingSha256(p),
        encryptToVault: async (src, prog) => {
          await fs.mkdir(folderPath, { recursive: true });
          return useSessionFek
            ? StorageService.saveEncryptedFileFromPathFEK(src, filePath, prog)
            : StorageService.saveEncryptedFileFromPathV3(src, filePath, prog);
        },
        hashVaultPlaintext: async () => {
          // Stream-decrypt → SHA-256; plaintext never touches disk. The
          // stream helper auto-selects machine key vs session FEK (GCM
          // probe), matching whichever key encrypted above (blobs written
          // here are always V3; the verify helper adds hybrid-blob support
          // for free).
          const plainStream = await StorageService.createVerifyDecryptStream(filePath);
          return sha256OfStream(plainStream);
        },
        removeVaultFile: async () => {
          await fs.unlink(filePath).catch(() => {});
        },
        commit: async (origSize) => {
          await StorageService.incrementStorageUsage(origSize);
          if (activeProfileId) {
            syncService.notifyFileChanged(activeProfileId, `${safeFolderId}/${safeName}`);
          }
          recordRecentProtected(safeFolderId, safeName, origSize);
        },
        secureDeleteOriginal: (p) => secureDeleteFile(p),
      },
      resolvedSource,
      onProgress
    );
  }
);

// ==================== FILARR BOX (Wave 2 — protéger sur place) ====================
// `.filarr` protected containers living in REAL OS folders. The renderer
// contract is src/services/features/filarrBoxBridge.ts — every channel below
// mirrors it. Format + orchestration live in pure-Node modules
// (filarrContainer.ts / filarrBox.ts); this section wires keys
// (StorageService), dialogs, temp-file tracking and the advisory registry.
// The app-vault import flows above are untouched — both models coexist.

const protectedRegistry = new ProtectedRegistry({
  getFilePath: () => path.join(getActiveProfileDataDir(), 'protected_items.json'),
  encrypt: (plain) => StorageService.encryptBinary(plain),
  decrypt: (blob) => StorageService.decryptBinary(blob),
  warn: (message, error) => log.warn(message, error),
});

/**
 * Serializes rewrite-on-save per container: a second editor save landing
 * while a rewrite is in flight waits for it (per-boxPath promise chain).
 * A failed rewrite keeps the previous container version intact.
 */
const boxRewriteChains = new Map<string, Promise<void>>();

function queueBoxRewrite(boxPath: string, tempPath: string, key: Buffer, name: string): void {
  const prev = boxRewriteChains.get(boxPath) ?? Promise.resolve();
  const next = prev
    .then(() => rewriteFileContainer(key, boxPath, tempPath, name))
    .then(() => {
      log.info('[filarrBox] container re-encrypted after edit:', boxPath);
    })
    .catch((err) => {
      log.warn('[filarrBox] container rewrite failed (previous version kept):', err);
    });
  boxRewriteChains.set(boxPath, next);
}

function assertBoxPathArg(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || !value.toLowerCase().endsWith('.filarr')) {
    throw new Error('Chemin de conteneur .filarr invalide');
  }
  return path.resolve(value);
}

/**
 * Runs `fn` with OWNED copies of the candidate read keys (machine key, then
 * account FEK), zeroized afterwards. Refuses up front while the vault is
 * locked — a `.filarr` on disk stays opaque ciphertext until unlock.
 */
async function withBoxReadKeys<T>(fn: (candidates: Buffer[]) => Promise<T>): Promise<T> {
  if (isVaultLockedForTray()) {
    throw new Error(ERR_BOX_LOCKED);
  }
  const candidates = await StorageService.getBoxKeyCandidates();
  if (candidates.length === 0) {
    throw new Error(ERR_BOX_LOCKED);
  }
  try {
    return await fn(candidates);
  } finally {
    for (const k of candidates) k.fill(0);
  }
}

/** Throttled byte-progress push to the renderer ('filarrBox:progress'). */
function makeBoxProgressEmitter(
  sender: Electron.WebContents,
  phase: 'encrypt' | 'verify' | 'decrypt' | 'delete',
  boxPath?: string
): (doneBytes: number, totalBytes: number) => void {
  let lastEmit = 0;
  return (processed: number, total: number): void => {
    const now = Date.now();
    if (processed < total && now - lastEmit < 200) return;
    lastEmit = now;
    if (!sender.isDestroyed()) {
      sender.send('filarrBox:progress', { boxPath, phase, processed, total });
    }
  };
}

// Note backups are small JSON files — cap what inspect will read into memory.
const BOX_NOTE_CONTENT_MAX = 32 * 1024 * 1024;

// First-bytes routing for a double-clicked .filarr: FILARRBOX magic → 'box'
// (+ metadata when unlocked), '{' after BOM/whitespace → 'note' (the EXISTING
// plaintext note-backup import path — never the box parser), else 'unknown'.
ipcMain.handle('filarrBox:inspect', async (_event: IpcMainInvokeEvent, filePath: unknown) => {
  const resolved = assertBoxPathArg(filePath);
  const type = await sniffFilarrFile(resolved);
  if (type === 'note') {
    let content: string | undefined;
    try {
      const { size } = await fs.stat(resolved);
      if (size <= BOX_NOTE_CONTENT_MAX) {
        content = await fs.readFile(resolved, 'utf8');
      }
    } catch {
      content = undefined;
    }
    return { type: 'note', ...(content !== undefined ? { content } : {}) };
  }
  if (type === 'unknown') {
    return { type: 'unknown' };
  }
  const header = await readContainerHeader(resolved); // French corrupt/newer errors
  if (isVaultLockedForTray()) {
    return { type: 'box', locked: true, kind: header.kind };
  }
  return withBoxReadKeys(async (candidates) => {
    const { metadata } = await readContainerMetadata(candidates, resolved); // French wrong-key error
    return {
      type: 'box',
      kind: header.kind,
      name: metadata.name,
      size: metadata.size,
      createdAt: metadata.createdAt,
      ...(metadata.entryCount !== undefined ? { entryCount: metadata.entryCount } : {}),
    };
  });
});

// "Protéger sur place": each source becomes `<destDir|source dir>/<name>.filarr`.
// Sequencing per item (filarrBox.performProtectInPlace): pack to staging →
// VERIFY decrypt-back hash → rename → only then secure-delete the original.
// Never throws for per-item failures — each result carries its French reason.
ipcMain.handle('filarrBox:protect', async (event: IpcMainInvokeEvent, args: unknown) => {
  const a = (args && typeof args === 'object' ? args : {}) as {
    paths?: unknown;
    destDir?: unknown;
    deleteOriginals?: unknown;
  };
  if (
    !Array.isArray(a.paths) ||
    a.paths.length === 0 ||
    a.paths.some((p) => typeof p !== 'string' || p.length === 0)
  ) {
    throw new Error('Paramètres invalides — aucune source à protéger');
  }
  if (isVaultLockedForTray()) {
    throw new Error(ERR_BOX_LOCKED);
  }
  const destDir =
    typeof a.destDir === 'string' && a.destDir.length > 0 ? path.resolve(a.destDir) : null;
  if (destDir) {
    const destStat = await fs.stat(destDir).catch(() => null);
    if (!destStat || !destStat.isDirectory()) {
      throw new Error('Dossier de destination introuvable');
    }
  }
  const deleteOriginals = a.deleteOriginals === true;
  const userDataRoot = path.resolve(app.getPath('userData'));
  const sender = event.sender;
  const results = [];
  for (const rawPath of a.paths as string[]) {
    const resolvedSource = path.resolve(rawPath);
    // Never let protect (and its delete-original step) touch Filarr's own
    // data — same guard as file:secureDeleteOriginal.
    if (resolvedSource === userDataRoot || resolvedSource.startsWith(userDataRoot + path.sep)) {
      results.push({
        sourcePath: resolvedSource,
        ok: false,
        originalDeleted: false,
        error:
          'Chemin source invalide — les données de Filarr ne peuvent pas être protégées sur place',
      });
      continue;
    }
    const outcome = await performProtectInPlace(
      {
        getWriteKey: () => StorageService.getBoxWriteKey(),
        secureDeleteFile: (p) => secureDeleteFile(p),
        secureDeleteDir: (p) => secureDeleteDir(p),
      },
      { sourcePath: resolvedSource, destDir, deleteOriginal: deleteOriginals },
      makeBoxProgressEmitter(sender, 'encrypt')
    );
    if (
      outcome.ok &&
      outcome.boxPath &&
      outcome.kind !== undefined &&
      outcome.name &&
      outcome.size !== undefined
    ) {
      try {
        await protectedRegistry.upsert({
          boxPath: outcome.boxPath,
          kind: outcome.kind,
          name: outcome.name,
          size: outcome.size,
        });
      } catch (err) {
        log.warn('[filarrBox] registry upsert failed (advisory only):', err);
      }
    }
    results.push(outcome);
  }
  return { results };
});

// Opens a single-FILE container: decrypt to a TRACKED temp copy (5-min purge,
// purge-on-lock/quit), open with the default app, and re-encrypt the whole
// container on every save (chokidar watcher — same options as
// openEncryptedFile). While locked or without Filarr, the .filarr on disk is
// opaque ciphertext at all times.
ipcMain.handle('filarrBox:openFile', async (event: IpcMainInvokeEvent, boxPath: unknown) => {
  const resolved = assertBoxPathArg(boxPath);
  return withBoxReadKeys(async (candidates) => {
    const { tempPath, metadata, key } = await openContainerToTemp(candidates, resolved, {
      tempDir: app.getPath('temp'),
      onProgress: makeBoxProgressEmitter(event.sender, 'decrypt', resolved),
    });
    // Owned copy for the long-lived watcher — `key` is a reference into
    // `candidates`, which are zeroized when this handler returns.
    const rewriteKey = Buffer.from(key);
    scheduleTempCleanup(tempPath);
    const watcher: FSWatcher = chokidar.watch(tempPath, {
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    });
    watcher.on('change', () => {
      queueBoxRewrite(resolved, tempPath, rewriteKey, metadata.name);
    });
    watcher.on('error', (err: Error) => {
      log.warn('[filarrBox] temp watcher error:', err);
    });
    // Registry closes the watcher BEFORE the timed/manual purge wipes the
    // temp file (tempFileRegistry contract).
    attachTempWatcher(tempPath, watcher);
    try {
      await protectedRegistry.upsert({
        boxPath: resolved,
        kind: BOX_KIND_FILE,
        name: metadata.name,
        size: metadata.size,
        createdAt: metadata.createdAt,
        lastOpenedAt: new Date().toISOString(),
      });
    } catch (err) {
      log.warn('[filarrBox] registry upsert failed (advisory only):', err);
    }
    await shell.openPath(tempPath);
    return { name: metadata.name };
  });
});

// Opens a FOLDER container as a browsable mini-vault: authenticated tar-index
// walk only — no file data is materialized until the user opens an entry.
ipcMain.handle('filarrBox:openFolder', async (_event: IpcMainInvokeEvent, boxPath: unknown) => {
  const resolved = assertBoxPathArg(boxPath);
  return withBoxReadKeys(async (candidates) => {
    const { metadata, entries } = await listFolderContainer(candidates, resolved);
    try {
      await protectedRegistry.upsert({
        boxPath: resolved,
        kind: BOX_KIND_FOLDER,
        name: metadata.name,
        size: metadata.size,
        createdAt: metadata.createdAt,
        lastOpenedAt: new Date().toISOString(),
      });
    } catch (err) {
      log.warn('[filarrBox] registry upsert failed (advisory only):', err);
    }
    return {
      meta: {
        name: metadata.name,
        size: metadata.size,
        createdAt: metadata.createdAt,
        ...(metadata.entryCount !== undefined ? { entryCount: metadata.entryCount } : {}),
      },
      entries,
    };
  });
});

// Extracts ONE file entry of a folder container.
//  - mode 'open'  : tracked temp copy + default app (READ-ONLY in v1 — no
//    write-back watcher; the mini-vault UI shows the persistent notice).
//  - mode 'saveAs': explicit save dialog; written where the user chose,
//    NOT temp-tracked (an explicit extraction, like a download).
ipcMain.handle(
  'filarrBox:extractEntry',
  async (event: IpcMainInvokeEvent, boxPath: unknown, entryPath: unknown, opts: unknown) => {
    const resolved = assertBoxPathArg(boxPath);
    if (typeof entryPath !== 'string' || entryPath.length === 0) {
      throw new Error('Entrée introuvable dans le conteneur');
    }
    const mode =
      opts && typeof opts === 'object' && (opts as { mode?: unknown }).mode === 'saveAs'
        ? 'saveAs'
        : 'open';
    return withBoxReadKeys(async (candidates) => {
      const onProgress = makeBoxProgressEmitter(event.sender, 'decrypt', resolved);
      if (mode === 'open') {
        const { tempPath } = await extractOneEntryToTemp(candidates, resolved, entryPath, {
          tempDir: app.getPath('temp'),
          onProgress,
        });
        scheduleTempCleanup(tempPath);
        await shell.openPath(tempPath);
        return { openedPath: tempPath };
      }
      const defaultName = entryPath.split('/').pop() || 'fichier';
      const { canceled, filePath: savePath } = await dialog.showSaveDialog(
        mainWindow as BrowserWindow,
        { defaultPath: defaultName, title: 'Extraire vers…' }
      );
      if (canceled || !savePath) {
        return { canceled: true };
      }
      // Extract into the destination directory (same volume), then rename to
      // the chosen name — the dialog already confirmed any overwrite.
      const { tempPath } = await extractOneEntryToTemp(candidates, resolved, entryPath, {
        tempDir: path.dirname(savePath),
        onProgress,
      });
      try {
        await fs.rename(tempPath, savePath);
      } catch {
        await fs.copyFile(tempPath, savePath);
        await secureDeleteFile(tempPath);
      }
      return { savedPath: savePath };
    });
  }
);

// "Tout extraire…": directory picker, then the whole tree (empty dirs
// included) is rebuilt under `<picked>/<name>` — collision-suffixed, every
// byte from GCM-verified chunks. Partial failure removes the partial tree.
ipcMain.handle('filarrBox:extractAll', async (_event: IpcMainInvokeEvent, boxPath: unknown) => {
  const resolved = assertBoxPathArg(boxPath);
  if (isVaultLockedForTray()) {
    throw new Error(ERR_BOX_LOCKED);
  }
  const picked = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
    title: 'Tout extraire vers…',
    buttonLabel: 'Extraire ici',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (picked.canceled || picked.filePaths.length === 0) {
    return { canceled: true };
  }
  return withBoxReadKeys(async (candidates) => {
    const { metadata } = await readContainerMetadata(candidates, resolved);
    const destRoot = await suffixedPlainPath(picked.filePaths[0], metadata.name);
    await fs.mkdir(destRoot, { recursive: true });
    try {
      const { fileCount } = await extractAllEntries(candidates, resolved, destRoot);
      return { destDir: destRoot, fileCount };
    } catch (err) {
      // Partial plaintext tree we just created — plain removal is safe and
      // the container stays intact.
      await fs.rm(destRoot, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  });
});

// "Déprotéger": restore the plaintext next to the container (verified), then
// remove the .filarr (plain unlink — it is ciphertext) + its registry entry.
ipcMain.handle('filarrBox:unprotect', async (_event: IpcMainInvokeEvent, boxPath: unknown) => {
  const resolved = assertBoxPathArg(boxPath);
  const result = await withBoxReadKeys((candidates) => unprotectContainer(candidates, resolved));
  try {
    await protectedRegistry.removeByBoxPath(resolved);
  } catch (err) {
    log.warn('[filarrBox] registry removal failed (advisory only):', err);
  }
  return { restoredPath: result.restoredPath };
});

// "Mes fichiers protégés" — advisory list (registry file is vault-encrypted;
// unavailable while locked, mirroring miniMode:getRecent).
ipcMain.handle('filarrBox:registryList', async () => {
  if (isVaultLockedForTray()) {
    throw new Error(ERR_BOX_LOCKED);
  }
  const items = await protectedRegistry.list();
  return Promise.all(
    items.map(async (entry) => ({
      ...entry,
      exists: await fs
        .access(entry.boxPath)
        .then(() => true)
        .catch(() => false),
    }))
  );
});

ipcMain.handle('filarrBox:registryRemove', async (_event: IpcMainInvokeEvent, id: unknown) => {
  if (isVaultLockedForTray()) {
    throw new Error(ERR_BOX_LOCKED);
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Entrée de registre introuvable');
  }
  const removed = await protectedRegistry.remove(id);
  return { removed };
});

// "Localiser…" — re-points a missing entry to a picked .filarr AFTER
// validating the magic + decrypted metadata (name and kind must match).
ipcMain.handle(
  'filarrBox:registryRelocate',
  async (_event: IpcMainInvokeEvent, id: unknown, newPath: unknown) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Entrée de registre introuvable');
    }
    const resolvedNew = assertBoxPathArg(newPath);
    const entries = await protectedRegistry.list();
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      throw new Error('Entrée de registre introuvable');
    }
    await withBoxReadKeys(async (candidates) => {
      const { header, metadata } = await readContainerMetadata(candidates, resolvedNew);
      if (metadata.name !== entry.name || header.kind !== entry.kind) {
        throw new Error("Ce conteneur ne correspond pas à l'élément sélectionné");
      }
    });
    const updated = await protectedRegistry.relocate(id, resolvedNew);
    if (!updated) {
      throw new Error('Entrée de registre introuvable');
    }
    return { ...updated, exists: true };
  }
);

ipcMain.handle('filarrBox:showInFolder', async (_event: IpcMainInvokeEvent, boxPath: unknown) => {
  const resolved = assertBoxPathArg(boxPath);
  await fs.access(resolved); // missing container → clean rejection for the bridge
  shell.showItemInFolder(resolved);
  return { shown: true };
});

// ── macOS Touch ID gate (Windows Hello: deferred) ───────────────────────────
// promptTouchID only proves USER PRESENCE — it cannot derive the FEK. The
// renderer may use a positive result solely to gate the .fek_safe
// auto-restore path ('hybrid:loadFEK'); it must NEVER replace the vault
// password when no FEK is sealed on disk.
ipcMain.handle('auth:touchId', async (_event: IpcMainInvokeEvent, reason?: unknown) => {
  if (process.platform !== 'darwin') {
    return {
      available: false,
      ok: false,
      error: 'Biométrie non disponible sur cette plateforme (Windows Hello : à venir)',
    };
  }
  try {
    if (!systemPreferences.canPromptTouchID()) {
      return { available: false, ok: false, error: 'Touch ID non disponible sur ce Mac' };
    }
  } catch {
    return { available: false, ok: false, error: 'Touch ID non disponible sur ce Mac' };
  }
  const promptReason =
    typeof reason === 'string' && reason.trim().length > 0
      ? reason.trim().slice(0, 80)
      : 'déverrouiller le coffre Filarr';
  try {
    await systemPreferences.promptTouchID(promptReason);
    return { available: true, ok: true };
  } catch {
    return { available: true, ok: false, error: 'Authentification Touch ID refusée' };
  }
});

// ── Mini-mode window surface (invoked by the mini renderer) ─────────────────
// The mini window has no Redux store — everything it shows comes from here.
// The window itself is toggled main-side (tray left-click, global hotkey).

/** Vault state for the mini window's status pill / drop-zone gating. */
ipcMain.handle('miniMode:getState', async () => {
  return { locked: isVaultLockedForTray() };
});

/** "Protégés récemment" list (names + folder ids only; empty when locked —
 *  no plaintext metadata behind a lock screen). */
ipcMain.handle('miniMode:getRecent', async () => {
  if (isVaultLockedForTray()) return [];
  return recentFilesCache.map((e) => ({ ...e }));
});

// Files dropped on the mini window drop-zone: full main-side import into the
// desktop inbox folder (the mini renderer has no folder tree). Refused while
// the vault is locked. Per-file failures are counted so the mini window can
// report a partial success honestly.
ipcMain.handle('miniMode:protectFiles', async (_event: IpcMainInvokeEvent, args: unknown) => {
  const a = (args && typeof args === 'object' ? args : {}) as { paths?: unknown };
  const paths = Array.isArray(a.paths)
    ? a.paths.filter((p): p is string => typeof p === 'string' && p.length > 0).slice(0, 100)
    : [];
  if (paths.length === 0) {
    return { imported: 0, failed: 0 };
  }
  if (isVaultLockedForTray()) {
    throw new Error('Coffre verrouillé — déverrouillez Filarr avant de protéger des fichiers');
  }
  const res = await protectPathsIntoVault(paths);
  if (res.imported === 0 && res.errors.length > 0) {
    throw new Error(res.errors[0]);
  }
  return { imported: res.imported, failed: res.failed };
});

// "Tout verrouiller" from the mini window: same main-side path as
// tray/hotkey/powerMonitor (clear session FEK, purge temps, broadcast).
ipcMain.handle('miniMode:lockVault', async () => {
  await lockVaultFromMain('mini');
  return { locked: true };
});

ipcMain.handle('miniMode:hide', async () => {
  hideMiniWindow();
  return true;
});

ipcMain.handle('miniMode:openMain', async () => {
  hideMiniWindow();
  showMainWindowFromTray();
  return true;
});

ipcMain.handle(
  'updateNotificationSettings',
  async (_event: IpcMainInvokeEvent, settings: NotificationSettings) => {
    try {
      await StorageService.updateNotificationSettings(settings);
      notificationSettings = settings;
      reminderScheduler.updateSettings({ enabled: settings.enabled, sound: settings.sound });
      return { success: true };
    } catch (error: unknown) {
      console.error('Error updating notification settings:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

ipcMain.handle('getReminder', async (_event: IpcMainInvokeEvent, reminderId: string) => {
  return await StorageService.getReminder(reminderId);
});

// ============================================
// FILE DIALOG IPC HANDLERS
// ============================================

ipcMain.handle(
  'showSaveDialog',
  async (_event: IpcMainInvokeEvent, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(mainWindow as BrowserWindow, options);
    return result.filePath;
  }
);

ipcMain.handle(
  'showOpenDialog',
  async (_event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, options);
    return result;
  }
);

ipcMain.handle(
  'writeRawFile',
  async (_event: IpcMainInvokeEvent, filePath: string, data: number[] | Uint8Array | Buffer) => {
    // Security: validate path to prevent arbitrary filesystem writes
    const resolved = path.resolve(filePath);
    const homeDir = app.getPath('home');
    const tempDir = app.getPath('temp');
    if (!resolved.startsWith(homeDir) && !resolved.startsWith(tempDir)) {
      throw new Error('writeRawFile: path must be under user home or temp directory');
    }
    await fs.writeFile(resolved, Buffer.isBuffer(data) ? data : Buffer.from(data as any));
    return true;
  }
);

ipcMain.handle('downloadItem', async (_event: IpcMainInvokeEvent, request: DownloadItemRequest) => {
  try {
    const { folderId, itemId, savePath, password } = request;
    const item = await StorageService.getItem(itemId);

    if (item.protected && !password) {
      throw new Error('Password required for protected item');
    }

    if (item.type === 'folder') {
      await downloadFolder(item as Folder, savePath, password);
    } else {
      await downloadFile(folderId, item, savePath, password);
    }

    return { success: true };
  } catch (error: unknown) {
    console.error('Error during download:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// ============================================
// MOVE/COPY IPC HANDLERS
// ============================================

ipcMain.handle(
  'moveItem',
  async (
    _event: IpcMainInvokeEvent,
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string
  ) => {
    try {
      const result = await StorageService.moveItem(itemId, sourceFolderId, targetFolderId);
      emitFoldersUpdated();
      return result;
    } catch (error) {
      console.error('Error in moveItem:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'copyItem',
  async (
    _event: IpcMainInvokeEvent,
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string,
    newName?: string
  ) => {
    try {
      const result = await StorageService.copyItem(itemId, sourceFolderId, targetFolderId, newName);
      emitFoldersUpdated();
      return result;
    } catch (error) {
      console.error('Error in copyItem:', error);
      throw error;
    }
  }
);

/**
 * Download file helper — V3-aware: V3 files stream chunk-by-chunk straight
 * to the user-chosen destination (flat memory, no whole-buffer decrypt);
 * V1/V2 blobs decrypt exactly as before. This is the intended-plaintext
 * export path (the user explicitly saves out of the vault).
 */
async function downloadFile(
  folderId: string,
  item: Item,
  savePath: string,
  _password?: string
): Promise<void> {
  const filePath = path.join(getActiveProfileDataDir(), folderId, sanitizePath(item.name));
  await StorageService.decryptFileToFileAuto(filePath, savePath);
}

/**
 * Download folder helper (recursive)
 */
async function downloadFolder(folder: Folder, savePath: string, password?: string): Promise<void> {
  const folderPath = path.join(savePath, sanitizePath(folder.name));
  await fs.mkdir(folderPath, { recursive: true });

  // Get folder items
  const folderItems = await StorageService.getFolderItems(folder.id);

  for (const item of folderItems) {
    const itemSavePath = path.join(folderPath, sanitizePath(item.name));
    if (item.type === 'folder') {
      await downloadFolder(item as Folder, folderPath, password);
    } else {
      await downloadFile(folder.id, item, itemSavePath, password);
    }
  }
}

// ============================================
// MULTIPLE DOWNLOAD (ZIP) IPC HANDLER
// ============================================

interface DownloadMultipleRequest {
  folderId: string;
  itemIds: string[];
  savePath: string;
}

// French error surfaced when a V3 decrypt stream fails mid-archive (GCM
// authentication failure = corrupt/tampered source file).
const ZIP_EXPORT_STREAM_ERROR = 'Echec de l export ZIP - fichier corrompu';

/** Minimal surface of an archiver instance used by the ZIP export helpers. */
interface ZipArchive {
  append(source: Buffer | NodeJS.ReadableStream, data: { name: string; date?: Date }): void;
  finalize(): void;
  abort(): void;
  pipe(dest: NodeJS.WritableStream): void;
  on(event: 'error', cb: (err: Error) => void): void;
}

/** Best-effort ZIP entry timestamp (falls back to "now"). */
function zipEntryDate(item: Item): Date {
  const raw = item.updatedAt || item.date || item.createdAt;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d;
    }
  }
  return new Date();
}

/**
 * Appends one vault file to a ZIP archive.
 *  - V3 sources stream chunk-by-chunk with flat memory — no per-entry size
 *    cap anymore (archiver switches to zip64 automatically past 4 GiB). A
 *    mid-stream decryption failure (corrupt chunk) aborts the whole build
 *    via onStreamError.
 *  - Legacy V1/V2 blobs keep the whole-buffer path (<= 500 MB by
 *    construction).
 */
async function appendVaultEntryToArchive(
  archive: ZipArchive,
  filePath: string,
  entryName: string,
  entryDate: Date,
  onStreamError: (err: Error) => void
): Promise<void> {
  if (await StorageService.isV3VaultFile(filePath)) {
    // Header + total length are validated eagerly (throws here on a corrupt
    // header); per-chunk GCM failures surface as 'error' events while
    // archiver drains the stream. Our listener is attached before
    // archive.append so the French error wins the abort race.
    const stream = await StorageService.createDecryptStreamAuto(filePath);
    stream.on('error', (err: Error) => {
      log.error('[zip-export] V3 decrypt stream failed:', err.message);
      onStreamError(new Error(ZIP_EXPORT_STREAM_ERROR));
    });
    archive.append(stream, { name: entryName, date: entryDate });
    return;
  }
  const decrypted = await StorageService.decryptFileAuto(filePath);
  archive.append(decrypted, { name: entryName, date: entryDate });
}

/**
 * Add folder contents to archive recursively
 */
async function addFolderToArchive(
  archive: ZipArchive,
  folder: Folder,
  prefix: string,
  onStreamError: (err: Error) => void
): Promise<void> {
  const folderItems = await StorageService.getFolderItems(folder.id);
  for (const item of folderItems) {
    const itemPath = `${prefix}/${sanitizePath(item.name)}`;
    if (item.type === 'folder') {
      await addFolderToArchive(archive, item as Folder, itemPath, onStreamError);
    } else {
      const filePath = path.join(getActiveProfileDataDir(), folder.id, sanitizePath(item.name));
      await appendVaultEntryToArchive(
        archive,
        filePath,
        itemPath,
        zipEntryDate(item),
        onStreamError
      );
    }
  }
}

ipcMain.handle(
  'downloadMultipleAsZip',
  async (_event: IpcMainInvokeEvent, request: DownloadMultipleRequest) => {
    try {
      const { folderId, itemIds, savePath } = request;
      const archiver = require('archiver');

      const output = fsSync.createWriteStream(savePath);
      const archive: ZipArchive = archiver('zip', { zlib: { level: 5 } });

      return await new Promise((resolve, reject) => {
        let failed = false;
        // First failure wins: stop the archiver, destroy the output stream,
        // then remove the partial ZIP once the descriptor is closed (Windows
        // refuses to unlink files with open handles).
        const failZip = (err: unknown): void => {
          if (failed) {
            return;
          }
          failed = true;
          const error = err instanceof Error ? err : new Error(String(err));
          try {
            archive.abort();
          } catch {
            /* best effort */
          }
          const removePartial = (): void => {
            fs.unlink(savePath).catch(() => {});
          };
          if (output.destroyed) {
            removePartial();
          } else {
            output.once('close', removePartial);
            output.destroy();
          }
          reject(error);
        };

        output.on('close', () => {
          if (!failed) {
            resolve({ success: true, count: itemIds.length });
          }
        });
        output.on('error', failZip);
        archive.on('error', failZip);
        archive.pipe(output);

        (async () => {
          for (const itemId of itemIds) {
            if (failed) {
              return;
            }
            const item = await StorageService.getItem(itemId);
            if (item.type === 'folder') {
              await addFolderToArchive(archive, item as Folder, sanitizePath(item.name), failZip);
            } else {
              const filePath = path.join(
                getActiveProfileDataDir(),
                folderId,
                sanitizePath(item.name)
              );
              await appendVaultEntryToArchive(
                archive,
                filePath,
                item.name,
                zipEntryDate(item),
                failZip
              );
            }
          }
          if (!failed) {
            archive.finalize();
          }
        })().catch(failZip);
      });
    } catch (error: unknown) {
      console.error('Error during multiple download:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
);

// ============================================
// STORAGE QUOTA IPC HANDLERS
// ============================================

ipcMain.handle('getStorageQuota', async () => {
  try {
    return await StorageService.getStorageQuota();
  } catch (error) {
    console.error('Error in getStorageQuota:', error);
    throw error;
  }
});

ipcMain.handle('updateStorageQuota', async () => {
  try {
    return await StorageService.updateStorageQuota();
  } catch (error) {
    console.error('Error in updateStorageQuota:', error);
    throw error;
  }
});

ipcMain.handle('checkQuotaBeforeUpload', async (_event: IpcMainInvokeEvent, fileSize: number) => {
  try {
    return await StorageService.checkQuotaBeforeUpload(fileSize);
  } catch (error) {
    console.error('Error in checkQuotaBeforeUpload:', error);
    throw error;
  }
});

// ============================================
// TRASH/CORBEILLE IPC HANDLERS
// ============================================

ipcMain.handle('storage:getTrashItems', async () => {
  try {
    const items = await StorageService.getTrashItems();
    return items;
  } catch (error) {
    console.error('[IPC] Error in storage:getTrashItems:', error);
    throw error;
  }
});

ipcMain.handle('storage:restoreItem', async (_event: IpcMainInvokeEvent, itemId: string) => {
  try {
    const result = await StorageService.restoreItem(itemId);
    return result;
  } catch (error) {
    console.error('[IPC] Error in storage:restoreItem:', error);
    throw error;
  }
});

ipcMain.handle(
  'storage:permanentlyDeleteItem',
  async (_event: IpcMainInvokeEvent, itemId: string, folderId?: string) => {
    try {
      const result = await StorageService.permanentlyDeleteItem(itemId, folderId || null);
      return result;
    } catch (error) {
      console.error('[IPC] Error in storage:permanentlyDeleteItem:', error);
      throw error;
    }
  }
);

ipcMain.handle('storage:emptyTrash', async (_event: IpcMainInvokeEvent, olderThanDays?: number) => {
  try {
    const result = await StorageService.emptyTrash(olderThanDays);
    return result;
  } catch (error) {
    console.error('[IPC] Error in storage:emptyTrash:', error);
    throw error;
  }
});

ipcMain.handle('storage:autoCleanupTrash', async () => {
  try {
    const result = await StorageService.autoCleanupTrash();
    return result;
  } catch (error) {
    console.error('[IPC] Error in storage:autoCleanupTrash:', error);
    throw error;
  }
});

ipcMain.handle(
  'storage:deleteFolder',
  async (_event: IpcMainInvokeEvent, id: string, permanent: boolean = false) => {
    try {
      await StorageService.deleteFolder(id, permanent);
      return true;
    } catch (error) {
      console.error('[IPC] Error in storage:deleteFolder:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'storage:deleteFile',
  async (
    _event: IpcMainInvokeEvent,
    folderId: string,
    fileName: string,
    permanent: boolean = false
  ) => {
    try {
      const result = await StorageService.deleteFile(folderId, fileName, permanent);
      return result;
    } catch (error) {
      console.error('[IPC] Error in storage:deleteFile:', error);
      throw error;
    }
  }
);

// ==================== Password Manager IPC Handlers ====================

const PM_DB_FILENAME = 'password_manager.enc';

ipcMain.handle('pm:saveDatabase', async (_event: IpcMainInvokeEvent, encryptedData: string) => {
  try {
    const dataDir = getActiveProfileDataDir();
    await fs.mkdir(dataDir, { recursive: true });
    const filePath = path.join(dataDir, PM_DB_FILENAME);
    await fs.writeFile(filePath, encryptedData, 'utf-8');
    return true;
  } catch (error) {
    console.error('[IPC] Error in pm:saveDatabase:', error);
    throw error;
  }
});

ipcMain.handle('pm:loadDatabase', async () => {
  try {
    const filePath = path.join(getActiveProfileDataDir(), PM_DB_FILENAME);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return data;
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  } catch (error) {
    console.error('[IPC] Error in pm:loadDatabase:', error);
    throw error;
  }
});

ipcMain.handle('pm:deleteDatabase', async () => {
  try {
    const filePath = path.join(getActiveProfileDataDir(), PM_DB_FILENAME);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return true;
  } catch (error) {
    console.error('[IPC] Error in pm:deleteDatabase:', error);
    throw error;
  }
});

ipcMain.handle(
  'pm:exportToFile',
  async (_event: IpcMainInvokeEvent, data: string, defaultName: string) => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return null;

      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [
          { name: 'JSON', extensions: ['json'] },
          { name: 'CSV', extensions: ['csv'] },
          { name: 'Encrypted', extensions: ['enc'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) return null;

      await fs.writeFile(result.filePath, data, 'utf-8');
      return result.filePath;
    } catch (error) {
      console.error('[IPC] Error in pm:exportToFile:', error);
      throw error;
    }
  }
);

ipcMain.handle('pm:importFromFile', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Password Files', extensions: ['json', 'csv', 'enc'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const data = await fs.readFile(filePath, 'utf-8');
    return { data, path: filePath };
  } catch (error) {
    console.error('[IPC] Error in pm:importFromFile:', error);
    throw error;
  }
});

let clipboardClearTimer: NodeJS.Timeout | null = null;

ipcMain.handle(
  'pm:copyToClipboard',
  async (_event: IpcMainInvokeEvent, text: string, clearAfterMs: number = 30000) => {
    try {
      clipboard.writeText(text);

      // Clear any existing timer
      if (clipboardClearTimer) {
        clearTimeout(clipboardClearTimer);
      }

      // Set auto-clear timer
      if (clearAfterMs > 0) {
        clipboardClearTimer = setTimeout(() => {
          // Only clear if clipboard still contains what we wrote
          if (clipboard.readText() === text) {
            clipboard.writeText('');
          }
          clipboardClearTimer = null;
        }, clearAfterMs);
      }

      return true;
    } catch (error) {
      console.error('[IPC] Error in pm:copyToClipboard:', error);
      throw error;
    }
  }
);

/**
 * Copie d'une image (d'une note) dans le presse-papiers du système.
 *
 * Le renderer ne PEUT PAS le faire seul : `event.clipboardData` ne transporte
 * que du texte, et Electron n'installe aucun menu contextuel natif. Sans ce
 * canal, un « Copier » sur une image de note ne produisait que du HTML —
 * inutilisable dans Paint, Word ou une messagerie.
 *
 * Les deux formes partent ensemble : le bitmap pour le monde extérieur, le
 * HTML pour que le collage DANS Filarr retrouve un `fileEmbed`.
 */
ipcMain.handle(
  'clipboard:writeImage',
  async (_event: IpcMainInvokeEvent, dataUrl: string, fileName?: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false;
    const image = nativeImage.createFromDataURL(dataUrl);
    // Un décodage raté rend une image VIDE sans lever : sans ce garde-fou on
    // écraserait le presse-papiers de l'utilisateur avec du néant.
    if (image.isEmpty()) return false;
    const alt = (fileName || 'image').replace(/[&<>"]/g, '');
    clipboard.write({ image, html: `<img src="${dataUrl}" alt="${alt}">` });
    return true;
  }
);

/**
 * « Enregistrer l'image sous… » depuis une note.
 *
 * Le dialogue ET l'écriture sont ici, dans le même appel : le renderer ne
 * choisit jamais le chemin, donc ce canal n'ouvre aucune écriture arbitraire —
 * la destination est celle que l'utilisateur vient de désigner lui-même. C'est
 * aussi ce qui permet d'enregistrer HORS du dossier personnel (un disque
 * externe, une clé USB), ce que `writeRawFile` refuse par construction.
 *
 * Les octets d'origine sont écrits tels quels : ré-encoder via `nativeImage`
 * transformerait un PNG optimisé ou un GIF animé en une autre image.
 */
ipcMain.handle(
  'notes:saveImageAs',
  async (
    _event: IpcMainInvokeEvent,
    dataUrl: string,
    suggestedName?: string
  ): Promise<'saved' | 'cancelled' | 'failed'> => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return 'failed';
    const marker = dataUrl.indexOf(';base64,');
    if (marker < 0) return 'failed';
    try {
      const bytes = Buffer.from(dataUrl.slice(marker + ';base64,'.length), 'base64');
      if (bytes.length === 0) return 'failed';
      const result = await dialog.showSaveDialog(mainWindow as BrowserWindow, {
        defaultPath: suggestedName || 'image.png',
      });
      if (result.canceled || !result.filePath) return 'cancelled';
      await fs.writeFile(result.filePath, bytes);
      return 'saved';
    } catch (error) {
      console.error('[IPC] Error in notes:saveImageAs:', error);
      return 'failed';
    }
  }
);

// ==================== Notes IPC Handlers ====================

const NOTES_DB_FILENAME = 'notes.enc';

// ── Cache mémoire du coffre de notes DÉCHIFFRÉ ──────────────────────────────
//
// POSSÉDÉ PAR LE MAIN, et par personne d'autre. Il n'existe que pour que
// `notes:saveDelta` puisse appliquer quelques Ko de modifications sans relire ni
// déchiffrer 70 Mo à chaque frappe. Une seule entrée : garder le clair de
// plusieurs profils en mémoire serait une fuite, pas une optimisation — l'entrée
// porte donc SON profil et son fichier, et tout ce qui ne correspond pas est
// traité comme absent.
//
// L'EMPREINTE DE FICHIER est le cœur de la sûreté. Le cache est peuplé par
// `notes:load` et par `notes:save`, mais un TROISIÈME écrivain existe : la fusion
// du cycle de synchronisation (`downloadAndMergeNotes`), qui réécrit `notes.enc`
// sans rien savoir d'ici. On mémorise donc l'identité du fichier au moment où le
// cache a été rempli (taille + mtime nanoseconde + index NTFS/inode — que
// l'écriture-puis-renommage d'`encryptToFile` renouvelle à chaque fois) et on la
// revérifie sous le verrou avant CHAQUE application de delta. La moindre
// divergence, ou une empreinte impossible à lire, et on relit le disque.
interface NotesVaultCacheEntry {
  profileId: string;
  filePath: string;
  payload: NotesVaultPayload;
  fingerprint: string;
}
let notesVaultCache: NotesVaultCacheEntry | null = null;

/**
 * ÉTAT DU COFFRE v2 DU PROFIL ACTIF. `null` = profil en v1, ou rien encore lu.
 *
 * Deux choses y vivent ensemble parce qu'elles ne valent QUE l'une par l'autre :
 * l'index (pour écrire de façon incrémentale) et le clair (pour appliquer un
 * delta sans tout relire). Séparés, on pourrait appliquer un delta sur un clair
 * qui ne correspond plus à l'index — donc écrire un coffre qui ment.
 *
 * ⚠ N'EMPRUNTE PAS l'empreinte de fichier du cache v1 : en v2, `notes.enc` ne
 * bouge plus jamais, son empreinte serait donc éternellement « valide » et le
 * cache ne se périmerait plus. C'est l'INDEX qui fait foi ici.
 */
let notesV2State: {
  profileId: string;
  index: NotesIndex;
  payload: NotesVaultPayload;
} | null = null;

/** Oublie le coffre v2 en mémoire. Appelé au verrouillage et au changement de profil. */
function forgetNotesV2(): void {
  notesV2State = null;
}

/**
 * Identité du fichier, ou `null` s'il n'existe pas / n'est pas lisible. `null`
 * n'est JAMAIS traité comme « inchangé » : c'est un refus de conclure.
 */
async function notesFileFingerprint(filePath: string): Promise<string | null> {
  try {
    const st = await fs.stat(filePath, { bigint: true });
    return `${st.size}:${st.mtimeNs}:${st.ino}`;
  } catch {
    return null;
  }
}

/** Retient le coffre en clair. Sans profil ou sans empreinte : on oublie. */
function rememberNotesVault(
  profileId: string | null,
  filePath: string,
  payload: unknown,
  fingerprint: string | null
): void {
  if (!profileId || fingerprint === null || !isUsableNotesBase(payload)) {
    notesVaultCache = null;
    return;
  }
  notesVaultCache = { profileId, filePath, payload, fingerprint };
}

/**
 * Efface le clair de la mémoire du main. Appelé au VERROUILLAGE et à tout
 * changement de profil : un coffre verrouillé ne doit rien laisser derrière lui.
 */
function forgetNotesVault(): void {
  notesVaultCache = null;
  // MÊME CYCLE DE VIE, sans exception : un coffre verrouillé ne doit rien
  // laisser derrière lui, quel que soit son format.
  notesV2State = null;
}

/** Dernier clair remonté par profil — voir la garde de notes:save plus bas. */
const _notesDigests = new Map<string, string>();
/** Au-delà, on ne sérialise pas pour hacher (import massif) : on notifie. */
const NOTES_DIGEST_MAX_NOTES = 20_000;
/**
 * Budget d'octets du hachage complet. LE COMPTE DE NOTES NE BORNE RIEN : le
 * coût est en OCTETS, et une seule note peut peser des dizaines de Mo dès qu'on
 * y colle une image en data-URL. Un coffre de 70 Mo restait très en dessous des
 * 20 000 notes et coûtait donc `JSON.stringify` + SHA-256 du clair ENTIER à
 * chaque sauvegarde — mesuré ~180 ms de processus principal FIGÉ, toutes les
 * 2 s pendant qu'on déplace une note collante. D'où ce plafond.
 */
const NOTES_DIGEST_BYTE_BUDGET = 2 * 1024 * 1024;

/**
 * SHA-256 du clair, ou null si le hachage n'est pas raisonnable ici (l'appelant
 * notifie alors sans condition — se tromper doit toujours pencher du côté
 * « synchroniser quand même »).
 *
 * Deux régimes, selon le poids du coffre :
 *  - sous le budget : empreinte du clair entier, comme avant ;
 *  - au-dessus : empreinte STRUCTURELLE — id, `updatedAt`, titre et LONGUEURS
 *    par note, sans jamais construire la grande chaîne. Ce que cette empreinte
 *    ne voit pas, c'est une modification de contenu qui ne toucherait ni
 *    `updatedAt` ni la longueur ; or toute écriture de contenu passe par
 *    `updateNote`/`updateNoteContent`, qui posent `updatedAt`. Les seules
 *    mutations volontairement sans `updatedAt` sont la géométrie de vue
 *    (`setNoteViewGeometry`), qu'on ne veut justement pas pousser toute seule.
 */
function notesPlainDigest(notesData: unknown): string | null {
  try {
    const data = notesData as {
      allIds?: unknown[];
      byId?: Record<string, Record<string, unknown> | undefined>;
    };
    const allIds = data?.allIds;
    if (!Array.isArray(allIds)) return null;
    if (allIds.length > NOTES_DIGEST_MAX_NOTES) return null;

    // Pré-mesure O(N) et SANS allocation : additionne les longueurs déjà
    // connues des grandes chaînes, et s'arrête dès que le budget est dépassé.
    let weight = 0;
    for (const rawId of allIds) {
      const note = data.byId?.[String(rawId)];
      if (!note) continue;
      const content = note.content;
      const plainText = note.plainText;
      if (typeof content === 'string') weight += content.length;
      if (typeof plainText === 'string') weight += plainText.length;
      if (weight > NOTES_DIGEST_BYTE_BUDGET) break;
    }

    if (weight <= NOTES_DIGEST_BYTE_BUDGET) {
      return crypto.createHash('sha256').update(JSON.stringify(notesData)).digest('hex');
    }

    const hash = crypto.createHash('sha256');
    hash.update(`v2:${allIds.length}\u0000`);
    for (const rawId of allIds) {
      const id = String(rawId);
      const note = data.byId?.[id];
      if (!note) {
        hash.update(`${id}\u0000-\u0000`);
        continue;
      }
      const content = typeof note.content === 'string' ? note.content : '';
      const plainText = typeof note.plainText === 'string' ? note.plainText : '';
      const title = typeof note.title === 'string' ? note.title : '';
      hash.update(
        `${id}\u0000${String(note.updatedAt ?? '')}\u0000${String(note.deletedAt ?? '')}\u0000` +
          `${title}\u0000${content.length}\u0000${plainText.length}\u0000`
      );
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

ipcMain.handle(
  'notes:save',
  async (
    _event: IpcMainInvokeEvent,
    notesData: {
      byId: Record<string, any>;
      allIds: string[];
      templates: any[];
      /**
       * Set by bulk writers (external import) to skip version snapshotting.
       * Snapshotting every note of a 20k-note import means 20k hash-and-write
       * round-trips for a "version" that is just the imported file — the source
       * vault is the real backup. Normal saves leave this unset.
       */
      skipVersioning?: boolean;
    }
  ) => {
    try {
      const dataDir = getActiveProfileDataDir();
      await fs.mkdir(dataDir, { recursive: true });
      const filePath = path.join(dataDir, NOTES_DB_FILENAME);

      // GARDE + ÉCRITURE SOUS VERROU : la fusion des notes du cycle de sync
      // (downloadAndMergeNotes) lit, fusionne puis réécrit le MÊME fichier avec
      // plusieurs `await` entre les deux. Une sauvegarde qui s'intercalait dans
      // cet intervalle était écrasée par la fusion — la frappe partait — et les
      // deux écritures pouvaient se croiser dans le temporaire d'encryptToFile.
      // Le blob v1 a-t-il été RÉÉCRIT ? Seul ce cas arme la remontée de
      // `meta:notes` ; en v2 le fichier ne bouge pas, et c'est le pont du cycle
      // des notes qui s'en charge — il arme lui-même quand il réécrit.
      let wroteLegacyBlob = false;
      const written = await withNotesLock(async (): Promise<number | null> => {
        // CRITICAL SAFETY GUARD: refuse to overwrite a non-empty notes file with
        // an empty state unless the user explicitly requested a bulk deletion.
        // Without this guard, a race between mount and loadNotesFromDisk can
        // produce a write with byId={} that wipes 30 KB of real encrypted notes.
        // We consider the incoming state "empty" if it has zero notes AND zero
        // allIds. The existing file is "non-empty" if it's > 200 bytes (an empty
        // encrypted {byId:{},allIds:[],templates:[...]} is typically ~150 bytes).
        const incomingIsEmpty =
          (!notesData?.allIds || notesData.allIds.length === 0) &&
          (!notesData?.byId || Object.keys(notesData.byId).length === 0);
        if (incomingIsEmpty) {
          try {
            const existing = await fs.stat(filePath);
            if (existing.size > 200) {
              log.warn(
                `[notes:save] REFUSED: incoming state is empty but existing notes.enc is ${existing.size} bytes. ` +
                  'Likely race between mount and loadNotesFromDisk — skipping to preserve data.'
              );
              return null;
            }
          } catch {
            /* file doesn't exist — safe to write empty */
          }
        }

        /**
         * CHEMIN v2 — sortie anticipée, SOUS LE MÊME VERROU.
         *
         * L'écriture y est déjà incrémentale : `saveVaultV2` ne réécrit que les
         * notes dont l'empreinte a bougé. Une sauvegarde « pleine » en v2 coûte
         * donc ce qu'on a tapé, pas la taille de la bibliothèque.
         *
         * La garde anti-vidage ci-dessus s'applique aux DEUX formats : elle est
         * passée avant d'arriver ici.
         */
        if (notesV2State && notesV2State.profileId === activeProfileId) {
          try {
            const res = await notesVault.saveNotesV2(
              dataDir,
              notesData as NotesVaultPayload,
              notesV2State.index
            );
            notesV2State = {
              profileId: notesV2State.profileId,
              index: res.index!,
              payload: notesData as NotesVaultPayload,
            };
            log.info(`[notes:save] v2 — ${res.written.length} objet(s) réécrit(s)`);
            // Taille rendue à l'appelant : la somme n'a plus de sens en v2, on
            // rend 1 pour dire « écrit » sans mentir sur des octets.
            return 1;
          } catch (err) {
            // On n'écrit RIEN plutôt que d'écrire à moitié. Le disque est resté
            // ce qu'il était (l'index n'a pas été touché) et l'appelant le saura.
            forgetNotesV2();
            throw err;
          }
        }

        // Streamed to disk rather than built as one giant string: a bulk import
        // can make this payload hundreds of MB, and the old build-then-write path
        // peaked at several times that. Same `v2:` container either way.
        try {
          await StorageService.encryptToFile(notesData, filePath);
          wroteLegacyBlob = true;
        } catch (err) {
          // Le fichier est resté ce qu'il était (encryptToFile ne renomme qu'à la
          // fin), mais on n'a plus aucune raison de faire confiance à ce qu'on
          // croyait savoir : on oublie plutôt que de risquer un delta sur une base
          // fausse.
          forgetNotesVault();
          throw err;
        }
        const stat = await fs.stat(filePath).catch(() => null);
        // Le coffre qui vient d'être scellé DEVIENT la base des deltas suivants —
        // sans quoi la toute première sauvegarde incrémentale relirait 70 Mo.
        rememberNotesVault(
          activeProfileId,
          filePath,
          notesData,
          await notesFileFingerprint(filePath)
        );
        return stat?.size ?? 0;
      });

      if (written === null) return false;

      log.info(`[notes:save] Wrote ${written} bytes (${notesData.allIds?.length ?? 0} notes)`);

      // Notify sync service — seulement si le CLAIR a réellement changé. Un
      // aller-retour identique (rechargement après une fusion, puis auto-sauvegarde)
      // rescelle le conteneur avec un sel neuf : l'empreinte du chiffré diffère
      // toujours, et la sync remontait donc un contenu inchangé. Miroir de la
      // garde web (src/platform/web/sync/notesDigest.ts).
      if (activeProfileId) {
        if (wroteLegacyBlob) {
          const digest = notesPlainDigest(notesData);
          if (digest === null || _notesDigests.get(activeProfileId) !== digest) {
            if (digest !== null) _notesDigests.set(activeProfileId, digest);
            syncService.notifyMetadataChanged(activeProfileId, 'notes');
          }
        } else {
          // v2 : `notes.enc` n'a pas bougé — armer `meta:notes` ici faisait
          // repartir 3,5 Mo à l'identique à chaque sauvegarde dès que le pont
          // différait sa réécriture (05/09/2026). On demande juste un cycle pour
          // que les objets de notes partent ; le pont arme le blob quand il l'écrit.
          syncService.scheduleSync(activeProfileId);
        }
      }

      if (notesData.skipVersioning) {
        log.info('[notes:save] Version snapshots skipped (bulk write)');
      }

      // Snapshot version history — fire-and-forget. Never block the save on this.
      // The service internally dedups identical content and throttles bursts.
      if (!notesData.skipVersioning && activeProfileId && notesData.byId && notesData.allIds) {
        const snapshotInputs = notesData.allIds
          .map((id) => notesData.byId[id])
          .filter((n) => n && !n.deletedAt)
          .map((n) => ({
            id: n.id,
            title: n.title ?? '',
            content: typeof n.content === 'string' ? n.content : '',
            plainText: typeof n.plainText === 'string' ? n.plainText : '',
            wordCount: typeof n.wordCount === 'number' ? n.wordCount : 0,
          }));
        const pid = activeProfileId;
        // E9-2: an active org governance policy's versionRetentionDays overrides the personal 30-day
        // default for this member's version history (compliance retention). Best-effort: a failure to
        // read the cached policy just falls back to the default.
        let versionRetentionDays: number | null = null;
        try {
          const cache = await authService.loadPolicyCache();
          if (cache && cache.policyVersion >= 1) {
            const v = (
              cache.policyJson as { retention?: { versionRetentionDays?: unknown } } | null
            )?.retention?.versionRetentionDays;
            if (typeof v === 'number' && v > 0) versionRetentionDays = v;
          }
        } catch {
          /* fall back to the personal default retention */
        }
        noteVersionService
          .recordSnapshots(pid, dataDir, snapshotInputs, versionRetentionDays)
          .then((res) => {
            // Always log so the reader can tell the versioning path ran,
            // even when every note was skipped by dedup or interval.
            log.info(
              `[notes:save] Version snapshots: ${res.snapshotted.length} new, ${res.skipped.length} skipped, pruned ${res.pruned}`
            );
            if (res.skipped.length > 0 && res.snapshotted.length === 0) {
              // Helpful during testing: expose why nothing was snapshotted.
              const reasons = res.skipped.map((s) => s.reason).join(',');
              log.info(`[notes:save] Skip reasons: ${reasons}`);
            }
          })
          .catch((err) => {
            log.warn('[notes:save] recordSnapshots failed (non-blocking):', err?.message || err);
          });
      }

      return true;
    } catch (error) {
      console.error('[IPC] Error in notes:save:', error);
      throw error;
    }
  }
);

/**
 * SAUVEGARDE INCRÉMENTALE — le même fichier, écrit à partir de beaucoup moins.
 *
 * Ce que ce canal change par rapport à `notes:save` : la charge utile. Le
 * renderer n'envoie plus que les notes qu'il a touchées depuis la dernière
 * écriture. Sur un coffre de 70 Mo, la sérialisation payée deux fois côté
 * renderer (contextBridge puis IPC) tombe de ~100 ms à une fraction de
 * milliseconde, et le main n'a plus à désérialiser le coffre entier.
 *
 * Ce que ce canal NE change PAS : le format de `notes.enc`, la garde
 * anti-vidage, le verrou partagé avec la fusion du cycle de sync, l'empreinte
 * du clair qui décide s'il faut notifier la synchronisation. `notes:save`
 * (plein) reste vivant et inchangé — c'est lui qu'utilisent l'import massif, les
 * réglages, et le repli de ce canal.
 *
 * EN CAS DE DOUTE, ON N'ÉCRIT PAS. Delta malformé, base introuvable, base
 * illisible, base d'une autre forme : on rend `{ ok: false, needsFull: true }` et
 * le renderer refait une sauvegarde PLEINE. Écrire un état partiel serait la
 * seule issue véritablement destructrice.
 */
ipcMain.handle('notes:saveDelta', async (_event: IpcMainInvokeEvent, rawDelta: unknown) => {
  try {
    if (!isWellFormedNotesDelta(rawDelta)) {
      log.warn('[notes:saveDelta] delta malformé — repli sur une écriture pleine');
      return { ok: false, needsFull: true };
    }
    const delta: NotesDeltaPayload = rawDelta;
    const dataDir = getActiveProfileDataDir();
    await fs.mkdir(dataDir, { recursive: true });
    const filePath = path.join(dataDir, NOTES_DB_FILENAME);
    const profileId = activeProfileId;

    type DeltaOutcome =
      | { kind: 'needs-full'; why: string }
      | { kind: 'refused' }
      | {
          kind: 'written';
          payload: NotesVaultPayload;
          size: number;
          reusedCache: boolean;
          /** Notes que le disque portait plus fraîches — non écrites. */
          stale: string[];
          /** Le blob v1 `notes.enc` a été réécrit (chemin v1) — faux en v2. */
          legacy: boolean;
        };

    // MÊME VERROU que `notes:save` et que la fusion de la descente : la
    // vérification d'identité du fichier, la lecture de secours, l'application du
    // delta et l'écriture forment une seule section critique. Sans cela, deux
    // deltas concurrents liraient la même base et le second effacerait le premier.
    const outcome = await withNotesLock(async (): Promise<DeltaOutcome> => {
      /**
       * CHEMIN v2 — sortie anticipée, sous le même verrou que la v1.
       *
       * La base n'est PAS relue du disque : c'est `notesV2State.payload`, tenu à
       * jour par le chargement et par chaque écriture. En v2 il n'y a pas
       * d'empreinte de fichier à vérifier — `notes.enc` ne bouge plus — donc
       * c'est l'INDEX qui tient lieu d'identité, et il voyage avec le clair dans
       * le même objet, précisément pour qu'ils ne puissent pas se désaccorder.
       *
       * La garde de concurrence optimiste (`selectStaleDeltaEntries`) s'applique
       * exactement comme en v1 : une copie périmée du renderer ne passe pas.
       */
      if (notesV2State && notesV2State.profileId === profileId) {
        const base = notesV2State.payload;
        const stale = selectStaleDeltaEntries(base, delta);
        const next = applyNotesDelta(base, delta);

        // Même garde anti-vidage qu'en v1, portée sur le RÉSULTAT.
        if (isEmptyNotesVault(next) && Object.keys(base.byId).length > 0) {
          log.warn('[notes:saveDelta] REFUSÉ (v2) : le delta viderait un coffre plein.');
          return { kind: 'refused' };
        }

        try {
          const res = await notesVault.saveNotesV2(dataDir, next, notesV2State.index);
          notesV2State = { profileId, index: res.index!, payload: next };
          return {
            kind: 'written',
            payload: next,
            size: res.written.length,
            reusedCache: true,
            stale,
            legacy: false,
          };
        } catch (err) {
          forgetNotesV2();
          throw err;
        }
      }

      const fingerprint = await notesFileFingerprint(filePath);

      let base: NotesVaultPayload | null = null;
      let reusedCache = false;
      if (
        notesVaultCache &&
        notesVaultCache.profileId === profileId &&
        notesVaultCache.filePath === filePath &&
        fingerprint !== null &&
        notesVaultCache.fingerprint === fingerprint
      ) {
        base = notesVaultCache.payload;
        reusedCache = true;
      }

      if (!base) {
        // Cache absent, périmé, ou fichier réécrit sous nos pieds (fusion du
        // cycle de sync) : UNE relecture + déchiffrement, puis on repart.
        forgetNotesVault();
        if (fingerprint === null) {
          // Pas de fichier du tout : il n'existe aucune base à laquelle ajouter
          // un delta. C'est le premier enregistrement, il doit être plein.
          return { kind: 'needs-full', why: 'aucun notes.enc' };
        }
        let decrypted: unknown;
        try {
          const container = await fs.readFile(filePath, 'utf-8');
          if (!container || container.trim().length === 0) {
            return { kind: 'needs-full', why: 'notes.enc vide' };
          }
          decrypted = await StorageService.decrypt(container);
        } catch (err) {
          log.warn(
            `[notes:saveDelta] base illisible (${(err as Error).message}) — repli sur une écriture pleine`
          );
          return { kind: 'needs-full', why: 'lecture/déchiffrement impossible' };
        }
        if (!isUsableNotesBase(decrypted)) {
          return { kind: 'needs-full', why: 'base de forme inattendue' };
        }
        base = decrypted;
      }

      /**
       * GARDE DE CONCURRENCE OPTIMISTE — calculée SOUS LE VERROU, sur la base
       * qu'on va réellement écrire.
       *
       * Le renderer déclare, note par note, la version dont il est parti. Si le
       * disque a avancé entre-temps (la fusion de la descente vient de
       * rapatrier plus frais), sa copie est périmée : on ne l'écrit pas, on
       * garde celle du disque, et on le fera recharger. C'est le défaut du
       * 2026-09-02 — 613 586 octets écrasés puis remontés au nuage — pris à la
       * seule endroit où il est encore réparable.
       */
      const stale = selectStaleDeltaEntries(base, delta);
      const next = applyNotesDelta(base, delta);

      // GARDE ANTI-VIDAGE, mot pour mot celle de `notes:save` : un état vide ne
      // remplace jamais un fichier plein. Elle porte ici sur le RÉSULTAT, donc
      // elle reste vraie même si la base venait du cache.
      if (isEmptyNotesVault(next)) {
        try {
          const existing = await fs.stat(filePath);
          if (existing.size > 200) {
            log.warn(
              `[notes:saveDelta] REFUSÉ : le delta viderait un notes.enc de ${existing.size} octets.`
            );
            return { kind: 'refused' };
          }
        } catch {
          /* pas de fichier — écrire du vide est sans danger */
        }
      }

      try {
        await StorageService.encryptToFile(next, filePath);
      } catch (err) {
        forgetNotesVault();
        throw err;
      }
      const stat = await fs.stat(filePath).catch(() => null);
      rememberNotesVault(profileId, filePath, next, await notesFileFingerprint(filePath));
      return {
        kind: 'written',
        payload: next,
        size: stat?.size ?? 0,
        reusedCache,
        stale,
        legacy: true,
      };
    });

    if (outcome.kind === 'needs-full') {
      log.info(`[notes:saveDelta] écriture pleine demandée (${outcome.why})`);
      return { ok: false, needsFull: true };
    }
    if (outcome.kind === 'refused') return { ok: false, needsFull: false };

    log.info(
      `[notes:saveDelta] Wrote ${outcome.size} bytes (${
        Object.keys(delta.dirtyById).length
      } sale(s), ${delta.removedIds.length} retirée(s), ${
        outcome.payload.allIds.length
      } notes, base ${outcome.reusedCache ? 'en cache' : 'relue'})`
    );

    /**
     * DES NOTES ONT ÉTÉ REFUSÉES : LE RENDERER DOIT LE SAVOIR.
     *
     * Le disque porte, pour ces notes-là, une version plus fraîche que celle
     * dont le renderer est parti. Il tient donc en mémoire un état périmé et le
     * réécrirait à la frappe suivante — la garde le refuserait de nouveau, en
     * boucle, pendant que l'utilisateur voit « Enregistré ».
     *
     * `notes-updated` le fait relire le disque (via la purge puis
     * `loadNotesFromDisk` — voir electronMiddleware) : il repart alors de la
     * bonne base, et l'éditeur ouvert se resème par `note.content`. Ce que
     * l'utilisateur vient de taper sur ces notes-là est perdu au profit du
     * disque — mais c'est un ARBITRAGE ASSUMÉ entre deux versions, pas la
     * destruction silencieuse d'une version que personne n'avait vue.
     */
    if (outcome.stale.length > 0) {
      log.warn(
        `[notes:saveDelta] ${outcome.stale.length} note(s) REFUSÉE(S) — le disque était plus frais : ` +
          `${outcome.stale.slice(0, 5).join(', ')}${outcome.stale.length > 5 ? '…' : ''}`
      );
      mainWindow?.webContents.send('notes-updated');
    }

    // Empreinte du CLAIR, comme `notes:save` : un aller-retour identique ne doit
    // pas réveiller la synchronisation. Calculée sur le coffre complet (l'objet
    // en cache), pas sur le delta — c'est le fichier qui est comparé d'un
    // appareil à l'autre, pas le geste.
    if (profileId) {
      if (outcome.legacy) {
        const digest = notesPlainDigest(outcome.payload);
        if (digest === null || _notesDigests.get(profileId) !== digest) {
          if (digest !== null) _notesDigests.set(profileId, digest);
          syncService.notifyMetadataChanged(profileId, 'notes');
        }
      } else {
        // v2 : voir `notes:save` — le blob n'a pas bougé, on ne l'arme pas.
        syncService.scheduleSync(profileId);
      }
    }

    // Instantanés de version sur les SEULES notes sales. Le passage complet
    // sérialisait et hachait les 70 Mo du coffre à chaque sauvegarde, pour
    // conclure que rien n'avait bougé sur 5 999 notes.
    if (!delta.skipVersioning && profileId) {
      const snapshotInputs = snapshotInputsFromDelta(delta);
      if (snapshotInputs.length > 0) {
        let versionRetentionDays: number | null = null;
        try {
          const cache = await authService.loadPolicyCache();
          if (cache && cache.policyVersion >= 1) {
            const v = (
              cache.policyJson as { retention?: { versionRetentionDays?: unknown } } | null
            )?.retention?.versionRetentionDays;
            if (typeof v === 'number' && v > 0) versionRetentionDays = v;
          }
        } catch {
          /* fall back to the personal default retention */
        }
        noteVersionService
          .recordSnapshots(profileId, dataDir, snapshotInputs, versionRetentionDays)
          .then((res) => {
            log.info(
              `[notes:saveDelta] Version snapshots: ${res.snapshotted.length} new, ${res.skipped.length} skipped, pruned ${res.pruned}`
            );
          })
          .catch((err) => {
            log.warn(
              '[notes:saveDelta] recordSnapshots failed (non-blocking):',
              err?.message || err
            );
          });
      }
    }

    return { ok: true };
  } catch (error) {
    console.error('[IPC] Error in notes:saveDelta:', error);
    // Une exception ne doit pas laisser le renderer croire que c'est écrit :
    // il refera une sauvegarde pleine.
    return { ok: false, needsFull: true };
  }
});

/**
 * ÉTAT DU FORMAT DU COFFRE — ce que l'écran des réglages a besoin de savoir.
 *
 * Trois choses, et rien d'autre : le format sur le disque, si migrer est sûr
 * en ce moment, et combien de notes sont concernées. Aucune n'est devinable
 * depuis le renderer : le format vit sur le disque, le verdict vient du dernier
 * cycle de synchronisation.
 */
ipcMain.handle('notes:vaultFormat', async () => {
  try {
    const dataDir = getActiveProfileDataDir();
    const format = await notesVault.formatOf(dataDir);
    const verdict = activeProfileId
      ? syncService.legacyNotesVerdict(activeProfileId)
      : ('unknown' as const);
    return { success: true, format, verdict };
  } catch (error) {
    log.error('[notes:vaultFormat]', error);
    return { success: false, format: 'none', verdict: 'unknown' };
  }
});

/**
 * MIGRER, PARCE QUE QUELQU'UN VIENT DE LE DEMANDER.
 *
 * Sous le MÊME VERROU que les écritures de notes : la migration lit `notes.enc`
 * et pose une arborescence entière ; une sauvegarde qui s'intercalerait écrirait
 * dans un format pendant qu'on bascule vers l'autre.
 *
 * L'état v2 en mémoire est oublié après coup, et non recalculé : le prochain
 * `notes:load` le reconstruira depuis le disque, qui fait autorité.
 */
ipcMain.handle('notes:migrateV2', async (_event, opts?: { acknowledgeLegacyWriter?: boolean }) => {
  try {
    const dataDir = getActiveProfileDataDir();
    const verdict = activeProfileId
      ? syncService.legacyNotesVerdict(activeProfileId)
      : ('unknown' as const);
    const res = await withNotesLock(() =>
      notesVault.migrateNow(dataDir, verdict, {
        acknowledgeLegacyWriter: opts?.acknowledgeLegacyWriter === true,
      })
    );
    if (res.ok) {
      forgetNotesVault();
      // Le renderer relit tout : ses notes viennent désormais d'ailleurs.
      mainWindow?.webContents.send('notes-updated');
    }
    return res;
  } catch (error) {
    log.error('[notes:migrateV2]', error);
    return { ok: false, why: (error as Error).message };
  }
});

ipcMain.handle('notes:load', async () => {
  try {
    const dataDir = getActiveProfileDataDir();
    const filePath = path.join(dataDir, NOTES_DB_FILENAME);

    /**
     * CHEMIN v2 — un objet par note. Placé EN TÊTE et en sortie anticipée : le
     * code v1 qui suit est littéralement celui d'avant, non touché.
     *
     * La migration est tentée ici, et pas ailleurs, parce que c'est le seul
     * endroit où l'on est sûr des trois conditions : le profil est actif, le
     * coffre est déverrouillé (`StorageService` porte sa clé), et on s'apprêtait
     * de toute façon à tout lire. Elle ne fait rien sans `FILARR_NOTES_V2`.
     */
    try {
      // Le verdict vient du DERNIER cycle de synchronisation : lui seul a vu
      // le manifeste distant. Sans cycle encore passe, il vaut `unknown` et la
      // migration attend — voir `migrateIfEnabled`.
      await notesVault.migrateIfEnabled(
        dataDir,
        activeProfileId ? syncService.legacyNotesVerdict(activeProfileId) : 'unknown'
      );
      const t0 = Date.now();
      const loaded = await notesVault.loadNotes(dataDir);
      if (loaded && loaded.format === 'v2' && loaded.index) {
        // Le cache v1 n'a plus de sens : son empreinte porte sur un `notes.enc`
        // qui ne bougera plus jamais, elle serait éternellement « valide ».
        notesVaultCache = null;
        notesV2State = activeProfileId
          ? {
              profileId: activeProfileId,
              index: loaded.index,
              payload: loaded.payload as NotesVaultPayload,
            }
          : null;
        // La durée est le chiffre qui compte : 8,3 s pour 32 notes le 05/09/2026,
        // une dérivation PBKDF2 par objet, en série. Voir `VAULT_READ_CONCURRENCY`.
        log.info(
          `[notes:load] v2 — ${Object.keys(loaded.index.notes).length} note(s)` +
            (loaded.missing.length > 0 ? `, ${loaded.missing.length} illisible(s)` : '') +
            ` en ${Date.now() - t0} ms`
        );
        if (loaded.missingBlobs.length > 0 && activeProfileId) {
          // Des images citées manquent sur ce disque. Le cycle ne descend une
          // image qu'avec la note qu'il télécharge lui-même : une note réinjectée
          // depuis la v1 arrive sans les siennes. On les demande au prochain cycle.
          syncService.reportMissingNoteBlobs(activeProfileId, loaded.missingBlobs);
        }
        // Passe de migration `v2:` → `v3:` du coffre de notes, sous le verrou des
        // notes, APRÈS avoir rendu la main. Ne fait rien tant que
        // FILARR_MACHINE_CONTAINER_V3 n'est pas à `notes` ou `all`.
        void withNotesLock(() => notesVault.upgradeContainers(dataDir)).catch((err) => {
          log.warn(`[notes:load] migration v3 du coffre ignorée : ${(err as Error).message}`);
        });
        return loaded.payload;
      }
    } catch (err) {
      // Un échec du chemin v2 ne doit JAMAIS empêcher de lire : on retombe sur
      // la v1, qui est toujours sur le disque (la migration ne l'efface pas).
      log.error('[notes:load] chemin v2 en échec — repli sur v1 :', err);
      notesV2State = null;
    }

    log.info(`[notes:load] Loading from ${filePath}`);
    try {
      // Encadrer la lecture par deux relevés d'identité : ce chemin ne prend PAS
      // le verrou des notes (il ne modifie rien), donc la fusion du cycle de sync
      // peut réécrire le fichier pendant qu'on déchiffre. Mémoriser un clair
      // périmé sous l'empreinte du fichier NEUF ferait appliquer les deltas
      // suivants sur une base fausse — la fusion serait perdue. Empreintes
      // différentes = on ne met simplement rien en cache.
      const fingerprintBefore = await notesFileFingerprint(filePath);
      const data = await fs.readFile(filePath, 'utf-8');
      if (!data || data.trim().length === 0) {
        log.warn(`[notes:load] File empty or null (${data?.length ?? 0} bytes)`);
        return null;
      }
      log.info(`[notes:load] Read ${data.length} bytes, decrypting…`);
      const decrypted = await StorageService.decrypt(data);
      const noteCount = decrypted?.byId ? Object.keys(decrypted.byId).length : 0;
      log.info(`[notes:load] Decrypted OK — ${noteCount} notes`);
      // Le coffre vient d'être déchiffré ICI : le garder évite au premier delta
      // de refaire exactement ce travail. Le renderer reçoit une COPIE (clone
      // structuré de l'IPC), les deux objets ne s'aliasent donc jamais.
      const fingerprintAfter = await notesFileFingerprint(filePath);
      if (fingerprintBefore !== null && fingerprintBefore === fingerprintAfter) {
        rememberNotesVault(activeProfileId, filePath, decrypted, fingerprintAfter);
      } else {
        forgetNotesVault();
      }
      return decrypted;
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        log.info(`[notes:load] File does not exist (ENOENT)`);
        return null;
      }
      // StorageService not yet initialized — normal during startup race
      if (err instanceof Error && err.message.includes('not initialized')) {
        log.warn(`[notes:load] StorageService not initialized — returning null`);
        return null;
      }
      log.error('[notes:load] Decryption or read failed:', err);
      return null;
    }
  } catch (error) {
    log.error('[notes:load] Unexpected error:', error);
    throw error;
  }
});

// ==================== Note Version History IPC ====================

// Reject malformed note ids before they reach fs.*. Note ids in this
// codebase are UUID v4; allow hex + hyphen + underscore to cover legacy
// ids as well, but nothing that could escape the versions directory.
function isSafeNoteId(noteId: unknown): noteId is string {
  return typeof noteId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(noteId);
}

ipcMain.handle('note-versions:list', async (_event: IpcMainInvokeEvent, noteId: string) => {
  try {
    if (!isSafeNoteId(noteId)) return [];
    return await noteVersionService.listVersions(getActiveProfileDataDir(), noteId);
  } catch (err) {
    log.error('[note-versions:list] failed:', (err as Error).message);
    return [];
  }
});

ipcMain.handle(
  'note-versions:get',
  async (_event: IpcMainInvokeEvent, noteId: string, versionId: string) => {
    try {
      if (!isSafeNoteId(noteId)) return null;
      return await noteVersionService.getVersion(getActiveProfileDataDir(), noteId, versionId);
    } catch (err) {
      log.error('[note-versions:get] failed:', (err as Error).message);
      return null;
    }
  }
);

ipcMain.handle(
  'note-versions:delete',
  async (_event: IpcMainInvokeEvent, noteId: string, versionId: string) => {
    try {
      if (!isSafeNoteId(noteId)) return false;
      return await noteVersionService.deleteVersion(getActiveProfileDataDir(), noteId, versionId);
    } catch (err) {
      log.error('[note-versions:delete] failed:', (err as Error).message);
      return false;
    }
  }
);

ipcMain.handle('note-versions:clear', async (_event: IpcMainInvokeEvent, noteId: string) => {
  try {
    if (!isSafeNoteId(noteId)) return false;
    await noteVersionService.clearVersions(getActiveProfileDataDir(), noteId);
    return true;
  } catch (err) {
    log.error('[note-versions:clear] failed:', (err as Error).message);
    return false;
  }
});

// ── Historique de versions des FICHIERS personnels ──────────────────────────
//
// Miroir des poignées de notes ci-dessus, sur le magasin d'instantanés
// chiffrés de `fileVersionService`. La différence tient en un mot : ici on
// transporte des OCTETS, pas du JSON — d'où les conversions Buffer/Uint8Array
// aux deux bouts, et un plafond de taille appliqué côté service.

ipcMain.handle(
  'file-versions:snapshot',
  async (
    _event: IpcMainInvokeEvent,
    payload: {
      fileId: string;
      fileName: string;
      folderId: string;
      bytes: Uint8Array | ArrayBuffer;
      comment?: string;
    }
  ) => {
    try {
      const brut = payload?.bytes;
      const bytes = Buffer.isBuffer(brut)
        ? brut
        : brut instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(brut))
          : Buffer.from(brut as Uint8Array);
      return await fileVersionService.snapshot(getActiveProfileDataDir(), {
        fileId: payload.fileId,
        fileName: payload.fileName,
        folderId: payload.folderId,
        bytes,
        comment: payload.comment,
      });
    } catch (err) {
      log.error('[file-versions:snapshot] failed:', (err as Error).message);
      return { status: 'failed', reason: (err as Error).message };
    }
  }
);

ipcMain.handle('file-versions:list', async (_event: IpcMainInvokeEvent, fileId: string) => {
  try {
    return await fileVersionService.listVersions(getActiveProfileDataDir(), fileId);
  } catch (err) {
    log.error('[file-versions:list] failed:', (err as Error).message);
    return [];
  }
});

ipcMain.handle(
  'file-versions:content',
  async (_event: IpcMainInvokeEvent, fileId: string, versionId: string) => {
    try {
      const buf = await fileVersionService.getVersionContent(
        getActiveProfileDataDir(),
        fileId,
        versionId
      );
      // `null` porte DEUX cas et c'est voulu : version absente, ou empreinte
      // qui ne correspond pas. L'appelant ne doit rien réécrire dans les deux.
      return buf ? new Uint8Array(buf) : null;
    } catch (err) {
      log.error('[file-versions:content] failed:', (err as Error).message);
      return null;
    }
  }
);

ipcMain.handle(
  'file-versions:delete',
  async (_event: IpcMainInvokeEvent, fileId: string, versionId: string) => {
    try {
      return await fileVersionService.deleteVersion(getActiveProfileDataDir(), fileId, versionId);
    } catch (err) {
      log.error('[file-versions:delete] failed:', (err as Error).message);
      return false;
    }
  }
);

ipcMain.handle('file-versions:clear', async (_event: IpcMainInvokeEvent, fileId: string) => {
  try {
    return await fileVersionService.clearVersions(getActiveProfileDataDir(), fileId);
  } catch (err) {
    log.error('[file-versions:clear] failed:', (err as Error).message);
    return false;
  }
});

// ==================== Layout IPC Handlers ====================
//
// Le CONTENEUR DE MISE EN PAGE (`layout.enc`) est le socle de l'accueil
// modulaire : ce que l'utilisateur a posé, où il l'a posé, sur chacune de ses
// vues. Il vit à côté de `notes.enc`, scellé sous la même clé MACHINE — donc
// disponible hors ligne et sur un profil qui n'a aucun compte (voir l'en-tête
// de `sync/layoutStore.ts` pour pourquoi ce n'est PAS la FEK).

ipcMain.handle(
  'layout:load',
  async (_event: IpcMainInvokeEvent, hints?: LayoutSeedHints): Promise<LayoutLoadResult> => {
    try {
      const dataDir = getActiveProfileDataDir();
      // GARDE ANTI-DOUBLE-AMORÇAGE : si le nuage porte déjà une mise en page,
      // on n'en fabrique pas une seconde — on attend la descente.
      const cloudHas = activeProfileId
        ? await syncService.cloudCarriesLayout(activeProfileId).catch(() => false)
        : false;
      const result = await loadOrSeedLayout(dataDir, hints ?? {}, cloudHas);
      // Prévenir la sync UNIQUEMENT quand l'amorçage vient de créer le fichier :
      // marquer une remontée à chaque lecture rouvrirait un cycle pour rien.
      if (result.created && activeProfileId) {
        syncService.notifyMetadataChanged(activeProfileId, LAYOUT_META_RESOURCE_ID);
      }
      return result;
    } catch (err) {
      log.error('[layout:load] failed:', (err as Error).message);
      // `seeded: false` fait comprendre au renderer que le document rendu est
      // PROVISOIRE : il ne le réécrira pas par-dessus ce qui existe.
      return { document: createEmptyLayoutDocument(), seeded: false, created: false };
    }
  }
);

ipcMain.handle(
  'layout:save',
  async (_event: IpcMainInvokeEvent, document: unknown): Promise<boolean> => {
    try {
      const dataDir = getActiveProfileDataDir();
      // Écriture SOUS VERROU : la fusion du cycle de sync
      // (`downloadAndMergeLayout`) lit, fusionne puis réécrit le MÊME fichier
      // avec plusieurs `await` entre les deux. Sans le verrou partagé, une
      // sauvegarde intercalée était écrasée par la fusion, et les deux écritures
      // pouvaient se croiser dans le temporaire d'`encryptToFile`.
      await withLayoutLock(() => writeLayoutDocument(dataDir, normalizeLayoutDocument(document)));
      if (activeProfileId) {
        syncService.notifyMetadataChanged(activeProfileId, LAYOUT_META_RESOURCE_ID);
      }
      return true;
    } catch (err) {
      log.error('[layout:save] failed:', (err as Error).message);
      return false;
    }
  }
);

// ==================== Modèles de mise en page (.filarrlayout) ====================
//
// LE PRINCIPAL N'ANALYSE JAMAIS UN MODÈLE. Il ouvre un dialogue, il refuse ce
// qui dépasse le plafond, il rend une CHAÎNE. Toute la lecture (JSON, clés
// interdites, types de widgets, liaisons) se fait dans le renderer, dans
// `src/services/layouts/layoutValidator.ts` — un seul analyseur pour un format
// qui circule, parce que deux jeux de règles finiraient par diverger et que
// c'est toujours le plus permissif qui déciderait.
//
// Le plafond est mesuré ICI AUSSI, en octets, sur la taille du fichier : lire
// 400 Mo pour les rendre au renderer qui les refusera aurait déjà coûté les
// 400 Mo.

/** Miroir de `LAYOUT_FILE_MAX_BYTES` (src/services/layouts/layoutFormat.ts). */
const LAYOUT_FILE_MAX_BYTES = 256 * 1024;

const LAYOUT_FILE_FILTERS = [{ name: 'Filarr layout', extensions: ['filarrlayout'] }];

ipcMain.handle(
  'layouts:exportFile',
  async (_event: IpcMainInvokeEvent, payload: { content?: unknown; suggestedName?: unknown }) => {
    try {
      const content = typeof payload?.content === 'string' ? payload.content : null;
      if (content === null) return { success: false, error: 'bad-payload' };
      if (Buffer.byteLength(content, 'utf8') > LAYOUT_FILE_MAX_BYTES) {
        return { success: false, error: 'too-large' };
      }
      const suggested =
        typeof payload?.suggestedName === 'string' && payload.suggestedName.trim() !== ''
          ? path.basename(payload.suggestedName)
          : 'mise-en-page.filarrlayout';
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      if (!win) return { success: false, error: 'no-window' };
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: suggested,
        filters: LAYOUT_FILE_FILTERS,
      });
      if (canceled || !filePath) return { success: false, canceled: true };
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      log.error('[layouts:exportFile] failed:', (err as Error).message);
      return { success: false, error: 'write-failed' };
    }
  }
);

/**
 * Lit un `.filarrlayout` — celui qu'on choisit, ou celui dont on connaît déjà
 * le chemin (double-clic dans l'explorateur).
 *
 * L'extension est vérifiée même sur un chemin fourni : le renderer ne fabrique
 * ces chemins qu'à partir de ce que le principal lui a envoyé, mais un canal
 * `invoke` reste une surface d'appel, et rien ici ne doit pouvoir servir à lire
 * un fichier arbitraire du disque.
 */
ipcMain.handle(
  'layouts:importFile',
  async (_event: IpcMainInvokeEvent, payload?: { path?: unknown }) => {
    try {
      let filePath = typeof payload?.path === 'string' ? path.resolve(payload.path) : null;
      if (filePath === null) {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;
        if (!win) return { success: false, error: 'no-window' };
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
          filters: LAYOUT_FILE_FILTERS,
          properties: ['openFile'],
        });
        if (canceled || !filePaths[0]) return { success: false, canceled: true };
        filePath = filePaths[0];
      }
      if (!filePath.toLowerCase().endsWith('.filarrlayout')) {
        return { success: false, error: 'bad-extension' };
      }
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return { success: false, error: 'not-a-file' };
      if (stat.size > LAYOUT_FILE_MAX_BYTES) return { success: false, error: 'too-large' };
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, content, fileName: path.basename(filePath) };
    } catch (err) {
      log.error('[layouts:importFile] failed:', (err as Error).message);
      return { success: false, error: 'read-failed' };
    }
  }
);

/**
 * Récupère (et consomme) un modèle double-cliqué avant que l'écran d'accueil ne
 * soit monté. Voir `forwardLayoutFileOpen` : sur un démarrage à froid,
 * l'événement partirait vers un renderer qui n'écoute pas encore.
 */
ipcMain.handle('layouts:takePendingOpen', async () => {
  const pending = pendingLayoutOpenPath;
  pendingLayoutOpenPath = null;
  if (!pending) return null;
  try {
    const stat = await fs.stat(pending);
    if (!stat.isFile() || stat.size > LAYOUT_FILE_MAX_BYTES) return null;
    const content = await fs.readFile(pending, 'utf-8');
    return { content, fileName: path.basename(pending) };
  } catch {
    return null;
  }
});

// ==================== Generic File Open Dialog ====================

ipcMain.handle(
  'dialog:openFile',
  async (
    _event: IpcMainInvokeEvent,
    options: { filters?: { name: string; extensions: string[] }[] }
  ) => {
    try {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: options?.filters,
      });
      if (result.canceled || !result.filePaths.length) return null;
      const filePath = result.filePaths[0];
      const content = await fs.readFile(filePath, 'utf-8');
      const fileName = path.basename(filePath);
      return { fileName, content, filePath };
    } catch (error) {
      console.error('[IPC] Error in dialog:openFile:', error);
      return null;
    }
  }
);

// ==================== External Import Helpers ====================

/**
 * Security: whitelist of paths the user has explicitly approved via a native
 * dialog. `import:readFile` and `import:readDirectory` refuse any path not
 * under one of these roots — prevents a compromised renderer (XSS) from
 * reading arbitrary files like ~/.ssh/id_rsa or %APPDATA%\<anything>.
 */
const approvedImportPaths = new Set<string>();

/** Returns true if targetPath is `root` itself or a descendant of `root`. */
function isPathInside(targetPath: string, root: string): boolean {
  const normTarget = path.resolve(targetPath);
  const normRoot = path.resolve(root);
  if (normTarget === normRoot) return true;
  const rel = path.relative(normRoot, normTarget);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isApprovedPath(candidate: string): boolean {
  for (const approved of approvedImportPaths) {
    if (isPathInside(candidate, approved)) return true;
  }
  return false;
}

ipcMain.handle('import:selectDirectory', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    approvedImportPaths.add(path.resolve(result.filePaths[0]));
    return result.filePaths[0];
  } catch (error) {
    console.error('[IPC] Error in import:selectDirectory:', error);
    return null;
  }
});

ipcMain.handle(
  'import:selectFile',
  async (
    _event: IpcMainInvokeEvent,
    options: {
      filters?: { name: string; extensions: string[] }[];
    }
  ) => {
    try {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: options?.filters,
      });
      if (result.canceled || !result.filePaths[0]) return null;
      approvedImportPaths.add(path.resolve(result.filePaths[0]));
      return result.filePaths[0];
    } catch (error) {
      console.error('[IPC] Error in import:selectFile:', error);
      return null;
    }
  }
);

const IMPORT_SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.DS_Store']);
const IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Extensions the renderer is allowed to ask for. A caller may narrow this set
 * (Obsidian only wants `.md`) but never widen it — otherwise a compromised
 * renderer could ask for `.env`/`.pem` inside a directory the user approved
 * for an unrelated reason.
 */
const IMPORT_TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.htm',
  '.css',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
]);
const IMPORT_BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.pdf',
]);

/**
 * Cap for the one-shot reader, which holds every file's CONTENT in memory and
 * ships it across IPC in a single message. Deliberately conservative.
 */
const IMPORT_MAX_ENTRIES = 20_000;
/**
 * Cap for the streaming lister. It only collects PATHS (tens of bytes each),
 * so it can be an order of magnitude higher than the one-shot reader without
 * any memory risk — a 200k-file vault lists in a few MB.
 */
const IMPORT_MAX_FILES = 200_000;
/** Upper bound on a single `import:readBatch` request. */
const IMPORT_MAX_BATCH = 2_000;

/**
 * Intersect a caller-supplied extension list with the allowlist above.
 * Returns the full allowlist when the caller does not narrow it.
 */
function resolveImportExtensions(requested?: unknown): Set<string> {
  const allowed = new Set([...IMPORT_TEXT_EXTENSIONS, ...IMPORT_BINARY_EXTENSIONS]);
  if (!Array.isArray(requested) || requested.length === 0) return allowed;
  const narrowed = new Set<string>();
  for (const raw of requested) {
    if (typeof raw !== 'string') continue;
    const ext = (raw.startsWith('.') ? raw : `.${raw}`).toLowerCase();
    if (allowed.has(ext)) narrowed.add(ext);
  }
  return narrowed.size > 0 ? narrowed : allowed;
}

interface ImportWalkResult {
  files: string[];
  truncated: boolean;
  oversized: number;
}

/**
 * Walk an approved directory and collect matching file paths — no content.
 * This is what makes a large-vault import possible: the walk stays flat in
 * memory regardless of how many gigabytes of notes and attachments sit below.
 */
async function walkImportPaths(
  rootResolved: string,
  wanted: Set<string>
): Promise<ImportWalkResult> {
  const files: string[] = [];
  let truncated = false;
  let oversized = 0;

  async function walk(dir: string, prefix: string): Promise<void> {
    if (files.length >= IMPORT_MAX_FILES) {
      truncated = true;
      return;
    }
    let items: Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip rather than abort the whole walk
    }
    for (const item of items) {
      if (files.length >= IMPORT_MAX_FILES) {
        truncated = true;
        return;
      }
      if (IMPORT_SKIP_DIRS.has(item.name)) continue;
      const fullPath = path.join(dir, item.name);

      // Reject symlinks — prevents escape via crafted link to /etc/passwd
      try {
        const lstat = await fs.lstat(fullPath);
        if (lstat.isSymbolicLink()) continue;
      } catch {
        continue;
      }

      // Defense-in-depth: ensure fullPath did not escape the approved root
      if (!isPathInside(fullPath, rootResolved)) continue;

      const relPath = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.isDirectory()) {
        await walk(fullPath, relPath);
        continue;
      }
      if (!wanted.has(path.extname(item.name).toLowerCase())) continue;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > IMPORT_MAX_FILE_SIZE) {
          oversized++;
          continue;
        }
      } catch {
        continue;
      }
      files.push(relPath);
    }
  }

  await walk(rootResolved, '');
  return { files, truncated, oversized };
}

/**
 * Phase 1 of a streaming import: enumerate the files worth reading.
 *
 * Returning paths instead of content is what keeps a 20k-note vault from
 * pinning gigabytes in both processes at once. `truncated` is reported so the
 * renderer can TELL THE USER what was left out instead of presenting a
 * partial import as a complete one.
 */
ipcMain.handle(
  'import:listFiles',
  async (
    _event: IpcMainInvokeEvent,
    options: {
      dirPath: string;
      extensions?: string[];
    }
  ) => {
    const dirPath = options?.dirPath;
    try {
      // Security: refuse paths not approved via import:selectDirectory
      if (typeof dirPath !== 'string' || !isApprovedPath(dirPath)) {
        log.warn(`[import:listFiles] Refused unapproved path: ${String(dirPath).slice(0, 120)}`);
        return { files: [], truncated: false, oversized: 0 };
      }
      const result = await walkImportPaths(
        path.resolve(dirPath),
        resolveImportExtensions(options?.extensions)
      );
      log.info(
        `[import:listFiles] ${result.files.length} file(s) matched` +
          `${result.truncated ? ` — TRUNCATED at the ${IMPORT_MAX_FILES} cap` : ''}` +
          `${result.oversized > 0 ? `, ${result.oversized} over the ${IMPORT_MAX_FILE_SIZE} byte limit` : ''}`
      );
      return result;
    } catch (error) {
      log.error('[IPC] Error in import:listFiles:', error);
      return { files: [], truncated: false, oversized: 0 };
    }
  }
);

/**
 * Phase 2 of a streaming import: read one batch of the listed files.
 *
 * The renderer parses each batch and drops the raw strings before asking for
 * the next, so peak memory tracks the batch size, not the vault size.
 */
ipcMain.handle(
  'import:readBatch',
  async (
    _event: IpcMainInvokeEvent,
    options: {
      dirPath: string;
      relativePaths: string[];
    }
  ) => {
    const dirPath = options?.dirPath;
    try {
      if (typeof dirPath !== 'string' || !isApprovedPath(dirPath)) {
        log.warn(`[import:readBatch] Refused unapproved path: ${String(dirPath).slice(0, 120)}`);
        return [];
      }
      const relativePaths = Array.isArray(options?.relativePaths) ? options.relativePaths : [];
      if (relativePaths.length > IMPORT_MAX_BATCH) {
        log.warn(`[import:readBatch] Refused oversized batch of ${relativePaths.length}`);
        return [];
      }

      const rootResolved = path.resolve(dirPath);
      const entries: { relativePath: string; content: string; isDirectory: boolean }[] = [];

      for (const relPath of relativePaths) {
        if (typeof relPath !== 'string' || !relPath) continue;
        const fullPath = path.resolve(rootResolved, relPath);
        // Re-validate every path: the renderer supplies these, and a crafted
        // `../../` must not walk out of the directory the user approved.
        if (!isPathInside(fullPath, rootResolved)) continue;

        const ext = path.extname(fullPath).toLowerCase();
        const isText = IMPORT_TEXT_EXTENSIONS.has(ext);
        if (!isText && !IMPORT_BINARY_EXTENSIONS.has(ext)) continue;

        try {
          // lstat, not stat: a symlink reports isFile() === false here, so this
          // doubles as the symlink rejection.
          const lstat = await fs.lstat(fullPath);
          if (!lstat.isFile() || lstat.size > IMPORT_MAX_FILE_SIZE) continue;
        } catch {
          continue;
        }

        try {
          const content = isText
            ? await fs.readFile(fullPath, 'utf-8')
            : `data:base64,${(await fs.readFile(fullPath)).toString('base64')}`;
          entries.push({ relativePath: relPath, content, isDirectory: false });
        } catch {
          // Unreadable file (locked, permissions) — skip it rather than fail the batch
        }
      }

      return entries;
    } catch (error) {
      log.error('[IPC] Error in import:readBatch:', error);
      return [];
    }
  }
);

/**
 * One-shot directory read: walks and returns every file's content in a single
 * IPC message.
 *
 * Superseded by `import:listFiles` + `import:readBatch` for anything that may
 * be large — this handler's peak memory is the whole directory, twice (once
 * built here, once cloned into the renderer). Kept for small directories and
 * for callers that have not migrated. Pass `extensions` to avoid paying for
 * content you are going to discard.
 */
ipcMain.handle(
  'import:readDirectory',
  async (
    _event: IpcMainInvokeEvent,
    arg:
      | string
      | {
          dirPath: string;
          extensions?: string[];
        }
  ) => {
    const dirPath = typeof arg === 'string' ? arg : arg?.dirPath;
    const extensions = typeof arg === 'string' ? undefined : arg?.extensions;
    try {
      // Security: refuse paths not approved via import:selectDirectory
      if (typeof dirPath !== 'string' || !isApprovedPath(dirPath)) {
        log.warn(
          `[import:readDirectory] Refused unapproved path: ${String(dirPath).slice(0, 120)}`
        );
        return [];
      }

      const rootResolved = path.resolve(dirPath);
      const wanted = resolveImportExtensions(extensions);
      const { files, oversized } = await walkImportPaths(rootResolved, wanted);

      const capped = files.slice(0, IMPORT_MAX_ENTRIES);
      if (files.length > IMPORT_MAX_ENTRIES) {
        log.warn(
          `[import:readDirectory] TRUNCATED: ${files.length} files matched but only ` +
            `${IMPORT_MAX_ENTRIES} were read. Use import:listFiles + import:readBatch instead.`
        );
      }

      const entries: { relativePath: string; content: string; isDirectory: boolean }[] = [];
      for (const relPath of capped) {
        const fullPath = path.join(rootResolved, relPath);
        const ext = path.extname(relPath).toLowerCase();
        try {
          const content = IMPORT_TEXT_EXTENSIONS.has(ext)
            ? await fs.readFile(fullPath, 'utf-8')
            : `data:base64,${(await fs.readFile(fullPath)).toString('base64')}`;
          entries.push({ relativePath: relPath, content, isDirectory: false });
        } catch {
          continue;
        }
      }

      log.info(
        `[import:readDirectory] Read ${entries.length}/${files.length} file(s)` +
          `${oversized > 0 ? `, ${oversized} skipped for size` : ''}`
      );
      return entries;
    } catch (error) {
      log.error('[IPC] Error in import:readDirectory:', error);
      return [];
    }
  }
);

ipcMain.handle('import:readFile', async (_event: IpcMainInvokeEvent, filePath: string) => {
  try {
    // Security: only accept paths the user approved via a native dialog
    if (typeof filePath !== 'string' || !isApprovedPath(filePath)) {
      log.warn(`[import:readFile] Refused unapproved path: ${String(filePath).slice(0, 120)}`);
      return null;
    }
    // Reject symlinks — prevents reading linked target outside approved scope
    try {
      const lstat = await fs.lstat(filePath);
      if (lstat.isSymbolicLink()) return null;
    } catch {
      return null;
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return { content, fileName: path.basename(filePath) };
  } catch (error) {
    console.error('[IPC] Error in import:readFile:', error);
    return null;
  }
});

// ==================== SSRF Protection ====================

/**
 * Block requests to private/internal networks to prevent SSRF attacks.
 * The renderer must not be able to use the main process as a proxy to internal services.
 */
function isPrivateOrReservedUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      return true;
    }

    // Block cloud metadata endpoints (AWS, GCP, Azure)
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
      return true;
    }

    // Block private IP ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 0) return true; // 0.0.0.0/8
    }

    return false;
  } catch {
    return true; // Block malformed URLs
  }
}

// ==================== AUTO LINK TITLE (fetch page title bypassing CORS) ====================

ipcMain.handle('fetchPageTitle', async (_event: IpcMainInvokeEvent, url: string) => {
  try {
    if (!url || !/^https?:\/\//.test(url)) return null;
    if (isPrivateOrReservedUrl(url)) {
      log.warn('[fetchPageTitle] Blocked SSRF attempt to private URL:', url);
      return null;
    }
    const response = await net.fetch(url, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Filarr/1.0' },
    });
    if (!response.ok) return null;
    // Only read first 50KB to avoid downloading huge pages
    const reader = response.body?.getReader();
    if (!reader) return null;
    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 50000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      // Check if we already have the title
      const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (match) {
        reader.cancel();
        return match[1].trim();
      }
    }
    reader.cancel();
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : null;
  } catch (error) {
    console.error('[IPC] fetchPageTitle error:', error);
    return null;
  }
});

// ==================== BOOKMARK METADATA (fetch OG tags bypassing CORS) ====================

ipcMain.handle('fetchPageMetadata', async (_event: IpcMainInvokeEvent, url: string) => {
  try {
    if (!url || !/^https?:\/\//.test(url)) return null;
    if (isPrivateOrReservedUrl(url)) {
      log.warn('[fetchPageMetadata] Blocked SSRF attempt to private URL:', url);
      return null;
    }
    const response = await net.fetch(url, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Filarr/1.0' },
    });
    if (!response.ok) return null;

    // Read first 100KB to find meta tags
    const reader = response.body?.getReader();
    if (!reader) return null;
    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 100000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel();

    // Parse metadata with regex (no DOM parser in main process)
    const getMetaContent = (property: string): string => {
      // Try property="..." first (OG), then name="..." (standard)
      const re1 = new RegExp(
        `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
        'i'
      );
      const re2 = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
        'i'
      );
      const re3 = new RegExp(
        `<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`,
        'i'
      );
      const re4 = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`,
        'i'
      );
      return (
        re1.exec(html)?.[1] ||
        re2.exec(html)?.[1] ||
        re3.exec(html)?.[1] ||
        re4.exec(html)?.[1] ||
        ''
      ).trim();
    };

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const ogTitle = getMetaContent('og:title');
    const ogDesc = getMetaContent('og:description');
    const ogImage = getMetaContent('og:image');
    const metaDesc = getMetaContent('description');

    // Favicon: look for <link rel="icon" href="...">
    const faviconMatch =
      html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i) ||
      html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i);

    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;

    // Resolve relative URLs
    const resolveUrl = (relative: string): string => {
      if (!relative) return '';
      try {
        return new URL(relative, url).href;
      } catch {
        return relative;
      }
    };

    // Proxy images as data URIs to avoid CSP issues
    const fetchAsDataUri = async (imgUrl: string): Promise<string> => {
      if (!imgUrl) return '';
      if (isPrivateOrReservedUrl(imgUrl)) return '';
      try {
        const imgResp = await net.fetch(imgUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 Filarr/1.0' },
        });
        if (!imgResp.ok) return '';
        const contentType = imgResp.headers.get('content-type') || 'image/png';
        const buffer = await imgResp.arrayBuffer();
        if (buffer.byteLength > 2 * 1024 * 1024) return ''; // Skip images > 2MB
        const base64 = Buffer.from(buffer).toString('base64');
        return `data:${contentType};base64,${base64}`;
      } catch {
        return '';
      }
    };

    const resolvedImage = resolveUrl(ogImage);
    const resolvedFavicon = faviconMatch
      ? resolveUrl(faviconMatch[1])
      : `${parsedUrl.origin}/favicon.ico`;

    // Fetch both images in parallel
    const [imageDataUri, faviconDataUri] = await Promise.all([
      fetchAsDataUri(resolvedImage),
      fetchAsDataUri(resolvedFavicon),
    ]);

    return {
      title: ogTitle || titleTag,
      description: ogDesc || metaDesc,
      image: imageDataUri,
      favicon: faviconDataUri,
      domain,
    };
  } catch (error) {
    console.error('[IPC] fetchPageMetadata error:', error);
    return null;
  }
});

// ============ CONNECTEURS DE BASES INLINE (appel amont DIRECT) ============
//
// Confidentialité : le desktop parle à l'API amont sans aucun tiers dans la
// boucle — pas de passage par nos serveurs (le client web, lui, doit passer par
// POST /meta/lookup, sa CSP épinglant connect-src à api.filarr.com).
//
// Garde anti-SSRF : le renderer n'envoie PAS d'URL. Il envoie
// { source, query, apiKey?, lang? } et buildConnectorRequest — liste blanche
// partagée, cf. electron/connectors/connectorSourcesCore.ts — fabrique seul
// l'appel. Aucune URL arbitraire n'est proxifiable par ce canal.
//
// Contrat d'échec : null, jamais un throw (miroir de fetchPageMetadata). Ni la
// requête ni la clé d'API ne sont journalisées.

ipcMain.handle('connectors:lookup', async (_event: IpcMainInvokeEvent, input: unknown) => {
  const built = buildConnectorRequest(input);
  if (!built.ok) {
    log.warn('[connectors:lookup] Rejected request:', built.error);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTOR_TIMEOUT_MS);
  try {
    const response = await net.fetch(built.request.url, {
      method: built.request.method,
      headers: built.request.headers,
      body: built.request.body,
      signal: controller.signal,
      // Aucune redirection légitime attendue des quatre amonts : plutôt que de
      // suivre un saut sans le re-valider (ce que fait le Worker à la main), on
      // échoue. Un 3xx amont devient un simple « recherche impossible ».
      redirect: 'error',
    });
    if (!response.ok) return null;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('json')) return null;

    // Lecture bornée : une réponse démesurée est abandonnée plutôt que bufferisée.
    const reader = response.body?.getReader();
    if (!reader) return null;
    let text = '';
    let bytes = 0;
    let truncated = false;
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CONNECTOR_MAX_RESPONSE_BYTES) {
        truncated = true;
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    if (truncated) return null;

    // JSON amont BRUT : la normalisation vit côté renderer, partagée avec le web.
    return JSON.parse(text) as unknown;
  } catch {
    // Message générique : ni l'URL construite, ni la requête, ni la clé.
    log.warn('[connectors:lookup] Upstream call failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
});

// ==================== EXPORT IPC HANDLERS ====================

ipcMain.handle('export:gdprData', async (_event: IpcMainInvokeEvent, jsonData: string) => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) throw new Error('No window available');

    const result = await dialog.showSaveDialog(win, {
      defaultPath: `filarr-gdpr-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) return null;

    await fs.writeFile(result.filePath, jsonData, 'utf-8');
    return result.filePath;
  } catch (error) {
    console.error('[IPC] Error in export:gdprData:', error);
    throw error;
  }
});

// ==================== ARGON2 IPC HANDLERS ====================
// (imports for argon2Service / extensionBridge hoisted to the top of
//  the file — see comment near the top imports for the TDZ rationale.)

ipcMain.handle(
  'crypto:argon2Hash',
  async (_event: IpcMainInvokeEvent, password: string, salt?: string) => {
    try {
      return await argon2Hash(password, salt);
    } catch (error) {
      console.error('[IPC] Error in crypto:argon2Hash:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'crypto:argon2Verify',
  async (_event: IpcMainInvokeEvent, hash: string, password: string) => {
    try {
      return await argon2Verify(hash, password);
    } catch (error) {
      console.error('[IPC] Error in crypto:argon2Verify:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'crypto:argon2DeriveKey',
  async (_event: IpcMainInvokeEvent, password: string, salt: string) => {
    try {
      return await argon2DeriveKey(password, salt);
    } catch (error) {
      console.error('[IPC] Error in crypto:argon2DeriveKey:', error);
      throw error;
    }
  }
);

/**
 * Dérivation BRUTE à profil explicite — la KEK de la clé de garde du compte.
 *
 * Distinct de `crypto:argon2DeriveKey`, dont le profil est celui du PIN local
 * et n'est pas dit dans l'appel : la garde doit reproduire octet pour octet
 * celui du site et du mobile. Cf. `argon2RawDerive`.
 *
 * Ne JETTE PAS — l'échec est une valeur. Une exception traversant l'IPC arrive
 * au renderer sous la forme d'un `Error: Error invoking remote method …`
 * illisible, et le seul appelant (l'écran de déverrouillage) a besoin de
 * distinguer « paramètres refusés » de « mauvaise phrase », ce qu'un message
 * enveloppé rend impossible.
 */
ipcMain.handle(
  'crypto:argon2Raw',
  async (_event: IpcMainInvokeEvent, req: Argon2RawRequest) => {
    try {
      return { success: true, data: await argon2RawDerive(req) };
    } catch (error) {
      // Le mot de passe NE DOIT PAS atterrir dans le journal : on ne consigne
      // que le motif, jamais l'entrée.
      const message = error instanceof Error ? error.message : 'ARGON2_FAILED';
      console.error('[IPC] Error in crypto:argon2Raw:', message);
      return { success: false, error: message };
    }
  }
);

// ==================== CLÉ DE GARDE DU COMPTE ====================
//
// Le pont vers `custodyService`. Rien n'est déchiffré ici : le principal relaie
// les routes (il tient le jeton porteur) et range, sur demande explicite, la
// privée derrière `safeStorage`. Voir l'en-tête de custodyService.ts.

ipcMain.handle('custody:key', async () => {
  return custodyService.getCustodyKeyMaterial();
});

ipcMain.handle('custody:shareLabels', async () => {
  return custodyService.listShareLabels();
});

ipcMain.handle(
  'custody:setLabel',
  async (
    _event: IpcMainInvokeEvent,
    kind: custodyService.ShareKind,
    shareId: string,
    wrappedLabel: string | null
  ) => {
    return custodyService.setShareLabel(
      kind === 'request' ? 'request' : 'send',
      String(shareId),
      typeof wrappedLabel === 'string' && wrappedLabel.length > 0 ? wrappedLabel : null
    );
  }
);

ipcMain.handle(
  'custody:remember',
  async (
    _event: IpcMainInvokeEvent,
    input: { custodyPublicKey: string; privateKeyBase64: string; ttlMs?: number }
  ) => {
    return { success: true, data: await custodyService.rememberCustody(input) };
  }
);

ipcMain.handle('custody:recall', async (_event: IpcMainInvokeEvent, custodyPublicKey: string) => {
  return { success: true, data: await custodyService.recallCustody(String(custodyPublicKey)) };
});

ipcMain.handle('custody:rememberStatus', async () => {
  return { success: true, data: await custodyService.rememberedCustodyStatus() };
});

ipcMain.handle('custody:forget', async () => {
  await custodyService.clearRememberedCustody();
  return { success: true };
});

// --- bcrypt password hashing for file/folder protection ---
import bcryptjs from 'bcryptjs';

ipcMain.handle('crypto:hashPassword', async (_event: IpcMainInvokeEvent, password: string) => {
  return bcryptjs.hash(password, 12);
});

ipcMain.handle(
  'crypto:verifyPassword',
  async (_event: IpcMainInvokeEvent, password: string, hash: string) => {
    return bcryptjs.compare(password, hash);
  }
);

// ============================================
// SECURE PASSWORD HASH STORE (file/folder passwords)
// Stores password hashes encrypted via StorageService instead of localStorage
// ============================================

const PASSWORD_HASHES_FILE = 'password_hashes.enc';

ipcMain.handle('secureStore:getPasswordHashes', async () => {
  try {
    const filePath = path.join(StorageService.getBaseDir(), PASSWORD_HASHES_FILE);
    const data = await fs.readFile(filePath, 'utf8').catch(() => null);
    if (!data) return {};
    return await StorageService.decrypt(data);
  } catch (error) {
    console.error('[IPC] Error in secureStore:getPasswordHashes:', error);
    return {};
  }
});

ipcMain.handle(
  'secureStore:setPasswordHashes',
  async (_event: IpcMainInvokeEvent, hashes: Record<string, any>) => {
    try {
      const filePath = path.join(StorageService.getBaseDir(), PASSWORD_HASHES_FILE);
      const encrypted = await StorageService.encrypt(hashes);
      await fs.writeFile(filePath, encrypted, 'utf8');
      return true;
    } catch (error) {
      console.error('[IPC] Error in secureStore:setPasswordHashes:', error);
      throw error;
    }
  }
);

// ============================================
// EXTENSION BRIDGE IPC HANDLERS
// TODO: Enable in v2.x when Password Manager is shipped
// ============================================

if (EXTENSION_BRIDGE_ENABLED) {
  ipcMain.handle('extension:getStatus', async () => {
    try {
      return {
        running: extensionBridge.isRunning(),
        port: extensionBridge.getPort(),
        connectedClients: extensionBridge.getConnectedClientCount(),
        pairedClients: extensionBridge.getPairedClients(),
      };
    } catch (error) {
      console.error('[IPC] Error in extension:getStatus:', error);
      throw error;
    }
  });

  ipcMain.handle('extension:generatePairingCode', async () => {
    try {
      const code = extensionBridge.generatePairingCode();
      return { code };
    } catch (error) {
      console.error('[IPC] Error in extension:generatePairingCode:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'extension:removePairedClient',
    async (_event: IpcMainInvokeEvent, clientId: string) => {
      try {
        const removed = extensionBridge.removePairedClient(clientId);
        return { success: removed };
      } catch (error) {
        console.error('[IPC] Error in extension:removePairedClient:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('extension:setPort', async (_event: IpcMainInvokeEvent, port: number) => {
    try {
      extensionBridge.setPort(port);
      return { success: true, port: extensionBridge.getPort() };
    } catch (error) {
      console.error('[IPC] Error in extension:setPort:', error);
      throw error;
    }
  });
}

// ============================================
// DESKTOP NOTIFICATION IPC HANDLER
// ============================================

ipcMain.handle(
  'showDesktopNotification',
  async (_event: IpcMainInvokeEvent, payload: { title: string; body?: string }) => {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: payload.title,
          body: payload.body || '',
          icon: app.isPackaged
            ? path.join(process.resourcesPath, 'src', 'public', 'icon.png')
            : path.join(__dirname, '..', 'public', 'icon.png'),
        });
        notification.show();
        return { success: true };
      }
      return { success: false, reason: 'Notifications not supported' };
    } catch (error) {
      console.error('[IPC] Error in showDesktopNotification:', error);
      throw error;
    }
  }
);

// ============================================
// BYOS (Bring Your Own Storage) IPC HANDLERS
// ============================================
// (credentialStore import hoisted to the top — see TDZ note there.)

const BYOS_PROVIDERS_FILE = 'byos-providers.json';

function getByosProvidersPath(): string {
  return path.join(getActiveProfileDataDir(), BYOS_PROVIDERS_FILE);
}

async function loadByosProviders(): Promise<any[]> {
  const filePath = getByosProvidersPath();
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveByosProviders(providers: any[]): Promise<void> {
  const filePath = getByosProvidersPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(providers, null, 2), 'utf-8');
}

ipcMain.handle('byos:getProviders', async () => {
  try {
    return await loadByosProviders();
  } catch (error) {
    console.error('[IPC] Error in byos:getProviders:', error);
    throw error;
  }
});

ipcMain.handle('byos:saveProvider', async (_event: IpcMainInvokeEvent, request: any) => {
  try {
    const { secretAccessKey, ...config } = request;
    const providers = await loadByosProviders();

    // Generate ID if new provider
    const providerId =
      config.id || `byos-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const provider = {
      ...config,
      id: providerId,
      isDefault: providers.length === 0,
      createdAt: new Date().toISOString(),
    };

    // Store secret in credential store
    await credentialStore.saveCredential(providerId, secretAccessKey);

    // Save provider config (without secret)
    const idx = providers.findIndex((p: any) => p.id === providerId);
    if (idx >= 0) {
      providers[idx] = { ...providers[idx], ...provider };
    } else {
      providers.push(provider);
    }
    await saveByosProviders(providers);

    return provider;
  } catch (error) {
    console.error('[IPC] Error in byos:saveProvider:', error);
    throw error;
  }
});

ipcMain.handle('byos:deleteProvider', async (_event: IpcMainInvokeEvent, providerId: string) => {
  try {
    let providers = await loadByosProviders();
    providers = providers.filter((p: any) => p.id !== providerId);
    await saveByosProviders(providers);
    await credentialStore.deleteCredential(providerId);
    return { success: true };
  } catch (error) {
    console.error('[IPC] Error in byos:deleteProvider:', error);
    throw error;
  }
});

ipcMain.handle('byos:testConnection', async (_event: IpcMainInvokeEvent, providerId: string) => {
  try {
    const providers = await loadByosProviders();
    const provider = providers.find((p: any) => p.id === providerId);
    if (!provider) throw new Error('Provider not found');

    // Verify credential exists
    await credentialStore.getCredential(providerId);

    // Basic HTTP connectivity test to the endpoint
    const endpoint = provider.endpoint || `https://s3.${provider.region}.amazonaws.com`;
    const start = Date.now();
    const response = await net.fetch(endpoint, { method: 'HEAD' });
    const latencyMs = Date.now() - start;

    // Any response (even 403) means the endpoint is reachable
    // Update testedAt
    const idx = providers.findIndex((p: any) => p.id === providerId);
    if (idx >= 0) {
      providers[idx].testedAt = new Date().toISOString();
      await saveByosProviders(providers);
    }

    return {
      success: true,
      message: `Endpoint reachable (${latencyMs}ms, HTTP ${response.status})`,
      latencyMs,
    };
  } catch (error: any) {
    return { success: false, message: error.message || 'Connection failed' };
  }
});

// ─── BYOS File Operations ────────────────────────────────────────────────────

async function getByosS3Client(providerId: string): Promise<{
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}> {
  const providers = await loadByosProviders();
  const provider = providers.find((p: any) => p.id === providerId);
  if (!provider) throw new Error(`BYOS provider "${providerId}" not found`);

  const secretAccessKey = await credentialStore.getCredential(providerId);
  if (!secretAccessKey) throw new Error(`No credentials found for provider "${providerId}"`);

  return {
    endpoint: provider.endpoint || `https://s3.${provider.region || 'us-east-1'}.amazonaws.com`,
    bucket: provider.bucket,
    region: provider.region || 'us-east-1',
    accessKeyId: provider.accessKeyId,
    secretAccessKey,
  };
}

function buildS3Headers(contentType?: string): Record<string, string> {
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const headers: Record<string, string> = {
    'x-amz-date': dateStamp,
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  return headers;
}

ipcMain.handle(
  'byos:upload',
  async (
    _event: IpcMainInvokeEvent,
    request: {
      providerId: string;
      key: string;
      filePath: string;
      contentType?: string;
    }
  ) => {
    try {
      const config = await getByosS3Client(request.providerId);
      const fileBuffer = await fs.readFile(request.filePath);
      const url = `${config.endpoint}/${config.bucket}/${encodeURIComponent(request.key)}`;
      const headers = buildS3Headers(request.contentType);

      const response = await net.fetch(url, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Length': String(fileBuffer.byteLength),
        },
        body: fileBuffer,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`S3 upload failed (HTTP ${response.status}): ${body}`);
      }

      return { success: true, key: request.key, size: fileBuffer.byteLength };
    } catch (error: any) {
      console.error('[IPC] Error in byos:upload:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'byos:download',
  async (
    _event: IpcMainInvokeEvent,
    request: {
      providerId: string;
      key: string;
      destPath: string;
    }
  ) => {
    try {
      const config = await getByosS3Client(request.providerId);
      const url = `${config.endpoint}/${config.bucket}/${encodeURIComponent(request.key)}`;
      const headers = buildS3Headers();

      const response = await net.fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`S3 download failed (HTTP ${response.status})`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const destDir = path.dirname(request.destPath);
      await fs.mkdir(destDir, { recursive: true });
      await fs.writeFile(request.destPath, Buffer.from(arrayBuffer));

      return { success: true, key: request.key, size: arrayBuffer.byteLength };
    } catch (error: any) {
      console.error('[IPC] Error in byos:download:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'byos:delete',
  async (
    _event: IpcMainInvokeEvent,
    request: {
      providerId: string;
      key: string;
    }
  ) => {
    try {
      const config = await getByosS3Client(request.providerId);
      const url = `${config.endpoint}/${config.bucket}/${encodeURIComponent(request.key)}`;
      const headers = buildS3Headers();

      const response = await net.fetch(url, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`S3 delete failed (HTTP ${response.status})`);
      }

      return { success: true, key: request.key };
    } catch (error: any) {
      console.error('[IPC] Error in byos:delete:', error);
      throw error;
    }
  }
);

ipcMain.handle(
  'byos:list',
  async (
    _event: IpcMainInvokeEvent,
    request: {
      providerId: string;
      prefix?: string;
      maxKeys?: number;
    }
  ) => {
    try {
      const config = await getByosS3Client(request.providerId);
      const params = new URLSearchParams({ 'list-type': '2' });
      if (request.prefix) params.set('prefix', request.prefix);
      if (request.maxKeys) params.set('max-keys', String(request.maxKeys));

      const url = `${config.endpoint}/${config.bucket}?${params.toString()}`;
      const headers = buildS3Headers();

      const response = await net.fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`S3 list failed (HTTP ${response.status})`);
      }

      const xmlText = await response.text();

      // Parse XML response to extract keys
      const keys: Array<{ key: string; size: number; lastModified: string }> = [];
      const keyRegex = /<Key>([^<]+)<\/Key>/g;
      const sizeRegex = /<Size>(\d+)<\/Size>/g;
      const dateRegex = /<LastModified>([^<]+)<\/LastModified>/g;

      let keyMatch: RegExpExecArray | null;
      const sizes: number[] = [];
      const dates: string[] = [];

      let sizeMatch: RegExpExecArray | null;
      while ((sizeMatch = sizeRegex.exec(xmlText)) !== null) sizes.push(parseInt(sizeMatch[1], 10));
      let dateMatch: RegExpExecArray | null;
      while ((dateMatch = dateRegex.exec(xmlText)) !== null) dates.push(dateMatch[1]);

      let i = 0;
      while ((keyMatch = keyRegex.exec(xmlText)) !== null) {
        keys.push({
          key: keyMatch[1],
          size: sizes[i] || 0,
          lastModified: dates[i] || '',
        });
        i++;
      }

      return { success: true, keys };
    } catch (error: any) {
      console.error('[IPC] Error in byos:list:', error);
      throw error;
    }
  }
);
