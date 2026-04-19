/**
 * Vault Import Service
 *
 * Restores a complete Filarr backup from a ZIP file exported by vaultExportService.
 * Reads `_data/notes.json` for full-fidelity note restoration,
 * `_data/settings.json` for user preferences, and `_manifest.json` for metadata.
 *
 * Two modes:
 * - Plain: standard ZIP
 * - Encrypted: ZIP decrypted with AES-256-GCM via user password
 */

export interface ImportProgress {
  phase: 'reading' | 'decrypting' | 'parsing' | 'notes' | 'files' | 'settings' | 'done';
  current: number;
  total: number;
  fileName?: string;
}

export type ImportProgressCallback = (progress: ImportProgress) => void;

export interface ImportResult {
  notesCount: number;
  filesCount: number;
  foldersCount: number;
  tagsCount: number;
  settingsRestored: boolean;
}

export interface ImportedNote {
  id: string;
  title: string;
  content: string;
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

export interface ImportedManifest {
  version: string;
  export_date: string;
  profile_name: string;
  encrypted: boolean;
  stats: {
    files: number;
    folders: number;
    notes: number;
    tags: number;
  };
  folders: Array<{
    id: string;
    name: string;
    parentId: string | null;
    color?: string;
    path?: string;
  }>;
  tags: Array<{ id: string; name: string; color?: string }>;
}

/**
 * Import a vault backup ZIP file via Electron dialog.
 * Returns the parsed data for the caller to dispatch into Redux.
 */
export async function importVault(
  options: { password?: string; filePath?: string },
  onProgress?: ImportProgressCallback
): Promise<{
  manifest: ImportedManifest;
  notes: ImportedNote[];
  settings: Record<string, unknown> | null;
  fileEntries: Array<{
    path: string;
    name: string;
    folderId: string;
    data: string;
    encoding: 'utf8' | 'base64';
  }>;
} | null> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Vault import requires Electron');
  }

  const ipc = window.electron.ipcRenderer;

  // Phase 1: Open file dialog and read ZIP
  onProgress?.({ phase: 'reading', current: 0, total: 1 });

  const zipData: {
    entries: Array<{ path: string; data: string; encoding: 'utf8' | 'base64' }>;
  } | null = await ipc.invoke('vault:importZip', {
    filePath: options.filePath,
    password: options.password,
  });

  if (!zipData || !zipData.entries) {
    return null; // User cancelled
  }

  onProgress?.({ phase: 'parsing', current: 0, total: 1 });

  const entryMap = new Map<string, string>();
  for (const entry of zipData.entries) {
    entryMap.set(entry.path, entry.data);
  }

  // Parse manifest
  const manifestRaw = entryMap.get('_manifest.json');
  if (!manifestRaw) {
    throw new Error('Invalid backup: missing _manifest.json');
  }
  const manifest: ImportedManifest = JSON.parse(manifestRaw);

  // Parse full-fidelity notes from _data/notes.json
  let notes: ImportedNote[] = [];
  const notesJsonRaw = entryMap.get('_data/notes.json');
  if (notesJsonRaw) {
    notes = JSON.parse(notesJsonRaw);
  }

  onProgress?.({ phase: 'notes', current: 0, total: notes.length });

  // Parse settings
  let settings: Record<string, unknown> | null = null;
  const settingsRaw = entryMap.get('_data/settings.json');
  if (settingsRaw) {
    settings = JSON.parse(settingsRaw);
  }

  // Collect file entries (binary blobs under files/)
  const fileEntries: Array<{
    path: string;
    name: string;
    folderId: string;
    data: string;
    encoding: 'utf8' | 'base64';
  }> = [];

  for (const entry of zipData.entries) {
    if (entry.path.startsWith('files/') && entry.encoding === 'base64') {
      const pathParts = entry.path.replace('files/', '').split('/');
      const fileName = pathParts.pop() || '';
      const folderPath = pathParts.join('/');

      // Find the folder ID by matching the folder path to manifest folders
      const folder = manifest.folders.find((f) => f.name === folderPath || f.path === folderPath);
      const folderId = folder?.id || 'root';

      if (fileName) {
        fileEntries.push({
          path: entry.path,
          name: fileName,
          folderId,
          data: entry.data,
          encoding: entry.encoding,
        });
      }
    }
  }

  onProgress?.({ phase: 'done', current: 1, total: 1 });

  return { manifest, notes, settings, fileEntries };
}
