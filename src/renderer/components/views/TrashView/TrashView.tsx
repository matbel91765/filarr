/**
 * TrashView Component
 *
 * Affiche la corbeille avec les elements supprimes et les options de restauration/suppression definitive
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../../../store';
import {
  fetchTrashItems,
  restoreFromTrash,
  permanentlyDelete,
  emptyTrash,
  clearTrashErrors,
} from '../../../../store/slices/trashSlice';
import {
  selectAllTrashItems,
  selectTrashLoading,
  selectTrashError,
  selectIsTrashEmpty,
  selectTrashItemsCount,
  selectTrashTotalSize,
  selectTrashItemsByDate,
} from '../../../../store/selectors/trashSelectors';
import type { TrashItem } from '../../../../store/slices/trashSlice';
import './TrashView.css';

const TrashView: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  // Local state
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'empty' | 'delete' | 'deleteBatch' | null>(
    null
  );
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [operationInProgress, setOperationInProgress] = useState(false);

  // Selectors
  const trashItems = useSelector(selectAllTrashItems);
  const loading = useSelector(selectTrashLoading);
  const error = useSelector(selectTrashError);
  const isEmpty = useSelector(selectIsTrashEmpty);
  const itemsCount = useSelector(selectTrashItemsCount);
  const totalSize = useSelector(selectTrashTotalSize);
  const itemsByDate = useSelector(selectTrashItemsByDate);

  // Charger les items au montage
  useEffect(() => {
    dispatch(fetchTrashItems());
  }, [dispatch]);

  // Nettoyer les erreurs au demontage
  useEffect(() => {
    return () => {
      dispatch(clearTrashErrors());
    };
  }, [dispatch]);

  // Handlers
  const handleSelectItem = useCallback((itemId: string) => {
    setSelectedItems((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedItems.length === trashItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(trashItems.map((item) => item.id));
    }
  }, [selectedItems.length, trashItems]);

  const handleRestore = useCallback(
    async (itemId: string) => {
      setOperationInProgress(true);
      await dispatch(restoreFromTrash({ itemId }));
      setSelectedItems((prev) => prev.filter((id) => id !== itemId));
      setOperationInProgress(false);
    },
    [dispatch]
  );

  const handleRestoreSelected = useCallback(async () => {
    setOperationInProgress(true);
    await Promise.all(selectedItems.map((itemId) => dispatch(restoreFromTrash({ itemId }))));
    setSelectedItems([]);
    setOperationInProgress(false);
  }, [dispatch, selectedItems]);

  const handlePermanentlyDelete = useCallback(
    async (itemId: string, folderId?: string) => {
      setOperationInProgress(true);
      await dispatch(permanentlyDelete({ itemId, folderId }));
      setSelectedItems((prev) => prev.filter((id) => id !== itemId));
      setShowConfirmDialog(false);
      setItemToDelete(null);
      setConfirmAction(null);
      setOperationInProgress(false);
    },
    [dispatch]
  );

  const handleDeleteSelected = useCallback(async () => {
    setOperationInProgress(true);
    await Promise.all(
      selectedItems.map((itemId) => {
        const item = trashItems.find((i) => i.id === itemId);
        return dispatch(permanentlyDelete({ itemId, folderId: item?.parentFolderId }));
      })
    );
    setSelectedItems([]);
    setShowConfirmDialog(false);
    setConfirmAction(null);
    setOperationInProgress(false);
  }, [dispatch, selectedItems, trashItems]);

  const handleEmptyTrash = useCallback(async () => {
    setOperationInProgress(true);
    const result = await dispatch(emptyTrash({ olderThanDays: 0 }));
    if (emptyTrash.fulfilled.match(result)) {
      setSelectedItems([]);
    }
    setShowConfirmDialog(false);
    setConfirmAction(null);
    setOperationInProgress(false);
  }, [dispatch]);

  const confirmPermanentDelete = useCallback((itemId: string) => {
    setItemToDelete(itemId);
    setConfirmAction('delete');
    setShowConfirmDialog(true);
  }, []);

  const confirmEmptyTrash = useCallback(() => {
    setConfirmAction('empty');
    setShowConfirmDialog(true);
  }, []);

  const confirmDeleteSelected = useCallback(() => {
    setConfirmAction('deleteBatch');
    setShowConfirmDialog(true);
  }, []);

  const closeConfirmDialog = useCallback(() => {
    setShowConfirmDialog(false);
    setItemToDelete(null);
    setConfirmAction(null);
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = useCallback(
    (dateString: string): string => {
      const date = new Date(dateString);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) return t('trash.today');
      if (days === 1) return t('trash.yesterday');
      if (days < 7) return t('trash.daysAgo', { count: days });
      if (days < 30) return t('trash.weeksAgo', { count: Math.floor(days / 7) });
      return t('trash.monthsAgo', { count: Math.floor(days / 30) });
    },
    [t]
  );

  const renderTrashItem = (item: TrashItem) => (
    <div
      key={item.id}
      className={`trash-item ${selectedItems.includes(item.id) ? 'selected' : ''}`}
      onClick={() => handleSelectItem(item.id)}
    >
      <div className="trash-item-checkbox">
        <input
          type="checkbox"
          checked={selectedItems.includes(item.id)}
          onChange={() => handleSelectItem(item.id)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className="trash-item-icon">
        {item.type === 'folder' ? (
          <span className="icon-folder">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </span>
        ) : (
          <span className="icon-file">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </span>
        )}
      </div>

      <div className="trash-item-info">
        <div className="trash-item-name">{item.name}</div>
        <div className="trash-item-meta">
          {item.type === 'file' && item.size && (
            <span className="meta-size">{formatSize(item.size)}</span>
          )}
          {item.parentFolderName && (
            <span className="meta-location">
              {t('trash.from', { folder: item.parentFolderName })}
            </span>
          )}
          <span className="meta-date">
            {t('trash.deletedDate', { date: formatDate(item.deletedAt) })}
          </span>
        </div>
      </div>

      <div className="trash-item-actions">
        <button
          className="btn-restore"
          onClick={(e) => {
            e.stopPropagation();
            handleRestore(item.id);
          }}
          disabled={operationInProgress}
          title={t('trash.restore')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          {t('trash.restore')}
        </button>
        <button
          className="btn-delete-permanent"
          onClick={(e) => {
            e.stopPropagation();
            confirmPermanentDelete(item.id);
          }}
          disabled={operationInProgress}
          title={t('trash.deletePermanently')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          {t('trash.deletePermanently')}
        </button>
      </div>
    </div>
  );

  const renderGroupedItems = () => {
    const groups: { key: string; labelKey: string }[] = [
      { key: 'today', labelKey: 'trash.today' },
      { key: 'yesterday', labelKey: 'trash.yesterday' },
      { key: 'thisWeek', labelKey: 'trash.thisWeek' },
      { key: 'thisMonth', labelKey: 'trash.thisMonth' },
      { key: 'older', labelKey: 'trash.older' },
    ];

    return groups.map((group) => {
      const items = itemsByDate[group.key as keyof typeof itemsByDate];
      if (!items || items.length === 0) return null;

      return (
        <div key={group.key} className="trash-group">
          <h3 className="trash-group-title">
            {t(group.labelKey)} ({items.length})
          </h3>
          <div className="trash-group-items">{items.map(renderTrashItem)}</div>
        </div>
      );
    });
  };

  if (loading && trashItems.length === 0) {
    return (
      <div className="trash-view loading">
        <div className="loading-spinner">{t('trash.loading')}</div>
      </div>
    );
  }

  return (
    <div className="trash-view">
      <div className="trash-header">
        <div className="trash-title">
          <h1>{t('trash.title')}</h1>
          <div className="trash-stats">
            {itemsCount > 0 && (
              <>
                <span>{t('trash.itemCount', { count: itemsCount })}</span>
                {totalSize > 0 && <span> &bull; {formatSize(totalSize)}</span>}
              </>
            )}
          </div>
        </div>

        <div className="trash-actions">
          {selectedItems.length > 0 && (
            <>
              <button
                className="btn-restore-selected"
                onClick={handleRestoreSelected}
                disabled={operationInProgress}
              >
                {t('trash.restoreSelection', { count: selectedItems.length })}
              </button>
              <button
                className="btn-delete-selected"
                onClick={confirmDeleteSelected}
                disabled={operationInProgress}
              >
                {t('trash.deleteSelection', { count: selectedItems.length })}
              </button>
            </>
          )}

          {!isEmpty && (
            <>
              <button
                className="btn-select-all"
                onClick={handleSelectAll}
                disabled={operationInProgress}
              >
                {selectedItems.length === trashItems.length
                  ? t('trash.deselectAll')
                  : t('trash.selectAll')}
              </button>
              <button
                className="btn-empty-trash"
                onClick={confirmEmptyTrash}
                disabled={operationInProgress}
              >
                {t('trash.emptyTrash')}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="trash-error">
          <p>{t('trash.error', { message: error.message })}</p>
          <button onClick={() => dispatch(clearTrashErrors())}>{t('trash.errorClose')}</button>
        </div>
      )}

      <div className="trash-content">
        {isEmpty ? (
          <div className="trash-empty">
            <div className="empty-icon">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <h2>{t('trash.emptyState')}</h2>
            <p>{t('trash.emptyStateDesc')}</p>
          </div>
        ) : (
          <div className="trash-items-container">{renderGroupedItems()}</div>
        )}
      </div>

      {showConfirmDialog && (
        <div className="confirm-dialog-overlay" onClick={closeConfirmDialog}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>{t('trash.confirmTitle')}</h2>
            <p>
              {confirmAction === 'empty'
                ? t('trash.confirmEmpty', { count: itemsCount })
                : confirmAction === 'deleteBatch'
                  ? t('trash.confirmDeleteBatch', { count: selectedItems.length })
                  : t('trash.confirmDelete')}
            </p>
            <div className="confirm-dialog-actions">
              <button
                className="btn-cancel"
                onClick={closeConfirmDialog}
                disabled={operationInProgress}
              >
                {t('trash.cancel')}
              </button>
              <button
                className="btn-confirm"
                disabled={operationInProgress}
                onClick={() => {
                  if (confirmAction === 'empty') {
                    handleEmptyTrash();
                  } else if (confirmAction === 'deleteBatch') {
                    handleDeleteSelected();
                  } else if (confirmAction === 'delete' && itemToDelete) {
                    const item = trashItems.find((i) => i.id === itemToDelete);
                    handlePermanentlyDelete(itemToDelete, item?.parentFolderId);
                  }
                }}
              >
                {operationInProgress ? '...' : t('trash.confirmDeleteButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrashView;
