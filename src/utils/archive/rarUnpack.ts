/**
 * RAR5 decompression (custom, pure JS).
 *
 * From-scratch port of the RAR 5.0 unpack algorithm (unrar Unpack::Unpack5
 * semantics): LZSS over a sliding dictionary with 5 Huffman tables per block
 * (main / distance / low-distance / rep-length / bit-length) and optional
 * per-block filters (delta, x86 e8, x86 e8e9, ARM). RAR5 has no PPMd and no
 * RarVM. Methods 1-5, non-solid, single-file window: since the unpacked size
 * is known and solid streams are excluded, we decode straight into the full
 * output buffer (no circular window); the dictionary size only caps match
 * distances.
 *
 * Pure JavaScript / TypeScript: no WASM, no eval, no workers, no DOM. The
 * renderer CSP blocks all WebAssembly, which is why this is hand-written.
 *
 * rar.ts calls unpackRar5() inside a try/catch, so a thrown Error never
 * breaks the app. User-facing error messages are in French.
 */

export const RAR5_UNPACK_IMPLEMENTED = true;

/* ------------------------------------------------------------------ */
/* Constants (unrar compress.hpp, RAR 5.0 alphabet sizes)              */
/* ------------------------------------------------------------------ */

const NC = 306; // main alphabet
const DC = 64; // distance slots
const LDC = 16; // low distance (4 bits aligned)
const RC = 44; // rep-length slots
const BC = 20; // bit-length table size
const HUFF_TABLE_SIZE = NC + DC + LDC + RC; // 430

const FILTER_DELTA = 0;
const FILTER_E8 = 1;
const FILTER_E8E9 = 2;
const FILTER_ARM = 3;

const MAX_FILTER_BLOCK_SIZE = 0x400000; // 4 MiB, as in unrar
const MAX_FILTERS = 1 << 20; // safety cap against filter-record bombs

// Mandatory safety caps.
const MAX_UNPACKED_SIZE = 1024 * 1024 * 1024; // 1 GiB
const MAX_DICT_SIZE = 512 * 1024 * 1024; // 512 MiB

const ERR_TOO_BIG = 'Archive trop volumineuse pour un apercu';
const ERR_CORRUPT = 'Archive RAR corrompue ou tronquee - apercu impossible';

/* ------------------------------------------------------------------ */
/* Bit reader (unrar getbits.hpp semantics: MSB-first within bytes)    */
/* ------------------------------------------------------------------ */

interface BitReader {
  /** Packed data padded with 8 trailing zero bytes. */
  buf: Uint8Array;
  /** Real (unpadded) length of the packed data. */
  len: number;
  /** Current byte offset. */
  addr: number;
  /** Current bit offset within buf[addr] (0..7). */
  bit: number;
}

function makeBitReader(src: Uint8Array): BitReader {
  const buf = new Uint8Array(src.length + 8);
  buf.set(src);
  return { buf, len: src.length, addr: 0, bit: 0 };
}

/** 16 bits left-aligned in a 16-bit field, without consuming. */
function getbits(br: BitReader): number {
  const b = br.buf;
  const a = br.addr;
  const field = ((b[a] << 16) | (b[a + 1] << 8) | b[a + 2]) >>> (8 - br.bit);
  return field & 0xffff;
}

/** 32 bits left-aligned, without consuming. Unsigned. */
function getbits32(br: BitReader): number {
  const b = br.buf;
  const a = br.addr;
  let field = ((b[a] << 24) | (b[a + 1] << 16) | (b[a + 2] << 8) | b[a + 3]) >>> 0;
  if (br.bit !== 0) {
    field = ((field << br.bit) | (b[a + 4] >>> (8 - br.bit))) >>> 0;
  }
  return field;
}

/** Consume n bits; throws (never hangs) on any read past the real end. */
function addbits(br: BitReader, n: number): void {
  const bits = br.bit + n;
  br.addr += bits >>> 3;
  br.bit = bits & 7;
  if (br.addr > br.len) {
    throw new Error(ERR_CORRUPT);
  }
}

/** Align to the next byte boundary (unrar faddbits((8-InBit)&7)). */
function alignByte(br: BitReader): void {
  if (br.bit !== 0) {
    addbits(br, 8 - br.bit);
  }
}

/* ------------------------------------------------------------------ */
/* Huffman decode tables (unrar MakeDecodeTables / DecodeNumber)       */
/* ------------------------------------------------------------------ */

