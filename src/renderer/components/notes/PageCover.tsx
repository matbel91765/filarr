/**
 * PageCover — Filarr Notes
 *
 * Renders the note's cover banner (solid, gradient, or uploaded image)
 * and the icon chip (emoji / Lucide / custom image). Both are edited
 * through popover selectors hosted inline under the banner.
 *
 * Prop contract:
 *   - `icon` is the raw encoded string from Note.icon (emoji | lucide:id | img:dataUrl)
 *   - Covers are decomposed into three Note fields passed individually:
 *       coverPresetId — preferred, resolves via getCoverPreset()
 *       coverImage    — custom uploaded image (data URL)
 *       coverPosition — 0-100 for image covers
 *       coverColor    — legacy fallback, treated as raw CSS
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import IconSelector from './pickers/IconSelector';
import CoverSelector, { type CoverChange } from './pickers/CoverSelector';
import NoteIcon from './pickers/NoteIcon';
import { getCoverPreset } from '../../../services/notes/coverPresets';
import './PageCover.css';

interface PageCoverProps {
  icon?: string;
  /** Preset id from `coverPresets.ts`. Takes precedence over `coverColor`. */
  coverPresetId?: string;
  /** Uploaded image data URL. Takes precedence over both preset and color. */
  coverImage?: string;
  /** 0-100, vertical position for image covers. Defaults to 50 (center). */
  coverPosition?: number;
  /** 0-100, horizontal position for image covers. Defaults to 50 (center). */
  coverPositionX?: number;
  /** 100-300, scale for image covers. Defaults to 100 (fit). */
  coverScale?: number;
  /** Legacy raw CSS color. Used if no preset/image is set. */
  coverColor?: string;

  onIconChange: (icon: string | null) => void;
  onCoverChange: (change: CoverChange) => void;
  readOnly?: boolean;
}

/**
 * Resolve the final CSS background string from the three cover sources
 * in priority order. Returns null when the note has no cover.
 */
function resolveCoverBackground(
  presetId: string | undefined,
  image: string | undefined,
  color: string | undefined
): { css: string; isImage: boolean } | null {
  if (image) {
    return { css: `url("${image}")`, isImage: true };
  }
  if (presetId) {
    const preset = getCoverPreset(presetId);
    if (preset) return { css: preset.css, isImage: false };
  }
  if (color) {
    return { css: color, isImage: false };
  }
  return null;
}

export const PageCover: React.FC<PageCoverProps> = React.memo(function PageCover({
  icon,
  coverPresetId,
  coverImage,
  coverPosition,
  coverPositionX,
  coverScale,
  coverColor,
  onIconChange,
  onCoverChange,
  readOnly,
}) {
  const { t } = useTranslation();
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showCoverPicker, setShowCoverPicker] = useState(false);

  const background = resolveCoverBackground(coverPresetId, coverImage, coverColor);

  const toggleIconPicker = useCallback(() => {
    if (!readOnly) setShowIconPicker((p) => !p);
  }, [readOnly]);

  const toggleCoverPicker = useCallback(() => {
    if (!readOnly) setShowCoverPicker((p) => !p);
  }, [readOnly]);

  const hasCover = !!background;

  return (
    <>
      {/* Cover banner */}
      {background && (
        <div
          className={`page-cover__banner ${background.isImage ? 'page-cover__banner--image' : ''}`}
          style={
            background.isImage
              ? {
                  backgroundImage: background.css,
                  backgroundPosition: `${coverPositionX ?? 50}% ${coverPosition ?? 50}%`,
                  backgroundSize: `${coverScale ?? 100}%`,
                }
              : { background: background.css }
          }
          onClick={toggleCoverPicker}
          title={readOnly ? undefined : t('notes.changeCover', 'Changer la couverture')}
        />
      )}

      {/* Icon + controls row */}
      <div className={`page-cover__controls ${hasCover ? 'page-cover__controls--with-cover' : ''}`}>
        <button
          className={`page-cover__icon-btn ${icon ? '' : 'page-cover__icon-btn--empty'}`}
          onClick={toggleIconPicker}
          title={readOnly ? undefined : t('notes.changeIcon', 'Changer l’icône')}
          disabled={readOnly}
        >
          {icon ? (
            <NoteIcon icon={icon} size={56} />
          ) : (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              opacity={0.35}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          )}
        </button>

        {!hasCover && !readOnly && (
          <button className="page-cover__add-cover" onClick={toggleCoverPicker}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
            <span>{t('notes.addCover', 'Ajouter une couverture')}</span>
          </button>
        )}
      </div>

      {/* Popovers */}
      {showIconPicker && (
        <div className="page-cover__popover page-cover__popover--icon">
          <IconSelector
            value={icon}
            onChange={(v) => onIconChange(v)}
            onClose={() => setShowIconPicker(false)}
          />
        </div>
      )}
      {showCoverPicker && (
        <div className="page-cover__popover page-cover__popover--cover">
          <CoverSelector
            currentPresetId={coverPresetId}
            currentImage={coverImage}
            currentPosition={coverPosition}
            currentPositionX={coverPositionX}
            currentScale={coverScale}
            onChange={(change) => {
              onCoverChange(change);
              if (change.type === 'clear') setShowCoverPicker(false);
            }}
            onClose={() => setShowCoverPicker(false)}
          />
        </div>
      )}

      {/* Dismiss popovers when the user clicks elsewhere. */}
      {(showIconPicker || showCoverPicker) && (
        <div
          className="page-cover__popover-backdrop"
          onClick={() => {
            setShowIconPicker(false);
            setShowCoverPicker(false);
          }}
        />
      )}
    </>
  );
});

export default PageCover;
