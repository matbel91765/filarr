/**
 * Moteur de grille — le VOCABULAIRE.
 *
 * Ce module ne contient aucun algorithme et aucun rendu : rien que les
 * constantes et les formes que le solveur, les gestes et les composants
 * partagent. Il est importable depuis n'importe où (y compris un test node pur)
 * sans traîner React derrière lui.
 *
 * ── LE MODÈLE EST LA GRILLE, PAS LE PIXEL ──────────────────────────────────
 *
 * Une position absolue en pixels n'a aucun sens sur un téléphone, et elle rend
 * un modèle INTRANSPORTABLE : ce qui est « à droite du bloc météo » sur un
 * 27 pouces devient « hors écran » sur un 13 pouces. Ce qui se synchronise et
 * s'exporte est donc une disposition en CASES : douze colonnes, des rangées de
 * hauteur fixe. Le pixel n'apparaît qu'au dernier moment, dans la feuille de
 * style.
 *
 * ── UNE SEULE DISPOSITION MAÎTRESSE ────────────────────────────────────────
 *
 * Il n'existe QU'UNE disposition stockée, celle en douze colonnes. Les largeurs
 * inférieures sont DÉRIVÉES (voir `projectLayout`), jamais enregistrées à côté.
 * Stocker trois dispositions reviendrait à demander à l'utilisateur d'entretenir
 * trois mises en page, et à un modèle partagé d'en transporter trois — dont deux
 * que son auteur n'a jamais regardées.
 */

import { breakpointForWidth } from '../../styles/breakpoints';

// ==================== Métrique ====================

/** Colonnes de la disposition maîtresse. Douze : divisible par 2, 3, 4 et 6. */
export const GRID_COLUMNS = 12;

/**
 * Hauteur d'une rangée, en pixels. 88 = 11 × 8 : la trame du produit est à 8 px
 * (`--spacing-unit` × 2), et une rangée qui n'est pas un multiple de la trame
 * désaligne tout ce qu'un widget pose à l'intérieur de lui-même.
 */
export const GRID_ROW_HEIGHT = 88;

/** Gouttière entre deux cases, en pixels (`--spacing-4`). */
export const GRID_GUTTER = 16;

/** Les seules largeurs de grille qui existent. */
export type GridColumnCount = 12 | 6 | 1;

/**
 * Colonnes pour une largeur de CONTENEUR donnée (pas de fenêtre : voir
 * `breakpoints.ts`).
 */
export function columnsForWidth(width: number): GridColumnCount {
  switch (breakpointForWidth(width)) {
    case 'wide':
      return 12;
    case 'medium':
      return 6;
    default:
      return 1;
  }
}

// ==================== Catalogue de formats ====================

/**
 * Identifiants des huit formats NOMMÉS.
 *
 * ── LE CATALOGUE EST UN RACCOURCI, PLUS UNE LOI ────────────────────────────
 *
 * Il a d'abord été fermé : la poignée s'aimantait dessus et rien d'autre
 * n'était fabricable. L'usage a tranché contre — un bloc dont les trois formats
 * autorisés faisaient tous douze de large ne se redimensionnait PLUS DU TOUT en
 * largeur, la hauteur butait sur le plus grand format nommé, et l'aimantation
 * au plus proche faisait sauter la largeur pendant qu'on tirait vers le bas. La
 * poignée pose désormais N'IMPORTE QUELLE géométrie entière, bornée par les
 * contraintes du widget (voir `GridSizeConstraints`).
 *
 * Ce que le catalogue garde : nommer les tailles courantes. On les propose en un
 * clic (prise de format, inspecteur, gabarits) et on les dit à voix haute
 * (« Bande », « Pleine page »). Une taille hors catalogue reste parfaitement
 * légale — elle s'affiche alors par ses dimensions.
 *
 * Trois formats occupent toute la largeur — « Pleine largeur » (12×2),
 * « Panneau » (12×4) et « Pleine page » (12×6) : les blocs qui portent une liste
 * écrivent vraiment ces hauteurs-là, et un raccourci qui ne sait pas nommer ce
 * que les dispositions contiennent ne sert à rien.
 */
export type GridSizeId = 'tile' | 'square' | 'band' | 'wide' | 'full' | 'panel' | 'page' | 'tall';

export interface GridSize {
  readonly id: GridSizeId;
  /** Largeur en colonnes. */
  readonly w: number;
  /** Hauteur en rangées. */
  readonly h: number;
}

