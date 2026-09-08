/**
 * schemaGuard — LA protection des salles à versions mixtes.
 *
 * LE PROBLÈME, ET POURQUOI LE REFUS fdoc NE SUFFIT PAS. `parseFdoc` refuse un
 * document d'une version inconnue : c'est la garde du chemin FICHIER. En
 * SALLE, il n'y a pas de fichier — il y a un Y.XmlFragment partagé, et un pair
 * qui monte tiptap sans les extensions v3 détruit les nœuds v3 AU SIMPLE
 * MONTAGE : y-prosemirror projette le fragment dans un schéma qui ne connaît
 * pas `taskItem`, ProseMirror jette ce qu'il ne sait pas placer, et la
 * suppression repart vers tout le monde comme une édition légitime. Personne
 * n'a rien fait, et les tâches ont disparu pour tous.
 *
 * DEUX GARDES, DANS LES DEUX SENS DU TEMPS.
 *
 *  1. VERS LE PASSÉ — la capacité d'Awareness. Chaque client v3 annonce
 *     `docsSchema: 3`. Tant qu'UN pair présent ne l'annonce pas (les v2
 *     n'annoncent rien du tout), l'INSERTION des types v3 est désactivée : on
 *     n'introduit jamais un nœud qu'un pair présent détruirait. Ce n'est pas
 *     une dégradation du document — c'est un bouton grisé, réévalué à chaque
 *     changement de composition de la salle, qui redevient actif dès que le
 *     retardataire est parti ou s'est mis à jour.
 *
 *  2. VERS L'AVENIR — le plancher dans le Y.Doc. La salle porte son propre
 *     numéro de schéma dans `filarr:docs`. Si elle annonce plus haut que ce
 *     qu'on sait faire, on NE SE LIE PAS : montage solo et bandeau, même
 *     doctrine que parseFdoc — refuser, jamais dégrader. Sinon on y inscrit
 *     notre niveau, ce qui protégera les v3 des futurs v4.
 */
import type * as Y from 'yjs';
import type { AwarenessLike } from './filarr-plugin-api';
/** Le niveau de schéma que ce plugin sait porter. Suit FDOC_VERSION. */
export declare const DOCS_SCHEMA = 3;
/** Le champ d'Awareness qui porte la capacité — absent = version antérieure. */
export declare const SCHEMA_FIELD = "docsSchema";
/** La carte de métadonnées de la salle, et sa clé de plancher. */
export declare const SCHEMA_MAP = "filarr:docs";
export declare const SCHEMA_KEY = "schema";
/**
 * Vrai si TOUS les pairs présents (nous exclus) annoncent au moins `requis`.
 * Seul dans la salle : vrai — il n'y a personne à léser.
 */
export declare function peersSupportSchema(states: Map<number, Record<string, unknown>>, selfClientId: number, requis?: number): boolean;
export interface SchemaCapability {
    /** Réévalué à chaque changement d'Awareness. */
    peersReady(): boolean;
    destroy(): void;
}
/**
 * Annonce notre capacité et surveille celle des autres. `onChange` n'est
 * appelé que lorsque la réponse CHANGE — la barre se redessine alors, et pas à
 * chaque battement de curseur des voisins.
 */
export declare function announceSchemaCapability(awareness: AwarenessLike, onChange: (ready: boolean) => void): SchemaCapability;
export interface SchemaFloor {
    /** 'join' = on se lie au CRDT ; 'solo' = la salle est trop récente. */
    mode: 'join' | 'solo';
    /** Le niveau annoncé par la salle AVANT notre passage (0 = vierge). */
    roomSchema: number;
}
/**
 * Lit le plancher de la salle et, si on la comprend, y inscrit le nôtre.
 *
 * On n'ABAISSE jamais le plancher : `max(actuel, DOCS_SCHEMA)`. Un v4 qui
 * repasserait derrière nous se verrait rétrogradé, et le v2 suivant croirait
 * la salle sûre.
 */
export declare function claimSchemaFloor(doc: Y.Doc): SchemaFloor;
