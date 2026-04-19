/**
 * Hook pour debouncer une valeur
 * Utile pour limiter les appels API lors de la saisie
 */

import { useEffect, useState } from 'react';

/**
 * Debounce une valeur - attend que l'utilisateur arrête de taper avant de retourner la valeur
 * @param value - La valeur à debouncer
 * @param delay - Le délai en ms (défaut: 300ms)
 * @returns La valeur debouncée
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up le timer pour mettre à jour la valeur après le délai
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Nettoyer le timer si la valeur change avant le délai
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default useDebounce;
