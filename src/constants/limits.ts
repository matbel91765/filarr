/**
 * File and storage limits constants
 */

// File size limits — per-file ceiling for a single upload.
// Raised 5 GiB → 5 TiB now that the direct-to-R2 data plane (presigned
// multipart parts PUT straight to R2, bounded-parallel, dynamic part sizing)
// removes the Worker request-body ceiling. 5 TiB is R2's own multipart hard
// cap (mirrored server-side by DIRECT_TOTAL_MAX_BYTES) — kept as the sane
// absolute guard rather than an unbounded value.
export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024 * 1024; // 5 TiB (R2 multipart hard cap)
export const MAX_FILES_BATCH = 25; // Maximum files to upload at once
export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB chunks (matches Worker multipart sweet spot)

// V3 streaming import (local mode only). Files above this threshold whose OS
// path is resolvable are encrypted chunk-by-chunk in the main process — the
// content never enters renderer memory. Below it, the proven buffer path stays.
export const LOCAL_STREAM_THRESHOLD = 64 * 1024 * 1024; // 64 MiB

// Non-local modes (cloud/hybrid/BYOS) still buffer the whole file in renderer
// memory — cap them until their pipelines learn to stream too.
export const NON_LOCAL_MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MiB

// In-memory preview ceiling for whole-buffer previews (images, text, docx…).
// Types that support windowed range previews (PDF, video, audio, and ZIP via
// ranged central-directory listing) bypass this cap entirely — see
// FilePreviewPanel. It stays because a raster image / text buffer must be
// decoded whole, and the buffer path holds the bytes twice (state + Blob).
export const MAX_PREVIEW_FILE_SIZE = 1024 * 1024 * 1024; // 1 GiB

// Plafond d'OUVERTURE DANS UN EDITEUR.
//
// L'apercu avait sa garde (MAX_PREVIEW_FILE_SIZE) ; l'editeur n'en avait
// AUCUNE, alors qu'il est plus couteux : il garde tout le clair dans l'etat
// React, le rend dans un noeud editable, et l'editeur de documents en fait en
// plus un arbre ProseMirror. Un `.log` de 800 Mo ouvert « pour voir » gelait
// donc le rendu sans qu'aucun message ne l'annonce.
//
// 50 Mio est deliberement BAS : au-dela, aucun editeur de ce produit ne rend
// une experience utilisable, et l'apercu (qui sait fenetrer) ou l'application
// systeme sont de meilleures reponses. Un greffon qui sait faire mieux le
// declare lui-meme via EditorContribution.maxBytes.
export const MAX_EDITOR_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB

// Whole-buffer archive formats without a random-access index (7z / rar / tar /
// tgz / gz, and ZIP when no ranged reader is available) are parsed entirely in
// RAM, so their content must first come back through the buffered read path
// (readEncryptedFileForCopy -> decryptFileAuto). That path is HARD-capped in
// the main process at V3_PREVIEW_MAX_BYTES (1 GiB): past it it throws instead
// of returning bytes. So the buffered-archive gate is pinned AT that ceiling —
// raising it higher would only swap a clean "download" card for a decrypt
// error. The real large-archive win is windowed listing, which applies to ZIP
// only (its index sits at EOF, reachable by ranged reads): a ZIP above this cap
// in local/hybrid mode lists its central directory WITHOUT any full download,
// so it has no size limit. tar/tgz/gz/7z/rar have no random-access index and
// therefore stay bounded by this buffered ceiling.
export const MAX_ARCHIVE_PREVIEW_SIZE = MAX_PREVIEW_FILE_SIZE; // 1 GiB (main-process buffered-decrypt ceiling)

// File extension validation. Filarr is end-to-end encrypted: the server
// only ever sees opaque ciphertext, so blocking extensions on the client
// is purely cosmetic — a determined user can always rename. We allow
// everything and surface a warning at the UI level for executables (see
// EXECUTABLE_EXTENSIONS below) so users know we cannot scan the content.
export const ALLOWED_EXTENSIONS = ['*']; // '*' means all extensions allowed

// Extensions that get a "we can't scan encrypted files" warning in the UI.
// They are NOT blocked — the warning is informational, matching the
// behaviour of other E2EE storage providers (Proton Drive, Tresorit, Sync.com).
export const EXECUTABLE_EXTENSIONS = [
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.vbs',
  '.ps1',
  '.sh',
  '.app',
  '.deb',
  '.rpm',
  '.dmg',
  '.pkg',
  '.jar',
];

// Formats that are already heavily compressed — skip zstd to save CPU
// and avoid the (very small) ratio loss from re-compressing entropy-dense
// bytes. Detection is by extension here; the encryption layer also checks
// magic bytes as a second line of defence (see hybridCrypto.ts).
export const PRECOMPRESSED_EXTENSIONS = [
  // Images
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
  '.avif',
  // Video
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.avi',
  '.m4v',
  '.flv',
  // Audio
  '.mp3',
  '.aac',
  '.ogg',
  '.opus',
  '.flac',
  '.m4a',
  // Archives
  '.zip',
  '.7z',
  '.rar',
  '.gz',
  '.bz2',
  '.xz',
  '.zst',
  '.lz4',
  '.tar.gz',
  '.tgz',
  // Documents that are internally compressed
  '.docx',
  '.xlsx',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.epub',
  '.pages',
  '.numbers',
  '.keynote',
  // PDF (typically deflate-compressed streams already)
  '.pdf',
];

// Progress thresholds
export const SHOW_PROGRESS_THRESHOLD = 10 * 1024 * 1024; // Show progress for files > 10MB

// Error messages (user-facing — French)
export const FILE_ERRORS = {
  TOO_LARGE: 'Fichier trop volumineux (max 5 To)',
  TOO_MANY_FILES: `Impossible d'uploader plus de ${MAX_FILES_BATCH} fichiers à la fois`,
  INVALID_FILE: 'Fichier invalide',
} as const;

// Helper functions
export const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export const getFileExtension = (filename: string): string => {
  const parts = filename.split('.');
  return parts.length > 1 ? '.' + parts[parts.length - 1].toLowerCase() : '';
};

export const isExtensionExecutable = (filename: string): boolean => {
  const extension = getFileExtension(filename);
  return EXECUTABLE_EXTENSIONS.includes(extension);
};

export const isExtensionPrecompressed = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  return PRECOMPRESSED_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

// Kept for backward compat with any existing callers that imported the
// blocklist version. Always returns true now — actual file-type policy
// lives in EXECUTABLE_EXTENSIONS (warning only, never a hard block).
export const isExtensionAllowed = (_filename: string): boolean => true;
