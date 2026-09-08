/**
 * RecoveryKeyImportModal — Restore vault from a recovery key file.
 *
 * Two-step flow:
 * 1. Preview: select file → show metadata (profile, date, hint)
 * 2. Confirm: enter recovery password + new vault password → restore
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { useNotification } from '../ui/Notification';

interface RecoveryKeyImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ImportStep = 'warning' | 'preview' | 'confirm';

interface PreviewData {
  filePath: string;
  profileName: string | null;
  createdAt: string | null;
  hint: string | null;
  appVersion: string | null;
}

const RecoveryKeyImportModal: React.FC<RecoveryKeyImportModalProps> = ({ isOpen, onClose }) => {
  const { i18n } = useTranslation();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const isFr = i18n.language?.startsWith('fr');

  const [step, setStep] = useState<ImportStep>('warning');
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [newVaultPassword, setNewVaultPassword] = useState('');
  const [newVaultConfirm, setNewVaultConfirm] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => {
    setStep('warning');
    setConfirmed(false);
    setPreview(null);
    setRecoveryPassword('');
    setNewVaultPassword('');
    setNewVaultConfirm('');
    setError('');
    onClose();
  };

  const handleSelectFile = useCallback(async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('security:previewRecoveryKey');
      if (result.success) {
        setPreview(result);
        setStep('preview');
      } else if (result.error !== 'Cancelled') {
        setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const handleRestore = useCallback(async () => {
    if (!preview || !recoveryPassword || !newVaultPassword || newVaultPassword !== newVaultConfirm)
      return;
    setRestoring(true);
    setError('');

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'security:importRecoveryKey',
        preview.filePath,
        recoveryPassword,
        newVaultPassword
      );

      if (result.success) {
        notifySuccess(
          isFr
            ? 'Vault restauré avec succès. Votre nouveau mot de passe vault est actif.'
            : 'Vault restored successfully. Your new vault password is active.'
        );
        handleClose();
      } else {
        setError(
          result.error === 'Wrong recovery password'
            ? isFr
              ? 'Mot de passe de secours incorrect'
              : 'Wrong recovery password'
            : result.error
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoring(false);
    }
  }, [
    preview,
    recoveryPassword,
    newVaultPassword,
    newVaultConfirm,
    isFr,
    notifySuccess,
    handleClose,
  ]);

  const canRestore =
    recoveryPassword.length > 0 &&
    newVaultPassword.length >= 8 &&
    newVaultPassword === newVaultConfirm &&
    !restoring;

  return (
    <Modal
      isOpen={isOpen}
      onClose={restoring ? () => {} : handleClose}
      title={isFr ? 'Restaurer depuis une clé de secours' : 'Restore from recovery key'}
      size="sm"
    >
      <ModalBody>
        {/* STEP 1: WARNING */}
        {step === 'warning' && (
          <div>
            <div
              className="rounded-lg p-3 mb-5 text-xs"
              style={{ backgroundColor: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b' }}
            >
              {isFr
                ? 'Cette opération remplace votre clé de chiffrement actuelle. Tous vos fichiers locaux existants seront inaccessibles sauf s\u2019ils ont été chiffrés avec cette clé.'
                : 'This operation replaces your current encryption key. All existing local files will be inaccessible unless they were encrypted with this key.'}
            </div>

            <label className="flex items-center gap-2 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {isFr ? 'Je comprends et je veux continuer' : 'I understand and want to continue'}
              </span>
            </label>
          </div>
        )}

        {/* STEP 2: PREVIEW */}
        {step === 'preview' && preview && (
          <div>
            <div
              className="rounded-lg p-4 mb-5"
              style={{
                backgroundColor: 'var(--color-background-secondary)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {isFr ? 'Profil' : 'Profile'}
                  </span>
                  <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {preview.profileName || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {isFr ? 'Créé le' : 'Created'}
                  </span>
                  <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {preview.createdAt
                      ? new Date(preview.createdAt).toLocaleDateString(isFr ? 'fr-FR' : 'en-US')
                      : '—'}
                  </span>
                </div>
                {preview.hint && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--color-text-tertiary)' }}>
                      {isFr ? 'Indice' : 'Hint'}
                    </span>
                    <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {preview.hint}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Recovery password */}
            <div className="mb-4">
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {isFr ? 'Mot de passe de secours' : 'Recovery password'}
              </label>
              <input
                type="password"
                value={recoveryPassword}
                onChange={(e) => {
                  setRecoveryPassword(e.target.value);
                  setError('');
                }}
                autoFocus
                className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>

            {/* New vault password */}
            <div className="mb-4">
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {isFr ? 'Nouveau mot de passe vault' : 'New vault password'}
              </label>
              <input
                type="password"
                value={newVaultPassword}
                onChange={(e) => setNewVaultPassword(e.target.value)}
                placeholder={isFr ? '8 caractères minimum' : '8 characters minimum'}
                className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>

            <div className="mb-2">
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {isFr ? 'Confirmer' : 'Confirm'}
              </label>
              <input
                type="password"
                value={newVaultConfirm}
                onChange={(e) => setNewVaultConfirm(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />
              {newVaultConfirm && newVaultPassword !== newVaultConfirm && (
                <p className="text-xs mt-1" style={{ color: '#ef4444' }}>
                  {isFr ? 'Les mots de passe ne correspondent pas' : 'Passwords do not match'}
                </p>
              )}
            </div>

            {error && (
              <p className="text-xs mt-3 text-center" style={{ color: '#ef4444' }}>
                {error}
              </p>
            )}
          </div>
        )}

        {/* Error on warning step */}
        {step === 'warning' && error && (
          <p className="text-xs mt-2" style={{ color: '#ef4444' }}>
            {error}
          </p>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex justify-end gap-2">
          <button
            onClick={handleClose}
            disabled={restoring}
            className="px-4 py-2 text-sm font-medium rounded-lg"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            {isFr ? 'Annuler' : 'Cancel'}
          </button>

          {step === 'warning' && (
            <button
              onClick={handleSelectFile}
              disabled={!confirmed}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white"
              style={{
                backgroundColor: confirmed
                  ? 'var(--color-primary-600)'
                  : 'var(--color-primary-300)',
                cursor: confirmed ? 'pointer' : 'not-allowed',
                opacity: confirmed ? 1 : 0.6,
              }}
            >
              {isFr ? 'Sélectionner le fichier' : 'Select file'}
            </button>
          )}

          {step === 'preview' && (
            <button
              onClick={handleRestore}
              disabled={!canRestore}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white"
              style={{
                backgroundColor: canRestore ? '#dc2626' : '#fca5a5',
                cursor: canRestore ? 'pointer' : 'not-allowed',
                opacity: canRestore ? 1 : 0.6,
              }}
            >
              {restoring
                ? isFr
                  ? 'Restauration...'
                  : 'Restoring...'
                : isFr
                  ? 'Restaurer'
                  : 'Restore'}
            </button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default RecoveryKeyImportModal;
