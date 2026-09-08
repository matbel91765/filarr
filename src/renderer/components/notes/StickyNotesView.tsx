/**
 * StickyNotesView — Filarr Notes / Atelier
 *
 * Plan 2D libre : cartes posées, déplacées, redimensionnées, panoramique et
 * zoom. La route `/board` en fait une DESTINATION plein écran (voir `source`).
 *
 * Le moteur de gestes (armement, refs miroirs, écriture unique au relâchement)
 * est décrit plus bas et n'a pas bougé. Ce qui a changé, livraison après
 * livraison :
 *
 * « LE REGARD » — les cartes sont des `BoardCard` (surface du thème + liseré de
 * teinte) ; le zoom est ANCRÉ AU CURSEUR ; la molette suit les conventions
 * Figma ; le fond est un décor à trois couches verrouillé au monde
 * (`ParallaxBackdrop`) ; le niveau de détail est purement CSS (`data-lod`).
 *
 * « LA MAIN » — ce qu'on peut FAIRE d'un tableau, pas seulement en voir un :
 *   - des GUIDES D'ALIGNEMENT magnétiques pendant le glissement, prioritaires
 *     sur l'aimantation à la grille (`alignmentSnap`) ;
 *   - une SÉLECTION AU CADRE sur le fond (le clic gauche sur le vide ne servait
 *     à rien — le panoramique est au clic-milieu ou Maj+clic) ;
 *   - le glissement de GROUPE, qui commite en UNE action ;
 *   - Suppr (avec confirmation) et Échap sur la sélection ;
 *   - un bouton « Ranger le tableau ».
 *
 * « L'ÉCHELLE » — ce qui tient encore à cinq cents notes :
 *   - CULLING : au-delà de `CULL_THRESHOLD`, seules les cartes qui coupent le
 *     rectangle visible (plus une marge d'hystérésis) sont montées ;
 *   - le PANORAMIQUE n'écrit plus `pan` dans l'état à chaque pixel : il pousse
 *     la transformée directement dans le DOM et ne commite qu'au relâchement,
 *     exactement comme le glissement le fait déjà pour Redux ;
 *   - une MINIMAP en un seul canvas 2D, redessinée en rAF.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { AppDispatch, RootState } from '../../../store';
import {
  addNote,
  deleteNotesBatch,
  selectAllNotes,
  selectFilteredNotes,
  setEditingNote,
  setNoteViewGeometry,
  setManyNoteViewGeometry,
  materializeStickyPositions,
  migrateStickyPositionPollution,
} from '../../../store/slices/notesSlice';
import { createNote as createNoteService } from '../../../services/notes/noteService';
import type { Note } from '../../../types/notes';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { BoardCard, noteTintHue, type BoardCardTag } from './board/BoardCard';
import { ParallaxBackdrop, type ParallaxBackdropHandle } from './board/ParallaxBackdrop';
import { AlignmentGuides, type BoardGuide } from './board/AlignmentGuides';
import { Minimap, type MinimapHandle, type MinimapNote } from './board/Minimap';
import { resolveCoverBackground } from './PageCover';
import * as profileStorage from '../../../services/core/profileStorage';
import './StickyNotesView.css';

// ==================== Constants ====================

const DEFAULT_SIZE = { w: 200, h: 160 };
const MIN_STICKY_SIZE = { w: 120, h: 80 };
const MAX_STICKY_SIZE = { w: 600, h: 600 };
const GRID_SNAP = 20;
/**
 * Course écran à franchir avant qu'un geste soit ARMÉ, en pixels non zoomés.
 * En dessous, le mousedown/mouseup reste un clic : les deux clics d'un
 * double-clic passent rarement au pixel près, et sans ce seuil le micro-écart
 * entre eux « posait » la note à une case de là avant même l'ouverture.
 */
const GESTURE_ARM_PX = 5;
/**
 * Point de vue et minimap restent PAR APPAREIL — un cadrage n'a de sens que
 * devant l'écran où il a été posé, on ne le synchronise pas. Ils passent quand
 * même par profileStorage : seule leur PORTÉE change (par profil, plus par
 * poste), pas leur nature.
 */
const STICKY_VIEW_STORAGE_KEY = 'filarr.stickyView.viewport.v1';
const MINIMAP_STORAGE_KEY = 'filarr.stickyView.minimap.v1';

/** Bornes du zoom. Inchangées : le point de vue enregistré est validé dessus. */
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
/**
 * Sensibilité du zoom molette. Exponentielle et non multiplicative par cran :
 * un pavé tactile envoie des dizaines de petits deltas par pincement, un pas
 * fixe de ×1,1 les transformait en bond. `exp(-100 × 0.001) ≈ 1,105` conserve
 * exactement l'ancienne sensation à la souris (un cran = 100).
 */
const ZOOM_SENSITIVITY = 0.001;

/**
 * Tolérance des guides d'alignement, en unités MONDE.
 *
 * Six pixels et pas vingt : au-delà, l'aimant attire des cartes que
 * l'utilisateur ne voulait pas aligner et le geste devient collant. En dessous
 * de quatre, il faut viser — et un aimant qu'il faut viser ne sert à rien.
 */
const ALIGN_TOLERANCE = 6;

/**
 * Au-delà de ce nombre de notes MONTÉES, la vue ne rend plus que ce qui coupe
 * le rectangle visible. En dessous, le filtrage coûterait plus cher que les
 * quelques nœuds qu'il éviterait — et surtout il rendrait le comportement de la
 * vue dépendant du point de vue pour rien.
 */
const CULL_THRESHOLD = 200;
/**
 * Marge d'HYSTÉRÉSIS autour du rectangle visible, en unités monde.
 *
 * Elle a deux rôles. Le premier est cosmétique : une carte qui entre par un
 * bord est déjà montée quand elle devient visible, donc elle n'« apparaît »
 * jamais. Le second est le vrai : pendant un panoramique, `pan` n'est pas dans
 * l'état React — on ne re-rend (et donc on ne re-cull) que lorsque le regard
 * SORT de cette marge. Deux cents pixels de plus, c'est un rendu de moins tous
 * les quelques dixièmes de seconde de glissement.
 */
const CULL_MARGIN = 400;

/** Gouttière entre deux cases de « Ranger le tableau », en unités monde. */
const TIDY_GUTTER = 20;

/**
 * Seuils de NIVEAU DE DÉTAIL. Le zoom minimal étant 0,3, la bande « faraway »
 * est étroite mais atteignable (recadrage « Tout afficher » sur un grand plan).
 */
function lodFor(zoom: number): 'near' | 'far' | 'faraway' {
  if (zoom < 0.35) return 'faraway';
  if (zoom < 0.5) return 'far';
  return 'near';
}

/** Longueur d'extrait envoyée au DOM. Au-delà, personne ne lit sur une carte. */
const CARD_TEXT_CHARS = 320;

/** Références constantes : un `[]` neuf à chaque rendu re-rendrait toute la vue. */
const EMPTY_TAGS: BoardCardTag[] = [];
const EMPTY_GUIDES: BoardGuide[] = [];

function getStickySize(note: Note): { w: number; h: number } {
  return note.viewSizes?.sticky ?? DEFAULT_SIZE;
}

// ==================== Helpers ====================

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Position the user actually placed the note at, or null if there is none. */
function getStoredStickyPos(note: Note): { x: number; y: number } | null {
  // New canonical location for sticky coordinates.
  if (note.viewPositions?.sticky) return note.viewPositions.sticky;
  // Legacy fallback: coverColor used to double as "x,y" position storage.
  // Read but don't write here — `migrateStickyPositionPollution` migrates
  // these values to viewPositions on mount.
  if (note.coverColor && note.coverColor.includes(',')) {
    const [x, y] = note.coverColor.split(',').map(Number);
    if (!isNaN(x) && !isNaN(y)) return { x, y };
  }
  return null;
}

/**
 * Coordonnées de la note. Plus de case calculée d'après un rang : ce rang était
 * une APPARTENANCE à l'ensemble des notes non posées, et la note qu'on venait de
 * déplacer en sortait — toutes les suivantes reculaient alors d'une case au
 * relâchement de la souris. `materializeStickyPositions` écrit une vraie
 * position à chacune (voir l'effet de mise en page plus bas), donc ce repli ne
 * sert qu'au tout premier rendu, avant que le reducer n'ait tranché.
 */
