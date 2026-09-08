/**
 * Points d'arrêt PARTAGÉS.
 *
 * Un seul endroit répond à « à partir de quelle largeur ? ». Les feuilles de
 * style du produit portaient jusqu'ici neuf seuils différents (480, 600, 639,
 * 640, 720, 768, 900, 1024, 1280) : chacun était défendable pris isolément, et
 * l'ensemble ne décrivait aucune intention. Une disposition MODULAIRE ne peut
 * pas se permettre ça — elle doit se replier de la même façon partout, sinon un
 * modèle partagé ne se replie pas comme chez celui qui l'a fabriqué.
 *
 * Trois bandes, pas plus, parce qu'il y a exactement trois façons de tenir
 * l'application : plein écran (douze colonnes), fenêtre partagée ou tablette
 * (six), téléphone ou panneau étroit (une).
 *
 * MESURÉ SUR UN CONTENEUR, PAS SUR LA FENÊTRE. `breakpointForWidth` prend une
 * largeur en pixels, d'où qu'elle vienne. La grille lui passe la largeur de sa
 * surface (relevée par un `ResizeObserver`) : une grille posée dans un panneau
 * latéral de 700 px doit se replier même sur un écran de 4 K, et c'est le
 * conteneur, jamais la fenêtre, qui le sait. Les requêtes média exportées
 * restent disponibles pour le CSS qui, lui, n'a que la fenêtre.
 */

/** En dessous : une seule colonne. */
export const BREAKPOINT_COMPACT = 840;
/** À partir d'ici : la grille maîtresse en douze colonnes. */
export const BREAKPOINT_WIDE = 1200;

export type LayoutBreakpoint = 'compact' | 'medium' | 'wide';

/**
 * Bande d'une largeur donnée. Les bornes sont fermées à gauche (`>=`), comme les
 * `min-width` du CSS : 840 est déjà `medium`, 1200 est déjà `wide`. Une largeur
 * absurde (0, NaN d'un conteneur pas encore mesuré) retombe sur `compact` —
 * c'est la disposition qui ne peut jamais déborder.
 */
export function breakpointForWidth(width: number): LayoutBreakpoint {
  if (!Number.isFinite(width) || width < BREAKPOINT_COMPACT) return 'compact';
  if (width < BREAKPOINT_WIDE) return 'medium';
  return 'wide';
}

/** Requêtes média équivalentes, pour le CSS et `window.matchMedia`. */
export const MEDIA_MEDIUM_UP = `(min-width: ${BREAKPOINT_COMPACT}px)`;
export const MEDIA_WIDE_UP = `(min-width: ${BREAKPOINT_WIDE}px)`;
