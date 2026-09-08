/**
 * DÉVERROUILLER LE COFFRE DU COMPTE — la fenêtre de saisie de la phrase.
 *
 * LE PIÈGE QU'ELLE DOIT FERMER, et il n'est pas cosmétique : l'utilisateur a
 * DEUX secrets sur ce compte, et un seul ouvre cette clé.
 *
 *   · le MOT DE PASSE du compte — celui de la connexion, que le serveur voit à
 *     chaque ouverture de session ;
 *   · la PHRASE DE RÉCUPÉRATION — dédiée, jamais transmise, et la seule qui
 *     déballe la clé de garde.
 *
 * C'est tout le sens du schéma `passphrase-v1` : un serveur compromis ne doit
 * pas pouvoir dériver la KEK. Si l'écran dit seulement « mot de passe »,
 * l'utilisateur essaiera le sien, échouera, et conclura que la fonction est
 * cassée. Le libellé du champ et son texte d'aide portent donc la distinction,
 * explicitement — pas en petits caractères.
 *
 * LA CASE « SE SOUVENIR » EST DÉCOCHÉE PAR DÉFAUT, et n'apparaît même pas
 * quand la machine ne sait pas chiffrer au repos (`safeStorage` indisponible).
 * Une case qui promet un chiffrement sur une machine qui n'en fait pas serait
 * pire que pas de case du tout.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  custodyUnlockErrorKey,
  custodyUnlockErrorOf,
  type CustodyUnlockError,
} from '../../../services/custody';
import { Button } from '../ui/Button/Button';
import { Checkbox } from '../ui/Checkbox/Checkbox';
import { Input } from '../ui/Input/Input';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';

export interface CustodyUnlockDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Vrai quand `safeStorage` est disponible : sinon la case n'est pas offerte. */
  canRemember: boolean;
  /** Lève sur échec ; la cause est traduite ici. */
  onUnlock: (passphrase: string, remember: boolean) => Promise<boolean>;
}

export const CustodyUnlockDialog: React.FC<CustodyUnlockDialogProps> = ({
  isOpen,
  onClose,
  canRemember,
  onUnlock,
}) => {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CustodyUnlockError | null>(null);

  // La phrase ne SURVIT PAS à la fermeture. Une fenêtre rouverte avec le
  // secret encore dans son champ le laisserait s'afficher sur un écran qu'on
  // croyait vide — et le garder en état React n'apporte rien.
  useEffect(() => {
    if (!isOpen) {
      setPassphrase('');
      setRemember(false);
      setError(null);
      setBusy(false);
    }
  }, [isOpen]);

  const submit = useCallback(async () => {
    if (busy || passphrase.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await onUnlock(passphrase, remember && canRemember);
      if (ok) {
        setPassphrase('');
        onClose();
      } else {
        setError('generic');
      }
    } catch (err) {
      setError(custodyUnlockErrorOf(err));
    } finally {
      setBusy(false);
    }
  }, [busy, passphrase, remember, canRemember, onUnlock, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      title={t('custody.unlock.title', { defaultValue: 'Unlock your account vault' })}
    >
      <ModalBody>
        <p className="custody-dialog__intro">
          {t('custody.unlock.intro', {
            defaultValue:
              'Share names are encrypted end-to-end. Enter your recovery passphrase to read them on this computer.',
          })}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            type="password"
            autoFocus
            fullWidth
            autoComplete="off"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            label={t('custody.unlock.field', { defaultValue: 'Recovery passphrase' })}
            helperText={t('custody.unlock.hint', {
              defaultValue:
                'This is the dedicated passphrase you created for your vault — not your account password.',
            })}
            error={
              error
                ? t(custodyUnlockErrorKey(error), {
                    defaultValue: 'Could not unlock the vault.',
                  })
                : undefined
            }
          />
          {canRemember && (
            <Checkbox
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              label={t('custody.unlock.remember', {
                defaultValue: 'Stay unlocked on this computer for 14 days',
              })}
            />
          )}
          {canRemember && remember && (
            <p className="custody-dialog__warning">
              {t('custody.unlock.rememberWarning', {
                defaultValue:
                  'Your vault key will be stored on this computer, encrypted by the operating system. Only do this on a machine you control — you can undo it at any time with “Forget this computer”.',
              })}
            </p>
          )}
          {/* Soumission cachée : la touche Entrée doit valider, et un bouton
              de type submit hors du formulaire ne le ferait pas. */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="tertiary" size="sm" onClick={onClose} disabled={busy}>
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={passphrase.length === 0}
          onClick={() => void submit()}
        >
          {t('custody.unlock.submit', { defaultValue: 'Unlock' })}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CustodyUnlockDialog;
