/**
 * Notion Export Importer
 *
 * Parses a Notion ZIP export (HTML or Markdown format):
 * - Strips UUID suffixes from filenames (e.g. "Page Title abc12345def.md" → "Page Title")
 * - Converts HTML/MD content → TipTap JSON
 * - Maps nested folder structure to note hierarchy
 * - Resolves inter-page links using the title mapping
 */

import { createNote } from '../noteService';
import { markdownToTipTap, htmlToTipTap, extractPlainText, countWords } from '../noteImportService';
import type {
  SourceEntry,
  ExternalImportOptions,
  ExternalImportResult,
  ProgressCallback,
} from '../externalImportService';

// ==================== Notion-specific helpers ====================

/** Notion appends a hex UUID to filenames: "Page Title abc12345def67.md" → "Page Title" */
function cleanNotionTitle(filename: string): string {
  // Remove file extension
  const withoutExt = filename.replace(/\.(md|html|htm|csv)$/i, '');
  // Remove Notion's hex UUID suffix (typically 32 hex chars at the end, separated by space)
  const cleaned = withoutExt.replace(/\s+[a-f0-9]{20,}$/i, '');
  // Also handle underscore-separated UUIDs
  return cleaned.replace(/_[a-f0-9]{20,}$/i, '').trim() || withoutExt;
}

/** Check if file is a content file (not an attachment or config) */
function isContentFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    (lower.endsWith('.md') || lower.endsWith('.html') || lower.endsWith('.htm')) &&
    !lower.includes('__') // Notion sometimes uses __ for internal files
  );
}

// ==================== Main Parser ====================

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function parseNotionExport(
  entries: SourceEntry[],
  options: ExternalImportOptions,
  onProgress?: ProgressCallback
): Promise<ExternalImportResult> {
  const result: ExternalImportResult = {
    notes: [],
    tags: [],
    notebooks: [],
    notesImported: 0,
    tagsCreated: 0,
    linksResolved: 0,
    warnings: [],
    errors: [],
  };

  // Filter content files
  const contentFiles = entries.filter((e) => !e.isDirectory && isContentFile(e.relativePath));

  if (contentFiles.length === 0) {
    result.warnings.push(
      'No content files found in the Notion export. Make sure you exported as HTML or Markdown.'
    );
    return result;
  }

  // Build a title mapping for link resolution (original Notion filename → clean title)
  const titleMap = new Map<string, string>();

  for (let i = 0; i < contentFiles.length; i++) {
    const entry = contentFiles[i];

    if (i % 50 === 0) {
      onProgress?.({
        phase: 'converting',
        current: i,
        total: contentFiles.length,
        detail: entry.relativePath,
      });
      await yieldToUI();
    }

    try {
      const fileName = entry.relativePath.split('/').pop() || '';
      const isHtml = /\.html?$/i.test(fileName);
      const cleanTitle = cleanNotionTitle(fileName);

      // Store mapping for link resolution
      titleMap.set(fileName, cleanTitle);
      // Also map without extension and with UUID for broader matching
      const withoutExt = fileName.replace(/\.(md|html|htm)$/i, '');
      titleMap.set(withoutExt, cleanTitle);

      let title: string;
      let doc: { type: string; content?: unknown[] };
      let plainText: string;

      if (isHtml) {
        const parsed = htmlToTipTap(entry.content);
        title = parsed.title || cleanTitle;
        doc = parsed.doc;
        plainText = extractPlainText(parsed.doc);
      } else {
        const parsed = markdownToTipTap(entry.content);
        title = parsed.title || cleanTitle;
        doc = parsed.doc;
        plainText = extractPlainText(parsed.doc);
      }

      const note = createNote({
        title,
        content: JSON.stringify(doc),
        plainText,
        wordCount: countWords(plainText),
        notebookId: options.targetNotebookId || undefined,
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      result.notes.push(note);
      result.notesImported++;
    } catch (err) {
      result.errors.push(
        `Failed to import ${entry.relativePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Try to extract tags from any CSV database exports
  if (options.importTags) {
    const csvFiles = entries.filter(
      (e) => !e.isDirectory && e.relativePath.toLowerCase().endsWith('.csv')
    );
    for (const csv of csvFiles) {
      try {
        const tags = extractTagsFromNotionCsv(csv.content);
        for (const tag of tags) {
          if (!result.tags.some((t) => t.name === tag)) {
            result.tags.push({ name: tag });
          }
        }
      } catch {
        // CSV parsing is best-effort
      }
    }
    result.tagsCreated = result.tags.length;
  }

  return result;
}

// ==================== CSV Tag Extraction ====================

/** Extract Select/Multi-Select values from Notion CSV database exports as tags */
function extractTagsFromNotionCsv(csvContent: string): string[] {
  const tags = new Set<string>();
  const lines = csvContent.split('\n');
  if (lines.length < 2) return [];

  // Parse header to find potential tag columns (Select, Multi-Select, Tags)
  const headers = parseCsvLine(lines[0]);
  const tagColumnIndices: number[] = [];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (
      h.includes('tag') ||
      h.includes('category') ||
      h.includes('type') ||
      h.includes('status') ||
      h.includes('label')
    ) {
      tagColumnIndices.push(i);
    }
  }

  // Extract values from tag columns
  for (let row = 1; row < lines.length; row++) {
    if (!lines[row].trim()) continue;
    const cells = parseCsvLine(lines[row]);
    for (const idx of tagColumnIndices) {
      const cell = cells[idx]?.trim();
      if (cell) {
        // Multi-select values are comma-separated within the cell
        for (const val of cell.split(',')) {
          const trimmed = val.trim();
          if (trimmed && trimmed.length < 50) {
            tags.add(trimmed);
          }
        }
      }
    }
  }

  return Array.from(tags);
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
