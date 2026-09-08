/**
 * Hot Folders Bridge (renderer side)
 *
 * Listens for `hot-folders:file-event` from the main process and dispatches
 * the corresponding Filarr action (import via addFileToFolder, replace via
 * delete+add, or soft-delete via deleteFile) — then applies auto-tags,
 * fires the automation engine, and runs the post-import action.
 *
 * The crypto and sync layers are untouched: events flow into the standard
 * file pipeline that encrypts via HybridCrypto FEK and queues the upload via
 * syncService.notifyFileChanged.
 */

import type { Store } from '@reduxjs/toolkit';
import i18n from '../../i18n/config';
import { addFileToFolder, deleteFile } from '../../store/slices/filesSlice';
import { addTagToFile } from '../../store/slices/tagsSlice';
import { processFileEvent } from '../../store/slices/automationSlice';
import { showErrorNotification, showSuccessNotification } from '../../store/slices/uiSlice';
import { generateUniqueId } from '../../utils/idGenerator';
import type { Folder, FileItem, FileCreateData } from '../../types';
import { isWebPlatform } from '../platform/isWebPlatform';

type PostImportAction = 'keep' | 'secure-delete' | 'move-to-subfolder';

interface AddOrChangePayload {
  kind: 'add' | 'change';
  ruleId: string;
  sourcePath: string;
  targetFolderId: string;
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
  autoTagIds: string[];
  postImportAction: PostImportAction;
  postImportSubfolderPath?: string;
}

interface UnlinkPayload {
  kind: 'unlink';
  ruleId: string;
  sourcePath: string;
  targetFolderId: string;
  vaultFileId: string;
}

type HotFolderEvent = AddOrChangePayload | UnlinkPayload;

let initialized = false;
let listener: ((payload: HotFolderEvent) => void) | null = null;

// Le watcher re-détecte le même fichier à chaque scan : sans dédup, un
// fichier trop volumineux (garde > 500 Mo des modes non locaux) génère le
// même toast français en boucle. Une seule notification par chemin source
// et par session.
const oversizedToastShown = new Set<string>();

// Marque lue par ReduxNotificationsHost : sans elle, la notification reste
// dans state.ui.notifications sans jamais s'afficher (le seul système de
// toasts monté est celui du Context, cf. le hôte).
const TOAST_META = { metadata: { source: 'hotFolders' } } as const;

// Même raison pour le dossier cible disparu : le watcher relance le même
// fichier à chaque scan. Une alerte par règle et par session, puis on ignore
// en silence (console) jusqu'à ce que l'utilisateur corrige la règle.
const missingTargetToastShown = new Set<string>();

function isOversizedImportError(message: string): boolean {
  return message.includes('500 Mo');
}

/**
 * Chemin lisible d'un dossier du coffre — « Docs / Scans / 2026 ».
 *
 * Exporté parce que HotFoldersSection affiche la destination de la règle avec
 * le MÊME libellé que le toast d'import : sans ça, l'utilisateur lit un nom de
 * feuille ici et un autre là. Retourne null quand le dossier n'est plus dans
 * le store (supprimé, ou appartenant à un autre profil) — l'appelant décide de
 * ce qu'il en dit.
 */
export function buildFolderPath(
  foldersById: Record<string, Folder | undefined>,
  folderId: string
): string | null {
  const start = folderId ? foldersById[folderId] : undefined;
  if (!start || start.deletedAt) return null;
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: Folder | undefined = start;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? foldersById[current.parentId] : undefined;
  }
  return parts.join(' / ');
}

