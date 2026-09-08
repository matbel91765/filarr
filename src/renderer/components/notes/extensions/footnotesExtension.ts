/**
 * Footnotes Extension — Filarr Notes
 *
 * Auto-numbered footnotes as inline atom nodes.
 * Footnote content is stored in the node attribute; the number is
 * computed from document position at render time.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FootnoteNodeView } from './FootnoteNodeView';
import { footnoteIndexText } from './indexText';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (content?: string) => ReturnType;
    };
  }
}

export const FootnoteExtension = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: { default: '' },
    };
  },

  /** Nœud INLINE : bordé d'espaces, sinon la note souderait les deux mots qui l'entourent. */
  renderText({ node }) {
    return footnoteIndexText(node.attrs);
  },

  parseHTML() {
    return [{ tag: 'span[data-footnote]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-footnote': '',
        class: 'footnote-ref',
        title: node.attrs.content,
      }),
      '[*]',
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteNodeView as any);
  },

  addCommands() {
    return {
      insertFootnote:
        (content = '') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { content },
          });
        },
    };
  },
});
