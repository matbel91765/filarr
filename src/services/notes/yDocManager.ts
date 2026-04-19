/**
 * Yjs Document Manager — Filarr Notes
 *
 * Manages Y.Doc lifecycle per note.
 * - Redux owns metadata (title, links, tags)
 * - Yjs owns document content via Y.XmlFragment
 * - y-indexeddb persists locally
 *
 * Feature-flagged: opt-in via settings.
 */

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

// ==================== Types ====================

export interface ManagedDoc {
  yDoc: Y.Doc;
  persistence: IndexeddbPersistence;
  fragment: Y.XmlFragment;
}

// ==================== Manager ====================

class YDocManager {
  private docs: Map<string, ManagedDoc> = new Map();
  private enabled = false;

  /**
   * Enable/disable CRDT mode.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.destroyAll();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get or create a Y.Doc for a note.
   */
  getDoc(noteId: string): ManagedDoc {
    const existing = this.docs.get(noteId);
    if (existing) return existing;

    const yDoc = new Y.Doc();
    const fragment = yDoc.getXmlFragment('content');
    const persistence = new IndexeddbPersistence(`filarr-note-${noteId}`, yDoc);

    const managed: ManagedDoc = { yDoc, persistence, fragment };
    this.docs.set(noteId, managed);

    return managed;
  }

  /**
   * Check if a doc exists in memory.
   */
  hasDoc(noteId: string): boolean {
    return this.docs.has(noteId);
  }

  /**
   * Destroy a single doc (cleanup).
   */
  destroyDoc(noteId: string): void {
    const managed = this.docs.get(noteId);
    if (managed) {
      managed.persistence.destroy();
      managed.yDoc.destroy();
      this.docs.delete(noteId);
    }
  }

  /**
   * Destroy all docs.
   */
  destroyAll(): void {
    for (const [id] of this.docs) {
      this.destroyDoc(id);
    }
  }

  /**
   * Get plainText from a Y.Doc's fragment (for search indexing).
   */
  getPlainText(noteId: string): string {
    const managed = this.docs.get(noteId);
    if (!managed) return '';
    return this.xmlFragmentToText(managed.fragment);
  }

  /**
   * Get word count from a Y.Doc.
   */
  getWordCount(noteId: string): number {
    const text = this.getPlainText(noteId);
    return text.split(/\s+/).filter(Boolean).length;
  }

  /**
   * Convert XmlFragment to plain text.
   */
  private xmlFragmentToText(fragment: Y.XmlFragment): string {
    const parts: string[] = [];
    fragment.forEach((item) => {
      if (item instanceof Y.XmlText) {
        parts.push(item.toString());
      } else if (item instanceof Y.XmlElement) {
        parts.push(this.xmlElementToText(item));
      }
    });
    return parts.join('\n');
  }

  private xmlElementToText(el: Y.XmlElement): string {
    const parts: string[] = [];
    el.forEach((child) => {
      if (child instanceof Y.XmlText) {
        parts.push(child.toString());
      } else if (child instanceof Y.XmlElement) {
        parts.push(this.xmlElementToText(child));
      }
    });
    return parts.join('');
  }

  /**
   * Get count of active docs.
   */
  get size(): number {
    return this.docs.size;
  }
}

// Singleton
const yDocManager = new YDocManager();
export default yDocManager;
