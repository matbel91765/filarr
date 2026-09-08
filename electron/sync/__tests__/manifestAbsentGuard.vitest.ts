/**
 * « Manifeste absent » n'est une vérité QUE sur un profil neuf.
 *
 * Le défaut : un magasin injoignable (bucket BYOS en 403 après révocation de
 * la clé, 5xx, délai dépassé) faisait rendre `manifest: null`. Le cycle lisait
 * « le nuage est vide », fusionnait le manifeste local dans du vide, et
 * repoussait le résultat en version N+1 — tout fichier absent de CET appareil
 * disparaissait du manifeste distant.
 *
 * Le Worker rend désormais 503 dans ce cas. Ce test garde la SECONDE serrure,
 * côté client : une version distante non nulle sans manifeste est incohérente,
 * quelle que soit la raison, et interrompt le cycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../authService', () => ({
  default: {},
  API_BASE: 'https://api.filarr.test',
  getAccessToken: vi.fn(async () => 'tok'),
  authenticatedApiCall: vi.fn(),
  // Le module réel enveloppe fetch d'un AbortController ; ici on veut voir la
  // réponse stubée telle quelle.
  fetchWithTimeout: vi.fn(async (url: string, init?: RequestInit) => fetch(url, init)),
}));

import { getManifest } from '../syncR2Client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getManifest — absent vs incohérent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepte l’absence sur un profil NEUF (version 0)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: { manifest: null, version: 0 } }))
    );
    const res = await getManifest('p1');
    expect(res.manifest).toBeNull();
    expect(res.version).toBe(0);
  });

  it('REFUSE un manifeste absent alors que la version distante a avancé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: { manifest: null, version: 7 } }))
    );
    await expect(getManifest('p1')).rejects.toThrow(/version distante est 7/);
  });

  it('remonte le 503 du Worker au lieu de le lire comme un nuage vide', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { success: false, error: 'Storage backend unreachable', code: 'storage_unreachable' },
          503
        )
      )
    );
    await expect(getManifest('p1')).rejects.toThrow(/503/);
  });
});
