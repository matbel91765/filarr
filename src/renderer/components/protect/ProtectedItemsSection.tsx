/**
 * ProtectedItemsSection — « Mes fichiers protégés (sur place) » (Wave 2).
 *
 * Liste du registre des conteneurs .filarr protégés sur place. Le registre
 * est ADVISORY : un conteneur déplacé/renommé s'ouvre toujours par
 * double-clic — la liste sert à les retrouver depuis l'application. Une
 * entrée introuvable est grisée avec « Localiser… » (re-pointage validé côté
 * main) et « Retirer » ; aucune purge automatique.
 *
 * Rendu dans la section Paramètres → Protection du bureau, même langage
 * visuel (design system + famille d'icônes de protection écrite à la main).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useNotification } from '../ui/Notification';
import {
  BoxFileIcon,
  BoxFolderIcon,
  ForgetItemIcon,
  LocateIcon,
  OpenExternalIcon,
  ProtectInPlaceIcon,
  RevealLocationIcon,
  VaultUnlockIcon,
} from '../icons';
import {
  listProtectedItems,
  removeProtectedItem,
  relocateProtectedItem,
  showBoxInFolder,
  unprotectBox,
  queueBoxOpen,
  subscribeRegistryChanged,
  notifyRegistryChanged,
  type ProtectedRegistryEntry,
} from '../../../services/features/filarrBoxBridge';
import { ProtectInPlaceDialog } from './ProtectInPlaceDialog';
import { formatBytes } from '../../../constants/limits';
import './ProtectedItemsSection.css';

type LoadState = 'loading' | 'ready' | 'unavailable' | 'error';

export const ProtectedItemsSection: React.FC = () => {
  const { t } = useTranslation();
  const { success, error: notifyError, info } = useNotification();

  const [items, setItems] = useState<ProtectedRegistryEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  /** id de l'entrée en cours d'action (désactive ses boutons). */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unprotectTarget, setUnprotectTarget] = useState<ProtectedRegistryEntry | null>(null);
  const [protectPaths, setProtectPaths] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    const res = await listProtectedItems();
    if (res.ok && Array.isArray(res.data)) {
      setItems(res.data);
      setLoadState('ready');
      setLoadError(null);
    } else if (res.unavailable) {
      setLoadState('unavailable');
    } else {
      setLoadState('error');
      setLoadError(res.error ?? null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Rafraîchir quand une protection/déprotection aboutit ailleurs
    // (dialogue FolderView, host de double-clic, mini-vault).
    return subscribeRegistryChanged(() => {
      void refresh();
    });
  }, [refresh]);

  // ── Actions d'entrée ──

  const handleOpen = useCallback((entry: ProtectedRegistryEntry) => {
    // Même chemin que le double-clic : FilarrBoxHost draine la file
    // (fichier → ouverture temp ; dossier → mini-coffre navigable).
    queueBoxOpen({ boxPath: entry.boxPath, kind: entry.kind });
  }, []);

  const handleReveal = useCallback(
    async (entry: ProtectedRegistryEntry) => {
      const res = await showBoxInFolder(entry.boxPath);
      if (!res.ok) {
        if (res.unavailable) {
          info(
            t(
              'settings.desktop.featureUnavailable',
              'Disponible après la prochaine mise à jour de Filarr.'
            )
          );
        } else {
          notifyError(
            res.error ||
              t(
                'desktopProtection.registry.revealFailed',
                'Impossible d’afficher le conteneur dans l’explorateur.'
              )
          );
        }
      }
    },
    [notifyError, info, t]
  );

  const handleUnprotect = useCallback(async () => {
    const entry = unprotectTarget;
    if (!entry) return;
    setBusyId(entry.id);
    try {
      const res = await unprotectBox(entry.boxPath);
      if (res.ok) {
        success(
          t(
            'desktopProtection.registry.unprotected',
            '« {{name}} » restauré en clair — conteneur supprimé.',
            { name: entry.name }
          )
        );
        notifyRegistryChanged();
        void refresh();
      } else if (res.unavailable) {
        info(
          t(
            'settings.desktop.featureUnavailable',
            'Disponible après la prochaine mise à jour de Filarr.'
          )
        );
      } else {
        notifyError(
          res.error ||
            t(
              'desktopProtection.registry.unprotectFailed',
              'Échec de la déprotection — le conteneur est conservé.'
            )
        );
      }
    } finally {
      setBusyId(null);
    }
  }, [unprotectTarget, success, notifyError, info, refresh, t]);

  const handleForget = useCallback(
    async (entry: ProtectedRegistryEntry) => {
      setBusyId(entry.id);
      try {
        const res = await removeProtectedItem(entry.id);
        if (res.ok) {
          void refresh();
        } else if (!res.unavailable) {
          notifyError(
            res.error || t('desktopProtection.registry.forgetFailed', 'Échec du retrait.')
          );
        }
      } finally {
        setBusyId(null);
      }
    },
    [refresh, notifyError, t]
  );

  const handleLocate = useCallback(
    async (entry: ProtectedRegistryEntry) => {
      const renderer = window.electron?.ipcRenderer;
      if (!renderer) return;
      let picked: string | undefined;
      try {
        const result = (await renderer.invoke('showOpenDialog', {
          properties: ['openFile'],
          filters: [{ name: 'Conteneur Filarr', extensions: ['filarr'] }],
        })) as { canceled?: boolean; filePaths?: string[] } | undefined;
        picked = result && !result.canceled ? result.filePaths?.[0] : undefined;
      } catch {
        picked = undefined;
      }
      if (!picked) return;

      setBusyId(entry.id);
      try {
        // Le main valide le fichier choisi (magic FILARRBOX + nom des
        // métadonnées) avant de re-pointer l'entrée.
        const res = await relocateProtectedItem(entry.id, picked);
        if (res.ok) {
          success(
            t('desktopProtection.registry.relocated', '« {{name}} » retrouvé.', {
              name: entry.name,
            })
          );
          void refresh();
        } else if (res.unavailable) {
          info(
            t(
              'settings.desktop.featureUnavailable',
              'Disponible après la prochaine mise à jour de Filarr.'
            )
          );
        } else {
          notifyError(
            res.error ||
              t(
                'desktopProtection.registry.relocateFailed',
                'Ce fichier ne correspond pas au conteneur recherché.'
              )
          );
        }
      } finally {
        setBusyId(null);
      }
    },
    [refresh, success, notifyError, info, t]
  );

  // ── Nouvelles protections (sélecteurs OS) ──

  const pickAndProtect = useCallback(async (directory: boolean) => {
    const renderer = window.electron?.ipcRenderer;
    if (!renderer) return;
    try {
      const result = (await renderer.invoke('showOpenDialog', {
        properties: directory ? ['openDirectory'] : ['openFile', 'multiSelections'],
      })) as { canceled?: boolean; filePaths?: string[] } | undefined;
      const paths = result && !result.canceled ? (result.filePaths ?? []) : [];
      if (paths.length > 0) setProtectPaths(paths);
    } catch {
      // Dialogue indisponible — rien à casser.
    }
  }, []);

  return (
    <div className="protected-items">
      {/* ── En-tête + actions de protection ── */}
      <div className="protected-items__header">
        <div className="protected-items__header-text">
          <p className="protected-items__title">
            {t('desktopProtection.registry.title', 'Mes fichiers protégés (sur place)')}
          </p>
          <p className="protected-items__subtitle">
            {t(
              'desktopProtection.registry.subtitle',
              'Conteneurs .filarr chiffrés laissés dans vos dossiers Windows — un conteneur déplacé s’ouvre toujours par double-clic.'
            )}
          </p>
        </div>
        <div className="protected-items__header-actions">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ProtectInPlaceIcon size={14} />}
            onClick={() => void pickAndProtect(false)}
          >
            {t('desktopProtection.registry.protectFiles', 'Protéger des fichiers…')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<BoxFolderIcon size={14} />}
            onClick={() => void pickAndProtect(true)}
          >
            {t('desktopProtection.registry.protectFolder', 'Protéger un dossier…')}
          </Button>
        </div>
      </div>

      {/* ── Liste ── */}
      {loadState === 'unavailable' ? (
        <p className="protected-items__empty">
          {t(
            'settings.desktop.featureUnavailable',
            'Disponible après la prochaine mise à jour de Filarr.'
          )}
        </p>
      ) : loadState === 'error' ? (
        <p className="protected-items__empty protected-items__empty--error">
          {loadError ||
            t('desktopProtection.registry.loadFailed', 'Liste indisponible pour le moment.')}
        </p>
      ) : loadState === 'ready' && items.length === 0 ? (
        <p className="protected-items__empty">
          {t(
            'desktopProtection.registry.empty',
            'Aucun fichier protégé sur place pour l’instant — utilisez « Protéger des fichiers… » ci-dessus.'
          )}
        </p>
      ) : (
        <ul className="protected-items__list">
          {items.map((entry) => {
            const missing = entry.exists === false;
            const busy = busyId === entry.id;
            return (
              <li
                key={entry.id}
                className={`protected-items__row ${missing ? 'protected-items__row--missing' : ''}`}
              >
                <span className="protected-items__row-icon" aria-hidden="true">
                  {entry.kind === 1 ? <BoxFolderIcon size={17} /> : <BoxFileIcon size={17} />}
                </span>
                <span className="protected-items__row-text">
                  <span className="protected-items__row-name">{entry.name}</span>
                  <span className="protected-items__row-path" title={entry.boxPath}>
                    {missing
                      ? t(
                          'desktopProtection.registry.missing',
                          'Introuvable (déplacé ou renommé ?) — {{path}}',
                          { path: entry.boxPath }
                        )
                      : entry.boxPath}
                  </span>
                </span>
                <span className="protected-items__row-size">{formatBytes(entry.size)}</span>
                <span className="protected-items__row-actions">
                  {missing ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        leftIcon={<LocateIcon size={13} />}
                        onClick={() => void handleLocate(entry)}
                      >
                        {t('desktopProtection.registry.locate', 'Localiser…')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        leftIcon={<ForgetItemIcon size={13} />}
                        onClick={() => void handleForget(entry)}
                      >
                        {t('desktopProtection.registry.forget', 'Retirer')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        leftIcon={<OpenExternalIcon size={13} />}
                        onClick={() => handleOpen(entry)}
                      >
                        {t('desktopProtection.registry.open', 'Ouvrir')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        leftIcon={<RevealLocationIcon size={13} />}
                        onClick={() => void handleReveal(entry)}
                        title={t(
                          'desktopProtection.registry.reveal',
                          'Afficher dans l’explorateur'
                        )}
                        aria-label={t(
                          'desktopProtection.registry.reveal',
                          'Afficher dans l’explorateur'
                        )}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        leftIcon={<VaultUnlockIcon size={13} />}
                        onClick={() => setUnprotectTarget(entry)}
                        title={t('desktopProtection.registry.unprotect', 'Déprotéger')}
                        aria-label={t('desktopProtection.registry.unprotect', 'Déprotéger')}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        leftIcon={<ForgetItemIcon size={13} />}
                        onClick={() => void handleForget(entry)}
                        title={t('desktopProtection.registry.forgetTitle', 'Retirer de la liste')}
                        aria-label={t(
                          'desktopProtection.registry.forgetTitle',
                          'Retirer de la liste'
                        )}
                      />
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Confirmation de déprotection ── */}
      <ConfirmModal
        isOpen={unprotectTarget !== null}
        onClose={() => setUnprotectTarget(null)}
        onConfirm={() => void handleUnprotect()}
        variant="warning"
        title={t('desktopProtection.registry.unprotectTitle', 'Déprotéger « {{name}} » ?', {
          name: unprotectTarget?.name ?? '',
        })}
        message={t(
          'desktopProtection.registry.unprotectMessage',
          'Le contenu sera restauré EN CLAIR à côté du conteneur, vérifié, puis le conteneur .filarr sera supprimé. Le fichier restauré ne sera plus protégé.'
        )}
        confirmText={t('desktopProtection.registry.unprotectConfirm', 'Déprotéger')}
        cancelText={t('common.cancel', 'Annuler')}
      />

      {/* ── Dialogue de protection (sélections des boutons ci-dessus) ── */}
      <ProtectInPlaceDialog
        isOpen={protectPaths !== null}
        paths={protectPaths ?? []}
        onClose={() => setProtectPaths(null)}
        onDone={() => void refresh()}
      />
    </div>
  );
};

export default ProtectedItemsSection;
