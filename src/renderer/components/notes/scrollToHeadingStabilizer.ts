/**
 * Défilement vers un titre, re-visé après stabilisation de la mise en page —
 * Filarr Notes
 *
 * Logique PURE (aucun DOM, aucun React) : l'orchestration seule vit ici pour
 * être testée sans navigateur. `NoteEditor` fournit les ports (viser, lire
 * l'horloge, être prévenu de l'arrêt) et branche les vrais capteurs
 * (ResizeObserver, molette, clavier, minuterie).
 *
 * POURQUOI RE-VISER. Un clic dans la carte mentale REMONTE `NoteEditor` à
 * neuf (bascule de mode de vue), puis demande le saut vers un titre. Un seul
 * `requestAnimationFrame` plus tard, le document ProseMirror est bien posé,
 * mais les NodeViews React (encadré, mermaid, images, bases inline) se
 * montent APRÈS cette frame et changent la hauteur de tout ce qui précède le
 * titre visé : le défilement, calculé sur une géométrie provisoire, atterrit
 * à côté. On observe donc la taille du document pendant une courte fenêtre et
 * on re-vise à chaque décalage — puis on lâche prise.
 *
 * POURQUOI ABANDONNER. Le défilement ne doit JAMAIS se battre contre
 * l'utilisateur : dès qu'il manifeste une intention (molette, toucher, touche,
 * pointeur), la re-visée est abandonnée, même si la mise en page bouge encore.
 *
 * `onStop` est appelé UNE seule fois, quelle que soit la cause : c'est là que
 * le câblage débranche ses capteurs et efface le drapeau Redux — pas avant,
 * sinon l'effet qui l'a posé se démonte avec lui.
 */

// ==================== Résolution par rang ====================

/**
 * Sous-ensemble du document ProseMirror dont la résolution a besoin : de quoi
 * parcourir les nœuds en profondeur avec leur position.
 */
export interface HeadingDocLike {
  descendants(callback: (node: { type: { name: string } }, pos: number) => boolean | void): void;
}

/**
 * Position ProseMirror (INTÉRIEUR du titre, pas la frontière avant lui) du
 * titre de rang `rank` dans le document — ordre de parcours en profondeur,
 * titres vides compris, titres imbriqués (encadré, colonne, volet) compris.
 * C'est la convention de `extractHeadings`, du sommaire et de la carte
 * mentale : les trois doivent changer ensemble.
 *
 * `null` si le document compte moins de `rank + 1` titres.
 */
export function findHeadingPosByRank(doc: HeadingDocLike, rank: number): number | null {
  if (!Number.isInteger(rank) || rank < 0) return null;
  let seen = 0;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'heading') {
      if (seen === rank) {
        found = pos + 1;
        return false;
      }
      seen += 1;
    }
    return true;
  });
  return found;
}

// ==================== Géométrie ====================

/** Marge laissée au-dessus du titre pour qu'il ne colle pas au bord. */
export const HEADING_SCROLL_MARGIN_PX = 16;

/**
 * Nouveau `scrollTop` du conteneur pour amener le haut de la cible à
 * `margin` pixels sous le haut du conteneur, borné à ce que le conteneur peut
 * réellement défiler. Toutes les mesures sont en coordonnées d'écran
 * (`getBoundingClientRect`), sauf `scrollTop`/`scrollHeight`/`clientHeight`.
 */
export function computeScrollTopForTarget(input: {
  containerTop: number;
  containerScrollTop: number;
  containerScrollHeight: number;
  containerClientHeight: number;
  targetTop: number;
  margin?: number;
}): number {
  const margin = input.margin ?? HEADING_SCROLL_MARGIN_PX;
  const wanted = input.containerScrollTop + (input.targetTop - input.containerTop) - margin;
  const max = Math.max(0, input.containerScrollHeight - input.containerClientHeight);
  return Math.min(max, Math.max(0, Math.round(wanted)));
}

// ==================== Stabilisateur ====================

/** Fenêtre pendant laquelle un décalage de mise en page provoque une re-visée. */
export const HEADING_SCROLL_STABILIZE_WINDOW_MS = 500;

export type StabilizerStopReason =
  /** La fenêtre d'observation est écoulée : la mise en page est tenue pour stable. */
  | 'deadline'
  /** L'utilisateur a pris la main sur le défilement. */
  | 'user'
  /** La cible n'est plus résoluble (document réécrit, titre supprimé). */
  | 'unresolvable'
  /** Démontage externe (l'effet se nettoie). */
  | 'disposed';

export type LayoutShiftOutcome = 'aimed' | 'stopped';

export interface StabilizerPorts {
  /**
   * Recentre la vue sur la cible. Retourne `false` si la cible n'existe plus,
   * ce qui arrête le stabilisateur : re-viser le vide n'a pas de sens.
   */
  aim: () => boolean;
  /** Horloge injectée (millisecondes), pour des tests déterministes. */
  now: () => number;
  /** Appelé UNE fois, à l'arrêt, avec la cause. */
  onStop?: (reason: StabilizerStopReason) => void;
}

export interface HeadingScrollStabilizer {
  /** Un décalage de mise en page vient d'être observé. */
  onLayoutShift(): LayoutShiftOutcome;
  /** L'utilisateur a manifesté une intention : on lâche prise. */
  onUserIntent(): void;
  /** La minuterie de fin de fenêtre a sonné. */
  onDeadline(): void;
  /** Démontage externe. */
  dispose(): void;
  readonly active: boolean;
  readonly stopReason: StabilizerStopReason | null;
  /** Instant (horloge injectée) au-delà duquel plus aucune re-visée n'a lieu. */
  readonly deadlineAt: number;
}

/**
 * À créer JUSTE APRÈS la première visée réussie : la fenêtre court à partir
 * de `now()`. Le premier « décalage » signalé par un ResizeObserver est sa
 * notification initiale (taille courante) : la re-visée qu'elle déclenche
 * est un simple recalage, sans effet si rien n'a bougé.
 */
export function createHeadingScrollStabilizer(
  ports: StabilizerPorts,
  options: { windowMs?: number } = {}
): HeadingScrollStabilizer {
  const windowMs = options.windowMs ?? HEADING_SCROLL_STABILIZE_WINDOW_MS;
  const deadlineAt = ports.now() + windowMs;
  let stopReason: StabilizerStopReason | null = null;

  const stop = (reason: StabilizerStopReason): void => {
    if (stopReason !== null) return;
    stopReason = reason;
    ports.onStop?.(reason);
  };

  return {
    onLayoutShift() {
      if (stopReason !== null) return 'stopped';
      // La minuterie peut être en retard (onglet en arrière-plan) : l'horloge
      // fait foi, pas l'ordre d'arrivée des événements.
      if (ports.now() > deadlineAt) {
        stop('deadline');
        return 'stopped';
      }
      let resolved = false;
      try {
        resolved = ports.aim();
      } catch {
        // Une visée qui lève (vue détruite entre-temps) vaut cible perdue.
        resolved = false;
      }
      if (!resolved) {
        stop('unresolvable');
        return 'stopped';
      }
      return 'aimed';
    },
    onUserIntent() {
      stop('user');
    },
    onDeadline() {
      stop('deadline');
    },
    dispose() {
      stop('disposed');
    },
    get active() {
      return stopReason === null;
    },
    get stopReason() {
      return stopReason;
    },
    deadlineAt,
  };
}
