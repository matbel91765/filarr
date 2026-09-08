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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

import * as profileStorage from '../../../services/core/profileStorage';
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

const DB_POPOVER_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  zIndex: 30,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 10,
  minWidth: 300,
  maxHeight: 340,
  overflowY: 'auto',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
};

const DB_SELECT_STYLE: React.CSSProperties = {
  padding: '3px 6px',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
  fontSize: 12,
};

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
    case 'title':
      return note.title || 'Untitled';
    case 'notebook': {
      const nb = notebooks.find((n) => n.id === note.notebookId);
      return nb?.name || '';
    }
    case 'tags':
      return note.tagIds.join(', ');
    case 'updatedAt':
      return new Date(note.updatedAt).toLocaleDateString();
    case 'createdAt':
      return new Date(note.createdAt).toLocaleDateString();
    case 'wordCount':
      return String(note.wordCount);
    case 'isPinned':
      return note.isPinned ? 'Yes' : '';
    case 'links':
      return String(note.linkedNoteIds.length);
    default:
      return '';
  }
}

function getRawValue(note: Note, propId: string): string | number | boolean {
  switch (propId) {
    case 'title':
      return note.title || '';
    case 'updatedAt':
      return note.updatedAt;
    case 'createdAt':
      return note.createdAt;
    case 'wordCount':
      return note.wordCount;
    case 'isPinned':
      return note.isPinned;
    case 'links':
      return note.linkedNoteIds.length;
    default:
      return '';
  }
}

// ==================== Persistence ====================

const STORAGE_KEY = 'filarr.databaseView.config.v1';

interface PersistedConfig {
  viewType: ViewType;
  visibleProps: string[];
  sort: SortConfig;
  filters: FilterConfig[];
}

function loadPersistedConfig(): Partial<PersistedConfig> {
  try {
    const raw = profileStorage.getItemWithLegacyFallback(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedConfig>;
    if (typeof parsed !== 'object' || parsed === null) return {};
    // Drop any visibleProps that no longer correspond to a known property —
    // protects against schema drift across versions.
    const knownIds = new Set(DEFAULT_PROPERTIES.map((p) => p.id));
    if (Array.isArray(parsed.visibleProps)) {
      parsed.visibleProps = parsed.visibleProps.filter(
        (id): id is string => typeof id === 'string' && knownIds.has(id)
      );
    }
    return parsed;
  } catch {
    return {};
  }
}

function persistConfig(config: PersistedConfig): void {
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Quota / disabled storage — silent. Defaults will apply next launch.
  }
}

// ==================== Component ====================

interface DatabaseViewProps {
  /** See MasonryView — opening a note switches to list mode + focuses editor. */
  onOpenNote?: (id: string) => void;
}

