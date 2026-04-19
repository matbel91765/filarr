/**
 * CollectionView Component
 *
 * View for browsing collection contents with grid/list layouts.
 * Fully styled with Tailwind CSS utilities.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import {
  removeFilesFromCollection,
  exportCollection,
} from '../../../store/slices/collectionsSlice';
import type { CollectionsState } from '../../../store/slices/collectionsSlice';
import type { VirtualCollection, FileItem, ViewMode } from '../../../types';
import Button from '../ui/Button/Button';
import Select from '../ui/Dropdown/Select';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal/Modal';

// ==================== ICONS ====================

const SearchIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21L16.65 16.65" />
  </svg>
);

const GridViewIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

const ListViewIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6H20M4 12H20M4 18H20" />
  </svg>
);

const ImageIcon: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
    <path d="M21 15L16 10L5 21" />
  </svg>
);

const DocumentIcon: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);

const ExportIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

interface CollectionViewProps {
  collection: VirtualCollection;
  files: FileItem[];
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  onFileOpen?: (fileId: string) => void;
  onFileNavigate?: (fileId: string) => void;
  className?: string;
}

export const CollectionView: React.FC<CollectionViewProps> = ({
  collection,
  files,
  viewMode = 'grid',
  onViewModeChange,
  onFileOpen,
  onFileNavigate,
  className,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { smartCollectionResults } = useSelector(
    (state: { collections: CollectionsState }) => state.collections
  );

  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size' | 'type'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [localViewMode, setLocalViewMode] = useState<ViewMode>(viewMode);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setLocalViewMode(mode);
    onViewModeChange?.(mode);
  }, [onViewModeChange]);

  // Get files in collection
  const collectionFileIds = useMemo(() => {
    if (collection.type === 'smart') {
      return smartCollectionResults[collection.id] || [];
    }
    return collection.fileIds;
  }, [collection, smartCollectionResults]);

  // Get collection files with filtering and sorting
  const collectionFiles = useMemo(() => {
    let result = files.filter((f) => collectionFileIds.includes(f.id));

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((f) => f.name.toLowerCase().includes(query));
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'date':
          comparison =
            new Date(a.updatedAt || a.createdAt || 0).getTime() -
            new Date(b.updatedAt || b.createdAt || 0).getTime();
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [files, collectionFileIds, searchQuery, sortBy, sortOrder]);

  // Handle file selection
  const handleFileSelect = useCallback(
    (fileId: string, ctrlKey: boolean, shiftKey: boolean) => {
      if (ctrlKey) {
        setSelectedFiles((prev) =>
          prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
        );
      } else if (shiftKey && selectedFiles.length > 0) {
        const lastSelected = selectedFiles[selectedFiles.length - 1];
        const lastIndex = collectionFiles.findIndex((f) => f.id === lastSelected);
        const currentIndex = collectionFiles.findIndex((f) => f.id === fileId);
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const newSelection = collectionFiles.slice(start, end + 1).map((f) => f.id);
        setSelectedFiles(newSelection);
      } else {
        setSelectedFiles([fileId]);
      }
    },
    [selectedFiles, collectionFiles]
  );

  // Handle select all
  const handleSelectAll = useCallback(() => {
    if (selectedFiles.length === collectionFiles.length) {
      setSelectedFiles([]);
    } else {
      setSelectedFiles(collectionFiles.map((f) => f.id));
    }
  }, [selectedFiles, collectionFiles]);

  // Handle remove from collection
  const handleRemoveFromCollection = useCallback(() => {
    if (collection.type === 'manual' && selectedFiles.length > 0) {
      dispatch(
        removeFilesFromCollection({
          collectionId: collection.id,
          fileIds: selectedFiles,
        }) as any
      );
      setSelectedFiles([]);
    }
  }, [dispatch, collection, selectedFiles]);

  // Handle export
  const handleExport = useCallback(() => {
    dispatch(
      exportCollection({
        collectionId: collection.id,
        files,
        options: {
          format: exportFormat,
          includeMetadata: true,
          includeTags: true,
          preserveStructure: false,
        },
      }) as any
    ).then((result: any) => {
      if (result.payload) {
        const { data, filename } = result.payload;
        const blob = new Blob(
          [typeof data === 'string' ? data : JSON.stringify(data, null, 2)],
          { type: exportFormat === 'json' ? 'application/json' : 'text/csv' }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      setShowExportModal(false);
    });
  }, [dispatch, collection, files, exportFormat]);

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return t('units.zeroBytes');
    const k = 1024;
    const sizes = [t('units.bytes'), t('units.kb'), t('units.mb'), t('units.gb')];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // Format date
  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Get file type icon
  const getFileIcon = (type: string) => {
    if (type === 'image') return <ImageIcon />;
    return <DocumentIcon />;
  };

  // Sort options
  const sortOptions = [
    { value: 'name', label: t('collections.fields.name') },
    { value: 'date', label: t('collections.view.date') },
    { value: 'size', label: t('collections.fields.size') },
    { value: 'type', label: t('collections.fields.type') },
  ];

  const exportFormatOptions = [
    { value: 'json', label: 'JSON' },
    { value: 'csv', label: 'CSV' },
  ];

  return (
    <div className={`flex flex-col w-full min-h-full ${className || ''}`}>

      {/* ===== Collection info banner ===== */}
      <div className="px-6 py-5 bg-[var(--color-surface)] border-b border-[var(--color-border-light)]">
        <div className="max-w-[1400px] mx-auto flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div
              className="w-12 h-12 rounded-xl shrink-0"
              style={{ backgroundColor: collection.color }}
            />
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-[var(--color-text-tertiary)]">
                  {collection.type === 'smart' ? t('collections.smartCollectionLabel') : t('collections.manualCollectionLabel')}
                </span>
                <span className="text-sm text-[var(--color-text-tertiary)]">
                  {t('collections.view.fileCount', { count: collectionFiles.length })}
                </span>
                <span className="text-sm text-[var(--color-text-tertiary)]">
                  {formatSize(collectionFiles.reduce((acc, f) => acc + f.size, 0))}
                </span>
              </div>
              {collection.description && (
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                  {collection.description}
                </p>
              )}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
            <ExportIcon />
            {t('collections.export.export')}
          </Button>
        </div>
      </div>

      {/* ===== Smart collection criteria ===== */}
      {collection.type === 'smart' && collection.criteria && (
        <div className="px-6 py-2 bg-purple-50 border-b border-purple-100">
          <div className="max-w-[1400px] mx-auto flex items-center gap-2 text-xs text-purple-600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span>
              {t('collections.view.ruleCount', { count: collection.criteria.rules.length })} (
              {collection.criteria.matchType === 'all' ? t('collections.smartEditor.allConditions') : t('collections.smartEditor.anyCondition')})
            </span>
          </div>
        </div>
      )}

      {/* ===== Toolbar ===== */}
      <div className="px-6 py-3 border-b border-[var(--color-border-light)] bg-[var(--color-surface)]">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search */}
          <div className="relative w-full sm:w-64">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">
              <SearchIcon />
            </span>
            <input
              type="text"
              placeholder={t('collections.view.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)]
                bg-[var(--color-surface)] text-[var(--color-text-primary)]
                placeholder:text-[var(--color-text-tertiary)]
                focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-300)] focus:border-[var(--color-primary-300)]
                transition-all duration-150"
            />
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            {/* Remove from collection */}
            {selectedFiles.length > 0 && collection.type === 'manual' && (
              <Button variant="ghost" size="sm" onClick={handleRemoveFromCollection}>
                {t('collections.view.remove')} ({selectedFiles.length})
              </Button>
            )}

            {/* Sort */}
            <Select
              options={sortOptions}
              value={sortBy}
              onChange={(value) => setSortBy(value as any)}
              size="sm"
            />

            {/* Sort order */}
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
                hover:bg-[var(--color-background-secondary)] transition-colors duration-150"
              title={sortOrder === 'asc' ? t('collections.sort.ascending') : t('collections.sort.descending')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {sortOrder === 'asc' ? (
                  <path d="M12 5V19M7 10L12 5L17 10" />
                ) : (
                  <path d="M12 19V5M7 14L12 19L17 14" />
                )}
              </svg>
            </button>

            {/* View mode toggle */}
            <div className="flex items-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-0.5">
              <button
                onClick={() => handleViewModeChange('grid')}
                className={`p-1.5 rounded-md transition-all duration-150
                  ${localViewMode === 'grid'
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                title={t('collections.view.gridView')}
              >
                <GridViewIcon />
              </button>
              <button
                onClick={() => handleViewModeChange('list')}
                className={`p-1.5 rounded-md transition-all duration-150
                  ${localViewMode === 'list'
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                title={t('collections.view.listView')}
              >
                <ListViewIcon />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Selection bar ===== */}
      {selectedFiles.length > 0 && (
        <div className="px-6 py-2 bg-blue-50 border-b border-blue-100">
          <div className="max-w-[1400px] mx-auto flex items-center gap-3 text-xs">
            <span className="font-medium text-blue-700">
              {t('collections.view.selectedCount', { count: selectedFiles.length })}
            </span>
            <button
              onClick={handleSelectAll}
              className="text-blue-600 hover:text-blue-800 hover:underline transition-colors"
            >
              {selectedFiles.length === collectionFiles.length ? t('collections.view.deselectAll') : t('collections.view.selectAll')}
            </button>
            <button
              onClick={() => setSelectedFiles([])}
              className="text-blue-600 hover:text-blue-800 hover:underline transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ===== Content ===== */}
      <div className="flex-1 px-6 py-5 overflow-y-auto bg-[var(--color-background-secondary)]">
        <div className="max-w-[1400px] mx-auto">

          {/* Empty state */}
          {collectionFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center
              bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm">
              <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center mb-5">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              {searchQuery ? (
                <>
                  <h3 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
                    {t('collections.view.noFileFound')}
                  </h3>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {t('collections.view.tryOtherTerms')}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
                    {t('collections.view.emptyCollection')}
                  </h3>
                  <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
                    {collection.type === 'manual'
                      ? t('collections.view.addFilesHint')
                      : t('collections.view.noCriteriaMatch')}
                  </p>
                </>
              )}
            </div>
          ) : localViewMode === 'grid' ? (
            /* ===== Grid View ===== */
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {collectionFiles.map((file) => (
                <div
                  key={file.id}
                  onClick={(e) => handleFileSelect(file.id, e.ctrlKey, e.shiftKey)}
                  onDoubleClick={() => onFileOpen?.(file.id)}
                  className={`group flex flex-col items-center text-center p-4 rounded-xl border cursor-pointer select-none
                    transition-all duration-150 bg-[var(--color-surface)]
                    ${selectedFiles.includes(file.id)
                      ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary-200)] bg-[var(--color-primary-50)]'
                      : 'border-[var(--color-border)] hover:shadow-md hover:border-[var(--color-primary-200)] hover:-translate-y-0.5'
                    }`}
                >
                  <div className="w-16 h-16 rounded-xl bg-[var(--color-background-secondary)] flex items-center justify-center mb-3
                    text-[var(--color-text-tertiary)]">
                    {getFileIcon(file.type)}
                  </div>
                  <span className="text-sm font-medium text-[var(--color-text-primary)] truncate w-full" title={file.name}>
                    {file.name}
                  </span>
                  <span className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    {formatSize(file.size)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            /* ===== List View ===== */
            <div className="flex flex-col rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] shadow-sm">
              {/* Header row */}
              <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--color-border-light)]
                bg-[var(--color-background-secondary)] text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                <span className="flex-1">{t('collections.fields.name')}</span>
                <span className="w-20 text-right hidden sm:block">{t('collections.fields.size')}</span>
                <span className="w-24 text-right hidden md:block">{t('collections.view.date')}</span>
                <span className="w-16 text-right hidden lg:block">{t('collections.fields.type')}</span>
              </div>
              {collectionFiles.map((file, index) => (
                <div
                  key={file.id}
                  onClick={(e) => handleFileSelect(file.id, e.ctrlKey, e.shiftKey)}
                  onDoubleClick={() => onFileOpen?.(file.id)}
                  className={`flex items-center gap-4 px-4 py-2.5 cursor-pointer select-none
                    transition-colors duration-100
                    ${index !== 0 ? 'border-t border-[var(--color-border-light)]' : ''}
                    ${selectedFiles.includes(file.id)
                      ? 'bg-[var(--color-primary-50)]'
                      : 'hover:bg-[var(--color-background-secondary)]'
                    }`}
                >
                  <span className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-[var(--color-text-tertiary)] shrink-0">
                      {getFileIcon(file.type)}
                    </span>
                    <span className="text-sm text-[var(--color-text-primary)] truncate">
                      {file.name}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--color-text-tertiary)] w-20 text-right hidden sm:block">
                    {formatSize(file.size)}
                  </span>
                  <span className="text-xs text-[var(--color-text-tertiary)] w-24 text-right hidden md:block">
                    {formatDate(file.updatedAt || file.createdAt)}
                  </span>
                  <span className="text-xs text-[var(--color-text-tertiary)] w-16 text-right hidden lg:block">
                    {file.type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== Export Modal ===== */}
      <Modal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title={t('collections.export.title')}
        size="sm"
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            {t('collections.export.description')}
          </p>
          <Select
            label={t('collections.export.format')}
            options={exportFormatOptions}
            value={exportFormat}
            onChange={(value) => setExportFormat(value as any)}
            fullWidth
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setShowExportModal(false)}>
            {t('collections.export.cancel')}
          </Button>
          <Button variant="primary" onClick={handleExport}>
            {t('collections.export.export')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default CollectionView;
