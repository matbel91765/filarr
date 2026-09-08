/**
 * tarStream.ts — minimal streaming POSIX-ustar writer + index walker
 * (pure Node, no Electron/DOM). Foundation of the `.filarr` FOLDER
 * protected container: the folder tree is packed into a tar stream that is
 * fed chunk-by-chunk into the V3 encryption core (flat memory — the whole
 * tar NEVER exists in RAM or on disk in plaintext).
 *
 * Deliberately independent from the renderer's ArchivePreview parseTar
 * (different tsconfig universe); both implement the same ustar subset:
 *   - 512-byte header blocks: name@0(100), mode@100(8), uid@108(8),
 *     gid@116(8), size@124(12, octal), mtime@136(12, octal), chksum@148(8),
 *     typeflag@156 ('0' file / '5' dir), magic@257 "ustar\0" + version "00",
 *     prefix@345(155)
 *   - file data padded to 512, archive terminated by two zero blocks
 *   - UTF-8 names, ustar name(<=100)/prefix(<=155) byte-length split
 * No PAX/GNU extensions: paths that cannot split are refused up front with a
 * French error naming the offending path. Symlinks/junctions are NEVER
 * followed (lstat-only walk — symlink-loop-proof), only counted.
 */

import { createHash } from 'node:crypto';
import type { Hash } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';
import * as path from 'node:path';

export const TAR_BLOCK_SIZE = 512;

const NAME_MAX = 100;
const PREFIX_MAX = 155;
const MAX_TAR_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB — mirrors V3 MAX_FILE_SIZE
const MAX_TAR_ENTRIES = 50000;
const FILE_READ_SLICE = 4 * 1024 * 1024; // 4 MiB per fs read while streaming

export const ERR_TAR_TOO_LARGE = 'Dossier trop volumineux (max 5 Go)';
export const ERR_TAR_TOO_MANY_ENTRIES = "Trop d'éléments dans le dossier (max 50 000)";
export const ERR_TAR_PATH_TOO_LONG_PREFIX = 'Chemin trop long dans le dossier : ';
export const ERR_TAR_UNREADABLE_PREFIX = 'Élément illisible dans le dossier : ';
export const ERR_TAR_FOLDER_CHANGED = 'Le dossier a été modifié pendant la protection — réessayez';
export const ERR_TAR_CORRUPT = 'Archive interne corrompue — ouverture impossible';
const ERR_TAR_SEQUENCE = 'Lecture de blocs tar non séquentielle (erreur interne)';
const ERR_TAR_DIGEST_EARLY = 'Empreinte tar demandée avant la fin de la production (erreur interne)';

export interface TarScanEntry {
  /** Path relative to the scanned root, '/'-separated (tar convention). */
  relPath: string;
  /** Plaintext byte size (0 for directories). */
  size: number;
  /** Modification time, whole seconds since epoch (>= 0). */
  mtime: number;
  isDir: boolean;
}

export interface TarScanResult {
  /** Depth-first, name-sorted entries (directories before their children). */
  entries: TarScanEntry[];
  /** Exact byte size of the tar stream the producer will emit. */
  tarSize: number;
  /** Number of regular files (directories excluded). */
  fileCount: number;
  /** Symlinks/junctions/special files skipped (never followed). */
  skippedSymlinks: number;
}

export interface TarChunkProducer {
  /**
   * Returns exactly `plainLen` tar bytes for chunk `index` — the contract of
   * streamCrypto's encryptStreamToFileV3 readChunk. Chunks MUST be requested
   * sequentially from 0. Throws ERR_TAR_FOLDER_CHANGED when a file's size on
   * disk no longer matches the scan.
   */
  readChunk(index: number, plainLen: number): Promise<Buffer>;
  /** SHA-256 (hex) of ALL produced tar bytes — only after the last chunk. */
  sha256Hex(): string;
  /** Exact total tar byte size (same formula as scanFolderForTar). */
  readonly tarSize: number;
}

export interface TarIndexEntry {
  /** '/'-separated path (no trailing slash, even for directories). */
  path: string;
  /** File data byte size (0 for directories). */
  size: number;
  /** Byte offset of the file DATA inside the tar stream. */
  offset: number;
  isDir: boolean;
}

