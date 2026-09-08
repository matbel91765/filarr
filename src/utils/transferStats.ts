/**
 * Transfer statistics — smoothed rate + ETA math for live cloud-sync progress.
 *
 * Pure, framework-free helpers shared by the sync slice (rate/ETA computation
 * on every progress sample) and the sync UI (speed/duration/percent
 * formatting). Everything here is monotonic-safe and guards against
 * NaN/Infinity so the UI never renders a garbage value, no matter how the
 * underlying emit path behaves (retries, 0-byte files, duplicate samples).
 */

// EMA smoothing factor for the instantaneous rate (0 < alpha <= 1). Higher =
// more reactive, lower = smoother. 0.3 gives a stable-but-responsive readout.
const RATE_EMA_ALPHA = 0.3;

// A rate is only "stable" enough to derive an ETA from after this many folded
// progress samples (i.e. at least two measured intervals blended by the EMA),
// so a single lucky delta can never produce a wild ETA.
export const MIN_SAMPLES_FOR_ETA = 3;

export type TransferLocale = 'fr' | 'en';

const SPEED_UNITS_FR = ['o/s', 'Ko/s', 'Mo/s', 'Go/s', 'To/s'];
const SPEED_UNITS_EN = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];

/**
 * Fold a new progress sample into the previous smoothed rate (bytes/second).
 *
 * - Non-positive time delta → keep the previous rate (avoids /0 and jitter).
 * - Negative byte delta (retry/reset) → rate collapses to 0 (caller reseeds).
 * - First real interval seeds the EMA with the instantaneous rate.
 *
 * Always returns a finite, non-negative number.
 */
export function nextSmoothedRate(
  prevRate: number,
  prevBytes: number,
  prevTsMs: number,
  newBytes: number,
  newTsMs: number
): number {
  const safePrev = prevRate > 0 && isFinite(prevRate) ? prevRate : 0;
  const dtSec = (newTsMs - prevTsMs) / 1000;
  if (!(dtSec > 0)) return safePrev;
  const deltaBytes = newBytes - prevBytes;
  if (deltaBytes < 0) return 0;
  const instant = deltaBytes / dtSec;
  if (!isFinite(instant)) return safePrev;
  if (safePrev <= 0) return instant;
  return RATE_EMA_ALPHA * instant + (1 - RATE_EMA_ALPHA) * safePrev;
}

/**
 * Seconds remaining given the bytes left and a smoothed rate.
 * Returns `null` when no meaningful ETA exists (no/invalid rate), and `0` at
 * or past completion.
 */
export function etaSeconds(remainingBytes: number, rate: number): number | null {
  if (remainingBytes <= 0) return 0;
  if (!(rate > 0) || !isFinite(rate)) return null;
  const eta = remainingBytes / rate;
  if (!isFinite(eta)) return null;
  return eta;
}

/**
 * Percent complete, clamped to 0..100. Returns `null` when the total size is
 * unknown (0 or non-finite), so the UI can fall back to an indeterminate state.
 */
export function percentComplete(transferred: number, total: number): number | null {
  if (!(total > 0) || !isFinite(total)) return null;
  const pct = (transferred / total) * 100;
  if (!isFinite(pct)) return null;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Format a byte/second rate in localized units, e.g. 13_000_000 → "12,4 Mo/s"
 * (fr) / "12.4 MB/s" (en). Returns '' for a non-positive/non-finite rate so the
 * caller can hide the speed until it exists.
 */
export function formatSpeed(bytesPerSec: number, locale: TransferLocale = 'fr'): string {
  if (!(bytesPerSec > 0) || !isFinite(bytesPerSec)) return '';
  const units = locale === 'en' ? SPEED_UNITS_EN : SPEED_UNITS_FR;
  const k = 1024;
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytesPerSec) / Math.log(k)));
  const value = bytesPerSec / Math.pow(k, i);
  const decimals = value >= 100 || i === 0 ? 0 : 1;
  const num = value.toFixed(decimals);
  return `${locale === 'en' ? num : num.replace('.', ',')} ${units[i]}`;
}

/**
 * Humanized remaining duration, e.g. 100 → "~1 min 40" (fr) / "~1m 40s" (en),
 * 45 → "~45 s". Returns '' for null/negative/non-finite input so callers can
 * hide the ETA entirely until a stable rate exists.
 */
export function formatEta(seconds: number | null, locale: TransferLocale = 'fr'): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (locale === 'en') {
    if (total < 60) return `~${total}s`;
    if (total < 3600) return `~${Math.floor(total / 60)}m ${pad(total % 60)}s`;
    return `~${Math.floor(total / 3600)}h ${pad(Math.floor((total % 3600) / 60))}m`;
  }
  if (total < 60) return `~${total} s`;
  if (total < 3600) return `~${Math.floor(total / 60)} min ${pad(total % 60)}`;
  return `~${Math.floor(total / 3600)} h ${pad(Math.floor((total % 3600) / 60))}`;
}
