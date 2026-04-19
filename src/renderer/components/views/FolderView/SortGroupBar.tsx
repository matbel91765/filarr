/**
 * SortGroupBar Component
 *
 * Barre de controle pour le tri, le groupement et le mode de vue.
 */

import React, { useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button/Button';
import { Dropdown } from '../../ui/Dropdown/Dropdown';
import { setSortBy, setGroupBy, setViewMode } from '../../../../store/slices/uiSlice';
import type { RootState, AppDispatch } from '../../../../store';
import type { SortOption, ViewMode } from '../../../../types';

const SortAscIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75L17.25 9m0 0L21 12.75M17.25 9v12" />
  </svg>
);

const SortDescIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0l-3.75-3.75M17.25 21L21 17.25" />
  </svg>
);

const ListIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);

const GridIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
  </svg>
);

const GroupIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
  </svg>
);

interface SortGroupBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  className?: string;
}

export const SortGroupBar: React.FC<SortGroupBarProps> = ({ searchQuery, onSearchChange, className }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { sortBy, groupBy, viewMode } = useSelector((state: RootState) => ({
    sortBy: state.ui.sortBy,
    groupBy: state.ui.groupBy,
    viewMode: state.ui.viewMode,
  }));

  const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = useMemo(() => [
    { value: 'name', label: t('sort.name') },
    { value: 'date', label: t('sort.date') },
    { value: 'size', label: t('sort.size') },
    { value: 'type', label: t('sort.type') },
  ], [t]);

  const GROUP_OPTIONS: Array<{ value: 'none' | 'type' | 'date' | 'firstLetter'; label: string }> = useMemo(() => [
    { value: 'none', label: t('sort.none') },
    { value: 'type', label: t('sort.type') },
    { value: 'date', label: t('sort.date') },
    { value: 'firstLetter', label: t('sort.letter') },
  ], [t]);

  const currentSortLabel = SORT_OPTIONS.find(o => o.value === sortBy.field)?.label || t('sort.name');
  const currentGroupLabel = GROUP_OPTIONS.find(o => o.value === groupBy.field)?.label || t('sort.none');

  const handleSetViewMode = (mode: ViewMode) => {
    dispatch(setViewMode(mode));
  };

  return (
    <div className={`flex items-center justify-between px-6 py-2.5 bg-[var(--color-surface)] border-b border-[var(--color-border-light)] shrink-0 ${className || ''}`}>
      {/* Search */}
      <div className="flex-1 max-w-[400px]">
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)] pointer-events-none">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder={t('sort.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-[var(--color-background-secondary)]
              border border-transparent text-sm text-[var(--color-text-primary)]
              placeholder:text-[var(--color-text-tertiary)]
              focus:bg-[var(--color-surface)] focus:border-[var(--color-primary-300)]
              focus:ring-1 focus:ring-[var(--color-primary-300)] focus:outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full
                text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]
                hover:bg-[var(--color-background-secondary)] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Sort */}
        <Dropdown
          trigger={
            <Button variant="ghost" size="sm">
              {t('sort.sortBy')}: {currentSortLabel}
            </Button>
          }
          items={SORT_OPTIONS.map(opt => ({
            label: opt.label,
            onClick: () => dispatch(setSortBy({ field: opt.value, order: sortBy.order })),
          }))}
          position="bottom-right"
        />

        {/* Sort direction */}
        <button
          onClick={() => dispatch(setSortBy({ field: sortBy.field, order: sortBy.order === 'asc' ? 'desc' : 'asc' }))}
          className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
            hover:bg-[var(--color-background-secondary)] transition-colors"
          title={sortBy.order === 'asc' ? t('sort.ascending') : t('sort.descending')}
        >
          {sortBy.order === 'asc' ? <SortAscIcon /> : <SortDescIcon />}
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-[var(--color-border)]" />

        {/* Group */}
        <Dropdown
          trigger={
            <Button variant="ghost" size="sm" leftIcon={<GroupIcon />}>
              {groupBy.field !== 'none' ? currentGroupLabel : t('sort.group')}
            </Button>
          }
          items={GROUP_OPTIONS.map(opt => ({
            label: opt.label,
            onClick: () => dispatch(setGroupBy({
              field: opt.value,
              enabled: opt.value !== 'none',
            })),
          }))}
          position="bottom-right"
        />

        {/* Separator */}
        <div className="w-px h-5 bg-[var(--color-border)]" />

        {/* View toggle */}
        <div className="flex items-center bg-[var(--color-background-secondary)] border border-[var(--color-border)] rounded-lg p-0.5">
          <button
            onClick={() => handleSetViewMode('list')}
            className={`p-1.5 rounded-md transition-all duration-150
              ${viewMode === 'list'
                ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            aria-label={t('sort.listView')}
          >
            <ListIcon />
          </button>
          <button
            onClick={() => handleSetViewMode('grid')}
            className={`p-1.5 rounded-md transition-all duration-150
              ${viewMode === 'grid'
                ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            aria-label={t('sort.gridView')}
          >
            <GridIcon />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SortGroupBar;