function getStickyPos(note: Note): { x: number; y: number } {
  return getStoredStickyPos(note) ?? { x: 40, y: 40 };
}

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SNAP) * GRID_SNAP;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Rectangle du MONDE que la fenêtre montre, pour un point de vue donné. */
function visibleWorldRect(
  pan: { x: number; y: number },
  zoom: number,
  size: { w: number; h: number }
): Rect {
  return { x: -pan.x / zoom, y: -pan.y / zoom, w: size.w / zoom, h: size.h / zoom };
}

/**
 * AIMANTATION AUX VOISINES, prioritaire sur l'aimantation à la grille.
 *
 * On compare les trois abscisses remarquables de la boîte qu'on déplace (bord
 * gauche, centre, bord droit) aux trois de chaque voisine MONTÉE, et pareil en
 * ordonnées. Le meilleur accord à moins de `ALIGN_TOLERANCE` gagne ; s'il n'y
 * en a aucun sur un axe, cet axe retombe sur la grille de 20.
 *
 * L'ordre de priorité n'est pas un détail. La grille aligne les cartes sur des
 * multiples de 20 — deux cartes de largeurs différentes y sont « rangées » sans
 * jamais partager un bord ni un centre. Ce sont les guides qui alignent
 * vraiment ; la grille n'est que le repli quand il n'y a rien à aligner.
 *
 * Les deux axes sont indépendants : on peut très bien être aimanté au bord
 * gauche d'une voisine et à la grille en ordonnée.
 */
function alignmentSnap(
  raw: { x: number; y: number },
  w: number,
  h: number,
  others: Array<Rect & { id: string }>,
  exclude: Set<string>
): { x: number; y: number; guides: BoardGuide[] } {
  const movingX = [raw.x, raw.x + w / 2, raw.x + w];
  const movingY = [raw.y, raw.y + h / 2, raw.y + h];

  let bestDX = Infinity;
  let posX = 0;
  let otherX: Rect | null = null;
  let bestDY = Infinity;
  let posY = 0;
  let otherY: Rect | null = null;

  for (const o of others) {
    // Le filtrage est fait ICI et non par un `.filter()` en amont : ce chemin
    // est parcouru à chaque `mousemove`, et un tableau neuf de cinq cents
    // entrées par image est du travail pur pour le ramasse-miettes.
    if (exclude.has(o.id)) continue;
    const candX = [o.x, o.x + o.w / 2, o.x + o.w];
    for (const mv of movingX) {
      for (const cv of candX) {
        const d = cv - mv;
        if (Math.abs(d) <= ALIGN_TOLERANCE && Math.abs(d) < Math.abs(bestDX)) {
          bestDX = d;
          posX = cv;
          otherX = o;
        }
      }
    }
    const candY = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const mv of movingY) {
      for (const cv of candY) {
        const d = cv - mv;
        if (Math.abs(d) <= ALIGN_TOLERANCE && Math.abs(d) < Math.abs(bestDY)) {
          bestDY = d;
          posY = cv;
          otherY = o;
        }
      }
    }
  }

  const x = otherX ? raw.x + bestDX : snapToGrid(raw.x);
  const y = otherY ? raw.y + bestDY : snapToGrid(raw.y);

  // Le trait relie la carte tenue à celle sur laquelle elle s'accorde, et
  // s'arrête là : un trait qui traverse tout le plan ne désigne plus personne.
  const guides: BoardGuide[] = [];
  if (otherX) {
    guides.push({
      axis: 'x',
      pos: posX,
      from: Math.min(y, otherX.y),
      to: Math.max(y + h, otherX.y + otherX.h),
    });
  }
  if (otherY) {
    guides.push({
      axis: 'y',
      pos: posY,
      from: Math.min(x, otherY.x),
      to: Math.max(x + w, otherY.x + otherY.w),
    });
  }
  return { x, y, guides };
}

/**
 * « RANGER LE TABLEAU » — la mise en page en grille de
 * `materializeStickyPositions`, mais RÉAPPLIQUÉE à des notes déjà posées.
 *
 * Le reducer, lui, ignore volontairement toute note qui a déjà une position :
 * c'est ce qui le rend idempotent et sans danger au montage. Ici l'utilisateur
 * DEMANDE l'écrasement, et il le confirme — d'où ce calcul côté vue, commité
 * par un seul `setManyNoteViewGeometry`.
 *
 * Deux écarts assumés avec le reducer, tous deux dictés par l'échelle :
 *  - la case suit la PLUS GRANDE carte du lot, sinon « ranger » deux cents
 *    notes dont trois affiches produirait trois chevauchements ;
 *  - le nombre de colonnes suit la racine carrée de l'effectif : les 4 colonnes
 *    en dur du reducer donneraient un ruban de cinquante rangs, c'est-à-dire un
 *    tableau qu'on ne peut plus regarder d'un coup.
 *
 * L'origine est le coin haut-gauche de ce qu'on range : le bloc reste là où
 * l'utilisateur le regardait, il ne saute pas à l'origine du plan.
 */
function tidyPositions(targets: Note[]): Array<{ id: string; x: number; y: number }> {
  if (targets.length === 0) return [];

  // Ordre `createdAt` puis `id` — jamais `updatedAt`, que cette vue ne suit pas
  // (voir `setNoteViewGeometry`) : un tri sur l'horloge d'édition ferait sauter
  // les cases d'un rangement à l'autre sans que rien n'ait bougé sur le plan.
  const sorted = [...targets].sort((a, b) => {
    const cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  });

  let cellW = DEFAULT_SIZE.w;
  let cellH = DEFAULT_SIZE.h;
  let ox = Infinity;
  let oy = Infinity;
  for (const n of sorted) {
    const s = getStickySize(n);
    if (s.w > cellW) cellW = s.w;
    if (s.h > cellH) cellH = s.h;
    const p = getStickyPos(n);
    if (p.x < ox) ox = p.x;
    if (p.y < oy) oy = p.y;
  }
  cellW = snapToGrid(cellW + TIDY_GUTTER);
  cellH = snapToGrid(cellH + TIDY_GUTTER);
  const originX = Number.isFinite(ox) ? snapToGrid(ox) : 40;
  const originY = Number.isFinite(oy) ? snapToGrid(oy) : 40;
  const cols = Math.max(1, Math.round(Math.sqrt(sorted.length)));

  return sorted.map((n, i) => ({
    id: n.id,
    x: originX + (i % cols) * cellW,
    y: originY + Math.floor(i / cols) * cellH,
  }));
}

/**
 * Case libre la plus proche de `(x, y)`, en descendant la diagonale.
 *
 * Sert au bouton « + Note », qui vise toujours le centre de la vue : sans ça,
 * cinq clics d'affilée empilaient cinq notes exactement au même endroit — le
 * tas ressemble à UNE note et les quatre autres passent pour perdues. Le
 * double-clic, lui, vise un point que l'utilisateur a choisi sur du vide : on
 * ne corrige rien.
 */
function findFreeSpot(x: number, y: number, notes: Note[]): { x: number; y: number } {
  const taken = new Set<string>();
  for (const n of notes) {
    const p = getStoredStickyPos(n);
    if (p) taken.add(`${p.x},${p.y}`);
  }
  let cx = x;
  let cy = y;
  for (let i = 0; i < 200 && taken.has(`${cx},${cy}`); i++) {
    cx += GRID_SNAP;
    cy += GRID_SNAP;
  }
  return { x: cx, y: cy };
}

