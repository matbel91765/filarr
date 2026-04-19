/**
 * ProgressBar Component
 * Composant de barre de progression avec modes déterminé et indéterminé
 */

import React from 'react';
import './ProgressBar.css';

export type ProgressBarVariant = 'default' | 'success' | 'warning' | 'error' | 'primary';
export type ProgressBarSize = 'sm' | 'md' | 'lg';

export interface ProgressBarProps {
  /** Valeur actuelle de la progression (0-100) */
  value?: number;
  /** Valeur maximale (défaut: 100) */
  max?: number;
  /** Variante de couleur */
  variant?: ProgressBarVariant;
  /** Taille de la barre */
  size?: ProgressBarSize;
  /** Label optionnel affiché au-dessus */
  label?: string;
  /** Afficher la valeur en pourcentage */
  showValue?: boolean;
  /** Mode indéterminé (animation de chargement) */
  indeterminate?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
}

/**
 * Composant ProgressBar
 * Barre de progression linéaire avec support des modes déterminé et indéterminé
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  value = 0,
  max = 100,
  variant = 'default',
  size = 'md',
  label,
  showValue = false,
  indeterminate = false,
  className = '',
}) => {
  // Clamp la valeur entre 0 et max
  const clampedValue = Math.min(Math.max(0, value), max);
  const percentage = (clampedValue / max) * 100;

  // Classes CSS
  const containerClasses = [
    'progress-bar-container',
    className,
  ].filter(Boolean).join(' ');

  const barClasses = [
    'progress-bar',
    `progress-bar--${variant}`,
    `progress-bar--${size}`,
    indeterminate && 'progress-bar--indeterminate',
  ].filter(Boolean).join(' ');

  const fillClasses = [
    'progress-bar__fill',
    `progress-bar__fill--${variant}`,
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClasses}>
      {/* Header avec label et valeur */}
      {(label || showValue) && (
        <div className="progress-bar__header">
          {label && <span className="progress-bar__label">{label}</span>}
          {showValue && !indeterminate && (
            <span className="progress-bar__value">{Math.round(percentage)}%</span>
          )}
        </div>
      )}

      {/* Barre de progression */}
      <div
        className={barClasses}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : clampedValue}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label || 'Progress'}
        aria-busy={indeterminate}
      >
        {!indeterminate && (
          <div
            className={fillClasses}
            style={{ width: `${percentage}%` }}
          />
        )}
        {indeterminate && (
          <div className={fillClasses} />
        )}
      </div>
    </div>
  );
};

export default ProgressBar;
