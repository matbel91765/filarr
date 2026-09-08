/**
 * Web Clipper — renderer-side clip ingest (feature #9).
 *
 * The clipper bridge (electron/clipperBridge.ts) forwards a captured page on the
 * `clipper:save` channel. Here, in the renderer where the FEK lives, we:
 *   1. sanitise the HTML with DOMPurify (defang scripts/handlers/iframes),
 *   2. convert it to a TipTap document via the existing htmlToTipTap importer,
 *   3. create a note in the "Clippings" notebook,
 *   4. persist via saveNotesToDisk — which encrypts with the FEK on the way out.
 *
 * The clip never touches the network on its way in (loopback bridge only) and is
 * encrypted at rest like any other note, so the E2EE promise holds end to end.
 */

import DOMPurify from 'dompurify';
import store, { type AppDispatch } from '../../store';
import { addNote, addNotebook, saveNotesToDisk } from '../../store/slices/notesSlice';
import { createNote } from '../notes/noteService';
import { htmlToTipTap } from '../notes/noteImportService';
import { hasHybridKey } from '../auth/hybridCrypto';
import { selectClipperUnlimited } from '../../store/selectors/authSelectors';

/** Captured page sent by the extension — mirrors ClipPayload in clipperBridge.ts. */
interface ClipPayload {
  url: string;
  title: string;
  html?: string;
  selectionText?: string;
  capturedAt?: string;
}

interface ClipSaveResult {
  ok: boolean;
  noteId?: string;
  error?: string;
}

const CLIPPINGS_NOTEBOOK_NAME = 'Clippings';

// ── Free-tier monthly cap (roadmap #9: Free 50/mo, Solo+ unlimited) ──────────
// Client-side only: there is no server in the clipper path at all (loopback
// bridge), so this localStorage counter IS the enforcement, as a product nudge
// rather than a hard security boundary. Counter key rolls over monthly.
export const CLIPPER_FREE_MONTHLY_LIMIT = 50;

function clipCountKey(): string {
  return `filarr-clips-${new Date().toISOString().slice(0, 7)}`; // YYYY-MM
}

function getMonthlyClipCount(): number {
  return parseInt(localStorage.getItem(clipCountKey()) || '0', 10) || 0;
}

function incrementMonthlyClipCount(): void {
  localStorage.setItem(clipCountKey(), String(getMonthlyClipCount() + 1));
}

/** Current month's clip usage, for the Settings panel. */
export function getClipUsage(): { count: number; limit: number; unlimited: boolean } {
  return {
    count: getMonthlyClipCount(),
    limit: CLIPPER_FREE_MONTHLY_LIMIT,
    unlimited: selectClipperUnlimited(store.getState()),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Find the Clippings notebook or create it, returning its id (or '' on failure). */
function findOrCreateClippingsNotebook(): string {
  const existing = Object.values(store.getState().notes.notebooks).find(
    (nb) => nb.name === CLIPPINGS_NOTEBOOK_NAME
  );
  if (existing) return existing.id;
  store.dispatch(
    addNotebook({ name: CLIPPINGS_NOTEBOOK_NAME, icon: 'lucide:Scissors', color: '#6366f1' })
  );
  const created = Object.values(store.getState().notes.notebooks).find(
    (nb) => nb.name === CLIPPINGS_NOTEBOOK_NAME
  );
  return created?.id ?? '';
}

async function handleClip(payload: ClipPayload): Promise<ClipSaveResult> {
  if (!hasHybridKey()) {
    return { ok: false, error: 'Vault is locked — unlock Filarr before clipping' };
  }

  const unlimited = selectClipperUnlimited(store.getState());
  if (!unlimited && getMonthlyClipCount() >= CLIPPER_FREE_MONTHLY_LIMIT) {
    return {
      ok: false,
      error: `Free plan limit reached (${CLIPPER_FREE_MONTHLY_LIMIT} clips/month) — upgrade to Solo for unlimited clipping`,
    };
  }

  // Build a source-attribution header, then the sanitised body.
  const sourceLine = payload.url
    ? `<p><em>Clipped from <a href="${escapeHtml(payload.url)}">${escapeHtml(payload.url)}</a></em></p>`
    : '';
  const bodyHtml =
    payload.html ||
    (payload.selectionText ? `<p>${escapeHtml(payload.selectionText)}</p>` : '<p></p>');

  // DOMPurify hard-strips anything executable. We also drop full <img> data on
  // remote URLs is left to the importer; sanitisation is the security boundary.
  const safeHtml = DOMPurify.sanitize(sourceLine + bodyHtml, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
    ALLOW_DATA_ATTR: false,
  });

  const { title, doc } = htmlToTipTap(safeHtml);
  const finalTitle = (payload.title || title || payload.url || 'Clipping').slice(0, 200);

  const notebookId = findOrCreateClippingsNotebook();
  const note = createNote({
    title: finalTitle,
    content: JSON.stringify(doc),
    notebookId: notebookId || undefined,
  });

  store.dispatch(addNote(note));
  // saveNotesToDisk is a thunk → encrypts + writes via the notes:save IPC.
  await (store.dispatch as AppDispatch)(saveNotesToDisk());

  incrementMonthlyClipCount();
  return { ok: true, noteId: note.id };
}

let initialised = false;

/**
 * Wire up the renderer to receive clips. Idempotent — safe to call on every
 * app mount. Does nothing outside Electron. Also restarts the loopback bridge
 * if the user had it enabled (persistent `clipper-enabled` flag) — the bridge
 * only ever runs once a profile is selected, i.e. when clips can be saved.
 */
export function initClipReceiver(): void {
  if (initialised) return;
  if (!window.electron?.ipcRenderer) return;
  initialised = true;

  window.electron.ipcRenderer
    .invoke('flag:get', 'clipper-enabled')
    .then((v: string | null) =>
      v === 'true' ? window.electron.ipcRenderer.invoke('clipper:setEnabled', true) : undefined
    )
    .catch(() => {
      /* bridge stays off; user can re-enable from Settings */
    });

  window.electron.ipcRenderer.on(
    'clipper:save',
    async (data: { requestId: string; payload: ClipPayload }) => {
      let result: ClipSaveResult;
      try {
        result = await handleClip(data.payload);
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : 'Clip failed' };
      }
      try {
        await window.electron.ipcRenderer.invoke('clipper:saveResult', {
          requestId: data.requestId,
          ...result,
        });
      } catch {
        /* main will time out and report failure to the extension */
      }
    }
  );
}
