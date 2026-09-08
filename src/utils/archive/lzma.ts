/**
 * Pure-JS LZMA1 + LZMA2 decoders (decompression only).
 *
 * The renderer CSP blocks all WebAssembly, so this is a hand-written
 * TypeScript port of Igor Pavlov's reference LZMA decoder (LzmaSpec.cpp,
 * public domain). Node-compatible pure functions: no DOM, no workers.
 *
 * Simplification used throughout: the caller always knows the exact
 * uncompressed size, so the output buffer itself is used as the LZ77
 * dictionary window (no circular buffer). Matches copy from
 * out[pos - dist - 1]. A dictionary reset only moves the logical start of
 * the window (dictStart); valid streams never reference data before it.
 *
 * User-facing errors thrown from here are in French (parser rule).
 */

// ---------------------------------------------------------------------------
// Safety caps: malformed input must never hang the UI or exhaust memory.
// ---------------------------------------------------------------------------
const MAX_OUTPUT = 1024 * 1024 * 1024; // 1 GiB
const MAX_DICT = 512 * 1024 * 1024; // 512 MiB declared dictionary

const ERR_CORRUPT = 'Archive corrompue ou tronquee - apercu impossible';
const ERR_TOO_BIG = 'Archive trop volumineuse pour un apercu';

const PROB_INIT = 1024; // 2048 / 2 (11-bit probabilities)
const NUM_STATES = 12;
const MATCH_MIN_LEN = 2;
const END_MARKER_DIST = 0xffffffff;

const EMPTY_BYTES = new Uint8Array(0);

/**
 * Stateful LZMA decoder. Kept as a class so LZMA2 can preserve probability
 * arrays, LZ state and window position across chunks (reset mode 0), while
 * re-initializing the range coder for every chunk.
 */
class LzmaDecoder {
  readonly out: Uint8Array;

  outPos = 0;

  /** Logical start of the dictionary window (moved by dict resets). */
  private dictStart = 0;

  // Literal coder parameters.
  private lc = 0;
  private lp = 0;
  private pb = 0;

  // Probability arrays (11-bit models, init 1024).
  private readonly isMatch = new Uint16Array(NUM_STATES << 4);
  private readonly isRep = new Uint16Array(NUM_STATES);
  private readonly isRepG0 = new Uint16Array(NUM_STATES);
  private readonly isRepG1 = new Uint16Array(NUM_STATES);
  private readonly isRepG2 = new Uint16Array(NUM_STATES);
  private readonly isRep0Long = new Uint16Array(NUM_STATES << 4);
  private readonly posSlot = new Uint16Array(4 << 6); // 4 length classes x 64
  private readonly specPos = new Uint16Array(115);
  private readonly align = new Uint16Array(16);
  // Match-length coder: [choice, choice2] + low[16][8] + mid[16][8] + high[256]
  private readonly lenChoice = new Uint16Array(2);
  private readonly lenLow = new Uint16Array(16 << 3);
  private readonly lenMid = new Uint16Array(16 << 3);
  private readonly lenHigh = new Uint16Array(256);
  // Rep-match length coder.
  private readonly repLenChoice = new Uint16Array(2);
  private readonly repLenLow = new Uint16Array(16 << 3);
  private readonly repLenMid = new Uint16Array(16 << 3);
  private readonly repLenHigh = new Uint16Array(256);
  // Literal probabilities: 0x300 << (lc + lp) entries.
  private lit = new Uint16Array(0x300);

  // LZ state.
  private state = 0;
  private rep0 = 0;
  private rep1 = 0;
  private rep2 = 0;
  private rep3 = 0;

  // Range decoder.
  private src: Uint8Array = EMPTY_BYTES;
  private srcPos = 0;
  private srcEnd = 0;
  private range = 0;
  private code = 0;

  constructor(outSize: number) {
    if (!Number.isSafeInteger(outSize) || outSize < 0 || outSize > MAX_OUTPUT) {
      throw new Error(ERR_TOO_BIG);
    }
    this.out = new Uint8Array(outSize);
  }

  /** Set lc/lp/pb from the packed properties byte d = (pb*5 + lp)*9 + lc. */
  setProps(d: number): void {
    if (d >= 9 * 5 * 5) {
      throw new Error(ERR_CORRUPT);
    }
    const lc = d % 9;
    const rest = (d / 9) | 0;
    const lp = rest % 5;
    const pb = (rest / 5) | 0;
    if (pb > 4) {
      throw new Error(ERR_CORRUPT);
    }
    this.lc = lc;
    this.lp = lp;
    this.pb = pb;
    const size = 0x300 << (lc + lp);
    if (this.lit.length !== size) {
      this.lit = new Uint16Array(size);
    }
  }

