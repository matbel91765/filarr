/**
 * DeviceTrustSection (E5-4) — opt-in "Trust this device" for password-less unlock after SSO.
 *
 * Enrolling stores a random device key in the OS keychain and wraps the FEK under it, so after an
 * SSO login (the IdP federates the session but never sees a key) the vault unlocks with no password.
 * The password always keeps working; this only ADDS a path. Honest about the device-theft tradeoff
 * (anyone with your OS session could unlock here) — enrol only on a personal, trusted device.
 */

import { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button/Button';
import {
  hasDeviceKeyWrap,
  enrollDeviceKey,
  clearDeviceKeyEnrollment,
  hasHybridKey,
} from '../../../services/auth/hybridCrypto';

const DeviceTrustSection: FC = () => {
  const { t } = useTranslation();
  const [enrolled, setEnrolled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEnrolled(await hasDeviceKeyWrap());
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
            'settings.deviceTrust.vaultLocked',
            'Déverrouillez le vault avant de faire confiance à cet appareil.'
          ) as string
        );
      }
      await enrollDeviceKey();
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
          'settings.deviceTrust.confirmRemove',
          'Oublier cet appareil ? La prochaine connexion SSO redemandera votre mot de passe.'
        ) as string
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await clearDeviceKeyEnrollment();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="divide-y divide-[var(--color-border-light)]">
      {error && <div className="px-6 py-3 text-xs text-red-600 bg-red-50">{error}</div>}

      <div className="px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-[var(--color-text-primary)]">
            {enrolled
              ? t(
                  'settings.deviceTrust.enrolled',
                  'Appareil de confiance — déverrouillage sans mot de passe après SSO'
                )
              : t('settings.deviceTrust.notEnrolled', 'Cet appareil n’est pas de confiance')}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {t(
              'settings.deviceTrust.note',
              'Après une connexion SSO, le coffre se déverrouille via une clé liée à cet appareil (gardée dans le trousseau du système, jamais envoyée au serveur ni à l’IdP). Le mot de passe reste toujours utilisable.'
            )}
          </div>
        </div>
        {enrolled ? (
          <Button variant="danger" size="sm" onClick={handleRemove} disabled={busy}>
            {t('settings.deviceTrust.remove', 'Oublier cet appareil')}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={handleEnroll} disabled={busy}>
            {busy
              ? t('settings.deviceTrust.enrolling', 'Activation…')
              : t('settings.deviceTrust.enroll', 'Faire confiance à cet appareil')}
          </Button>
        )}
      </div>

      <div className="px-6 py-3 text-xs text-[var(--color-text-tertiary)] bg-[var(--color-background-secondary)]">
        ⚠️{' '}
        {t(
          'settings.deviceTrust.theftNote',
          'Compromis assumé : une personne ayant accès à votre session du système d’exploitation pourrait déverrouiller le coffre sur cet appareil. N’activez ceci que sur un appareil personnel et de confiance.'
        )}
      </div>
    </div>
  );
};

export default DeviceTrustSection;