interface DecodeTable {
  decodeLen: Uint32Array; // 16 entries: left-aligned upper-limit code per bit length
  decodePos: Uint32Array; // 16 entries: start position in code list per bit length
  decodeNum: Uint16Array; // code-list position -> alphabet symbol
  maxNum: number;
}

function makeDecodeTable(lengthTable: Uint8Array, offset: number, size: number): DecodeTable {
  const decodeLen = new Uint32Array(16);
  const decodePos = new Uint32Array(16);
  const decodeNum = new Uint16Array(size);

  const lengthCount = new Uint32Array(16);
  for (let i = 0; i < size; i++) {
    lengthCount[lengthTable[offset + i] & 0xf]++;
  }
  lengthCount[0] = 0;

  let upperLimit = 0;
  for (let i = 1; i < 16; i++) {
    upperLimit += lengthCount[i];
    const leftAligned = (upperLimit << (16 - i)) >>> 0;
    upperLimit *= 2;
    decodeLen[i] = leftAligned;
    decodePos[i] = decodePos[i - 1] + lengthCount[i - 1];
  }

  const copyDecodePos = decodePos.slice();
  for (let i = 0; i < size; i++) {
    const curBitLength = lengthTable[offset + i] & 0xf;
    if (curBitLength !== 0) {
      decodeNum[copyDecodePos[curBitLength]] = i;
      copyDecodePos[curBitLength]++;
    }
  }

  return { decodeLen, decodePos, decodeNum, maxNum: size };
}

function decodeNumber(br: BitReader, table: DecodeTable): number {
  const bitField = getbits(br) & 0xfffe;

  let bits = 15;
  const decodeLen = table.decodeLen;
  for (let i = 1; i < 15; i++) {
    if (bitField < decodeLen[i]) {
      bits = i;
      break;
    }
  }
  addbits(br, bits);

  const dist = (bitField - decodeLen[bits - 1]) >>> (16 - bits);
  let pos = table.decodePos[bits] + dist;
  if (pos >= table.maxNum) {
    pos = 0;
  }
  return table.decodeNum[pos];
}

/* ------------------------------------------------------------------ */
/* Block headers and Huffman table descriptions                        */
/* ------------------------------------------------------------------ */

interface BlockHeader {
  blockSize: number;
  blockStart: number;
  blockBitSize: number; // valid bits in the last byte of the block (1..8)
  lastBlock: boolean;
  tablePresent: boolean;
}

interface BlockTables {
  ld: DecodeTable; // literal / main
  dd: DecodeTable; // distance
  ldd: DecodeTable; // low distance
  rd: DecodeTable; // rep length
  bd: DecodeTable; // bit lengths (used only while reading tables)
}

function readBlockHeader(br: BitReader): BlockHeader {
  alignByte(br);

  const blockFlags = getbits(br) >>> 8;
  addbits(br, 8);
  const byteCount = ((blockFlags >>> 3) & 3) + 1;
  if (byteCount === 4) {
    throw new Error(ERR_CORRUPT);
  }

  const savedCheckSum = getbits(br) >>> 8;
  addbits(br, 8);

  let blockSize = 0;
  for (let i = 0; i < byteCount; i++) {
    blockSize += (getbits(br) >>> 8) << (i * 8);
    addbits(br, 8);
  }

  const checkSum = (0x5a ^ blockFlags ^ blockSize ^ (blockSize >>> 8) ^ (blockSize >>> 16)) & 0xff;
  if (checkSum !== savedCheckSum) {
    throw new Error(ERR_CORRUPT);
  }

  // The whole packed stream is in memory, so a block whose declared extent
  // exceeds the real data is truncated: detect it now instead of decoding
  // garbage from the zero padding.
  if (br.addr + blockSize > br.len) {
    throw new Error(ERR_CORRUPT);
  }

  return {
    blockSize,
    blockStart: br.addr,
    blockBitSize: (blockFlags & 7) + 1,
    lastBlock: (blockFlags & 0x40) !== 0,
    tablePresent: (blockFlags & 0x80) !== 0,
  };
}

