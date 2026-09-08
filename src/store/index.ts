/**
 * Configuration du store Redux
 *
 * Ce fichier configure le store Redux central qui va gérer tout l'état de l'application.
 * Il combine les différents reducers, configure les middleware et permet la persistance.
 */

import { configureStore, combineReducers, Middleware } from '@reduxjs/toolkit';
import { persistStore, persistReducer, PERSIST, REHYDRATE, createTransform } from 'redux-persist';
import logger from 'redux-logger';
import electronMiddleware from './middleware/electronMiddleware';

// Import des reducers (slices) TypeScript
import foldersReducer from './slices/foldersSlice';
import filesReducer from './slices/filesSlice';
import uiReducer from './slices/uiSlice';
import authReducer from './slices/authSlice';
import searchReducer from './slices/searchSlice';
import settingsReducer from './slices/settingsSlice';
import trashReducer from './slices/trashSlice';
import collectionsReducer from './slices/collectionsSlice';
import versionsReducer from './slices/versionsSlice';
import favoritesReducer from './slices/favoritesSlice';
import tagsReducer from './slices/tagsSlice';
import savedFiltersReducer from './slices/savedFiltersSlice';
import tabsReducer from './slices/tabsSlice';
import profilesReducer from './slices/profilesSlice';
import automationReducer from './slices/automationSlice';
import notesReducer from './slices/notesSlice';
import syncReducer from './slices/syncSlice';
import pomodoroReducer from './slices/pomodoroSlice';
import sharesReducer from './slices/sharesSlice';
import orgReducer from './slices/orgSlice';
import vaultsReducer from './slices/vaultsSlice';
import sharedWithMeReducer from './slices/sharedWithMeSlice';
import marketplaceReducer from './slices/marketplaceSlice';
import auditReducer from './slices/auditSlice';
import governanceReducer from './slices/governanceSlice';
import layoutReducer from './slices/layoutSlice';
import shareIndexReducer from './slices/shareIndexSlice';
import { rewriteLegacyTabRoutes } from '../renderer/components/layout/RouteContent/routeCompat';

// Import des types de state
import type { FoldersState } from './slices/foldersSlice';
import type { FilesState } from './slices/filesSlice';
import type { UIState } from './slices/uiSlice';
import type { AuthState } from './slices/authSlice';
import type { SearchState } from './slices/searchSlice';
import type { SettingsState } from './slices/settingsSlice';
import type { TrashState } from './slices/trashSlice';
import type { CollectionsState } from './slices/collectionsSlice';
import type { VersionsState } from './slices/versionsSlice';
import type { FavoritesState } from './slices/favoritesSlice';
import type { TagsState } from './slices/tagsSlice';
import type { SavedFiltersState } from './slices/savedFiltersSlice';
import type { TabsState } from './slices/tabsSlice';
import type { ProfilesState } from './slices/profilesSlice';
import type { NotesState } from './slices/notesSlice';
import type { PomodoroState } from './slices/pomodoroSlice';
import type { SharesState } from './slices/sharesSlice';
import type { OrgState } from './slices/orgSlice';
import type { VaultsState } from './slices/vaultsSlice';
import type { AuditState } from './slices/auditSlice';
import type { GovernanceState } from './slices/governanceSlice';
import type { LayoutState } from './slices/layoutSlice';
import type { ShareIndexState } from './slices/shareIndexSlice';
import { profilePersistStorage, setActiveProfile } from '../services/core/profileStorage';

// Restore last active profile BEFORE redux-persist rehydrates
// so that profilePersistStorage reads from the correct prefixed keys
const savedProfileId = localStorage.getItem('filarr-active-profile');
if (savedProfileId) {
  setActiveProfile(savedProfileId);
}

// Type pour le RootState
export interface RootState {
  folders: FoldersState;
  files: FilesState;
  ui: UIState;
  auth: AuthState;
  search: SearchState;
  settings: SettingsState;
  trash: TrashState;
  collections: CollectionsState;
  versions: VersionsState;
  favorites: FavoritesState;
  tags: TagsState;
  savedFilters: SavedFiltersState;
  tabs: TabsState;
  profiles: ProfilesState;
  notes: NotesState;
  sync: import('./slices/syncSlice').SyncSliceState;
  pomodoro: PomodoroState;
  shares: SharesState;
  org: OrgState;
  vaults: VaultsState;
  sharedWithMe: import('./slices/sharedWithMeSlice').SharedWithMeState;
  marketplace: import('./slices/marketplaceSlice').MarketplaceState;
  audit: AuditState;
  governance: GovernanceState;
  layout: LayoutState;
  shareIndex: ShareIndexState;
}

