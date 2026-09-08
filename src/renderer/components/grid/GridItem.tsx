/**
 * Moteur de grille — UNE CASE.
 *
 * Ne connaît ni le contenu qu'elle porte, ni le solveur : elle sait se placer,
 * et en édition elle offre trois prises (déplacer, changer de format,
 * redimensionner). C'est tout, et c'est voulu — la case est ce qui se réutilise
 * d'un accueil à un dossier sans rien traîner de l'un chez l'autre.
 *
 * ── AUCUN STYLE PROPRE AU REPOS ────────────────────────────────────────────
 *
 * Hors édition, la case n'a ni fond, ni bordure, ni ombre, ni arrondi : elle est
 * un simple rectangle de placement. Un cadre systématique ferait ressembler tous
 * les accueils entre eux et empêcherait un widget de choisir d'être transparent,
 * ou de déborder de sa case. Ce qui se voit vient du contenu.
 *
 * ── CONTRAT DE MÉMOÏSATION ─────────────────────────────────────────────────
 *
 * Toutes les props sont des PRIMITIVES, sauf les rappels — qui doivent être
 * STABLES (la surface les fabrique une fois pour toutes). `renderItem` en
 * particulier : la case l'appelle elle-même au lieu de recevoir des `children`,
 * parce qu'un `children` est un élément neuf à chaque rendu du parent et
 * rendrait la comparaison superficielle de `React.memo` toujours fausse. Sans
 * ça, glisser une case re-rendrait les N autres à chaque case franchie.
 */

import React from 'react';

export interface GridItemProps {
  id: string;
  /** Colonne de départ, base 0. */
  x: number;
  /** Rangée de départ, base 0. */
  y: number;
  w: number;
  h: number;
  editing: boolean;
  /** Case saisie (glissée ou redimensionnée) en ce moment. */
  isActive: boolean;
  /**
   * Le widget a plus d'une géométrie possible : sinon, pas de prise d'angle.
   * Vrai par défaut dans les faits — un widget ne se fige que s'il déclare des
   * bornes qui l'y obligent.
   */
  canResize: boolean;
  /** Il reste au moins deux formats NOMMÉS à proposer en un clic. */
  canCycleSize: boolean;
  /** Nom du format courant (« Bande ») ou, hors catalogue, ses dimensions. */
  sizeName: string;
  dragLabel: string;
  resizeLabel: string;
  cycleSizeLabel: string;
  onDragStart: (event: React.MouseEvent, id: string) => void;
  onResizeStart: (event: React.MouseEvent, id: string) => void;
  onCycleSize: (id: string) => void;
  onNudge: (id: string, dx: number, dy: number) => void;
  /** DOIT être stable (`useCallback`), sinon la mémoïsation ne tient pas. */
  renderItem: (id: string) => React.ReactNode;
}

/** Flèches du clavier → une case. Le seul moyen de ranger sans souris. */
const NUDGES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export const GridItem: React.FC<GridItemProps> = React.memo(function GridItem({
  id,
  x,
  y,
  w,
  h,
  editing,
  isActive,
  canResize,
  canCycleSize,
  sizeName,
  dragLabel,
  resizeLabel,
  cycleSizeLabel,
  onDragStart,
  onResizeStart,
  onCycleSize,
  onNudge,
  renderItem,
}) {
  const className = [
    'grid-item',
    editing ? 'grid-item--editing' : '',
    isActive ? 'grid-item--active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // La géométrie voyage en variables CSS et non en `grid-column` calculé ici :
  // la feuille de style reste le seul endroit qui sait ce qu'est une case, et
  // `transform` n'apparaît nulle part — c'est ce qui permet au moteur de gestes
  // d'y écrire le décalage sous-case sans que React ne l'efface au rendu suivant.
  const style = {
    ['--grid-col-start' as string]: String(x + 1),
    ['--grid-row-start' as string]: String(y + 1),
    ['--grid-w' as string]: String(w),
    ['--grid-h' as string]: String(h),
  } as React.CSSProperties;

  return (
    <div className={className} style={style} data-grid-id={id}>
      <div className="grid-item__content">{renderItem(id)}</div>

      {editing && (
        <div className="grid-item__tools">
          {/* Poignée de déplacement. Un vrai bouton : elle est atteignable au
              clavier, et les flèches y déplacent la case d'un cran. */}
          <button
            type="button"
            className="grid-item__handle"
            aria-label={dragLabel}
            onMouseDown={(e) => onDragStart(e, id)}
            onKeyDown={(e) => {
              const delta = NUDGES[e.key];
              if (!delta) return;
              e.preventDefault();
              onNudge(id, delta[0], delta[1]);
            }}
          >
            <span className="grid-item__grip" aria-hidden="true" />
          </button>

          {canCycleSize && (
            <button
              type="button"
              className="grid-item__size"
              aria-label={cycleSizeLabel}
              title={cycleSizeLabel}
              onClick={() => onCycleSize(id)}
            >
              {sizeName}
            </button>
          )}
        </div>
      )}

      {/* Prise d'angle. `stopPropagation` implicite : le moteur de gestes coupe
          déjà la propagation, donc un redimensionnement ne démarre jamais AUSSI
          un déplacement. Rendue seulement en édition, comme le reste.

          Elle ne propose plus une liste de formats : elle pose la géométrie que
          le curseur dicte, case par case. Elle est donc la prise PRINCIPALE du
          mode édition, et elle se voit — dessinée en permanence tant qu'on
          édite, pas seulement au survol, et assez large pour se saisir sans
          viser. Elle reste décorative pour un lecteur d'écran (`presentation`) :
          elle ne se prend qu'à la souris, et le chemin clavier existe ailleurs
          — la prise de format cycle les tailles nommées, les flèches déplacent
          la case. Annoncer une prise insaisissable serait une fausse promesse. */}
      {editing && canResize && (
        <span
          className="grid-item__resize"
          role="presentation"
          title={resizeLabel}
          onMouseDown={(e) => onResizeStart(e, id)}
        />
      )}
    </div>
  );
});

export default GridItem;
