/**
 * checkPluginUpdates — la pastille de mise à jour des plugins.
 *
 * CE THUNK TOURNE AU MONTAGE DE LA SIDEBAR, donc sur chaque écran de
 * l'application. Ce que ces tests défendent, dans l'ordre où ça saignerait :
 *
 *  · IL NE REJETTE JAMAIS. Une API tombée, un IndexedDB absent (env node, mode
 *    privé verrouillé), un stockage qui jette : chacun produisait une action
 *    `rejected` non gérée à chaque démarrage — pour une DÉCORATION. « Je ne
 *    sais pas » se dit ici « zéro », sans bruit.
 *  · IL COMPTE JUSTE. Seuls les slugs INSTALLÉS dont la version en ligne est
 *    STRICTEMENT plus récente comptent — pas les inconnus du catalogue, pas
 *    les égaux, pas les plus anciens (un serveur qui régresse ne fabrique pas
 *    une pastille).
 *  · IL LIT LES MÉTADONNÉES, jamais les bundles : `installedPluginVersions`
 *    (curseur borné au compte) et non `installedPluginsList` (getAll de tous
 *    les octets de tous les comptes).
 *  · LA SENTINELLE retombe : sans elle, la Sidebar re-déclencherait sans fin.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

vi.mock('../../../services/plugins/pluginStorage', () => ({
  installedPluginVersions: vi.fn(),
  installedPluginsList: vi.fn(),
}));

vi.mock('../../../services/plugins/marketplaceApi', () => ({
  apiListMarketplace: vi.fn(),
  apiGetMarketplacePlugin: vi.fn(),
}));

import * as storage from '../../../services/plugins/pluginStorage';
import * as api from '../../../services/plugins/marketplaceApi';
import marketplaceReducer, {
  checkPluginUpdates,
  marketplaceUpdatesInvalidated,
} from '../marketplaceSlice';
import type { MarketplacePluginSummary } from '../../../services/plugins/marketplaceTypes';

function makeStore() {
  return configureStore({ reducer: { marketplace: marketplaceReducer } });
}

function summary(slug: string, latestVersion: string): MarketplacePluginSummary {
  return {
    slug,
    name: slug,
    description: '',
    latestVersion,
    publisherFingerprint: '00000 11111 22222 33333 44444 55555',
    downloads: 0,
    status: 'published',
    updatedAt: '2026-08-01 00:00:00',
    ownedByMe: false,
  };
}

function installed(entries: Array<[string, string]>) {
  return entries.map(([slug, installedVersion]) => ({
    slug,
    installedVersion,
    enabled: true,
  }));
}

/**
 * L'env vitest est `node` : `indexedDB` n'y existe pas, et le thunk s'arrête
 * DÈS le premier `typeof`. Pour éprouver le comptage, on lui pose une présence
 * — le stockage lui-même est mocké, l'objet n'est jamais déréférencé.
 */
const G = globalThis as unknown as { indexedDB?: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  G.indexedDB = {};
});

afterEach(() => {
  delete G.indexedDB;
});

