/**
 * DatabaseView — Filarr Notes
 *
 * Notion-like database view for notes. Displays notes as a filterable,
 * sortable table with properties (columns). Supports table and board views.
 *
 * Properties are derived from note metadata: title, tags, notebook, status,
 * dates, word count, links. Users can add custom properties stored in the
 * note's content frontmatter.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  selectAllNotes,
  selectAllNotebooks,
  selectNote,
  setEditingNote,
  updateNote,
  setNoteNotebook,
  togglePinNote,
  deleteNote,
} from '../../../store/slices/notesSlice';
import type { Note, Notebook } from '../../../types/notes';
import './DatabaseView.css';

// ==================== Types ====================

type PropertyType = 'text' | 'date' | 'select' | 'number' | 'checkbox' | 'tags';

interface DatabaseProperty {
  id: string;
  name: string;
  type: PropertyType;
  /** For select type: available options */
  options?: string[];
}

type ViewType = 'table' | 'board';

interface SortConfig {
  propertyId: string;
  direction: 'asc' | 'desc';
}

interface FilterConfig {
  propertyId: string;
  operator: 'equals' | 'contains' | 'isEmpty' | 'isNotEmpty';
  value: string;
}

// ==================== Default Properties ====================

const DEFAULT_PROPERTIES: DatabaseProperty[] = [
  { id: 'title', name: 'Title', type: 'text' },
  { id: 'notebook', name: 'Notebook', type: 'select' },
  { id: 'tags', name: 'Tags', type: 'tags' },
  { id: 'updatedAt', name: 'Modified', type: 'date' },
  { id: 'createdAt', name: 'Created', type: 'date' },
  { id: 'wordCount', name: 'Words', type: 'number' },
  { id: 'isPinned', name: 'Pinned', type: 'checkbox' },
  { id: 'links', name: 'Links', type: 'number' },
];

// ==================== Property Value Getter ====================

function getPropertyValue(note: Note, propId: string, notebooks: Notebook[]): string {
  switch (propId) {
    case 'title': return note.title || 'Untitled';
    case 'notebook': {
      const nb = notebooks.find((n) => n.id === note.notebookId);
      return nb?.name || '';
    }
    case 'tags': return note.tagIds.join(', ');
    case 'updatedAt': return new Date(note.updatedAt).toLocaleDateString();
    case 'createdAt': return new Date(note.createdAt).toLocaleDateString();
    case 'wordCount': return String(note.wordCount);
    case 'isPinned': return note.isPinned ? 'Yes' : '';
    case 'links': return String(note.linkedNoteIds.length);
    default: return '';
  }
}

function getRawValue(note: Note, propId: string): string | number | boolean {
  switch (propId) {
    case 'title': return note.title || '';
    case 'updatedAt': return note.updatedAt;
    case 'createdAt': return note.createdAt;
    case 'wordCount': return note.wordCount;
    case 'isPinned': return note.isPinned;
    case 'links': return note.linkedNoteIds.length;
    default: return '';
  }
}

// ==================== Component ====================

