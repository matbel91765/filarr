/**
 * OrgGovernanceSection — E9-10 admin disclosure of how governance policy enforcement actually behaves.
 *
 * The honest counterpart to the policy editor: it tells the admin that client-side enforcement is
 * BEST-EFFORT and that offline devices keep running their last cached policy, so a hardened policy is
 * never instantly universal. It distinguishes devices seen recently (policy likely applied) from
 * devices offline beyond the grace window (pending), and states plainly what cannot be enforced in a
 * zero-knowledge model. No content, no keys — device metadata + the configured grace window only.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import apiClient from '../../../services/network/apiClient';
import { AdminSection, InfoCallout, StatusBadge } from './enterprise/AdminPrimitives';
import { DEFAULT_OFFLINE_GRACE_DAYS } from '../../../store/slices/governanceSlice';
import type { OrgRole } from '../../../types/org';

interface DeviceRow {
  id: string;
  lastSeenAt: string | null;
  wipeRequestedAt?: string | null;
  revokedAt?: string | null;
}

const RECENT_MS = 24 * 60 * 60 * 1000; // "seen recently" = within 24h

const OrgGovernanceSection: React.FC<{ orgId: string; myRole: OrgRole }> = ({ orgId }) => {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [graceDays, setGraceDays] = useState<number | null>(null);
  const [retention, setRetention] = useState<{
    versionRetentionDays: number | null;
    trashRetentionDays: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const [dRes, pRes] = await Promise.allSettled([
        apiClient.get(`/org/${orgId}/devices`),
        apiClient.get(`/org/${orgId}/policies`),
      ]);
      if (cancelled) return;
      if (dRes.status === 'fulfilled') {
        setDevices((dRes.value.data?.data?.devices as DeviceRow[]) ?? []);
      }
      if (pRes.status === 'fulfilled') {
        const v = pRes.value.data?.data?.policy?.session?.offlineGraceDays;
        setGraceDays(typeof v === 'number' ? v : null);
        const r = pRes.value.data?.data?.policy?.retention;
        setRetention(
          r
            ? {
                versionRetentionDays:
                  typeof r.versionRetentionDays === 'number' ? r.versionRetentionDays : null,
                trashRetentionDays:
                  typeof r.trashRetentionDays === 'number' ? r.trashRetentionDays : null,
              }
            : null
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const now = Date.now();
  const list = devices ?? [];
  const active = list.filter((d) => !d.revokedAt);
  const seen = active.filter(
    (d) => d.lastSeenAt && now - new Date(d.lastSeenAt).getTime() < RECENT_MS
  ).length;
  const pending = active.length - seen;
  const effectiveGrace = graceDays ?? DEFAULT_OFFLINE_GRACE_DAYS;

  return (
    <AdminSection
      title={t('org.governance.title', 'Governance & offline enforcement')}
      description={t('org.governance.desc', {
        defaultValue:
          'How your governance policies actually apply across member devices — and what is, and is not, enforceable.',
      })}
    >
      <InfoCallout tone="info">
        {t('org.governance.bestEffort', {
          defaultValue:
            'Policy enforcement is best-effort and client-applied. A device that is offline keeps running the policy it last cached, so a hardened policy is not instantly universal. The Worker remains authoritative for what it can enforce server-side: token issuance/refresh, IP allowlist, and remote sign-out at next connect.',
        })}
      </InfoCallout>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--spacing-4)',
          margin: 'var(--spacing-4) 0',
        }}
      >
        <div>
          <p className="ent-section__desc" style={{ marginBottom: 4 }}>
            {t('org.governance.applied', 'Applied (devices seen in the last 24h)')}
          </p>
          <StatusBadge tone="success" dot>
            {loading ? '…' : seen}
          </StatusBadge>
        </div>
        <div>
          <p className="ent-section__desc" style={{ marginBottom: 4 }}>
            {t('org.governance.pending', 'Pending (offline devices on a cached policy)')}
          </p>
          <StatusBadge tone={pending > 0 ? 'warning' : 'neutral'} dot>
            {loading ? '…' : pending}
          </StatusBadge>
        </div>
        <div>
          <p className="ent-section__desc" style={{ marginBottom: 4 }}>
            {t('org.governance.graceLabel', 'Offline grace window')}
          </p>
          <StatusBadge tone="info">
            {effectiveGrace} {t('org.governance.daysUnit', 'days')}
            {graceDays === null ? ` ${t('org.governance.graceDefault', '(default)')}` : ''}
          </StatusBadge>
        </div>
      </div>

      <p className="ent-section__desc">
        {t('org.governance.offlineCaveat', {
          days: effectiveGrace,
          defaultValue:
            'Offline devices apply the cached idle-lock and grace window locally (forgetting their key after {{days}} days offline), but absolute-session expiry, IP allowlist, policy updates, and remote-wipe only take effect at the next successful connection. These local guards are best-effort and can be bypassed offline by a determined user who holds the password.',
        })}
      </p>

      {/* E9-2: data retention — applied on each member's device (versions at write time, trash on a
          timer). Disclosed as client-applied/best-effort like the rest of the governance controls. */}
      <p className="ent-section__desc" style={{ marginTop: 'var(--spacing-4)', fontWeight: 600 }}>
        {t('org.governance.retention.title', 'Data retention (client-applied)')}
      </p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--spacing-4)',
          margin: 'var(--spacing-2) 0',
        }}
      >
        <StatusBadge tone={retention?.versionRetentionDays ? 'info' : 'neutral'}>
          {t('org.governance.retention.versions', 'Note versions')}:{' '}
          {retention?.versionRetentionDays
            ? `${retention.versionRetentionDays} ${t('org.governance.daysUnit', 'days')}`
            : t('org.governance.retention.unset', 'not set')}
        </StatusBadge>
        <StatusBadge tone={retention?.trashRetentionDays ? 'info' : 'neutral'}>
          {t('org.governance.retention.trash', 'Trash')}:{' '}
          {retention?.trashRetentionDays
            ? `${retention.trashRetentionDays} ${t('org.governance.daysUnit', 'days')}`
            : t('org.governance.retention.unset', 'not set')}
        </StatusBadge>
      </div>
      <p className="ent-section__desc">
        {t('org.governance.retention.caveat', {
          defaultValue:
            "Retention runs on each member device: version history is pruned as notes are saved, and trashed items are purged on a periodic sweep. It is best-effort (a determined offline user can defer it). IMPORTANT: it does NOT yet exclude a member's LOCAL data under a legal hold — a held member's trashed notes and old versions may still be pruned on their own device. The authoritative synced/vault copy stays preserved by the server-side legal-hold gates; full client-side hold exclusion is planned.",
        })}
      </p>

      {/* E9-9: honest DLP reframe — server-side content scanning is impossible under zero-knowledge. */}
      <p className="ent-section__desc" style={{ marginTop: 'var(--spacing-4)', fontWeight: 600 }}>
        {t('org.governance.dlp.title', 'Data loss prevention (DLP)')}
      </p>
      <InfoCallout tone="info">
        {t('org.governance.dlp.body', {
          defaultValue:
            'Filarr is zero-knowledge: the server only ever holds ciphertext, so it cannot scan or classify your content — there is no server-side content DLP, and we never claim there is. Your real DLP controls are the metadata/ciphertext ones above: share governance, session/IP allowlist, device revoke + remote-wipe, retention + legal hold, and the tamper-evident audit log. To plug into an endpoint-DLP or SIEM (CrowdStrike, Microsoft Purview, Splunk…), add an audit Sink (the SIEM tab) pointing at your collector — Filarr streams metadata-only events (never content) for it to act on. Post-decryption controls (no-copy/print/watermark) cannot be server-enforced and are only ever a best-effort endpoint agent.',
        })}
      </InfoCallout>
    </AdminSection>
  );
};

export default OrgGovernanceSection;
