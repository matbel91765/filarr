/**
 * CircularProgress Component
 * Indicateur de progression circulaire avec modes déterminé et indéterminé
 */

import React from 'react';
import './CircularProgress.css';

export type CircularProgressVariant = 'default' | 'success' | 'warning' | 'error';
export type CircularProgressSize = 'sm' | 'md' | 'lg' | 'xl';
export type CircularProgressThickness = 'fine' | 'normal' | 'bold';

export interface CircularProgressProps {
  /** Valeur actuelle de la progression (0-100) */
  value?: number;
  /** Taille du cercle */
  size?: CircularProgressSize;
  /** Variante de couleur */
  variant?: CircularProgressVariant;
  /** Épaisseur du trait */
  thickness?: CircularProgressThickness;
  /** Afficher la valeur en pourcentage au centre */
  showValue?: boolean;
  /** Mode indéterminé (animation de rotation) */
  indeterminate?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
}

// Mapping des tailles en pixels
const SIZE_MAP: Record<CircularProgressSize, number> = {
  sm: 32,
  md: 48,
  lg: 64,
  xl: 96,
};

// Mapping des épaisseurs en pixels
const THICKNESS_MAP: Record<CircularProgressThickness, number> = {
  fine: 2,
  normal: 4,
  bold: 6,
};

/**
 * Composant CircularProgress
 * Indicateur de progression circulaire avec animation SVG
 */
export const CircularProgress: React.FC<CircularProgressProps> = ({
  value = 0,
  size = 'md',
  variant = 'default',
  thickness = 'normal',
  showValue = false,
  indeterminate = false,
  className = '',
}) => {
  // Dimensions
  const sizeInPx = SIZE_MAP[size];
  const strokeWidth = THICKNESS_MAP[thickness];
  const radius = (sizeInPx - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Clamp la valeur entre 0 et 100
  const clampedValue = Math.min(Math.max(0, value), 100);
  const percentage = clampedValue;

  // Calcul du stroke-dashoffset pour le mode déterminé
  const strokeDashoffset = indeterminate
    ? circumference * 0.75 // 25% visible pour l'animation
    : circumference - (percentage / 100) * circumference;

  // Classes CSS
  const containerClasses = [
    'circular-progress',
    `circular-progress--${size}`,
    `circular-progress--${variant}`,
    indeterminate && 'circular-progress--indeterminate',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={containerClasses}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-busy={indeterminate}
    >
      <svg
        width={sizeInPx}
        height={sizeInPx}
        viewBox={`0 0 ${sizeInPx} ${sizeInPx}`}
        className="circular-progress__svg"
      >
        {/* Cercle de fond */}
        <circle
          className="circular-progress__track"
          cx={sizeInPx / 2}
          cy={sizeInPx / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
        />

        {/* Cercle de progression */}
        <circle
          className={`circular-progress__circle circular-progress__circle--${variant}`}
          cx={sizeInPx / 2}
          cy={sizeInPx / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${sizeInPx / 2} ${sizeInPx / 2})`}
        />
      </svg>

      {/* Valeur au centre */}
      {showValue && !indeterminate && (
        <div className="circular-progress__value">
          {Math.round(percentage)}%
        </div>
      )}
    </div>
  );
};

export default CircularProgress;
