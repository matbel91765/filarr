/**
 * OrgEscrowSection (E4 UI) — the "Recovery" dashboard tab. Owner/admin view of the org escrow key:
 * policy (off / org_key / shamir), the key's safety number + KT status, recovery-copy count,
 * pending reset requests (read-only here), and the org-key rotation danger zone. The Shamir flows
 * (conversion, multi-party reset approval) live in their own panels; this composes the org_key UX.
 */

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AdminSection,
  StatusBadge,
  InfoCallout,
  DangerZone,
  RelativeTime,
  CopyableId,
  type BadgeTone,
} from './AdminPrimitives';
import { StatCard } from './Charts';
import { OrgKeyFingerprintPanel } from './OrgKeyFingerprintPanel';
import { StartShamirConversionModal } from './StartShamirConversionModal';
import { ShamirResetModal } from './ShamirResetModal';
import { ShamirResplitModal } from './ShamirResplitModal';
import OrgEscrowConsentBanner from '../OrgEscrowConsentBanner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { useNotification } from '../../ui/Notification';
import {
  apiGetOrgPublicKey,
  apiGetOrgKeyLog,
  apiGetAllRecoveryWraps,
  apiListResetRequests,
  apiSetEscrowPolicy,
  type OrgPublicKey,
  type ResetRequestSummary,
} from '../../../../services/org/orgKeysApi';
import type { KeyLogEntry } from '../../../../services/vault/keyTransparency';
import type { OrgRole } from '../../../../types/org';

interface Props {
  orgId: string;
  myRole: OrgRole;
}

const POLICY_TONE: Record<string, BadgeTone> = { off: 'neutral', org_key: 'info', shamir: 'brand' };

