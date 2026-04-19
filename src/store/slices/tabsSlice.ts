/**
 * Redux Slice pour le systeme d'onglets avec split-view
 *
 * Gere les panneaux (1 ou 2), les onglets par panneau, le focus, et le split.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import i18n from '../../i18n/config';

export interface TabInfo {
  id: string;
  title: string;
  route: string;
  icon?: string;
  closable: boolean;
  folderId?: string;
}

export interface PanelInfo {
  id: string;
  tabs: TabInfo[];
  activeTabId: string;
}

export interface TabsState {
  panels: PanelInfo[];
  focusedPanelId: string;
  splitDirection: 'none' | 'horizontal';
  splitRatio: number;
  maxTabs: number;
}

const HOME_TAB: TabInfo = {
  id: 'home',
  title: i18n.t('tabs.home'),
  route: '/',
  closable: false,
};

const DEFAULT_PANEL: PanelInfo = {
  id: 'panel-main',
  tabs: [HOME_TAB],
  activeTabId: 'home',
};

const initialState: TabsState = {
  panels: [DEFAULT_PANEL],
  focusedPanelId: 'panel-main',
  splitDirection: 'none',
  splitRatio: 0.5,
  maxTabs: 15,
};

let tabCounter = 0;
const generateTabId = (): string => {
  tabCounter += 1;
  return `tab-${Date.now()}-${tabCounter}`;
};

let panelCounter = 0;
const generatePanelId = (): string => {
  panelCounter += 1;
  return `panel-${Date.now()}-${panelCounter}`;
};

/** Count all tabs across all panels */
function totalTabCount(state: TabsState): number {
  return state.panels.reduce((sum, p) => sum + p.tabs.length, 0);
}

/** Find panel by id */
function findPanel(state: TabsState, panelId: string): PanelInfo | undefined {
  return state.panels.find(p => p.id === panelId);
}

/** Get the focused panel */
function getFocusedPanel(state: TabsState): PanelInfo | undefined {
  return state.panels.find(p => p.id === state.focusedPanelId);
}

/** Activate neighbor tab after closing one */
function activateNeighbor(panel: PanelInfo, closedIndex: number): void {
  if (panel.tabs.length === 0) return;
  const newIndex = Math.min(closedIndex, panel.tabs.length - 1);
  panel.activeTabId = panel.tabs[newIndex].id;
}

/** Merge the second panel's tabs into the first, then remove the second panel */
function collapsePanels(state: TabsState): void {
  if (state.panels.length <= 1) return;

  const survivorIndex = state.panels.findIndex(p => p.tabs.length > 0);
  const emptyIndex = state.panels.findIndex(p => p.tabs.length === 0);

  if (survivorIndex === -1 || emptyIndex === -1) {
    // Both have tabs — shouldn't collapse, or edge case
    // If we're explicitly collapsing, merge second into first
    const [first, second] = state.panels;
    first.tabs.push(...second.tabs);
    state.panels = [first];
    state.focusedPanelId = first.id;
    state.splitDirection = 'none';
    state.splitRatio = 0.5;
    return;
  }

  // Remove the empty panel
  state.panels.splice(emptyIndex, 1);
  state.focusedPanelId = state.panels[0].id;
  state.splitDirection = 'none';
  state.splitRatio = 0.5;
}

