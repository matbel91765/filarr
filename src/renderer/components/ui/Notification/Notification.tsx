/**
 * Notification Component (Toast)
 *
 * Composant notification/toast avec auto-dismiss, icônes et actions
 */

import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import './Notification.css';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationAction {
  /** Label du bouton d'action */
  label: string;
  /** Callback au clic */
  onClick: () => void;
  /** Variante du bouton d'action */
  variant?: 'primary' | 'secondary';
}

export interface NotificationProps {
  /** ID unique de la notification */
  id: string;
  /** Type de notification */
  type: NotificationType;
  /** Message principal */
  message: string;
  /** Titre optionnel */
  title?: string;
  /** Durée d'affichage en ms (0 = persistant) */
  duration?: number;
  /** Callback à la fermeture */
  onClose: (id: string) => void;
  /** Icône personnalisée (remplace l'icône par défaut) */
  icon?: React.ReactNode;
  /** Action optionnelle */
  action?: NotificationAction;
  /** Classe CSS additionnelle */
  className?: string;
}

// Icônes SVG par défaut
const SuccessIcon = () => (
  <svg
    className="notification__default-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const ErrorIcon = () => (
  <svg
    className="notification__default-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const WarningIcon = () => (
  <svg
    className="notification__default-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const InfoIcon = () => (
  <svg
    className="notification__default-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const CloseIcon = () => (
  <svg
    className="notification__close-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const iconMap: Record<NotificationType, React.ReactNode> = {
  success: <SuccessIcon />,
  error: <ErrorIcon />,
  warning: <WarningIcon />,
  info: <InfoIcon />,
};

/**
 * Composant Notification (Toast)
 */
export const Notification: React.FC<NotificationProps> = ({
  id,
  type,
  message,
  title,
  duration = 5000,
  onClose,
  icon,
  action,
  className,
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const remainingTimeRef = useRef<number>(duration);
  const startTimeRef = useRef<number>(Date.now());

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose(id);
    }, 300); // Durée de l'animation de sortie
  };

  const startTimer = () => {
    if (duration > 0 && !isPaused) {
      startTimeRef.current = Date.now();
      timerRef.current = setTimeout(() => {
        handleClose();
      }, remainingTimeRef.current);
    }
  };

  const pauseTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const elapsed = Date.now() - startTimeRef.current;
      remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
    }
  };

  useEffect(() => {
    startTimer();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isPaused]);

  const handleMouseEnter = () => {
    setIsPaused(true);
    pauseTimer();
  };

  const handleMouseLeave = () => {
    setIsPaused(false);
  };

  const notificationClasses = clsx(
    'notification',
    `notification--${type}`,
    {
      'notification--exiting': isExiting,
    },
    className
  );

  const displayIcon = icon || iconMap[type];

  return (
    <div
      className={notificationClasses}
      role="alert"
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Indicateur de type (border-left) */}
      <div className={`notification__indicator notification__indicator--${type}`} />

      {/* Icône */}
      <div className={`notification__icon notification__icon--${type}`}>
        {displayIcon}
      </div>

      {/* Contenu */}
      <div className="notification__content">
        {title && <div className="notification__title">{title}</div>}
        <div className="notification__message">{message}</div>

        {/* Action optionnelle */}
        {action && (
          <div className="notification__action">
            <button
              type="button"
              className={clsx(
                'notification__action-button',
                action.variant === 'primary' && 'notification__action-button--primary'
              )}
              onClick={() => {
                action.onClick();
                handleClose();
              }}
            >
              {action.label}
            </button>
          </div>
        )}
      </div>

      {/* Bouton de fermeture */}
      <button
        type="button"
        className="notification__close"
        onClick={handleClose}
        aria-label="Fermer la notification"
      >
        <CloseIcon />
      </button>

      {/* Barre de progression (si durée définie) */}
      {duration > 0 && (
        <div className="notification__progress">
          <div
            className={`notification__progress-bar notification__progress-bar--${type}`}
            style={{
              animationDuration: `${duration}ms`,
              animationPlayState: isPaused ? 'paused' : 'running',
            }}
          />
        </div>
      )}
    </div>
  );
};

export default Notification;
