/**
 * Files Components Index
 *
 * Exports all file-related components including password protection.
 */

export {
  FilePasswordModal,
  default as FilePasswordModalDefault,
  isItemUnlocked,
  unlockItemSession,
  lockItemSession,
  cleanupExpiredSessions,
} from './FilePasswordModal';

// Re-export types
export type {
  FilePasswordModalProps,
  FilePasswordMode,
  FilePasswordResult,
} from './FilePasswordModal';
