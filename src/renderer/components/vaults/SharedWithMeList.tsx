/**
 * SharedWithMeList — les lignes de « Partagé avec moi », sans page autour.
 *
 * Extraite de `SharedWithMeView` (lot A, C5) parce que ces lignes vivent
 * désormais dans le bandeau de l'accueil (`VaultInboxBanner`) : l'ancienne
 * page n'est plus qu'une coque, et une coque ne devait pas emporter avec elle
 * l'aperçu, le téléchargement et l'état de repli.
 *
 * Ce que la liste peut montrer : le titre (méta sous le K_item qui m'est
 * scellé), la taille, « partagé par » (résolu par le serveur), l'expiration.
 * Ce qu'elle ne peut PAS montrer, par construction : le nom du coffre —
 * chiffré sous une K_vault que je n'ai pas.
 *
 * `needsRewrap` : le wrap est en retard sur la version réelle (édition entre
 * ma lecture et le rescellement) — « en attente de rescellement », jamais des
 * octets indéchiffrables ni une erreur brute.
 *
 * LA PAIRE DE CLÉS. Ouvrir ou télécharger déballe K_item avec ma clé privée ;
 * après un déverrouillage par PIN elle n'est pas en mémoire, et la liste a pu
 * être LUE sans elle (état 'locked' : le serveur donne le compte, pas le
 * contenu). Dans les deux cas on passe par le gate EN FENÊTRE
 * (`VaultKeypairGateModal`) et on reprend le geste interrompu — jamais un
 * bouton qui échoue en silence. L'état 'locked' se dit sur UNE ligne discrète
 * (« N éléments attendent — déverrouillez »), pas dans un bloc d'alerte : rien
 * n'a échoué, quelque chose attend.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button } from '../ui';
import { Skeleton } from '../ui/Skeleton/Skeleton';
import { useNotification } from '../ui/Notification';
import type { AppDispatch, RootState } from '../../../store';
import {
  fetchSharedWithMe,
  downloadSharedItemContent,
  type SharedItemSummary,
} from '../../../store/slices/sharedWithMeSlice';
import { hasUserKeypair } from '../../../services/auth/userKeypair';
import { BufferPreview } from '../preview/BufferPreview';
import { Modal, ModalHeader, ModalBody } from '../ui/Modal/Modal';
import { vaultErrorKey } from '../../../services/vault/vaultErrorMessages';
import { VaultKeypairGateModal } from './VaultKeypairGate';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Le geste mis en attente derrière le gate, repris dès que la clé est là. */
type AfterGate =
  | { kind: 'refetch' }
  | { kind: 'open'; entry: SharedItemSummary }
  | { kind: 'download'; entry: SharedItemSummary };

interface Props {
  /**
   * Au-delà de N lignes, la liste se replie et un « voir tout » la déplie SUR
   * PLACE (le bandeau de l'accueil passe 3). Sans valeur : tout est montré.
   */
  collapseAfter?: number;
  /** Rendu quand la liste est prête et vide. Le bandeau ne passe rien : `null`. */
  emptyState?: React.ReactNode;
}

