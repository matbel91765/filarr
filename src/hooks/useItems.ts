/**
 * Hook for managing items (files or folders) with local state
 *
 * This hook provides utilities for managing a list of items,
 * including adding, updating, deleting, and reordering.
 */

import { useState, useCallback } from 'react';
import type { Item } from '../types';

/**
 * Return type for useItems hook
 */
export interface UseItemsReturn<T = Item> {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  addItem: (newItem: T) => void;
  updateItem: (id: string, updatedItem: Partial<T>) => void;
  deleteItem: (id: string) => void;
  reorderItems: (startIndex: number, endIndex: number) => void;
}

/**
 * Hook for managing items with local state
 * @param initialItems - Initial array of items
 * @returns Object with items and methods to manage them
 */
export const useItems = <T extends { id: string }>(initialItems: T[] = []): UseItemsReturn<T> => {
  const [items, setItems] = useState<T[]>(initialItems);

  const addItem = useCallback((newItem: T) => {
    setItems(prevItems => [...prevItems, newItem]);
  }, []);

  const updateItem = useCallback((id: string, updatedItem: Partial<T>) => {
    setItems(prevItems => prevItems.map(item =>
      item.id === id ? { ...item, ...updatedItem } : item
    ));
  }, []);

  const deleteItem = useCallback((id: string) => {
    setItems(prevItems => prevItems.filter(item => item.id !== id));
  }, []);

  const reorderItems = useCallback((startIndex: number, endIndex: number) => {
    setItems(prevItems => {
      const result = Array.from(prevItems);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      return result;
    });
  }, []);

  return { items, setItems, addItem, updateItem, deleteItem, reorderItems };
};

export default useItems;
