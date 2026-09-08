/**
 * MiniMode — fenêtre compacte de protection (Wave 1).
 *
 * Rendue dans une SECONDE fenêtre Electron (frameless, ~360×480) qui charge
 * le même index.html avec le hash '#/mini'. C'est un arbre React autonome :
 * PAS de Provider Redux, pas de LaunchScreen, pas de Router — tout l'état
 * (verrouillage, récents) vient du main process via desktopProtectionBridge,
 * car le state Redux ne circule pas entre fenêtres.
 *
 * Thème + police auto-appliqués depuis les préférences persistées
 * (localStorage 'theme' / 'filarr-font', partagés entre fenêtres de même
 * origine) et resynchronisés via l'événement 'storage' quand la fenêtre
 * principale change de thème.
 *
 * Icônes : la famille de protection écrite à la main
 * (src/renderer/components/icons — vocabulaire point-et-trait du glyphe F),
 * jamais d'icône générée.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import FilarrLogo from '../ui/FilarrLogo';
import {
  FilarrLockMark,
  FilarrShieldMark,
  LockAllIcon,
  OpenExternalIcon,
  ProtectInPlaceIcon,
  RecentItemsIcon,
  VaultUnlockIcon,
} from '../icons';
import {
  getMiniVaultState,
  getRecentProtected,
  protectFiles,
  lockVaultFromMini,
  openMainWindow,
  hideMiniWindow,
  onMiniRefresh,
  onLockRequest,
  type RecentProtectedItem,
} from '../../../services/features/desktopProtectionBridge';
import { protectInPlace } from '../../../services/features/filarrBoxBridge';
import './MiniMode.css';

// ==================== Petits glyphes utilitaires ====================
// Convention inline-SVG du projet (heroicons-style, currentColor) pour les
// contrôles génériques de la barre de titre / liste — les motifs de
// protection viennent de ../icons.

const CloseIcon: React.FC = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const FileIcon: React.FC = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

// ==================== Utilitaires ====================

/** Mêmes valeurs que le sélecteur de police des Paramètres (App.tsx). */
const FONT_MAP: Record<string, string> = {
  inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif",
  geist: "'Geist', 'Inter', -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  georgia: "'Georgia', 'Times New Roman', serif",
  nunito: "'Nunito', 'Inter', -apple-system, sans-serif",
  'space-grotesk': "'Space Grotesk', 'Inter', -apple-system, sans-serif",
  atkinson: "'Atkinson Hyperlegible', 'Inter', -apple-system, sans-serif",
  jakarta: "'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif",
};

/**
 * Applique thème + police persistés à CETTE fenêtre (le state Redux de la
 * fenêtre principale ne circule pas ; localStorage est partagé).
 */
