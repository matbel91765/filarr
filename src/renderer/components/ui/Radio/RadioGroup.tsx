/**
 * RadioGroup Component
 *
 * Conteneur pour gérer un groupe de radios avec sélection unique
 */

import { ReactElement } from 'react';
import clsx from 'clsx';
import { Radio } from './Radio';
import './Radio.css';

export interface RadioOption {
  /** Valeur de l'option */
  value: string;
  /** Label de l'option */
  label: string;
  /** Désactiver cette option */
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Options du groupe radio */
  options: RadioOption[];
  /** Valeur sélectionnée */
  value?: string;
  /** Callback lors du changement */
  onChange?: (value: string) => void;
  /** Label du groupe */
  label?: string;
  /** Message d'erreur */
  error?: string;
  /** Nom du groupe (requis pour grouper les radios) */
  name: string;
  /** Orientation du groupe */
  orientation?: 'horizontal' | 'vertical';
  /** Taille des radios */
  size?: 'sm' | 'md' | 'lg';
  /** Désactiver tout le groupe */
  disabled?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
}

/**
 * Composant RadioGroup
 */
export const RadioGroup = ({
  options,
  value,
  onChange,
  label,
  error,
  name,
  orientation = 'vertical',
  size = 'md',
  disabled = false,
  className,
}: RadioGroupProps): ReactElement => {
  const groupClasses = clsx(
    'radio-group',
    `radio-group--${orientation}`,
    {
      'radio-group--disabled': disabled,
    },
    className
  );

  const handleChange = (optionValue: string) => {
    if (onChange && !disabled) {
      onChange(optionValue);
    }
  };

  return (
    <div className="radio-group-container">
      {label && (
        <div className="radio-group-label" role="group" aria-label={label}>
          {label}
        </div>
      )}

      <div className={groupClasses}>
        {options.map((option) => (
          <Radio
            key={option.value}
            name={name}
            value={option.value}
            label={option.label}
            checked={value === option.value}
            onChange={() => handleChange(option.value)}
            disabled={disabled || option.disabled}
            size={size}
            containerClassName="radio-group__item"
          />
        ))}
      </div>

      {error && (
        <p className="radio-group-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

RadioGroup.displayName = 'RadioGroup';

export default RadioGroup;
