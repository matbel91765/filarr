/**
 * pdf.js worker configuration (shared by the PDF preview and the search
 * text-extractor).
 *
 * The app CSP (electron/main.ts) is `script-src 'self'` (no `'unsafe-eval'`) and
 * `worker-src 'self' blob: https://cdnjs.cloudflare.com`. So pdf.js's eval-based
 * "fake worker" fallback is blocked, and a bare `'self'` worker path is
 * unreliable under `file://` in the packaged build — the net effect being a PDF
 * that never renders. We therefore fetch the bundled worker and hand pdf.js a
 * `blob:` URL, which the CSP explicitly allows in every environment and works
 * fully offline (no CDN). Await `pdfWorkerReady` before the first getDocument so
 * the blob URL is in place first; a direct-path fallback keeps things working if
 * the fetch ever fails.
 */
import * as pdfjsLib from 'pdfjs-dist';

const WORKER_URL = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.js`;

// Set synchronously so workerSrc is never empty if the blob step is skipped.
pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;

export const pdfWorkerReady: Promise<void> = (async () => {
  try {
    const res = await fetch(WORKER_URL);
    if (!res.ok) return;
    const blob = await res.blob();
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  } catch {
    /* keep the direct-path fallback set above */
  }
})();
