import { app, BrowserWindow, ipcMain, shell, Notification, dialog, clipboard, nativeImage, IpcMainInvokeEvent, Tray, Menu, net, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import crypto from 'crypto';
import chokidar, { FSWatcher } from 'chokidar';
import StorageService from './storageService';
import profileManager from './profileManager';
import { migrateLegacyToDefaultProfile } from './profileMigration';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import * as noteVersionService from './noteVersionService';
import downloadsWatcherService, {
  DEFAULT_DOWNLOADS_WATCHER_CONFIG,
  DownloadsWatcherConfig,
} from './downloadsWatcherService';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env') });

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
  description: string;
  date: string;
  isRead?: boolean;
  isCompleted?: boolean;
  itemId?: string;
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

// ---- Window bounds persistence ----
interface WindowBounds { x: number; y: number; width: number; height: number; isMaximized: boolean }
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
  } catch { /* non-critical */ }
}
let notificationMessages: NotificationMessages | null = null;
let notificationSettings: NotificationSettings = {
  enabled: true,
  sound: true,
  delay: 15
};

// ==================== TEMP FILE CLEANUP ====================
// Tracks temp files and schedules deletion after a delay (default 5 min)
const TEMP_CLEANUP_DELAY_MS = 5 * 60 * 1000;
const tempCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleTempCleanup(tempPath: string, delayMs: number = TEMP_CLEANUP_DELAY_MS): void {
  // Cancel any existing timer for this path
  const existing = tempCleanupTimers.get(tempPath);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    try {
      await fs.unlink(tempPath);
    } catch { /* file may already be deleted */ }
    tempCleanupTimers.delete(tempPath);
  }, delayMs);

  tempCleanupTimers.set(tempPath, timer);
}

// Cleanup all remaining temp files on app quit
app.on('will-quit', async () => {
  for (const [tempPath, timer] of tempCleanupTimers) {
    clearTimeout(timer);
    try {
      await fs.unlink(tempPath);
    } catch { /* ignore */ }
  }
  tempCleanupTimers.clear();
});

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
function showNotification(title: string, body: string, _reminder: Reminder): void {
  if (!notificationSettings.enabled) return; // Don't show notification if disabled

  const notification = new Notification({
    title: `Filarr - ${title}`,
    body,
    silent: !notificationSettings.sound
  });

  notification.show();

  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.webContents.send('openNotificationsPage');
    }
  });
}

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
 * Check reminders
 */
async function checkReminders(): Promise<void> {
  try {
    // Skip if no active profile (e.g. after full reset)
    const manifest = profileManager.getManifest();
    if (!manifest.activeProfileId || manifest.profiles.length === 0) return;

    const reminders = await StorageService.getAllReminders();
    const now = new Date();
    const notificationThreshold = 30 * 60 * 1000; // 30 minutes in milliseconds

    const upcomingReminders = reminders.filter(reminder => {
      const reminderDate = new Date(reminder.date);
      const timeDifference = reminderDate.getTime() - now.getTime();
      // Check that reminder is not marked as completed
      return !reminder.isCompleted &&
             timeDifference > -notificationThreshold &&
             timeDifference <= notificationThreshold;
    });

    upcomingReminders.forEach(reminder => {
      const reminderDate = new Date(reminder.date);
      if (reminderDate > now) {
        showNotification(
          getRandomMessage('title'),
          reminder.description,
          reminder
        );
      } else {
        showNotification(
          getRandomMessage('missedReminder'),
          reminder.description,
          reminder
        );
      }
    });

    if (mainWindow) {
      mainWindow.webContents.send('upcomingReminders', upcomingReminders);
    }
  } catch (error) {
    console.error('Error checking reminders:', error);
  }
}

/**
 * Setup auto updater
 */
