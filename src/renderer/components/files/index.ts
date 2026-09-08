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

// Briques présentationnelles de l'explorateur — partagées entre l'espace
// personnel (FolderView) et le navigateur de coffre partagé.
export {
  FileCard,
  FileThumbnail,
  FileTagPills,
  MovingOverlay,
  FileIcon,
  FolderIcon,
  EMPTY_TAGS,
  formatSize,
  formatDate,
} from './FileCard';
export type { ExplorerItem, FileCardProps } from './FileCard';
export { SubfolderCard } from './SubfolderCard';
export type { ExplorerFolder, SubfolderCardProps } from './SubfolderCard';
export { SharedBadge } from './SharedBadge';
export type { SharedBadgeProps, SharedBadgeVariant } from './SharedBadge';
export { ExplorerHeader } from './ExplorerHeader';
export type { ExplorerHeaderProps } from './ExplorerHeader';
