/**
 * Pure-JS 7-Zip (.7z) container parser: listing + extraction.
 *
 * The renderer CSP blocks all WebAssembly, so this parser is hand-written
 * JavaScript with no native dependencies. LZMA1/LZMA2 are decoded by the
 * pure-JS decoder in ./lzma; Deflate goes through the already-bundled
 * fflate package. Copy, Delta and BCJ (x86) filters are implemented here.
 *
 * Unsupported codecs (PPMd, BCJ2, BZip2, non-x86 branch filters, ...)
 * degrade gracefully per folder: the entries of that folder are listed with
 * bytes = null and a French note while other folders still extract.
 * AES-encrypted archives throw (headers are usually encrypted too).
 *
 * Node-compatible pure functions: no DOM, no React, no workers.
 */

import { inflateSync } from 'fflate';
import { lzma2Decode, lzmaDecode } from './lzma';

export interface SevenZipEntry {
  path: string;
  size: number;
  bytes: Uint8Array | null;
  note?: string;
}

// ---------------------------------------------------------------------------
// Safety caps: malformed archives must never hang the UI or exhaust memory.
// ---------------------------------------------------------------------------
const MAX_TOTAL_UNPACKED = 1024 * 1024 * 1024; // 1 GiB declared unpacked total
const MAX_ENTRIES = 100000;
const MAX_DICT_SIZE = 512 * 1024 * 1024; // 512 MiB dictionary/window
const MAX_CODERS_PER_FOLDER = 64;
const MAX_PROPS_SIZE = 1024 * 1024;
const MAX_HEADER_DEPTH = 4;

// User-facing errors thrown from this parser are in French.
const ERR_NOT_7Z = 'Fichier 7z invalide ou non reconnu';
const ERR_CORRUPT = 'Archive 7z corrompue ou tronquee - apercu impossible';
const ERR_ENCRYPTED = 'Archive 7z chiffree par mot de passe - apercu impossible';
const ERR_TOO_BIG = 'Archive trop volumineuse pour un apercu';

const NOTE_PPMD = 'compression PPMd non prise en charge';
const NOTE_BCJ2 = 'filtre BCJ2 non pris en charge';
const NOTE_BZIP2 = 'compression BZip2 non prise en charge';
const NOTE_BRANCH = 'filtre de branchement non pris en charge';
const NOTE_UNKNOWN_CODEC = 'compression non prise en charge';
const NOTE_BAD_CRC = 'somme de controle invalide';

// Property IDs of the 7z header format.
const K_END = 0x00;
const K_HEADER = 0x01;
const K_ARCHIVE_PROPERTIES = 0x02;
const K_ADDITIONAL_STREAMS = 0x03;
const K_MAIN_STREAMS = 0x04;
const K_FILES_INFO = 0x05;
const K_PACK_INFO = 0x06;
const K_UNPACK_INFO = 0x07;
const K_SUBSTREAMS_INFO = 0x08;
const K_SIZE = 0x09;
const K_CRC = 0x0a;
const K_FOLDER = 0x0b;
const K_CODERS_UNPACK_SIZE = 0x0c;
const K_NUM_UNPACK_STREAM = 0x0d;
const K_EMPTY_STREAM = 0x0e;
const K_EMPTY_FILE = 0x0f;
const K_ANTI = 0x10;
const K_NAME = 0x11;
const K_ENCODED_HEADER = 0x17;

// Codec IDs (big-endian bytes packed into a number).
const CODEC_COPY = 0x00;
const CODEC_DELTA = 0x03;
const CODEC_LZMA2 = 0x21;
const CODEC_LZMA = 0x030101;
const CODEC_PPMD = 0x030401;
const CODEC_BCJ_X86 = 0x03030103;
const CODEC_BCJ2 = 0x0303011b;
const CODEC_DEFLATE = 0x040108;
const CODEC_BZIP2 = 0x040202;
const CODEC_AES256 = 0x06f10701;

// Other known branch filters (PPC/ALPHA/IA64/ARM/ARMT/SPARC + new-style
// ARM64/RISC-V ids) — recognized but not implemented.
const BRANCH_FILTER_IDS = new Set<number>([
  0x03030205, // PPC
  0x03030301, // ALPHA
  0x03030401, // IA64
  0x03030501, // ARM
  0x03030701, // ARMT
  0x03030805, // SPARC
  0x0a, // ARM64
  0x0b, // RISC-V
]);

const SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];

// ---------------------------------------------------------------------------
// Internal sentinel for per-folder graceful degradation (message is the
// French note attached to the folder's entries).
// ---------------------------------------------------------------------------
const UNSUPPORTED_CODEC_NAME = 'Filarr7zUnsupportedCodec';

function unsupportedCodec(note: string): Error {
  const err = new Error(note);
  err.name = UNSUPPORTED_CODEC_NAME;
  return err;
}

function isUnsupportedCodec(err: unknown): err is Error {
  return err instanceof Error && err.name === UNSUPPORTED_CODEC_NAME;
}

