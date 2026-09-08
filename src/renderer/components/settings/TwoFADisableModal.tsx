/**
 * TwoFADisableModal — Disable 2FA on the account.
 *
 * Requires password + current TOTP (or backup code as fallback). The server
 * enforces both checks; this UI just collects them.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody } from '../ui/Modal/Modal';
import * as authApi from '../../../services/auth/authApi';

interface TwoFADisableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDisabled: () => void;
}

const TwoFADisableModal: React.FC<TwoFADisableModalProps> = ({ isOpen, onClose, onDisabled }) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (busy) return;
    setPassword('');
    setCode('');
    setError(null);
    onClose();
  };

  const handleDisable = async () => {
    if (!password || !code) return;
    setBusy(true);
    setError(null);
    const result = await authApi.disable2FA(password, code);
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Failed');
      return;
    }
    onDisabled();
    handleClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('settings.2fa.disableTitle', 'Désactiver la 2FA')}
      size="sm"
    >
      <ModalBody>
        <div
          className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
          style={{ backgroundColor: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e' }}
        >
          <span className="flex-shrink-0 text-lg">&#9888;&#65039;</span>
          <p>
            {t(
              'settings.2fa.disableWarn',
              'Votre compte ne sera plus protégé par la double authentification. Vous pouvez toujours la réactiver plus tard.'
            )}
          </p>
        </div>

        <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
          {t('settings.2fa.passwordLabel', 'Mot de passe du compte')}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
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
          {t('settings.2fa.codeLabel', 'Code TOTP ou code de secours')}
        </label>
        <input
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder="123456 or ABCD-1234"
          className="w-full px-4 py-2.5 rounded-lg font-mono mb-4 focus:outline-none focus:ring-2"
          style={{
            backgroundColor: 'var(--color-background-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
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
            disabled={busy}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {t('common.cancel', 'Annuler')}
          </button>
          <button
            onClick={handleDisable}
            disabled={busy || !password || !code}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg text-white"
            style={{
              backgroundColor: '#dc2626',
              cursor: busy || !password || !code ? 'not-allowed' : 'pointer',
              opacity: busy || !password || !code ? 0.5 : 1,
            }}
          >
            {busy ? t('common.loading', '...') : t('settings.2fa.disable', 'Désactiver')}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
};

export default TwoFADisableModal;
