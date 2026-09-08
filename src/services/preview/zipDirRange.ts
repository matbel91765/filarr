/**
 * zipDirRange.ts — list a ZIP archive's entries WITHOUT downloading the whole
 * file, using a {@link RangeSource} for random access.
 *
 * A ZIP's index (the "central directory") lives at the END of the file, pointed
 * to by the End-Of-Central-Directory (EOCD) record. So listing entries only needs
 * a small tail read: find the EOCD (and, for large archives, the Zip64 EOCD via
 * its locator), then read just the central-directory bytes and walk them. Reading
 * one chosen entry then only fetches that entry's local header + data range.
 *
 * Pure transport/parse logic: the parsing functions operate on `Uint8Array`s and
 * are unit-testable with an in-memory {@link RangeSource}. Only {@link readZipEntryBytes}
 * touches `fflate` (dynamically imported, matching ArchivePreview) to inflate
 * DEFLATE entries — the raw ranged read {@link readZipEntryCompressed} needs nothing.
 */

import type { RangeSource } from './rangeSource';

// Little-endian signatures.
const EOCD_SIG = 0x06054b50; // "PK\x05\x06" — End Of Central Directory
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50; // "PK\x06\x07"
const ZIP64_EOCD_RECORD_SIG = 0x06064b50; // "PK\x06\x06"
const CENTRAL_HEADER_SIG = 0x02014b50; // "PK\x01\x02" — central directory file header
const LOCAL_HEADER_SIG = 0x04034b50; // "PK\x03\x04" — local file header

const EOCD_MIN_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_FIXED_SIZE = 56;
const CENTRAL_HEADER_FIXED_SIZE = 46;
const LOCAL_HEADER_FIXED_SIZE = 30;

// The ZIP comment can be up to 65535 bytes, so the EOCD can sit that far from EOF.
const MAX_TAIL_SCAN = EOCD_MIN_SIZE + ZIP64_LOCATOR_SIZE + 0xffff;

// Sentinels that mean "the real value is in a Zip64 record/extra field".
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

export interface ZipEntry {
  /** Entry path as stored in the archive (forward slashes; directories end with "/"). */
  fileName: string;
  /** ZIP compression method: 0 = stored, 8 = DEFLATE (others are unsupported for inflate). */
  compressionMethod: number;
  /** Size of the stored/compressed data, in bytes. */
  compressedSize: number;
  /** Size after decompression, in bytes. */
  uncompressedSize: number;
  crc32: number;
  /** Absolute offset of this entry's local file header within the archive. */
  localHeaderOffset: number;
  /** True for directory entries (path ends with "/"). */
  isDirectory: boolean;
}

class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(dv: DataView, offset: number): number {
  return dv.getUint16(offset, true);
}

function u32(dv: DataView, offset: number): number {
  return dv.getUint32(offset, true);
}

function u64(dv: DataView, offset: number): number {
  const big = dv.getBigUint64(offset, true);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipFormatError('Archive ZIP trop volumineuse pour être indexée (dépasse 8 Po).');
  }
  return Number(big);
}

/**
 * Scans a buffer that ENDS at the archive's EOF for the EOCD record. Returns its
 * offset within `tail`, or `null` if not found. Disambiguates a signature that
 * happens to appear inside the comment by requiring the record + its declared
 * comment length to reach exactly the end of the buffer.
 */
function findEocd(tail: Uint8Array): number | null {
  const dv = view(tail);
  for (let pos = tail.length - EOCD_MIN_SIZE; pos >= 0; pos--) {
    if (dv.getUint32(pos, true) !== EOCD_SIG) {
      continue;
    }
    const commentLen = u16(dv, pos + 20);
    if (pos + EOCD_MIN_SIZE + commentLen === tail.length) {
      return pos;
    }
  }
  return null;
}

interface CentralDirLocation {
  offset: number;
  size: number;
  entryCount: number;
}

/**
 * Resolves where the central directory lives and how many entries it holds,
 * transparently following the Zip64 locator + Zip64 EOCD record when the classic
 * EOCD carries sentinel values. Needs `source` for the (rare) case where the
 * Zip64 EOCD record sits outside the tail already read.
 */
