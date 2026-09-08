/**
 * OrgBillingSection (E1-8) — per-seat billing summary + Stripe portal/checkout.
 * Shows tier, paid seats, pooled quota and a dunning banner; viewers are free.
 */

import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import { useNotification } from '../ui/Notification';
import {
  AdminSection,
  TierBadge,
  StatusBadge,
  InfoCallout,
  type BadgeTone,
} from './enterprise/AdminPrimitives';
import { StatCard } from './enterprise/Charts';
import type { OrgBillingStatus } from '../../../types/org';

const BILLING_RETURN = 'https://app.filarr.com/billing';

/**
 * Le stockage mutualise vaut 100 Go PAR SIEGE — c'est `POOLED_STORAGE_PER_SEAT`
 * cote Worker. La constante n'est ici que pour ECRIRE la phrase « 100 Go × 3
 * sieges » : le quota affiche, lui, reste celui que le serveur a calcule, jamais
 * ce produit. Si les deux divergent un jour, c'est le serveur qui a raison.
 */
const PER_SEAT_STORAGE_BYTES = 100 * 1024 * 1024 * 1024;

const CreditCardIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
  </svg>
);

const CheckIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const PauseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <line x1="10" y1="9" x2="10" y2="15" />
    <line x1="14" y1="9" x2="14" y2="15" />
  </svg>
);

const AlertIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
  </svg>
);

const StopIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <line x1="8" y1="8" x2="16" y2="16" />
  </svg>
);

/** Maps a Stripe billing status to a badge tone. */
const BILLING_TONE: Record<string, BadgeTone> = {
  active: 'success',
  trialing: 'info',
  past_due: 'warning',
  suspended: 'error',
  canceled: 'neutral',
};

interface Props {
  orgId: string;
}

