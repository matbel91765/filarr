/**
 * Layout Component
 *
 * Layout principal de l'application avec Header, Sidebar et SplitContainer.
 * Le contenu est rendu par les PanelView via SplitContainer,
 * pas par {children} (qui n'est plus utilise).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Header } from '../Header';
import { Sidebar } from '../Sidebar';
import { SplitContainer } from '../SplitContainer/SplitContainer';
import { ErrorBoundary } from '../../ui/ErrorBoundary';
import { UITour } from '../../features/UITour';
import { useAutoLock } from '../../../../hooks/useAutoLock';
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
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [, setIsMobile] = useState<boolean>(window.innerWidth < 1024);
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
  }, []);

  // Also open sidebar when tour is relaunched from Settings
  useEffect(() => {
    const handleTourRelaunch = () => {
      setTimeout(() => setSidebarOpen(true), 200);
    };
    window.addEventListener('filarr-tour-relaunch', handleTourRelaunch);
    return () => window.removeEventListener('filarr-tour-relaunch', handleTourRelaunch);
  }, []);

  useEffect(() => {
    const handleResize = (): void => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [sidebarOpen]);

  const handleSidebarToggle = useCallback((): void => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleSidebarClose = useCallback((): void => {
    setSidebarOpen(false);
  }, []);

  const handleRestart = useCallback(() => {
    window.electron?.ipcRenderer?.send('restart_app', null);
  }, []);

  const showToast = updateState !== 'idle' && !updateDismissed;

  return (
    <div className={`layout ${className || ''}`}>
      {showHeader && <Header onMenuToggle={handleSidebarToggle} sidebarOpen={sidebarOpen} />}

      <div className="layout__body">
        {showSidebar && <Sidebar isOpen={sidebarOpen} onClose={handleSidebarClose} />}

        <main
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
