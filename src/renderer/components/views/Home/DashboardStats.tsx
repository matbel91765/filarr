/**
 * DashboardStats — Section de statistiques sur la page d'accueil
 *
 * Affiche des StatCards, un donut SVG par type de fichier,
 * et les top 5 plus gros dossiers. Zéro dépendance externe.
 */

import React, { useState, useMemo, FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../../../../store';
import { selectFilesStats } from '../../../../store/selectors/fileSelectors';

// ==================== Helpers ====================

const formatSize = (bytes: number, t: (key: string) => string): string => {
  if (bytes === 0) return `0 ${t('units.b')}`;
  const unitKeys = ['units.b', 'units.kb', 'units.mb', 'units.gb', 'units.tb'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${t(unitKeys[Math.min(i, unitKeys.length - 1)])}`;
};

// Memoized selectors to avoid creating new array references on every render
const selectAllFiles = createSelector(
  (state: RootState) => state.files.allIds,
  (state: RootState) => state.files.byId,
  (allIds, byId) => allIds.map((id) => byId[id]).filter(Boolean)
);

const selectAllFolders = createSelector(
  (state: RootState) => state.folders.allIds,
  (state: RootState) => state.folders.byId,
  (allIds, byId) => allIds.map((id) => byId[id]).filter(Boolean)
);

// ==================== Sub-components ====================

const StatCard: FC<{ label: string; value: string | number; icon: React.ReactNode }> = ({
  label,
  value,
  icon,
}) => (
  <div className="flex items-center gap-3 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm">
    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
      {icon}
    </div>
    <div>
      <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold text-[var(--color-text-primary)]">{value}</p>
    </div>
  </div>
);

// Donut SVG
const DonutChart: FC<{
  data: Array<{ label: string; value: number; color: string }>;
  noFilesLabel: string;
}> = ({ data, noFilesLabel }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0)
    return (
      <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">{noFilesLabel}</p>
    );

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg width="120" height="120" viewBox="0 0 100 100">
        {data.map((d, i) => {
          const pct = d.value / total;
          const dash = pct * circumference;
          const currentOffset = offset;
          offset += dash;
          return (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={d.color}
              strokeWidth="16"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-currentOffset}
              transform="rotate(-90 50 50)"
            />
          );
        })}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: '14px', fontWeight: 600, fill: 'var(--color-text-primary)' }}
        >
          {total}
        </text>
      </svg>
      <div className="flex flex-col gap-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-[var(--color-text-secondary)]">{d.label}</span>
            <span className="text-[var(--color-text-tertiary)] ml-auto">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Top folders bar chart
const TopFoldersChart: FC<{
  folders: Array<{ name: string; size: number }>;
  noFoldersLabel: string;
  formatSizeFn: (bytes: number) => string;
}> = ({ folders, noFoldersLabel, formatSizeFn }) => {
  if (folders.length === 0)
    return <p className="text-sm text-[var(--color-text-tertiary)]">{noFoldersLabel}</p>;
  const maxSize = Math.max(...folders.map((f) => f.size));

  return (
    <div className="flex flex-col gap-2">
      {folders.map((f, i) => (
        <div key={i} className="flex items-center gap-3">
          <span
            className="text-xs text-[var(--color-text-secondary)] w-28 truncate shrink-0"
            title={f.name}
          >
            {f.name}
          </span>
          <div className="flex-1 h-5 bg-[var(--color-background-secondary)] rounded overflow-hidden">
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${maxSize > 0 ? (f.size / maxSize) * 100 : 0}%`,
                backgroundColor: 'var(--color-primary-400)',
              }}
            />
          </div>
          <span className="text-xs text-[var(--color-text-tertiary)] w-16 text-right shrink-0">
            {formatSizeFn(f.size)}
          </span>
        </div>
      ))}
    </div>
  );
};

// ==================== Icons ====================