/**
 * Les huit formats nommés, dans l'ORDRE DE CYCLE (c'est aussi l'ordre où on les
 * présente à l'utilisateur). Grossièrement croissant en surface, avec « Haute »
 * en fin parce qu'elle est la seule à changer d'orientation : la mettre au
 * milieu ferait osciller la carte entre portrait et paysage pendant le cycle.
 *
 * Les trois pleines largeurs se suivent (24, 48 puis 72 cases) : un bloc qui
 * n'en propose qu'elles voit donc un cycle qui GRANDIT à chaque clic puis revient
 * au plus petit, ce qui est la seule progression qu'on puisse prédire sans
 * regarder l'écran.
 */
export const GRID_SIZES: readonly GridSize[] = [
  { id: 'tile', w: 3, h: 1 },
  { id: 'square', w: 3, h: 2 },
  { id: 'band', w: 6, h: 2 },
  { id: 'wide', w: 6, h: 3 },
  { id: 'full', w: 12, h: 2 },
  { id: 'panel', w: 12, h: 4 },
  { id: 'page', w: 12, h: 6 },
  { id: 'tall', w: 4, h: 4 },
];

export const GRID_SIZE_IDS: readonly GridSizeId[] = GRID_SIZES.map((s) => s.id);

/** Format par identifiant. Lève si l'identifiant n'existe pas : c'est un bug. */
export function gridSize(id: GridSizeId): GridSize {
  const found = GRID_SIZES.find((s) => s.id === id);
  if (!found) throw new Error(`gridSize: format inconnu « ${id} »`);
  return found;
}

/**
 * Format correspondant à des dimensions, ou `null` si le couple ne porte pas de
 * nom. Sert à étiqueter un widget (« Bande ») et à savoir d'où repartir dans le
 * cycle. Renvoyer `null` plutôt qu'un format approché est volontaire : depuis que
 * la poignée est libre, une géométrie sur deux est hors catalogue (5×3, 12×7), et
 * la mentir en « Carré » afficherait un nom faux. L'appelant montre alors les
 * dimensions.
 */
export function sizeIdOf(w: number, h: number): GridSizeId | null {
  return GRID_SIZES.find((s) => s.w === w && s.h === h)?.id ?? null;
}

// ==================== Disposition ====================

/** Un rectangle en cases. Sans identité : sert aux sondages de collision. */
export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Un widget POSÉ. `id` est l'identité stable côté consommateur. */
export interface GridPlacement extends GridRect {
  id: string;
}

/**
 * La disposition. C'est ce qui se synchronise et ce qui s'exporte en modèle :
 * un tableau plat, sans pixel, sans thème, sans contenu.
 */
export type GridLayout = GridPlacement[];

/**
 * Formats NOMMÉS proposés en un clic pour un widget. Absent ⇒ les huit.
 *
 * Ce n'est plus ce qui borne la poignée (voir `GridSizeConstraints`) : c'est le
 * menu des raccourcis, rien de plus.
 */
export type GridAllowedSizes = Readonly<Record<string, readonly GridSizeId[]>>;

// ==================== Contraintes de taille ====================

/**
 * Ce qu'un widget a le droit d'exiger de sa case — et RIEN DE PLUS.
 *
 * C'est le contrat qui a remplacé la liste fermée de formats. Un widget ne
 * choisit plus dans un menu de huit rectangles : il déclare un plancher (en
 * dessous, son contenu est illisible : une liste sans aucune ligne visible, un
 * titre coupé) et, s'il en a vraiment un, un plafond (au-delà, il ne sait que
 * s'étirer bêtement). Entre les deux, l'utilisateur fait CE QU'IL VEUT, case par
 * case — c'est sa grille, pas la nôtre.
 *
 * Les quatre champs sont facultatifs, et l'absence veut dire « libre » :
 *   — pas de `minW`/`minH` ⇒ plancher à une case ;
 *   — pas de `maxW` ⇒ jusqu'aux douze colonnes ;
 *   — pas de `maxH` ⇒ AUCUN plafond en hauteur. La surface s'allonge, la page
 *     défile ; un bloc de quinze rangées est une demande légitime, pas un bug.
 *
 * Un widget qui ne déclare rien du tout est donc librement redimensionnable de
 * 1×1 à 12 colonnes. C'est le défaut, et c'est volontaire : une contrainte doit
 * se justifier une par une, pas s'appliquer par oubli.
 */
export interface GridSizeConstraints {
  /** Largeur minimale, en colonnes. Défaut : 1. */
  readonly minW?: number;
  /** Hauteur minimale, en rangées. Défaut : 1. */
  readonly minH?: number;
  /** Largeur maximale, en colonnes. Absent ⇒ les douze. */
  readonly maxW?: number;
  /** Hauteur maximale, en rangées. Absent ⇒ non bornée. */
  readonly maxH?: number;
}

/** Contraintes par widget. Absent ⇒ librement redimensionnable. */
export type GridConstraintMap = Readonly<Record<string, GridSizeConstraints>>;
