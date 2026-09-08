/**
 * DeleteAccountModal — Permanent account deletion
 *
 * Step 1: Warning + email confirmation
 * Step 2: Loading spinner during deletion
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import Modal, { ModalBody } from '../ui/Modal/Modal';
import { clearCloudAuth, setSyncEnabled } from '../../../store/slices/authSlice';
import * as authApi from '../../../services/auth/authApi';
import type { AppDispatch } from '../../../store';
import { vaultErrorKey } from '../../../services/vault/vaultErrorMessages';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}

const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({ isOpen, onClose, userEmail }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (deleting) return; // prevent close during deletion
    setConfirmEmail('');
    setError(null);
    onClose();
  };

  const emailMatches = confirmEmail.toLowerCase() === userEmail.toLowerCase();

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const result = await authApi.deleteAccount();
      if (result.success) {
        // Account is gone server-side; also stop the local daemon so it
        // doesn't keep retrying against a nonexistent identity.
        await authApi.setSyncEnabled(false);
        dispatch(clearCloudAuth());
        dispatch(setSyncEnabled(false));
        handleClose();
      } else {
        // Le code d'abord : `vault_owner_must_hand_over` a sa phrase, en deux
        // langues, et elle dit quoi faire — transmettre ou supprimer les coffres
        // partagés avant de revenir. Le message brut du serveur ne servait que
        // de repli, en anglais, sur le seul refus actionnable de ce dialogue.
        setError(
          result.code
            ? t(vaultErrorKey(result.code, 'settings.deleteAccount.failed'), {
                count: result.vaultCount ?? 0,
              })
            : result.error || t('settings.deleteAccount.failed')
        );
        setDeleting(false);
      }
    } catch {
      setError(t('settings.deleteAccount.networkError'));
      setDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('settings.deleteAccount.title', 'Supprimer mon compte')}
      size="md"
    >
      <ModalBody>
        {deleting ? (
          /* Step 2: Loading */
          <div className="text-center py-8">
            <svg
              className="animate-spin w-8 h-8 mx-auto mb-4"
              style={{ color: '#dc2626' }}
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
              <path
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                opacity="0.75"
              />
            </svg>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('settings.deleteAccount.deleting', 'Suppression en cours...')}
            </p>
          </div>
        ) : (
          /* Step 1: Warning + confirmation */
          <div>
            {/* Warning */}
            <div
              className="flex items-start gap-2 p-4 rounded-lg mb-5 text-sm"
              style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b' }}
            >
              <span className="flex-shrink-0 text-lg">&#9888;&#65039;</span>
              <div>
                <p className="font-semibold mb-1">
                  {t('settings.deleteAccount.warningTitle', 'Cette action est irréversible')}
                </p>
                <p>
                  {t(
                    'settings.deleteAccount.warningText',
                    'Votre compte et toutes vos données cloud seront définitivement supprimés. Vos fichiers locaux ne sont pas affectés.'
                  )}
                </p>
              </div>
            </div>

            {/* Email confirmation */}
            <div className="mb-4">
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('settings.deleteAccount.confirmLabel', 'Saisissez votre email pour confirmer')}
              </label>
              <input
                type="email"
                value={confirmEmail}
                onChange={(e) => {
                  setConfirmEmail(e.target.value);
                  setError(null);
                }}
                placeholder={userEmail}
                className="w-full px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  color: 'var(--color-text-primary)',
                  border: `1px solid ${emailMatches ? '#dc2626' : 'var(--color-border)'}`,
                }}
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border-l-4 border-red-500 text-sm text-red-700 mb-4">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
              >
                {t('common.cancel', 'Annuler')}
              </button>
              <button
                onClick={handleDelete}
                disabled={!emailMatches}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg text-white"
                style={{
                  backgroundColor: emailMatches ? '#dc2626' : 'var(--color-neutral-400)',
                  cursor: emailMatches ? 'pointer' : 'not-allowed',
                  opacity: emailMatches ? 1 : 0.5,
                }}
              >
                {t('settings.deleteAccount.deleteButton', 'Supprimer définitivement')}
              </button>
            </div>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
};

export default DeleteAccountModal;
