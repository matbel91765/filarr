/**
 * Auto-Link Service — Filarr Notes
 *
 * Scans note plain text for substrings matching other note titles.
 * Finds "potential links" — mentions of note names without [[wiki-link]] syntax.
 */

import type { Note } from '../../types/notes';
import { foldAligned } from '../../utils/textFold';

export interface PotentialLink {
  /** ID of the note whose title was found in the text */
  noteId: string;
  /** The matched title */
  matchedTitle: string;
  /** Position in plainText where the match starts */
  position: number;
  /** Context snippet around the match (~60 chars) */
  context: string;
}

/** Spans already spoken for by a real wiki-link. */
const WIKI_SPAN_RE = /\[\[[^\]]*\]\]/g;

/**
 * Node types whose text the editor will never rewrite. `codeBlock` is what the
 * schema actually registers; the loose test also catches the variants another
 * extension could add without silently re-opening the hole.
 */
function isCodeNodeType(type: unknown): boolean {
  return typeof type === 'string' && /code/i.test(type);
}

/** The shape of a TipTap JSON node, as far as text extraction cares. */
interface ScanNode {
  type?: unknown;
  text?: unknown;
  marks?: Array<{ type?: unknown } | null>;
  content?: unknown[];
}

interface ScanText {
  /** The note's text, in document order. */
  text: string;
  /** `offLimits[i]` — index `i` sits in a zone the editor refuses to rewrite. */
  offLimits: boolean[];
}

/**
 * Rebuilds the note's text from its TipTap JSON while remembering which
 * stretches are off-limits: code blocks, `code`/`link` marks, and existing
 * `[[…]]` spans. Those are exactly the zones the editor's `eachOccurrence`
 * skips — scanning `plainText` instead would keep offering a "Link" button the
 * editor is bound to refuse (PL-3).
 *
 * Offsets are self-consistent: they index `text` and nothing else. That is fine
 * because `position` is informational and the context snippet is sliced from
 * this very string. Returns `null` when the content isn't parseable TipTap JSON
 * — imported notes that only ever carried `plainText` fall back to the unmasked
 * scan, where PL-2's honest failure toast remains the safety net.
 */
function buildScanText(contentJson: string): ScanText | null {
  let root: unknown;
  try {
    root = JSON.parse(contentJson);
  } catch {
    return null;
  }
  if (!root || typeof root !== 'object') return null;

  let text = '';
  const offLimits: boolean[] = [];

  const append = (chunk: string, off: boolean): void => {
    text += chunk;
    for (let i = 0; i < chunk.length; i++) offLimits.push(off);
  };

  const walk = (raw: unknown, inherited: boolean): void => {
    if (!raw || typeof raw !== 'object') return;
    const node = raw as ScanNode;
    if (typeof node.text === 'string') {
      const marks = Array.isArray(node.marks) ? node.marks : [];
      const marked = marks.some((m) => m?.type === 'code' || m?.type === 'link');
      append(node.text, inherited || marked);
      return;
    }
    const off = inherited || isCodeNodeType(node.type);
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child, off);
    }
    // Blocks have to end somewhere: without a separator, « …la fin » followed
    // by « Réunion… » would read as one word and the boundary test below would
    // reject a perfectly real mention.
    if (node.type !== 'doc' && !text.endsWith('\n')) append('\n', false);
  };

  walk(root, false);
  if (!text.trim()) return null;

  WIKI_SPAN_RE.lastIndex = 0;
  let span: RegExpExecArray | null;
  while ((span = WIKI_SPAN_RE.exec(text)) !== null) {
    for (let i = span.index; i < span.index + span[0].length; i++) offLimits[i] = true;
  }

  return { text, offLimits };
}

/** True when any index of `[start, end)` falls in an off-limits stretch. */
function spansOffLimits(offLimits: boolean[] | null, start: number, end: number): boolean {
  if (!offLimits) return false;
  for (let i = start; i < end; i++) {
    if (offLimits[i]) return true;
  }
  return false;
}

/**
 * Find potential links in a note's text.
 * Searches for occurrences of other note titles that aren't already wiki-linked.
 * Titles are sorted longest-first to avoid partial matches. Code blocks, code and
 * link marks and existing `[[…]]` spans are skipped, so what this reports is what
 * the editor will actually agree to rewrite.
 */
