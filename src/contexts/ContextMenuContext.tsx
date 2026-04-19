/**
 * Contexte pour le menu contextuel avec intégration Redux
 *
 * Ce fichier intègre la gestion du menu contextuel avec Redux via le slice UI.
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { useDispatch } from 'react-redux';
import { openModal } from '../store/slices/uiSlice';
import { ContextMenuOptions } from '../types';

interface ContextMenuContextValue {
  setContextMenu: (options: ContextMenuOptions) => void;
}

// Création du contexte
const ContextMenuContext = createContext<ContextMenuContextValue | undefined>(undefined);

interface ContextMenuProviderProps {
  children: ReactNode;
}

/**
 * Provider pour le menu contextuel
 */
export const ContextMenuProvider: React.FC<ContextMenuProviderProps> = ({ children }) => {
  const dispatch = useDispatch();

  // Fonction pour afficher le menu contextuel via Redux
  const setContextMenu = ({ x, y, options, onOptionSelect, item }: ContextMenuOptions): void => {
    dispatch(openModal({
      type: 'context-menu',
      props: { x, y, options, onOptionSelect, item }
    }));
  };

  return (
    <ContextMenuContext.Provider value={{ setContextMenu }}>
      {children}
    </ContextMenuContext.Provider>
  );
};

/**
 * Hook pour utiliser le contexte du menu contextuel
 */
export const useContextMenu = (): ContextMenuContextValue => {
  const context = useContext(ContextMenuContext);
  if (!context) {
    throw new Error('useContextMenu must be used within a ContextMenuProvider');
  }
  return context;
};

export default ContextMenuContext;
