/**
 * Radio Component
 *
 * Composant radio personnalisé avec support d'erreurs et de tailles
 */

import { forwardRef, InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import './Radio.css';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  /** Label du radio */
  label?: string;
  /** Message d'erreur */
  error?: string;
  /** Taille du radio */
  size?: 'sm' | 'md' | 'lg';
  /** Classe CSS additionnelle */
  className?: string;
  /** Classe CSS pour le conteneur */
  containerClassName?: string;
}

/**
 * Composant Radio
 */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  (
    {
      label,
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
    const radioId = id || `radio-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = Boolean(error);

    const containerClasses = clsx(
      'radio-container',
      {
        'radio-container--disabled': disabled,
      },
      containerClassName
    );

    const wrapperClasses = clsx(
      'radio-wrapper',
      `radio-wrapper--${size}`,
      {
        'radio-wrapper--error': hasError,
      }
    );

    const radioClasses = clsx(
      'radio',
      `radio--${size}`,
      {
        'radio--checked': checked,
        'radio--error': hasError,
        'radio--disabled': disabled,
      },
      className
    );

    return (
      <div className={containerClasses}>
        <label htmlFor={radioId} className={wrapperClasses}>
          <input
            ref={ref}
            id={radioId}
            type="radio"
            className="radio__input"
            checked={checked}
            disabled={disabled}
            aria-invalid={hasError}
            aria-describedby={error ? `${radioId}-error` : undefined}
            {...props}
          />

          <span className={radioClasses} aria-hidden="true">
            {/* Radio dot */}
            <span className="radio__dot"></span>
          </span>

          {label && <span className="radio-label">{label}</span>}
        </label>

        {error && (
          <p id={`${radioId}-error`} className="radio-error">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Radio.displayName = 'Radio';

export default Radio;
