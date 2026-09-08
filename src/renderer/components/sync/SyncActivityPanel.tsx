/**
 * SyncActivityPanel — ce que la sync vient de faire, en clair
 *
 * Popover ancré sous l'icône de sync du Header. Tout ce qu'il montre existait
 * déjà sur le disque (manifeste local + file de retry) et n'était lu par
 * personne : le badge disait « il y a un problème » sans jamais dire lequel.
 *
 * État LOCAL uniquement — pas de slice Redux : ces listes ne servent qu'ici,
 * elles sont relues à l'ouverture et à chaque `sync-status-changed`, et rien
 * d'autre dans l'application n'a à en dépendre.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RootState } from '../../../store';
import { getOverlayBounds, clampToBounds } from '../../utils/overlayBounds';
import {
  describeSyncItem,
  describeSyncItemContext,
  type DescribableSyncItem,
} from './syncActivityLabels';

// ── Types (miroir de main.ts, canal 'sync:getActivity') ─────────────────────

export interface SyncActivityItem {
  fileId: string;
  name: string;
  localPath?: string;
  size: number;
  status: string;
  updatedAt: string;
  syncedAt: string | null;
  lastDirection?: 'up' | 'down';
  /**
   * Le côté DISTANT, posé par `sync:getActivity` sur les conflits seulement.
   *
   * `null` = le manifeste distant n'a pas pu être lu (réseau, clé). On affiche
   * alors « inconnue » plutôt que d'inventer : une comparaison fausse est pire
   * qu'une comparaison absente, parce qu'elle sera crue.
   */
  remoteSize?: number | null;
  remoteUpdatedAt?: string | null;
}

export interface SyncFailedItem {
  id: string;
  fileId: string;
  name: string;
  localPath?: string;
  resourceType: string;
  direction: 'upload' | 'download' | 'delete';
  attempts: number;
  maxAttempts: number;
  error: string;
  lastAttempt: string | null;
  exhausted: boolean;
}

interface SyncActivityData {
  recent: SyncActivityItem[];
  pending: SyncActivityItem[];
  conflicts: SyncActivityItem[];
  failed: SyncFailedItem[];
}

const EMPTY: SyncActivityData = { recent: [], pending: [], conflicts: [], failed: [] };

type TabId = 'recent' | 'pending' | 'issues';

