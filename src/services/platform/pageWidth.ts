/**
 * LA LARGEUR DES PAGES — une préférence d'application, un seul poseur.
 *
 * ── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
 *
 * Le réglage « Accueil pleine largeur » existait déjà, mais il vit DANS le
 * document de l'accueil (`homeConfig`, un emplacement réservé du fichier de
 * disposition) : c'est un attribut de cette page-là, il voyage avec elle quand
 * on l'exporte ou qu'on la publie, et il ne concerne qu'elle.
 *
 * Le reste de l'application, lui, portait ses plafonds ÉCRITS EN DUR, chacun
 * dans son coin : 1120 px dans la page « Gérer le coffre » et dans la console
 * d'organisation, 900 et 1100 px dans la marketplace, 960 px dans les Rappels,
 * 1200 px dans la corbeille. Sur un écran large, mettre l'accueil en pleine
 * largeur et retrouver une colonne centrée partout ailleurs se lit comme un
 * défaut d'affichage, pas comme une intention.
 *
 * ── CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS ──────────────────────────
 *
 * Il pose un attribut sur le document, et rien d'autre. Les pages ne le lisent
 * pas : elles écrivent `max-width: var(--page-max-width, <leur plafond>)`, et
 * la feuille `pageWidth.css` ne définit `--page-max-width` QUE dans le mode
 * « pleine largeur », où elle vaut `none`.
 *
 * C'est ce qui rend le changement sans risque : en mode centré la variable
 * n'existe pas, le repli s'applique, et chaque page garde EXACTEMENT le
 * plafond qu'elle avait — 960 pour les Rappels, 1200 pour la corbeille. Rien
 * n'est uniformisé au passage, parce qu'uniformiser aurait été un autre
 * chantier, non demandé, et invisible dans une revue de ce lot.
 *
 * ⚠ L'ACCUEIL N'EST PAS CONCERNÉ. Il a son propre réglage, à sa propre place,
 * et c'est lui qui décide de lui-même. Deux réglages pour deux portées : celui
 * de l'accueil suit le document (il part avec un modèle publié), celui-ci suit
 * la MACHINE et ne voyage nulle part.
 */

export type PageWidth = 'centered' | 'full';

/** Les deux valeurs, et il n'y en aura pas de troisième. */
export const PAGE_WIDTHS: readonly PageWidth[] = ['centered', 'full'];

/** Ce que vaut une application dont personne n'a rien réglé. */
export const DEFAULT_PAGE_WIDTH: PageWidth = 'centered';

/** La clé de stockage. Partagée entre fenêtres de même origine (mode réduit). */
export const PAGE_WIDTH_KEY = 'filarr-page-width';

/** L'attribut posé sur `<html>`. Lu par `pageWidth.css`, jamais par du JS. */
export const PAGE_WIDTH_ATTR = 'data-page-width';

export function isPageWidth(value: unknown): value is PageWidth {
  return typeof value === 'string' && (PAGE_WIDTHS as readonly string[]).includes(value);
}

/**
 * Pose la largeur sur le document, et la retient.
 *
 * Le mode centré RETIRE l'attribut au lieu de le poser à `centered` : c'est le
 * comportement d'avant ce réglage, et un attribut absent est ce qui garantit
 * qu'aucune règle nouvelle ne s'applique à ceux qui n'ont rien demandé.
 */
export function applyPageWidth(width: PageWidth, persist = true): void {
  if (typeof document !== 'undefined') {
    if (width === 'full') {
      document.documentElement.setAttribute(PAGE_WIDTH_ATTR, 'full');
    } else {
      document.documentElement.removeAttribute(PAGE_WIDTH_ATTR);
    }
  }
  if (!persist) return;
  try {
    localStorage.setItem(PAGE_WIDTH_KEY, width);
  } catch {
    // Stockage refusé : la largeur est posée pour cette session, et c'est déjà
    // ce que l'utilisateur vient de demander.
  }
}

/** La largeur en vigueur. Une valeur inconnue retombe sur le défaut. */
export function currentPageWidth(): PageWidth {
  try {
    const raw = localStorage.getItem(PAGE_WIDTH_KEY);
    return isPageWidth(raw) ? raw : DEFAULT_PAGE_WIDTH;
  } catch {
    return DEFAULT_PAGE_WIDTH;
  }
}
