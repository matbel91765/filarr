/**
 * outline — le plan du document, construit depuis les titres.
 *
 * DEUX PRÉCAUTIONS, ET ELLES COMPTENT.
 *
 *  1. Le texte d'un titre est du CONTENU DE DOCUMENT — donc du texte
 *     d'attaquant, exactement comme un href. Il n'entre dans le plan que par
 *     `textContent` ; `innerHTML` transformerait un titre en surface de rendu.
 *  2. La reconstruction est DÉBOUNCÉE par l'appelant (300 ms). Reconstruire à
 *     chaque transaction, c'est reconstruire à chaque frappe — la sienne comme
 *     celle des pairs en salle, où les transactions arrivent en rafale.
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import type { I18n } from './i18n';
export interface OutlineEntry {
    /** 1 à 3 — la profondeur d'indentation. */
    level: number;
    text: string;
    /** La position du titre dans le document, pour y sauter. */
    pos: number;
}
/** Les titres du document, dans l'ordre de lecture. */
export declare function buildOutline(doc: PMNode): OutlineEntry[];
export interface OutlinePanelHandle {
    readonly element: HTMLElement;
    update(entries: OutlineEntry[]): void;
    open(): void;
    close(): void;
    toggle(): void;
    isOpen(): boolean;
    destroy(): void;
}
export interface OutlinePanelOptions {
    i18n: I18n;
    onGoTo(pos: number): void;
}
export declare function createOutlinePanel(opts: OutlinePanelOptions): OutlinePanelHandle;
/**
 * Un débounceur minuscule, exporté pour être testé sans horloge réelle.
 * `annuler()` est indispensable : un timer qui survit au démontage rappelle
 * un éditeur détruit.
 */
export declare function debounce<A extends unknown[]>(fn: (...args: A) => void, delai: number): {
    (...args: A): void;
    annuler(): void;
};
