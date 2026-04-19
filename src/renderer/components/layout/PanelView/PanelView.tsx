/**
 * PanelView Component
 *
 * Un panneau individuel qui contient sa propre TabBar et son propre contenu.
 * Wrappe le contenu dans PanelProvider pour que les vues enfants
 * puissent connaitre leur panelId.
 *
 * En mode split, le panneau focuse a un indicateur bien visible (bordure
 * coloree en haut + opacite normale) tandis que le panneau inactif est
 * legerement attenue pour que l'utilisateur sache toujours quel panneau
 * recevra les actions de la sidebar.
 */

import React, { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../../store';
import { focusPanel } from '../../../../store/slices/tabsSlice';
import { PanelProvider } from '../../../../contexts/PanelContext';
import { TabBar } from '../TabBar/TabBar';
import { RouteContent } from '../RouteContent/RouteContent';

interface PanelViewProps {
  panelId: string;
}

export const PanelView: React.FC<PanelViewProps> = ({ panelId }) => {
  const dispatch = useDispatch<AppDispatch>();
  const panel = useSelector((state: RootState) => state.tabs.panels.find((p) => p.id === panelId));
  const focusedPanelId = useSelector((state: RootState) => state.tabs.focusedPanelId);
  const isSplit = useSelector((state: RootState) => state.tabs.panels.length > 1);
  const isFocused = panelId === focusedPanelId;

  const handleFocus = useCallback(() => {
    if (!isFocused) {
      dispatch(focusPanel(panelId));
    }
  }, [dispatch, panelId, isFocused]);

  if (!panel) return null;

  const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);

  // Inline styles for split focus — much more visible than the old 1px ring
  const panelStyle: React.CSSProperties = isSplit
    ? {
        borderTop: isFocused
          ? '3px solid var(--color-primary-500, #4682b4)'
          : '3px solid transparent',
        opacity: isFocused ? 1 : 0.55,
        transition: 'opacity 0.2s, border-color 0.2s',
      }
    : {};

  return (
    <PanelProvider value={panelId}>
      <div
        className="flex-1 flex flex-col min-w-0 overflow-hidden"
        style={panelStyle}
        onMouseDown={handleFocus}
      >
        <TabBar panelId={panelId} />
        {activeTab ? (
          <RouteContent route={activeTab.route} panelId={panelId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-tertiary)] text-sm">
            Aucun onglet ouvert
          </div>
        )}
      </div>
    </PanelProvider>
  );
};

export default PanelView;
