/**
 * ShamirResetModal (E4-6c UI) — the multi-party k-of-n recovery flow for one reset request under a
 * Shamir org. One admin (the COORDINATOR) opens a session; the others confirm the coordinator's
 * fingerprint out-of-band and contribute their re-sealed share; once k approvals land, the
 * coordinator combines them and completes the reset. The org private key is reconstructed only in
 * the coordinator's memory, transiently, and zeroed.
 */

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../../store';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { useNotification } from '../../ui/Notification';
import { InfoCallout } from './AdminPrimitives';
import { StatCard } from './Charts';
import { formatFingerprint } from '../../../utils/formatFingerprint';
import {
  apiGetShamirSessionForRequest,
  apiGetMyShamirShare,
  type ShamirSessionDetail,
} from '../../../../services/org/orgKeysApi';

interface Props {
  orgId: string;
  reqId: string;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}

const fpStyle: React.CSSProperties = {
  fontSize: 13,
  letterSpacing: '0.06em',
  wordBreak: 'break-word',
};

export const ShamirResetModal: FC<Props> = ({ orgId, reqId, isOpen, onClose, onDone }) => {
  const { t } = useTranslation();
  const { success, error: notifyError } = useNotification();
  const myUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const [session, setSession] = useState<ShamirSessionDetail | null>(null);
  const [hasShare, setHasShare] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmedFp, setConfirmedFp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, mine] = await Promise.all([
        apiGetShamirSessionForRequest(orgId, reqId).catch(() => null),
        apiGetMyShamirShare(orgId).catch(() => null),
      ]);
      setSession(s);
      setHasShare(!!mine);
    } finally {
      setLoading(false);
    }
  }, [orgId, reqId]);

  useEffect(() => {
    if (isOpen) {
      setConfirmedFp(false);
      void load();
    }
  }, [isOpen, load]);

  const start = async () => {
    setBusy(true);
    try {
      const { openShamirResetSession } = await import('../../../../services/org/orgKeySync');
      await openShamirResetSession(orgId, reqId);
      success(t('org.escrow.shamirReset.started'));
      await load();
    } catch {
      notifyError(t('org.escrow.shamirReset.error'));
    } finally {
      setBusy(false);
    }
  };

  const contribute = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { contributeShamirShare } = await import('../../../../services/org/orgKeySync');
      const ok = await contributeShamirShare(orgId, session);
      if (ok) {
        success(t('org.escrow.shamirReset.contributed'));
        await load();
      } else {
        notifyError(t('org.escrow.shamirReset.noShare'));
      }
    } catch {
      notifyError(t('org.escrow.shamirReset.error'));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { completeMemberResetShamir } = await import('../../../../services/org/orgKeySync');
      const count = await completeMemberResetShamir(orgId, reqId, session.sessionId);
      success(t('org.escrow.reset.restored', { count }));
      onDone();
      onClose();
    } catch {
      notifyError(t('org.escrow.shamirReset.completeError'));
    } finally {
      setBusy(false);
    }
  };

  const isCoordinator = !!session && session.coordinatorUserId === myUserId;
  const enough = !!session && session.approvalsSoFar >= session.kThreshold;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('org.escrow.shamirReset.title')} size="md">
      <ModalBody>
        {loading ? (
          <p style={{ opacity: 0.6 }}>{t('common.loading', 'Loading…')}</p>
        ) : !session ? (
          hasShare ? (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <p style={{ margin: 0 }}>{t('org.escrow.shamirReset.startIntro')}</p>
              <InfoCallout tone="info">{t('org.escrow.shamirReset.startHint')}</InfoCallout>
            </div>
          ) : (
            <InfoCallout tone="info">{t('org.escrow.shamirReset.noSessionNoShare')}</InfoCallout>
          )
        ) : isCoordinator ? (
          <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
            <div className="ent-statgrid">
              <StatCard
                label={t('org.escrow.shamirReset.approvals')}
                value={`${session.approvalsSoFar} / ${session.kThreshold}`}
              />
            </div>
            <InfoCallout tone="info">{t('org.escrow.shamirReset.coordShareFp')}</InfoCallout>
            <div className="ent-mono" style={fpStyle}>
              {formatFingerprint(session.coordinatorFingerprint)}
            </div>
            {!enough && (
              <InfoCallout tone="info">
                {t('org.escrow.shamirReset.waiting', {
                  have: session.approvalsSoFar,
                  need: session.kThreshold,
                })}
              </InfoCallout>
            )}
          </div>
        ) : hasShare ? (
          <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
            <p style={{ margin: 0 }}>{t('org.escrow.shamirReset.approveIntro')}</p>
            <InfoCallout tone="danger">{t('org.escrow.shamirReset.verifyCoord')}</InfoCallout>
            <div className="ent-mono" style={fpStyle}>
              {formatFingerprint(session.coordinatorFingerprint)}
            </div>
            <Checkbox
              checked={confirmedFp}
              onChange={(e) => setConfirmedFp(e.target.checked)}
              label={t('org.escrow.shamirReset.confirmFp')}
            />
          </div>
        ) : (
          <InfoCallout tone="info">
            {t('org.escrow.shamirReset.inProgress', {
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
          <Button variant="primary" loading={busy} onClick={start}>
            {t('org.escrow.shamirReset.start')}
          </Button>
        )}
        {!loading && session && !isCoordinator && hasShare && (
          <Button variant="primary" loading={busy} disabled={!confirmedFp} onClick={contribute}>
            {t('org.escrow.shamirReset.contribute')}
          </Button>
        )}
        {!loading && session && isCoordinator && (
          <Button variant="primary" loading={busy} disabled={!enough} onClick={complete}>
            {t('org.escrow.shamirReset.complete')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default ShamirResetModal;
