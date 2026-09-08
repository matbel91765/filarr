/**
 * PDF Text Extraction Service
 *
 * Uses pdfjs-dist (already bundled for PDF preview) to extract text content
 * from PDF files and populate SearchIndex.content for full-text search.
 *
 * No additional dependencies required — pdfjs getTextContent() is built-in.
 */

import * as pdfjsLib from 'pdfjs-dist';
import searchService from './searchService';
// Shared worker setup (blob URL, CSP-safe, offline). Background extraction can
// run before <PDFPreview> ever mounts, so import it here too.
import { pdfWorkerReady } from '../../utils/pdfWorker';

// Max pages to extract per PDF (avoids blocking on huge PDFs)
const MAX_PAGES = 50;
// Max text length stored per item (avoid bloating the Fuse index)
const MAX_CONTENT_LENGTH = 100_000;

/**
 * Extract all text content from a PDF file.
 * @param pdfSource - Either a URL/path string or an ArrayBuffer of the PDF data
 * @returns Concatenated text content from all pages
 */
export async function extractPdfText(pdfSource: string | ArrayBuffer): Promise<string> {
  await pdfWorkerReady;
  const loadingTask = pdfjsLib.getDocument(
    typeof pdfSource === 'string' ? pdfSource : { data: pdfSource }
  );
  const pdf = await loadingTask.promise;

  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const pageTexts: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    pageTexts.push(pageText);
  }

  const fullText = pageTexts.join('\n').trim();
  return fullText.length > MAX_CONTENT_LENGTH ? fullText.slice(0, MAX_CONTENT_LENGTH) : fullText;
}

/**
 * Extract text from a PDF and index it for search.
 * Safe to call multiple times — overwrites previous content.
 *
 * @param fileId - The file ID in the search index
 * @param pdfSource - PDF data (URL or ArrayBuffer)
 * @param rebuildIndex - Whether to rebuild the Fuse index after update (default true)
 */
export async function indexPdfContent(
  fileId: string,
  pdfSource: string | ArrayBuffer,
  rebuildIndex: boolean = true
): Promise<void> {
  try {
    const text = await extractPdfText(pdfSource);
    if (text.length > 0) {
      searchService.updateItemContent(fileId, text);
      if (rebuildIndex) {
        searchService.buildFuseIndex();
      }
    }
  } catch (err) {
    // PDF extraction is best-effort — don't break the app if a PDF is corrupted
    console.warn(`[PdfTextExtractor] Failed to extract text from file ${fileId}:`, err);
  }
}

/**
 * Batch-extract text from multiple PDFs.
 * Rebuilds the Fuse index only once at the end.
 *
 * @param items - Array of { fileId, pdfSource } pairs
 */
export async function batchIndexPdfContent(
  items: Array<{ fileId: string; pdfSource: string | ArrayBuffer }>
): Promise<number> {
  let indexed = 0;
  for (const item of items) {
    try {
      const text = await extractPdfText(item.pdfSource);
      if (text.length > 0) {
        searchService.updateItemContent(item.fileId, text);
        indexed++;
      }
    } catch (err) {
      console.warn(`[PdfTextExtractor] Skipping ${item.fileId}:`, err);
    }
  }

  if (indexed > 0) {
    searchService.buildFuseIndex();
  }

  return indexed;
}
