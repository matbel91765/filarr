/**
 * Middleware Redux pour la communication avec Electron
 *
 * Synchronise les actions Redux importantes avec le processus principal.
 */

import { Middleware, AnyAction, isFulfilled, isRejected } from '@reduxjs/toolkit';
import { RootState } from '../../types';
import {
  pushRendererLockState,
  purgeTempFiles,
} from '../../services/features/desktopProtectionBridge';
import { fetchManifest } from '../slices/profilesSlice';
import { flushPendingNotesSave, markNotesStateClean } from '../notesAutosaveFlush';

/**
 * Type de l'action qui remplace `byId` en bloc depuis le disque. Écrit en dur
 * plutôt qu'importé de `notesSlice` : ce middleware est chargé au montage du
 * store, et tirer le slice des notes ici referme une boucle d'imports
 * (store → middleware → slice → store).
 */
const NOTES_LOADED_ACTION = 'notes/loadFromDisk/fulfilled';

const electronMiddleware: Middleware<object, RootState> =
  (store) => (next) => (action: unknown) => {
    const electron = window.electron;
    const result = next(action);

    // AVANT la garde Electron : le suivi des notes sales existe aussi sur le
    // web, où `window.electron` est un substitut. Ce que Redux porte au sortir
    // d'un chargement disque EST ce que le disque porte — le déclarer propre
    // évite une écriture pleine redondante de tout le coffre (voir
    // `markNotesStateClean`).
    if ((action as AnyAction)?.type === NOTES_LOADED_ACTION) {
      markNotesStateClean();
    }

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
      case 'auth/lockApp': {
        // La fenêtre mini possède son propre store (même index.js) mais ne
        // représente pas la session : seule la fenêtre principale rapporte
        // l'état de verrouillage et déclenche la purge (sinon un lock
        // broadcasté ferait tout tourner en double).
        if (window.location.hash.startsWith('#/mini')) break;
        // Icône du tray + fenêtre mini : le main ne peut pas lire le state
        // Redux, on lui pousse chaque transition de verrouillage (best-effort).
        pushRendererLockState(true);
        // Protection du bureau : purger les copies temporaires en clair au
        // verrouillage (réglage actif par défaut, désactivable). Les locks
        // initiés par le MAIN purgent déjà main-side — la purge est
        // idempotente, le doublon est sans effet. Le RootState de src/types
        // ne connaît pas le slice settings (types historiques partiels) —
        // cast structurel local, sans import du store (circulaire).
        const state = store.getState() as unknown as {
          settings?: { desktop?: { purgeTempOnLock?: boolean } };
        };
        if (state.settings?.desktop?.purgeTempOnLock !== false) {
          purgeTempFiles().catch(() => {});
        }
        break;
      }
      case 'auth/unlockApp':
        if (window.location.hash.startsWith('#/mini')) break;
        pushRendererLockState(false);
        break;
      default:
        handleGenericActions(typedAction, electron);
        break;
    }

    return result;
  };