// Transform pour migrer le slice tabs de l'ancien format plat vers le format panel-based
const tabsMigrationTransform = createTransform(
  // inbound: no change when persisting
  (inboundState: any) => inboundState,
  // outbound: detect old flat format and migrate on rehydration
  (outboundState: any, _key) => {
    let state = outboundState;
    if (state && state.tabs && !state.panels) {
      // Old flat format: { tabs: TabInfo[], activeTabId: string, maxTabs: number }
      state = {
        panels: [
          {
            id: 'panel-main',
            tabs: state.tabs,
            activeTabId: state.activeTabId || 'home',
          },
        ],
        focusedPanelId: 'panel-main',
        splitDirection: 'none',
        splitRatio: 0.5,
        maxTabs: state.maxTabs || 15,
      };
    }
    // Routes ANCIENNES (`/vaults`, `/vaults/<id>`) réécrites à la réhydratation
    // (lot A, C3) : un onglet persisté avant la route profonde `/vault-folder/<id>`
    // doit rouvrir le même coffre, pas un 404 — et ce dès la lecture du blob,
    // pour que `RouteContent`, la barre d'onglets et le titre de fenêtre ne
    // voient jamais l'orthographe legacy. Fonction pure, testée à part.
    return rewriteLegacyTabRoutes(state);
  },
  { whitelist: ['tabs'] }
);

/**
 * LE VERROU NE SE PERSISTE PAS.
 *
 * `auth` n'est pas dans la liste noire : tout le slice part sur disque,
 * `isLocked` compris. Un verrouillage — inactivite, deconnexion, geste depuis
 * la zone de notification — revenait donc TEL QUEL au lancement suivant, et
 * rien ne le levait : `unlockApp` n'est dispatche que par les deux ecrans de
 * verrouillage eux-memes. L'application reclamait le mot de passe du coffre
 * alors que la FEK etait parfaitement restaurable depuis `.fek_safe`, sans
 * qu'aucun reglage de securite ne le demande. Et comme `auth` survit a
 * `resetAppData`, le verrou d'un profil suivait meme le changement de profil.
 *
 * Le verrou est un fait de SESSION. Au demarrage, App.tsx le RECALCULE depuis
 * l'etat reel des cles (Enhanced Lock, `.fek_safe`, `wrapped_fek.json`) : il
 * n'y a donc rien a garder d'une session a l'autre. Neutralise dans les deux
 * sens pour que les blobs deja ecrits avant ce correctif cessent de verrouiller.
 */
const authLockTransform = createTransform(
  (inboundState: any) =>
    inboundState ? { ...inboundState, isLocked: false, lockReason: null } : inboundState,
  (outboundState: any) =>
    outboundState ? { ...outboundState, isLocked: false, lockReason: null } : outboundState,
  { whitelist: ['auth'] }
);

// Configuration pour la persistance
const persistConfig = {
  key: 'root',
  storage: profilePersistStorage,
  // ui et search sont exclus car ils contiennent des données temporaires
  // profiles is excluded because it's fetched from main process via IPC
  // notes is excluded because it's persisted to encrypted disk via IPC (notes:save/notes:load)
  // vaults is excluded: shared-vault content is E2EE with the cloud as source of
  // truth, so its decrypted metadata must never be written to local persisted storage.
  // governance is excluded: the policy is re-hydrated from the on-disk cache (org:policy:load) +
  // re-fetched online (E9-10); it must never stale-load from the persisted redux blob.
  blacklist: [
    'ui',
    'search',
    'profiles',
    'notes',
    'sync',
    'pomodoro',
    'org',
    'vaults',
    // shareIndex : l'index des partages (lot B3) dérive du nuage et de contenu
    // déchiffré — même raison que `vaults`, jamais sur disque.
    'shareIndex',
    'audit',
    // sharedWithMe is excluded for the same reason as vaults: decrypted item
    // metadata + sealed K_item wraps, cloud = source of truth — never on disk.
    'sharedWithMe',
    // marketplace : catalogue = serveur, installés = IndexedDB — rien à persister.
    'marketplace',
    'governance',
    // layout est exclu : la source de vérité est le conteneur chiffré
    // `layout.enc` du profil (lu par `layout:load`, fusionné vue à vue par la
    // sync). Le persister dans le blob redux en ferait une seconde vérité, qui
    // se désynchroniserait dès la première fusion venue d'un autre appareil —
    // et qui survivrait au changement de profil par une clé mal préfixée.
    'layout',
  ],
  transforms: [tabsMigrationTransform, authLockTransform],
};

