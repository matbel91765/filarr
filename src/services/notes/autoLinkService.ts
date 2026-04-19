/**
 * Auto-Link Service — Filarr Notes
 *
 * Scans note plain text for substrings matching other note titles.
 * Finds "potential links" — mentions of note names without [[wiki-link]] syntax.
 */

import type { Note } from '../../types/notes';

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

/**
 * Find potential links in a note's plain text.
 * Searches for occurrences of other note titles that aren't already wiki-linked.
 * Titles are sorted longest-first to avoid partial matches.
 */
export function findPotentialLinks(
  noteId: string,
  notesById: Record<string, Note>
): PotentialLink[] {
  const note = notesById[noteId];
  if (!note || !note.plainText) return [];

  const text = note.plainText;
  const textLower = text.toLowerCase();

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

    const titleLower = other.title.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < textLower.length) {
      const idx = textLower.indexOf(titleLower, searchFrom);
      if (idx === -1) break;

      const end = idx + titleLower.length;

      // Check word boundaries to avoid matching inside longer words
      const charBefore = idx > 0 ? text[idx - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      const isWordBoundary =
        /[\s,.;:!?()[\]{}'"—–-]/.test(charBefore) || idx === 0;
      const isWordEnd =
        /[\s,.;:!?()[\]{}'"—–-]/.test(charAfter) || end === text.length;

      if (isWordBoundary && isWordEnd) {
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

/**
 * Check if a note is an orphan (no incoming or outgoing note links).
 */
export function isOrphanNote(
  noteId: string,
  notesById: Record<string, Note>
): boolean {
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
