/**
 * streamProtocol.ts — pure decision logic for the filarr-stream:// media
 * protocol. No Electron imports: everything here is unit-testable in plain
 * Node. The Electron-side wiring (protocol.registerSchemesAsPrivileged,
 * protocol.handle, decrypt streams) lives in main.ts.
 *
 * URL shape: filarr-stream://media/<folderId>/<encodeURIComponent(fileName)>
 *  - host is the literal "media"
 *  - folderId "root" maps to the profile data dir itself (like
 *    openEncryptedFile)
 *
 * Response contract:
 *  - GET only ................................. anything else -> 405
 *  - too many open streams .................... 503
 *  - bad URL / bad decode / traversal ......... 400 (unknown host -> 404)
 *  - missing file ............................. 404
 *  - legacy (V1/V2) blob over the RAM cap ..... 413
 *  - V3: single "bytes=" range ................ 206 + Content-Range
 *        no Range ............................. 200 full stream
 *        malformed / multi / unsatisfiable .... 416 + wildcard Content-Range
 *  - legacy <= cap: whole-buffer decrypt, Range honored by slicing.
 */

import path from 'path';

export const STREAM_SCHEME = 'filarr-stream';
export const STREAM_HOST = 'media';

/** Max simultaneously open decrypt streams served by the protocol. */
export const MAX_CONCURRENT_STREAMS = 16;

/**
 * Legacy (V1/V2) blobs are not range-decryptable: they are fully decrypted
 * in RAM before serving. Cap mirrors the historical 500 MB legacy vault
 * limit — larger legacy files answer 413.
 */
export const LEGACY_STREAM_MAX_BYTES = 500 * 1024 * 1024;

/**
 * Slack allowed on the *encrypted* size of a legacy blob before we even try
 * decrypting it (marker + salt + IV + GCM tag overhead is ~51 bytes; 4 KiB
 * is generous).
 */
export const LEGACY_CONTAINER_OVERHEAD = 4096;

/** Same character policy as sanitizeFolderId in main.ts ("root" matches). */
const FOLDER_ID_RE = /^[a-zA-Z0-9_-]+$/;

const CONTENT_TYPES: Record<string, string> = {
  // Video / audio (media element consumers via media-src CSP).
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'audio/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  // Documents / archives / images — the protocol now serves ANY vault file by
  // range, not just media, so windowed consumers (PDF viewer, ZIP lister,
  // image tags) receive a correct Content-Type instead of octet-stream.
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  tgz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
};

/** Extension -> MIME type for any vault file (default application/octet-stream). */
export function contentTypeForFile(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) {
    return 'application/octet-stream';
  }
  const ext = fileName.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Mirror of main.ts sanitizePath, as a *reject* (not rewrite) check: a file
 * name must already be a plain basename. Any separator, traversal sequence,
 * NUL byte or drive-qualified form is refused outright.
 */
export function isSafeFileName(name: string): boolean {
  if (!name || name === '.' || name === '..') {
    return false;
  }
  if (name.includes('\0') || name.includes('/') || name.includes('\\')) {
    return false;
  }
  if (name.includes('..')) {
    return false;
  }
  // Defence in depth: catches platform-specific forms the checks above
  // miss (e.g. win32 drive-relative "C:name" -> basename "name").
  if (path.basename(name) !== name) {
    return false;
  }
  return true;
}

export type ParseStreamUrlResult =
  | { ok: true; folderId: string; fileName: string }
  | { ok: false; status: 400 | 404 };

/**
 * Parses and validates a filarr-stream:// URL. Wrong host -> 404; malformed
 * URL, bad percent-encoding, or unsafe path segments -> 400.
 */
export function parseStreamUrl(rawUrl: string): ParseStreamUrlResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400 };
  }
  if (url.protocol !== `${STREAM_SCHEME}:`) {
    return { ok: false, status: 400 };
  }
  if (url.hostname !== STREAM_HOST) {
    return { ok: false, status: 404 };
  }
  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length !== 2) {
    return { ok: false, status: 400 };
  }
  let folderId: string;
  let fileName: string;
  try {
    folderId = decodeURIComponent(segments[0]);
    fileName = decodeURIComponent(segments[1]);
  } catch {
    return { ok: false, status: 400 };
  }
  if (!FOLDER_ID_RE.test(folderId)) {
    return { ok: false, status: 400 };
  }
  if (!isSafeFileName(fileName)) {
    return { ok: false, status: 400 };
  }
  return { ok: true, folderId, fileName };
}

