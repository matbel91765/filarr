/**
 * Tag Hierarchy Manager Component
 *
 * Provides comprehensive UI for managing hierarchical tags including:
 * - Parent-child relationships
 * - Tag colors and icons
 * - Tag aliases for search
 * - Usage statistics
 * - Bulk tag operations
 */

import React, { useState, useCallback, useMemo, FC } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import clsx from 'clsx';
import Button from '../ui/Button/Button';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { Input } from '../ui/Input/Input';
import { useNotification } from '../ui/Notification';
import type { RootState, AppDispatch } from '../../../store';
import type { HierarchicalTag, TagStatistics, BulkTagOperation } from '../../../types';
import './TagHierarchyManager.css';

// Icons
const PlusIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const FolderIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const TagIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const EditIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const TrashIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const ChevronRightIcon: FC<{ expanded?: boolean }> = ({ expanded }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const MergeIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 6l4-4 4 4" />
    <path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22" />
    <path d="m20 22-5-5" />
  </svg>
);

const StatsIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 20V10M12 20V4M6 20v-6" />
  </svg>
);

// Predefined colors for tags
const TAG_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#84CC16', '#6366F1',
];

// Predefined icons for tags
const TAG_ICONS = [
  'tag', 'folder', 'file', 'star', 'heart', 'bookmark',
  'flag', 'bell', 'calendar', 'archive', 'briefcase', 'globe',
];

interface TagHierarchyManagerProps {
  tags: HierarchicalTag[];
  statistics: TagStatistics[];
  onCreateTag: (tag: Omit<HierarchicalTag, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateTag: (id: string, updates: Partial<HierarchicalTag>) => void;
  onDeleteTag: (id: string) => void;
  onMergeTags: (sourceIds: string[], targetId: string) => void;
  onBulkOperation: (operation: Omit<BulkTagOperation, 'id' | 'createdAt'>) => void;
  selectedFileIds?: string[];
}

interface TagTreeItemProps {
  tag: HierarchicalTag;
  children: HierarchicalTag[];
  allTags: HierarchicalTag[];
  level: number;
  statistics?: TagStatistics;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onEdit: (tag: HierarchicalTag) => void;
  onDelete: (id: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
}

/**
 * Tag Tree Item Component
 */
const TagTreeItem: FC<TagTreeItemProps> = ({
  tag,
  children,
  allTags,
  level,
  statistics,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  expandedIds,
  onToggleExpand,
}) => {
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(tag.id);

  const getChildTags = (parentId: string): HierarchicalTag[] => {
    return allTags.filter((t) => t.parentId === parentId);
  };

  return (
    <div className="tag-tree-item">
      <div
        className={clsx('tag-tree-item__row', {
          'tag-tree-item__row--selected': isSelected,
        })}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={() => onSelect(tag.id)}
      >
        {hasChildren && (
          <button
            className="tag-tree-item__expand"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(tag.id);
            }}
          >
            <ChevronRightIcon expanded={isExpanded} />
          </button>
        )}
        {!hasChildren && <span className="tag-tree-item__spacer" />}

        <span
          className="tag-tree-item__color"
          style={{ backgroundColor: tag.color }}
        />

        <span className="tag-tree-item__name">{tag.name}</span>

        {tag.aliases.length > 0 && (
          <span className="tag-tree-item__aliases">
            ({tag.aliases.length} alias{tag.aliases.length > 1 ? 'es' : ''})
          </span>
        )}

        <span className="tag-tree-item__count">{tag.usageCount} files</span>

