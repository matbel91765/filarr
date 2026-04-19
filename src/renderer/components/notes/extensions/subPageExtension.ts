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
          return commands.insertContent({
            type: this.name,
            attrs: {
              noteId: attrs?.noteId || '',
              title: attrs?.title || '',
              icon: attrs?.icon || '',
            },
          });
        },
    };
  },
});
