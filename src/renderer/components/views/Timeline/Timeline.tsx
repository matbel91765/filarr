/**
 * Timeline — Vue chronologie d'activité
 *
 * Agrège tous les fichiers/dossiers depuis Redux, les affiche
 * par groupes temporels (Aujourd'hui, Hier, Cette semaine, etc.)
 * avec filtres par type d'action et type de fichier.
 */

import React, { useState, useMemo, useCallback, FC } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RootState } from '../../../../store';
import type { FileItem, Folder } from '../../../../types';

// ==================== Types ====================

interface TimelineEntry {
  id: string;
  name: string;
  action: 'created' | 'modified';
  timestamp: string;
  type: 'file' | 'folder';
  fileType?: string;
  folderId?: string;
  folderName?: string;
}

type TimeGroup = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older';

// ==================== Helpers ====================

const getTimeGroup = (dateStr: string): TimeGroup => {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= weekAgo) return 'thisWeek';
  if (date >= monthAgo) return 'thisMonth';
  return 'older';
};

// ==================== Icons ====================

const ClockIcon: FC = () => (
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
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const FileIcon: FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const FolderSmallIcon: FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const PlusIcon: FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const EditSmallIcon: FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

// ==================== Constants ====================

const ITEMS_PER_PAGE = 50;

// ==================== Component ====================

export const Timeline: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const GROUP_LABELS: Record<TimeGroup, string> = useMemo(
    () => ({
      today: t('timeline.today'),
      yesterday: t('timeline.yesterday'),
      thisWeek: t('timeline.thisWeek'),
      thisMonth: t('timeline.thisMonth'),
      older: t('timeline.older'),
    }),
    [t]
  );

  const FILE_TYPE_CATEGORIES: Record<string, string> = useMemo(
    () => ({
      image: t('timeline.typeImages'),
      video: t('timeline.typeVideos'),
      audio: t('timeline.typeAudio'),
      text: t('timeline.typeDocuments'),
      pdf: t('timeline.typePDF'),
    }),
    [t]
  );

  const formatRelativeTime = useCallback(
    (dateStr: string): string => {
      const date = new Date(dateStr);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return t('timeline.justNow');
      if (minutes < 60) return t('timeline.minutesAgo', { count: minutes });
      if (hours < 24) return t('timeline.hoursAgo', { count: hours });
      if (days < 7) return t('timeline.daysAgo', { count: days });
      return date.toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    },
    [t]
  );

  const [actionFilter, setActionFilter] = useState<'all' | 'created' | 'modified'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);

  // Get all files and folders from Redux
  const allFiles = useSelector(
    (state: RootState) =>
      state.files.allIds.map((id) => state.files.byId[id]).filter(Boolean) as FileItem[]
  );
  const allFolders = useSelector(
    (state: RootState) =>
      state.folders.allIds.map((id) => state.folders.byId[id]).filter(Boolean) as Folder[]
  );

  // Build folder name lookup
  const folderNameMap = useMemo(() => {
    const map = new Map<string, string>();
    allFolders.forEach((f) => map.set(f.id, f.name));
    return map;
  }, [allFolders]);

  // Build timeline entries.
  //
  // Defensive fallbacks for `createdAt`: a previous bug in
  // electron/main.ts:addItemToFolder stripped createdAt/updatedAt before
  // persisting items, so files saved by older builds may have only
  // `date` (legacy field) or no timestamp at all on disk. Fall back to
  // `date` then `updatedAt` so those orphan files still appear in the
  // timeline instead of vanishing after a sync that re-hydrates the
  // store from disk.
  const fileCreated = (f: FileItem): string | undefined =>
    f.createdAt || (f as any).date || f.updatedAt;
  const folderCreated = (f: Folder): string | undefined =>
    f.createdAt || (f as any).date || f.updatedAt;

  const allEntries = useMemo(() => {
    const entries: TimelineEntry[] = [];

    allFiles.forEach((file) => {
      const created = fileCreated(file);
      if (created) {
        entries.push({
          id: `${file.id}-created`,
          name: file.name,
          action: 'created',
          timestamp: created,
          type: 'file',
          fileType: file.type,
          folderId: file.parentId || undefined,
          folderName: file.parentId ? folderNameMap.get(file.parentId) : undefined,
        });
      }
      if (file.updatedAt && file.updatedAt !== created) {
        entries.push({
          id: `${file.id}-modified`,
          name: file.name,
          action: 'modified',
          timestamp: file.updatedAt,
          type: 'file',
          fileType: file.type,
          folderId: file.parentId || undefined,
          folderName: file.parentId ? folderNameMap.get(file.parentId) : undefined,
        });
      }
    });

    allFolders.forEach((folder) => {
      const created = folderCreated(folder);
      if (created) {
        entries.push({
          id: `${folder.id}-created`,
          name: folder.name,
          action: 'created',
          timestamp: created,
          type: 'folder',
        });
      }
    });

    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return entries;
  }, [allFiles, allFolders, folderNameMap]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return allEntries.filter((entry) => {
      if (actionFilter !== 'all' && entry.action !== actionFilter) return false;
      if (typeFilter !== 'all') {
        if (typeFilter === 'folder') return entry.type === 'folder';
        return entry.type === 'file' && entry.fileType === typeFilter;
      }
      return true;
    });
  }, [allEntries, actionFilter, typeFilter]);

  // Reset pagination whenever the filters change — otherwise a user who
  // had paginated past page 1 with no filters, then applied a filter,
  // would still see a slice of the freshly-filtered list rather than all
  // matches. Reverse case (filter narrows below visibleCount) was already
  // safe but resetting keeps the UX consistent.
  React.useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
  }, [actionFilter, typeFilter]);

  // When a filter is active, surface the entire filtered set — pagination
  // exists to tame the unfiltered firehose, not to hide matches the user
  // explicitly asked for. Without this, rare events (e.g. a single .heic
  // file at position 80 in the unfiltered timeline) could be hidden
  // behind a "Load more" button while looking like the filter found
  // nothing.
  const isFiltered = actionFilter !== 'all' || typeFilter !== 'all';
  const visibleEntries = isFiltered ? filteredEntries : filteredEntries.slice(0, visibleCount);
  const grouped = useMemo(() => {
    const groups: Partial<Record<TimeGroup, TimelineEntry[]>> = {};
    visibleEntries.forEach((entry) => {
      const group = getTimeGroup(entry.timestamp);
      if (!groups[group]) groups[group] = [];
      groups[group]!.push(entry);
    });
    return groups;
  }, [visibleEntries]);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + ITEMS_PER_PAGE);
  }, []);

  // Available file types for filter
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    allEntries.forEach((e) => {
      if (e.type === 'file' && e.fileType) types.add(e.fileType);
    });
    return [...types].sort();
  }, [allEntries]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
          <ClockIcon />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('timeline.title')}
          </h1>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {t('timeline.activityCount', { count: filteredEntries.length })}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-[var(--color-border-light)] bg-[var(--color-surface)] shrink-0">
        {/* Action filter */}
        {(['all', 'created', 'modified'] as const).map((action) => (
          <button
            key={action}
            onClick={() => setActionFilter(action)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              actionFilter === action
                ? 'bg-[var(--color-primary-100)] text-[var(--color-primary-700)] font-medium'
                : 'bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'
            }`}
          >
            {action === 'all'
              ? t('timeline.all')
              : action === 'created'
                ? t('timeline.created')
                : t('timeline.modified')}
          </button>
        ))}

        <span className="w-px h-4 bg-[var(--color-border)]" />

        {/* Type filter */}
        <button
          onClick={() => setTypeFilter('all')}
          className={`px-3 py-1 text-xs rounded-full transition-colors ${
            typeFilter === 'all'
              ? 'bg-[var(--color-primary-100)] text-[var(--color-primary-700)] font-medium'
              : 'bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'
          }`}
        >
          {t('timeline.allTypes')}
        </button>
        <button
          onClick={() => setTypeFilter('folder')}
          className={`px-3 py-1 text-xs rounded-full transition-colors ${
            typeFilter === 'folder'
              ? 'bg-[var(--color-primary-100)] text-[var(--color-primary-700)] font-medium'
              : 'bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'
          }`}
        >
          {t('timeline.folders')}
        </button>
        {availableTypes.map((type) => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              typeFilter === type
                ? 'bg-[var(--color-primary-100)] text-[var(--color-primary-700)] font-medium'
                : 'bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'
            }`}
          >
            {FILE_TYPE_CATEGORIES[type] || type}
          </button>
        ))}
      </div>

      {/* Timeline content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-tertiary)]">
            <ClockIcon />
            <p className="mt-3 text-sm">{t('timeline.noActivity')}</p>
          </div>
        ) : (
          <div className="max-w-[800px] mx-auto">
            {(['today', 'yesterday', 'thisWeek', 'thisMonth', 'older'] as TimeGroup[]).map(
              (group) => {
                const entries = grouped[group];
                if (!entries || entries.length === 0) return null;

                return (
                  <div key={group} className="mb-6">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3 sticky top-0 bg-[var(--color-background)] py-1 z-10">
                      {GROUP_LABELS[group]}
                    </h2>

                    <div className="relative pl-6 border-l-2 border-[var(--color-border-light)]">
                      {entries.map((entry) => (
                        <div key={entry.id} className="relative mb-3 last:mb-0">
                          {/* Dot on timeline */}
                          <div
                            className={`absolute -left-[25px] top-2 w-3 h-3 rounded-full border-2 border-[var(--color-surface)] ${
                              entry.action === 'created' ? 'bg-green-500' : 'bg-blue-500'
                            }`}
                          />

                          <div className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] hover:shadow-sm transition-shadow">
                            <div className="flex items-start gap-3">
                              {/* Icon */}
                              <div
                                className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${
                                  entry.type === 'folder'
                                    ? 'bg-amber-50 text-amber-600'
                                    : 'bg-blue-50 text-blue-600'
                                }`}
                              >
                                {entry.type === 'folder' ? <FolderSmallIcon /> : <FileIcon />}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                                    {entry.name}
                                  </span>
                                  <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full ${
                                      entry.action === 'created'
                                        ? 'bg-green-50 text-green-700'
                                        : 'bg-blue-50 text-blue-700'
                                    }`}
                                  >
                                    {entry.action === 'created' ? <PlusIcon /> : <EditSmallIcon />}
                                    {entry.action === 'created'
                                      ? t('timeline.actionCreated')
                                      : t('timeline.actionModified')}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 mt-1">
                                  {entry.folderName && entry.folderId && (
                                    <button
                                      onClick={() => navigate(`/folder/${entry.folderId}`)}
                                      className="text-xs text-[var(--color-primary-600)] hover:underline truncate max-w-[200px]"
                                    >
                                      {entry.folderName}
                                    </button>
                                  )}
                                  <span className="text-xs text-[var(--color-text-tertiary)]">
                                    {formatRelativeTime(entry.timestamp)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
            )}

            {/* Load more — hidden when a filter is active since filtered
                view shows every match (see visibleEntries above). */}
            {!isFiltered && visibleCount < filteredEntries.length && (
              <div className="flex justify-center py-4">
                <button
                  onClick={loadMore}
                  className="px-4 py-2 text-sm font-medium text-[var(--color-primary-600)] bg-[var(--color-primary-50)] rounded-lg hover:bg-[var(--color-primary-100)] transition-colors"
                >
                  {t('timeline.loadMore', { count: filteredEntries.length - visibleCount })}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Timeline;
