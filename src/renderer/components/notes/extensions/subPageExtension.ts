/**
 * Sub-Page Extension — Filarr Notes
 *
 * Custom TipTap Node for embedding a link to a sub-page (child note).
 * Renders as a styled block with icon + title, click navigates to the note.
 * The `/page` slash command inserts this node.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { SubPageNodeView } from './SubPageNodeView';
import { generateNoteId } from '../../../../services/notes/noteService';
import { markMintedSubPage } from './subPageMint';
import { subPageIndexText } from './indexText';

export interface SubPageAttributes {
  noteId: string;
  title: string;
  icon: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    subPage: {
      insertSubPage: (attrs?: Partial<SubPageAttributes>) => ReturnType;
    };
  }
}

export const SubPageExtension = Node.create({
  name: 'subPage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      noteId: { default: '' },
      title: { default: '' },
      icon: { default: '' },
    };
  },

  /** Le titre de la sous-page : le `noteId` est un identifiant, jamais un mot cherché. */
  renderText({ node }) {
    return subPageIndexText(node.attrs);
  },

  parseHTML() {
    return [{ tag: 'div[data-sub-page]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-sub-page': '', class: 'sub-page-block' }),
      ['span', { class: 'sub-page-block__icon' }, HTMLAttributes.icon || '📄'],
      ['span', { class: 'sub-page-block__title' }, HTMLAttributes.title || 'Untitled'],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubPageNodeView as any);
  },

  addCommands() {
    return {
      insertSubPage:
        (attrs?: Partial<SubPageAttributes>) =>
        ({ commands }) => {
          // Id frappé ICI plutôt que laissé vide : un nœud sans id fait créer
          // une note à CHAQUE appareil qui le reçoit (voir `subPageMint`).
          let noteId = attrs?.noteId || '';
          if (!noteId) {
            noteId = generateNoteId();
            markMintedSubPage(noteId);
          }
          return commands.insertContent({
            type: this.name,
            attrs: {
              noteId,
              title: attrs?.title || '',
              icon: attrs?.icon || '',
            },
          });
        },
    };
  },
});
