/**
 * overlayBounds — la zone où un panneau flottant a le droit de se poser.
 *
 * ── LE PROBLÈME ────────────────────────────────────────────────────────────
 * Menus et panneaux sont portés par `<body>` (portail) et placés en
 * `position: fixed`. Leurs coordonnées sont donc celles de la FENÊTRE — et la
 * fenêtre n'est pas ce qui est libre. En disposition « rail », une colonne de
 * 56 px est collée à gauche, en `position: fixed`, à un z-index SUPÉRIEUR
 * (1041 contre 1000) : un panneau ramené « dans l'écran » se glissait
 * dessous, et le rail lui mangeait sa marge gauche — titre, onglets et noms de
 * fichiers tronqués, sans que rien ne le signale (constaté le 2026-08-31 sur
 * le panneau d'activité de synchro).
 *
 * ── LE CONTRAT ─────────────────────────────────────────────────────────────
 * Une surface fixe qui mange une bande de la fenêtre se DÉCLARE, avec
 * `data-overlay-obstruction="left | right | top | bottom"` — le côté qu'elle
 * occupe. Personne n'a besoin de connaître sa largeur : elle est mesurée.
 *
 * C'est un attribut et non une classe en dur ici : le jour où une seconde
 * barre fixe apparaît (rail à droite, bande d'état en bas), elle se déclare et
 * TOUS les panneaux en tiennent compte, sans qu'aucun ne soit modifié.
 *
 * ── POURQUOI LA GÉOMÉTRIE EST SÉPARÉE DE LA MESURE ─────────────────────────
 * `computeBounds` ne touche pas au DOM : c'est la règle, et elle est
 * éprouvée (overlayBounds.vitest.ts). `getOverlayBounds` n'est que l'oeil qui
 * lit la page et la lui passe. Ce calcul s'est trompé deux fois de suite —
 * une fois en bas, une fois à gauche — chaque fois écrit à la main dans le
 * composant concerné, donc jamais au même endroit.
 */

/** L'air minimale entre un panneau et ce qui le borde. */
export const OVERLAY_MARGIN = 8;

export type ObstructionSide = 'left' | 'right' | 'top' | 'bottom';

export interface OverlayBounds {
  /** Abscisse minimale du bord GAUCHE d'un panneau. */
  left: number;
  /** Abscisse maximale de son bord DROIT. */
  right: number;
  /** Ordonnée minimale de son bord HAUT. */
  top: number;
  /** Ordonnée maximale de son bord BAS. */
  bottom: number;
}

/** Le strict nécessaire d'un DOMRect — pour que le calcul reste testable. */
export interface ObstructionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Obstruction {
  side: ObstructionSide;
  rect: ObstructionRect;
}

/**
 * La zone libre, à partir d'une fenêtre et des surfaces qui la mordent.
 *
 * Fonction PURE : aucun DOM, donc éprouvable.
 */
export function computeBounds(
  viewport: { width: number; height: number },
  obstructions: readonly Obstruction[] = [],
  margin: number = OVERLAY_MARGIN
): OverlayBounds {
  const bounds: OverlayBounds = {
    left: margin,
    right: viewport.width - margin,
    top: margin,
    bottom: viewport.height - margin,
  };

  for (const { side, rect } of obstructions) {
    // Une surface repliée (largeur ou hauteur nulle) n'obstrue rien : une barre
    // peut rester montée dans un mode où elle n'est pas rendue.
    if (rect.width === 0 || rect.height === 0) continue;
    switch (side) {
      case 'left':
        bounds.left = Math.max(bounds.left, rect.right + margin);
        break;
      case 'right':
        bounds.right = Math.min(bounds.right, rect.left - margin);
        break;
      case 'top':
        bounds.top = Math.max(bounds.top, rect.bottom + margin);
        break;
      case 'bottom':
        bounds.bottom = Math.min(bounds.bottom, rect.top - margin);
        break;
    }
  }

  return bounds;
}

/**
 * La zone libre courante, lue sur la page.
 *
 * Mesurée à chaque appel : le rail apparaît et disparaît au gré du réglage
 * « Affichage des barres », et une valeur mise en cache mentirait dès le
 * premier changement de mode.
 */
export function getOverlayBounds(margin: number = OVERLAY_MARGIN): OverlayBounds {
  const obstructions: Obstruction[] = [];
  for (const el of Array.from(document.querySelectorAll('[data-overlay-obstruction]'))) {
    const side = el.getAttribute('data-overlay-obstruction');
    if (side !== 'left' && side !== 'right' && side !== 'top' && side !== 'bottom') continue;
    obstructions.push({ side, rect: el.getBoundingClientRect() });
  }
  return computeBounds(
    { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    obstructions,
    margin
  );
}

/**
 * Ramène une longueur dans [min, max] SANS jamais franchir `min`.
 *
 * `Math.min(Math.max(min, v), max)` retournerait `max` — donc moins que `min` —
 * quand la zone libre est plus étroite que le panneau. Mieux vaut alors un
 * panneau qui dépasse du côté opposé qu'un panneau dont le DÉBUT est hors
 * champ : c'est le début qui porte le titre et les premières lignes.
 */
export function clampToBounds(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), Math.max(min, max));
}
