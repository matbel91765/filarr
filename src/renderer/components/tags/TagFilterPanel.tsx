/**
 * Tag Filter Panel Component
 *
 * Provides advanced tag filtering capabilities:
 * - Multi-tag selection with AND/OR logic
 * - Hierarchical tag expansion
 * - Tag search with alias support
 * - Quick filters (recent, popular, untagged)
 * - Tag usage statistics
 */

import React, { useState, useCallback, useMemo, FC } from 'react';
import clsx from 'clsx';
import { Input } from '../ui/Input/Input';
import type { HierarchicalTag } from '../../../types';
import './TagFilterPanel.css';

// Icons
const TagIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const CheckIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronDownIcon: FC<{ expanded?: boolean }> = ({ expanded }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ClockIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const TrendingIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const FileQuestionIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <circle cx="12" cy="14" r="2" />
    <path d="M12 10V9" />
  </svg>
);

const ClearIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export type FilterLogic = 'and' | 'or';

export interface TagFilterPanelProps {
  tags: HierarchicalTag[];
  selectedTagIds: string[];
  filterLogic: FilterLogic;
  onSelectedTagsChange: (tagIds: string[]) => void;
  onFilterLogicChange: (logic: FilterLogic) => void;
  onFilterUntagged: () => void;
  recentTagIds?: string[];
  popularTagIds?: string[];
  className?: string;
}

interface TagFilterItemProps {
  tag: HierarchicalTag;
  children: HierarchicalTag[];
  allTags: HierarchicalTag[];
  isSelected: boolean;
  isPartiallySelected: boolean;
  onToggle: (id: string, withChildren?: boolean) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  level: number;
}

/**
 * Tag Filter Item Component
 */
