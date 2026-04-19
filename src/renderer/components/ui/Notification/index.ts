/**
 * Notification System - Public API
 *
 * Exports pour le système de notifications
 */

// Composants
export { Notification } from './Notification';
export type { NotificationProps, NotificationType, NotificationAction } from './Notification';

export { NotificationContainer } from './NotificationContainer';
export type { NotificationContainerProps, NotificationPosition } from './NotificationContainer';

export { NotificationProvider, NotificationContext } from './NotificationProvider';
export type {
  NotificationProviderProps,
  NotificationContextValue,
  NotificationOptions,
} from './NotificationProvider';

// Hook
export { useNotification } from './useNotification';

// Export par défaut du Provider (pour faciliter l'import)
export { NotificationProvider as default } from './NotificationProvider';