/**
 * Resolves <baseDir>/<folderId>/<fileName> (folderId "root" -> baseDir
 * itself, like openEncryptedFile) and verifies via path.relative that the
 * result stays inside baseDir — defence in depth on top of the character
 * validation above. Returns null when the path escapes or the inputs are
 * unsafe.
 */
export function resolveVaultFilePath(baseDir: string, folderId: string, fileName: string): string | null {
  if (!FOLDER_ID_RE.test(folderId) || !isSafeFileName(fileName)) {
    return null;
  }
  const base = path.resolve(baseDir);
  const dir = folderId === 'root' ? base : path.join(base, folderId);
  const resolved = path.resolve(dir, fileName);
  const rel = path.relative(base, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

export type RangeResult =
  | { type: 'full' }
  | { type: 'range'; start: number; end: number }
  | { type: 'invalid' };

// Exactly one "bytes=start-end" spec. Multi-range and non-bytes units are
// deliberately rejected (-> 416 per the protocol contract).
const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses a Range header against a plaintext size. Returns:
 *  - full     -> no header: serve the whole file (200)
 *  - range    -> a satisfiable inclusive [start, end] window (206)
 *  - invalid  -> malformed, multi-range, or unsatisfiable (416)
 */
export function parseRangeHeader(header: string | null | undefined, size: number): RangeResult {
  if (header === null || header === undefined || header === '') {
    return { type: 'full' };
  }
  const m = RANGE_RE.exec(header.trim());
  if (!m) {
    return { type: 'invalid' };
  }
  const startStr = m[1];
  const endStr = m[2];
  if (startStr === '' && endStr === '') {
    return { type: 'invalid' };
  }
  if (startStr === '') {
    // Suffix range: last N bytes. "bytes=-0" is unsatisfiable per RFC 9110,
    // and no suffix is satisfiable on an empty file.
    const suffix = Number(endStr);
    if (!Number.isSafeInteger(suffix) || suffix === 0 || size === 0) {
      return { type: 'invalid' };
    }
    return { type: 'range', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startStr);
  if (!Number.isSafeInteger(start)) {
    return { type: 'invalid' };
  }
  if (start >= size) {
    return { type: 'invalid' }; // out of bounds (covers empty files too)
  }
  if (endStr === '') {
    return { type: 'range', start, end: size - 1 };
  }
  const end = Number(endStr);
  if (!Number.isSafeInteger(end) || end < start) {
    return { type: 'invalid' };
  }
  return { type: 'range', start, end: Math.min(end, size - 1) };
}

/**
 * What the handler learned about the on-disk file. "unprobed" is only valid
 * when a pre-source check (method / stream cap) short-circuits the request.
 */
export type StreamSource =
  | { state: 'unprobed' }
  | { state: 'missing' }
  | { state: 'legacy-too-large' }
  | { state: 'v3'; plainSize: number }
  | { state: 'legacy'; plainSize: number };

export interface StreamResponsePlan {
  status: number;
  headers: Record<string, string>;
  /** Plaintext window [offset, offset + length) to serve — 200/206 only. */
  window?: { offset: number; length: number };
}

/**
 * Computes the full response decision (status, headers, plaintext window)
 * for a filarr-stream request. Pure: the caller supplies everything it
 * probed. Check order: method -> stream cap -> missing -> legacy size cap
 * -> Range logic.
 */
export function planStreamResponse(opts: {
  method: string;
  fileName: string;
  rangeHeader: string | null | undefined;
  source: StreamSource;
  activeStreams: number;
}): StreamResponsePlan {
  if (opts.method !== 'GET') {
    return { status: 405, headers: { Allow: 'GET' } };
  }
  if (opts.activeStreams >= MAX_CONCURRENT_STREAMS) {
    return { status: 503, headers: { 'Retry-After': '1' } };
  }
  const src = opts.source;
  if (src.state === 'unprobed') {
    // Handler bug: the probe must run before range planning.
    return { status: 500, headers: {} };
  }
  if (src.state === 'missing') {
    return { status: 404, headers: {} };
  }
  if (src.state === 'legacy-too-large') {
    return { status: 413, headers: {} };
  }
  const size = src.plainSize;
  const baseHeaders: Record<string, string> = {
    'Content-Type': contentTypeForFile(opts.fileName),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = parseRangeHeader(opts.rangeHeader, size);
  if (range.type === 'invalid') {
    return {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
    };
  }
  if (range.type === 'full') {
    return {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(size) },
      window: { offset: 0, length: size },
    };
  }
  const length = range.end - range.start + 1;
  return {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': String(length),
    },
    window: { offset: range.start, length },
  };
}
