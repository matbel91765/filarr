/**
 * Layout Component
 *
 * Layout principal de l'application avec Header, Sidebar et SplitContainer.
 * Le contenu est rendu par les PanelView via SplitContainer,
 * pas par {children} (qui n'est plus utilise).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Header } from '../Header';
import { Sidebar } from '../Sidebar';
import { SplitContainer } from '../SplitContainer/SplitContainer';
import { ErrorBoundary } from '../../ui/ErrorBoundary';
import { UITour } from '../../features/UITour';
import SyncProgressBar from '../../sync/SyncProgressBar';
import GovernanceBanner from '../../governance/GovernanceBanner';
import { checkForUpdate } from '../../../../services/platform/versionService';
import { useAutoLock } from '../../../../hooks/useAutoLock';
import {
  setSidebarOpen as setSidebarOpenAction,
  toggleSidebar,
} from '../../../../store/slices/uiSlice';
import {
  selectHeaderBarAutohide,
  selectHeaderBarFloating,
  selectHeaderBarSide,
  selectHeaderBarVisible,
  selectTabBarVisible,
  selectSidebarOpen,
} from '../../../../store/selectors/uiSelectors';
import './Layout.css';

export interface LayoutProps {
  children?: React.ReactNode;
  showHeader?: boolean;
  showSidebar?: boolean;
  className?: string;
}

type UpdateState = 'idle' | 'available' | 'downloading' | 'ready';

export const Layout: React.FC<LayoutProps> = ({
  showHeader = true,
  showSidebar = true,
  className,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  // La sidebar vit dans Redux : c'est ce que Ctrl+B et la palette de commandes
  // pilotent (un useState local ici rendait ces raccourcis sans effet).
  const sidebarOpen = useSelector(selectSidebarOpen);
  // Dérivés du réglage « Affichage des barres » : la barre d'onglets, elle,
  // est branchée panneau par panneau dans PanelView.
  const barsShowHeader = useSelector(selectHeaderBarVisible);
  /**
   * PERSONNE NE TIENT LA BANDE.
   *
   * En mode « aucune barre », ni le bandeau ni les onglets ne sont rendus : le
   * contenu commence donc a y=0, sous les boutons de fenetre que l'OS peint
   * par-dessus. Tous les autres modes ont une barre qui reserve (bandeau,
   * onglets, pilule bornee, rail) — celui-ci n'en a aucune, et c'etait le seul
   * trou restant de la primitive.
   */
  const barsShowTabs = useSelector(selectTabBarVisible);
  const barsAutohideHeader = useSelector(selectHeaderBarAutohide);
  const barsFloatingHeader = useSelector(selectHeaderBarFloating);
  const barsSideHeader = useSelector(selectHeaderBarSide);
  const setSidebarOpen = useCallback(
    (open: boolean): void => {
      dispatch(setSidebarOpenAction(open));
    },
    [dispatch]
  );
  // Largeur observée au dernier resize. Sert à ne réagir qu'aux vrais
  // franchissements du seuil : sur téléphone, l'ouverture du clavier virtuel
  // émet un resize (la hauteur change, pas la largeur) et refermait jusqu'ici
  // la sidebar à chaque frappe.
  const prevWidthRef = useRef<number>(window.innerWidth);
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateVersion, setUpdateVersion] = useState<string>('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  // Auto-lock after inactivity
  useAutoLock();

  // Listen for auto-updater events from main process
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    const onAvailable = (_e: any, data: any) => {
      setUpdateVersion(data?.version || '');
      setUpdateState('available');
      setUpdateDismissed(false);
    };
    const onProgress = (_e: any, data: any) => {
      setUpdateState('downloading');
      setDownloadPercent(data?.percent || 0);
    };
    const onDownloaded = (_e: any, data: any) => {
      setUpdateVersion(data?.version || updateVersion);
      setUpdateState('ready');
      setDownloadPercent(100);
    };

    ipc.on('update_available', onAvailable);
    ipc.on('update_download_progress', onProgress);
    ipc.on('update_downloaded', onDownloaded);

    return () => {
      ipc.removeListener('update_available', onAvailable);
      ipc.removeListener('update_download_progress', onProgress);
      ipc.removeListener('update_downloaded', onDownloaded);
    };
  }, [updateVersion]);

  // Anonymous telemetry ping (version, OS) — fire-and-forget, throttled to once per 24h
  useEffect(() => {
    checkForUpdate().catch(() => {});
  }, []);

  // Open sidebar automatically when tour starts so sidebar targets are visible
  useEffect(() => {
    const shouldShowTour =
      !!localStorage.getItem('filarr-onboarding-complete') &&
      !localStorage.getItem('filarr-ui-tour-complete');

    if (shouldShowTour) {
      const timer = setTimeout(() => setSidebarOpen(true), 400);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [setSidebarOpen]);

  // Also open sidebar when tour is relaunched from Settings
  useEffect(() => {
    const handleTourRelaunch = () => {
      setTimeout(() => setSidebarOpen(true), 200);
    };
    window.addEventListener('filarr-tour-relaunch', handleTourRelaunch);
    return () => window.removeEventListener('filarr-tour-relaunch', handleTourRelaunch);
  }, [setSidebarOpen]);

  useEffect(() => {
    const handleResize = (): void => {
      const previousWidth = prevWidthRef.current;
      const width = window.innerWidth;
      prevWidthRef.current = width;
      // Uniquement la transition desktop → étroit, pas « toute largeur < 1024 ».
      const crossedIntoNarrow = previousWidth >= 1024 && width < 1024;
      if (crossedIntoNarrow && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarOpen, setSidebarOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [sidebarOpen, setSidebarOpen]);

  const handleSidebarToggle = useCallback((): void => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  const handleSidebarClose = useCallback((): void => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleRestart = useCallback(() => {
    window.electron?.ipcRenderer?.send('restart_app', null);
  }, []);

  const showToast = updateState !== 'idle' && !updateDismissed;

  // Les modes sans barre supérieure la retirent du DOM ; 'autohide' la sort
  // du flux (CSS) et la révèle à l'approche du bord haut ou dès qu'elle prend
  // le focus clavier. 'floating' et 'side' la gardent montée mais changent sa
  // géométrie (pilule centrée / rail vertical), pilotée par les classes du
  // conteneur et du créneau.
  const headerVisible = showHeader && barsShowHeader;
  const headerAutohide = headerVisible && barsAutohideHeader;
  const headerFloating = headerVisible && barsFloatingHeader;
  const headerSide = headerVisible && barsSideHeader;
  // Vrai uniquement quand la barre occupe une vraie ligne du flux ('all',
  // 'search-only', 'floating'). Sinon le tiroir latéral, ancré sous
  // --spacing-layout-header-height, laisserait un vide de 64 px en haut.
  const headerInFlow = headerVisible && !headerAutohide && !headerSide;

  // Dépliage du mode « au survol », piloté en JS et NON en CSS.
  //
  // Les 40 premiers pixels de la fenêtre n'appartiennent pas au DOM : 0-7 px
  // sont la bordure de redimensionnement (HTTOP) et 8-39 px la bande de
  // déplacement de WindowDragRegion (-webkit-app-region: drag). Sonde Electron
  // avec un VRAI curseur : la dernière rangée qui émet encore un mousemove est
  // y = 40, aucune en dessous — une bande de survol collée au bord haut ne peut
  // donc jamais s'armer, quel que soit son :hover. On ouvre à l'approche depuis
  // la première rangée atteignable, avec hystérésis pour ne pas battre ; la
  // barre elle-même se déplie SOUS les onglets (cf. Layout.css) pour ne jamais
  // leur voler un clic.
  const [headerPeek, setHeaderPeek] = useState(false);
  const headerPeekRef = useRef(false);

  useEffect(() => {
    if (!headerAutohide) {
      headerPeekRef.current = false;
      setHeaderPeek(false);
      return undefined;
    }
    const handleMouseMove = (e: MouseEvent): void => {
      // 48 px pour ouvrir (la rangée 40 suffit donc), 112 px pour se refermer :
      // la barre dépliée descend jusqu'à ~101 px, on reste ouvert tant que le
      // pointeur est dessus.
      const limit = headerPeekRef.current ? 112 : 48;
      const next = e.clientY <= limit;
      if (next !== headerPeekRef.current) {
        headerPeekRef.current = next;
        setHeaderPeek(next);
      }
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [headerAutohide]);

  const layoutModeClass = headerAutohide
    ? 'layout--header-autohide'
    : headerFloating
      ? 'layout--header-floating'
      : headerSide
        ? 'layout--header-side'
        : '';

  const headerSlotClass = headerAutohide
    ? `layout__header-slot--auto ${headerPeek ? 'layout__header-slot--peek' : ''}`
    : headerFloating
      ? 'layout__header-slot--floating'
      : headerSide
        ? 'layout__header-slot--side'
        : '';

  return (
    <div
      className={`layout ${layoutModeClass} ${
        headerInFlow ? '' : 'layout--header-out-of-flow'
      } ${!barsShowHeader && !barsShowTabs ? 'layout--no-chrome' : ''} ${className || ''}`}
    >
      {/* Skip link: first focusable element, jumps keyboard users past the
          header/sidebar straight to the content. */}
      <a href="#main-content" className="skip-link">
        Aller au contenu
      </a>
      {headerVisible && (
        <div
          className={`layout__header-slot ${headerSlotClass}`}
          /* En rail, la barre est une colonne FIXE qui mange le bord gauche de
             la fenêtre, au-dessus des panneaux flottants (z 1041 contre 1000).
             Les menus et panneaux sont portés par <body> : le padding de
             .layout ne les décale pas, et ils se glissaient sous le rail, qui
             leur rognait leur marge gauche. L'attribut déclare l'obstruction ;
             sa LARGEUR est mesurée, jamais recopiée (cf. overlayBounds). */
          data-overlay-obstruction={headerSide ? 'left' : undefined}
        >
          <Header onMenuToggle={handleSidebarToggle} sidebarOpen={sidebarOpen} />
        </div>
      )}
      <SyncProgressBar />
      <GovernanceBanner />

      <div className="layout__body">
        {/* Le tiroir est en position:fixed : le décalage du rail, posé en
            padding sur .layout, ne l'atteint pas. On le lui donne par classe. */}
        {showSidebar && (
          <Sidebar
            isOpen={sidebarOpen}
            onClose={handleSidebarClose}
            className={headerSide ? 'layout__sidebar--railed' : ''}
          />
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className={`layout__content ${sidebarOpen && showSidebar ? 'layout__content--with-sidebar' : ''}`}
        >
          <ErrorBoundary>
            <SplitContainer />
          </ErrorBoundary>
        </main>
      </div>

      {/* Interactive UI Tour (shown after onboarding, before tour is completed) */}
      <UITour />

      {/* Update toast — bottom right */}
      {showToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            zIndex: 9999,
            minWidth: 300,
            maxWidth: 380,
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.18))',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            animation: 'slideUp 0.3s ease-out',
          }}
        >
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-primary-600)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {updateState === 'ready'
                  ? t('update.ready', 'Mise a jour prete')
                  : updateState === 'downloading'
                    ? t('update.downloading', 'Telechargement...')
                    : t('update.available', 'Filarr {{version}} disponible', {
                        version: updateVersion,
                      })}
              </span>
            </div>
            {updateState !== 'downloading' && (
              <button
                onClick={() => setUpdateDismissed(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  color: 'var(--color-text-tertiary)',
                  lineHeight: 0,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          {/* Progress bar — shown during download and when ready */}
          {(updateState === 'downloading' || updateState === 'ready') && (
            <div
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: 'var(--color-border)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${downloadPercent}%`,
                  borderRadius: 2,
                  backgroundColor:
                    updateState === 'ready'
                      ? 'var(--color-success, #22c55e)'
                      : 'var(--color-primary)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}

          {/* Action buttons */}
          {updateState === 'ready' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setUpdateDismissed(true)}
                style={{
                  fontSize: 12,
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-background)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {t('update.later', 'Plus tard')}
              </button>
              <button
                onClick={handleRestart}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--color-primary-600, var(--color-primary))',
                  color: 'var(--color-primary-foreground, #fff)',
                  cursor: 'pointer',
                }}
              >
                {t('update.restart', 'Redemarrer')}
              </button>
            </div>
          )}

          {updateState === 'downloading' && (
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {downloadPercent}%
            </span>
          )}
        </div>
      )}

      {/* Animation keyframe for toast */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default Layout;
