/**
 * OrgPolicySection (E9-1 / E5-7 UI) — owner/admin editor for the org governance policy. Edits the
 * session, sharing and retention sections and PUTs them to the reviewed /org/:id/policies endpoint
 * (MANAGE_GOVERNANCE, optimistic-concurrency gated on the version we read). Metadata only — never a
 * vault key. The IP allowlist (CIDR-list section) is a separate editor and not handled here yet.
 *
 * This is where session.mfaRequired (E5-7) is turned on: enforced server-side on password logins.
 */

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminSection, InfoCallout } from './AdminPrimitives';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Toggle } from '../../ui/Toggle';
import { useNotification } from '../../ui/Notification';
import {
  apiGetOrgPolicy,
  apiUpdateOrgPolicy,
  type OrgPolicyDocument,
  type SessionPolicy,
  type SharingPolicy,
  type RetentionPolicy,
} from '../../../../services/org/orgPolicyApi';

interface Props {
  orgId: string;
}

const errMsg = (e: unknown, fallback: string): string =>
  (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error ||
  (e as { message?: string })?.message ||
  fallback;

// ── Row helpers (design-system Toggle / Input; never raw inputs on the dark theme) ──

const ToggleRow: FC<{
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}> = ({ label, desc, checked, onChange, disabled }) => (
  <div className="flex items-start justify-between gap-4 py-2.5">
    <div className="min-w-0">
      <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {label}
      </div>
      {desc && (
        <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {desc}
        </div>
      )}
    </div>
    <Toggle checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
  </div>
);

const NumberRow: FC<{
  label: string;
  desc?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  min?: number;
  disabled?: boolean;
}> = ({ label, desc, value, onChange, placeholder, min = 1, disabled }) => (
  <div className="flex items-start justify-between gap-4 py-2.5">
    <div className="min-w-0">
      <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {label}
      </div>
      {desc && (
        <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {desc}
        </div>
      )}
    </div>
    <div style={{ width: 120, flexShrink: 0 }}>
      <Input
        type="number"
        min={min}
        value={value ?? ''}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(null); // empty = no limit
            return;
          }
          // Clamp to >= min; a non-numeric value can't reach null/NaN in state.
          const n = Math.floor(Number(raw));
          onChange(Number.isFinite(n) ? Math.max(min, n) : min);
        }}
      />
    </div>
  </div>
);

