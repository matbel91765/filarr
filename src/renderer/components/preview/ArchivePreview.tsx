/**
 * ArchivePreview Component
 *
 * In-app browser for ZIP / TAR / TGZ / 7Z / RAR archives (and single-file .gz)
 * that decompresses entirely in RAM — nothing is ever written to disk, matching
 * the E2EE/offline stance. fflate handles zip + gzip; a small built-in reader
 * walks tar headers (fflate has no tar); 7z and rar go through hand-written
 * pure-JS parsers (src/utils/archive), dynamically imported so they stay out of
 * the main bundle — the renderer CSP forbids WASM. The archive is listed as a
 * scrollable tree of entries; clicking a text-like entry decodes it (UTF-8)
 * into a side pane. Entries whose codec is unsupported come back with
 * bytes = null plus a French note and render as dimmed, non-clickable rows.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { createIpcRangeSource } from '../../../services/preview/ipcRangeSource';
import {
  listZipEntries,
  readZipEntryBytes,
  type ZipEntry,
} from '../../../services/preview/zipDirRange';
import type { RangeSource } from '../../../services/preview/rangeSource';
import './MarkdownPreview.css';

export interface ArchivePreviewProps {
  /** Archive data as ArrayBuffer (buffered mode; ignored when `windowed` is set) */
  data?: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension (zip | gz | tar | tgz | 7z | rar) */
  extension?: string;
  /** Additional CSS class */
  className?: string;
  /**
   * Windowed mode (ZIP only): list entries via ranged reads of the central
   * directory instead of downloading + inflating the whole archive. Requires
   * `folderId`; used for large vault ZIPs in local / hybrid (V3) modes.
   */
  windowed?: boolean;
  /** Folder id of the vault file — required in windowed mode. */
  folderId?: string | null;
}

interface ArchiveEntry {
  path: string;
  size: number;
  /** null when the entry could not be decoded (unsupported codec…) — see note. */
  bytes: Uint8Array | null;
  isText: boolean;
  /** French reason why the content is unavailable or suspect (7z/rar only). */
  note?: string;
}

// Extensions we decode inline as UTF-8 text. Everything else lists name + size.
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'json',
  'csv',
  'log',
  'js',
  'ts',
  'css',
  'html',
  'xml',
  'yml',
  'yaml',
]);

const getExt = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
};

