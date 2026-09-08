/**
 * OrgSettingsSection — the org Settings tab: rename, slug, and the owner-only danger zone
 * (delete org). Extracted from the former OrgConsole so the dashboard owns it.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { Input, Button, ConfirmModal } from '../ui';
import { useNotification } from '../ui/Notification';
import { fetchOrgs, setCurrentOrg } from '../../../store/slices/orgSlice';
import { AdminSection, DangerZone } from './enterprise/AdminPrimitives';
import type { OrgSummary } from '../../../types/org';

const SettingsIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const OrgSettingsSection: React.FC<{ org: OrgSummary }> = ({ org }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const [name, setName] = useState(org.name);
  const [savingName, setSavingName] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ipc = window.electron?.ipcRenderer;

  useEffect(() => {
    setName(org.name);
  }, [org.id, org.name]);

  const saveName = async () => {
    if (!name.trim() || name.trim() === org.name) return;
    setSavingName(true);
    try {
      const res = await ipc?.invoke('org:update', org.id, name.trim());
      if (res?.success) {
        notifySuccess(t('org.console.settings.nameSaved'));
        dispatch(fetchOrgs());
      } else {
        notifyError(t('org.errors.generic'));
      }
    } finally {
      setSavingName(false);
    }
  };

  const deleteOrg = async () => {
    setConfirmDelete(false);
    const res = await ipc?.invoke('org:delete', org.id);
    if (res?.success) {
      notifySuccess(t('org.console.settings.deleteInitiated'));
      dispatch(setCurrentOrg(null));
      dispatch(fetchOrgs());
    } else {
      notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
    }
  };

  return (
    <AdminSection
      title={t('org.console.settings.title')}
      description={t('org.console.settings.subtitle', 'Rename the organization or remove it.')}
      icon={<SettingsIcon />}
    >
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            label={t('org.console.settings.nameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          variant="primary"
          onClick={saveName}
          loading={savingName}
          disabled={!name.trim() || name.trim() === org.name}
        >
          {t('org.console.settings.save')}
        </Button>
      </div>
      {org.slug && (
        <p className="ent-hint" style={{ marginTop: 'var(--spacing-3)' }}>
          {t('org.console.settings.slug')}: <span className="ent-mono">{org.slug}</span>
        </p>
      )}

      {org.role === 'owner' && (
        <div style={{ marginTop: 'var(--spacing-4)' }}>
          <DangerZone
            title={t('org.console.settings.dangerZone')}
            hint={t('org.console.settings.dangerHint')}
          >
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              {t('org.console.settings.deleteOrg')}
            </Button>
          </DangerZone>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteOrg}
        title={t('org.console.settings.deleteTitle')}
        message={t('org.console.settings.deleteConfirm', { name: org.name })}
        confirmText={t('org.console.settings.deleteOrg')}
        variant="danger"
      />
    </AdminSection>
  );
};

export default OrgSettingsSection;