  /** Reset probability models, state and rep distances. */
  resetState(): void {
    this.isMatch.fill(PROB_INIT);
    this.isRep.fill(PROB_INIT);
    this.isRepG0.fill(PROB_INIT);
    this.isRepG1.fill(PROB_INIT);
    this.isRepG2.fill(PROB_INIT);
    this.isRep0Long.fill(PROB_INIT);
    this.posSlot.fill(PROB_INIT);
    this.specPos.fill(PROB_INIT);
    this.align.fill(PROB_INIT);
    this.lenChoice.fill(PROB_INIT);
    this.lenLow.fill(PROB_INIT);
    this.lenMid.fill(PROB_INIT);
    this.lenHigh.fill(PROB_INIT);
    this.repLenChoice.fill(PROB_INIT);
    this.repLenLow.fill(PROB_INIT);
    this.repLenMid.fill(PROB_INIT);
    this.repLenHigh.fill(PROB_INIT);
    this.lit.fill(PROB_INIT);
    this.state = 0;
    this.rep0 = 0;
    this.rep1 = 0;
    this.rep2 = 0;
    this.rep3 = 0;
  }

  /** Dictionary reset: the window logically restarts at the current position. */
  resetDict(): void {
    this.dictStart = this.outPos;
  }

  /**
   * Initialize the range coder from src[pos..end). Consumes 5 bytes:
   * a mandatory 0x00 then 4 big-endian code bytes.
   */
  rcInit(src: Uint8Array, pos: number, end: number): void {
    if (pos + 5 > end || end > src.length) {
      throw new Error(ERR_CORRUPT);
    }
    if (src[pos] !== 0) {
      throw new Error(ERR_CORRUPT);
    }
    this.src = src;
    this.srcEnd = end;
    this.code =
      ((src[pos + 1] << 24) | (src[pos + 2] << 16) | (src[pos + 3] << 8) | src[pos + 4]) >>> 0;
    this.range = 0xffffffff;
    this.srcPos = pos + 5;
  }

  private nextByte(): number {
    if (this.srcPos >= this.srcEnd) {
      throw new Error(ERR_CORRUPT);
    }
    return this.src[this.srcPos++];
  }

  private decodeBit(probs: Uint16Array, index: number): number {
    const prob = probs[index];
    // range >>> 11 <= 0x1FFFFF and prob < 2048, so bound < 2^32 (exact as float).
    const bound = (this.range >>> 11) * prob;
    let bit: number;
    if (this.code < bound) {
      this.range = bound >>> 0;
      probs[index] = prob + ((2048 - prob) >> 5);
      bit = 0;
    } else {
      this.code = (this.code - bound) >>> 0;
      this.range = (this.range - bound) >>> 0;
      probs[index] = prob - (prob >> 5);
      bit = 1;
    }
    if (this.range < 0x1000000) {
      this.range = (this.range * 256) >>> 0;
      this.code = ((this.code << 8) | this.nextByte()) >>> 0;
    }
    return bit;
  }

  private decodeDirectBits(numBits: number): number {
    let res = 0;
    let n = numBits;
    do {
      this.range = this.range >>> 1;
      this.code = (this.code - this.range) >>> 0;
      // After the subtraction, range < 2^31, so the top bit of code is set
      // if and only if the subtraction borrowed (bit value 0).
      let bit = 1;
      if (this.code >>> 31 !== 0) {
        this.code = (this.code + this.range) >>> 0;
        bit = 0;
      }
      if (this.range < 0x1000000) {
        this.range = (this.range * 256) >>> 0;
        this.code = ((this.code << 8) | this.nextByte()) >>> 0;
      }
      res = res * 2 + bit;
    } while (--n !== 0);
    return res;
  }

  private bitTree(probs: Uint16Array, offset: number, numBits: number): number {
    let m = 1;
    for (let i = 0; i < numBits; i++) {
      m = (m << 1) | this.decodeBit(probs, offset + m);
    }
    return m - (1 << numBits);
  }

  private bitTreeReverse(probs: Uint16Array, offset: number, numBits: number): number {
    let m = 1;
    let symbol = 0;
    for (let i = 0; i < numBits; i++) {
      const bit = this.decodeBit(probs, offset + m);
      m = (m << 1) | bit;
      symbol |= bit << i;
    }
    return symbol;
  }

  /** Returns the raw length (0-based; real length = value + MATCH_MIN_LEN). */
  private decodeLen(
    choice: Uint16Array,
    low: Uint16Array,
    mid: Uint16Array,
    high: Uint16Array,
    posState: number
  ): number {
    if (this.decodeBit(choice, 0) === 0) {
      return this.bitTree(low, posState << 3, 3);
    }
    if (this.decodeBit(choice, 1) === 0) {
      return 8 + this.bitTree(mid, posState << 3, 3);
    }
    return 16 + this.bitTree(high, 0, 8);
  }

