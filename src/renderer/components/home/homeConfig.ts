/**
 * Accueil modulaire — LES RÉGLAGES DE LA PAGE.
 *
 * ── LE PROBLÈME ─────────────────────────────────────────────────────────────
 *
 * Le conteneur de mise en page ne connaît que des VUES faites d'EMPLACEMENTS.
 * Il n'a pas de champ « réglages de la page », et lui en ajouter un voudrait
 * dire porter un nouveau format jusque dans `electron/sync/layoutMergeCore.ts`
 * — la source de vérité du FORMAT — puis vivre avec des documents que les
 * versions plus anciennes ne savent plus fusionner.
 *
 * ── LA SOLUTION EST DÉJÀ INVENTÉE ───────────────────────────────────────────
 *
 * Le chantier des dossiers personnalisables a résolu exactement ça, et ce
 * fichier n'en est que la transposition à l'accueil : les réglages qui ne sont
 * pas des blocs voyagent dans un EMPLACEMENT RÉSERVÉ, rangé comme les autres
 * dans `LayoutView.slots`. Voir `../folder/folderLayout.ts`, dont ce module
 * reprend le motif à l'identique — mêmes garanties, mêmes raisons :
 *
 *   · son `type` n'est PAS dans le registre de widgets, et c'est volontaire :
 *     il ne se dessine pas, ne s'insère pas depuis la palette, n'a pas de
 *     réglages. Le registre reste la liste de ce qui se DESSINE, et le contrat
 *     écrit dans `widgetRegistry` dit qu'un type inconnu doit être CONSERVÉ tel
 *     quel — une version plus ancienne de Filarr affichera donc un accueil
 *     centré sans jamais perdre le réglage de la plus récente ;
 *   · son identité est DÉTERMINISTE (`home:config`) et non un uuid : si deux
 *     appareils écrivent le réglage du même accueil, la fusion doit y
 *     reconnaître un seul emplacement, pas deux empilés ;
 *   · sa géométrie est NULLE et il est retiré de ce qu'on donne à la grille
 *     (`homeGridSlots`) : il n'occupe aucune case, ne peut être ni déplacé, ni
 *     sélectionné, ni retiré, et `mergeGeometry` le préserve intact puisqu'un
 *     emplacement absent des placements garde ce qu'il avait.
 *
 * ── RIEN N'EST ÉCRIT TANT QUE RIEN N'EST DEMANDÉ ────────────────────────────
 *
 * Revenir à « Centré » RETIRE l'emplacement au lieu d'y écrire un marqueur. Un
 * accueil que personne n'a réglé porte donc exactement les mêmes octets
 * qu'avant que ce fichier existe, et ne pousse aucun cycle de synchronisation
 * pour décrire le défaut.
 *
 * ── ET LE GABARIT PARTAGÉ ? ─────────────────────────────────────────────────
 *
 * L'emplacement réservé NE PART PAS à l'export (`Home.tsx` ne donne au
 * dialogue que `homeGridSlots`). Arbitrage : la largeur est une préférence
 * d'ÉCRAN, pas une disposition. Celui qui installe un modèle a son propre
 * moniteur, et un `.filarrlayout` fabriqué sur un 34 pouces n'a pas à forcer la
 * pleine largeur sur un 13 pouces. Techniquement le laisser passer serait pire
 * encore : `coreType('home-config')` est une chaîne acceptable pour le format,
 * le fichier voyagerait donc sans erreur, et à l'import le bloc — absent du
 * registre — s'afficherait en TUILE INERTE au milieu de la disposition que
 * l'utilisateur vient de choisir.
 */

import type { LayoutSlot, LayoutView } from '../../../services/layout/layoutTypes';
import { GRID_COLUMNS, GRID_GUTTER, GRID_ROW_HEIGHT } from '../grid/gridTypes';

// ==================== L'emplacement réservé ====================

/** Type de l'emplacement réservé. Absent du registre, et c'est le point. */
export const HOME_CONFIG_TYPE = 'home-config';

/** Rôle symbolique, pour un gabarit qui traverserait `toTemplate`. */
export const HOME_CONFIG_ROLE = 'home-config';

/** Identité STABLE de l'emplacement réservé. Déterministe, jamais un uuid. */
export const HOME_CONFIG_SLOT_ID = 'home:config';

// ==================== Le modèle ====================

