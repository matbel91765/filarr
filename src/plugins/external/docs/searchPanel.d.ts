/**
 * searchPanel — la barre de recherche, et ses deux touches piégées.
 *
 * ÉCHAP NE DOIT PAS REMONTER. L'éditeur vit dans une `Modal` de l'hôte, qui
 * écoute Échap sur `document` pour se fermer. Sans `stopPropagation`, fermer
 * la recherche fermerait l'ÉDITEUR ENTIER — et en salle, sans même la
 * confirmation « modifications non enregistrées », puisque le document CRDT
 * est réputé sauvegardé ailleurs.
 *
 * CTRL+F NON PLUS. Sur le web, il ouvre la recherche du NAVIGATEUR, qui ne
 * connaît ni les décorations ni le remplacement, et qui cherche aussi dans la
 * barre d'outils. `preventDefault` est le seul moyen d'avoir la nôtre.
 */
import type { EditorView } from '@tiptap/pm/view';
import type { I18n } from './i18n';
export interface SearchPanelHandle {
    readonly element: HTMLElement;
    open(): void;
    close(): void;
    isOpen(): boolean;
    /** Réaffiche le compteur — à appeler quand le document bouge. */
    refresh(): void;
    destroy(): void;
}
export interface SearchPanelOptions {
    i18n: I18n;
    /** La vue est résolue à l'usage : le panneau se construit avant elle. */
    view: () => EditorView | null;
    /** Un lecteur cherche ; il ne remplace pas. */
    editable: boolean;
    onNotify(message: string): void;
}
export declare function createSearchPanel(opts: SearchPanelOptions): SearchPanelHandle;
