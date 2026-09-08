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

import React, { useCallback, useEffect, useRef, useState } from 'react';
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

  /**
   * ── LES TROIS LIBELLÉS, EXTRAITS DES NOTES ────────────────────────────────
   *
   * Ce composant ne dessine ni une note ni un dossier : il dessine une
   * COUVERTURE et une ICÔNE, et ses props étaient déjà primitives. Le seul
   * reste de couplage était ici — trois chaînes câblées en dur sur l'espace de
   * noms `notes.*`, qui auraient fait dire « Changer l'icône de la note » à
   * l'en-tête d'un dossier.
   *
   * Ils restent OPTIONNELS et retombent sur les clés d'origine : l'éditeur de
   * notes n'a rien à changer, et un nouvel appelant ne peut pas se retrouver
   * sans libellé.
   */
  changeCoverLabel?: string;
  changeIconLabel?: string;
  addCoverLabel?: string;

  /**
   * Signale qu'un sélecteur (icône ou couverture) est ouvert.
   *
   * Les deux popovers sont rendus DANS ce composant : quiconque démonte
   * PageCover démonte le geste en cours. L'éditeur de notes replie désormais
   * son en-tête tout seul au défilement — sans ce signal, un cran de molette
   * pendant le choix d'une couverture ferait disparaître le sélecteur.
   *
   * Optionnel : les appelants qui ne replient rien (en-tête de dossier, notes
   * autocollantes) n'ont rien à passer.
   */
  onPickerOpenChange?: (open: boolean) => void;

  /**
   * Escamote le BANDEAU en gardant l'icône et le reste.
   *
   * C'est le palier intermédiaire de l'éditeur de notes : au défilement la
   * couverture s'efface avant le titre. Distinct de « pas de couverture » —
   * la note en a bien une, on ne la montre simplement pas, donc le bouton
   * « Ajouter une couverture » ne doit surtout pas réapparaître, et le
   * chevauchement négatif de la puce d'icône doit tomber : sans bandeau sous
   * elle, il la tirerait hors du conteneur.
   */
  coverHidden?: boolean;
}

/**
 * Resolve the final CSS background string from the three cover sources
 * in priority order. Returns null when the note has no cover.
 *
 * Exportée : le tableau (`board/BoardCard`) peint le même bandeau en miniature
 * et doit résoudre EXACTEMENT la même chose — un aperçu qui diverge de la page
 * de note n'est pas un aperçu.
 */
export function resolveCoverBackground(
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
  changeCoverLabel,
  changeIconLabel,
  addCoverLabel,
  onPickerOpenChange,
  coverHidden = false,
}) {
  const { t } = useTranslation();
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showCoverPicker, setShowCoverPicker] = useState(false);

  const pickerOpen = showIconPicker || showCoverPicker;
  const pickerReportRef = useRef(onPickerOpenChange);
  pickerReportRef.current = onPickerOpenChange;
  useEffect(() => {
    onPickerOpenChange?.(pickerOpen);
  }, [pickerOpen, onPickerOpenChange]);
  // Le démontage compte comme une fermeture. Sans cela, replier l'en-tête
  // pendant qu'un sélecteur est ouvert emporterait le popover avec lui en
  // laissant l'appelant convaincu qu'un geste est toujours en cours — verrou
  // armé pour de bon. Effet séparé : un nettoyage posé sur `pickerOpen`
  // s'exécuterait aussi à chaque changement, et annoncerait « fermé » juste
  // avant « ouvert ».
  useEffect(() => () => pickerReportRef.current?.(false), []);

  const background = resolveCoverBackground(coverPresetId, coverImage, coverColor);

  const toggleIconPicker = useCallback(() => {
    if (!readOnly) setShowIconPicker((p) => !p);
  }, [readOnly]);

  const toggleCoverPicker = useCallback(() => {
    if (!readOnly) setShowCoverPicker((p) => !p);
  }, [readOnly]);

  const hasCover = !!background;
  // « Il y a une couverture » et « on la dessine » sont deux choses : la
  // première décide du bouton d'ajout, la seconde du bandeau et du
  // chevauchement.
  const coverShown = hasCover && !coverHidden;

  return (
    <>
      {/* Cover banner */}
      {coverShown && background && (
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
          title={
            readOnly
              ? undefined
              : (changeCoverLabel ?? t('notes.changeCover', 'Changer la couverture'))
          }
        />
      )}

      {/* Icon + controls row */}
      <div
        className={`page-cover__controls ${coverShown ? 'page-cover__controls--with-cover' : ''}`}
      >
        <button
          className={`page-cover__icon-btn ${icon ? '' : 'page-cover__icon-btn--empty'}`}
          onClick={toggleIconPicker}
          title={
            readOnly ? undefined : (changeIconLabel ?? t('notes.changeIcon', 'Changer l’icône'))
          }
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
            <span>{addCoverLabel ?? t('notes.addCover', 'Ajouter une couverture')}</span>
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
