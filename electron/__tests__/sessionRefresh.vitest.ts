/**
 * QUAND faire tourner le jeton de session — et quand ne surtout pas.
 *
 * CE QUI ÉTAIT CASSÉ, DEUX FOIS DE SUITE.
 *
 * D'abord la condition testait le TEXTE : `response.error?.includes('expired')`.
 * Le Worker prononce ce mot dans une quinzaine de refus qui n'ont rien à voir
 * avec notre jeton d'accès — `invitation_expired` (410), `invite_expired`,
 * « Invalid or expired upload token » (403), « Send expired »… Chacun
 * déclenchait une rotation parasite PUIS rejouait la requête, si bien qu'un
 * refus pouvait revenir DIFFÉRENT du premier.
 *
 * Puis la condition est devenue `httpStatus === 401`, juste pour le parcours
 * d'invitation mais trop LARGE : elle attrape aussi les 401 qui ne parlent pas
 * de notre jeton mais du secret que l'utilisateur vient de taper — « Invalid
 * code » sur la vérification 2FA, « Current password is incorrect » au
 * changement de mot de passe. Aucun d'eux ne porte de `code` (le Worker n'en met
 * pas sur ces routes) : c'est la ROUTE, et rien d'autre, qui les distingue.
 *
 * CE QUE ÇA COÛTAIT : un mauvais code 2FA faisait tourner la session puis
 * REJOUER la requête, donc vérifier deux fois le même secret erroné — un
 * compteur de limitation qui avance deux fois plus vite, et un second refus qui
 * n'est pas forcément le même que le premier.
 */

import { describe, it, expect, vi } from 'vitest';

// authService est un module du processus principal : il ouvre `electron`,
// `electron-log` et le gestionnaire de profils dès l'import. On ne teste ici que
// sa logique PURE, donc ces trois-là sont remplacés par des coquilles.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, getVersion: () => '0.0.0' },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('electron-log', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../profileManager', () => ({ default: { getActiveProfileId: () => null } }));

import { needsSessionRefresh } from '../authService';

/** La signature d'`authMiddleware` : 401, aucun `code`. */
const TOKEN_REFUSED = { success: false, error: 'Invalid or expired token', httpStatus: 401 };

describe('needsSessionRefresh', () => {
  it('tourne le jeton sur un 401 d’une route ordinaire', () => {
    for (const endpoint of ['/auth/me', '/org', '/vaults', '/sync/status/p1', '/account/devices']) {
      expect(needsSessionRefresh(endpoint, TOKEN_REFUSED), endpoint).toBe(true);
    }
  });

  it.each([
    ['/auth/change-password', 'Current password is incorrect'],
    ['/auth/2fa/verify-setup', 'Invalid code'],
    ['/auth/2fa/disable', 'Invalid password'],
    ['/auth/2fa/backup-codes/regenerate', 'Invalid TOTP code'],
    ['/account/recovery-phrase/regenerate', 'Invalid password'],
  ])('ne touche à rien sur %s, dont le 401 parle du secret saisi', (endpoint, error) => {
    // Ces refus ne portent AUCUN `code` — comme celui d'authMiddleware. Seule la
    // route les sépare, et c'est la propriété que ce test épingle.
    expect(needsSessionRefresh(endpoint, { success: false, error, httpStatus: 401 })).toBe(false);
  });

  it('ne se laisse pas contourner par une chaîne de requête', () => {
    expect(
      needsSessionRefresh('/auth/2fa/disable?x=1', { success: false, httpStatus: 401 })
    ).toBe(false);
  });

  it('ignore le TEXTE, dans les deux sens', () => {
    // Le mot « expired » ailleurs qu'en 401 ne dit rien de notre jeton…
    expect(
      needsSessionRefresh('/org/invitations/abc/accept', {
        success: false,
        error: 'Invitation expired',
        code: 'invitation_expired',
        httpStatus: 410,
      })
    ).toBe(false);
    // …et un 401 sans ce mot en dit tout.
    expect(
      needsSessionRefresh('/vaults', {
        success: false,
        error: 'Missing authorization token',
        httpStatus: 401,
      })
    ).toBe(true);
  });

  it('laisse un 403 tranquille : une permission ne se répare pas par un jeton neuf', () => {
    expect(
      needsSessionRefresh('/vaults/v1/join', {
        success: false,
        error: 'Forbidden',
        code: 'org_forbidden',
        httpStatus: 403,
      })
    ).toBe(false);
  });

  it('ne fait rien sur une réponse réussie', () => {
    expect(needsSessionRefresh('/auth/me', { success: true, httpStatus: 200 })).toBe(false);
  });

  it('ne fait rien quand le statut est inconnu (échec de transport)', () => {
    // `apiCall` n'a jamais atteint le serveur : rien ne dit que notre jeton est
    // en cause, et une rotation à l'aveugle brûlerait le jeton de rafraîchissement.
    expect(needsSessionRefresh('/auth/me', { success: false, error: 'Network error' })).toBe(false);
  });
});