const OrgEscrowSection: FC<Props> = ({ orgId }) => {
  const { t } = useTranslation();
  const { success, error: notifyError } = useNotification();
  const [orgPub, setOrgPub] = useState<OrgPublicKey | null>(null);
  const [entries, setEntries] = useState<KeyLogEntry[]>([]);
  const [copyCount, setCopyCount] = useState<number | null>(null);
  const [requests, setRequests] = useState<ResetRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [orgKeyTrusted, setOrgKeyTrusted] = useState(true);
  const [confirmComplete, setConfirmComplete] = useState<ResetRequestSummary | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [showShamirConvert, setShowShamirConvert] = useState(false);
  const [showResplit, setShowResplit] = useState(false);
  const [shamirResetReq, setShamirResetReq] = useState<ResetRequestSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pub, log] = await Promise.all([
        apiGetOrgPublicKey(orgId),
        apiGetOrgKeyLog(orgId).catch(() => [] as KeyLogEntry[]),
      ]);
      setOrgPub(pub);
      setEntries(log);
      void apiListResetRequests(orgId, 'pending')
        .then(setRequests)
        .catch(() => undefined);
      void apiGetAllRecoveryWraps(orgId)
        .then((c) => setCopyCount(c.length))
        .catch(() => setCopyCount(null));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setPolicy = async (policy: 'off' | 'org_key') => {
    setBusy(true);
    try {
      await apiSetEscrowPolicy(orgId, policy);
      success(t('org.escrow.policyUpdated'));
      await load();
    } catch {
      notifyError(t('org.escrow.policyError'));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    setConfirmRotate(false);
    setBusy(true);
    try {
      const { rotateOrgKeypair } = await import('../../../../services/org/orgKeySync');
      const res = await rotateOrgKeypair(orgId);
      if (res) {
        success(t('org.escrow.rotated', { count: res.rewrapped }));
        await load();
      } else {
        notifyError(t('org.escrow.rotateUnavailable'));
      }
    } catch {
      notifyError(t('org.escrow.rotateError'));
    } finally {
      setBusy(false);
    }
  };

  const completeReset = async (req: ResetRequestSummary) => {
    setConfirmComplete(null);
    setCompleting(req.id);
    try {
      const { completeMemberReset } = await import('../../../../services/org/orgKeySync');
      const count = await completeMemberReset(orgId, req.id);
      success(t('org.escrow.reset.restored', { count }));
      await load();
    } catch {
      notifyError(t('org.escrow.reset.completeError'));
    } finally {
      setCompleting(null);
    }
  };

  if (loading) return <InfoCallout>{t('common.loading', 'Loading…')}</InfoCallout>;
  if (!orgPub) return <InfoCallout>{t('org.escrow.noKey')}</InfoCallout>;

  const policy = orgPub.escrowPolicy;
  const isShamir = policy === 'shamir';

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      {/* The admin is also a member — let them grant/withdraw their own recovery consent here. */}
      <OrgEscrowConsentBanner />

      <AdminSection title={t('org.escrow.title')} description={t('org.escrow.desc')}>
        <div className="ent-statgrid">
          <StatCard
            label={t('org.escrow.stat.policy')}
            value={
              <StatusBadge tone={POLICY_TONE[policy] ?? 'neutral'}>
                {t(`org.escrow.policy.${policy}`)}
              </StatusBadge>
            }
          />
          <StatCard label={t('org.escrow.stat.keyVersion')} value={`v${orgPub.keyVersion}`} />
          <StatCard label={t('org.escrow.stat.copies')} value={copyCount ?? '—'} />
          <StatCard label={t('org.escrow.stat.pendingResets')} value={requests.length} />
        </div>
      </AdminSection>

      <AdminSection title={t('org.escrow.keyTitle')} description={t('org.escrow.keyDesc')}>
        <OrgKeyFingerprintPanel
          orgId={orgId}
          encPublicKey={orgPub.encPublicKey}
          fingerprint={orgPub.fingerprint}
          entries={entries}
          onTrustChange={setOrgKeyTrusted}
        />
        {!orgKeyTrusted && (
          <div style={{ marginTop: 'var(--spacing-3)' }}>
            <InfoCallout tone="danger">{t('org.escrow.keyUntrusted')}</InfoCallout>
          </div>
        )}
      </AdminSection>

      <AdminSection title={t('org.escrow.policyTitle')} description={t('org.escrow.policyDesc')}>
        {isShamir ? (
          <InfoCallout tone="info">{t('org.escrow.shamirActive')}</InfoCallout>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
            <Button
              variant={policy === 'off' ? 'secondary' : 'ghost'}
              disabled={busy || policy === 'off'}
              onClick={() => setPolicy('off')}
            >
              {t('org.escrow.action.disable')}
            </Button>
            <Button
              variant={policy === 'org_key' ? 'secondary' : 'primary'}
              disabled={busy || policy === 'org_key'}
              onClick={() => setPolicy('org_key')}
            >
              {t('org.escrow.action.enableOrgKey')}
            </Button>
            {policy === 'org_key' && (
              <Button variant="primary" disabled={busy} onClick={() => setShowShamirConvert(true)}>
                {t('org.escrow.action.convertShamir')}
              </Button>
            )}
          </div>
        )}
        {policy === 'org_key' && (
          <div style={{ marginTop: 'var(--spacing-3)' }}>
            <InfoCallout tone="info">{t('org.escrow.orgKeyNote')}</InfoCallout>
          </div>
        )}
      </AdminSection>

      <AdminSection title={t('org.escrow.resetsTitle')} description={t('org.escrow.resetsDesc')}>
        {requests.length === 0 ? (
          <p style={{ opacity: 0.6, margin: 0 }}>{t('org.escrow.noResets')}</p>
        ) : (
          <div>
            {requests.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'var(--spacing-2) 0',
                  gap: 'var(--spacing-3)',
                  borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
                }}
              >
                <CopyableId value={r.memberUserId} prefix={t('org.escrow.member')} />
                <span className="ent-mono" style={{ fontSize: 12, opacity: 0.8 }}>
                  {r.newKeyFingerprint.slice(0, 14)}…
                </span>
                <RelativeTime ms={Date.parse(r.createdAt)} />
                <Button
                  variant="primary"
                  size="sm"
                  loading={completing === r.id}
                  disabled={(!!completing && completing !== r.id) || (!isShamir && !orgKeyTrusted)}
                  onClick={() => (isShamir ? setShamirResetReq(r) : setConfirmComplete(r))}
                >
                  {isShamir ? t('org.escrow.shamirReset.action') : t('org.escrow.action.complete')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {isShamir && requests.length > 0 && (
          <p style={{ opacity: 0.6, marginTop: 'var(--spacing-3)', marginBottom: 0, fontSize: 12 }}>
            {t('org.escrow.shamirReset.note')}
          </p>
        )}
      </AdminSection>

      <DangerZone title={t('org.escrow.rotateTitle')} hint={t('org.escrow.rotateHint')}>
        {isShamir ? (
          <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
            <InfoCallout tone="info">{t('org.escrow.resplit.dangerNote')}</InfoCallout>
            <div>
              <Button variant="danger" disabled={busy} onClick={() => setShowResplit(true)}>
                {t('org.escrow.resplit.action')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="danger"
            disabled={busy || policy === 'off'}
            onClick={() => setConfirmRotate(true)}
          >
            {t('org.escrow.action.rotate')}
          </Button>
        )}
      </DangerZone>

      <ConfirmModal
        isOpen={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        onConfirm={rotate}
        title={t('org.escrow.rotateConfirmTitle')}
        message={t('org.escrow.rotateConfirmMsg')}
        variant="warning"
      />

      <ConfirmModal
        isOpen={confirmComplete !== null}
        onClose={() => setConfirmComplete(null)}
        onConfirm={() => confirmComplete && completeReset(confirmComplete)}
        title={t('org.escrow.reset.completeConfirmTitle')}
        message={t('org.escrow.reset.completeConfirmMsg', {
          fingerprint: confirmComplete?.newKeyFingerprint.slice(0, 14) ?? '',
        })}
        variant="warning"
      />

      <StartShamirConversionModal
        orgId={orgId}
        isOpen={showShamirConvert}
        onClose={() => setShowShamirConvert(false)}
        onConverted={load}
      />

      <ShamirResplitModal
        orgId={orgId}
        isOpen={showResplit}
        onClose={() => setShowResplit(false)}
        onDone={load}
      />

      {shamirResetReq && (
        <ShamirResetModal
          orgId={orgId}
          reqId={shamirResetReq.id}
          isOpen={shamirResetReq !== null}
          onClose={() => setShamirResetReq(null)}
          onDone={load}
        />
      )}
    </div>
  );
};

export default OrgEscrowSection;
