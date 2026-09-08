/**
 * Les canaux de gestion de compte, servis sur le web.
 *
 * LE TROU. `auth:setup2FA`, `auth:getDevices`, `auth:regenerateRecoveryPhrase`…
 * étaient CLASSÉS (api/M1) mais pas SERVIS : ouvrir « Activer la 2FA » ou
 * « Appareils connectés » sur app.filarr.com faisait lever le dispatcher —
 * spinner figé, rejet non géré (balayage du 2026-08-28). Chaque relais rend
 * l'enveloppe du Worker telle quelle : c'est la forme que authApi.ts promet aux
 * modales.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webInvoke } from '../dispatcher';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { success: true } };

beforeEach(() => {
  calls = [];
  reply = { status: 200, body: { success: true } };
  (globalThis as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return {
      status: reply.status,
      ok: reply.status < 400,
      json: async () => reply.body,
    } as unknown as Response;
  });
});

describe('relais de gestion de compte', () => {
  it('auth:setup2FA → POST /auth/2fa/setup, enveloppe intacte', async () => {
    reply = {
      status: 200,
      body: { success: true, data: { secret: 'S', otpauthUrl: 'otpauth://x' } },
    };
    const res = await webInvoke('auth:setup2FA');
    expect(res).toEqual({ success: true, data: { secret: 'S', otpauthUrl: 'otpauth://x' } });
    expect(calls[0]).toMatchObject({
      url: 'https://api.filarr.com/auth/2fa/setup',
      method: 'POST',
    });
  });

  it('auth:verifySetup2FA porte le code, et rend les codes de secours', async () => {
    reply = { status: 200, body: { success: true, data: { backupCodes: ['a', 'b'] } } };
    const res = await webInvoke('auth:verifySetup2FA', '123456');
    expect(res).toMatchObject({ success: true, data: { backupCodes: ['a', 'b'] } });
    expect(calls[0]).toMatchObject({
      url: 'https://api.filarr.com/auth/2fa/verify-setup',
      method: 'POST',
      body: { code: '123456' },
    });
  });

  it('auth:disable2FA et auth:regenerateBackupCodes portent mot de passe + code', async () => {
    await webInvoke('auth:disable2FA', 'pw', '000000');
    await webInvoke('auth:regenerateBackupCodes', 'pw', '111111');
    expect(calls[0]).toMatchObject({
      url: 'https://api.filarr.com/auth/2fa/disable',
      body: { password: 'pw', code: '000000' },
    });
    expect(calls[1]).toMatchObject({
      url: 'https://api.filarr.com/auth/2fa/backup-codes/regenerate',
      body: { password: 'pw', code: '111111' },
    });
  });

  it('auth:regenerateRecoveryPhrase omet le code quand il n’y en a pas (compte sans 2FA)', async () => {
    reply = { status: 200, body: { success: true, data: { recoveryCodes: ['w1', 'w2'] } } };
    const res = await webInvoke('auth:regenerateRecoveryPhrase', 'pw');
    expect(res).toMatchObject({ success: true, data: { recoveryCodes: ['w1', 'w2'] } });
    expect(calls[0]).toMatchObject({
      url: 'https://api.filarr.com/account/recovery-phrase/regenerate',
      body: { password: 'pw' },
    });
    expect((calls[0].body as Record<string, unknown>).code).toBeUndefined();

    await webInvoke('auth:regenerateRecoveryPhrase', 'pw', '222222');
    expect(calls[1].body).toEqual({ password: 'pw', code: '222222' });
  });

  it('auth:getDevices / auth:deleteDevice → /account/devices', async () => {
    reply = { status: 200, body: { success: true, data: { devices: [{ id: 'd1' }] } } };
    const list = await webInvoke('auth:getDevices');
    expect(list).toMatchObject({ success: true, data: { devices: [{ id: 'd1' }] } });
    expect(calls[0]).toMatchObject({
      url: 'https://api.filarr.com/account/devices',
      method: 'GET',
    });

    reply = { status: 200, body: { success: true } };
    await webInvoke('auth:deleteDevice', 'd 1/x');
    expect(calls[1]).toMatchObject({
      url: 'https://api.filarr.com/account/devices/d%201%2Fx',
      method: 'DELETE',
    });
  });

  it('auth:changePassword suit le rescellement local de la FEK', async () => {
    await webInvoke('auth:changePassword', 'old', 'newnewnew');
    expect(calls[0]).toMatchObject({
      url: 'https://api.filarr.com/auth/change-password',
      method: 'POST',
      body: { currentPassword: 'old', newPassword: 'newnewnew' },
    });
  });

  it('un refus du serveur traverse avec son message ; un corps non-JSON devient un échec lisible', async () => {
    reply = { status: 401, body: { success: false, error: 'Invalid code' } };
    await expect(webInvoke('auth:disable2FA', 'pw', 'bad')).resolves.toEqual({
      success: false,
      error: 'Invalid code',
    });

    reply = { status: 502, body: null };
    await expect(webInvoke('auth:getDevices')).resolves.toEqual({
      success: false,
      error: 'HTTP 502',
    });
  });
});
