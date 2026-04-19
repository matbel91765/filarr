/**
 * Checkbox Component
 *
 * Composant checkbox personnalisé avec support indeterminate, erreurs et tailles
 */

import { forwardRef, InputHTMLAttributes, useEffect, useRef } from 'react';
import clsx from 'clsx';
import './Checkbox.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Label du checkbox */
  label?: string;
  /** État indéterminé (trait horizontal) */
  indeterminate?: boolean;
  /** Message d'erreur */
  error?: string;
  /** Taille du checkbox */
  size?: 'sm' | 'md' | 'lg';
  /** Classe CSS additionnelle */
  className?: string;
  /** Classe CSS pour le conteneur */
  containerClassName?: string;
}

/**
 * Composant Checkbox
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      indeterminate = false,
      error,
      size = 'md',
      className,
      containerClassName,
      disabled,
      checked,
      id,
      ...props
    },
    ref
  ) => {
    const checkboxId = id || `checkbox-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = Boolean(error);
    const internalRef = useRef<HTMLInputElement>(null);

    // Gérer le ref forwarding et le ref interne
    const inputRef = (ref as any) || internalRef;

    // Gérer l'état indeterminate (ne peut être défini que via JavaScript)
    useEffect(() => {
      if (inputRef.current) {
        inputRef.current.indeterminate = indeterminate;
      }
    }, [indeterminate, inputRef]);

    const containerClasses = clsx(
      'checkbox-container',
      {
        'checkbox-container--disabled': disabled,
      },
      containerClassName
    );

    const wrapperClasses = clsx(
      'checkbox-wrapper',
      `checkbox-wrapper--${size}`,
      {
        'checkbox-wrapper--error': hasError,
      }
    );

    const checkboxClasses = clsx(
      'checkbox',
      `checkbox--${size}`,
      {
        'checkbox--checked': checked,
        'checkbox--indeterminate': indeterminate,
        'checkbox--error': hasError,
        'checkbox--disabled': disabled,
      },
      className
    );

    return (
      <div className={containerClasses}>
        <label htmlFor={checkboxId} className={wrapperClasses}>
          <input
            ref={inputRef}
            id={checkboxId}
            type="checkbox"
            className="checkbox__input"
            checked={checked}
            disabled={disabled}
            aria-invalid={hasError}
            aria-describedby={error ? `${checkboxId}-error` : undefined}
            {...props}
          />

          <span className={checkboxClasses} aria-hidden="true">
            {/* Checkmark icon */}
            {!indeterminate && (
              <svg
                className="checkbox__icon checkbox__icon--check"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M13.3333 4L6 11.3333L2.66667 8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}

            {/* Indeterminate icon */}
            {indeterminate && (
              <svg
                className="checkbox__icon checkbox__icon--indeterminate"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M4 8H12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </span>

          {label && <span className="checkbox-label">{label}</span>}
        </label>

        {error && (
          <p id={`${checkboxId}-error`} className="checkbox-error">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';

export default Checkbox;
