/**
 * docsExtensions — LA liste d'extensions, partagée éditeur/import.
 *
 * generateJSON(html, extensions) de l'import docx DOIT utiliser exactement
 * cette liste : une extension absente et les `<table>`/`<img>` produits par
 * mammoth sont silencieusement jetés au parsing — perte muette, le contraire
 * du contrat « pertes annoncées ».
 *
 * TABLES : TableKit SEUL (il enregistre Table+Row+Cell+Header) — ajouter en
 * plus un nœud table individuel enregistrerait deux fois le même nœud dans le
 * schéma ; une seule source, ici.
 */
import StarterKit from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { FdocImage } from './fdocImage';
import { makeIsAllowedUri } from './docsLinks';
/**
 * QUI ÉCRIT — lu dans l'awareness, jamais dans le contrat.
 *
 * `EditorHost` ne porte AUCUNE identité : c'est délibéré, un plugin n'a pas à
 * connaître le compte de l'utilisateur. Mais l'hôte publie déjà `user:{name,
 * color}` dans l'awareness pour sa propre barre de présence — la même donnée,
 * au même endroit, pour tous les pairs. On la relit, on ne l'invente pas.
 *
 * Repli sur un nom neutre plutôt que rien : un curseur anonyme reste plus utile
 * qu'un curseur absent, et `CollaborationCaret` exige les deux champs.
 */
/**
 * `CollaborationCaret` en demande PLUS que notre contrat n'en promet.
 *
 * Il lit `awareness.states` (la Map brute), `getLocalState()` et
 * `setLocalState()`, alors que `AwarenessLike` ne décrit que `getStates()` et
 * `setLocalStateField()`. En production l'hôte passe une vraie `Awareness` de
 * y-protocols, qui a les deux ; mais un hôte plus étroit (test, portage,
 * version antérieure) ferait ÉCHOUER LE MONTAGE ENTIER pour une fonction
 * purement visuelle. On vérifie donc la forme, et on se passe des curseurs
 * plutôt que de perdre l'éditeur : la salle marche, elle est simplement muette
 * sur qui écrit.
 */
function peutPorterLesCarets(awareness) {
    const brut = awareness;
    return (!!awareness &&
        brut.states instanceof Map &&
        typeof brut.getLocalState === 'function' &&
        typeof brut.setLocalState === 'function');
}
function identiteLocale(awareness) {
    const etat = awareness.getStates().get(awareness.clientID);
    const brut = etat?.user;
    return {
        name: typeof brut?.name === 'string' && brut.name ? brut.name : '—',
        color: typeof brut?.color === 'string' && brut.color ? brut.color : '#888888',
    };
}
export function buildDocsExtensions(opts = {}) {
    return [
        StarterKit.configure({
            heading: { levels: [1, 2, 3] },
            // LIEN COUPÉ ICI, reconfiguré plus bas. Le laisser à StarterKit
            // enregistrerait DEUX extensions nommées « link » : celle du kit gagne
            // (elle s'enregistre en premier) et garde ses défauts — openOnClick:true,
            // target _blank sans noopener, mailto/ftp/tel permis. La configuration
            // sûre serait posée sur un fantôme.
            link: false,
            // En salle, l'HISTOIRE vit dans le CRDT : le undo/redo local détruirait
            // la frappe des autres (même règle que collabExtensions.ts du cœur).
            // Le yUndoPlugin de Collaboration prend le relais — annulation PAR
            // UTILISATEUR, et les boutons restent donc visibles et utiles.
            ...(opts.collabDoc ? { undoRedo: false } : {}),
        }),
        Link.configure({
            // L'ouverture est un GESTE, dans la bulle — jamais un effet de bord du
            // clic (voir docsLinks.ts pour les trois canons refermés).
            openOnClick: false,
            /**
             * AUTOLINK COUPÉ EN SALLE. Son appendTransaction s'exécute bien sur les
             * transactions y-sync, mais sa remontée vers Yjs est muselée par le mutex
             * de y-prosemirror : l'état ProseMirror gagne une marque que le Y.Doc
             * n'a pas. Or c'est getJSON() qui part à la sauvegarde — le fichier
             * enregistré divergerait de ce que voient les autres pairs.
             */
            autolink: !opts.collabDoc,
            isAllowedUri: makeIsAllowedUri(),
        }),
        TableKit.configure({ table: { resizable: false } }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        /**
         * LE DELTA v3, EN ENTIER. Liens, code en ligne, blocs de code et
         * séparateurs étaient DÉJÀ là (StarterKit) : il ne restait que ces
         * quatre-là.
         *
         * TaskList/TaskItem viennent de '@tiptap/extension-list' — les paquets
         * @tiptap/extension-task-list et -task-item ne sont que des ré-exports de
         * ce module, et en installer un de plus multiplierait les chemins de
         * résolution vers @tiptap/core sans rien apporter.
         */
        TaskList,
        TaskItem.configure({ nested: true }),
        Subscript,
        Superscript,
        /**
         * Placeholder, CharacterCount et UndoRedo viennent de '@tiptap/extensions'
         * — déjà présent des DEUX côtés par transitivité. Les paquets
         * @tiptap/extension-placeholder et compagnie n'en sont que des ré-exports :
         * les installer ajouterait des chemins de résolution vers @tiptap/core
         * sans ajouter une ligne de code.
         */
        Placeholder.configure({ placeholder: opts.placeholder ?? '' }),
        // Le compteur de mots est une STORAGE tiptap, pas un parcours maison du
        // document à chaque frappe.
        CharacterCount,
        FdocImage,
        ...(opts.collabDoc
            ? [
                Collaboration.configure({ document: opts.collabDoc, field: 'content' }),
                // Les curseurs et sélections des autres. Sans lui, la salle
                // fonctionne mais reste INVISIBLE : on écrit à plusieurs sans jamais
                // voir où sont les autres, et l'en-tête de DocsEditor affirmait
                // pourtant le contraire. `CollaborationCaret` n'attend d'un
                // « provider » que son `.awareness` — le contrat nous la donne
                // directement, on l'emballe.
                ...(peutPorterLesCarets(opts.awareness)
                    ? [
                        CollaborationCaret.configure({
                            provider: { awareness: opts.awareness },
                            user: identiteLocale(opts.awareness),
                        }),
                    ]
                    : []),
            ]
            : []),
    ];
}
