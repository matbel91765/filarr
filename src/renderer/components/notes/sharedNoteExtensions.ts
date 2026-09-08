/**
 * Jeu d'extensions des surfaces de note AUTRES que NoteEditor : le rendu d'une
 * version archivée (VersionRender), le README de dossier (FolderReadme) et
 * l'éditeur de coffre partagé (VaultNoteEditor) — ce dernier étant bel et bien
 * ÉDITABLE et collaboratif.
 *
 * LE NOM A CHANGÉ (2026-08-26). Le fichier s'appelait `readOnlyExtensions.ts`
 * et vivait dans `versioning/` : deux mensonges, puisque son plus gros
 * consommateur est l'éditeur de coffre partagé, ÉDITABLE et collaboratif, qui
 * n'a rien à voir avec l'historique des versions. Ce n'est pas un détail de
 * baptême — c'est ce nom qui a laissé croire qu'on pouvait y recopier « à peu
 * près » le schéma de NoteEditor, et qui a coûté les attributs effacés
 * décrits plus bas.
 *
 * Le schéma n'est plus recopié à la main ici. Il vient de
 * `buildNoteSchemaExtensions`, la source unique partagée avec NoteEditor.
 *
 * POURQUOI cette dépendance est vitale : une extension d'attribut global
 * absente ne « manque » pas discrètement — ProseMirror efface l'attribut hors
 * schéma au premier aller-retour parse → sérialisation. C'est exactement ce qui
 * arrivait aux ancres de bloc, à la taille de police et à l'espacement quand on
 * éditait une note de coffre partagé. Toute extension de schéma s'ajoute
 * désormais dans `extensions/schemaExtensions.ts`, jamais ici.
 */

import type { AnyExtension } from '@tiptap/core';
import type { StarterKitOptions } from '@tiptap/starter-kit';

import { buildNoteSchemaExtensions } from './extensions/schemaExtensions';
import { WikiLinkDecorationExtension } from './extensions/wikiLinkDecorationPlugin';
import {
  buildInteractiveNoteExtensions,
  type InteractiveNoteOptions,
} from './interactiveNoteExtensions';

export interface SharedNoteExtensionOptions {
  /**
   * Extra StarterKit options merged over the shared defaults.
   *
   * The one real caller is live collaboration: Yjs brings its own history
   * (yUndoPlugin, carried by the Collaboration extension), so ProseMirror's
   * must be turned OFF with `{ undoRedo: false }`. Leaving both on makes Ctrl+Z
   * undo OTHER PEOPLE'S typing — the same reason NoteEditor's
   * `starterKitOptions(collabActive)` exists.
   */
  starterKit?: Record<string, unknown>;
  /**
   * LES EXTENSIONS D'INTERACTION — menu « / », placeholder, poignée de glisser,
   * repli des titres, émojis, titres de liens automatiques.
   *
   * ABSENT PAR DÉFAUT, et c'est le bon défaut : deux des trois appelants de ce
   * module ne sont PAS des surfaces d'édition (le rendu d'une version archivée,
   * le README d'un dossier). Leur accrocher un menu de commandes et des
   * écouteurs de suggestion serait offrir des gestes qui ne peuvent rien.
   *
   * Le TROISIÈME, l'éditeur de coffre partagé, est bel et bien éditable, et
   * c'est lui qui passe cette option. Il ne recopie donc rien : il monte les
   * mêmes instances que NoteEditor, construites au même endroit.
   */
  interactive?: InteractiveNoteOptions;
}

/**
 * Build the extension list for a secondary note surface. Called fresh per
 * mount so each editor gets its own instance tree.
 *
 * LES EXTENSIONS D'INTERACTION SONT DÉSORMAIS OPTIONNELLES, pas absentes.
 * Elles l'étaient parce que les premiers appelants étaient des APERÇUS ; le
 * jour où l'éditeur de coffre partagé est devenu éditable et collaboratif,
 * cette absence a cessé d'être une décision pour devenir un manque — pas de
 * menu « / », pas de placeholder, pas de poignée de glisser dans un éditeur à
 * part entière. `options.interactive` les rend, depuis le MÊME module que
 * NoteEditor (`interactiveNoteExtensions`).
 *
 * Le soulignement des liens wiki, lui, reste inconditionnel : c'est du décor
 * pur, utile même sur un aperçu.
 */
export function buildSharedNoteExtensions(
  options: SharedNoteExtensionOptions = {}
): AnyExtension[] {
  const inter = options.interactive ? buildInteractiveNoteExtensions(options.interactive) : null;
  return buildNoteSchemaExtensions({
    starterKit: options.starterKit as Partial<StarterKitOptions> | undefined,
    /**
     * Les poignées de redimensionnement de colonnes suivent l'interactivité :
     * une surface de LECTURE n'en a que faire, une surface d'ÉDITION en a besoin
     * — l'éditeur de coffre partagé les perdait pour la seule raison que ce
     * module servait d'abord des aperçus. Le schéma est le même dans les deux
     * cas (`colwidth` existe toujours) : seul le geste change.
     */
    tableResizable: !!inter,
    slots: {
      afterStarterKit: inter?.afterStarterKit,
      afterCodeBlock: inter?.afterCodeBlock,
      // Le soulignement des liens wiki est du DÉCOR pur (aucune résolution vers
      // les notes personnelles) : utile partout, y compris en lecture seule.
      afterBlockId: [WikiLinkDecorationExtension],
      afterComment: inter?.afterComment,
      afterFootnote: inter?.afterFootnote,
      trailing: inter?.trailing,
    },
  });
}
