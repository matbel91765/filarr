/**
 * interactiveNoteExtensions — les extensions d'INTERACTION d'une surface de
 * note, et leur branchement React, en UN seul endroit.
 *
 * ── CE QUE CE MODULE FERME ───────────────────────────────────────────────────
 *
 * `extensions/schemaExtensions.ts` avait déjà unifié tout ce qui CONTRIBUE AU
 * SCHÉMA — nœuds, marques, attributs globaux — après qu'une liste recopiée à la
 * main eut effacé les ancres de bloc, la taille de police et l'espacement des
 * notes de coffre partagé. Il s'arrêtait volontairement là, sur cette ligne de
 * coupe : « tout ce qui est interaction pure reste chez l'appelant ».
 *
 * La ligne était juste tant qu'il n'y avait qu'UN appelant interactif. Depuis
 * que l'éditeur de coffre est lui aussi éditable et collaboratif, elle laissait
 * l'éditeur de coffre SANS menu slash, sans placeholder, sans poignée de
 * glisser, sans repli de titres et sans émojis — non pas par décision, mais
 * parce que ces cinq-là vivaient dans le corps de `NoteEditor`, mêlés à ~90
 * lignes de branchement `ReactRenderer` chacun. Les recopier eût été la MÊME
 * faute que le schéma recopié, à un an d'intervalle : deux copies qui
 * divergeraient au premier ajout de commande.
 *
 * Ce module est donc la seconde moitié de la même idée. Il ne contient aucune
 * décision de schéma ; il contient le branchement, qui est exactement ce qui
 * était trop encombrant pour être partagé jusqu'ici.
 *
 * ── CE QU'IL NE FAIT PAS ─────────────────────────────────────────────────────
 *
 * Il ne prend PAS les extensions liées à l'espace personnel : l'autocomplétion
 * de liens wiki, le soulignement des titres mentionnés
 * (`PotentialLinkDecorationExtension`), le résolveur de transclusion par titre.
 * Elles lisent `notesSlice` — la faire tourner dans une note de coffre ferait
 * entrer du contenu local dans un document que d'autres membres liront. Elles
 * restent branchées par `NoteEditor`, dans SES emplacements, et c'est aussi
 * pourquoi ce module rend des emplacements séparés plutôt qu'une liste close :
 * chaque hôte compose les siens.
 */

import { ReactRenderer } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';

import { SlashCommandExtension, buildSlashItems } from './slashCommandExtension';
import { SlashCommandMenu } from './SlashCommandMenu';
import type { SlashCommandMenuRef, SlashCommandItem } from './SlashCommandMenu';
import { DragHandleExtension } from './extensions/dragHandlePlugin';
import { HeadingCollapserExtension } from './extensions/headingCollapserExtension';
import { EmojiShortcodesExtension } from './extensions/emojiShortcodesExtension';
import type { EmojiItem } from './extensions/emojiShortcodesExtension';
import EmojiSuggestionMenu from './EmojiSuggestionMenu';
import type { EmojiSuggestionMenuRef } from './EmojiSuggestionMenu';
import { AutoLinkTitleExtension } from './extensions/autoLinkTitleExtension';
import { MentionSuggestionExtension } from './extensions/mentionSuggestionExtension';
import type {
  MentionCandidate,
  MentionCandidatesProvider,
} from './extensions/mentionSuggestionExtension';
import MentionSuggestionMenu from './MentionSuggestionMenu';
import type { MentionSuggestionMenuRef } from './MentionSuggestionMenu';

// ==================== Suggestion Popup Helper ====================

/**
 * Creates a DOM-based popup anchored to a clientRect.
 * Replaces tippy.js to avoid module resolution issues with baseUrl.
 *
 * (Déplacé depuis `NoteEditor` : les deux menus de suggestion s'y ancrent, et
 * il est désormais monté par deux hôtes.)
 */