const OrgBillingSection: React.FC<Props> = ({ orgId }) => {
  const { t } = useTranslation();
  const { error: notifyError } = useNotification();
  const [status, setStatus] = useState<OrgBillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /*
    LE PALIER EST FIXE, LA PÉRIODE NE L'EST PLUS.
    « Enterprise » ne s'achète pas ici et c'est voulu : ce qui le distingue de
    Teams — SSO, SCIM, résidence des données — est encore fermé dans
    `ENTERPRISE_FEATURES`, et son minimum de 25 sièges en fait une conversation
    commerciale, pas un bouton. L'annuel, lui, n'avait aucune raison d'être
    absent : le Worker accepte `period`, le tarif Stripe existe, et la grille
    publique l'annonce à −17 %. Seul cet appel écrivait « monthly » en dur.
  */
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly');

  const ipc = window.electron?.ipcRenderer;

  const load = useCallback(async () => {
    if (!ipc) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await ipc.invoke('org:billing:status', orgId);
      if (res?.success) setStatus(res.data ?? null);
    } catch {
      // Sur le web le dispatcher lève sur ce canal (pas encore porté) : sans
      // catch, `try/finally` laissait partir un rejet non géré au montage.
      notifyError(t('org.errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [ipc, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Le plancher que le SERVEUR appliquera : ni sous les membres facturables
   * existants, ni sous le minimum du plan. Recalculé ici pour griser le bouton
   * plutôt que laisser l'administrateur découvrir le refus après le clic — mais
   * c'est le serveur qui tranche, et lui seul.
   */
  const planMinimum = status?.tier === 'enterprise' ? 25 : 3;
  const seatFloor = Math.max(planMinimum, status?.billableMembers ?? 0);

  const changeSeats = async (seats: number) => {
    if (!ipc || seats < seatFloor) return;
    setBusy(true);
    try {
      const res = await ipc.invoke('org:billing:seats', orgId, seats);
      if (res?.success) {
        // Stripe confirme par son webhook, qui écrit `seats_purchased`. Le temps
        // qu'il arrive, on relit : afficher tout de suite la valeur demandée
        // annoncerait un achat qui n'est pas encore acté.
        await load();
      } else {
        notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
      }
    } catch {
      notifyError(t('org.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    try {
      const res = await ipc?.invoke('org:billing:portal', orgId);
      if (res?.success && res.data?.portalUrl) {
        ipc?.send('open-external', res.data.portalUrl);
      } else {
        notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
      }
    } finally {
      setBusy(false);
    }
  };

  const subscribe = async () => {
    setBusy(true);
    try {
      const res = await ipc?.invoke(
        'org:billing:checkout',
        orgId,
        'teams',
        period,
        `${BILLING_RETURN}/success`,
        `${BILLING_RETURN}/cancel`
      );
      if (res?.success && res.data?.checkoutUrl) {
        ipc?.send('open-external', res.data.checkoutUrl);
      } else {
        notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
      }
    } finally {
      setBusy(false);
    }
  };

  const gb = (bytes: number) => `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  const billingTone: BadgeTone = status
    ? (BILLING_TONE[status.billingStatus] ?? 'neutral')
    : 'neutral';

  /*
    L'EN-TETE NOMME L'ETAT, LE BANDEAU L'EXPLIQUE ET LE CHANGE.
    Les deux boutons vivaient ici, loin de toute phrase disant ce que chacun
    provoque : « Souscrire » et « Gerer l'abonnement » cote a cote au-dessus
    d'une liste de chiffres laissaient DEVINER lequel s'applique. Ils sont
    descendus dans le bandeau d'etat, qui n'en montre qu'UN — celui que la
    situation appelle.
  */
  const actions = (
    <>
      <TierBadge tier={status?.tier ?? 'free'} />
      {status && (
        <StatusBadge tone={billingTone} dot>
          {t(`org.console.billing.status.${status.billingStatus}`, status.billingStatus)}
        </StatusBadge>
      )}
    </>
  );

  /*
    QUATRE SITUATIONS, QUATRE PHRASES, UN SEUL GESTE A CHAQUE FOIS.
    L'ordre des tests n'est pas indifferent : une organisation resiliee n'est
    PAS non plus « entitled », donc a tester l'abonnement d'abord, une equipe
    qui vient de resilier lirait « aucun abonnement » au lieu de « abonnement
    arrete » — et perdrait au passage la seule phrase qui la rassure, celle qui
    dit que rien n'est supprime.
  */
  const band: {
    tone: 'success' | 'info' | 'warning' | 'danger';
    icon: ReactNode;
    title: string;
    text: string;
    emphasis: string;
    cta: 'manage' | 'subscribe';
  } | null = !status
    ? null
    : status.billingStatus === 'canceled' || status.billingStatus === 'suspended'
      ? {
          tone: 'danger',
          icon: <StopIcon />,
          title: t('org.console.billing.band.stopped.title'),
          text: t('org.console.billing.band.stopped.text'),
          emphasis: t('org.console.billing.band.keptSafe'),
          cta: 'subscribe',
        }
      : !status.entitled
        ? {
            tone: 'info',
            icon: <PauseIcon />,
            title: t('org.console.billing.band.dormant.title'),
            text: t('org.console.billing.band.dormant.text'),
            emphasis: t('org.console.billing.band.dormant.emphasis'),
            cta: 'subscribe',
          }
        : status.billingStatus === 'past_due'
          ? {
              tone: 'warning',
              icon: <AlertIcon />,
              title: t('org.console.billing.band.pastDue.title'),
              text: t('org.console.billing.band.pastDue.text'),
              emphasis: t('org.console.billing.band.keptSafe'),
              cta: 'manage',
            }
          : {
              tone: 'success',
              icon: <CheckIcon />,
              title: t('org.console.billing.band.active.title'),
              text: t('org.console.billing.band.active.text'),
              emphasis: t('org.console.billing.band.keptSafe'),
              cta: 'manage',
            };

  return (
    <AdminSection
      title={t('org.console.billing.title')}
      description={t(
        'org.console.billing.subtitle',
        'Per-seat subscription, pooled storage and payment status.'
      )}
      icon={<CreditCardIcon />}
      actions={actions}
    >
      {loading && !status ? (
        <p className="ent-hint">{t('common.loading', 'Loading…')}</p>
      ) : status && band ? (
        <>
          <div className={`ent-band ent-band--${band.tone}`}>
            <div className="ent-band__icon">{band.icon}</div>
            <div className="ent-band__body">
              <div className="ent-band__title">{band.title}</div>
              <p className="ent-band__text">
                {band.text} <strong>{band.emphasis}</strong>
              </p>
              <div className="ent-band__actions">
                {band.cta === 'manage' ? (
                  <Button variant="secondary" size="sm" onClick={openPortal} loading={busy}>
                    {t('org.console.billing.manage')}
                  </Button>
                ) : (
                  <>
                    {/* Le choix se fait AVANT le bouton : après, on est chez Stripe. */}
                    <div
                      className="ent-segmented"
                      role="group"
                      aria-label={t('org.console.billing.period.label')}
                    >
                      {(['monthly', 'annual'] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={`ent-segmented__btn ${period === p ? 'ent-segmented__btn--active' : ''}`}
                          aria-pressed={period === p}
                          onClick={() => setPeriod(p)}
                        >
                          {t(`org.console.billing.period.${p}`)}
                        </button>
                      ))}
                    </div>
                    <Button variant="primary" size="sm" onClick={subscribe} loading={busy}>
                      {t('org.console.billing.subscribe')}
                    </Button>
                  </>
                )}
              </div>
              {band.cta === 'subscribe' && (
                <p className="ent-field__hint">{t(`org.console.billing.period.hint.${period}`)}</p>
              )}
            </div>
          </div>

          {/*
            LES QUATRE CHIFFRES D'UN MEME SUJET SE LISENT ENSEMBLE. Le panneau
            les tient, et les tuiles y perdent leur cadre : ce ne sont pas quatre
            statistiques independantes, c'est une facture lue en quatre fois.
            Chaque valeur porte sa ligne d'explication — un nombre de sieges sans
            « minimum du plan » a cote laisse croire a un choix la ou le plan
            impose un plancher.
          */}
          <div className="ent-statpanel" style={{ marginTop: 'var(--spacing-5)' }}>
            <div className="ent-statgrid">
              <StatCard
                label={t('org.console.billing.plan')}
                value={<TierBadge tier={status.tier} />}
                sub={t(`org.console.billing.planSub.${status.tier}`, '') || undefined}
              />
              <StatCard
                label={t('org.console.billing.seats')}
                value={
                  /*
                    LE SIEGE S'ACHETE ICI, ET C'EST LA SEULE PORTE.
                    Les sieges achetes ne montaient qu'apres l'arrivee d'un
                    membre, alors que l'invitation est refusee des qu'il n'en
                    reste plus : une organisation pleine ne pouvait plus jamais
                    grandir. On ne la fait pas grandir toute seule — augmenter
                    une facture sans que personne ne l'ait demande n'est pas une
                    commodite, c'est un prelevement — donc le geste est
                    explicite, et borne par le serveur (jamais sous les membres
                    existants ni sous le minimum du plan).
                  */
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span>{status.entitled ? status.seatsPurchased : '—'}</span>
                    {status.entitled && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || status.seatsPurchased <= seatFloor}
                          onClick={() => changeSeats(status.seatsPurchased - 1)}
                          aria-label={t('org.console.billing.seatsRemove', 'Rendre un siège')}
                        >
                          −
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => changeSeats(status.seatsPurchased + 1)}
                          aria-label={t('org.console.billing.seatsAdd', 'Acheter un siège')}
                        >
                          +
                        </Button>
                      </>
                    )}
                  </span>
                }
                sub={
                  status.entitled && status.seatsPurchased <= seatFloor
                    ? t('org.console.billing.seatsFloorSub')
                    : undefined
                }
              />
              <StatCard
                label={t('org.console.billing.billable')}
                value={status.billableMembers}
                sub={t('org.console.billing.billableSub')}
              />
              <StatCard
                label={t('org.console.billing.pooledQuota')}
                value={
                  status.entitled
                    ? `${gb(status.pooledStorageUsed ?? 0)} / ${gb(status.pooledStorageLimit)}`
                    : '—'
                }
                sub={
                  status.entitled
                    ? t('org.console.billing.pooledSub', {
                        perSeat: gb(PER_SEAT_STORAGE_BYTES),
                        seats: status.seatsPurchased,
                      })
                    : t('org.console.billing.pooledNone')
                }
              />
            </div>
          </div>

          <p className="ent-hint" style={{ marginTop: 'var(--spacing-4)' }}>
            {t('org.console.billing.proration')}
          </p>
        </>
      ) : (
        <InfoCallout>
          {t('org.console.billing.empty', 'No billing information is available yet.')}
        </InfoCallout>
      )}
    </AdminSection>
  );
};

export default OrgBillingSection;
