/**
 * Mini-mode window — the compact frameless drop-zone/unlock surface opened
 * from the tray (left-click) or the global hotkey.
 *
 * Lifecycle: created lazily on first toggle, then HIDDEN on close/blur —
 * never destroyed while the app runs, so re-opening is instant and the
 * renderer keeps its state. It loads the same index.html as the main window
 * with the '#/mini' hash (HashRouter — no server route needed), inherits the
 * default session's CSP/permission handlers automatically, and uses the same
 * sandboxed preload.
 *
 * Security parity with the main window: prod devtools blocked, window.open
 * denied (external http(s) via shell), navigation covered by main.ts's
 * 'web-contents-created' guard which whitelists this webContents through
 * isMiniWindowWebContents().
 */

import { BrowserWindow, screen, shell, type WebContents } from 'electron';
import log from 'electron-log';

export const MINI_WINDOW_WIDTH = 360;
export const MINI_WINDOW_HEIGHT = 480;

export interface MiniWindowConfig {
  preloadPath: string;
  /** Full renderer URL including the #/mini hash. */
  loadUrl: string;
  isDev: boolean;
  /** Live getters so settings changes apply without recreating the window. */
  alwaysOnTop(): boolean;
  autoHideOnBlur(): boolean;
  isQuitting(): boolean;
  isSafeExternalUrl(url: unknown): url is string;
}

let miniWindow: BrowserWindow | null = null;

export function getMiniWindow(): BrowserWindow | null {
  return miniWindow && !miniWindow.isDestroyed() ? miniWindow : null;
}

/** Used by the global 'web-contents-created' navigation guard in main.ts. */
export function isMiniWindowWebContents(contents: WebContents): boolean {
  const win = getMiniWindow();
  return !!win && win.webContents === contents;
}

/**
 * Positions the window near the cursor (which sits on the tray icon right
 * after a tray click), fully clamped inside the current display's work area.
 * Opens upward when the cursor is in the bottom half (Windows taskbar).
 */
function positionNearCursor(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const wa = display.workArea;
  const margin = 12;

  const x = Math.min(
    Math.max(cursor.x - Math.round(MINI_WINDOW_WIDTH / 2), wa.x + margin),
    wa.x + wa.width - MINI_WINDOW_WIDTH - margin
  );
  const preferAbove = cursor.y > wa.y + wa.height / 2;
  const rawY = preferAbove ? cursor.y - MINI_WINDOW_HEIGHT - margin : cursor.y + margin;
  const y = Math.min(Math.max(rawY, wa.y + margin), wa.y + wa.height - MINI_WINDOW_HEIGHT - margin);

  win.setPosition(Math.round(x), Math.round(y), false);
}

function createMiniWindow(config: MiniWindowConfig): BrowserWindow {
  const win = new BrowserWindow({
    width: MINI_WINDOW_WIDTH,
    height: MINI_WINDOW_HEIGHT,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: config.alwaysOnTop(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: config.preloadPath,
    },
  });

  // Hide instead of destroy — and never flip the app-level quit flag.
  win.on('close', (event) => {
    if (!config.isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    miniWindow = null;
  });

  // Graceful auto-hide when focus leaves the palette (optional via settings).
  win.on('blur', () => {
    if (config.autoHideOnBlur() && !win.webContents.isDevToolsOpened()) {
      win.hide();
    }
  });

  // Same window-open policy as the main window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (config.isSafeExternalUrl(url)) {
      shell.openExternal(url);
    } else {
      log.warn(`[miniWindow] Refused unsafe URL: ${String(url).slice(0, 120)}`);
    }
    return { action: 'deny' };
  });

  // Prod devtools block (parity with the main window).
  if (!config.isDev) {
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools();
    });
    win.setMenuBarVisibility(false);
  }

  void win.loadURL(config.loadUrl).catch((err) => {
    log.warn('[miniWindow] loadURL failed:', err);
  });

  return win;
}

/** Shows (creating lazily) the mini window near the cursor. */
export function showMiniWindow(config: MiniWindowConfig): void {
  let win = getMiniWindow();
  if (!win) {
    win = createMiniWindow(config);
    miniWindow = win;
  }
  win.setAlwaysOnTop(config.alwaysOnTop());
  positionNearCursor(win);
  win.show();
  win.focus();
}

export function hideMiniWindow(): void {
  const win = getMiniWindow();
  if (win && win.isVisible()) {
    win.hide();
  }
}

/** Tray left-click / global hotkey entry point. */
export function toggleMiniWindow(config: MiniWindowConfig): void {
  const win = getMiniWindow();
  if (win && win.isVisible()) {
    win.hide();
    return;
  }
  showMiniWindow(config);
}

/** Applies the always-on-top setting live (Settings toggle). */
export function applyMiniAlwaysOnTop(flag: boolean): void {
  const win = getMiniWindow();
  if (win) {
    win.setAlwaysOnTop(flag);
  }
}

/** Real destroy — only during app teardown. */
export function destroyMiniWindow(): void {
  const win = getMiniWindow();
  if (win) {
    win.destroy();
  }
  miniWindow = null;
}
