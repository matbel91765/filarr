/**
 * useTabNavigation Hook
 *
 * Synchronise les onglets Redux avec React Router.
 * Seul le panneau focused est synchronise avec l'URL du navigateur.
 * - Quand l'URL change → met a jour la route de l'onglet actif du panneau focused
 * - Quand l'onglet actif / panneau focused change → navigue vers sa route
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import { updateTabRoute } from '../store/slices/tabsSlice';
import i18n from '../i18n/config';

/** Map routes to human-readable titles */
function routeToTitle(pathname: string, folders: Record<string, any>): string {
  if (pathname === '/') return i18n.t('tabs.home');
  if (pathname === '/settings') return i18n.t('tabs.settings');
  if (pathname === '/calendar') return i18n.t('tabs.calendar');
  if (pathname === '/trash') return i18n.t('tabs.trash');
  if (pathname === '/vault') return i18n.t('tabs.vault');
  // Password Manager disabled until v2.x
  if (pathname === '/collections') return i18n.t('tabs.collections');
  if (pathname === '/automation') return i18n.t('tabs.automation');
  if (pathname === '/timeline') return i18n.t('tabs.timeline');
  if (pathname === '/duplicates') return i18n.t('tabs.duplicates');
  if (pathname === '/analytics') return i18n.t('tabs.analytics');
  if (pathname === '/file-requests') return i18n.t('tabs.fileRequests');
  if (pathname === '/data-rooms') return i18n.t('tabs.dataRooms');
  if (pathname === '/admin') return i18n.t('tabs.admin');
  if (pathname === '/share-links') return i18n.t('tabs.shareLinks');
  if (pathname === '/api-keys') return i18n.t('tabs.apiKeys');

  const folderMatch = pathname.match(/^\/folder\/(.+)$/);
  if (folderMatch) {
    const folderId = folderMatch[1];
    const folder = folders[folderId];
    return folder?.name ?? i18n.t('tabs.folder');
  }

  return 'Filarr';
}

export { routeToTitle };

export function useTabNavigation(): void {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const location = useLocation();

  const panels = useSelector((state: RootState) => state.tabs.panels);
  const focusedPanelId = useSelector((state: RootState) => state.tabs.focusedPanelId);
  const folders = useSelector((state: RootState) => state.folders.byId);
  const isSplit = panels.length > 1;

  const focusedPanel = panels.find((p) => p.id === focusedPanelId);
  const activeTabId = focusedPanel?.activeTabId;
  const activeTab = focusedPanel?.tabs.find((t) => t.id === activeTabId);

  // Refs to prevent infinite loops
  const isTabSwitchRef = useRef(false);
  const prevActiveTabIdRef = useRef(activeTabId);
  const prevFocusedPanelIdRef = useRef(focusedPanelId);

  // Effect 1: When URL changes → update focused panel's active tab route
  // In split mode, the Sidebar already dispatches updateTabRoute directly,
  // so we skip this effect to avoid double-updating.
  useEffect(() => {
    if (isTabSwitchRef.current) {
      isTabSwitchRef.current = false;
      return;
    }

    if (!activeTabId || !focusedPanelId) return;

    // In split mode, skip URL → tab sync (Sidebar handles it directly)
    // to prevent the URL change from overriding the Sidebar's explicit dispatch.
    if (isSplit && activeTab && activeTab.route === location.pathname) return;

    const title = routeToTitle(location.pathname, folders);
    const folderMatch = location.pathname.match(/^\/folder\/(.+)$/);
    const folderId = folderMatch ? folderMatch[1] : undefined;

    dispatch(
      updateTabRoute({
        panelId: focusedPanelId,
        tabId: activeTabId,
        route: location.pathname,
        title,
        folderId,
      })
    );
  }, [location.pathname, activeTabId, focusedPanelId, dispatch, folders, isSplit, activeTab]);

  // Effect 2: When active tab or focused panel changes → navigate
  // Keeps the URL in sync with the focused panel's active route.
  useEffect(() => {
    const tabChanged = prevActiveTabIdRef.current !== activeTabId;
    const panelChanged = prevFocusedPanelIdRef.current !== focusedPanelId;
    prevActiveTabIdRef.current = activeTabId;
    prevFocusedPanelIdRef.current = focusedPanelId;

    if (!tabChanged && !panelChanged) return;
    if (!activeTab) return;

    if (activeTab.route !== location.pathname) {
      isTabSwitchRef.current = true;
      navigate(activeTab.route);
    }
  }, [activeTabId, focusedPanelId, activeTab, navigate, location.pathname]);
}

export default useTabNavigation;