/**
 * Les DEUX valeurs, et il n'y en aura pas de troisième.
 *
 *   · `centered` — le défaut, et le comportement d'avant ce chantier. Ce n'est
 *     pas de la timidité : une ligne de texte de 2 500 px est illisible, et un
 *     accueil qui porte des notes et des noms de fichiers en vit.
 *   · `full` — la grille occupe toute la fenêtre, avec les mêmes marges
 *     latérales que partout ailleurs.
 */
export type HomeWidth = 'centered' | 'full';

export interface HomeConfig {
  width: HomeWidth;
}

/** Ce que vaut un accueil dont personne n'a rien réglé. */
export const DEFAULT_HOME_CONFIG: HomeConfig = { width: 'centered' };

// ==================== Lecture DÉFENSIVE ====================
//
// `LayoutSlot.options` est un `Record<string, unknown>` qui a pu voyager :
// document fusionné depuis un autre appareil, version plus récente, fichier
// trafiqué. Rien de ce qui sort d'ici n'est cru sur parole.

const WIDTHS: readonly HomeWidth[] = ['centered', 'full'];

function readWidth(value: unknown): HomeWidth {
  return typeof value === 'string' && (WIDTHS as readonly string[]).includes(value)
    ? (value as HomeWidth)
    : DEFAULT_HOME_CONFIG.width;
}

// ==================== Vue ⇄ configuration ====================

/**
 * Les réglages portés par une liste d'emplacements. Jamais `null` : contrairement
 * à un dossier, l'accueil existe toujours et a toujours une largeur — l'absence
 * d'emplacement réservé se lit « Centré », pas « rien ».
 *
 * C'est aussi ce que lit le BROUILLON d'une session d'édition, qui n'a pas de
 * vue à lui mais bien une liste d'emplacements.
 */
export function readHomeConfigFromSlots(slots: readonly LayoutSlot[] | undefined): HomeConfig {
  const slot = slots?.find((candidate) => candidate.type === HOME_CONFIG_TYPE);
  if (!slot) return DEFAULT_HOME_CONFIG;
  return { width: readWidth(slot.options?.width) };
}

/** La même lecture à partir d'une vue. */
export function readHomeConfig(view: LayoutView | undefined): HomeConfig {
  return readHomeConfigFromSlots(view?.slots);
}

/**
 * Les blocs qui vont à la GRILLE : tout sauf l'emplacement réservé.
 *
 * La référence est PRÉSERVÉE quand il n'y a rien à filtrer — c'est-à-dire chez
 * tous ceux qui n'ont jamais touché au réglage. Recréer le tableau à chaque
 * rendu casserait la mémoïsation qui fait que `GridItem` ne re-rend que les
 * cases qui bougent pendant un glissement.
 */
export function homeGridSlots(slots: readonly LayoutSlot[]): readonly LayoutSlot[] {
  return slots.some((slot) => slot.type === HOME_CONFIG_TYPE)
    ? slots.filter((slot) => slot.type !== HOME_CONFIG_TYPE)
    : slots;
}

/** L'emplacement réservé, fabriqué à partir d'une configuration. */
function toConfigSlot(config: HomeConfig): LayoutSlot {
  return {
    id: HOME_CONFIG_SLOT_ID,
    role: HOME_CONFIG_ROLE,
    type: HOME_CONFIG_TYPE,
    // Géométrie NULLE : cet emplacement ne va jamais à la grille, mais s'il y
    // arrivait un jour par un chemin qu'on n'a pas prévu, il n'y prendrait
    // aucune case au lieu d'ouvrir un trou d'une rangée.
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    options: { width: config.width },
  };
}

/**
 * Repose des réglages sur une liste de blocs. L'emplacement réservé passe EN
 * TÊTE : il ne coûte rien à la grille (qui ne le voit jamais) et il rend le
 * document lisible à l'œil nu quand on l'inspecte.
 *
 * Le défaut n'écrit RIEN : revenir à « Centré » retire l'emplacement.
 */
export function withHomeConfig(slots: readonly LayoutSlot[], config: HomeConfig): LayoutSlot[] {
  const band = [...homeGridSlots(slots)];
  return config.width === DEFAULT_HOME_CONFIG.width ? band : [toConfigSlot(config), ...band];
}

// ==================== La métrique de la page ====================