export const DatabaseView: React.FC = React.memo(function DatabaseView() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const notes = useSelector(selectAllNotes);
  const notebooks = useSelector(selectAllNotebooks);

  const [viewType, setViewType] = useState<ViewType>('table');
  const [visibleProps, setVisibleProps] = useState<string[]>(
    DEFAULT_PROPERTIES.map((p) => p.id)
  );
  const [sort, setSort] = useState<SortConfig>({ propertyId: 'updatedAt', direction: 'desc' });
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const properties = DEFAULT_PROPERTIES;

  // Filter and sort
  const processedNotes = useMemo(() => {
    let result = [...notes];

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.plainText.toLowerCase().includes(q)
      );
    }

    // Filters
    for (const filter of filters) {
      result = result.filter((n) => {
        const val = getPropertyValue(n, filter.propertyId, notebooks).toLowerCase();
        switch (filter.operator) {
          case 'equals': return val === filter.value.toLowerCase();
          case 'contains': return val.includes(filter.value.toLowerCase());
          case 'isEmpty': return !val;
          case 'isNotEmpty': return !!val;
          default: return true;
        }
      });
    }

    // Sort
    result.sort((a, b) => {
      const aVal = getRawValue(a, sort.propertyId);
      const bVal = getRawValue(b, sort.propertyId);
      let cmp = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sort.direction === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [notes, notebooks, searchQuery, filters, sort]);

  const handleSelectNote = useCallback(
    (noteId: string) => {
      dispatch(selectNote(noteId));
      dispatch(setEditingNote(noteId));
    },
    [dispatch]
  );

  const handleSort = useCallback((propertyId: string) => {
    setSort((prev) =>
      prev.propertyId === propertyId
        ? { propertyId, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { propertyId, direction: 'asc' }
    );
  }, []);

  const toggleProperty = useCallback((propId: string) => {
    setVisibleProps((prev) =>
      prev.includes(propId) ? prev.filter((p) => p !== propId) : [...prev, propId]
    );
  }, []);

  const visibleProperties = useMemo(
    () => properties.filter((p) => visibleProps.includes(p.id)),
    [properties, visibleProps]
  );

  // Board view: group by notebook
  const boardGroups = useMemo(() => {
    if (viewType !== 'board') return [];
    const groups: { id: string; name: string; color: string; notes: Note[] }[] = [];
    const noNotebook: Note[] = [];

    for (const nb of notebooks) {
      groups.push({
        id: nb.id,
        name: nb.name,
        color: nb.color || '#4682b4',
        notes: processedNotes.filter((n) => n.notebookId === nb.id),
      });
    }
    noNotebook.push(...processedNotes.filter((n) => !n.notebookId));
    if (noNotebook.length > 0) {
      groups.unshift({ id: '__none', name: t('notes.noNotebook', 'No notebook'), color: '#94a3b8', notes: noNotebook });
    }
    return groups;
  }, [viewType, notebooks, processedNotes, t]);

  return (
    <div className="database-view">
      {/* Toolbar */}
      <div className="database-view__toolbar">
        <div className="database-view__search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="database-view__search-input"
            placeholder={t('notes.searchDatabase', 'Filter...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="database-view__actions">
          <button
            className={`database-view__view-btn ${viewType === 'table' ? 'is-active' : ''}`}
            onClick={() => setViewType('table')}
            title="Table"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
          <button
            className={`database-view__view-btn ${viewType === 'board' ? 'is-active' : ''}`}
            onClick={() => setViewType('board')}
            title="Board"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" />
              <rect x="17" y="3" width="5" height="15" rx="1" />
            </svg>
          </button>
          <span className="database-view__count">
            {processedNotes.length} {t('notes.notesCount', 'note(s)')}
          </span>
        </div>
      </div>

      {/* Table View */}
      {viewType === 'table' && (
        <div className="database-view__table-wrapper">
          <table className="database-view__table">
            <thead>
              <tr>
                {visibleProperties.map((prop) => (
                  <th
                    key={prop.id}
                    className="database-view__th"
                    onClick={() => handleSort(prop.id)}
                  >
                    <span>{prop.name}</span>
                    {sort.propertyId === prop.id && (
                      <span className="database-view__sort-indicator">
                        {sort.direction === 'asc' ? '\u2191' : '\u2193'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processedNotes.map((note) => (
                <tr
                  key={note.id}
                  className="database-view__row"
                  onClick={() => handleSelectNote(note.id)}
                >
                  {visibleProperties.map((prop) => (
                    <td key={prop.id} className="database-view__td">
                      {prop.id === 'title' ? (
                        <span className="database-view__title-cell">
                          {note.icon && <span className="database-view__cell-icon">{note.icon}</span>}
                          <span>{note.title || 'Untitled'}</span>
                        </span>
                      ) : prop.id === 'isPinned' ? (
                        note.isPinned ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1}>
                            <polyline points="20,6 9,17 4,12" />
                          </svg>
                        ) : null
                      ) : prop.id === 'notebook' ? (
                        (() => {
                          const nb = notebooks.find((n) => n.id === note.notebookId);
                          return nb ? (
                            <span className="database-view__notebook-badge" style={{ borderColor: nb.color || '#4682b4' }}>
                              {nb.icon || ''} {nb.name}
                            </span>
                          ) : null;
                        })()
                      ) : prop.id === 'tags' && note.tagIds.length > 0 ? (
                        <span className="database-view__tags-cell">
                          {note.tagIds.slice(0, 3).map((tag) => (
                            <span key={tag} className="database-view__tag-badge">{tag}</span>
                          ))}
                          {note.tagIds.length > 3 && <span className="database-view__tag-more">+{note.tagIds.length - 3}</span>}
                        </span>
                      ) : (
                        <span>{getPropertyValue(note, prop.id, notebooks)}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Board View */}
      {viewType === 'board' && (
        <div className="database-view__board">
          {boardGroups.map((group) => (
            <div key={group.id} className="database-view__board-column">
              <div className="database-view__board-column-header">
                <span className="database-view__board-dot" style={{ background: group.color }} />
                <span>{group.name}</span>
                <span className="database-view__board-count">{group.notes.length}</span>
              </div>
              <div className="database-view__board-cards">
                {group.notes.map((note) => (
                  <div
                    key={note.id}
                    className="database-view__board-card"
                    onClick={() => handleSelectNote(note.id)}
                  >
                    <div className="database-view__board-card-title">
                      {note.icon && <span>{note.icon}</span>}
                      <span>{note.title || 'Untitled'}</span>
                    </div>
                    <div className="database-view__board-card-meta">
                      <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                      {note.wordCount > 0 && <span>{note.wordCount} words</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
