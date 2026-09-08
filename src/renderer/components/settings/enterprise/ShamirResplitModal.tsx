/**
 * ShamirResplitModal (E4 UI) — the multi-party re-split ceremony for a Shamir org: redistribute the
 * shares to the CURRENT admin set and/or change the threshold k, WITHOUT changing the org key (the
 * public key is preserved, so every recovery copy + member consent stays valid). One admin (the
 * COORDINATOR) opens a session and picks the new k; the others confirm the coordinator's fingerprint
 * out-of-band and contribute their current share; once k approvals land, the coordinator combines
 * them, re-splits the same org key for the current admins, and submits. The org private key is
 * reconstructed only transiently in the coordinator's memory and zeroed.
 */

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../../store';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Select } from '../../ui/Dropdown';
import { useNotification } from '../../ui/Notification';
import { InfoCallout } from './AdminPrimitives';
import { StatCard } from './Charts';
import { formatFingerprint } from '../../../utils/formatFingerprint';
import {
  apiGetOpenResplitSession,
  apiGetMyShamirShare,
  type ShamirResplitSessionDetail,
} from '../../../../services/org/orgKeysApi';

interface Props {
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}

const fpStyle: React.CSSProperties = {
  fontSize: 13,
  letterSpacing: '0.06em',
  wordBreak: 'break-word',
};

