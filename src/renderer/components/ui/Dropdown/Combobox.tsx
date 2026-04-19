/**
 * Combobox Component
 *
 * Composant select avec recherche avancée, support async et création d'options
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import './Select.css';

export interface ComboboxOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface ComboboxProps {
  /** Options disponibles */
  options: ComboboxOption[];
  /** Valeur sélectionnée */
  value?: string | string[];
  /** Callback lors du changement */
  onChange?: (value: string | string[]) => void;
  /** Callback lors de la recherche (pour async) */
  onSearch?: (query: string) => void;
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
  /** État de chargement */
  loading?: boolean;
  /** Permettre la création de nouvelles options */
  creatable?: boolean;
  /** Callback lors de la création d'une option */
  onCreate?: (value: string) => void;
  /** Pleine largeur */
  fullWidth?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
  /** Classe CSS pour le conteneur */
  containerClassName?: string;
}

/**
 * Composant Combobox
 */
export const Combobox: React.FC<ComboboxProps> = ({
  options,
  value,
  onChange,
  onSearch,
  placeholder = 'Rechercher ou sélectionner...',
  label,
  error,
  helperText,
  size = 'md',
  variant = 'default',
  disabled = false,
  required = false,
  multiple = false,
  loading = false,
  creatable = false,
  onCreate,
  fullWidth = false,
  className,
  containerClassName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const comboboxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const comboboxId = `combobox-${Math.random().toString(36).substr(2, 9)}`;
  const hasError = Boolean(error);

  // Normaliser la valeur en array
  const selectedValues = multiple
    ? Array.isArray(value) ? value : (value ? [value] : [])
    : value ? [value as string] : [];

  // Filtrer les options selon la recherche
  const filteredOptions = searchQuery
    ? options.filter(opt =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : options;

  // Vérifier si on peut créer une nouvelle option
  const canCreateOption = creatable && searchQuery && !filteredOptions.some(opt => opt.label.toLowerCase() === searchQuery.toLowerCase());

  // Calculer la position du dropdown
  const updateDropdownPosition = useCallback(() => {
    if (comboboxRef.current && isOpen) {
      const rect = comboboxRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [isOpen]);

  // Ouvrir/fermer le dropdown
  const openDropdown = () => {
    if (!disabled) {
      setIsOpen(true);
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
      setSearchQuery('');
      inputRef.current?.focus();
    } else {
      onChange?.(optionValue);
      setSearchQuery('');
      closeDropdown();
    }
  };

  // Créer une nouvelle option
  const handleCreateOption = () => {
    if (canCreateOption && onCreate) {
      onCreate(searchQuery);
      setSearchQuery('');
      inputRef.current?.focus();
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

  // Gérer le changement de recherche
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    onSearch?.(query);
    if (!isOpen) {
      openDropdown();
    }
  };

  // Gérer le clavier
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case 'Enter':
        if (isOpen) {
          e.preventDefault();
          if (canCreateOption && focusedIndex === filteredOptions.length) {
            handleCreateOption();
          } else if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
            const option = filteredOptions[focusedIndex];
            if (!option.disabled) {
              handleSelectOption(option.value);
            }
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
          openDropdown();
        } else {
          setFocusedIndex(prev => {
            const maxIndex = canCreateOption ? filteredOptions.length : filteredOptions.length - 1;
            let next = prev + 1;
            while (next < filteredOptions.length && filteredOptions[next].disabled) {
              next++;
            }
            return next <= maxIndex ? next : prev;
          });
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          setFocusedIndex(prev => {
            let next = prev - 1;
            while (next >= 0 && next < filteredOptions.length && filteredOptions[next].disabled) {
              next--;
            }
            return next >= -1 ? next : prev;
          });
        }
        break;
      case 'Backspace':
        if (multiple && !searchQuery && selectedValues.length > 0) {
          e.preventDefault();
          const newValues = selectedValues.slice(0, -1);
          onChange?.(newValues);
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

  // Fermer au clic extérieur
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        comboboxRef.current &&
        !comboboxRef.current.contains(event.target as Node) &&
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
    'combobox-container',
    {
      'select-container--full-width': fullWidth,
      'select-container--disabled': disabled,
    },
    containerClassName
  );

  const comboboxClasses = clsx(
    'select',
    'combobox',
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
    'combobox-dropdown',
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
          width: `${dropdownPosition.width}px`,
        }}
        role="listbox"
        aria-labelledby={comboboxId}
      >
        <div className="select-dropdown__list">
          {loading ? (
            <div className="select-dropdown__loading">
              <span className="select-dropdown__spinner" />
              <span>Chargement...</span>
            </div>
          ) : filteredOptions.length === 0 && !canCreateOption ? (
            <div className="select-dropdown__empty">Aucun résultat</div>
          ) : (
            <>
              {filteredOptions.map((option, index) => {
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
              })}

              {canCreateOption && (
                <div
                  data-option-index={filteredOptions.length}
                  className={clsx('select-dropdown__option', 'select-dropdown__option--create', {
                    'select-dropdown__option--focused': focusedIndex === filteredOptions.length,
                  })}
                  role="option"
                  onClick={handleCreateOption}
                  onMouseEnter={() => setFocusedIndex(filteredOptions.length)}
                >
                  <svg className="select-dropdown__option-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="select-dropdown__option-label">
                    Créer "<strong>{searchQuery}</strong>"
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div className={containerClasses}>
      {label && (
        <label htmlFor={comboboxId} className="select-label">
          {label}
          {required && <span className="select-label__required">*</span>}
        </label>
      )}

      <div
        ref={comboboxRef}
        id={comboboxId}
        className={comboboxClasses}
        role="combobox"
        aria-expanded={isOpen}
        aria-disabled={disabled}
        aria-invalid={hasError}
        aria-describedby={
          error
            ? `${comboboxId}-error`
            : helperText
            ? `${comboboxId}-helper`
            : undefined
        }
      >
        <div className="select__value combobox__value">
          {multiple && selectedValues.length > 0 && (
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
          )}

          <input
            ref={inputRef}
            type="text"
            className="combobox__input"
            placeholder={selectedValues.length === 0 ? placeholder : ''}
            value={searchQuery}
            onChange={handleSearchChange}
            onFocus={openDropdown}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            required={required && selectedValues.length === 0}
            aria-autocomplete="list"
            aria-controls={`${comboboxId}-listbox`}
            autoComplete="off"
          />
        </div>

        {loading && (
          <span className="select__loading" aria-hidden="true">
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25"/>
              <path d="M8 2C4.686 2 2 4.686 2 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </span>
        )}

        <span className="select__chevron" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </div>

      {error && (
        <p id={`${comboboxId}-error`} className="select-message select-message--error">
          {error}
        </p>
      )}

      {!error && helperText && (
        <p id={`${comboboxId}-helper`} className="select-message select-message--helper">
          {helperText}
        </p>
      )}

      {renderDropdown()}
    </div>
  );
};

Combobox.displayName = 'Combobox';

export default Combobox;
