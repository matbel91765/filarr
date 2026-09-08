/**
 * Potential-Link Decoration Plugin — Filarr Notes
 *
 * Underlines, with a discreet dotted rule, every mention of ANOTHER note's
 * title that isn't wiki-linked yet. Clicking one opens a two-item popover
 * ("Link" / "Ignore") rendered by the NoteEditor — this plugin only paints the
 * hints and owns the ignore list.
 *
 * Cost control, because the scan is O(titles × text):
 *   • it never runs inside a synchronous handler — every rebuild goes through
 *     a 300 ms debounce, and only `docChanged` transactions schedule one;
 *   • candidates are pruned in one pass against the whole document's folded
 *     text before any per-node walk;
 *   • at most `MAX_DECORATIONS` hints are painted, so a common word used as a
 *     note title can't turn a long note into a minefield.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { foldAligned } from '../../../../utils/textFold';
import { getItem, setItem } from '../../../../services/core/profileStorage';

/** A title shorter than this matches far too much prose to be a signal. */
const MIN_TITLE_LENGTH = 3;
/** Hard cap on painted hints — a noisy editor is worse than a silent one. */
const MAX_DECORATIONS = 50;
/** Rebuild delay after the last keystroke. */
const RESCAN_DELAY_MS = 300;

/** Same boundary alphabet as `findPotentialLinks`, so panel and editor agree. */
const BOUNDARY_RE = /[\s,.;:!?()[\]{}'"—–-]/;
/** Ranges already spoken for by a real wiki-link. */
const WIKI_LINK_RE = /\[\[[^\]]*\]\]/g;

export const POTENTIAL_LINK_CLASS = 'potential-link';
export const potentialLinkDecorationKey = new PluginKey<DecorationSet>('potentialLinkDecoration');

/** Short-lived highlight painted over a mention that was just wrapped. */
export const POTENTIAL_LINK_FLASH_CLASS = 'wiki-link--flash';
export const potentialLinkFlashKey = new PluginKey<DecorationSet>('potentialLinkFlash');
/** Long enough to be seen after a scroll, short enough not to look like state. */
const FLASH_DURATION_MS = 1200;

/** Fired when the ignore list or the preference changed under the plugin. */
export const POTENTIAL_LINK_REFRESH_EVENT = 'filarr:potential-links-refresh';

export interface PotentialLinkCandidate {
  /** Note the title belongs to. */
  id: string;
  /** Title as written — what gets inserted between the brackets. */
  title: string;
}

export interface PotentialLinkDecorationOptions {
  /**
   * Every note that could be linked to, read fresh from the store. Called at
   * scan time and never captured — the extension instance outlives any render.
   */
  getCandidates: () => PotentialLinkCandidate[];
  /** The note this editor is showing — never hints at its own title. */
  getCurrentNoteId: () => string | null;
}

// ==================== Preference ====================

const HINTS_ENABLED_KEY = 'filarr-potential-link-hints';

/** Editor hints are ON unless the user turned them off. */
export function arePotentialLinkHintsEnabled(): boolean {
  return getItem(HINTS_ENABLED_KEY) !== '0';
}

export function setPotentialLinkHintsEnabled(enabled: boolean): void {
  setItem(HINTS_ENABLED_KEY, enabled ? '1' : '0');
  requestPotentialLinkRescan();
}

// ==================== Ignore list ====================

const IGNORED_KEY = 'filarr-potential-link-ignored';

/**
 * `{ [noteId]: foldedTitle[] }` — dismissing a hint silences THAT title in
 * THAT note only. The same mention elsewhere is still worth suggesting.
 * Cached in memory because the (debounced) scan reads it on every pass.
 */
let ignoredCache: Record<string, string[]> | null = null;

