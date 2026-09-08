/**
 * OrgSinksSection — admin config for SIEM/webhook audit-log sinks.
 *
 * A "sink" streams the org's tamper-evident audit log to an external destination
 * (a signed webhook, or a Splunk HTTP Event Collector). Teams/Enterprise only, and —
 * because exporting the audit trail off-box is a security-sensitive control —
 * restricted to owners and security admins (separation of duties). The signing
 * secret / HEC token is write-only: the server returns a `hasSecret` flag, never the value.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, Input, Button, Toggle, ConfirmModal } from '../ui';
import { useNotification } from '../ui/Notification';
import { Table, Column } from '../ui/Table/Table';
import { AdminSection, StatusBadge, RelativeTime, InfoCallout } from './enterprise/AdminPrimitives';
import {
  apiListSinks,
  apiCreateSink,
  apiSetSinkEnabled,
  apiDeleteSink,
  type AuditSink,
  type AuditSinkType,
} from '../../../services/audit/sinksApi';
import type { OrgRole } from '../../../types/org';

interface Props {
  orgId: string;
  tier: string;
  myRole: OrgRole;
}

const StreamIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="20" height="7" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="7" rx="2" ry="2" />
    <line x1="6" y1="6.5" x2="6.01" y2="6.5" />
    <line x1="6" y1="17.5" x2="6.01" y2="17.5" />
  </svg>
);

const MIN_SECRET_LEN = 16;

export const OrgSinksSection: React.FC<Props> = ({ orgId, tier, myRole }) => {
  const { t } = useTranslation();
  const { success: notifySuccess, error: notifyError } = useNotification();

  const [sinks, setSinks] = useState<AuditSink[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<AuditSink | null>(null);

  // Add-sink form state.
  const [type, setType] = useState<AuditSinkType>('webhook');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');

  const isTeams = tier === 'teams' || tier === 'enterprise';
  const canManage = myRole === 'owner' || myRole === 'security_admin';

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { sinks: list } = await apiListSinks();
      setSinks(list);
    } catch {
      notifyError(t('sinks.errors.load', 'Could not load audit sinks.'));
    } finally {
      setLoading(false);
    }
  }, [notifyError, t]);

  useEffect(() => {
    if (!isTeams || !canManage) return;
    void reload();
  }, [orgId, isTeams, canManage, reload]);

  // Separation of duties — only owners / security admins may configure off-box export.
  if (!canManage) return null;

  if (!isTeams) {
    return (
      <AdminSection
        title={t('sinks.title', 'Audit log streaming')}
        description={t('sinks.subtitle', 'Forward the tamper-evident audit log to your SIEM.')}
        icon={<StreamIcon />}
      >
        <InfoCallout>
          {t(
            'sinks.teamsOnly',
            'Streaming the audit log to an external SIEM is available on the Teams and Enterprise plans.'
          )}
        </InfoCallout>
      </AdminSection>
    );
  }

  const secretRequiredLen = type === 'webhook';
  // Validate the trimmed value — it's what gets sent — so trailing spaces can't pass a
  // client check the server then rejects.
  const secretTooShort =
    secretRequiredLen && secret.trim().length > 0 && secret.trim().length < MIN_SECRET_LEN;
  const canSubmit =
    !submitting && /^https:\/\//i.test(url.trim()) && secret.trim().length > 0 && !secretTooShort;

  const onCreate = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await apiCreateSink({
        type,
        url: url.trim(),
        ...(type === 'webhook' ? { secret: secret.trim() } : { hecToken: secret.trim() }),
      });
      notifySuccess(t('sinks.created', 'Audit sink added.'));
      setUrl('');
      setSecret('');
      await reload();
    } catch {
      notifyError(t('sinks.errors.create', 'Could not add the audit sink.'));
    } finally {
      setSubmitting(false);
    }
  };

  const onToggle = async (sink: AuditSink, enabled: boolean) => {
    setBusyId(sink.id);
    try {
      await apiSetSinkEnabled(sink.id, enabled);
      notifySuccess(
        enabled ? t('sinks.enabled', 'Sink enabled.') : t('sinks.disabled', 'Sink disabled.')
      );
      await reload();
    } catch {
      notifyError(t('sinks.errors.toggle', 'Could not update the sink.'));
    } finally {
      setBusyId(null);
    }
  };

  const onConfirmRemove = async () => {
    if (!toRemove) return;
    const sink = toRemove;
    setToRemove(null);
    setBusyId(sink.id);
    try {
      await apiDeleteSink(sink.id);
      notifySuccess(t('sinks.removed', 'Audit sink removed.'));
      await reload();
    } catch {
      notifyError(t('sinks.errors.remove', 'Could not remove the audit sink.'));
    } finally {
      setBusyId(null);
    }
  };

  const typeLabel = (s: AuditSinkType) =>
    s === 'splunk_hec' ? t('sinks.type.splunk', 'Splunk HEC') : t('sinks.type.webhook', 'Webhook');

  const columns: Column<AuditSink>[] = [
    {
      key: 'type',
      header: t('sinks.col.type', 'Type'),
      width: '130px',
      accessor: (s) => (
        <StatusBadge tone={s.type === 'splunk_hec' ? 'brand' : 'info'}>
          {typeLabel(s.type)}
        </StatusBadge>
      ),
    },
    {
      key: 'url',
      header: t('sinks.col.destination', 'Destination'),
      accessor: (s) => (
        <span
          className="ent-mono"
          title={s.url}
          style={{
            display: 'block',
            maxWidth: '320px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--color-text-primary)',
          }}
        >
          {s.url}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('sinks.col.status', 'Status'),
      width: '150px',
      accessor: (s) =>
        s.lastError ? (
          <StatusBadge tone="error" dot title={s.lastError}>
            {t('sinks.status.error', 'Error')}
          </StatusBadge>
        ) : s.enabled ? (
          <StatusBadge tone="success" dot>
            {t('sinks.status.active', 'Active')}
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral">{t('sinks.status.disabled', 'Disabled')}</StatusBadge>
        ),
    },
    {
      key: 'delivered',
      header: t('sinks.col.delivered', 'Delivered'),
      width: '120px',
      align: 'right',
      accessor: (s) => (
        <span
          className="ent-mono"
          title={t('sinks.deliveredHint', 'Last audit event id delivered')}
        >
          {s.lastDeliveredId > 0 ? `#${s.lastDeliveredId}` : '—'}
        </span>
      ),
    },
    {
      key: 'updated',
      header: t('sinks.col.updated', 'Updated'),
      width: '130px',
      accessor: (s) => <RelativeTime ms={s.updatedAt} />,
    },
    {
      key: 'actions',
      header: t('sinks.col.actions', 'Actions'),
      width: '160px',
      align: 'right',
      accessor: (s) => (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
          <Toggle
            size="sm"
            checked={s.enabled}
            disabled={busyId === s.id}
            onChange={(e) => onToggle(s, e.target.checked)}
            aria-label={t('sinks.toggleAria', 'Enable or disable this sink')}
          />
          <Button
            variant="danger"
            size="sm"
            loading={busyId === s.id}
            onClick={() => setToRemove(s)}
          >
            {t('sinks.remove', 'Remove')}
          </Button>
        </div>
      ),
    },
  ];

  const typeOptions = [
    { value: 'webhook', label: t('sinks.type.webhook', 'Webhook') },
    { value: 'splunk_hec', label: t('sinks.type.splunk', 'Splunk HEC') },
  ];

  const onTypeChange = (v: string | string[]) => {
    const next = (Array.isArray(v) ? v[0] : v) as AuditSinkType;
    setType(next === 'splunk_hec' ? 'splunk_hec' : 'webhook');
    setSecret('');
  };

  return (
    <>
      <AdminSection
        title={t('sinks.title', 'Audit log streaming')}
        description={t('sinks.subtitle', 'Forward the tamper-evident audit log to your SIEM.')}
        icon={<StreamIcon />}
        actions={
          <StatusBadge tone="neutral">
            {t('sinks.count', '{{count}} sink', { count: sinks.length })}
          </StatusBadge>
        }
        flush
      >
        <Table
          columns={columns}
          data={sinks}
          keyExtractor={(s) => s.id}
          loading={loading && sinks.length === 0}
          emptyMessage={t('sinks.empty', 'No audit sinks configured yet.')}
          stickyHeader
          striped
          size="sm"
        />

        <div
          style={{
            padding: 'var(--spacing-4) var(--spacing-5) var(--spacing-5)',
            borderTop: '1px solid var(--color-border-light)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-3)',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-text-primary)',
            }}
          >
            {t('sinks.add.title', 'Add a sink')}
          </p>

          <div className="ent-toolbar" style={{ marginBottom: 0 }}>
            <div className="ent-toolbar__field" style={{ minWidth: '170px' }}>
              <Select
                options={typeOptions}
                value={type}
                onChange={onTypeChange}
                size="sm"
                ariaLabel={t('sinks.col.type', 'Type')}
              />
            </div>
            <div className="ent-toolbar__field" style={{ flex: '1 1 280px' }}>
              <Input
                size="sm"
                fullWidth
                type="url"
                aria-label={t('sinks.col.destination', 'Destination')}
                placeholder={t(
                  'sinks.add.urlPlaceholder',
                  'https://siem.example.com/services/collector'
                )}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="ent-toolbar__field" style={{ flex: '1 1 240px' }}>
              <Input
                size="sm"
                fullWidth
                type="password"
                autoComplete="new-password"
                aria-label={
                  type === 'webhook'
                    ? t('sinks.add.secretPlaceholder', 'Signing secret (≥ 16 chars)')
                    : t('sinks.add.tokenPlaceholder', 'Splunk HEC token')
                }
                placeholder={
                  type === 'webhook'
                    ? t('sinks.add.secretPlaceholder', 'Signing secret (≥ 16 chars)')
                    : t('sinks.add.tokenPlaceholder', 'Splunk HEC token')
                }
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                error={
                  secretTooShort
                    ? t('sinks.add.secretTooShort', 'Use at least 16 characters.')
                    : undefined
                }
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              loading={submitting}
              disabled={!canSubmit}
              onClick={onCreate}
            >
              {t('sinks.add.submit', 'Add')}
            </Button>
          </div>

          <InfoCallout>
            {type === 'webhook'
              ? t(
                  'sinks.add.webhookHint',
                  'Events are POSTed as JSON over HTTPS and signed with HMAC-SHA256 using your secret. The secret is stored encrypted and never shown again.'
                )
              : t(
                  'sinks.add.splunkHint',
                  'Events are sent to your Splunk HTTP Event Collector endpoint. The HEC token is stored encrypted and never shown again.'
                )}
          </InfoCallout>
        </div>
      </AdminSection>

      <ConfirmModal
        isOpen={toRemove !== null}
        onClose={() => setToRemove(null)}
        onConfirm={onConfirmRemove}
        title={t('sinks.removeTitle', 'Remove audit sink')}
        message={t(
          'sinks.removeConfirm',
          'Stop streaming the audit log to {{url}}? This cannot be undone.',
          {
            url: toRemove?.url ?? '',
          }
        )}
        confirmText={t('sinks.remove', 'Remove')}
        variant="danger"
      />
    </>
  );
};

export default OrgSinksSection;
