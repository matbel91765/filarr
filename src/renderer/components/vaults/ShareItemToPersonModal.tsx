/**
 * ShareItemToPersonModal — partager UN élément avec UNE personne (E3-6).
 *
 * Un cadre, rien de plus : tout le contenu (choix de la personne, cérémonie
 * d'empreinte, expiration, accès existants) vit dans ShareItemToPersonBody,
 * que le futur ShareDialog rendra inline sans passer par une modale.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalHeader } from '../ui';
import type { VaultItemSummary } from '../../../store/slices/vaultsSlice';
import { ShareItemToPersonBody } from './ShareItemToPersonBody';

interface Props {
  vaultId: string;
  item: VaultItemSummary;
  itemName: string;
  onClose: () => void;
}

export const ShareItemToPersonModal: React.FC<Props> = ({ vaultId, item, itemName, onClose }) => {
  const { t } = useTranslation();

  return (
    <Modal isOpen onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>
        {t('teamVaults.grants.modalTitle', { name: itemName })}
      </ModalHeader>
      <ModalBody>
        <ShareItemToPersonBody vaultId={vaultId} items={[item]} />
      </ModalBody>
    </Modal>
  );
};

export default ShareItemToPersonModal;
