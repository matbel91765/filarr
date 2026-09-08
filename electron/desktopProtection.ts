/**
 * Desktop protection settings — pure parsing/merging logic (no Electron
 * imports, unit-testable in plain Node).
 *
 * The renderer owns the canonical settings UI (settingsSlice) but the main
 * process must read these values at boot — before any renderer exists — so
 * they are mirrored into filarr-flags.json under DESKTOP_SETTINGS_FLAG_KEY
 * as a JSON string (precedent: the 'sync-paused' flag read in startApp).
 * Main-side consumers: global hotkeys, powerMonitor auto-lock, idle lock,
 * mini-window behavior and temp-purge-on-lock.
 */

export const DESKTOP_SETTINGS_FLAG_KEY = 'desktop-protection';

export interface DesktopProtectionSettings {
  /** Master switch for the two global shortcuts below. */
  hotkeysEnabled: boolean;
  /** Accelerator that toggles the mini-mode window. */
  hotkeyMini: string;
  /** Accelerator that locks the vault (and purges temp plaintext). */
  hotkeyLock: string;
  /** Lock the vault when the OS session locks (Win/mac 'lock-screen'). */
  lockOnOsLock: boolean;
  /** Lock the vault when the machine suspends (also covers Linux). */
  lockOnSuspend: boolean;
  /** Main-side OS-idle lock (powerMonitor.getSystemIdleTime polling). */
  idleLockEnabled: boolean;
  /** Idle threshold in minutes (clamped 1..240). */
  idleLockMinutes: number;
  /** Secure-purge temp plaintext on every lock (recommended). */
  purgeTempOnLock: boolean;
  /** Start with the main window hidden (tray only). */
  startInTray: boolean;
  /** Mini window stays above other windows. */
  miniAlwaysOnTop: boolean;
  /** Mini window hides itself when it loses focus. */
  miniAutoHideOnBlur: boolean;
}

export const DEFAULT_DESKTOP_PROTECTION_SETTINGS: DesktopProtectionSettings = {
  // Defaults MUST stay IDENTICAL to DESKTOP_PROTECTION_DEFAULTS in the
  // renderer's settingsSlice (mirrored fields) — the Settings screen renders
  // its own defaults before the first mirror lands, and a mismatch would
  // make the UI lie about what is actually active.
  hotkeysEnabled: true,
  // CommandOrControl+Alt+F: brand mnemonic ("F" glyph), unclaimed by Windows
  // (Ctrl+Alt+L locks the session on some setups — avoided on purpose).
  hotkeyMini: 'CommandOrControl+Alt+F',
  hotkeyLock: 'CommandOrControl+Alt+Shift+L',
  lockOnOsLock: true,
  lockOnSuspend: true,
  idleLockEnabled: false,
  idleLockMinutes: 15,
  purgeTempOnLock: true,
  startInTray: false,
  miniAlwaysOnTop: true,
  // Default OFF: an auto-hiding palette vanishes the instant a native OS drag
  // steals focus (the mini window blurs), which broke the primary "drop a file
  // to protect it" gesture. Staying put is the usable default; the user closes
  // it via the tray, the hotkey, or the close control.
  miniAutoHideOnBlur: false,
};

/**
 * Conservative accelerator sanity check. Electron's real validation happens
 * at globalShortcut.register time (which can also fail when another app owns
 * the combo) — this only rejects obviously-broken strings so we never persist
 * garbage that would throw at boot.
 */
export function isPlausibleAccelerator(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return false;
  // Tokens separated by '+', each token alphanumeric or a known key name.
  return /^[0-9A-Za-z+\- ]+$/.test(trimmed) && !trimmed.startsWith('+') && !trimmed.endsWith('+');
}

function readBool(source: Record<string, unknown>, key: keyof DesktopProtectionSettings, fallback: boolean): boolean {
  const v = source[key];
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Parses the persisted JSON string (or a plain object) into a fully-populated
 * settings object. Unknown/malformed fields silently fall back to defaults —
 * a corrupted flags file must never break app boot.
 */
export function parseDesktopSettings(raw: unknown): DesktopProtectionSettings {
  const defaults = DEFAULT_DESKTOP_PROTECTION_SETTINGS;
  let source: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        source = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt JSON → defaults.
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    source = raw as Record<string, unknown>;
  }

  const minutesRaw = source.idleLockMinutes;
  const minutes =
    typeof minutesRaw === 'number' && Number.isFinite(minutesRaw)
      ? Math.min(240, Math.max(1, Math.round(minutesRaw)))
      : defaults.idleLockMinutes;

  return {
    hotkeysEnabled: readBool(source, 'hotkeysEnabled', defaults.hotkeysEnabled),
    hotkeyMini: isPlausibleAccelerator(source.hotkeyMini) ? (source.hotkeyMini as string).trim() : defaults.hotkeyMini,
    hotkeyLock: isPlausibleAccelerator(source.hotkeyLock) ? (source.hotkeyLock as string).trim() : defaults.hotkeyLock,
    lockOnOsLock: readBool(source, 'lockOnOsLock', defaults.lockOnOsLock),
    lockOnSuspend: readBool(source, 'lockOnSuspend', defaults.lockOnSuspend),
    idleLockEnabled: readBool(source, 'idleLockEnabled', defaults.idleLockEnabled),
    idleLockMinutes: minutes,
    purgeTempOnLock: readBool(source, 'purgeTempOnLock', defaults.purgeTempOnLock),
    startInTray: readBool(source, 'startInTray', defaults.startInTray),
    miniAlwaysOnTop: readBool(source, 'miniAlwaysOnTop', defaults.miniAlwaysOnTop),
    miniAutoHideOnBlur: readBool(source, 'miniAutoHideOnBlur', defaults.miniAutoHideOnBlur),
  };
}

/**
 * Merges a partial update (from the renderer settings screen) into the
 * current settings, revalidating every field through the same parser.
 */
export function mergeDesktopSettings(
  current: DesktopProtectionSettings,
  patch: unknown
): DesktopProtectionSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ...current };
  return parseDesktopSettings({ ...current, ...(patch as Record<string, unknown>) });
}
