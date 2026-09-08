/**
 * 401 sur le web : UN retry après refresh-cookie — la branche axios qui manquait.
 *
 * Le défaut réel (web, 2026-09-01) : `ensureAccessToken` rend VOLONTAIREMENT le
 * jeton périmé quand un refresh échoue sur une panne passagère ; `apiFetch`
 * rattrape au 401 suivant, mais tout ce qui passe par axios (coffres, orgs)
 * n'avait pas ce rattrapage — le web ne pose jamais le `refreshToken` module.
 * Le 401 se lisait `session_expired`, TERMINAL : l'accueil perdait ses coffres
 * pour toute la session d'onglet, sans un mot, selon l'âge du jeton au
 * chargement de la page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosRequestConfig } from 'axios';

/**
 * COMME SUR LE VRAI WEB : le module `authToken` d'apiClient reste NUL, le
 * jeton vient du shim (`auth:getAccessToken` → ensureAccessToken) À CHAQUE
 * tentative — y compris le retry, dont l'intercepteur de requête réécrit
 * l'en-tête. Le refresh-cookie change donc ce que le shim rend ensuite.
 */
const { tokenState, refreshViaCookie, ensureAccessToken } = vi.hoisted(() => {
  const tokenState = { current: 'jeton-perime' };
  return {
    tokenState,
    refreshViaCookie: vi.fn(async () => {
      tokenState.current = 'jeton-frais';
      return true;
    }),
    ensureAccessToken: vi.fn(async () => tokenState.current),
  };
});

vi.mock('../../platform/isWebPlatform', () => ({ isWebPlatform: () => true }));
vi.mock('../../../platform/web/webApiBase', () => ({ refreshViaCookie, ensureAccessToken }));

vi.stubGlobal('window', {
  electron: {
    ipcRenderer: {
      invoke: async (channel: string) =>
        channel === 'auth:getAccessToken' ? tokenState.current : null,
    },
  },
});

import apiClient from '../apiClient';

/**
 * Un adapter maison doit REJETER lui-même les statuts d'erreur (le `settle`
 * vit dans les adapters d'axios, pas dans dispatchRequest) — résoudre un 401
 * le ferait passer pour un succès et l'intercepteur ne verrait rien.
 */
function reject401(config: AxiosRequestConfig): Promise<never> {
  const err = Object.assign(new Error('Request failed with status code 401'), {
    isAxiosError: true,
    config,
    response: { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config },
  });
  return Promise.reject(err);
}

describe('apiClient — 401 web', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenState.current = 'jeton-perime';
  });

  it('rejoue UNE fois avec le jeton re-frappé, et la requête aboutit', async () => {
    const seen: Array<string | undefined> = [];
    apiClient.defaults.adapter = (async (config: AxiosRequestConfig) => {
      seen.push(String(config.headers?.Authorization ?? ''));
      if (seen.length === 1) return reject401(config);
      return { status: 200, statusText: 'OK', data: { success: true }, headers: {}, config };
    }) as never;

    const res = await apiClient.get('/vaults');
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe('Bearer jeton-perime');
    expect(seen[1]).toBe('Bearer jeton-frais');
    expect(refreshViaCookie).toHaveBeenCalledTimes(1);
  });

  it('quand le refresh-cookie échoue, le 401 d’origine reste la réponse (pas de boucle)', async () => {
    refreshViaCookie.mockResolvedValueOnce(false);
    let calls = 0;
    apiClient.defaults.adapter = (async (config: AxiosRequestConfig) => {
      calls++;
      return reject401(config);
    }) as never;

    await expect(apiClient.get('/vaults')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(calls).toBe(1); // pas de retry sans jeton frais, pas de boucle
  });
});
