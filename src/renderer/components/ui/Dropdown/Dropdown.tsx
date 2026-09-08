/**
 * Dropdown Component
 *
 * Composant dropdown menu pour actions (similaire à un context menu)
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { getOverlayBounds, clampToBounds } from '../../../utils/overlayBounds';
import './Dropdown.css';

/** Écart entre le déclencheur et le menu. */
const GAP = 4;

type DropdownPlacement = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

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
  /** Position SOUHAITÉE du dropdown ; elle bascule si elle ne tient pas. */
  position?: DropdownPlacement;
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
  const [placed, setPlaced] = useState<{
    top: number;
    left: number;
    placement: DropdownPlacement;
  } | null>(null);

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /**
   * La position est MESURÉE, pas déduite du seul côté demandé.
   *
   * `position` dit où l'on préfère ouvrir ; c'est la place disponible qui
   * tranche. Un déclencheur collé au bas de l'écran — c'est exactement le cas
   * des actions du rail latéral, épinglées en bas de la colonne — recevait un
   * menu ouvert vers le bas, dont la moitié tombait sous le bord de la
   * fenêtre, hors d'atteinte. On bascule donc du côté qui tient, et on borne
   * dans les deux axes.
   *
   * Les bornes ne sont PAS celles de la fenêtre : le rail est une colonne fixe
   * peinte au-dessus des menus, un menu « ramené dans l'écran » se glissait
   * dessous. `getOverlayBounds` rend la zone réellement libre.
   */
  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = dropdownRef.current;
    if (!trigger || !menu) return;

    const rect = trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const bounds = getOverlayBounds();

    // Axe vertical : le côté demandé s'il tient, l'autre s'il tient mieux.
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    const wantsAbove = position.startsWith('top-');
    const fitsBelow = below + height <= bounds.bottom;
    const fitsAbove = above >= bounds.top;
    const goesAbove = wantsAbove ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
    // Le bornage final couvre le cas où AUCUN côté ne tient (menu plus haut
    // que la fenêtre) : mieux vaut un menu collé en haut, défilable, qu'un
    // menu dont le premier item est déjà hors champ.
    const top = clampToBounds(goesAbove ? above : below, bounds.top, bounds.bottom - height);

    // Axe horizontal : aligné sur un bord du déclencheur, ramené dans la zone.
    const wantsRight = position.endsWith('-right');
    const left = clampToBounds(
      wantsRight ? rect.right - width : rect.left,
      bounds.left,
      bounds.right - width
    );

    setPlaced({
      top,
      left,
      placement: `${goesAbove ? 'top' : 'bottom'}-${wantsRight ? 'right' : 'left'}`,
    });
  }, [position]);

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

  // La mesure a lieu AVANT la peinture : le menu est monté (caché) le temps
  // qu'on lise sa taille, puis placé dans la même image. Un useEffect ordinaire
  // laisserait voir une image au mauvais endroit.
  useLayoutEffect(() => {
    if (!isOpen) {
      setPlaced(null);
      return undefined;
    }
    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
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

  // Les classes suivent la position RETENUE (celle qui tient), pas celle qui
  // était souhaitée : c'est elle qui donne le sens du glissement d'ouverture.
  const getDropdownClasses = () => {
    return clsx(
      'dropdown-menu',
      `dropdown-menu--${placed?.placement ?? position}`,
      {
        'dropdown-menu--open': isOpen,
      },
      dropdownClassName
    );
  };

  // Rendu du dropdown (via portal)
  const renderDropdown = () => {
    if (!isOpen) return null;

    // `fixed` et non `absolute` : le menu est porté par <body>, et les bornes
    // qu'on vient de calculer sont celles de la FENÊTRE. Tant que la mesure
    // n'a pas eu lieu (première image), il est monté mais invisible.
    const style: React.CSSProperties = {
      position: 'fixed',
      top: placed?.top ?? 0,
      left: placed?.left ?? 0,
      visibility: placed ? undefined : 'hidden',
    };

    return createPortal(
      <div
        ref={dropdownRef}
        className={getDropdownClasses()}
        style={style}
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
              {item.icon && <span className="dropdown-menu__item-icon">{item.icon}</span>}
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
