/**
 * Mermaid Extension — Filarr Notes
 *
 * Renders code blocks with language "mermaid" as interactive diagrams.
 * Uses a React NodeView with the mermaid library.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MermaidNodeView } from './MermaidNodeView';
import { mermaidIndexText } from './indexText';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaidBlock: {
      insertMermaidBlock: (content?: string) => ReturnType;
    };
  }
}

export const MermaidExtension = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      code: { default: 'graph TD\n  A[Start] --> B[End]' },
    };
  },

  /**
   * Sans ceci, `getText()` saute le nœud et la SOURCE du diagramme (ses
   * libellés, ses étiquettes de flèches) n'entre jamais dans `plainText` :
   * un diagramme est alors introuvable par la recherche locale.
   */
  renderText({ node }) {
    return mermaidIndexText(node.attrs);
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-mermaid': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView as any);
  },

  addCommands() {
    return {
      insertMermaidBlock:
        (content = 'graph TD\n  A[Start] --> B[End]') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { code: content },
          });
        },
    };
  },
});
