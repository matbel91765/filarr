/**
 * RENOMMER UN PARTAGE — le libellé et le client.
 *
 * Deux champs, et pas un de plus. Ce sont exactement ceux du site et du mobile
 * (`{label, client}`), parce que le contenu du sceau est un contrat partagé :
 * un troisième champ ajouté ici serait scellé, envoyé, et silencieusement
 * ignoré par les deux autres clients — donc invisible partout sauf sur la
 * machine qui l'a écrit.
 *
 * VIDER LES DEUX CHAMPS EFFACE le libellé, ici comme sur le serveur (`null`).
 * C'est le seul geste d'effacement, et il n'a pas besoin d'un bouton à lui :
 * un « Supprimer le nom » à côté d'un champ qu'on peut vider serait deux
 * chemins pour un même résultat.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_LABEL_LENGTH, type ShareLabel } from '../../../services/sharing/shareLabels';
import { Button } from '../ui/Button/Button';
import { Input } from '../ui/Input/Input';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';

export interface ShareRenameDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Valeur courante, ou `undefined` quand le partage n'a pas encore de nom. */
  initial?: ShareLabel;
  /** Reçoit la valeur BRUTE ; la normalisation appartient au modèle. */
  onSave: (value: ShareLabel) => Promise<void>;
}

export const ShareRenameDialog: React.FC<ShareRenameDialogProps> = ({
  isOpen,
  onClose,
  initial,
  onSave,
}) => {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [client, setClient] = useState('');
  const [busy, setBusy] = useState(false);

  // Les champs sont ré-amorcés à chaque OUVERTURE, pas au montage : la fenêtre
  // est réutilisée d'une ligne à l'autre, et garder la valeur précédente
  // ferait renommer un partage avec le nom d'un autre.
  useEffect(() => {
    if (isOpen) {
      setLabel(initial?.label ?? '');
      setClient(initial?.client ?? '');
      setBusy(false);
    }
  }, [isOpen, initial]);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave({ label, client });
      onClose();
    } finally {
      setBusy(false);
    }
  }, [busy, label, client, onSave, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      title={t('sharing.management.renameTitle', { defaultValue: 'Rename this share' })}
    >
      <ModalBody>
        <p className="custody-dialog__intro">
          {t('sharing.management.renameIntro', {
            defaultValue:
              'The name is encrypted before it leaves this computer, so it follows you to your other devices without the server ever reading it.',
          })}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            autoFocus
            fullWidth
            maxLength={MAX_LABEL_LENGTH}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            label={t('sharing.management.renameLabel', { defaultValue: 'Name' })}
            placeholder={t('sharing.management.renameLabelPlaceholder', {
              defaultValue: 'Roof quote — June',
            })}
          />
          <Input
            fullWidth
            maxLength={MAX_LABEL_LENGTH}
            value={client}
            onChange={(e) => setClient(e.target.value)}
            label={t('sharing.management.renameClient', { defaultValue: 'Client (optional)' })}
            helperText={t('sharing.management.renameClear', {
              defaultValue: 'Leave both fields empty to remove the name.',
            })}
          />
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="tertiary" size="sm" onClick={onClose} disabled={busy}>
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
          {t('common.save', { defaultValue: 'Save' })}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ShareRenameDialog;
