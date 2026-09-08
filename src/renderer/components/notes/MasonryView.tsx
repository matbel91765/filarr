/**
 * MasonryView — Filarr Notes
 *
 * CSS column-count masonry layout showing note cards
 * with title, preview, color accent, and badges.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { selectFilteredNotes, setEditingNote } from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';
import { isDarkTheme } from '../../utils/theme';
import './MasonryView.css';

import * as profileStorage from '../../../services/core/profileStorage';
// ==================== Card Colors ====================

const CARD_COLORS_LIGHT = [
  'rgba(135, 206, 235, 0.1)',
  'rgba(52, 211, 153, 0.08)',
  'rgba(251, 191, 36, 0.08)',
  'rgba(167, 139, 250, 0.08)',
  'rgba(244, 114, 182, 0.08)',
  'rgba(96, 165, 250, 0.08)',
];

const CARD_COLORS_DARK = [
  'rgba(135, 206, 235, 0.08)',
  'rgba(52, 211, 153, 0.10)',
  'rgba(251, 191, 36, 0.10)',
  'rgba(167, 139, 250, 0.10)',
  'rgba(244, 114, 182, 0.10)',
  'rgba(96, 165, 250, 0.10)',
];

// Stable per-note tint: hash the id once so re-sorting / filtering keeps
// each card the same color, preserving visual anchors that users rely on
// to recognize specific notes at a glance.
function hashNoteId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getCardColor(noteId: string): string {
  const colors = isDarkTheme() ? CARD_COLORS_DARK : CARD_COLORS_LIGHT;
  return colors[hashNoteId(noteId) % colors.length];
}

function getPreview(plainText: string, maxLen = 120): string {
  if (!plainText) return '';
  const clean = plainText.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
}

// ==================== Sort + Filter ====================

const MASONRY_CONFIG_KEY = 'filarr.masonryView.config.v1';

type SortKey = 'updatedAt' | 'createdAt' | 'title' | 'wordCount' | 'linkCount';
type SortDir = 'asc' | 'desc';

interface MasonryConfig {
  sortKey: SortKey;
  sortDir: SortDir;
  notebookId: string | null; // null = all notebooks
  tagId: string | null; // null = no tag filter
  hidePinned: boolean;
}

const DEFAULT_MASONRY_CONFIG: MasonryConfig = {
  sortKey: 'updatedAt',
  sortDir: 'desc',
  notebookId: null,
  tagId: null,
  hidePinned: false,
};

function loadMasonryConfig(): MasonryConfig {
  try {
    const raw = profileStorage.getItemWithLegacyFallback(MASONRY_CONFIG_KEY);
    if (!raw) return DEFAULT_MASONRY_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_MASONRY_CONFIG, ...parsed };
  } catch {
    return DEFAULT_MASONRY_CONFIG;
  }
}

function persistMasonryConfig(config: MasonryConfig): void {
  try {
    profileStorage.setItem(MASONRY_CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* quota / disabled — silent */
  }
}

function compareNotes(a: Note, b: Note, key: SortKey): number {
  switch (key) {
    case 'title':
      return (a.title || '').localeCompare(b.title || '');
    case 'createdAt':
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    case 'wordCount':
      return (a.wordCount || 0) - (b.wordCount || 0);
    case 'linkCount':
      return (a.linkedNoteIds?.length || 0) - (b.linkedNoteIds?.length || 0);
    case 'updatedAt':
    default:
      return new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
  }
}

// ==================== Component ====================

interface MasonryViewProps {
  /**
   * Called when the user clicks a card. Provided by NotesView so that
   * opening a note from masonry mode also switches back to the list
   * view where the editor is actually rendered. When unset, falls back
   * to a plain `setEditingNote` dispatch (legacy callers).
   */
  onOpenNote?: (id: string) => void;
}

