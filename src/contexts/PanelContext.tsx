/**
 * PanelContext
 *
 * Fournit l'ID du panneau courant aux composants enfants.
 * Utilise par les vues pour savoir dans quel panneau elles sont rendues.
 */

import { createContext, useContext } from 'react';

const PanelContext = createContext<string>('panel-main');

export const PanelProvider = PanelContext.Provider;

export const usePanelId = (): string => useContext(PanelContext);

export default PanelContext;
