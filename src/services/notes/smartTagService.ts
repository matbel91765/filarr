/**
 * Smart Tag Service — Filarr Notes
 *
 * TF-IDF keyword extraction for automatic tag suggestions.
 * Supports EN and FR stop words. No external dependencies.
 */

import type { Note } from '../../types/notes';

// ==================== Stop Words ====================

const STOP_WORDS_EN = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for',
  'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'just', 'me', 'my', 'no', 'not',
  'of', 'on', 'or', 'our', 'out', 'so', 'some', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up',
  'us', 'very', 'was', 'we', 'were', 'what', 'when', 'which', 'who',
  'will', 'with', 'would', 'you', 'your', 'but', 'been', 'about', 'all',
  'also', 'could', 'did', 'get', 'got', 'here', 'him', 'more', 'new',
  'now', 'old', 'see', 'way', 'may', 'day', 'too', 'any', 'why', 'let',
]);

const STOP_WORDS_FR = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'est',
  'en', 'que', 'qui', 'dans', 'ce', 'il', 'ne', 'sur', 'se', 'pas',
  'plus', 'par', 'je', 'avec', 'tout', 'faire', 'son', 'mais', 'on',
  'sa', 'au', 'aux', 'ou', 'elle', 'ses', 'nous', 'vous', 'ils',
  'elles', 'cette', 'ces', 'pour', 'sont', 'bien', 'si', 'lui',
  'deux', 'été', 'mes', 'ici', 'dont', 'mon', 'même', 'te', 'tes',
  'ton', 'ma', 'nos', 'vos', 'leur', 'leurs', 'peu', 'très', 'aussi',
]);

const ALL_STOP_WORDS = new Set([...STOP_WORDS_EN, ...STOP_WORDS_FR]);

// ==================== Tokenization ====================

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !ALL_STOP_WORDS.has(w));
}

// ==================== TF-IDF ====================

/**
 * Compute term frequency for a document.
 */
function tf(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  const total = tokens.length || 1;
  const result = new Map<string, number>();
  for (const [term, count] of counts) {
    result.set(term, count / total);
  }
  return result;
}

/**
 * Compute inverse document frequency from a corpus.
 */
function idf(corpus: string[][], term: string): number {
  const docCount = corpus.filter((doc) => doc.includes(term)).length;
  if (docCount === 0) return 0;
  return Math.log(corpus.length / docCount);
}

// ==================== Public API ====================

export interface SmartTagSuggestion {
  tag: string;
  score: number;
}

/**
 * Suggest tags for a note using TF-IDF against all other notes as corpus.
 */
export function suggestTags(
  noteId: string,
  notesById: Record<string, Note>,
  maxSuggestions = 5
): SmartTagSuggestion[] {
  const note = notesById[noteId];
  if (!note || !note.plainText) return [];

  // Build corpus (tokenized docs)
  const corpus: string[][] = [];
  const allNotes = Object.values(notesById).filter((n) => !n.deletedAt);
  for (const n of allNotes) {
    corpus.push(tokenize(n.plainText));
  }

  // Tokenize target note
  const noteTokens = tokenize(note.plainText);
  if (noteTokens.length === 0) return [];

  // Compute TF for this note
  const noteTf = tf(noteTokens);

  // Compute TF-IDF scores
  const scores: SmartTagSuggestion[] = [];
  for (const [term, tfValue] of noteTf) {
    const idfValue = idf(corpus, term);
    scores.push({ tag: term, score: tfValue * idfValue });
  }

  // Sort by score descending, take top N
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, maxSuggestions);
}