  /** Returns dist (real distance = dist + 1); 0xFFFFFFFF is the end marker. */
  private decodeDistance(len: number): number {
    const lenState = len < 4 ? len : 3;
    const posSlot = this.bitTree(this.posSlot, lenState << 6, 6);
    if (posSlot < 4) {
      return posSlot;
    }
    const numDirect = (posSlot >> 1) - 1;
    if (posSlot < 14) {
      const base = (2 | (posSlot & 1)) << numDirect;
      return base + this.bitTreeReverse(this.specPos, base - posSlot, numDirect);
    }
    // posSlot >= 14: distances can exceed 2^31, keep them as exact floats.
    const base = (2 + (posSlot & 1)) * Math.pow(2, numDirect);
    const direct = this.decodeDirectBits(numDirect - 4);
    return base + direct * 16 + this.bitTreeReverse(this.align, 0, 4);
  }

  /**
   * Decode until outPos reaches `limit` (absolute position in `out`).
   * Returns true if the 0xFFFFFFFF end marker was encountered (in which case
   * outPos may be short of limit). Every loop iteration writes at least one
   * byte or terminates, so malformed input can never hang.
   */
  decode(limit: number): boolean {
    const out = this.out;
    const pbMask = (1 << this.pb) - 1;
    const lpMask = (1 << this.lp) - 1;
    while (this.outPos < limit) {
      const processed = this.outPos - this.dictStart;
      const posState = processed & pbMask;
      if (this.decodeBit(this.isMatch, (this.state << 4) + posState) === 0) {
        // Literal.
        const prevByte = processed === 0 ? 0 : out[this.outPos - 1];
        const litState = ((processed & lpMask) << this.lc) + (prevByte >>> (8 - this.lc));
        const probs = this.lit;
        const base = 0x300 * litState;
        let symbol = 1;
        if (this.state >= 7) {
          // Matched literal: state >= 7 implies a match already validated
          // rep0 against the window since the last state reset.
          let matchByte = out[this.outPos - this.rep0 - 1];
          do {
            const matchBit = (matchByte >> 7) & 1;
            matchByte = (matchByte << 1) & 0xff;
            const bit = this.decodeBit(probs, base + ((1 + matchBit) << 8) + symbol);
            symbol = (symbol << 1) | bit;
            if (matchBit !== bit) {
              break;
            }
          } while (symbol < 0x100);
        }
        while (symbol < 0x100) {
          symbol = (symbol << 1) | this.decodeBit(probs, base + symbol);
        }
        out[this.outPos++] = symbol & 0xff;
        this.state = this.state < 4 ? 0 : this.state < 10 ? this.state - 3 : this.state - 6;
        continue;
      }
      let len: number;
      if (this.decodeBit(this.isRep, this.state) !== 0) {
        // Rep match.
        if (processed === 0) {
          throw new Error(ERR_CORRUPT);
        }
        if (this.decodeBit(this.isRepG0, this.state) === 0) {
          if (this.decodeBit(this.isRep0Long, (this.state << 4) + posState) === 0) {
            // Short rep: copy a single byte from distance rep0 + 1.
            if (this.rep0 >= processed) {
              throw new Error(ERR_CORRUPT);
            }
            this.state = this.state < 7 ? 9 : 11;
            out[this.outPos] = out[this.outPos - this.rep0 - 1];
            this.outPos++;
            continue;
          }
        } else {
          let dist: number;
          if (this.decodeBit(this.isRepG1, this.state) === 0) {
            dist = this.rep1;
          } else {
            if (this.decodeBit(this.isRepG2, this.state) === 0) {
              dist = this.rep2;
            } else {
              dist = this.rep3;
              this.rep3 = this.rep2;
            }
            this.rep2 = this.rep1;
          }
          this.rep1 = this.rep0;
          this.rep0 = dist;
        }
        len = this.decodeLen(
          this.repLenChoice,
          this.repLenLow,
          this.repLenMid,
          this.repLenHigh,
          posState
        );
        this.state = this.state < 7 ? 8 : 11;
      } else {
        // Simple match: new distance.
        this.rep3 = this.rep2;
        this.rep2 = this.rep1;
        this.rep1 = this.rep0;
        len = this.decodeLen(this.lenChoice, this.lenLow, this.lenMid, this.lenHigh, posState);
        this.state = this.state < 7 ? 7 : 10;
        const dist = this.decodeDistance(len);
        if (dist === END_MARKER_DIST) {
          return true;
        }
        this.rep0 = dist;
      }
      // Copy the match. Distance must stay inside the current window.
      if (this.rep0 >= this.outPos - this.dictStart) {
        throw new Error(ERR_CORRUPT);
      }
      const realLen = len + MATCH_MIN_LEN;
      if (this.outPos + realLen > limit) {
        throw new Error(ERR_CORRUPT);
      }
      let from = this.outPos - this.rep0 - 1;
      for (let i = 0; i < realLen; i++) {
        out[this.outPos++] = out[from++];
      }
    }
    return false;
  }
}