const FileIcon: FC = () => (
  <svg
    width="20"
    height="20"
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

const FolderIcon: FC = () => (
  <svg
    width="20"
    height="20"
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

const StorageIcon: FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

const ChevronIcon: FC<{ open: boolean }> = ({ open }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ==================== Main ====================

export const DashboardStats: FC = () => {
  const { t } = useTranslation();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('filarr-dashboard-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const fileStats = useSelector(selectFilesStats);
  const folderCount = useSelector((state: RootState) => state.folders.allIds.length);
  const allFiles = useSelector(selectAllFiles);
  const allFolders = useSelector(selectAllFolders);

  // File categories with colors for the donut — must be inside component for t()
  const fileCategories = useMemo(
    () =>
      ({
        image: { label: t('dashboard.images'), color: '#f59e0b' },
        video: { label: t('dashboard.videos'), color: '#8b5cf6' },
        audio: { label: t('dashboard.audio'), color: '#ec4899' },
        text: { label: t('dashboard.documents'), color: '#3b82f6' },
        pdf: { label: t('dashboard.pdf'), color: '#ef4444' },
      }) as Record<string, { label: string; color: string }>,
    [t]
  );

  const otherCategory = useMemo(() => ({ label: t('dashboard.other'), color: '#94a3b8' }), [t]);

  const localFormatSize = useMemo(() => (bytes: number) => formatSize(bytes, t), [t]);

  // Donut data — group by category (MIME prefix: "image/jpeg" → "image")
  const donutData = useMemo(() => {
    const groups: Record<string, number> = {};
    Object.entries(fileStats.typeDistribution).forEach(([type, count]) => {
      const mimePrefix = type.split('/')[0];
      // Check for PDF specifically (application/pdf)
      const category =
        type === 'application/pdf' ? 'pdf' : fileCategories[mimePrefix] ? mimePrefix : 'other';
      groups[category] = (groups[category] || 0) + count;
    });
    return Object.entries(groups)
      .map(([key, value]) => {
        const cat = fileCategories[key] || otherCategory;
        return { label: cat.label, value, color: cat.color };
      })
      .sort((a, b) => b.value - a.value);
  }, [fileStats.typeDistribution, fileCategories, otherCategory]);

  // Top 5 folders by total file size
  const topFolders = useMemo(() => {
    const folderSizes = new Map<string, { name: string; size: number }>();
    allFolders.forEach((f) => {
      if (f) folderSizes.set(f.id, { name: f.name, size: 0 });
    });
    allFiles.forEach((file) => {
      if (file?.parentId && folderSizes.has(file.parentId)) {
        const entry = folderSizes.get(file.parentId)!;
        entry.size += file.size || 0;
      }
    });
    return [...folderSizes.values()]
      .sort((a, b) => b.size - a.size)
      .slice(0, 5)
      .filter((f) => f.size > 0);
  }, [allFiles, allFolders]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('filarr-dashboard-collapsed', String(next));
    } catch {
      /* noop */
    }
  };

  return (
    <section className="mb-2">
      <button
        onClick={toggleCollapsed}
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3 hover:text-[var(--color-text-secondary)] transition-colors"
      >
        <ChevronIcon open={!collapsed} />
        {t('dashboard.title')}
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-4">
          {/* Stat cards row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard
              label={t('dashboard.files')}
              value={fileStats.totalCount}
              icon={<FileIcon />}
            />
            <StatCard label={t('dashboard.folders')} value={folderCount} icon={<FolderIcon />} />
            <StatCard
              label={t('dashboard.totalSize')}
              value={localFormatSize(fileStats.totalSize)}
              icon={<StorageIcon />}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Donut: file types */}
            <div className="p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
                {t('dashboard.typeDistribution')}
              </p>
              <DonutChart data={donutData} noFilesLabel={t('dashboard.noFiles')} />
            </div>

            {/* Top folders */}
            <div className="p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
                {t('dashboard.topFoldersBySize')}
              </p>
              <TopFoldersChart
                folders={topFolders}
                noFoldersLabel={t('dashboard.noFolders')}
                formatSizeFn={localFormatSize}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default DashboardStats;
