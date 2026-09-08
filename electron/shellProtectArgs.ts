/**
 * shellProtectArgs.ts — pure argv parsing + burst coalescing for the Windows
 * Explorer right-click verb « Protéger avec Filarr » (Wave 2b). No Electron
 * imports: everything here is unit-testable in plain Node (same pattern as
 * streamProtocol.ts). The Electron-side wiring (second-instance handler,
 * cold-start scan, 'shell:protect-request' delivery) lives in main.ts; the
 * HKCU registry verbs themselves are written by the NSIS installer
 * (buildResources/installer.nsh).
 *
 * Invocation shape (per the registry `command` value):
 *   "C:\...\Filarr.exe" --protect "C:\selected\path"
 *
 * Windows runs a classic shell verb ONCE PER SELECTED ITEM: a multi-select
 * of N files spawns N processes, each carrying ONE `--protect <path>` pair.
 * All but the first forward their argv to the running instance via the
 * single-instance lock — the coalescer below debounces that burst into a
 * single flush so the renderer opens ONE protect dialog listing all paths.
 *
 * Ownership rules (interference guard):
 *  - only the exact token `--protect` (or `--protect=<path>`) is consumed;
 *  - plain `.filarr` paths are IGNORED here — they belong to the existing
 *    double-click open flow (forwardFilarrFileOpen), and a `.filarr` is
 *    already protected anyway;
 *  - `filarr://` URIs are IGNORED here — they belong to handleProtocolUri.
 */

/** The argv token the NSIS shell verb passes before each selected path. */
export const SHELL_PROTECT_FLAG = '--protect';

/**
 * Debounce window for coalescing the one-process-per-item burst Explorer
 * produces on multi-select. 350 ms is comfortably above the inter-process
 * spawn jitter observed for classic verbs while staying imperceptible for
 * a single-item invocation.
 */
export const SHELL_PROTECT_DEBOUNCE_MS = 350;

/**
 * Extracts the path(s) following `--protect` tokens from an argv array.
 *
 *  - `--protect <path>` and `--protect=<path>` are both accepted (the NSIS
 *    verb generates the former; the latter is defensive).
 *  - The OS has already split/unquoted argv, but stray surrounding double
 *    quotes are stripped defensively (a literal `"` is invalid in Windows
 *    file names, so this can never corrupt a real path).
 *  - A `--protect` followed by another `-`-prefixed token (or nothing) is
 *    treated as having no path; the next token keeps its own meaning.
 *  - `.filarr` paths and `filarr://` URIs are excluded (owned by the
 *    existing open/protocol handlers — see module header).
 *  - Duplicates are removed (first occurrence wins).
 */
export function parseProtectPaths(argv: readonly string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== 'string') continue;

    let candidate: string | null = null;
    if (token === SHELL_PROTECT_FLAG) {
      const next = argv[i + 1];
      // Windows shell paths are absolute (drive letter or UNC) and can
      // never start with '-': a dash-prefixed follower is another flag,
      // which must keep its own meaning (it could itself be --protect).
      if (typeof next === 'string' && !next.startsWith('-')) {
        candidate = next;
        i++; // consumed as this flag's path
      }
    } else if (token.startsWith(`${SHELL_PROTECT_FLAG}=`)) {
      candidate = token.slice(SHELL_PROTECT_FLAG.length + 1);
    }
    if (candidate === null) continue;

    const cleaned = stripSurroundingQuotes(candidate.trim());
    if (cleaned.length === 0) continue;
    const lower = cleaned.toLowerCase();
    if (lower.endsWith('.filarr')) continue; // existing .filarr open flow owns these
    if (lower.startsWith('filarr://')) continue; // protocol handler owns these
    if (!paths.includes(cleaned)) paths.push(cleaned);
  }
  return paths;
}

function stripSurroundingQuotes(value: string): string {
  let result = value;
  while (result.length >= 2 && result.startsWith('"') && result.endsWith('"')) {
    result = result.slice(1, -1);
  }
  return result;
}

/** Opaque timer handle — whatever the injected scheduler returns. */
type TimerHandle = unknown;

export interface ProtectCoalescerOptions {
  /** Debounce window in ms. Defaults to SHELL_PROTECT_DEBOUNCE_MS. */
  debounceMs?: number;
  /** Timer injection points for deterministic tests (default: setTimeout). */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export interface ProtectCoalescer {
  /**
   * Queues paths and (re)arms the debounce timer. Rapid successive calls —
   * one per Explorer-spawned process on multi-select — keep pushing the
   * flush back so the whole burst lands in a single onFlush.
   */
  add(paths: readonly string[]): void;
  /** Drops queued paths and disarms the timer (quit / test teardown). */
  cancel(): void;
}

/**
 * Creates a debounced accumulator: every add() resets a debounceMs timer;
 * when it finally fires, onFlush receives the deduplicated union of all
 * paths queued since the last flush (order of first appearance).
 */
export function createProtectCoalescer(
  onFlush: (paths: string[]) => void,
  options: ProtectCoalescerOptions = {}
): ProtectCoalescer {
  const debounceMs = options.debounceMs ?? SHELL_PROTECT_DEBOUNCE_MS;
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number): TimerHandle => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: TimerHandle): void => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let queued: string[] = [];
  let timer: TimerHandle | null = null;

  const flush = (): void => {
    timer = null;
    if (queued.length === 0) return;
    const paths = queued;
    queued = [];
    onFlush(paths);
  };

  return {
    add(paths: readonly string[]): void {
      for (const p of paths) {
        if (!queued.includes(p)) queued.push(p);
      }
      if (queued.length === 0) return; // nothing new and nothing pending
      if (timer !== null) clearTimer(timer);
      timer = setTimer(flush, debounceMs);
    },
    cancel(): void {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      queued = [];
    },
  };
}
