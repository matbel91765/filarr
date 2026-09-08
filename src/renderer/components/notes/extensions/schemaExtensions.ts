/**
 * Source unique des extensions TipTap qui CONTRIBUENT AU SCHÉMA du document :
 * nœuds, marques, et attributs globaux.
 *
 * POURQUOI ce module existe — une perte de données silencieuse.
 * ProseMirror n'est pas tolérant : un attribut absent du schéma n'est pas
 * « ignoré », il est SUPPRIMÉ au premier aller-retour parse → sérialisation.
 * Tant que la liste de NoteEditor et celle de l'éditeur de coffre partagé
 * étaient recopiées à la main, la moindre divergence effaçait du contenu :
 * `BlockIdExtension`, `FontSizeExtension` et `BlockSpacingExtension`
 * manquaient côté coffre, si bien qu'ouvrir puis éditer une note partagée
 * effaçait les ancres de bloc (celles que visent les transclusions
 * `![[Note^abc123]]`), la taille de police et l'espacement — et en session
 * collaborative l'effacement se propageait aux autres membres via le CRDT.
 *
 * LA LIGNE DE COUPE. Ce module ne contient QUE ce qui définit le schéma.
 * Tout ce qui est interaction pure (placeholder traduit, suggestions et leurs
 * popups React, poignée de glisser, décorations) reste chez l'appelant : ces
 * extensions portent des fermetures non transposables (t(), le store, des
 * refs de rendu) et n'ont aucun effet sur ce qui est ÉCRIT dans le document.
 *
 * L'ORDRE compte (priorités TipTap, ordre des greffons ProseMirror, règles de
 * saisie). Les `slots` permettent à chaque appelant de réinsérer SES extensions
 * d'interaction exactement là où elles étaient avant l'extraction, plutôt que
 * de les repousser toutes en fin de liste et de changer silencieusement l'ordre
 * des gestionnaires de clavier et de collage.
 */

import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { StarterKitOptions } from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { common, createLowlight } from 'lowlight';

import { EnhancedCodeBlockExtension } from './codeBlockExtension';
import { FileEmbedExtension } from './fileEmbedExtension';
import { TransclusionExtension } from './transclusionExtension';
import { BlockIdExtension } from './blockIdExtension';
import { CalloutExtension } from './calloutExtension';
import { BookmarkExtension } from './bookmarkExtension';
import { CalendarBlockExtension } from './calendarBlockExtension';
import { InlineDatabaseExtension } from './inlineDatabaseExtension';
import { ToggleExtension, ToggleSummaryExtension } from './toggleExtension';
import { MathBlockExtension, MathInlineExtension } from './mathExtension';
import { ColumnsExtension, ColumnExtension } from './columnsExtension';
import { TocExtension } from './tocExtension';
import { MermaidExtension } from './mermaidExtension';
import { DateExtension } from './dateExtension';
import { MentionExtension } from './mentionExtension';
import { EmbedExtension } from './embedExtension';
import { CommentExtension } from './commentExtension';
import { FootnoteExtension } from './footnotesExtension';
import { DataviewExtension } from './dataviewExtension';
import { SubPageExtension } from './subPageExtension';
import { FontSizeExtension } from './fontSizeExtension';
import { BlockSpacingExtension } from './blockSpacingExtension';
import { BlockSizeExtension } from './blockSizeExtension';

const lowlight = createLowlight(common);

/**
 * Points d'insertion pour les extensions d'interaction de l'appelant.
 *
 * Chaque nom dit APRÈS quelle extension de schéma le contenu est inséré : c'est
 * la position qu'occupaient ces extensions dans NoteEditor avant l'extraction,
 * et la reproduire à l'identique est ce qui rend ce remaniement neutre.
 */
export interface NoteSchemaSlots {
  /** Juste après StarterKit : montage Yjs, placeholder traduit. */
  afterStarterKit?: AnyExtension[];
  /** Après le bloc de code lowlight : poignée de glisser. */
  afterCodeBlock?: AnyExtension[];
  /** Après l'ancre de bloc : décorations de liens wiki / liens potentiels. */
  afterBlockId?: AnyExtension[];
  /** Après la marque de commentaire : repli des titres. */
  afterComment?: AnyExtension[];
  /** Après les notes de bas de page : émojis, titres de liens automatiques. */
  afterFootnote?: AnyExtension[];
  /** En toute fin de liste : menu slash. */
  trailing?: AnyExtension[];
}