/**
 * Le plafond du mode « Centré », en pixels. Il DOUBLE `--home-page-max-width`
 * dans `home.css`, exactement comme `GRID_GUTTER` double `--grid-gutter` : la
 * feuille de style pose la largeur, ce module en dérive la case, et les deux
 * doivent dire la même chose. Changer l'un sans l'autre décale le témoin de
 * dépôt d'une demi-case.
 */
export const HOME_PAGE_MAX_WIDTH = 1400;

/** Les marges latérales usuelles de la page (`px-6`), des deux côtés. */
export const HOME_PAGE_PADDING = 24;

/**
 * La case de RÉFÉRENCE : celle qu'on obtient au plafond du mode centré, donc
 * celle sur laquelle les blocs du produit ont été dessinés. 98 px.
 */
export const HOME_REFERENCE_CELL =
  (HOME_PAGE_MAX_WIDTH - 2 * HOME_PAGE_PADDING - GRID_GUTTER * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

/**
 * De combien la case a le droit de s'élargir par rapport à sa référence avant
 * qu'on cesse de la suivre. Mesuré (sonde de rendu réel, `.home-page` en pleine
 * largeur) :
 *
 *     fenêtre   case     bloc « Tuile » (3×1) à rangée fixe
 *      1440    100 px     332 × 88  — ratio 3,8 (référence : 3,7)
 *      1904    139 px     448 × 88  — ratio 5,1
 *      2560    193 px     612 × 88  — ratio 7,0
 *      3440    267 px     832 × 88  — ratio 9,5
 *
 * Au-delà de ~1900 px la carte n'est plus une carte, c'est un bandeau. Le
 * remède est de BORNER LA CASE, pas de re-brider la page : re-brider serait
 * remettre exactement le vide que ce réglage sert à supprimer.
 *
 * Or la seule dimension de la case qu'on puisse borner sans toucher au moteur
 * de grille est sa HAUTEUR — la largeur, elle, est imposée par les douze
 * colonnes, qui sont la disposition MAÎTRESSE et ne se négocient pas. On fait
 * donc suivre la rangée jusqu'à 1,5× : la proportion redescend à 3,7 sur 1904
 * et à 4,8 sur 2560, et au-delà on assume l'étirement résiduel plutôt que de
 * fabriquer des blocs hauts de trois cents pixels.
 */
export const HOME_ROW_SCALE_MAX = 1.5;

/** La trame du produit. Une rangée hors trame désaligne tout ce qu'un bloc pose. */
const GRID_UNIT = 8;

/**
 * La hauteur de rangée à donner à la surface, pour une largeur de grille et un
 * nombre de colonnes DÉJÀ connus.
 *
 * C'est une métrique DÉRIVÉE, jamais stockée — comme le nombre de colonnes.
 * Rien de ce qui se synchronise ni de ce qui s'exporte n'en dépend : deux
 * appareils qui reçoivent la même disposition affichent la même chose à largeur
 * égale, et un modèle partagé ne transporte aucune hauteur.
 *
 * Elle NE BOUGE PAS en mode centré, et ce n'est pas un hasard : la page y est
 * plafonnée à 1400 px, donc la case n'y dépasse jamais sa référence et l'échelle
 * reste coincée à 1. Le défaut du produit rend donc au pixel près ce qu'il
 * rendait avant ce chantier.
 */
export function homeRowHeight(gridWidth: number, columns: number): number {
  // Six et une colonne sont des REPLIS : ils n'arrivent que sous 1200 px de
  // surface, là où la pleine largeur et le centrage donnent la même chose. Rien
  // à corriger, et une correction y ferait bouger un rendu qui va bien.
  if (columns !== GRID_COLUMNS) return GRID_ROW_HEIGHT;
  if (!Number.isFinite(gridWidth) || gridWidth <= 0) return GRID_ROW_HEIGHT;

  const cell = (gridWidth - GRID_GUTTER * (columns - 1)) / columns;
  const scale = Math.min(Math.max(cell / HOME_REFERENCE_CELL, 1), HOME_ROW_SCALE_MAX);
  // Arrondi VERS LE BAS sur la trame : une rangée de 132 px désalignerait tout
  // ce qu'un bloc pose à l'intérieur de lui-même.
  return Math.floor((GRID_ROW_HEIGHT * scale) / GRID_UNIT) * GRID_UNIT;
}
