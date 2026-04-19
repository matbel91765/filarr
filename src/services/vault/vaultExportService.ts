/**
 * Vault Export Service
 *
 * Exports the entire vault as a ZIP file containing:
 * - All files (decrypted) in their folder structure
 * - Notes as Markdown with YAML frontmatter (title, dates, tags)
 * - _manifest.json with full metadata, graph links, tags, stats
 *
 * Two modes:
 * - Plain: standard ZIP, universally readable
 * - Encrypted: ZIP built then encrypted with AES-256-GCM via a user-chosen password
 */

import type { FileItem, Folder } from '../../types';
import { getAppVersion } from '../platform/appVersion';
import { decryptFileContent, hasHybridKey } from '../auth/hybridCrypto';

export interface VaultExportOptions {
  mode: 'plain' | 'encrypted';
  /** Password for encrypted mode (ignored if plain) */
  password?: string;
  /** Profile name for manifest */
  profileName: string;
}

export interface ExportProgress {
  phase: 'preparing' | 'files' | 'notes' | 'packaging' | 'encrypting' | 'saving' | 'done';
  current: number;
  total: number;
  fileName?: string;
}

export type ProgressCallback = (progress: ExportProgress) => void;

export interface NoteForExport {
  id: string;
  title: string;
  content: string; // TipTap JSON content (full fidelity)
  plainText: string;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
  linkedNoteIds: string[];
  linkedFileIds: string[];
  linkedFolderIds: string[];
  parentId?: string | null;
  isDaily?: boolean;
  dailyDate?: string;
  icon?: string;
  coverColor?: string;
  isPinned?: boolean;
}

export interface TagForExport {
  id: string;
  name: string;
  color?: string;
}

/** Additional data for complete export/restore */
export interface ExportExtras {
  templates?: Record<string, unknown>[];
  flashcardDecks?: Record<string, unknown>[];
  automations?: Record<string, unknown>[];
  profiles?: Record<string, unknown>[];
  settings?: Record<string, unknown>;
}

/**
 * Export the vault to a ZIP file via Electron dialog.
 */
