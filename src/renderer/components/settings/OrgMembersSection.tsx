/**
 * OrgMembersSection (E1-8) — admin console: members list, role change, removal.
 * Calls go through the main process (IPC → authService → Worker /org/:orgId/...).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, Button, ConfirmModal } from '../ui';
import { useNotification } from '../ui/Notification';
import { Table, Column } from '../ui/Table/Table';
import {
  AdminSection,
  RoleBadge,
  MemberStatusBadge,
  CopyableId,
  RelativeTime,
} from './enterprise/AdminPrimitives';
import type { OrgMember, OrgRole } from '../../../types/org';

const ROLE_OPTIONS = (t: (k: string) => string) => [
  { value: 'admin', label: t('org.role.admin') },
  { value: 'security_admin', label: t('org.role.security_admin') },
  { value: 'editor', label: t('org.role.editor') },
  { value: 'viewer', label: t('org.role.viewer') },
];

const UsersIcon = () => (
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
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

interface Props {
  orgId: string;
  /** The current user's role — owner can manage owners, admin cannot. */
  myRole: OrgRole;
}

const OrgMembersSection: React.FC<Props> = ({ orgId, myRole }) => {
  const { t } = useTranslation();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [toRemove, setToRemove] = useState<OrgMember | null>(null);

  const ipc = window.electron?.ipcRenderer;

  const load = useCallback(async () => {
    if (!ipc) return;
    setLoading(true);
    try {
      const res = await ipc.invoke('org:members:list', orgId);
      if (res?.success) setMembers(res.data?.members ?? []);
      else notifyError(t('org.errors.loadMembers'));
    } catch {
      // Le pont existe aussi sur le web (dispatcher), mais il LÈVE sur un canal
      // pas encore porté : sans ce catch, `try/finally` laissait partir un rejet
      // non géré à chaque montage de la section.
      notifyError(t('org.errors.loadMembers'));
    } finally {
      setLoading(false);
    }
  }, [ipc, orgId, notifyError, t]);

  useEffect(() => {
    load();
  }, [load]);

  const changeRole = async (member: OrgMember, role: string) => {
    const res = await ipc?.invoke('org:members:updateRole', orgId, member.userId, role);
    if (res?.success) {
      notifySuccess(t('org.console.members.roleUpdated'));
      load();
    } else {
      notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
    }
  };

  const confirmRemove = async () => {
    if (!toRemove) return;
    const member = toRemove;
    setToRemove(null);
    const res = await ipc?.invoke('org:members:remove', orgId, member.userId);
    if (res?.success) {
      notifySuccess(t('org.console.members.removed'));
      load();
    } else {
      notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
    }
  };

  // An admin may not modify or remove an owner; the worker enforces this too.
  const canActOn = (m: OrgMember) => m.role !== 'owner' || myRole === 'owner';

  const columns: Column<OrgMember>[] = [
    {
      key: 'member',
      header: t('org.console.members.col.member', 'Member'),
      accessor: (m) => <CopyableId value={m.userId} />,
    },
    {
      key: 'role',
      header: t('org.console.members.col.role', 'Role'),
      width: '200px',
      accessor: (m) =>
        m.role !== 'owner' && canActOn(m) ? (
          <Select
            options={ROLE_OPTIONS(t)}
            value={m.role}
            onChange={(v) => changeRole(m, Array.isArray(v) ? v[0] : v)}
            ariaLabel={t('org.console.members.changeRoleAria', { user: m.userId })}
          />
        ) : (
          <RoleBadge role={m.role} />
        ),
    },
    {
      key: 'status',
      header: t('org.console.members.col.status', 'Status'),
      width: '130px',
      accessor: (m) => <MemberStatusBadge status={m.status} />,
    },
    {
      key: 'joined',
      header: t('org.console.members.col.joined', 'Joined'),
      width: '130px',
      accessor: (m) => {
        const ms = Date.parse(m.createdAt);
        return Number.isNaN(ms) ? <span className="ent-hint">—</span> : <RelativeTime ms={ms} />;
      },
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      align: 'right',
      accessor: (m) =>
        canActOn(m) ? (
          <Button variant="danger" size="sm" onClick={() => setToRemove(m)}>
            {t('org.console.members.remove')}
          </Button>
        ) : (
          <span className="ent-hint">—</span>
        ),
    },
  ];

  return (
    <AdminSection
      title={t('org.console.members.title')}
      description={t(
        'org.console.members.subtitle',
        'Manage roles and access for everyone in this organization.'
      )}
      icon={<UsersIcon />}
      flush
    >
      <Table
        columns={columns}
        data={members}
        keyExtractor={(m) => m.id}
        loading={loading && members.length === 0}
        emptyMessage={t('org.console.members.empty', 'No members yet.')}
        stickyHeader
        striped
        size="sm"
      />

      <ConfirmModal
        isOpen={toRemove !== null}
        onClose={() => setToRemove(null)}
        onConfirm={confirmRemove}
        title={t('org.console.members.removeTitle')}
        message={t('org.console.members.removeConfirm', { user: toRemove?.userId ?? '' })}
        confirmText={t('org.console.members.remove')}
        variant="danger"
      />
    </AdminSection>
  );
};

export default OrgMembersSection;