function bootstrapAppearance(): void {
  try {
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    const savedFont = localStorage.getItem('filarr-font');
    const fontValue = savedFont ? FONT_MAP[savedFont] : undefined;
    if (fontValue) {
      document.documentElement.style.setProperty('--font-family-base', fontValue);
      document.documentElement.style.setProperty('--font-family-display', fontValue);
    }
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

type Feedback = { kind: 'success' | 'error' | 'info'; text: string } | null;

const RECENT_LIMIT = 5;

// ==================== Composant ====================

export const MiniMode: React.FC = () => {
  const { t } = useTranslation();

  // null = état inconnu (main pas encore interrogé / canal indisponible)
  const [locked, setLocked] = useState<boolean | null>(null);
  const [bridgeAvailable, setBridgeAvailable] = useState(true);
  const [recent, setRecent] = useState<RecentProtectedItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const refresh = useCallback(async () => {
    const [stateRes, recentRes] = await Promise.all([getMiniVaultState(), getRecentProtected()]);
    if (stateRes.ok && stateRes.data) {
      setLocked(stateRes.data.locked);
      setBridgeAvailable(true);
    } else if (stateRes.unavailable) {
      setBridgeAvailable(false);
    }
    if (recentRes.ok && Array.isArray(recentRes.data)) {
      setRecent(recentRes.data.slice(0, RECENT_LIMIT));
    }
  }, []);

  // Boot : thème + état initial + resynchronisations.
  useEffect(() => {
    bootstrapAppearance();
    refresh();

    // Le main pousse 'mini:refresh' à chaque changement pertinent
    // (verrouillage, nouveau fichier protégé, réglages).
    const unsubscribeRefresh = onMiniRefresh(() => {
      refresh();
    });

    // Verrouillage broadcasté par le main (powerMonitor, raccourci, tray) :
    // réagir immédiatement sans attendre le refetch.
    const unsubscribeLock = onLockRequest(() => {
      setLocked(true);
      setRecent([]);
    });

    // Thème changé dans la fenêtre principale → l'événement storage
    // traverse les fenêtres de même origine.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'theme' || e.key === 'filarr-font') bootstrapAppearance();
    };
    window.addEventListener('storage', onStorage);

    // Filet de sécurité : refetch au focus (la fenêtre mini est refocusée
    // à chaque ouverture depuis le tray / raccourci global).
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      unsubscribeRefresh();
      unsubscribeLock();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  // ── Protection de fichiers (drop / sélecteur) ──
  const handleProtectFiles = useCallback(
    async (files: File[]) => {
      if (busy) return;
      setFeedback(null);

      const getPath = window.electron?.getPathForFile;
      const paths: string[] = [];
      let unresolvable = 0;
      for (const file of files) {
        let osPath: string | null = null;
        try {
          osPath = getPath ? getPath(file) : null;
        } catch {
          osPath = null;
        }
        if (osPath && osPath.length > 0) paths.push(osPath);
        else unresolvable += 1;
      }

      if (paths.length === 0) {
        setFeedback({
          kind: 'error',
          text: t(
            'miniMode.noResolvablePath',
            "Impossible de résoudre le chemin de ces fichiers — importez-les depuis l'explorateur."
          ),
        });
        return;
      }

      setBusy(true);
      try {
        const res = await protectFiles(paths);
        if (res.ok) {
          const imported = res.data?.imported ?? paths.length;
          const failed = (res.data?.failed ?? 0) + unresolvable;
          setFeedback({
            kind: failed > 0 ? 'info' : 'success',
            text:
              failed > 0
                ? t(
                    'miniMode.protectedPartial',
                    '{{count}} fichier(s) protégé(s), {{failed}} en échec.',
                    {
                      count: imported,
                      failed,
                    }
                  )
                : t(
                    'miniMode.protectedSuccess',
                    '{{count}} fichier(s) protégé(s) dans votre coffre.',
                    {
                      count: imported,
                    }
                  ),
          });
          refresh();
        } else if (res.unavailable) {
          setFeedback({
            kind: 'info',
            text: t(
              'miniMode.bridgeUnavailable',
              'Fonction indisponible — mettez à jour Filarr puis relancez.'
            ),
          });
        } else {
          setFeedback({
            kind: 'error',
            text: res.error || t('miniMode.protectFailed', 'Échec de la protection des fichiers.'),
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh, t]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setDragActive(false);
      if (locked !== false || busy) return;
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) handleProtectFiles(files);
    },
    [locked, busy, handleProtectFiles]
  );

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handlePick = useCallback(() => {
    if (locked !== false || busy) return;
    fileInputRef.current?.click();
  }, [locked, busy]);

  const handlePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length > 0) handleProtectFiles(files);
    },
    [handleProtectFiles]
  );

  // ── Protéger sur place (Wave 2) ──
  // Depuis la fenêtre mini : sélecteur OS natif → conteneurs .filarr créés À
  // CÔTÉ des originaux, ORIGINAUX CONSERVÉS (pas de place ici pour la note
  // d'honnêteté SSD — la suppression se choisit dans la fenêtre principale).
  const handleProtectInPlace = useCallback(async () => {
    if (locked !== false || busy) return;
    const renderer = window.electron?.ipcRenderer;
    if (!renderer) return;

    let paths: string[] = [];
    try {
      const result = (await renderer.invoke('showOpenDialog', {
        properties: ['openFile', 'multiSelections'],
      })) as { canceled?: boolean; filePaths?: string[] } | undefined;
      paths = result && !result.canceled ? (result.filePaths ?? []) : [];
    } catch {
      paths = [];
    }
    if (paths.length === 0) return;

    setBusy(true);
    setFeedback(null);
    try {
      const res = await protectInPlace({ paths, deleteOriginals: false });
      if (res.ok && res.data) {
        const okCount = res.data.results.filter((r) => r.ok).length;
        const failedCount = res.data.results.length - okCount;
        setFeedback({
          kind: failedCount > 0 ? 'info' : 'success',
          text:
            failedCount > 0
              ? t(
                  'miniMode.inPlacePartial',
                  '{{count}} conteneur(s) .filarr créé(s), {{failed}} en échec — originaux conservés.',
                  { count: okCount, failed: failedCount }
                )
              : t(
                  'miniMode.inPlaceSuccess',
                  '{{count}} conteneur(s) .filarr créé(s) à côté des originaux (conservés).',
                  { count: okCount }
                ),
        });
      } else if (res.unavailable) {
        setFeedback({
          kind: 'info',
          text: t(
            'miniMode.bridgeUnavailable',
            'Fonction indisponible — mettez à jour Filarr puis relancez.'
          ),
        });
      } else {
        setFeedback({
          kind: 'error',
          text: res.error || t('miniMode.inPlaceFailed', 'Échec de la protection sur place.'),
        });
      }
    } finally {
      setBusy(false);
    }
  }, [locked, busy, t]);

  // ── Verrouillage ──
  const handleLockAll = useCallback(async () => {
    const res = await lockVaultFromMini();
    if (res.ok) {
      setLocked(true);
      setRecent([]);
      setFeedback({
        kind: 'success',
        text: t('miniMode.lockedAll', 'Coffre verrouillé — fichiers temporaires purgés.'),
      });
    } else if (res.unavailable) {
      setFeedback({
        kind: 'info',
        text: t(
          'miniMode.bridgeUnavailable',
          'Fonction indisponible — mettez à jour Filarr puis relancez.'
        ),
      });
    } else {
      setFeedback({
        kind: 'error',
        text: res.error || t('miniMode.lockFailed', 'Échec du verrouillage.'),
      });
    }
  }, [t]);

  const handleUnlock = useCallback(() => {
    // Le déverrouillage exige le mot de passe / PIN saisi dans la fenêtre
    // principale (la FEK ne peut pas être dérivée ici) — on l'ouvre.
    openMainWindow();
  }, []);

  const handleOpenMain = useCallback(() => {
    openMainWindow();
  }, []);

  const handleClose = useCallback(async () => {
    const res = await hideMiniWindow();
    if (!res.ok) window.close();
  }, []);

  const handleRecentClick = useCallback(() => {
    // Pas de navigation profonde inter-fenêtres : on ouvre Filarr, le
    // sous-menu « Fichiers récents » du tray, lui, navigue directement.
    openMainWindow();
  }, []);

  const formatRelativeTime = useCallback(
    (iso?: string): string => {
      if (!iso) return '';
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return '';
      const minutes = Math.round((Date.now() - then) / 60000);
      if (minutes < 1) return t('miniMode.timeNow', "à l'instant");
      if (minutes < 60)
        return t('miniMode.timeMinutes', 'il y a {{count}} min', { count: minutes });
      const hours = Math.round(minutes / 60);
      if (hours < 24) return t('miniMode.timeHours', 'il y a {{count}} h', { count: hours });
      const days = Math.round(hours / 24);
      return t('miniMode.timeDays', 'il y a {{count}} j', { count: days });
    },
    [t]
  );

  const isUnlocked = locked === false;

  return (
    <div className="mini-root">
      {/* ── Barre de titre (drag de la fenêtre) ── */}
      <header className="mini-titlebar">
        <FilarrLogo size={18} />
        <span className="mini-titlebar__title">Filarr</span>
        {locked !== null && (
          <span
            className={`mini-status-pill ${
              isUnlocked ? 'mini-status-pill--unlocked' : 'mini-status-pill--locked'
            }`}
          >
            <span className="mini-status-pill__dot" aria-hidden="true" />
            {isUnlocked
              ? t('miniMode.statusUnlocked', 'Déverrouillé')
              : t('miniMode.statusLocked', 'Verrouillé')}
          </span>
        )}
        <span className="mini-titlebar__spacer" />
        <button
          type="button"
          className="mini-titlebar__btn"
          onClick={handleOpenMain}
          title={t('miniMode.openMain', 'Ouvrir Filarr')}
          aria-label={t('miniMode.openMain', 'Ouvrir Filarr')}
        >
          <OpenExternalIcon size={15} />
        </button>
        <button
          type="button"
          className="mini-titlebar__btn"
          onClick={handleClose}
          title={t('miniMode.close', 'Fermer')}
          aria-label={t('miniMode.close', 'Fermer')}
        >
          <CloseIcon />
        </button>
      </header>

      <main className="mini-body">
        {/* ── Zone principale : dépôt (déverrouillé) ou état verrouillé ── */}
        {isUnlocked ? (
          <div
            className={`mini-dropzone ${dragActive ? 'mini-dropzone--active' : ''} ${
              busy ? 'mini-dropzone--disabled' : ''
            }`}
            role="button"
            tabIndex={0}
            aria-label={t('miniMode.dropTitle', 'Glissez des fichiers pour les protéger')}
            onClick={handlePick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handlePick();
              }
            }}
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
          >
            <span className="mini-dropzone__icon">
              <FilarrShieldMark size={44} color="currentColor" />
            </span>
            <p className="mini-dropzone__title">
              {dragActive
                ? t('miniMode.dropRelease', 'Déposez pour protéger')
                : t('miniMode.dropTitle', 'Glissez des fichiers pour les protéger')}
            </p>
            <p className="mini-dropzone__hint">
              {busy
                ? t('miniMode.protecting', 'Chiffrement en cours…')
                : t('miniMode.dropHint', 'ou cliquez pour choisir des fichiers')}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={handlePicked}
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
        ) : (
          <div className="mini-locked">
            {/* État inconnu (connexion) : bouclier neutre — ne jamais afficher
                un cadenas ouvert/fermé avant de connaître l'état réel. */}
            <span
              className={`mini-locked__icon ${locked === null ? 'mini-locked__icon--pending' : ''}`}
            >
              {locked === null ? (
                <FilarrShieldMark size={44} color="currentColor" />
              ) : (
                <FilarrLockMark size={44} color="currentColor" />
              )}
            </span>
            <p className="mini-locked__title">
              {locked === null
                ? bridgeAvailable
                  ? t('miniMode.stateLoading', 'Connexion au coffre…')
                  : t('miniMode.stateUnavailable', 'État du coffre indisponible')
                : t('miniMode.lockedTitle', 'Coffre verrouillé')}
            </p>
            <p className="mini-locked__hint">
              {locked === null
                ? bridgeAvailable
                  ? ''
                  : t(
                      'miniMode.bridgeUnavailable',
                      'Fonction indisponible — mettez à jour Filarr puis relancez.'
                    )
                : t('miniMode.lockedHint', 'Le déverrouillage se fait dans la fenêtre principale.')}
            </p>
            {locked === true && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<VaultUnlockIcon size={15} />}
                onClick={handleUnlock}
              >
                {t('miniMode.unlock', 'Déverrouiller')}
              </Button>
            )}
          </div>
        )}

        {/* ── Protéger sur place (Wave 2) : conteneur .filarr à côté de
             l'original, ouvrable uniquement via Filarr ── */}
        {isUnlocked && (
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            disabled={busy}
            leftIcon={<ProtectInPlaceIcon size={14} />}
            onClick={() => void handleProtectInPlace()}
          >
            {t('miniMode.protectInPlace', 'Protéger sur place…')}
          </Button>
        )}

        {busy && (
          <div
            className="mini-progress"
            role="progressbar"
            aria-label={t('miniMode.protecting', 'Chiffrement en cours…')}
          >
            <div className="mini-progress__bar" />
          </div>
        )}

        {feedback && (
          <div
            className={`mini-feedback mini-feedback--${feedback.kind}`}
            role={feedback.kind === 'error' ? 'alert' : 'status'}
          >
            {feedback.text}
          </div>
        )}

        {/* ── Récents (masqués quand le coffre est verrouillé : pas de
             métadonnées en clair sur un écran verrouillé) ── */}
        {isUnlocked && (
          <section className="mini-recent" aria-label={t('miniMode.recent', 'Protégés récemment')}>
            <p className="mini-recent__label">
              <RecentItemsIcon size={12} className="mini-recent__label-icon" />
              {t('miniMode.recent', 'Protégés récemment')}
            </p>
            {recent.length === 0 ? (
              <p className="mini-recent__empty">
                {t('miniMode.recentEmpty', 'Aucun fichier protégé récemment.')}
              </p>
            ) : (
              <ul className="mini-recent__list">
                {recent.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="mini-recent__item"
                      onClick={handleRecentClick}
                      title={t('miniMode.openMain', 'Ouvrir Filarr')}
                    >
                      <span className="mini-recent__file-icon">
                        <FileIcon />
                      </span>
                      <span className="mini-recent__name">{item.name}</span>
                      <span className="mini-recent__time">
                        {formatRelativeTime(item.protectedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ── Tout verrouiller ── */}
        {isUnlocked && (
          <footer className="mini-footer">
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              leftIcon={<LockAllIcon size={14} />}
              onClick={handleLockAll}
            >
              {t('miniMode.lockAll', 'Tout verrouiller')}
            </Button>
          </footer>
        )}
      </main>
    </div>
  );
};

export default MiniMode;
