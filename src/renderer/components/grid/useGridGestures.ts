/**
 * Moteur de grille — LES GESTES.
 *
 * Rien n'est inventé ici : le moteur du plan libre (`StickyNotesView` +
 * `notes/board/`) a déjà payé les quatre leçons qui suivent, et elles sont
 * rejouées à l'identique parce qu'elles étaient chères.
 *
 * 1. ARMEMENT À 5 PIXELS. En dessous, un mousedown/mouseup reste un CLIC. Les
 *    deux clics d'un double-clic passent rarement au pixel près, et sans seuil
 *    le micro-écart entre eux « posait » l'élément une case plus loin avant même
 *    que le double-clic ne soit reconnu.
 *
 * 2. REFS MIROIRS. Tout ce que la boucle du geste lit (disposition, colonnes,
 *    métrique, rappels) vit dans une ref. L'effet qui pose les écouteurs ne se
 *    réabonne donc qu'au DÉBUT et à la FIN du geste, jamais entre deux pixels —
 *    sinon on démonte et remonte `mousemove` soixante fois par seconde.
 *
 * 3. ÉCOUTEURS SUR `window`, JAMAIS `mouseleave`. Le piège exact : une barre
 *    d'outils flottante enfant du conteneur déclenche `mouseleave` quand on la
 *    survole en plein glissement, donc un COMMIT — l'élément se pose tout seul
 *    au milieu du mouvement. Du mousedown au mouseup, le geste vit sur `window`
 *    et rien de ce que le curseur traverse ne peut le trancher.
 *
 * 4. COMMIT UNIQUE AU RELÂCHEMENT. Pendant le geste on ne montre qu'un APERÇU,
 *    calculé mais jamais écrit. Une seule écriture part à la fin, et seulement si
 *    la disposition a réellement changé : cette disposition-là se synchronise sur
 *    tous les appareils de l'utilisateur, on n'en pousse pas soixante par seconde.
 *
 * ── CE QUI EST PROPRE À LA GRILLE ──────────────────────────────────────────
 *
 * L'aperçu est TOUJOURS recalculé depuis la disposition de départ, jamais depuis
 * l'aperçu précédent : un aller-retour de la souris doit revenir exactement au
 * point de départ. Et le décalage sous-case (le reste de la division du
 * déplacement par le pas de la grille) est écrit DIRECTEMENT dans le DOM, pas
 * dans l'état — c'est ce qui fait qu'un glissement ne re-rend que quand la CASE
 * change, pas quand le pixel change.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { clampToConstraints, layoutsEqual, moveItem, resizeItem } from './gridSolver';
import type { GridColumnCount, GridPlacement, GridSizeConstraints } from './gridTypes';

/**
 * Course écran à franchir avant qu'un geste soit ARMÉ, en pixels. Même valeur
 * que le plan libre : c'est un réglage de la MAIN, pas de la vue.
 */
export const GESTURE_ARM_PX = 5;

export type GridGestureMode = 'drag' | 'resize';

interface GestureSession {
  mode: GridGestureMode;
  id: string;
  /** Point de pression, en coordonnées client. */
  startX: number;
  startY: number;
  /** Géométrie au moment de la pression, en cases. */
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  /** Le seuil des 5 px est franchi. */
  armed: boolean;
  /** Dernière cible en cases (déplacement) ou dernières dimensions (redimension). */
  curX: number;
  curY: number;
  curW: number;
  curH: number;
}

export interface UseGridGesturesOptions {
  /** Disposition affichée (déjà projetée). Point de départ de chaque geste. */
  items: readonly GridPlacement[];
  columns: GridColumnCount;
  /** Largeur d'une colonne en pixels, relevée sur la surface. */
  cellWidth: number;
  rowHeight: number;
  gutter: number;
  /** Hors édition, aucun geste ne démarre. */
  editing: boolean;
  /**
   * Bornes d'un widget ; `undefined` ⇒ librement redimensionnable de 1×1 aux
   * douze colonnes. Ce n'est PLUS une liste de formats : la poignée pose la
   * géométrie que le curseur dicte, case par case, et ces bornes sont la seule
   * chose qui l'arrête.
   */
  getConstraints: (id: string) => GridSizeConstraints | undefined;
  /** Appelé UNE fois, au relâchement, si quelque chose a bougé. */
  onLayoutChange: (next: GridPlacement[]) => void;
  /** Surface, pour retrouver le nœud saisi et lui poser son décalage. */
  surfaceRef: React.RefObject<HTMLElement | null>;
}

export interface GridGestures {
  /** Aperçu pendant le geste, `items` sinon. Ce que la surface doit rendre. */
  layout: readonly GridPlacement[];
  activeId: string | null;
  mode: GridGestureMode | null;
  beginDrag: (event: React.MouseEvent, id: string) => void;
  beginResize: (event: React.MouseEvent, id: string) => void;
  /** Déplacement au CLAVIER d'une case, commité immédiatement (pas de geste). */
  nudge: (id: string, dx: number, dy: number) => void;
}