const TagFilterItem: FC<TagFilterItemProps> = ({
  tag,
  children,
  allTags,
  isSelected,
  isPartiallySelected,
  onToggle,
  expandedIds,
  onToggleExpand,
  level,
}) => {
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(tag.id);

  const getChildTags = (parentId: string): HierarchicalTag[] => {
    return allTags.filter((t) => t.parentId === parentId);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey && hasChildren) {
      // Shift+click to select with children
      onToggle(tag.id, true);
    } else {
      onToggle(tag.id, false);
    }
  };

  return (
    <div className="tag-filter-item">
      <div
        className={clsx('tag-filter-item__row', {
          'tag-filter-item__row--selected': isSelected,
          'tag-filter-item__row--partial': isPartiallySelected && !isSelected,
        })}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        {hasChildren && (
          <button
            className="tag-filter-item__expand"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(tag.id);
            }}
          >
            <ChevronDownIcon expanded={isExpanded} />
          </button>
        )}
        {!hasChildren && <span className="tag-filter-item__spacer" />}

        <span
          className={clsx('tag-filter-item__checkbox', {
            'tag-filter-item__checkbox--checked': isSelected,
            'tag-filter-item__checkbox--partial': isPartiallySelected && !isSelected,
          })}
        >
          {isSelected && <CheckIcon />}
          {isPartiallySelected && !isSelected && <span className="tag-filter-item__checkbox-partial" />}
        </span>

        <span
          className="tag-filter-item__color"
          style={{ backgroundColor: tag.color }}
        />

        <span className="tag-filter-item__name">{tag.name}</span>

        <span className="tag-filter-item__count">{tag.usageCount}</span>
      </div>

      {hasChildren && isExpanded && (
        <div className="tag-filter-item__children">
          {children.map((child) => (
            <TagFilterItem
              key={child.id}
              tag={child}
              children={getChildTags(child.id)}
              allTags={allTags}
              isSelected={false}
              isPartiallySelected={false}
              onToggle={onToggle}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Tag Filter Panel Component
 */
const TagFilterPanel: FC<TagFilterPanelProps> = ({
  tags,
  selectedTagIds,
  filterLogic,
  onSelectedTagsChange,
  onFilterLogicChange,
  onFilterUntagged,
  recentTagIds = [],
  popularTagIds = [],
  className,
}) => {
  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeQuickFilter, setActiveQuickFilter] = useState<'recent' | 'popular' | null>(null);

  // Get root tags
  const rootTags = useMemo(() => {
    return tags.filter((t) => !t.parentId);
  }, [tags]);

  // Get child tags for a parent
  const getChildTags = useCallback(
    (parentId: string): HierarchicalTag[] => {
      return tags.filter((t) => t.parentId === parentId);
    },
    [tags]
  );

  // Get all descendant IDs for a tag
  const getDescendantIds = useCallback(
    (tagId: string): string[] => {
      const descendants: string[] = [];
      const children = getChildTags(tagId);

      for (const child of children) {
        descendants.push(child.id);
        descendants.push(...getDescendantIds(child.id));
      }

      return descendants;
    },
    [getChildTags]
  );

  // Check if any descendant is selected
  const hasSelectedDescendant = useCallback(
    (tagId: string): boolean => {
      const descendants = getDescendantIds(tagId);
      return descendants.some((id) => selectedTagIds.includes(id));
    },
    [getDescendantIds, selectedTagIds]
  );

  // Filter tags by search
  const filteredTags = useMemo(() => {
    if (!searchQuery) return tags;
    const query = searchQuery.toLowerCase();
    return tags.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.aliases.some((a) => a.toLowerCase().includes(query))
    );
  }, [tags, searchQuery]);

  // Get filtered root tags for display
  const displayTags = useMemo(() => {
    if (searchQuery) {
      // When searching, show flat list
      return filteredTags;
    }

    if (activeQuickFilter === 'recent') {
      return tags.filter((t) => recentTagIds.includes(t.id));
    }

    if (activeQuickFilter === 'popular') {
      return tags.filter((t) => popularTagIds.includes(t.id));
    }

    return rootTags;
  }, [searchQuery, filteredTags, activeQuickFilter, recentTagIds, popularTagIds, tags, rootTags]);

  // Toggle tag selection
  const handleToggleTag = useCallback(
    (id: string, withChildren: boolean = false) => {
      const isSelected = selectedTagIds.includes(id);
      let newSelection: string[];

      if (withChildren) {
        const descendants = getDescendantIds(id);
        if (isSelected) {
          // Remove tag and all descendants
          newSelection = selectedTagIds.filter(
            (selectedId) => selectedId !== id && !descendants.includes(selectedId)
          );
        } else {
          // Add tag and all descendants
          newSelection = [...selectedTagIds, id, ...descendants.filter(
            (d) => !selectedTagIds.includes(d)
          )];
        }
      } else {
        if (isSelected) {
          newSelection = selectedTagIds.filter((selectedId) => selectedId !== id);
        } else {
          newSelection = [...selectedTagIds, id];
        }
      }

      onSelectedTagsChange(newSelection);
    },
    [selectedTagIds, getDescendantIds, onSelectedTagsChange]
  );

  // Toggle expand
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Clear all selections
  const handleClearAll = useCallback(() => {
    onSelectedTagsChange([]);
    setActiveQuickFilter(null);
  }, [onSelectedTagsChange]);

  // Select all visible tags
  const handleSelectAll = useCallback(() => {
    const allIds = displayTags.map((t) => t.id);
    onSelectedTagsChange([...new Set([...selectedTagIds, ...allIds])]);
  }, [displayTags, selectedTagIds, onSelectedTagsChange]);

  // Quick filter handlers
  const handleQuickFilter = useCallback(
    (filter: 'recent' | 'popular') => {
      if (activeQuickFilter === filter) {
        setActiveQuickFilter(null);
      } else {
        setActiveQuickFilter(filter);
        setSearchQuery('');
      }
    },
    [activeQuickFilter]
  );

  // Handle untagged filter
  const handleUntagged = useCallback(() => {
    onFilterUntagged();
    setActiveQuickFilter(null);
  }, [onFilterUntagged]);

  // Get tag path for search results
  const getTagPath = useCallback(
    (tagId: string): string => {
      const tag = tags.find((t) => t.id === tagId);
      if (!tag) return '';

      const path: string[] = [];
      let current = tag;

      while (current.parentId) {
        const parent = tags.find((t) => t.id === current.parentId);
        if (!parent) break;
        path.unshift(parent.name);
        current = parent;
      }

      return path.length > 0 ? path.join(' > ') + ' > ' : '';
    },
    [tags]
  );

  const selectedCount = selectedTagIds.length;

  return (
    <div className={clsx('tag-filter-panel', className)}>
      {/* Header */}
      <div className="tag-filter-panel__header">
        <h3 className="tag-filter-panel__title">
          <TagIcon /> Filter by Tags
        </h3>
        {selectedCount > 0 && (
          <span className="tag-filter-panel__count">
            {selectedCount} selected
          </span>
        )}
      </div>

      {/* Logic toggle */}
      <div className="tag-filter-panel__logic">
        <span className="tag-filter-panel__logic-label">Match:</span>
        <div className="tag-filter-panel__logic-toggle">
          <button
            className={clsx('tag-filter-panel__logic-btn', {
              'tag-filter-panel__logic-btn--active': filterLogic === 'and',
            })}
            onClick={() => onFilterLogicChange('and')}
          >
            All tags (AND)
          </button>
          <button
            className={clsx('tag-filter-panel__logic-btn', {
              'tag-filter-panel__logic-btn--active': filterLogic === 'or',
            })}
            onClick={() => onFilterLogicChange('or')}
          >
            Any tag (OR)
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="tag-filter-panel__search">
        <Input
          type="text"
          placeholder="Search tags..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setActiveQuickFilter(null);
          }}
        />
      </div>

      {/* Quick filters */}
      <div className="tag-filter-panel__quick-filters">
        <button
          className={clsx('tag-filter-panel__quick-btn', {
            'tag-filter-panel__quick-btn--active': activeQuickFilter === 'recent',
          })}
          onClick={() => handleQuickFilter('recent')}
        >
          <ClockIcon /> Recent
        </button>
        <button
          className={clsx('tag-filter-panel__quick-btn', {
            'tag-filter-panel__quick-btn--active': activeQuickFilter === 'popular',
          })}
          onClick={() => handleQuickFilter('popular')}
        >
          <TrendingIcon /> Popular
        </button>
        <button
          className="tag-filter-panel__quick-btn"
          onClick={handleUntagged}
        >
          <FileQuestionIcon /> Untagged
        </button>
      </div>

      {/* Actions */}
      <div className="tag-filter-panel__actions">
        <button
          className="tag-filter-panel__action"
          onClick={handleSelectAll}
        >
          Select All
        </button>
        <button
          className="tag-filter-panel__action"
          onClick={handleClearAll}
          disabled={selectedCount === 0}
        >
          <ClearIcon /> Clear
        </button>
      </div>

      {/* Tag list */}
      <div className="tag-filter-panel__list">
        {searchQuery || activeQuickFilter ? (
          // Flat list for search or quick filters
          displayTags.map((tag) => (
            <div
              key={tag.id}
              className={clsx('tag-filter-item__row', {
                'tag-filter-item__row--selected': selectedTagIds.includes(tag.id),
              })}
              onClick={() => handleToggleTag(tag.id)}
            >
              <span className="tag-filter-item__spacer" />
              <span
                className={clsx('tag-filter-item__checkbox', {
                  'tag-filter-item__checkbox--checked': selectedTagIds.includes(tag.id),
                })}
              >
                {selectedTagIds.includes(tag.id) && <CheckIcon />}
              </span>
              <span
                className="tag-filter-item__color"
                style={{ backgroundColor: tag.color }}
              />
              <span className="tag-filter-item__name">
                {searchQuery && (
                  <span className="tag-filter-item__path">{getTagPath(tag.id)}</span>
                )}
                {tag.name}
              </span>
              <span className="tag-filter-item__count">{tag.usageCount}</span>
            </div>
          ))
        ) : (
          // Hierarchical tree
          displayTags.map((tag) => (
            <TagFilterItem
              key={tag.id}
              tag={tag}
              children={getChildTags(tag.id)}
              allTags={tags}
              isSelected={selectedTagIds.includes(tag.id)}
              isPartiallySelected={hasSelectedDescendant(tag.id)}
              onToggle={handleToggleTag}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
              level={0}
            />
          ))
        )}

        {displayTags.length === 0 && (
          <div className="tag-filter-panel__empty">
            {searchQuery ? 'No tags match your search' : 'No tags available'}
          </div>
        )}
      </div>

      {/* Selected tags summary */}
      {selectedCount > 0 && (
        <div className="tag-filter-panel__selected">
          <span className="tag-filter-panel__selected-label">Selected:</span>
          <div className="tag-filter-panel__selected-tags">
            {selectedTagIds.slice(0, 5).map((id) => {
              const tag = tags.find((t) => t.id === id);
              if (!tag) return null;
              return (
                <span
                  key={id}
                  className="tag-filter-panel__selected-tag"
                  style={{ backgroundColor: tag.color + '20', borderColor: tag.color }}
                >
                  {tag.name}
                  <button onClick={() => handleToggleTag(id)}>&times;</button>
                </span>
              );
            })}
            {selectedCount > 5 && (
              <span className="tag-filter-panel__selected-more">
                +{selectedCount - 5} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Help text */}
      <div className="tag-filter-panel__help">
        Shift+click to select tag with children
      </div>
    </div>
  );
};

export default TagFilterPanel;
