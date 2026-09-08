/**
 * RequestAccountResetModal (E4-5 UI) — member-facing. After a member loses their password and
 * re-keys, their team-vault memberships are sealed to the OLD key and won't decrypt. This opens a
 * recovery-reset request (requestAccountReset) so an admin can restore their team-vault access by
 * re-sealing each escrowed vault key to the member's NEW key. Personal vaults are not recoverable.
 */

import React, { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { selectCurrentOrgId } from '../../../store/selectors/authSelectors';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { InfoCallout } from './enterprise/AdminPrimitives';
import { useNotification } from '../ui/Notification';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const RequestAccountResetModal: FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { success, error: notifyError } = useNotification();
  const orgId = useSelector(selectCurrentOrgId);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      const { requestAccountReset } = await import('../../../services/org/orgKeySync');
      const id = await requestAccountReset(orgId, reason.trim() || undefined);
      if (id) {
        success(t('org.escrow.requestReset.done'));
        onClose();
      } else {
        notifyError(t('org.escrow.requestReset.error'));
      }
    } catch (e) {
      notifyError((e as Error)?.message || t('org.escrow.requestReset.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('org.escrow.requestReset.title')} size="md">
      <ModalBody>
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <p style={{ margin: 0 }}>{t('org.escrow.requestReset.intro')}</p>
          <InfoCallout tone="info">{t('org.escrow.requestReset.hint')}</InfoCallout>
          <Input
            label={t('org.escrow.requestReset.reasonLabel')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('org.escrow.requestReset.reasonPlaceholder')}
            maxLength={500}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" loading={busy} disabled={!orgId} onClick={submit}>
          {t('org.escrow.requestReset.submit')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default RequestAccountResetModal;