async function locateCentralDirectory(
  source: RangeSource,
  tail: Uint8Array,
  tailStart: number,
  eocdPos: number
): Promise<CentralDirLocation> {
  const dv = view(tail);
  let entryCount = u16(dv, eocdPos + 10);
  let size = u32(dv, eocdPos + 12);
  let offset = u32(dv, eocdPos + 16);

  const needsZip64 = entryCount === U16_MAX || size === U32_MAX || offset === U32_MAX;
  if (!needsZip64) {
    return { offset, size, entryCount };
  }

  // The Zip64 EOCD locator sits immediately before the classic EOCD.
  const locatorPos = eocdPos - ZIP64_LOCATOR_SIZE;
  if (locatorPos < 0 || dv.getUint32(locatorPos, true) !== ZIP64_EOCD_LOCATOR_SIG) {
    throw new ZipFormatError('Localisateur Zip64 introuvable dans cette archive.');
  }
  const zip64RecordOffset = u64(dv, locatorPos + 8);

  // Read the Zip64 EOCD record — reuse the tail if it already covers it.
  let record: Uint8Array;
  let recordBase: number;
  if (zip64RecordOffset >= tailStart) {
    record = tail;
    recordBase = zip64RecordOffset - tailStart;
  } else {
    record = await source.readRange(zip64RecordOffset, zip64RecordOffset + ZIP64_EOCD_FIXED_SIZE);
    recordBase = 0;
  }
  const rdv = view(record);
  if (
    recordBase + ZIP64_EOCD_FIXED_SIZE > record.length ||
    rdv.getUint32(recordBase, true) !== ZIP64_EOCD_RECORD_SIG
  ) {
    throw new ZipFormatError('Enregistrement Zip64 (EOCD) invalide.');
  }
  entryCount = u64(rdv, recordBase + 32);
  size = u64(rdv, recordBase + 40);
  offset = u64(rdv, recordBase + 48);
  return { offset, size, entryCount };
}

/**
 * Applies a central-directory entry's Zip64 extended-information extra field,
 * overriding whichever base values were the 0xFFFFFFFF/0xFFFF sentinel. The
 * 8-byte values appear in a fixed order, and only for the sentinel fields.
 */
function applyZip64Extra(
  extra: Uint8Array,
  base: {
    uncompressedSize: number;
    compressedSize: number;
    localHeaderOffset: number;
    diskStart: number;
  }
): { uncompressedSize: number; compressedSize: number; localHeaderOffset: number } {
  let { uncompressedSize, compressedSize, localHeaderOffset } = base;
  const dv = view(extra);
  let p = 0;
  while (p + 4 <= extra.length) {
    const headerId = u16(dv, p);
    const dataSize = u16(dv, p + 2);
    const dataStart = p + 4;
    if (headerId === 0x0001) {
      let q = dataStart;
      const end = Math.min(dataStart + dataSize, extra.length);
      if (uncompressedSize === U32_MAX && q + 8 <= end) {
        uncompressedSize = u64(dv, q);
        q += 8;
      }
      if (compressedSize === U32_MAX && q + 8 <= end) {
        compressedSize = u64(dv, q);
        q += 8;
      }
      if (localHeaderOffset === U32_MAX && q + 8 <= end) {
        localHeaderOffset = u64(dv, q);
        q += 8;
      }
      break;
    }
    p = dataStart + dataSize;
  }
  return { uncompressedSize, compressedSize, localHeaderOffset };
}

/**
 * Walks the raw central-directory bytes and returns the entries. Stops at
 * `entryCount` entries (when known) or when the bytes/signature run out.
 */
export function parseCentralDirectory(cd: Uint8Array, entryCount: number): ZipEntry[] {
  const dv = view(cd);
  const entries: ZipEntry[] = [];
  const limit = entryCount >= 0 ? entryCount : Number.MAX_SAFE_INTEGER;
  let off = 0;
  while (off + CENTRAL_HEADER_FIXED_SIZE <= cd.length && entries.length < limit) {
    if (u32(dv, off) !== CENTRAL_HEADER_SIG) {
      break;
    }
    const flags = u16(dv, off + 8);
    const method = u16(dv, off + 10);
    const crc = u32(dv, off + 16);
    const baseCompressed = u32(dv, off + 20);
    const baseUncompressed = u32(dv, off + 24);
    const fnLen = u16(dv, off + 28);
    const extraLen = u16(dv, off + 30);
    const commentLen = u16(dv, off + 32);
    const baseDiskStart = u16(dv, off + 34);
    const baseLocalOffset = u32(dv, off + 42);

    const nameStart = off + CENTRAL_HEADER_FIXED_SIZE;
    const extraStart = nameStart + fnLen;
    const commentStart = extraStart + extraLen;
    const next = commentStart + commentLen;
    if (next > cd.length) {
      break; // truncated central directory
    }

    const nameBytes = cd.subarray(nameStart, extraStart);
    const extraBytes = cd.subarray(extraStart, commentStart);
    const utf8 = (flags & 0x0800) !== 0;
    const fileName = decodeName(nameBytes, utf8);

    const resolved = applyZip64Extra(extraBytes, {
      uncompressedSize: baseUncompressed,
      compressedSize: baseCompressed,
      localHeaderOffset: baseLocalOffset,
      diskStart: baseDiskStart,
    });

    entries.push({
      fileName,
      compressionMethod: method,
      compressedSize: resolved.compressedSize,
      uncompressedSize: resolved.uncompressedSize,
      crc32: crc >>> 0,
      localHeaderOffset: resolved.localHeaderOffset,
      isDirectory: fileName.endsWith('/'),
    });
    off = next;
  }
  return entries;
}

