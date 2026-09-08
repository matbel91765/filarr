/**
 * transferStats — pure rate / ETA / formatting math for live sync progress.
 * Run via `npm run test:crypto` (vitest, scoped to *.vitest.ts).
 *
 * Covers the mandated edge cases: 0-byte totals, a single sample (no ETA yet),
 * completion, and a multi-sample sequence whose ETA strictly decreases as the
 * transfer nears the end.
 */

import { describe, it, expect } from 'vitest';
import {
  nextSmoothedRate,
  etaSeconds,
  percentComplete,
  formatSpeed,
  formatEta,
  MIN_SAMPLES_FOR_ETA,
} from './transferStats';

describe('nextSmoothedRate', () => {
  it('seeds with the instantaneous rate on the first real interval', () => {
    // 1 MiB over 1s → 1 MiB/s
    expect(nextSmoothedRate(0, 0, 1000, 1024 * 1024, 2000)).toBeCloseTo(1024 * 1024, 5);
  });

  it('keeps the previous rate when the time delta is non-positive (no /0, no jitter)', () => {
    expect(nextSmoothedRate(500, 100, 5000, 200, 5000)).toBe(500);
    expect(nextSmoothedRate(500, 100, 5000, 200, 4000)).toBe(500);
  });

  it('collapses to 0 on a negative byte delta (retry / reset)', () => {
    expect(nextSmoothedRate(1000, 5000, 1000, 4000, 2000)).toBe(0);
  });

  it('blends via EMA once a rate exists', () => {
    // prev 1000 B/s, new interval measures 2000 B/s → 0.3*2000 + 0.7*1000 = 1300
    const r = nextSmoothedRate(1000, 0, 1000, 2000, 2000);
    expect(r).toBeCloseTo(1300, 5);
  });

  it('never returns NaN/Infinity for degenerate input', () => {
    expect(Number.isFinite(nextSmoothedRate(0, 0, 0, 0, 0))).toBe(true);
    expect(Number.isFinite(nextSmoothedRate(NaN, 0, 0, 100, 1000))).toBe(true);
  });
});

describe('etaSeconds', () => {
  it('returns 0 at/after completion (no bytes remaining)', () => {
    expect(etaSeconds(0, 1000)).toBe(0);
    expect(etaSeconds(-50, 1000)).toBe(0);
  });

  it('returns null when there is no usable rate', () => {
    expect(etaSeconds(1000, 0)).toBeNull();
    expect(etaSeconds(1000, -1)).toBeNull();
    expect(etaSeconds(1000, Infinity)).toBeNull();
  });

  it('computes remaining / rate', () => {
    expect(etaSeconds(1000, 100)).toBe(10);
  });
});

describe('percentComplete', () => {
  it('returns null for a 0-byte / unknown total', () => {
    expect(percentComplete(0, 0)).toBeNull();
    expect(percentComplete(10, 0)).toBeNull();
  });

  it('clamps to 0..100', () => {
    expect(percentComplete(0, 100)).toBe(0);
    expect(percentComplete(50, 100)).toBe(50);
    expect(percentComplete(150, 100)).toBe(100);
  });
});

describe('formatSpeed', () => {
  it('formats French units with a comma decimal, e.g. "12,4 Mo/s"', () => {
    expect(formatSpeed(13_000_000, 'fr')).toBe('12,4 Mo/s');
  });

  it('formats English units with a dot decimal', () => {
    expect(formatSpeed(13_000_000, 'en')).toBe('12.4 MB/s');
  });

  it('drops decimals for large values and for bytes/s', () => {
    expect(formatSpeed(512, 'fr')).toBe('512 o/s');
    expect(formatSpeed(200 * 1024 * 1024, 'fr')).toBe('200 Mo/s');
  });

  it('returns empty string for a non-positive / non-finite rate', () => {
    expect(formatSpeed(0)).toBe('');
    expect(formatSpeed(-5)).toBe('');
    expect(formatSpeed(Infinity)).toBe('');
  });
});

