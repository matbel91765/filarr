/**
 * Downloads Watcher Bridge (renderer side)
 *
 * Listens for `downloads-watcher:file-detected` events from the main process,
 * imports each detected file into Filarr via the existing addFileToFolder
 * thunk, then dispatches the automation engine with the new
 * `file_imported_from_os` trigger so user rules can route the file further.
 *
 * Flow:
 *   main (chokidar) → IPC → here → addFileToFolder thunk → file_created event
 *                                 → file_imported_from_os event
 *                                 → optional source delete
 */

import type { Store } from '@reduxjs/toolkit';
import i18n from '../../i18n/config';
import { addFileToFolder } from '../../store/slices/filesSlice';
import { processFileEvent } from '../../store/slices/automationSlice';
import { showErrorNotification, showSuccessNotification } from '../../store/slices/uiSlice';
import { generateUniqueId } from '../../utils/idGenerator';
import type { Folder, FileCreateData } from '../../types';
import { isWebPlatform } from '../platform/isWebPlatform';

// Opt-in du ReduxNotificationsHost : seules les notifications marquées
// `metadata.source` sont rendues — sans ce tag, les toasts de ce bridge
// tombent dans le vide (aucun composant ne rend state.ui.notifications nu).
const TOAST_META = { metadata: { source: 'downloadsWatcher' } } as const;

interface FileDetectedPayload {
  sourcePath: string;
  name: string;
  size: number;
  type: string;
  /**
   * Contenu inline, présent uniquement pour les fichiers <= 500 Mo.
   * Les fichiers plus gros arrivent SANS contenu : ils sont importés depuis
   * sourcePath via l'IPC de streaming V3 (saveEncryptedFileFromPath), sans
   * jamais transiter par la mémoire du renderer.
   */
  contentBytes?: number[];
  inboxFolderId: string;
  deleteOriginal: boolean;
}

let initialized = false;
let listener: ((payload: FileDetectedPayload) => void) | null = null;

// Le watcher re-détecte le même fichier à chaque scan : sans dédup, un
// fichier trop volumineux (garde > 500 Mo des modes non locaux) génère le
// même toast français en boucle. Une seule notification par chemin source
// et par session.
const oversizedToastShown = new Set<string>();

function isOversizedImportError(message: string): boolean {
  return message.includes('500 Mo');
}