describe('checkPluginUpdates — le compte', () => {
  it('ne compte que les installés STRICTEMENT dépassés', async () => {
    vi.mocked(storage.installedPluginVersions).mockResolvedValue(
      installed([
        ['a-jour', '1.2.3'], // égal — pas une mise à jour
        ['en-retard', '1.0.0'], // 2.0.0 en ligne — compte
        ['tres-en-retard', '0.9.0'], // 1.0.1 en ligne — compte
        ['plus-au-catalogue', '1.0.0'], // absent du catalogue — ne compte pas
        ['serveur-regresse', '3.0.0'], // 2.0.0 en ligne — JAMAIS une pastille
      ])
    );
    vi.mocked(api.apiListMarketplace).mockResolvedValue([
      summary('a-jour', '1.2.3'),
      summary('en-retard', '2.0.0'),
      summary('tres-en-retard', '1.0.1'),
      summary('serveur-regresse', '2.0.0'),
      summary('jamais-installe', '9.9.9'), // du catalogue, pas de nous
    ]);

    const store = makeStore();
    await store.dispatch(checkPluginUpdates('u1'));
    expect(store.getState().marketplace.updatesAvailable).toBe(2);
    expect(store.getState().marketplace.updatesStatus).toBe('ready');
  });

  it('aucun plugin installé : zéro, et le catalogue n’est même pas demandé', async () => {
    vi.mocked(storage.installedPluginVersions).mockResolvedValue([]);
    const store = makeStore();
    await store.dispatch(checkPluginUpdates('u1'));
    expect(store.getState().marketplace.updatesAvailable).toBe(0);
    expect(api.apiListMarketplace).not.toHaveBeenCalled();
  });

  it('lit les MÉTADONNÉES, jamais les bundles', async () => {
    vi.mocked(storage.installedPluginVersions).mockResolvedValue(installed([['x', '1.0.0']]));
    vi.mocked(api.apiListMarketplace).mockResolvedValue([summary('x', '1.0.0')]);
    await makeStore().dispatch(checkPluginUpdates('u1'));
    expect(storage.installedPluginVersions).toHaveBeenCalledWith('u1');
    expect(storage.installedPluginsList).not.toHaveBeenCalled();
  });
});

describe('checkPluginUpdates — il ne rejette JAMAIS', () => {
  it('une API tombée donne zéro, pas une action rejected', async () => {
    vi.mocked(storage.installedPluginVersions).mockResolvedValue(installed([['x', '1.0.0']]));
    vi.mocked(api.apiListMarketplace).mockRejectedValue(new Error('network_unavailable'));

    const store = makeStore();
    const action = await store.dispatch(checkPluginUpdates('u1'));
    expect(action.type).toBe(checkPluginUpdates.fulfilled.type);
    expect(store.getState().marketplace.updatesAvailable).toBe(0);
    expect(store.getState().marketplace.updatesStatus).toBe('ready');
  });

  it('un stockage qui jette donne zéro', async () => {
    vi.mocked(storage.installedPluginVersions).mockRejectedValue(
      new Error('pluginStorage requires a browser context')
    );
    const store = makeStore();
    const action = await store.dispatch(checkPluginUpdates('u1'));
    expect(action.type).toBe(checkPluginUpdates.fulfilled.type);
    expect(store.getState().marketplace.updatesAvailable).toBe(0);
  });

  it('sans IndexedDB (env node), zéro sans même toucher au stockage', async () => {
    delete G.indexedDB;
    expect(typeof indexedDB).toBe('undefined');
    const store = makeStore();
    const action = await store.dispatch(checkPluginUpdates('u1'));
    expect(action.type).toBe(checkPluginUpdates.fulfilled.type);
    expect(store.getState().marketplace.updatesAvailable).toBe(0);
    expect(storage.installedPluginVersions).not.toHaveBeenCalled();
  });
});

describe('la sentinelle updatesStatus', () => {
  it('idle → loading → ready ; l’invalidation la ramène à idle et remet le compte à zéro', async () => {
    vi.mocked(storage.installedPluginVersions).mockResolvedValue(installed([['x', '1.0.0']]));
    vi.mocked(api.apiListMarketplace).mockResolvedValue([summary('x', '2.0.0')]);

    const store = makeStore();
    expect(store.getState().marketplace.updatesStatus).toBe('idle');
    const enVol = store.dispatch(checkPluginUpdates('u1'));
    expect(store.getState().marketplace.updatesStatus).toBe('loading');
    await enVol;
    expect(store.getState().marketplace.updatesStatus).toBe('ready');
    expect(store.getState().marketplace.updatesAvailable).toBe(1);

    // Après une installation : le compte affiché est périmé, on le retire tout
    // de suite plutôt que de laisser une pastille mentir le temps du recompte.
    store.dispatch(marketplaceUpdatesInvalidated());
    expect(store.getState().marketplace.updatesStatus).toBe('idle');
    expect(store.getState().marketplace.updatesAvailable).toBe(0);
  });
});
