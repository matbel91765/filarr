/**
 * Document Text Extraction (buffer-based)
 *
 * Extracts plain text from a decrypted document ArrayBuffer and feeds it into the
 * search index, so Word/CSV/text documents become findable by content — not just
 * viewable. Runs entirely in the renderer (offline, no bytes leave the device).
 *
 * This complements pdfTextExtractor (which pulls PDFs from a local path in the
 * background queue). This path is driven from the preview panel, where we already
 * hold the decrypted bytes, so it is correct regardless of at-rest encryption.
 */

import searchService from './searchService';
import mammoth from 'mammoth/mammoth.browser';

// Keep the stored content bounded so the Fuse index doesn't bloat.
const MAX_CONTENT_LENGTH = 100_000;

// Plain-text / structured-text formats we can decode directly as UTF-8.
const TEXT_LIKE = new Set([
  'txt',
  'md',
  'markdown',
  'mdx',
  'csv',
  'tsv',
  'json',
  'log',
  'xml',
  'yaml',
  'yml',
  'html',
  'htm',
  'js',
  'ts',
  'jsx',
  'tsx',
  'css',
  'scss',
  'ini',
  'conf',
  'sh',
]);

const extOf = (fileName: string): string => fileName.split('.').pop()?.toLowerCase() || '';

/** Whether we can extract searchable text from this file's decrypted buffer. */
export function isBufferExtractable(fileName: string): boolean {
  const ext = extOf(fileName);
  return ext === 'docx' || TEXT_LIKE.has(ext);
}

function clamp(text: string): string {
  const t = text.trim();
  return t.length > MAX_CONTENT_LENGTH ? t.slice(0, MAX_CONTENT_LENGTH) : t;
}

/** Extract plain text from a decrypted document buffer. Returns '' if unsupported. */
export async function extractBufferText(fileName: string, buffer: ArrayBuffer): Promise<string> {
  const ext = extOf(fileName);
  if (ext === 'docx') {
    // slice(0) so mammoth's typed-array view never disturbs the shared buffer.
    const result = await mammoth.extractRawText({ arrayBuffer: buffer.slice(0) });
    return clamp(result.value);
  }
  if (TEXT_LIKE.has(ext)) {
    return clamp(new TextDecoder('utf-8').decode(buffer));
  }
  return '';
}

/**
 * Extract a document's text and index it for full-text search. Best-effort:
 * never throws, and no-ops for items not present in the search index.
 */
export async function indexBufferContent(
  fileId: string,
  fileName: string,
  buffer: ArrayBuffer,
  rebuildIndex = true
): Promise<void> {
  try {
    if (!isBufferExtractable(fileName)) return;
    const text = await extractBufferText(fileName, buffer);
    if (text.length > 0) {
      searchService.updateItemContent(fileId, text);
      if (rebuildIndex) searchService.buildFuseIndex();
    }
  } catch (err) {
    console.warn(`[DocumentTextExtractor] Failed to extract text from ${fileId}:`, err);
  }
}
