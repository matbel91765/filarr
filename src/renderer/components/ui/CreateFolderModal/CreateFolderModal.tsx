/**
 * CreateFolderModal Component
 *
 * Création d'un dossier avec CHOIX DE L'EMPLACEMENT.
 *
 * Remplace le PromptModal « nom seul » : celui-ci créait toujours dans le
 * dossier ouvert (ou à la racine depuis l'accueil), sans recours. L'emplacement
 * est prérempli avec le contexte d'appel, donc le geste habituel reste
 * « taper un nom, valider ».
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../Modal';
import { Input } from '../Input';
import { Button } from '../Button';
import { InlineFolderPicker } from '../../automation/InlineFolderPicker';

export interface CreateFolderModalProps {
  /** Modal ouvert ou fermé */
  isOpen: boolean;
  /** Callback de fermeture */
  onClose: () => void;
  /** Callback de soumission : nom + dossier parent (`null` = racine) */
  onSubmit: (name: string, parentId: string | null) => void;
  /** Emplacement proposé à l'ouverture (`null` = racine) */
  defaultParentId?: string | null;
  /** Titre du modal (par défaut : « Nouveau dossier ») */
  title?: string;
}

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultParentId = null,
  title,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(defaultParentId);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setParentId(defaultParentId);
    }
  }, [isOpen, defaultParentId]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed, parentId);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalHeader onClose={onClose} closeLabel={t('common.close')}>
        {title || t('folder.createTitle')}
      </ModalHeader>
      <ModalBody>
        <form onSubmit={handleSubmit}>
          <Input
            label={t('folder.nameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('folder.namePlaceholder')}
            fullWidth
            autoFocus
          />
          <div style={{ marginTop: '16px' }}>
            <InlineFolderPicker
              label={t('folder.locationLabel')}
              placeholder={t('folder.locationRoot')}
              value={parentId}
              onChange={(folderId) => setParentId(folderId || null)}
            />
          </div>
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={() => handleSubmit()} disabled={!name.trim()}>
          {t('common.create')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateFolderModal;