// Action pour reset global des donnees (logout, changement de compte/profil)
const RESET_APP_DATA = 'app/resetData';
export const resetAppData = () => ({ type: RESET_APP_DATA });

// Combiner tous les reducers
const appReducer = combineReducers({
  folders: foldersReducer,
  files: filesReducer,
  ui: uiReducer,
  auth: authReducer,
  search: searchReducer,
  settings: settingsReducer,
  trash: trashReducer,
  collections: collectionsReducer,
  versions: versionsReducer,
  favorites: favoritesReducer,
  tags: tagsReducer,
  savedFilters: savedFiltersReducer,
  tabs: tabsReducer,
  profiles: profilesReducer,
  automation: automationReducer,
  notes: notesReducer,
  sync: syncReducer,
  pomodoro: pomodoroReducer,
  shares: sharesReducer,
  org: orgReducer,
  vaults: vaultsReducer,
  sharedWithMe: sharedWithMeReducer,
  marketplace: marketplaceReducer,
  audit: auditReducer,
  governance: governanceReducer,
  layout: layoutReducer,
  shareIndex: shareIndexReducer,
});

// Wrapper: intercepte RESET_APP_DATA pour reset tous les slices sauf auth/ui/settings/profiles
//
// `layout` N'EST PAS DANS LA LISTE PRÉSERVÉE, et ce n'est pas un oubli : une
// mise en page cite des identifiants de dossiers du profil qu'on quitte. La
// garder ferait fuir la disposition — et ces identifiants — dans le profil
// suivant, qui ne les connaît pas. Elle est réhydratée depuis le disque du
// nouveau profil par `loadLayoutFromDisk` (App.tsx, handleProfileSelected).
const rootReducer: typeof appReducer = (state, action) => {
  if (action.type === RESET_APP_DATA) {
    return appReducer(
      {
        auth: state?.auth,
        ui: state?.ui,
        settings: state?.settings,
        profiles: state?.profiles,
      } as any,
      action
    );
  }
  return appReducer(state, action);
};

// Créer le reducer persistant
// @ts-expect-error: Redux Persist type compatibility issue
const persistedReducer = persistReducer(persistConfig, rootReducer) as typeof rootReducer;

// Middleware personnalisé pour gérer les erreurs
const errorMiddleware: Middleware<object, RootState> = (_store) => (next) => (action) => {
  try {
    return next(action);
  } catch (error) {
    console.error('Error in Redux action:', error);
    return next({ type: 'ERROR', payload: error, error: true });
  }
};

// Configuration du store avec les middleware personnalisés
const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          PERSIST,
          REHYDRATE,
          'files/addToFolder/pending',
          'files/addToFolder/fulfilled',
        ],
        ignoredActionPaths: [
          'payload.file',
          'meta.arg.file',
          'meta.arg.file.content',
          'meta.arg.content',
          'payload.content',
          'payload.items',
        ],
        ignoredPaths: ['files.uploadProgress', 'files.downloadProgress'],
      },
    }).concat(
      errorMiddleware,
      electronMiddleware as unknown as Middleware<object, RootState>,
      ...(process.env.NODE_ENV !== 'production' ? [logger] : [])
    ),
  devTools: process.env.NODE_ENV !== 'production',
});

// Type pour AppDispatch
export type AppDispatch = typeof store.dispatch;

// Création du persistor pour PersistGate
export const persistor = persistStore(store);

// Expose the store on `window` in dev so we can poke at it from the
// DevTools console (e.g. `window.__REDUX_STORE__.getState().folders.byId`).
// Gated on NODE_ENV so production bundles don't leak the store.
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { __REDUX_STORE__: typeof store }).__REDUX_STORE__ = store;
}

// Export du store par défaut
export default store;
