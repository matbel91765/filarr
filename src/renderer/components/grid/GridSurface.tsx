/**
 * Moteur de grille — LA SURFACE.
 *
 * Autonome : elle ne connaît ni l'accueil, ni les dossiers, ni le moindre
 * widget. On lui donne une disposition maîtresse en douze colonnes et une
 * fonction qui sait dessiner un widget d'après son identifiant ; elle rend la
 * grille, gère l'édition, et rappelle une seule fois quand la disposition a
 * changé. C'est cette autonomie qui la rend portable : le jour où les dossiers
 * veulent la même chose que l'accueil, il n'y a rien à copier.
 *
 * ── LA LARGEUR SE MESURE SUR LE CONTENEUR, PAS SUR LA FENÊTRE ──────────────
 *
 * `ResizeObserver` sur la surface elle-même. Une grille posée dans un panneau de
 * 700 px doit se replier même sur un écran de 4 K, et seule la surface le sait.
 * Les requêtes média n'auraient vu que la fenêtre.
 *
 * ── ON N'ÉDITE QUE LA DISPOSITION MAÎTRESSE ────────────────────────────────
 *
 * L'édition est refusée en dessous de douze colonnes, et ce n'est pas une
 * limitation technique : les largeurs inférieures sont DÉRIVÉES. Y déplacer un
 * widget demanderait de remonter le geste jusqu'à la disposition maîtresse —
 * remontée ambiguë (deux dispositions maîtresses différentes donnent le même
 * repli), donc arbitraire, donc destructrice pour les grands écrans de
 * quelqu'un d'autre. Mieux vaut dire « pas ici » que ranger au hasard.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GridItem } from './GridItem';
import {
  allowedSizeList,
  cycleSize,
  isResizable,
  layoutRowCount,
  projectLayout,
  resizeItem,
  snapToAllowedSize,
} from './gridSolver';
import {
  GRID_COLUMNS,
  GRID_GUTTER,
  GRID_ROW_HEIGHT,
  columnsForWidth,
  sizeIdOf,
  type GridAllowedSizes,
  type GridColumnCount,
  type GridConstraintMap,
  type GridPlacement,
  type GridSizeConstraints,
} from './gridTypes';
import { useGridGestures } from './useGridGestures';
import './grid.css';

export interface GridSurfaceProps {
  /** Disposition MAÎTRESSE, en douze colonnes. Référence stable, sinon tout se re-projette. */
  layout: readonly GridPlacement[];
  /** Mode édition. Sans effet en dessous de douze colonnes (voir en-tête). */
  editing?: boolean;
  /** Appelé UNE fois par geste, avec la disposition maîtresse à enregistrer. */
  onLayoutChange?: (next: GridPlacement[]) => void;
  /**
   * Formats NOMMÉS proposés en un clic par widget (prise de format). Absent ⇒
   * les huit. Ne borne PAS la poignée d'angle : voir `constraints`.
   */
  allowedSizes?: GridAllowedSizes;
  /**
   * Bornes de la poignée d'angle par widget. Absent ⇒ le widget se redimensionne
   * librement, de 1×1 aux douze colonnes. Référence stable de préférence.
   */
  constraints?: GridConstraintMap;
  /** DOIT être stable (`useCallback`) : voir le contrat de mémoïsation de `GridItem`. */
  renderItem: (id: string) => React.ReactNode;
  /** Force le nombre de colonnes — démonstration et tests seulement. */
  columnsOverride?: GridColumnCount;
  rowHeight?: number;
  gutter?: number;
  className?: string;
  /** Rendu à la place de la grille quand la disposition est vide. */
  emptyState?: React.ReactNode;
}

