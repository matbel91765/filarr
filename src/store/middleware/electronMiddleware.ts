/**
 * Middleware Redux pour la communication avec Electron
 *
 * Synchronise les actions Redux importantes avec le processus principal.
 */

import { Middleware, AnyAction, isFulfilled, isRejected } from '@reduxjs/toolkit';
import { RootState } from '../../types';

const electronMiddleware: Middleware<object, RootState> =
  (_store) => (next) => (action: unknown) => {
    const electron = window.electron;
    const result = next(action);

    if (!electron || !electron.ipcRenderer) {
      return result;
    }

    const typedAction = action as AnyAction;

    switch (typedAction.type) {
      case 'files/addFileRequested':
        electron.ipcRenderer.invoke('add-file', typedAction.payload);
        break;
      case 'files/exportFileRequested':
        electron.ipcRenderer.invoke('export-file', typedAction.payload);
        break;
      case 'folders/createRequested':
        electron.ipcRenderer.invoke('create-folder', typedAction.payload);
        break;
      default:
        handleGenericActions(typedAction, electron);
        break;
    }

    return result;
  };

function handleGenericActions(action: AnyAction, electron: typeof window.electron): void {
  if (isRejected(action)) {
    electron.ipcRenderer.invoke('redux-error', {
      type: action.type,
      error: action.error?.message || 'Unknown error',
      meta: action.meta
        ? { requestId: action.meta.requestId, requestStatus: action.meta.requestStatus }
        : undefined,
    });
  }

  const actionTypesToSync = [
    'folders/fetchAll/fulfilled',
    'folders/create/fulfilled',
    'folders/delete/fulfilled',
    'files/addToFolder/fulfilled',
    'files/delete/fulfilled',
  ];

  if (actionTypesToSync.includes(action.type)) {
    electron.ipcRenderer.send('redux-state-changed', {
      type: action.type,
      payload: action.payload,
    });
  }
}

export const setupIpcListeners = (store: { dispatch: (action: AnyAction) => void }): void => {
  const electron = window.electron;

  if (!electron || !electron.ipcRenderer) {
    console.warn('Electron IPC not available, skipping IPC listeners setup');
    return;
  }

  // NOTE: preload.on() strips the IPC event — callbacks receive data directly, not (_event, data)

  electron.ipcRenderer.on('show-notification', (notification) => {
    store.dispatch({
      type: 'ui/addNotification',
      payload: notification,
    });
  });

  electron.ipcRenderer.on('folders-updated', (folders) => {
    if (folders && typeof folders === 'object' && Object.keys(folders).length > 0) {
      store.dispatch({
        type: 'folders/loadFoldersSuccess',
        payload: folders,
      });
    } else {
      // Empty payload = sync signal → re-fetch folders from disk
      import('../../services/core/folderService').then(({ getFolders }) => {
        getFolders()
          .then((freshFolders: any[]) => {
            // Clear stale files before re-populating from fresh folders
            store.dispatch({ type: 'files/clearAll' });
            store.dispatch({
              type: 'folders/fetchAll/fulfilled',
              payload: freshFolders,
            });
          })
          .catch(() => {});
      });
    }
  });

  electron.ipcRenderer.on('notes-updated', () => {
    import('../slices/notesSlice').then(({ loadNotesFromDisk }) => {
      store.dispatch(loadNotesFromDisk() as any);
    });
  });

  electron.ipcRenderer.on('profiles-updated', () => {
    // Profile manifest changed (new profile, PIN updated from another device, etc.)
    // — reload the full manifest and keep localProfile.hasPin in sync so the
    // LaunchScreen shows the correct lock screen (PinLockScreen vs VaultPasswordLock).
    electron.ipcRenderer
      .invoke('profile:getManifest')
      .then((manifest: any) => {
        if (manifest?.profiles) {
          store.dispatch({ type: 'profiles/loadProfilesSuccess', payload: manifest.profiles });
          const activeId = manifest.activeProfileId;
          const active = manifest.profiles.find((p: any) => p.id === activeId);
          if (active) {
            store.dispatch({ type: 'auth/setPin', payload: !!active.pinHash });
          }
        }
      })
      .catch(() => {});
  });

  electron.ipcRenderer.on('files-updated', (payload: any) => {
    if (!payload || typeof payload !== 'object') return;
    store.dispatch({
      type: 'files/updateFolderFiles',
      payload: { folderId: payload.folderId, files: payload.files },
    });
  });

  electron.ipcRenderer.on('main-process-error', (error: any) => {
    store.dispatch({
      type: 'ui/addNotification',
      payload: {
        type: 'error',
        message: `Erreur du processus principal: ${error?.message || error}`,
        autoClose: true,
        duration: 7000,
      },
    });
  });

  electron.ipcRenderer.on('system-theme-changed', (isDarkMode) => {
    store.dispatch({
      type: 'ui/setDarkMode',
      payload: isDarkMode,
    });
  });
};

export default electronMiddleware;