// ---------------------------------------------------------------------------
// CRC-32 (IEEE, table-based).
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Byte reader with the 7z variable-length number encoding.
// ---------------------------------------------------------------------------
class ByteReader {
  pos = 0;

  constructor(private readonly data: Uint8Array) {}

  get length(): number {
    return this.data.length;
  }

  readByte(): number {
    if (this.pos >= this.data.length) {
      throw new Error(ERR_CORRUPT);
    }
    return this.data[this.pos++];
  }

  readBytes(count: number): Uint8Array {
    if (count < 0 || this.pos + count > this.data.length) {
      throw new Error(ERR_CORRUPT);
    }
    const slice = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }

  skip(count: number): void {
    if (count < 0 || this.pos + count > this.data.length) {
      throw new Error(ERR_CORRUPT);
    }
    this.pos += count;
  }

  readUInt32LE(): number {
    const b = this.readBytes(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  }

  /** 7z variable-length number (first-byte high-bit mask scheme). */
  readNumber(): number {
    const first = this.readByte();
    let mask = 0x80;
    let value = 0;
    for (let i = 0; i < 8; i++) {
      if ((first & mask) === 0) {
        value += (first & (mask - 1)) * Math.pow(2, 8 * i);
        break;
      }
      value += this.readByte() * Math.pow(2, 8 * i);
      mask >>= 1;
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(ERR_TOO_BIG);
    }
    return value;
  }

  /** Bit vector, MSB first. */
  readBits(count: number): boolean[] {
    const result: boolean[] = [];
    let current = 0;
    let mask = 0;
    for (let i = 0; i < count; i++) {
      if (mask === 0) {
        current = this.readByte();
        mask = 0x80;
      }
      result.push((current & mask) !== 0);
      mask >>= 1;
    }
    return result;
  }

  /** "allAreDefined" byte followed by a bit vector when it is 0. */
  readBoolVector(count: number): boolean[] {
    const allDefined = this.readByte();
    if (allDefined !== 0) {
      return new Array<boolean>(count).fill(true);
    }
    return this.readBits(count);
  }
}

/** Digests: defined-vector then a u32 CRC per defined stream. */
function readDigests(r: ByteReader, count: number): Array<number | null> {
  const defined = r.readBoolVector(count);
  return defined.map((d) => (d ? r.readUInt32LE() : null));
}

// ---------------------------------------------------------------------------
// StreamsInfo structures.
// ---------------------------------------------------------------------------
interface Coder {
  id: number; // -1 when the id is too long to represent exactly
  numIn: number;
  numOut: number;
  props: Uint8Array | null;
}

interface BindPair {
  inIndex: number;
  outIndex: number;
}

interface Folder {
  coders: Coder[];
  bindPairs: BindPair[];
  /** Global in-stream indices fed by pack streams, in pack order. */
  packedIndices: number[];
  /** Unpack size per global out-stream index. */
  unpackSizes: number[];
  numPackStreams: number;
  totalIn: number;
  totalOut: number;
  crc: number | null;
}

interface StreamsInfo {
  packPos: number;
  packSizes: number[];
  folders: Folder[];
  numUnpackStreams: number[];
  substreamSizes: number[][];
  substreamCRCs: Array<Array<number | null>>;
}

/** Index of the folder's final out-stream (the one no bind pair consumes). */
function finalOutIndex(folder: Folder): number {
  for (let o = 0; o < folder.totalOut; o++) {
    if (!folder.bindPairs.some((bp) => bp.outIndex === o)) {
      return o;
    }
  }
  throw new Error(ERR_CORRUPT);
}

function folderUnpackSize(folder: Folder): number {
  return folder.unpackSizes[finalOutIndex(folder)];
}

function parseFolder(r: ByteReader): Folder {
  const numCoders = r.readNumber();
  if (numCoders === 0 || numCoders > MAX_CODERS_PER_FOLDER) {
    throw new Error(ERR_CORRUPT);
  }
  const coders: Coder[] = [];
  let totalIn = 0;
  let totalOut = 0;
  for (let i = 0; i < numCoders; i++) {
    const flag = r.readByte();
    if ((flag & 0x80) !== 0) {
      // Alternative methods are not part of the published format.
      throw new Error(ERR_CORRUPT);
    }
    const idSize = flag & 0x0f;
    const idBytes = r.readBytes(idSize);
    let id = 0;
    if (idSize <= 6) {
      for (let k = 0; k < idBytes.length; k++) {
        id = id * 256 + idBytes[k];
      }
    } else {
      id = -1; // unknown, too long to represent exactly
    }
    let numIn = 1;
    let numOut = 1;
    if ((flag & 0x10) !== 0) {
      numIn = r.readNumber();
      numOut = r.readNumber();
      if (
        numIn === 0 ||
        numOut === 0 ||
        numIn > MAX_CODERS_PER_FOLDER ||
        numOut > MAX_CODERS_PER_FOLDER
      ) {
        throw new Error(ERR_CORRUPT);
      }
    }
    let props: Uint8Array | null = null;
    if ((flag & 0x20) !== 0) {
      const propsSize = r.readNumber();
      if (propsSize > MAX_PROPS_SIZE) {
        throw new Error(ERR_CORRUPT);
      }
      props = r.readBytes(propsSize);
    }
    coders.push({ id, numIn, numOut, props });
    totalIn += numIn;
    totalOut += numOut;
  }
  const numBindPairs = totalOut - 1;
  const bindPairs: BindPair[] = [];
  for (let i = 0; i < numBindPairs; i++) {
    const inIndex = r.readNumber();
    const outIndex = r.readNumber();
    if (inIndex >= totalIn || outIndex >= totalOut) {
      throw new Error(ERR_CORRUPT);
    }
    bindPairs.push({ inIndex, outIndex });
  }
  const numPackStreams = totalIn - numBindPairs;
  if (numPackStreams < 1) {
    throw new Error(ERR_CORRUPT);
  }
  let packedIndices: number[] = [];
  if (numPackStreams === 1) {
    // The single packed input is the in-stream no bind pair feeds.
    let found = -1;
    for (let inIdx = 0; inIdx < totalIn; inIdx++) {
      if (!bindPairs.some((bp) => bp.inIndex === inIdx)) {
        found = inIdx;
        break;
      }
    }
    if (found < 0) {
      throw new Error(ERR_CORRUPT);
    }
    packedIndices = [found];
  } else {
    for (let i = 0; i < numPackStreams; i++) {
      const idx = r.readNumber();
      if (idx >= totalIn) {
        throw new Error(ERR_CORRUPT);
      }
      packedIndices.push(idx);
    }
  }
  return {
    coders,
    bindPairs,
    packedIndices,
    unpackSizes: [],
    numPackStreams,
    totalIn,
    totalOut,
    crc: null,
  };
}

function parsePackInfo(r: ByteReader): { packPos: number; packSizes: number[] } {
  const packPos = r.readNumber();
  const numPackStreams = r.readNumber();
  if (numPackStreams > MAX_ENTRIES) {
    throw new Error(ERR_TOO_BIG);
  }
  let packSizes: number[] | null = null;
  for (;;) {
    const id = r.readNumber();
    if (id === K_END) {
      break;
    }
    if (id === K_SIZE) {
      packSizes = [];
      for (let i = 0; i < numPackStreams; i++) {
        packSizes.push(r.readNumber());
      }
    } else if (id === K_CRC) {
      readDigests(r, numPackStreams);
    } else {
      throw new Error(ERR_CORRUPT);
    }
  }
  if (packSizes === null) {
    throw new Error(ERR_CORRUPT);
  }
  return { packPos, packSizes };
}

function parseUnpackInfo(r: ByteReader): Folder[] {
  let folders: Folder[] | null = null;
  for (;;) {
    const id = r.readNumber();
    if (id === K_END) {
      break;
    }
    if (id === K_FOLDER) {
      const numFolders = r.readNumber();
      if (numFolders > MAX_ENTRIES) {
        throw new Error(ERR_TOO_BIG);
      }
      const external = r.readByte();
      if (external !== 0) {
        // Folder definitions stored in a separate stream: not supported.
        throw new Error(ERR_CORRUPT);
      }
      folders = [];
      for (let i = 0; i < numFolders; i++) {
        folders.push(parseFolder(r));
      }
    } else if (id === K_CODERS_UNPACK_SIZE) {
      if (folders === null) {
        throw new Error(ERR_CORRUPT);
      }
      for (const folder of folders) {
        for (let o = 0; o < folder.totalOut; o++) {
          folder.unpackSizes.push(r.readNumber());
        }
      }
    } else if (id === K_CRC) {
      if (folders === null) {
        throw new Error(ERR_CORRUPT);
      }
      const digests = readDigests(r, folders.length);
      folders.forEach((folder, i) => {
        folder.crc = digests[i];
      });
    } else {
      throw new Error(ERR_CORRUPT);
    }
  }
  if (folders === null) {
    throw new Error(ERR_CORRUPT);
  }
  for (const folder of folders) {
    if (folder.unpackSizes.length !== folder.totalOut) {
      throw new Error(ERR_CORRUPT);
    }
  }
  return folders;
}

function parseSubStreamsInfo(
  r: ByteReader,
  folders: Folder[]
): { numUnpackStreams: number[]; sizes: number[][]; crcs: Array<Array<number | null>> } {
  let numUnpackStreams: number[] = folders.map(() => 1);
  let sizes: number[][] | null = null;
  let crcs: Array<Array<number | null>> | null = null;
  for (;;) {
    const id = r.readNumber();
    if (id === K_END) {
      break;
    }
    if (id === K_NUM_UNPACK_STREAM) {
      numUnpackStreams = folders.map(() => r.readNumber());
      const total = numUnpackStreams.reduce((a, b) => a + b, 0);
      if (total > MAX_ENTRIES) {
        throw new Error(ERR_TOO_BIG);
      }
    } else if (id === K_SIZE) {
      sizes = [];
      for (let f = 0; f < folders.length; f++) {
        const n = numUnpackStreams[f];
        const folderSizes: number[] = [];
        if (n > 0) {
          let sum = 0;
          for (let k = 0; k < n - 1; k++) {
            const s = r.readNumber();
            folderSizes.push(s);
            sum += s;
          }
          const last = folderUnpackSize(folders[f]) - sum;
          if (last < 0 || !Number.isSafeInteger(last)) {
            throw new Error(ERR_CORRUPT);
          }
          folderSizes.push(last);
        }
        sizes.push(folderSizes);
      }
    } else if (id === K_CRC) {
      // Digests only for streams whose CRC is not already known from the
      // folder (single-stream folders with a folder CRC).
      let unknownCount = 0;
      for (let f = 0; f < folders.length; f++) {
        if (numUnpackStreams[f] === 1 && folders[f].crc !== null) {
          continue;
        }
        unknownCount += numUnpackStreams[f];
      }
      const digests = readDigests(r, unknownCount);
      let cursor = 0;
      crcs = [];
      for (let f = 0; f < folders.length; f++) {
        const n = numUnpackStreams[f];
        if (n === 1 && folders[f].crc !== null) {
          crcs.push([folders[f].crc]);
        } else {
          crcs.push(digests.slice(cursor, cursor + n));
          cursor += n;
        }
      }
    } else {
      throw new Error(ERR_CORRUPT);
    }
  }
  if (sizes === null) {
    sizes = folders.map((folder, f) => {
      const n = numUnpackStreams[f];
      if (n === 0) {
        return [];
      }
      if (n !== 1) {
        throw new Error(ERR_CORRUPT);
      }
      return [folderUnpackSize(folder)];
    });
  }
  if (crcs === null) {
    crcs = folders.map((folder, f) => {
      const n = numUnpackStreams[f];
      if (n === 1 && folder.crc !== null) {
        return [folder.crc];
      }
      return new Array<number | null>(n).fill(null);
    });
  }
  // Reject out-of-order property blocks (kSize/kCRC parsed before
  // kNumUnpackStream): sizes/CRCs must exist for every declared substream,
  // otherwise entries would surface with undefined sizes.
  for (let f = 0; f < folders.length; f++) {
    if (sizes[f].length !== numUnpackStreams[f] || crcs[f].length !== numUnpackStreams[f]) {
      throw new Error(ERR_CORRUPT);
    }
  }
  return { numUnpackStreams, sizes, crcs };
}

function parseStreamsInfo(r: ByteReader): StreamsInfo {
  let packPos = 0;
  let packSizes: number[] = [];
  let folders: Folder[] = [];
  let sub: {
    numUnpackStreams: number[];
    sizes: number[][];
    crcs: Array<Array<number | null>>;
  } | null = null;
  for (;;) {
    const id = r.readNumber();
    if (id === K_END) {
      break;
    }
    if (id === K_PACK_INFO) {
      const info = parsePackInfo(r);
      packPos = info.packPos;
      packSizes = info.packSizes;
    } else if (id === K_UNPACK_INFO) {
      folders = parseUnpackInfo(r);
    } else if (id === K_SUBSTREAMS_INFO) {
      sub = parseSubStreamsInfo(r, folders);
    } else {
      throw new Error(ERR_CORRUPT);
    }
  }
  // Enforce the global declared-unpacked-size cap (includes intermediate
  // coder outputs, which we also have to materialize).
  let declared = 0;
  for (const folder of folders) {
    for (const size of folder.unpackSizes) {
      declared += size;
      if (declared > MAX_TOTAL_UNPACKED) {
        throw new Error(ERR_TOO_BIG);
      }
    }
  }
  if (sub === null) {
    sub = {
      numUnpackStreams: folders.map(() => 1),
      sizes: folders.map((folder) => [folderUnpackSize(folder)]),
      crcs: folders.map((folder) => [folder.crc]),
    };
  }
  return {
    packPos,
    packSizes,
    folders,
    numUnpackStreams: sub.numUnpackStreams,
    substreamSizes: sub.sizes,
    substreamCRCs: sub.crcs,
  };
}

// ---------------------------------------------------------------------------
// FilesInfo.
// ---------------------------------------------------------------------------
interface FilesInfo {
  count: number;
  names: string[];
  emptyStream: boolean[];
  emptyFile: boolean[];
  anti: boolean[];
}

function decodeNames(bytes: Uint8Array, expectedCount: number): string[] {
  if (bytes.length % 2 !== 0) {
    throw new Error(ERR_CORRUPT);
  }
  const decoder = new TextDecoder('utf-16le');
  const names: string[] = [];
  let start = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) {
      names.push(decoder.decode(bytes.subarray(start, i)).replace(/\\/g, '/'));
      start = i + 2;
      if (names.length > expectedCount) {
        throw new Error(ERR_CORRUPT);
      }
    }
  }
  if (names.length !== expectedCount || start !== bytes.length) {
    throw new Error(ERR_CORRUPT);
  }
  return names;
}