// ---------------------------------------------------------------------------
// ustar name/prefix split
// ---------------------------------------------------------------------------

/**
 * Splits a relative path into the ustar name(<=100)/prefix(<=155) byte
 * fields (UTF-8 byte lengths; split only at '/' which never occurs inside a
 * multi-byte UTF-8 sequence). Directories get a trailing '/' appended to the
 * name field, counted against the 100-byte limit. Returns null when no valid
 * split exists (caller refuses the folder with a French error).
 */
function splitUstarPath(relPath: string, isDir: boolean): { nameBytes: Buffer; prefixBytes: Buffer } | null {
  const dirSuffix = isDir ? 1 : 0;
  const bytes = Buffer.from(relPath, 'utf8');
  if (bytes.length === 0) {
    return null;
  }
  const withDirSlash = (b: Buffer): Buffer => (isDir ? Buffer.concat([b, Buffer.from('/', 'ascii')]) : b);
  if (bytes.length + dirSuffix <= NAME_MAX) {
    return { nameBytes: withDirSlash(bytes), prefixBytes: Buffer.alloc(0) };
  }
  // Find the highest '/' usable as split point: prefix = bytes[0..i)
  // (<= 155, non-empty), name = bytes[i+1..) + optional '/' (<= 100,
  // non-empty). Scanning downward, the first '/' found yields the shortest
  // possible name — if even that exceeds 100 bytes, no split exists.
  for (let i = Math.min(PREFIX_MAX, bytes.length - 2); i >= 1; i--) {
    if (bytes[i] !== 0x2f) {
      continue;
    }
    const nameLen = bytes.length - i - 1 + dirSuffix;
    if (nameLen > NAME_MAX) {
      return null;
    }
    return { nameBytes: withDirSlash(bytes.subarray(i + 1)), prefixBytes: bytes.subarray(0, i) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Folder scan
// ---------------------------------------------------------------------------

/** 512 header + data padded to 512 (dirs: header only). */
function tarBytesForEntry(entry: Pick<TarScanEntry, 'size' | 'isDir'>): number {
  return entry.isDir ? TAR_BLOCK_SIZE : TAR_BLOCK_SIZE + Math.ceil(entry.size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
}

/**
 * Recursive lstat-only walk of `rootPath`. Regular files and directories are
 * collected (empty directories preserved); symlinks/junctions and special
 * files (sockets, FIFOs…) are skipped and counted, NEVER followed. Refuses —
 * with French errors — paths that cannot split into ustar name/prefix, more
 * than 50 000 entries, and a tar stream over 5 GiB. Deterministic order
 * (name-sorted, directories before their children).
 */
export async function scanFolderForTar(rootPath: string): Promise<TarScanResult> {
  const entries: TarScanEntry[] = [];
  let tarSize = 2 * TAR_BLOCK_SIZE; // two trailing zero blocks
  let fileCount = 0;
  let skippedSymlinks = 0;

  const walk = async (dirAbs: string, relBase: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(dirAbs);
    } catch {
      throw new Error(ERR_TAR_UNREADABLE_PREFIX + (relBase || path.basename(rootPath)));
    }
    names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      const abs = path.join(dirAbs, name);
      const rel = relBase ? `${relBase}/${name}` : name;
      let st;
      try {
        st = await lstat(abs);
      } catch {
        throw new Error(ERR_TAR_UNREADABLE_PREFIX + rel);
      }
      if (st.isSymbolicLink()) {
        skippedSymlinks++;
        continue;
      }
      const isDir = st.isDirectory();
      if (!isDir && !st.isFile()) {
        // Sockets, FIFOs, devices — cannot be represented faithfully.
        skippedSymlinks++;
        continue;
      }
      if (!splitUstarPath(rel, isDir)) {
        throw new Error(ERR_TAR_PATH_TOO_LONG_PREFIX + rel);
      }
      const entry: TarScanEntry = {
        relPath: rel,
        size: isDir ? 0 : st.size,
        mtime: Math.max(0, Math.floor(st.mtimeMs / 1000)),
        isDir,
      };
      entries.push(entry);
      tarSize += tarBytesForEntry(entry);
      if (!isDir) {
        fileCount++;
      }
      if (entries.length > MAX_TAR_ENTRIES) {
        throw new Error(ERR_TAR_TOO_MANY_ENTRIES);
      }
      if (tarSize > MAX_TAR_SIZE) {
        throw new Error(ERR_TAR_TOO_LARGE);
      }
      if (isDir) {
        await walk(abs, rel);
      }
    }
  };

  await walk(rootPath, '');
  return { entries, tarSize, fileCount, skippedSymlinks };
}

// ---------------------------------------------------------------------------
// ustar header
// ---------------------------------------------------------------------------

/** Octal ASCII field: (len-1) digits zero-padded + NUL terminator. */
function writeOctal(header: Buffer, offset: number, fieldLen: number, value: number): void {
  const digits = Math.max(0, Math.floor(value)).toString(8);
  if (digits.length > fieldLen - 1) {
    throw new Error(ERR_TAR_TOO_LARGE);
  }
  header.write(digits.padStart(fieldLen - 1, '0'), offset, 'ascii');
  header[offset + fieldLen - 1] = 0;
}

function buildTarHeader(entry: TarScanEntry): Buffer {
  const split = splitUstarPath(entry.relPath, entry.isDir);
  if (!split) {
    throw new Error(ERR_TAR_PATH_TOO_LONG_PREFIX + entry.relPath);
  }
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  split.nameBytes.copy(header, 0);
  writeOctal(header, 100, 8, entry.isDir ? 0o755 : 0o644); // mode
  writeOctal(header, 108, 8, 0); // uid
  writeOctal(header, 116, 8, 0); // gid
  writeOctal(header, 124, 12, entry.isDir ? 0 : entry.size);
  writeOctal(header, 136, 12, entry.mtime);
  header.fill(0x20, 148, 156); // chksum: spaces while summing
  header[156] = entry.isDir ? 0x35 : 0x30; // typeflag '5' / '0'
  Buffer.from('ustar\0', 'ascii').copy(header, 257);
  header.write('00', 263, 'ascii'); // ustar version
  split.prefixBytes.copy(header, 345);
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    sum += header[i];
  }
  header.write(sum.toString(8).padStart(6, '0'), 148, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

// ---------------------------------------------------------------------------
// Streaming producer (writer)
// ---------------------------------------------------------------------------

/**
 * Builds the tar stream for `entries` (from scanFolderForTar) on demand, in
 * chunks matching encryptStreamToFileV3's readChunk contract. Flat memory:
 * one <= 4 MiB read buffer + the assembled chunk. A running SHA-256 of every
 * produced byte is exposed for the verify-before-delete step. If any file's
 * size at read time differs from the scan, ERR_TAR_FOLDER_CHANGED is thrown
 * and encryption aborts (staging cleanup is the encrypt caller's contract).
 */
export function createTarChunkProducer(rootPath: string, entries: readonly TarScanEntry[]): TarChunkProducer {
  const tarSize = entries.reduce((acc, e) => acc + tarBytesForEntry(e), 2 * TAR_BLOCK_SIZE);
  const hash: Hash = createHash('sha256');
  let digestHex: string | null = null;
  let producedBytes = 0;
  let nextIndex = 0;
  let leftover: Buffer | null = null;

  // Parts generator: headers, file data slices (reused buffer — consumer
  // copies before pulling the next part), padding, final zero blocks.
  async function* tarParts(): AsyncGenerator<Buffer> {
    const readBuf = Buffer.allocUnsafe(FILE_READ_SLICE);
    for (const entry of entries) {
      yield buildTarHeader(entry);
      if (entry.isDir) {
        continue;
      }
      const abs = path.join(rootPath, ...entry.relPath.split('/'));
      const handle = await open(abs, 'r').catch(() => {
        throw new Error(ERR_TAR_FOLDER_CHANGED);
      });
      try {
        const st = await handle.stat();
        if (st.size !== entry.size) {
          throw new Error(ERR_TAR_FOLDER_CHANGED);
        }
        let position = 0;
        while (position < entry.size) {
          const want = Math.min(FILE_READ_SLICE, entry.size - position);
          let got = 0;
          while (got < want) {
            const { bytesRead } = await handle.read(readBuf, got, want - got, position + got);
            if (bytesRead <= 0) {
              throw new Error(ERR_TAR_FOLDER_CHANGED);
            }
            got += bytesRead;
          }
          position += want;
          yield readBuf.subarray(0, want);
        }
      } finally {
        await handle.close().catch(() => undefined);
      }
      const padding = Math.ceil(entry.size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE - entry.size;
      if (padding > 0) {
        yield Buffer.alloc(padding);
      }
    }
    yield Buffer.alloc(2 * TAR_BLOCK_SIZE);
  }

  const generator = tarParts();

  return {
    tarSize,
    readChunk: async (index: number, plainLen: number): Promise<Buffer> => {
      if (index !== nextIndex) {
        throw new Error(ERR_TAR_SEQUENCE);
      }
      nextIndex++;
      const out = Buffer.allocUnsafe(plainLen);
      let filled = 0;
      while (filled < plainLen) {
        if (!leftover || leftover.length === 0) {
          const { value, done } = await generator.next();
          if (done || !value) {
            // Producer exhausted before tarSize bytes: a file shrank between
            // scan and read in a way the per-file checks did not catch.
            throw new Error(ERR_TAR_FOLDER_CHANGED);
          }
          leftover = value;
        }
        const take = Math.min(leftover.length, plainLen - filled);
        // Copy BEFORE pulling the next part: leftover may view a reused buffer.
        leftover.copy(out, filled, 0, take);
        filled += take;
        leftover = take < leftover.length ? leftover.subarray(take) : null;
      }
      hash.update(out);
      producedBytes += plainLen;
      return out;
    },
    sha256Hex: (): string => {
      if (digestHex === null) {
        if (producedBytes !== tarSize) {
          throw new Error(ERR_TAR_DIGEST_EARLY);
        }
        digestHex = hash.digest('hex');
      }
      return digestHex;
    },
  };
}

// ---------------------------------------------------------------------------
// Index walker (reader)
// ---------------------------------------------------------------------------

function isZeroBlock(block: Buffer): boolean {
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    if (block[i] !== 0) {
      return false;
    }
  }
  return true;
}

/** NUL-terminated UTF-8 string field. */
function readTarString(block: Buffer, offset: number, length: number): string {
  let end = offset;
  const max = offset + length;
  while (end < max && block[end] !== 0) {
    end++;
  }
  return block.toString('utf8', offset, end);
}

/**
 * Walks tar HEADERS only via the provided `read` callback (e.g. an
 * authenticated V3FileReader window) and returns the entry index — file data
 * is never materialized. Directories lose their trailing slash. Unknown
 * typeflags are skipped but their data is advanced over. Malformed headers
 * throw ERR_TAR_CORRUPT (inside an authenticated payload this means a writer
 * bug or post-write corruption).
 */
export async function walkTarIndex(
  read: (offset: number, length: number) => Promise<Buffer>,
  totalSize: number
): Promise<TarIndexEntry[]> {
  const out: TarIndexEntry[] = [];
  let offset = 0;
  while (offset + TAR_BLOCK_SIZE <= totalSize) {
    const block = await read(offset, TAR_BLOCK_SIZE);
    if (block.length !== TAR_BLOCK_SIZE) {
      throw new Error(ERR_TAR_CORRUPT);
    }
    if (isZeroBlock(block)) {
      break;
    }
    const name = readTarString(block, 0, NAME_MAX);
    const prefix = readTarString(block, 345, PREFIX_MAX);
    const sizeText = readTarString(block, 124, 12).trim();
    const size = sizeText.length > 0 ? parseInt(sizeText, 8) : 0;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(ERR_TAR_CORRUPT);
    }
    const typeflag = block[156];
    let fullName = prefix ? `${prefix}/${name}` : name;
    offset += TAR_BLOCK_SIZE;
    const dataStart = offset;
    offset += Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    if (offset > totalSize || fullName.length === 0) {
      throw new Error(ERR_TAR_CORRUPT);
    }
    const isDir = typeflag === 0x35 || fullName.endsWith('/');
    if (isDir && fullName.endsWith('/')) {
      fullName = fullName.slice(0, -1);
    }
    // typeflag NUL or '0' = regular file, '5' = directory; skip the rest.
    if (typeflag === 0 || typeflag === 0x30 || typeflag === 0x35) {
      out.push({ path: fullName, size: isDir ? 0 : size, offset: dataStart, isDir });
    }
  }
  return out;
}
