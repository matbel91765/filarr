/**
 * useContextMenu Hook
 *
 * Hook pour gérer l'état du menu contextuel
 */

import { useState } from 'react';
import type { ContextMenuItem } from '../renderer/components/ui/ContextMenu';

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export const useContextMenu = () => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    items: [],
  });

  const openContextMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      items,
    });
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  };

  return { contextMenu, openContextMenu, closeContextMenu };
};

export default useContextMenu;
