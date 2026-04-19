/**
 * IconSelector — hybrid picker with 3 tabs
 *
 *   Emojis  | Lucide icons | Custom upload
 *
 * Translates a user pick into the encoded `icon` string documented on
 * the Note type:
 *   - emoji pick      → raw character
 *   - lucide pick     → `lucide:<id>`
 *   - image upload    → `img:<dataUrl>` (compressed to ≤ 256 KB)
 *
 * The active tab is derived from the current value so re-opening the
 * picker lands on the user's last choice.
 */

import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmojiPicker from './EmojiPicker';
import IconPicker from './IconPicker';
import './IconSelector.css';

export type IconKind = 'emoji' | 'lucide' | 'image';

interface IconSelectorProps {
  value?: string;
  onChange: (icon: string | null) => void;
  onClose: () => void;
}

// Max size of the encoded dataUrl we accept from uploads. Covers
// easily fit below this — icons are small (64-128px) so anything
// bigger is a mis-upload.
const MAX_ICON_DATA_URL_BYTES = 256 * 1024;

function detectKind(value: string | undefined): IconKind {
  if (!value) return 'emoji';
  if (value.startsWith('lucide:')) return 'lucide';
  if (value.startsWith('img:')) return 'image';
  return 'emoji';
}

export const IconSelector: React.FC<IconSelectorProps> = ({ value, onChange, onClose }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<IconKind>(() => detectKind(value));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const currentEmoji = useMemo(
    () => (value && detectKind(value) === 'emoji' ? value : undefined),
    [value]
  );
  const currentLucide = useMemo(
    () => (value && detectKind(value) === 'lucide' ? value.slice('lucide:'.length) : undefined),
    [value]
  );
  const currentImage = useMemo(
    () => (value && detectKind(value) === 'image' ? value.slice('img:'.length) : undefined),
    [value]
  );

  const pickEmoji = (emoji: string) => {
    onChange(emoji);
    onClose();
  };

  const pickLucide = (id: string) => {
    onChange(`lucide:${id}`);
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError(t('notes.pickers.notAnImage', 'Ce fichier n’est pas une image.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') return;
      if (dataUrl.length > MAX_ICON_DATA_URL_BYTES) {
        setUploadError(
          t(
            'notes.pickers.imageTooLarge',
            'Image trop grande — compressez-la sous 200 Ko avant de réessayer.'
          )
        );
        return;
      }
      onChange(`img:${dataUrl}`);
      onClose();
    };
    reader.onerror = () => {
      setUploadError(t('notes.pickers.uploadFailed', 'Impossible de lire le fichier.'));
    };
    reader.readAsDataURL(file);
  };

  const removeIcon = () => {
    onChange(null);
    onClose();
  };

  return (
    <div className="icon-selector" onClick={(e) => e.stopPropagation()}>
      <div className="icon-selector__tabs" role="tablist">
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'emoji'}
          className={`icon-selector__tab ${tab === 'emoji' ? 'icon-selector__tab--active' : ''}`}
          onClick={() => setTab('emoji')}
        >
          {t('notes.pickers.tabEmoji', 'Emojis')}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'lucide'}
          className={`icon-selector__tab ${tab === 'lucide' ? 'icon-selector__tab--active' : ''}`}
          onClick={() => setTab('lucide')}
        >
          {t('notes.pickers.tabIcons', 'Icônes')}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'image'}
          className={`icon-selector__tab ${tab === 'image' ? 'icon-selector__tab--active' : ''}`}
          onClick={() => setTab('image')}
        >
          {t('notes.pickers.tabUpload', 'Importer')}
        </button>
      </div>

      {tab === 'emoji' && (
        <EmojiPicker selected={currentEmoji} onSelect={pickEmoji} onRemove={removeIcon} />
      )}
      {tab === 'lucide' && (
        <IconPicker selected={currentLucide} onSelect={pickLucide} onRemove={removeIcon} />
      )}
      {tab === 'image' && (
        <div className="icon-selector__upload">
          {currentImage && (
            <div className="icon-selector__upload-current">
              <img src={currentImage} alt="" />
              <button type="button" className="picker-panel__remove" onClick={removeIcon}>
                {t('notes.removeIcon', 'Retirer')}
              </button>
            </div>
          )}
          <p className="icon-selector__upload-hint">
            {t(
              'notes.pickers.uploadHint',
              'Importez une petite image (PNG, JPG, SVG). Idéalement 128×128 px, moins de 200 Ko.'
            )}
          </p>
          <button
            type="button"
            className="icon-selector__upload-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('notes.pickers.chooseFile', 'Choisir un fichier')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          {uploadError && <div className="icon-selector__error">{uploadError}</div>}
        </div>
      )}
    </div>
  );
};

export default IconSelector;
