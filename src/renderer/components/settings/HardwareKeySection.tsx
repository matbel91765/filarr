/**
 * Hardware Security Key Settings Section (roadmap #7)
 *
 * Enroll / remove a WebAuthn PRF hardware key (YubiKey, Windows Hello,
 * Touch ID) as an additional vault unlock method. Plan gating: Solo+.
 * The password always keeps working — enrolling adds a path, never replaces.
 */

import { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Button } from '../ui/Button/Button';
import type { RootState } from '../../../store';
import { selectCanUseHardwareKey } from '../../../store/selectors/authSelectors';
import {
  getHardwareKeyInfo,
  removeHardwareKey,
  hasHybridKey,
} from '../../../services/auth/hybridCrypto';
import { isWebAuthnAvailable, enrollHardwareKeyWebAuthn } from '../../../services/auth/hardwareKey';

const HardwareKeySection: FC = () => {
  const { t } = useTranslation();
  const canUse = useSelector(selectCanUseHardwareKey);
  const localProfile = useSelector((s: RootState) => s.auth.localProfile);

  const [enrolled, setEnrolled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webAuthnOk = isWebAuthnAvailable();

  const refresh = useCallback(async () => {
    try {
      const info = await getHardwareKeyInfo();
      setEnrolled(info.enrolled);
    } catch {
      setEnrolled(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleEnroll = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!hasHybridKey()) {
        throw new Error(
          t(
            'settings.hardwareKey.vaultLocked',
            'Déverrouillez le vault avant d’enrôler une clé.'
          ) as string
        );
      }
      await enrollHardwareKeyWebAuthn(localProfile?.name || 'Filarr');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (
      !confirm(
        t(
          'settings.hardwareKey.confirmRemove',
          'Retirer la clé de sécurité ? Votre mot de passe vault continuera de fonctionner.'
        ) as string
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await removeHardwareKey();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!canUse) {
    return (
      <div className="px-6 py-4 text-sm italic text-[var(--color-text-tertiary)]">
        {t('settings.hardwareKey.upgradeNote', 'Disponible à partir du plan Solo.')}
      </div>
    );
  }

  if (!webAuthnOk) {
    return (
      <div className="px-6 py-4 text-sm italic text-[var(--color-text-tertiary)]">
        {t(
          'settings.hardwareKey.unavailable',
          'WebAuthn n’est pas disponible dans ce contexte. Mettez l’application à jour vers la dernière version.'
        )}
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--color-border-light)]">
      {error && <div className="px-6 py-3 text-xs text-red-600 bg-red-50">{error}</div>}

      <div className="px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-[var(--color-text-primary)]">
            {enrolled
              ? t(
                  'settings.hardwareKey.enrolled',
                  'Une clé de sécurité est enrôlée sur cet appareil'
                )
              : t('settings.hardwareKey.notEnrolled', 'Aucune clé de sécurité enrôlée')}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {t(
              'settings.hardwareKey.passwordStillWorks',
              'Votre mot de passe vault reste toujours utilisable — la clé est un raccourci, pas un remplacement.'
            )}
          </div>
        </div>
        {enrolled ? (
          <Button variant="danger" size="sm" onClick={handleRemove} disabled={busy}>
            {t('settings.hardwareKey.remove', 'Retirer')}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={handleEnroll} disabled={busy}>
            {busy
              ? t('settings.hardwareKey.enrolling', 'Touchez votre clé…')
              : t('settings.hardwareKey.enroll', 'Enrôler une clé')}
          </Button>
        )}
      </div>

      <div className="px-6 py-3 text-xs text-[var(--color-text-tertiary)] bg-[var(--color-background-secondary)]">
        ⓘ{' '}
        {t(
          'settings.hardwareKey.supportNote',
          'Compatible YubiKey 5+, Windows Hello, Touch ID (passkeys). La clé doit supporter l’extension PRF/hmac-secret. L’enrôlement est propre à cet appareil.'
        )}
      </div>
    </div>
  );
};

export default HardwareKeySection;
