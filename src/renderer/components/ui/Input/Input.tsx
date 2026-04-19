/**
 * Input Component
 *
 * Composant input réutilisable avec support d'icônes, états d'erreur et variantes
 */

import React, { forwardRef, InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import './Input.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Label du champ */
  label?: string;
  /** Message d'erreur */
  error?: string;
  /** Message d'aide */
  helperText?: string;
  /** Icône à gauche */
  leftIcon?: React.ReactNode;
  /** Icône à droite */
  rightIcon?: React.ReactNode;
  /** Taille de l'input */
  size?: 'sm' | 'md' | 'lg';
  /** Variante */
  variant?: 'default' | 'filled' | 'outlined';
  /** Pleine largeur */
  fullWidth?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
  /** Classe CSS pour le conteneur */
  containerClassName?: string;
}

/**
 * Composant Input
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      size = 'md',
      variant = 'default',
      fullWidth = false,
      className,
      containerClassName,
      disabled,
      required,
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = Boolean(error);

    const containerClasses = clsx(
      'input-container',
      {
        'input-container--full-width': fullWidth,
        'input-container--disabled': disabled,
      },
      containerClassName
    );

    const wrapperClasses = clsx(
      'input-wrapper',
      `input-wrapper--${size}`,
      `input-wrapper--${variant}`,
      {
        'input-wrapper--error': hasError,
        'input-wrapper--disabled': disabled,
        'input-wrapper--with-left-icon': leftIcon,
        'input-wrapper--with-right-icon': rightIcon,
      }
    );

    const inputClasses = clsx(
      'input',
      `input--${size}`,
      {
        'input--with-left-icon': leftIcon,
        'input--with-right-icon': rightIcon,
      },
      className
    );

    return (
      <div className={containerClasses}>
        {label && (
          <label htmlFor={inputId} className="input-label">
            {label}
            {required && <span className="input-label__required">*</span>}
          </label>
        )}

        <div className={wrapperClasses}>
          {leftIcon && (
            <span className="input-icon input-icon--left" aria-hidden="true">
              {leftIcon}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            className={inputClasses}
            disabled={disabled}
            required={required}
            aria-invalid={hasError}
            aria-describedby={
              error
                ? `${inputId}-error`
                : helperText
                ? `${inputId}-helper`
                : undefined
            }
            {...props}
          />

          {rightIcon && (
            <span className="input-icon input-icon--right" aria-hidden="true">
              {rightIcon}
            </span>
          )}
        </div>

        {error && (
          <p id={`${inputId}-error`} className="input-message input-message--error">
            {error}
          </p>
        )}

        {!error && helperText && (
          <p id={`${inputId}-helper`} className="input-message input-message--helper">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
