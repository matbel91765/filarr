/**
 * marketplaceSlice — l'état de la place de marché de greffons (P2).
 *
 * Rien à persister (blacklist redux-persist) : le catalogue est du serveur,
 * la liste installée dérive d'IndexedDB (pluginStorage) — un blob persisté ne
 * serait que du stale. Et JAMAIS d'octets de bundle dans Redux : seulement
 * des métadonnées.
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { apiListMarketplace, apiGetMarketplacePlugin } from '../../services/plugins/marketplaceApi';
import {
  compareSemver,
  type MarketplacePluginDetail,
  type MarketplacePluginSummary,
} from '../../services/plugins/marketplaceTypes';
import { installedPluginVersions } from '../../services/plugins/pluginStorage';
import {
  loadInstalledPlugins,
  type LoadedPluginState,
} from '../../services/plugins/installedPlugins';

export interface MarketplaceState {
  catalog: MarketplacePluginSummary[];
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  detailBySlug: Record<string, MarketplacePluginDetail>;
  installed: LoadedPluginState[];
  /** Combien de plugins installés ont une version plus récente en ligne. */
  updatesAvailable: number;
  /**
   * La SENTINELLE du comptage (motif fetchSharedWithMe) : la Sidebar ne
   * déclenche que sur 'idle', ce qui empêche une boucle de re-fetch à chaque
   * rendu. Remis à 'idle' par `marketplaceUpdatesInvalidated` après une
   * installation, une mise à jour ou une désinstallation.
   */
  updatesStatus: 'idle' | 'loading' | 'ready';
}

const initialState: MarketplaceState = {
  catalog: [],
  catalogStatus: 'idle',
  error: null,
  detailBySlug: {},
  installed: [],
  updatesAvailable: 0,
  updatesStatus: 'idle',
};

export const fetchMarketplaceCatalog = createAsyncThunk(
  'marketplace/fetchCatalog',
  async (args: { q?: string; category?: string } | undefined) =>
    apiListMarketplace(args?.q, undefined, args?.category)
);

/**
 * La PASTILLE de mise à jour — combien d'installés ont une version plus
 * récente en ligne.
 *
 * CE THUNK NE REJETTE JAMAIS, et ce n'est pas de la paresse : il tourne au
 * MONTAGE DE LA SIDEBAR, c'est-à-dire sur chaque écran de l'application. Une
 * rejection y produirait une action `rejected` non gérée à chaque démarrage
 * hors ligne, sur un poste sans IndexedDB (env de test, mode privé verrouillé)
 * ou pendant une panne d'API — pour une DÉCORATION. « Je ne sais pas » se dit
 * ici « zéro mise à jour connue » : aucune pastille, aucun bruit, et le prochain
 * passage recomptera.
 */
export const checkPluginUpdates = createAsyncThunk(
  'marketplace/checkUpdates',
  async (userId: string): Promise<number> => {
    if (typeof indexedDB === 'undefined') return 0;
    try {
      // Les MÉTADONNÉES seulement : jamais les bundles (installedPluginVersions
      // lit par curseur, borné au compte).
      const installés = await installedPluginVersions(userId);
      if (installés.length === 0) return 0;
      const catalogue = await apiListMarketplace();
      const dernières = new Map(catalogue.map((p) => [p.slug, p.latestVersion]));
      let n = 0;
      for (const rec of installés) {
        const enLigne = dernières.get(rec.slug);
        if (enLigne && compareSemver(enLigne, rec.installedVersion) > 0) n += 1;
      }
      return n;
    } catch {
      return 0;
    }
  }
);

export const fetchMarketplacePluginDetail = createAsyncThunk(
  'marketplace/fetchDetail',
  async (slug: string) => apiGetMarketplacePlugin(slug)
);

/** Relit IndexedDB, re-vérifie chaque record, (ré)enregistre les actifs. */
export const refreshInstalledPlugins = createAsyncThunk(
  'marketplace/refreshInstalled',
  async (userId: string) => loadInstalledPlugins(userId)
);

const marketplaceSlice = createSlice({
  name: 'marketplace',
  initialState,
  reducers: {
    /** Le compte est PÉRIMÉ (install / mise à jour / désinstallation) — la
     *  Sidebar recomptera au prochain rendu, sans que l'écran ait à connaître
     *  l'identifiant du compte. */
    marketplaceUpdatesInvalidated(state) {
      state.updatesStatus = 'idle';
      state.updatesAvailable = 0;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMarketplaceCatalog.pending, (state) => {
        state.catalogStatus = 'loading';
        state.error = null;
      })
      .addCase(fetchMarketplaceCatalog.fulfilled, (state, action) => {
        state.catalogStatus = 'ready';
        state.catalog = action.payload;
      })
      .addCase(fetchMarketplaceCatalog.rejected, (state, action) => {
        state.catalogStatus = 'error';
        state.error = action.error.message ?? 'marketplace_load_failed';
      })
      .addCase(fetchMarketplacePluginDetail.fulfilled, (state, action) => {
        state.detailBySlug[action.payload.slug] = action.payload;
      })
      .addCase(refreshInstalledPlugins.fulfilled, (state, action) => {
        state.installed = action.payload;
      })
      .addCase(checkPluginUpdates.pending, (state) => {
        state.updatesStatus = 'loading';
      })
      .addCase(checkPluginUpdates.fulfilled, (state, action) => {
        state.updatesStatus = 'ready';
        state.updatesAvailable = action.payload;
      })
      // Le thunk ne rejette pas ; si un jour il le faisait, la sentinelle doit
      // quand même retomber — sinon la Sidebar re-déclencherait sans fin.
      .addCase(checkPluginUpdates.rejected, (state) => {
        state.updatesStatus = 'ready';
        state.updatesAvailable = 0;
      });
  },
});

export const { marketplaceUpdatesInvalidated } = marketplaceSlice.actions;

export default marketplaceSlice.reducer;