export function initDownloadsWatcherBridge(store: Store): void {
  /**
   * ⚠ SUR LE WEB, `window.electron.ipcRenderer` EXISTE.
   *
   * C'est un shim, pose pour que le code partage n'ait pas a se dedoubler --
   * et c'est precisement ce qui rend le test ci-dessus insuffisant : il passe,
   * puis le canal repond « indisponible sur le web : fonctionnalite
   * desktop-only ». Ici le rejet est bien attrape, donc rien ne casse ; il
   * reste une erreur rouge dans la console de PRODUCTION, a chaque
   * chargement, pour une fonction qui n'existe pas sur cette plateforme.
   *
   * La seule garde qui distingue vraiment les deux mondes est
   * `isWebPlatform()`. Le depot a deja paye cette lecon une fois, sur
   * `layouts:takePendingOpen`, ou le rejet n'etait PAS attrape.
   */
  if (isWebPlatform()) return;
  if (initialized) return;
  if (!window.electron?.ipcRenderer) return;
  initialized = true;

  // Hydrate the main-process watcher on mount. Triggers lazy load from disk
  // + start if the saved config has `enabled: true`.
  window.electron.ipcRenderer
    .invoke('downloads-watcher:get-config')
    .catch((err: unknown) => console.warn('[downloadsWatcherBridge] hydrate failed:', err));

  listener = async (payload: FileDetectedPayload) => {
    if (!payload || typeof payload !== 'object') return;
    const { sourcePath, name, size, type, contentBytes, inboxFolderId, deleteOriginal } = payload;

    if (!inboxFolderId) {
      console.warn('[downloadsWatcherBridge] no inbox folder configured, dropping', name);
      return;
    }
    const hasInlineContent = Array.isArray(contentBytes);
    if (!hasInlineContent && (typeof sourcePath !== 'string' || sourcePath.length === 0)) {
      console.warn('[downloadsWatcherBridge] invalid payload for', name);
      return;
    }

    try {
      // Pre-generate the file id so we can pass the same id to the automation
      // engine. addFileToFolder honors `file.id` when present.
      const newFileId = generateUniqueId();

      const fileArg: FileCreateData = {
        id: newFileId,
        name,
        type: type || 'file',
        size,
      };
      if (hasInlineContent && contentBytes) {
        fileArg.content =
          typeof Buffer !== 'undefined'
            ? Buffer.from(contentBytes)
            : (new Uint8Array(contentBytes) as unknown as Buffer);
      } else {
        // Gros fichier (> 500 Mo) : import V3 en streaming — le main process
        // chiffre directement depuis le chemin OS, mémoire plate côté renderer.
        fileArg.sourcePath = sourcePath;
      }

      const result = await store
        .dispatch(addFileToFolder({ folderId: inboxFolderId, file: fileArg as any }) as any)
        .unwrap();

      // The addFileToFolder thunk already dispatched `file_created` for
      // automation. Now dispatch the OS-specific trigger so rules using
      // `file_imported_from_os` (or `os_source_path` conditions) can match.
      const dotIdx = name.lastIndexOf('.');
      const extension = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
      const folder = result as Folder;
      const now = new Date().toISOString();
      store.dispatch(
        processFileEvent({
          trigger: 'file_imported_from_os',
          file: {
            id: newFileId,
            name,
            extension,
            type: type || 'file',
            size,
            folderId: inboxFolderId,
            folderPath: folder?.name || '',
            createdAt: now,
            modifiedAt: now,
            tags: [],
            osSourcePath: sourcePath,
          },
        }) as any
      );

      if (deleteOriginal) {
        try {
          await window.electron.ipcRenderer.invoke('downloads-watcher:delete-source', sourcePath);
        } catch (err) {
          console.warn('[downloadsWatcherBridge] failed to delete OS source after import:', err);
        }
      }

      // Tell main to bump its status counter so the Settings UI reflects
      // the live count of imported files.
      window.electron.ipcRenderer
        .invoke('downloads-watcher:notify-import-success', name)
        .catch(() => {});

      store.dispatch(
        showSuccessNotification(
          i18n.t('settings.downloadsWatcher.notifications.imported', 'Importé : {{name}}', {
            name,
          }),
          TOAST_META
        )
      );
    } catch (error) {
      console.error('[downloadsWatcherBridge] import failed for', name, error);
      // unwrap() d'un thunk rejeté via rejectWithValue lance le payload brut
      // (objet { message, ... }, pas une Error) — lire .message dans les deux cas.
      const rawMessage = (error as { message?: unknown } | null)?.message;
      const message = typeof rawMessage === 'string' && rawMessage ? rawMessage : 'Erreur inconnue';
      // Toast « fichier trop volumineux » : une seule fois par chemin source
      // et par session (le watcher re-déclenche le même fichier en boucle).
      if (isOversizedImportError(message)) {
        const dedupKey = sourcePath || name;
        if (oversizedToastShown.has(dedupKey)) return;
        oversizedToastShown.add(dedupKey);
      }
      store.dispatch(
        showErrorNotification(
          i18n.t(
            'settings.downloadsWatcher.notifications.importFailed',
            "Échec de l'import automatique de {{name}} : {{message}}",
            { name, message }
          ),
          TOAST_META
        )
      );
    }
  };

  window.electron.ipcRenderer.on('downloads-watcher:file-detected', listener);
}

export function teardownDownloadsWatcherBridge(): void {
  if (!initialized) return;
  if (listener && window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.removeListener('downloads-watcher:file-detected', listener);
  }
  listener = null;
  initialized = false;
}