function parseFilesInfo(r: ByteReader): FilesInfo {
  const numFiles = r.readNumber();
  if (numFiles > MAX_ENTRIES) {
    throw new Error(ERR_TOO_BIG);
  }
  let names: string[] | null = null;
  let emptyStream: boolean[] = new Array<boolean>(numFiles).fill(false);
  let emptyFile: boolean[] = [];
  let anti: boolean[] = [];
  let numEmpty = 0;
  for (;;) {
    const id = r.readNumber();
    if (id === K_END) {
      break;
    }
    const size = r.readNumber();
    if (r.pos + size > r.length) {
      throw new Error(ERR_CORRUPT);
    }
    const endPos = r.pos + size;
    if (id === K_EMPTY_STREAM) {
      emptyStream = r.readBits(numFiles);
      numEmpty = emptyStream.reduce((acc, b) => acc + (b ? 1 : 0), 0);
    } else if (id === K_EMPTY_FILE) {
      emptyFile = r.readBits(numEmpty);
    } else if (id === K_ANTI) {
      anti = r.readBits(numEmpty);
    } else if (id === K_NAME) {
      const external = r.readByte();
      if (external !== 0) {
        throw new Error(ERR_CORRUPT);
      }
      names = decodeNames(r.readBytes(endPos - r.pos), numFiles);
    }
    // Skip anything unparsed (kMTime, kAttributes, kDummy, unknown ids):
    // every property block carries its exact byte size.
    r.pos = endPos;
  }
  if (names === null) {
    throw new Error(ERR_CORRUPT);
  }
  return { count: numFiles, names, emptyStream, emptyFile, anti };
}

