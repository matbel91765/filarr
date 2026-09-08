/**
 * SyncProgressBar — Thin upload progress indicator
 *
 * Rendered just below the Header.
 * Visible when pendingItems > 0 and accountMode === 'cloud'.
 * Fades out smoothly when sync completes.
 */

import React from 'react';
import { useSyncStatus } from '../../../hooks/useSyncStatus';

const SyncProgressBar: React.FC = () => {
  const { isCloud, pendingItems, syncProgress } = useSyncStatus();

  const visible = isCloud && pendingItems > 0;

  return (
    <div
      style={{
        height: visible ? 3 : 0,
        opacity: visible ? 1 : 0,
        transition: 'height 0.3s ease, opacity 0.3s ease',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.max(syncProgress, 2)}%`,
          backgroundColor: 'var(--color-primary-500)',
          transition: 'width 0.5s ease',
          borderRadius: '0 2px 2px 0',
        }}
      />
    </div>
  );
};

export default React.memo(SyncProgressBar);
