/**
 * toolbar — UNE liste ordonnée de specs, et rien d'autre.
 *
 * CE QUI NE MARCHAIT PAS. La barre v0.2 construisait les pastilles de
 * surlignage d'abord, puis insérait chaque bouton avec
 * `insertBefore(b, toolbar.querySelector('.fdocs-swatch'))`. Deux
 * conséquences, toutes deux vécues :
 *
 *  · les pastilles étaient ÉPINGLÉES en fin de barre, quoi qu'on veuille. On
 *    ne pouvait pas les ranger avec les autres outils de couleur, donc pas
 *    grouper la barre du tout.
 *  · le rafraîchissement couplait `boutonEls[i]` à `boutons[i]`. Tant que les
 *    deux listes se correspondaient un pour un, ça tenait ; le jour où un
 *    séparateur — un élément SANS spec de bouton — entre dans la barre, tout
 *    l'appariement glisse d'un cran et les états actifs se posent sur les
 *    mauvais boutons.
 *
 * D'où : une SEULE liste, parcourue en `appendChild` dans l'ordre déclaré, et
 * un rafraîchissement qui travaille sur des PAIRES `{spec, el}` — jamais sur
 * des index parallèles.
 *
 * LES SÉPARATEURS SONT VIVANTS. Un séparateur introduit un groupe ; il se
 * masque quand tout son groupe est masqué. Sans cette règle, sortir d'un
 * tableau laissait un trait qui ne séparait plus rien.
 */
import type { I18n } from './i18n';
export interface ToolbarButtonSpec {
    kind: 'button';
    /** Le groupe auquel ce bouton appartient — sert aux séparateurs. */
    group: string;
    label: string;
    /** Part en `title=` ET en `aria-label` : un glyphe nu ne se lit pas. */
    title: string;
    /** Bouton contextuel (gestes de tableau) — retiré hors contexte. */
    visible?: () => boolean;
    /** Grisé mais VISIBLE, avec la raison dans le tooltip. */
    enabled?: () => boolean;
    isActive?: () => boolean;
    run: () => void;
}
export interface ToolbarSwatchSpec {
    kind: 'swatch';
    group: string;
    /** La couleur portée ; `null` = la pastille de retrait. */
    color: string | null;
    label?: string;
    title: string;
    run: () => void;
}
export interface ToolbarSeparatorSpec {
    kind: 'separator';
    /** Le groupe que ce séparateur INTRODUIT. */
    group: string;
}
export type ToolbarSpec = ToolbarButtonSpec | ToolbarSwatchSpec | ToolbarSeparatorSpec;
export interface ToolbarHandle {
    readonly element: HTMLElement;
    /** Réapplique actif / visible / grisé à partir de l'état courant. */
    refresh(): void;
    destroy(): void;
}
export interface ToolbarOptions {
    i18n: I18n;
    /** Ce qu'on dit d'un bouton grisé — jamais un grisé muet. */
    disabledReason: string;
}
export declare function renderToolbar(specs: ToolbarSpec[], opts: ToolbarOptions): ToolbarHandle;
