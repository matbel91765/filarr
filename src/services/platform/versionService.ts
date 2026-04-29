/**
 * Version Check Service
 *
 * Pings the Filarr API on startup to:
 * 1. Check if a newer version is available
 * 2. Log anonymous usage data (OS, version, anonymous device ID)
 *
 * No PII is collected. The device ID is a random UUID generated on first run.
 */

import profileStorage from '../core/profileStorage';
import { getAppVersion } from './appVersion';

// Cloudflare Worker endpoint
const VERSION_CHECK_URL = 'https://filarr-version.filarr-app.workers.dev/version';
const DEVICE_ID_KEY = 'filarr_device_id';
const LAST_CHECK_KEY = 'filarr_last_version_check';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface VersionCheckResult {
  updateAvailable: boolean;
  latestVersion: string | null;
  currentVersion: string;
  releaseUrl?: string;
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Win')) return 'windows';
  if (ua.includes('Mac')) return 'macos';
  if (ua.includes('Linux')) return 'linux';
  return 'unknown';
}

function getCurrentVersion(): string {
  return getAppVersion();
}

function compareVersions(current: string, latest: string): boolean {
  const c = current.split('.').map(Number);
  const l = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

/**
 * Check for updates (throttled to once per 24h).
 * Returns null if skipped due to throttle.
 */
export async function checkForUpdate(force: boolean = false): Promise<VersionCheckResult | null> {
  const currentVersion = getCurrentVersion();

  // Throttle: skip if checked recently (unless forced)
  if (!force) {
    const lastCheck = profileStorage.getItem(LAST_CHECK_KEY);
    if (lastCheck) {
      const elapsed = Date.now() - parseInt(lastCheck, 10);
      if (elapsed < CHECK_INTERVAL_MS) {
        return null;
      }
    }
  }

  try {
    const deviceId = getOrCreateDeviceId();
    const os = getOS();

    const url = `${VERSION_CHECK_URL}?v=${encodeURIComponent(currentVersion)}&os=${os}&id=${deviceId}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    profileStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

    if (!response.ok) {
      return { updateAvailable: false, latestVersion: null, currentVersion };
    }

    const data = await response.json();
    const latestVersion = data.latest || data.version || null;

    return {
      updateAvailable: latestVersion ? compareVersions(currentVersion, latestVersion) : false,
      latestVersion,
      currentVersion,
      releaseUrl: data.releaseUrl || data.url,
    };
  } catch {
    // Network errors are expected (offline, server down, etc.)
    return { updateAvailable: false, latestVersion: null, currentVersion };
  }
}