export function findPotentialLinks(
  noteId: string,
  notesById: Record<string, Note>
): PotentialLink[] {
  const note = notesById[noteId];
  if (!note) return [];

  const scan = buildScanText(note.content);
  const text = scan ? scan.text : note.plainText;
  const offLimits = scan ? scan.offLimits : null;
  if (!text) return [];

  // `foldAligned` (and not `toLowerCase`) so « reunion » finds « Réunion ».
  // The aligned variant is load-bearing here: every index computed below is
  // used to slice `text` itself, so folding must not shift a single offset.
  const textLower = foldAligned(text);

  // Collect all other note titles, sorted longest-first
  const otherNotes = Object.values(notesById)
    .filter((n) => n.id !== noteId && !n.deletedAt && n.title.trim().length >= 2)
    .sort((a, b) => b.title.length - a.title.length);

  const results: PotentialLink[] = [];
  const usedRanges: Array<[number, number]> = [];

  // Already linked note IDs — skip these
  const alreadyLinked = new Set(note.linkedNoteIds);

  for (const other of otherNotes) {
    if (alreadyLinked.has(other.id)) continue;

    const titleLower = foldAligned(other.title);
    let searchFrom = 0;

    while (searchFrom < textLower.length) {
      const idx = textLower.indexOf(titleLower, searchFrom);
      if (idx === -1) break;

      const end = idx + titleLower.length;

      // Check word boundaries to avoid matching inside longer words
      const charBefore = idx > 0 ? text[idx - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      const isWordBoundary = /[\s,.;:!?()[\]{}'"—–-]/.test(charBefore) || idx === 0;
      const isWordEnd = /[\s,.;:!?()[\]{}'"—–-]/.test(charAfter) || end === text.length;

      // A mention inside code, inside a link, or inside an existing `[[…]]` is
      // one the editor will refuse to rewrite — don't advertise it.
      if (isWordBoundary && isWordEnd && !spansOffLimits(offLimits, idx, end)) {
        // Check it doesn't overlap with an already-found range
        const overlaps = usedRanges.some(
          ([s, e]) => (idx >= s && idx < e) || (end > s && end <= e)
        );

        if (!overlaps) {
          usedRanges.push([idx, end]);

          // Build context snippet
          const ctxStart = Math.max(0, idx - 30);
          const ctxEnd = Math.min(text.length, end + 30);
          const prefix = ctxStart > 0 ? '...' : '';
          const suffix = ctxEnd < text.length ? '...' : '';
          const context = prefix + text.slice(ctxStart, ctxEnd).trim() + suffix;

          results.push({
            noteId: other.id,
            matchedTitle: other.title,
            position: idx,
            context,
          });

          // Only report first occurrence per note
          break;
        }
      }

      searchFrom = end;
    }
  }

  return results;
}

// ==================== Panel → editor bridge ====================

/**
 * The backlinks panel can SEE a potential link, but only the editor holding
 * the note can rewrite it: the ProseMirror document in memory is the authority
 * and would overwrite any store-level edit at the next keystroke. So the panel
 * asks, through a window event, and the editor showing `noteId` answers —
 * exactly the pattern the vault-note embed already uses.
 */
export const LINK_POTENTIAL_EVENT = 'filarr:link-potential';

export interface LinkPotentialDetail {
  /** The note whose editor must perform the replacement. */
  noteId: string;
  /** Titles to wrap in `[[…]]`, in order. */
  titles: string[];
  /**
   * Set by the editor that took the request. Split view can mount two editors
   * on the same note; without this the replacement would run twice.
   */
  handled?: boolean;
  /** Filled by the editor: titles it actually wrapped, in order. */
  linked: string[];
  /** Filled by the editor: titles it could not find in the live document. */
  failed: string[];
}

/** What the caller learns from a request. See {@link requestPotentialLink}. */
export interface LinkPotentialResult {
  /** An editor holding that note answered. `false` = nobody was listening. */
  answered: boolean;
  /** Titles wrapped in `[[…]]`. */
  linked: string[];
  /** Titles the editor refused or could no longer locate. */
  failed: string[];
}

/**
 * Asks the editor holding `noteId` to link these mentions, and reports back.
 *
 * The round trip works because `dispatchEvent` is SYNCHRONOUS: every listener
 * has run by the time it returns, so the fields the editor wrote into `detail`
 * are readable right here. That is the whole reason the caller can hide a row
 * optimistically or say honestly that nothing happened — a fire-and-forget
 * event could only ever pretend.
 */
export function requestPotentialLink(noteId: string, titles: string[]): LinkPotentialResult {
  const detail: LinkPotentialDetail = { noteId, titles, linked: [], failed: [] };
  window.dispatchEvent(new CustomEvent(LINK_POTENTIAL_EVENT, { detail }));
  return { answered: detail.handled === true, linked: detail.linked, failed: detail.failed };
}

/**
 * Check if a note is an orphan (no incoming or outgoing note links).
 */
export function isOrphanNote(noteId: string, notesById: Record<string, Note>): boolean {
  const note = notesById[noteId];
  if (!note || note.deletedAt) return false;

  // Has outgoing links?
  if (note.linkedNoteIds.length > 0) return false;

  // Has incoming links (backlinks)?
  for (const other of Object.values(notesById)) {
    if (other.id === noteId || other.deletedAt) continue;
    if (other.linkedNoteIds.includes(noteId)) return false;
  }

  return true;
}