export const MasonryView: React.FC<MasonryViewProps> = React.memo(function MasonryView({
  onOpenNote,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const notes = useSelector(selectFilteredNotes);
  const selectedNoteId = useSelector((s: RootState) => s.notes.selectedNoteId);
  const notebooks = useSelector((s: RootState) => s.notes.notebooks);
  const tags = useSelector((s: RootState) => (s.tags?.tags ? s.tags.tags : [])) as Array<{
    id: string;
    name: string;
  }>;

  const [config, setConfig] = useState<MasonryConfig>(() => loadMasonryConfig());
  useEffect(() => {
    persistMasonryConfig(config);
  }, [config]);

  // Apply masonry-scoped sort + filter on top of selectFilteredNotes (which
  // already applies the global search / folder / daily / notebook filter).
  // The notebook filter here is independent so the user can pin Masonry to
  // a specific notebook without affecting other views.
  const visibleNotes = useMemo(() => {
    let list = notes.slice();
    if (config.notebookId) {
      list = list.filter((n) => n.notebookId === config.notebookId);
    }
    if (config.tagId) {
      list = list.filter((n) => n.tagIds?.includes(config.tagId as string));
    }
    if (config.hidePinned) {
      list = list.filter((n) => !n.isPinned);
    }
    list.sort((a, b) => {
      const cmp = compareNotes(a, b, config.sortKey);
      return config.sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [notes, config]);

  const handleSelect = useCallback(
    (noteId: string) => {
      if (onOpenNote) {
        onOpenNote(noteId);
      } else {
        dispatch(setEditingNote(noteId));
      }
    },
    [dispatch, onOpenNote]
  );

  const notebookList = useMemo(
    () => Object.values(notebooks).sort((a, b) => (a?.name || '').localeCompare(b?.name || '')),
    [notebooks]
  );

  return (
    <div className="masonry-view-container">
      <div className="masonry-view__toolbar">
        <label className="masonry-view__field">
          <span className="masonry-view__field-label">{t('notes.masonrySortBy', 'Sort')}</span>
          <select
            value={config.sortKey}
            onChange={(e) => setConfig((c) => ({ ...c, sortKey: e.target.value as SortKey }))}
          >
            <option value="updatedAt">{t('notes.sortUpdatedAt', 'Updated')}</option>
            <option value="createdAt">{t('notes.sortCreatedAt', 'Created')}</option>
            <option value="title">{t('notes.sortTitle', 'Title')}</option>
            <option value="wordCount">{t('notes.sortWordCount', 'Word count')}</option>
            <option value="linkCount">{t('notes.sortLinkCount', 'Links')}</option>
          </select>
        </label>

        <button
          type="button"
          className="masonry-view__dir-btn"
          onClick={() =>
            setConfig((c) => ({ ...c, sortDir: c.sortDir === 'asc' ? 'desc' : 'asc' }))
          }
          title={
            config.sortDir === 'asc'
              ? t('notes.sortAsc', 'Ascending')
              : t('notes.sortDesc', 'Descending')
          }
        >
          {config.sortDir === 'asc' ? '↑' : '↓'}
        </button>

        {notebookList.length > 0 && (
          <label className="masonry-view__field">
            <span className="masonry-view__field-label">
              {t('notes.masonryNotebook', 'Notebook')}
            </span>
            <select
              value={config.notebookId ?? ''}
              onChange={(e) => setConfig((c) => ({ ...c, notebookId: e.target.value || null }))}
            >
              <option value="">{t('notes.masonryAllNotebooks', 'All notebooks')}</option>
              {notebookList.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {tags.length > 0 && (
          <label className="masonry-view__field">
            <span className="masonry-view__field-label">{t('notes.masonryTag', 'Tag')}</span>
            <select
              value={config.tagId ?? ''}
              onChange={(e) => setConfig((c) => ({ ...c, tagId: e.target.value || null }))}
            >
              <option value="">{t('notes.masonryAllTags', 'All tags')}</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="masonry-view__checkbox">
          <input
            type="checkbox"
            checked={config.hidePinned}
            onChange={(e) => setConfig((c) => ({ ...c, hidePinned: e.target.checked }))}
          />
          {t('notes.masonryHidePinned', 'Hide pinned')}
        </label>

        <span className="masonry-view__count">
          {t('notes.masonryCount', '{{count}} notes', { count: visibleNotes.length })}
        </span>
      </div>

      {visibleNotes.length === 0 ? (
        <div className="masonry-view__empty">
          <p>
            {notes.length === 0
              ? t('notes.emptyTitle', 'No notes yet')
              : t('notes.masonryNoMatch', 'No notes match the current filters.')}
          </p>
        </div>
      ) : (
        <div className="masonry-view">
          {visibleNotes.map((note) => (
            <MasonryCard
              key={note.id}
              note={note}
              isSelected={note.id === selectedNoteId}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// ==================== Card ====================

interface MasonryCardProps {
  note: Note;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const MasonryCard: React.FC<MasonryCardProps> = React.memo(function MasonryCard({
  note,
  isSelected,
  onSelect,
}) {
  const { t } = useTranslation();
  const preview = getPreview(note.plainText);

  return (
    <div
      className={`masonry-card ${isSelected ? 'masonry-card--selected' : ''} ${note.isPinned ? 'masonry-card--pinned' : ''}`}
      style={{ background: getCardColor(note.id) }}
      onClick={() => onSelect(note.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(note.id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={note.title || t('notes.untitled', 'Untitled')}
    >
      <div className="masonry-card__header">
        <h3 className="masonry-card__title">{note.title || t('notes.untitled', 'Untitled')}</h3>
        {note.isPinned && (
          <span className="masonry-card__pin">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1z" />
            </svg>
          </span>
        )}
      </div>
      {preview && <p className="masonry-card__preview">{preview}</p>}
      <div className="masonry-card__footer">
        <span className="masonry-card__date">
          {new Date(note.updatedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
          })}
        </span>
        {note.wordCount > 0 && (
          <span className="masonry-card__words">
            {note.wordCount} {t('notes.words', 'words')}
          </span>
        )}
        {note.linkedNoteIds.length > 0 && (
          <span className="masonry-card__links">
            {note.linkedNoteIds.length} {t('notes.links', 'links')}
          </span>
        )}
        {note.isDaily && (
          <span className="masonry-card__badge masonry-card__badge--daily">
            {t('notes.dailyNote', 'Daily')}
          </span>
        )}
      </div>
    </div>
  );
});

export default MasonryView;
