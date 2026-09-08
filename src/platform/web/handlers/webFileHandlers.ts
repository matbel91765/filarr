/**
 * Handlers web des canaux de CONTENU de fichiers — palier M2.
 *
 * Chaque fichier est chiffré avec la FEK par le pipeline de production
 * (`encryptFileContent`, format V1/V2 portable) AVANT d'entrer dans IndexedDB
 * — c'est le format que le moteur de sync M3 poussera tel quel vers R2
 * (contrairement au desktop local qui chiffre en clé machine puis migre).
 * Les métadonnées d'items vivent dans l'objet Folder (folders store), comme
 * dans le metadata.json desktop ; la corbeille garde les blobs jusqu'à
 * suppression définitive.
 */

import { zipSync } from 'fflate';
import { decryptFileContent, encryptFileContent } from '../../../services/auth/hybridCrypto';
import { storeDelete, storeGet, storePut } from '../webStore';
import { emitWebEvent } from '../webEventBus';
import { markPendingUpload } from '../sync/pendingUploads';
import { deriveFileId } from '../sync/readSync';

const FOLDERS_KEY = 'folders';
const TRASH_KEY = 'trash';

interface WebItem {
  id: string;
  name: string;
  type?: string;
  size?: number;
  content?: unknown;
  parentId?: string | null;
  deletedAt?: string;
  [key: string]: unknown;
}