// Minimal pure-JS tar reader (POSIX ustar): 512-byte header blocks, file data
// padded to a 512-byte boundary, terminated by two zero blocks. Enough to list
// and read the regular files inside a .tar (fflate has no tar support).
function parseTar(buf: Uint8Array): { path: string; bytes: Uint8Array }[] {
  const out: { path: string; bytes: Uint8Array }[] = [];
  const readStr = (start: number, len: number): string => {
    let end = start;
    while (end < start + len && buf[end] !== 0) end++;
    return new TextDecoder().decode(buf.subarray(start, end));
  };
  let offset = 0;
  while (offset + 512 <= buf.length) {
    // End of archive: a zero-filled block.
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (buf[offset + i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const name = readStr(offset, 100);
    const prefix = readStr(offset + 345, 155); // ustar long-name prefix
    const size = parseInt(readStr(offset + 124, 12).trim(), 8) || 0;
    const typeflag = buf[offset + 156];
    const fullName = prefix ? `${prefix}/${name}` : name;
    offset += 512;

    // typeflag '0' (0x30) or NUL = regular file; '5' = directory (skipped).
    if ((typeflag === 0x30 || typeflag === 0) && size > 0 && fullName) {
      out.push({ path: fullName, bytes: buf.subarray(offset, offset + size) });
    }
    offset += Math.ceil(size / 512) * 512; // advance past the (padded) file data
  }
  return out;
}

// Compact human-readable size (self-contained so this component stays one file).
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 o';
  const k = 1024;
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
};

const styles: Record<string, React.CSSProperties> = {
  layout: { display: 'flex', height: '100%', minHeight: 0 },
  list: {
    flex: '0 0 42%',
    maxWidth: 440,
    minWidth: 220,
    overflow: 'auto',
    padding: '4px 0',
    borderRight: '1px solid var(--color-border, #e5e7eb)',
  },
  rowBase: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
    padding: '6px 12px',
    margin: 0,
    border: 'none',
    borderRadius: 0,
    background: 'transparent',
    font: 'inherit',
    fontSize: 13,
    color: 'var(--color-text-primary, #1f2937)',
  },
  rowPath: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
  },
  rowSize: {
    flexShrink: 0,
    color: 'var(--color-text-tertiary, #9ca3af)',
    fontVariantNumeric: 'tabular-nums',
    fontSize: 12,
  },
  // Inline hint next to the size for entries carrying a French note
  // (unsupported codec, checksum mismatch…). marginLeft: auto keeps it glued
  // to the size column instead of floating mid-row.
  rowNote: {
    marginLeft: 'auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--color-text-tertiary, #9ca3af)',
    fontStyle: 'italic',
    fontSize: 11,
  },
  pane: { flex: 1, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' },
  placeholder: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
    color: 'var(--color-text-tertiary, #9ca3af)',
    fontSize: 13,
  },
  paneHeader: {
    flexShrink: 0,
    padding: '6px 16px',
    borderBottom: '1px solid var(--color-border, #e5e7eb)',
    background: 'var(--color-bg-secondary, #f9fafb)',
    fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    fontSize: 12,
    color: 'var(--color-text-secondary, #6b7280)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};

export const ArchivePreview: React.FC<ArchivePreviewProps> = ({
  data,
  fileName,
  extension,
  className,
  windowed = false,
  folderId,
}) => {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Archive-level French notice (multi-volume rar, etc.) shown in the toolbar.
  const [notice, setNotice] = useState<string | null>(null);
  // Ranged (windowed) ZIP mode: per-entry content is loaded on demand.
  const [rangedText, setRangedText] = useState<{ path: string; text: string } | null>(null);
  const [rangedLoading, setRangedLoading] = useState(false);
  const [rangedError, setRangedError] = useState<string | null>(null);
  const zipEntriesRef = useRef<Map<string, ZipEntry>>(new Map());
  const rangeSourceRef = useRef<RangeSource | null>(null);

  const lowerName = fileName.toLowerCase();
  const archiveExt = (extension || getExt(fileName)).toLowerCase();
  const isTarGz = archiveExt === 'tgz' || lowerName.endsWith('.tar.gz');
  const isTar = archiveExt === 'tar';
  const isGz = !isTarGz && archiveExt === 'gz';
  const is7z = archiveExt === '7z';
  const isRar = archiveExt === 'rar';
  // Ranged listing only works for ZIP (its index sits at EOF); tar/tgz/7z/rar
  // have no random-access index, so they always take the buffered path.
  const useRangedZip =
    windowed && folderId != null && !isTarGz && !isTar && !isGz && !is7z && !isRar;
  const badge = is7z
    ? '7Z'
    : isRar
      ? 'RAR'
      : isTarGz
        ? 'TAR.GZ'
        : isTar
          ? 'TAR'
          : isGz
            ? 'GZ'
            : 'ZIP';

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setEntries(null);
    setSelected(null);
    setNotice(null);
    setRangedText(null);
    setRangedError(null);
    zipEntriesRef.current = new Map();
    rangeSourceRef.current = null;

    (async () => {
      try {
        const sortByPath = (a: ArchiveEntry, b: ArchiveEntry): number =>
          a.path.localeCompare(b.path, undefined, { numeric: true });

        // Windowed ZIP: list entries from the central directory via ranged
        // reads — the archive is never fully downloaded or inflated. Entry
        // content is read lazily on selection (see the ranged-content effect).
        if (useRangedZip && folderId != null) {
          const source = createIpcRangeSource(folderId, fileName);
          rangeSourceRef.current = source;
          const zipEntries = await listZipEntries(source);
          if (cancelled) return;
          const map = new Map<string, ZipEntry>();
          const parsedRanged = zipEntries
            .filter((e) => !e.isDirectory)
            .map((e) => {
              map.set(e.fileName, e);
              return {
                path: e.fileName,
                size: e.uncompressedSize,
                bytes: null,
                isText: TEXT_EXTS.has(getExt(e.fileName)),
              } as ArchiveEntry;
            })
            .sort(sortByPath);
          zipEntriesRef.current = map;
          setEntries(parsedRanged);
          const firstRangedText = parsedRanged.find((e) => e.isText);
          if (parsedRanged.length === 1 && firstRangedText) setSelected(firstRangedText.path);
          return;
        }

        if (!data) {
          throw new Error('Archive indisponible.');
        }

        let parsed: ArchiveEntry[];
        let archiveNotice: string | null = null;

        if (is7z) {
          // Hand-written pure-JS 7z reader (LZMA/LZMA2/Delta/BCJ/Deflate) —
          // dynamically imported so it stays out of the main bundle.
          const { parseSevenZip } = await import('../../../utils/archive/sevenZip');
          if (cancelled) return;
          parsed = parseSevenZip(new Uint8Array(data))
            .map((f) => ({
              path: f.path,
              size: f.size,
              bytes: f.bytes,
              isText: f.bytes !== null && TEXT_EXTS.has(getExt(f.path)),
              note: f.note,
            }))
            .sort(sortByPath);
        } else if (isRar) {
          // Hand-written pure-JS RAR4/RAR5 reader — dynamically imported too.
          const { parseRar } = await import('../../../utils/archive/rar');
          if (cancelled) return;
          const archive = parseRar(new Uint8Array(data));
          archiveNotice = archive.notice ?? null;
          parsed = archive.entries
            .map((f) => ({
              path: f.path,
              size: f.size,
              bytes: f.bytes,
              isText: f.bytes !== null && TEXT_EXTS.has(getExt(f.path)),
              note: f.note,
            }))
            .sort(sortByPath);
        } else {
          const fflate = await import('fflate');
          if (cancelled) return;

          if (isTar || isTarGz) {
            // .tgz/.tar.gz: gunzip to the raw tar first, then walk its headers.
            const raw = new Uint8Array(data);
            const tarBytes = isTarGz ? fflate.gunzipSync(raw) : raw;
            parsed = parseTar(tarBytes)
              .map((f) => ({
                path: f.path,
                size: f.bytes.length,
                bytes: f.bytes,
                isText: TEXT_EXTS.has(getExt(f.path)),
              }))
              .sort(sortByPath);
          } else if (isGz) {
            const out = fflate.gunzipSync(new Uint8Array(data));
            const innerName = fileName.replace(/\.gz$/i, '') || 'fichier';
            parsed = [
              {
                path: innerName,
                size: out.length,
                bytes: out,
                isText: TEXT_EXTS.has(getExt(innerName)),
              },
            ];
          } else {
            const files = fflate.unzipSync(new Uint8Array(data));
            parsed = Object.keys(files)
              .filter((p) => !p.endsWith('/')) // skip directory entries
              .map((p) => ({
                path: p,
                size: files[p].length,
                bytes: files[p],
                isText: TEXT_EXTS.has(getExt(p)),
              }))
              .sort(sortByPath);
          }
        }

        if (cancelled) return;
        setEntries(parsed);
        setNotice(archiveNotice);
        // A single-file .gz: auto-open it if it's text.
        const firstText = parsed.find((e) => e.isText);
        if (parsed.length === 1 && firstText) setSelected(firstText.path);
      } catch (err) {
        if (cancelled) return;
        console.error('[ArchivePreview] Extraction error:', err);
        setError(err instanceof Error ? err.message : "Impossible de lire l'archive");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data, fileName, isGz, isTar, isTarGz, is7z, isRar, useRangedZip, folderId]);

  // Ranged ZIP: load the selected entry's bytes on demand and decode as UTF-8.
  useEffect(() => {
    if (!useRangedZip || !selected) {
      return;
    }
    const entry = zipEntriesRef.current.get(selected);
    const source = rangeSourceRef.current;
    if (!entry || !source || !TEXT_EXTS.has(getExt(selected))) {
      return;
    }
    let cancelled = false;
    setRangedLoading(true);
    setRangedError(null);
    (async () => {
      try {
        const bytes = await readZipEntryBytes(source, entry);
        if (cancelled) return;
        setRangedText({
          path: selected,
          text: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
        });
      } catch (err) {
        if (cancelled) return;
        setRangedError(err instanceof Error ? err.message : "Impossible de lire l'entrée.");
      } finally {
        if (!cancelled) setRangedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useRangedZip, selected, fileName]);

  const totalSize = useMemo(
    () => (entries ? entries.reduce((sum, e) => sum + e.size, 0) : 0),
    [entries]
  );

  const selectedText = useMemo(() => {
    if (!selected || !entries) return null;
    const entry = entries.find((e) => e.path === selected);
    if (!entry || entry.bytes === null) return null;
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(entry.bytes);
    } catch {
      return null;
    }
  }, [selected, entries]);

  const containerClasses = clsx('markdown-preview', className);

  return (
    <div className={containerClasses}>
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">{badge}</span>
          <span
            className="markdown-preview__stats"
            title={notice ? `${fileName} — ${notice}` : fileName}
          >
            {entries
              ? `${entries.length.toLocaleString()} entrée${entries.length > 1 ? 's' : ''} · ${formatBytes(totalSize)}`
              : fileName}
            {notice ? ` · ${notice}` : ''}
          </span>
        </div>
      </div>

      <div className="markdown-preview__container">
        {isLoading ? (
          <div className="file-preview-panel__loading">
            <div className="file-preview-panel__spinner" />
            <span>Lecture de l'archive…</span>
          </div>
        ) : error ? (
          <div className="file-preview-panel__error">
            <span>Impossible de lire cette archive</span>
            <p className="file-preview-panel__error-message">{error}</p>
          </div>
        ) : entries && entries.length === 0 ? (
          <div className="file-preview-panel__error">
            <span>Archive vide</span>
            <p className="file-preview-panel__error-message">
              Aucun fichier trouvé dans cette archive.
            </p>
          </div>
        ) : (
          <div style={styles.layout}>
            <div style={styles.list}>
              {entries?.map((entry, index) => {
                // Key includes the index: a crafted archive can list the same
                // path twice, and the list never reorders once set.
                const rowKey = `${index}-${entry.path}`;
                const isSelected = entry.path === selected;
                const rowStyle: React.CSSProperties = {
                  ...styles.rowBase,
                  cursor: entry.isText ? 'pointer' : 'default',
                  color: entry.isText
                    ? styles.rowBase.color
                    : 'var(--color-text-tertiary, #9ca3af)',
                  background: isSelected ? 'var(--color-primary-50, #eff6ff)' : 'transparent',
                };
                const rowTitle = entry.note ? `${entry.path} — ${entry.note}` : entry.path;
                const content = (
                  <>
                    <span style={styles.rowPath} title={rowTitle}>
                      {entry.path}
                    </span>
                    {entry.note && <span style={styles.rowNote}>{entry.note}</span>}
                    <span style={styles.rowSize}>{formatBytes(entry.size)}</span>
                  </>
                );
                return entry.isText ? (
                  <button
                    key={rowKey}
                    type="button"
                    style={rowStyle}
                    onClick={() => setSelected(entry.path)}
                    title={`${rowTitle} — cliquer pour prévisualiser`}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={rowKey} style={rowStyle} title={rowTitle}>
                    {content}
                  </div>
                );
              })}
            </div>

            <div style={styles.pane}>
              {useRangedZip ? (
                selected && rangedLoading ? (
                  <div style={styles.placeholder}>Lecture de l'entrée…</div>
                ) : selected && rangedError ? (
                  <div style={styles.placeholder}>{rangedError}</div>
                ) : selected && rangedText && rangedText.path === selected ? (
                  <>
                    <div style={styles.paneHeader} title={selected}>
                      {selected}
                    </div>
                    <pre className="markdown-preview__source" style={{ flex: 1 }}>
                      {rangedText.text}
                    </pre>
                  </>
                ) : (
                  <div style={styles.placeholder}>
                    Sélectionnez un fichier texte dans la liste pour afficher son contenu.
                  </div>
                )
              ) : selected && selectedText !== null ? (
                <>
                  <div style={styles.paneHeader} title={selected}>
                    {selected}
                  </div>
                  <pre className="markdown-preview__source" style={{ flex: 1 }}>
                    {selectedText}
                  </pre>
                </>
              ) : (
                <div style={styles.placeholder}>
                  Sélectionnez un fichier texte dans la liste pour afficher son contenu.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArchivePreview;
