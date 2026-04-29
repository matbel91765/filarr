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
import { addFileToFolder } from '../../store/slices/filesSlice';
import { processFileEvent } from '../../store/slices/automationSlice';
import { showErrorNotification, showSuccessNotification } from '../../store/slices/uiSlice';
import { generateUniqueId } from '../../utils/idGenerator';
import type { Folder } from '../../types';

interface FileDetectedPayload {
  sourcePath: string;
  name: string;
  size: number;
  type: string;
  contentBytes: number[];
  inboxFolderId: string;
  deleteOriginal: boolean;
}

let initialized = false;
let listener: ((payload: FileDetectedPayload) => void) | null = null;

export function initDownloadsWatcherBridge(store: Store): void {
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
    if (!Array.isArray(contentBytes)) {
      console.warn('[downloadsWatcherBridge] invalid payload for', name);
      return;
    }

    try {
      // Pre-generate the file id so we can pass the same id to the automation
      // engine. addFileToFolder honors `file.id` when present.
      const newFileId = generateUniqueId();
      const buffer =
        typeof Buffer !== 'undefined'
          ? Buffer.from(contentBytes)
          : (new Uint8Array(contentBytes) as any);

      const fileArg = {
        id: newFileId,
        name,
        type: type || 'file',
        size,
        content: buffer,
      };

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

      store.dispatch(showSuccessNotification(`Importé : ${name}`));
    } catch (error) {
      console.error('[downloadsWatcherBridge] import failed for', name, error);
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      store.dispatch(
        showErrorNotification(`Échec de l'import automatique de ${name} : ${message}`)
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