interface WebFolder {
  id: string;
  name: string;
  items?: WebItem[];
  parentId?: string | null;
  color?: string;
  deletedAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Corbeille HORS-BANDE héritée (avant l'alignement sur le modèle desktop). */
interface TrashEntry {
  item: WebItem;
  folderId: string;
  deletedAt: string;
}

/** Ligne de corbeille, forme exacte de StorageService.getTrashItems. */
interface TrashRow extends Record<string, unknown> {
  id: string;
  name: string;
  deletedAt?: string;
  itemType: 'file' | 'folder';
  parentFolderId?: string;
  __legacyTrash?: boolean;
}

const blobKey = (folderId: unknown, fileName: unknown) => `file:${folderId}/${fileName}`;

function toBytes(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (ArrayBuffer.isView(content)) {
    const view = content as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(content)) return new Uint8Array(content as number[]);
  return new TextEncoder().encode(String(content ?? ''));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function getFoldersMap(): Promise<Record<string, WebFolder>> {
  return (await storeGet<Record<string, WebFolder>>(FOLDERS_KEY)) ?? {};
}

async function putFoldersMap(map: Record<string, WebFolder>): Promise<void> {
  await storePut(FOLDERS_KEY, map);
  emitWebEvent('folders-updated');
}

/**
 * VERROU DES MÉTADONNÉES DE DOSSIERS. Chaque mutation fait lire-modifier-écrire
 * la MÊME valeur IndexedDB (« folders ») en plusieurs await : deux mutations
 * concurrentes — un import multi-fichiers lançait tous ses `addItemToFolder`
 * de front — relisaient chacune la même carte et la réécrivaient entière. Le
 * dernier écrivain gagnait : les fiches des autres fichiers disparaissaient
 * en silence (leurs blobs chiffrés, eux, étaient bien écrits). Cas réel du
 * 2026-09-01 : cinq photos importées sur le web, une seule visible.
 *
 * Toute section lire→écrire passe donc par cette file indienne. Ne JAMAIS
 * l'appeler depuis une fonction déjà sous verrou (auto-interblocage).
 */
let foldersLock: Promise<unknown> = Promise.resolve();
function withFoldersLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = foldersLock.then(fn, fn);
  foldersLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function getTrash(): Promise<TrashEntry[]> {
  return (await storeGet<TrashEntry[]>(TRASH_KEY)) ?? [];
}

async function writeEncrypted(folderId: unknown, fileName: unknown, bytes: Uint8Array) {
  const encrypted = await encryptFileContent(toArrayBuffer(bytes), {
    fileName: String(fileName),
  });
  await storePut(blobKey(folderId, fileName), encrypted);
  // Remontée cloud : le blob local EST le format de câble (FEK portable)
  const fileId = await deriveFileId(String(folderId), String(fileName));
  await markPendingUpload(fileId, {
    kind: 'blob',
    folderId: String(folderId),
    fileName: String(fileName),
  }).catch(() => {});
}

async function markFolderMetaDirty(folderId: string): Promise<void> {
  await markPendingUpload(`meta:${folderId}`, { kind: 'meta', folderId }).catch(() => {});
}

/**
 * Purge définitive d'un fichier : le blob local part, et l'entrée de manifeste
 * est marquée 'deleted' au prochain push.
 *
 * PORTÉE RÉELLE, vérifiée : cette bascule ne purge RIEN dans le nuage. Le
 * desktop ignore les entrées distantes marquées supprimées
 * (syncManifest.mergeWithRemote:351) et sa purge R2 ne lit que SON manifeste
 * local (syncService étape 7, ligne 605). La suppression définitive depuis le
 * web est donc locale + marquage — l'objet R2 reste jusqu'à ce qu'un appareil
 * desktop supprime le fichier de son côté.
 */
async function purgeFileBlob(folderId: string, fileName: string): Promise<void> {
  await storeDelete(blobKey(folderId, fileName)).catch(() => {});
  await markPendingUpload(await deriveFileId(folderId, fileName), {
    kind: 'delete',
    folderId,
    fileName,
  }).catch(() => {});
}

/**
 * Purge définitive d'un dossier — miroir de StorageService.deleteFolder(id,
 * true) (secureDeleteDir) : les blobs partent AUSSI (l'ancien chemin les
 * laissait indéfiniment dans IndexedDB).
 */
export async function purgeFolderPermanently(folderId: string): Promise<void> {
  const folders = await getFoldersMap();
  const folder = folders[folderId];
  delete folders[folderId];
  await putFoldersMap(folders);
  await markPendingUpload(`meta:${folderId}`, { kind: 'delete', folderId }).catch(() => {});
  for (const item of folder?.items ?? []) {
    if (!item?.name || item.type === 'folder') continue;
    await purgeFileBlob(folderId, item.name);
  }
}

/**
 * Toute la corbeille, forme desktop (StorageService.getTrashItems) : dossiers
 * supprimés + items supprimés EN PLACE dans leur dossier, plus les entrées
 * hors-bande héritées. `itemType`/`parentFolderId`/`parentFolderName` sont ce
 * que lit trashSlice.fetchTrashItems — sans eux la corbeille affiche un type
 * faux et aucune origine.
 */
async function collectTrashRows(): Promise<TrashRow[]> {
  const folders = await getFoldersMap();
  const rows: TrashRow[] = [];
  for (const folder of Object.values(folders)) {
    if (folder.deletedAt) {
      rows.push({
        ...folder,
        type: 'folder',
        itemType: 'folder',
        parentId: folder.parentId ?? null,
      });
    }
    for (const item of folder.items ?? []) {
      if (!item?.deletedAt) continue;
      rows.push({
        ...item,
        itemType: 'file',
        parentFolderId: folder.id,
        parentFolderName: folder.name,
      });
    }
  }
  for (const entry of await getTrash()) {
    rows.push({
      ...entry.item,
      deletedAt: entry.deletedAt,
      itemType: 'file',
      parentFolderId: entry.folderId,
      parentFolderName: folders[entry.folderId]?.name ?? '',
      __legacyTrash: true,
    });
  }
  return rows.sort(
    (a, b) => new Date(String(b.deletedAt)).getTime() - new Date(String(a.deletedAt)).getTime()
  );
}

/**
 * Vide la corbeille — miroir de StorageService.emptyTrash : `olderThanDays > 0`
 * ne purge que les entrées assez vieilles.
 */
async function emptyTrash(olderThanDays: number): Promise<number> {
  const now = Date.now();
  const eligible = (await collectTrashRows()).filter((row) => {
    if (olderThanDays <= 0) return true;
    const ageDays = (now - new Date(String(row.deletedAt)).getTime()) / 86_400_000;
    // Date illisible → NaN → la comparaison est fausse et l'item est GARDÉ :
    // on ne supprime jamais ce qu'on ne sait pas dater.
    return ageDays >= olderThanDays;
  });
  // Les dossiers en DERNIER : purger un dossier emporte ses items, dont les
  // lignes de corbeille rendraient alors `false` (la vue est triée par date,
  // un dossier pouvait donc passer avant ses propres items et fausser le
  // compte rendu à l'utilisateur).
  const ordered = [
    ...eligible.filter((row) => row.itemType !== 'folder'),
    ...eligible.filter((row) => row.itemType === 'folder'),
  ];
  let deleted = 0;
  for (const row of ordered) {
    if (await permanentlyDelete(row.id, row.parentFolderId)) deleted++;
  }
  return deleted;
}

/** Suppression définitive d'une ligne de corbeille (fichier OU dossier). */
async function permanentlyDelete(itemId: string, folderIdHint?: string): Promise<boolean> {
  const folders = await getFoldersMap();

  if (folders[itemId]) {
    await purgeFolderPermanently(itemId);
    emitWebEvent('files-updated');
    return true;
  }

  const scope = folderIdHint
    ? [folders[folderIdHint]].filter((f): f is WebFolder => Boolean(f))
    : Object.values(folders);
  for (const folder of scope) {
    const idx = folder.items?.findIndex((i) => i.id === itemId) ?? -1;
    if (idx < 0) continue;
    const [item] = folder.items!.splice(idx, 1);
    folder.updatedAt = new Date().toISOString();
    await putFoldersMap(folders);
    await purgeFileBlob(folder.id, item.name);
    await markFolderMetaDirty(folder.id);
    emitWebEvent('files-updated');
    return true;
  }

  // Corbeille hors-bande héritée : l'item n'est plus dans aucun dossier.
  const trash = await getTrash();
  const idx = trash.findIndex((e) => e.item.id === itemId);
  if (idx === -1) return false;
  const [entry] = trash.splice(idx, 1);
  await storePut(TRASH_KEY, trash);
  await purgeFileBlob(entry.folderId, entry.item.name);
  return true;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/plain',
  json: 'application/json',
  html: 'text/html',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/**
 * Types que le NAVIGATEUR sait afficher dans un onglet. SVG et HTML en sont
 * volontairement EXCLUS : un blob s'exécute dans l'origine de l'app — un
 * fichier piégé pourrait scripter dans le coffre. Tout le reste part en
 * téléchargement NOMMÉ (un window.open sur un type non affichable télécharge
 * avec un nom de blob opaque sans extension — le « fichier bizarre »).
 */
const VIEWABLE_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'application/json',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
]);

/** Blob URL typée : onglet pour les types affichables, téléchargement nommé sinon. */
function openAsBlobUrl(fileName: string, bytes: Uint8Array, shouldOpen: boolean): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: mime }));
  if (shouldOpen) {
    const downloadNamed = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
    };
    if (VIEWABLE_MIME.has(mime)) {
      const win = window.open(url, '_blank');
      if (!win) downloadNamed(); // popup bloquée
    } else {
      downloadNamed();
    }
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}

