/**
 * Le format `.fdoc` — le document natif de Filarr Docs.
 *
 * POURQUOI UN FORMAT À NOUS, plutôt que docx partout. Le docx est un format
 * d'ÉCHANGE : soixante pages de spécification OOXML dont un éditeur maison ne
 * portera jamais qu'un sous-ensemble — prétendre « éditer du docx » en perdant
 * silencieusement les révisions, les sections et les styles inconnus à chaque
 * enregistrement serait une corruption polie. Le `.fdoc` assume l'inverse :
 * c'est le document ProseMirror sérialisé, il porte EXACTEMENT ce que
 * l'éditeur sait faire, rien ne se perd entre deux sessions, et le CRDT
 * (Y.XmlFragment) s'y projette sans conversion. Le docx reste aux frontières :
 * on l'IMPORTE (mammoth, une fois, avec pertes annoncées) et on l'EXPORTE
 * (docx, à la demande) — jamais il ne sert de format de travail.
 *
 * L'enveloppe est versionnée : un `.fdoc` v1 restera lisible par tout éditeur
 * futur, et un éditeur v1 REFUSE un `.fdoc` d'une version qu'il ne connaît pas
 * plutôt que d'en détruire ce qu'il ne comprend pas.
 *
 * v3 — LE SUPERSET COURANT. v1 (texte, titres, listes, citation) ⊂ v2 (tables,
 * images data-URL, alignement, couleur, surlignage) ⊂ v3 (listes de tâches,
 * exposant, indice — liens et code étaient DÉJÀ dans le schéma v2, apportés
 * par StarterKit). Un contenu v1 ou v2 reste donc valide tel quel : la
 * lecture accepte {1, 2, 3}, l'écriture produit TOUJOURS 3.
 *
 * QU'UN CŒUR ANCIEN REFUSE UN v3 EST LE COMPORTEMENT VOULU. Le contrat est
 * « refuser, jamais dégrader » : un éditeur v2 qui ouvrirait un v3 en
 * jetterait les tâches et les exposants au parsing, puis les réécrirait
 * absents à la première sauvegarde. Une modale « mettez à jour » vaut
 * infiniment mieux qu'une perte polie. L'hôte reconnaît d'ailleurs le message
 * de cette erreur et l'affiche comme telle (PluginEditorModal).
 */
/** La version ÉCRITE. Lire la liste complète : `FDOC_VERSIONS_LUES`. */
export const FDOC_VERSION = 3;
/** Les versions que ce plugin sait lire — tout le reste est refusé. */
export const FDOC_VERSIONS_LUES = [1, 2, 3];
const decoder = new TextDecoder();
const encoder = new TextEncoder();
export class FdocFormatError extends Error {
}
export function parseFdoc(bytes) {
    let parsed;
    try {
        parsed = JSON.parse(decoder.decode(bytes));
    }
    catch {
        throw new FdocFormatError('Not a JSON document');
    }
    const env = parsed;
    if (env?.format !== 'fdoc')
        throw new FdocFormatError('Not an fdoc envelope');
    if (!FDOC_VERSIONS_LUES.includes(env.version)) {
        // Refuser, jamais dégrader : réécrire un document d'une version inconnue
        // en détruirait tout ce que cette version sait et pas nous.
        throw new FdocFormatError(`Unsupported fdoc version: ${String(env.version)}`);
    }
    if (typeof env.content !== 'object' || env.content === null) {
        throw new FdocFormatError('Missing content');
    }
    return env;
}
export function serializeFdoc(content) {
    // L'écriture produit TOUJOURS la version courante : le plugin est builtin,
    // il est livré AVEC le cœur, tous les clients avancent ensemble. Écrire une
    // version antérieure « au cas où » fabriquerait des fichiers qui mentent sur
    // ce qu'ils contiennent.
    const envelope = { format: 'fdoc', version: FDOC_VERSION, content };
    return encoder.encode(JSON.stringify(envelope));
}
/** Un document vide, pour la création d'un nouveau `.fdoc`. */
export function emptyFdoc() {
    return { format: 'fdoc', version: FDOC_VERSION, content: { type: 'doc', content: [] } };
}
