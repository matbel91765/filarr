/**
 * NotificationProvider Component
 *
 * Provider pour gérer l'état global des notifications via Context API
 */

import React, { createContext, useState, useCallback, useMemo, useRef, ReactNode } from 'react';
import { NotificationContainer, NotificationPosition } from './NotificationContainer';
import { NotificationProps, NotificationType, NotificationAction } from './Notification';

export interface NotificationOptions {
  /** Type de notification */
  type: NotificationType;
  /** Message principal */
  message: string;
  /** Titre optionnel */
  title?: string;
  /** Durée d'affichage en ms (0 = persistant) */
  duration?: number;
  /** Icône personnalisée */
  icon?: React.ReactNode;
  /** Action optionnelle */
  action?: NotificationAction;
}

export interface NotificationContextValue {
  /** Afficher une notification */
  notify: (options: NotificationOptions) => string;
  /** Afficher une notification de succès */
  success: (message: string, title?: string, duration?: number) => string;
  /** Afficher une notification d'erreur */
  error: (message: string, title?: string, duration?: number) => string;
  /** Afficher une notification d'avertissement */
  warning: (message: string, title?: string, duration?: number) => string;
  /** Afficher une notification d'information */
  info: (message: string, title?: string, duration?: number) => string;
  /** Fermer une notification spécifique */
  dismiss: (id: string) => void;
  /** Fermer toutes les notifications */
  dismissAll: () => void;
}

export const NotificationContext = createContext<NotificationContextValue | undefined>(
  undefined
);

export interface NotificationProviderProps {
  /** Enfants */
  children: ReactNode;
  /** Position des notifications */
  position?: NotificationPosition;
  /** Nombre maximum de notifications visibles */
  maxNotifications?: number;
}

/**
 * Provider pour les notifications
 */
export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
  position = 'top-right',
  maxNotifications = 5,
}) => {
  const [notifications, setNotifications] = useState<
    Omit<NotificationProps, 'onClose'>[]
  >([]);

  // Utiliser un ref pour le compteur — pas de re-render quand l'ID change
  const nextIdRef = useRef(1);

  const notify = useCallback(
    (options: NotificationOptions): string => {
      const id = `notification-${nextIdRef.current++}`;
      const notification: Omit<NotificationProps, 'onClose'> = {
        id,
        type: options.type,
        message: options.message,
        title: options.title,
        duration: options.duration ?? 5000,
        icon: options.icon,
        action: options.action,
      };

      setNotifications((prev) => [notification, ...prev]);
      return id;
    },
    []
  );

  const success = useCallback(
    (message: string, title?: string, duration?: number): string => {
      return notify({ type: 'success', message, title, duration });
    },
    [notify]
  );

  const error = useCallback(
    (message: string, title?: string, duration?: number): string => {
      return notify({ type: 'error', message, title, duration });
    },
    [notify]
  );

  const warning = useCallback(
    (message: string, title?: string, duration?: number): string => {
      return notify({ type: 'warning', message, title, duration });
    },
    [notify]
  );

  const info = useCallback(
    (message: string, title?: string, duration?: number): string => {
      return notify({ type: 'info', message, title, duration });
    },
    [notify]
  );

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Memoiser le context value pour éviter de re-render tous les consommateurs
  const contextValue = useMemo<NotificationContextValue>(() => ({
    notify,
    success,
    error,
    warning,
    info,
    dismiss,
    dismissAll,
  }), [notify, success, error, warning, info, dismiss, dismissAll]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <NotificationContainer
        position={position}
        notifications={notifications}
        onClose={dismiss}
        maxNotifications={maxNotifications}
      />
    </NotificationContext.Provider>
  );
};

export default NotificationProvider;
