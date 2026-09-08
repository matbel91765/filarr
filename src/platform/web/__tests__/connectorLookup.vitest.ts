/**
 * Connecteurs de bases inline côté WEB — garde d'opt-in et forme du contrat.
 *
 * Ce que le test verrouille : tant que l'utilisateur n'a pas activé le relais
 * DES CONNECTEURS, aucune requête ne part (pas même une requête « inoffensive »
 * de recherche — les mots cherchés sont de la donnée personnelle). Le
 * consentement des aperçus de liens est un AUTRE consentement : aucun des deux
 * n'ouvre l'autre, dans aucun sens. Et une fois activé, le corps envoyé au
 * Worker ne contient JAMAIS d'URL : seulement `{ source, query, apiKey?, lang? }`,
 * l'URL amont étant fabriquée côté Worker depuis la liste blanche partagée.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { metaHandlers } from '../handlers/metaHandlers';
import {
  isConnectorProxyOptedIn,
  isMetaProxyOptedIn,
  setConnectorProxyOptIn,
  setMetaProxyOptIn,
} from '../handlers/metaHandlers';

const TMDB_KEY = '0123456789abcdef0123456789abcdef';

function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const lookup = metaHandlers['connectors:lookup'] as (input: unknown) => Promise<unknown>;
const fetchMeta = metaHandlers.fetchPageMetadata as (url: unknown) => Promise<unknown>;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeLocalStorage());
  fetchSpy = vi.fn(async () => ({
    status: 200,
    json: async () => ({ success: true, data: { docs: [{ title: 'Dune' }] } }),
  }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('garde d’opt-in', () => {
  it('sans accord explicite : null et ZÉRO requête réseau', async () => {
    await expect(lookup({ source: 'books', query: 'dune' })).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opt-in retiré après coup : la porte se referme', async () => {
    setConnectorProxyOptIn(true);
    await lookup({ source: 'books', query: 'dune' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    setConnectorProxyOptIn(false);
    await expect(lookup({ source: 'books', query: 'dune' })).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('DEUX consentements séparés — aucun n’ouvre l’autre', () => {
  it('accepter les aperçus de liens n’envoie AUCUN terme de recherche', async () => {
    setMetaProxyOptIn(true);
    expect(isConnectorProxyOptedIn()).toBe(false);
    await expect(lookup({ source: 'books', query: 'dune' })).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepter les connecteurs n’envoie AUCUNE URL de page', async () => {
    setConnectorProxyOptIn(true);
    expect(isMetaProxyOptedIn()).toBe(false);
    await expect(fetchMeta('https://exemple.test/article')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('les deux interrupteurs vivent sur deux clés distinctes', () => {
    setMetaProxyOptIn(true);
    setConnectorProxyOptIn(true);
    expect(localStorage.getItem('filarr-web-meta-proxy')).toBe('1');
    expect(localStorage.getItem('filarr-web-connectors')).toBe('1');

    setMetaProxyOptIn(false);
    expect(isMetaProxyOptedIn()).toBe(false);
    expect(isConnectorProxyOptedIn()).toBe(true);
  });
});

describe('appel proxifié', () => {
  beforeEach(() => setConnectorProxyOptIn(true));

  it('POST /meta/lookup, corps sans la moindre URL', async () => {
    const data = await lookup({ source: 'books', query: 'dune', lang: 'fr' });
    expect(data).toEqual({ docs: [{ title: 'Dune' }] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('https://api.filarr.com/meta/lookup');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['lang', 'query', 'source']);
    expect(body).toMatchObject({ source: 'books', query: 'dune', lang: 'fr' });
  });

  it('la clé d’API accompagne la requête TMDB, et rien d’autre', async () => {
    await lookup({ source: 'movies', query: 'akira', apiKey: TMDB_KEY });
    const [, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      source: 'movies',
      query: 'akira',
      apiKey: TMDB_KEY,
    });
  });

  it('entrée refusée par la liste blanche : aucun aller-retour', async () => {
    for (const input of [
      { source: 'evil', query: 'x' },
      { source: 'https://169.254.169.254/', query: 'x' },
      { source: 'books', query: '' },
      { source: 'books', query: 'a'.repeat(201) },
      { source: 'movies', query: 'akira' },
      null,
    ]) {
      await expect(lookup(input)).resolves.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('réponse en échec du Worker → null (jamais de throw)', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 502,
      json: async () => ({ success: false, error: 'Upstream error' }),
    });
    await expect(lookup({ source: 'tv', query: 'the wire' })).resolves.toBeNull();

    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    await expect(lookup({ source: 'tv', query: 'the wire' })).resolves.toBeNull();
  });
});
