/**
 * ForgotPasswordModal — Cloud account recovery via the 24-word phrase.
 *
 * Three internal phases:
 *   form    → email + recovery phrase + new password collected
 *   working → running the unwrap-rewrap-commit atomic flow
 *   done    → success message, user is told to log in with the new password
 *
 * The email-based reset path was removed because it silently orphaned the
 * wrapped FEK (password_hash updated, but the FEK stayed wrapped with the
 * KEK derived from the old password → all encrypted data unreadable). The
 * phrase flow rewraps the FEK locally with the new password AND commits
 * password_hash + wrapped_keys in a single server transaction, so nothing
 * is left in an inconsistent state.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody } from '../ui/Modal/Modal';
import { recoverCloudAccount } from '../../../services/auth/hybridCrypto';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional pre-filled email from the login form. */
  defaultEmail?: string;
}

type Phase = 'form' | 'working' | 'done';

const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  isOpen,
  onClose,
  defaultEmail,
}) => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('form');
  const [email, setEmail] = useState(defaultEmail || '');
  const [phrase, setPhrase] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setPhase('form');
      setEmail(defaultEmail || '');
      setPhrase('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
    }
  }, [isOpen, defaultEmail]);

  const handleClose = () => {
    if (phase === 'working') return;
    onClose();
  };

  const wordCount = phrase.trim().split(/\s+/).filter(Boolean).length;
  const canSubmit =
    email.includes('@') &&
    wordCount >= 12 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPhase('working');
    setError(null);
    try {
      await recoverCloudAccount(email.trim(), phrase.trim(), newPassword);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('form');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('forgotPassword.title', 'Récupération par phrase de récupération')}
      size="md"
    >
      <ModalBody>
        {phase === 'form' && (
          <div>
            <div
              className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
              style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #93c5fd',
                color: '#1e40af',
              }}
            >
              <span className="flex-shrink-0 text-lg">&#8505;&#65039;</span>
              <p>
                {t(
                  'forgotPassword.info',
                  'Entrez votre phrase de récupération à 24 mots pour réinitialiser votre mot de passe. Cette opération déconnectera tous vos appareils — vous devrez vous reconnecter avec le nouveau mot de passe.'
                )}
              </p>
            </div>

            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              {t('forgotPassword.emailLabel', 'Adresse email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              className="w-full px-4 py-2.5 rounded-lg mb-4 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              }}
            />

            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              {t('forgotPassword.phraseLabel', 'Phrase de récupération (24 mots)')}
            </label>
            <textarea
              value={phrase}
              onChange={(e) => {
                setPhrase(e.target.value);
                setError(null);
              }}
              rows={3}
              placeholder={t('forgotPassword.phrasePlaceholder', 'mot1 mot2 mot3 ... mot24')}
              className="w-full px-4 py-2.5 rounded-lg font-mono text-sm mb-1 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
                resize: 'vertical',
              }}
            />
            <p className="text-xs mb-4" style={{ color: 'var(--color-text-tertiary)' }}>
              {wordCount}/24 {t('forgotPassword.words', 'mots')}
            </p>

            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              {t('forgotPassword.newPasswordLabel', 'Nouveau mot de passe')}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setError(null);
              }}
              className="w-full px-4 py-2.5 rounded-lg mb-4 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              }}
            />

            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              {t('forgotPassword.confirmLabel', 'Confirmer le mot de passe')}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError(null);
              }}
              className="w-full px-4 py-2.5 rounded-lg mb-4 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                border: `1px solid ${
                  confirmPassword && confirmPassword !== newPassword
                    ? '#ef4444'
                    : 'var(--color-border)'
                }`,
              }}
            />

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
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg text-white"
                style={{
                  backgroundColor: canSubmit
                    ? 'var(--color-primary-600)'
                    : 'var(--color-neutral-400)',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  opacity: canSubmit ? 1 : 0.5,
                }}
              >
                {t('forgotPassword.submit', 'Réinitialiser le mot de passe')}
              </button>
            </div>
          </div>
        )}

        {phase === 'working' && (
          <div className="text-center py-8">
            <svg
              className="animate-spin w-8 h-8 mx-auto mb-4"
              style={{ color: 'var(--color-primary-600)' }}
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
              {t('forgotPassword.working', 'Réinitialisation en cours...')}
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div>
            <div
              className="flex items-start gap-2 p-4 rounded-lg mb-4 text-sm"
              style={{
                backgroundColor: '#d1fae5',
                border: '1px solid #10b981',
                color: '#065f46',
              }}
            >
              <span className="flex-shrink-0 text-lg">&#10004;</span>
              <div>
                <p className="font-semibold mb-1">
                  {t('forgotPassword.doneTitle', 'Mot de passe réinitialisé')}
                </p>
                <p>
                  {t(
                    'forgotPassword.doneDesc',
                    'Tous vos appareils ont été déconnectés. Connectez-vous maintenant avec votre nouveau mot de passe.'
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-lg text-white"
              style={{
                backgroundColor: 'var(--color-primary-600)',
                cursor: 'pointer',
              }}
            >
              {t('common.done', 'Terminé')}
            </button>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
};

export default ForgotPasswordModal;
