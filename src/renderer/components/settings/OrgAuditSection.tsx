/**
 * OrgAuditSection (E7-5) — admin view of the org's tamper-evident audit log.
 *
 * Consumes the E7-4 read API via the audit slice: paginated event list (filter by type),
 * a chain-integrity badge (verifyAuditChain), and load-more (keyset cursor). Teams/
 * Enterprise only. target_id stays opaque — the server never sends titles/content.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Select, Button } from '../ui';
import { Table, Column } from '../ui/Table/Table';
import {
  AdminSection,
  StatusBadge,
  CopyableId,
  RelativeTime,
  InfoCallout,
} from './enterprise/AdminPrimitives';
import type { AppDispatch } from '../../../store';
import {
  loadAuditEvents,
  checkAuditIntegrity,
  selectAuditEvents,
  selectAuditNextCursor,
  selectAuditLoading,
  selectAuditIntegrity,
  selectAuditVerifying,
} from '../../../store/slices/auditSlice';

interface Props {
  orgId: string;
  tier: string;
}

interface AuditEventRow {
  id: number;
  occurredAt: number;
  eventType: string;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  ipSubnet: string | null;
  country: string | null;
}

const EVENT_TYPES = [
  'auth.login.success',
  'auth.login.failure',
  'role.change',
  'permission.change',
  'share.create',
  'share.revoke',
  'download.file',
  'device.enroll',
  'device.revoke',
  'admin.action',
  'recovery.initiate',
  'recovery.complete',
  'scim.user.deprovision',
  'offboarding.step',
  'policy.update',
  'governance.action',
  'legal_hold.set',
  'device.wipe',
];

const ShieldIcon = () => (
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
);

export const OrgAuditSection: React.FC<Props> = ({ orgId, tier }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const events = useSelector(selectAuditEvents) as AuditEventRow[];
  const nextCursor = useSelector(selectAuditNextCursor);
  const loading = useSelector(selectAuditLoading);
  const integrity = useSelector(selectAuditIntegrity);
  const verifying = useSelector(selectAuditVerifying);
  const [eventType, setEventType] = useState('');

  const isTeams = tier === 'teams' || tier === 'enterprise';

  const reload = useCallback(
    (et: string) => {
      dispatch(
        loadAuditEvents({ query: { eventType: et || undefined, limit: 50 }, append: false })
      );
    },
    [dispatch]
  );

  useEffect(() => {
    if (!isTeams) return;
    reload('');
    dispatch(checkAuditIntegrity());
  }, [orgId, isTeams, reload, dispatch]);

  const onFilterChange = (et: string) => {
    setEventType(et);
    reload(et);
  };

  const loadMore = () => {
    if (!nextCursor) return;
    dispatch(
      loadAuditEvents({
        query: { eventType: eventType || undefined, cursor: nextCursor, limit: 50 },
        append: true,
      })
    );
  };

  if (!isTeams) {
    return (
      <AdminSection title={t('audit.title')} icon={<ShieldIcon />}>
        <InfoCallout>{t('audit.teamsOnly')}</InfoCallout>
      </AdminSection>
    );
  }

  const columns: Column<AuditEventRow>[] = [
    {
      key: 'time',
      header: t('audit.col.time'),
      width: '150px',
      accessor: (e) => <RelativeTime ms={e.occurredAt} />,
    },
    {
      key: 'event',
      header: t('audit.col.event'),
      accessor: (e) => (
        <span className="ent-mono" style={{ color: 'var(--color-text-primary)' }}>
          {e.eventType}
        </span>
      ),
    },
    {
      key: 'actor',
      header: t('audit.col.actor'),
      accessor: (e) => <CopyableId value={e.actorUserId} />,
    },
    {
      key: 'target',
      header: t('audit.col.target'),
      accessor: (e) => <CopyableId value={e.targetId} prefix={e.targetType} />,
    },
    {
      key: 'ip',
      header: t('audit.col.ip'),
      width: '120px',
      accessor: (e) => <span className="ent-mono">{e.ipSubnet ?? '—'}</span>,
    },
    {
      key: 'country',
      header: t('audit.col.country'),
      width: '90px',
      align: 'center',
      accessor: (e) => <span className="ent-hint">{e.country ?? '—'}</span>,
    },
  ];

  const integrityBadge = integrity ? (
    <StatusBadge
      tone={integrity.ok ? 'success' : 'error'}
      dot
      title={
        integrity.ok
          ? t('audit.integrityOk')
          : t('audit.integrityBroken', { id: integrity.brokenAtId ?? '?' })
      }
    >
      {integrity.ok ? t('audit.intact') : t('audit.broken')}
    </StatusBadge>
  ) : null;

  return (
    <AdminSection
      title={t('audit.title')}
      description={t('audit.subtitle', 'Tamper-evident, metadata-only activity log.')}
      icon={<ShieldIcon />}
      actions={
        <>
          {integrityBadge}
          <Button
            variant="ghost"
            size="sm"
            loading={verifying}
            onClick={() => dispatch(checkAuditIntegrity())}
          >
            {t('audit.verify')}
          </Button>
        </>
      }
      flush
    >
      <div style={{ padding: 'var(--spacing-4) var(--spacing-5) 0' }}>
        <div className="ent-toolbar">
          <div className="ent-toolbar__field">
            <Select
              options={[
                { value: '', label: t('audit.allEvents') },
                ...EVENT_TYPES.map((e) => ({ value: e, label: e })),
              ]}
              value={eventType}
              onChange={(v) => onFilterChange(Array.isArray(v) ? (v[0] ?? '') : v)}
              searchable
              ariaLabel={t('audit.filterLabel', 'Filter by event type')}
            />
          </div>
        </div>
      </div>

      <Table
        columns={columns}
        data={events}
        keyExtractor={(e) => String(e.id)}
        loading={loading && events.length === 0}
        emptyMessage={t('audit.empty')}
        stickyHeader
        striped
        size="sm"
      />

      {nextCursor && (
        <div style={{ padding: '0 var(--spacing-5) var(--spacing-4)' }}>
          <Button variant="secondary" size="sm" loading={loading} onClick={loadMore}>
            {t('audit.loadMore')}
          </Button>
        </div>
      )}
    </AdminSection>
  );
};

export default OrgAuditSection;
