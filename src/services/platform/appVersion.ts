/**
 * Single source of truth for the app version.
 *
 * Resolution order:
 * 1. Webpack DefinePlugin injection (__FILARR_VERSION__, config-overrides.js) —
 *    the package.json version, in every build (dev server, desktop, web)
 * 2. Electron IPC (window.electronAPI.getVersion) — works in Electron runtime
 * 3. REACT_APP_VERSION env var — works with react-scripts start
 *
 * On the web the resolved version carries a `-web` suffix, so a crash entry or
 * a version string in Settings never passes a browser session off as a desktop
 * build. Import this instead of reading __FILARR_VERSION__ directly.
 */

import { isWebPlatform } from './isWebPlatform';

declare const __FILARR_VERSION__: string | undefined;

let cachedVersion: string | null = null;

/**
 * The version baked into the bundle at build time, without platform suffix —
 * `null` when nothing was injected (tests, an unconfigured toolchain).
 *
 * Kept separate from `getAppVersion()` so the web shim of `electronAPI.getVersion`
 * (src/platform/web/installWebPlatform.ts) can read it WITHOUT calling
 * `getAppVersion()` — which would call the shim back, forever.
 */
export function getBuildVersion(): string | null {
  if (typeof __FILARR_VERSION__ !== 'undefined' && __FILARR_VERSION__) {
    return __FILARR_VERSION__;
  }
  if (process.env.REACT_APP_VERSION) {
    return process.env.REACT_APP_VERSION;
  }
  return null;
}

export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion;

  // 1. Build-time injection (DefinePlugin) or 3. react-scripts env var
  const build = getBuildVersion();
  if (build) {
    cachedVersion = isWebPlatform() ? `${build}-web` : build;
    return cachedVersion;
  }

  // 2. Electron IPC (and the web shim, which already suffixes `-web`)
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

  // 4. Fallback — should never happen in production
  cachedVersion = '0.0.0';
  return cachedVersion;
}
