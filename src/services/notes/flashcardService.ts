/**
 * Flashcard Service — Filarr Notes
 *
 * SM-2 spaced repetition algorithm for flashcard review.
 * Parses Q&A patterns from note text.
 * Stores decks in profile-scoped localStorage.
 */

import * as profileStorage from '../core/profileStorage';

// ==================== Types ====================

export interface Flashcard {
  id: string;
  /** Source note ID */
  noteId: string;
  question: string;
  answer: string;
  /** SM-2 parameters */
  easeFactor: number;
  interval: number; // days
  repetitions: number;
  /** ISO date of next review */
  nextReview: string;
  /** ISO date of last review */
  lastReview: string | null;
}

export interface FlashcardDeck {
  id: string;
  name: string;
  cards: Flashcard[];
  createdAt: string;
  updatedAt: string;
}

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;
// 0 = complete blackout
// 1 = incorrect, but remembered upon seeing answer
// 2 = incorrect, but easy to recall
// 3 = correct, with serious difficulty
// 4 = correct, with hesitation
// 5 = perfect response

// ==================== Constants ====================

const STORAGE_KEY = 'filarr-flashcard-decks';

// ==================== SM-2 Algorithm ====================

/**
 * SM-2 supermemo algorithm — update card after review.
 */
export function reviewCard(card: Flashcard, quality: ReviewQuality): Flashcard {
  let { easeFactor, interval, repetitions } = card;

  if (quality < 3) {
    // Failed — reset
    repetitions = 0;
    interval = 1;
  } else {
    // Passed
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  }

  // Update ease factor
  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

  const nextReview = new Date(Date.now() + interval * 24 * 60 * 60 * 1000).toISOString();

  return {
    ...card,
    easeFactor,
    interval,
    repetitions,
    nextReview,
    lastReview: new Date().toISOString(),
  };
}

// ==================== Parsing ====================

/**
 * Parse Q&A pairs from text.
 * Supports patterns:
 * - "Q: question\nA: answer"
 * - "? question\n! answer"
 * - "**question**\nanswer"
 */
export function parseFlashcards(text: string, noteId: string): Flashcard[] {
  const cards: Flashcard[] = [];

  // Normalize: collapse multiple newlines into single \n, then filter empty lines
  // TipTap getText() may use \n\n between paragraphs
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] || '';

    let question = '';
    let answer = '';

    // Q: / A: pattern (also handles Q : with space before colon)
    if (/^Q\s*:\s*/i.test(line) && /^A\s*:\s*/i.test(nextLine)) {
      question = line.replace(/^Q\s*:\s*/i, '');
      answer = nextLine.replace(/^A\s*:\s*/i, '');
      i++; // skip next line
    }
    // ? / ! pattern
    else if (line.startsWith('? ') && nextLine.startsWith('! ')) {
      question = line.slice(2);
      answer = nextLine.slice(2);
      i++;
    }

    if (question && answer) {
      cards.push(createFlashcard(noteId, question, answer));
    }
  }

  return cards;
}

function createFlashcard(noteId: string, question: string, answer: string): Flashcard {
  return {
    id: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    noteId,
    question,
    answer,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: new Date().toISOString(),
    lastReview: null,
  };
}

// ==================== Storage ====================

export function loadDecks(): FlashcardDeck[] {
  const raw = profileStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveDecks(decks: FlashcardDeck[]): void {
  profileStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

export function createDeck(name: string): FlashcardDeck {
  const now = new Date().toISOString();
  return {
    id: `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    cards: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function getDueCards(deck: FlashcardDeck): Flashcard[] {
  const now = Date.now();
  return deck.cards.filter((c) => new Date(c.nextReview).getTime() <= now);
}
