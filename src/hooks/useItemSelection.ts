/**
 * Hook for managing item selection state
 *
 * This hook provides utilities for managing multiple item selection,
 * including toggling selection mode and selecting/deselecting items.
 */

import { useState, useCallback } from 'react';

/**
 * Return type for useItemSelection hook
 */
export interface UseItemSelectionReturn {
  multipleSelection: boolean;
  selectedItems: string[];
  toggleMultipleSelection: () => void;
  toggleItemSelection: (itemId: string) => void;
  clearSelection: () => void;
  selectAll: (itemIds: string[]) => void;
  isItemSelected: (itemId: string) => boolean;
}

/**
 * Hook for managing item selection
 * @returns Object with selection state and methods
 */
export const useItemSelection = (): UseItemSelectionReturn => {
  const [multipleSelection, setMultipleSelection] = useState<boolean>(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const toggleMultipleSelection = useCallback(() => {
    setMultipleSelection(prev => !prev);
    setSelectedItems([]);
  }, []);

  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItems(prevSelected => {
      if (prevSelected.includes(itemId)) {
        return prevSelected.filter(id => id !== itemId);
      } else {
        return [...prevSelected, itemId];
      }
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItems([]);
  }, []);

  const selectAll = useCallback((itemIds: string[]) => {
    setSelectedItems(itemIds);
  }, []);

  const isItemSelected = useCallback((itemId: string): boolean => {
    return selectedItems.includes(itemId);
  }, [selectedItems]);

  return {
    multipleSelection,
    selectedItems,
    toggleMultipleSelection,
    toggleItemSelection,
    clearSelection,
    selectAll,
    isItemSelected
  };
};

export default useItemSelection;
