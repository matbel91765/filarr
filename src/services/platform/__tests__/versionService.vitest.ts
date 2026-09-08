/**
 * Le contrôle de version et la plateforme.
 *
 * Sur app.filarr.com il n'y a rien à mettre à jour (le worker sert toujours le
 * dernier build), et la requête vers le Worker de version est de toute façon
 * hors `connect-src` : elle était refusée par le navigateur et loguée en rouge
 * à chaque chargement (constaté en prod le 2026-08-28). Le ping anonyme tombe
 * avec, à dessein — la télémétrie web est opt-in (ESW-1605).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/profileStorage', () => ({
  default: { getItem: vi.fn(() => null), setItem: vi.fn() },
}));

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function installBrowser(web: boolean): ReturnType<typeof vi.fn> {
  defineGlobal('window', { __FILARR_WEB__: web || undefined });
  defineGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  const store = new Map<string, string>();
  defineGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ latest: '99.0.0', releaseUrl: 'https://filarr.com/download' }),
  }));
  defineGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('web : aucune requête ne part, même forcé — rend null', async () => {
    const fetchMock = installBrowser(true);
    const { checkForUpdate } = await import('../versionService');
    await expect(checkForUpdate(true)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bureau : la requête part vers le Worker de version et compare les versions', async () => {
    const fetchMock = installBrowser(false);
    const { checkForUpdate } = await import('../versionService');
    const result = await checkForUpdate(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith('https://filarr-version.filarr-app.workers.dev/version?')).toBe(true);
    expect(result).toMatchObject({ updateAvailable: true, latestVersion: '99.0.0' });
  });
});
