/**
 * Version Check Service — local-only stub.
 *
 * The hosted release-channel endpoint that this service used to query has been
 * removed from the public source tree. Forks that ship updates should
 * re-implement `checkForUpdate()` against their own infrastructure.
 */

import { getAppVersion } from './appVersion';

export interface VersionCheckResult {
  updateAvailable: boolean;
  latestVersion: string | null;
  currentVersion: string;
  releaseUrl?: string;
}

export async function checkForUpdate(_force: boolean = false): Promise<VersionCheckResult | null> {
  return {
    updateAvailable: false,
    latestVersion: null,
    currentVersion: getAppVersion(),
  };
}
