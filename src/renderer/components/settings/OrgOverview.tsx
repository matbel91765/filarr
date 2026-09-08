/**
 * OrgOverview — the monitoring "at a glance" tab of the org dashboard: stat cards +
 * audit-activity charts. Reads the org-scoped aggregate endpoints (audit stats, members,
 * billing, sinks, chain integrity) in parallel; everything stays metadata-only.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminSection, StatusBadge, InfoCallout } from './enterprise/AdminPrimitives';
import { StatCard, BarChart, BarList } from './enterprise/Charts';
import {
  apiGetAuditStats,
  apiVerifyAuditChain,
  type AuditStats,
  type AuditChainStatus,
} from '../../../services/audit/auditApi';
import { apiListSinks, type AuditSink } from '../../../services/audit/sinksApi';
import type { OrgMember, OrgRole } from '../../../types/org';

interface Props {
  orgId: string;
  tier: string;
  myRole: OrgRole;
}

interface Billing {
  seatsPurchased?: number;
  /** Répondu par le SERVEUR, avec le prédicat même qui garde les fonctions. */
  entitled?: boolean;
  billableMembers?: number;
  pooledStorageLimit?: number;
  pooledStorageUsed?: number;
}

const ROLE_ORDER: OrgRole[] = ['owner', 'admin', 'security_admin', 'editor', 'viewer'];

