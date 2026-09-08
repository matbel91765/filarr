/**
 * i18n.ts — le dictionnaire embarqué du plugin, fr/en.
 *
 * POURQUOI DANS LE PLUGIN. L'hôte a son propre i18next et ses locales JSON,
 * mais un plugin vit dans SON dépôt et se construit seul : lui faire réclamer
 * une clé du cœur à chaque libellé, c'est deux dépôts qui doivent bouger
 * ensemble à chaque bouton. Le contrat `EditorHost` ne passe d'ailleurs
 * AUCUNE fonction de traduction — c'est délibéré, et c'est ici la conséquence.
 * Deux langues en dur, quelques kilo-octets, aucun aller-retour.
 *
 * La parité fr/en est garantie par le TYPE : `MESSAGES_EN` est déclaré
 * `Record<MessageKey, string>`, donc une clé ajoutée d'un seul côté ne compile
 * pas. Même contrat que `scripts/i18n-parity.cjs` du cœur, obtenu ici par le
 * compilateur plutôt que par un script — c'est le motif de
 * filarr-plugin-kanban, repris tel quel.
 *
 * LES GLYPHES SONT DES MESSAGES. « G » pour gras est un glyphe français : en
 * anglais c'est « B ». Chaque bouton porte donc DEUX clés — `.label` (ce qui
 * s'affiche, souvent une lettre ou un pictogramme) et `.title` (la phrase qui
 * part en `title=` ET en `aria-label`, car un lecteur d'écran ne fait rien de
 * « ABC »).
 */
