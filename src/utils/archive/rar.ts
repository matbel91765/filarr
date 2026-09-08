/**
 * Pure-JS RAR archive parser (RAR4 + RAR5): listing + stored-entry extraction.
 *
 * The renderer CSP blocks all WebAssembly, so this parser is hand-written
 * JavaScript with zero dependencies. Compressed RAR5 entries are delegated to
 * unpackRar5 (./rarUnpack); if decompression is unavailable or fails, the
 * entry stays listed with bytes = null and a French note.
 *
 * Node-compatible pure functions: no DOM, no React, no workers.
 */

import { unpackRar5 } from './rarUnpack';

export interface RarEntry {
  path: string;
  size: number;
  packedSize: number;
  stored: boolean;
  bytes: Uint8Array | null;
  note?: string;
}

export interface RarArchive {
  format: 'rar4' | 'rar5';
  entries: RarEntry[];
  notice?: string;
}

// ---------------------------------------------------------------------------
// Safety caps: malformed archives must never hang the UI or exhaust memory.
// ---------------------------------------------------------------------------
const MAX_TOTAL_UNPACKED = 1024 * 1024 * 1024; // 1 GiB declared unpacked total
const MAX_ENTRIES = 100000;
const MAX_DICT_SIZE = 512 * 1024 * 1024; // 512 MiB dictionary/window
const MAX_NAME_BYTES = 65536;

// User-facing errors thrown from this parser are in French.
const ERR_NOT_RAR = 'Fichier RAR invalide ou non reconnu';
const ERR_CORRUPT = 'Archive RAR corrompue ou tronquee - apercu impossible';
const ERR_ENCRYPTED = 'Archive RAR chiffree par mot de passe - apercu impossible';
const ERR_TOO_BIG = 'Archive trop volumineuse pour un apercu';

const NOTE_COMPRESSED = 'contenu compresse (RAR) - telechargez pour extraire';
const NOTE_FILE_ENCRYPTED = 'fichier chiffre';
const NOTE_SOLID = 'archive solide - apercu indisponible';
const NOTE_BAD_CRC = 'somme de controle invalide';
const NOTE_RAR4_COMPRESSED = 'compression RAR4 non prise en charge';
const NOTICE_MULTI_VOLUME = 'archive multi-volumes: seul ce volume est liste';

const RAR5_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
const RAR4_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];

// ---------------------------------------------------------------------------
// CRC32 (IEEE 802.3, polynomial 0xEDB88320) — used for data checksums.
// ---------------------------------------------------------------------------
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Bounds-checked little-endian reader. All read failures throw the French
// corruption error so a truncated archive can never crash with a RangeError.
// ---------------------------------------------------------------------------
class ByteReader {
  readonly data: Uint8Array;

  pos: number;

  constructor(data: Uint8Array, pos: number) {
    this.data = data;
    this.pos = pos;
  }

  need(n: number): void {
    if (n < 0 || this.pos + n > this.data.length) {
      throw new Error(ERR_CORRUPT);
    }
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }

  u8(): number {
    this.need(1);
    const v = this.data[this.pos];
    this.pos += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const p = this.pos;
    this.pos += 2;
    return this.data[p] | (this.data[p + 1] << 8);
  }

  u32(): number {
    this.need(4);
    const p = this.pos;
    this.pos += 4;
    return (
      (this.data[p] |
        (this.data[p + 1] << 8) |
        (this.data[p + 2] << 16) |
        (this.data[p + 3] << 24)) >>>
      0
    );
  }

  /** RAR5 variable-length integer: LEB128, 7 data bits per byte, max 10 bytes. */
  vint(): number {
    let result = 0;
    let factor = 1;
    for (let i = 0; i < 10; i++) {
      this.need(1);
      const b = this.data[this.pos];
      this.pos += 1;
      result += (b & 0x7f) * factor;
      if ((b & 0x80) === 0) {
        if (result > Number.MAX_SAFE_INTEGER) throw new Error(ERR_TOO_BIG);
        return result;
      }
      factor *= 128;
    }
    throw new Error(ERR_CORRUPT);
  }
}