export function initHotFoldersBridge(store: Store): void {
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

  // Hydrate the main-process service on mount: lazily loads rules from
  // appConfig.json + starts the watchers that are `enabled: true`.
  window.electron.ipcRenderer
    .invoke('hot-folders:list')
    .catch((err: unknown) => console.warn('[hotFoldersBridge] hydrate failed:', err));

  listener = async (payload: HotFolderEvent) => {
    if (!payload || typeof payload !== 'object') return;
    try {
      if (payload.kind === 'unlink') {
        await handleUnlink(store, payload);
      } else {
        await handleAddOrChange(store, payload);
      }
    } catch (error) {
      console.error('[hotFoldersBridge] handler error:', error);
      // unwrap() d'un thunk rejeté via rejectWithValue lance le payload brut
      // (objet { message, ... }, pas une Error) — lire .message dans les deux cas.
      const rawMessage = (error as { message?: unknown } | null)?.message;
      const message = typeof rawMessage === 'string' && rawMessage ? rawMessage : 'Erreur inconnue';
      // Toast « fichier trop volumineux » : une seule fois par chemin source
      // et par session (le watcher re-déclenche le même fichier en boucle).
      if (isOversizedImportError(message)) {
        const dedupKey = payload.sourcePath || message;
        if (oversizedToastShown.has(dedupKey)) return;
        oversizedToastShown.add(dedupKey);
      }
      store.dispatch(
        showErrorNotification(
          i18n.t('settings.hotFolders.notifications.error', 'Hot folder : {{message}}', {
            message,
          }),
          TOAST_META
        )
      );
    }
  };

  window.electron.ipcRenderer.on('hot-folders:file-event', listener);
}

export function teardownHotFoldersBridge(): void {
  if (!initialized) return;
  if (listener && window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.removeListener('hot-folders:file-event', listener);
  }
  listener = null;
  initialized = false;
}