const MESSAGES_FR = {
    // ── La barre d'outils ──────────────────────────────────────────────────────
    'toolbar.label': 'Mise en forme du document',
    'toolbar.bold.label': 'G',
    'toolbar.bold.title': 'Gras (Ctrl+B)',
    'toolbar.italic.label': 'I',
    'toolbar.italic.title': 'Italique (Ctrl+I)',
    'toolbar.underline.label': 'S',
    'toolbar.underline.title': 'Souligné (Ctrl+U)',
    'toolbar.strike.label': 'ABC',
    'toolbar.strike.title': 'Barré',
    'toolbar.code.label': '</>',
    'toolbar.code.title': 'Code en ligne',
    'toolbar.superscript.label': 'X²',
    'toolbar.superscript.title': 'Exposant',
    'toolbar.subscript.label': 'X₂',
    'toolbar.subscript.title': 'Indice',
    'toolbar.h1.label': 'T1',
    'toolbar.h1.title': 'Titre de niveau 1',
    'toolbar.h2.label': 'T2',
    'toolbar.h2.title': 'Titre de niveau 2',
    'toolbar.h3.label': 'T3',
    'toolbar.h3.title': 'Titre de niveau 3',
    'toolbar.bulletList.label': '• liste',
    'toolbar.bulletList.title': 'Liste à puces',
    'toolbar.orderedList.label': '1. liste',
    'toolbar.orderedList.title': 'Liste numérotée',
    'toolbar.taskList.label': '☑ tâches',
    'toolbar.taskList.title': 'Liste de tâches',
    'toolbar.blockquote.label': '❝',
    'toolbar.blockquote.title': 'Citation',
    'toolbar.codeBlock.label': '{ }',
    'toolbar.codeBlock.title': 'Bloc de code',
    'toolbar.horizontalRule.label': '―',
    'toolbar.horizontalRule.title': 'Séparateur horizontal',
    'toolbar.alignLeft.label': '⬅',
    'toolbar.alignLeft.title': 'Aligner à gauche',
    'toolbar.alignCenter.label': '⬌',
    'toolbar.alignCenter.title': 'Centrer',
    'toolbar.alignRight.label': '➡',
    'toolbar.alignRight.title': 'Aligner à droite',
    'toolbar.alignJustify.label': '⬍',
    'toolbar.alignJustify.title': 'Justifier',
    'toolbar.color.label': 'A▾',
    'toolbar.color.title': 'Couleur du texte',
    'toolbar.colorClear.label': 'A×',
    'toolbar.colorClear.title': 'Retirer la couleur du texte',
    'toolbar.link.label': '\u{1f517}',
    'toolbar.link.title': 'Insérer ou modifier un lien (Ctrl+K)',
    'toolbar.table.label': 'Tableau',
    'toolbar.table.title': 'Insérer un tableau 3 × 3',
    'toolbar.rowAfter.label': '+lig',
    'toolbar.rowAfter.title': 'Ajouter une ligne',
    'toolbar.rowDelete.label': '−lig',
    'toolbar.rowDelete.title': 'Supprimer la ligne',
    'toolbar.colAfter.label': '+col',
    'toolbar.colAfter.title': 'Ajouter une colonne',
    'toolbar.colDelete.label': '−col',
    'toolbar.colDelete.title': 'Supprimer la colonne',
    'toolbar.tableDelete.label': 'Suppr. tableau',
    'toolbar.tableDelete.title': 'Supprimer le tableau',
    'toolbar.image.label': 'Image',
    'toolbar.image.title': 'Insérer une image',
    'toolbar.exportDocx.label': 'Exporter .docx',
    'toolbar.exportDocx.title': 'Exporter une copie au format .docx',
    'toolbar.undo.label': '↶',
    'toolbar.undo.title': 'Annuler (Ctrl+Z)',
    'toolbar.redo.label': '↷',
    'toolbar.redo.title': 'Rétablir (Ctrl+Maj+Z)',
    'toolbar.find.label': '\u{1f50d}',
    'toolbar.find.title': 'Rechercher et remplacer (Ctrl+F)',
    'toolbar.outline.label': '☰ Plan',
    'toolbar.outline.title': 'Afficher ou masquer le plan du document',
    'toolbar.highlight.title': 'Surligner en {color}',
    'toolbar.highlightClear.label': '×',
    'toolbar.highlightClear.title': 'Retirer le surlignage',
    'toolbar.disabledMixedVersions': 'Indisponible : un participant utilise une version antérieure du plugin.',
    // ── La bulle de lien ───────────────────────────────────────────────────────
    'link.bubble': 'Actions du lien',
    'link.open': 'Ouvrir',
    'link.openTitle': 'Ouvrir le lien dans une nouvelle fenêtre',
    'link.copy': 'Copier',
    'link.copyTitle': 'Copier l’adresse du lien',
    'link.copied': 'Adresse copiée.',
    'link.edit': 'Modifier',
    'link.editTitle': 'Modifier l’adresse du lien',
    'link.remove': 'Retirer',
    'link.removeTitle': 'Retirer le lien (le texte reste)',
    'link.close': 'Fermer',
    'link.promptLabel': 'Adresse du lien',
    'link.promptPlaceholder': 'https://exemple.org/page',
    'link.apply': 'Valider',
    'link.cancel': 'Annuler',
    'link.invalid': 'Adresse refusée : seuls les liens http:// et https:// sont acceptés.',
    // ── Recherche et remplacement ──────────────────────────────────────────────
    'search.panel': 'Rechercher et remplacer',
    'search.placeholder': 'Rechercher…',
    'search.replacePlaceholder': 'Remplacer par…',
    'search.count': '{current} sur {total}',
    'search.none': 'Aucun résultat',
    'search.next': 'Occurrence suivante (Entrée)',
    'search.previous': 'Occurrence précédente (Maj+Entrée)',
    'search.replace': 'Remplacer',
    'search.replaceAll': 'Tout remplacer',
    'search.matchCase': 'Aa',
    'search.matchCaseTitle': 'Respecter la casse',
    'search.close': 'Fermer la recherche (Échap)',
    'search.replacedAll': '{count} occurrence(s) remplacée(s).',
    // ── Le plan du document ────────────────────────────────────────────────────
    'outline.title': 'Plan du document',
    'outline.empty': 'Aucun titre pour l’instant.',
    'outline.goTo': 'Aller à « {title} »',
    'outline.untitled': '(titre vide)',
    // ── Le pied : compteur ─────────────────────────────────────────────────────
    'counter.stats': '{words} mot(s) · {characters} caractère(s)',
    'counter.label': 'Statistiques du document',
    // ── Le corps ───────────────────────────────────────────────────────────────
    'editor.placeholder': 'Commencez à écrire… « / » n’est pas nécessaire, la barre du haut suffit.',
    'editor.label': 'Corps du document',
    // ── Les bandeaux ───────────────────────────────────────────────────────────
    'banner.docxSolo': 'Import .docx : édition seule — la co-édition s’ouvrira après le premier enregistrement.',
    'banner.tooLarge': 'Document trop volumineux pour l’édition à plusieurs — édition seule.',
    'banner.newerRoom': 'Cette salle a été ouverte par une version plus récente de Filarr Docs. Vous la consultez hors ligne, en édition seule : mettez à jour pour co-éditer.',
    'banner.mixedVersions': 'Un participant utilise une version antérieure du plugin : les listes de tâches, l’exposant et l’indice restent indisponibles tant qu’il est là.',
    'banner.imageTooLargeForCollab': 'Image refusée : le document dépasserait la limite d’édition à plusieurs.',
    'banner.imageTooLarge': 'Image refusée : document trop volumineux.',
    'banner.imageUnreadable': 'Image illisible ou trop volumineuse.',
    'banner.docxLossy': 'Import .docx : le texte, les titres, les listes, les tableaux, les images et l’alignement des paragraphes ont été repris. La mise en page — polices, couleurs, tailles, marges, sections, en-têtes et pieds de page — n’a pas d’équivalent ici et est perdue, une fois, maintenant.',
    'banner.docxFailed': 'Ce fichier .docx n’a pas pu être lu : il est peut-être abîmé, protégé, ou porte l’extension .docx sans être un document Word. Rien n’a été enregistré.',
    'error.documentNotLoaded': 'Le document n’est pas encore chargé : l’enregistrement est refusé pour ne pas écraser le fichier par un document vide.',
    // ── L'import ───────────────────────────────────────────────────────────────
    'import.imageRemoved': '[image retirée : trop volumineuse]',
};
/** Toutes les clés, pour les gardes de contenu — l'ordre est celui du fr. */
export const MESSAGE_KEYS = Object.keys(MESSAGES_FR);
/** La parité est vérifiée par le compilateur : une clé manquante ne compile pas. */
const MESSAGES_EN = {
    'toolbar.label': 'Document formatting',
    'toolbar.bold.label': 'B',
    'toolbar.bold.title': 'Bold (Ctrl+B)',
    'toolbar.italic.label': 'I',
    'toolbar.italic.title': 'Italic (Ctrl+I)',
    'toolbar.underline.label': 'U',
    'toolbar.underline.title': 'Underline (Ctrl+U)',
    'toolbar.strike.label': 'ABC',
    'toolbar.strike.title': 'Strikethrough',
    'toolbar.code.label': '</>',
    'toolbar.code.title': 'Inline code',
    'toolbar.superscript.label': 'X²',
    'toolbar.superscript.title': 'Superscript',
    'toolbar.subscript.label': 'X₂',
    'toolbar.subscript.title': 'Subscript',
    'toolbar.h1.label': 'H1',
    'toolbar.h1.title': 'Heading level 1',
    'toolbar.h2.label': 'H2',
    'toolbar.h2.title': 'Heading level 2',
    'toolbar.h3.label': 'H3',
    'toolbar.h3.title': 'Heading level 3',
    'toolbar.bulletList.label': '• list',
    'toolbar.bulletList.title': 'Bullet list',
    'toolbar.orderedList.label': '1. list',
    'toolbar.orderedList.title': 'Numbered list',
    'toolbar.taskList.label': '☑ tasks',
    'toolbar.taskList.title': 'Task list',
    'toolbar.blockquote.label': '❝',
    'toolbar.blockquote.title': 'Quote',
    'toolbar.codeBlock.label': '{ }',
    'toolbar.codeBlock.title': 'Code block',
    'toolbar.horizontalRule.label': '―',
    'toolbar.horizontalRule.title': 'Horizontal rule',
    'toolbar.alignLeft.label': '⬅',
    'toolbar.alignLeft.title': 'Align left',
    'toolbar.alignCenter.label': '⬌',
    'toolbar.alignCenter.title': 'Center',
    'toolbar.alignRight.label': '➡',
    'toolbar.alignRight.title': 'Align right',
    'toolbar.alignJustify.label': '⬍',
    'toolbar.alignJustify.title': 'Justify',
    'toolbar.color.label': 'A▾',
    'toolbar.color.title': 'Text colour',
    'toolbar.colorClear.label': 'A×',
    'toolbar.colorClear.title': 'Remove text colour',
    'toolbar.link.label': '\u{1f517}',
    'toolbar.link.title': 'Insert or edit a link (Ctrl+K)',
    'toolbar.table.label': 'Table',
    'toolbar.table.title': 'Insert a 3 × 3 table',
    'toolbar.rowAfter.label': '+row',
    'toolbar.rowAfter.title': 'Add a row',
    'toolbar.rowDelete.label': '−row',
    'toolbar.rowDelete.title': 'Delete the row',
    'toolbar.colAfter.label': '+col',
    'toolbar.colAfter.title': 'Add a column',
    'toolbar.colDelete.label': '−col',
    'toolbar.colDelete.title': 'Delete the column',
    'toolbar.tableDelete.label': 'Delete table',
    'toolbar.tableDelete.title': 'Delete the table',
    'toolbar.image.label': 'Image',
    'toolbar.image.title': 'Insert an image',
    'toolbar.exportDocx.label': 'Export .docx',
    'toolbar.exportDocx.title': 'Export a copy as .docx',
    'toolbar.undo.label': '↶',
    'toolbar.undo.title': 'Undo (Ctrl+Z)',
    'toolbar.redo.label': '↷',
    'toolbar.redo.title': 'Redo (Ctrl+Shift+Z)',
    'toolbar.find.label': '\u{1f50d}',
    'toolbar.find.title': 'Find and replace (Ctrl+F)',
    'toolbar.outline.label': '☰ Outline',
    'toolbar.outline.title': 'Show or hide the document outline',
    'toolbar.highlight.title': 'Highlight in {color}',
    'toolbar.highlightClear.label': '×',
    'toolbar.highlightClear.title': 'Remove highlight',
    'toolbar.disabledMixedVersions': 'Unavailable: a participant is using an older version of the plugin.',
    'link.bubble': 'Link actions',
    'link.open': 'Open',
    'link.openTitle': 'Open the link in a new window',
    'link.copy': 'Copy',
    'link.copyTitle': 'Copy the link address',
    'link.copied': 'Address copied.',
    'link.edit': 'Edit',
    'link.editTitle': 'Edit the link address',
    'link.remove': 'Remove',
    'link.removeTitle': 'Remove the link (the text stays)',
    'link.close': 'Close',
    'link.promptLabel': 'Link address',
    'link.promptPlaceholder': 'https://example.org/page',
    'link.apply': 'Apply',
    'link.cancel': 'Cancel',
    'link.invalid': 'Address rejected: only http:// and https:// links are accepted.',
    'search.panel': 'Find and replace',
    'search.placeholder': 'Find…',
    'search.replacePlaceholder': 'Replace with…',
    'search.count': '{current} of {total}',
    'search.none': 'No results',
    'search.next': 'Next match (Enter)',
    'search.previous': 'Previous match (Shift+Enter)',
    'search.replace': 'Replace',
    'search.replaceAll': 'Replace all',
    'search.matchCase': 'Aa',
    'search.matchCaseTitle': 'Match case',
    'search.close': 'Close find (Esc)',
    'search.replacedAll': '{count} occurrence(s) replaced.',
    'outline.title': 'Document outline',
    'outline.empty': 'No heading yet.',
    'outline.goTo': 'Go to “{title}”',
    'outline.untitled': '(empty heading)',
    'counter.stats': '{words} word(s) · {characters} character(s)',
    'counter.label': 'Document statistics',
    'editor.placeholder': 'Start writing… no “/” needed, the bar above is enough.',
    'editor.label': 'Document body',
    'banner.docxSolo': '.docx import: solo editing — co-editing opens after the first save.',
    'banner.tooLarge': 'Document too large for multi-user editing — editing alone.',
    'banner.newerRoom': 'This room was opened by a newer version of Filarr Docs. You are viewing it offline, solo: update to co-edit.',
    'banner.mixedVersions': 'A participant is using an older version of the plugin: task lists, superscript and subscript stay unavailable while they are here.',
    'banner.imageTooLargeForCollab': 'Image rejected: the document would exceed the multi-user editing limit.',
    'banner.imageTooLarge': 'Image rejected: document too large.',
    'banner.imageUnreadable': 'Image unreadable or too large.',
    'banner.docxLossy': '.docx import: text, headings, lists, tables, images and paragraph alignment were carried over. Layout — fonts, colours, sizes, margins, sections, headers and footers — has no equivalent here and is lost, once, now.',
    'banner.docxFailed': 'This .docx file could not be read: it may be damaged, protected, or carry the .docx extension without being a Word document. Nothing was saved.',
    'error.documentNotLoaded': 'The document is not loaded yet: saving is refused so the file is not overwritten with an empty document.',
    'import.imageRemoved': '[image removed: too large]',
};
const DICTIONARIES = {
    fr: MESSAGES_FR,
    en: MESSAGES_EN,
};
function interpolate(template, vars) {
    if (vars === undefined)
        return template;
    return template.replace(/\{(\w+)\}/g, (whole, name) => Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}
export function createI18n(lang) {
    const dict = DICTIONARIES[lang];
    return {
        lang,
        t(key, vars) {
            return interpolate(dict[key], vars);
        },
    };
}
/**
 * La langue d'après les préférences du navigateur. Défensif par nécessité :
 * `navigator` n'existe pas sous vitest en environnement node, et un plugin qui
 * jette au montage devient une modale d'erreur pour l'utilisateur.
 */
export function detectLang(preferred) {
    const tags = preferred ??
        (typeof navigator === 'undefined'
            ? []
            : navigator.languages && navigator.languages.length > 0
                ? navigator.languages
                : [navigator.language]);
    for (const tag of tags) {
        if (typeof tag === 'string' && tag.toLowerCase().startsWith('fr'))
            return 'fr';
    }
    return 'en';
}
