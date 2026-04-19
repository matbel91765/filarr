/**
 * ColorPickerModal Component
 *
 * Modal pour sélectionner une couleur pour personnaliser un dossier
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../Modal/Modal';
import { Button } from '../Button/Button';
import './ColorPickerModal.css';

interface ColorPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (color: string) => void;
  defaultColor?: string;
  title?: string;
}

const PRESET_COLORS = [
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#eab308', // Yellow
  '#84cc16', // Lime
  '#22c55e', // Green
  '#10b981', // Emerald
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#0ea5e9', // Sky
  '#6366f1', // Indigo
  '#a855f7', // Violet
  '#d946ef', // Fuchsia
  '#f43f5e', // Rose
  '#64748b', // Slate
];

export const ColorPickerModal: React.FC<ColorPickerModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultColor = '#3b82f6',
  title,
}) => {
  const { t } = useTranslation();
  const resolvedTitle = title || t('colorPicker.title');
  const [selectedColor, setSelectedColor] = useState(defaultColor);

  const handleSubmit = () => {
    onSubmit(selectedColor);
    onClose();
  };

  const handleColorSelect = (color: string) => {
    setSelectedColor(color);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>{resolvedTitle}</ModalHeader>
      <ModalBody>
        <div className="color-picker-modal__content">
          <div className="color-picker-modal__preview">
            <div
              className="color-picker-modal__preview-icon"
              style={{ color: selectedColor }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <p className="color-picker-modal__preview-label">{t('colorPicker.preview')}</p>
          </div>

          <div className="color-picker-modal__label">{t('colorPicker.presetColors')}</div>
          <div className="color-picker-modal__colors">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                className={`color-picker-modal__color ${
                  selectedColor === color ? 'color-picker-modal__color--selected' : ''
                }`}
                style={{ backgroundColor: color }}
                onClick={() => handleColorSelect(color)}
                aria-label={`${t('colorPicker.color')} ${color}`}
              >
                {selectedColor === color && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={3}
                    stroke="white"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className="color-picker-modal__label">{t('colorPicker.customColor')}</div>
          <div className="color-picker-modal__custom">
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
              className="color-picker-modal__input"
            />
            <input
              type="text"
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
              className="color-picker-modal__text-input"
              placeholder="#000000"
              maxLength={7}
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={handleSubmit}>
          {t('common.apply')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ColorPickerModal;
