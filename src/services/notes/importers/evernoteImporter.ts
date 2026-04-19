/**
 * Evernote .enex Importer
 *
 * Parses Evernote's .enex XML export format:
 * - <note> elements → Filarr notes
 * - ENML content (XHTML subset) → HTML → TipTap JSON
 * - <en-media> tags → inline images (base64 data URIs)
 * - <en-todo> tags → task list items
 * - <tag> elements → Filarr tags
 * - <created>/<updated> timestamps → note dates
 */

import type { Note } from '../../../types/notes';
import { createNote } from '../noteService';
import { htmlToTipTap, extractPlainText, countWords } from '../noteImportService';
import type {
  ExternalImportOptions,
  ExternalImportResult,
  ProgressCallback,
} from '../externalImportService';

// ==================== ENML → HTML Conversion ====================

/** Parse <resource> elements and build a hash → data URI map */
function parseResources(noteEl: Element): Map<string, { dataUri: string; filename?: string }> {
  const resources = new Map<string, { dataUri: string; filename?: string }>();
  const resourceEls = noteEl.querySelectorAll('resource');

  for (const res of Array.from(resourceEls)) {
    const dataEl = res.querySelector('data');
    const mimeEl = res.querySelector('mime');
    const recognitionEl = res.querySelector('recognition');
    const fileNameEl = res.querySelector('file-name');
    const resourceAttrEl = res.querySelector('resource-attributes');

    if (!dataEl?.textContent || !mimeEl?.textContent) continue;

    const data = dataEl.textContent.replace(/\s+/g, '');
    const mime = mimeEl.textContent.trim();
    const filename =
      fileNameEl?.textContent?.trim() ||
      resourceAttrEl?.querySelector('file-name')?.textContent?.trim();

    // Compute MD5 hash for matching <en-media> references
    // Since we can't easily compute MD5 in the browser, extract from recognition data
    let hash = '';
    if (recognitionEl?.textContent) {
      const hashMatch = recognitionEl.textContent.match(/objID="([a-f0-9]+)"/);
      if (hashMatch) hash = hashMatch[1];
    }

    // Fallback: use a simple hash of the first 100 chars of data
    if (!hash) {
      hash = simpleHash(data.slice(0, 100));
    }

    resources.set(hash, {
      dataUri: `data:${mime};base64,${data}`,
      filename,
    });
  }

  return resources;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

/** Convert ENML content to standard HTML */
function enmlToHtml(
  enml: string,
  resources: Map<string, { dataUri: string; filename?: string }>
): string {
  let html = enml;

  // Remove XML declaration and DOCTYPE
  html = html.replace(/<\?xml[^?]*\?>/g, '');
  html = html.replace(/<!DOCTYPE[^>]*>/g, '');

  // Replace <en-note> with <div>
  html = html.replace(/<en-note[^>]*>/g, '<div>');
  html = html.replace(/<\/en-note>/g, '</div>');

  // Replace <en-todo> with checkbox indicators
  html = html.replace(
    /<en-todo\s+checked="true"\s*\/>/g,
    '<input type="checkbox" checked disabled /> '
  );
  html = html.replace(/<en-todo\s+checked="false"\s*\/>/g, '<input type="checkbox" disabled /> ');
  html = html.replace(/<en-todo\s*\/>/g, '<input type="checkbox" disabled /> ');

  // Replace <en-media> with <img> or file links
  html = html.replace(
    /<en-media[^>]*hash="([a-f0-9]+)"[^>]*(?:type="([^"]*)")?[^>]*\/?>/gi,
    (_match, hash, _type) => {
      const resource = resources.get(hash);
      if (resource) {
        if (resource.dataUri.startsWith('data:image/')) {
          return `<img src="${resource.dataUri}" alt="${resource.filename || 'image'}" />`;
        }
        return `<p>[Attachment: ${resource.filename || 'file'}]</p>`;
      }
      return '<p>[Missing attachment]</p>';
    }
  );

  // Remove <en-crypt> encrypted sections (can't be imported)
  html = html.replace(
    /<en-crypt[^>]*>.*?<\/en-crypt>/gs,
    '<p>[Encrypted content — cannot be imported]</p>'
  );

  return html;
}

// ==================== Evernote Date Parsing ====================

/** Parse Evernote's date format: 20231215T143022Z → ISO string */
function parseEvernoteDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString();
  try {
    // Format: YYYYMMDDTHHmmssZ
    const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (match) {
      const [, y, m, d, h, min, s] = match;
      return new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`).toISOString();
    }
    return new Date(dateStr).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// ==================== Main Parser ====================

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function parseEvernoteExport(
  enexContent: string,
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

  // Parse the XML
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(enexContent, 'text/xml');

  // Check for parsing errors
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    result.errors.push(`XML parsing error: ${parseError.textContent?.slice(0, 200)}`);
    return result;
  }

  const noteElements = xmlDoc.querySelectorAll('note');
  if (noteElements.length === 0) {
    result.warnings.push('No notes found in the .enex file.');
    return result;
  }

  const allTags = new Set<string>();

  for (let i = 0; i < noteElements.length; i++) {
    const noteEl = noteElements[i];

    if (i % 50 === 0) {
      onProgress?.({
        phase: 'converting',
        current: i,
        total: noteElements.length,
        detail: `Note ${i + 1}/${noteElements.length}`,
      });
      await yieldToUI();
    }

    try {
      // Extract metadata
      const title = noteEl.querySelector('title')?.textContent?.trim() || 'Untitled';
      const contentEl = noteEl.querySelector('content');
      const createdStr = noteEl.querySelector('created')?.textContent?.trim() || '';
      const updatedStr = noteEl.querySelector('updated')?.textContent?.trim() || '';

      // Extract tags
      const noteTags: string[] = [];
      if (options.importTags) {
        const tagEls = noteEl.querySelectorAll('tag');
        for (const tagEl of Array.from(tagEls)) {
          const tagName = tagEl.textContent?.trim();
          if (tagName) {
            noteTags.push(tagName);
            allTags.add(tagName);
          }
        }
      }

      // Get ENML content from CDATA
      let enmlContent = contentEl?.textContent || '';
      if (!enmlContent.trim()) {
        result.warnings.push(`Note "${title}" has no content, creating empty note.`);
        enmlContent = '<en-note></en-note>';
      }

      // Parse resources (images, files)
      const resources = parseResources(noteEl);

      // Convert ENML → HTML → TipTap
      const html = enmlToHtml(enmlContent, resources);
      const { doc } = htmlToTipTap(html);
      const plainText = extractPlainText(doc);

      const note = createNote({
        title,
        content: JSON.stringify(doc),
        plainText,
        wordCount: countWords(plainText),
        notebookId: options.targetNotebookId || undefined,
        tagIds: [],
        createdAt: parseEvernoteDate(createdStr),
        updatedAt: parseEvernoteDate(updatedStr) || parseEvernoteDate(createdStr),
      });

      // Store tag names for later resolution
      (note as Note & { _importTags?: string[] })._importTags = noteTags;

      result.notes.push(note);
      result.notesImported++;
    } catch (err) {
      result.errors.push(
        `Failed to import note ${i + 1}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  result.tags = Array.from(allTags).map((name) => ({ name }));
  result.tagsCreated = result.tags.length;

  return result;
}