function setupAutoUpdater(): void {
  autoUpdater.logger = log;
  (autoUpdater.logger as typeof log).transports.file.level = 'info';

  // No hosted release channel is configured in the open-source build.
  // Forks should configure their own update endpoint via autoUpdater.setFeedURL.

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...');
  });

  autoUpdater.on('update-available', (info: any) => {
    log.info('Update available.', info);
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
 * Emit folders updated event
 */
function emitFoldersUpdated(): void {
  if (mainWindow) {
    mainWindow.webContents.send('foldersUpdated');
  }
}

/**
 * Create system tray icon with context menu
 */
function createTray(): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'public', 'favicon-64.png')
    : path.join(__dirname, '..', 'public', 'favicon-64.png');

  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Filarr',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Filarr');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: 'rgba(0,0,0,0)', symbolColor: '#888888', height: 40 } }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
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

  // Maximize if it was maximized when closed
  if (saved.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadURL(
    app.isPackaged
      ? `file://${path.join(__dirname, '../build/index.html')}`
      : 'http://localhost:3000'
  );

  // Security headers: Content Security Policy and other protections
  const connectSrcDev = 'http://localhost:3001 ws://localhost:3001 ws://127.0.0.1:28080';
  const connectSrcProd = '';
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
          " font-src 'self' data: blob: *;" +
          ` connect-src 'self' ${connectSrc} https://www.googleapis.com https://gmail.googleapis.com;` +
          " worker-src 'self' blob: https://cdnjs.cloudflare.com;" +
          " frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com;" +
          " object-src 'none';" +
          " base-uri 'self';" +
          " form-action 'self';" +
          " frame-ancestors 'none'"
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
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const allowedOrigins = ['file:', 'http://localhost:3000', 'http://localhost:3001'];
    if (!allowedOrigins.some(origin => navigationUrl.startsWith(origin)) && parsedUrl.protocol !== 'file:') {
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
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write', 'notifications'];
    callback(allowedPermissions.includes(permission));
  });

  // Deny permission check requests
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write', 'notifications'];
    return allowedPermissions.includes(permission);
  });

  // ─── End Security Hardening ─────────────────────────────────────

  mainWindow.on('ready-to-show', async () => {
    await loadNotificationMessages();
    checkReminders();
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
}

/**
 * Start application
 */
async function startApp(): Promise<void> {
  try {
    // Show window immediately so the user sees the app loading
    createWindow();
    createTray();

    // Initialize backend services in parallel with UI rendering
    const baseDir = path.join(app.getPath('userData'), 'FilarData');
    await fs.mkdir(baseDir, { recursive: true });

    // Initialize profile system BEFORE StorageService
    const manifest = await profileManager.initialize();

    // Legacy migration: move pre-profile data into a default profile
    if (!manifest.migratedFromLegacy && await profileManager.hasLegacyData()) {
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

    log.info(`Application started, version: ${app.getVersion()}, activeProfile: ${activeProfileId ?? 'none'}`);

    // Non-blocking: load settings and check for updates
    loadNotificationSettings().catch(() => {});
    setupAutoUpdater();
    // Delay first update check to let the renderer mount its IPC listeners
    setTimeout(checkForUpdates, 10_000);
    setInterval(checkForUpdates, 4 * 60 * 60 * 1000); // Check for updates every 4 hours
    setInterval(checkReminders, 60 * 60 * 1000); // Check every hour

    // Start extension bridge WebSocket server (disabled until Password Manager ships)
    if (EXTENSION_BRIDGE_ENABLED && mainWindow) {
      extensionBridge.setMainWindow(mainWindow);
      extensionBridge.start();
    }
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

// ─── Global Security Hardening ───────────────────────────────────
// Prevent new webContents from being created with insecure settings
app.on('web-contents-created', (_event, contents) => {
  // Disable navigation in all webContents
  contents.on('will-navigate', (event, navigationUrl) => {
    if (contents !== mainWindow?.webContents) {
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
  app.on('second-instance', () => {
    // Someone tried to launch a second instance — focus the existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
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

ipcMain.on('open-external', (_event, url: string) => {
  if (isSafeExternalUrl(url)) {
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
let enhancedLockCleanupDone = false;

app.on('before-quit', (event) => {
  isQuitting = true;

  // If we've already run cleanup, let this quit through.
  if (enhancedLockCleanupDone) return;

  // If there's no active profile, nothing to wipe — let the quit proceed.
  if (!activeProfileId) {
    enhancedLockCleanupDone = true;
    return;
  }

  // Block the quit and run the Enhanced Lock cleanup to completion.
  event.preventDefault();

  (async () => {
    try {
      const profileDir = profileManager.getProfileDataDir(activeProfileId!);
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
      // Mark done and re-trigger quit — this time `before-quit` runs again
      // but returns early because `enhancedLockCleanupDone === true`.
      enhancedLockCleanupDone = true;
      app.quit();
    }
  })();
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
          ? parsed.downloadsWatcher.extensionAllowList.filter(
              (e: unknown) => typeof e === 'string'
            )
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

// --- Profile Management ---

ipcMain.handle('profile:getManifest', async () => {
  try {
    return profileManager.getManifest();
  } catch (error) {
    console.error('Error in profile:getManifest:', error);
    throw error;
  }
});

ipcMain.handle('profile:create', async (_event: IpcMainInvokeEvent, params: { name: string; avatarColor: string; pin?: string; allowPinReset?: boolean }) => {
  try {
    return await profileManager.createProfile(params.name, params.avatarColor, params.pin, params.allowPinReset);
  } catch (error) {
    console.error('Error in profile:create:', error);
    throw error;
  }
});

ipcMain.handle('profile:update', async (_event: IpcMainInvokeEvent, profileId: string, updates: { name?: string; avatarColor?: string; avatarImage?: string | null; pin?: string | null; allowPinReset?: boolean }) => {
  try {
    return await profileManager.updateProfile(profileId, updates);
  } catch (error) {
    console.error('Error in profile:update:', error);
    throw error;
  }
});

ipcMain.handle('profile:delete', async (_event: IpcMainInvokeEvent, profileId: string) => {
  try {
    await profileManager.deleteProfile(profileId);
    // If we deleted the active profile, switch to the new active
    const manifest = profileManager.getManifest();
    if (activeProfileId === profileId && manifest.activeProfileId) {
      activeProfileId = manifest.activeProfileId;
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
      } catch { /* ignore if dir doesn't exist */ }
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

    // Stop the downloads watcher — the next profile may have its own config
    // (config is profile-scoped via appConfig.json).
    await downloadsWatcherService.stop();

    // Update last accessed + set as active in manifest
    await profileManager.updateLastAccessed(profileId);
    activeProfileId = profileId;

    // Drop in-memory snapshot dedup state so the new profile starts fresh
    // and we don't carry hashes from the previous profile's notes.
    noteVersionService.resetSnapshotState();

    // Re-initialize StorageService with the new profile's data directory
    const profileDataDir = profileManager.getProfileDataDir(profileId);
    log.info(`[profile:activate] baseDir now: ${profileDataDir}`);
    await StorageService.reinitialize(profileDataDir);

    // Notify renderer that folders changed (new profile = different data)
    emitFoldersUpdated();

    // Hydrate the downloads watcher from this profile's config and start it
    // if enabled. Done last so the renderer is ready to receive events.
    try {
      const watcherConfig = await loadDownloadsWatcherConfigFromDisk();
      await downloadsWatcherService.setConfig(watcherConfig);
    } catch (err) {
      log.warn('[profile:activate] downloads watcher hydration failed:', err);
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

ipcMain.handle('profile:verifyPin', async (_event: IpcMainInvokeEvent, profileId: string, pin: string) => {
  try {
    return await profileManager.verifyPin(profileId, pin);
  } catch (error) {
    console.error('Error in profile:verifyPin:', error);
    throw error;
  }
});

ipcMain.handle('profile:resetPin', async (_event: IpcMainInvokeEvent, profileId: string, confirmName: string) => {
  try {
    await profileManager.resetPin(profileId, confirmName);
    return { success: true };
  } catch (error) {
    console.error('Error in profile:resetPin:', error);
    throw error;
  }
});

// --- Hybrid Storage (local-first + cloud sync) ---

ipcMain.handle('hybrid:writeRawBlob', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string, data: number[] | Uint8Array | Buffer) => {
  try {
    const dir = path.join(StorageService.getBaseDir(), sanitizeFolderId(folderId));
    await fs.mkdir(dir, { recursive: true });
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
    await fs.writeFile(path.join(dir, sanitizePath(fileName)), buf);
  } catch (error) {
    console.error('Error in hybrid:writeRawBlob:', error);
    throw error;
  }
});

ipcMain.handle('hybrid:readRawBlob', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    const filePath = path.join(StorageService.getBaseDir(), sanitizeFolderId(folderId), sanitizePath(fileName));
    const data = await fs.readFile(filePath);
    return new Uint8Array(data);
  } catch (error) {
    console.error('Error in hybrid:readRawBlob:', error);
    throw error;
  }
});

ipcMain.handle('hybrid:fileExists', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    const filePath = path.join(StorageService.getBaseDir(), sanitizeFolderId(folderId), sanitizePath(fileName));
    return await fs.access(filePath).then(() => true).catch(() => false);
  } catch {
    return false;
  }
});

ipcMain.handle('hybrid:computeChecksum', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    const filePath = path.join(StorageService.getBaseDir(), sanitizeFolderId(folderId), sanitizePath(fileName));
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch (error) {
    console.error('Error in hybrid:computeChecksum:', error);
    throw error;
  }
});

ipcMain.handle('hybrid:deleteBlob', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    const filePath = path.join(StorageService.getBaseDir(), sanitizeFolderId(folderId), sanitizePath(fileName));
    await fs.unlink(filePath).catch(() => {});
  } catch (error) {
    console.error('Error in hybrid:deleteBlob:', error);
    throw error;
  }
});

ipcMain.handle('hybrid:saveWrappedKey', async (_event: IpcMainInvokeEvent, wrappedKeyData: Record<string, unknown>) => {
  try {
    const keyPath = path.join(StorageService.getBaseDir(), 'wrapped_fek.json');
    await fs.writeFile(keyPath, JSON.stringify(wrappedKeyData), { mode: 0o600 });
  } catch (error) {
    log.error('Error in hybrid:saveWrappedKey:', error);
    throw error;
  }
});

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

// --- Print Recovery Codes PDF ---

function generateRecoveryCodesHtml(words: string[], lang: string): string {
  const isFr = lang === 'fr';
  const date = new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const title = isFr ? 'Filarr — Codes de récupération' : 'Filarr — Recovery Codes';
  const warning = isFr
    ? 'Ne partagez jamais ces codes. Ils sont la seule façon de récupérer votre compte.'
    : 'Never share these codes. They are the only way to recover your account.';
  const dateLabel = isFr ? 'Date de génération' : 'Generated on';
  const neverShare = isFr ? 'Ne partagez jamais ces codes.' : 'Never share these codes.';

  const grid = words.map((w, i) =>
    `<div class="word"><span class="num">${i + 1}.</span>${w}</div>`
  ).join('');

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

ipcMain.handle('pdf:printRecoveryCodes', async (_event: IpcMainInvokeEvent, words: string[], lang: string) => {
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
});

// --- Security IPC handlers ---

ipcMain.handle('security:getEnhancedLock', async (_event: IpcMainInvokeEvent, profileId: string) => {
  const dir = profileId ? profileManager.getProfileDataDir(profileId) : StorageService.getBaseDir();
  return StorageService.getEnhancedLock(dir);
});

ipcMain.handle('security:setEnhancedLock', async (_event: IpcMainInvokeEvent, profileId: string, enabled: boolean) => {
  const dir = profileId ? profileManager.getProfileDataDir(profileId) : StorageService.getBaseDir();
  await StorageService.setEnhancedLock(dir, enabled);
  return { success: true };
});

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

ipcMain.handle('security:exportRecoveryKey', async (
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
      'raw', fekRaw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );

    // 4. Wrap FEK with recovery KEK
    const iv = crypto.randomBytes(12);
    const wrappedBuffer = await crypto.subtle.wrapKey('raw', fekKey, kek, { name: 'AES-GCM', iv });

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
});

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

ipcMain.handle('security:importRecoveryKey', async (
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

// --- Vault Export ---

ipcMain.handle('vault:exportZip', async (_event: IpcMainInvokeEvent, options: {
  entries: Array<{ path: string; data: string; encoding: string }>;
  encrypted?: boolean;
  password?: string;
  defaultFileName?: string;
}) => {
  try {
    const archiver = require('archiver');

    const defaultName = options.defaultFileName || `filarr-export-${new Date().toISOString().slice(0, 10)}.zip`;

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
        const buffer = entry.encoding === 'base64'
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
});

// --- Vault Import ---

ipcMain.handle('vault:selectImportFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    filters: [
      { name: 'ZIP / Encrypted', extensions: ['zip', 'enc', 'filarr'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  return {
    filePath: filePaths[0],
    isEncrypted: filePaths[0].endsWith('.enc'),
    fileName: path.basename(filePaths[0]),
  };
});

ipcMain.handle('vault:importZip', async (_event: IpcMainInvokeEvent, options: {
  filePath?: string;
  password?: string;
}) => {
  try {
    let filePath = options.filePath;
    if (!filePath) {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
        filters: [
          { name: 'ZIP / Encrypted', extensions: ['zip', 'enc', 'filarr'] },
        ],
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
          'raw', new TextEncoder().encode(options.password), 'PBKDF2', false, ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-512' },
          keyMaterial,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          key,
          encrypted
        );
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
      throw new Error(`Archive rejected: too many entries (${fileEntries.length} > ${MAX_ENTRIES})`);
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
        throw new Error(`Archive rejected: entry "${entryPath.slice(0, 80)}" exceeds ${MAX_ENTRY_SIZE} bytes`);
      }

      const isText = /\.(json|md|txt|yml|yaml|csv)$/i.test(entryPath);
      const rawBytes = await entry.async('uint8array');

      if (rawBytes.byteLength > MAX_ENTRY_SIZE) {
        throw new Error(`Archive rejected: entry "${entryPath.slice(0, 80)}" exceeds ${MAX_ENTRY_SIZE} bytes after inflate`);
      }
      totalDecompressed += rawBytes.byteLength;
      if (totalDecompressed > MAX_TOTAL_DECOMPRESSED) {
        throw new Error(`Archive rejected: total uncompressed size exceeds ${MAX_TOTAL_DECOMPRESSED} bytes (ZIP bomb?)`);
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
});

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

ipcMain.handle('updateFolder', async (_event: IpcMainInvokeEvent, id: string, updatedFolder: Partial<Folder>) => {
  try {
    const result = await StorageService.updateFolder(id, updatedFolder);
    emitFoldersUpdated();
    return result;
  } catch (error) {
    console.error('Error in updateFolder:', error);
    throw error;
  }
});

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

ipcMain.handle('addItemToFolder', async (_event: IpcMainInvokeEvent, folderId: string, item: Item) => {
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
        reminders: []
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
      parentId: folderId.toString()
    });

    return result;
  } catch (error) {
    console.error('Error in addItemToFolder:', error);
    throw error;
  }
});

ipcMain.handle('readEncryptedFileForCopy', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
    const filePath = path.join(folderPath, sanitizePath(fileName));
    const encryptedContent = await fs.readFile(filePath);

    // Check if migration is needed (no v2 marker detected)
    const v2Marker = Buffer.from(StorageService.ENCRYPTION_VERSION_2, 'utf8');
    const needsMigration = !encryptedContent.slice(0, v2Marker.length).equals(v2Marker);

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
});

// Prépare un fichier pour le drag natif vers le bureau
ipcMain.handle('prepareDragFile', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
    const filePath = path.join(folderPath, sanitizePath(fileName));
    const encryptedContent = await fs.readFile(filePath);
    const decryptedContent = await StorageService.decryptBinary(encryptedContent);

    const tempDir = path.join(app.getPath('temp'), 'filarr-drag');
    await fs.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, sanitizePath(fileName));
    await fs.writeFile(tempPath, decryptedContent);
    return tempPath;
  } catch (error) {
    console.error('Error in prepareDragFile:', error);
    throw error;
  }
});

// Lance le drag natif OS depuis le main process
ipcMain.on('ondragstart', (event, filePath: string) => {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABhSURBVFhH7c0xDQAwDASwov/PZS8+IMIqO93dvy0sLCwsLCz8y8LCwsLCwsK/LCwsLCwsLPzLwsLCwsLCwr8sLCwsLCws/MvCwsLCwsLCvywsLCwsLCz8y8LCwsLCwmcWvKZiRVJnxPEAAAAASUVORK5CYII='
  );
  event.sender.startDrag({ file: filePath, icon });
});

ipcMain.handle('saveEncryptedFile', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string, content: any) => {
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

    // Check per-file size limit (500 MB)
    const sizeCheck = await StorageService.checkQuotaBeforeUpload(bufferContent.length);
    if (!sizeCheck.allowed) {
      throw new Error(sizeCheck.reason || 'File too large (max 500 MB)');
    }

    const encryptedContent = await StorageService.encryptBinary(bufferContent);
    await fs.writeFile(filePath, encryptedContent);

    // Increment storage usage
    await StorageService.incrementStorageUsage(bufferContent.length);
  } catch (error) {
    console.error('Error in saveEncryptedFile:', error);
    throw error;
  }
});

ipcMain.handle('renameItem', async (_event: IpcMainInvokeEvent, parentId: string | undefined, itemId: string, oldName: string, newName: string) => {
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
    if (await fs.access(oldPath).then(() => true).catch(() => false)) {
      try {
        await fs.rename(oldPath, newPath);
      } catch (renameError: unknown) {
        console.error(`Error physically renaming file from ${oldName} to ${newName} in ${folderPath}:`, renameError);
        const renameMessage = renameError instanceof Error ? renameError.message : "Unknown error";
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
        const updatedItems = folder.items.map(item =>
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
});

ipcMain.handle('removeItemFromFolder', async (_event: IpcMainInvokeEvent, folderId: string, itemId: string) => {
  try {
    const result = await StorageService.removeItemFromFolder(folderId, itemId);
    emitFoldersUpdated();
    return result;
  } catch (error) {
    console.error('Error in removeItemFromFolder:', error);
    throw error;
  }
});

ipcMain.handle('saveFile', async (_event: IpcMainInvokeEvent, folderId: string, file: FileUpload) => {
  try {
    return await StorageService.saveFile(folderId, file);
  } catch (error) {
    console.error('Error in saveFile:', error);
    throw error;
  }
});

ipcMain.handle('readFile', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    return await StorageService.readFile(folderId, fileName);
  } catch (error) {
    console.error('Error in readFile:', error);
    throw error;
  }
});

ipcMain.handle('deleteFile', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    return await StorageService.deleteFile(folderId, fileName);
  } catch (error) {
    console.error('Error in deleteFile:', error);
    throw error;
  }
});

ipcMain.handle('openFile', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
    const filePath = path.join(folderPath, sanitizePath(fileName));

    // Read encrypted file content
    const encryptedContent = await fs.readFile(filePath);

    // Decrypt content
    const decryptedContent = await StorageService.decrypt(encryptedContent.toString('utf8'));

    // Write decrypted content to temporary file
    const tempPath = path.join(app.getPath('temp'), sanitizePath(fileName));
    await fs.writeFile(tempPath, decryptedContent);
    scheduleTempCleanup(tempPath);

    // Open temporary file
    await shell.openPath(tempPath);

    return true;
  } catch (error) {
    console.error('Error in openFile:', error);
    throw error;
  }
});

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

ipcMain.handle('openEncryptedFile', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string, shouldOpen: boolean = true) => {
  try {
    let folderPath: string;
    if (folderId === 'root') {
      folderPath = getActiveProfileDataDir();
    } else {
      folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
    }
    const filePath = path.join(folderPath, sanitizePath(fileName));

    const encryptedContent = await fs.readFile(filePath);

    // Check if migration is needed (no v2 marker detected)
    const v2Marker = Buffer.from(StorageService.ENCRYPTION_VERSION_2, 'utf8');
    const needsMigration = !encryptedContent.slice(0, v2Marker.length).equals(v2Marker);

    let decryptedContent: Buffer;
    try {
      decryptedContent = await StorageService.decryptBinary(encryptedContent);
    } catch (decryptError: unknown) {
      console.error('Detailed error during decryption:', decryptError);
      const decryptMessage = decryptError instanceof Error ? decryptError.message : "Unknown error";
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

    const tempPath = path.join(app.getPath('temp'), sanitizePath(fileName));
    await fs.writeFile(tempPath, decryptedContent);
    scheduleTempCleanup(tempPath);

    if (shouldOpen) {
      // Watch temporary file for modifications
      const watcher: FSWatcher = chokidar.watch(tempPath, {
        persistent: true,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100
        },
      });

      watcher.on('change', async (_watchPath: string) => {
        try {
          const updatedContent = await fs.readFile(tempPath);
          const reEncryptedContent = await StorageService.encryptBinary(updatedContent);
          await fs.writeFile(filePath, reEncryptedContent);
        } catch (error) {
          console.error('Error updating file:', error);
        }
      });

      shell.openPath(tempPath);
    }

    return tempPath;
  } catch (error) {
    console.error('Error in openEncryptedFile:', error);
    throw error;
  }
});

// Open a vault file (already decrypted in the renderer) with the system default app
// In hybrid mode, watches for edits and notifies the renderer via file-changed event
ipcMain.handle('openVaultFile', async (_event: IpcMainInvokeEvent, fileName: string, data: ArrayBuffer | Buffer | number[]) => {
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
      console.log('[openVaultFile] chokidar detected change on:', tempPath, 'fileName:', safeName);
      // Notify the renderer that this file was modified externally
      if (mainWindow) {
        mainWindow.webContents.send('file-changed', {
          fileName: safeName,
          tempPath,
        });
      }
    });

    watcher.on('error', (error: Error) => {
      console.error('[openVaultFile] chokidar watcher error:', error);
    });

    shell.openPath(tempPath);
    return tempPath;
  } catch (error) {
    console.error('Error in openVaultFile:', error);
    throw error;
  }
});

