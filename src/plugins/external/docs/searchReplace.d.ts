/**
 * searchReplace — la recherche du document, SANS dépendance.
 *
 * Un plugin ProseMirror maison : décorations de surlignage, occurrence
 * courante distincte, compteur x/y, remplacer et tout remplacer. Pas de
 * paquet tiers pour trois cents lignes qu'on doit de toute façon comprendre.
 *
 * TOUT REMPLACER EST BORNÉ, ET CE N'EST PAS DU CONFORT. En salle, une
 * transaction unique qui réécrit dix mille occurrences produit une trame Yjs
 * qui peut dépasser le maximum du relais (1 Mio) — et une trame trop grosse
 * est ABANDONNÉE SANS RETRANSMISSION : les pairs gardent silencieusement un
 * document différent du nôtre, définitivement. Les tranches (50 occurrences,
 * une respiration entre deux) laissent le lot de sortie produire PLUSIEURS
 * trames de taille raisonnable.
 *
 * ON REMPLACE DE LA FIN VERS LE DÉBUT. Les positions calculées une seule fois
 * restent valides tant qu'on ne touche à rien AVANT elles ; c'est aussi ce qui
 * fait terminer un « remplacer "a" par "aa" » qui, recalculé à chaque tour,
 * tournerait pour toujours.
 */
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
export interface Match {
    from: number;
    to: number;
}
export interface SearchState {
    query: string;
    matchCase: boolean;
    matches: Match[];
    /** L'index de l'occurrence courante ; -1 quand il n'y en a aucune. */
    index: number;
    decorations: DecorationSet;
}
/** Une tranche de remplacement — voir l'en-tête pour la trame de 1 Mio. */
export declare const TRANCHE_REMPLACEMENT = 50;
export declare const searchPluginKey: PluginKey<SearchState>;
/**
 * Toutes les occurrences, en ordre de position.
 *
 * On travaille BLOC DE TEXTE par bloc de texte : une occurrence à cheval sur
 * deux nœuds texte (le mot est en partie gras) doit être trouvée, or les nœuds
 * texte sont découpés par les marques. `textBetween` recolle le bloc, et un
 * caractère de remplissage par nœud-feuille garde les décalages alignés sur
 * les positions du document.
 */
export declare function findMatches(doc: PMNode, query: string, matchCase?: boolean): Match[];
export declare function searchPlugin(): Plugin<SearchState>;
export declare function getSearchState(state: EditorState): SearchState | undefined;
/** Pose (ou efface) la recherche courante. */
export declare function setSearch(view: EditorView, query: string, matchCase: boolean): void;
/** Avance de ±1 dans les occurrences, en bouclant, et fait défiler jusqu'à elle. */
export declare function stepMatch(view: EditorView, delta: number): void;
/** Amène l'occurrence courante sous les yeux, sans voler le focus au champ. */
export declare function revealCurrent(view: EditorView): void;
/** Remplace l'occurrence COURANTE. Rend vrai si quelque chose a bougé. */
export declare function replaceCurrent(view: EditorView, remplacement: string): boolean;
export interface ReplaceAllOptions {
    /** Occurrences par transaction — voir l'en-tête (trame de 1 Mio). */
    tranche?: number;
    /** La respiration entre deux tranches, injectable pour les tests. */
    respirer?: () => Promise<void>;
}
/**
 * Remplace TOUT, par tranches. Rend le nombre d'occurrences remplacées.
 *
 * Les positions sont calculées UNE fois puis traitées de la fin vers le début :
 * rien de ce qu'on remplace ne déplace ce qui reste à faire.
 */
export declare function replaceAll(view: EditorView, remplacement: string, opts?: ReplaceAllOptions): Promise<number>;