export async function exportVault(
  files: FileItem[],
  folders: Folder[],
  notes: NoteForExport[],
  tags: TagForExport[],
  options: VaultExportOptions,
  onProgress?: ProgressCallback,
  extras?: ExportExtras
): Promise<boolean> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Vault export requires Electron');
  }

  const ipc = window.electron.ipcRenderer;
  const isEncrypted = options.mode === 'encrypted' && !!options.password;

  // Phase 1: Prepare folder structure map
  onProgress?.({ phase: 'preparing', current: 0, total: 1 });
  const folderPathMap = buildFolderPathMap(folders);
  const tagById = new Map(tags.map((t) => [t.id, t]));

  // Phase 2: Collect file entries
  const zipEntries: Array<{ path: string; data: ArrayBuffer | string }> = [];
  const totalItems = files.length + notes.length;
  let processed = 0;
  let totalSizeBytes = 0;

  for (const file of files) {
    onProgress?.({ phase: 'files', current: processed, total: totalItems, fileName: file.name });

    try {
      const folderId = file.parentId || 'root';
      let fileContent: ArrayBuffer | null = null;

      // Method 1: Read + decrypt via StorageService (files encrypted with encryption.key)
      try {
        const decrypted: Buffer = await ipc.invoke('readEncryptedFileForCopy', folderId, file.name);
        if (decrypted && decrypted.byteLength > 0) {
          fileContent = new Uint8Array(decrypted).buffer as ArrayBuffer;
        }
      } catch {
        // Not found by name or decryption failed
      }

      // Method 2: Try by file ID
      if (!fileContent) {
        try {
          const decrypted: Buffer = await ipc.invoke('readEncryptedFileForCopy', folderId, file.id);
          if (decrypted && decrypted.byteLength > 0) {
            fileContent = new Uint8Array(decrypted).buffer as ArrayBuffer;
          }
        } catch {
          // Not found by ID either
        }
      }

      // Method 3: Raw blob + FEK decrypt (hybrid encrypted files)
      if (!fileContent) {
        try {
          const rawData: number[] | null = await ipc.invoke(
            'hybrid:readRawBlob',
            folderId,
            file.name
          );
          if (rawData && rawData.length > 0 && hasHybridKey()) {
            fileContent = await decryptFileContent(new Uint8Array(rawData));
          }
        } catch {
          // Skip
        }
      }

      if (fileContent && fileContent.byteLength > 0) {
        const folderPath = folderPathMap.get(file.parentId || '') || '';
        const filePath = folderPath ? `files/${folderPath}/${file.name}` : `files/${file.name}`;
        zipEntries.push({ path: filePath, data: fileContent });
        totalSizeBytes += fileContent.byteLength;
      }
    } catch (err) {
      console.warn(`[VaultExport] Skipping file ${file.name}:`, err);
    }
    processed++;
  }

  // Phase 3: Collect notes — both Markdown (human-readable) and full JSON (restorable)
  onProgress?.({ phase: 'notes', current: processed, total: totalItems });

  for (const note of notes) {
    const safeName = note.title.replace(/[/\\:*?"<>|]/g, '_') || 'untitled';
    const noteTags = note.tagIds.map((id) => tagById.get(id)?.name).filter(Boolean);

    // Human-readable Markdown export
    const frontmatter = [
      '---',
      `title: "${note.title.replace(/"/g, '\\"')}"`,
      `date_creation: ${note.createdAt}`,
      `date_modification: ${note.updatedAt}`,
      noteTags.length > 0 ? `tags: [${noteTags.map((t) => `"${t}"`).join(', ')}]` : null,
      '---',
      '',
    ]
      .filter((line) => line !== null)
      .join('\n');

    const mdContent = frontmatter + '\n' + note.plainText;
    zipEntries.push({ path: `_notes/${safeName}.md`, data: mdContent });
    totalSizeBytes += new TextEncoder().encode(mdContent).byteLength;
    processed++;
  }

  // Full-fidelity note data (TipTap JSON + all metadata) for restoration
  const notesJsonData = JSON.stringify(
    notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      plainText: n.plainText,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      tagIds: n.tagIds,
      linkedNoteIds: n.linkedNoteIds,
      linkedFileIds: n.linkedFileIds,
      linkedFolderIds: n.linkedFolderIds,
      parentId: n.parentId ?? null,
      isDaily: n.isDaily ?? false,
      dailyDate: n.dailyDate,
      icon: n.icon,
      coverColor: n.coverColor,
      isPinned: n.isPinned ?? false,
    })),
    null,
    2
  );
  zipEntries.push({ path: '_data/notes.json', data: notesJsonData });
  totalSizeBytes += new TextEncoder().encode(notesJsonData).byteLength;

  // Extra data: templates, flashcards, automations, profiles, settings
  if (extras) {
    if (extras.templates?.length) {
      const data = JSON.stringify(extras.templates, null, 2);
      zipEntries.push({ path: '_data/templates.json', data });
    }
    if (extras.flashcardDecks?.length) {
      const data = JSON.stringify(extras.flashcardDecks, null, 2);
      zipEntries.push({ path: '_data/flashcards.json', data });
    }
    if (extras.automations?.length) {
      const data = JSON.stringify(extras.automations, null, 2);
      zipEntries.push({ path: '_data/automations.json', data });
    }
    if (extras.profiles?.length) {
      const data = JSON.stringify(extras.profiles, null, 2);
      zipEntries.push({ path: '_data/profiles.json', data });
    }
    if (extras.settings && Object.keys(extras.settings).length > 0) {
      const data = JSON.stringify(extras.settings, null, 2);
      zipEntries.push({ path: '_data/settings.json', data });
    }
  }

  // Phase 4: Build graph_links from notes
  const graphLinks: Array<{ source: string; target: string; type: string }> = [];
  for (const note of notes) {
    for (const targetId of note.linkedNoteIds) {
      graphLinks.push({ source: note.id, target: targetId, type: 'note-note' });
    }
    for (const targetId of note.linkedFileIds) {
      graphLinks.push({ source: note.id, target: targetId, type: 'note-file' });
    }
    for (const targetId of note.linkedFolderIds) {
      graphLinks.push({ source: note.id, target: targetId, type: 'note-folder' });
    }
  }

  // Phase 5: Build manifest
  const manifest = {
    version: getAppVersion(),
    export_date: new Date().toISOString(),
    profile_name: options.profileName,
    encrypted: isEncrypted,
    ...(isEncrypted ? { encryption_algorithm: 'AES-256-GCM' } : {}),
    stats: {
      files: files.length,
      folders: folders.length,
      notes: notes.length,
      tags: tags.length,
      graph_links: graphLinks.length,
      total_size_mb: Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100,
    },
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: (f as any).parentId || null,
      color: f.color,
      path: folderPathMap.get(f.id) || f.name,
    })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    graph_links: graphLinks,
  };

  zipEntries.push({ path: '_manifest.json', data: JSON.stringify(manifest, null, 2) });

  // Phase 6: Serialize and send to Electron
  onProgress?.({ phase: 'packaging', current: 0, total: 1 });

  const serializedEntries = zipEntries.map((entry) => ({
    path: entry.path,
    data: typeof entry.data === 'string' ? entry.data : arrayBufferToBase64(entry.data),
    encoding: typeof entry.data === 'string' ? ('utf8' as const) : ('base64' as const),
  }));

  if (isEncrypted) {
    onProgress?.({ phase: 'encrypting', current: 0, total: 1 });
  } else {
    onProgress?.({ phase: 'saving', current: 0, total: 1 });
  }

  const defaultName = isEncrypted
    ? `filarr-export-encrypted-${new Date().toISOString().slice(0, 10)}.zip`
    : `filarr-export-${new Date().toISOString().slice(0, 10)}.zip`;

  const result: boolean = await ipc.invoke('vault:exportZip', {
    entries: serializedEntries,
    encrypted: isEncrypted,
    password: isEncrypted ? options.password : undefined,
    defaultFileName: defaultName,
  });

  onProgress?.({ phase: 'done', current: 1, total: 1 });
  return result;
}

function buildFolderPathMap(folders: Folder[]): Map<string, string> {
  const map = new Map<string, string>();
  const folderById = new Map<string, Folder>();
  folders.forEach((f) => folderById.set(f.id, f));

  function getPath(folderId: string): string {
    if (map.has(folderId)) return map.get(folderId)!;
    const folder = folderById.get(folderId);
    if (!folder) return '';

    const parentId = (folder as any).parentId;
    if (parentId && folderById.has(parentId)) {
      const parentPath = getPath(parentId);
      const p = parentPath ? `${parentPath}/${folder.name}` : folder.name;
      map.set(folderId, p);
      return p;
    }

    map.set(folderId, folder.name);
    return folder.name;
  }

  folders.forEach((f) => getPath(f.id));
  return map;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
