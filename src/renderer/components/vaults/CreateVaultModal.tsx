/**
 * CreateVaultModal (E3-8) — name a new team vault.
 *
 * The crypto (generate K_vault, seal it to our own E2 key, encrypt the name) all
 * happens inside the createVault thunk; this modal only collects the plaintext name
 * and surfaces the two failure modes the thunk distinguishes: account-locked (no
 * keypair yet) vs a generic create failure.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { Modal, ModalBody, ModalFooter, Input, Button } from '../ui';
import { useNotification } from '../ui/Notification';
import type { AppDispatch } from '../../../store';
import { createVault } from '../../../store/slices/vaultsSlice';
import { vaultErrorKey } from '../../../services/vault/vaultErrorMessages';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new vault id so the caller can select it. */
  onCreated?: (vaultId: string) => void;
}

export const CreateVaultModal: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setName('');
    onClose();
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const vault = await dispatch(createVault({ name: trimmed })).unwrap();
      success(t('teamVaults.created'));
      onCreated?.(vault.id);
      setName('');
      onClose();
    } catch (e) {
      // createVault rejectWithValue is a plain string: either a sentence (the
      // no-keypair path) or the Worker's error code — `upgrade_required` above all,
      // which is the whole point of a plan gate and must not read as a failure.
      const msg = String((e as Error)?.message ?? e);
      error(
        /unlock your account/i.test(msg)
          ? t('teamVaults.errors.noAccount')
          : t(vaultErrorKey(msg, 'teamVaults.errors.create'))
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title={t('teamVaults.createTitle')} size="sm">
      <ModalBody>
        <Input
          label={t('teamVaults.nameLabel')}
          placeholder={t('teamVaults.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate();
          }}
          fullWidth
          autoFocus
          disabled={busy}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={handleCreate} loading={busy} disabled={!name.trim()}>
          {busy ? t('teamVaults.creating') : t('teamVaults.create')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateVaultModal;
