/**
 * Select Component
 *
 * Composant select classique avec support single/multi-select et keyboard navigation
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  /** Options disponibles */
  options: SelectOption[];
  /** Valeur sélectionnée (string pour single, string[] pour multi) */
  value?: string | string[];
  /** Callback lors du changement */
  onChange?: (value: string | string[]) => void;
  /** Placeholder */
  placeholder?: string;
  /** Label */
  label?: string;
  /** Message d'erreur */
  error?: string;
  /** Message d'aide */
  helperText?: string;
  /** Taille */
  size?: 'sm' | 'md' | 'lg';
  /** Variante */
  variant?: 'default' | 'filled' | 'outlined';
  /** Désactivé */
  disabled?: boolean;
  /** Requis */
  required?: boolean;
  /** Multi-select */
  multiple?: boolean;
  /** Activer la recherche/filtre */
  searchable?: boolean;
  /** Pleine largeur */
  fullWidth?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
  /** Classe CSS pour le conteneur */
  containerClassName?: string;
}

/**
 * Composant Select
 */
export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Sélectionner...',
  label,
  error,
  helperText,
  size = 'md',
  variant = 'default',
  disabled = false,
  required = false,
  multiple = false,
  searchable = false,
  fullWidth = false,
  className,
  containerClassName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const selectRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectId = `select-${Math.random().toString(36).substr(2, 9)}`;
  const hasError = Boolean(error);

  // Normaliser la valeur en array pour faciliter la gestion
  const selectedValues = multiple
    ? Array.isArray(value) ? value : (value ? [value] : [])
    : value ? [value as string] : [];

  // Filtrer les options selon la recherche
  const filteredOptions = searchable && searchQuery
    ? options.filter(opt =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : options;

  // Calculer la position du dropdown
  const updateDropdownPosition = useCallback(() => {
    if (selectRef.current && isOpen) {
      const rect = selectRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [isOpen]);

  // Ouvrir/fermer le dropdown
  const toggleDropdown = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
      setSearchQuery('');
      setFocusedIndex(-1);
    }
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setSearchQuery('');
    setFocusedIndex(-1);
  };

  // Gérer la sélection d'une option
  const handleSelectOption = (optionValue: string) => {
    if (multiple) {
      const newValues = selectedValues.includes(optionValue)
        ? selectedValues.filter(v => v !== optionValue)
        : [...selectedValues, optionValue];
      onChange?.(newValues);
    } else {
      onChange?.(optionValue);
      closeDropdown();
    }
  };

  // Gérer la suppression d'une valeur (multi-select)
  const handleRemoveValue = (e: React.MouseEvent, valueToRemove: string) => {
    e.stopPropagation();
    if (multiple) {
      const newValues = selectedValues.filter(v => v !== valueToRemove);
      onChange?.(newValues);
    }
  };

  // Gérer le clavier
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case 'Enter':
      case ' ':
        if (!isOpen) {
          e.preventDefault();
          setIsOpen(true);
        } else if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          e.preventDefault();
          const option = filteredOptions[focusedIndex];
          if (!option.disabled) {
            handleSelectOption(option.value);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeDropdown();
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setFocusedIndex(prev => {
            let next = prev + 1;
            while (next < filteredOptions.length && filteredOptions[next].disabled) {
              next++;
            }
            return next < filteredOptions.length ? next : prev;
          });
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          setFocusedIndex(prev => {
            let next = prev - 1;
            while (next >= 0 && filteredOptions[next].disabled) {
              next--;
            }
            return next >= 0 ? next : prev;
          });
        }
        break;
      case 'Tab':
        if (isOpen) {
          closeDropdown();
        }
        break;
      default:
        break;
    }
  };

  // Scroll vers l'option focusée
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && dropdownRef.current) {
      const focusedElement = dropdownRef.current.querySelector(
        `[data-option-index="${focusedIndex}"]`
      ) as HTMLElement;
      focusedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex, isOpen]);

  // Mettre à jour la position au redimensionnement
  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
      window.addEventListener('resize', updateDropdownPosition);
      window.addEventListener('scroll', updateDropdownPosition, true);

      return () => {
        window.removeEventListener('resize', updateDropdownPosition);
        window.removeEventListener('scroll', updateDropdownPosition, true);
      };
    }
    return undefined;
  }, [isOpen, updateDropdownPosition]);

  // Focus sur le champ de recherche quand on ouvre
  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen, searchable]);

  // Fermer au clic extérieur
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        selectRef.current &&
        !selectRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        closeDropdown();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [isOpen]);

  // Obtenir le label d'une valeur
  const getOptionLabel = (val: string) => {
    return options.find(opt => opt.value === val)?.label || val;
  };

  // Obtenir l'icône d'une valeur
  const getOptionIcon = (val: string) => {
    return options.find(opt => opt.value === val)?.icon;
  };

  // Classes CSS
  const containerClasses = clsx(
    'select-container',
    {
      'select-container--full-width': fullWidth,
      'select-container--disabled': disabled,
    },
    containerClassName
  );

  const selectClasses = clsx(
    'select',
    `select--${size}`,
    `select--${variant}`,
    {
      'select--error': hasError,
      'select--disabled': disabled,
      'select--open': isOpen,
      'select--has-value': selectedValues.length > 0,
    },
    className
  );

  const dropdownClasses = clsx(
    'select-dropdown',
    `select-dropdown--${size}`,
    {
      'select-dropdown--open': isOpen,
    }
  );

  // Rendu du dropdown (via portal)
  const renderDropdown = () => {
    if (!isOpen || !dropdownPosition) return null;

    return createPortal(
      <div
        ref={dropdownRef}
        className={dropdownClasses}
        style={{
          position: 'absolute',
          top: `${dropdownPosition.top}px`,
          left: `${dropdownPosition.left}px`,
          minWidth: `${dropdownPosition.width}px`,
          width: 'max-content',
        }}
        role="listbox"
        aria-labelledby={selectId}
        aria-multiselectable={multiple}
      >
        {searchable && (
          <div className="select-dropdown__search">
            <input
              ref={searchInputRef}
              type="text"
              className="select-dropdown__search-input"
              placeholder="Rechercher..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        <div className="select-dropdown__list">
          {filteredOptions.length === 0 ? (
            <div className="select-dropdown__empty">Aucun résultat</div>
          ) : (
            filteredOptions.map((option, index) => {
              const isSelected = selectedValues.includes(option.value);
              const isFocused = index === focusedIndex;

              return (
                <div
                  key={option.value}
                  data-option-index={index}
                  className={clsx('select-dropdown__option', {
                    'select-dropdown__option--selected': isSelected,
                    'select-dropdown__option--focused': isFocused,
                    'select-dropdown__option--disabled': option.disabled,
                  })}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled}
                  onClick={() => !option.disabled && handleSelectOption(option.value)}
                  onMouseEnter={() => !option.disabled && setFocusedIndex(index)}
                >
                  {multiple && (
                    <span className={clsx('select-dropdown__checkbox', {
                      'select-dropdown__checkbox--checked': isSelected,
                    })} />
                  )}
                  {option.icon && (
                    <span className="select-dropdown__option-icon">{option.icon}</span>
                  )}
                  <span className="select-dropdown__option-label">{option.label}</span>
                  {!multiple && isSelected && (
                    <svg className="select-dropdown__check" width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div className={containerClasses}>
      {label && (
        <label htmlFor={selectId} className="select-label">
          {label}
          {required && <span className="select-label__required">*</span>}
        </label>
      )}

      <div
        ref={selectRef}
        id={selectId}
        className={selectClasses}
        onClick={toggleDropdown}
        onKeyDown={handleKeyDown}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-disabled={disabled}
        aria-invalid={hasError}
        aria-describedby={
          error
            ? `${selectId}-error`
            : helperText
            ? `${selectId}-helper`
            : undefined
        }
      >
        <input
          ref={inputRef}
          type="hidden"
          value={multiple ? selectedValues.join(',') : selectedValues[0] || ''}
          required={required}
        />

        <div className="select__value">
          {selectedValues.length === 0 ? (
            <span className="select__placeholder">{placeholder}</span>
          ) : multiple ? (
            <div className="select__tags">
              {selectedValues.map((val) => (
                <span key={val} className="select__tag">
                  {getOptionIcon(val) && (
                    <span className="select__tag-icon">{getOptionIcon(val)}</span>
                  )}
                  <span className="select__tag-label">{getOptionLabel(val)}</span>
                  <button
                    type="button"
                    className="select__tag-remove"
                    onClick={(e) => handleRemoveValue(e, val)}
                    aria-label={`Retirer ${getOptionLabel(val)}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="select__single-value">
              {getOptionIcon(selectedValues[0]) && (
                <span className="select__single-value-icon">{getOptionIcon(selectedValues[0])}</span>
              )}
              <span className="select__single-value-label">{getOptionLabel(selectedValues[0])}</span>
            </span>
          )}
        </div>

        <span className="select__chevron" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </div>

      {error && (
        <p id={`${selectId}-error`} className="select-message select-message--error">
          {error}
        </p>
      )}

      {!error && helperText && (
        <p id={`${selectId}-helper`} className="select-message select-message--helper">
          {helperText}
        </p>
      )}

      {renderDropdown()}
    </div>
  );
};

Select.displayName = 'Select';

export default Select;
