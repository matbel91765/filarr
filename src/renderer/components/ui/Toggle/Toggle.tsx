/**
 * Toggle Component (Switch)
 *
 * Composant toggle/switch avec animation slide et support de tailles
 */

import { forwardRef, InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import './Toggle.css';

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  /** Label du toggle */
  label?: string;
  /** Position du label */
  labelPosition?: 'left' | 'right';
  /** Taille du toggle */
  size?: 'sm' | 'md' | 'lg';
  /** Classe CSS additionnelle */
  className?: string;
  /** Classe CSS pour le conteneur */
  containerClassName?: string;
}

/**
 * Composant Toggle
 */
export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  (
    {
      label,
      labelPosition = 'right',
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
    const toggleId = id || `toggle-${Math.random().toString(36).substr(2, 9)}`;

    const containerClasses = clsx(
      'toggle-container',
      {
        'toggle-container--disabled': disabled,
        'toggle-container--label-left': label && labelPosition === 'left',
        'toggle-container--label-right': label && labelPosition === 'right',
      },
      containerClassName
    );

    const wrapperClasses = clsx(
      'toggle-wrapper',
      `toggle-wrapper--${size}`,
    );

    const toggleClasses = clsx(
      'toggle',
      `toggle--${size}`,
      {
        'toggle--checked': checked,
        'toggle--disabled': disabled,
      },
      className
    );

    return (
      <label htmlFor={toggleId} className={containerClasses}>
        {label && labelPosition === 'left' && (
          <span className="toggle-label toggle-label--left">{label}</span>
        )}

        <div className={wrapperClasses}>
          <input
            ref={ref}
            id={toggleId}
            type="checkbox"
            role="switch"
            className="toggle__input"
            checked={checked}
            disabled={disabled}
            aria-checked={checked}
            {...props}
          />

          <span className={toggleClasses} aria-hidden="true">
            <span className="toggle__thumb"></span>
          </span>
        </div>

        {label && labelPosition === 'right' && (
          <span className="toggle-label toggle-label--right">{label}</span>
        )}
      </label>
    );
  }
);

Toggle.displayName = 'Toggle';

export default Toggle;
