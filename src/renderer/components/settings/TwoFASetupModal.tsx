/**
 * TwoFASetupModal — Enable TOTP 2FA.
 *
 * Three internal steps, tracked with the `phase` state:
 *   qr     → user scans QR / copies secret into their authenticator app
 *   verify → user types the first 6-digit code to prove pairing worked
 *   codes  → server-generated backup codes shown ONCE (print + copy)
 *
 * The phase advances only on server-confirmed success. Closing the modal
 * during `qr` or `verify` aborts setup; closing during `codes` is allowed
 * only after the user ticks "J'ai sauvegardé" — losing unseen backup codes
 * would leave them with only TOTP and the recovery phrase.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import Modal, { ModalBody } from '../ui/Modal/Modal';
import * as authApi from '../../../services/auth/authApi';

interface TwoFASetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEnabled: () => void;
}

type Phase = 'qr' | 'verify' | 'codes';

const TwoFASetupModal: React.FC<TwoFASetupModalProps> = ({ isOpen, onClose, onEnabled }) => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('qr');
  const [secret, setSecret] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [codesSaved, setCodesSaved] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Reset on open + request setup
    setPhase('qr');
    setCode('');
    setBackupCodes([]);
    setCodesSaved(false);
    setError(null);
    setBusy(true);
    (async () => {
      const result = await authApi.setup2FA();
      if (!result.success || !result.data) {
        setError(result.error || 'Failed to start 2FA setup');
        setBusy(false);
        return;
      }
      setSecret(result.data.secret);
      try {
        const url = await QRCode.toDataURL(result.data.otpauthUrl, {
          margin: 1,
          width: 220,
        });
        setQrDataUrl(url);
      } catch {
        setQrDataUrl('');
      }
      setBusy(false);
    })();
  }, [isOpen]);

  const handleClose = () => {
    if (busy) return;
    if (phase === 'codes' && !codesSaved) return;
    onClose();
  };

  const handleVerify = async () => {
    if (code.replace(/\s+/g, '').length !== 6) return;
    setBusy(true);
    setError(null);
    const result = await authApi.verifySetup2FA(code);
    setBusy(false);
    if (!result.success || !result.data) {
      setError(result.error || 'Invalid code');
      return;
    }
    setBackupCodes(result.data.backupCodes);
    setPhase('codes');
    onEnabled();
  };

  const copyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
    } catch {
      /* no-op */
    }
  };

  const printBackupCodes = async () => {
    try {
      await window.electron?.ipcRenderer?.invoke('pdf:printRecoveryCodes', {
        words: backupCodes,
        lang: 'fr',
      });
    } catch {
      /* no-op */
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('settings.2fa.setupTitle', 'Activer la double authentification')}
      size="md"
    >
      <ModalBody>
        {phase === 'qr' && (
          <div>
            <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
              {t(
                'settings.2fa.qrDesc',
                "Scannez ce code QR avec votre application d'authentification (Authy, Google Authenticator, 1Password, etc.)."
              )}
            </p>
            <div className="flex justify-center mb-4">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="TOTP QR code" style={{ width: 220, height: 220 }} />
              ) : (
                <div
                  style={{
                    width: 220,
                    height: 220,
                    backgroundColor: 'var(--color-background-secondary)',
                  }}
                />
              )}
            </div>
            <div className="mb-4">
              <label
                className="block text-xs mb-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('settings.2fa.manualEntry', 'Saisie manuelle (clé secrète)')}
              </label>
              <div
                className="px-3 py-2 rounded-lg font-mono text-sm break-all"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {secret}
              </div>
            </div>
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
                onClick={() => setPhase('verify')}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg text-white"
                style={{ backgroundColor: 'var(--color-primary-600)', cursor: 'pointer' }}
              >
                {t('common.next', 'Suivant')}
              </button>
            </div>
          </div>
        )}

        {phase === 'verify' && (
          <div>
            <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
              {t(
                'settings.2fa.verifyDesc',
                'Saisissez le code à 6 chiffres affiché dans votre application pour finaliser.'
              )}
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError(null);
              }}
              placeholder="123456"
              className="w-full px-4 py-3 rounded-lg text-center font-mono text-lg tracking-widest mb-4 focus:outline-none focus:ring-2"
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
                onClick={() => setPhase('qr')}
                disabled={busy}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {t('common.back', 'Retour')}
              </button>
              <button
                onClick={handleVerify}
                disabled={busy || code.length !== 6}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg text-white"
                style={{
                  backgroundColor: 'var(--color-primary-600)',
                  cursor: busy || code.length !== 6 ? 'not-allowed' : 'pointer',
                  opacity: busy || code.length !== 6 ? 0.5 : 1,
                }}
              >
                {busy ? t('common.loading', '...') : t('settings.2fa.verify', 'Vérifier')}
              </button>
            </div>
          </div>
        )}

        {phase === 'codes' && (
          <div>
            <div
              className="flex items-start gap-2 p-4 rounded-lg mb-4 text-sm"
              style={{ backgroundColor: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e' }}
            >
              <span className="flex-shrink-0 text-lg">&#9888;&#65039;</span>
              <div>
                <p className="font-semibold mb-1">
                  {t('settings.2fa.codesTitle', 'Codes de secours — à sauvegarder maintenant')}
                </p>
                <p>
                  {t(
                    'settings.2fa.codesDesc',
                    "Chaque code s'utilise une seule fois. Ils ne seront plus jamais affichés. Perdez-les et vous devrez utiliser votre phrase de récupération pour vous reconnecter si vous perdez votre appareil TOTP."
                  )}
                </p>
              </div>
            </div>
            <div
              className="grid grid-cols-2 gap-2 p-4 rounded-lg mb-4"
              style={{ backgroundColor: 'var(--color-background-secondary)' }}
            >
              {backupCodes.map((bc, i) => (
                <div
                  key={i}
                  className="font-mono text-sm px-3 py-2 rounded"
                  style={{ backgroundColor: 'var(--color-background-primary)' }}
                >
                  {bc}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mb-4">
              <button
                onClick={copyBackupCodes}
                className="flex-1 px-4 py-2 text-sm font-medium rounded-lg"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
              >
                {t('common.copy', 'Copier')}
              </button>
              <button
                onClick={printBackupCodes}
                className="flex-1 px-4 py-2 text-sm font-medium rounded-lg"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
              >
                {t('common.print', 'Imprimer')}
              </button>
            </div>
            <label
              className="flex items-center gap-2 p-3 rounded-lg mb-4 cursor-pointer"
              style={{
                backgroundColor: codesSaved ? '#d1fae5' : 'var(--color-background-secondary)',
                border: `1px solid ${codesSaved ? '#10b981' : 'var(--color-border)'}`,
              }}
            >
              <input
                type="checkbox"
                checked={codesSaved}
                onChange={(e) => setCodesSaved(e.target.checked)}
              />
              <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                {t('settings.2fa.codesSaved', "J'ai sauvegardé mes codes de secours en lieu sûr")}
              </span>
            </label>
            <button
              onClick={handleClose}
              disabled={!codesSaved}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-lg text-white"
              style={{
                backgroundColor: codesSaved
                  ? 'var(--color-primary-600)'
                  : 'var(--color-neutral-400)',
                cursor: codesSaved ? 'pointer' : 'not-allowed',
                opacity: codesSaved ? 1 : 0.5,
              }}
            >
              {t('common.done', 'Terminé')}
            </button>
          </div>
        )}

        {error && phase === 'qr' && (
          <div className="p-3 mt-3 rounded-lg bg-red-50 border-l-4 border-red-500 text-sm text-red-700">
            {error}
          </div>
        )}
      </ModalBody>
    </Modal>
  );
};

export default TwoFASetupModal;