function loadIgnored(): Record<string, string[]> {
  if (ignoredCache) return ignoredCache;
  try {
    const raw = getItem(IGNORED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    ignoredCache = parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
  } catch {
    ignoredCache = {};
  }
  return ignoredCache;
}

export function isPotentialLinkIgnored(noteId: string | null, title: string): boolean {
  if (!noteId) return false;
  const list = loadIgnored()[noteId];
  return Array.isArray(list) && list.includes(foldAligned(title));
}

/** Persists (noteId, title) as "don't suggest this again here". */
export function ignorePotentialLink(noteId: string, title: string): void {
  const all = { ...loadIgnored() };
  const folded = foldAligned(title);
  const list = Array.isArray(all[noteId]) ? all[noteId] : [];
  if (list.includes(folded)) return;
  all[noteId] = [...list, folded];
  ignoredCache = all;
  try {
    setItem(IGNORED_KEY, JSON.stringify(all));
  } catch {
    // Quota or private mode — the in-memory cache still holds for this session.
  }
  requestPotentialLinkRescan();
}

/**
 * Asks every mounted editor to rebuild its hints. Used after a change that the
 * document itself doesn't reflect (an ignore, a preference flip).
 */
export function requestPotentialLinkRescan(): void {
  window.dispatchEvent(new Event(POTENTIAL_LINK_REFRESH_EVENT));
}

// ==================== Occurrence resolution ====================

export interface TitleOccurrence {
  from: number;
  to: number;
}

/** True when `[start, end)` sits outside every word it touches. */
function hasWordBoundaries(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : ' ';
  const after = end < text.length ? text[end] : ' ';
  if (start !== 0 && !BOUNDARY_RE.test(before)) return false;
  if (end !== text.length && !BOUNDARY_RE.test(after)) return false;
  // `[` is a boundary char, so `[[Title]]` would otherwise match — the mention
  // is already a link there, and re-linking it would produce `[[[[Title]]]]`.
  if (start >= 2 && text.slice(start - 2, start) === '[[') return false;
  return true;
}

/** Ranges of `[[...]]` inside a single text node — never hint over those. */
function wikiRangesOf(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  WIKI_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_RE.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function overlaps(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([s, e]) => start < e && end > s);
}

/**
 * Walks the document's text nodes — same word boundaries and same folding as
 * `findPotentialLinks` — and yields every linkable occurrence of `title`.
 * Code blocks, code marks, existing links and existing `[[...]]` are skipped,
 * so what this returns is always safe to replace.
 */
function eachOccurrence(
  doc: PMNode,
  title: string,
  visit: (occurrence: TitleOccurrence) => boolean | void
): void {
  const needle = foldAligned(title);
  if (!needle) return;
  let stop = false;

  doc.descendants((node, pos) => {
    if (stop) return false;

    // ORDER IS LOAD-BEARING. Every ProseMirror text node is a leaf, so
    // `node.isAtom` is TRUE for all of them — testing it before `isText`
    // pruned the walk at the first piece of text and this function never
    // yielded anything at all (no dotted hints, dead "Link" button). The
    // code/atom guard therefore only applies to NON-text nodes: code blocks
    // and atoms (transclusions, drawings, inline databases…) hold text that
    // must never be rewritten, so we don't even descend into them.
    if (!node.isText) {
      if (node.type.spec.code || node.isAtom) return false;
      return undefined;
    }
    // Text carrying a code or link mark is equally off-limits. A text node has
    // no children, so returning `false` here only means "don't descend".
    if (node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return false;

    const text = node.text || '';
    const folded = foldAligned(text);
    const wikiRanges = wikiRangesOf(text);

    let searchFrom = 0;
    while (searchFrom <= folded.length) {
      const idx = folded.indexOf(needle, searchFrom);
      if (idx === -1) break;
      const end = idx + needle.length;
      if (hasWordBoundaries(text, idx, end) && !overlaps(wikiRanges, idx, end)) {
        if (visit({ from: pos + idx, to: pos + end }) === false) {
          stop = true;
          return false;
        }
      }
      searchFrom = end;
    }
    return false;
  });
}

/**
 * Turns a title into a concrete range in the live document. `hintPos` is the
 * position the user clicked at — we honour it when it still holds the title
 * (positions move under a debounced decoration set), otherwise we fall back to
 * the first occurrence, which is what the backlinks panel means by "the"
 * mention.
 */
export function resolveTitleOccurrence(
  doc: PMNode,
  title: string,
  hintPos?: number | null
): TitleOccurrence | null {
  const needle = foldAligned(title);
  if (!needle) return null;

  if (typeof hintPos === 'number' && hintPos >= 0 && hintPos + needle.length <= doc.content.size) {
    try {
      const slice = doc.textBetween(hintPos, hintPos + needle.length, '', '');
      if (foldAligned(slice) === needle) return { from: hintPos, to: hintPos + needle.length };
    } catch {
      // Out-of-document hint — fall through to the scan.
    }
  }

  let found: TitleOccurrence | null = null;
  eachOccurrence(doc, title, (occurrence) => {
    found = occurrence;
    return false;
  });
  return found;
}

// ==================== Decoration building ====================

function buildDecorations(
  doc: PMNode,
  options: PotentialLinkDecorationOptions,
  editable: boolean
): DecorationSet {
  // Read-only panes (history preview, shared read access) get no hints: there
  // would be nothing to do with them.
  if (!editable || !arePotentialLinkHintsEnabled()) return DecorationSet.empty;

  const currentNoteId = options.getCurrentNoteId();
  const candidates = options
    .getCandidates()
    .filter(
      (c) =>
        c.id !== currentNoteId &&
        c.title.trim().length >= MIN_TITLE_LENGTH &&
        !isPotentialLinkIgnored(currentNoteId, c.title)
    );
  if (candidates.length === 0) return DecorationSet.empty;

  // One pass over the whole document prunes the candidate list before the
  // per-node walk — without it every title would be searched in every node.
  const docFolded = foldAligned(doc.textBetween(0, doc.content.size, '\n', ' '));
  if (!docFolded) return DecorationSet.empty;

  const present = candidates
    .map((c) => ({ ...c, folded: foldAligned(c.title) }))
    .filter((c) => c.folded.length >= MIN_TITLE_LENGTH && docFolded.includes(c.folded))
    // Longest first, so « Notes de réunion » wins over « Notes ».
    .sort((a, b) => b.folded.length - a.folded.length);
  if (present.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  const taken: Array<[number, number]> = [];

  for (const candidate of present) {
    if (decorations.length >= MAX_DECORATIONS) break;
    eachOccurrence(doc, candidate.title, ({ from, to }) => {
      if (overlaps(taken, from, to)) return undefined;
      taken.push([from, to]);
      decorations.push(
        Decoration.inline(from, to, {
          class: POTENTIAL_LINK_CLASS,
          'data-potential-title': candidate.title,
          'data-potential-note-id': candidate.id,
        })
      );
      return decorations.length < MAX_DECORATIONS;
    });
  }

  return DecorationSet.create(doc, decorations);
}

// ==================== Flash feedback ====================

/**
 * One pending "un-flash" per view. A WeakMap and not a module variable: split
 * view mounts two editors, and the second flash must not cancel the first
 * one's highlight — nor keep the view alive once it's gone.
 */
const flashTimers = new WeakMap<EditorView, number>();

function clearFlashTimer(view: EditorView): void {
  const pending = flashTimers.get(view);
  if (pending !== undefined) {
    window.clearTimeout(pending);
    flashTimers.delete(view);
  }
}

/**
 * Paints `[from, to)` for {@link FLASH_DURATION_MS}, then clears it. This is
 * the "here, this is what I changed" of a link action the user asked for from
 * somewhere else (the popover, or the backlinks panel) — without it the only
 * proof of the rewrite is two brackets that landed off-screen.
 *
 * The decoration is mapped through subsequent transactions, so it follows the
 * text if the user keeps typing while it shows.
 */
export function flashRange(view: EditorView, from: number, to: number): void {
  if (view.isDestroyed || to <= from) return;
  clearFlashTimer(view);
  view.dispatch(
    view.state.tr.setMeta(potentialLinkFlashKey, { from, to }).setMeta('addToHistory', false)
  );
  const timer = window.setTimeout(() => {
    flashTimers.delete(view);
    if (view.isDestroyed) return;
    view.dispatch(
      view.state.tr.setMeta(potentialLinkFlashKey, null).setMeta('addToHistory', false)
    );
  }, FLASH_DURATION_MS);
  flashTimers.set(view, timer);
}

function flashPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: potentialLinkFlashKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr: Transaction, old: DecorationSet) {
        const meta = tr.getMeta(potentialLinkFlashKey) as
          | { from: number; to: number }
          | null
          | undefined;
        if (meta === null) return DecorationSet.empty;
        if (meta) {
          return DecorationSet.create(tr.doc, [
            Decoration.inline(meta.from, meta.to, { class: POTENTIAL_LINK_FLASH_CLASS }),
          ]);
        }
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state: EditorState) {
        return potentialLinkFlashKey.getState(state) ?? DecorationSet.empty;
      },
    },
    view(view: EditorView) {
      return {
        destroy() {
          clearFlashTimer(view);
        },
      };
    },
  });
}

