/**
 * Table of Contents Block Extension — Filarr Notes
 *
 * Renders an inline TOC that auto-updates from the document's headings.
 * Uses a React NodeView to dynamically extract headings.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TocNodeView } from './TocNodeView';
import { tocIndexText } from './indexText';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

export const TocExtension = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  /**
   * Volontairement VIDE : le sommaire ne fait que refléter des titres déjà
   * indexés à leur place. L'indexer compterait chaque titre deux fois.
   */
  renderText() {
    return tocIndexText();
  },

  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '', class: 'toc-block' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocNodeView as any);
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) => {
          return commands.insertContent({ type: this.name });
        },
    };
  },
});
