/**
 * External Import Service — Filarr Notes
 *
 * Orchestrates importing notes from external applications:
 * - Obsidian (Markdown vault with YAML frontmatter + wiki-links)
 * - Notion (ZIP export with HTML/Markdown + nested folders)
 * - Evernote (.enex XML with ENML content + embedded resources)
 */

import type { Note } from '../../types/notes';

// ==================== Types ====================

export type ExternalSource = 'obsidian' | 'notion' | 'evernote';

export interface ExternalImportOptions {
  source: ExternalSource;
  /** For Notion/Evernote: path to ZIP/ENEX file. For Obsidian: path to vault directory */
  sourcePath: string;
  /** Target notebook ID for imported notes */
  targetNotebookId?: string;
  /** Whether to import tags (default: true) */
  importTags: boolean;
  /** Whether to preserve internal links between imported notes (default: true) */
  preserveLinks: boolean;
}

export interface ExternalImportResult {
  notes: Note[];
  tags: { name: string; parentName?: string; color?: string }[];
  /** Notebooks to create from folder structure (name → list of note IDs) */
  notebooks: { name: string; noteIds: string[] }[];
  notesImported: number;
  tagsCreated: number;
  linksResolved: number;
  warnings: string[];
  errors: string[];
}

export interface ExternalImportProgress {
  phase: 'reading' | 'parsing' | 'converting' | 'linking' | 'done';
  current: number;
  total: number;
  detail?: string;
}

export type ProgressCallback = (progress: ExternalImportProgress) => void;

/** Entry from reading a directory or ZIP */
export interface SourceEntry {
  relativePath: string;
  content: string;
  isDirectory: boolean;
}

// ==================== Orchestrator ====================

export async function runExternalImport(
  options: ExternalImportOptions,
  onProgress?: ProgressCallback
): Promise<ExternalImportResult> {
  const { source, sourcePath } = options;

  // Phase 1: Read source data
  onProgress?.({ phase: 'reading', current: 0, total: 1, detail: 'Reading source files...' });

  let entries: SourceEntry[];

  if (source === 'obsidian') {
    // Read directory via IPC
    entries = await window.electron.ipcRenderer.invoke('import:readDirectory', sourcePath);
  } else if (source === 'notion') {
    // Read ZIP via existing vault:importZip IPC
    const zipResult = await window.electron.ipcRenderer.invoke('vault:importZip', {
      filePath: sourcePath,
    });
    if (!zipResult?.entries) {
      return {
        notes: [],
        tags: [],
        notebooks: [],
        notesImported: 0,
        tagsCreated: 0,
        linksResolved: 0,
        warnings: [],
        errors: ['Failed to read ZIP file'],
      };
    }
    entries = zipResult.entries.map((e: { path: string; data: string }) => ({
      relativePath: e.path,
      content: e.data,
      isDirectory: e.path.endsWith('/'),
    }));
  } else {
    // Evernote: read single .enex file
    const fileResult = await window.electron.ipcRenderer.invoke('import:readFile', sourcePath);
    if (!fileResult) {
      return {
        notes: [],
        tags: [],
        notebooks: [],
        notesImported: 0,
        tagsCreated: 0,
        linksResolved: 0,
        warnings: [],
        errors: ['Failed to read .enex file'],
      };
    }
    entries = [
      { relativePath: fileResult.fileName, content: fileResult.content, isDirectory: false },
    ];
  }

  onProgress?.({
    phase: 'reading',
    current: 1,
    total: 1,
    detail: `${entries.length} entries found`,
  });

  // Phase 2: Parse with source-specific importer
  onProgress?.({ phase: 'parsing', current: 0, total: entries.length });

  let result: ExternalImportResult;

  if (source === 'obsidian') {
    const { parseObsidianVault } = await import('./importers/obsidianImporter');
    result = await parseObsidianVault(entries, options, onProgress);
  } else if (source === 'notion') {
    const { parseNotionExport } = await import('./importers/notionImporter');
    result = await parseNotionExport(entries, options, onProgress);
  } else {
    const { parseEvernoteExport } = await import('./importers/evernoteImporter');
    result = await parseEvernoteExport(entries[0].content, options, onProgress);
  }

  // Phase 3: Resolve internal links
  if (options.preserveLinks && result.notes.length > 1) {
    onProgress?.({ phase: 'linking', current: 0, total: result.notes.length });
    const resolved = resolveInternalLinks(result.notes);
    result.linksResolved = resolved;
    onProgress?.({ phase: 'linking', current: result.notes.length, total: result.notes.length });
  }

  onProgress?.({
    phase: 'done',
    current: result.notesImported,
    total: result.notesImported,
    detail: 'Import complete',
  });

  return result;
}

// ==================== Link Resolution ====================

/**
 * After all notes are imported, resolve wiki-links between them.
 * Matches [[note title]] against imported note titles to populate linkedNoteIds.
 */
function resolveInternalLinks(notes: Note[]): number {
  const titleMap = new Map<string, string>(); // lowercased title → note ID
  for (const note of notes) {
    if (note.title) {
      titleMap.set(note.title.toLowerCase(), note.id);
    }
  }

  let resolved = 0;
  const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  for (const note of notes) {
    const linkedIds = new Set<string>(note.linkedNoteIds);
    let match: RegExpExecArray | null;

    // Search in content string for wiki-links
    wikiLinkPattern.lastIndex = 0;
    while ((match = wikiLinkPattern.exec(note.content)) !== null) {
      const linkTarget = match[1].trim().toLowerCase();
      const targetId = titleMap.get(linkTarget);
      if (targetId && targetId !== note.id && !linkedIds.has(targetId)) {
        linkedIds.add(targetId);
        resolved++;
      }
    }

    // Also check plainText for wiki-links
    wikiLinkPattern.lastIndex = 0;
    while ((match = wikiLinkPattern.exec(note.plainText)) !== null) {
      const linkTarget = match[1].trim().toLowerCase();
      const targetId = titleMap.get(linkTarget);
      if (targetId && targetId !== note.id && !linkedIds.has(targetId)) {
        linkedIds.add(targetId);
        resolved++;
      }
    }

    note.linkedNoteIds = Array.from(linkedIds);
  }

  return resolved;
}