function matchesSignature(data: Uint8Array, signature: number[]): boolean {
  if (data.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (data[i] !== signature[i]) return false;
  }
  return true;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function normalizePath(name: string): string {
  return name.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function parseRar(data: Uint8Array): RarArchive {
  if (matchesSignature(data, RAR5_SIGNATURE)) return parseRar5(data);
  if (matchesSignature(data, RAR4_SIGNATURE)) return parseRar4(data);
  throw new Error(ERR_NOT_RAR);
}

// ---------------------------------------------------------------------------
// RAR5
// ---------------------------------------------------------------------------

/** Scans a RAR5 extra area for a file-encryption record (type 0x01). */
function rar5ExtraHasEncryption(data: Uint8Array, extraStart: number, extraEnd: number): boolean {
  // Bound the reader to the extra area: subarray(0, end) keeps absolute indices.
  const r = new ByteReader(data.subarray(0, extraEnd), extraStart);
  try {
    while (r.pos < extraEnd) {
      // recSize counts the record from its type field (type vint + record data).
      const recSize = r.vint();
      const recEnd = r.pos + recSize;
      if (recSize <= 0 || recEnd > extraEnd) return false;
      const recType = r.vint();
      if (recType === 0x01) return true;
      r.pos = recEnd; // always > previous pos since recSize > 0
    }
  } catch {
    // Malformed extra area: not fatal for the listing.
    return false;
  }
  return false;
}

function parseRar5(data: Uint8Array): RarArchive {
  const utf8 = new TextDecoder('utf-8');
  const entries: RarEntry[] = [];
  let notice: string | undefined;
  let totalUnpacked = 0;
  let offset = RAR5_SIGNATURE.length;
  let sawEnd = false;

  while (offset < data.length) {
    const head = new ByteReader(data, offset);
    head.skip(4); // header CRC32 (not verified: data CRCs are)
    const headerSize = head.vint(); // size of type field .. end of extra area
    if (headerSize <= 0) throw new Error(ERR_CORRUPT);
    const headerStart = head.pos;
    const headerEnd = headerStart + headerSize;
    if (headerEnd > data.length) throw new Error(ERR_CORRUPT);

    // Bound all header-field reads to the declared header size.
    const r = new ByteReader(data.subarray(0, headerEnd), headerStart);
    const blockType = r.vint();
    const blockFlags = r.vint();
    let extraSize = 0;
    let dataSize = 0;
    if ((blockFlags & 0x01) !== 0) extraSize = r.vint(); // extra area present
    if ((blockFlags & 0x02) !== 0) dataSize = r.vint(); // data area present

    const extraStart = headerEnd - extraSize;
    if (extraSize < 0 || extraStart < r.pos) throw new Error(ERR_CORRUPT);
    const dataStart = headerEnd;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > data.length) throw new Error(ERR_CORRUPT);
    const nextOffset = dataEnd;
    if (nextOffset <= offset) throw new Error(ERR_CORRUPT); // provable advance

    if (blockType === 4) {
      // Archive encryption header: everything after it is unreadable.
      throw new Error(ERR_ENCRYPTED);
    }
    if (blockType === 5) {
      sawEnd = true;
      break;
    }
    if (blockType === 1) {
      // Main archive header
      const archiveFlags = r.vint();
      if ((archiveFlags & 0x01) !== 0) notice = NOTICE_MULTI_VOLUME;
    } else if (blockType === 2) {
      // File header
      const fileFlags = r.vint();
      const isDirectory = (fileFlags & 0x01) !== 0;
      const declaredUnpSize = r.vint();
      r.vint(); // attributes
      if ((fileFlags & 0x02) !== 0) r.skip(4); // mtime (u32 unix)
      let dataCrc: number | null = null;
      if ((fileFlags & 0x04) !== 0) dataCrc = r.u32();
      const compressionInfo = r.vint();
      r.vint(); // host OS
      const nameLen = r.vint();
      if (nameLen > MAX_NAME_BYTES) throw new Error(ERR_CORRUPT);
      if (r.pos + nameLen > extraStart) throw new Error(ERR_CORRUPT);
      const name = normalizePath(utf8.decode(data.subarray(r.pos, r.pos + nameLen)));

      const fileEncrypted = extraSize > 0 && rar5ExtraHasEncryption(data, extraStart, headerEnd);

      if (!isDirectory) {
        const sizeUnknown = (fileFlags & 0x08) !== 0;
        const unpSize = sizeUnknown ? dataSize : declaredUnpSize;
        totalUnpacked += unpSize;
        if (totalUnpacked > MAX_TOTAL_UNPACKED) throw new Error(ERR_TOO_BIG);
        if (entries.length >= MAX_ENTRIES) throw new Error(ERR_TOO_BIG);

        const algoVersion = compressionInfo & 0x3f; // bits 0-5 (0 = RAR5, 1 = RAR7)
        const method = (compressionInfo >> 7) & 0x07; // bits 7-9
        const solid = (compressionInfo & 0x40) !== 0; // bit 6
        const dictBits = (compressionInfo >> 10) & 0x0f; // bits 10-13
        const dictSize = 128 * 1024 * Math.pow(2, dictBits);

        const entry: RarEntry = {
          path: name,
          size: unpSize,
          packedSize: dataSize,
          stored: method === 0,
          bytes: null,
        };

        if (fileEncrypted) {
          entry.note = NOTE_FILE_ENCRYPTED;
        } else if (method === 0) {
          const bytes = data.slice(dataStart, dataEnd);
          entry.bytes = bytes;
          if (dataCrc !== null && crc32(bytes) !== dataCrc) entry.note = NOTE_BAD_CRC;
        } else if (solid) {
          // Solid entries need the preceding compressed stream: not previewable.
          entry.note = NOTE_SOLID;
        } else if (algoVersion !== 0) {
          // RAR7+ (algorithm version 1) streams are not the v0 bitstream that
          // unpackRar5 implements: decoding them would produce garbage.
          entry.note = NOTE_COMPRESSED;
        } else {
          if (dictSize > MAX_DICT_SIZE) throw new Error(ERR_TOO_BIG);
          try {
            const bytes = unpackRar5(data.slice(dataStart, dataEnd), unpSize, dictSize);
            entry.bytes = bytes;
            if (dataCrc !== null && crc32(bytes) !== dataCrc) entry.note = NOTE_BAD_CRC;
          } catch {
            entry.bytes = null;
            entry.note = NOTE_COMPRESSED;
          }
        }
        entries.push(entry);
      }
    }
    // blockType 3 (service) and unknown block types: skip header + data area.
    offset = nextOffset;
  }

  if (!sawEnd) throw new Error(ERR_CORRUPT);

  const archive: RarArchive = { format: 'rar5', entries };
  if (notice !== undefined) archive.notice = notice;
  return archive;
}

// ---------------------------------------------------------------------------
// RAR4
// ---------------------------------------------------------------------------

/**
 * Standard RAR4 unicode name decoding (encname.cpp algorithm): an opcode
 * stream with 2-bit flags driving UTF-16 code-unit production.
 * Returns null when the encoded stream is unusable (caller falls back to the
 * plain ascii half).
 */
function decodeRar4UnicodeName(ascii: Uint8Array, enc: Uint8Array): string | null {
  const maxDecoded = MAX_NAME_BYTES;
  const out: number[] = [];
  let encPos = 0;
  let flags = 0;
  let flagBits = 0;
  if (enc.length === 0) return null;
  const highByte = enc[encPos];
  encPos += 1;
  while (encPos < enc.length && out.length < maxDecoded) {
    if (flagBits === 0) {
      flags = enc[encPos];
      encPos += 1;
      flagBits = 8;
    }
    if (encPos >= enc.length) break;
    switch ((flags >> 6) & 0x03) {
      case 0:
        // Raw byte (high byte 0)
        out.push(enc[encPos]);
        encPos += 1;
        break;
      case 1:
        // Low byte combined with the current high byte
        out.push(enc[encPos] + (highByte << 8));
        encPos += 1;
        break;
      case 2:
        // Explicit 2-byte little-endian code unit
        if (encPos + 1 >= enc.length) return null;
        out.push(enc[encPos] + (enc[encPos + 1] << 8));
        encPos += 2;
        break;
      case 3: {
        // Run-length copy from the ascii part
        let runLength = enc[encPos];
        encPos += 1;
        if ((runLength & 0x80) !== 0) {
          if (encPos >= enc.length) return null;
          const correction = enc[encPos];
          encPos += 1;
          for (
            runLength = (runLength & 0x7f) + 2;
            runLength > 0 && out.length < maxDecoded;
            runLength--
          ) {
            const idx = out.length;
            if (idx >= ascii.length) break;
            out.push(((ascii[idx] + correction) & 0xff) + (highByte << 8));
          }
        } else {
          for (runLength += 2; runLength > 0 && out.length < maxDecoded; runLength--) {
            const idx = out.length;
            if (idx >= ascii.length) break;
            out.push(ascii[idx]);
          }
        }
        break;
      }
      default:
        return null; // unreachable: 2-bit opcode
    }
    flags = (flags << 2) & 0xff;
    flagBits -= 2;
  }
  if (out.length === 0) return null;
  let s = '';
  for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
  return s;
}

function decodeRar4Name(nameBytes: Uint8Array, hasUnicode: boolean): string {
  if (!hasUnicode) return latin1(nameBytes);
  const zero = nameBytes.indexOf(0);
  if (zero < 0) {
    // Unicode flag without the "ascii\0encoded" split: the name is plain UTF-8.
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch {
      return latin1(nameBytes);
    }
  }
  const ascii = nameBytes.subarray(0, zero);
  const encoded = nameBytes.subarray(zero + 1);
  let decoded: string | null = null;
  try {
    decoded = decodeRar4UnicodeName(ascii, encoded);
  } catch {
    decoded = null;
  }
  return decoded !== null ? decoded : latin1(ascii);
}

function parseRar4(data: Uint8Array): RarArchive {
  const entries: RarEntry[] = [];
  let notice: string | undefined;
  let totalUnpacked = 0;
  let offset = RAR4_SIGNATURE.length;

  while (offset < data.length) {
    if (offset + 7 > data.length) throw new Error(ERR_CORRUPT);
    const r = new ByteReader(data, offset);
    r.skip(2); // header CRC16 (not verified)
    const blockType = r.u8();
    const blockFlags = r.u16();
    const headSize = r.u16();
    if (headSize < 7) throw new Error(ERR_CORRUPT); // a block must advance
    const headerEnd = offset + headSize;
    if (headerEnd > data.length) throw new Error(ERR_CORRUPT);
    let dataSize = 0;

    if (blockType === 0x7b) {
      // End of archive
      const archive: RarArchive = { format: 'rar4', entries };
      if (notice !== undefined) archive.notice = notice;
      return archive;
    }

    if (blockType === 0x73) {
      // Main archive header
      if ((blockFlags & 0x0080) !== 0) throw new Error(ERR_ENCRYPTED); // encrypted headers
      if ((blockFlags & 0x0001) !== 0) notice = NOTICE_MULTI_VOLUME; // volume
    } else if (blockType === 0x74) {
      // File header — the leading u32 packSize is the data-area size.
      const packSizeLow = r.u32();
      const unpSizeLow = r.u32();
      r.skip(1); // host OS
      const fileCrc = r.u32();
      r.skip(4); // ftime
      r.skip(1); // unpVer
      const method = r.u8();
      const nameSize = r.u16();
      r.skip(4); // attributes
      let packSize = packSizeLow;
      let unpSize = unpSizeLow;
      if ((blockFlags & 0x100) !== 0) {
        packSize = r.u32() * 4294967296 + packSizeLow; // highPackSize
        unpSize = r.u32() * 4294967296 + unpSizeLow; // highUnpSize
      }
      if (r.pos + nameSize > headerEnd) throw new Error(ERR_CORRUPT);
      const nameBytes = data.subarray(r.pos, r.pos + nameSize);
      dataSize = packSize;
      const dataStart = headerEnd;
      const dataEnd = dataStart + dataSize;
      if (dataEnd > data.length) throw new Error(ERR_CORRUPT);

      const isDirectory = (blockFlags & 0xe0) === 0xe0;
      if (!isDirectory) {
        totalUnpacked += unpSize;
        if (totalUnpacked > MAX_TOTAL_UNPACKED) throw new Error(ERR_TOO_BIG);
        if (entries.length >= MAX_ENTRIES) throw new Error(ERR_TOO_BIG);

        const name = normalizePath(decodeRar4Name(nameBytes, (blockFlags & 0x200) !== 0));
        const entry: RarEntry = {
          path: name,
          size: unpSize,
          packedSize: packSize,
          stored: method === 0x30,
          bytes: null,
        };

        if ((blockFlags & 0x04) !== 0) {
          // Password-protected file data
          entry.note = NOTE_FILE_ENCRYPTED;
        } else if (method === 0x30) {
          const bytes = data.slice(dataStart, dataEnd);
          entry.bytes = bytes;
          if (crc32(bytes) !== fileCrc) entry.note = NOTE_BAD_CRC;
        } else {
          entry.note = NOTE_RAR4_COMPRESSED;
        }
        entries.push(entry);
      }
    } else if ((blockFlags & 0x8000) !== 0) {
      // Any other block with a data area (service blocks, recovery record, ...)
      dataSize = r.u32();
      if (headerEnd + dataSize > data.length) throw new Error(ERR_CORRUPT);
    }

    const nextOffset = headerEnd + dataSize;
    if (nextOffset <= offset) throw new Error(ERR_CORRUPT); // provable advance
    offset = nextOffset;
  }

  // Very old RAR4 writers may omit the end-of-archive block: accept a clean
  // end-of-buffer, anything else already threw ERR_CORRUPT above.
  const archive: RarArchive = { format: 'rar4', entries };
  if (notice !== undefined) archive.notice = notice;
  return archive;
}
