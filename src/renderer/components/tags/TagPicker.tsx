/**
 * TagPicker Component
 *
 * Composant pour assigner des tags a des fichiers.
 * Supporte la selection multiple avec recherche
 * et la creation rapide de nouveaux tags.
 */

import React, { FC, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import clsx from 'clsx';
import type { AppDispatch, RootState } from '../../../store';
import type { HierarchicalTag } from '../../../types';
import {
  selectAllTags,
  selectSearchResults,
  setSearchQuery,
  addTagToFile,
  removeTagFromFile,
  selectFileTags,
  createTag,
} from '../../../store/slices/tagsSlice';
import { Input } from '../ui/Input/Input';
import Button from '../ui/Button/Button';
import { useNotification } from '../ui/Notification';
import './TagPicker.css';

// ==================== ICONS ====================

const TagIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const SearchIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

const CheckIcon: FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PlusIcon: FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const CloseIcon: FC = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ==================== TYPES ====================

interface TagPickerProps {
  fileId: string;
  className?: string;
  onTagsChange?: (tagIds: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  maxDisplayTags?: number;
}

// ==================== COMPONENT ====================

const TagPicker: FC<TagPickerProps> = ({
  fileId,
  className,
  onTagsChange,
  disabled = false,
  placeholder = 'Ajouter un tag...',
  maxDisplayTags = 5,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const allTags = useSelector((state: RootState) => selectAllTags(state as any));
  const searchResults = useSelector((state: RootState) => selectSearchResults(state as any));
  const fileTags = useSelector((state: RootState) => selectFileTags(state as any, fileId));
  const { success, error } = useNotification();

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setLocalSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fileTagIds = useMemo(() => fileTags.map(t => t.id), [fileTags]);

  // Filter tags based on search
  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) {
      return allTags;
    }
    const query = searchQuery.toLowerCase().trim();
    return allTags.filter(
      tag =>
        tag.name.toLowerCase().includes(query) ||
        tag.aliases.some(a => a.toLowerCase().includes(query))
    );
  }, [allTags, searchQuery]);

  // Check if exact match exists (for quick create)
  const exactMatchExists = useMemo(() => {
    if (!searchQuery.trim()) return true;
    return allTags.some(
      tag => tag.name.toLowerCase() === searchQuery.trim().toLowerCase()
    );
  }, [allTags, searchQuery]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setLocalSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handlers
  const handleToggleOpen = useCallback(() => {
    if (!disabled) {
      setIsOpen(prev => !prev);
      if (!isOpen) {
        setLocalSearchQuery('');
      }
    }
  }, [disabled, isOpen]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSearchQuery(e.target.value);
  }, []);

  const handleToggleTag = useCallback(
    async (tagId: string) => {
      const isSelected = fileTagIds.includes(tagId);

      try {
        if (isSelected) {
          await dispatch(removeTagFromFile({ fileId, tagId })).unwrap();
        } else {
          await dispatch(addTagToFile({ fileId, tagId })).unwrap();
        }

        const newTagIds = isSelected
          ? fileTagIds.filter(id => id !== tagId)
          : [...fileTagIds, tagId];
        onTagsChange?.(newTagIds);
      } catch (err) {
        error('Erreur lors de la modification des tags');
      }
    },
    [dispatch, fileId, fileTagIds, onTagsChange, error]
  );

  const handleRemoveTag = useCallback(
    async (e: React.MouseEvent, tagId: string) => {
      e.stopPropagation();
      try {
        await dispatch(removeTagFromFile({ fileId, tagId })).unwrap();
        const newTagIds = fileTagIds.filter(id => id !== tagId);
        onTagsChange?.(newTagIds);
      } catch (err) {
        error('Erreur lors de la suppression du tag');
      }
    },
    [dispatch, fileId, fileTagIds, onTagsChange, error]
  );

  const handleQuickCreate = useCallback(async () => {
    if (!searchQuery.trim() || exactMatchExists) return;

    setIsCreating(true);
    try {
      const result = await dispatch(
        createTag({
          name: searchQuery.trim(),
        })
      ).unwrap();

      // Add the new tag to the file
      await dispatch(addTagToFile({ fileId, tagId: result.id })).unwrap();

      const newTagIds = [...fileTagIds, result.id];
      onTagsChange?.(newTagIds);

      setLocalSearchQuery('');
      success('Tag cree et ajoute');
    } catch (err) {
      error('Erreur lors de la creation du tag');
    } finally {
      setIsCreating(false);
    }
  }, [dispatch, fileId, searchQuery, exactMatchExists, fileTagIds, onTagsChange, success, error]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setLocalSearchQuery('');
      } else if (e.key === 'Enter' && !exactMatchExists && searchQuery.trim()) {
        e.preventDefault();
        handleQuickCreate();
      }
    },
    [exactMatchExists, searchQuery, handleQuickCreate]
  );

  // Display tags (limited)
  const displayedTags = useMemo(() => {
    if (fileTags.length <= maxDisplayTags) {
      return fileTags;
    }
    return fileTags.slice(0, maxDisplayTags);
  }, [fileTags, maxDisplayTags]);

  const hiddenCount = fileTags.length - displayedTags.length;

  return (
    <div
      ref={containerRef}
      className={clsx('tag-picker', { 'tag-picker--disabled': disabled }, className)}
    >
      {/* Selected tags display */}
      <div
        className={clsx('tag-picker__display', { 'tag-picker__display--open': isOpen })}
        onClick={handleToggleOpen}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {fileTags.length === 0 ? (
          <span className="tag-picker__placeholder">
            <TagIcon />
            {placeholder}
          </span>
        ) : (
          <div className="tag-picker__tags">
            {displayedTags.map((tag) => (
              <span
                key={tag.id}
                className="tag-picker__tag"
                style={{ backgroundColor: tag.color }}
              >
                <span className="tag-picker__tag-name">{tag.name}</span>
                {!disabled && (
                  <button
                    className="tag-picker__tag-remove"
                    onClick={(e) => handleRemoveTag(e, tag.id)}
                    aria-label={`Supprimer ${tag.name}`}
                  >
                    <CloseIcon />
                  </button>
                )}
              </span>
            ))}
            {hiddenCount > 0 && (
              <span className="tag-picker__more">+{hiddenCount}</span>
            )}
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="tag-picker__dropdown" role="listbox">
          {/* Search input */}
          <div className="tag-picker__search">
            <Input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleKeyDown}
              placeholder="Rechercher ou creer..."
              size="sm"
              leftIcon={<SearchIcon />}
            />
          </div>

          {/* Quick create option */}
          {searchQuery.trim() && !exactMatchExists && (
            <button
              className="tag-picker__create"
              onClick={handleQuickCreate}
              disabled={isCreating}
            >
              <PlusIcon />
              <span>Creer "{searchQuery.trim()}"</span>
            </button>
          )}

          {/* Tags list */}
          <div className="tag-picker__list">
            {filteredTags.length === 0 ? (
              <div className="tag-picker__empty">
                {searchQuery.trim() ? (
                  <span>Aucun tag trouve</span>
                ) : (
                  <span>Aucun tag disponible</span>
                )}
              </div>
            ) : (
              filteredTags.map((tag) => {
                const isSelected = fileTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    className={clsx('tag-picker__option', {
                      'tag-picker__option--selected': isSelected,
                    })}
                    onClick={() => handleToggleTag(tag.id)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span
                      className="tag-picker__option-color"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="tag-picker__option-name">{tag.name}</span>
                    <span className="tag-picker__option-count">{tag.usageCount}</span>
                    {isSelected && (
                      <span className="tag-picker__option-check">
                        <CheckIcon />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TagPicker;
