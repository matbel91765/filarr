/**
 * TabBar Component
 *
 * Barre d'onglets horizontale pour un panneau.
 * Supporte: clic pour activer, middle-click pour fermer, clic droit pour menu contextuel,
 * drag pour split-view.
 * 100% Tailwind.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../../store';
import {
  addTab,
  closeTab,
  activateTab,
  closeOtherTabs,
  splitPanel,
  moveTabToPanel,
} from '../../../../store/slices/tabsSlice';
import { selectTotalTabCount, selectIsSplit } from '../../../../store/selectors/tabSelectors';
import type { TabInfo } from '../../../../store/slices/tabsSlice';

interface TabBarProps {
  panelId: string;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tabId: string;
}

const CloseIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    fill="currentColor"
    width="10"
    height="10"
  >
    <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
  </svg>
);

const PlusIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    fill="currentColor"
    width="14"
    height="14"
  >
    <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
  </svg>
);

const HomeIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    fill="currentColor"
    width="12"
    height="12"
  >
    <path d="M8.543 2.232a.75.75 0 00-1.085 0l-5.25 5.5A.75.75 0 002.75 9H4v4a1 1 0 001 1h2V11h2v3h2a1 1 0 001-1V9h1.25a.75.75 0 00.543-1.268l-5.25-5.5z" />
  </svg>
);

const FolderIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    fill="currentColor"
    width="12"
    height="12"
  >
    <path d="M1.75 2A1.75 1.75 0 000 3.75v.736a.75.75 0 000 .027v7.737C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0016 12.25v-6.5A1.75 1.75 0 0014.25 4H8.416l-.93-1.39A1.75 1.75 0 005.914 2H1.75z" />
  </svg>
);

function getTabIcon(tab: TabInfo): React.ReactNode {
  if (tab.route === '/') return <HomeIcon />;
  if (tab.folderId) return <FolderIcon />;
  return null;
}

export const TabBar: React.FC<TabBarProps> = React.memo(function TabBar({ panelId }) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const panel = useSelector((state: RootState) => state.tabs.panels.find((p) => p.id === panelId));
  const totalTabs = useSelector(selectTotalTabCount);
  const maxTabs = useSelector((state: RootState) => state.tabs.maxTabs);
  const isSplit = useSelector(selectIsSplit);
  const allPanels = useSelector((state: RootState) => state.tabs.panels);

  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    tabId: '',
  });

  const tabs = panel?.tabs ?? [];
  const activeTabId = panel?.activeTabId ?? '';

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu.visible) return;
    const handleClick = () => setContextMenu((prev) => ({ ...prev, visible: false }));
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu.visible]);

  const handleTabClick = useCallback(
    (tabId: string) => {
      dispatch(activateTab({ panelId, tabId }));
    },
    [dispatch, panelId]
  );

  const handleTabMouseDown = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      if (e.button === 1) {
        e.preventDefault();
        const tab = tabs.find((t) => t.id === tabId);
        if (tab?.closable) {
          dispatch(closeTab({ panelId, tabId }));
        }
      }
    },
    [dispatch, panelId, tabs]
  );

  const handleTabClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      dispatch(closeTab({ panelId, tabId }));
    },
    [dispatch, panelId]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, tabId });
  }, []);

  const handleNewTab = useCallback(() => {
    if (totalTabs >= maxTabs) return;
    dispatch(addTab({ panelId, route: '/', title: t('tabs.home') }));
  }, [dispatch, panelId, totalTabs, maxTabs, t]);

  const handleCloseOthers = useCallback(() => {
    dispatch(closeOtherTabs({ panelId, tabId: contextMenu.tabId }));
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [dispatch, panelId, contextMenu.tabId]);

  const handleCloseFromMenu = useCallback(() => {
    dispatch(closeTab({ panelId, tabId: contextMenu.tabId }));
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [dispatch, panelId, contextMenu.tabId]);

  const handleSplitRight = useCallback(() => {
    dispatch(splitPanel({ tabId: contextMenu.tabId, sourcePanelId: panelId, side: 'right' }));
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [dispatch, panelId, contextMenu.tabId]);

  const handleMoveToOtherPanel = useCallback(() => {
    const otherPanel = allPanels.find((p) => p.id !== panelId);
    if (otherPanel) {
      dispatch(
        moveTabToPanel({
          tabId: contextMenu.tabId,
          sourcePanelId: panelId,
          targetPanelId: otherPanel.id,
        })
      );
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [dispatch, panelId, allPanels, contextMenu.tabId]);

  // Handle dropping tabs from other panels
  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-filarr-tab')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData('application/x-filarr-tab');
      if (!raw) return;
      e.preventDefault();
      try {
        const data = JSON.parse(raw);
        if (data.sourcePanelId !== panelId) {
          dispatch(
            moveTabToPanel({
              tabId: data.tabId,
              sourcePanelId: data.sourcePanelId,
              targetPanelId: panelId,
            })
          );
        }
      } catch {
        // Ignore invalid data
      }
    },
    [dispatch, panelId]
  );

  // Tab drag
  const handleTabDragStart = useCallback(
    (e: React.DragEvent, tabId: string) => {
      const data = JSON.stringify({ tabId, sourcePanelId: panelId });
      e.dataTransfer.setData('application/x-filarr-tab', data);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('filarr:tab-drag-start', { detail: { tabId, sourcePanelId: panelId } })
        );
      }, 0);
    },
    [panelId]
  );

  const handleTabDragEnd = useCallback(() => {
    window.dispatchEvent(new CustomEvent('filarr:tab-drag-end'));
  }, []);

  // Scroll active tab into view
  useEffect(() => {
    if (!tabsContainerRef.current) return;
    const activeEl = tabsContainerRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeTabId]);

  if (!panel) return null;

  const contextTab = tabs.find((t) => t.id === contextMenu.tabId);

  return (
    <>
      <div className="flex items-stretch h-9 bg-[var(--color-surface)] border-b border-[var(--color-border)] select-none shrink-0">
        <div
          ref={tabsContainerRef}
          className="flex flex-1 overflow-x-auto overflow-y-hidden min-w-0"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          onDragOver={handleContainerDragOver}
          onDrop={handleContainerDrop}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                data-tab-id={tab.id}
                draggable={tab.closable}
                onDragStart={(e) => handleTabDragStart(e, tab.id)}
                onDragEnd={handleTabDragEnd}
                className={`group flex items-center gap-1.5 h-full px-3 max-w-[180px] min-w-[100px]
                  border-none border-r border-r-[var(--color-border-light)]
                  text-xs font-medium cursor-pointer whitespace-nowrap relative
                  transition-colors duration-150
                  ${
                    isActive
                      ? 'text-[var(--color-text-primary)] font-semibold bg-[var(--color-background)]'
                      : 'text-[var(--color-text-secondary)] bg-transparent hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)]'
                  }`}
                onClick={() => handleTabClick(tab.id)}
                onMouseDown={(e) => handleTabMouseDown(e, tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                title={tab.title}
              >
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-primary-500)]" />
                )}
                {getTabIcon(tab)}
                <span className="flex-1 overflow-hidden text-ellipsis text-left">{tab.title}</span>
                {tab.closable && (
                  <span
                    className={`flex items-center justify-center w-4 h-4 rounded-sm shrink-0
                      transition-all duration-150 cursor-pointer
                      text-[var(--color-text-tertiary)]
                      hover:bg-red-100 hover:text-red-600
                      ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    onClick={(e) => handleTabClose(e, tab.id)}
                    title={t('tabs.close')}
                  >
                    <CloseIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          className="flex items-center justify-center w-8 h-full border-none bg-transparent
            text-[var(--color-text-tertiary)] cursor-pointer shrink-0
            transition-colors duration-150
            hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)]
            disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handleNewTab}
          title={t('tabs.newTab')}
          disabled={totalTabs >= maxTabs}
        >
          <PlusIcon />
        </button>
      </div>

      {contextMenu.visible && (
        <div
          className="fixed z-[1000] min-w-[160px] bg-[var(--color-surface)] border border-[var(--color-border)]
            rounded-lg shadow-lg p-1 animate-[scaleIn_100ms_ease-out]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextTab?.closable && (
            <button
              className="flex items-center gap-2 w-full px-2.5 py-1.5 border-none rounded-md
                bg-transparent text-[var(--color-text-primary)] text-xs cursor-pointer
                transition-colors duration-100 hover:bg-[var(--color-hover-overlay)]"
              onClick={handleCloseFromMenu}
            >
              {t('tabs.close')}
            </button>
          )}
          <button
            className="flex items-center gap-2 w-full px-2.5 py-1.5 border-none rounded-md
              bg-transparent text-[var(--color-text-primary)] text-xs cursor-pointer
              transition-colors duration-100 hover:bg-[var(--color-hover-overlay)]"
            onClick={handleCloseOthers}
          >
            {t('tabs.closeOthers')}
          </button>
          {!isSplit && contextTab?.closable && (
            <button
              className="flex items-center gap-2 w-full px-2.5 py-1.5 border-none rounded-md
                bg-transparent text-[var(--color-text-primary)] text-xs cursor-pointer
                transition-colors duration-100 hover:bg-[var(--color-hover-overlay)]"
              onClick={handleSplitRight}
            >
              {t('tabs.splitRight')}
            </button>
          )}
          {isSplit && contextTab?.closable && (
            <button
              className="flex items-center gap-2 w-full px-2.5 py-1.5 border-none rounded-md
                bg-transparent text-[var(--color-text-primary)] text-xs cursor-pointer
                transition-colors duration-100 hover:bg-[var(--color-hover-overlay)]"
              onClick={handleMoveToOtherPanel}
            >
              {t('tabs.moveToOtherPanel')}
            </button>
          )}
        </div>
      )}
    </>
  );
});

export default TabBar;
