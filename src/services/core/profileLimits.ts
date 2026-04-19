/**
 * Profile Limits — Local-first, no plan restrictions
 */

const MAX_PROFILES = 10;

export function getMaxProfiles(): number {
  return MAX_PROFILES;
}

export function canCreateProfile(_plan: unknown, currentCount: number): boolean {
  return currentCount < MAX_PROFILES;
}