export const DatabaseView: React.FC<DatabaseViewProps> = React.memo(function DatabaseView({
  onOpenNote,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const notes = useSelector(selectAllNotes);
  const notebooks = useSelector(selectAllNotebooks);

  // Hydrate from localStorage on first render — a missing key just gives
  // back `{}` and the useState defaults take over.
  const persisted = useMemo(() => loadPersistedConfig(), []);

  const [viewType, setViewType] = useState<ViewType>(persisted.viewType ?? 'table');
  const [visibleProps, setVisibleProps] = useState<string[]>(
    persisted.visibleProps && persisted.visibleProps.length > 0
      ? persisted.visibleProps
      : DEFAULT_PROPERTIES.map((p) => p.id)
  );
  const [sort, setSort] = useState<SortConfig>(
    persisted.sort ?? { propertyId: 'updatedAt', direction: 'desc' }
  );
  const [filters, setFilters] = useState<FilterConfig[]>(persisted.filters ?? []);
  const [showFilters, setShowFilters] = useState(false);
  const [showProps, setShowProps] = useState(false);
  const updateFilter = useCallback((i: number, patch: Partial<FilterConfig>) => {
    setFilters((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }, []);
  const [searchQuery, setSearchQuery] = useState('');

  // Persist whenever any of the user-visible config bits change. Search
  // query is intentionally excluded — it's transient input, not a setting.
  useEffect(() => {
    persistConfig({ viewType, visibleProps, sort, filters });
  }, [viewType, visibleProps, sort, filters]);

  const properties = DEFAULT_PROPERTIES;

  // Filter and sort
  const processedNotes = useMemo(() => {
    let result = [...notes];

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) => n.title.toLowerCase().includes(q) || n.plainText.toLowerCase().includes(q)
      );
    }

    // Filters
    for (const filter of filters) {
      result = result.filter((n) => {
        const val = getPropertyValue(n, filter.propertyId, notebooks).toLowerCase();
        switch (filter.operator) {
          case 'equals':
            return val === filter.value.toLowerCase();
          case 'contains':
            return val.includes(filter.value.toLowerCase());
          case 'isEmpty':
            return !val;
          case 'isNotEmpty':
            return !!val;
          default:
            return true;
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
      if (onOpenNote) {
        onOpenNote(noteId);
      } else {
        dispatch(setEditingNote(noteId));
      }
    },
    [dispatch, onOpenNote]
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
      groups.unshift({
        id: '__none',
        name: t('notes.noNotebook', 'No notebook'),
        color: '#94a3b8',
        notes: noNotebook,
      });
    }
    return groups;
  }, [viewType, notebooks, processedNotes, t]);

  return (
    <div className="database-view">
      {/* Toolbar */}
      <div className="database-view__toolbar">
        <div className="database-view__search">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
          <button
            className={`database-view__view-btn ${viewType === 'board' ? 'is-active' : ''}`}
            onClick={() => setViewType('board')}
            title="Board"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="3" y="3" width="5" height="18" rx="1" />
              <rect x="10" y="3" width="5" height="12" rx="1" />
              <rect x="17" y="3" width="5" height="15" rx="1" />
            </svg>
          </button>

          {/* Filter popover */}
          <div style={{ position: 'relative' }}>
            <button
              className={`database-view__view-btn ${filters.length > 0 ? 'is-active' : ''}`}
              onClick={() => {
                setShowFilters((v) => !v);
                setShowProps(false);
              }}
              aria-expanded={showFilters}
              title={t('notes.dbFilter', 'Filtrer')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
              {filters.length > 0 && <span style={{ marginLeft: 4 }}>{filters.length}</span>}
            </button>
            {showFilters && (
              <div className="database-view__popover" style={DB_POPOVER_STYLE}>
                {filters.length === 0 && (
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-tertiary)',
                      margin: '2px 0 8px',
                    }}
                  >
                    {t('notes.dbNoFilters', 'Aucun filtre')}
                  </p>
                )}
                {filters.map((f, i) => (
                  <div
                    key={i}
                    style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}
                  >
                    <select
                      value={f.propertyId}
                      onChange={(e) => updateFilter(i, { propertyId: e.target.value })}
                      style={DB_SELECT_STYLE}
                    >
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={f.operator}
                      onChange={(e) =>
                        updateFilter(i, { operator: e.target.value as FilterConfig['operator'] })
                      }
                      style={DB_SELECT_STYLE}
                    >
                      <option value="contains">{t('notes.dbOpContains', 'contient')}</option>
                      <option value="equals">{t('notes.dbOpEquals', 'égal à')}</option>
                      <option value="isEmpty">{t('notes.dbOpEmpty', 'est vide')}</option>
                      <option value="isNotEmpty">{t('notes.dbOpNotEmpty', 'non vide')}</option>
                    </select>
                    {(f.operator === 'contains' || f.operator === 'equals') && (
                      <input
                        value={f.value}
                        onChange={(e) => updateFilter(i, { value: e.target.value })}
                        placeholder={t('notes.dbValue', 'valeur')}
                        style={{ ...DB_SELECT_STYLE, flex: 1, minWidth: 50 }}
                      />
                    )}
                    <button
                      onClick={() => setFilters(filters.filter((_, j) => j !== i))}
                      title={t('common.remove', 'Retirer')}
                      aria-label={t('common.remove', 'Retirer')}
                      style={{ padding: '2px 6px', color: 'var(--color-text-tertiary)' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setFilters([
                      ...filters,
                      { propertyId: properties[0].id, operator: 'contains', value: '' },
                    ])
                  }
                  style={{ fontSize: 12, marginTop: 4, color: 'var(--color-primary-600)' }}
                >
                  + {t('notes.dbAddFilter', 'Ajouter un filtre')}
                </button>
              </div>
            )}
          </div>

          {/* Properties (column visibility) popover */}
          <div style={{ position: 'relative' }}>
            <button
              className="database-view__view-btn"
              onClick={() => {
                setShowProps((v) => !v);
                setShowFilters(false);
              }}
              aria-expanded={showProps}
              title={t('notes.dbProperties', 'Propriétés')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
            {showProps && (
              <div className="database-view__popover" style={DB_POPOVER_STYLE}>
                {properties.map((p) => (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 2px',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={visibleProps.includes(p.id)}
                      onChange={() => toggleProperty(p.id)}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
          </div>

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
                  tabIndex={0}
                  onClick={() => handleSelectNote(note.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSelectNote(note.id);
                    }
                  }}
                >
                  {visibleProperties.map((prop) => (
                    <td key={prop.id} className="database-view__td">
                      {prop.id === 'title' ? (
                        <span className="database-view__title-cell">
                          {note.icon && (
                            <span className="database-view__cell-icon">{note.icon}</span>
                          )}
                          <span>{note.title || 'Untitled'}</span>
                        </span>
                      ) : prop.id === 'isPinned' ? (
                        note.isPinned ? (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth={1}
                          >
                            <polyline points="20,6 9,17 4,12" />
                          </svg>
                        ) : null
                      ) : prop.id === 'notebook' ? (
                        (() => {
                          const nb = notebooks.find((n) => n.id === note.notebookId);
                          return nb ? (
                            <span
                              className="database-view__notebook-badge"
                              style={{ borderColor: nb.color || '#4682b4' }}
                            >
                              {nb.icon || ''} {nb.name}
                            </span>
                          ) : null;
                        })()
                      ) : prop.id === 'tags' && note.tagIds.length > 0 ? (
                        <span className="database-view__tags-cell">
                          {note.tagIds.slice(0, 3).map((tag) => (
                            <span key={tag} className="database-view__tag-badge">
                              {tag}
                            </span>
                          ))}
                          {note.tagIds.length > 3 && (
                            <span className="database-view__tag-more">
                              +{note.tagIds.length - 3}
                            </span>
                          )}
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
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectNote(note.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectNote(note.id);
                      }
                    }}
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
