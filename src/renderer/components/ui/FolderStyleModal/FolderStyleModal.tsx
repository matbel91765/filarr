/**
 * FolderStyleModal
 *
 * Lets the user personalize a folder: pick a color and (optionally) an emoji
 * shown in place of the generic folder glyph. Reuses the shared Modal primitives
 * and the notes EmojiPicker.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { EmojiPicker } from '../../notes/pickers/EmojiPicker';

interface FolderStyleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (style: { color: string; emoji?: string }) => void;
  folderName: string;
  defaultColor?: string;
  defaultEmoji?: string;
}

const PRESET_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#6366f1',
  '#a855f7',
  '#d946ef',
  '#f43f5e',
  '#64748b',
];

export const FolderStyleModal: React.FC<FolderStyleModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  folderName,
  defaultColor = '#3b82f6',
  defaultEmoji,
}) => {
  const { t } = useTranslation();
  const [color, setColor] = useState(defaultColor);
  const [emoji, setEmoji] = useState<string | undefined>(defaultEmoji);

  const handleApply = () => {
    onSubmit({ color, emoji });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>
        {t('folderStyle.title', 'Couleur & icône')} — {folderName}
      </ModalHeader>
      <ModalBody>
        <div className="flex flex-col gap-5">
          {/* Live preview */}
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
              style={{ backgroundColor: `${color}1f`, color }}
            >
              {emoji ? (
                <span className="text-2xl leading-none">{emoji}</span>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  className="w-6 h-6"
                >
                  <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {folderName}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {t('folderStyle.preview', 'Aperçu')}
              </p>
            </div>
          </div>

          {/* Colors */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2.5">
              {t('colorPicker.presetColors', 'Couleur')}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className="w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    boxShadow:
                      color === c
                        ? '0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-text-primary)'
                        : 'none',
                  }}
                >
                  {color === c && (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth={3.5}
                      className="w-3.5 h-3.5"
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
              <label
                className="w-6 h-6 rounded-full cursor-pointer flex items-center justify-center border border-dashed border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:border-[var(--color-primary-400)] relative overflow-hidden"
                title={t('colorPicker.customColor', 'Couleur personnalisée')}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="w-3.5 h-3.5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label={t('colorPicker.customColor', 'Couleur personnalisée')}
                />
              </label>
            </div>
          </div>

          {/* Emoji — bounded so the full category list scrolls inside a fixed box
              instead of stretching the modal. */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2.5">
              {t('folderStyle.icon', 'Icône (emoji)')}
            </div>
            <div className="flex flex-col h-[240px] rounded-lg border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
              <EmojiPicker
                selected={emoji}
                onSelect={setEmoji}
                onRemove={() => setEmoji(undefined)}
              />
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel', 'Annuler')}
        </Button>
        <Button variant="primary" onClick={handleApply}>
          {t('common.apply', 'Appliquer')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default FolderStyleModal;
