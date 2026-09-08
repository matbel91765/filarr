/**
 * Le point d'étranglement des canaux auth:* et le dispatcher web.
 *
 * Sur app.filarr.com, `window.electron.ipcRenderer` est le dispatcher web, qui
 * LÈVE sur un canal sans handler (2FA, appareils, régénération de phrase…).
 * Les appelants lisent `result.success` sans try/catch : la promesse partait en
 * rejet non géré et la modale restait sur son spinner. `invokeAuth` convertit
 * ces deux refus-là — et seulement eux — en enveloppe d'échec.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelNotImplementedError, ChannelUnavailableError } from '../../../platform/web/errors';

// Le message est traduit par le catalogue de l'application ; ici on ne charge
// pas i18next, on vérifie seulement que la clé et son repli sont ceux attendus.
vi.mock('../../../i18n/config', () => ({
  default: {
    t: (key: string, fallback: string) =>
      key === 'settings.webUnavailable' ? `[traduit] ${fallback}` : fallback,
  },
}));

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

function installBridge(invoke: Invoke): void {
  Object.defineProperty(globalThis, 'window', {
    value: { electron: { ipcRenderer: { invoke } }, __FILARR_WEB__: true },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('authApi sur le dispatcher web', () => {
  it('un canal pas encore porté rend une enveloppe d’échec, jamais un rejet', async () => {
    installBridge(async (channel) => {
      throw new ChannelNotImplementedError(channel, 'M2');
    });
    const { setup2FA, getDevices, WEB_UNAVAILABLE_CODE, WEB_UNAVAILABLE_ERROR } =
      await import('../authApi');
    await expect(setup2FA()).resolves.toEqual({
      success: false,
      error: `[traduit] ${WEB_UNAVAILABLE_ERROR}`,
      code: WEB_UNAVAILABLE_CODE,
    });
    await expect(getDevices()).resolves.toMatchObject({ success: false });
  });

  it('un canal desktop-only aussi', async () => {
    installBridge(async (channel) => {
      throw new ChannelUnavailableError(channel, 'desktop-only');
    });
    const { regenerateRecoveryPhrase } = await import('../authApi');
    await expect(regenerateRecoveryPhrase('pw')).resolves.toMatchObject({
      success: false,
      code: 'web_unavailable',
    });
  });

  it('une exception QUELCONQUE du pont continue de se propager', async () => {
    // Masquer un vrai défaut du bureau derrière « indisponible » cacherait le
    // défaut : seuls les deux refus du dispatcher web sont convertis.
    installBridge(async () => {
      throw new Error('main exploded');
    });
    const { disable2FA } = await import('../authApi');
    await expect(disable2FA('pw', '000000')).rejects.toThrow('main exploded');
  });

  it('une réponse normale passe intacte, avec ses arguments', async () => {
    const invoke = vi.fn<Invoke>(async () => ({ success: true, data: { backupCodes: ['a'] } }));
    installBridge(invoke);
    const { verifySetup2FA } = await import('../authApi');
    await expect(verifySetup2FA('123456')).resolves.toEqual({
      success: true,
      data: { backupCodes: ['a'] },
    });
    expect(invoke).toHaveBeenCalledWith('auth:verifySetup2FA', '123456');
  });
});