const Ico = {
  users: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  ),
  activity: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  stream: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="7" rx="2" />
      <rect x="2" y="14" width="20" height="7" rx="2" />
      <line x1="6" y1="6.5" x2="6.01" y2="6.5" />
      <line x1="6" y1="17.5" x2="6.01" y2="17.5" />
    </svg>
  ),
  seat: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  ),
  shield: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
};

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export const OrgOverview: React.FC<Props> = ({ orgId, tier, myRole }) => {
  const { t } = useTranslation();
  const ipc = window.electron?.ipcRenderer;
  const canManageSinks = myRole === 'owner' || myRole === 'security_admin';

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  /**
   * L'organisation a-t-elle droit a ce qu'elle paie ? On croit le SERVEUR, qui
   * repond avec le predicat meme qui garde les fonctions. Le repli sur le palier
   * seul n'existe que pour un Worker plus ancien : il est plus indulgent que le
   * predicat serveur (il ignore le gel et la resiliation), et c'est acceptable
   * pour un AFFICHAGE — le refus, lui, reste pris cote serveur.
   */
  const entitled = billing?.entitled ?? (tier === 'teams' || tier === 'enterprise');
  const storageRatio =
    billing && billing.pooledStorageLimit
      ? (billing.pooledStorageUsed ?? 0) / billing.pooledStorageLimit
      : 0;
  const [sinks, setSinks] = useState<AuditSink[]>([]);
  const [integrity, setIntegrity] = useState<AuditChainStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, m, b, k, v] = await Promise.allSettled([
      apiGetAuditStats(),
      ipc?.invoke('org:members:list', orgId),
      ipc?.invoke('org:billing:status', orgId),
      canManageSinks ? apiListSinks() : Promise.resolve({ sinks: [] as AuditSink[] }),
      apiVerifyAuditChain(),
    ]);
    type Env<T> = { success?: boolean; data?: T } | undefined;
    if (s.status === 'fulfilled') setStats(s.value);
    const mv = m.status === 'fulfilled' ? (m.value as Env<{ members?: OrgMember[] }>) : undefined;
    if (mv?.success) setMembers(mv.data?.members ?? []);
    const bv = b.status === 'fulfilled' ? (b.value as Env<Billing>) : undefined;
    if (bv?.success) setBilling(bv.data ?? null);
    if (k.status === 'fulfilled') setSinks((k.value as { sinks: AuditSink[] }).sinks ?? []);
    if (v.status === 'fulfilled') setIntegrity(v.value);
    setLoading(false);
  }, [ipc, orgId, canManageSinks]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = members.filter((m) => m.status === 'pending').length;
  const roleCounts = ROLE_ORDER.map((r) => ({
    label: t(`org.role.${r}`),
    count: members.filter((m) => m.role === r).length,
  })).filter((r) => r.count > 0);
  const activeSinks = sinks.filter((k) => k.enabled).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
      <div className="ent-statgrid">
        <StatCard
          label={t('org.dashboard.stat.members')}
          icon={Ico.users}
          value={loading ? '—' : members.length}
          sub={pending > 0 ? t('org.dashboard.stat.membersPending', { count: pending }) : undefined}
        />
        <StatCard
          label={t('org.dashboard.stat.events', { days: stats?.windowDays ?? 30 })}
          icon={Ico.activity}
          value={loading ? '—' : (stats?.total ?? 0).toLocaleString()}
          sub={stats ? t('org.dashboard.stat.actors', { count: stats.actors }) : undefined}
        />
        {/*
          UNE ORGANISATION SANS ABONNEMENT N'A NI SIÈGE NI STOCKAGE, et cette
          tuile l'annonçait pourtant. Une organisation neuve nait avec un siège
          par défaut et le quota se calculait « sièges × 100 Go » : sa vue
          d'ensemble affichait donc « 1/1 » et « 100 Go » à quelqu'un dont la
          première tentative de créer un coffre sera refusée. Le serveur ne
          renvoie plus ce quota, et l'écran dit maintenant ce qu'il faut faire
          plutôt qu'un « 0 Go » exact et muet.
        */}
        <StatCard
          label={t('org.dashboard.stat.seats')}
          icon={Ico.seat}
          value={
            loading
              ? '—'
              : !entitled
                ? '—'
                : `${billing?.billableMembers ?? members.length}/${billing?.seatsPurchased ?? '—'}`
          }
          sub={
            entitled ? (
              <>
                {t('org.dashboard.stat.storageUsed', {
                  used: fmtBytes(billing?.pooledStorageUsed ?? 0),
                  size: fmtBytes(billing?.pooledStorageLimit),
                })}
                {(billing?.pooledStorageLimit ?? 0) > 0 && (
                  <div
                    className={`ent-meter ${storageRatio >= 1 ? 'ent-meter--full' : storageRatio >= 0.85 ? 'ent-meter--warn' : ''}`}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(Math.min(1, storageRatio) * 100)}
                  >
                    <div
                      className="ent-meter__fill"
                      style={{ width: `${Math.min(100, storageRatio * 100)}%` }}
                    />
                  </div>
                )}
              </>
            ) : (
              t('org.dashboard.stat.noSubscription', 'Avec l’abonnement')
            )
          }
        />
        {canManageSinks && (
          <StatCard
            label={t('org.dashboard.stat.sinks')}
            icon={Ico.stream}
            value={loading ? '—' : `${activeSinks}/${sinks.length}`}
            sub={t('org.dashboard.stat.sinksActive')}
          />
        )}
        <StatCard
          label={t('org.dashboard.stat.integrity')}
          icon={Ico.shield}
          value={
            integrity == null ? (
              '—'
            ) : (
              <StatusBadge tone={integrity.ok ? 'success' : 'error'} dot>
                {integrity.ok ? t('audit.intact') : t('audit.broken')}
              </StatusBadge>
            )
          }
          sub={t('org.dashboard.stat.integritySub')}
        />
      </div>

      {tier !== 'teams' && tier !== 'enterprise' ? (
        <InfoCallout>{t('audit.teamsOnly')}</InfoCallout>
      ) : (
        <div className="ent-grid-2">
          <div className="ent-card">
            <p className="ent-card__title">{t('org.dashboard.chart.activity')}</p>
            <p className="ent-card__hint">
              {t('org.dashboard.chart.activityHint', { days: stats?.windowDays ?? 30 })}
            </p>
            {stats && stats.total > 0 ? (
              <BarChart data={stats.byDay} windowDays={stats.windowDays} />
            ) : (
              <p className="ent-hint">{t('audit.empty')}</p>
            )}
          </div>
          <div className="ent-card">
            <p className="ent-card__title">{t('org.dashboard.chart.byType')}</p>
            <p className="ent-card__hint">{t('org.dashboard.chart.byTypeHint')}</p>
            {stats && stats.byType.length > 0 ? (
              <BarList
                items={stats.byType.slice(0, 8).map((x) => ({ label: x.type, count: x.count }))}
              />
            ) : (
              <p className="ent-hint">{t('audit.empty')}</p>
            )}
          </div>
        </div>
      )}

      <AdminSection
        title={t('org.dashboard.roles')}
        description={t('org.dashboard.rolesHint')}
        icon={Ico.users}
      >
        {roleCounts.length > 0 ? (
          <BarList items={roleCounts} />
        ) : (
          <p className="ent-hint">{t('common.loading')}</p>
        )}
      </AdminSection>
    </div>
  );
};

export default OrgOverview;
