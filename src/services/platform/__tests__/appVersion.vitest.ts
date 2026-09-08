/**
 * La version annoncée, selon la plateforme.
 *
 * Le client web s'annonçait « dev-web » en production : `REACT_APP_VERSION`
 * n'était jamais posé au build et `__FILARR_VERSION__` n'était défini nulle
 * part. config-overrides.js injecte désormais la version de package.json ; ici
 * on épingle la résolution (suffixe web, pas de récursion avec le shim).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

describe('getAppVersion', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { window?: unknown }).window;
  });

  it('bureau : la version du build, telle quelle', async () => {
    vi.stubEnv('REACT_APP_VERSION', '9.9.9');
    defineGlobal('window', {});
    const { getAppVersion, getBuildVersion } = await import('../appVersion');
    expect(getBuildVersion()).toBe('9.9.9');
    expect(getAppVersion()).toBe('9.9.9');
  });

  it('web : la même version, suffixée -web', async () => {
    vi.stubEnv('REACT_APP_VERSION', '9.9.9');
    defineGlobal('window', { __FILARR_WEB__: true });
    const { getAppVersion } = await import('../appVersion');
    expect(getAppVersion()).toBe('9.9.9-web');
  });

  it('sans version de build : le pont (ou le shim web) décide, sans boucle', async () => {
    vi.stubEnv('REACT_APP_VERSION', '');
    const getVersion = vi.fn(() => '1.2.3-web');
    defineGlobal('window', { __FILARR_WEB__: true, electronAPI: { getVersion } });
    const { getAppVersion, getBuildVersion } = await import('../appVersion');
    expect(getBuildVersion()).toBeNull();
    expect(getAppVersion()).toBe('1.2.3-web');
    expect(getVersion).toHaveBeenCalledTimes(1);
  });
});