async function handleAddOrChange(store: Store, payload: AddOrChangePayload): Promise<void> {
  const {
    ruleId,
    sourcePath,
    targetFolderId,
    name,
    size,
    type,
    contentBytes,
    autoTagIds,
    postImportAction,
    postImportSubfolderPath,
  } = payload;

  if (!targetFolderId) {
    console.warn('[hotFoldersBridge] event without targetFolderId, dropping', name);
    return;
  }

  // Dossier cible disparu (supprimé, ou d'un autre profil) : ne RIEN importer.
  // Sans ce garde, l'import partait vers un dossier fantôme — le fichier était
  // chiffré et rangé nulle part, et l'utilisateur n'en savait rien. Le chemin
  // est calculé ici pour que le toast de succès nomme la destination.
  const targetPath = buildFolderPath(store.getState()?.folders?.byId ?? {}, targetFolderId);
  if (!targetPath) {
    console.warn('[hotFoldersBridge] target folder missing, skipping import of', name);
    if (!missingTargetToastShown.has(targetFolderId)) {
      missingTargetToastShown.add(targetFolderId);
      store.dispatch(
        showErrorNotification(
          i18n.t(
            'settings.hotFolders.notifications.targetMissing',
            '« {{name}} » n’a pas été importé : le dossier de destination n’existe plus. Modifiez la règle hot folder.',
            { name }
          ),
          TOAST_META
        )
      );
    }
    return;
  }

  const hasInlineContent = Array.isArray(contentBytes);
  if (!hasInlineContent && (typeof sourcePath !== 'string' || sourcePath.length === 0)) {
    console.warn('[hotFoldersBridge] invalid payload for', name);
    return;
  }

  // Replace-in-place if a file with the same name already exists in the
  // target folder — this covers external edits (VS Code editing a .md, etc.)
  // and keeps the vault file id stable across edits.
  const existing = findExistingFile(store, targetFolderId, name);
  let vaultFileId: string;
  let wasReplacement = false;

  if (existing) {
    wasReplacement = true;
    vaultFileId = existing.id;
    try {
      await store
        .dispatch(deleteFile({ folderId: targetFolderId, fileId: existing.id }) as any)
        .unwrap();
    } catch (err) {
      console.warn('[hotFoldersBridge] delete-before-replace failed:', err);
      // Fall through — addFileToFolder may still succeed under a deduped name
    }
  } else {
    vaultFileId = generateUniqueId();
  }

  const fileArg: FileCreateData = {
    id: vaultFileId,
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
    .dispatch(addFileToFolder({ folderId: targetFolderId, file: fileArg as any }) as any)
    .unwrap();

  // Auto-tags: only fire on initial import, not on replacement (replacement
  // preserves the previous tags through delete+add of the same id).
  if (!wasReplacement) {
    for (const tagId of autoTagIds) {
      try {
        await store.dispatch(addTagToFile({ fileId: vaultFileId, tagId }) as any);
      } catch (err) {
        console.warn('[hotFoldersBridge] auto-tag failed:', err);
      }
    }
  }

  // Automation engine — `file_imported_from_os` lets users build rules
  // scoped to hot folders (the payload includes ruleId + osSourcePath).
  const folder = result as Folder;
  const dotIdx = name.lastIndexOf('.');
  const extension = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
  const now = new Date().toISOString();
  store.dispatch(
    processFileEvent({
      trigger: 'file_imported_from_os',
      file: {
        id: vaultFileId,
        name,
        extension,
        type: type || 'file',
        size,
        folderId: targetFolderId,
        folderPath: folder?.name || '',
        createdAt: now,
        modifiedAt: now,
        tags: [],
        osSourcePath: sourcePath,
        hotFolderRuleId: ruleId,
      },
    }) as any
  );

  // Tell main about the mapping so unlink events can later resolve the
  // vault file id, and so status counters update.
  window.electron.ipcRenderer
    .invoke('hot-folders:notify-import-success', { ruleId, sourcePath, vaultFileId })
    .catch(() => {});

  // Post-import action — only on fresh imports, not replacements (the source
  // file shouldn't be deleted just because someone re-edited it).
  if (!wasReplacement) {
    if (postImportAction === 'secure-delete') {
      try {
        await window.electron.ipcRenderer.invoke('hot-folders:delete-source', {
          ruleId,
          sourcePath,
        });
      } catch (err) {
        console.warn('[hotFoldersBridge] secure-delete failed:', err);
      }
    } else if (postImportAction === 'move-to-subfolder' && postImportSubfolderPath) {
      try {
        await window.electron.ipcRenderer.invoke('hot-folders:move-source', {
          ruleId,
          sourcePath,
          subfolder: postImportSubfolderPath,
        });
      } catch (err) {
        console.warn('[hotFoldersBridge] move-source failed:', err);
      }
    }
  }

  store.dispatch(
    showSuccessNotification(
      wasReplacement
        ? i18n.t(
            'settings.hotFolders.notifications.updated',
            'Mis à jour : {{name}} → {{folder}}',
            {
              name,
              folder: targetPath,
            }
          )
        : i18n.t('settings.hotFolders.notifications.imported', 'Importé : {{name}} → {{folder}}', {
            name,
            folder: targetPath,
          }),
      TOAST_META
    )
  );
}

async function handleUnlink(store: Store, payload: UnlinkPayload): Promise<void> {
  const { targetFolderId, vaultFileId, sourcePath } = payload;
  if (!targetFolderId || !vaultFileId) {
    console.warn('[hotFoldersBridge] unlink missing targetFolderId/vaultFileId');
    return;
  }
  try {
    await store
      .dispatch(deleteFile({ folderId: targetFolderId, fileId: vaultFileId }) as any)
      .unwrap();
    store.dispatch(
      showSuccessNotification(
        i18n.t('settings.hotFolders.notifications.removed', 'Supprimé du coffre : {{name}}', {
          name: basename(sourcePath),
        }),
        TOAST_META
      )
    );
  } catch (err) {
    console.warn('[hotFoldersBridge] vault delete failed for unlinked file:', err);
  }
}

function findExistingFile(store: Store, folderId: string, name: string): FileItem | null {
  const state: any = store.getState();
  const folder: Folder | undefined = state?.folders?.byId?.[folderId];
  if (!folder?.items?.length) return null;
  const byId: Record<string, FileItem> = state?.files?.byId ?? {};
  for (const id of folder.items) {
    const file = byId[id];
    if (file && file.name === name) return file;
  }
  return null;
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}
