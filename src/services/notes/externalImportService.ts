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
  /**
   * `base64` pour une entree BINAIRE (image, PDF, police...).
   *
   * Le principal decodait deja les binaires en base64 et l'annoncait ici — mais
   * le champ etait JETE a la lecture de l'archive, si bien qu'aucun importateur
   * ne pouvait distinguer une image d'un fichier texte. Toutes les images d'un
   * export Notion etaient donc perdues avant meme d'atteindre le convertisseur.
   */
  encoding?: 'utf8' | 'base64';
}

// ==================== Orchestrator ====================

/**
 * Files read per `import:readBatch` round-trip.
 *
 * The point of batching is that only one batch of raw file content is alive
 * at a time, so this is the knob that decides peak memory during a large
 * import. A few hundred keeps the IPC round-trips cheap without letting the
 * transient payload grow past a few MB.
 */
const OBSIDIAN_BATCH_SIZE = 400;

/** Obsidian notes are Markdown — never ask the main process for anything else. */
const OBSIDIAN_EXTENSIONS = ['.md', '.markdown'];

function emptyResult(errors: string[] = [], warnings: string[] = []): ExternalImportResult {
  return {
    notes: [],
    tags: [],
    notebooks: [],
    notesImported: 0,
    tagsCreated: 0,
    linksResolved: 0,
    warnings,
    errors,
  };
}

/** Let the UI repaint and make the previous batch's strings collectable. */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Obsidian import, streamed.
 *
 * Lists the vault's Markdown paths first, then reads and converts them in
 * batches. Nothing ever holds the whole vault: each batch's raw content is
 * dropped once converted, so memory tracks OBSIDIAN_BATCH_SIZE rather than
 * the number of notes. Attachments are never read at all — the importer only
 * consumes Markdown, and reading images just to discard them was what made
 * large vaults exhaust the heap.
 */
async function runObsidianImport(
  options: ExternalImportOptions,
  onProgress?: ProgressCallback
): Promise<ExternalImportResult> {
  const { ObsidianVaultAccumulator } = await import('./importers/obsidianImporter');

  // Phase 1: enumerate paths only — cheap regardless of vault size
  onProgress?.({ phase: 'reading', current: 0, total: 1, detail: 'Listing vault files...' });

  const listing = (await window.electron.ipcRenderer.invoke('import:listFiles', {
    dirPath: options.sourcePath,
    extensions: OBSIDIAN_EXTENSIONS,
  })) as { files: string[]; truncated: boolean; oversized: number } | null;

  const files = listing?.files ?? [];
  if (files.length === 0) {
    return emptyResult(['No Markdown file found in this folder — is it an Obsidian vault?']);
  }

  onProgress?.({ phase: 'reading', current: 1, total: 1, detail: `${files.length} notes found` });

  const accumulator = new ObsidianVaultAccumulator(options);

  // Surface what the walk left out. A silently partial import is worse than a
  // failed one: it looks like a success and the user never goes looking.
  if (listing?.truncated) {
    accumulator.addWarning(
      `Vault too large to enumerate fully — only the first ${files.length} notes were imported. ` +
        'Split the vault and import the rest separately.'
    );
  }
  if (listing?.oversized && listing.oversized > 0) {
    accumulator.addWarning(
      `${listing.oversized} file(s) skipped: larger than the 10 MB per-file limit.`
    );
  }

  // Phase 2: read + convert, one batch at a time
  for (let offset = 0; offset < files.length; offset += OBSIDIAN_BATCH_SIZE) {
    const batch = files.slice(offset, offset + OBSIDIAN_BATCH_SIZE);

    onProgress?.({
      phase: 'converting',
      current: offset,
      total: files.length,
      detail: batch[0],
    });

    const entries = (await window.electron.ipcRenderer.invoke('import:readBatch', {
      dirPath: options.sourcePath,
      relativePaths: batch,
    })) as SourceEntry[] | null;

    if (!entries || entries.length === 0) {
      accumulator.addWarning(
        `Could not read ${batch.length} file(s) starting at "${batch[0]}" — skipped.`
      );
      continue;
    }

    accumulator.addBatch(entries);
    await yieldToUI();
  }

  const result = accumulator.finalize();

  // Phase 3: resolve internal links across every note
  if (options.preserveLinks && result.notes.length > 1) {
    onProgress?.({ phase: 'linking', current: 0, total: result.notes.length });
    result.linksResolved = resolveInternalLinks(result.notes);
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

export async function runExternalImport(
  options: ExternalImportOptions,
  onProgress?: ProgressCallback
): Promise<ExternalImportResult> {
  const { source, sourcePath } = options;

  // Obsidian reads a directory, which can be arbitrarily large — it gets the
  // streaming path. ZIP/ENEX sources are a single bounded file.
  if (source === 'obsidian') {
    return await runObsidianImport(options, onProgress);
  }

  // Phase 1: Read source data
  onProgress?.({ phase: 'reading', current: 0, total: 1, detail: 'Reading source files...' });

  let entries: SourceEntry[];

  if (source === 'notion') {
    // Read ZIP via existing vault:importZip IPC
    const zipResult = await window.electron.ipcRenderer.invoke('vault:importZip', {
      filePath: sourcePath,
    });
    if (!zipResult?.entries) {
      return emptyResult(['Failed to read ZIP file']);
    }
    entries = zipResult.entries.map(
      (e: { path: string; data: string; encoding?: 'utf8' | 'base64' }) => ({
        relativePath: e.path,
        content: e.data,
        isDirectory: e.path.endsWith('/'),
        encoding: e.encoding ?? 'utf8',
      })
    );
  } else {
    // Evernote: read single .enex file
    const fileResult = await window.electron.ipcRenderer.invoke('import:readFile', sourcePath);
    if (!fileResult) {
      return emptyResult(['Failed to read .enex file']);
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

  if (source === 'notion') {
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
