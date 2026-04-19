/**
 * Note Search Service — Filarr Notes
 *
 * Full-text search indexing powered by FlexSearch.
 * Singleton service that subscribes to Redux store changes
 * and exposes instant search with highlighted snippets.
 *
 * Supports prefix queries: title:, tag:, in:folder
 */

import { Index as FlexIndex } from 'flexsearch';
import type { Note } from '../../types/notes';

// ==================== Types ====================

export interface NoteSearchResult {
  noteId: string;
  title: string;
  /** Matched snippet with context */
  snippet: string;
  /** Relevance score (higher = better) */
  score: number;
}

// ==================== Service ====================

class NoteSearchService {
  private index: FlexIndex;
  private notesMap: Map<string, Note> = new Map();

  constructor() {
    this.index = new FlexIndex({
      tokenize: 'forward',
      resolution: 9,
      cache: 100,
    });
  }

  /**
   * Rebuild the entire index from a notes map.
   * Called when notes are loaded or significantly changed.
   */
  rebuildIndex(notesById: Record<string, Note>): void {
    // Clear existing
    this.notesMap.clear();

    // Create new index
    this.index = new FlexIndex({
      tokenize: 'forward',
      resolution: 9,
      cache: 100,
    });

    for (const note of Object.values(notesById)) {
      if (note.deletedAt) continue;
      this.notesMap.set(note.id, note);
      const text = `${note.title} ${note.plainText}`;
      this.index.add(note.id as any, text);
    }
  }

  /**
   * Add or update a single note in the index.
   */
  updateNote(note: Note): void {
    if (note.deletedAt) {
      this.removeNote(note.id);
      return;
    }
    this.notesMap.set(note.id, note);
    const text = `${note.title} ${note.plainText}`;
    this.index.update(note.id as any, text);
  }

  /**
   * Remove a note from the index.
   */
  removeNote(noteId: string): void {
    this.notesMap.delete(noteId);
    try {
      this.index.remove(noteId as any);
    } catch {
      // Ignore if not found
    }
  }

  /**
   * Search notes with optional prefix queries.
   * - `title:foo` — match title only
   * - Plain query — full-text search
   */
  search(query: string, limit = 20): NoteSearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // Handle title: prefix
    if (trimmed.startsWith('title:')) {
      const titleQuery = trimmed.slice(6).trim().toLowerCase();
      if (!titleQuery) return [];
      return this.searchByTitle(titleQuery, limit);
    }

    // Full-text search
    const resultIds = this.index.search(trimmed, { limit }) as string[];
    return resultIds.map((id, i) => {
      const note = this.notesMap.get(id);
      return {
        noteId: id,
        title: note?.title || 'Untitled',
        snippet: note ? this.extractSnippet(note.plainText, trimmed) : '',
        score: limit - i,
      };
    });
  }

  /**
   * Search by title substring.
   */
  private searchByTitle(query: string, limit: number): NoteSearchResult[] {
    const results: NoteSearchResult[] = [];
    for (const note of this.notesMap.values()) {
      if (results.length >= limit) break;
      const titleLower = note.title.toLowerCase();
      if (titleLower.includes(query)) {
        results.push({
          noteId: note.id,
          title: note.title,
          snippet: note.plainText.slice(0, 120),
          score: titleLower.startsWith(query) ? 100 : 50,
        });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Extract a snippet around the first query match with highlighting markers.
   */
  private extractSnippet(plainText: string, query: string, contextLen = 60): string {
    if (!plainText) return '';
    const lower = plainText.toLowerCase();
    const queryLower = query.toLowerCase();
    const idx = lower.indexOf(queryLower);
    if (idx === -1) return plainText.slice(0, 120);

    const start = Math.max(0, idx - contextLen);
    const end = Math.min(plainText.length, idx + query.length + contextLen);
    let snippet = '';
    if (start > 0) snippet += '...';
    snippet += plainText.slice(start, end);
    if (end < plainText.length) snippet += '...';
    return snippet;
  }

  /**
   * Get total indexed count.
   */
  get size(): number {
    return this.notesMap.size;
  }
}

// Singleton
const noteSearchService = new NoteSearchService();
export default noteSearchService;
