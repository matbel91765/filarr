/**
 * Math/LaTeX Extension — Filarr Notes
 *
 * Inline and block math rendering via KaTeX.
 * - Inline: $E = mc^2$
 * - Block: $$\int_0^\infty e^{-x} dx = 1$$
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MathNodeView } from './MathNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      insertMathBlock: (content?: string) => ReturnType;
    };
    mathInline: {
      insertMathInline: (content?: string) => ReturnType;
    };
  }
}

// ==================== Block Math ====================

export const MathBlockExtension = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView as any);
  },

  addCommands() {
    return {
      insertMathBlock:
        (content = '') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { latex: content },
          });
        },
    };
  },
});

// ==================== Inline Math ====================

export const MathInlineExtension = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView as any);
  },

  addCommands() {
    return {
      insertMathInline:
        (content = '') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { latex: content },
          });
        },
    };
  },
});