export interface NoteSchemaExtensionOptions {
  /**
   * Options fusionnées par-dessus les réglages de StarterKit ci-dessous.
   *
   * La divergence légitime, ici, c'est `undoRedo: false` : dès qu'Yjs est monté
   * le CRDT apporte son propre historique (yUndoPlugin, porté par l'extension
   * Collaboration), et laisser celui de ProseMirror actif ferait annuler par
   * Ctrl+Z les frappes des AUTRES appareils.
   */
  starterKit?: Partial<StarterKitOptions>;
  /**
   * Poignées de redimensionnement des colonnes de tableau. Vrai dans l'éditeur
   * de notes, faux dans les surfaces de lecture — ça ne change pas le schéma
   * (`colwidth` existe dans les deux cas), seulement l'interaction.
   */
  tableResizable?: boolean;
  /**
   * Résolution titre → note pour la règle de saisie `![[Titre]]`. Purement
   * comportemental : sans résolveur la règle n'insère rien, mais le nœud
   * `transclusion` existe dans le schéma de la même façon.
   */
  resolveTransclusionByTitle?: (title: string) => { id: string; title: string } | undefined;
  /** Extensions d'interaction de l'appelant, réinsérées à leur place d'origine. */
  slots?: NoteSchemaSlots;
}

/**
 * Construit la liste des extensions de schéma. Appelée à neuf par montage
 * d'éditeur : une instance d'extension ne se partage pas entre deux éditeurs.
 */
export function buildNoteSchemaExtensions(
  options: NoteSchemaExtensionOptions = {}
): AnyExtension[] {
  const slots = options.slots ?? {};
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      // Le bloc de code du StarterKit est remplacé par la version lowlight
      // (coloration syntaxique) plus bas ; les deux ne peuvent pas coexister,
      // ils portent le même nom de nœud.
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      // Le lien est enregistré à part pour lui donner sa classe et couper
      // l'ouverture au clic.
      link: false,
      ...options.starterKit,
    }),
    ...(slots.afterStarterKit ?? []),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'note-link' },
    }),
    Highlight.configure({ multicolor: true }),
    // Underline volontairement absent : StarterKit 3 l'inclut déjà —
    // l'enregistrer en plus émet « Duplicate extension names » au montage.
    TextStyle,
    Color,
    Typography,
    Table.configure({ resizable: options.tableResizable ?? false }),
    TableRow,
    TableCell,
    TableHeader,
    EnhancedCodeBlockExtension.configure({ lowlight }),
    ...(slots.afterCodeBlock ?? []),
    FileEmbedExtension,
    TransclusionExtension.configure(
      options.resolveTransclusionByTitle
        ? { resolveByTitle: options.resolveTransclusionByTitle }
        : {}
    ),
    // Attribut global `blockId` sur paragraph/heading : la cible des
    // transclusions de bloc. Absent = ancres effacées à la première édition.
    BlockIdExtension,
    ...(slots.afterBlockId ?? []),
    CalloutExtension,
    BookmarkExtension,
    CalendarBlockExtension,
    InlineDatabaseExtension,
    ToggleExtension,
    ToggleSummaryExtension,
    MathBlockExtension,
    MathInlineExtension,
    ColumnsExtension,
    ColumnExtension,
    TocExtension,
    MermaidExtension,
    DateExtension,
    MentionExtension,
    EmbedExtension,
    CommentExtension,
    ...(slots.afterComment ?? []),
    FootnoteExtension,
    ...(slots.afterFootnote ?? []),
    DataviewExtension,
    SubPageExtension,
    // Attributs globaux `fontSize`/`fontFamily` (marque textStyle) et
    // `lineSpacing` (blocs) : même histoire que blockId, ils disparaissent du
    // document dès qu'une surface d'édition les ignore.
    FontSizeExtension,
    BlockSpacingExtension,
    // Attribut global `blockWidthPx` : la largeur, en pixels, des blocs qu'on
    // redimensionne à la poignée (base inline, schéma, calendrier…). Même
    // raison d'être ici que les trois du dessus — une surface qui l'ignore
    // l'EFFACE, et un lecteur de coffre partagé reverrait tous les blocs à la
    // largeur d'office.
    BlockSizeExtension,
    ...(slots.trailing ?? []),
  ];
  return extensions;
}
