/**
 * QuickSwitcherPlus — Filarr Notes
 *
 * Enhanced quick switcher modal (Obsidian-style Quick Switcher++).
 * Search modes:
 *   (default) — search note titles
 *   # prefix  — search headings across all notes
 *   > prefix  — search commands
 *   @ prefix  — search tags
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import './QuickSwitcherPlus.css';

// ==================== Types ====================

interface Note {
  id: string;
  title: string;
  content: string;
  plainText: string;
  parentId: string | null;
  linkedNoteIds: string[];
  isDaily: boolean;
  dailyDate: string | null;
  icon: string | null;
  coverColor: string | null;
  wordCount: number;
  tagIds: string[];
  notebookId: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Notebook {
  id: string;
  name: string;
}

interface HeadingResult {
  noteId: string;
  noteTitle: string;
  text: string;
  level: number;
  pos: number;
}

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface SearchResult {
  type: 'note' | 'heading' | 'command' | 'tag';
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  noteId?: string;
  pos?: number;
  action?: () => void;
}

interface QuickSwitcherPlusProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (noteId: string) => void;
  onSelectHeading?: (noteId: string, pos: number) => void;
  commands?: CommandItem[];
}

type SearchMode = 'notes' | 'headings' | 'commands' | 'tags';

// ==================== Helpers ====================

function extractText(node: any): string {
  if (typeof node === 'string') return node;
  if (node.text) return node.text;
  if (node.content) return node.content.map(extractText).join('');
  return '';
}

function extractHeadings(content: string): { text: string; level: number; pos: number }[] {
  try {
    const doc = JSON.parse(content);
    if (!doc?.content) return [];
    const headings: { text: string; level: number; pos: number }[] = [];
    let pos = 0;
    function walk(node: any) {
      if (node.type === 'heading') {
        const text = extractText(node).trim();
        if (text) {
          headings.push({ text, level: node.attrs?.level || 1, pos });
        }
      }
      pos += 1;
      if (node.content) node.content.forEach(walk);
    }
    walk(doc);
    return headings;
  } catch {
    return [];
  }
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="qs-plus__highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function getSearchMode(input: string): { mode: SearchMode; query: string } {
  if (input.startsWith('#')) return { mode: 'headings', query: input.slice(1).trim() };
  if (input.startsWith('>')) return { mode: 'commands', query: input.slice(1).trim() };
  if (input.startsWith('@')) return { mode: 'tags', query: input.slice(1).trim() };
  return { mode: 'notes', query: input.trim() };
}

function getNoteIcon(note: Note): string {
  if (note.icon) return note.icon;
  if (note.isDaily) return '\uD83D\uDCC5'; // calendar
  return '\uD83D\uDCC4'; // page
}

// ==================== Component ====================

const QuickSwitcherPlus: React.FC<QuickSwitcherPlusProps> = ({
  isOpen,
  onClose,
  onSelectNote,
  onSelectHeading,
  commands = [],
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [input, setInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Redux state
  const notesById = useSelector((state: any) => state.notes?.byId ?? {});
  const notebooksRecord = useSelector((state: any) => state.notes?.notebooks ?? {});

  const allNotes: Note[] = useMemo(() => Object.values(notesById), [notesById]);

  const notebookMap = useMemo(() => {
    const map: Record<string, string> = {};
    const nbs: Notebook[] = Array.isArray(notebooksRecord) ? notebooksRecord : Object.values(notebooksRecord);
    for (const nb of nbs) {
      if (nb && nb.id && nb.name) map[nb.id] = nb.name;
    }
    return map;
  }, [notebooksRecord]);

  // Parse search mode and query
  const { mode, query } = useMemo(() => getSearchMode(input), [input]);

  // Build tag set from all notes
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const note of allNotes) {
      if (note.tagIds) {
        for (const tag of note.tagIds) {
          tagSet.add(tag);
        }
      }
    }
    return Array.from(tagSet).sort();
  }, [allNotes]);

  // Compute results
  const results: SearchResult[] = useMemo(() => {
    const items: SearchResult[] = [];

    switch (mode) {
      case 'notes': {
        const filtered = allNotes
          .filter(n => fuzzyMatch(n.title || 'Untitled', query))
          .sort((a, b) => {
            // Pinned first, then by updatedAt
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          })
          .slice(0, 50);

        for (const note of filtered) {
          const nbName = note.notebookId ? notebookMap[note.notebookId] : undefined;
          items.push({
            type: 'note',
            id: note.id,
            title: note.title || 'Untitled',
            subtitle: nbName,
            icon: getNoteIcon(note),
            noteId: note.id,
          });
        }
        break;
      }

      case 'headings': {
        for (const note of allNotes) {
          const headings = extractHeadings(note.content);
          for (const h of headings) {
            if (fuzzyMatch(h.text, query)) {
              items.push({
                type: 'heading',
                id: `${note.id}-h-${h.pos}`,
                title: h.text,
                subtitle: `${note.title || 'Untitled'} \u203A H${h.level}`,
                icon: `H${h.level}`,
                noteId: note.id,
                pos: h.pos,
              });
            }
          }
          if (items.length >= 50) break;
        }
        break;
      }

      case 'commands': {
        for (const cmd of commands) {
          if (fuzzyMatch(cmd.label, query)) {
            items.push({
              type: 'command',
              id: cmd.id,
              title: cmd.label,
              subtitle: cmd.shortcut,
              icon: '\u2318',
              action: cmd.action,
            });
          }
        }
        break;
      }

      case 'tags': {
        for (const tag of allTags) {
          if (fuzzyMatch(tag, query)) {
            // Count notes with this tag
            const count = allNotes.filter(n => n.tagIds?.includes(tag)).length;
            items.push({
              type: 'tag',
              id: `tag-${tag}`,
              title: tag,
              subtitle: `${count} note${count !== 1 ? 's' : ''}`,
              icon: '#',
            });
          }
          if (items.length >= 50) break;
        }
        break;
      }
    }

    return items;
  }, [mode, query, allNotes, notebookMap, commands, allTags]);

  // Reset on open/close
  useEffect(() => {
    if (isOpen) {
      setInput('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Clamp selected index
  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const selectResult = useCallback((result: SearchResult) => {
    if (result.type === 'note' && result.noteId) {
      onSelectNote(result.noteId);
      onClose();
    } else if (result.type === 'heading' && result.noteId != null && result.pos != null) {
      if (onSelectHeading) {
        onSelectHeading(result.noteId, result.pos);
      } else {
        onSelectNote(result.noteId);
      }
      onClose();
    } else if (result.type === 'command' && result.action) {
      result.action();
      onClose();
    } else if (result.type === 'tag') {
      // For tags, we could filter notes — for now just close
      onClose();
    }
  }, [onSelectNote, onSelectHeading, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          selectResult(results[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [results, selectedIndex, selectResult, onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  const modeLabel: Record<SearchMode, string> = {
    notes: t('notes.quickSwitcher.searchNotes', 'Search notes...'),
    headings: t('notes.quickSwitcher.searchHeadings', 'Search headings...'),
    commands: t('notes.quickSwitcher.searchCommands', 'Search commands...'),
    tags: t('notes.quickSwitcher.searchTags', 'Search tags...'),
  };

  return (
    <div className="qs-plus__overlay" onClick={handleBackdropClick}>
      <div className="qs-plus" role="dialog" aria-modal="true">
        {/* Search Input */}
        <div className="qs-plus__input-container">
          {mode !== 'notes' && (
            <span className="qs-plus__mode-badge">
              {mode === 'headings' ? '#' : mode === 'commands' ? '>' : '@'}
            </span>
          )}
          <input
            ref={inputRef}
            className="qs-plus__input"
            type="text"
            value={input}
            onChange={e => { setInput(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder={modeLabel[mode]}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="qs-plus__hints">
            <span className="qs-plus__hint" title="Search headings">#</span>
            <span className="qs-plus__hint" title="Search commands">&gt;</span>
            <span className="qs-plus__hint" title="Search tags">@</span>
          </div>
        </div>

        {/* Results */}
        <div className="qs-plus__results" ref={listRef}>
          {results.length === 0 && (
            <div className="qs-plus__empty">
              {query
                ? t('notes.quickSwitcher.noResults', 'No results found')
                : t('notes.quickSwitcher.typeToSearch', 'Type to search...')}
            </div>
          )}
          {results.map((result, index) => (
            <button
              key={result.id}
              className={`qs-plus__result ${index === selectedIndex ? 'qs-plus__result--selected' : ''}`}
              onClick={() => selectResult(result)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className={`qs-plus__result-icon qs-plus__result-icon--${result.type}`}>
                {result.icon}
              </span>
              <div className="qs-plus__result-body">
                <span className="qs-plus__result-title">
                  {highlightMatch(result.title, query)}
                </span>
                {result.subtitle && (
                  <span className="qs-plus__result-subtitle">
                    {result.subtitle}
                  </span>
                )}
              </div>
              <span className="qs-plus__result-type">
                {result.type}
              </span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="qs-plus__footer">
          <span className="qs-plus__footer-hint">
            <kbd className="qs-plus__kbd">&uarr;&darr;</kbd> {t('notes.quickSwitcher.navigate', 'navigate')}
          </span>
          <span className="qs-plus__footer-hint">
            <kbd className="qs-plus__kbd">&crarr;</kbd> {t('notes.quickSwitcher.select', 'select')}
          </span>
          <span className="qs-plus__footer-hint">
            <kbd className="qs-plus__kbd">esc</kbd> {t('notes.quickSwitcher.close', 'close')}
          </span>
        </div>
      </div>
    </div>
  );
};

export default QuickSwitcherPlus;
