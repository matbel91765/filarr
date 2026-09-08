/**
 * Global hotkeys — toggle mini-mode + lock vault.
 *
 * globalShortcut quirks handled here:
 *  - register() returns FALSE (no exception) when another application already
 *    owns the accelerator — the failure must be surfaced to Settings, never
 *    assumed successful;
 *  - register() THROWS on a malformed accelerator string — caught and
 *    reported the same way;
 *  - re-applying settings unregisters the previous accelerators first so a
 *    hotkey change never leaves the old combo dangling;
 *  - unregisterAllHotkeys() must run on 'will-quit' (Electron requirement).
 *
 * Only usable after app 'ready'.
 */

import { globalShortcut } from 'electron';
import log from 'electron-log';
import type { DesktopProtectionSettings } from './desktopProtection';

export interface HotkeyActions {
  toggleMini(): void;
  lockVault(): void;
}

export interface HotkeyRegistration {
  accelerator: string;
  /** True when the OS accepted the registration. */
  ok: boolean;
  /** French reason when ok === false. */
  error?: string;
}

export interface HotkeyStatus {
  enabled: boolean;
  mini: HotkeyRegistration;
  lock: HotkeyRegistration;
}

let registered: string[] = [];

function unregisterCurrent(): void {
  for (const accelerator of registered) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      /* already gone */
    }
  }
  registered = [];
}

function tryRegister(accelerator: string, handler: () => void): HotkeyRegistration {
  try {
    const ok = globalShortcut.register(accelerator, handler);
    if (ok) {
      registered.push(accelerator);
      return { accelerator, ok: true };
    }
    return {
      accelerator,
      ok: false,
      error: 'Raccourci déjà utilisé par une autre application',
    };
  } catch (err) {
    log.warn('[hotkeys] invalid accelerator:', accelerator, err);
    return { accelerator, ok: false, error: 'Raccourci invalide' };
  }
}

/**
 * (Re)applies the hotkey settings: unregisters whatever was registered
 * before, then registers the current accelerators. Never throws.
 */
export function applyHotkeys(
  settings: DesktopProtectionSettings,
  actions: HotkeyActions
): HotkeyStatus {
  unregisterCurrent();

  if (!settings.hotkeysEnabled) {
    return {
      enabled: false,
      mini: { accelerator: settings.hotkeyMini, ok: false, error: 'Raccourcis désactivés' },
      lock: { accelerator: settings.hotkeyLock, ok: false, error: 'Raccourcis désactivés' },
    };
  }

  const mini = tryRegister(settings.hotkeyMini, actions.toggleMini);
  const lock =
    settings.hotkeyLock === settings.hotkeyMini
      ? { accelerator: settings.hotkeyLock, ok: false, error: 'Raccourci identique au précédent' }
      : tryRegister(settings.hotkeyLock, actions.lockVault);

  if (!mini.ok) log.warn('[hotkeys] mini-mode hotkey not registered:', mini.error);
  if (!lock.ok) log.warn('[hotkeys] lock hotkey not registered:', lock.error);

  return { enabled: true, mini, lock };
}

/** Full teardown — call from app 'will-quit'. */
export function unregisterAllHotkeys(): void {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* app may be tearing down */
  }
  registered = [];
}
