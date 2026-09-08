/**
 * Text folding — Filarr
 *
 * Accent- and case-insensitive normalisation, shared by everything that has to
 * match what the user TYPED against what a note is CALLED. Without it
 * « reunion » never finds « Réunion », which is most of the French titles in a
 * real vault.
 */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Accent- and case-insensitive folding. Lengths are NOT preserved (a
 * decomposed « é » collapses to one char), so never use the result to index
 * back into the input — use {@link foldAligned} for that.
 */
export function fold(s: string): string {
  return s.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

/**
 * Same folding as {@link fold}, but guaranteed 1:1 on code units: an index into
 * the result is the SAME index in the input. That is what lets a match found in
 * folded text be turned back into a range of the original string (and, from
 * there, into ProseMirror positions).
 *
 * Chars whose folded form isn't exactly one code unit — a combining mark on its
 * own, a ligature, the odd Turkish dotted capital — are left alone rather than
 * silently shifting every offset that follows.
 */
export function foldAligned(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const folded = fold(ch);
    if (folded.length === 1) {
      out += folded;
      continue;
    }
    const lower = ch.toLowerCase();
    out += lower.length === 1 ? lower : ch;
  }
  return out;
}
