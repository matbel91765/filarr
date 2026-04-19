/**
 * Single source of truth for the app version.
 *
 * Resolution order:
 * 1. Webpack DefinePlugin injection (__FILARR_VERSION__) — works in production build
 * 2. Electron IPC (window.electronAPI.getVersion) — works in Electron runtime
 * 3. REACT_APP_VERSION env var — works with react-scripts start
 *
 * Import this instead of reading __FILARR_VERSION__ directly.
 */

declare const __FILARR_VERSION__: string | undefined;

let cachedVersion: string | null = null;

export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion;

  // 1. Webpack DefinePlugin (production build)
  if (typeof __FILARR_VERSION__ !== 'undefined' && __FILARR_VERSION__) {
    cachedVersion = __FILARR_VERSION__;
    return cachedVersion;
  }

  // 2. Electron IPC
  const electronAPI = (window as unknown as Record<string, unknown>).electronAPI as
    | { getVersion: () => string }
    | undefined;
  if (electronAPI?.getVersion) {
    try {
      const v = electronAPI.getVersion();
      if (v) {
        cachedVersion = v;
        return cachedVersion;
      }
    } catch {
      // IPC not available
    }
  }

  // 3. react-scripts env var
  if (process.env.REACT_APP_VERSION) {
    cachedVersion = process.env.REACT_APP_VERSION;
    return cachedVersion;
  }

  // 4. Fallback — should never happen in production
  cachedVersion = '0.0.0';
  return cachedVersion;
}