// ---------------------------------------------------------------------------
// Filters implemented locally.
// ---------------------------------------------------------------------------
function deltaDecode(data: Uint8Array, distance: number): void {
  for (let i = distance; i < data.length; i++) {
    data[i] = (data[i] + data[i - distance]) & 0xff;
  }
}

function isX86MSByte(b: number): boolean {
  return b === 0 || b === 0xff;
}

const BCJ_MASK_TO_ALLOWED = [true, true, true, false, true, false, false, false];
const BCJ_MASK_TO_BIT = [0, 1, 2, 2, 3, 3, 3, 3];

/**
 * BCJ x86 branch converter, decode direction (port of the reference
 * Bra86.c x86_Convert with encoding = 0, ip base 0, initial state 0).
 * Converts absolute E8/E9 call/jump targets back to relative ones in place.
 */
function bcjX86Decode(data: Uint8Array): void {
  const size = data.length;
  if (size < 5) {
    return;
  }
  const ip = 5;
  const limit = size - 4;
  let bufferPos = 0;
  let prevMask = 0;
  let prevPos = -1;
  for (;;) {
    while (bufferPos < limit && (data[bufferPos] & 0xfe) !== 0xe8) {
      bufferPos++;
    }
    if (bufferPos >= limit) {
      break;
    }
    const dist = bufferPos - prevPos;
    if (dist > 3) {
      prevMask = 0;
    } else {
      prevMask = (prevMask << (dist - 1)) & 0x7;
      if (prevMask !== 0) {
        const b = data[bufferPos + 4 - BCJ_MASK_TO_BIT[prevMask]];
        if (!BCJ_MASK_TO_ALLOWED[prevMask] || isX86MSByte(b)) {
          prevPos = bufferPos;
          prevMask = ((prevMask << 1) & 0x7) | 1;
          bufferPos++;
          continue;
        }
      }
    }
    prevPos = bufferPos;
    if (isX86MSByte(data[bufferPos + 4])) {
      let src =
        ((data[bufferPos + 4] << 24) |
          (data[bufferPos + 3] << 16) |
          (data[bufferPos + 2] << 8) |
          data[bufferPos + 1]) >>>
        0;
      let dest: number;
      for (;;) {
        dest = (src - (ip + bufferPos)) >>> 0;
        if (prevMask === 0) {
          break;
        }
        const index = BCJ_MASK_TO_BIT[prevMask] * 8;
        const b = (dest >>> (24 - index)) & 0xff;
        if (!isX86MSByte(b)) {
          break;
        }
        src = (dest ^ ((1 << (32 - index)) - 1)) >>> 0;
      }
      data[bufferPos + 4] = (dest >>> 24) & 1 ? 0xff : 0x00;
      data[bufferPos + 3] = (dest >>> 16) & 0xff;
      data[bufferPos + 2] = (dest >>> 8) & 0xff;
      data[bufferPos + 1] = dest & 0xff;
      bufferPos += 5;
    } else {
      prevMask = ((prevMask << 1) & 0x7) | 1;
      bufferPos++;
    }
  }
}