export function createSuggestionPopup() {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.zIndex = '9999';
  container.style.pointerEvents = 'auto';
  document.body.appendChild(container);

  return {
    element: container,
    updatePosition: (getRect: (() => DOMRect | null) | null) => {
      if (!getRect) return;
      const rect = getRect();
      if (!rect) return;

      const menuHeight = container.offsetHeight || 320; // estimate if not yet rendered
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      // Recalage horizontal : le menu « / » fait maintenant deux volets (~420
      // px). Aligné bêtement sur le curseur, il sortait de la fenêtre dès
      // qu'on tapait « / » près du bord droit — la moitié des commandes
      // devenait inatteignable.
      const menuWidth = container.offsetWidth || 420;
      const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
      container.style.left = `${Math.min(rect.left, maxLeft)}px`;
      /**
       * LE MENU EST BORNÉ À LA PLACE DISPONIBLE, il ne se contente pas de
       * choisir un côté.
       *
       * Choisir le côté ne suffit pas : quand aucun des deux n'offre la hauteur
       * demandée (curseur au milieu d'une fenêtre courte, barre des tâches en
       * bas), le menu débordait de l'écran — et comme le débordement était HORS
       * du conteneur défilant, les dernières commandes devenaient
       * inatteignables, à la souris comme au clavier.
       *
       * En posant une hauteur maximale, la liste défile à l'intérieur : tout
       * reste accessible, quelle que soit la place.
       */
      const MARGIN = 8;
      const above = spaceBelow < menuHeight && spaceAbove > spaceBelow;
      const available = (above ? spaceAbove : spaceBelow) - MARGIN * 2;
      container.style.maxHeight = `${Math.max(160, available)}px`;

      if (above) {
        container.style.top = '';
        container.style.bottom = `${viewportHeight - rect.top + 4}px`;
      } else {
        container.style.bottom = '';
        container.style.top = `${rect.bottom + 4}px`;
      }
    },
    destroy: () => {
      container.remove();
    },
  };
}

// ==================== Les deux menus de suggestion ====================

/**
 * Le menu « / ».
 *
 * `exclude` écarte des commandes par identifiant — c'est ainsi que l'éditeur de
 * coffre partagé retire celles qui visent l'espace personnel
 * (`PERSONAL_ONLY_SLASH_IDS`). Le FILTRAGE lui-même reste dans
 * `buildSlashItems` : la recherche (libellé traduit, description, alias) n'est
 * écrite qu'une fois, et une commande ajoutée demain apparaît dans les deux
 * hôtes sans que personne n'y pense.
 */
export function slashCommandExtension(options: { exclude?: readonly string[] } = {}): AnyExtension {
  const { exclude } = options;
  return SlashCommandExtension.configure({
    suggestion: {
      items: ({ query }: { query: string }): SlashCommandItem[] =>
        buildSlashItems(query, { exclude }),
      render: () => {
        let component: ReactRenderer<SlashCommandMenuRef> | null = null;
        let popup: ReturnType<typeof createSuggestionPopup> | null = null;

        return {
          onStart: (props: any) => {
            component = new ReactRenderer(SlashCommandMenu, {
              props: {
                items: props.items,
                // La requête pilote le régime d'affichage du menu :
                // catalogue en sections quand elle est vide, classement
                // par pertinence dès qu'on tape.
                query: props.query ?? '',
                command: (item: SlashCommandItem) => props.command(item),
              },
              editor: props.editor,
            });

            popup = createSuggestionPopup();
            popup.element.appendChild(component.element);
            popup.updatePosition(props.clientRect);
          },
          onUpdate: (props: any) => {
            component?.updateProps({
              items: props.items,
              query: props.query ?? '',
              command: (item: SlashCommandItem) => props.command(item),
            });
            popup?.updatePosition(props.clientRect);
          },
          onKeyDown: (props: any) => {
            if (props.event.key === 'Escape') {
              popup?.destroy();
              return true;
            }
            return component?.ref?.onKeyDown(props) ?? false;
          },
          onExit: () => {
            popup?.destroy();
            component?.destroy();
          },
        };
      },
    },
  });
}

