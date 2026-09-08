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
import {
  isLegacyRoute,
  normalizeRoute,
  vaultIdFromRoute,
} from '../renderer/components/layout/RouteContent/routeCompat';

/**
 * Map routes to human-readable titles.
 *
 * `vaults` est optionnel : la barre latérale (Sidebar) appelle encore la
 * signature à deux arguments pour des routes fixes. Sans lui, un onglet de
 * coffre porte le repli « Coffre partagé » — jamais une chaîne vide.
 */
function routeToTitle(
  rawPathname: string,
  folders: Record<string, any>,
  vaults?: Record<string, { name?: string } | undefined>
): string {
  // Les routes anciennes (`/vaults`, `/vaults/<id>`) sont titrées comme leur
  // forme canonique : un onglet legacy réhydraté ne s'appelle plus « Team Vaults ».
  const pathname = normalizeRoute(rawPathname);
  if (pathname === '/') return i18n.t('tabs.home');
  if (pathname === '/settings') return i18n.t('tabs.settings');
  // Ces trois routes existent depuis longtemps mais n'avaient pas de titre :
  // leurs onglets s'appelaient tous « Filarr », donc rien ne les distinguait
  // les uns des autres dans la barre d'onglets ni dans le titre de la fenêtre.
  if (pathname === '/profile') return i18n.t('tabs.profile', { defaultValue: 'Profil' });
  if (pathname === '/notes' || pathname.startsWith('/notes/')) {
    return i18n.t('tabs.notes', { defaultValue: 'Notes' });
  }
  if (pathname === '/board') return i18n.t('tabs.board', { defaultValue: 'Tableau' });
  if (pathname === '/calendar') return i18n.t('tabs.calendar');
  if (pathname === '/trash') return i18n.t('tabs.trash');
  if (pathname === '/vault') return i18n.t('tabs.vault');
  // Password Manager disabled until v2.x
  if (pathname === '/collections') return i18n.t('tabs.collections');
  if (pathname === '/automation') return i18n.t('tabs.automation');
  if (pathname === '/timeline') return i18n.t('tabs.timeline');
  if (pathname === '/shares') return i18n.t('tabs.shares', { defaultValue: 'Partages' });
  if (pathname === '/duplicates') return i18n.t('tabs.duplicates');
  if (pathname === '/analytics') return i18n.t('tabs.analytics');
  if (pathname === '/file-requests') return i18n.t('tabs.fileRequests');
  if (pathname === '/data-rooms') return i18n.t('tabs.dataRooms');
  if (pathname === '/admin') return i18n.t('tabs.admin');
  if (pathname === '/pricing') return i18n.t('tabs.pricing');
  if (pathname === '/subscription') return i18n.t('tabs.subscription');
  if (pathname === '/share-links') return i18n.t('tabs.shareLinks');
  if (pathname === '/api-keys') return i18n.t('tabs.apiKeys');

  const folderMatch = pathname.match(/^\/folder\/(.+)$/);
  if (folderMatch) {
    const folderId = folderMatch[1];
    const folder = folders[folderId];
    return folder?.name ?? i18n.t('tabs.folder');
  }

  // Même patron que `/folder/<id>` : le nom du coffre s'il est connu. Un coffre
  // VERROUILLÉ (non déchiffrable) n'a pas de nom lisible, et un coffre absent
  // (pas encore chargé, ou quitté) n'en a pas du tout : dans les deux cas le
  // repli est un libellé, pas une chaîne vide dans la barre d'onglets.
  const vaultId = vaultIdFromRoute(pathname);
  if (vaultId) {
    const name = vaults?.[vaultId]?.name;
    return name || i18n.t('tabs.vaultFolder', { defaultValue: 'Coffre partagé' });
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
  const vaults = useSelector((state: RootState) => state.vaults.vaults);
  const isLocked = useSelector((state: RootState) => state.auth.isLocked);
  const isSplit = panels.length > 1;

  const focusedPanel = panels.find((p) => p.id === focusedPanelId);
  const activeTabId = focusedPanel?.activeTabId;
  const activeTab = focusedPanel?.tabs.find((t) => t.id === activeTabId);

  // Refs to prevent infinite loops
  const isTabSwitchRef = useRef(false);
  const prevActiveTabIdRef = useRef(activeTabId);
  const prevFocusedPanelIdRef = useRef(focusedPanelId);

  // Effect 0: une URL LEGACY (`/vaults`, `/vaults/<id>`) est remplacée par sa
  // forme canonique, sans entrée d'historique (replace) : un lien profond, un
  // raccourci ou une entrée de barre latérale encore à l'ancienne orthographe
  // atterrit au bon endroit, et « retour » ne repasse pas par l'adresse morte.
  // L'effet 1 tourne aussi sur ce même commit avec l'ancienne URL, puis de
  // nouveau avec la nouvelle : le second passage écrase le premier — sans
  // danger, et sans drapeau à poser.
  useEffect(() => {
    if (isLegacyRoute(location.pathname)) {
      navigate(normalizeRoute(location.pathname), { replace: true });
    }
  }, [location.pathname, navigate]);

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

    const title = routeToTitle(location.pathname, folders, vaults);
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
  }, [
    location.pathname,
    activeTabId,
    focusedPanelId,
    dispatch,
    folders,
    vaults,
    isSplit,
    activeTab,
  ]);

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

  // Effect 3: Keep document.title in sync with the focused panel's active route
  // (browser tab title on web, window title on desktop). Verrouillé : titre
  // neutre — ne pas exposer le contenu courant dans la barre des tâches.
  useEffect(() => {
    const apply = () => {
      const title =
        !isLocked && activeTab ? routeToTitle(activeTab.route, folders, vaults) : 'Filarr';
      document.title = title === 'Filarr' ? 'Filarr' : `${title} · Filarr`;
    };
    apply();
    i18n.on('languageChanged', apply);
    return () => {
      i18n.off('languageChanged', apply);
    };
  }, [activeTab, folders, vaults, isLocked]);
}

export default useTabNavigation;