export const ShamirResplitModal: FC<Props> = ({ orgId, isOpen, onClose, onDone }) => {
  const { t } = useTranslation();
  const { success, error: notifyError } = useNotification();
  const myUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const [session, setSession] = useState<ShamirResplitSessionDetail | null>(null);
  const [hasShare, setHasShare] = useState(false);
  const [n, setN] = useState<number | null>(null);
  const [k, setK] = useState('2');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmedFp, setConfirmedFp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, mine] = await Promise.all([
        apiGetOpenResplitSession(orgId).catch(() => null),
        apiGetMyShamirShare(orgId).catch(() => null),
      ]);
      setSession(s);
      setHasShare(!!mine);
      // Only the coordinator-start path needs the admin count (to bound the new-k selector).
      if (!s) {
        const { countShamirEligibleAdmins } = await import('../../../../services/org/orgKeySync');
        const count = await countShamirEligibleAdmins(orgId).catch(() => 0);
        setN(count);
        setK(String(Math.max(2, Math.ceil((count + 1) / 2))));
      }
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (isOpen) {
      setConfirmedFp(false);
      void load();
    }
  }, [isOpen, load]);

  const kOptions =
    n && n >= 2
      ? Array.from({ length: n - 1 }, (_, i) => ({ value: String(i + 2), label: String(i + 2) }))
      : [];

  const start = async () => {
    setBusy(true);
    try {
      const { openShamirResplitSession } = await import('../../../../services/org/orgKeySync');
      await openShamirResplitSession(orgId, parseInt(k, 10));
      success(t('org.escrow.resplit.started'));
      await load();
    } catch (e) {
      notifyError((e as Error)?.message || t('org.escrow.resplit.error'));
    } finally {
      setBusy(false);
    }
  };

  const contribute = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { contributeResplitShare } = await import('../../../../services/org/orgKeySync');
      const ok = await contributeResplitShare(orgId, session);
      if (ok) {
        success(t('org.escrow.resplit.contributed'));
        await load();
      } else {
        notifyError(t('org.escrow.resplit.noShare'));
      }
    } catch {
      notifyError(t('org.escrow.resplit.error'));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { completeShamirResplit } = await import('../../../../services/org/orgKeySync');
      const res = await completeShamirResplit(orgId, session.sessionId);
      success(t('org.escrow.resplit.done', { k: res.kThreshold, n: res.nShares }));
      onDone();
      onClose();
    } catch {
      notifyError(t('org.escrow.resplit.completeError'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { apiCancelResplitSession } = await import('../../../../services/org/orgKeysApi');
      await apiCancelResplitSession(orgId, session.sessionId);
      success(t('org.escrow.resplit.cancelled'));
      await load();
    } catch {
      notifyError(t('org.escrow.resplit.error'));
    } finally {
      setBusy(false);
    }
  };

  const isCoordinator = !!session && session.coordinatorUserId === myUserId;
  const enough = !!session && session.approvalsSoFar >= session.kThreshold;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('org.escrow.resplit.title')} size="md">
      <ModalBody>
        {loading ? (
          <p style={{ opacity: 0.6 }}>{t('common.loading', 'Loading…')}</p>
        ) : !session ? (
          hasShare ? (
            <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
              <p style={{ margin: 0 }}>{t('org.escrow.resplit.startIntro')}</p>
              {n === null ? (
                <p style={{ opacity: 0.6 }}>{t('common.loading', 'Loading…')}</p>
              ) : n < 2 ? (
                <InfoCallout tone="danger">{t('org.escrow.resplit.needAdmins')}</InfoCallout>
              ) : (
                <>
                  <Select
                    label={t('org.escrow.resplit.threshold', { n })}
                    options={kOptions}
                    value={k}
                    onChange={(v) => setK(Array.isArray(v) ? v[0] : v)}
                  />
                  <InfoCallout tone="info">
                    {t('org.escrow.resplit.thresholdHint', { k, n })}
                  </InfoCallout>
                </>
              )}
              <InfoCallout tone="info">{t('org.escrow.resplit.startHint')}</InfoCallout>
            </div>
          ) : (
            <InfoCallout tone="info">{t('org.escrow.resplit.noSessionNoShare')}</InfoCallout>
          )
        ) : isCoordinator ? (
          <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
            <div className="ent-statgrid">
              <StatCard
                label={t('org.escrow.resplit.approvals')}
                value={`${session.approvalsSoFar} / ${session.kThreshold}`}
              />
              <StatCard label={t('org.escrow.resplit.newK')} value={String(session.targetK)} />
            </div>
            <InfoCallout tone="info">{t('org.escrow.resplit.coordShareFp')}</InfoCallout>
            <div className="ent-mono" style={fpStyle}>
              {formatFingerprint(session.coordinatorFingerprint)}
            </div>
            {!enough && (
              <InfoCallout tone="info">
                {t('org.escrow.resplit.waiting', {
                  have: session.approvalsSoFar,
                  need: session.kThreshold,
                })}
              </InfoCallout>
            )}
          </div>
        ) : hasShare ? (
          <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
            <p style={{ margin: 0 }}>{t('org.escrow.resplit.approveIntro')}</p>
            <InfoCallout tone="danger">{t('org.escrow.resplit.verifyCoord')}</InfoCallout>
            <div className="ent-mono" style={fpStyle}>
              {formatFingerprint(session.coordinatorFingerprint)}
            </div>
            <Checkbox
              checked={confirmedFp}
              onChange={(e) => setConfirmedFp(e.target.checked)}
              label={t('org.escrow.resplit.confirmFp')}
            />
          </div>
        ) : (
          <InfoCallout tone="info">
            {t('org.escrow.resplit.inProgress', {
              have: session.approvalsSoFar,
              need: session.kThreshold,
            })}
          </InfoCallout>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.close', 'Close')}
        </Button>
        {!loading && session && (
          <Button variant="secondary" onClick={load} disabled={busy}>
            {t('common.refresh', 'Refresh')}
          </Button>
        )}
        {!loading && !session && hasShare && (
          <Button variant="primary" loading={busy} disabled={!n || n < 2} onClick={start}>
            {t('org.escrow.resplit.start')}
          </Button>
        )}
        {!loading && session && !isCoordinator && hasShare && (
          <Button variant="primary" loading={busy} disabled={!confirmedFp} onClick={contribute}>
            {t('org.escrow.resplit.contribute')}
          </Button>
        )}
        {!loading && session && isCoordinator && (
          <Button variant="danger" onClick={cancel} disabled={busy}>
            {t('org.escrow.resplit.cancel')}
          </Button>
        )}
        {!loading && session && isCoordinator && (
          <Button variant="primary" loading={busy} disabled={!enough} onClick={complete}>
            {t('org.escrow.resplit.complete')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default ShamirResplitModal;