ipcMain.handle('updateItemInFolder', async (_event: IpcMainInvokeEvent, folderId: string, itemId: string, itemData: Partial<Item>) => {
  if (!folderId || !itemId || !itemData) {
    throw new Error('folderId, itemId, and itemData are required for updating an item metadata.');
  }
  try {
    const folder = await StorageService.getFolder(folderId.toString());
    if (!folder || !folder.items) {
      throw new Error(`Folder with id ${folderId} not found or has no items.`);
    }

    const itemIndex = folder.items.findIndex(item => item.id === itemId.toString());
    if (itemIndex === -1) {
      throw new Error(`Item with id ${itemId} not found in folder ${folderId}.`);
    }

    folder.items[itemIndex] = { ...folder.items[itemIndex], ...itemData };

    await StorageService.saveFolder(folder);

    emitFoldersUpdated();

    return folder.items[itemIndex];
  } catch (error) {
    console.error(`Error in IPC handler 'updateItemInFolder' for item ${itemId} in folder ${folderId}:`, error);
    throw error;
  }
});

ipcMain.handle('readEncryptedFile', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string) => {
  try {
    const folderPath = path.join(getActiveProfileDataDir(), folderId.toString());
    const filePath = path.join(folderPath, sanitizePath(fileName));

    if (!await fs.access(filePath).then(() => true).catch(() => false)) {
      console.error(`File ${fileName} does not exist in folder ${folderId}`);
      throw new Error(`File ${fileName} does not exist in folder ${folderId}`);
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
});

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
    await fs.unlink(tempFilePath);
  } catch (error) {
    console.error('Error deleting temporary file:', error);
    throw error;
  }
});

