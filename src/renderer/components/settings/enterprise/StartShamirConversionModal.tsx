/**
 * StartShamirConversionModal (E4-6b UI) — convert org_key → Shamir k-of-n. The admin picks the
 * threshold k (2..n, where n = admins holding a keypair); on confirm, convertOrgKeyToShamir splits
 * the EXISTING org private key in place (public key unchanged → recovery copies stay valid) and the
 * server destroys the whole-wraps so no single admin can recover alone. One-way (closes T1).
 */

import React, { FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal';
import { Select } from '../../ui/Dropdown';
import { Button } from '../../ui/Button';
import { InfoCallout } from './AdminPrimitives';
import { useNotification } from '../../ui/Notification';

interface Props {
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
  onConverted: () => void;
}

export const StartShamirConversionModal: FC<Props> = ({ orgId, isOpen, onClose, onConverted }) => {
  const { t } = useTranslation();
  const { success, error: notifyError } = useNotification();
  const [n, setN] = useState<number | null>(null);
  const [k, setK] = useState('2');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setN(null);
    let live = true;
    void (async () => {
      try {
        const { countShamirEligibleAdmins } = await import('../../../../services/org/orgKeySync');
        const count = await countShamirEligibleAdmins(orgId);
        if (!live) return;
        setN(count);
        setK(String(Math.max(2, Math.ceil((count + 1) / 2)))); // default: a majority
      } catch {
        if (live) setN(0);
      }
    })();
    return () => {
      live = false;
    };
  }, [isOpen, orgId]);

  const options =
    n && n >= 2
      ? Array.from({ length: n - 1 }, (_, i) => ({ value: String(i + 2), label: String(i + 2) }))
      : [];

  const convert = async () => {
    setBusy(true);
    try {
      const { convertOrgKeyToShamir } = await import('../../../../services/org/orgKeySync');
      const ok = await convertOrgKeyToShamir(orgId, parseInt(k, 10));
      if (ok) {
        success(t('org.escrow.shamir.converted'));
        onConverted();
        onClose();
      } else {
        notifyError(t('org.escrow.shamir.convertError'));
      }
    } catch (e) {
      notifyError((e as Error)?.message || t('org.escrow.shamir.convertError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('org.escrow.shamir.convertTitle')} size="md">
      <ModalBody>
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <p style={{ margin: 0 }}>{t('org.escrow.shamir.convertIntro')}</p>
          {n === null ? (
            <p style={{ opacity: 0.6 }}>{t('common.loading', 'Loading…')}</p>
          ) : n < 2 ? (
            <InfoCallout tone="danger">{t('org.escrow.shamir.needAdmins')}</InfoCallout>
          ) : (
            <>
              <Select
                label={t('org.escrow.shamir.threshold', { n })}
                options={options}
                value={k}
                onChange={(v) => setK(Array.isArray(v) ? v[0] : v)}
              />
              <InfoCallout tone="info">
                {t('org.escrow.shamir.thresholdHint', { k, n })}
              </InfoCallout>
            </>
          )}
          <InfoCallout tone="danger">{t('org.escrow.shamir.irreversible')}</InfoCallout>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" loading={busy} disabled={!n || n < 2} onClick={convert}>
          {t('org.escrow.shamir.convertConfirm')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default StartShamirConversionModal;