/** A-t-on déjà un point de vue enregistré pour cette vue ? (voir l'auto-cadrage) */
function hasStoredViewport(): boolean {
  try {
    return profileStorage.getItemWithLegacyFallback(STICKY_VIEW_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

// ==================== Component ====================

interface StickyNotesViewProps {
  /** See MasonryView — click/double-click switches to list mode + opens editor. */
  onOpenNote?: (id: string) => void;
  /**
   * D'OÙ viennent les notes affichées.
   *
   * `'filtered'` (défaut) : la vue est un MODE de la section Notes et suit ses
   * filtres — carnet, dossier, recherche. C'est ce qu'on veut quand elle est
   * l'un des onglets de vue.
   *
   * `'all'` : la vue est une DESTINATION (route `/board`). Un tableau où
   * « il manque des notes » selon un filtre posé dans un autre écran une heure
   * plus tôt n'est pas un tableau, c'est un piège : ici, tout est là.
   */
  source?: 'filtered' | 'all';
}

/** Le geste de déplacement, une carte ou tout un groupe. */
interface DragState {
  /** La carte SAISIE. Les autres membres suivent le même écart. */
  noteId: string;
  armed: boolean;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  curX: number;
  curY: number;
  /**
   * Boîte englobante du groupe au moment de la prise. C'est ELLE qu'on aimante
   * (bords et centre) : aimanter la seule carte saisie alignerait un membre au
   * hasard du groupe et laisserait le bloc de travers.
   */
  box: Rect;
  /** Membres et positions d'origine, FIGÉS à la prise. */
  group: Array<{ id: string; x: number; y: number }>;
  guides: BoardGuide[];
}

/** Le cadre de sélection, en pixels ÉCRAN relatifs à la fenêtre. */
interface MarqueeState {
  armed: boolean;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  /** Ctrl/Cmd à la prise : le cadre AJOUTE à la sélection au lieu de la remplacer. */
  additive: boolean;
}

export const StickyNotesView: React.FC<StickyNotesViewProps> = React.memo(function StickyNotesView({
  onOpenNote,
  source = 'filtered',
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const isBoard = source === 'all';
  const notes = useSelector(isBoard ? selectAllNotes : selectFilteredNotes);
  // `EMPTY_TAGS` et non `[]` : un tableau neuf à chaque appel du sélecteur
  // ferait re-rendre la vue à CHAQUE action du store, tableau vide ou pas.
  const tags = useSelector((s: RootState) => s.tags?.tags ?? EMPTY_TAGS) as BoardCardTag[];

  // Heal notes whose sticky position was stored in the legacy
  // `coverColor` field (pre-#19 schema). Idempotent: already-migrated
  // notes have no `<num>,<num>` coverColor so the reducer is a no-op.
  useEffect(() => {
    dispatch(migrateStickyPositionPollution());
  }, [dispatch]);

  // Notes que personne n'a encore posées sur le canevas. Tant qu'il en reste,
  // leur place n'existe QUE dans le rendu — et disparaît dès qu'une voisine est
  // déplacée. On les matérialise (voir `materializeStickyPositions`).
  const unplacedIds = useMemo(
    () => notes.filter((n) => getStoredStickyPos(n) === null).map((n) => n.id),
    [notes]
  );

  /**
   * Les puces de tags, résolues UNE fois pour tout le tableau.
   *
   * C'est la seule prop non primitive d'une carte, donc sa RÉFÉRENCE doit être
   * stable d'un rendu à l'autre : un `note.tagIds.map(...)` dans le rendu
   * fabriquerait un tableau neuf à chaque image d'un glissement et ferait
   * échouer la comparaison de `React.memo` pour les N cartes — exactement ce que
   * la mémoïsation existe pour éviter. Ici, tant que ni les notes ni les tags ne
   * changent, chaque carte reçoit le même tableau.
   */
  const tagsByNote = useMemo(() => {
    const byId = new Map<string, BoardCardTag>();
    for (const tag of tags) byId.set(tag.id, tag);
    const map = new Map<string, BoardCardTag[]>();
    for (const n of notes) {
      if (!n.tagIds?.length) continue;
      const list: BoardCardTag[] = [];
      for (const id of n.tagIds) {
        const tag = byId.get(id);
        if (tag) list.push(tag);
      }
      if (list.length) map.set(n.id, list);
    }
    return map;
  }, [notes, tags]);

  /**
   * AUTO-CADRAGE À L'OUVERTURE — tableau seulement.
   *
   * `needed` part à vrai quand aucun point de vue n'a jamais été enregistré, et
   * repasse à vrai chaque fois que ce montage a dû POSER des notes qui ne
   * l'avaient jamais été : la grille fraîche descend alors bien plus bas que la
   * fenêtre, et sans recadrage l'utilisateur voit huit notes sur deux cents et
   * conclut que le reste a disparu. Hors de ces deux cas on ne touche à rien —
   * le zoom et le panoramique enregistrés sont un choix de l'utilisateur.
   *
   * La lecture du stockage passe par un état à initialiseur PARESSEUX, pas par
   * l'initialiseur du `useRef` : celui-ci est évalué à chaque rendu, ce qui
   * aurait glissé un accès `localStorage` synchrone dans chaque image d'un
   * glissement. Et elle doit être faite au MONTAGE de toute façon — l'effet de
   * persistance écrit dès le premier rendu, donc plus tard la réponse serait
   * « oui » même pour un premier passage.
   */
  const [viewportWasStored] = useState(hasStoredViewport);
  const autoFit = useRef({ done: false, needed: !viewportWasStored });

  // `useLayoutEffect` : le reducer écrit les positions AVANT la peinture, donc
  // l'utilisateur ne voit jamais la pile de notes empilées sur le repli. La
  // boucle se ferme d'elle-même — après écriture, `unplacedIds` est vide et
  // l'effet ne dispatche plus rien (le reducer est de toute façon idempotent).
  useLayoutEffect(() => {
    if (unplacedIds.length === 0) return;
    autoFit.current.needed = true;
    dispatch(materializeStickyPositions(unplacedIds));
  }, [unplacedIds, dispatch]);

  /** La FENÊTRE (repère écran). */
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Le PLAN transformé (repère monde) — sert à reconnaître un clic sur le fond. */
  const contentRef = useRef<HTMLDivElement>(null);
  /** Décor et minimap : rafraîchis SANS rendu pendant un panoramique. */
  const backdropRef = useRef<ParallaxBackdropHandle>(null);
  const minimapRef = useRef<MinimapHandle>(null);

  // Persist zoom + pan so reopening the view returns to the same vantage
  // point — stickies are used for durable spatial organization, losing
  // the view position every session breaks the mental model. Hydrate
  // synchronously on mount; saving is best-effort (a quota error just
  // means the user starts from the default next launch).
  const [pan, setPan] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = profileStorage.getItemWithLegacyFallback(STICKY_VIEW_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.pan && Number.isFinite(parsed.pan.x) && Number.isFinite(parsed.pan.y)) {
          return { x: parsed.pan.x, y: parsed.pan.y };
        }
      }
    } catch {
      /* fall back to default */
    }
    return { x: 0, y: 0 };
  });
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const raw = profileStorage.getItemWithLegacyFallback(STICKY_VIEW_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.zoom === 'number' && parsed.zoom >= 0.3 && parsed.zoom <= 3) {
          return parsed.zoom;
        }
      }
    } catch {
      /* fall back to default */
    }
    return 1;
  });

  useEffect(() => {
    try {
      profileStorage.setItem(STICKY_VIEW_STORAGE_KEY, JSON.stringify({ pan, zoom }));
    } catch {
      /* quota / disabled — silent */
    }
  }, [pan, zoom]);

  /** La minimap est masquable, et son choix survit à la session. */
  const [minimapOn, setMinimapOn] = useState<boolean>(() => {
    try {
      return profileStorage.getItemWithLegacyFallback(MINIMAP_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggleMinimap = useCallback(() => {
    setMinimapOn((on) => {
      try {
        profileStorage.setItem(MINIMAP_STORAGE_KEY, on ? '0' : '1');
      } catch {
        /* quota / disabled — silent */
      }
      return !on;
    });
  }, []);

  /**
   * Miroirs du POINT DE VUE, pour la molette ET pour le panoramique.
   *
   * L'écouteur `wheel` est natif et posé une seule fois (il lui faut
   * `{ passive: false }` pour pouvoir annuler le défilement de la page) : il ne
   * peut donc pas lire `pan`/`zoom` par fermeture sans se réabonner à chaque
   * image. Et il ne peut pas non plus les lire par la forme fonctionnelle de
   * `setState` : le zoom ancré a besoin des DEUX à la fois, et enchaîner un
   * `setPan` dans le calcul d'un `setZoom` ferait appliquer le panoramique deux
   * fois en mode strict. D'où le même motif que le moteur de gestes : l'écouteur
   * écrit la ref SUR-LE-CHAMP, avant l'état, et un effet la resynchronise quand
   * le point de vue change par une autre voie (recadrage, hydratation).
   *
   * Depuis « l'échelle », `panRef` est en plus la SEULE vérité pendant un
   * panoramique à la souris : l'état ne la rattrape qu'au relâchement.
   */
  const panRef = useRef(pan);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /**
   * TAILLE DE LA FENÊTRE, observée.
   *
   * Nécessaire au culling et à la minimap : `clientWidth` n'est pas réactif, et
   * une fenêtre agrandie sans re-mesure laisserait une bande de cartes non
   * montées le long du nouveau bord.
   */
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  const viewportSizeRef = useRef(viewportSize);
  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setViewportSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // `cur*` is the live geometry of the gesture in progress: the note follows
  // the cursor from local state and Redux gets a single write on mouse up.
  // Dispatching per mousemove bumped `updatedAt` dozens of times a second,
  // which re-sorted the list under the cursor and flooded persistence + sync.
  // `armed` : le geste n'a pas encore franchi `GESTURE_ARM_PX`, donc rien ne
  // sera écrit — c'est un clic, pas un déplacement.
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [resizing, setResizing] = useState<{
    noteId: string;
    armed: boolean;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    curW: number;
    curH: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  /** Coin haut-gauche de la fenêtre au moment de la prise du cadre. */
  const marqueeOrigin = useRef({ left: 0, top: 0 });

  /** La sélection courante. Un `Set`, donc `has` en temps constant au rendu. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectedIdsRef = useRef(selectedIds);
  const applySelection = useCallback((next: Set<string>) => {
    // Ref d'abord : les gestionnaires de geste la lisent, et rien ne garantit
    // qu'un rendu se soit intercalé avant le mousedown suivant.
    selectedIdsRef.current = next;
    setSelectedIds(next);
  }, []);

  /** Confirmations destructives / irréversibles à l'œil nu. */
  const [pendingAction, setPendingAction] = useState<'delete' | 'tidy' | null>(null);
  const pendingActionRef = useRef(pendingAction);
  useEffect(() => {
    pendingActionRef.current = pendingAction;
  }, [pendingAction]);

  // Miroirs du geste en cours, synchronisés par un effet dédié.
  //
  // Le commit lit ICI et non dans sa fermeture : `handleMouseUp` reste alors
  // stable d'un rendu à l'autre, donc les écouteurs `window` posés au mousedown
  // ne sont pas réabonnés à chaque pixel parcouru. Le suivi du mouvement écrit
  // AUSSI ces refs directement, avant l'état : un relâchement arrivé dans la
  // même image que le dernier mousemove commiterait sinon la case précédente.
  const draggingRef = useRef(dragging);
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);
  const resizingRef = useRef(resizing);
  useEffect(() => {
    resizingRef.current = resizing;
  }, [resizing]);
  const marqueeRef = useRef(marquee);
  useEffect(() => {
    marqueeRef.current = marquee;
  }, [marquee]);
  /**
   * Les membres du glissement, en `Set`. Figé au mousedown comme `group`, mais
   * gardé à part : l'aimantation doit écarter le groupe de ses candidats à
   * chaque `mousemove`, et un `Array.some` imbriqué serait quadratique.
   */
  const dragGroupSet = useRef<Set<string>>(new Set());
  const panningRef = useRef(false);
  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  /**
   * Écrit le point de vue DIRECTEMENT dans le DOM.
   *
   * Le panoramique passe par ici et non par `setPan` : à soixante images par
   * seconde sur cinq cents notes, chaque `setPan` re-rend la vue, refait le
   * culling et re-compare les props des N cartes montées. Ici on touche trois
   * nœuds — la transformée du plan, le décor, la minimap — et l'état ne
   * rattrape qu'au relâchement (ou quand le culling l'exige, voir plus bas).
   */
  const syncViewportDom = useCallback(() => {
    const p = panRef.current;
    const z = zoomRef.current;
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${p.x}px, ${p.y}px) scale(${z})`;
    }
    backdropRef.current?.setViewport(p.x, p.y, z);
    minimapRef.current?.setViewport(p.x, p.y, z);
  }, []);

  /**
   * MOLETTE — conventions Figma/FigJam, et zoom ANCRÉ AU CURSEUR.
   *
   *   molette seule  → panoramique vertical
   *   Shift+molette  → panoramique horizontal
   *   Ctrl+molette   → zoom (c'est aussi ce qu'un pincement de pavé tactile
   *                    envoie : le navigateur le traduit en wheel + ctrlKey)
   *
   * L'ancrage est la moitié importante. La transformation du plan est
   * `translate(pan) scale(zoom)`, donc le point écran `c` correspond au point
   * monde `(c - pan) / zoom`. Pour que CE point ne bouge pas quand le zoom passe
   * de `z` à `z'`, il faut :
   *
   *     pan' = c − (c − pan) × (z'/z)
   *
   * Sans ça — l'ancien code se contentait de changer `zoom` — l'ancre reste le
   * coin haut-gauche de la fenêtre : le contenu FUIT vers le coin dès qu'on
   * zoome, et il faut re-panoramiquer après chaque cran. C'est très exactement
   * la sensation « bricolage » qu'on vient corriger.
   *
   * `deltaMode` : Firefox et certaines souris comptent en LIGNES (1) ou en PAGES
   * (2), pas en pixels (0). Sans conversion, un cran ferait trois pixels.
   */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;

      if (e.ctrlKey || e.metaKey) {
        const z = zoomRef.current;
        const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * Math.exp(-dy * ZOOM_SENSITIVITY)));
        if (nz === z) return;
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const p = panRef.current;
        const k = nz / z;
        const np = { x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k };
        zoomRef.current = nz;
        panRef.current = np;
        setZoom(nz);
        setPan(np);
        return;
      }

      // Une molette verticale ordinaire n'envoie que `deltaY` : avec Shift, c'est
      // ce delta-là qu'il faut porter sur X. Un pavé tactile, lui, envoie déjà un
      // vrai `deltaX` — on ne le détourne pas.
      const p = panRef.current;
      const np = e.shiftKey && dx === 0 ? { x: p.x - dy, y: p.y } : { x: p.x - dx, y: p.y - dy };
      panRef.current = np;
      setPan(np);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ==================== Culling ====================

  /**
   * Le rectangle du monde que les cartes montées couvrent, marge comprise.
   * `null` = pas de culling (peu de notes, ou fenêtre pas encore mesurée), et
   * c'est aussi le drapeau que lit la boucle de panoramique pour savoir si elle
   * doit surveiller une sortie de marge.
   */
  const cullRect = useMemo<Rect | null>(() => {
    if (notes.length <= CULL_THRESHOLD) return null;
    if (viewportSize.w === 0 || viewportSize.h === 0) return null;
    const v = visibleWorldRect(pan, zoom, viewportSize);
    return {
      x: v.x - CULL_MARGIN,
      y: v.y - CULL_MARGIN,
      w: v.w + CULL_MARGIN * 2,
      h: v.h + CULL_MARGIN * 2,
    };
  }, [notes.length, pan, zoom, viewportSize]);
  const cullRectRef = useRef(cullRect);
  useEffect(() => {
    cullRectRef.current = cullRect;
  }, [cullRect]);

  /** Membres du glissement en cours — toujours montés, même sortis du cadre. */
  const draggedIds = useMemo(
    () => (dragging ? new Set(dragging.group.map((g) => g.id)) : null),
    [dragging]
  );

  const visibleNotes = useMemo(() => {
    if (!cullRect) return notes;
    return notes.filter((n) => {
      // Une carte tenue qui sortirait du cadre en plein geste se démonterait
      // sous le curseur : le commit lirait toujours la bonne position, mais
      // l'utilisateur verrait sa note s'évaporer pendant qu'il la déplace.
      if (draggedIds?.has(n.id)) return true;
      const p = getStickyPos(n);
      const s = getStickySize(n);
      return rectsIntersect({ x: p.x, y: p.y, w: s.w, h: s.h }, cullRect);
    });
  }, [notes, cullRect, draggedIds]);

  /**
   * Les rectangles des cartes MONTÉES, pour l'aimantation.
   *
   * Une ref et non un état : le suivi du mouvement les lit soixante fois par
   * seconde et ne doit pas provoquer de rendu. « Montées » et non « toutes » est
   * volontaire — s'aimanter sur une carte hors champ produirait un trait qui
   * pointe vers rien.
   */
  const visibleRectsRef = useRef<Array<Rect & { id: string }>>([]);
  useEffect(() => {
    visibleRectsRef.current = visibleNotes.map((n) => {
      const p = getStickyPos(n);
      const s = getStickySize(n);
      return { id: n.id, x: p.x, y: p.y, w: s.w, h: s.h };
    });
  }, [visibleNotes]);

  // ==================== Gestes ====================

  /**
   * Prise sur le FOND. Trois issues selon les modificateurs :
   *   Maj+clic ou clic-milieu → panoramique (inchangé)
   *   clic gauche             → CADRE DE SÉLECTION
   *   clic gauche sans course → la sélection est vidée au relâchement
   *
   * Le test sur la cible est le même que pour le double-clic de création : seuls
   * la fenêtre et le plan sont « le fond ». Sans lui, un cadre démarrerait aussi
   * depuis la barre de contrôles flottante, qui est leur enfant.
   */
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      panningRef.current = true;
      setPanning(true);
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      return;
    }
    if (e.button !== 0) return;
    if (e.target !== canvasRef.current && e.target !== contentRef.current) return;
    // Sans ça, le glissement sur le fond déclenche la sélection de texte native
    // du navigateur et la fenêtre se met à « surligner » les cartes traversées.
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    marqueeOrigin.current = { left: rect?.left ?? 0, top: rect?.top ?? 0 };
    const sx = e.clientX - marqueeOrigin.current.left;
    const sy = e.clientY - marqueeOrigin.current.top;
    const next: MarqueeState = {
      armed: false,
      startX: sx,
      startY: sy,
      curX: sx,
      curY: sy,
      additive: e.ctrlKey || e.metaKey,
    };
    marqueeRef.current = next;
    setMarquee(next);
  }, []);

  /**
   * Fin de geste : la seule écriture de tout le déplacement.
   *
   * N'écrit que si le geste a été ARMÉ (course franchie) ET que la géométrie a
   * réellement changé. Passe par `setManyNoteViewGeometry`, qui ne touche PAS à
   * `updatedAt` : déplacer une note n'est pas l'éditer — sinon le tri par
   * défaut la remonte en tête, la pile z se refait sous le curseur, une version
   * est archivée et le nuage arbitre en faveur du glissement contre une vraie
   * édition d'ailleurs. UNE action pour tout le groupe, pas une par carte.
   *
   * Lit le geste dans des refs (voir plus haut) pour rester stable : les
   * écouteurs `window` en dépendent. Vide ces refs SUR-LE-CHAMP, donc un second
   * appel pour le même relâchement (l'écouteur `window` et le filet du
   * conteneur peuvent tous deux passer) ne réécrit rien.
   */
  const handleMouseUp = useCallback(() => {
    if (panningRef.current) {
      panningRef.current = false;
      setPanning(false);
      // Le panoramique vivait dans le DOM : c'est ici, et ici seulement, que
      // l'état le rattrape.
      setPan(panRef.current);
    }

    const drag = draggingRef.current;
    draggingRef.current = null;
    if (drag) {
      if (drag.armed && (drag.curX !== drag.origX || drag.curY !== drag.origY)) {
        const dx = drag.curX - drag.origX;
        const dy = drag.curY - drag.origY;
        // Index par identifiant : un `find` par membre coûterait N×M sur un
        // groupe de cinquante cartes dans un coffre de cinq cents.
        const byId = new Map(notesRef.current.map((n) => [n.id, n]));
        const entries = drag.group.map((g) => ({
          id: g.id,
          // Fusionne avec la carte courante pour ne pas effacer les entrées
          // sœurs (une future position `canvas`, par exemple).
          viewPositions: {
            ...(byId.get(g.id)?.viewPositions ?? {}),
            sticky: { x: g.x + dx, y: g.y + dy },
          },
        }));
        dispatch(setManyNoteViewGeometry(entries));
      }
      setDragging(null);
    }

    const resize = resizingRef.current;
    resizingRef.current = null;
    if (resize) {
      if (resize.armed && (resize.curW !== resize.origW || resize.curH !== resize.origH)) {
        const note = notesRef.current.find((n) => n.id === resize.noteId);
        dispatch(
          setNoteViewGeometry({
            id: resize.noteId,
            viewSizes: {
              ...(note?.viewSizes ?? {}),
              sticky: { w: resize.curW, h: resize.curH },
            },
          })
        );
      }
      setResizing(null);
    }

    const mq = marqueeRef.current;
    marqueeRef.current = null;
    if (mq) {
      if (mq.armed) {
        // Le cadre est en pixels écran ; les notes vivent dans le monde.
        // `screen = pan + world × zoom`, donc l'inverse ci-dessous.
        const p = panRef.current;
        const z = zoomRef.current;
        const left = Math.min(mq.startX, mq.curX);
        const top = Math.min(mq.startY, mq.curY);
        const world: Rect = {
          x: (left - p.x) / z,
          y: (top - p.y) / z,
          w: Math.abs(mq.curX - mq.startX) / z,
          h: Math.abs(mq.curY - mq.startY) / z,
        };
        const next = mq.additive ? new Set(selectedIdsRef.current) : new Set<string>();
        for (const n of notesRef.current) {
          const pos = getStickyPos(n);
          const size = getStickySize(n);
          if (rectsIntersect({ x: pos.x, y: pos.y, w: size.w, h: size.h }, world)) next.add(n.id);
        }
        applySelection(next);
      } else if (!mq.additive && selectedIdsRef.current.size > 0) {
        // Clic sec sur le vide = « je ne parlais de rien ».
        applySelection(new Set());
      }
      setMarquee(null);
    }
  }, [dispatch, applySelection]);

  /**
   * SUIVI DU GESTE SUR `window`, PAS SUR LE CANEVAS.
   *
   * Le canevas portait `onMouseMove` + `onMouseUp` + `onMouseLeave={handleMouseUp}`.
   * Or la barre d'outils flottante est un enfant du canevas : la survoler
   * pendant un glissement déclenchait `mouseleave` sur le conteneur, donc un
   * COMMIT — la note se posait toute seule, au milieu du mouvement. Même chose
   * en sortant par un bord. Ici, le geste vit sur `window` du mousedown au
   * mouseup : rien de ce que le curseur traverse ne peut plus le trancher.
   *
   * Tout se lit dans des refs (point de vue, geste, rectangles) : l'effet ne se
   * réabonne donc qu'au début et à la fin du geste, jamais entre deux pixels.
   */
  const gestureActive = dragging !== null || resizing !== null || panning || marquee !== null;
  const panFrame = useRef<number | null>(null);
  useEffect(() => {
    if (!gestureActive) return;

    const onMove = (e: MouseEvent) => {
      const zoomNow = zoomRef.current;

      if (panningRef.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        panRef.current = { x: panStart.current.panX + dx, y: panStart.current.panY + dy };
        if (panFrame.current === null) {
          panFrame.current = requestAnimationFrame(() => {
            panFrame.current = null;
            syncViewportDom();
            // HYSTÉRÉSIS : tant que le regard reste dans la marge des cartes
            // déjà montées, aucun rendu. Dès qu'il en sort, on commite le
            // panoramique pour que le culling reprenne la main — sinon on
            // panoramiquerait dans le vide, cartes non montées.
            const cr = cullRectRef.current;
            if (cr) {
              const v = visibleWorldRect(panRef.current, zoomRef.current, viewportSizeRef.current);
              const inside =
                v.x >= cr.x && v.y >= cr.y && v.x + v.w <= cr.x + cr.w && v.y + v.h <= cr.y + cr.h;
              if (!inside) setPan(panRef.current);
            }
          });
        }
      }

      const d = draggingRef.current;
      if (d) {
        const sdx = e.clientX - d.startX;
        const sdy = e.clientY - d.startY;
        // Course mesurée à l'ÉCRAN : au zoom 0,3 un pas de grille ne couvre que
        // 6 px, un tremblement de main suffisait à déplacer la note.
        const armed = d.armed || Math.abs(sdx) >= GESTURE_ARM_PX || Math.abs(sdy) >= GESTURE_ARM_PX;
        if (armed) {
          // On aimante la BOÎTE du groupe, puis on reporte le même écart sur la
          // carte saisie. Aimanter la carte saisie et « traîner » les autres
          // alignerait un membre arbitraire et laisserait le bloc de travers.
          const rawBox = { x: d.box.x + sdx / zoomNow, y: d.box.y + sdy / zoomNow };
          const snapped = alignmentSnap(
            rawBox,
            d.box.w,
            d.box.h,
            visibleRectsRef.current,
            dragGroupSet.current
          );
          const newX = d.origX + (snapped.x - d.box.x);
          const newY = d.origY + (snapped.y - d.box.y);
          // Rien à faire quand la case n'a pas changé — le curseur peut parcourir
          // tout un pas de grille sans provoquer un seul rendu. On compare aussi
          // les guides, qui apparaissent et disparaissent sans que la position
          // bouge d'un pixel.
          const sameGuides =
            d.guides.length === snapped.guides.length &&
            d.guides.every(
              (g, i) => g.axis === snapped.guides[i].axis && g.pos === snapped.guides[i].pos
            );
          if (d.armed !== armed || d.curX !== newX || d.curY !== newY || !sameGuides) {
            const next: DragState = {
              ...d,
              armed,
              curX: newX,
              curY: newY,
              guides: snapped.guides,
            };
            draggingRef.current = next;
            setDragging(next);
          }
        }
      }

      const r = resizingRef.current;
      if (r) {
        const sdx = e.clientX - r.startX;
        const sdy = e.clientY - r.startY;
        const armed = r.armed || Math.abs(sdx) >= GESTURE_ARM_PX || Math.abs(sdy) >= GESTURE_ARM_PX;
        if (armed) {
          const rawW = r.origW + sdx / zoomNow;
          const rawH = r.origH + sdy / zoomNow;
          const newW =
            Math.round(Math.max(MIN_STICKY_SIZE.w, Math.min(MAX_STICKY_SIZE.w, rawW)) / GRID_SNAP) *
            GRID_SNAP;
          const newH =
            Math.round(Math.max(MIN_STICKY_SIZE.h, Math.min(MAX_STICKY_SIZE.h, rawH)) / GRID_SNAP) *
            GRID_SNAP;
          if (r.armed !== armed || r.curW !== newW || r.curH !== newH) {
            const next = { ...r, armed, curW: newW, curH: newH };
            resizingRef.current = next;
            setResizing(next);
          }
        }
      }

      const mq = marqueeRef.current;
      if (mq) {
        const cx = e.clientX - marqueeOrigin.current.left;
        const cy = e.clientY - marqueeOrigin.current.top;
        const armed =
          mq.armed ||
          Math.abs(cx - mq.startX) >= GESTURE_ARM_PX ||
          Math.abs(cy - mq.startY) >= GESTURE_ARM_PX;
        if (mq.armed !== armed || mq.curX !== cx || mq.curY !== cy) {
          const next = { ...mq, armed, curX: cx, curY: cy };
          marqueeRef.current = next;
          setMarquee(next);
        }
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (panFrame.current !== null) {
        cancelAnimationFrame(panFrame.current);
        panFrame.current = null;
      }
    };
  }, [gestureActive, handleMouseUp, syncViewportDom]);

  /**
   * Le point de vue vit dans le DOM pendant un panoramique — donc TOUT rendu
   * survenu entre-temps (une note arrivée du nuage, un survol) le remettrait à
   * la valeur périmée de l'état. On le réécrit après chaque rendu, tant que le
   * geste dure. Sans tableau de dépendances : c'est exactement « après chaque
   * rendu » qu'il faut, et le corps ne fait rien hors panoramique.
   */
  useLayoutEffect(() => {
    if (panningRef.current) syncViewportDom();
  });

  // Auto-fit: compute the bounding box of all sticky positions and
  // re-center the canvas so every sticky is visible. Caps zoom at 1
  // to avoid hyper-zooming on a single sticky; uses a small margin so
  // notes don't sit flush against the viewport edges.
  const handleFitAll = useCallback(() => {
    if (!canvasRef.current || notes.length === 0) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    notes.forEach((n) => {
      const p = getStickyPos(n);
      const s = getStickySize(n);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + s.w > maxX) maxX = p.x + s.w;
      if (p.y + s.h > maxY) maxY = p.y + s.h;
    });
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    const margin = 60;
    const vw = canvasRef.current.clientWidth;
    const vh = canvasRef.current.clientHeight;
    const scaleX = (vw - margin * 2) / bboxW;
    const scaleY = (vh - margin * 2) / bboxH;
    const nextZoom = Math.max(0.3, Math.min(1, scaleX, scaleY));
    // Center bbox center on viewport center.
    const bcx = (minX + maxX) / 2;
    const bcy = (minY + maxY) / 2;
    setZoom(nextZoom);
    setPan({ x: vw / 2 - bcx * nextZoom, y: vh / 2 - bcy * nextZoom });
  }, [notes]);

  /**
   * Le recadrage d'ouverture (voir `autoFit` plus haut). Ne se déclenche
   * qu'UNE fois par montage, et seulement quand plus aucune note n'attend sa
   * case : cadrer pendant la matérialisation reviendrait à cadrer la boîte
   * englobante du repli (40, 40), c'est-à-dire un point.
   */
  useEffect(() => {
    if (!isBoard || autoFit.current.done) return;
    // Le coffre n'est peut-être pas encore chargé — rien à cadrer, on attend.
    if (notes.length === 0) return;
    if (unplacedIds.length > 0) return;
    autoFit.current.done = true;
    if (autoFit.current.needed) handleFitAll();
  }, [isBoard, notes.length, unplacedIds.length, handleFitAll]);

  /** Point de l'écran → point du plan (l'inverse exact de la transformation CSS). */
  const clientToWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = canvasRef.current?.getBoundingClientRect();
      return {
        x: (clientX - (rect?.left ?? 0) - pan.x) / zoom,
        y: (clientY - (rect?.top ?? 0) - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  /** Recentrer la fenêtre sur un point du monde — la minimap ne fait que ça. */
  const handlePanTo = useCallback((worldX: number, worldY: number) => {
    const size = viewportSizeRef.current;
    const z = zoomRef.current;
    const np = { x: size.w / 2 - worldX * z, y: size.h / 2 - worldY * z };
    panRef.current = np;
    setPan(np);
  }, []);

  /**
   * Créer une note DÉJÀ POSÉE.
   *
   * La position part avec l'objet créé, elle ne fait pas l'objet d'une seconde
   * écriture : passer par `updateNote` bousculerait `updatedAt` (voir
   * `setNoteViewGeometry`), et passer par `setNoteViewGeometry` juste après
   * l'ajout laisserait la note exister un instant SANS coordonnées — le temps
   * qu'il faut à `materializeStickyPositions` pour lui attribuer une case de
   * grille, que l'on écraserait aussitôt : la note sauterait sous les yeux de
   * l'utilisateur. `updatedAt` posé à la création, lui, est légitime.
   */
  const createNoteAt = useCallback(
    (world: { x: number; y: number }, avoidCollisions: boolean) => {
      const wanted = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
      const pos = avoidCollisions ? findFreeSpot(wanted.x, wanted.y, notesRef.current) : wanted;
      const note = createNoteService({ title: '', viewPositions: { sticky: pos } });
      dispatch(addNote(note));
    },
    [dispatch]
  );

  /**
   * Double-clic sur le FOND = nouvelle note à cet endroit précis.
   *
   * Le filtre sur la cible est tout le sujet : les pastilles ne stoppent pas la
   * propagation de leur propre double-clic (qui, lui, ouvre la note), donc sans
   * ce test chaque ouverture créerait aussi une note fantôme derrière elle.
   * Seuls la fenêtre et le plan comptent comme « le fond ».
   */
  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isBoard) return;
      if (e.target !== canvasRef.current && e.target !== contentRef.current) return;
      createNoteAt(clientToWorld(e.clientX, e.clientY), false);
    },
    [isBoard, clientToWorld, createNoteAt]
  );

  /** Bouton « + Note » : au centre de ce que l'utilisateur regarde. */
  const handleAddNote = useCallback(() => {
    const el = canvasRef.current;
    const vw = el?.clientWidth ?? 0;
    const vh = el?.clientHeight ?? 0;
    const center = { x: (vw / 2 - pan.x) / zoom, y: (vh / 2 - pan.y) / zoom };
    createNoteAt({ x: center.x - DEFAULT_SIZE.w / 2, y: center.y - DEFAULT_SIZE.h / 2 }, true);
  }, [pan, zoom, createNoteAt]);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, noteId: string, curW: number, curH: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const next = {
        noteId,
        armed: false,
        startX: e.clientX,
        startY: e.clientY,
        origW: curW,
        origH: curH,
        curW,
        curH,
      };
      // Ref d'abord : le suivi du mouvement la lit, et rien ne garantit qu'un
      // rendu se soit intercalé entre le mousedown et le premier mousemove.
      resizingRef.current = next;
      setResizing(next);
    },
    []
  );

  /**
   * Prise sur une CARTE.
   *
   *   Ctrl/Cmd+clic → bascule l'appartenance à la sélection, sans prise
   *   clic sur un membre de la sélection → prise de TOUT le groupe
   *   clic ailleurs → la sélection devient cette seule carte, puis prise
   *
   * Maj est laissé au panoramique (le `return` ci-dessous laisse l'événement
   * remonter au fond), comme avant.
   */
  const handleStickyMouseDown = useCallback(
    (e: React.MouseEvent, noteId: string, x: number, y: number) => {
      if (e.button !== 0 || e.shiftKey) return;
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {
        const toggled = new Set(selectedIdsRef.current);
        if (toggled.has(noteId)) toggled.delete(noteId);
        else toggled.add(noteId);
        applySelection(toggled);
        return;
      }

      let selection = selectedIdsRef.current;
      if (!selection.has(noteId)) {
        selection = new Set([noteId]);
        applySelection(selection);
      }

      // Positions et boîte englobante FIGÉES ici : tout le reste du geste n'est
      // qu'un écart appliqué à ces valeurs. Les relire à chaque mousemove
      // ferait dériver le groupe (on lirait des positions déjà décalées).
      const group: Array<{ id: string; x: number; y: number }> = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of notesRef.current) {
        if (!selection.has(n.id)) continue;
        const p = getStickyPos(n);
        const s = getStickySize(n);
        group.push({ id: n.id, x: p.x, y: p.y });
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x + s.w > maxX) maxX = p.x + s.w;
        if (p.y + s.h > maxY) maxY = p.y + s.h;
      }
      // Repli : la note n'est pas (encore) dans la liste montée — on tient au
      // moins ce que l'appelant nous a donné.
      if (group.length === 0) {
        group.push({ id: noteId, x, y });
        minX = x;
        minY = y;
        maxX = x + DEFAULT_SIZE.w;
        maxY = y + DEFAULT_SIZE.h;
      }

      const next: DragState = {
        noteId,
        armed: false,
        startX: e.clientX,
        startY: e.clientY,
        origX: x,
        origY: y,
        curX: x,
        curY: y,
        box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        group,
        guides: EMPTY_GUIDES,
      };
      // Ref d'abord — même raison que pour le redimensionnement ci-dessus.
      dragGroupSet.current = new Set(group.map((g) => g.id));
      draggingRef.current = next;
      setDragging(next);
    },
    [applySelection]
  );

  /**
   * Ouverture d'une note — UN seul gestionnaire stable pour toutes les cartes.
   * Une fermeture par carte (`() => onOpenNote(note.id)`) est reconstruite à
   * chaque rendu et ferait échouer la comparaison de `React.memo` : les N cartes
   * se re-rendraient à chaque mousedown, ce que toute cette mémoïsation existe
   * précisément pour éviter.
   */
  const handleOpenNote = useCallback(
    (noteId: string) => {
      if (onOpenNote) onOpenNote(noteId);
      else dispatch(setEditingNote(noteId));
    },
    [onOpenNote, dispatch]
  );

  // ==================== Sélection : clavier et actions ====================

  /**
   * Suppr et Échap. L'écouteur n'existe QUE quand il y a une sélection : hors
   * de là, cette vue n'a rien à dire du clavier de l'application.
   *
   * Deux garde-fous. Un champ de saisie ou un bloc éditable a toujours la
   * priorité — « Suppr » y veut dire « efface un caractère », pas « jette dix
   * notes ». Et une confirmation ouverte prend Échap pour elle : sinon la même
   * touche fermerait la boîte ET viderait la sélection qu'elle décrit.
   */
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true)
      ) {
        return;
      }
      if (pendingActionRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        applySelection(new Set());
        return;
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        setPendingAction('delete');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, applySelection]);

  /**
   * Suppression DOUCE (`deleteNotesBatch`) : les notes partent à la corbeille et
   * restent restaurables. Une sélection au cadre peut ramasser des voisines que
   * l'utilisateur n'avait pas vues — une destruction définitive serait ici la
   * pire des issues, et c'est pourquoi le libellé de confirmation dit « à la
   * corbeille » et non « supprimer ».
   */
  const confirmDelete = useCallback(() => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    dispatch(deleteNotesBatch(ids));
    applySelection(new Set());
  }, [dispatch, applySelection]);

  const confirmTidy = useCallback(() => {
    const sel = selectedIdsRef.current;
    const targets = sel.size > 0 ? notesRef.current.filter((n) => sel.has(n.id)) : notesRef.current;
    const laid = tidyPositions(targets);
    if (laid.length === 0) return;
    const byId = new Map(notesRef.current.map((n) => [n.id, n]));
    dispatch(
      setManyNoteViewGeometry(
        laid.map((p) => ({
          id: p.id,
          viewPositions: {
            ...(byId.get(p.id)?.viewPositions ?? {}),
            sticky: { x: p.x, y: p.y },
          },
        }))
      )
    );
  }, [dispatch]);

  // ==================== Rendu ====================

  /**
   * Positions vivantes du groupe pendant un glissement. Un `Map` construit une
   * fois par pas de grille, pas une recherche par carte : le rendu de N cartes
   * ne doit pas être quadratique en la taille du groupe.
   */
  const dragPositions = useMemo(() => {
    if (!dragging || !dragging.armed) return null;
    const dx = dragging.curX - dragging.origX;
    const dy = dragging.curY - dragging.origY;
    const map = new Map<string, { x: number; y: number }>();
    for (const g of dragging.group) map.set(g.id, { x: g.x + dx, y: g.y + dy });
    return map;
  }, [dragging]);

  /** Ce que la minimap a besoin de savoir. Recalculé quand le plan change. */
  const minimapNotes = useMemo<MinimapNote[]>(
    () =>
      notes.map((n) => {
        const p = getStickyPos(n);
        const s = getStickySize(n);
        return {
          id: n.id,
          x: p.x,
          y: p.y,
          w: s.w,
          h: s.h,
          hue: noteTintHue(n.id, n.icon),
          selected: selectedIds.has(n.id),
        };
      }),
    [notes, selectedIds]
  );

  // Libellés constants, résolus UNE fois pour toutes les cartes.
  const untitledLabel = t('notes.untitled', 'Untitled');
  const wordsLabel = t('notes.words', 'words');
  const resizeLabel = t('notes.stickyResize', 'Resize');
  const moreTagsLabel = t('notes.boardMoreTags', 'Autres étiquettes');

  // Niveau de détail : UN attribut sur la fenêtre, le reste est du CSS. Aucune
  // carte n'est re-rendue quand on dézoome — le navigateur recompose, c'est tout.
  const lod = lodFor(zoom);
  const selectionCount = selectedIds.size;

  return (
    // Ni `onMouseMove`, ni surtout `onMouseLeave` : le geste est suivi sur
    // `window` (voir l'effet plus haut). Reste `onMouseUp`, en filet : un clic
    // assez bref pour que le relâchement précède la pose des écouteurs
    // laisserait sinon le panoramique collé au curseur. `handleMouseUp` vide
    // ses refs d'entrée, donc le doublon n'écrit rien deux fois.
    <div
      className={`sticky-notes-view ${isBoard ? 'sticky-notes-view--board' : ''}`}
      data-lod={lod}
      ref={canvasRef}
      onMouseDown={handleCanvasMouseDown}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleCanvasDoubleClick}
    >
      {/* Décor verrouillé au monde. Entièrement `pointer-events: none` — il est
          posé PAR-DESSUS le fond de la fenêtre, donc s'il prenait le clic, le
          double-clic « créer une note ici » ne trouverait plus jamais le fond. */}
      <ParallaxBackdrop ref={backdropRef} panX={pan.x} panY={pan.y} zoom={zoom} grid={GRID_SNAP} />

      <div
        className="sticky-notes-view__canvas"
        ref={contentRef}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Les traits d'aimantation vivent DANS le plan : ils doivent rester
            collés aux cartes si un zoom survient au milieu du geste. */}
        <AlignmentGuides guides={dragging?.guides ?? EMPTY_GUIDES} zoom={zoom} />

        {visibleNotes.map((note) => {
          // While a gesture is running the geometry comes from local state:
          // Redux only learns about it on mouse up.
          const dragged = dragPositions?.get(note.id);
          const resize = resizing?.noteId === note.id ? resizing : null;
          const pos = dragged ?? getStickyPos(note);
          const size =
            resize && resize.armed ? { w: resize.curW, h: resize.curH } : getStickySize(note);
          // Les variantes de carte sont DÉRIVÉES de ce que la note porte déjà :
          // même résolution de couverture que la page de note (`PageCover`),
          // donc un aperçu fidèle et zéro champ de plus à synchroniser.
          //
          // `coverColor` est volontairement écarté ICI : dans cette vue, ce champ
          // a longtemps servi de rangement à la position « x,y » (voir
          // `getStoredStickyPos` et la migration). Le passer en dernier recours
          // peindrait « 340,120 » comme fond de bandeau sur les notes pas encore
          // migrées.
          const cover = resolveCoverBackground(note.coverPresetId, note.coverImage, undefined);
          const full = note.plainText || '';
          return (
            <BoardCard
              key={note.id}
              noteId={note.id}
              title={note.title}
              text={full.length > CARD_TEXT_CHARS ? full.slice(0, CARD_TEXT_CHARS) : full}
              wordCount={note.wordCount}
              icon={note.icon}
              coverCss={cover?.css}
              coverIsImage={!!cover?.isImage}
              coverPosition={note.coverPosition}
              coverPositionX={note.coverPositionX}
              tags={tagsByNote.get(note.id) ?? EMPTY_TAGS}
              tintHue={noteTintHue(note.id, note.icon)}
              x={pos.x}
              y={pos.y}
              w={size.w}
              h={size.h}
              isDragging={!!dragged}
              isResizing={!!resize?.armed}
              isSelected={selectedIds.has(note.id)}
              untitledLabel={untitledLabel}
              wordsLabel={wordsLabel}
              resizeLabel={resizeLabel}
              moreTagsLabel={moreTagsLabel}
              onCardMouseDown={handleStickyMouseDown}
              onResizeMouseDown={handleResizeMouseDown}
              onOpen={handleOpenNote}
            />
          );
        })}
      </div>

      {/* Le cadre de sélection est en pixels ÉCRAN : il ne doit ni zoomer ni se
          déformer, c'est un geste de l'utilisateur, pas un objet du plan. */}
      {marquee?.armed && (
        <div
          className="sticky-notes-view__marquee"
          aria-hidden="true"
          style={{
            left: Math.min(marquee.startX, marquee.curX),
            top: Math.min(marquee.startY, marquee.curY),
            width: Math.abs(marquee.curX - marquee.startX),
            height: Math.abs(marquee.curY - marquee.startY),
          }}
        />
      )}

      {/* Le tableau vide ne dit pas « rien ici » : il dit COMMENT le remplir.
          Réservé au tableau — dans la section Notes, une liste vide est
          presque toujours un filtre trop serré, pas un coffre vide. */}
      {isBoard && notes.length === 0 && (
        <div className="sticky-notes-view__empty">
          <p className="sticky-notes-view__empty-title">
            {t('notes.boardEmptyTitle', 'Aucune note pour le moment')}
          </p>
          <p className="sticky-notes-view__empty-hint">
            {t(
              'notes.boardEmptyHint',
              'Double-cliquez n’importe où sur le fond pour en créer une.'
            )}
          </p>
        </div>
      )}

      {/* Viewport controls */}
      <div className="sticky-notes-view__controls">
        {minimapOn && (
          <Minimap
            ref={minimapRef}
            notes={minimapNotes}
            viewportW={viewportSize.w}
            viewportH={viewportSize.h}
            panX={pan.x}
            panY={pan.y}
            zoom={zoom}
            label={t('notes.boardMinimapLabel', 'Plan du tableau')}
            onPanTo={handlePanTo}
          />
        )}

        <div className="sticky-notes-view__controls-row">
          {/* Ce que la sélection contient, en clair : un cadre peut ramasser des
              cartes hors champ, et le nombre est le seul moyen de le savoir
              AVANT d'appuyer sur Suppr. */}
          {selectionCount > 0 && (
            <div className="sticky-notes-view__selection-count">
              {t('notes.boardSelectionCount', '{{n}} sélectionnées', { n: selectionCount })}
            </div>
          )}
          {isBoard && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleAddNote}
              title={t('notes.boardAddNoteHint', 'Ajouter une note au centre de la vue')}
            >
              {t('notes.boardAddNote', 'Nouvelle note')}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setPendingAction('tidy')}
            title={t(
              'notes.boardTidyHint',
              'Réaligner la sélection sur une grille (ou tout le tableau si rien n’est sélectionné)'
            )}
          >
            {t('notes.boardTidy', 'Ranger')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleFitAll}
            title={t('notes.stickyFitAll', 'Recentrer sur tous les stickies')}
          >
            {t('notes.stickyFitAllShort', 'Tout afficher')}
          </Button>
          {/* Une bascule, pas deux boutons : le libellé ne change pas (« Plan »
              reste ce que le bouton concerne), c'est l'infobulle qui dit dans
              quel sens il agit et `data-on` qui montre l'état. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={toggleMinimap}
            title={
              minimapOn
                ? t('notes.boardMinimapHide', 'Masquer le plan du tableau')
                : t('notes.boardMinimapShow', 'Afficher le plan du tableau')
            }
          >
            <span className="sticky-notes-view__toggle" data-on={minimapOn ? 'true' : 'false'}>
              {t('notes.boardMinimap', 'Plan')}
            </span>
          </Button>
          {/* Les conventions de la molette ne s'apprennent nulle part ailleurs :
              l'infobulle du zoom est le seul endroit où l'utilisateur peut les lire. */}
          <div
            className="sticky-notes-view__zoom"
            title={t(
              'notes.boardWheelHint',
              'Molette : défiler · Maj+molette : horizontal · Ctrl+molette : zoom'
            )}
          >
            {Math.round(zoom * 100)}%
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={pendingAction === 'delete'}
        onClose={() => setPendingAction(null)}
        onConfirm={confirmDelete}
        variant="danger"
        title={t('notes.boardDeleteTitle', 'Mettre la sélection à la corbeille ?')}
        message={t(
          'notes.boardDeleteMessage',
          '{{n}} notes partiront à la corbeille. Vous pourrez les restaurer depuis la corbeille.',
          { n: selectionCount }
        )}
        confirmText={t('notes.boardDeleteConfirm', 'Mettre à la corbeille')}
        cancelText={t('common.cancel', 'Annuler')}
      />

      <ConfirmModal
        isOpen={pendingAction === 'tidy'}
        onClose={() => setPendingAction(null)}
        onConfirm={confirmTidy}
        variant="warning"
        title={t('notes.boardTidyTitle', 'Ranger le tableau ?')}
        message={
          selectionCount > 0
            ? t(
                'notes.boardTidyMessageSelection',
                '{{n}} notes sélectionnées seront réalignées sur une grille. Leur contenu n’est pas touché.',
                { n: selectionCount }
              )
            : t(
                'notes.boardTidyMessageAll',
                'Les {{n}} notes du tableau seront réalignées sur une grille. Leur contenu n’est pas touché.',
                { n: notes.length }
              )
        }
        confirmText={t('notes.boardTidyConfirm', 'Ranger')}
        cancelText={t('common.cancel', 'Annuler')}
      />
    </div>
  );
});

export default StickyNotesView;
