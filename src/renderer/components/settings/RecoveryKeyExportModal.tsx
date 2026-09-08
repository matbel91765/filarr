/**
 * RecoveryKeyExportModal — Create and download a recovery key file.
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { useNotification } from '../ui/Notification';

interface RecoveryKeyExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string;
}

function getPasswordStrength(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const STRENGTH_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'];

const RecoveryKeyExportModal: React.FC<RecoveryKeyExportModalProps> = ({
  isOpen,
  onClose,
  profileId,
}) => {
  const { t, i18n } = useTranslation();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const isFr = i18n.language?.startsWith('fr');

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [hint, setHint] = useState('');
  const [generating, setGenerating] = useState(false);

  const strength = getPasswordStrength(password);
  const canSubmit = password.length >= 8 && password === passwordConfirm && !generating;

  const handleExport = useCallback(async () => {
    if (!canSubmit) return;
    setGenerating(true);

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'security:exportRecoveryKey',
        profileId,
        password,
        hint.trim() || null
      );

      if (result.success) {
        notifySuccess(
          isFr
            ? 'Clé de secours sauvegardée. Conservez-la précieusement.'
            : 'Recovery key saved. Keep it safe.'
        );
        onClose();
      } else if (result.error !== 'Cancelled') {
        notifyError(result.error);
      }
    } catch (err) {
      notifyError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [canSubmit, profileId, password, hint, isFr, notifySuccess, notifyError, onClose]);

  const handleClose = () => {
    setPassword('');
    setPasswordConfirm('');
    setHint('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isFr ? 'Créer une clé de secours' : 'Create a recovery key'}
      size="sm"
    >
      <ModalBody>
        {/* Warning */}
        <div
          className="rounded-lg p-3 mb-5 text-xs"
          style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e' }}
        >
          {isFr
            ? 'Cette clé permet de récupérer vos données si vous oubliez votre mot de passe vault. Stockez-la dans un endroit sûr, séparé de votre appareil.'
            : 'This key lets you recover your data if you forget your vault password. Store it in a safe place, separate from your device.'}
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              isFr ? 'Différent de votre mot de passe vault' : 'Different from your vault password'
            }
            className="w-full px-3 py-2 text-sm rounded-lg outline-none"
            style={{
              backgroundColor: 'var(--color-background-secondary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
          {password.length > 0 && (
            <div className="flex gap-1 mt-2">
              {[0, 1, 2, 3, 4].map((level) => (
                <div
                  key={level}
                  className="h-1 flex-1 rounded-full"
                  style={{
                    backgroundColor:
                      level <= strength ? STRENGTH_COLORS[strength] : 'var(--color-border)',
                  }}
                />
              ))}
            </div>
          )}
          {password.length > 0 && password.length < 8 && (
            <p className="text-xs mt-1" style={{ color: '#ef4444' }}>
              {isFr ? '8 caractères minimum' : '8 characters minimum'}
            </p>
          )}
        </div>

        {/* Confirm */}
        <div className="mb-4">
          <label
            className="block text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {isFr ? 'Confirmer' : 'Confirm'}
          </label>
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg outline-none"
            style={{
              backgroundColor: 'var(--color-background-secondary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
          {passwordConfirm && password !== passwordConfirm && (
            <p className="text-xs mt-1" style={{ color: '#ef4444' }}>
              {isFr ? 'Les mots de passe ne correspondent pas' : 'Passwords do not match'}
            </p>
          )}
        </div>

        {/* Hint */}
        <div className="mb-2">
          <label
            className="block text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {isFr
              ? 'Indice (optionnel, visible en clair)'
              : 'Hint (optional, stored in plain text)'}
          </label>
          <input
            type="text"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder={isFr ? 'Ex: coffre-fort bureau' : 'E.g. office safe'}
            className="w-full px-3 py-2 text-sm rounded-lg outline-none"
            style={{
              backgroundColor: 'var(--color-background-secondary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
      </ModalBody>

      <ModalFooter>
        <div className="flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium rounded-lg"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            {t('common.cancel', 'Annuler')}
          </button>
          <button
            onClick={handleExport}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white"
            style={{
              backgroundColor: canSubmit ? 'var(--color-primary-600)' : 'var(--color-primary-300)',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.6,
            }}
          >
            {generating
              ? isFr
                ? 'Génération...'
                : 'Generating...'
              : isFr
                ? 'Générer et télécharger'
                : 'Generate and download'}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default RecoveryKeyExportModal;
