/**
 * Redux Slice pour les fichiers
 *
 * Gère tout l'état relatif aux fichiers dans l'application,
 * incluant les métadonnées des fichiers et les actions sur ces fichiers.
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { fileService } from '../../services';
import errorService from '../../services/platform/errorService';
import searchService from '../../services/search/searchService';
import { indexPdfContent } from '../../services/search/pdfTextExtractor';
import { generateUniqueId } from '../../utils/idGenerator';
import type { FileItem, Folder, DownloadResult } from '../../types';
import { fetchFolder, fetchFolders } from './foldersSlice';
import { processFileEvent as dispatchAutomationFileEvent } from './automationSlice';

/**
 * Queue PDF text extraction for search indexing (async, non-blocking).
 * Called after files are indexed to populate SearchIndex.content for PDFs.
 */
function queuePdfExtraction(files: Array<{ id: string; name: string }>): void {
  const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
  if (pdfFiles.length === 0) return;

  // Run asynchronously — don't block the reducer
  setTimeout(async () => {
    for (const file of pdfFiles) {
      try {
        // Try to get a local URL/path for the file via IPC
        const localPath: string | null = await window.electron?.ipcRenderer?.invoke(
          'file:getLocalPath',
          file.id
        );
        if (localPath) {
          await indexPdfContent(file.id, localPath, false);
        }
      } catch {
        // Best-effort — skip silently
      }
    }
    // Rebuild Fuse index once after all PDFs are processed
    if (pdfFiles.length > 0) {
      searchService.buildFuseIndex();
    }
  }, 2000); // Delay to let the UI settle first
}

// Types pour l'état des fichiers
export interface FilesState {
  byId: Record<string, FileItem>; // Map des fichiers indexés par ID
  allIds: string[]; // Liste des IDs de tous les fichiers
  selectedIds: string[]; // IDs des fichiers sélectionnés
  loading: boolean; // Indicateur de chargement
  error: SerializedError | null; // Erreur éventuelle
  uploadProgress: Record<string, number>; // Progression des uploads par ID
  downloadProgress: Record<string, number>; // Progression des downloads par ID
}

// Type pour les erreurs sérialisées (compatible Redux)
export interface SerializedError {
  name?: string;
  message?: string;
  details?: any;
  type?: string;
}

// Types pour les paramètres des thunks
interface AddFileToFolderParams {
  folderId: string;
  file: File | { name: string; content: Buffer | ArrayBuffer; type?: string; size?: number };
}

interface ReadFileParams {
  folderId: string;
  fileName: string;
}

interface ReadFileResult {
  folderId: string;
  fileName: string;
  content: string | null;
}

interface DeleteFileParams {
  folderId: string;
  fileId: string;
}

interface DeleteFileResult {
  folderId: string;
  fileId: string;
}

interface RenameFileParams {
  folderId: string;
  fileId: string;
  newName: string;
}

interface RenameFileResult {
  folderId: string;
  fileId: string;
  newName: string;
}

interface DownloadFileParams {
  folderId: string;
  fileId: string;
  password?: string;
}

interface UpdateFileMetadataParams {
  folderId: string;
  fileId: string;
  metadata: Partial<FileItem>;
}

interface ConvertFileToVaultShortcutParams {
  folderId: string;
  fileId: string;
  vaultId: string;
  itemId: string;
}

interface ConvertFileToVaultShortcutResult {
  folderId: string;
  /** La fiche-raccourci telle que persistée : `vaultRef` posé, sans octets. */
  file: FileItem;
}

interface ProgressPayload {
  fileId: string;
  progress: number;
}

// État initial
const initialState: FilesState = {
  byId: {}, // Map des fichiers indexés par ID
  allIds: [], // Liste des IDs de tous les fichiers
  selectedIds: [], // IDs des fichiers sélectionnés
  loading: false, // Indicateur de chargement
  error: null, // Erreur éventuelle
  uploadProgress: {}, // Progression des téléchargements par ID
  downloadProgress: {}, // Progression des téléchargements par ID
};

// Thunks (actions asynchrones)
// -----------------------------

/**
 * Ajoute un fichier à un dossier
 */
export const addFileToFolder = createAsyncThunk<
  Folder,
  AddFileToFolderParams,
  { rejectValue: SerializedError }
