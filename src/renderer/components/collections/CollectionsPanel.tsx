/**
 * CollectionsPanel Component
 *
 * Full-page Google Drive-style view for managing collections.
 * Shows collection cards in a responsive grid with search, filter, sort.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import {
  loadCollections,
  createManualCollection,
  deleteCollection,
  duplicateCollection,
  selectCollection,
  setFilterType,
  setSortOptions,
  evaluateSmartCollection,
} from '../../../store/slices/collectionsSlice';
import type { CollectionsState } from '../../../store/slices/collectionsSlice';
import type { RootState } from '../../../store';
import type { VirtualCollection } from '../../../types';
import { selectAllFiles } from '../../../store/selectors/fileSelectors';
import Button from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import SmartCollectionEditor from './SmartCollectionEditor';
import CollectionView from './CollectionView';

// ==================== ICONS ====================

const SmartIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
  </svg>
);

const FolderCollectionIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);

const PlusIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M12 5V19M5 12H19" />
  </svg>
);

const SearchIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21L16.65 16.65" />
  </svg>
);

const GridIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

const ListIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6H20M4 12H20M4 18H20" />
  </svg>
);

const SortAscIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5V19M7 10L12 5L17 10" />
  </svg>
);

const SortDescIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M7 14L12 19L17 14" />
  </svg>
);

const DuplicateIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6H5H21M19 6V20a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

const EditIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const MoreDotsIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
);

const BackIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19L5 12L12 5" />
  </svg>
);

interface CollectionsPanelProps {
  onCollectionSelect?: (collectionId: string | null) => void;
  className?: string;
}

export const CollectionsPanel: React.FC<CollectionsPanelProps> = ({
  onCollectionSelect,
  className,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const {
    collections,
    selectedCollectionId,
    isLoading,
    error,
    filterType,
    sortBy,
    sortOrder,
  } = useSelector((state: { collections: CollectionsState }) => state.collections);

  // Rule field labels for display
  const FIELD_LABELS: Record<string, string> = useMemo(() => ({
    name: t('collections.fields.name'),
    extension: t('collections.fields.extension'),
    size: t('collections.fields.size'),
    createdAt: t('collections.fields.createdAt'),
    modifiedAt: t('collections.fields.modifiedAt'),
    tags: t('collections.fields.tags'),
    folder: t('collections.fields.folder'),
    type: t('collections.fields.type'),
    content: t('collections.fields.content'),
    isFavorite: t('collections.fields.favorite'),
    duplicateOf: t('collections.fields.duplicate'),
  }), [t]);

  const OPERATOR_LABELS: Record<string, string> = useMemo(() => ({
    equals: '=',
    notEquals: '!=',
    contains: t('collections.operators.contains'),
    notContains: t('collections.operators.notContains'),
    startsWith: t('collections.operators.startsWith'),
    endsWith: t('collections.operators.endsWith'),
    greaterThan: '>',
    lessThan: '<',
    between: t('collections.operators.between'),
    isEmpty: t('collections.operators.isEmpty'),
    isNotEmpty: t('collections.operators.notEmpty'),
    matchesRegex: t('collections.operators.regex'),
    inList: t('collections.operators.in'),
    hasAny: t('collections.operators.hasOne'),
    hasAll: t('collections.operators.hasAll'),
    isTrue: t('collections.operators.yes'),
    isFalse: t('collections.operators.no'),
    withinLast: t('collections.operators.inLast'),
  }), [t]);

  // Get all files from store for smart collection evaluation
  const allFiles = useSelector(selectAllFiles);
  const fileTagMappings = useSelector((state: RootState) => state.tags?.fileTagMappings || {});
  const favorites = useSelector((state: RootState) => state.favorites?.favorites || []);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSmartEditor, setShowSmartEditor] = useState(false);
  const [editingCollection, setEditingCollection] = useState<VirtualCollection | undefined>(undefined);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<string | null>(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDescription, setNewCollectionDescription] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenuCollection, setContextMenuCollection] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [localViewMode, setLocalViewMode] = useState<'grid' | 'list'>('grid');

  // Load collections on mount
  useEffect(() => {
    dispatch(loadCollections() as any);
  }, [dispatch]);

  // Build file tags map for smart collection evaluation
  const fileTagsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [fileId, tagIds] of Object.entries(fileTagMappings)) {
      map.set(fileId, tagIds);
    }
    return map;
  }, [fileTagMappings]);

  // Build favorite file IDs set
  const favoriteFileIds = useMemo(() => {
    return new Set(
      favorites
        .filter((f: any) => f.itemType === 'file')
        .map((f: any) => f.itemId)
    );
  }, [favorites]);

  // Evaluate all smart collections when files change
  useEffect(() => {
    if (allFiles.length === 0) return;
    collections
      .filter((c) => c.type === 'smart' && c.criteria)
      .forEach((c) => {
        dispatch(
          evaluateSmartCollection({
            collectionId: c.id,
            files: allFiles,
            fileTags: fileTagsMap,
            favoriteFileIds,
          }) as any
        );
      });
  }, [dispatch, collections.length, allFiles.length, fileTagsMap, favoriteFileIds]);

  // Filter and sort collections
  const filteredCollections = useMemo(() => {
    return collections
      .filter((c) => {
        if (filterType !== 'all' && c.type !== filterType) return false;
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          return (
            c.name.toLowerCase().includes(query) ||
            c.description?.toLowerCase().includes(query)
          );
        }
        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'dateCreated':
            comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            break;
          case 'dateModified':
            comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
            break;
          case 'fileCount':
            comparison = a.fileCount - b.fileCount;
            break;
          default:
            comparison = 0;
        }
        return sortOrder === 'desc' ? -comparison : comparison;
      });
  }, [collections, filterType, searchQuery, sortBy, sortOrder]);

  // Selected collection object
  const selectedCollection = useMemo(() => {
    if (!selectedCollectionId) return null;
    return collections.find((c) => c.id === selectedCollectionId) || null;
  }, [collections, selectedCollectionId]);

  // Handle select collection
  const handleSelectCollection = useCallback(
    (collectionId: string) => {
      const col = collections.find((c) => c.id === collectionId);
      // Re-evaluate smart collection on open
      if (col && col.type === 'smart' && col.criteria && allFiles.length > 0) {
        dispatch(
          evaluateSmartCollection({
            collectionId: col.id,
            files: allFiles,
            fileTags: fileTagsMap,
            favoriteFileIds,
          }) as any
        );
      }
      dispatch(selectCollection(collectionId));
      onCollectionSelect?.(collectionId);
    },
    [dispatch, onCollectionSelect, collections, allFiles, fileTagsMap, favoriteFileIds]
  );

  // Handle back to list
  const handleBackToList = useCallback(() => {
    dispatch(selectCollection(null));
    onCollectionSelect?.(null);
  }, [dispatch, onCollectionSelect]);

  // Handle create manual collection
  const handleCreateManualCollection = useCallback(() => {
    if (!newCollectionName.trim()) return;
    dispatch(
      createManualCollection({
        name: newCollectionName.trim(),
        description: newCollectionDescription.trim() || undefined,
      }) as any
    );
    setNewCollectionName('');
    setNewCollectionDescription('');
    setShowCreateModal(false);
  }, [dispatch, newCollectionName, newCollectionDescription]);

  // Handle context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, collectionId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenuCollection(collectionId);
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenuCollection(null);
    setContextMenuPosition(null);
  }, []);

  const handleDeleteConfirm = useCallback((collectionId: string) => {
    setCollectionToDelete(collectionId);
    setShowDeleteConfirm(true);
    closeContextMenu();
  }, [closeContextMenu]);

  const handleDelete = useCallback(() => {
    if (collectionToDelete) {
      dispatch(deleteCollection(collectionToDelete) as any);
      setShowDeleteConfirm(false);
      setCollectionToDelete(null);
    }
  }, [dispatch, collectionToDelete]);

  const handleDuplicate = useCallback(
    (collectionId: string) => {
      dispatch(duplicateCollection({ collectionId }) as any);
      closeContextMenu();
    },
    [dispatch, closeContextMenu]
  );

  // Handle edit smart collection
  const handleEditCollection = useCallback(
    (collectionId: string) => {
      const col = collections.find((c) => c.id === collectionId);
      if (col && col.type === 'smart') {
        setEditingCollection(col);
        setShowSmartEditor(true);
      }
      closeContextMenu();
    },
    [collections, closeContextMenu]
  );

  // Get criteria summary for a smart collection
  const getCriteriaSummary = (collection: VirtualCollection): string => {
    if (!collection.criteria || !collection.criteria.rules.length) return '';
    const rules = collection.criteria.rules;
    const parts = rules.slice(0, 2).map((r) => {
      const field = FIELD_LABELS[r.field] || r.field;
      const op = OPERATOR_LABELS[r.operator] || r.operator;
      const val = Array.isArray(r.value) ? r.value.join(', ') : String(r.value || '');
      return `${field} ${op} ${val}`.trim();
    });
    if (rules.length > 2) parts.push(`+${rules.length - 2}`);
    return parts.join(collection.criteria.matchType === 'all' ? ` ${t('collections.smartEditor.and')} ` : ` ${t('collections.smartEditor.or')} `);
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return t('units.zeroBytes');
    const k = 1024;
    const sizes = [t('units.bytes'), t('units.kb'), t('units.mb'), t('units.gb')];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  // Filter options as buttons
  const filterOptions = [
    { value: 'all' as const, label: t('collections.filters.all') },
    { value: 'manual' as const, label: t('collections.filters.manual') },
    { value: 'smart' as const, label: t('collections.filters.smart') },
  ];

  // Context menu collection object
  const contextMenuCollectionObj = useMemo(() => {
    if (!contextMenuCollection) return null;
    return collections.find((c) => c.id === contextMenuCollection) || null;
  }, [collections, contextMenuCollection]);

  // If a collection is selected, show the CollectionView
  if (selectedCollection) {
    return (
      <div className={`flex flex-col w-full min-h-full bg-[var(--color-background-secondary)] ${className || ''}`}>
        {/* Back header */}
        <div className="bg-[var(--color-surface)] border-b border-[var(--color-border-light)] px-6 py-4">
          <div className="max-w-[1400px] mx-auto flex items-center gap-4">
            <button
              onClick={handleBackToList}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-text-secondary)]
                hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-primary)]
                transition-colors duration-150"
            >
              <BackIcon />
            </button>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${selectedCollection.color}20` }}
              >
                <span style={{ color: selectedCollection.color }}>
                  {selectedCollection.type === 'smart' ? <SmartIcon /> : <FolderCollectionIcon />}
                </span>
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-[var(--color-text-primary)] truncate">
                  {selectedCollection.name}
                </h1>
                {selectedCollection.description && (
                  <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                    {selectedCollection.description}
                  </p>
                )}
              </div>
              <span className={`ml-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full shrink-0
                ${selectedCollection.type === 'smart'
                  ? 'bg-purple-50 text-purple-600 border border-purple-200'
                  : 'bg-blue-50 text-blue-600 border border-blue-200'
                }`}
              >
                {selectedCollection.type === 'smart' ? t('collections.smart') : t('collections.manual')}
              </span>
            </div>
            {/* Edit button for smart collections */}
            {selectedCollection.type === 'smart' && (
              <button
                onClick={() => {
                  setEditingCollection(selectedCollection);
                  setShowSmartEditor(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600
                  bg-purple-50 border border-purple-200 rounded-lg
                  hover:bg-purple-100 transition-colors duration-150"
              >
                <EditIcon />
                {t('collections.smartEditor.editRules')}
              </button>
            )}
          </div>
        </div>

        {/* Smart collection criteria bar */}
        {selectedCollection.type === 'smart' && selectedCollection.criteria && (
          <div className="px-6 py-2 bg-purple-50 border-b border-purple-100">
            <div className="max-w-[1400px] mx-auto flex items-center gap-2 text-xs text-purple-600 flex-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span className="font-medium">
                {selectedCollection.criteria.matchType === 'all' ? t('collections.smartEditor.allConditions') : t('collections.smartEditor.anyCondition')}:
              </span>
              {selectedCollection.criteria.rules.map((rule, i) => (
                <span key={rule.id || i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 rounded-full">
                  <span className="font-medium">{FIELD_LABELS[rule.field] || rule.field}</span>
                  <span>{OPERATOR_LABELS[rule.operator] || rule.operator}</span>
                  {!['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'].includes(rule.operator) && (
                    <span className="font-medium">
                      "{Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value || '')}"
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Collection detail view */}
        <div className="flex-1 overflow-auto">
          <CollectionView
            collection={selectedCollection}
            files={allFiles}
            onFileOpen={() => {}}
          />
        </div>

        {/* Smart editor for editing */}
        {showSmartEditor && (
          <SmartCollectionEditor
            isOpen={showSmartEditor}
            onClose={() => {
              setShowSmartEditor(false);
              setEditingCollection(undefined);
            }}
            collection={editingCollection}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col w-full min-h-full bg-[var(--color-background-secondary)] ${className || ''}`}>

      {/* ===== Header banner ===== */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border-light)] px-6 py-6">
        <div className="max-w-[1400px] mx-auto flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-normal text-[var(--color-text-primary)] mb-1">
              {t('collections.title')}
            </h1>
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t('collections.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            <Button variant="secondary" size="sm" onClick={() => { setEditingCollection(undefined); setShowSmartEditor(true); }}>
              <SmartIcon />
              {t('collections.smartCollection')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
              <PlusIcon />
              {t('collections.newCollection')}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto w-full px-6 py-6 flex flex-col gap-5">

        {/* ===== Toolbar: search + filters + sort + view mode ===== */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search */}
          <div className="relative w-full sm:w-72">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">
              <SearchIcon />
            </span>
            <input
              type="text"
              placeholder={t('collections.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--color-border)]
                bg-[var(--color-surface)] text-[var(--color-text-primary)]
                placeholder:text-[var(--color-text-tertiary)]
                focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-300)] focus:border-[var(--color-primary-300)]
                transition-all duration-150"
            />
          </div>

          {/* Filter chips */}
          <div className="flex items-center gap-1">
            {filterOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => dispatch(setFilterType(opt.value as any))}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all duration-150
                  ${filterType === opt.value
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] border-[var(--color-primary-200)]'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-background-secondary)]'
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 sm:ml-auto">
            {/* Sort toggle */}
            <button
              onClick={() => dispatch(setSortOptions({ sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' }))}
              className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
                hover:bg-[var(--color-surface)] transition-colors duration-150"
              title={sortOrder === 'asc' ? t('collections.sort.ascending') : t('collections.sort.descending')}
            >
              {sortOrder === 'asc' ? <SortAscIcon /> : <SortDescIcon />}
            </button>

            {/* View mode toggle */}
            <div className="flex items-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-0.5">
              <button
                onClick={() => setLocalViewMode('grid')}
                className={`p-1.5 rounded-md transition-all duration-150
                  ${localViewMode === 'grid'
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                title={t('collections.view.gridView')}
              >
                <GridIcon />
              </button>
              <button
                onClick={() => setLocalViewMode('list')}
                className={`p-1.5 rounded-md transition-all duration-150
                  ${localViewMode === 'list'
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                title={t('collections.view.listView')}
              >
                <ListIcon />
              </button>
            </div>
          </div>
        </div>

        {/* ===== Loading ===== */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
          </div>
        )}

        {/* ===== Error ===== */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
            {error.message}
          </div>
        )}

        {/* ===== Empty state ===== */}
        {!isLoading && !error && filteredCollections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center
            bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm">
            <div className="w-24 h-24 rounded-full bg-blue-50 flex items-center justify-center mb-6">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary-400)" strokeWidth="1">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 11V17M9 14H15" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {searchQuery ? (
              <>
                <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                  {t('collections.noResults')}
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)] max-w-md">
                  {t('collections.noResultsDescription')}
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                  {t('collections.emptyState')}
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)] max-w-md mb-6">
                  {t('collections.emptyStateDescription')}
                </p>
                <div className="flex gap-3">
                  <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
                    {t('collections.newCollection')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => { setEditingCollection(undefined); setShowSmartEditor(true); }}>
                    {t('collections.smartCollection')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ===== Grid View ===== */}
        {!isLoading && !error && filteredCollections.length > 0 && localViewMode === 'grid' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredCollections.map((collection) => (
              <div
                key={collection.id}
                onClick={() => handleSelectCollection(collection.id)}
                onContextMenu={(e) => handleContextMenu(e, collection.id)}
                className="group relative rounded-xl border cursor-pointer select-none
                  transition-all duration-200 overflow-hidden
                  bg-[var(--color-surface)] border-[var(--color-border)] shadow-sm
                  hover:shadow-lg hover:border-[var(--color-primary-200)] hover:-translate-y-0.5"
              >
                {/* Color accent area */}
                <div
                  className="h-[100px] flex items-center justify-center relative"
                  style={{ backgroundColor: `${collection.color}12` }}
                >
                  <span style={{ color: collection.color }} className="opacity-40">
                    {collection.type === 'smart' ? (
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                      </svg>
                    ) : (
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                    )}
                  </span>

                  {/* Type badge */}
                  <span className={`absolute top-2 right-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full
                    ${collection.type === 'smart'
                      ? 'bg-purple-100 text-purple-600'
                      : 'bg-blue-100 text-blue-600'
                    }`}
                  >
                    {collection.type === 'smart' ? t('collections.smart') : t('collections.manual')}
                  </span>

                  {/* Criteria hint for smart collections */}
                  {collection.type === 'smart' && collection.criteria && collection.criteria.rules.length > 0 && (
                    <span className="absolute bottom-2 left-2 right-2 px-2 py-1 text-[10px] text-purple-700 bg-purple-100/80 rounded-md truncate">
                      {getCriteriaSummary(collection)}
                    </span>
                  )}
                </div>

                {/* Info bar */}
                <div className="px-3 py-3 bg-[var(--color-surface)] border-t border-[var(--color-border-light)]">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: collection.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {collection.name}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        {t('collections.view.fileCount', { count: collection.fileCount })}
                        {collection.totalSize > 0 && ` · ${formatSize(collection.totalSize)}`}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleContextMenu(e, collection.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-full shrink-0
                        hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
                    >
                      <MoreDotsIcon />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ===== List View ===== */}
        {!isLoading && !error && filteredCollections.length > 0 && localViewMode === 'list' && (
          <div className="flex flex-col rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] shadow-sm">
            {filteredCollections.map((collection, index) => (
              <div
                key={collection.id}
                onClick={() => handleSelectCollection(collection.id)}
                onContextMenu={(e) => handleContextMenu(e, collection.id)}
                className={`group flex items-center gap-4 px-4 py-3 cursor-pointer select-none
                  transition-colors duration-100 hover:bg-[var(--color-background-secondary)]
                  ${index !== 0 ? 'border-t border-[var(--color-border-light)]' : ''}`}
              >
                {/* Color dot + icon */}
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${collection.color}20` }}
                >
                  <span style={{ color: collection.color }}>
                    {collection.type === 'smart' ? <SmartIcon /> : <FolderCollectionIcon />}
                  </span>
                </div>

                {/* Name and description */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {collection.name}
                  </p>
                  {collection.type === 'smart' && collection.criteria ? (
                    <p className="text-[11px] text-purple-500 truncate">
                      {getCriteriaSummary(collection)}
                    </p>
                  ) : collection.description ? (
                    <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                      {collection.description}
                    </p>
                  ) : null}
                </div>

                {/* Type badge */}
                <span className={`hidden sm:inline-flex px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full shrink-0
                  ${collection.type === 'smart'
                    ? 'bg-purple-50 text-purple-600 border border-purple-200'
                    : 'bg-blue-50 text-blue-600 border border-blue-200'
                  }`}
                >
                  {collection.type === 'smart' ? t('collections.smart') : t('collections.manual')}
                </span>

                {/* File count */}
                <span className="text-xs text-[var(--color-text-tertiary)] hidden sm:inline shrink-0">
                  {t('collections.view.fileCount', { count: collection.fileCount })}
                </span>

                {/* Date */}
                <span className="text-xs text-[var(--color-text-tertiary)] hidden md:inline shrink-0 w-24 text-right">
                  {formatDate(collection.updatedAt)}
                </span>

                {/* More button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleContextMenu(e, collection.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-full shrink-0
                    hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
                >
                  <MoreDotsIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Context Menu ===== */}
      {contextMenuPosition && contextMenuCollection && (
        <>
          <div
          // chrome:free — voile de rejet uniforme : tout point referme.
            className="fixed inset-0 z-[999]"
            onClick={closeContextMenu}
          />
          <div
            className="fixed z-[1000] min-w-[180px] py-1 rounded-xl border border-[var(--color-border)]
              bg-[var(--color-surface)] shadow-lg"
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            {/* Edit option for smart collections */}
            {contextMenuCollectionObj?.type === 'smart' && (
              <button
                onClick={() => handleEditCollection(contextMenuCollection)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-purple-600
                  text-left hover:bg-purple-50 transition-colors duration-100"
              >
                <EditIcon />
                {t('collections.smartEditor.editRules')}
              </button>
            )}
            <button
              onClick={() => handleDuplicate(contextMenuCollection)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--color-text-primary)]
                text-left hover:bg-[var(--color-background-secondary)] transition-colors duration-100"
            >
              <DuplicateIcon />
              {t('collections.contextMenu.duplicate')}
            </button>
            <button
              onClick={() => handleDeleteConfirm(contextMenuCollection)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-600
                text-left hover:bg-red-50 transition-colors duration-100"
            >
              <TrashIcon />
              {t('collections.contextMenu.delete')}
            </button>
          </div>
        </>
      )}

      {/* ===== Create Modal ===== */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={t('collections.createModal.title')}
        size="sm"
      >
        <ModalBody>
          <div className="flex flex-col gap-4">
            <Input
              label={t('collections.createModal.name')}
              placeholder={t('collections.createModal.namePlaceholder')}
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              required
              fullWidth
              autoFocus
            />
            <Input
              label={t('collections.createModal.description')}
              placeholder={t('collections.createModal.descriptionPlaceholder')}
              value={newCollectionDescription}
              onChange={(e) => setNewCollectionDescription(e.target.value)}
              fullWidth
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
            {t('collections.createModal.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleCreateManualCollection}
            disabled={!newCollectionName.trim()}
          >
            {t('collections.createModal.create')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ===== Smart Collection Editor ===== */}
      {showSmartEditor && (
        <SmartCollectionEditor
          isOpen={showSmartEditor}
          onClose={() => {
            setShowSmartEditor(false);
            setEditingCollection(undefined);
          }}
          collection={editingCollection}
        />
      )}

      {/* ===== Delete Confirmation Modal ===== */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title={t('collections.deleteModal.title')}
        size="sm"
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-primary)]">
            {t('collections.deleteModal.confirm')}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
            {t('collections.deleteModal.info')}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
            {t('collections.deleteModal.cancel')}
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            {t('collections.deleteModal.delete')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default CollectionsPanel;
