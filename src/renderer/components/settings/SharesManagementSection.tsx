/**
 * SharesManagementSection — Settings section listing active E2EE shares
 *
 * Shows the owner every share they've created in the last 7 days (active or
 * recently expired/revoked), with actions to:
 *   - Re-copy the public URL (reconstructed from local K_share cache)
 *   - Revoke a still-active share
 *   - Name it, and READ the name others gave it (voir ci-dessous)
 *
 * Cloud mode only — the entire section is hidden in local mode (no shares
 * possible) to keep the Settings page tidy for users who don't sync.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LES NOMS — CE QUI MANQUAIT, ET CE QUE ÇA COÛTAIT
 * ════════════════════════════════════════════════════════════════════════
 * Sous chiffrement de bout en bout, le serveur ne sait pas ce qu'un partage
 * contient : cette liste n'avait donc RIEN à afficher qu'un identifiant
 * tronqué (`a1b2c3d4…9f0e`). Le site et le mobile, eux, montrent depuis
 * longtemps le nom que l'utilisateur a donné à son lien — un libellé SCELLÉ
 * vers la clé publique de garde du compte, que seule la phrase de récupération
 * ouvre.
 *
 * Le bureau savait SCELLER (c'est ainsi que K_share voyage) mais pas OUVRIR :
 * ni clé privée en mémoire, ni déballage, ni session. D'où trois ajouts, tous
 * hors de ce fichier — `services/custody/**` pour la session,
 * `services/sharing/shareLabels.ts` pour le modèle, `hooks/useCustody.ts` pour
 * le branchement React. Ce composant ne fait que les assembler.
 *
 * DEUX ÉTATS À NE PAS CONFONDRE, et c'est tout l'objet de la bannière :
 *   · COFFRE VERROUILLÉ — les noms EXISTENT, cette machine ne peut pas les
 *     lire. Un bouton « Déverrouiller » les révèle.
 *   · PAS DE COFFRE — rien à lire, et un nom saisi ici RESTERA ici.
 * Les afficher pareil ferait chercher une phrase de récupération qui n'a
 * jamais existé.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AnyAction } from 'redux';
import type { ThunkDispatch } from 'redux-thunk';
import { useTranslation } from 'react-i18next';
import type { RootState } from '../../../store';
import { loadSharesThunk, revokeShareThunk } from '../../../store/slices/sharesSlice';
import {
  getLocalShareUrl,
  pruneDeadShareKeys,
  listShareViews,
  type ShareView,
} from '../../../services/sharing/shareService';
import {
  applyLabel,
  mergeServerLabels,
  normalizeShareLabel,
  pruneLabels,
  readLabels,
  syncLabelToServer,
  writeLabels,
  type LabelSyncReason,
  type ShareLabel,
  type ShareLabelMap,
} from '../../../services/sharing/shareLabels';
import {
  custodyBannerVisible,
  custodyCanUnlock,
  custodyPhaseKey,
  fetchShareLabels,
  labelSyncReasonKey,
} from '../../../services/custody';
import { useCustody } from '../../../hooks/useCustody';
import { Button } from '../ui/Button/Button';
import { formatBytes } from '../../../constants/limits';
import CustodyUnlockDialog from './CustodyUnlockDialog';
import ShareRenameDialog from './ShareRenameDialog';
import './SharesManagementSection.css';

// Best-guess "is this share useful to display" check used to filter the
// list view. We still show inactive shares (revoked / expired / view-limit)
// for a few days so the user has audit visibility — but they get a muted
// styling and no actions.

const SharesManagementSection: React.FC = () => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<ThunkDispatch<RootState, unknown, AnyAction>>();
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const { items, loading, revokingId, error } = useSelector((s: RootState) => s.shares);

  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  const [unrecoverable, setUnrecoverable] = useState<string | null>(null);

  // ── Clé de garde et libellés ────────────────────────────────────────────
  const custody = useCustody(accountMode === 'cloud');
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Amorcée depuis le cache local : les noms s'affichent AVANT le premier
  // aller-retour serveur, et même coffre verrouillé. C'est ce qui distingue
  // « pas encore chargé » de « illisible ».
  const [labels, setLabels] = useState<ShareLabelMap>(() => readLabels());
  const [serverKnowsAppLabels, setServerKnowsAppLabels] = useState(false);
  // Dernière raison d'abstention, par partage — la ligne la porte le temps
  // qu'on la lise. Pas un toast : le message parle d'UNE ligne précise.
  const [syncNote, setSyncNote] = useState<{ id: string; reason: LabelSyncReason } | null>(null);
  const custodyStatus = custody.session.status;
  /**
   * Les identifiants que le SERVEUR a listés au dernier passage. Une `ref` et
   * non un état : rien ne se repeint quand ils changent, ils ne servent qu'au
   * ménage des libellés — en faire un état déclencherait un rendu pour rien.
   */
  const serverIdsRef = useRef<Set<string>>(new Set());

  /**
   * Fusionne les libellés du serveur dans la carte locale.
   *
   * REJOUÉE À CHAQUE DÉVERROUILLAGE, et pas seulement au montage : tant que le
   * coffre est fermé, `openWrappedLabel` rend `null` pour tout le monde et la
   * fusion ne rapporterait rien. C'est le passage à `unlocked` qui rend la
   * lecture possible, donc c'est lui qui doit la déclencher.
   *
   * `poussées` est la moitié MONTANTE de la convergence : les noms que cette
   * machine a et que le serveur ignore. On les envoie une fois, ici, plutôt
   * qu'à chaque saisie — l'utilisateur a pu nommer des partages hors ligne, ou
   * avant d'avoir un coffre.
   */
  const rechargerLibelles = useCallback(async () => {
    if (accountMode !== 'cloud') return;
    let listing;
    try {
      listing = await fetchShareLabels();
    } catch {
      // Panne : on GARDE ce qu'on a. Effacer les noms locaux parce que le
      // réseau a hoqueté serait une perte de données causée par une coupure.
      return;
    }
    setServerKnowsAppLabels(listing.serverKnowsAppLabels);
    const rows = [...listing.sends, ...listing.appSends, ...listing.requests];
    serverIdsRef.current = new Set(rows.map((r) => r.id));
    const local = readLabels();
    const { merged, toPush } = await mergeServerLabels(local, rows);
    writeLabels(merged);
    setLabels(merged);
    if (listing.serverKnowsAppLabels) {
      for (const id of toPush) {
        const value = merged[id];
        if (!value) continue;
        await syncLabelToServer('send', id, value, {
          appOrigin: true,
          serverKnowsAppLabels: true,
        });
      }
    }
  }, [accountMode]);

  // Une seule dépendance utile : le STATUT de la session. Se lier à l'objet
  // `custody.session` relancerait la fusion à chaque notification, y compris
  // celles qui ne changent que le matériel de clé.
  const dernierStatut = useRef<string>('');
  useEffect(() => {
    if (accountMode !== 'cloud') return;
    if (dernierStatut.current === custodyStatus) return;
    dernierStatut.current = custodyStatus;
    if (custodyStatus === 'unlocked' || custodyStatus === 'locked' || custodyStatus === 'absent') {
      void rechargerLibelles();
    }
  }, [accountMode, custodyStatus, rechargerLibelles]);

  /**
   * Enregistre un nom : LOCAL D'ABORD, serveur ensuite.
   *
   * L'ordre n'est pas négociable. La copie locale est celle que l'utilisateur
   * verra dans la seconde qui suit, et la faire dépendre d'un aller-retour
   * réseau ferait clignoter la ligne — ou pire, perdre la saisie sur une
   * coupure. La synchronisation est un BONUS de convergence, pas la source.
   */
  const enregistrerLibelle = useCallback(
    async (shareId: string, brut: ShareLabel) => {
      const value = normalizeShareLabel(brut);
      const suivant = applyLabel(readLabels(), shareId, value);
      writeLabels(suivant);
      setLabels(suivant);
      const outcome = await syncLabelToServer('send', shareId, value, {
        // Toute ligne de CETTE liste vient de `GET /sync/share`, c'est-à-dire
        // de la table `shares` : elles sont toutes d'origine application.
        appOrigin: true,
        serverKnowsAppLabels,
      });
      setSyncNote(outcome.status === 'local' ? { id: shareId, reason: outcome.reason } : null);
    },
    [serverKnowsAppLabels]
  );

  // Audit log expansion — one share at a time, keyed by shareId. When set
  // the row renders an inline panel showing the download history. We cache
  // the views per-share so collapsing + re-expanding doesn't re-fetch.
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null);
  const [viewsByShareId, setViewsByShareId] = useState<Record<string, ShareView[]>>({});
  const [loadingViewsId, setLoadingViewsId] = useState<string | null>(null);

  const handleToggleViews = useCallback(
    async (shareId: string) => {
      // Collapse if already open. Cheap pattern — no race conditions
      // because state updates are synchronous within the React batch.
      if (expandedShareId === shareId) {
        setExpandedShareId(null);
        return;
      }
      setExpandedShareId(shareId);
      // Lazy-fetch only on first expand; subsequent toggles reuse cache.
      // Refresh-the-list refetches from scratch (and resets this cache
      // implicitly because items is rebuilt).
      if (viewsByShareId[shareId]) return;
      setLoadingViewsId(shareId);
      try {
        const views = await listShareViews(shareId);
        setViewsByShareId((prev) => ({ ...prev, [shareId]: views }));
      } catch {
        // Non-fatal — the row stays expanded with an empty list. The
        // user can collapse + retry. Surface no toast; if the share
        // simply has no views yet, an empty list is the correct UX.
        setViewsByShareId((prev) => ({ ...prev, [shareId]: [] }));
      } finally {
        setLoadingViewsId(null);
      }
    },
    [expandedShareId, viewsByShareId]
  );

  const formatViewedAt = useCallback(
    (ms: number): string => {
      const date = new Date(ms);
      return new Intl.DateTimeFormat(i18n.language || undefined, {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
    },
    [i18n.language]
  );

  // Pull the latest list on mount (and any time the user re-opens settings).
  // The thunk already de-dupes if a load is in flight; the worst case is
  // one extra fetch which is cheap.
  useEffect(() => {
    if (accountMode !== 'cloud') return;
    void dispatch(loadSharesThunk());
  }, [accountMode, dispatch]);

  // Ménage des clés locales — SUR PREUVE seulement. On ne purge que les liens
  // que le serveur déclare explicitement inactifs ; un identifiant simplement
  // absent de la liste garde sa clé. L'ancienne règle inverse détruisait la clé
  // de tout lien de plus de sept jours, le rendant irrécupérable à vie.
  useEffect(() => {
    if (items.length === 0) return;
    pruneDeadShareKeys(new Set(items.filter((s) => !s.active).map((s) => s.shareId)));
  }, [items]);

  /**
   * Ménage des LIBELLÉS — même prudence, autre règle.
   *
   * On garde le nom de tout partage encore LISTÉ, révoqué compris : le pire
   * moment pour perdre le nom d'un lien est celui où l'utilisateur cherche à
   * comprendre ce qu'il vient de couper. Ne partent que les entrées dont
   * l'identifiant a complètement disparu de la liste.
   *
   * Ce ménage n'a lieu QUE sur une liste non vide : une liste vide vient aussi
   * d'un chargement en cours ou d'une erreur, et purger là-dessus effacerait
   * tous les noms sur une simple panne.
   *
   * LES DEUX LISTES COMPTENT. Celle-ci (`GET /sync/share`) ne montre que les
   * partages d'origine APPLICATION ; le listing du compte en connaît d'autres
   * — les envois faits sur filarr.com, les demandes de fichiers — dont les
   * noms sont dans la même carte. Purger sur la seule liste locale les
   * effacerait à chaque passage, pour les voir revenir à la fusion suivante.
   */
  useEffect(() => {
    if (items.length === 0) return;
    const vivants = new Set([...items.map((s) => s.shareId), ...serverIdsRef.current]);
    setLabels((prev) => {
      const suivant = pruneLabels(prev, vivants);
      if (Object.keys(suivant).length === Object.keys(prev).length) return prev;
      writeLabels(suivant);
      return suivant;
    });
  }, [items]);

  const handleCopyUrl = useCallback(async (shareId: string) => {
    const url = getLocalShareUrl(shareId);
    if (!url) {
      // K_share isn't on this device — this happens when the share was
      // created on another machine, or localStorage was wiped. There's
      // no recovery: only the owner who minted K_share can reconstruct
      // the URL. We surface this honestly rather than silently failing.
      setUnrecoverable(shareId);
      window.setTimeout(() => setUnrecoverable(null), 4000);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopiedShareId(shareId);
    window.setTimeout(() => setCopiedShareId(null), 2000);
  }, []);

  const handleRevoke = useCallback(
    async (shareId: string) => {
      await dispatch(revokeShareThunk(shareId));
    },
    [dispatch]
  );

  const formatDate = useCallback(
    (ms: number): string => {
      const date = new Date(ms);
      return new Intl.DateTimeFormat(i18n.language || undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    },
    [i18n.language]
  );

  // Group: active first (sorted by expiry ascending — "expiring soon" surfaces
  // at the top), then inactive (revoked / expired / view limit hit).
  const groups = useMemo(() => {
    const active = items.filter((s) => s.active).sort((a, b) => a.expiresAt - b.expiresAt);
    const inactive = items.filter((s) => !s.active).sort((a, b) => b.createdAt - a.createdAt);
    return { active, inactive };
  }, [items]);

  if (accountMode !== 'cloud') {
    // Hide section entirely — sharing requires a cloud account.
    return null;
  }

  return (
    <div className="shares-section">
      <div className="shares-section__header">
        <div>
          <h3 className="shares-section__title">
            {t('sharing.management.title', { defaultValue: 'My shares' })}
          </h3>
          <p className="shares-section__subtitle">
            {t('sharing.management.subtitle', {
              defaultValue: 'Active and recent share links you have created.',
            })}
          </p>
        </div>
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => void dispatch(loadSharesThunk())}
          disabled={loading}
        >
          {loading
            ? t('common.loading', { defaultValue: 'Loading…' })
            : t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {error && <div className="shares-section__error">{error}</div>}

      {/*
        LA BANNIÈRE DU COFFRE. Une phrase par phase, et elles ne disent pas la
        même chose : « verrouillé » promet des noms qu'un déverrouillage
        révélera, « pas de coffre » prévient que ce qu'on saisit restera ici.
        Elle se tait quand le coffre est ouvert — une bannière permanente qui
        annonce que tout va bien finit par masquer celle qui compte.
      */}
      {custodyBannerVisible(custody.phase) && (
        <div
          className={`shares-section__custody shares-section__custody--${custody.phase}`}
          role="status"
        >
          <span className="shares-section__custody-text">
            {t(custodyPhaseKey(custody.phase), {
              defaultValue: 'Unlock your account vault to read share names.',
            })}
          </span>
          {custodyCanUnlock(custody.phase) && (
            <Button variant="secondary" size="sm" onClick={() => setUnlockOpen(true)}>
              {t('custody.unlock.action', { defaultValue: 'Unlock' })}
            </Button>
          )}
        </div>
      )}

      {/*
        Le contrôle de la session, offert SEULEMENT quand elle est ouverte :
        « verrouiller » n'a rien à faire à côté d'un coffre déjà fermé, et
        « oublier cet ordinateur » n'apparaît que si quelque chose EST rangé.
      */}
      {custody.session.status === 'unlocked' && (
        <div className="shares-section__custody shares-section__custody--unlocked">
          <span className="shares-section__custody-text">
            {t(custodyPhaseKey('unlocked'), {
              defaultValue: 'Vault unlocked — share names are visible on this computer.',
            })}
          </span>
          <Button variant="tertiary" size="sm" onClick={custody.lock}>
            {t('custody.lock', { defaultValue: 'Lock' })}
          </Button>
          {custody.remember.remembered && (
            <Button variant="tertiary" size="sm" onClick={() => void custody.forget()}>
              {t('custody.forgetDevice', { defaultValue: 'Forget this computer' })}
            </Button>
          )}
        </div>
      )}

      {items.length === 0 && !loading && (
        <div className="shares-section__empty">
          {t('sharing.management.empty', {
            defaultValue:
              "You haven't created any shares yet. Right-click any file and pick “Share via link” to make one.",
          })}
        </div>
      )}

      {groups.active.length > 0 && (
        <div className="shares-section__group">
          <h4 className="shares-section__group-title">
            {t('sharing.management.activeHeader', { defaultValue: 'Active' })}
            <span className="shares-section__count">{groups.active.length}</span>
          </h4>
          <ul className="shares-section__list">
            {groups.active.map((s) => (
              <li key={s.shareId} className="shares-section__row">
                <div className="shares-section__row-main">
                  {/*
                    LE NOM PREND LA PLACE D'HONNEUR quand il existe, et
                    l'identifiant tronqué reste EN DESSOUS plutôt que de
                    disparaître : c'est lui qui figure dans les journaux et
                    dans l'URL, et le retirer priverait l'utilisateur du seul
                    moyen de rapprocher une ligne d'un lien qu'il a sous les
                    yeux.
                  */}
                  {labels[s.shareId]?.label && (
                    <div className="shares-section__row-name" title={labels[s.shareId]?.label}>
                      {labels[s.shareId]?.label}
                      {labels[s.shareId]?.client && (
                        <span className="shares-section__row-client">
                          {labels[s.shareId]?.client}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="shares-section__row-id" title={s.shareId}>
                    {s.shareId.slice(0, 8)}…{s.shareId.slice(-4)}
                    {s.passwordProtected && (
                      <span
                        className="shares-section__badge shares-section__badge--lock"
                        title={t('sharing.management.passwordProtected', {
                          defaultValue: 'Password protected',
                        })}
                      >
                        🔒
                      </span>
                    )}
                  </div>
                  <div className="shares-section__row-meta">
                    <span>{formatBytes(s.sizeBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className="shares-section__stat"
                      title={t('sharing.management.visitsTooltip', {
                        defaultValue: 'Number of times the share page was opened',
                      })}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      {s.infoViewCount}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className="shares-section__stat shares-section__stat--accent"
                      title={t('sharing.management.downloadsTooltip', {
                        defaultValue: 'Number of completed downloads',
                      })}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      {s.maxViews ? `${s.viewCount} / ${s.maxViews}` : s.viewCount}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t('sharing.management.expiresAt', {
                        defaultValue: 'expires {{date}}',
                        date: formatDate(s.expiresAt),
                      })}
                    </span>
                  </div>
                </div>
                <div className="shares-section__row-actions">
                  {/*
                    RENOMMER NE DEMANDE PAS LE DÉVERROUILLAGE. Sceller n'exige
                    que la clé PUBLIQUE : on peut donc nommer un partage sur
                    une machine verrouillée, même si on n'en relira le nom
                    qu'après avoir saisi sa phrase. C'est ce qui fait converger
                    les appareils sans imposer une ressaisie pour un geste
                    d'écriture.
                  */}
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={() => setRenamingId(s.shareId)}
                    title={t('sharing.management.renameTitle', {
                      defaultValue: 'Rename this share',
                    })}
                  >
                    {t('sharing.management.rename', { defaultValue: 'Rename' })}
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={() => handleToggleViews(s.shareId)}
                    title={t('sharing.management.viewsTitle', {
                      defaultValue: 'Show download history',
                    })}
                  >
                    {expandedShareId === s.shareId
                      ? t('sharing.management.viewsHide', { defaultValue: 'Hide history' })
                      : t('sharing.management.viewsShow', { defaultValue: 'History' })}
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={() => handleCopyUrl(s.shareId)}
                    title={t('sharing.management.copyTitle', {
                      defaultValue: 'Copy link to clipboard',
                    })}
                  >
                    {copiedShareId === s.shareId
                      ? t('sharing.success.copied', { defaultValue: '✓ Copied' })
                      : t('sharing.management.copy', { defaultValue: 'Copy link' })}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRevoke(s.shareId)}
                    loading={revokingId === s.shareId}
                    disabled={revokingId !== null}
                  >
                    {t('sharing.management.revoke', { defaultValue: 'Revoke' })}
                  </Button>
                </div>
                {unrecoverable === s.shareId && (
                  <div className="shares-section__hint">
                    {t('sharing.management.unrecoverable', {
                      defaultValue:
                        'This share was created on another device — its link cannot be rebuilt here. Revoke and recreate from this device if you need the link again.',
                    })}
                  </div>
                )}
                {/*
                  POURQUOI CE NOM N'EST PAS PARTI. Quatre raisons, quatre
                  phrases : trois disent « ça ne partira pas », une seule dit
                  « on réessaiera ». Les fondre en un « échec » unique
                  laisserait attendre une convergence qui n'aura jamais lieu.
                */}
                {syncNote?.id === s.shareId && (
                  <div className="shares-section__hint">
                    {t(labelSyncReasonKey(syncNote.reason), {
                      defaultValue: 'Saved on this computer only.',
                    })}
                  </div>
                )}
                {expandedShareId === s.shareId && (
                  <div className="shares-section__views">
                    {loadingViewsId === s.shareId ? (
                      <div className="shares-section__views-loading">
                        {t('common.loading', { defaultValue: 'Loading…' })}
                      </div>
                    ) : (viewsByShareId[s.shareId] ?? []).length === 0 ? (
                      <div className="shares-section__views-empty">
                        {t('sharing.management.viewsEmpty', {
                          defaultValue: 'No downloads yet.',
                        })}
                      </div>
                    ) : (
                      <ul className="shares-section__views-list">
                        {(viewsByShareId[s.shareId] ?? []).map((v, idx) => (
                          <li key={`${s.shareId}-${idx}`} className="shares-section__views-item">
                            <span className="shares-section__views-time">
                              {formatViewedAt(v.viewedAt)}
                            </span>
                            <span className="shares-section__views-loc">
                              {v.country ? v.country : '··'}
                              {v.ipSubnet && (
                                <span className="shares-section__views-ip">{v.ipSubnet}</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="shares-section__views-note">
                      {t('sharing.management.viewsPrivacyNote', {
                        defaultValue:
                          'For privacy, we only log a coarse subnet (/16) and the country — never full IP addresses.',
                      })}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.inactive.length > 0 && (
        <div className="shares-section__group">
          <h4 className="shares-section__group-title">
            {t('sharing.management.inactiveHeader', { defaultValue: 'Recently inactive' })}
            <span className="shares-section__count">{groups.inactive.length}</span>
          </h4>
          <ul className="shares-section__list shares-section__list--muted">
            {groups.inactive.map((s) => {
              const reason = s.revokedAt
                ? t('sharing.management.reasonRevoked', { defaultValue: 'Revoked' })
                : s.expiresAt < Date.now()
                  ? t('sharing.management.reasonExpired', { defaultValue: 'Expired' })
                  : t('sharing.management.reasonExhausted', { defaultValue: 'View limit reached' });
              return (
                <li key={s.shareId} className="shares-section__row shares-section__row--muted">
                  <div className="shares-section__row-main">
                    {/*
                      Le nom survit à la révocation, et c'est délibéré : c'est
                      précisément en relisant la liste des liens morts qu'on
                      cherche à savoir CE QU'ON a coupé.
                    */}
                    {labels[s.shareId]?.label && (
                      <div className="shares-section__row-name">{labels[s.shareId]?.label}</div>
                    )}
                    <div className="shares-section__row-id">
                      {s.shareId.slice(0, 8)}…{s.shareId.slice(-4)}
                    </div>
                    <div className="shares-section__row-meta">
                      <span className="shares-section__reason">{reason}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatBytes(s.sizeBytes)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t('sharing.management.visitsAndDownloads', {
                          defaultValue: '{{visits}} visits, {{downloads}} downloads',
                          visits: s.infoViewCount,
                          downloads: s.viewCount,
                        })}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <CustodyUnlockDialog
        isOpen={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        canRemember={custody.remember.available}
        onUnlock={custody.unlock}
      />

      <ShareRenameDialog
        isOpen={renamingId !== null}
        onClose={() => setRenamingId(null)}
        initial={renamingId ? labels[renamingId] : undefined}
        onSave={async (value) => {
          if (renamingId) await enregistrerLibelle(renamingId, value);
        }}
      />
    </div>
  );
};

export default SharesManagementSection;