        <div className="tag-tree-item__actions">
          <button
            className="tag-tree-item__action"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(tag);
            }}
            title="Edit tag"
          >
            <EditIcon />
          </button>
          <button
            className="tag-tree-item__action tag-tree-item__action--danger"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(tag.id);
            }}
            title="Delete tag"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="tag-tree-item__children">
          {children.map((child) => (
            <TagTreeItem
              key={child.id}
              tag={child}
              children={getChildTags(child.id)}
              allTags={allTags}
              level={level + 1}
              statistics={undefined}
              isSelected={false}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Tag Hierarchy Manager Component
 */
const TagHierarchyManager: FC<TagHierarchyManagerProps> = ({
  tags,
  statistics,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onMergeTags,
  onBulkOperation,
  selectedFileIds = [],
}) => {
  const { success, error, info } = useNotification();

  // State
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<HierarchicalTag | null>(null);
  const [selectedForMerge, setSelectedForMerge] = useState<string[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    parentId: null as string | null,
    color: TAG_COLORS[0],
    icon: '',
    aliases: [] as string[],
    description: '',
  });
  const [aliasInput, setAliasInput] = useState('');

  // Get root tags (no parent)
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

  // Get tag statistics
  const getTagStats = useCallback(
    (tagId: string): TagStatistics | undefined => {
      return statistics.find((s) => s.tagId === tagId);
    },
    [statistics]
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

  // Expand all
  const handleExpandAll = useCallback(() => {
    setExpandedIds(new Set(tags.map((t) => t.id)));
  }, [tags]);

  // Collapse all
  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  // Open create modal
  const handleOpenCreate = useCallback((parentId: string | null = null) => {
    setFormData({
      name: '',
      parentId,
      color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)],
      icon: '',
      aliases: [],
      description: '',
    });
    setAliasInput('');
    setIsCreateModalOpen(true);
  }, []);

  // Open edit modal
  const handleOpenEdit = useCallback((tag: HierarchicalTag) => {
    setEditingTag(tag);
    setFormData({
      name: tag.name,
      parentId: tag.parentId,
      color: tag.color,
      icon: tag.icon || '',
      aliases: [...tag.aliases],
      description: tag.description || '',
    });
    setAliasInput('');
    setIsEditModalOpen(true);
  }, []);

  // Add alias
  const handleAddAlias = useCallback(() => {
    if (aliasInput.trim() && !formData.aliases.includes(aliasInput.trim())) {
      setFormData((prev) => ({
        ...prev,
        aliases: [...prev.aliases, aliasInput.trim()],
      }));
      setAliasInput('');
    }
  }, [aliasInput, formData.aliases]);

  // Remove alias
  const handleRemoveAlias = useCallback((alias: string) => {
    setFormData((prev) => ({
      ...prev,
      aliases: prev.aliases.filter((a) => a !== alias),
    }));
  }, []);

  // Create tag
  const handleCreate = useCallback(() => {
    if (!formData.name.trim()) {
      error('Tag name is required');
      return;
    }

    onCreateTag({
      name: formData.name.trim(),
      parentId: formData.parentId,
      color: formData.color,
      icon: formData.icon || undefined,
      aliases: formData.aliases,
      description: formData.description || undefined,
      usageCount: 0,
      children: [],
    });

    setIsCreateModalOpen(false);
    success('Tag created successfully');
  }, [formData, onCreateTag, error, success]);

  // Update tag
  const handleUpdate = useCallback(() => {
    if (!editingTag) return;
    if (!formData.name.trim()) {
      error('Tag name is required');
      return;
    }

    onUpdateTag(editingTag.id, {
      name: formData.name.trim(),
      parentId: formData.parentId,
      color: formData.color,
      icon: formData.icon || undefined,
      aliases: formData.aliases,
      description: formData.description || undefined,
    });

    setIsEditModalOpen(false);
    setEditingTag(null);
    success('Tag updated successfully');
  }, [editingTag, formData, onUpdateTag, error, success]);

  // Delete tag
  const handleDelete = useCallback(
    (id: string) => {
      const tag = tags.find((t) => t.id === id);
      if (!tag) return;

      const childCount = getChildTags(id).length;
      if (childCount > 0) {
        error(`Cannot delete tag with ${childCount} child tags. Please delete or move children first.`);
        return;
      }

      if (window.confirm(`Are you sure you want to delete "${tag.name}"?`)) {
        onDeleteTag(id);
        if (selectedTagId === id) {
          setSelectedTagId(null);
        }
        success('Tag deleted successfully');
      }
    },
    [tags, getChildTags, onDeleteTag, selectedTagId, error, success]
  );

  // Open merge modal
  const handleOpenMerge = useCallback(() => {
    setSelectedForMerge([]);
    setIsMergeModalOpen(true);
  }, []);

  // Toggle merge selection
  const handleToggleMergeSelection = useCallback((id: string) => {
    setSelectedForMerge((prev) => {
      if (prev.includes(id)) {
        return prev.filter((i) => i !== id);
      }
      return [...prev, id];
    });
  }, []);

  // Execute merge
  const handleMerge = useCallback(() => {
    if (selectedForMerge.length < 2) {
      error('Select at least 2 tags to merge');
      return;
    }

    const targetId = selectedForMerge[0];
    const sourceIds = selectedForMerge.slice(1);

    onMergeTags(sourceIds, targetId);
    setIsMergeModalOpen(false);
    success(`${sourceIds.length} tags merged successfully`);
  }, [selectedForMerge, onMergeTags, error, success]);

  // Bulk add tags to files
  const handleBulkAddTags = useCallback(() => {
    if (!selectedTagId || selectedFileIds.length === 0) {
      error('Select a tag and files first');
      return;
    }

    onBulkOperation({
      type: 'add',
      sourceTagIds: [selectedTagId],
      fileIds: selectedFileIds,
      status: 'pending',
      progress: 0,
    });

    info(`Adding tag to ${selectedFileIds.length} files...`);
  }, [selectedTagId, selectedFileIds, onBulkOperation, error, info]);

  // Bulk remove tags from files
  const handleBulkRemoveTags = useCallback(() => {
    if (!selectedTagId || selectedFileIds.length === 0) {
      error('Select a tag and files first');
      return;
    }

    onBulkOperation({
      type: 'remove',
      sourceTagIds: [selectedTagId],
      fileIds: selectedFileIds,
      status: 'pending',
      progress: 0,
    });

    info(`Removing tag from ${selectedFileIds.length} files...`);
  }, [selectedTagId, selectedFileIds, onBulkOperation, error, info]);

  // Get full tag path
  const getTagPath = useCallback(
    (tagId: string): string => {
      const tag = tags.find((t) => t.id === tagId);
      if (!tag) return '';

      const path: string[] = [tag.name];
      let current = tag;

      while (current.parentId) {
        const parent = tags.find((t) => t.id === current.parentId);
        if (!parent) break;
        path.unshift(parent.name);
        current = parent;
      }

      return path.join(' > ');
    },
    [tags]
  );

  const selectedTag = selectedTagId ? tags.find((t) => t.id === selectedTagId) : null;
  const selectedStats = selectedTagId ? getTagStats(selectedTagId) : undefined;

  return (
    <div className="tag-hierarchy-manager">
      {/* Header */}
      <div className="tag-hierarchy-manager__header">
        <h2 className="tag-hierarchy-manager__title">
          <TagIcon /> Tag Manager
        </h2>
        <div className="tag-hierarchy-manager__actions">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PlusIcon />}
            onClick={() => handleOpenCreate(null)}
          >
            New Tag
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<MergeIcon />}
            onClick={handleOpenMerge}
          >
            Merge Tags
          </Button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="tag-hierarchy-manager__search">
        <Input
          type="text"
          placeholder="Search tags or aliases..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="tag-hierarchy-manager__expand-controls">
          <button onClick={handleExpandAll}>Expand All</button>
          <button onClick={handleCollapseAll}>Collapse All</button>
        </div>
      </div>

      {/* Tag tree */}
      <div className="tag-hierarchy-manager__tree">
        {searchQuery ? (
          // Flat list for search results
          filteredTags.map((tag) => (
            <div
              key={tag.id}
              className={clsx('tag-tree-item__row', {
                'tag-tree-item__row--selected': selectedTagId === tag.id,
              })}
              onClick={() => setSelectedTagId(tag.id)}
            >
              <span className="tag-tree-item__color" style={{ backgroundColor: tag.color }} />
              <span className="tag-tree-item__name">{tag.name}</span>
              <span className="tag-tree-item__path">{getTagPath(tag.id)}</span>
              <span className="tag-tree-item__count">{tag.usageCount} files</span>
              <div className="tag-tree-item__actions">
                <button
                  className="tag-tree-item__action"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenEdit(tag);
                  }}
                >
                  <EditIcon />
                </button>
                <button
                  className="tag-tree-item__action tag-tree-item__action--danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(tag.id);
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))
        ) : (
          // Hierarchical tree
          rootTags.map((tag) => (
            <TagTreeItem
              key={tag.id}
              tag={tag}
              children={getChildTags(tag.id)}
              allTags={tags}
              level={0}
              statistics={getTagStats(tag.id)}
              isSelected={selectedTagId === tag.id}
              onSelect={setSelectedTagId}
              onEdit={handleOpenEdit}
              onDelete={handleDelete}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
            />
          ))
        )}

        {tags.length === 0 && (
          <div className="tag-hierarchy-manager__empty">
            <TagIcon />
            <p>No tags yet</p>
            <Button variant="primary" size="sm" onClick={() => handleOpenCreate(null)}>
              Create your first tag
            </Button>
          </div>
        )}
      </div>

      {/* Selected tag details */}
      {selectedTag && (
        <div className="tag-hierarchy-manager__details">
          <div className="tag-details__header">
            <span
              className="tag-details__color"
              style={{ backgroundColor: selectedTag.color }}
            />
            <h3>{selectedTag.name}</h3>
            <button onClick={() => setIsStatsModalOpen(true)}>
              <StatsIcon /> View Stats
            </button>
          </div>

          {selectedTag.description && (
            <p className="tag-details__description">{selectedTag.description}</p>
          )}

          <div className="tag-details__meta">
            <div className="tag-details__item">
              <span className="tag-details__label">Path:</span>
              <span className="tag-details__value">{getTagPath(selectedTag.id)}</span>
            </div>
            <div className="tag-details__item">
              <span className="tag-details__label">Files:</span>
              <span className="tag-details__value">{selectedTag.usageCount}</span>
            </div>
            <div className="tag-details__item">
              <span className="tag-details__label">Children:</span>
              <span className="tag-details__value">{selectedTag.children.length}</span>
            </div>
          </div>

          {selectedTag.aliases.length > 0 && (
            <div className="tag-details__aliases">
              <span className="tag-details__label">Aliases:</span>
              <div className="tag-details__alias-list">
                {selectedTag.aliases.map((alias) => (
                  <span key={alias} className="tag-details__alias">
                    {alias}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="tag-details__actions">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<PlusIcon />}
              onClick={() => handleOpenCreate(selectedTag.id)}
            >
              Add Child Tag
            </Button>
            {selectedFileIds.length > 0 && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleBulkAddTags}
                >
                  Add to {selectedFileIds.length} Files
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleBulkRemoveTags}
                >
                  Remove from Files
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create Tag Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Tag"
        size="md"
      >
        <ModalBody>
          <div className="tag-form">
            <div className="tag-form__field">
              <label>Name *</label>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Enter tag name"
              />
            </div>

            <div className="tag-form__field">
              <label>Parent Tag</label>
              <select
                value={formData.parentId || ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    parentId: e.target.value || null,
                  }))
                }
              >
                <option value="">No parent (root tag)</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {getTagPath(tag.id)}
                  </option>
                ))}
              </select>
            </div>

            <div className="tag-form__field">
              <label>Color</label>
              <div className="tag-form__colors">
                {TAG_COLORS.map((color) => (
                  <button
                    key={color}
                    className={clsx('tag-form__color', {
                      'tag-form__color--selected': formData.color === color,
                    })}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData((prev) => ({ ...prev, color }))}
                  />
                ))}
              </div>
            </div>

            <div className="tag-form__field">
              <label>Aliases (for search)</label>
              <div className="tag-form__alias-input">
                <Input
                  type="text"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="Add alias"
                  onKeyPress={(e) => e.key === 'Enter' && handleAddAlias()}
                />
                <Button variant="secondary" size="sm" onClick={handleAddAlias}>
                  Add
                </Button>
              </div>
              {formData.aliases.length > 0 && (
                <div className="tag-form__aliases">
                  {formData.aliases.map((alias) => (
                    <span key={alias} className="tag-form__alias">
                      {alias}
                      <button onClick={() => handleRemoveAlias(alias)}>&times;</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="tag-form__field">
              <label>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Optional description"
                rows={3}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreate}>
            Create Tag
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Tag Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Tag"
        size="md"
      >
        <ModalBody>
          <div className="tag-form">
            <div className="tag-form__field">
              <label>Name *</label>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Enter tag name"
              />
            </div>

            <div className="tag-form__field">
              <label>Parent Tag</label>
              <select
                value={formData.parentId || ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    parentId: e.target.value || null,
                  }))
                }
              >
                <option value="">No parent (root tag)</option>
                {tags
                  .filter((tag) => tag.id !== editingTag?.id)
                  .map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {getTagPath(tag.id)}
                    </option>
                  ))}
              </select>
            </div>

            <div className="tag-form__field">
              <label>Color</label>
              <div className="tag-form__colors">
                {TAG_COLORS.map((color) => (
                  <button
                    key={color}
                    className={clsx('tag-form__color', {
                      'tag-form__color--selected': formData.color === color,
                    })}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData((prev) => ({ ...prev, color }))}
                  />
                ))}
              </div>
            </div>

            <div className="tag-form__field">
              <label>Aliases (for search)</label>
              <div className="tag-form__alias-input">
                <Input
                  type="text"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="Add alias"
                  onKeyPress={(e) => e.key === 'Enter' && handleAddAlias()}
                />
                <Button variant="secondary" size="sm" onClick={handleAddAlias}>
                  Add
                </Button>
              </div>
              {formData.aliases.length > 0 && (
                <div className="tag-form__aliases">
                  {formData.aliases.map((alias) => (
                    <span key={alias} className="tag-form__alias">
                      {alias}
                      <button onClick={() => handleRemoveAlias(alias)}>&times;</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="tag-form__field">
              <label>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Optional description"
                rows={3}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleUpdate}>
            Save Changes
          </Button>
        </ModalFooter>
      </Modal>

      {/* Merge Tags Modal */}
      <Modal
        isOpen={isMergeModalOpen}
        onClose={() => setIsMergeModalOpen(false)}
        title="Merge Tags"
        size="md"
      >
        <ModalBody>
          <p className="tag-merge__info">
            Select tags to merge. The first selected tag will be the target (kept),
            and all other selected tags will be merged into it.
          </p>
          <div className="tag-merge__list">
            {tags.map((tag) => (
              <label key={tag.id} className="tag-merge__item">
                <input
                  type="checkbox"
                  checked={selectedForMerge.includes(tag.id)}
                  onChange={() => handleToggleMergeSelection(tag.id)}
                />
                <span
                  className="tag-merge__color"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="tag-merge__name">{tag.name}</span>
                <span className="tag-merge__count">({tag.usageCount} files)</span>
                {selectedForMerge[0] === tag.id && (
                  <span className="tag-merge__target">Target</span>
                )}
              </label>
            ))}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsMergeModalOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleMerge}
            disabled={selectedForMerge.length < 2}
          >
            Merge {selectedForMerge.length > 0 ? selectedForMerge.length : ''} Tags
          </Button>
        </ModalFooter>
      </Modal>

      {/* Stats Modal */}
      <Modal
        isOpen={isStatsModalOpen}
        onClose={() => setIsStatsModalOpen(false)}
        title={`Statistics: ${selectedTag?.name || ''}`}
        size="md"
      >
        <ModalBody>
          {selectedStats ? (
            <div className="tag-stats">
              <div className="tag-stats__item">
                <span className="tag-stats__label">Total Files</span>
                <span className="tag-stats__value">{selectedStats.totalFiles}</span>
              </div>
              <div className="tag-stats__item">
                <span className="tag-stats__label">Recent Usage (30 days)</span>
                <span className="tag-stats__value">{selectedStats.recentUsage}</span>
              </div>
              <div className="tag-stats__item">
                <span className="tag-stats__label">Average Confidence</span>
                <span className="tag-stats__value">
                  {(selectedStats.averageConfidence * 100).toFixed(1)}%
                </span>
              </div>
              <div className="tag-stats__item">
                <span className="tag-stats__label">Last Used</span>
                <span className="tag-stats__value">
                  {new Date(selectedStats.lastUsedAt).toLocaleDateString()}
                </span>
              </div>
              {selectedStats.topCoTags.length > 0 && (
                <div className="tag-stats__cotags">
                  <span className="tag-stats__label">Often Used With</span>
                  <div className="tag-stats__cotag-list">
                    {selectedStats.topCoTags.map((tagName) => (
                      <span key={tagName} className="tag-stats__cotag">
                        {tagName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p>No statistics available for this tag.</p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsStatsModalOpen(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default TagHierarchyManager;
