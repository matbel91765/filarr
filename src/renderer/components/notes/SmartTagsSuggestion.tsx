/**
 * SmartTagsSuggestion — Filarr Notes
 *
 * Displays TF-IDF auto-suggested tags below backlinks.
 * Each suggestion has an "Add" button that associates the tag with the note.
 * Shows existing note tags with remove capability.
 */

import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { createTag } from '../../../store/slices/tagsSlice';
import { addTagToNote, removeTagFromNote } from '../../../store/slices/notesSlice';
import { suggestTags, type SmartTagSuggestion } from '../../../services/notes/smartTagService';
import './SmartTagsSuggestion.css';

// ==================== Icons ====================

const SparkleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
  </svg>
);

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const TagIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

// ==================== Component ====================

interface SmartTagsSuggestionProps {
  noteId: string;
}

export const SmartTagsSuggestion: React.FC<SmartTagsSuggestionProps> = React.memo(
  function SmartTagsSuggestion({ noteId }) {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const notesById = useSelector((s: RootState) => s.notes.byId);
    const existingTags = useSelector((s: RootState) => s.tags?.tags ?? []);
    const note = notesById[noteId];
    const noteTagIds = note?.tagIds || [];

    // Get tag names for display
    const noteTags = useMemo(() => {
      return noteTagIds
        .map((tagId) => existingTags.find((t: any) => t.id === tagId))
        .filter(Boolean);
    }, [noteTagIds, existingTags]);

    const suggestions: SmartTagSuggestion[] = useMemo(() => {
      const all = suggestTags(noteId, notesById, 5);
      // Filter out tags already on this note
      const existingNames = new Set(noteTags.map((t: any) => t.name.toLowerCase()));
      return all.filter((s) => !existingNames.has(s.tag.toLowerCase()));
    }, [noteId, notesById, noteTags]);

    const handleAddTag = useCallback(
      async (tagName: string) => {
        // Find or create tag, then associate with note
        const existing = existingTags.find(
          (t: any) => t.name.toLowerCase() === tagName.toLowerCase()
        );
        if (existing) {
          dispatch(addTagToNote({ noteId, tagId: existing.id }));
        } else {
          const result = await dispatch(createTag({ name: tagName }));
          if (createTag.fulfilled.match(result)) {
            dispatch(addTagToNote({ noteId, tagId: result.payload.id }));
          }
        }
      },
      [dispatch, existingTags, noteId]
    );

    const handleRemoveTag = useCallback(
      (tagId: string) => {
        dispatch(removeTagFromNote({ noteId, tagId }));
      },
      [dispatch, noteId]
    );

    const hasTags = noteTags.length > 0;
    const hasSuggestions = suggestions.length > 0;

    if (!hasTags && !hasSuggestions) return null;

    return (
      <div className="smart-tags">
        {/* Existing tags */}
        {hasTags && (
          <>
            <div className="smart-tags__header">
              <TagIcon />
              <span>{t('notes.tags', 'Tags')}</span>
            </div>
            <div className="smart-tags__list">
              {noteTags.map((tag: any) => (
                <span key={tag.id} className="smart-tags__tag smart-tags__tag--existing">
                  <span className="smart-tags__tag-name">{tag.name}</span>
                  <button
                    className="smart-tags__tag-remove"
                    onClick={() => handleRemoveTag(tag.id)}
                    title={t('common.remove', 'Remove')}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          </>
        )}

        {/* Suggestions */}
        {hasSuggestions && (
          <>
            <div className="smart-tags__header">
              <SparkleIcon />
              <span>{t('notes.suggestedTags', 'Suggested Tags')}</span>
            </div>
            <div className="smart-tags__list">
              {suggestions.map((s) => (
                <button
                  key={s.tag}
                  className="smart-tags__tag"
                  onClick={() => handleAddTag(s.tag)}
                  title={`Score: ${s.score.toFixed(3)}`}
                >
                  <span className="smart-tags__tag-name">{s.tag}</span>
                  <PlusIcon />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }
);

export default SmartTagsSuggestion;
