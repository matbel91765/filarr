/**
 * DisableSyncModal — Cloud → Local migration
 *
 * Two options:
 *   A) Disable only (keep cloud data)
 *   B) Disable and delete cloud data (keep local)
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import Modal, { ModalBody } from '../ui/Modal/Modal';
import { clearCloudAuth, setSyncEnabled } from '../../../store/slices/authSlice';
import * as authApi from '../../../services/auth/authApi';
import type { AppDispatch } from '../../../store';

interface DisableSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}

const DisableSyncModal: React.FC<DisableSyncModalProps> = ({ isOpen, onClose, userEmail }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleClose = () => {
    setConfirmEmail('');
    setDeleting(false);
    setError(null);
    setShowDeleteConfirm(false);
    onClose();
  };

  // Option A: disable only
  const handleDisableOnly = async () => {
    await authApi.setSyncEnabled(false);
    dispatch(setSyncEnabled(false));
    handleClose();
  };

  // Option B: disable + delete cloud data
  const handleDeleteAndDisable = async () => {
    setDeleting(true);
    setError(null);
    try {
      const result = await authApi.deleteAccountData();
      if (result.success) {
        await authApi.setSyncEnabled(false);
        dispatch(setSyncEnabled(false));
        dispatch(clearCloudAuth());
        handleClose();
      } else {
        setError(result.error || 'Failed to delete data');
      }
    } catch {
      setError('Network error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('settings.disableSync.title', 'Désactiver la synchronisation')}
      size="md"
    >
      <ModalBody>
        {!showDeleteConfirm ? (
          <div className="space-y-3">
            {/* Option A */}
            <button
              onClick={handleDisableOnly}
              className="w-full text-left p-4 rounded-xl border-2 transition-all hover:shadow-sm"
              style={{ borderColor: 'var(--color-border)', cursor: 'pointer' }}
            >
              <h3
                className="text-sm font-semibold mb-1"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('settings.disableSync.optionA', 'Désactiver uniquement')}
              </h3>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'settings.disableSync.optionADesc',
                  'Vos données cloud sont conservées. Vous pourrez réactiver la sync plus tard.'
                )}
              </p>
            </button>

            {/* Option B */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full text-left p-4 rounded-xl border-2 transition-all hover:shadow-sm"
              style={{ borderColor: '#fca5a5', cursor: 'pointer' }}
            >
              <h3 className="text-sm font-semibold mb-1" style={{ color: '#dc2626' }}>
                {t('settings.disableSync.optionB', 'Désactiver et supprimer mes données cloud')}
              </h3>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'settings.disableSync.optionBDesc',
                  'Vos fichiers locaux sont conservés. Les données sur nos serveurs seront supprimées.'
                )}
              </p>
            </button>
          </div>
        ) : (
          /* Delete confirmation */
          <div>
            <div
              className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
              style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b' }}
            >
              <span className="flex-shrink-0">&#9888;&#65039;</span>
              <span>
                {t(
                  'settings.disableSync.deleteWarning',
                  'Cette action supprimera toutes vos données cloud. Vos fichiers locaux ne sont pas affectés.'
                )}
              </span>
            </div>

            <div className="mb-4">
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('settings.disableSync.confirmEmail', 'Saisissez votre email pour confirmer')}
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
                  border: '1px solid var(--color-border)',
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
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
              >
                {t('common.back', 'Retour')}
              </button>
              <button
                onClick={handleDeleteAndDisable}
                disabled={confirmEmail.toLowerCase() !== userEmail.toLowerCase() || deleting}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg text-white flex items-center justify-center gap-2"
                style={{
                  backgroundColor:
                    confirmEmail.toLowerCase() === userEmail.toLowerCase() && !deleting
                      ? '#dc2626'
                      : 'var(--color-neutral-400)',
                  cursor:
                    confirmEmail.toLowerCase() === userEmail.toLowerCase() && !deleting
                      ? 'pointer'
                      : 'not-allowed',
                }}
              >
                {deleting && (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      opacity="0.25"
                    />
                    <path
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      opacity="0.75"
                    />
                  </svg>
                )}
                {t('settings.disableSync.deleteButton', 'Supprimer et désactiver')}
              </button>
            </div>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
};

export default DisableSyncModal;