function decodeName(bytes: Uint8Array, _utf8: boolean): string {
  // Modern archives set the UTF-8 flag; legacy ones use CP437 but are rare.
  // Non-fatal UTF-8 decoding degrades gracefully for either.
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Lists a ZIP archive's entries using only ranged reads: a tail read to find the
 * EOCD (+ Zip64 records when present), then a read of just the central directory.
 * The whole archive is never downloaded.
 */
export async function listZipEntries(source: RangeSource): Promise<ZipEntry[]> {
  const total = await source.getSize();
  if (total < EOCD_MIN_SIZE) {
    throw new ZipFormatError('Fichier trop court pour être une archive ZIP valide.');
  }
  const tailLen = Math.min(total, MAX_TAIL_SCAN);
  const tailStart = total - tailLen;
  const tail = await source.readRange(tailStart, total);

  const eocdPos = findEocd(tail);
  if (eocdPos === null) {
    throw new ZipFormatError(
      'Fin de répertoire central (EOCD) introuvable — archive ZIP invalide ou corrompue.'
    );
  }

  const loc = await locateCentralDirectory(source, tail, tailStart, eocdPos);
  if (loc.size === 0 || loc.entryCount === 0) {
    return [];
  }

  // Reuse the tail if it already spans the central directory, else read it.
  let cd: Uint8Array;
  if (loc.offset >= tailStart) {
    cd = tail.subarray(loc.offset - tailStart, loc.offset - tailStart + loc.size);
  } else {
    cd = await source.readRange(loc.offset, loc.offset + loc.size);
  }
  return parseCentralDirectory(cd, loc.entryCount);
}

/**
 * Reads an entry's raw stored/compressed bytes via a single ranged read of its
 * local header + data. No decompression — for a stored (method 0) entry these
 * bytes ARE the content; for DEFLATE use {@link readZipEntryBytes}.
 */
export async function readZipEntryCompressed(
  source: RangeSource,
  entry: ZipEntry
): Promise<Uint8Array> {
  const header = await source.readRange(
    entry.localHeaderOffset,
    entry.localHeaderOffset + LOCAL_HEADER_FIXED_SIZE
  );
  if (header.length < LOCAL_HEADER_FIXED_SIZE) {
    throw new ZipFormatError(`En-tête local tronqué pour « ${entry.fileName} ».`);
  }
  const dv = view(header);
  if (u32(dv, 0) !== LOCAL_HEADER_SIG) {
    throw new ZipFormatError(`En-tête local invalide pour « ${entry.fileName} ».`);
  }
  // Local header fn/extra lengths can differ from the central directory's.
  const localFnLen = u16(dv, 26);
  const localExtraLen = u16(dv, 28);
  const dataStart = entry.localHeaderOffset + LOCAL_HEADER_FIXED_SIZE + localFnLen + localExtraLen;
  return source.readRange(dataStart, dataStart + entry.compressedSize);
}

/**
 * Reads and decompresses a single entry to its plaintext bytes. Stored entries
 * are returned as-is; DEFLATE entries are inflated with `fflate` (dynamically
 * imported, keeping it out of the main bundle like ArchivePreview does).
 */
export async function readZipEntryBytes(source: RangeSource, entry: ZipEntry): Promise<Uint8Array> {
  const raw = await readZipEntryCompressed(source, entry);
  if (entry.compressionMethod === 0) {
    return raw;
  }
  if (entry.compressionMethod === 8) {
    const fflate = await import('fflate');
    return fflate.inflateSync(raw);
  }
  throw new ZipFormatError(
    `Méthode de compression non prise en charge (${entry.compressionMethod}) pour « ${entry.fileName} ».`
  );
}
