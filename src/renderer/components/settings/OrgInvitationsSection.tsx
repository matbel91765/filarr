/**
 * OrgInvitationsSection (E1-8) — invite by email, list pending, revoke.
 * Error codes from the Worker are mapped to localized messages (E1-11/E1-13).
 *
 * Redesigned onto the shared enterprise admin console primitives (AdminSection,
 * RoleBadge, StatusBadge, CopyableId, RelativeTime, InfoCallout) + the Table
 * component. Tokens only — no raw hex. Behaviour (IPC, handlers, gating) unchanged.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Select, Button } from '../ui';
import { useNotification } from '../ui/Notification';
import { Table, Column } from '../ui/Table/Table';
import {
  AdminSection,
  RoleBadge,
  StatusBadge,
  CopyableId,
  RelativeTime,
  InfoCallout,
} from './enterprise/AdminPrimitives';
import type { OrgInvitation } from '../../../types/org';

const ROLE_OPTIONS = (t: (k: string) => string) => [
  { value: 'admin', label: t('org.role.admin') },
  { value: 'editor', label: t('org.role.editor') },
  { value: 'viewer', label: t('org.role.viewer') },
];

const MailIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

interface Props {
  orgId: string;
}

const OrgInvitationsSection: React.FC<Props> = ({ orgId }) => {
  const { t, i18n } = useTranslation();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  /*
    LE REFUS ARRIVAIT APRÈS LA SAISIE. Une organisation sans abonnement se
    voyait proposer le formulaire complet, tapait une adresse, choisissait un
    rôle, cliquait — et lisait un 409. La règle est connue avant le premier
    caractère : on la montre là, et on retire le formulaire au lieu de le
    laisser mentir. `null` tant que la réponse n’est pas là : on ne bloque
    pas sur un doute, on bloque sur un « non » du serveur.
  */
  const [entitled, setEntitled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    window.electron?.ipcRenderer
      ?.invoke('org:billing:status', orgId)
      .then((r: { success?: boolean; data?: { entitled?: boolean } }) => {
        if (alive && r?.success && typeof r.data?.entitled === 'boolean')
          setEntitled(r.data.entitled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [orgId]);

  const ipc = window.electron?.ipcRenderer;

  const load = useCallback(async () => {
    if (!ipc) return;
    setLoading(true);
    try {
      const res = await ipc.invoke('org:invitations:list', orgId);
      if (res?.success) setInvitations(res.data?.invitations ?? []);
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

  const invite = async () => {
    if (!email.trim()) return;
    setSending(true);
    try {
      // Send the invite email in the inviter's UI language (E1-13).
      const res = await ipc?.invoke(
        'org:invitations:create',
        orgId,
        email.trim(),
        role,
        i18n.language
      );
      if (res?.success) {
        notifySuccess(t('org.console.invitations.sent', { email: email.trim() }));
        setEmail('');
        load();
      } else {
        notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
      }
    } finally {
      setSending(false);
    }
  };

  const revoke = async (inv: OrgInvitation) => {
    const res = await ipc?.invoke('org:invitations:revoke', orgId, inv.id);
    if (res?.success) {
      notifySuccess(t('org.console.invitations.revoked'));
      load();
    } else {
      notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
    }
  };

  const pending = invitations.filter((i) => i.status === 'pending');

  const columns: Column<OrgInvitation>[] = [
    {
      key: 'email',
      header: t('org.console.invitations.col.email', 'Email'),
      accessor: (inv) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <span
            style={{
              color: 'var(--color-text-primary)',
              fontWeight: 'var(--font-weight-medium)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {inv.email}
          </span>
          <CopyableId value={inv.id} prefix={t('org.console.invitations.col.id', 'invite')} />
        </div>
      ),
    },
    {
      key: 'role',
      header: t('org.console.invitations.col.role', 'Role'),
      width: '130px',
      accessor: (inv) => <RoleBadge role={inv.role} />,
    },
    {
      key: 'status',
      header: t('org.console.invitations.col.status', 'Status'),
      width: '130px',
      accessor: () => (
        <StatusBadge tone="warning" dot>
          {t('org.console.invitations.pending')}
        </StatusBadge>
      ),
    },
    {
      key: 'expires',
      header: t('org.console.invitations.col.expires', 'Expires'),
      width: '140px',
      accessor: (inv) => {
        const ms = Date.parse(inv.expiresAt);
        return Number.isNaN(ms) ? <span className="ent-hint">—</span> : <RelativeTime ms={ms} />;
      },
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      align: 'right',
      accessor: (inv) => (
        <Button variant="ghost" size="sm" onClick={() => revoke(inv)}>
          {t('org.console.invitations.revoke')}
        </Button>
      ),
    },
  ];

  return (
    <AdminSection
      title={t('org.console.invitations.title')}
      description={t(
        'org.console.invitations.subtitle',
        'Invite teammates by email. Pending invites expire automatically.'
      )}
      icon={<MailIcon />}
      actions={
        pending.length > 0 ? (
          <StatusBadge tone="info">
            {t('org.console.invitations.count', { count: pending.length })}
          </StatusBadge>
        ) : undefined
      }
      flush
    >
      <div style={{ padding: 'var(--spacing-5) var(--spacing-5) 0' }}>
        {entitled === false && (
          <div className="ent-band ent-band--info" style={{ marginBottom: 'var(--spacing-4)' }}>
            <div className="ent-band__icon">
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
            </div>
            <div className="ent-band__body">
              <div className="ent-band__title">{t('org.console.invitations.dormant.title')}</div>
              <p className="ent-band__text">{t('org.console.invitations.dormant.text')}</p>
            </div>
          </div>
        )}
        {entitled !== false && (
          <div
            className="ent-toolbar"
            style={{ alignItems: 'flex-end', marginBottom: 'var(--spacing-4)' }}
          >
            <div style={{ flex: '1 1 auto', minWidth: '200px' }}>
              <Input
                type="email"
                label={t('org.console.invitations.emailLabel')}
                placeholder={t('org.console.invitations.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div style={{ width: '160px' }}>
              <Select
                label={t('org.console.invitations.roleLabel')}
                options={ROLE_OPTIONS(t)}
                value={role}
                onChange={(v) => setRole(Array.isArray(v) ? v[0] : v)}
              />
            </div>
            <Button variant="primary" onClick={invite} loading={sending} disabled={!email.trim()}>
              {t('org.console.invitations.invite')}
            </Button>
          </div>
        )}

        <InfoCallout>
          {t(
            'org.console.invitations.note',
            'Invitees join with the role you assign here. You can change it any time from Members.'
          )}
        </InfoCallout>
      </div>

      <Table
        columns={columns}
        data={pending}
        keyExtractor={(inv) => inv.id}
        loading={loading && pending.length === 0}
        emptyMessage={t('org.console.invitations.empty', 'No pending invitations.')}
        stickyHeader
        striped
        size="sm"
      />
    </AdminSection>
  );
};

export default OrgInvitationsSection;
