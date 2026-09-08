import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button, Input, useNotification } from '../ui';
import type { AppDispatch, RootState } from '../../../store';
import { setCloudAuth } from '../../../store/slices/authSlice';
import { apiUpdateDisplayName } from '../../../services/account/displayNameApi';

/**
 * LE NOM D'AFFICHAGE, dans Réglages > Compte.
 *
 * Sans lui, une personne n'était qu'une adresse : les puces de mention et le
 * trombinoscope d'un coffre affichaient « prenom.nom@societe.fr ». Facultatif
 * — on le vide pour revenir à son adresse.
 *
 * Ne s'affiche que pour un compte cloud : un profil local n'a personne à qui se
 * présenter.
 */
export const DisplayNameSection: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const cloudUser = useSelector((s: RootState) => s.auth?.cloudUser ?? null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(cloudUser?.displayName ?? '');
  }, [cloudUser?.displayName]);

  if (!cloudUser) return null;

  const courant = cloudUser.displayName ?? '';
  const modifie = value.trim() !== courant;

  const enregistrer = async (): Promise<void> => {
    setBusy(true);
    try {
      const user = await apiUpdateDisplayName(value.trim());
      if (user) dispatch(setCloudAuth(user));
      success(t('settings.displayNameSaved', 'Nom d’affichage enregistré'));
    } catch {
      error(t('settings.displayNameFailed', 'Le nom d’affichage n’a pas pu être enregistré'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="p-4 rounded-lg"
      style={{
        backgroundColor: 'var(--color-background-secondary)',
        border: '1px solid var(--color-border)',
      }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('settings.displayName', 'Nom d’affichage')}
      </h3>
      <p className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
        {t(
          'settings.displayNameDesc',
          'Ce que les autres membres de vos coffres partagés voient à la place de votre adresse — dans le trombinoscope et dans les mentions. Laissez vide pour revenir à votre adresse.'
        )}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 64))}
          placeholder={cloudUser.email}
          aria-label={t('settings.displayName', 'Nom d’affichage')}
          disabled={busy}
        />
        <Button variant="secondary" size="sm" onClick={enregistrer} disabled={busy || !modifie}>
          {busy ? t('common.saving', 'Enregistrement…') : t('common.save', 'Enregistrer')}
        </Button>
      </div>
    </div>
  );
};

export default DisplayNameSection;