>('files/addToFolder', async ({ folderId, file }, { rejectWithValue, dispatch }) => {
  try {
    // Indication de progression initiale
    dispatch(setUploadProgress({ fileId: 'pending', progress: 0 }));

    // Pre-attach an id so we can wire the new file into automation rules below.
    // fileService.addFileToFolder honors `file.id` if present, else generates one.
    const preAssignedId = (file as any)?.id || generateUniqueId();
    try {
      (file as any).id = preAssignedId;
    } catch {
      // File objects in some environments may reject custom props; fileService
      // will then generate its own id and the automation event will fall back
      // to the last item in the resulting folder.
    }

    // Ajout du fichier via le service
    const result = await fileService.addFileToFolder(folderId, file as any);

    // Mise à jour de progression finale
    dispatch(setUploadProgress({ fileId: 'pending', progress: 100 }));

    // Fire automation `file_created` event (best-effort, fire-and-forget)
    try {
      const fileName: string = (file as any)?.name ?? '';
      const fileType: string = (file as any)?.type || 'file';
      const fileSize: number = typeof (file as any)?.size === 'number' ? (file as any).size : 0;
      const newFileId: string =
        (file as any)?.id ||
        (Array.isArray(result?.items) && result.items.length > 0
          ? result.items[result.items.length - 1]
          : preAssignedId);
      const dotIdx = fileName.lastIndexOf('.');
      const extension = dotIdx >= 0 ? fileName.slice(dotIdx + 1).toLowerCase() : '';
      const now = new Date().toISOString();
      dispatch(
        dispatchAutomationFileEvent({
          trigger: 'file_created',
          file: {
            id: newFileId,
            name: fileName,
            extension,
            type: fileType,
            size: fileSize,
            folderId,
            folderPath: result?.name || '',
            createdAt: now,
            modifiedAt: now,
            tags: [],
          },
        })
      );
    } catch (automationErr) {
      console.warn('[filesSlice] failed to dispatch automation file_created event:', automationErr);
    }

    // Retourner le résultat pour le reducer
    return result;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      `Impossible d'ajouter le fichier ${(file as any).name || 'unknown'} au dossier ${folderId}`,
      errorService.ErrorTypes.FILE_SYSTEM
    );
    errorService.logError(appError, 'addFileToFolder');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Lit le contenu d'un fichier
 */
export const readFile = createAsyncThunk<
  ReadFileResult,
  ReadFileParams,
  { rejectValue: SerializedError }
>('files/read', async ({ folderId, fileName }, { rejectWithValue, dispatch }) => {
  try {
    // Track download progress for cloud mode
    const fileId = `${folderId}/${fileName}`;
    dispatch(setDownloadProgress({ fileId, progress: 0 }));

    const rawContent = await fileService.readFile(folderId, fileName, true, (percent) => {
      dispatch(setDownloadProgress({ fileId, progress: percent }));
    });
    let serializableContent: string | null = null;

    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(rawContent)) {
      serializableContent = rawContent.toString('base64');
    } else if (typeof ArrayBuffer !== 'undefined' && rawContent instanceof ArrayBuffer) {
      // Fallback for browser environments if service changes
      serializableContent = btoa(
        new Uint8Array(rawContent).reduce(
          (data: string, byte: number) => data + String.fromCharCode(byte),
          ''
        )
      );
    } else if (typeof Uint8Array !== 'undefined' && rawContent instanceof Uint8Array) {
      // Fallback
      serializableContent = btoa(
        rawContent.reduce((data: string, byte: number) => data + String.fromCharCode(byte), '')
      );
    } else if (typeof rawContent === 'string') {
      serializableContent = rawContent; // Already a string
    } else if (rawContent === null || rawContent === undefined) {
      serializableContent = null; // Handle cases where content might be null/undefined
    } else {
      console.warn(`readFile thunk received unexpected content type: ${typeof rawContent}`);
      // Attempt to stringify, or handle as an error appropriately
      try {
        serializableContent = JSON.stringify(rawContent);
      } catch (_e) {
        serializableContent = null; // Or throw an error / return a specific error payload
      }
    }

    dispatch(setDownloadProgress({ fileId, progress: 100 }));
    return { folderId, fileName, content: serializableContent };
  } catch (error) {
    const fileId = `${folderId}/${fileName}`;
    dispatch(setDownloadProgress({ fileId, progress: 0 }));
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de lire le fichier ${fileName}`,
      errorService.ErrorTypes.FILE_SYSTEM
    );
    errorService.logError(appError, 'readFile');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Supprime un fichier
 */
export const deleteFile = createAsyncThunk<
  DeleteFileResult,
  DeleteFileParams,
  { rejectValue: SerializedError }
>('files/delete', async ({ folderId, fileId }, { rejectWithValue }) => {
  try {
    await fileService.deleteFile(folderId, fileId);

    return { folderId, fileId };
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de supprimer le fichier ${fileId}`,
      errorService.ErrorTypes.FILE_SYSTEM
    );
    errorService.logError(appError, 'deleteFile');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Renomme un fichier
 */
export const renameFile = createAsyncThunk<
  RenameFileResult,
  RenameFileParams,
  { rejectValue: SerializedError }
>('files/rename', async ({ folderId, fileId, newName }, { rejectWithValue }) => {
  try {
    await fileService.renameFile(folderId, fileId, newName);

    return { folderId, fileId, newName };
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de renommer le fichier ${fileId}`,
      errorService.ErrorTypes.FILE_SYSTEM
    );
    errorService.logError(appError, 'renameFile');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Télécharge un fichier
 */
export const downloadFile = createAsyncThunk<
  DownloadResult,
  DownloadFileParams,
  { rejectValue: SerializedError }
>('files/download', async ({ folderId, fileId, password }, { rejectWithValue, dispatch }) => {
  try {
    // Indication de progression initiale
    dispatch(setDownloadProgress({ fileId, progress: 0 }));

    // Téléchargement via le service
    const result = await fileService.downloadFile(folderId, fileId, password);

    // Mise à jour de progression finale
    dispatch(setDownloadProgress({ fileId, progress: 100 }));

    return result;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de télécharger le fichier ${fileId}`,
      errorService.ErrorTypes.FILE_SYSTEM
    );
    errorService.logError(appError, 'downloadFile');

    // Réinitialiser la progression en cas d'erreur
    dispatch(setDownloadProgress({ fileId, progress: 0 }));

    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Met à jour les métadonnées d'un fichier
 */
export const updateFileMetadata = createAsyncThunk<
  FileItem,
  UpdateFileMetadataParams,
  { rejectValue: SerializedError }
>('files/updateMetadata', async ({ folderId, fileId, metadata }, { rejectWithValue }) => {
  try {
    const updatedFile = await fileService.updateFileMetadata(folderId, fileId, metadata);

    // Since updateFileMetadata returns Item (FileItem | Folder), we need to assert it's a FileItem
    return updatedFile as FileItem;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de mettre à jour le fichier ${fileId}`,
      errorService.ErrorTypes.FILE_SYSTEM
    );
    errorService.logError(appError, 'updateFileMetadata');
    // Explicitly pass a plain object to rejectWithValue
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata ? JSON.parse(JSON.stringify(appError.metadata)) : null, // Ensure details are serializable
      type: appError.type,
    });
  }
});

/**
 * « Déplacer vers le coffre en laissant un raccourci » — la moitié PERSONNELLE
 * du geste, une fois les octets déposés dans le coffre (`addVaultItem` a rendu
 * `itemId`). Les octets quittent l'espace personnel ; la fiche reste, devenue
 * raccourci (`vaultRef`). `movedAt` est pris ICI, au moment du geste : c'est
 * la seule date que la fiche portera, et elle ne dépend d'aucune horloge serveur.
 */
export const convertFileToVaultShortcut = createAsyncThunk<
  ConvertFileToVaultShortcutResult,
  ConvertFileToVaultShortcutParams,
  { rejectValue: SerializedError }
>(
  'files/convertToVaultShortcut',
  async ({ folderId, fileId, vaultId, itemId }, { rejectWithValue }) => {
    try {
      const movedAt = new Date().toISOString();
      const folder = await fileService.convertFileToVaultShortcut(folderId, fileId, {
        vaultId,
        itemId,
        movedAt,
      });
      // `Folder.items` est typé `string[]` mais transporte les fiches complètes
      // (même lecture que `addFileToFolder.fulfilled`) : on relit la fiche
      // telle que PERSISTÉE plutôt que de la reconstruire ici — c'est elle qui
      // fait foi sur ce qui a été retiré.
      const file = (folder.items as unknown as Array<FileItem | string>).find(
        (item): item is FileItem => typeof item === 'object' && item.id === fileId
      );
      if (!file) {
        throw new Error(`Fiche ${fileId} introuvable après conversion en raccourci`);
      }
      return { folderId, file };
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        `Impossible de transformer le fichier ${fileId} en raccourci vers le coffre`,
        errorService.ErrorTypes.FILE_SYSTEM
      );
      errorService.logError(appError, 'convertFileToVaultShortcut');
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        details: appError.metadata ? JSON.parse(JSON.stringify(appError.metadata)) : null,
        type: appError.type,
      });
    }
  }
);

// Slice
const filesSlice = createSlice({
  name: 'files',
  initialState,
  reducers: {
    // Clear all files (used by sync to remove stale entries before re-fetch)
    clearAll(state) {
      state.byId = {};
      state.allIds = [];
      state.selectedIds = [];
    },

    // Actions synchrones (non-async)
    selectFile(state, action: PayloadAction<string>) {
      const fileId = action.payload;
      if (!state.selectedIds.includes(fileId)) {
        state.selectedIds.push(fileId);
      }
    },

    unselectFile(state, action: PayloadAction<string>) {
      const fileId = action.payload;
      state.selectedIds = state.selectedIds.filter((id) => id !== fileId);
    },

    clearSelection(state) {
      state.selectedIds = [];
    },

    clearFileErrors(state) {
      state.error = null;
    },

    setUploadProgress(state, action: PayloadAction<ProgressPayload>) {
      const { fileId, progress } = action.payload;
      state.uploadProgress[fileId] = progress;
    },

    setDownloadProgress(state, action: PayloadAction<ProgressPayload>) {
      const { fileId, progress } = action.payload;
      state.downloadProgress[fileId] = progress;
    },

    // Sync: Apply a file from remote sync (create or update) — idempotent
    syncApplyFile(state, action: PayloadAction<Partial<FileItem> & { id: string }>) {
      const data = action.payload;
      const existing = state.byId[data.id];
      if (existing) {
        state.byId[data.id] = { ...existing, ...data };
      } else {
        state.byId[data.id] = {
          name: 'Unknown',
          type: 'application/octet-stream',
          size: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...data,
        } as FileItem;
        if (!state.allIds.includes(data.id)) {
          state.allIds.push(data.id);
        }
      }
    },

    // Sync: Remove a file from remote sync (delete) — idempotent
    syncRemoveFile(state, action: PayloadAction<{ entityId: string; folderId?: string }>) {
      const { entityId } = action.payload;
      delete state.byId[entityId];
      state.allIds = state.allIds.filter((id) => id !== entityId);
      state.selectedIds = state.selectedIds.filter((id) => id !== entityId);
    },
  },
  // Extra reducers pour gérer les actions asynchrones
  extraReducers: (builder) => {
    builder
      // Gestion de addFileToFolder
      .addCase(addFileToFolder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(addFileToFolder.fulfilled, (state, action) => {
        state.loading = false;

        // Le dossier mis à jour est retourné, extraire les nouveaux fichiers
        const updatedFolder = action.payload;
        if (updatedFolder && updatedFolder.items) {
          // Les items du dossier sont des IDs ou des objets complets
          updatedFolder.items.forEach((item: any) => {
            // Si c'est un objet fichier complet (pas un dossier, pas un string ID)
            if (typeof item === 'object' && item.id && item.name && item.type !== 'folder') {
              state.byId[item.id] = item;
              if (!state.allIds.includes(item.id)) {
                state.allIds.push(item.id);
              }

              // Auto-index le fichier pour la recherche
              try {
                searchService.indexItem(item, updatedFolder.name, []);
                searchService.buildFuseIndex();
              } catch (error) {
                console.error('Failed to index file for search:', error);
              }
            }
          });
        }
      })
      .addCase(addFileToFolder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de deleteFile
      .addCase(deleteFile.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteFile.fulfilled, (state, action) => {
        state.loading = false;
        const { fileId } = action.payload;

        // Supprimer le fichier de l'état
        delete state.byId[fileId];
        state.allIds = state.allIds.filter((id) => id !== fileId);

        // Supprimer de la sélection si présent
        if (state.selectedIds.includes(fileId)) {
          state.selectedIds = state.selectedIds.filter((id) => id !== fileId);
        }
      })
      .addCase(deleteFile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de renameFile
      .addCase(renameFile.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(renameFile.fulfilled, (state, action) => {
        state.loading = false;
        const { fileId, newName } = action.payload;

        // Mettre à jour le nom du fichier
        if (state.byId[fileId]) {
          state.byId[fileId].name = newName;
        }
      })
      .addCase(renameFile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de updateFileMetadata
      .addCase(updateFileMetadata.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateFileMetadata.fulfilled, (state, action) => {
        state.loading = false;
        const updatedFile = action.payload;

        // Mettre à jour le fichier avec les nouvelles métadonnées
        if (updatedFile && updatedFile.id) {
          state.byId[updatedFile.id] = {
            ...state.byId[updatedFile.id],
            ...updatedFile,
          };
        }
      })
      .addCase(updateFileMetadata.rejected, (state, action) => {
        state.loading = false;
        // Ensure action.payload is treated as a plain object
        state.error = action.payload ?? null;
      })

      // Gestion de convertFileToVaultShortcut
      .addCase(convertFileToVaultShortcut.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(convertFileToVaultShortcut.fulfilled, (state, action) => {
        state.loading = false;
        const { file } = action.payload;
        // REMPLACER, pas fusionner : une fusion garderait `encryptedData`/`iv`
        // de l'ancienne fiche, et l'état afficherait des octets qui n'existent plus.
        state.byId[file.id] = file;
        if (!state.allIds.includes(file.id)) {
          state.allIds.push(file.id);
        }
      })
      .addCase(convertFileToVaultShortcut.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })
      // Also need to handle readFile.rejected and downloadFile.rejected if they set state.error
      .addCase(readFile.rejected, (state, action) => {
        state.loading = false; // Assuming readFile might set loading true
        state.error = action.payload ?? null;
      })
      .addCase(downloadFile.rejected, (state, action) => {
        state.loading = false; // Assuming downloadFile might set loading true
        state.error = action.payload ?? null;
      })

      // Écouter les actions de foldersSlice pour synchroniser les fichiers
      .addCase(fetchFolder.fulfilled, (state, action) => {
        // Quand un dossier est chargé, ajouter ses fichiers au state
        const folder = action.payload;
        if (folder && folder.items) {
          folder.items.forEach((item: any) => {
            // Si c'est un objet fichier complet (pas un dossier, pas un string ID)
            if (typeof item === 'object' && item.id && item.name && item.type !== 'folder') {
              // Shallow-copy so we can attach parentId (payload is frozen)
              const file = { ...item, parentId: item.parentId || folder.id };
              state.byId[file.id] = file;
              if (!state.allIds.includes(item.id)) {
                state.allIds.push(item.id);
              }

              // Auto-index le fichier pour la recherche
              try {
                searchService.indexItem(item, folder.name, []);
                searchService.buildFuseIndex();
              } catch (error) {
                console.error('Failed to index file for search:', error);
              }
            }
          });
        }
      })
      .addCase(fetchFolders.fulfilled, (state, action) => {
        // Reset files before re-populating from folders (prevents stale entries)
        state.byId = {};
        state.allIds = [];

        const folders = action.payload;
        if (Array.isArray(folders)) {
          folders.forEach((folder: Folder) => {
            if (folder.items) {
              folder.items.forEach((item: any) => {
                // Si c'est un objet fichier complet (pas un dossier, pas un string ID)
                if (typeof item === 'object' && item.id && item.name && item.type !== 'folder') {
                  // Shallow-copy so we can attach parentId (payload is frozen)
                  const file = { ...item, parentId: item.parentId || folder.id };
                  state.byId[file.id] = file;
                  if (!state.allIds.includes(item.id)) {
                    state.allIds.push(item.id);
                  }

                  // Auto-index le fichier pour la recherche
                  try {
                    searchService.indexItem(item, folder.name, []);
                  } catch (error) {
                    console.error('Failed to index file for search:', error);
                  }
                }
              });
            }
          });

          // Rebuild index once after all items are indexed
          try {
            searchService.buildFuseIndex();
          } catch (error) {
            console.error('Failed to build search index:', error);
          }

          // Queue async PDF text extraction for search
          const allFiles: Array<{ id: string; name: string }> = [];
          folders.forEach((folder: Folder) => {
            if (folder.items) {
              folder.items.forEach((item: any) => {
                if (typeof item === 'object' && item.id && item.name && item.type !== 'folder') {
                  allFiles.push({ id: item.id, name: item.name });
                }
              });
            }
          });
          queuePdfExtraction(allFiles);
        }
      });

    // Notez: Nous ne stockons pas le contenu des fichiers dans Redux
    // readFile est utilisé pour des opérations temporaires et n'affecte pas l'état
    // downloadFile gère uniquement la progression du téléchargement
  },
});

// Exporter les actions synchrones du slice
export const {
  selectFile,
  unselectFile,
  clearSelection,
  clearFileErrors,
  setUploadProgress,
  setDownloadProgress,
  syncApplyFile,
  syncRemoveFile,
} = filesSlice.actions;

// Exporter le reducer
export default filesSlice.reducer;