const tabsSlice = createSlice({
  name: 'tabs',
  initialState,
  reducers: {
    addTab(state, action: PayloadAction<{ panelId?: string; route: string; title: string; folderId?: string; icon?: string }>) {
      if (totalTabCount(state) >= state.maxTabs) return;

      const targetPanelId = action.payload.panelId || state.focusedPanelId;
      const panel = findPanel(state, targetPanelId);
      if (!panel) return;

      const newTab: TabInfo = {
        id: generateTabId(),
        title: action.payload.title,
        route: action.payload.route,
        icon: action.payload.icon,
        closable: true,
        folderId: action.payload.folderId,
      };
      panel.tabs.push(newTab);
      panel.activeTabId = newTab.id;
      state.focusedPanelId = targetPanelId;
    },

    closeTab(state, action: PayloadAction<{ panelId: string; tabId: string }>) {
      const { panelId, tabId } = action.payload;
      const panel = findPanel(state, panelId);
      if (!panel) return;

      const tab = panel.tabs.find(t => t.id === tabId);
      if (!tab || !tab.closable) return;

      const tabIndex = panel.tabs.findIndex(t => t.id === tabId);
      panel.tabs = panel.tabs.filter(t => t.id !== tabId);

      if (panel.activeTabId === tabId) {
        activateNeighbor(panel, tabIndex);
      }

      // If panel is now empty and we have 2 panels, collapse
      if (panel.tabs.length === 0 && state.panels.length > 1) {
        collapsePanels(state);
      }
    },

    closeActiveTab(state) {
      const panel = getFocusedPanel(state);
      if (!panel) return;

      const activeTab = panel.tabs.find(t => t.id === panel.activeTabId);
      if (!activeTab || !activeTab.closable) return;

      const tabIndex = panel.tabs.findIndex(t => t.id === panel.activeTabId);
      panel.tabs = panel.tabs.filter(t => t.id !== panel.activeTabId);

      activateNeighbor(panel, tabIndex);

      if (panel.tabs.length === 0 && state.panels.length > 1) {
        collapsePanels(state);
      }
    },

    activateTab(state, action: PayloadAction<{ panelId: string; tabId: string }>) {
      const { panelId, tabId } = action.payload;
      const panel = findPanel(state, panelId);
      if (!panel) return;

      const tab = panel.tabs.find(t => t.id === tabId);
      if (tab) {
        panel.activeTabId = tabId;
        state.focusedPanelId = panelId;
      }
    },

    activateNextTab(state) {
      const panel = getFocusedPanel(state);
      if (!panel || panel.tabs.length === 0) return;

      const currentIndex = panel.tabs.findIndex(t => t.id === panel.activeTabId);
      const nextIndex = (currentIndex + 1) % panel.tabs.length;
      panel.activeTabId = panel.tabs[nextIndex].id;
    },

    activatePreviousTab(state) {
      const panel = getFocusedPanel(state);
      if (!panel || panel.tabs.length === 0) return;

      const currentIndex = panel.tabs.findIndex(t => t.id === panel.activeTabId);
      const prevIndex = (currentIndex - 1 + panel.tabs.length) % panel.tabs.length;
      panel.activeTabId = panel.tabs[prevIndex].id;
    },

    updateTabRoute(state, action: PayloadAction<{ panelId: string; tabId: string; route: string; title: string; folderId?: string }>) {
      const { panelId, tabId, route, title, folderId } = action.payload;
      const panel = findPanel(state, panelId);
      if (!panel) return;

      const tab = panel.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.route = route;
        tab.title = title;
        tab.folderId = folderId;
      }
    },

    closeOtherTabs(state, action: PayloadAction<{ panelId: string; tabId: string }>) {
      const { panelId, tabId } = action.payload;
      const panel = findPanel(state, panelId);
      if (!panel) return;

      panel.tabs = panel.tabs.filter(t => t.id === tabId || !t.closable);
      if (!panel.tabs.find(t => t.id === panel.activeTabId)) {
        panel.activeTabId = tabId;
      }
    },

    focusPanel(state, action: PayloadAction<string>) {
      const panel = findPanel(state, action.payload);
      if (panel) {
        state.focusedPanelId = action.payload;
      }
    },

    splitPanel(state, action: PayloadAction<{ tabId: string; sourcePanelId: string; side: 'left' | 'right' }>) {
      if (state.panels.length >= 2) return; // Already split

      const { tabId, sourcePanelId, side } = action.payload;
      const sourcePanel = findPanel(state, sourcePanelId);
      if (!sourcePanel) return;

      const tabIndex = sourcePanel.tabs.findIndex(t => t.id === tabId);
      if (tabIndex === -1) return;

      const tab = sourcePanel.tabs[tabIndex];

      // Don't allow splitting the only non-closable tab
      if (!tab.closable && sourcePanel.tabs.length === 1) return;

      // Remove tab from source
      sourcePanel.tabs.splice(tabIndex, 1);

      // Activate neighbor in source if we removed the active tab
      if (sourcePanel.activeTabId === tabId) {
        activateNeighbor(sourcePanel, tabIndex);
      }

      // If source panel is now empty of tabs, add a home tab
      if (sourcePanel.tabs.length === 0) {
        const homeTab: TabInfo = { id: generateTabId(), title: i18n.t('tabs.home'), route: '/', closable: false };
        sourcePanel.tabs.push(homeTab);
        sourcePanel.activeTabId = homeTab.id;
      }

      // Create new panel
      const newPanel: PanelInfo = {
        id: generatePanelId(),
        tabs: [tab],
        activeTabId: tabId,
      };

      // Insert based on side
      if (side === 'right') {
        state.panels.push(newPanel);
      } else {
        state.panels.unshift(newPanel);
      }

      state.splitDirection = 'horizontal';
      state.focusedPanelId = newPanel.id;
    },

    moveTabToPanel(state, action: PayloadAction<{ tabId: string; sourcePanelId: string; targetPanelId: string }>) {
      const { tabId, sourcePanelId, targetPanelId } = action.payload;
      if (sourcePanelId === targetPanelId) return;

      const sourcePanel = findPanel(state, sourcePanelId);
      const targetPanel = findPanel(state, targetPanelId);
      if (!sourcePanel || !targetPanel) return;

      const tabIndex = sourcePanel.tabs.findIndex(t => t.id === tabId);
      if (tabIndex === -1) return;

      const tab = sourcePanel.tabs[tabIndex];

      // Don't move the only non-closable tab
      if (!tab.closable && sourcePanel.tabs.length === 1) return;

      // Remove from source
      sourcePanel.tabs.splice(tabIndex, 1);

      if (sourcePanel.activeTabId === tabId) {
        activateNeighbor(sourcePanel, tabIndex);
      }

      // Add to target
      targetPanel.tabs.push(tab);
      targetPanel.activeTabId = tabId;
      state.focusedPanelId = targetPanelId;

      // Collapse if source is empty
      if (sourcePanel.tabs.length === 0 && state.panels.length > 1) {
        collapsePanels(state);
      }
    },

    setSplitRatio(state, action: PayloadAction<number>) {
      state.splitRatio = Math.max(0.25, Math.min(0.75, action.payload));
    },

    unsplit(state) {
      if (state.panels.length <= 1) return;

      // Merge all tabs into the first panel
      const [first, ...rest] = state.panels;
      for (const panel of rest) {
        // Avoid duplicate home tabs
        for (const tab of panel.tabs) {
          const isDuplicateHome = !tab.closable && first.tabs.some(t => !t.closable && t.route === tab.route);
          if (!isDuplicateHome) {
            first.tabs.push(tab);
          }
        }
      }

      state.panels = [first];
      state.focusedPanelId = first.id;
      state.splitDirection = 'none';
      state.splitRatio = 0.5;
    },
  },
});

export const {
  addTab,
  closeTab,
  closeActiveTab,
  activateTab,
  activateNextTab,
  activatePreviousTab,
  updateTabRoute,
  closeOtherTabs,
  focusPanel,
  splitPanel,
  moveTabToPanel,
  setSplitRatio,
  unsplit,
} = tabsSlice.actions;

export default tabsSlice.reducer;
