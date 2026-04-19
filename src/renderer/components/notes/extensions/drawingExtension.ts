/**
 * Drawing Extension — Filarr Notes
 *
 * Custom TipTap Node for inline freehand drawings.
 * Uses a React NodeView wrapping an HTML5 <canvas> element.
 * Stores strokes as JSON (array of paths with color/width).
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DrawingNodeView } from './DrawingNodeView';

export interface DrawingAttributes {
  strokes: string; // JSON-encoded stroke data
  width: number;
  height: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    drawing: {
      insertDrawing: () => ReturnType;
    };
  }
}

export const DrawingExtension = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      strokes: { default: '[]' },
      width: { default: 600 },
      height: { default: 300 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-drawing]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-drawing': '',
      class: 'drawing-block',
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingNodeView as any);
  },

  addCommands() {
    return {
      insertDrawing:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { strokes: '[]', width: 600, height: 300 },
          });
        },
    };
  },
});
