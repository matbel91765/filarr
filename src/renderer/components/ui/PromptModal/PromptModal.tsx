/**
 * PromptModal Component
 *
 * Modal réutilisable pour remplacer prompt() dans Electron
 */

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../Modal';
import { Input } from '../Input';
import { Button } from '../Button';

export interface PromptModalProps {
  /** Modal ouvert ou fermé */
  isOpen: boolean;
  /** Callback de fermeture */
  onClose: () => void;
  /** Callback de soumission avec la valeur */
  onSubmit: (value: string) => void;
  /** Titre du modal */
  title: string;
  /** Label de l'input */
  label?: string;
  /** Placeholder de l'input */
  placeholder?: string;
  /** Valeur par défaut */
  defaultValue?: string;
  /** Texte du bouton de soumission */
  submitText?: string;
  /** Texte du bouton d'annulation */
  cancelText?: string;
}

/**
 * Composant PromptModal
 */
export const PromptModal: React.FC<PromptModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title,
  label = '',
  placeholder = '',
  defaultValue = '',
  submitText,
  cancelText,
}) => {
  const { t } = useTranslation();
  const resolvedSubmitText = submitText || t('common.confirm');
  const resolvedCancelText = cancelText || t('common.cancel');
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      // Focus sur l'input après un court délai pour laisser le modal s'ouvrir
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, defaultValue]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim());
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  const handleClose = () => {
    setValue(defaultValue);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="sm">
      <ModalHeader onClose={handleClose}>{title}</ModalHeader>
      <ModalBody>
        <form onSubmit={handleSubmit}>
          <Input
            ref={inputRef}
            label={label}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            fullWidth
            autoFocus
          />
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={handleClose}>
          {resolvedCancelText}
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={!value.trim()}>
          {resolvedSubmitText}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default PromptModal;
