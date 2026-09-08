/**
 * RegeneratePhraseModal — Two flavours behind one modal:
 *   - `mode="recovery"`: regenerate the account recovery phrase (24 words).
 *     Requires password + TOTP if 2FA enabled.
 *   - `mode="backup"`: regenerate the 2FA backup codes (8 codes).
 *     Requires password + current TOTP.
 *
 * In both cases the server returns the new plaintext once; it's displayed
 * in a second phase with copy / print affordances, and the user must tick
 * "saved" before closing.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody } from '../ui/Modal/Modal';
import * as authApi from '../../../services/auth/authApi';

type Mode = 'recovery' | 'backup';

interface RegeneratePhraseModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: Mode;
  requireTotp: boolean;
}

const RegeneratePhraseModal: React.FC<RegeneratePhraseModalProps> = ({
  isOpen,
  onClose,
  mode,
  requireTotp,
}) => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'confirm' | 'display'>('confirm');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newItems, setNewItems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the server rotated the phrase but the re-wrapped recovery key did
  // NOT reach the cloud — recovery is broken until the device re-syncs (mode recovery).
  const [syncWarning, setSyncWarning] = useState(false);

  const reset = () => {
    setPhase('confirm');
    setPassword('');
    setCode('');
    setNewItems([]);
    setSaved(false);
    setError(null);
    setSyncWarning(false);
  };

  const handleClose = () => {
    if (busy) return;
    if (phase === 'display' && !saved) return;
    reset();
    onClose();
  };

  const handleConfirm = async () => {
    if (!password) return;
    if (requireTotp && !code) return;
    setBusy(true);
    setError(null);
    const result =
      mode === 'recovery'
        ? await authApi.regenerateRecoveryPhrase(password, requireTotp ? code : undefined)
        : await authApi.regenerateBackupCodes(password, code);
    setBusy(false);
    if (!result.success || !result.data) {
      setError(result.error || 'Failed');
      return;
    }
    const items =
      mode === 'recovery'
        ? (result.data as { recoveryCodes: string[] }).recoveryCodes
        : (result.data as { backupCodes: string[] }).backupCodes;

    // The server rotated the recovery code_hash to the NEW phrase. Re-wrap the
    // FEK + keypair under it too, otherwise recoverCloudAccount would verify the
    // new phrase but fail to unwrap blobs still wrapped under the old one. If the
    // re-wrap can't reach the cloud we MUST warn: recovery is now broken until the
    // device re-syncs. The FEK is in memory (unlocked); pass the password so the
    // keypair half can re-wrap even after a safeStorage-only restart.
    if (mode === 'recovery') {
      try {
        const { applyRecoveryPhrase } = await import('../../../services/auth/hybridCrypto');
        const published = await applyRecoveryPhrase(items.join(' '), password);
        setSyncWarning(!published);
      } catch (e) {
        console.warn('[RegeneratePhraseModal] recovery re-wrap failed (non-fatal):', e);
        setSyncWarning(true);
      }
    }

    setNewItems(items);
    setPhase('display');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(newItems.join(mode === 'recovery' ? ' ' : '\n'));
    } catch {
      /* no-op */
    }
  };

  const print = async () => {
    try {
      await window.electron?.ipcRenderer?.invoke('pdf:printRecoveryCodes', {
        words: newItems,
        lang: 'fr',
      });
    } catch {
      /* no-op */
    }
  };

  const title =
    mode === 'recovery'
      ? t('settings.regenPhrase.title', 'Régénérer la phrase de récupération')
      : t('settings.2fa.regenBackupTitle', 'Régénérer les codes de secours');

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="md">
      <ModalBody>
        {phase === 'confirm' && (
          <div>
            <div
              className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
              style={{ backgroundColor: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e' }}
            >
              <span className="flex-shrink-0 text-lg">&#9888;&#65039;</span>
              <p>
                {mode === 'recovery'
                  ? t(
                      'settings.regenPhrase.warn',
                      "La phrase actuelle sera invalidée. Assurez-vous d'avoir de quoi noter la nouvelle."
                    )
                  : t(
                      'settings.2fa.regenBackupWarn',
                      "Les codes actuels seront invalidés — assurez-vous d'avoir de quoi noter les nouveaux."
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

            {requireTotp && (
              <>
                <label
                  className="block text-xs mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('settings.2fa.totpLabel', 'Code TOTP actuel')}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setError(null);
                  }}
                  placeholder="123456"
                  className="w-full px-4 py-2.5 rounded-lg font-mono mb-4 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-background-secondary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                  }}
                />
              </>
            )}

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
                onClick={handleConfirm}
                disabled={busy || !password || (requireTotp && code.length !== 6)}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg text-white"
                style={{
                  backgroundColor: 'var(--color-primary-600)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy || !password || (requireTotp && code.length !== 6) ? 0.5 : 1,
                }}
              >
                {busy ? t('common.loading', '...') : t('common.validate', 'Valider')}
              </button>
            </div>
          </div>
        )}

        {phase === 'display' && (
          <div>
            <div
              className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
              style={{ backgroundColor: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e' }}
            >
              <span className="flex-shrink-0 text-lg">&#9888;&#65039;</span>
              <p>
                {t(
                  'settings.regenPhrase.saveNow',
                  'Copiez ou imprimez maintenant. Ne sera plus jamais affiché.'
                )}
              </p>
            </div>

            {mode === 'recovery' && syncWarning && (
              <div
                className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
                style={{
                  backgroundColor: '#fee2e2',
                  border: '1px solid #ef4444',
                  color: '#991b1b',
                }}
              >
                <span className="flex-shrink-0 text-lg">&#9888;&#65039;</span>
                <p>
                  {t(
                    'settings.regenPhrase.syncWarning',
                    "La nouvelle phrase n'a pas pu être synchronisée avec le cloud. La récupération de compte ne fonctionnera pas tant que cet appareil n'est pas reconnecté — relancez la régénération une fois en ligne."
                  )}
                </p>
              </div>
            )}

            {mode === 'recovery' ? (
              <div
                className="grid grid-cols-3 gap-2 p-4 rounded-lg mb-4"
                style={{ backgroundColor: 'var(--color-background-secondary)' }}
              >
                {newItems.map((w, i) => (
                  <div
                    key={i}
                    className="font-mono text-sm px-2 py-1.5 rounded"
                    style={{ backgroundColor: 'var(--color-background-primary)' }}
                  >
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}. </span>
                    {w}
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="grid grid-cols-2 gap-2 p-4 rounded-lg mb-4"
                style={{ backgroundColor: 'var(--color-background-secondary)' }}
              >
                {newItems.map((c, i) => (
                  <div
                    key={i}
                    className="font-mono text-sm px-3 py-2 rounded"
                    style={{ backgroundColor: 'var(--color-background-primary)' }}
                  >
                    {c}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 mb-4">
              <button
                onClick={copy}
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
                onClick={print}
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
                backgroundColor: saved ? '#d1fae5' : 'var(--color-background-secondary)',
                border: `1px solid ${saved ? '#10b981' : 'var(--color-border)'}`,
              }}
            >
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                {t('settings.2fa.codesSaved', "J'ai sauvegardé en lieu sûr")}
              </span>
            </label>

            <button
              onClick={handleClose}
              disabled={!saved}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-lg text-white"
              style={{
                backgroundColor: saved ? 'var(--color-primary-600)' : 'var(--color-neutral-400)',
                cursor: saved ? 'pointer' : 'not-allowed',
                opacity: saved ? 1 : 0.5,
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

export default RegeneratePhraseModal;
