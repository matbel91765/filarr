/**
 * rangeSource.ts — renderer-side random-access reader over a vault file.
 *
 * Preview code (PDF, ZIP, huge text/logs) needs to pull arbitrary byte windows
 * of a decrypted vault file WITHOUT buffering the whole thing in renderer RAM.
 * The main-process `filarr-stream://` protocol already decrypts V3 containers
 * chunk-by-chunk and honours HTTP `Range` requests (see electron/streamProtocol.ts),
 * so this module simply speaks that protocol with `fetch` + `Range` headers.
 *
 * URL shape (shared contract with the main-process handler and FilePreviewPanel):
 *   filarr-stream://media/<folderId>/<encodeURIComponent(fileName)>
 *
 * IMPORTANT for the integrate agent: the renderer CSP `connect-src` directive
 * (electron/main.ts) does NOT currently list `filarr-stream:`, so `fetch()` to a
 * stream URL is blocked until `filarr-stream:` is added to `connect-src`. The
 * `fetch` implementation is injectable (see `RangeFetch`) so an IPC-backed reader
 * can be swapped in instead if you prefer to keep the CSP tight.
 *
 * Pure/transport-only: no Electron, DOM, or Node built-ins — everything here is
 * unit-testable with a fake `RangeFetch`.
 */

export const STREAM_SCHEME = 'filarr-stream';
export const STREAM_HOST = 'media';

/**
 * Minimal structural view of the parts of a `fetch` Response this module uses.
 * The real DOM `Response` (and Node's global `Response`) satisfy this, so the
 * concrete `fetch` is assignable to `RangeFetch` with no casting.
 */
export interface RangeResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly body?: { cancel(): Promise<void> } | null;
}

/** The subset of `fetch` used here. The global `fetch` is assignable to this. */
export type RangeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string> }
) => Promise<RangeResponse>;

/**
 * A file bound to a random-access reader. Consumed by the PDF transport shim and
 * the ZIP directory reader, so both can be unit-tested against an in-memory fake.
 * `readRange` uses a half-open window `[start, end)` (like `Array.slice`), which
 * matches pdf.js's `requestDataRange(begin, end)` convention.
 */
export interface RangeSource {
  /** Total plaintext size of the file, in bytes. */
  getSize(): Promise<number>;
  /** Reads the half-open byte window `[start, end)`. May return fewer bytes at EOF. */
  readRange(start: number, end: number): Promise<Uint8Array>;
}

/** Builds the `filarr-stream://` URL for a vault file (matches FilePreviewPanel). */
export function buildStreamUrl(folderId: string, fileName: string): string {
  return `${STREAM_SCHEME}://${STREAM_HOST}/${folderId}/${encodeURIComponent(fileName)}`;
}

/**
 * Extracts the total size from a `Content-Range` header value. Handles both the
 * 206 form `bytes <start>-<end>/<total>` and the 416 unsatisfiable form (a literal
 * asterisk in place of the range). Returns `null` when the total is unknown or the
 * header is absent/malformed.
 */
export function parseContentRangeTotal(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  // The total always follows the final "/". "*" means the length is unknown.
  const m = /\/\s*(\d+)\s*$/.exec(value);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Best-effort release of an unread response body so the connection isn't pinned. */
async function drainBody(res: RangeResponse): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* nothing we can do — best effort */
  }
}

/** Resolves the platform `fetch` lazily so a missing global only fails when actually used. */
function resolveDefaultFetch(): RangeFetch {
  const f = (globalThis as unknown as { fetch?: RangeFetch }).fetch;
  if (typeof f !== 'function') {
    throw new Error(
      'La lecture par plage nécessite « fetch », indisponible dans cet environnement.'
    );
  }
  return f;
}

/**
 * Returns the total byte size of a vault file. Uses a `bytes=0-0` GET (the
 * protocol handler answers `HEAD` with 405, so a tiny ranged GET is used
 * instead): a 206/416 carries the total in `Content-Range`; a 200 (server
 * ignored the range) falls back to `Content-Length`, then to measuring the body.
 */
export async function getSize(
  folderId: string,
  fileName: string,
  fetchImpl?: RangeFetch
): Promise<number> {
  const doFetch = fetchImpl ?? resolveDefaultFetch();
  const url = buildStreamUrl(folderId, fileName);
  let res: RangeResponse;
  try {
    res = await doFetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
  } catch (err) {
    throw new Error(`Impossible de déterminer la taille de « ${fileName} » : ${errText(err)}`, {
      cause: err,
    });
  }

  // 206 (partial) and 416 (unsatisfiable, e.g. empty file) both report the total.
  const total = parseContentRangeTotal(res.headers.get('Content-Range'));
  if (total !== null) {
    await drainBody(res);
    return total;
  }

  if (res.status === 200) {
    const cl = res.headers.get('Content-Length');
    if (cl !== null && /^\d+$/.test(cl.trim())) {
      const n = Number(cl.trim());
      if (Number.isSafeInteger(n)) {
        await drainBody(res);
        return n;
      }
    }
    // Last resort: the server returned the whole object with no usable length.
    const buf = await res.arrayBuffer();
    return buf.byteLength;
  }

  await drainBody(res);
  throw new Error(
    `Impossible de déterminer la taille de « ${fileName} » (statut HTTP ${res.status}).`
  );
}

/**
 * Reads the half-open byte window `[start, end)` of a vault file. Robust to a
 * server that ignores the `Range` header and answers 200 with the full body
 * (the requested window is then sliced client-side). Returns fewer bytes than
 * requested only when the window runs past EOF.
 */
export async function readRange(
  folderId: string,
  fileName: string,
  start: number,
  end: number,
  fetchImpl?: RangeFetch
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new Error(`Plage d'octets invalide (${start}–${end}) pour « ${fileName} ».`);
  }
  if (end === start) {
    return new Uint8Array(0);
  }
  const doFetch = fetchImpl ?? resolveDefaultFetch();
  const url = buildStreamUrl(folderId, fileName);
  // HTTP Range is inclusive on both ends; our window is half-open.
  const rangeHeader = `bytes=${start}-${end - 1}`;
  let res: RangeResponse;
  try {
    res = await doFetch(url, { method: 'GET', headers: { Range: rangeHeader } });
  } catch (err) {
    throw new Error(`Échec de lecture de « ${fileName} » : ${errText(err)}`, { cause: err });
  }

  if (res.status === 206) {
    return new Uint8Array(await res.arrayBuffer());
  }
  if (res.status === 200) {
    // Range ignored: slice the requested window out of the full body.
    const full = new Uint8Array(await res.arrayBuffer());
    const from = Math.min(start, full.length);
    const to = Math.min(end, full.length);
    return full.slice(from, to);
  }
  if (res.status === 416) {
    await drainBody(res);
    throw new Error(
      `Plage demandée hors limites pour « ${fileName} » (octets ${start}–${end - 1}).`
    );
  }
  await drainBody(res);
  throw new Error(`Échec de lecture de « ${fileName} » (statut HTTP ${res.status}).`);
}

/** Binds `folderId`/`fileName` (and an optional `fetch`) into a reusable {@link RangeSource}. */
export function createStreamRangeSource(
  folderId: string,
  fileName: string,
  fetchImpl?: RangeFetch
): RangeSource {
  return {
    getSize: () => getSize(folderId, fileName, fetchImpl),
    readRange: (start, end) => readRange(folderId, fileName, start, end, fetchImpl),
  };
}