export function useGridGestures(options: UseGridGesturesOptions): GridGestures {
  const {
    items,
    columns,
    cellWidth,
    rowHeight,
    gutter,
    editing,
    getConstraints,
    onLayoutChange,
    surfaceRef,
  } = options;

  // ── État visible ─────────────────────────────────────────────────────────
  // `active` change deux fois par geste (début, fin) et sert à (dé)brancher les
  // écouteurs ; `preview` ne change QUE lorsque la case change.
  const [active, setActive] = useState<{ mode: GridGestureMode; id: string } | null>(null);
  const [preview, setPreview] = useState<GridPlacement[] | null>(null);

  // ── Refs miroirs ─────────────────────────────────────────────────────────
  const itemsRef = useRef(items);
  const columnsRef = useRef(columns);
  const cellWidthRef = useRef(cellWidth);
  const rowHeightRef = useRef(rowHeight);
  const gutterRef = useRef(gutter);
  const editingRef = useRef(editing);
  const getConstraintsRef = useRef(getConstraints);
  const onLayoutChangeRef = useRef(onLayoutChange);
  const previewRef = useRef<GridPlacement[] | null>(null);
  const sessionRef = useRef<GestureSession | null>(null);
  /** Nœud saisi, retrouvé une seule fois au mousedown. */
  const activeNodeRef = useRef<HTMLElement | null>(null);
  /** Décalage sous-case, en pixels, poussé dans le DOM et non dans l'état. */
  const offsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);
  useEffect(() => {
    cellWidthRef.current = cellWidth;
  }, [cellWidth]);
  useEffect(() => {
    rowHeightRef.current = rowHeight;
  }, [rowHeight]);
  useEffect(() => {
    gutterRef.current = gutter;
  }, [gutter]);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  useEffect(() => {
    getConstraintsRef.current = getConstraints;
  }, [getConstraints]);
  useEffect(() => {
    onLayoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  // ── Décalage sous-case ───────────────────────────────────────────────────

  /**
   * Écrit le décalage sur le nœud saisi. Le composant ne pose JAMAIS `transform`
   * dans son style, donc React ne l'efface pas au rendu suivant : il ne touche
   * qu'aux propriétés qu'il connaît.
   */
  const applyOffset = useCallback(() => {
    const node = activeNodeRef.current;
    if (!node) return;
    const { x, y } = offsetRef.current;
    node.style.transform = x === 0 && y === 0 ? '' : `translate(${x}px, ${y}px)`;
  }, []);

  const clearOffset = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    offsetRef.current = { x: 0, y: 0 };
    const node = activeNodeRef.current;
    if (node) node.style.transform = '';
    activeNodeRef.current = null;
  }, []);

  /**
   * Un rendu survenu EN PLEIN GESTE (une donnée arrivée du nuage, un survol)
   * reconstruirait le style du nœud et emporterait le décalage avec lui. On le
   * réécrit après chaque rendu tant que le geste dure. Sans tableau de
   * dépendances : c'est exactement « après chaque rendu » qu'il faut, et le
   * corps ne fait rien hors geste.
   */
  useLayoutEffect(() => {
    if (sessionRef.current) applyOffset();
  });

  // ── Fin de geste ─────────────────────────────────────────────────────────

  const finishGesture = useCallback(
    (commit: boolean) => {
      const session = sessionRef.current;
      sessionRef.current = null;
      clearOffset();
      const next = previewRef.current;
      previewRef.current = null;
      setPreview(null);
      setActive(null);
      // Commit UNIQUE, et seulement s'il y a quelque chose à dire : un clic sec
      // sur une poignée ne doit pas pousser une écriture synchronisée décrivant
      // une disposition rigoureusement identique.
      if (commit && session?.armed && next && !layoutsEqual(next, itemsRef.current)) {
        onLayoutChangeRef.current(next);
      }
    },
    [clearOffset]
  );

  const handleMouseUp = useCallback(() => finishGesture(true), [finishGesture]);

  // ── Boucle du geste ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return;

    const onMove = (event: MouseEvent) => {
      const session = sessionRef.current;
      if (!session) return;

      const sdx = event.clientX - session.startX;
      const sdy = event.clientY - session.startY;
      const armed =
        session.armed || Math.abs(sdx) >= GESTURE_ARM_PX || Math.abs(sdy) >= GESTURE_ARM_PX;
      if (!armed) return;

      // Pas de la grille = colonne + gouttière. Le garde-fou évite la division
      // par zéro avant que le `ResizeObserver` n'ait mesuré la surface.
      const pitchX = Math.max(1, cellWidthRef.current + gutterRef.current);
      const pitchY = Math.max(1, rowHeightRef.current + gutterRef.current);
      const cols = columnsRef.current;
      const base = itemsRef.current;

      let next: GridPlacement[] | null = null;
      let updated: GestureSession | null = null;

      if (session.mode === 'drag') {
        const targetX = session.origX + Math.round(sdx / pitchX);
        const targetY = Math.max(0, session.origY + Math.round(sdy / pitchY));
        if (armed !== session.armed || targetX !== session.curX || targetY !== session.curY) {
          updated = { ...session, armed, curX: targetX, curY: targetY };
          next = moveItem(base, session.id, targetX, targetY, cols);
        }
      } else {
        // GESTE LIBRE. Les deux axes sont INDÉPENDANTS : la largeur ne suit que
        // le déplacement horizontal, la hauteur que le vertical, chacun en cases
        // entières. C'est ce qui manquait — la poignée s'aimantait sur le format
        // le plus proche dans le plan, donc tirer vers le bas pouvait sauter de
        // 12×2 à 4×4 : le bloc changeait de LARGEUR sous un geste vertical.
        const rawW = session.origW + Math.round(sdx / pitchX);
        const rawH = session.origH + Math.round(sdy / pitchY);
        // Le coin haut-gauche ne bouge pas pendant un redimensionnement : on
        // borne donc la largeur à la place qui RESTE À DROITE. Sans ça le
        // solveur reculerait l'abscisse pour faire tenir le bloc, et le bloc
        // glisserait latéralement sous le curseur qui tire son coin opposé.
        const room = Math.max(1, cols - session.origX);
        const size = clampToConstraints(rawW, rawH, getConstraintsRef.current(session.id), room);
        if (armed !== session.armed || size.w !== session.curW || size.h !== session.curH) {
          updated = { ...session, armed, curW: size.w, curH: size.h };
          next = resizeItem(base, session.id, size.w, size.h, cols);
        }
      }

      if (updated) {
        sessionRef.current = updated;
        previewRef.current = next;
        setPreview(next);
      }

      // Le décalage se mesure sur la position RÉSOLUE (la gravité a pu poser le
      // widget ailleurs que là où le curseur pointait) : sans ça, l'élément
      // saisi se décollerait du curseur dès la première poussée de voisin.
      if (session.mode === 'drag') {
        const current = sessionRef.current;
        const resolved = (previewRef.current ?? base).find((i) => i.id === session.id);
        if (current && resolved) {
          offsetRef.current = {
            x: sdx - (resolved.x - current.origX) * pitchX,
            y: sdy - (resolved.y - current.origY) * pitchY,
          };
          if (frameRef.current === null) {
            frameRef.current = requestAnimationFrame(() => {
              frameRef.current = null;
              applyOffset();
            });
          }
        }
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Échap ABANDONNE : le geste s'annule sans rien écrire, ce qui est la
      // seule porte de sortie quand on s'aperçoit en plein glissement qu'on
      // tient le mauvais widget.
      if (event.key === 'Escape') {
        event.preventDefault();
        finishGesture(false);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active, handleMouseUp, finishGesture, applyOffset]);

  /** Le geste ne survit pas au démontage : les écouteurs sont sur `window`. */
  useEffect(() => clearOffset, [clearOffset]);

  // ── Démarrage ────────────────────────────────────────────────────────────

  const begin = useCallback(
    (event: React.MouseEvent, id: string, mode: GridGestureMode) => {
      if (event.button !== 0) return;
      if (!editingRef.current) return;
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;

      // `preventDefault` coupe la sélection de texte du navigateur, qui
      // surlignerait tout le contenu traversé pendant le glissement.
      event.preventDefault();
      event.stopPropagation();

      sessionRef.current = {
        mode,
        id,
        startX: event.clientX,
        startY: event.clientY,
        origX: item.x,
        origY: item.y,
        origW: item.w,
        origH: item.h,
        armed: false,
        curX: item.x,
        curY: item.y,
        curW: item.w,
        curH: item.h,
      };
      offsetRef.current = { x: 0, y: 0 };
      // Une seule recherche DOM par geste. Un protocole d'enregistrement de
      // nœuds coûterait une prop de plus sur chaque élément pour la même chose.
      activeNodeRef.current =
        surfaceRef.current?.querySelector<HTMLElement>(`[data-grid-id="${CSS.escape(id)}"]`) ??
        null;
      setActive({ mode, id });
    },
    [surfaceRef]
  );

  const beginDrag = useCallback(
    (event: React.MouseEvent, id: string) => begin(event, id, 'drag'),
    [begin]
  );
  const beginResize = useCallback(
    (event: React.MouseEvent, id: string) => begin(event, id, 'resize'),
    [begin]
  );

  /**
   * Déplacement au clavier. Pas de session, pas d'aperçu : une flèche = une case
   * = une écriture. C'est le seul moyen de ranger sa grille sans souris, et ça
   * passe par exactement le même solveur que le glissement.
   */
  const nudge = useCallback((id: string, dx: number, dy: number) => {
    if (!editingRef.current) return;
    const base = itemsRef.current;
    const item = base.find((i) => i.id === id);
    if (!item) return;
    const next = moveItem(base, id, item.x + dx, Math.max(0, item.y + dy), columnsRef.current);
    if (!layoutsEqual(next, base)) onLayoutChangeRef.current(next);
  }, []);

  return {
    layout: preview ?? items,
    activeId: active?.id ?? null,
    mode: active?.mode ?? null,
    beginDrag,
    beginResize,
    nudge,
  };
}
