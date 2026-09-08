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
export type Lang = 'fr' | 'en';
declare const MESSAGES_FR: {
    readonly 'toolbar.label': "Mise en forme du document";
    readonly 'toolbar.bold.label': "G";
    readonly 'toolbar.bold.title': "Gras (Ctrl+B)";
    readonly 'toolbar.italic.label': "I";
    readonly 'toolbar.italic.title': "Italique (Ctrl+I)";
    readonly 'toolbar.underline.label': "S";
    readonly 'toolbar.underline.title': "Souligné (Ctrl+U)";
    readonly 'toolbar.strike.label': "ABC";
    readonly 'toolbar.strike.title': "Barré";
    readonly 'toolbar.code.label': "</>";
    readonly 'toolbar.code.title': "Code en ligne";
    readonly 'toolbar.superscript.label': "X²";
    readonly 'toolbar.superscript.title': "Exposant";
    readonly 'toolbar.subscript.label': "X₂";
    readonly 'toolbar.subscript.title': "Indice";
    readonly 'toolbar.h1.label': "T1";
    readonly 'toolbar.h1.title': "Titre de niveau 1";
    readonly 'toolbar.h2.label': "T2";
    readonly 'toolbar.h2.title': "Titre de niveau 2";
    readonly 'toolbar.h3.label': "T3";
    readonly 'toolbar.h3.title': "Titre de niveau 3";
    readonly 'toolbar.bulletList.label': "• liste";
    readonly 'toolbar.bulletList.title': "Liste à puces";
    readonly 'toolbar.orderedList.label': "1. liste";
    readonly 'toolbar.orderedList.title': "Liste numérotée";
    readonly 'toolbar.taskList.label': "☑ tâches";
    readonly 'toolbar.taskList.title': "Liste de tâches";
    readonly 'toolbar.blockquote.label': "❝";
    readonly 'toolbar.blockquote.title': "Citation";
    readonly 'toolbar.codeBlock.label': "{ }";
    readonly 'toolbar.codeBlock.title': "Bloc de code";
    readonly 'toolbar.horizontalRule.label': "―";
    readonly 'toolbar.horizontalRule.title': "Séparateur horizontal";
    readonly 'toolbar.alignLeft.label': "⬅";
    readonly 'toolbar.alignLeft.title': "Aligner à gauche";
    readonly 'toolbar.alignCenter.label': "⬌";
    readonly 'toolbar.alignCenter.title': "Centrer";
    readonly 'toolbar.alignRight.label': "➡";
    readonly 'toolbar.alignRight.title': "Aligner à droite";
    readonly 'toolbar.alignJustify.label': "⬍";
    readonly 'toolbar.alignJustify.title': "Justifier";
    readonly 'toolbar.color.label': "A▾";
    readonly 'toolbar.color.title': "Couleur du texte";
    readonly 'toolbar.colorClear.label': "A×";
    readonly 'toolbar.colorClear.title': "Retirer la couleur du texte";
    readonly 'toolbar.link.label': "🔗";
    readonly 'toolbar.link.title': "Insérer ou modifier un lien (Ctrl+K)";
    readonly 'toolbar.table.label': "Tableau";
    readonly 'toolbar.table.title': "Insérer un tableau 3 × 3";
    readonly 'toolbar.rowAfter.label': "+lig";
    readonly 'toolbar.rowAfter.title': "Ajouter une ligne";
    readonly 'toolbar.rowDelete.label': "−lig";
    readonly 'toolbar.rowDelete.title': "Supprimer la ligne";
    readonly 'toolbar.colAfter.label': "+col";
    readonly 'toolbar.colAfter.title': "Ajouter une colonne";
    readonly 'toolbar.colDelete.label': "−col";
    readonly 'toolbar.colDelete.title': "Supprimer la colonne";
    readonly 'toolbar.tableDelete.label': "Suppr. tableau";
    readonly 'toolbar.tableDelete.title': "Supprimer le tableau";
    readonly 'toolbar.image.label': "Image";
    readonly 'toolbar.image.title': "Insérer une image";
    readonly 'toolbar.exportDocx.label': "Exporter .docx";
    readonly 'toolbar.exportDocx.title': "Exporter une copie au format .docx";
    readonly 'toolbar.undo.label': "↶";
    readonly 'toolbar.undo.title': "Annuler (Ctrl+Z)";
    readonly 'toolbar.redo.label': "↷";
    readonly 'toolbar.redo.title': "Rétablir (Ctrl+Maj+Z)";
    readonly 'toolbar.find.label': "🔍";
    readonly 'toolbar.find.title': "Rechercher et remplacer (Ctrl+F)";
    readonly 'toolbar.outline.label': "☰ Plan";
    readonly 'toolbar.outline.title': "Afficher ou masquer le plan du document";
    readonly 'toolbar.highlight.title': "Surligner en {color}";
    readonly 'toolbar.highlightClear.label': "×";
    readonly 'toolbar.highlightClear.title': "Retirer le surlignage";
    readonly 'toolbar.disabledMixedVersions': "Indisponible : un participant utilise une version antérieure du plugin.";
    readonly 'link.bubble': "Actions du lien";
    readonly 'link.open': "Ouvrir";
    readonly 'link.openTitle': "Ouvrir le lien dans une nouvelle fenêtre";
    readonly 'link.copy': "Copier";
    readonly 'link.copyTitle': "Copier l’adresse du lien";
    readonly 'link.copied': "Adresse copiée.";
    readonly 'link.edit': "Modifier";
    readonly 'link.editTitle': "Modifier l’adresse du lien";
    readonly 'link.remove': "Retirer";
    readonly 'link.removeTitle': "Retirer le lien (le texte reste)";
    readonly 'link.close': "Fermer";
    readonly 'link.promptLabel': "Adresse du lien";
    readonly 'link.promptPlaceholder': "https://exemple.org/page";
    readonly 'link.apply': "Valider";
    readonly 'link.cancel': "Annuler";
    readonly 'link.invalid': "Adresse refusée : seuls les liens http:// et https:// sont acceptés.";
    readonly 'search.panel': "Rechercher et remplacer";
    readonly 'search.placeholder': "Rechercher…";
    readonly 'search.replacePlaceholder': "Remplacer par…";
    readonly 'search.count': "{current} sur {total}";
    readonly 'search.none': "Aucun résultat";
    readonly 'search.next': "Occurrence suivante (Entrée)";
    readonly 'search.previous': "Occurrence précédente (Maj+Entrée)";
    readonly 'search.replace': "Remplacer";
    readonly 'search.replaceAll': "Tout remplacer";
    readonly 'search.matchCase': "Aa";
    readonly 'search.matchCaseTitle': "Respecter la casse";
    readonly 'search.close': "Fermer la recherche (Échap)";
    readonly 'search.replacedAll': "{count} occurrence(s) remplacée(s).";
    readonly 'outline.title': "Plan du document";
    readonly 'outline.empty': "Aucun titre pour l’instant.";
    readonly 'outline.goTo': "Aller à « {title} »";
    readonly 'outline.untitled': "(titre vide)";
    readonly 'counter.stats': "{words} mot(s) · {characters} caractère(s)";
    readonly 'counter.label': "Statistiques du document";
    readonly 'editor.placeholder': "Commencez à écrire… « / » n’est pas nécessaire, la barre du haut suffit.";
    readonly 'editor.label': "Corps du document";
    readonly 'banner.docxSolo': "Import .docx : édition seule — la co-édition s’ouvrira après le premier enregistrement.";
    readonly 'banner.tooLarge': "Document trop volumineux pour l’édition à plusieurs — édition seule.";
    readonly 'banner.newerRoom': "Cette salle a été ouverte par une version plus récente de Filarr Docs. Vous la consultez hors ligne, en édition seule : mettez à jour pour co-éditer.";
    readonly 'banner.mixedVersions': "Un participant utilise une version antérieure du plugin : les listes de tâches, l’exposant et l’indice restent indisponibles tant qu’il est là.";
    readonly 'banner.imageTooLargeForCollab': "Image refusée : le document dépasserait la limite d’édition à plusieurs.";
    readonly 'banner.imageTooLarge': "Image refusée : document trop volumineux.";
    readonly 'banner.imageUnreadable': "Image illisible ou trop volumineuse.";
    readonly 'banner.docxLossy': "Import .docx : le texte, les titres, les listes, les tableaux, les images et l’alignement des paragraphes ont été repris. La mise en page — polices, couleurs, tailles, marges, sections, en-têtes et pieds de page — n’a pas d’équivalent ici et est perdue, une fois, maintenant.";
    readonly 'banner.docxFailed': "Ce fichier .docx n’a pas pu être lu : il est peut-être abîmé, protégé, ou porte l’extension .docx sans être un document Word. Rien n’a été enregistré.";
    readonly 'error.documentNotLoaded': "Le document n’est pas encore chargé : l’enregistrement est refusé pour ne pas écraser le fichier par un document vide.";
    readonly 'import.imageRemoved': "[image retirée : trop volumineuse]";
};
export type MessageKey = keyof typeof MESSAGES_FR;
/** Toutes les clés, pour les gardes de contenu — l'ordre est celui du fr. */
export declare const MESSAGE_KEYS: MessageKey[];
export type TranslateVars = Readonly<Record<string, string | number>>;
export interface I18n {
    readonly lang: Lang;
    t(key: MessageKey, vars?: TranslateVars): string;
}
export declare function createI18n(lang: Lang): I18n;
/**
 * La langue d'après les préférences du navigateur. Défensif par nécessité :
 * `navigator` n'existe pas sous vitest en environnement node, et un plugin qui
 * jette au montage devient une modale d'erreur pour l'utilisateur.
 */
export declare function detectLang(preferred?: readonly string[]): Lang;
export {};
