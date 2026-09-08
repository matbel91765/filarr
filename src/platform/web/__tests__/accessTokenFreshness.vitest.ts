/**
 * LE JETON D'ACCÈS DU WEB : présent n'est pas valide.
 *
 * Ce test ne confronte AUCUNE doublure de `webApiBase` — c'est le vrai module
 * qui est importé, avec `fetch` seul stubé. C'est lui l'autorité : tout le reste
 * du web (le cycle de sync, `auth:getAccessToken` que lisent l'apiClient axios
 * et le billet de salle collab) lui demande le jeton et ne sait pas renouveler.
 *
 * CE QU'IL FERME (constaté le 31/08/2026 sur app.filarr.com). Le jeton dure
 * quinze minutes ; passé ce délai il restait en mémoire, périmé, et partait
 * quand même : `/sync/manifest`, `/collab/token` et `/vaults/heads` bouclaient
 * sur un 401 définitif jusqu'au rechargement de l'onglet, pendant que le cookie
 * de refresh valait encore quatre-vingt-dix jours.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let api: typeof import('../webApiBase');
let fetchMock: ReturnType<typeof vi.fn>;

/** Un JWT de forme réelle : seule la charge compte ici, la signature est décor. */
function jeton(expSeconds: number | null, marque = 'a'): string {
  const payload = expSeconds === null ? { sub: 'u1' } : { sub: 'u1', exp: expSeconds };
  const b64url = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `entete.${b64url}.signature-${marque}`;
}

const dansUneHeure = () => Math.floor(Date.now() / 1000) + 3600;
const ilYAUneHeure = () => Math.floor(Date.now() / 1000) - 3600;

/** Réponse de `/auth/refresh` telle que le Worker la rend. */
const refreshOk = (token: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: { accessToken: token } }),
});

beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  api = await import('../webApiBase');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fraîcheur du jeton en mémoire', () => {
  it('un jeton encore valable est frais, un jeton dépassé ne l’est pas', () => {
    api.setAccessToken(jeton(dansUneHeure()));
    expect(api.isAccessTokenFresh()).toBe(true);

    api.setAccessToken(jeton(ilYAUneHeure()));
    expect(api.isAccessTokenFresh()).toBe(false);
  });

  it('un jeton qui meurt dans dix secondes est déjà mort (marge de vol)', () => {
    api.setAccessToken(jeton(Math.floor(Date.now() / 1000) + 10));
    expect(api.isAccessTokenFresh()).toBe(false);
  });

  it('une charge illisible passe pour fraîche — on ne coupe pas un canal sur une lecture ratée', () => {
    api.setAccessToken('pas-du-tout-un-jwt');
    expect(api.isAccessTokenFresh()).toBe(true);
  });

  it('aucun jeton n’est jamais frais', () => {
    api.setAccessToken(null);
    expect(api.isAccessTokenFresh()).toBe(false);
  });
});

describe('ensureAccessToken — le jeton que reçoivent les appelants', () => {
  it('re-frappe un jeton dépassé via le cookie de refresh, et rend le neuf', async () => {
    const neuf = jeton(dansUneHeure(), 'neuf');
    fetchMock.mockResolvedValue(refreshOk(neuf));
    api.setAccessToken(jeton(ilYAUneHeure(), 'vieux'));

    expect(await api.ensureAccessToken()).toBe(neuf);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/refresh');
    // L'échéance suit le jeton : sans ça le suivant repartirait en re-frappe.
    expect(api.isAccessTokenFresh()).toBe(true);
  });

  it('ne frappe PAS le Worker quand le jeton tient encore', async () => {
    const bon = jeton(dansUneHeure());
    api.setAccessToken(bon);

    expect(await api.ensureAccessToken()).toBe(bon);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sans jeton en mémoire, rend null SANS frapper /auth/refresh', async () => {
    // La restauration au boot (authHandlers) est seule responsable de ce cas :
    // un onglet purement local ne doit pas marteler le Worker à chaque appel.
    api.setAccessToken(null);

    expect(await api.ensureAccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un refresh refusé rend le jeton périmé plutôt que rien — pas de panne PIRE', async () => {
    const vieux = jeton(ilYAUneHeure(), 'vieux');
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    api.setAccessToken(vieux);

    // Rendre `null` ferait lire « aucune session » à l'apiClient sur une simple
    // horloge locale en avance ; le 401 du serveur reste le seul juge.
    expect(await api.ensureAccessToken()).toBe(vieux);
  });

  it('vingt appelants réveillés ensemble ne font QU’UN /auth/refresh', async () => {
    // Chaque réponse de `/auth/refresh` ROTE le cookie : une salve en produirait
    // une où les dernières présentent un refresh déjà consommé, et se feraient
    // jeter — ce qui déconnecte une session parfaitement valide.
    const neuf = jeton(dansUneHeure(), 'neuf');
    let resoudre: () => void = () => undefined;
    const enVol = new Promise<void>((r) => {
      resoudre = r;
    });
    fetchMock.mockImplementation(async () => {
      await enVol;
      return refreshOk(neuf);
    });
    api.setAccessToken(jeton(ilYAUneHeure(), 'vieux'));

    const tous = Promise.all(Array.from({ length: 20 }, () => api.ensureAccessToken()));
    resoudre();

    expect(await tous).toEqual(Array.from({ length: 20 }, () => neuf));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('apiFetch — renouvelle avant de partir', () => {
  it('un jeton dépassé est re-frappé AVANT l’appel, qui part avec le neuf', async () => {
    const neuf = jeton(dansUneHeure(), 'neuf');
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) return refreshOk(neuf);
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });
    api.setAccessToken(jeton(ilYAUneHeure(), 'vieux'));

    await api.apiFetch('/sync/profiles');

    const appelMetier = fetchMock.mock.calls.find(
      (c) => !String(c[0]).includes('/auth/refresh')
    ) as [string, { headers: Record<string, string> }];
    expect(appelMetier[1].headers.Authorization).toBe(`Bearer ${neuf}`);
    // Un seul aller-retour refusé évité : le retry sur 401 n'a pas eu à servir.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('`auth: false` ne renouvelle rien et ne porte aucun jeton', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
    api.setAccessToken(jeton(ilYAUneHeure(), 'vieux'));

    await api.apiFetch('/auth/login', { method: 'POST', auth: false, body: {} });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBeUndefined();
  });
});