export const SharedWithMeList: React.FC<Props> = ({ collapseAfter, emptyState = null }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { error } = useNotification();
  const {
    entries,
    status,
    error: loadError,
    lockedCount,
  } = useSelector((s: RootState) => s.sharedWithMe);
  const [preview, setPreview] = useState<{
    entry: SharedItemSummary;
    data: ArrayBuffer | null;
    failed: boolean;
  } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [afterGate, setAfterGate] = useState<AfterGate | null>(null);

  const entryName = (e: SharedItemSummary): string =>
    e.meta.fileName || e.meta.title || t('teamVaults.items.untitled');

  // Des fonctions NUES, pas de `useCallback` : rien en dessous n'est mémoïsé,
  // et un chaînage de rappels mémoïsés qui se référencent l'un l'autre n'aurait
  // servi qu'à tromper le linter sur ses dépendances.
  const open = async (entry: SharedItemSummary) => {
    setPreview({ entry, data: null, failed: false });
    try {
      const bytes = await downloadSharedItemContent(entry);
      const copie = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copie).set(bytes);
      setPreview((p) => (p && p.entry.grantId === entry.grantId ? { ...p, data: copie } : p));
    } catch {
      setPreview((p) => (p && p.entry.grantId === entry.grantId ? { ...p, failed: true } : p));
    }
  };

  const download = async (entry: SharedItemSummary) => {
    setDownloadingId(entry.grantId);
    try {
      const bytes = await downloadSharedItemContent(entry);
      const possede = new Uint8Array(new ArrayBuffer(bytes.byteLength));
      possede.set(bytes);
      const blob = new Blob([possede], {
        type: entry.meta.mime || 'application/octet-stream',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entryName(entry);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      error(t(vaultErrorKey((e as Error)?.message, 'teamVaults.errors.download')));
    } finally {
      setDownloadingId(null);
    }
  };

  const run = async (action: AfterGate) => {
    if (action.kind === 'refetch') void dispatch(fetchSharedWithMe());
    else if (action.kind === 'open') await open(action.entry);
    else await download(action.entry);
  };

  /**
   * Le gate ne s'ouvre QUE si la clé manque (`hasUserKeypair`) : le cas
   * courant — clé déjà là — part directement, sans fenêtre.
   */
  const withKeypair = (action: AfterGate) => {
    if (hasUserKeypair()) {
      void run(action);
      return;
    }
    setAfterGate(action);
  };

  const handleGateReady = () => {
    const action = afterGate;
    setAfterGate(null);
    if (action) void run(action);
  };

  const gate = (
    <VaultKeypairGateModal
      isOpen={afterGate !== null}
      onClose={() => setAfterGate(null)}
      onReady={handleGateReady}
    />
  );

  // Une relecture qui a déjà des lignes les garde à l'écran : le squelette n'est
  // que pour le premier chargement, pas un clignotement à chaque rafraîchissement.
  if ((status === 'loading' || status === 'idle') && entries.length === 0) {
    return <Skeleton height="2.25rem" borderRadius="0.5rem" />;
  }

  if (status === 'locked') {
    // Rien n'a échoué : N enveloppes attendent la clé. Une ligne, un statut (pas
    // une alerte), un bouton-lien qui ouvre la porte puis relit.
    return (
      <div
        role="status"
        className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-4 h-4 shrink-0 text-[var(--color-text-tertiary)]"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z"
          />
        </svg>
        <span className="flex-1 min-w-0 truncate">
          {t('sharedWithMe.lockedCount', {
            count: lockedCount,
            defaultValue_one: '{{count}} item shared with you — unlock to read it',
            defaultValue_other: '{{count}} items shared with you — unlock to read them',
          })}
        </span>
        <Button size="sm" variant="ghost" onClick={() => withKeypair({ kind: 'refetch' })}>
          {t('teamVaults.unlock.submit')}
        </Button>
        {gate}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-[var(--color-text-secondary)] m-0">
          {t(vaultErrorKey(loadError, 'sharedWithMe.loadFailed'))}
        </p>
        {/* `withKeypair` : si la clé manque encore, la porte s'ouvre avant la relecture. */}
        <Button size="sm" variant="secondary" onClick={() => withKeypair({ kind: 'refetch' })}>
          {t('teamVaults.retry')}
        </Button>
        {gate}
      </div>
    );
  }

  if (entries.length === 0) return <>{emptyState}</>;

  const collapsed =
    typeof collapseAfter === 'number' && !expanded && entries.length > collapseAfter;
  const visible = collapsed ? entries.slice(0, collapseAfter) : entries;

  return (
    <div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1">
        {visible.map((entry) => (
          <li
            key={entry.grantId}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--color-hover-overlay)] border border-[var(--color-border-light)]"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--color-text-primary)] truncate m-0">
                {entryName(entry)}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                {formatBytes(entry.sizeBytes)}
                {entry.grantedByEmail
                  ? ` · ${t('sharedWithMe.sharedBy', { email: entry.grantedByEmail })}`
                  : ''}
                {entry.expiresAt
                  ? ` · ${t('sharedWithMe.expiresOn', {
                      date: new Date(entry.expiresAt).toLocaleDateString(),
                    })}`
                  : ''}
              </p>
            </div>
            {entry.needsRewrap ? (
              // Le wrap est en retard — le dire, pas offrir un bouton mort.
              <span className="text-xs text-[var(--color-warning-700)] shrink-0">
                {t('sharedWithMe.staleBadge')}
              </span>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => withKeypair({ kind: 'open', entry })}
                >
                  {t('teamVaults.preview.open')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={downloadingId === entry.grantId}
                  onClick={() => withKeypair({ kind: 'download', entry })}
                >
                  {t('sharedWithMe.download')}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>

      {collapsed && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          {t('sharedWithMe.seeAll', {
            count: entries.length,
            defaultValue: 'Voir tout ({{count}})',
          })}
        </Button>
      )}

      {preview && (
        <Modal isOpen onClose={() => setPreview(null)} size="xl">
          <ModalHeader onClose={() => setPreview(null)}>{entryName(preview.entry)}</ModalHeader>
          <ModalBody>
            <div className="h-[70vh] min-h-[320px]">
              {preview.failed ? (
                <p className="text-sm text-[var(--color-error-600,#dc2626)] m-0">
                  {t('teamVaults.preview.failed')}
                </p>
              ) : preview.data === null ? (
                <p className="text-sm text-[var(--color-text-secondary)] m-0">
                  {t('common.loading')}
                </p>
              ) : (
                <BufferPreview data={preview.data} fileName={entryName(preview.entry)} />
              )}
            </div>
          </ModalBody>
        </Modal>
      )}

      {gate}
    </div>
  );
};

export default SharedWithMeList;
