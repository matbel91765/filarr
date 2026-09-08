/**
 * BoardCard — Filarr Notes / Atelier
 *
 * UNE carte du tableau (`/board`), MÉMOÏSÉE.
 *
 * Ce n'est plus un post-it : le fond est la surface du thème, l'identité de la
 * note vient d'un LISERÉ de teinte et de ce que la note porte DÉJÀ (couverture,
 * icône, tags, taille). Aucun champ synchronisé n'a été ajouté — toutes les
 * variantes sont DÉRIVÉES :
 *
 *   couverture (coverImage / coverPresetId) → bandeau 21:9 en tête
 *   icône                                   → pastille NoteIcon dans le titre
 *   grande taille (viewSizes.sticky)        → « affiche » : titre display
 *   note nue et courte                      → carte compacte
 *
 * Contrainte de mémoïsation (héritée de l'ancienne StickyCard) : les props sont
 * des PRIMITIVES, sauf `tags` dont la référence est stabilisée par un `useMemo`
 * côté vue. Un objet reconstruit à chaque rendu rendrait la comparaison
 * superficielle de `React.memo` toujours fausse et ferait re-rendre les N cartes
 * à chaque mousedown.
 */

import React from 'react';
import NoteIcon from '../pickers/NoteIcon';
import './BoardCard.css';

// ==================== Teinte ====================

/**
 * Teintes de la roue, choisies espacées pour que deux cartes voisines se
 * distinguent d'un coup d'œil. Seule la TEINTE est fixée ici : la saturation et
 * la luminosité sont des tokens CSS (`--board-tint-s` / `--board-tint-l`), donc
 * chaque thème peut les tempérer sans qu'un composant ait à connaître le thème.
 */
const TINT_HUES = [8, 32, 45, 88, 150, 172, 196, 218, 258, 292, 320, 342];

function hashNoteId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Teinte stable d'une note. Hachée sur l'IDENTIFIANT, jamais sur un rang :
 * re-trier ou re-filtrer ne doit pas repeindre le tableau, la couleur est un
 * repère de mémoire. Le raccourci historique « icône = un seul chiffre » choisit
 * la teinte à la main et reste honoré.
 */
export function noteTintHue(id: string, icon?: string): number {
  if (icon && /^\d$/.test(icon)) {
    return TINT_HUES[parseInt(icon, 10) % TINT_HUES.length];
  }
  return TINT_HUES[hashNoteId(id) % TINT_HUES.length];
}

// ==================== Props ====================

export interface BoardCardTag {
  id: string;
  name: string;
  color: string;
}

export interface BoardCardProps {
  noteId: string;
  title: string;
  /** Extrait déjà tronqué par la vue — le texte entier n'a rien à faire au DOM. */
  text: string;
  wordCount: number;
  /** Encodage brut de `Note.icon` (emoji | lucide:id | img:dataUrl). */
  icon?: string;
  /** CSS résolu par `resolveCoverBackground`, ou undefined si la note n'a pas de couverture. */
  coverCss?: string;
  coverIsImage: boolean;
  coverPosition?: number;
  coverPositionX?: number;
  /** Référence STABLE (mémoïsée par la vue), sinon `React.memo` ne sert à rien. */
  tags: BoardCardTag[];
  tintHue: number;
  x: number;
  y: number;
  w: number;
  h: number;
  isDragging: boolean;
  isResizing: boolean;
  /** Membre de la sélection courante (cadre, clic, Ctrl+clic). Primitif : la
   *  mémoïsation tient. */
  isSelected: boolean;
  untitledLabel: string;
  wordsLabel: string;
  resizeLabel: string;
  moreTagsLabel: string;
  onCardMouseDown: (e: React.MouseEvent, noteId: string, x: number, y: number) => void;
  onResizeMouseDown: (e: React.MouseEvent, noteId: string, w: number, h: number) => void;
  onOpen: (noteId: string) => void;
}

/** Seuils de variante, en coordonnées MONDE (la taille posée par l'utilisateur). */
const POSTER_MIN_W = 300;
const POSTER_MIN_H = 240;
/** Au-delà, la note n'est plus « nue et courte » : elle mérite un corps de texte. */
const COMPACT_MAX_CHARS = 90;
/** Nombre de puces affichées avant le « +N ». */
const TAGS_SHOWN = 3;

// ==================== Composant ====================