// ==================== Extension ====================

export const PotentialLinkDecorationExtension = Extension.create<PotentialLinkDecorationOptions>({
  name: 'potentialLinkDecoration',

  addOptions() {
    return {
      getCandidates: () => [],
      getCurrentNoteId: () => null,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin<DecorationSet>({
        key: potentialLinkDecorationKey,
        state: {
          // Nothing on mount: the first scan is scheduled by the view below, so
          // opening a note never pays for it in the frame that paints it.
          init: () => DecorationSet.empty,
          apply(tr: Transaction, old: DecorationSet) {
            const next = tr.getMeta(potentialLinkDecorationKey) as DecorationSet | undefined;
            if (next) return next;
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state: EditorState) {
            return potentialLinkDecorationKey.getState(state) ?? DecorationSet.empty;
          },
        },
        view(view: EditorView) {
          let timer: number | null = null;

          const schedule = () => {
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              timer = null;
              if (view.isDestroyed) return;
              const set = buildDecorations(view.state.doc, options, view.editable);
              view.dispatch(
                view.state.tr
                  .setMeta(potentialLinkDecorationKey, set)
                  .setMeta('addToHistory', false)
              );
            }, RESCAN_DELAY_MS);
          };

          const onRefresh = () => schedule();
          window.addEventListener(POTENTIAL_LINK_REFRESH_EVENT, onRefresh);
          schedule();

          return {
            update(_view: EditorView, prevState: EditorState) {
              // Reference equality, NOT `doc.eq`: ProseMirror keeps the same
              // doc object when a transaction only moved the selection or
              // carried meta (ours does), so this is an O(1) `docChanged` —
              // whereas `eq` would deep-compare the document on every keystroke.
              if (prevState.doc !== view.state.doc) schedule();
            },
            destroy() {
              window.removeEventListener(POTENTIAL_LINK_REFRESH_EVENT, onRefresh);
              if (timer !== null) window.clearTimeout(timer);
            },
          };
        },
      }),
      // Rides along with the hints rather than as its own extension: it only
      // ever fires as the tail of a "link this mention" action.
      flashPlugin(),
    ];
  },
});

export default PotentialLinkDecorationExtension;