// ---------------------------------------------------------------------------
// Folder decoding (linear coder chains resolved through bind pairs).
// ---------------------------------------------------------------------------
interface DecodeBudget {
  used: number;
}

function chargeBudget(budget: DecodeBudget, size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(ERR_CORRUPT);
  }
  budget.used += size;
  if (budget.used > MAX_TOTAL_UNPACKED) {
    throw new Error(ERR_TOO_BIG);
  }
}

function lzma2DictSizeFromProps(props: Uint8Array | null): number {
  if (props === null || props.length < 1) {
    throw new Error(ERR_CORRUPT);
  }
  const p = props[0];
  if (p > 40) {
    throw new Error(ERR_CORRUPT);
  }
  if (p === 40) {
    return 0xffffffff;
  }
  return (2 + (p & 1)) * Math.pow(2, (p >> 1) + 11);
}

function decodeCoderOutput(coder: Coder, input: Uint8Array, outSize: number): Uint8Array {
  switch (coder.id) {
    case CODEC_COPY: {
      if (input.length < outSize) {
        throw new Error(ERR_CORRUPT);
      }
      return input.length === outSize ? input : input.subarray(0, outSize);
    }
    case CODEC_LZMA2: {
      if (lzma2DictSizeFromProps(coder.props) > MAX_DICT_SIZE) {
        throw new Error(ERR_TOO_BIG);
      }
      return lzma2Decode(input, outSize);
    }
    case CODEC_LZMA: {
      if (coder.props === null || coder.props.length < 5) {
        throw new Error(ERR_CORRUPT);
      }
      return lzmaDecode(coder.props, input, outSize);
    }
    case CODEC_DELTA: {
      if (input.length < outSize) {
        throw new Error(ERR_CORRUPT);
      }
      const distance = (coder.props !== null && coder.props.length >= 1 ? coder.props[0] : 0) + 1;
      const out = input.slice(0, outSize);
      deltaDecode(out, distance);
      return out;
    }
    case CODEC_BCJ_X86: {
      if (input.length < outSize) {
        throw new Error(ERR_CORRUPT);
      }
      const out = input.slice(0, outSize);
      bcjX86Decode(out);
      return out;
    }
    case CODEC_DEFLATE: {
      try {
        return inflateSync(input, { out: new Uint8Array(outSize) });
      } catch {
        throw new Error(ERR_CORRUPT);
      }
    }
    case CODEC_AES256:
      throw new Error(ERR_ENCRYPTED);
    case CODEC_PPMD:
      throw unsupportedCodec(NOTE_PPMD);
    case CODEC_BCJ2:
      throw unsupportedCodec(NOTE_BCJ2);
    case CODEC_BZIP2:
      throw unsupportedCodec(NOTE_BZIP2);
    default:
      if (BRANCH_FILTER_IDS.has(coder.id)) {
        throw unsupportedCodec(NOTE_BRANCH);
      }
      throw unsupportedCodec(NOTE_UNKNOWN_CODEC);
  }
}

