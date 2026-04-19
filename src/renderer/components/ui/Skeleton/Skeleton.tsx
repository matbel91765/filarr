/**
 * Skeleton Loader Components
 *
 * Placeholder loading components that mimic content shape while data loads.
 * Uses CSS shimmer animation with dark mode support.
 */

import React, { FC } from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
}

export const Skeleton: FC<SkeletonProps> = ({
  width = '100%',
  height = '1rem',
  borderRadius = '0.375rem',
  className = '',
}) => (
  <div
    className={`animate-pulse bg-[var(--color-background-secondary)] ${className}`}
    style={{ width, height, borderRadius }}
    role="presentation"
    aria-hidden="true"
  />
);

export const SkeletonText: FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className = '',
}) => (
  <div className={`space-y-2 ${className}`} role="presentation" aria-hidden="true">
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        height="0.75rem"
        width={i === lines - 1 ? '60%' : '100%'}
      />
    ))}
  </div>
);

export const SkeletonCard: FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 ${className}`}
    role="presentation"
    aria-hidden="true"
  >
    <Skeleton width="40%" height="1rem" className="mb-3" />
    <Skeleton width="70%" height="2rem" className="mb-2" />
    <SkeletonText lines={2} />
  </div>
);

export const SkeletonTable: FC<{ rows?: number; cols?: number; className?: string }> = ({
  rows = 5,
  cols = 4,
  className = '',
}) => (
  <div
    className={`bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden ${className}`}
    role="presentation"
    aria-hidden="true"
  >
    {/* Header */}
    <div className="flex gap-4 px-6 py-3 border-b border-[var(--color-border-light)] bg-[var(--color-background-secondary)]">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} width={i === 0 ? '30%' : '15%'} height="0.625rem" />
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, row) => (
      <div key={row} className="flex gap-4 px-6 py-3 border-b border-[var(--color-border-light)]">
        {Array.from({ length: cols }).map((_, col) => (
          <Skeleton key={col} width={col === 0 ? '30%' : '15%'} height="0.75rem" />
        ))}
      </div>
    ))}
  </div>
);

export const SkeletonList: FC<{ items?: number; className?: string }> = ({
  items = 4,
  className = '',
}) => (
  <div className={`space-y-3 ${className}`} role="presentation" aria-hidden="true">
    {Array.from({ length: items }).map((_, i) => (
      <div
        key={i}
        className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
      >
        <Skeleton width="2.5rem" height="2.5rem" borderRadius="50%" />
        <div className="flex-1 space-y-1.5">
          <Skeleton width="50%" height="0.75rem" />
          <Skeleton width="80%" height="0.625rem" />
        </div>
        <Skeleton width="4rem" height="1.5rem" borderRadius="0.5rem" />
      </div>
    ))}
  </div>
);

export const SkeletonDashboard: FC = () => (
  <div className="space-y-6" role="presentation" aria-hidden="true">
    {/* Stat cards */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
    {/* Chart placeholder */}
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5">
      <Skeleton width="30%" height="1rem" className="mb-4" />
      <Skeleton width="100%" height="12rem" />
    </div>
    {/* Table */}
    <SkeletonTable rows={4} cols={5} />
  </div>
);

export default Skeleton;