// ============================================
// REMINDERS IPC HANDLERS
// ============================================

ipcMain.handle('addReminder', async (_event: IpcMainInvokeEvent, itemId: string, reminder: Reminder) => {
  try {
    const result = await StorageService.addReminder(itemId, reminder);
    emitFoldersUpdated();
    return result;
  } catch (error) {
    console.error('Error in addReminder:', error);
    throw error;
  }
});

ipcMain.handle('updateReminder', async (_event: IpcMainInvokeEvent, itemId: string, reminderId: string, updatedReminder: Partial<Reminder>) => {
  try {
    const result = await StorageService.updateReminder(itemId, reminderId, updatedReminder);
    emitFoldersUpdated();
    return result;
  } catch (error) {
    console.error('Error in updateReminder:', error);
    throw error;
  }
});

ipcMain.handle('deleteReminder', async (_event: IpcMainInvokeEvent, itemId: string, reminderId: string) => {
  try {
    await StorageService.deleteReminder(itemId, reminderId);
    emitFoldersUpdated();
    return true;
  } catch (error) {
    console.error('Error in deleteReminder:', error);
    throw error;
  }
});

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

ipcMain.handle('updateItem', async (_event: IpcMainInvokeEvent, folderId: string, itemId: string, updatedItem: Partial<Item>) => {
  try {
    const folder = await StorageService.getFolder(folderId);
    if (folder && folder.items) {
      const itemIndex = folder.items.findIndex(item => item.id === itemId);
      if (itemIndex !== -1) {
        // Update item
        folder.items[itemIndex] = { ...folder.items[itemIndex], ...updatedItem };
        // If updated item is a reminder, ensure it's properly integrated
        if (updatedItem.reminders) {
          if (!folder.items[itemIndex].reminders) {
            folder.items[itemIndex].reminders = [];
          }
          // Merge reminders
          updatedItem.reminders.forEach(reminder => {
            const reminderIndex = folder.items[itemIndex].reminders!.findIndex(r => r.id === reminder.id);
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
});

ipcMain.handle('markReminderAsRead', async (_event: IpcMainInvokeEvent, reminderId: string) => {
  try {
    const reminder = await StorageService.getReminder(reminderId);
    if (reminder) {
      const updatedReminder: Partial<Reminder> = { ...reminder, isRead: true };
      const result = await StorageService.updateReminder(reminder.itemId as string, reminderId, updatedReminder);
      return { success: true, reminder: result };
    }
    return { success: false, error: 'Reminder not found' };
  } catch (error: unknown) {
    console.error('Error marking reminder as read:', error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
});

ipcMain.handle('markReminderAsDone', async (_event: IpcMainInvokeEvent, reminderId: string) => {
  try {
    const reminder = await StorageService.getReminder(reminderId);
    if (reminder) {
      const updatedReminder: Partial<Reminder> = { ...reminder, isCompleted: true };
      const result = await StorageService.updateReminder(reminder.itemId as string, reminderId, updatedReminder);
      return { success: true, reminder: result };
    }
    return { success: false, error: 'Reminder not found' };
  } catch (error: unknown) {
    console.error('Error marking reminder as done:', error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
});

ipcMain.handle('snoozeReminder', async (_event: IpcMainInvokeEvent, reminderId: string, snoozeTime: number) => {
  try {
    const reminder = await StorageService.getReminder(reminderId);
    if (reminder) {
      const newDate = new Date(reminder.date);
      newDate.setMinutes(newDate.getMinutes() + snoozeTime);
      const updatedReminder: Partial<Reminder> = { ...reminder, date: newDate.toISOString() };
      const result = await StorageService.updateReminder(reminder.itemId as string, reminderId, updatedReminder);
      return { success: true, reminder: result };
    }
    return { success: false, error: 'Reminder not found' };
  } catch (error: unknown) {
    console.error('Error snoozing reminder:', error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
});

ipcMain.handle('getNotificationSettings', async () => {
  try {
    return await StorageService.getNotificationSettings();
  } catch (error: unknown) {
    console.error('Error getting notification settings:', error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
});

ipcMain.handle('updateNotificationSettings', async (_event: IpcMainInvokeEvent, settings: NotificationSettings) => {
  try {
    await StorageService.updateNotificationSettings(settings);
    notificationSettings = settings;
    return { success: true };
  } catch (error: unknown) {
    console.error('Error updating notification settings:', error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
});

ipcMain.handle('getReminder', async (_event: IpcMainInvokeEvent, reminderId: string) => {
  return await StorageService.getReminder(reminderId);
});

// ============================================
// FILE DIALOG IPC HANDLERS
// ============================================

ipcMain.handle('showSaveDialog', async (_event: IpcMainInvokeEvent, options: Electron.SaveDialogOptions) => {
  const result = await dialog.showSaveDialog(mainWindow as BrowserWindow, options);
  return result.filePath;
});

ipcMain.handle('showOpenDialog', async (_event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions) => {
  const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, options);
  return result;
});

ipcMain.handle('writeRawFile', async (_event: IpcMainInvokeEvent, filePath: string, data: number[] | Uint8Array | Buffer) => {
  // Security: validate path to prevent arbitrary filesystem writes
  const resolved = path.resolve(filePath);
  const homeDir = app.getPath('home');
  const tempDir = app.getPath('temp');
  if (!resolved.startsWith(homeDir) && !resolved.startsWith(tempDir)) {
    throw new Error('writeRawFile: path must be under user home or temp directory');
  }
  await fs.writeFile(resolved, Buffer.isBuffer(data) ? data : Buffer.from(data as any));
  return true;
});

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
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
});

// ============================================
// MOVE/COPY IPC HANDLERS
// ============================================

ipcMain.handle('moveItem', async (_event: IpcMainInvokeEvent, itemId: string, sourceFolderId: string, targetFolderId: string) => {
  try {
    const result = await StorageService.moveItem(itemId, sourceFolderId, targetFolderId);
    emitFoldersUpdated();
    return result;
  } catch (error) {
    console.error('Error in moveItem:', error);
    throw error;
  }
});

ipcMain.handle('copyItem', async (_event: IpcMainInvokeEvent, itemId: string, sourceFolderId: string, targetFolderId: string, newName?: string) => {
  try {
    const result = await StorageService.copyItem(itemId, sourceFolderId, targetFolderId, newName);
    emitFoldersUpdated();
    return result;
  } catch (error) {
    console.error('Error in copyItem:', error);
    throw error;
  }
});

/**
 * Download file helper
 */
async function downloadFile(folderId: string, item: Item, savePath: string, _password?: string): Promise<void> {
  const filePath = path.join(getActiveProfileDataDir(), folderId, sanitizePath(item.name));
  const encryptedContent = await fs.readFile(filePath);
  const decryptedContent = await StorageService.decryptBinary(encryptedContent);
  await fs.writeFile(savePath, decryptedContent);
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

/**
 * Add folder contents to archive recursively
 */
async function addFolderToArchive(archive: any, folder: Folder, prefix: string): Promise<void> {
  const folderItems = await StorageService.getFolderItems(folder.id);
  for (const item of folderItems) {
    const itemPath = `${prefix}/${sanitizePath(item.name)}`;
    if (item.type === 'folder') {
      await addFolderToArchive(archive, item as Folder, itemPath);
    } else {
      const filePath = path.join(getActiveProfileDataDir(), folder.id, sanitizePath(item.name));
      const encrypted = await fs.readFile(filePath);
      const decrypted = await StorageService.decryptBinary(encrypted);
      archive.append(Buffer.from(decrypted), { name: itemPath });
    }
  }
}

ipcMain.handle('downloadMultipleAsZip', async (_event: IpcMainInvokeEvent, request: DownloadMultipleRequest) => {
  try {
    const { folderId, itemIds, savePath } = request;
    const archiver = require('archiver');
    const fsSync = require('fs');

    const output = fsSync.createWriteStream(savePath);
    const archive = archiver('zip', { zlib: { level: 5 } });

    return await new Promise((resolve, reject) => {
      output.on('close', () => resolve({ success: true, count: itemIds.length }));
      archive.on('error', (err: Error) => reject(err));
      archive.pipe(output);

      (async () => {
        for (const itemId of itemIds) {
          const item = await StorageService.getItem(itemId);
          if (item.type === 'folder') {
            await addFolderToArchive(archive, item as Folder, sanitizePath(item.name));
          } else {
            const filePath = path.join(getActiveProfileDataDir(), folderId, sanitizePath(item.name));
            const encrypted = await fs.readFile(filePath);
            const decrypted = await StorageService.decryptBinary(encrypted);
            archive.append(Buffer.from(decrypted), { name: item.name });
          }
        }
        archive.finalize();
      })().catch(reject);
    });
  } catch (error: unknown) {
    console.error('Error during multiple download:', error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
});

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

ipcMain.handle('storage:permanentlyDeleteItem', async (_event: IpcMainInvokeEvent, itemId: string, folderId?: string) => {
  try {
    const result = await StorageService.permanentlyDeleteItem(itemId, folderId || null);
    return result;
  } catch (error) {
    console.error('[IPC] Error in storage:permanentlyDeleteItem:', error);
    throw error;
  }
});

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

ipcMain.handle('storage:deleteFolder', async (_event: IpcMainInvokeEvent, id: string, permanent: boolean = false) => {
  try {
    await StorageService.deleteFolder(id, permanent);
    return true;
  } catch (error) {
    console.error('[IPC] Error in storage:deleteFolder:', error);
    throw error;
  }
});

ipcMain.handle('storage:deleteFile', async (_event: IpcMainInvokeEvent, folderId: string, fileName: string, permanent: boolean = false) => {
  try {
    const result = await StorageService.deleteFile(folderId, fileName, permanent);
    return result;
  } catch (error) {
    console.error('[IPC] Error in storage:deleteFile:', error);
    throw error;
  }
});

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

ipcMain.handle('pm:exportToFile', async (_event: IpcMainInvokeEvent, data: string, defaultName: string) => {
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
});

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

ipcMain.handle('pm:copyToClipboard', async (_event: IpcMainInvokeEvent, text: string, clearAfterMs: number = 30000) => {
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
});

// ==================== Notes IPC Handlers ====================

const NOTES_DB_FILENAME = 'notes.enc';

ipcMain.handle('notes:save', async (_event: IpcMainInvokeEvent, notesData: { byId: Record<string, any>; allIds: string[]; templates: any[] }) => {
  try {
    const dataDir = getActiveProfileDataDir();
    await fs.mkdir(dataDir, { recursive: true });
    const filePath = path.join(dataDir, NOTES_DB_FILENAME);

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
          return false;
        }
      } catch {
        /* file doesn't exist — safe to write empty */
      }
    }

    const encrypted = await StorageService.encrypt(notesData);
    await fs.writeFile(filePath, encrypted, 'utf-8');
    log.info(`[notes:save] Wrote ${encrypted.length} bytes (${notesData.allIds?.length ?? 0} notes)`);

    // Snapshot version history — fire-and-forget. Never block the save on this.
    // The service internally dedups identical content and throttles bursts.
    if (activeProfileId && notesData.byId && notesData.allIds) {
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
      noteVersionService
        .recordSnapshots(pid, dataDir, snapshotInputs)
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
});

ipcMain.handle('notes:load', async () => {
  try {
    const dataDir = getActiveProfileDataDir();
    const filePath = path.join(dataDir, NOTES_DB_FILENAME);
    log.info(`[notes:load] Loading from ${filePath}`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      if (!data || data.trim().length === 0) {
        log.warn(`[notes:load] File empty or null (${data?.length ?? 0} bytes)`);
        return null;
      }
      log.info(`[notes:load] Read ${data.length} bytes, decrypting…`);
      const decrypted = await StorageService.decrypt(data);
      const noteCount = decrypted?.byId ? Object.keys(decrypted.byId).length : 0;
      log.info(`[notes:load] Decrypted OK — ${noteCount} notes`);
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

// ==================== Generic File Open Dialog ====================

ipcMain.handle('dialog:openFile', async (_event: IpcMainInvokeEvent, options: { filters?: { name: string; extensions: string[] }[] }) => {
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
});

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

ipcMain.handle('import:selectFile', async (_event: IpcMainInvokeEvent, options: {
  filters?: { name: string; extensions: string[] }[];
}) => {
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
});

ipcMain.handle('import:readDirectory', async (_event: IpcMainInvokeEvent, dirPath: string) => {
  try {
    // Security: refuse paths not approved via import:selectDirectory
    if (typeof dirPath !== 'string' || !isApprovedPath(dirPath)) {
      log.warn(`[import:readDirectory] Refused unapproved path: ${String(dirPath).slice(0, 120)}`);
      return [];
    }

    const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.DS_Store']);
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const MAX_ENTRIES = 20_000; // hard cap to avoid runaway walks
    const rootResolved = path.resolve(dirPath);
    const entries: { relativePath: string; content: string; isDirectory: boolean }[] = [];

    async function walk(dir: string, prefix: string) {
      if (entries.length >= MAX_ENTRIES) return;
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (entries.length >= MAX_ENTRIES) return;
        if (SKIP_DIRS.has(item.name)) continue;
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
          entries.push({ relativePath: relPath, content: '', isDirectory: true });
          await walk(fullPath, relPath);
        } else {
          const ext = path.extname(item.name).toLowerCase();
          // Only read text-based files
          if (['.md', '.markdown', '.txt', '.html', '.htm', '.css', '.json', '.yaml', '.yml', '.csv'].includes(ext)) {
            const stat = await fs.stat(fullPath);
            if (stat.size <= MAX_FILE_SIZE) {
              const content = await fs.readFile(fullPath, 'utf-8');
              entries.push({ relativePath: relPath, content, isDirectory: false });
            }
          } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf'].includes(ext)) {
            // Binary attachments — read as base64
            const stat = await fs.stat(fullPath);
            if (stat.size <= MAX_FILE_SIZE) {
              const buffer = await fs.readFile(fullPath);
              entries.push({ relativePath: relPath, content: `data:base64,${buffer.toString('base64')}`, isDirectory: false });
            }
          }
        }
      }
    }

    await walk(rootResolved, '');
    return entries;
  } catch (error) {
    console.error('[IPC] Error in import:readDirectory:', error);
    return [];
  }
});

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
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname === '0.0.0.0') {
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
      const re1 = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i');
      const re3 = new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
      const re4 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i');
      return (re1.exec(html)?.[1] || re2.exec(html)?.[1] || re3.exec(html)?.[1] || re4.exec(html)?.[1] || '').trim();
    };

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const ogTitle = getMetaContent('og:title');
    const ogDesc = getMetaContent('og:description');
    const ogImage = getMetaContent('og:image');
    const metaDesc = getMetaContent('description');

    // Favicon: look for <link rel="icon" href="...">
    const faviconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i);

    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;

    // Resolve relative URLs
    const resolveUrl = (relative: string): string => {
      if (!relative) return '';
      try { return new URL(relative, url).href; } catch { return relative; }
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
    const resolvedFavicon = faviconMatch ? resolveUrl(faviconMatch[1]) : `${parsedUrl.origin}/favicon.ico`;

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

import { argon2Hash, argon2Verify, argon2DeriveKey } from './argon2Service';
import { extensionBridge, EXTENSION_BRIDGE_ENABLED } from './extensionBridge';

ipcMain.handle('crypto:argon2Hash', async (_event: IpcMainInvokeEvent, password: string, salt?: string) => {
  try {
    return await argon2Hash(password, salt);
  } catch (error) {
    console.error('[IPC] Error in crypto:argon2Hash:', error);
    throw error;
  }
});

ipcMain.handle('crypto:argon2Verify', async (_event: IpcMainInvokeEvent, hash: string, password: string) => {
  try {
    return await argon2Verify(hash, password);
  } catch (error) {
    console.error('[IPC] Error in crypto:argon2Verify:', error);
    throw error;
  }
});

ipcMain.handle('crypto:argon2DeriveKey', async (_event: IpcMainInvokeEvent, password: string, salt: string) => {
  try {
    return await argon2DeriveKey(password, salt);
  } catch (error) {
    console.error('[IPC] Error in crypto:argon2DeriveKey:', error);
    throw error;
  }
});

// --- bcrypt password hashing for file/folder protection ---
import bcryptjs from 'bcryptjs';

ipcMain.handle('crypto:hashPassword', async (_event: IpcMainInvokeEvent, password: string) => {
  return bcryptjs.hash(password, 12);
});

ipcMain.handle('crypto:verifyPassword', async (_event: IpcMainInvokeEvent, password: string, hash: string) => {
  return bcryptjs.compare(password, hash);
});

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

ipcMain.handle('secureStore:setPasswordHashes', async (_event: IpcMainInvokeEvent, hashes: Record<string, any>) => {
  try {
    const filePath = path.join(StorageService.getBaseDir(), PASSWORD_HASHES_FILE);
    const encrypted = await StorageService.encrypt(hashes);
    await fs.writeFile(filePath, encrypted, 'utf8');
    return true;
  } catch (error) {
    console.error('[IPC] Error in secureStore:setPasswordHashes:', error);
    throw error;
  }
});

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

  ipcMain.handle('extension:removePairedClient', async (_event: IpcMainInvokeEvent, clientId: string) => {
    try {
      const removed = extensionBridge.removePairedClient(clientId);
      return { success: removed };
    } catch (error) {
      console.error('[IPC] Error in extension:removePairedClient:', error);
      throw error;
    }
  });

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

ipcMain.handle('showDesktopNotification', async (_event: IpcMainInvokeEvent, payload: { title: string; body?: string }) => {
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
});

