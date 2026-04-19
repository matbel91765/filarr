/**
 * Button Component
 *
 * Composant bouton réutilisable avec variantes, tailles et états
 */

import React, { forwardRef, ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Variante du bouton */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
  /** Taille du bouton */
  size?: 'sm' | 'md' | 'lg';
  /** Icône à gauche */
  leftIcon?: React.ReactNode;
  /** Icône à droite */
  rightIcon?: React.ReactNode;
  /** État de chargement */
  loading?: boolean;
  /** Bouton pleine largeur */
  fullWidth?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
  /** Enfants (contenu du bouton) */
  children?: React.ReactNode;
}

/**
 * Composant Button
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      leftIcon,
      rightIcon,
      loading = false,
      fullWidth = false,
      className,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const buttonClasses = clsx(
      'button',
      `button--${variant}`,
      `button--${size}`,
      {
        'button--loading': loading,
        'button--full-width': fullWidth,
        'button--icon-only': !children && (leftIcon || rightIcon),
      },
      className
    );

    return (
      <button
        ref={ref}
        className={buttonClasses}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span className="button__spinner" aria-hidden="true">
            <svg
              className="button__spinner-icon"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="button__spinner-circle"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="button__spinner-path"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </span>
        )}

        {!loading && leftIcon && (
          <span className="button__icon button__icon--left" aria-hidden="true">
            {leftIcon}
          </span>
        )}

        {children && <span className="button__content">{children}</span>}

        {!loading && rightIcon && (
          <span className="button__icon button__icon--right" aria-hidden="true">
            {rightIcon}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
