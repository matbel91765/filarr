/**
 * TwoFAChallengeModal — Second step of the login flow when 2FA is enabled.
 *
 * Opened by login callers after a successful password step that returned
 * `requires2FA: true`. Collects a TOTP code or a backup code and calls
 * `completeMFALogin`. Cancelling clears the server-side mfaToken via
 * `cancelMFALogin` so a new login can start cleanly.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody } from '../ui/Modal/Modal';
import * as authApi from '../../../services/auth/authApi';
import { publishDeviceLimitPrompt } from '../../../services/auth/deviceLimitPrompt';
import type { UserDTO } from '../../../types/auth';

interface TwoFAChallengeModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onSuccess: (user: UserDTO) => void;
}

const TwoFAChallengeModal: React.FC<TwoFAChallengeModalProps> = ({
  isOpen,
  onCancel,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Remember this device": skip the TOTP step on this device for 30 days (the
  // password is still required every login). Stored locally + server-validated.
  const [rememberDevice, setRememberDevice] = useState(true);

  const handleCancel = async () => {
    if (busy) return;
    setCode('');
    setError(null);
    await authApi.cancelMFALogin();
    onCancel();
  };

  /**
   * LA TENTATIVE, ET SA REPRISE. Le refus « trop d'appareils » n'est pas une
   * erreur à afficher, c'est un choix à offrir — exactement comme sur le chemin
   * mot de passe (`useAuth.login`), par le même hôte (`DeviceLimitHost`). La
   * reprise rejoue CE code avec l'appareil choisi : le jeton MFA n'a pas été
   * consommé par le refus. Un second refus (un autre appareil a pris la place
   * entre-temps) republie le choix plutôt que d'échouer en silence.
   */
  const tenter = async (revokeDeviceId?: string): Promise<void> => {
    const result = await authApi.completeMFALogin(
      code,
      mode === 'totp' && rememberDevice,
      revokeDeviceId
    );
    if (result.code === 'device_limit_reached') {
      publishDeviceLimitPrompt({
        cap: result.data?.cap ?? 0,
        sessions: result.data?.sessions ?? [],
        retry: (deviceId) => tenter(deviceId),
      });
      return;
    }
    if (!result.success || !result.user) {
      setError(result.error || 'Invalid code');
      return;
    }
    setCode('');
    onSuccess(result.user);
  };

  const handleSubmit = async () => {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      await tenter();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={t('login.2fa.title', 'Double authentification')}
      size="sm"
    >
      <ModalBody>
        <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
          {mode === 'totp'
            ? t(
                'login.2fa.totpDesc',
                "Saisissez le code à 6 chiffres de votre application d'authentification."
              )
            : t(
                'login.2fa.backupDesc',
                'Saisissez un de vos codes de secours (format XXXX-XXXX). Il sera consommé.'
              )}
        </p>

        <input
          type="text"
          autoFocus
          inputMode={mode === 'totp' ? 'numeric' : 'text'}
          value={code}
          onChange={(e) => {
            setCode(
              mode === 'totp'
                ? e.target.value.replace(/\D/g, '').slice(0, 6)
                : e.target.value.toUpperCase().slice(0, 9)
            );
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && code && !busy) handleSubmit();
          }}
          placeholder={mode === 'totp' ? '123456' : 'ABCD-1234'}
          className="w-full px-4 py-3 rounded-lg text-center font-mono text-lg tracking-widest mb-3 focus:outline-none focus:ring-2"
          style={{
            backgroundColor: 'var(--color-background-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
          }}
        />

        <button
          onClick={() => {
            setMode(mode === 'totp' ? 'backup' : 'totp');
            setCode('');
            setError(null);
          }}
          className="text-xs mb-4"
          style={{
            color: 'var(--color-primary-600)',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
          }}
        >
          {mode === 'totp'
            ? t('login.2fa.useBackup', 'Utiliser un code de secours')
            : t('login.2fa.useTotp', "Utiliser l'application d'authentification")}
        </button>

        {mode === 'totp' && (
          <label
            className="flex items-center gap-2 text-sm mb-4 cursor-pointer"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
            />
            {t('login.2fa.rememberDevice', 'Se souvenir de cet appareil 30 jours')}
          </label>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border-l-4 border-red-500 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleCancel}
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
            onClick={handleSubmit}
            disabled={busy || !code}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg text-white"
            style={{
              backgroundColor: 'var(--color-primary-600)',
              cursor: busy || !code ? 'not-allowed' : 'pointer',
              opacity: busy || !code ? 0.5 : 1,
            }}
          >
            {busy ? t('common.loading', '...') : t('common.validate', 'Valider')}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
};

export default TwoFAChallengeModal;
