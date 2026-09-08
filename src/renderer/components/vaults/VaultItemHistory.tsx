/**
 * VaultItemHistory — l'historique qu'on payait sans pouvoir le lire.
 *
 * Le serveur conserve les trois dernières versions de chaque élément de coffre,
 * les compte dans le quota mutualisé de l'espace, et expose depuis toujours deux
 * routes pour les lister et les télécharger. AUCUN client ne les appelait. Un
 * mauvais enregistrement était donc irrécupérable — alors que le modèle de
 * permissions d'un coffre partagé, où un membre peut écraser le travail d'un
 * autre, ne tient que si l'on peut revenir en arrière. Les octets étaient là,
 * facturés, et hors d'atteinte ; ils étaient purgés en silence au quatrième
 * enregistrement.
 *
 * RESTAURER ÉCRIT UNE NOUVELLE VERSION. Le contenu d'autrefois repart par le
 * chemin de mise à jour ordinaire : quota, compare-and-set de version, et
 * re-chiffrement sous l'époque courante. Rien n'est effacé — l'état qu'on quitte
 * devient à son tour une révision, et une restauration malheureuse se défait
 * comme n'importe quel enregistrement.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { Button, ConfirmModal, Modal, ModalBody, ModalFooter, ModalHeader } from '../ui';
import { useNotification } from '../ui/Notification';
import {
  downloadVaultRevisionContent,
  listVaultItemRevisions,
  restoreVaultItemRevision,
  type VaultRevisionSummary,
} from '../../../store/slices/vaultsSlice';
import { groupRevisionsBySession } from './vaultRevisionSessions';
import { vaultErrorKey, errorText } from '../../../services/vault/vaultErrorMessages';

/** Même formatage que le navigateur d'éléments — l'unité est la seule chose à dire. */
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  vaultId: string;
  itemId: string;
  /** La version courante — le garde d'écriture que la restauration doit présenter. */
  currentVersion: number;
  /** Un lecteur consulte l'historique mais ne restaure pas. */
  canEdit: boolean;
  /** Rappelé après une restauration réussie, pour que l'appelant se recharge. */
  onRestored?: () => void;
}

type State = 'loading' | 'ready' | 'error';