const OrgPolicySection: FC<Props> = ({ orgId }) => {
  const { t } = useTranslation();
  const { success, error: notifyError } = useNotification();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState<OrgPolicyDocument | null>(null);
  const [draft, setDraft] = useState<OrgPolicyDocument | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGetOrgPolicy(orgId);
      setSaved(res.policy);
      setDraft(res.policy);
      setVersion(res.version);
    } catch (e) {
      notifyError(errMsg(e, t('org.policy.loadFailed', 'Could not load the policy')));
    } finally {
      setLoading(false);
    }
  }, [orgId, t, notifyError]);

  useEffect(() => {
    void load();
  }, [load]);

  const setSession = (patch: Partial<SessionPolicy>) =>
    setDraft((d) => (d ? { ...d, session: { ...d.session, ...patch } } : d));
  const setSharing = (patch: Partial<SharingPolicy>) =>
    setDraft((d) => (d ? { ...d, sharing: { ...d.sharing, ...patch } } : d));
  const setRetention = (patch: Partial<RetentionPolicy>) =>
    setDraft((d) => (d ? { ...d, retention: { ...d.retention, ...patch } } : d));

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    if (!draft || !dirty) return;
    setBusy(true);
    try {
      // Only the editable sections are patched — the server preserves ipAllowlist (unsent).
      const res = await apiUpdateOrgPolicy(
        orgId,
        { session: draft.session, sharing: draft.sharing, retention: draft.retention },
        version
      );
      setSaved(res.policy);
      setDraft(res.policy);
      setVersion(res.version);
      success(t('org.policy.saved', 'Policy saved'));
    } catch (e) {
      // A version conflict (someone else edited) or a validation error — reload so the admin sees
      // the current state, then they can re-apply.
      notifyError(errMsg(e, t('org.policy.saveFailed', 'Could not save the policy')));
      void load();
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setDraft(saved);

  if (loading || !draft) {
    return (
      <AdminSection title={t('org.policy.title', 'Governance policy')}>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t('common.loading', '...')}
        </p>
      </AdminSection>
    );
  }

  return (
    <AdminSection
      title={t('org.policy.title', 'Governance policy')}
      description={t(
        'org.policy.desc',
        'Org-wide security controls, enforced server-side. Metadata only — never your vault keys.'
      )}
      actions={
        <div className="flex gap-2">
          {dirty && (
            <Button variant="secondary" onClick={reset} disabled={busy}>
              {t('common.reset', 'Reset')}
            </Button>
          )}
          <Button onClick={save} disabled={busy || !dirty}>
            {busy ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </Button>
        </div>
      }
    >
      {/* Session / authentication */}
      <h4
        className="text-xs font-semibold uppercase tracking-wide mt-1 mb-1"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {t('org.policy.session.heading', 'Sessions & authentication')}
      </h4>
      <ToggleRow
        label={t('org.policy.mfaRequired.label', 'Require two-factor authentication')}
        desc={t(
          'org.policy.mfaRequired.desc',
          'Members must enrol 2FA to complete a password login. SSO members: configure MFA at your identity provider.'
        )}
        checked={draft.session.mfaRequired}
        onChange={(v) => setSession({ mfaRequired: v })}
        disabled={busy}
      />
      <ToggleRow
        label={t('org.policy.reauth.label', 'Re-authenticate for sensitive actions')}
        desc={t(
          'org.policy.reauth.desc',
          'Prompt for a fresh login before escrow, policy or billing changes.'
        )}
        checked={draft.session.reauthForSensitiveActions}
        onChange={(v) => setSession({ reauthForSensitiveActions: v })}
        disabled={busy}
      />
      <NumberRow
        label={t('org.policy.idleTimeout.label', 'Idle timeout (minutes)')}
        desc={t(
          'org.policy.idleTimeout.desc',
          'Auto-lock after this many idle minutes. Empty = no limit.'
        )}
        value={draft.session.idleTimeoutMinutes}
        onChange={(v) => setSession({ idleTimeoutMinutes: v })}
        placeholder={t('org.policy.noLimit', 'No limit')}
        disabled={busy}
      />
      <NumberRow
        label={t('org.policy.absoluteTimeout.label', 'Absolute session limit (minutes)')}
        desc={t(
          'org.policy.absoluteTimeout.desc',
          'Force re-login after this long regardless of activity. Empty = no limit.'
        )}
        value={draft.session.absoluteTimeoutMinutes}
        onChange={(v) => setSession({ absoluteTimeoutMinutes: v })}
        placeholder={t('org.policy.noLimit', 'No limit')}
        disabled={busy}
      />
      <NumberRow
        label={t('org.policy.offlineGrace.label', 'Offline grace (days)')}
        desc={t(
          'org.policy.offlineGrace.desc',
          'Days a device may run offline on its cached policy before it locks. Empty = client default (30).'
        )}
        value={draft.session.offlineGraceDays}
        onChange={(v) => setSession({ offlineGraceDays: v })}
        placeholder={t('org.policy.clientDefault', 'Default')}
        disabled={busy}
      />

      {/* Sharing (E9-7) */}
      <h4
        className="text-xs font-semibold uppercase tracking-wide mt-5 mb-1"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {t('org.policy.sharing.heading', 'Sharing')}
      </h4>
      <ToggleRow
        label={t('org.policy.externalShares.label', 'Block external share links')}
        desc={t(
          'org.policy.externalShares.desc',
          'Prevent members from creating public/external shares and Filarr Send links.'
        )}
        checked={draft.sharing.externalSharesDisabled}
        onChange={(v) => setSharing({ externalSharesDisabled: v })}
        disabled={busy}
      />
      <ToggleRow
        label={t('org.policy.forcePassword.label', 'Require a password on shares')}
        checked={draft.sharing.forcePassword}
        onChange={(v) => setSharing({ forcePassword: v })}
        disabled={busy}
      />
      <ToggleRow
        label={t('org.policy.forceExpiry.label', 'Require an expiry on shares')}
        checked={draft.sharing.forceExpiry}
        onChange={(v) => setSharing({ forceExpiry: v })}
        disabled={busy}
      />
      <ToggleRow
        label={t(
          'org.policy.restrictDownload.label',
          'View-only (block download of shared content)'
        )}
        desc={t('org.policy.restrictDownload.desc')}
        checked={draft.sharing.restrictDownload}
        onChange={(v) => setSharing({ restrictDownload: v })}
        disabled={busy}
      />
      <NumberRow
        label={t('org.policy.maxExpiry.label', 'Maximum share expiry (days)')}
        desc={t('org.policy.maxExpiry.desc', 'Cap how long a share can live. Empty = uncapped.')}
        value={draft.sharing.maxExpiryDays}
        onChange={(v) => setSharing({ maxExpiryDays: v })}
        placeholder={t('org.policy.uncapped', 'Uncapped')}
        disabled={busy}
      />

      {/* Retention (E9-2) */}
      <h4
        className="text-xs font-semibold uppercase tracking-wide mt-5 mb-1"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {t('org.policy.retention.heading', 'Retention')}
      </h4>
      <InfoCallout>
        {t(
          'org.policy.retention.note',
          'Retention is applied on each member device (the encrypted data lives there, not on the server).'
        )}
      </InfoCallout>
      <NumberRow
        label={t('org.policy.trashRetention.label', 'Purge trash older than (days)')}
        value={draft.retention.trashRetentionDays}
        onChange={(v) => setRetention({ trashRetentionDays: v })}
        placeholder={t('org.policy.keep', 'Keep')}
        disabled={busy}
      />
      <NumberRow
        label={t('org.policy.versionRetention.label', 'Prune note versions older than (days)')}
        value={draft.retention.versionRetentionDays}
        onChange={(v) => setRetention({ versionRetentionDays: v })}
        placeholder={t('org.policy.keep', 'Keep')}
        disabled={busy}
      />
    </AdminSection>
  );
};

export default OrgPolicySection;