/** Le menu `:emoji:`. Aucun état d'application : le même dans les deux hôtes. */
export function emojiShortcodesExtension(): AnyExtension {
  return EmojiShortcodesExtension.configure({
    suggestion: {
      render: () => {
        let component: ReactRenderer<EmojiSuggestionMenuRef> | null = null;
        let popup: ReturnType<typeof createSuggestionPopup> | null = null;

        return {
          onStart: (props: any) => {
            component = new ReactRenderer(EmojiSuggestionMenu, {
              props: {
                items: props.items,
                command: (item: EmojiItem) => props.command(item),
              },
              editor: props.editor,
            });
            popup = createSuggestionPopup();
            popup.element.appendChild(component.element);
            popup.updatePosition(props.clientRect);
          },
          onUpdate: (props: any) => {
            component?.updateProps({
              items: props.items,
              command: (item: EmojiItem) => props.command(item),
            });
            popup?.updatePosition(props.clientRect);
          },
          onKeyDown: (props: any) => {
            if (props.event.key === 'Escape') {
              popup?.destroy();
              return true;
            }
            return component?.ref?.onKeyDown(props) ?? false;
          },
          onExit: () => {
            popup?.destroy();
            component?.destroy();
          },
        };
      },
    },
  });
}

/** Le menu « Personnes » : même branchement que celui des emojis. */
export function mentionSuggestionExtension(candidates: MentionCandidatesProvider): AnyExtension {
  return MentionSuggestionExtension.configure({
    suggestion: {
      items: ({ query }: { query: string }) => candidates(query),
      render: () => {
        let component: ReactRenderer<MentionSuggestionMenuRef> | null = null;
        let popup: ReturnType<typeof createSuggestionPopup> | null = null;
        return {
          onStart: (props: any) => {
            component = new ReactRenderer(MentionSuggestionMenu, {
              props: {
                items: props.items,
                command: (item: MentionCandidate) => props.command(item),
              },
              editor: props.editor,
            });
            popup = createSuggestionPopup();
            popup.element.appendChild(component.element);
            popup.updatePosition(props.clientRect);
          },
          onUpdate: (props: any) => {
            component?.updateProps({
              items: props.items,
              command: (item: MentionCandidate) => props.command(item),
            });
            popup?.updatePosition(props.clientRect);
          },
          onKeyDown: (props: any) => {
            if (props.event.key === 'Escape') {
              popup?.destroy();
              return true;
            }
            return component?.ref?.onKeyDown(props) ?? false;
          },
          onExit: () => {
            popup?.destroy();
            component?.destroy();
          },
        };
      },
    },
  });
}

// ==================== Le jeu complet, par emplacement ====================

export interface InteractiveNoteSlots {
  afterStarterKit: AnyExtension[];
  afterCodeBlock: AnyExtension[];
  afterComment: AnyExtension[];
  afterFootnote: AnyExtension[];
  trailing: AnyExtension[];
}

export interface InteractiveNoteOptions {
  /** Le texte du bloc vide, DÉJÀ traduit — ce module ne traduit pas. */
  placeholder: string;
  /** Commandes « / » à retirer (voir `PERSONAL_ONLY_SLASH_IDS`). */
  excludeSlashIds?: readonly string[];
  /**
   * Les personnes qu’on peut mentionner sous « @ » (lot 2 des @mentions).
   * Fourni par les surfaces qui vivent dans un coffre partagé (ses membres) ;
   * absent, le menu « Personnes » n’est pas monté et le « @ » garde son rôle
   * d’avant. Voir mentionSuggestionExtension.
   */
  mentionCandidates?: MentionCandidatesProvider;
}

/**
 * Les extensions d'interaction, rangées dans les emplacements de
 * `NoteSchemaExtensionOptions.slots`.
 *
 * RENDU PAR EMPLACEMENT, ET PAS EN UNE LISTE. L'ordre compte (priorités TipTap,
 * ordre des greffons ProseMirror, règles de saisie), et chaque hôte a des
 * extensions à lui à intercaler : `NoteEditor` glisse le montage Yjs et les
 * décorations de liens personnels dans les mêmes emplacements. Rendre une liste
 * close les repousserait toutes en fin de course et changerait en silence
 * l'ordre des gestionnaires de clavier et de collage.
 */
export function buildInteractiveNoteExtensions(
  options: InteractiveNoteOptions
): InteractiveNoteSlots {
  return {
    afterStarterKit: [Placeholder.configure({ placeholder: options.placeholder })],
    afterCodeBlock: [DragHandleExtension],
    afterComment: [HeadingCollapserExtension],
    afterFootnote: [
      emojiShortcodesExtension(),
      AutoLinkTitleExtension,
      ...(options.mentionCandidates ? [mentionSuggestionExtension(options.mentionCandidates)] : []),
    ],
    trailing: [slashCommandExtension({ exclude: options.excludeSlashIds })],
  };
}
