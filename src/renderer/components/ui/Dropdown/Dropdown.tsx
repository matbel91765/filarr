/**
 * Dropdown Component
 *
 * Composant dropdown menu pour actions (similaire à un context menu)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import './Dropdown.css';

export interface DropdownItem {
  /** Label de l'item */
  label: string;
  /** Icône */
  icon?: React.ReactNode;
  /** Callback au clic */
  onClick?: () => void;
  /** Désactivé */
  disabled?: boolean;
  /** Diviseur après cet item */
  divider?: boolean;
  /** Style danger (rouge) */
  danger?: boolean;
}

export interface DropdownProps {
  /** Élément déclencheur */
  trigger: React.ReactNode;
  /** Items du menu */
  items: DropdownItem[];
  /** Position du dropdown */
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  /** Fermer au clic sur un item */
  closeOnSelect?: boolean;
  /** Désactivé */
  disabled?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
  /** Classe CSS pour le dropdown */
  dropdownClassName?: string;
}

/**
 * Composant Dropdown
 */
export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  items,
  position = 'bottom-left',
  closeOnSelect = true,
  disabled = false,
  className,
  dropdownClassName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calculer la position du dropdown
  const updateDropdownPosition = useCallback(() => {
    if (triggerRef.current && isOpen) {
      const rect = triggerRef.current.getBoundingClientRect();
      let top = 0;
      let left = 0;

      switch (position) {
        case 'bottom-left':
          top = rect.bottom + window.scrollY + 4;
          left = rect.left + window.scrollX;
          break;
        case 'bottom-right':
          top = rect.bottom + window.scrollY + 4;
          left = rect.right + window.scrollX;
          break;
        case 'top-left':
          top = rect.top + window.scrollY - 4;
          left = rect.left + window.scrollX;
          break;
        case 'top-right':
          top = rect.top + window.scrollY - 4;
          left = rect.right + window.scrollX;
          break;
      }

      setDropdownPosition({ top, left });
    }
  }, [isOpen, position]);

  // Toggle le dropdown
  const toggleDropdown = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const closeDropdown = () => {
    setIsOpen(false);
  };

  // Gérer le clic sur un item
  const handleItemClick = (item: DropdownItem) => {
    if (!item.disabled) {
      item.onClick?.();
      if (closeOnSelect) {
        closeDropdown();
      }
    }
  };

  // Gérer le clavier
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeDropdown();
    }
  };

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
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node) &&
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

  // Calculer les classes du dropdown selon la position
  const getDropdownClasses = () => {
    return clsx(
      'dropdown-menu',
      `dropdown-menu--${position}`,
      {
        'dropdown-menu--open': isOpen,
      },
      dropdownClassName
    );
  };

  // Rendu du dropdown (via portal)
  const renderDropdown = () => {
    if (!isOpen || !dropdownPosition) return null;

    // Calculer le style selon la position
    const getDropdownStyle = () => {
      const baseStyle: React.CSSProperties = {
        position: 'absolute',
      };

      if (position.startsWith('top-')) {
        baseStyle.bottom = `calc(100vh - ${dropdownPosition.top}px)`;
      } else {
        baseStyle.top = `${dropdownPosition.top}px`;
      }

      if (position.endsWith('-right')) {
        baseStyle.right = `calc(100vw - ${dropdownPosition.left}px)`;
      } else {
        baseStyle.left = `${dropdownPosition.left}px`;
      }

      return baseStyle;
    };

    return createPortal(
      <div
        ref={dropdownRef}
        className={getDropdownClasses()}
        style={getDropdownStyle()}
        role="menu"
        onKeyDown={handleKeyDown}
      >
        {items.map((item, index) => (
          <React.Fragment key={index}>
            <button
              type="button"
              className={clsx('dropdown-menu__item', {
                'dropdown-menu__item--disabled': item.disabled,
                'dropdown-menu__item--danger': item.danger,
              })}
              onClick={() => handleItemClick(item)}
              disabled={item.disabled}
              role="menuitem"
            >
              {item.icon && (
                <span className="dropdown-menu__item-icon">{item.icon}</span>
              )}
              <span className="dropdown-menu__item-label">{item.label}</span>
            </button>
            {item.divider && <div className="dropdown-menu__divider" role="separator" />}
          </React.Fragment>
        ))}
      </div>,
      document.body
    );
  };

  return (
    <div className={clsx('dropdown', className)}>
      <div
        ref={triggerRef}
        className={clsx('dropdown__trigger', {
          'dropdown__trigger--disabled': disabled,
          'dropdown__trigger--active': isOpen,
        })}
        onClick={toggleDropdown}
        role="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleDropdown();
          }
        }}
      >
        {trigger}
      </div>

      {renderDropdown()}
    </div>
  );
};

Dropdown.displayName = 'Dropdown';

export default Dropdown;
