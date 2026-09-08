/**
 * Unique origin of the Filarr control plane (auth, sync, billing).
 *
 * Changing this hostname is a credential-theft risk: the desktop main process
 * has no CSP and posts passwords here. Guarded by scripts/check-api-origins.cjs
 * and electron/__tests__/apiOrigin.vitest.ts.
 */
export const API_ORIGIN = 'https://api.filarr.com';
export const API_BASE = API_ORIGIN;
