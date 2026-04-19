/**
 * Selectors for the panel-based tabs state
 */

import type { RootState } from '../index';
import type { PanelInfo, TabInfo } from '../slices/tabsSlice';

export const selectFocusedPanel = (state: RootState): PanelInfo =>
  state.tabs.panels.find(p => p.id === state.tabs.focusedPanelId) || state.tabs.panels[0];

export const selectPanelById = (panelId: string) => (state: RootState): PanelInfo | undefined =>
  state.tabs.panels.find(p => p.id === panelId);

export const selectIsSplit = (state: RootState): boolean =>
  state.tabs.splitDirection !== 'none' && state.tabs.panels.length > 1;

export const selectFocusedActiveTab = (state: RootState): TabInfo | undefined => {
  const panel = selectFocusedPanel(state);
  return panel?.tabs.find(t => t.id === panel.activeTabId);
};

export const selectTotalTabCount = (state: RootState): number =>
  state.tabs.panels.reduce((sum, p) => sum + p.tabs.length, 0);