export const GridSurface: React.FC<GridSurfaceProps> = ({
  layout,
  editing = false,
  onLayoutChange,
  allowedSizes,
  constraints,
  renderItem,
  columnsOverride,
  rowHeight = GRID_ROW_HEIGHT,
  gutter = GRID_GUTTER,
  className,
  emptyState,
}) => {
  const { t } = useTranslation();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // ── Mesure ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return;
    // Première mesure immédiate : le `ResizeObserver` ne se déclenche qu'au
    // prochain cycle, et une grille qui naît à zéro colonne clignote.
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const columns = columnsOverride ?? columnsForWidth(width);
  const cellWidth = columns > 0 ? (width - gutter * (columns - 1)) / columns : 0;
  const canEdit = editing && columns === GRID_COLUMNS && !!onLayoutChange;

  // ── Projection ───────────────────────────────────────────────────────────

  // Dérivée, jamais stockée : deux appareils qui reçoivent la même disposition
  // maîtresse affichent le même repli, et aucune écriture ne part d'un repli.
  const projected = useMemo(() => projectLayout(layout, columns), [layout, columns]);

  // ── Rappels stables ──────────────────────────────────────────────────────
  // Tous les rappels rendus à `GridItem` doivent garder leur identité d'un rendu
  // à l'autre, sinon `React.memo` ne sert à rien et un glissement re-rend les N
  // cases. D'où les refs miroirs sur ce qu'ils lisent.

  const allowedSizesRef = useRef(allowedSizes);
  const constraintsRef = useRef(constraints);
  const onLayoutChangeRef = useRef(onLayoutChange);
  const projectedRef = useRef(projected);
  const columnsRef = useRef<GridColumnCount>(columns);
  useEffect(() => {
    allowedSizesRef.current = allowedSizes;
  }, [allowedSizes]);
  useEffect(() => {
    constraintsRef.current = constraints;
  }, [constraints]);
  useEffect(() => {
    onLayoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);
  useEffect(() => {
    projectedRef.current = projected;
  }, [projected]);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  const getConstraints = useCallback(
    (id: string): GridSizeConstraints | undefined => constraintsRef.current?.[id],
    []
  );

  const handleLayoutChange = useCallback((next: GridPlacement[]) => {
    onLayoutChangeRef.current?.(next);
  }, []);

  const gestures = useGridGestures({
    items: projected,
    columns,
    cellWidth,
    rowHeight,
    gutter,
    editing: canEdit,
    getConstraints,
    onLayoutChange: handleLayoutChange,
    surfaceRef,
  });

  /**
   * Formats nommés au clic (et à Entrée : c'est un `<button>`). Le pendant
   * clavier de la prise d'angle — et le seul chemin possible sur un pavé
   * tactile, où tirer une poignée de 22 px n'est pas une option.
   *
   * Depuis que la poignée est libre, la géométrie courante est souvent HORS
   * catalogue. Un cycle qui repartirait du premier format téléporterait alors un
   * 7×11 patiemment réglé vers un 3×1 : le premier clic RANGE donc le bloc sur le
   * format nommé le plus proche, et les suivants parcourent la liste. « Se
   * rapprocher » avant « parcourir » : aucun clic ne fait perdre son travail.
   */
  const handleCycleSize = useCallback((id: string) => {
    const base = projectedRef.current;
    const item = base.find((i) => i.id === id);
    if (!item) return;
    const allowed = allowedSizesRef.current?.[id];
    const current = sizeIdOf(item.w, item.h);
    const next = current
      ? cycleSize(current, allowed, 1)
      : snapToAllowedSize(item.w, item.h, allowed);
    onLayoutChangeRef.current?.(resizeItem(base, id, next.w, next.h, columnsRef.current));
  }, []);

  // ── Rendu ────────────────────────────────────────────────────────────────

  const display = gestures.layout;
  const rows = layoutRowCount(display);

  const surfaceStyle = {
    ['--grid-columns' as string]: String(columns),
    ['--grid-row-height' as string]: `${rowHeight}px`,
    ['--grid-gutter' as string]: `${gutter}px`,
    ['--grid-rows' as string]: String(Math.max(rows, 1)),
  } as React.CSSProperties;

  const surfaceClass = ['grid-surface', canEdit ? 'grid-surface--editing' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  const dragLabel = t('grid.dragHandle');
  const resizeLabel = t('grid.resizeHandle');
  const cycleLabel = t('grid.cycleSize');

  return (
    <div
      ref={surfaceRef}
      className={surfaceClass}
      style={surfaceStyle}
      data-columns={columns}
      data-gesture={gestures.mode ?? undefined}
    >
      {/* L'état vide est ENVELOPPÉ : enfant direct d'une surface `display: grid`,
          il serait auto-placé dans UNE colonne sur douze — un cadre de quarante
          pixels de large où le texte casse mot à mot. L'enveloppe prend toute
          la rangée (voir `grid.css`), quel que soit l'appelant. */}
      {display.length === 0 && emptyState !== undefined && emptyState !== null && (
        <div className="grid-surface__empty">{emptyState}</div>
      )}

      {display.map((item) => {
        const sizes = allowedSizeList(allowedSizes?.[item.id]);
        const currentId = sizeIdOf(item.w, item.h);
        return (
          <GridItem
            key={item.id}
            id={item.id}
            x={item.x}
            y={item.y}
            w={item.w}
            h={item.h}
            editing={canEdit}
            isActive={gestures.activeId === item.id}
            canResize={canEdit && isResizable(constraints?.[item.id], columns)}
            canCycleSize={canEdit && sizes.length > 1}
            // Hors catalogue — le cas ORDINAIRE depuis que la poignée est libre —
            // on montre les dimensions plutôt qu'un libellé vide. Des chiffres et
            // un « × » se lisent dans toutes les langues : rien à traduire.
            sizeName={currentId ? t(`grid.sizes.${currentId}`) : `${item.w} × ${item.h}`}
            dragLabel={dragLabel}
            resizeLabel={resizeLabel}
            cycleSizeLabel={cycleLabel}
            onDragStart={gestures.beginDrag}
            onResizeStart={gestures.beginResize}
            onCycleSize={handleCycleSize}
            onNudge={gestures.nudge}
            renderItem={renderItem}
          />
        );
      })}
    </div>
  );
};

export default GridSurface;