/**
 * Decode one folder's final output. `firstPack` is the index of the folder's
 * first pack stream within `packOffsets`/`packSizes`.
 */
function decodeFolder(
  archive: Uint8Array,
  packOffsets: number[],
  packSizes: number[],
  firstPack: number,
  folder: Folder,
  budget: DecodeBudget
): Uint8Array {
  // Global in/out stream index ranges per coder.
  const coderInStart: number[] = [];
  const coderOutStart: number[] = [];
  {
    let inAcc = 0;
    let outAcc = 0;
    for (const coder of folder.coders) {
      coderInStart.push(inAcc);
      coderOutStart.push(outAcc);
      inAcc += coder.numIn;
      outAcc += coder.numOut;
    }
  }
  const boundByIn = new Map<number, number>();
  for (const bp of folder.bindPairs) {
    if (boundByIn.has(bp.inIndex)) {
      throw new Error(ERR_CORRUPT);
    }
    boundByIn.set(bp.inIndex, bp.outIndex);
  }
  const packOrdinalByIn = new Map<number, number>();
  folder.packedIndices.forEach((inIdx, ord) => {
    packOrdinalByIn.set(inIdx, ord);
  });

  const coderOfOut = (outIdx: number): number => {
    for (let i = folder.coders.length - 1; i >= 0; i--) {
      if (outIdx >= coderOutStart[i]) {
        if (outIdx < coderOutStart[i] + folder.coders[i].numOut) {
          return i;
        }
        break;
      }
    }
    throw new Error(ERR_CORRUPT);
  };

  const outputs = new Map<number, Uint8Array>();
  const inProgress = new Set<number>();

  const getOutput = (outIdx: number, depth: number): Uint8Array => {
    if (depth > MAX_CODERS_PER_FOLDER) {
      throw new Error(ERR_CORRUPT);
    }
    const cached = outputs.get(outIdx);
    if (cached !== undefined) {
      return cached;
    }
    const ci = coderOfOut(outIdx);
    if (inProgress.has(ci)) {
      // Cycle in the bind-pair graph.
      throw new Error(ERR_CORRUPT);
    }
    inProgress.add(ci);
    const coder = folder.coders[ci];
    // Recognize encryption and unsupported codecs before shape checks so
    // multi-input codecs (BCJ2) degrade with their proper note.
    if (coder.id === CODEC_AES256) {
      throw new Error(ERR_ENCRYPTED);
    }
    if (coder.numIn !== 1 || coder.numOut !== 1) {
      // Only linear 1-in/1-out chains are supported (rules out BCJ2).
      if (coder.id === CODEC_BCJ2) {
        throw unsupportedCodec(NOTE_BCJ2);
      }
      throw unsupportedCodec(NOTE_UNKNOWN_CODEC);
    }
    const inIdx = coderInStart[ci];
    let input: Uint8Array;
    const boundOut = boundByIn.get(inIdx);
    if (boundOut !== undefined) {
      input = getOutput(boundOut, depth + 1);
    } else {
      const ord = packOrdinalByIn.get(inIdx);
      if (ord === undefined) {
        throw new Error(ERR_CORRUPT);
      }
      const packIdx = firstPack + ord;
      if (packIdx >= packOffsets.length) {
        throw new Error(ERR_CORRUPT);
      }
      const start = packOffsets[packIdx];
      const size = packSizes[packIdx];
      if (start + size > archive.length) {
        throw new Error(ERR_CORRUPT);
      }
      input = archive.subarray(start, start + size);
    }
    const outSize = folder.unpackSizes[outIdx];
    chargeBudget(budget, outSize);
    const out = decodeCoderOutput(coder, input, outSize);
    inProgress.delete(ci);
    outputs.set(outIdx, out);
    return out;
  };

  return getOutput(finalOutIndex(folder), 0);
}