export const BoardCard: React.FC<BoardCardProps> = React.memo(function BoardCard({
  noteId,
  title,
  text,
  wordCount,
  icon,
  coverCss,
  coverIsImage,
  coverPosition,
  coverPositionX,
  tags,
  tintHue,
  x,
  y,
  w,
  h,
  isDragging,
  isResizing,
  isSelected,
  untitledLabel,
  wordsLabel,
  resizeLabel,
  moreTagsLabel,
  onCardMouseDown,
  onResizeMouseDown,
  onOpen,
}) {
  const label = title || untitledLabel;
  const hasCover = !!coverCss;
  const isPoster = w >= POSTER_MIN_W || h >= POSTER_MIN_H;
  const isCompact = !hasCover && !icon && !isPoster && text.trim().length <= COMPACT_MAX_CHARS;

  const className = [
    'board-card',
    hasCover ? 'board-card--cover' : '',
    isPoster ? 'board-card--poster' : '',
    isCompact ? 'board-card--compact' : '',
    isDragging ? 'board-card--dragging' : '',
    isResizing ? 'board-card--resizing' : '',
    isSelected ? 'board-card--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // `--board-tint-h` : la teinte voyage en variable CSS, pas en couleur figée,
  // pour que le liseré, le halo de survol et le remplissage du niveau de détail
  // « faraway » se dérivent tous de la même valeur côté feuille de style.
  const style = {
    left: x,
    top: y,
    width: w,
    height: h,
    ['--board-tint-h' as string]: String(tintHue),
  } as React.CSSProperties;

  const shownTags = tags.length > TAGS_SHOWN ? tags.slice(0, TAGS_SHOWN) : tags;
  const hiddenTagCount = tags.length - shownTags.length;

  return (
    <div
      className={className}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={label}
      // La sélection du tableau est une sélection MULTIPLE (cadre, Ctrl+clic) :
      // `aria-selected` est le seul état qui la dise à un lecteur d'écran, et
      // `role="button"` ne le porte pas — d'où le `aria-pressed`, qui, lui, est
      // l'état « enfoncé » d'un bouton bascule.
      aria-pressed={isSelected}
      onMouseDown={(e) => onCardMouseDown(e, noteId, x, y)}
      onDoubleClick={() => onOpen(noteId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(noteId);
        }
      }}
    >
      {coverCss && (
        <div
          className="board-card__cover"
          style={
            coverIsImage
              ? {
                  backgroundImage: coverCss,
                  backgroundPosition: `${coverPositionX ?? 50}% ${coverPosition ?? 50}%`,
                  backgroundSize: 'cover',
                }
              : { background: coverCss }
          }
        />
      )}

      <div className="board-card__head">
        {icon && (
          <span className="board-card__icon">
            <NoteIcon icon={icon} size={16} />
          </span>
        )}
        <span className="board-card__title">{label}</span>
      </div>

      {text && (
        <div className="board-card__body">
          <p className="board-card__text">{text}</p>
          {/* Dégradé de fin de texte : sur une carte courte il peint la surface
              sur elle-même, donc il est invisible — pas besoin de le conditionner. */}
          <span className="board-card__fade" aria-hidden="true" />
        </div>
      )}

      {shownTags.length > 0 && (
        <div className="board-card__tags">
          {shownTags.map((tag) => (
            <span
              key={tag.id}
              className="board-card__tag"
              // Poser la variable à vide la rendrait « invalide à la valeur
              // calculée » et emporterait AUSSI le repli de `var()` : une
              // étiquette sans couleur perdrait fond, bordure et texte.
              style={
                tag.color
                  ? ({ ['--board-tag-color' as string]: tag.color } as React.CSSProperties)
                  : undefined
              }
            >
              {tag.name}
            </span>
          ))}
          {hiddenTagCount > 0 && (
            <span className="board-card__tag board-card__tag--more" title={moreTagsLabel}>
              +{hiddenTagCount}
            </span>
          )}
        </div>
      )}

      <div className="board-card__footer">
        {wordCount} {wordsLabel}
      </div>

      {/* Poignée de redimensionnement — stoppe la propagation pour qu'un
          redimensionnement ne démarre pas AUSSI un déplacement. */}
      <div
        className="board-card__resize"
        onMouseDown={(e) => onResizeMouseDown(e, noteId, w, h)}
        title={resizeLabel}
      />
    </div>
  );
});

export default BoardCard;