interface SyncActivityPanelProps {
  /** Bouton déclencheur — sert d'ancre de position et de zone « pas dehors ». */
  anchorEl: HTMLElement | null;
  profileId: string | null;
  onClose: () => void;
  /** Cycle manuel demandé depuis le panneau (l'icône garde le retour utilisateur). */
  onSyncNow: () => void;
  /** Un clic déjà parti, ou un cycle en cours. */
  busy: boolean;
  paused: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const PANEL_WIDTH = 380;

/**
 * Horodatage relatif traduit. Partagé avec SyncStatusIcon (sa bulle affiche la
 * date du dernier cycle) pour que les deux disent l'ancienneté dans les mêmes
 * mots — c'était la même logique écrite deux fois, en français codé en dur.
 */
export function relativeTime(iso: string | null, t: TFunction): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return t('sync.activity.time.now');
  if (minutes < 60) return t('sync.activity.time.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('sync.activity.time.hours', { count: hours });
  return t('sync.activity.time.days', { count: Math.floor(hours / 24) });
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1))} ${units[i]}`;
}

// ── Component ───────────────────────────────────────────────────────────────

const SyncActivityPanel: React.FC<SyncActivityPanelProps> = ({
  anchorEl,
  profileId,
  onClose,
  onSyncNow,
  busy,
  paused,
}) => {
  const { t } = useTranslation();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [tab, setTab] = React.useState<TabId>('recent');
  const [data, setData] = React.useState<SyncActivityData>(EMPTY);
  const [loading, setLoading] = React.useState(true);
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null);

  const ago = React.useCallback((iso: string | null) => relativeTime(iso, t), [t]);

  // Identifiant de dossier → nom. Le rendu les a déjà en mémoire : traduire
  // `<folderId>/metadata.json` en « Dossier "Photos" » ne coûte donc aucun
  // aller-retour vers le processus principal, et un dossier absent de la carte
  // se dégrade proprement (voir `describeSyncItem`).
  const foldersById = useSelector((s: RootState) => s.folders?.byId);
  const folderNames = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const [id, folder] of Object.entries(foldersById ?? {})) {
      if (folder?.name) map[id] = folder.name;
    }
    return map;
  }, [foldersById]);

  const describe = React.useCallback(
    (entry: DescribableSyncItem) => describeSyncItem(entry, folderNames, t),
    [folderNames, t]
  );

  // Position : ancrée sous le bouton, alignée à droite, ramenée dans l'écran.
  //
  // Ramenée dans les DEUX axes. Le bornage horizontal existait seul ; en
  // disposition « rail » le bouton de synchro est épinglé en bas de la colonne
  // de gauche, et le panneau, ouvert vers le bas, sortait par le bas de la
  // fenêtre — ses onglets et sa liste devenaient inatteignables. On l'ouvre
  // au-dessus du bouton quand le dessous ne tient pas, et on borne dans tous
  // les cas (fenêtre plus courte que le panneau).
  const updatePosition = React.useCallback(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const height = panelRef.current?.offsetHeight ?? 0;
    // PAS les bornes de la fenêtre : en rail, une colonne fixe de 56 px mange
    // le bord gauche et se peint AU-DESSUS du panneau (z 1041 contre 1000). Le
    // panneau, ramené « dans l'écran » à 8 px, se glissait dessous et perdait
    // sa marge gauche — titre, onglets et noms de fichiers tronqués.
    const bounds = getOverlayBounds();

    const left = clampToBounds(rect.right - PANEL_WIDTH, bounds.left, bounds.right - PANEL_WIDTH);

    const below = rect.bottom + 6;
    const above = rect.top - 6 - height;
    const fitsBelow = below + height <= bounds.bottom;
    const top = clampToBounds(
      fitsBelow || above < bounds.top ? below : above,
      bounds.top,
      bounds.bottom - height
    );

    setPosition({ top, left });
  }, [anchorEl]);

  // La hauteur du panneau n'est connue qu'une fois monté, et elle CHANGE quand
  // on passe d'un onglet à l'autre (récents / en attente / échecs n'ont pas le
  // même nombre de lignes). Un observateur de taille replace donc le panneau à
  // chaque fois, avant peinture — et non seulement à l'ouverture.
  React.useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      updatePosition();
      return undefined;
    }
    const observer = new ResizeObserver(() => updatePosition());
    observer.observe(el);
    return () => observer.disconnect();
  }, [updatePosition]);

  React.useEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition]);

  // Chargement à l'ouverture + à chaque changement d'état de la sync : c'est
  // l'événement que le moteur émet déjà à chaque début et fin de cycle.
  // Hissee hors de l'effet : « Ecarter » doit pouvoir la rappeler. Contrairement
  // a « Reessayer », qui declenche un cycle et donc un `sync-status-changed`,
  // ecarter ne produit aucun evenement — sans rappel explicite, la ligne
  // resterait affichee jusqu'a la prochaine ouverture du panneau.
  const refresh = React.useCallback(() => {
    window.electron?.ipcRenderer
      ?.invoke('sync:getActivity', profileId || '')
      .then((result: SyncActivityData | null) => {
        setData(result ?? EMPTY);
        setLoading(false);
      })
      .catch(() => {
        setData(EMPTY);
        setLoading(false);
      });
  }, [profileId]);

  React.useEffect(() => {
    refresh();
    const ipc = window.electron?.ipcRenderer;
    ipc?.on('sync-status-changed', refresh);
    return () => {
      ipc?.removeListener('sync-status-changed', refresh);
    };
  }, [refresh]);

  /**
   * REESSAYER / ECARTER un echec epuise.
   *
   * L'element garde son propre etat « en cours » : deux echecs peuvent etre
   * traites l'un apres l'autre sans que le panneau entier se fige, et un
   * double-clic ne part pas deux fois.
   *
   * Le main REFUSE d'agir sur un element non epuise (il rend `not_exhausted`).
   * On ne duplique pas cette regle ici — le bouton n'est de toute facon rendu
   * que sur une ligne epuisee, et deux exemplaires de la meme regle finissent
   * toujours par diverger. L'autorite est cote main, qui tient la file.
   */
  const [actionEnCours, setActionEnCours] = React.useState<string | null>(null);

  const agirSurEchec = React.useCallback(
    (itemId: string, canal: 'sync:retryFailed' | 'sync:dismissFailed') => {
      setActionEnCours(itemId);
      void window.electron?.ipcRenderer
        ?.invoke(canal, itemId)
        .catch(() => {
          // Un refus laisse la ligne en place : c'est le comportement honnete.
          // Le panneau se rafraichit juste apres et montrera l'etat reel.
        })
        .finally(() => {
          setActionEnCours(null);
          refresh();
        });
    },
    [refresh]
  );

  // Escape + clic dehors. Le bouton déclencheur est exclu : sinon son propre
  // clic fermerait puis rouvrirait le panneau dans la foulée.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [anchorEl, onClose]);

  // Le panneau prend le focus à l'ouverture : Escape doit marcher sans clic
  // préalable, et le lecteur d'écran doit annoncer ce qui vient de s'ouvrir.
  React.useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const issuesCount = data.failed.length + data.conflicts.length;
  const counts: Record<TabId, number> = {
    recent: data.recent.length,
    pending: data.pending.length,
    issues: issuesCount,
  };

  const renderDirection = (direction?: 'up' | 'down') => {
    if (!direction) return null;
    const label =
      direction === 'up' ? t('sync.activity.direction.up') : t('sync.activity.direction.down');
    return (
      <span
        className="text-xs font-semibold"
        style={{ color: direction === 'up' ? '#10b981' : 'var(--color-primary-500)' }}
        title={label}
        aria-label={label}
      >
        {direction === 'up' ? '↑' : '↓'}
      </span>
    );
  };

  /**
   * Sens à afficher. `lastDirection` ne parle que des transferts ABOUTIS ; pour
   * ce qui attend encore, le statut le dit déjà (pending_upload/download).
   */
  const rowDirection = (item: SyncActivityItem): 'up' | 'down' | undefined => {
    if (item.lastDirection) return item.lastDirection;
    if (item.status === 'pending_upload') return 'up';
    if (item.status === 'pending_download') return 'down';
    return undefined;
  };

  /**
   * Bulle d'aide : le libellé humain PUIS le chemin réel. Le chemin reste — il
   * est ce qu'on cherche quand on veut retrouver l'objet sur le disque — mais
   * il n'est plus la seule chose que la ligne sache dire.
   */
  const rowTitle = (item: DescribableSyncItem, text: string) =>
    item.localPath && item.localPath !== text ? `${text} — ${item.localPath}` : text;

  /**
   * ARBITRER UN CONFLIT — le geste qui manquait.
   *
   * Le panneau LISTAIT les conflits sans offrir de les résoudre. La pastille
   * orange restait donc allumée indéfiniment, et le fichier restait GELÉ : le
   * fusionneur saute les entrées en conflit, elles ne se synchronisaient plus
   * du tout. Signalé le 2026-09-08 après une nuit qui en avait fabriqué vingt.
   *
   * Le canal `sync:resolveConflict` existait déjà et faisait le travail des
   * deux côtés (télécharger le distant, ou garder le local et le republier).
   * Seuls les deux boutons manquaient.
   *
   * LA COPIE N'EST JAMAIS EFFACÉE. « Garder celle du nuage » écrase le fichier
   * local, et c'est précisément là que la copie `_conflict_…` cesse d'être un
   * doublon pour devenir la seule trace de la version qu'on abandonne.
   */
  const [arbitrage, setArbitrage] = React.useState<string | null>(null);

  const resoudre = async (fileId: string, keep: 'local' | 'remote'): Promise<void> => {
    setArbitrage(fileId);
    try {
      await window.electron.ipcRenderer.invoke('sync:resolveConflict', profileId, fileId, keep);
      refresh();
    } finally {
      setArbitrage(null);
    }
  };

  const renderRow = (item: SyncActivityItem, timestamp: string | null) => {
    const text = describe(item);
    const context = describeSyncItemContext(item, folderNames);
    return (
      <li
        key={item.fileId}
        className="px-3 py-2 border-b last:border-b-0"
        style={{ borderColor: 'var(--color-border-subtle, var(--color-border))' }}
      >
        <div className="flex items-center gap-2">
          {renderDirection(rowDirection(item))}
          <span
            className="flex-1 min-w-0 truncate text-sm text-[var(--color-text-primary)]"
            title={rowTitle(item, text)}
          >
            {text}
          </span>
          {item.size > 0 && (
            <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
              {formatSize(item.size)}
            </span>
          )}
          <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
            {ago(timestamp)}
          </span>
        </div>
        {/* Le dossier porteur, seulement quand il en existe un : deux fichiers
            de même nom dans deux dossiers étaient jusqu'ici indiscernables. */}
        {context && (
          <p className="mt-0.5 pl-5 truncate text-xs text-[var(--color-text-tertiary)]">
            {context}
          </p>
        )}
        {/* Les deux issues, et seulement pour un conflit. Nommées par ce qu'elles
            GARDENT, pas par « résoudre » — on ne clique pas sur un verbe dont on
            ne sait pas ce qu'il choisit. */}
        {item.status === 'conflict' && (
          <>
            {/*
              LE COMPARATIF. On ne peut pas montrer le CONTENU — le manifeste
              distant est chiffré de bout en bout et l'objet ne se télécharge
              pas pour un survol. Taille et date suffisent à trancher la
              plupart des cas, et c'est tout ce qu'on peut dire honnêtement.
            */}
            <div className="mt-1.5 pl-5 grid grid-cols-2 gap-2 text-xs">
              <div
                className="rounded px-2 py-1"
                style={{ backgroundColor: 'var(--color-background-secondary)' }}
              >
                <p className="font-medium text-[var(--color-text-primary)]">
                  {t('sync.activity.mine', 'Ma version')}
                </p>
                <p className="text-[var(--color-text-tertiary)]">
                  {formatSize(item.size)} · {ago(item.updatedAt)}
                </p>
              </div>
              <div
                className="rounded px-2 py-1"
                style={{ backgroundColor: 'var(--color-background-secondary)' }}
              >
                <p className="font-medium text-[var(--color-text-primary)]">
                  {t('sync.activity.theirs', 'Celle du nuage')}
                </p>
                <p className="text-[var(--color-text-tertiary)]">
                  {item.remoteSize == null
                    ? t('sync.activity.unknownSide', 'inconnue')
                    : `${formatSize(item.remoteSize)} · ${ago(item.remoteUpdatedAt ?? null)}`}
                </p>
              </div>
            </div>
            {/* Tailles ÉGALES : le cas le plus fréquent après une divergence de
                synchro, et celui où l'utilisateur hésite le plus longtemps
                pour rien. On le lui dit. */}
            {item.remoteSize != null && item.remoteSize === item.size && (
              <p className="mt-1 pl-5 text-xs text-[var(--color-text-tertiary)]">
                {t(
                  'sync.activity.sameSize',
                  'Même taille des deux côtés — le contenu est probablement identique.'
                )}
              </p>
            )}
            <div className="mt-1.5 pl-5 flex items-center gap-2">
              <button
                type="button"
                disabled={arbitrage !== null}
                onClick={() => void resoudre(item.fileId, 'local')}
                className="text-xs px-2 py-1 rounded disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {t('sync.activity.keepLocal', 'Garder ma version')}
              </button>
              <button
                type="button"
                disabled={arbitrage !== null}
                onClick={() => void resoudre(item.fileId, 'remote')}
                className="text-xs px-2 py-1 rounded disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {t('sync.activity.keepRemote', 'Garder celle du nuage')}
              </button>
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {t('sync.activity.copyKept', 'Une copie de l’autre version reste sur le disque.')}
              </span>
            </div>
          </>
        )}
      </li>
    );
  };

  const renderEmpty = (message: string) => (
    <p className="px-3 py-8 text-center text-sm text-[var(--color-text-tertiary)]">{message}</p>
  );

  const renderTabPanel = () => {
    if (loading) return renderEmpty(t('sync.activity.loading'));

    if (tab === 'recent') {
      return data.recent.length ? (
        <ul>{data.recent.map((item) => renderRow(item, item.syncedAt))}</ul>
      ) : (
        renderEmpty(t('sync.activity.empty.recent'))
      );
    }

    if (tab === 'pending') {
      return data.pending.length ? (
        <ul>{data.pending.map((item) => renderRow(item, item.updatedAt))}</ul>
      ) : (
        renderEmpty(t('sync.activity.empty.pending'))
      );
    }

    if (!issuesCount) return renderEmpty(t('sync.activity.empty.issues'));

    return (
      <>
        {data.conflicts.length > 0 && (
          <>
            <h4 className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
              {t('sync.activity.conflictsHeading')}
            </h4>
            <ul>{data.conflicts.map((item) => renderRow(item, item.updatedAt))}</ul>
          </>
        )}
        {data.failed.length > 0 && (
          <>
            <h4 className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
              {t('sync.activity.failuresHeading')}
            </h4>
            <ul>
              {data.failed.map((item) => (
                <li
                  key={item.id}
                  className="px-3 py-2 border-b last:border-b-0"
                  style={{ borderColor: 'var(--color-border-subtle, var(--color-border))' }}
                >
                  <div className="flex items-center gap-2">
                    {renderDirection(item.direction === 'download' ? 'down' : 'up')}
                    <span
                      className="flex-1 min-w-0 truncate text-sm text-[var(--color-text-primary)]"
                      title={rowTitle(item, describe(item))}
                    >
                      {describe(item)}
                    </span>
                    <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
                      {ago(item.lastAttempt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs" style={{ color: '#ef4444' }}>
                    {item.error}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {item.exhausted
                        ? t('sync.activity.exhausted', { count: item.attempts })
                        : t('sync.activity.attempts', {
                            attempts: item.attempts,
                            max: item.maxAttempts,
                          })}
                    </p>
                    {/*
                      LA PRISE QUI MANQUAIT. « Abandonne apres 3 tentatives »
                      etait un cul-de-sac : plus aucun essai prevu, et aucun
                      moyen d'en redemander un. La seule sortie etait de vivre
                      avec un badge rouge permanent, ce qui apprend surtout a
                      ignorer l'indicateur.

                      Seulement sur une ligne EPUISEE : tant qu'un essai reste
                      programme, il n'y a rien a demander, et proposer d'ecarter
                      un travail encore en cours serait une perte de donnees
                      deguisee en menage.
                    */}
                    {item.exhausted && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => agirSurEchec(item.id, 'sync:retryFailed')}
                          disabled={actionEnCours === item.id}
                          className={`px-2 py-0.5 text-xs rounded-md transition-colors
                            hover:bg-[var(--color-hover-overlay)] ${
                              actionEnCours === item.id ? 'opacity-60 cursor-default' : ''
                            }`}
                          style={{ color: 'var(--color-primary-500)' }}
                        >
                          {t('sync.activity.retry')}
                        </button>
                        <button
                          onClick={() => agirSurEchec(item.id, 'sync:dismissFailed')}
                          disabled={actionEnCours === item.id}
                          className={`px-2 py-0.5 text-xs rounded-md transition-colors
                            hover:bg-[var(--color-hover-overlay)] ${
                              actionEnCours === item.id ? 'opacity-60 cursor-default' : ''
                            }`}
                          style={{ color: 'var(--color-text-tertiary)' }}
                        >
                          {t('sync.activity.dismiss')}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  };

  // Le panneau est monté AVANT d'être placé : c'est sa présence dans le
  // document qui donne sa hauteur, et donc la place qu'il faut lui trouver. Il
  // est transparent le temps de cette première mesure — et transparent, pas
  // `visibility: hidden` : un élément caché ne prend pas le focus, et le
  // panneau se donne le focus au montage pour qu'Échap marche sans clic.
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('sync.activity.title')}
      tabIndex={-1}
      className="fixed z-[1000] rounded-xl shadow-xl overflow-hidden outline-none"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        opacity: position ? undefined : 0,
        pointerEvents: position ? undefined : 'none',
        width: PANEL_WIDTH,
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* En-tête : titre + action, pour que le panneau ne soit pas qu'un écran mort */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {t('sync.activity.title')}
        </h3>
        <button
          onClick={onSyncNow}
          disabled={busy}
          className={`px-2 py-1 text-xs rounded-md transition-colors
            hover:bg-[var(--color-hover-overlay)] ${busy ? 'opacity-60 cursor-default' : ''}`}
          style={{ color: 'var(--color-primary-500)' }}
        >
          {paused ? t('sync.activity.resume') : t('sync.activity.syncNow')}
        </button>
      </div>

      {/* Onglets */}
      <div role="tablist" className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
        {(['recent', 'pending', 'issues'] as TabId[]).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="flex-1 px-2 py-2 text-xs font-medium transition-colors"
            style={{
              color: tab === id ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              borderBottom:
                tab === id ? '2px solid var(--color-primary-500)' : '2px solid transparent',
            }}
          >
            {t(`sync.activity.tabs.${id}`)}
            {counts[id] > 0 && (
              <span className="ml-1 text-[var(--color-text-tertiary)]">({counts[id]})</span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="max-h-80 overflow-y-auto">
        {renderTabPanel()}
      </div>
    </div>,
    document.body
  );
};

export default SyncActivityPanel;
