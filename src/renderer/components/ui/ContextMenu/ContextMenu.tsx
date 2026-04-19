/**
 * ContextMenu Component
 *
 * Menu contextuel qui s'affiche au clic droit
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

export interface ContextMenuItem {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  divider?: boolean;
  danger?: boolean;
  shortcut?: string;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ items, x, y, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Calculer la position pour ne pas sortir de l'écran
  useEffect(() => {
    if (!menuRef.current) return;

    const menuRect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let newX = x;
    let newY = y;

    // Ajuster X si le menu dépasse à droite
    if (x + menuRect.width > viewportWidth) {
      newX = viewportWidth - menuRect.width - 8;
    }

    // Ajuster Y si le menu dépasse en bas
    if (y + menuRect.height > viewportHeight) {
      newY = viewportHeight - menuRect.height - 8;
    }

    setPosition({ x: newX, y: newY });
  }, [x, y]);

  // Gérer le clic en dehors
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Gérer les touches clavier
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const validItems = items.filter((item) => !item.divider && !item.disabled);

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % validItems.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev - 1 + validItems.length) % validItems.length);
          break;
        case 'Enter': {
          e.preventDefault();
          const focusedItem = validItems[focusedIndex];
          if (focusedItem && focusedItem.onClick) {
            focusedItem.onClick();
            onClose();
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [items, focusedIndex, onClose]);

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.disabled || !item.onClick) return;
    item.onClick();
    onClose();
  };

  const menuContent = (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      role="menu"
      aria-orientation="vertical"
    >
      {items.map((item, index) => {
        if (item.divider) {
          return <div key={`divider-${index}`} className="context-menu__divider" role="separator" />;
        }

        const validItems = items.filter((i) => !i.divider && !i.disabled);
        const validIndex = validItems.indexOf(item);
        const isFocused = validIndex === focusedIndex;

        return (
          <button
            key={index}
            className={`context-menu__item ${item.disabled ? 'context-menu__item--disabled' : ''} ${
              item.danger ? 'context-menu__item--danger' : ''
            } ${isFocused ? 'context-menu__item--focused' : ''}`}
            onClick={() => handleItemClick(item)}
            disabled={item.disabled}
            role="menuitem"
            aria-disabled={item.disabled}
            onMouseEnter={() => setFocusedIndex(validIndex)}
          >
            {item.icon && <span className="context-menu__item-icon">{item.icon}</span>}
            <span className="context-menu__item-label">{item.label}</span>
            {item.shortcut && <span className="context-menu__item-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );

  return createPortal(menuContent, document.body);
};

export default ContextMenu;