// ---------------------------------------------------------------------------
// Header parsing.
// ---------------------------------------------------------------------------
interface ParsedHeader {
  streams: StreamsInfo | null;
  files: FilesInfo | null;
}

function computePackOffsets(streams: StreamsInfo, archiveLength: number): number[] {
  const base = 32 + streams.packPos;
  const offsets: number[] = [];
  let acc = base;
  for (const size of streams.packSizes) {
    if (!Number.isSafeInteger(acc) || acc > archiveLength) {
      throw new Error(ERR_CORRUPT);
    }
    offsets.push(acc);
    acc += size;
  }
  if (!Number.isSafeInteger(acc) || acc > archiveLength) {
    throw new Error(ERR_CORRUPT);
  }
  return offsets;
}

/** First pack-stream index for each folder (folders consume packs in order). */
function firstPackPerFolder(streams: StreamsInfo): number[] {
  const firsts: number[] = [];
  let acc = 0;
  for (const folder of streams.folders) {
    firsts.push(acc);
    acc += folder.numPackStreams;
  }
  if (acc > streams.packSizes.length) {
    throw new Error(ERR_CORRUPT);
  }
  return firsts;
}

function decodeAllFolders(
  archive: Uint8Array,
  streams: StreamsInfo,
  budget: DecodeBudget
): Uint8Array {
  const packOffsets = computePackOffsets(streams, archive.length);
  const firsts = firstPackPerFolder(streams);
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let f = 0; f < streams.folders.length; f++) {
    const part = decodeFolder(
      archive,
      packOffsets,
      streams.packSizes,
      firsts[f],
      streams.folders[f],
      budget
    );
    parts.push(part);
    total += part.length;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  const joined = new Uint8Array(total);
  let off = 0;
  for (const part of parts) {
    joined.set(part, off);
    off += part.length;
  }
  return joined;
}

function parseHeaderBlock(
  archive: Uint8Array,
  headerBytes: Uint8Array,
  depth: number,
  budget: DecodeBudget
): ParsedHeader {
  if (depth > MAX_HEADER_DEPTH) {
    throw new Error(ERR_CORRUPT);
  }
  const r = new ByteReader(headerBytes);
  let id = r.readNumber();
  if (id === K_ENCODED_HEADER) {
    const streams = parseStreamsInfo(r);
    // The real header is the decoded content of these folder(s). If the
    // header itself uses an unsupported codec there is nothing we can list.
    const decoded = decodeAllFolders(archive, streams, budget);
    return parseHeaderBlock(archive, decoded, depth + 1, budget);
  }
  if (id !== K_HEADER) {
    throw new Error(ERR_CORRUPT);
  }
  let streams: StreamsInfo | null = null;
  let files: FilesInfo | null = null;
  id = r.readNumber();
  if (id === K_ARCHIVE_PROPERTIES) {
    for (;;) {
      const propId = r.readNumber();
      if (propId === K_END) {
        break;
      }
      const size = r.readNumber();
      r.skip(size);
    }
    id = r.readNumber();
  }
  if (id === K_ADDITIONAL_STREAMS) {
    // Parse to advance the reader correctly, then ignore.
    parseStreamsInfo(r);
    id = r.readNumber();
  }
  if (id === K_MAIN_STREAMS) {
    streams = parseStreamsInfo(r);
    id = r.readNumber();
  }
  if (id === K_FILES_INFO) {
    files = parseFilesInfo(r);
    id = r.readNumber();
  }
  if (id !== K_END) {
    throw new Error(ERR_CORRUPT);
  }
  return { streams, files };
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------
function readUInt64LESafe(data: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 7; i >= 0; i--) {
    value = value * 256 + data[offset + i];
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(ERR_TOO_BIG);
  }
  return value;
}

