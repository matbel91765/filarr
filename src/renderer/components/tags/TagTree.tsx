/**
 * TagTree Component
 *
 * Affiche les tags hierarchiques sous forme d'arbre collapsible.
 * Permet la selection pour filtrer les fichiers et le drag-drop
 * pour reorganiser les tags.
 */

import React, { FC, useCallback, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import clsx from 'clsx';
import type { AppDispatch, RootState } from '../../../store';
import type { HierarchicalTag } from '../../../types';
import {
  selectAllTags,
  selectRootTags,
  selectChildTags,
  selectIsTagExpanded,
  selectIsTagInFilter,
  toggleTagExpanded,
  expandAllTags,
  collapseAllTags,
  addTagToFilter,
  removeTagFromFilter,
  setSearchQuery,
  selectSearchResults,
} from '../../../store/slices/tagsSlice';
import { Input } from '../ui/Input/Input';
import Button from '../ui/Button/Button';
import './TagTree.css';

// ==================== ICONS ====================

const ChevronRightIcon: FC<{ expanded?: boolean }> = ({ expanded }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={clsx('tag-tree__chevron', { 'tag-tree__chevron--expanded': expanded })}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const TagIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const SearchIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

const ExpandIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

const CollapseIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 14h6m4 0h6M14 4v6m0 4v6M4 10V4m0 0h6M20 4h-6m6 6V4m0 16h-6m6-6v6M4 20v-6m0 6h6" />
  </svg>
);

const CheckIcon: FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ==================== TYPES ====================

interface TagTreeItemProps {
  tag: HierarchicalTag;
  level: number;
  onEdit?: (tag: HierarchicalTag) => void;
}

interface TagTreeProps {
  onTagSelect?: (tag: HierarchicalTag) => void;
  onTagEdit?: (tag: HierarchicalTag) => void;
  showSearch?: boolean;
  showControls?: boolean;
  className?: string;
}

// ==================== TAG TREE ITEM ====================

const TagTreeItem: FC<TagTreeItemProps> = ({ tag, level, onEdit }) => {
  const dispatch = useDispatch<AppDispatch>();
  const isExpanded = useSelector((state: RootState) => selectIsTagExpanded(state as any, tag.id));
  const isInFilter = useSelector((state: RootState) => selectIsTagInFilter(state as any, tag.id));
  const children = useSelector((state: RootState) => selectChildTags(state as any, tag.id));
  const hasChildren = children.length > 0;

  const [isDragOver, setIsDragOver] = useState(false);

  const handleToggleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      dispatch(toggleTagExpanded(tag.id));
    },
    [dispatch, tag.id]
  );

  const handleToggleFilter = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isInFilter) {
        dispatch(removeTagFromFilter(tag.id));
      } else {
        dispatch(addTagToFilter(tag.id));
      }
    },
    [dispatch, tag.id, isInFilter]
  );

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEdit?.(tag);
    },
    [onEdit, tag]
  );

  // Drag and drop handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'tag', id: tag.id }));
      e.dataTransfer.effectAllowed = 'move';
    },
    [tag.id]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      // Handle drop - dispatch update action to change parent
      // This would require the updateTag thunk
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        if (data.type === 'tag' && data.id !== tag.id) {
          // Would dispatch updateTag here with new parentId
        }
      } catch (error) {
        // Invalid drop data
      }
    },
    [tag.id]
  );

  return (
    <div className="tag-tree-item">
      <div
        className={clsx('tag-tree-item__row', {
          'tag-tree-item__row--selected': isInFilter,
          'tag-tree-item__row--drag-over': isDragOver,
        })}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleToggleFilter}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isInFilter}
      >
        {/* Expand/Collapse button */}
        {hasChildren ? (
          <button
            className="tag-tree-item__expand"
            onClick={handleToggleExpand}
            aria-label={isExpanded ? 'Replier' : 'Etendre'}
          >
            <ChevronRightIcon expanded={isExpanded} />
          </button>
        ) : (
          <span className="tag-tree-item__spacer" />
        )}

        {/* Color indicator */}
        <span
          className="tag-tree-item__color"
          style={{ backgroundColor: tag.color }}
          aria-hidden="true"
        />

        {/* Tag name */}
        <span className="tag-tree-item__name">{tag.name}</span>

        {/* Usage count */}
        <span className="tag-tree-item__count">{tag.usageCount}</span>

        {/* Selection indicator */}
        {isInFilter && (
          <span className="tag-tree-item__check" aria-label="Selectionne">
            <CheckIcon />
          </span>
        )}

        {/* Edit button */}
        {onEdit && (
          <button
            className="tag-tree-item__edit"
            onClick={handleEdit}
            aria-label="Modifier"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="tag-tree-item__children" role="group">
          {children.map((child) => (
            <TagTreeItem
              key={child.id}
              tag={child}
              level={level + 1}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ==================== TAG TREE ====================

const TagTree: FC<TagTreeProps> = ({
  onTagSelect,
  onTagEdit,
  showSearch = true,
  showControls = true,
  className,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const allTags = useSelector((state: RootState) => selectAllTags(state as any));
  const rootTags = useSelector((state: RootState) => selectRootTags(state as any));
  const searchResults = useSelector((state: RootState) => selectSearchResults(state as any));
  const [searchQuery, setLocalSearchQuery] = useState('');

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLocalSearchQuery(value);
      dispatch(setSearchQuery(value));
    },
    [dispatch]
  );

  const handleExpandAll = useCallback(() => {
    dispatch(expandAllTags());
  }, [dispatch]);

  const handleCollapseAll = useCallback(() => {
    dispatch(collapseAllTags());
  }, [dispatch]);

  const displayTags = useMemo(() => {
    if (searchQuery.trim() && searchResults.length > 0) {
      return searchResults.map(result => result.tag);
    }
    return rootTags;
  }, [searchQuery, searchResults, rootTags]);

  const isSearchMode = searchQuery.trim().length > 0;

  return (
    <div className={clsx('tag-tree', className)}>
      {/* Header */}
      <div className="tag-tree__header">
        <div className="tag-tree__title">
          <TagIcon />
          <span>Tags</span>
          <span className="tag-tree__count">({allTags.length})</span>
        </div>
        {showControls && (
          <div className="tag-tree__controls">
            <button
              className="tag-tree__control"
              onClick={handleExpandAll}
              title="Tout etendre"
              aria-label="Tout etendre"
            >
              <ExpandIcon />
            </button>
            <button
              className="tag-tree__control"
              onClick={handleCollapseAll}
              title="Tout replier"
              aria-label="Tout replier"
            >
              <CollapseIcon />
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      {showSearch && (
        <div className="tag-tree__search">
          <Input
            type="text"
            placeholder="Rechercher..."
            value={searchQuery}
            onChange={handleSearchChange}
            size="sm"
            leftIcon={<SearchIcon />}
          />
        </div>
      )}

      {/* Tree content */}
      <div className="tag-tree__content" role="tree" aria-label="Tags hierarchiques">
        {displayTags.length === 0 ? (
          <div className="tag-tree__empty">
            {isSearchMode ? (
              <p>Aucun tag trouve pour "{searchQuery}"</p>
            ) : (
              <>
                <TagIcon />
                <p>Aucun tag</p>
                <p className="tag-tree__empty-hint">
                  Creez des tags pour organiser vos fichiers
                </p>
              </>
            )}
          </div>
        ) : isSearchMode ? (
          // Flat list for search results
          displayTags.map((tag) => (
            <div
              key={tag.id}
              className="tag-tree-item__row tag-tree-item__row--flat"
              onClick={() => {
                dispatch(addTagToFilter(tag.id));
                onTagSelect?.(tag);
              }}
              role="treeitem"
            >
              <span className="tag-tree-item__color" style={{ backgroundColor: tag.color }} />
              <span className="tag-tree-item__name">{tag.name}</span>
              <span className="tag-tree-item__count">{tag.usageCount}</span>
            </div>
          ))
        ) : (
          // Hierarchical tree
          displayTags.map((tag) => (
            <TagTreeItem
              key={tag.id}
              tag={tag}
              level={0}
              onEdit={onTagEdit}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default TagTree;