function handleGenericActions(action: AnyAction, electron: typeof window.electron): void {
  if (isRejected(action)) {
    // Best-effort error reporting. There is no main-process handler for 'redux-error'
    // (and it isn't whitelisted in preload), so the invoke rejects — swallow it, or a
    // rejected thunk's report becomes an uncaught promise rejection (a crash overlay
    // in the dev server). Reporting fires on EVERY rejected action, including handled
    // rejections like loadVaults failing, so it must never surface to the user.
    electron.ipcRenderer
      .invoke('redux-error', {
        type: action.type,
        error: action.error?.message || 'Unknown error',
        meta: action.meta
          ? { requestId: action.meta.requestId, requestStatus: action.meta.requestStatus }
          : undefined,
      })
      .catch(() => {});
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
    // Re-load notes from disk when cloud sync updates notes.enc.
    //
    // D'ABORD purger la sauvegarde en attente. `loadNotesFromDisk` REMPLACE
    // `byId` en bloc : arrivé pendant les 2 s de debounce de l'auto-save, il
    // effaçait le geste que l'utilisateur venait de faire (déplacement d'une
    // note collante, frappe), et le timer re-persistait ensuite l'état périmé.
    // La purge écrit ce qui attendait ET l'attend — `notes:save` partage le
    // verrou du main avec la fusion de la descente, donc au retour le disque
    // porte bien le travail local, déjà fusionné avec ce que la sync a écrit.
    void flushPendingNotesSave().then(() =>
      import('../slices/notesSlice').then(({ loadNotesFromDisk }) => {
        store.dispatch(loadNotesFromDisk() as any);
      })
    );
  });

  /**
   * L'APPLICATION SE FERME : on écrit ce que le debounce retient, et on le DIT.
   *
   * Le `beforeunload` d'`App.tsx` vidait déjà la file, mais personne ne
   * l'attendait : l'écriture partait pendant que le processus mourait, et la
   * synchronisation — coupée dans la foulée — n'avait de toute façon plus
   * l'occasion de la remonter. Ici le main ATTEND cet accusé avant de lancer
   * son dernier cycle, ce qui fait de la chaîne « frappe → disque → nuage »
   * quelque chose qui survit à la croix de fermeture.
   *
   * L'accusé part dans TOUS LES CAS, y compris si l'écriture échoue :
   * `flushPendingNotesSave` ne rejette jamais (elle avale l'erreur pour ne pas
   * bloquer le rechargement qui la suit), et un main qui attendrait en vain
   * ne ferait que retarder la fermeture de son budget.
   */
  electron.ipcRenderer.on('app:flush-notes', () => {
    void flushPendingNotesSave().finally(() => {
      try {
        // La charge utile est vide par contrat : le canal EST le message.
        electron.ipcRenderer.send('app:flush-notes:done', null);
      } catch {
        /* le main retombe sur son budget */
      }
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
          // `profiles/loadProfilesSuccess` N'EXISTE PAS. Aucun reducer ne le
          // traite : le slice ne reagit qu'a ses thunks. L'evenement partait
          // donc dans le vide, et un profil restaure depuis le nuage restait
          // sur le disque sans jamais atteindre l'ecran. On relit par le thunk,
          // qui lui est bien branche.
          void store.dispatch(fetchManifest() as never);
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

  // ── Protection du bureau (Wave 1) ─────────────────────────────────────
  // Verrouillage demandé par le MAIN process (powerMonitor lock-screen /
  // suspend, raccourci global, action du tray). Le main a déjà purgé sa
  // session key + les fichiers temporaires ; ici on efface la FEK du
  // renderer et on affiche l'écran de verrouillage. Best-effort : si le
  // renderer était throttlé pendant la veille, l'événement est traité au
  // réveil — la clé main-side est déjà effacée entre-temps.
  // NOTE : preload.on jette tant que 'vault:lock-request' n'est pas dans
  // ALLOWED_RECEIVE_CHANNELS — try/catch pour ne pas casser les listeners
  // suivants tant que le main/preload de la Wave 1 n'est pas en place.
  // La fenêtre MINI (même index.js, hash '#/mini') n'enregistre pas ce
  // listener : elle n'a ni FEK ni écran de verrouillage, MiniMode écoute
  // 'mini:refresh'/'vault:lock-request' pour son propre affichage.
  if (!window.location.hash.startsWith('#/mini')) {
    try {
      electron.ipcRenderer.on('vault:lock-request', () => {
        // La séquence complète vit dans `forgetSessionSecrets` : purge de
        // l'écriture en attente, effacement de la FEK, purge de ce qui en dérive
        // (clés de salle, sessions, minuteurs), puis verrouillage de l'écran. La
        // réécrire ici était exactement le cinquième chemin que ce module
        // partagé existe pour empêcher.
        //
        // NUANCE HONNÊTE sur la purge d'écriture, pour un verrouillage venu du
        // MAIN : `lockVaultFromMain` a déjà effacé la clé de session avant de
        // diffuser ce message. Sur un profil hybride, l'écriture arrive donc
        // trop tard et échouera (sans bruit — la purge ne rejette jamais). Sur
        // un profil LOCAL, dont le contenu tient à la clé machine, elle passe et
        // sauve la frappe. Fermer complètement cette fenêtre demanderait au main
        // de réclamer la purge AVANT d'effacer, donc un aller-retour dans
        // `lockVaultFromMain` — noté, pas fait ici.
        void import('../../services/auth/sessionTeardown').then(({ forgetSessionSecrets }) =>
          forgetSessionSecrets(store.dispatch, 'manual')
        );
      });
    } catch {
      // Canal absent de l'allowlist preload (main pas à jour) : les locks
      // initiés par le main ne seront simplement pas relayés au renderer.
    }
  }

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

  // ── Sync events ───────────────────────────────────────────────────────

  electron.ipcRenderer.on('sync-status-changed', (status: any) => {
    if (!status || typeof status !== 'object') return;
    store.dispatch({
      type: 'sync/setSyncStatus',
      payload: status,
    });

    // Update storage info if available
    if (status.storageUsed != null && status.storageLimit != null) {
      store.dispatch({
        type: 'sync/setStorageInfo',
        payload: {
          storageUsed: status.storageUsed,
          storageLimit: status.storageLimit,
        },
      });
    }

    // Refresh file statuses on every sync status change (not just idle)
    // This shows pending_upload badges during the sync window
    const profilesState = (store as any).getState?.()?.profiles;
    const profileId = profilesState?.activeProfileId;
    if (profileId) {
      electron.ipcRenderer
        .invoke('sync:getAllFileStatuses', profileId)
        .then((statuses: Record<string, string>) => {
          if (statuses && Object.keys(statuses).length > 0) {
            store.dispatch({
              type: 'sync/setFileStatuses',
              payload: statuses,
            });
          }
        })
        .catch(() => {});
    }
  });

  // Individual file status change (immediate, before sync triggers)
  electron.ipcRenderer.on('sync-file-status-changed', (data: any) => {
    if (!data || typeof data !== 'object') return;
    const current = (store as any).getState?.()?.sync?.fileStatuses || {};
    const updated = { ...current };
    if (data.fileId) updated[data.fileId] = data.status;
    if (data.localPath) updated[data.localPath] = data.status;
    store.dispatch({ type: 'sync/setFileStatuses', payload: updated });

    // Thread byte-level progress through when the emit carries it (delta upload
    // and the wired multipart/download paths). Older emit paths omit these
    // fields → no dispatch, so the coarse status-only badge remains. Keyed by
    // BOTH fileId and localPath, mirroring the status map above.
    if (typeof data.transferredBytes === 'number' && typeof data.totalBytes === 'number') {
      const keys: string[] = [];
      if (data.fileId) keys.push(data.fileId);
      if (data.localPath) keys.push(data.localPath);
      if (keys.length > 0) {
        store.dispatch({
          type: 'sync/setFileProgress',
          payload: {
            keys,
            status: data.status,
            transferredBytes: data.transferredBytes,
            totalBytes: data.totalBytes,
            at: Date.now(),
          },
        });
      }
    }
  });

  // sync-conflict-detected and sync-quota-exceeded are handled by
  // SyncConflictHandler component (uses useNotification Context, not Redux)
};

export default electronMiddleware;