async function readDecrypted(folderId: unknown, fileName: unknown): Promise<Uint8Array> {
  const encrypted = await storeGet<Uint8Array>(blobKey(folderId, fileName));
  if (encrypted) {
    return new Uint8Array(await decryptFileContent(new Uint8Array(encrypted)));
  }
  // Absent en local : repli cloud (pont M3) — téléchargé, déchiffré selon son
  // format d'origine, re-chiffré au format web et mis en cache par readSync.
  const { fetchCloudFile } = await import('../sync/readSync');
  const fromCloud = await fetchCloudFile(String(folderId), String(fileName));
  if (fromCloud) return fromCloud;
  throw new Error(`File ${String(fileName)} does not exist in folder ${String(folderId)}`);
}

export const webFileHandlers: Record<string, (...args: unknown[]) => unknown> = {
  addItemToFolder: (folderIdArg: unknown, itemArg: unknown) =>
    withFoldersLock(async () => {
      const folderId = String(folderIdArg);
      const item = itemArg as WebItem;
      const folders = await getFoldersMap();
      const folder = folders[folderId];
      if (!folder) throw new Error(`Folder ${folderId} not found`);

      if (item.type === 'folder') {
        // Sous-dossier : même comportement que main.ts:4190-4204
        folders[item.id] = {
          id: String(item.id),
          name: item.name,
          parentId: folderId,
          items: [],
          color: item.color,
          protected: item.protected,
          password: item.password,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          reminders: [],
        } as WebFolder;
      } else if (item.content !== undefined && item.content !== null) {
        const bytes = toBytes(item.content);
        await writeEncrypted(folderId, item.name, bytes);
        item.size = bytes.byteLength;
      }

      // Métadonnées SANS contenu, comme StorageService.addItemToFolder
      const { content: _content, ...meta } = item;
      const items = folder.items ?? [];
      const existing = items.findIndex((i) => i.id === item.id);
      const entry = { ...meta, id: String(item.id), parentId: folderId } as WebItem;
      if (existing >= 0) items[existing] = entry;
      else items.push(entry);
      folder.items = items;
      folder.updatedAt = new Date().toISOString();
      await putFoldersMap(folders);
      await markFolderMetaDirty(folderId);
      if (item.type === 'folder') await markFolderMetaDirty(String(item.id));
      emitWebEvent('files-updated');
      return folder;
    }),

  readEncryptedFile: async (folderId: unknown, fileName: unknown) =>
    readDecrypted(folderId, fileName),

  readEncryptedFileForCopy: async (folderId: unknown, fileName: unknown) =>
    readDecrypted(folderId, fileName),

  saveEncryptedFile: async (folderId: unknown, fileName: unknown, content: unknown) => {
    await writeEncrypted(folderId, fileName, toBytes(content));
    await markFolderMetaDirty(String(folderId));
    emitWebEvent('files-updated');
    return true;
  },

  'storage:deleteFile': async (
    folderIdArg: unknown,
    fileNameArg: unknown,
    permanent: unknown = false
  ) => {
    const folderId = String(folderIdArg);
    const fileName = String(fileNameArg);
    const folders = await getFoldersMap();
    const folder = folders[folderId];
    const idx = folder?.items?.findIndex((i) => i.name === fileName || i.id === fileName) ?? -1;
    const item = idx >= 0 ? folder.items?.[idx] : undefined;

    if (permanent || !item) {
      if (folder && idx >= 0) {
        folder.items?.splice(idx, 1);
        folder.updatedAt = new Date().toISOString();
      }
      await purgeFileBlob(folderId, item?.name ?? fileName);
      await markFolderMetaDirty(folderId);
    } else {
      // Suppression DOUCE EN PLACE, comme StorageService.deleteFile : l'item
      // reste dans les métadonnées du dossier avec son `deletedAt`. Le sortir
      // vers une corbeille hors-bande (ce que faisait ce chemin) l'effaçait de
      // la méta poussée au nuage : le fichier disparaissait du desktop SANS
      // passer par sa corbeille, et son blob restait orphelin dans R2.
      const now = new Date().toISOString();
      item.deletedAt = now;
      item.updatedAt = now;
      folder.updatedAt = now;
      await markFolderMetaDirty(folderId);
    }
    await putFoldersMap(folders);
    emitWebEvent('files-updated');
    return true;
  },

  'storage:restoreItem': async (itemIdArg: unknown) => {
    const itemId = String(itemIdArg);
    const folders = await getFoldersMap();
    const now = new Date().toISOString();

    const folder = folders[itemId];
    if (folder?.deletedAt) {
      delete folder.deletedAt;
      folder.updatedAt = now;
      await putFoldersMap(folders);
      await markFolderMetaDirty(itemId);
      emitWebEvent('files-updated');
      return folder;
    }
    for (const parent of Object.values(folders)) {
      const item = parent.items?.find((i) => i.id === itemId);
      if (!item?.deletedAt) continue;
      delete item.deletedAt;
      item.updatedAt = now;
      parent.updatedAt = now;
      await putFoldersMap(folders);
      await markFolderMetaDirty(parent.id);
      emitWebEvent('files-updated');
      return item;
    }

    // Entrée hors-bande héritée : l'item avait été sorti de son dossier.
    const trash = await getTrash();
    const idx = trash.findIndex((e) => e.item.id === itemId);
    if (idx === -1) throw new Error(`Item ${itemId} not found or not deleted`);
    const [entry] = trash.splice(idx, 1);
    await storePut(TRASH_KEY, trash);
    const target = folders[entry.folderId];
    if (target) {
      target.items = [...(target.items ?? []), entry.item];
      await putFoldersMap(folders);
      await markFolderMetaDirty(entry.folderId);
    }
    emitWebEvent('files-updated');
    return entry.item;
  },

  'storage:permanentlyDeleteItem': async (itemId: unknown, folderId?: unknown) =>
    permanentlyDelete(String(itemId), folderId ? String(folderId) : undefined),

  // Corbeille : même vue que le desktop, alimentée par les `deletedAt` posés
  // EN PLACE dans les dossiers (plus les entrées hors-bande héritées).
  'storage:getTrashItems': async () => collectTrashRows(),

  'storage:emptyTrash': async (olderThanDaysArg?: unknown) =>
    emptyTrash(Number(olderThanDaysArg ?? 0) || 0),

  // Miroir de StorageService.autoCleanupTrash (30 jours) — la forme M2 rendait
  // 0 sans jamais purger.
  'storage:autoCleanupTrash': async () => emptyTrash(30),

  // ── Renommer / déplacer / copier / retirer — miroirs de main.ts:4456-5868 ──
  renameItem: async (
    parentIdArg: unknown,
    itemIdArg: unknown,
    oldNameArg: unknown,
    newNameArg: unknown
  ) => {
    const itemId = String(itemIdArg);
    const oldName = String(oldNameArg);
    const newName = String(newNameArg);
    if (!itemId || !oldName || !newName) throw new Error('Missing arguments for renaming');
    const folders = await getFoldersMap();

    if (parentIdArg === 'root' || parentIdArg === undefined || parentIdArg === null) {
      // Dossier de premier niveau : itemId EST l'id du dossier
      const folder = folders[itemId];
      if (folder) folder.name = newName;
    } else {
      const parentId = String(parentIdArg);
      const folder = folders[parentId];
      const item = folder?.items?.find((i) => i.id === itemId);
      if (item) {
        const encrypted = await storeGet<Uint8Array>(blobKey(parentId, oldName));
        if (encrypted) {
          await storePut(blobKey(parentId, newName), encrypted);
          await storeDelete(blobKey(parentId, oldName));
        }
        item.name = newName;
        await markPendingUpload(await deriveFileId(parentId, newName), {
          kind: 'blob',
          folderId: parentId,
          fileName: newName,
        }).catch(() => {});
        await markFolderMetaDirty(parentId);
      }
    }
    if (parentIdArg === 'root' || parentIdArg === undefined || parentIdArg === null) {
      await markFolderMetaDirty(itemId);
    }
    await putFoldersMap(folders);
    emitWebEvent('files-updated');
    return true;
  },

  moveItem: async (itemIdArg: unknown, sourceIdArg: unknown, targetIdArg: unknown) => {
    const itemId = String(itemIdArg);
    const sourceId = String(sourceIdArg);
    const targetId = String(targetIdArg);
    const folders = await getFoldersMap();
    const source = folders[sourceId];
    const target = folders[targetId];
    if (!source || !target) throw new Error('Folder not found');
    const idx = source.items?.findIndex((i) => i.id === itemId) ?? -1;
    if (idx === -1) throw new Error('Item not found');
    const [item] = source.items!.splice(idx, 1);
    // Même dossier (réordonnancement) : ne PAS toucher au blob — put puis
    // delete sur la même clé le détruirait.
    if (sourceId !== targetId) {
      const encrypted = await storeGet<Uint8Array>(blobKey(sourceId, item.name));
      if (encrypted) {
        await storePut(blobKey(targetId, item.name), encrypted);
        await storeDelete(blobKey(sourceId, item.name));
      }
    }
    target.items = [...(target.items ?? []), { ...item, parentId: targetId }];
    await putFoldersMap(folders);
    await markFolderMetaDirty(sourceId);
    await markFolderMetaDirty(targetId);
    await markPendingUpload(await deriveFileId(targetId, item.name), {
      kind: 'blob',
      folderId: targetId,
      fileName: item.name,
    }).catch(() => {});
    emitWebEvent('files-updated');
    return target;
  },

  copyItem: async (
    itemIdArg: unknown,
    sourceIdArg: unknown,
    targetIdArg: unknown,
    newNameArg?: unknown
  ) => {
    const itemId = String(itemIdArg);
    const sourceId = String(sourceIdArg);
    const targetId = String(targetIdArg);
    const folders = await getFoldersMap();
    const source = folders[sourceId];
    const target = folders[targetId];
    if (!source || !target) throw new Error('Folder not found');
    const item = source.items?.find((i) => i.id === itemId);
    if (!item) throw new Error('Item not found');
    const copyName = newNameArg ? String(newNameArg) : item.name;
    const encrypted = await storeGet<Uint8Array>(blobKey(sourceId, item.name));
    if (encrypted) await storePut(blobKey(targetId, copyName), encrypted);
    const copy: WebItem = {
      ...item,
      id: crypto.randomUUID(),
      name: copyName,
      parentId: targetId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    target.items = [...(target.items ?? []), copy];
    await putFoldersMap(folders);
    await markFolderMetaDirty(targetId);
    await markPendingUpload(await deriveFileId(targetId, copyName), {
      kind: 'blob',
      folderId: targetId,
      fileName: copyName,
    }).catch(() => {});
    emitWebEvent('files-updated');
    return target;
  },

  removeItemFromFolder: async (folderIdArg: unknown, itemIdArg: unknown) => {
    const folderId = String(folderIdArg);
    const folders = await getFoldersMap();
    const folder = folders[folderId];
    const idx = folder?.items?.findIndex((i) => i.id === String(itemIdArg)) ?? -1;
    if (folder && idx >= 0) {
      const [item] = folder.items!.splice(idx, 1);
      await storeDelete(blobKey(folderId, item.name)).catch(() => {});
      await markPendingUpload(await deriveFileId(folderId, item.name), {
        kind: 'delete',
        folderId,
        fileName: item.name,
      }).catch(() => {});
      await markFolderMetaDirty(folderId);
      await putFoldersMap(folders);
      emitWebEvent('files-updated');
    }
    return folder ?? null;
  },

  // ── Hashes de mots de passe des fichiers/dossiers protégés (PAS le
  // gestionnaire de mots de passe, hors périmètre) — chiffrés FEK en IDB,
  // comme le PASSWORD_HASHES_FILE chiffré du desktop (main.ts:7120-7142) ──
  'secureStore:getPasswordHashes': async () => {
    const encrypted = await storeGet<Uint8Array>('password_hashes_enc');
    if (!encrypted) return {};
    try {
      const plain = await decryptFileContent(new Uint8Array(encrypted));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      return {};
    }
  },

  'secureStore:setPasswordHashes': async (hashes: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(hashes ?? {}));
    const encrypted = await encryptFileContent(toArrayBuffer(bytes));
    await storePut('password_hashes_enc', encrypted);
    return true;
  },

  // ZIP multiple : le desktop écrit dans un savePath de dialogue ; sur web on
  // zippe en mémoire (fflate, déjà en dépendance) et on télécharge.
  downloadMultipleAsZip: async (requestArg: unknown) => {
    const { folderId, itemIds } = (requestArg ?? {}) as {
      folderId: string;
      itemIds: string[];
    };
    const folders = await getFoldersMap();
    const folder = folders[String(folderId)];
    if (!folder) throw new Error('Folder not found');
    const entries: Record<string, Uint8Array> = {};
    for (const id of itemIds ?? []) {
      const item = folder.items?.find((i) => i.id === id || i.name === id);
      if (!item || item.type === 'folder') continue;
      entries[item.name] = await readDecrypted(folderId, item.name);
    }
    if (Object.keys(entries).length === 0) throw new Error('No downloadable items');
    const zipped = zipSync(entries, { level: 5 });
    const url = URL.createObjectURL(new Blob([toArrayBuffer(zipped)]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${folder.name || 'filarr'}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { success: true };
  },

  // ── Ouverture de fichiers : sémantique web = onglet navigateur ───────────
  // Sur desktop, openEncryptedFile/openVaultFile déchiffrent vers un fichier
  // temporaire et l'ouvrent dans l'application système (avec re-chiffrement à
  // la sauvegarde). Sur web : Blob URL typée MIME — un PDF s'ouvre dans le
  // lecteur du navigateur, une image s'affiche, le reste se télécharge.
  // Découvert au premier test réel : tous les chemins « ouvrir » de
  // fileService.openFile aboutissent à l'un de ces deux canaux.
  openEncryptedFile: async (folderId: unknown, fileName: unknown, shouldOpen: unknown = true) => {
    const bytes = await readDecrypted(folderId, fileName);
    return openAsBlobUrl(String(fileName), bytes, Boolean(shouldOpen));
  },

  openVaultFile: async (fileName: unknown, content: unknown) => {
    return openAsBlobUrl(String(fileName), toBytes(content), true);
  },

  // Le téléchargement web n'a pas de savePath : déchiffrer puis déclencher le
  // téléchargement navigateur (l'équivalent du « Enregistrer sous » desktop).
  downloadItem: async (requestArg: unknown) => {
    const { folderId, itemId } = (requestArg ?? {}) as { folderId: string; itemId: string };
    const folders = await getFoldersMap();
    const folder = folders[String(folderId)];
    const item = folder?.items?.find((i) => i.id === itemId || i.name === itemId);
    if (!item) throw new Error('Item not found');
    const bytes = await readDecrypted(folderId, item.name);
    const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)]));
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { success: true };
  },
};
