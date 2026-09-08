/**
 * @filarr/plugin-docs — l’éditeur de documents de Filarr.
 *
 * Le bundle exporte UN objet : le `FilarrPlugin`. Une build du cœur qui
 * l'embarque l'ajoute à sa liste blanche (`registerBuiltinPlugins`) — voir le
 * README pour le circuit de build. Le régime `builtin` est assumé : ce code
 * touche des octets déchiffrés et se fait relire comme du code du cœur.
 */
import { mountDocsEditor } from './DocsEditor';
import { emptyFdoc } from './fdoc';
/**
 * Ce que « Nouveau document » crée pour ce greffon.
 *
 * La graine n'est PAS facultative ici : un `.fdoc` de zéro octet n'est pas
 * un document vide, c'est un fichier que `parseFdoc` refuse. Le menu du
 * cœur a un temps été dérivé des extensions OUVRABLES, et créait alors des
 * fichiers vides — indiscernables, pour qui les rouvre, de fichiers vidés.
 */
const NOUVEAU_DOCUMENT = [
    {
        ext: 'fdoc',
        label: 'Document',
        seed: () => new TextEncoder().encode(JSON.stringify(emptyFdoc())),
    },
];
export const docsPlugin = {
    manifest: {
        id: 'docs',
        name: 'Filarr Docs',
        version: '0.3.0',
        trust: 'builtin',
        provides: {
            editors: [
                {
                    id: 'rich-doc',
                    extensions: ['fdoc'],
                    imports: ['docx'],
                    displayName: 'Éditer le document',
                    newDocument: NOUVEAU_DOCUMENT,
                },
            ],
        },
    },
    editors: [
        {
            contribution: {
                id: 'rich-doc',
                extensions: ['fdoc'],
                imports: ['docx'],
                displayName: 'Éditer le document',
                newDocument: NOUVEAU_DOCUMENT,
            },
            mount: mountDocsEditor,
        },
    ],
};
export default docsPlugin;