function readUInt32LEAt(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

/**
 * Parse a .7z archive and extract its entries.
 *
 * Directories and anti-files are skipped. Entries whose folder uses an
 * unsupported codec are listed with bytes = null and a French note.
 */
export function parseSevenZip(data: Uint8Array): SevenZipEntry[] {
  if (data.length < 32) {
    throw new Error(ERR_NOT_7Z);
  }
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (data[i] !== SIGNATURE[i]) {
      throw new Error(ERR_NOT_7Z);
    }
  }
  // data[6] = major version, data[7] = minor version (0.x for all known 7z).
  const startHeaderCRC = readUInt32LEAt(data, 8);
  if (crc32(data.subarray(12, 32)) !== startHeaderCRC) {
    throw new Error(ERR_CORRUPT);
  }
  const nextHeaderOffset = readUInt64LESafe(data, 12);
  const nextHeaderSize = readUInt64LESafe(data, 20);
  const nextHeaderCRC = readUInt32LEAt(data, 28);
  if (nextHeaderSize === 0) {
    return []; // empty archive
  }
  const headerStart = 32 + nextHeaderOffset;
  if (
    headerStart + nextHeaderSize > data.length ||
    !Number.isSafeInteger(headerStart + nextHeaderSize)
  ) {
    throw new Error(ERR_CORRUPT);
  }
  const headerBytes = data.subarray(headerStart, headerStart + nextHeaderSize);
  if (crc32(headerBytes) !== nextHeaderCRC) {
    throw new Error(ERR_CORRUPT);
  }

  const budget: DecodeBudget = { used: 0 };
  const header = parseHeaderBlock(data, headerBytes, 0, budget);
  const files = header.files;
  if (files === null) {
    return [];
  }
  const streams = header.streams;
  const packOffsets = streams !== null ? computePackOffsets(streams, data.length) : [];
  const firsts = streams !== null ? firstPackPerFolder(streams) : [];

  const entries: SevenZipEntry[] = [];
  let emptyIdx = 0;
  // Cursor over the substreams (files consume them in order).
  let folderIdx = 0;
  let subIdx = 0;
  let folderOffset = 0;
  let folderLoaded = false;
  let folderData: Uint8Array | null = null;
  let folderNote: string | undefined;

  for (let i = 0; i < files.count; i++) {
    const path = files.names[i];
    if (files.emptyStream[i]) {
      const isEmptyFile = emptyIdx < files.emptyFile.length ? files.emptyFile[emptyIdx] : false;
      const isAnti = emptyIdx < files.anti.length ? files.anti[emptyIdx] : false;
      emptyIdx++;
      if (isAnti) {
        continue; // anti-file (incremental delete marker)
      }
      if (isEmptyFile) {
        entries.push({ path, size: 0, bytes: new Uint8Array(0) });
      }
      // Empty stream without the empty-file bit = directory: skip.
      continue;
    }
    if (streams === null) {
      throw new Error(ERR_CORRUPT);
    }
    while (folderIdx < streams.folders.length && subIdx >= streams.numUnpackStreams[folderIdx]) {
      folderIdx++;
      subIdx = 0;
      folderOffset = 0;
      folderLoaded = false;
    }
    if (folderIdx >= streams.folders.length) {
      throw new Error(ERR_CORRUPT);
    }
    if (!folderLoaded) {
      folderLoaded = true;
      folderNote = undefined;
      try {
        folderData = decodeFolder(
          data,
          packOffsets,
          streams.packSizes,
          firsts[folderIdx],
          streams.folders[folderIdx],
          budget
        );
      } catch (err) {
        if (isUnsupportedCodec(err)) {
          // Graceful per-folder degradation: keep listing, no bytes.
          folderData = null;
          folderNote = err.message;
        } else {
          throw err;
        }
      }
    }
    const size = streams.substreamSizes[folderIdx][subIdx];
    const crc = streams.substreamCRCs[folderIdx][subIdx];
    let bytes: Uint8Array | null = null;
    let note = folderNote;
    if (folderData !== null) {
      if (folderOffset + size > folderData.length) {
        throw new Error(ERR_CORRUPT);
      }
      bytes = folderData.subarray(folderOffset, folderOffset + size);
      if (crc !== null && crc !== undefined && crc32(bytes) !== crc) {
        note = NOTE_BAD_CRC;
      }
    }
    const entry: SevenZipEntry = { path, size, bytes };
    if (note !== undefined) {
      entry.note = note;
    }
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      throw new Error(ERR_TOO_BIG);
    }
    folderOffset += size;
    subIdx++;
  }
  return entries;
}
