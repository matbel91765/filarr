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
import pomodoroReducer from './slices/pomodoroSlice';

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
  pomodoro: PomodoroState;
}

// Transform pour migrer le slice tabs de l'ancien format plat vers le format panel-based
const tabsMigrationTransform = createTransform(
  // inbound: no change when persisting
  (inboundState: any) => inboundState,
  // outbound: detect old flat format and migrate on rehydration
  (outboundState: any, _key) => {
    if (outboundState && outboundState.tabs && !outboundState.panels) {
      // Old flat format: { tabs: TabInfo[], activeTabId: string, maxTabs: number }
      return {
        panels: [
          {
            id: 'panel-main',
            tabs: outboundState.tabs,
            activeTabId: outboundState.activeTabId || 'home',
          },
        ],
        focusedPanelId: 'panel-main',
        splitDirection: 'none',
        splitRatio: 0.5,
        maxTabs: outboundState.maxTabs || 15,
      };
    }
    return outboundState;
  },
  { whitelist: ['tabs'] }
);

// Configuration pour la persistance
const persistConfig = {
  key: 'root',
  storage: profilePersistStorage,
  // ui et search sont exclus car ils contiennent des données temporaires
  // profiles is excluded because it's fetched from main process via IPC
  // notes is excluded because it's persisted to encrypted disk via IPC (notes:save/notes:load)
  blacklist: ['ui', 'search', 'profiles', 'notes', 'pomodoro'],
  transforms: [tabsMigrationTransform],
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
  pomodoro: pomodoroReducer,
});

// Wrapper: intercepte RESET_APP_DATA pour reset tous les slices sauf auth/ui/settings/profiles
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

// Export du store par défaut
export default store;
