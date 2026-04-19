/**
 * NotificationContainer Component
 *
 * Container pour gérer l'affichage et le positionnement des notifications
 */

import React from 'react';
import clsx from 'clsx';
import { Notification, NotificationProps } from './Notification';
import './Notification.css';

export type NotificationPosition =
  | 'top-right'
  | 'top-left'
  | 'top-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center';

export interface NotificationContainerProps {
  /** Position du container */
  position?: NotificationPosition;
  /** Liste des notifications */
  notifications: Omit<NotificationProps, 'onClose'>[];
  /** Callback de fermeture */
  onClose: (id: string) => void;
  /** Nombre maximum de notifications visibles */
  maxNotifications?: number;
  /** Classe CSS additionnelle */
  className?: string;
}

/**
 * Composant NotificationContainer
 */
export const NotificationContainer: React.FC<NotificationContainerProps> = ({
  position = 'top-right',
  notifications,
  onClose,
  maxNotifications = 5,
  className,
}) => {
  // Limiter le nombre de notifications affichées
  const visibleNotifications = notifications.slice(0, maxNotifications);

  const containerClasses = clsx(
    'notification-container',
    `notification-container--${position}`,
    className
  );

  if (visibleNotifications.length === 0) {
    return null;
  }

  return (
    <div className={containerClasses} aria-live="polite" aria-atomic="false">
      {visibleNotifications.map((notification) => (
        <Notification
          key={notification.id}
          {...notification}
          onClose={onClose}
        />
      ))}
    </div>
  );
};

export default NotificationContainer;
