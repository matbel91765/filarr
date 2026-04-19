/**
 * CoverSelector — 3-tab picker for note covers
 *
 *   Presets  | Importer  | Retirer
 *
 * Emits structured updates through `onChange` so the caller can update
 * the three cover-related fields on a note (`coverPresetId`,
 * `coverImage`, `coverPosition`). A null value clears the cover.
 *
 * Upload cap is higher than icons (1 MB) because covers are banner-
 * sized images; we still downsample aggressively on the canvas before
 * storing to keep `notes.enc` reasonable.
 */

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CATEGORY_LABELS,
  getPresetsByCategory,
  type CoverCategory,
  type CoverPreset,
} from '../../../../services/notes/coverPresets';
import './IconSelector.css';

export type CoverChange =
  | { type: 'preset'; presetId: string }
  | { type: 'image'; dataUrl: string }
  | { type: 'position'; position: number }
  | { type: 'positionX'; positionX: number }
  | { type: 'scale'; scale: number }
  | { type: 'clear' };

interface CoverSelectorProps {
  currentPresetId?: string;
  currentImage?: string;
  currentPosition?: number;
  currentPositionX?: number;
  currentScale?: number;
  onChange: (change: CoverChange) => void;
  onClose: () => void;
}

type TabKey = 'presets' | 'image';

// Max dataUrl we'll persist on a note. 1.2 MB leaves breathing room
// over a compressed 1080p JPEG (~500-900 KB typical).
const MAX_COVER_DATA_URL_BYTES = 1200 * 1024;

// Canvas target size — covers are banner-shaped and viewed at ≤ 1200px
// wide in practice. Anything larger is wasted bytes.
const COVER_TARGET_WIDTH = 1600;
const COVER_TARGET_HEIGHT = 600;

/**
 * Load a File into an HTMLImageElement. Promise-wrapped so the caller
 * can await in a single expression.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

/**
 * Downsample an image onto a canvas and return a JPEG dataUrl. Keeps
 * the aspect ratio and fills the target — cropping happens later via
 * CSS `background-position` based on the user's reposition slider.
 */
function downsampleToDataUrl(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  // Preserve aspect ratio — we only cap the width to keep size bounded.
  const scale = Math.min(1, COVER_TARGET_WIDTH / img.naturalWidth);
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // JPEG quality chosen to land most photos below 800 KB at this size.
  return canvas.toDataURL('image/jpeg', 0.82);
}

export const CoverSelector: React.FC<CoverSelectorProps> = ({
  currentPresetId,
  currentImage,
  currentPosition,
  currentPositionX,
  currentScale,
  onChange,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<TabKey>(currentImage ? 'image' : 'presets');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isFr = i18n.language?.startsWith('fr');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError(t('notes.pickers.notAnImage', 'Ce fichier n’est pas une image.'));
      return;
    }

    setUploading(true);
    try {
      const img = await loadImage(file);
      const dataUrl = downsampleToDataUrl(img);
      if (dataUrl.length > MAX_COVER_DATA_URL_BYTES) {
        setUploadError(
          t(
            'notes.pickers.coverTooLarge',
            'Image trop volumineuse après compression. Essayez une image plus petite.'
          )
        );
        return;
      }
      onChange({ type: 'image', dataUrl });
      setTab('image');
    } catch {
      setUploadError(t('notes.pickers.uploadFailed', 'Impossible de lire le fichier.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pickPreset = (p: CoverPreset) => {
    onChange({ type: 'preset', presetId: p.id });
  };

  const handleClear = () => {
    onChange({ type: 'clear' });
    onClose();
  };

  const groups = getPresetsByCategory();

  return (
    <div className="cover-selector" onClick={(e) => e.stopPropagation()}>
      <div className="cover-selector__tabs" role="tablist">
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'presets'}
          className={`cover-selector__tab ${
            tab === 'presets' ? 'cover-selector__tab--active' : ''
          }`}
          onClick={() => setTab('presets')}
        >
          {t('notes.pickers.tabPresets', 'Presets')}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'image'}
          className={`cover-selector__tab ${tab === 'image' ? 'cover-selector__tab--active' : ''}`}
          onClick={() => setTab('image')}
        >
          {t('notes.pickers.tabImage', 'Image')}
        </button>
        <button
          type="button"
          className="cover-selector__tab"
          onClick={handleClear}
          title={t('notes.removeCover', 'Retirer la couverture')}
        >
          {t('notes.pickers.tabRemove', 'Retirer')}
        </button>
      </div>

      {tab === 'presets' ? (
        <div className="cover-selector__body">
          {groups.map(([cat, presets]) => (
            <section key={cat} className="cover-selector__group">
              <h3 className="cover-selector__group-title">
                {CATEGORY_LABELS[cat as CoverCategory][isFr ? 'fr' : 'en']}
              </h3>
              <div className="cover-selector__grid">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`cover-selector__swatch ${
                      currentPresetId === p.id ? 'cover-selector__swatch--active' : ''
                    }`}
                    style={{ background: p.css }}
                    onClick={() => pickPreset(p)}
                    title={p.label}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="cover-selector__upload-zone">
          {currentImage ? (
            <>
              <div
                className="cover-selector__upload-preview"
                style={{
                  backgroundImage: `url("${currentImage}")`,
                  backgroundPosition: `${currentPositionX ?? 50}% ${currentPosition ?? 50}%`,
                  backgroundSize: `${currentScale ?? 100}%`,
                }}
              />

              <div className="cover-selector__position-row">
                <div className="cover-selector__position-label">
                  <span>{t('notes.pickers.scale', 'Zoom')}</span>
                  <span>{currentScale ?? 100}%</span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={300}
                  step={1}
                  value={currentScale ?? 100}
                  onChange={(e) => onChange({ type: 'scale', scale: Number(e.target.value) })}
                  className="cover-selector__position-slider"
                />
              </div>

              <div className="cover-selector__position-row">
                <div className="cover-selector__position-label">
                  <span>{t('notes.pickers.positionX', 'Position horizontale')}</span>
                  <span>{currentPositionX ?? 50}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={currentPositionX ?? 50}
                  onChange={(e) =>
                    onChange({ type: 'positionX', positionX: Number(e.target.value) })
                  }
                  className="cover-selector__position-slider"
                />
              </div>

              <div className="cover-selector__position-row">
                <div className="cover-selector__position-label">
                  <span>{t('notes.pickers.position', 'Position verticale')}</span>
                  <span>{currentPosition ?? 50}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={currentPosition ?? 50}
                  onChange={(e) => onChange({ type: 'position', position: Number(e.target.value) })}
                  className="cover-selector__position-slider"
                />
              </div>
              <button
                type="button"
                className="icon-selector__upload-btn"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading
                  ? t('notes.pickers.uploading', 'Traitement…')
                  : t('notes.pickers.replaceImage', 'Remplacer l’image')}
              </button>
            </>
          ) : (
            <>
              <p className="icon-selector__upload-hint">
                {t(
                  'notes.pickers.coverUploadHint',
                  'Importez une image (PNG, JPG). Elle sera automatiquement redimensionnée et compressée.'
                )}
              </p>
              <button
                type="button"
                className="icon-selector__upload-btn"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading
                  ? t('notes.pickers.uploading', 'Traitement…')
                  : t('notes.pickers.chooseFile', 'Choisir un fichier')}
              </button>
            </>
          )}
          <input
            ref={fileRef}
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

export default CoverSelector;

// Suppress the unused canvas constant warning: kept as documentation
// for future callers that want a strict banner crop.
void COVER_TARGET_HEIGHT;
