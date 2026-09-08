import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Button, Input, useNotification } from '../ui';
import type { RootState } from '../../../store';
import {
  apiDeletePasskey,
  apiListPasskeys,
  apiRegisterPasskey,
  passkeysSupported,
  type PasskeyDTO,
} from '../../../services/account/passkeysApi';

/**
 * LES CLÉS D'ACCÈS, dans Réglages > Sécurité.
 *
 * Se connecter avec l'empreinte, le visage ou le code de l'appareil, au lieu du
 * mot de passe du compte. Ce que l'écran doit dire, et qu'il dit :
 *
 *  1. UNE CLÉ D'ACCÈS N'OUVRE PAS LE COFFRE. Elle ouvre le compte. Le mot de
 *     passe du coffre reste demandé, parce que c'est lui qui déchiffre. Sans
 *     cette phrase, quelqu'un croirait avoir remplacé les deux.
 *  2. POURQUOI LE BOUTON MANQUE SUR LE BUREAU. WebAuthn lie une clé à un nom de
 *     domaine et le vérifie contre l'origine de la page ; l'application de
 *     bureau sert la sienne depuis un schéma privé. Un bouton grisé sans raison
 *     est indiscernable d'une panne : on nomme la raison et on donne l'adresse.
 */
export const PasskeysSection: React.FC = () => {
  const { t } = useTranslation();
  const { success, error } = useNotification();
  const cloudUser = useSelector((s: RootState) => s.auth?.cloudUser ?? null);
  const [cles, setCles] = useState<PasskeyDTO[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const supporte = passkeysSupported();

  const rafraichir = useCallback(async (): Promise<void> => {
    try {
      setCles(await apiListPasskeys());
    } catch {
      setCles([]);
    }
  }, []);

  useEffect(() => {
    if (cloudUser && supporte) void rafraichir();
  }, [cloudUser, supporte, rafraichir]);

  // Un profil local n'a pas de compte à ouvrir : la section ne le concerne pas.
  if (!cloudUser) return null;

  const ajouter = async (): Promise<void> => {
    setBusy(true);
    try {
      const cree = await apiRegisterPasskey(label.trim());
      // `null` = la personne a fermé la fenêtre du navigateur. Un renoncement
      // n'est pas une erreur et ne s'annonce pas comme telle.
      if (cree) {
        setLabel('');
        success(t('settings.passkeyAdded', 'Clé d’accès ajoutée'));
        await rafraichir();
      }
    } catch {
      error(t('settings.passkeyFailed', 'La clé d’accès n’a pas pu être ajoutée'));
    } finally {
      setBusy(false);
    }
  };

  const retirer = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await apiDeletePasskey(id);
      await rafraichir();
    } catch {
      error(t('settings.passkeyRemoveFailed', 'La clé d’accès n’a pas pu être retirée'));
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
        {t('settings.passkeys', 'Clés d’accès')}
      </h3>
      <p className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
        {t(
          'settings.passkeysDesc',
          'Ouvrez votre compte avec l’empreinte, le visage ou le code de votre appareil, sans mot de passe. Une clé d’accès ouvre le COMPTE : le mot de passe de votre coffre reste demandé, c’est lui qui déchiffre vos fichiers.'
        )}
      </p>

      {!supporte ? (
        <p
          className="text-xs mt-3"
          style={{ color: 'var(--color-warning-on-background)', lineHeight: 1.6 }}
        >
          {t(
            'settings.passkeysWebOnly',
            'Une clé d’accès est liée à un nom de domaine, et l’application de bureau n’en sert pas un. Créez-la depuis app.filarr.com : elle vous connectera là-bas, et sur votre téléphone.'
          )}
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 64))}
              placeholder={t('settings.passkeyLabelPlaceholder', 'Cet ordinateur, mon téléphone…')}
              aria-label={t('settings.passkeyLabel', 'Nom de la clé')}
              disabled={busy}
            />
            <Button variant="secondary" size="sm" onClick={ajouter} disabled={busy}>
              {t('settings.passkeyAdd', 'Ajouter une clé')}
            </Button>
          </div>

          {cles !== null && cles.length === 0 && (
            <p className="text-xs mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('settings.passkeysEmpty', 'Aucune clé d’accès pour l’instant.')}
            </p>
          )}

          {cles?.map((k) => (
            <div
              key={k.id}
              className="mt-2 flex items-center justify-between gap-3 p-2 rounded-lg"
              style={{ background: 'var(--color-background)' }}
            >
              <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                {k.label || t('settings.passkeyUnnamed', 'Clé sans nom')}
                {k.backedUp && (
                  <span className="text-xs ml-2" style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('settings.passkeySynced', 'synchronisée')}
                  </span>
                )}
              </span>
              <Button variant="secondary" size="sm" onClick={() => retirer(k.id)} disabled={busy}>
                {t('common.remove', 'Retirer')}
              </Button>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default PasskeysSection;