export const VaultItemHistory: React.FC<Props> = ({
  isOpen,
  onClose,
  vaultId,
  itemId,
  currentVersion,
  canEdit,
  onRestored,
}) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();

  const [state, setState] = useState<State>('loading');
  const [revisions, setRevisions] = useState<VaultRevisionSummary[]>([]);
  const [toRestore, setToRestore] = useState<VaultRevisionSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setRevisions(await listVaultItemRevisions(vaultId, itemId));
      setState('ready');
    } catch {
      // Une liste illisible n'est PAS une liste vide : le dire, plutôt que
      // d'afficher « aucune version » sur une panne de lecture.
      setState('error');
    }
  }, [vaultId, itemId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  /** Lire le passé SANS réécrire le présent. */
  const downloadRevision = async (r: (typeof revisions)[number]) => {
    setBusy(true);
    try {
      const bytes = await downloadVaultRevisionContent(vaultId, itemId, r);
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.meta.fileName || r.meta.title || `version-${r.itemVersion}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.history.downloadFailed')));
    } finally {
      setBusy(false);
    }
  };

  const confirmRestore = async () => {
    const target = toRestore;
    setToRestore(null);
    if (!target) return;
    setBusy(true);
    try {
      await dispatch(
        restoreVaultItemRevision({
          vaultId,
          itemId,
          expectedVersion: currentVersion,
          revision: target,
        })
      ).unwrap();
      success(t('teamVaults.history.restored'));
      onRestored?.();
      onClose();
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.history.restoreFailed')));
      /**
       * RELIRE APRÈS UN ÉCHEC, et pas seulement après un succès.
       *
       * Le refus le plus courant est un conflit de version : quelqu'un d'autre a
       * écrit pendant qu'on regardait. La liste des révisions affichée date donc
       * d'avant cette écriture, et l'écriture concurrente vient elle-même d'y
       * ajouter une entrée. Sans relecture, la personne réessaie sur une liste
       * périmée en ignorant tout de ce qui l'a bloquée.
       *
       * `onRestored` rafraîchit la liste du parent, d'où sort `currentVersion` :
       * la tentative suivante repart donc de la version réelle. Le nom dit
       * « restauré », mais ce qu'il fait est « la liste a bougé, relisez » — et
       * c'est vrai dans les deux cas.
       */
      onRestored?.();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const when = (ms: number): string => {
    // Le serveur date en millisecondes epoch. On garde un repli lisible plutôt
    // qu'une date de 1970 si jamais la valeur manque.
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="md">
        <ModalHeader onClose={onClose} closeLabel={t('common.close')}>
          {t('teamVaults.history.title')}
        </ModalHeader>
        <ModalBody>
          {state === 'loading' && (
            <p className="text-sm text-[var(--color-text-secondary)] m-0">{t('common.loading')}</p>
          )}

          {state === 'error' && (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-sm text-[var(--color-text-primary)] m-0">
                {t('teamVaults.history.loadError')}
              </p>
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                {t('teamVaults.retry')}
              </Button>
            </div>
          )}

          {state === 'ready' && revisions.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)] m-0">
              {t('teamVaults.history.empty')}
            </p>
          )}

          {state === 'ready' && revisions.length > 0 && (
            <>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0 mb-3">
                {t('teamVaults.history.hint')}
              </p>
              <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
                {groupRevisionsBySession(revisions).map((group) => (
                  <li key={group.key} className="flex flex-col gap-1">
                    {group.sessionId !== null && (
                      <div className="px-1">
                        <p className="text-xs font-semibold text-[var(--color-text-secondary)] m-0">
                          {t('teamVaults.history.sessionHeader', { when: when(group.newestAt) })}
                          <span className="ml-1.5 font-normal text-[var(--color-text-tertiary)]">
                            {t('teamVaults.history.sessionCount', {
                              count: group.revisions.length,
                            })}
                          </span>
                        </p>
                        {group.participants.length > 0 && (
                          <p className="text-[11px] text-[var(--color-text-tertiary)] m-0">
                            {t('teamVaults.history.sessionWith', {
                              names: group.participants.join(', '),
                            })}
                          </p>
                        )}
                      </div>
                    )}
                    <ul
                      className={`list-none m-0 p-0 flex flex-col gap-1.5 ${
                        group.sessionId !== null
                          ? 'pl-2 border-l-2 border-[var(--color-border-light)]'
                          : ''
                      }`}
                    >
                      {group.revisions.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[var(--color-border-light)]"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-[var(--color-text-primary)] m-0 truncate">
                              {r.readable
                                ? r.meta.title || r.meta.fileName || t('teamVaults.items.untitled')
                                : t('teamVaults.history.unreadable')}
                            </p>
                            <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                              {t('teamVaults.history.versionLine', { version: r.itemVersion })} ·{' '}
                              {when(r.createdAt)} · {formatBytes(r.sizeBytes)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* La fonction de téléchargement d'une révision existait,
                          écrite et testée — aucun bouton ne l'appelait : on
                          payait la conservation d'un historique qu'on ne
                          pouvait consulter qu'en le RESTAURANT, c'est-à-dire en
                          écrivant par-dessus le présent pour lire le passé. */}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy || !r.readable}
                              onClick={() => void downloadRevision(r)}
                            >
                              {t('teamVaults.history.download')}
                            </Button>
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy || !r.readable}
                                onClick={() => setToRestore(r)}
                              >
                                {t('teamVaults.history.restore')}
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmModal
        isOpen={!!toRestore}
        onClose={() => setToRestore(null)}
        onConfirm={confirmRestore}
        title={t('teamVaults.history.restoreTitle')}
        message={t('teamVaults.history.restoreConfirm')}
        confirmText={t('teamVaults.history.restore')}
      />
    </>
  );
};

export default VaultItemHistory;