function readTables(br: BitReader): BlockTables {
  // 20 x 4-bit lengths (with 15 + zero-run escape) for the BD table.
  const bitLength = new Uint8Array(BC);
  for (let i = 0; i < BC; i++) {
    const length = getbits(br) >>> 12;
    addbits(br, 4);
    if (length === 15) {
      let zeroCount = getbits(br) >>> 12;
      addbits(br, 4);
      if (zeroCount === 0) {
        bitLength[i] = 15;
      } else {
        zeroCount += 2;
        while (zeroCount-- > 0 && i < BC) {
          bitLength[i++] = 0;
        }
        i--;
      }
    } else {
      bitLength[i] = length;
    }
  }

  const bd = makeDecodeTable(bitLength, 0, BC);

  // Run-length-coded code lengths for LD/DD/LDD/RD in one sequential stream.
  const table = new Uint8Array(HUFF_TABLE_SIZE);
  for (let i = 0; i < HUFF_TABLE_SIZE; ) {
    const num = decodeNumber(br, bd);
    if (num < 16) {
      table[i] = num;
      i++;
    } else if (num < 18) {
      // 16 / 17: repeat the previous length.
      let n: number;
      if (num === 16) {
        n = (getbits(br) >>> 13) + 3;
        addbits(br, 3);
      } else {
        n = (getbits(br) >>> 9) + 11;
        addbits(br, 7);
      }
      if (i === 0) {
        // "Repeat previous" cannot be the first code.
        throw new Error(ERR_CORRUPT);
      }
      while (n-- > 0 && i < HUFF_TABLE_SIZE) {
        table[i] = table[i - 1];
        i++;
      }
    } else {
      // 18 / 19: run of zeros.
      let n: number;
      if (num === 18) {
        n = (getbits(br) >>> 13) + 3;
        addbits(br, 3);
      } else {
        n = (getbits(br) >>> 9) + 11;
        addbits(br, 7);
      }
      while (n-- > 0 && i < HUFF_TABLE_SIZE) {
        table[i++] = 0;
      }
    }
  }

  return {
    ld: makeDecodeTable(table, 0, NC),
    dd: makeDecodeTable(table, NC, DC),
    ldd: makeDecodeTable(table, NC + DC, LDC),
    rd: makeDecodeTable(table, NC + DC + LDC, RC),
    bd,
  };
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

interface UnpackFilter {
  start: number; // absolute position in the output buffer
  length: number;
  type: number;
  channels: number;
}

/** unrar ReadFilterData: 2-bit byte-count-1, then LE bytes from the bitstream. */
function readFilterData(br: BitReader): number {
  const byteCount = (getbits(br) >>> 14) + 1;
  addbits(br, 2);
  let data = 0;
  for (let i = 0; i < byteCount; i++) {
    data += (getbits(br) >>> 8) * Math.pow(2, i * 8);
    addbits(br, 8);
  }
  return data;
}

function readFilter(br: BitReader, outPos: number): UnpackFilter {
  const blockStart = readFilterData(br);
  let blockLength = readFilterData(br);
  if (blockLength > MAX_FILTER_BLOCK_SIZE) {
    blockLength = 0; // invalid filter, as in unrar
  }
  const type = getbits(br) >>> 13;
  addbits(br, 3);
  let channels = 0;
  if (type === FILTER_DELTA) {
    channels = (getbits(br) >>> 11) + 1;
    addbits(br, 5);
  }
  return { start: outPos + blockStart, length: blockLength, type, channels };
}

function readU32LE(buf: Uint8Array, pos: number): number {
  return (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
}

function writeU32LE(buf: Uint8Array, pos: number, value: number): void {
  buf[pos] = value & 0xff;
  buf[pos + 1] = (value >>> 8) & 0xff;
  buf[pos + 2] = (value >>> 16) & 0xff;
  buf[pos + 3] = (value >>> 24) & 0xff;
}

/**
 * x86 e8 / e8e9 call filter: relative-to-absolute call address conversion.
 * fileOffset is the absolute output position of the filter block start
 * (unrar WrittenFileSize at apply time).
 */
function applyFilterE8(
  out: Uint8Array,
  start: number,
  length: number,
  fileOffset: number,
  e9Too: boolean
): void {
  const fileSize = 0x1000000;
  const cmpByte2 = e9Too ? 0xe9 : 0xe8;
  let curPos = 0;
  while (curPos + 4 < length) {
    const curByte = out[start + curPos];
    curPos++;
    if (curByte === 0xe8 || curByte === cmpByte2) {
      const offset = (curPos + fileOffset) % fileSize;
      const addr = readU32LE(out, start + curPos);
      if ((addr & 0x80000000) !== 0) {
        // addr < 0
        if (((addr + offset) & 0x80000000) === 0) {
          // addr + offset >= 0
          writeU32LE(out, start + curPos, addr + fileSize);
        }
      } else if (((addr - fileSize) & 0x80000000) !== 0) {
        // addr < fileSize
        writeU32LE(out, start + curPos, addr - offset);
      }
      curPos += 4;
    }
  }
}

/** ARM BL relative-to-absolute conversion. */
function applyFilterArm(out: Uint8Array, start: number, length: number, fileOffset: number): void {
  for (let curPos = 0; curPos + 3 < length; curPos += 4) {
    const p = start + curPos;
    if (out[p + 3] === 0xeb) {
      let offset = out[p] + out[p + 1] * 0x100 + out[p + 2] * 0x10000;
      offset -= Math.floor((fileOffset + curPos) / 4);
      out[p] = offset & 0xff;
      out[p + 1] = (offset >> 8) & 0xff;
      out[p + 2] = (offset >> 16) & 0xff;
    }
  }
}

/** Delta filter: de-interleave grouped channels back and undo byte deltas. */
function applyFilterDelta(out: Uint8Array, start: number, length: number, channels: number): void {
  const dst = new Uint8Array(length);
  let srcPos = 0;
  for (let ch = 0; ch < channels; ch++) {
    let prevByte = 0;
    for (let destPos = ch; destPos < length; destPos += channels) {
      prevByte = (prevByte - out[start + srcPos++]) & 0xff;
      dst[destPos] = prevByte;
    }
  }
  out.set(dst, start);
}

/* ------------------------------------------------------------------ */
/* Length / distance decoding helpers                                  */
/* ------------------------------------------------------------------ */

/** unrar SlotToLength. */
function slotToLength(br: BitReader, slot: number): number {
  let lBits: number;
  let length = 2;
  if (slot < 8) {
    lBits = 0;
    length += slot;
  } else {
    lBits = (slot >>> 2) - 1;
    length += (4 | (slot & 3)) << lBits;
  }
  if (lBits > 0) {
    length += getbits(br) >>> (16 - lBits);
    addbits(br, lBits);
  }
  return length;
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

/**
 * Decompress a RAR5 (algorithm version 0) packed stream.
 *
 * @param src          Packed data of the file (data area of the file block).
 * @param unpackedSize Exact declared unpacked size.
 * @param dictSize     Dictionary size declared in the file header (caps match
 *                     distances; with a non-solid single-file window, matches
 *                     reaching before position 0 are corrupt anyway).
 */
export function unpackRar5(src: Uint8Array, unpackedSize: number, dictSize: number): Uint8Array {
  if (!Number.isFinite(unpackedSize) || unpackedSize < 0 || unpackedSize > MAX_UNPACKED_SIZE) {
    throw new Error(ERR_TOO_BIG);
  }
  if (!Number.isFinite(dictSize) || dictSize < 0 || dictSize > MAX_DICT_SIZE) {
    throw new Error(ERR_TOO_BIG);
  }

  const out = new Uint8Array(unpackedSize);
  if (unpackedSize === 0) {
    return out;
  }

  const br = makeBitReader(src);
  const maxDist = dictSize > 0 ? dictSize : MAX_DICT_SIZE;

  // unrar UnpInitData(false): rep distances and last length start at zero.
  const oldDist = [0, 0, 0, 0];
  let lastLength = 0;
  let outPos = 0;

  const filters: UnpackFilter[] = [];

  // First block must carry Huffman tables (unrar TablesRead5 check).
  let header = readBlockHeader(br);
  if (!header.tablePresent) {
    throw new Error(ERR_CORRUPT);
  }
  let tables = readTables(br);

  mainLoop: while (outPos < unpackedSize) {
    // Block end: valid data ends at bit blockBitSize of the last block byte.
    // 'while' because an empty block containing only a Huffman table puts us
    // on the next block border immediately.
    while (
      br.addr > header.blockStart + header.blockSize - 1 ||
      (br.addr === header.blockStart + header.blockSize - 1 && br.bit >= header.blockBitSize)
    ) {
      if (header.lastBlock) {
        break mainLoop;
      }
      header = readBlockHeader(br);
      if (header.tablePresent) {
        tables = readTables(br);
      }
    }

    const mainSlot = decodeNumber(br, tables.ld);

    if (mainSlot < 256) {
      out[outPos++] = mainSlot;
      continue;
    }

    if (mainSlot >= 262) {
      let length = slotToLength(br, mainSlot - 262);

      let distance = 1;
      let dBits: number;
      const distSlot = decodeNumber(br, tables.dd);
      if (distSlot < 4) {
        dBits = 0;
        distance += distSlot;
      } else {
        dBits = (distSlot >>> 1) - 1;
        distance += (2 | (distSlot & 1)) * Math.pow(2, dBits);
      }

      if (dBits > 0) {
        if (dBits >= 4) {
          if (dBits > 4) {
            distance += (getbits32(br) >>> (36 - dBits)) * 16;
            addbits(br, dBits - 4);
          }
          const lowDist = decodeNumber(br, tables.ldd);
          distance += lowDist;
        } else {
          distance += getbits32(br) >>> (32 - dBits);
          addbits(br, dBits);
        }
      }

      if (distance > 0x100) {
        length++;
        if (distance > 0x2000) {
          length++;
          if (distance > 0x40000) {
            length++;
          }
        }
      }

      oldDist[3] = oldDist[2];
      oldDist[2] = oldDist[1];
      oldDist[1] = oldDist[0];
      oldDist[0] = distance;
      lastLength = length;

      outPos = copyString(out, outPos, unpackedSize, distance, length, maxDist);
      continue;
    }

    if (mainSlot === 256) {
      // Filter record follows.
      if (filters.length >= MAX_FILTERS) {
        throw new Error(ERR_CORRUPT);
      }
      const filter = readFilter(br, outPos);
      if (filter.length > 0) {
        filters.push(filter);
      }
      continue;
    }

    if (mainSlot === 257) {
      // Repeat last match.
      if (lastLength !== 0) {
        outPos = copyString(out, outPos, unpackedSize, oldDist[0], lastLength, maxDist);
      }
      continue;
    }

    // 258..261: rep distances 0-3 with a new length from the RC table.
    const distNum = mainSlot - 258;
    const distance = oldDist[distNum];
    for (let i = distNum; i > 0; i--) {
      oldDist[i] = oldDist[i - 1];
    }
    oldDist[0] = distance;

    const lengthSlot = decodeNumber(br, tables.rd);
    const length = slotToLength(br, lengthSlot);
    lastLength = length;

    outPos = copyString(out, outPos, unpackedSize, distance, length, maxDist);
  }

  if (outPos < unpackedSize) {
    // Stream ended (last block exhausted) before producing all declared bytes.
    throw new Error(ERR_CORRUPT);
  }

  // Consistency: RAR5 block sizes are bit-exact (blockBitSize gives the valid
  // bits of the last block byte), so a well-formed stream completes its output
  // exactly at the declared bit end of the current block. Anything else means
  // the tail of the stream was corrupt and the last symbols decoded garbage.
  const consumedBits = (br.addr - header.blockStart) * 8 + br.bit;
  const blockBits = (header.blockSize - 1) * 8 + header.blockBitSize;
  if (consumedBits !== blockBits) {
    throw new Error(ERR_CORRUPT);
  }

  // Apply filters in order to the fully decoded (unfiltered) buffer. In unrar
  // the window keeps unfiltered data for future matches and filters are
  // applied at write time; with a flat single-file buffer this is equivalent
  // to applying them once decoding is complete. WrittenFileSize at apply time
  // equals the absolute block start.
  let writtenBorder = 0;
  for (const filter of filters) {
    if (filter.start < writtenBorder || filter.start + filter.length > unpackedSize) {
      continue; // out-of-order or incomplete block: never applied by unrar either
    }
    switch (filter.type) {
      case FILTER_DELTA:
        applyFilterDelta(out, filter.start, filter.length, filter.channels);
        break;
      case FILTER_E8:
        applyFilterE8(out, filter.start, filter.length, filter.start, false);
        break;
      case FILTER_E8E9:
        applyFilterE8(out, filter.start, filter.length, filter.start, true);
        break;
      case FILTER_ARM:
        applyFilterArm(out, filter.start, filter.length, filter.start);
        break;
      default:
        break; // unknown filter type: data stays unfiltered
    }
    writtenBorder = filter.start + filter.length;
  }

  return out;
}

/**
 * Copy an LZ match. Byte-by-byte to handle overlapping copies; clamps at the
 * declared output size (a well-formed stream ends exactly at unpackedSize).
 */
function copyString(
  out: Uint8Array,
  outPos: number,
  unpackedSize: number,
  distance: number,
  length: number,
  maxDist: number
): number {
  if (distance > outPos || distance > maxDist || distance <= 0) {
    throw new Error(ERR_CORRUPT);
  }
  let src = outPos - distance;
  let dest = outPos;
  let n = length;
  if (dest + n > unpackedSize) {
    n = unpackedSize - dest;
  }
  while (n-- > 0) {
    out[dest++] = out[src++];
  }
  return dest;
}