describe('formatEta', () => {
  it('formats minutes + padded seconds, e.g. 100s → "~1 min 40"', () => {
    expect(formatEta(100, 'fr')).toBe('~1 min 40');
    expect(formatEta(100, 'en')).toBe('~1m 40s');
  });

  it('formats sub-minute durations', () => {
    expect(formatEta(45, 'fr')).toBe('~45 s');
    expect(formatEta(45, 'en')).toBe('~45s');
  });

  it('formats hours', () => {
    expect(formatEta(3600 + 5 * 60, 'fr')).toBe('~1 h 05');
  });

  it('returns empty string for null / negative / non-finite input', () => {
    expect(formatEta(null)).toBe('');
    expect(formatEta(-1)).toBe('');
    expect(formatEta(Infinity)).toBe('');
  });
});

/**
 * End-to-end simulation mirroring the syncSlice reducer's folding logic, to
 * assert: no ETA on the first sample, an ETA once the rate stabilizes, and a
 * strictly decreasing ETA as the transfer approaches completion.
 */
describe('progress folding (reducer-equivalent)', () => {
  interface Sample {
    transferredBytes: number;
    totalBytes: number;
    lastBytes: number;
    lastTs: number;
    rate: number;
    etaSeconds: number | null;
    samples: number;
  }

  function fold(
    prev: Sample | null,
    transferredBytes: number,
    totalBytes: number,
    at: number
  ): Sample {
    if (!prev || transferredBytes < prev.transferredBytes) {
      return {
        transferredBytes,
        totalBytes,
        lastBytes: transferredBytes,
        lastTs: at,
        rate: 0,
        etaSeconds: null,
        samples: 1,
      };
    }
    const dtMs = at - prev.lastTs;
    let rate = prev.rate;
    let lastBytes = prev.lastBytes;
    let lastTs = prev.lastTs;
    let samples = prev.samples;
    if (dtMs > 0 && transferredBytes >= prev.lastBytes) {
      rate = nextSmoothedRate(prev.rate, prev.lastBytes, prev.lastTs, transferredBytes, at);
      lastBytes = transferredBytes;
      lastTs = at;
      samples = prev.samples + 1;
    }
    const eta =
      samples >= MIN_SAMPLES_FOR_ETA ? etaSeconds(totalBytes - transferredBytes, rate) : null;
    return { transferredBytes, totalBytes, lastBytes, lastTs, rate, etaSeconds: eta, samples };
  }

  it('no ETA on the single first sample; ETA appears and strictly decreases', () => {
    const total = 100 * 1024 * 1024; // 100 MiB
    const step = 10 * 1024 * 1024; // 10 MiB per 1s tick → ~10 MiB/s

    // Sample 1: no rate, no ETA.
    let s = fold(null, step, total, 1000);
    expect(s.rate).toBe(0);
    expect(s.etaSeconds).toBeNull();

    // Build a full sequence of steady 10 MiB/s ticks.
    const etas: number[] = [];
    for (let i = 2; i <= 9; i++) {
      s = fold(s, step * i, total, 1000 + (i - 1) * 1000);
      if (s.etaSeconds !== null) etas.push(s.etaSeconds);
    }

    // ETA becomes available (>= MIN_SAMPLES_FOR_ETA samples) and there are several.
    expect(etas.length).toBeGreaterThan(2);
    // Strictly decreasing as we approach completion.
    for (let i = 1; i < etas.length; i++) {
      expect(etas[i]).toBeLessThan(etas[i - 1]);
    }
    // Never NaN/Infinity.
    for (const e of etas) expect(Number.isFinite(e)).toBe(true);
  });

  it('reaching the total yields a 0 ETA (completion boundary)', () => {
    const total = 20 * 1024 * 1024;
    let s = fold(null, 5 * 1024 * 1024, total, 1000);
    s = fold(s, 10 * 1024 * 1024, total, 2000);
    s = fold(s, 15 * 1024 * 1024, total, 3000);
    s = fold(s, total, total, 4000);
    expect(s.etaSeconds).toBe(0);
  });

  it('reseeds (no NaN) when bytes go backwards on a retry', () => {
    const total = 50 * 1024 * 1024;
    let s = fold(null, 10 * 1024 * 1024, total, 1000);
    s = fold(s, 20 * 1024 * 1024, total, 2000);
    s = fold(s, 30 * 1024 * 1024, total, 3000);
    // Retry: transferred drops → reseed.
    s = fold(s, 5 * 1024 * 1024, total, 4000);
    expect(s.rate).toBe(0);
    expect(s.etaSeconds).toBeNull();
    expect(s.samples).toBe(1);
  });
});