/**
 * Decode a raw LZMA1 stream.
 *
 * @param props 5 bytes: packed lc/lp/pb byte followed by a 4-byte
 *              little-endian dictionary size.
 * @param src the compressed stream (range-coder data).
 * @param outSize exact uncompressed size (always known in 7z containers).
 */
export function lzmaDecode(props: Uint8Array, src: Uint8Array, outSize: number): Uint8Array {
  if (props.length < 5) {
    throw new Error(ERR_CORRUPT);
  }
  const dictSize = (props[1] | (props[2] << 8) | (props[3] << 16) | (props[4] << 24)) >>> 0;
  if (dictSize > MAX_DICT) {
    throw new Error(ERR_TOO_BIG);
  }
  const dec = new LzmaDecoder(outSize);
  dec.setProps(props[0]);
  dec.resetState();
  dec.resetDict();
  if (outSize === 0) {
    return dec.out;
  }
  dec.rcInit(src, 0, src.length);
  dec.decode(outSize);
  if (dec.outPos !== outSize) {
    // End marker arrived before the declared size: data is missing.
    throw new Error(ERR_CORRUPT);
  }
  return dec.out;
}

/**
 * Decode an LZMA2 stream (chunked LZMA with reset control bytes).
 *
 * @param src the LZMA2 chunk stream.
 * @param outSize exact uncompressed size.
 */
export function lzma2Decode(src: Uint8Array, outSize: number): Uint8Array {
  const dec = new LzmaDecoder(outSize);
  let pos = 0;
  // 7-Zip Lzma2Dec semantics: the first chunk must reset the dictionary,
  // props must be set before any mode-0/1 LZMA chunk, and an uncompressed
  // dict-reset chunk forces the next LZMA chunk to reset props and state.
  let needInitDic = true;
  let needInitState = true;
  let needInitProp = true;
  for (;;) {
    if (pos >= src.length) {
      // Tolerate a missing terminator byte if the output is complete.
      if (dec.outPos === outSize) {
        break;
      }
      throw new Error(ERR_CORRUPT);
    }
    const ctrl = src[pos++];
    if (ctrl === 0) {
      break;
    }
    if (ctrl < 0x80) {
      // Uncompressed chunk: 0x01 = with dict reset, 0x02 = without.
      if (ctrl > 2) {
        throw new Error(ERR_CORRUPT);
      }
      if (pos + 2 > src.length) {
        throw new Error(ERR_CORRUPT);
      }
      const size = ((src[pos] << 8) | src[pos + 1]) + 1;
      pos += 2;
      if (ctrl === 1) {
        needInitProp = true;
        needInitState = true;
        dec.resetDict();
      } else if (needInitDic) {
        throw new Error(ERR_CORRUPT);
      }
      needInitDic = false;
      if (pos + size > src.length || dec.outPos + size > outSize) {
        throw new Error(ERR_CORRUPT);
      }
      dec.out.set(src.subarray(pos, pos + size), dec.outPos);
      dec.outPos += size;
      pos += size;
    } else {
      // LZMA chunk.
      if (pos + 4 > src.length) {
        throw new Error(ERR_CORRUPT);
      }
      const unpackSize = (((ctrl & 0x1f) << 16) | (src[pos] << 8) | src[pos + 1]) + 1;
      const packSize = ((src[pos + 2] << 8) | src[pos + 3]) + 1;
      pos += 4;
      const mode = (ctrl >> 5) & 3;
      const initDic = mode === 3;
      const initState = mode !== 0;
      if ((!initDic && needInitDic) || (!initState && needInitState)) {
        throw new Error(ERR_CORRUPT);
      }
      if (mode >= 2) {
        if (pos >= src.length) {
          throw new Error(ERR_CORRUPT);
        }
        dec.setProps(src[pos++]);
        needInitProp = false;
      } else if (needInitProp) {
        throw new Error(ERR_CORRUPT);
      }
      needInitDic = false;
      needInitState = false;
      if (initDic) {
        dec.resetDict();
      }
      if (initState) {
        dec.resetState();
      }
      const chunkEnd = dec.outPos + unpackSize;
      if (chunkEnd > outSize || pos + packSize > src.length) {
        throw new Error(ERR_CORRUPT);
      }
      dec.rcInit(src, pos, pos + packSize);
      const marker = dec.decode(chunkEnd);
      if (marker || dec.outPos !== chunkEnd) {
        // LZMA2 chunks never contain end markers and must fill exactly.
        throw new Error(ERR_CORRUPT);
      }
      pos += packSize;
    }
  }
  if (dec.outPos !== outSize) {
    throw new Error(ERR_CORRUPT);
  }
  return dec.out;
}
