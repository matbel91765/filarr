/**
 * Dataview Block Extension — Filarr Notes
 *
 * A TipTap extension that renders a Notion/Obsidian Dataview-like block
 * which queries notes by metadata using a simplified query language.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DataviewNodeView } from './DataviewNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dataviewBlock: {
      insertDataview: (query?: string) => ReturnType;
    };
  }
}

export const DataviewExtension = Node.create({
  name: 'dataviewBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      query: {
        default: 'TABLE title, wordCount, updatedAt\nFROM notes\nSORT updatedAt DESC\nLIMIT 10',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-dataview-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-dataview-block': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DataviewNodeView as any);
  },

  addCommands() {
    return {
      insertDataview:
        (query?: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              query:
                query ??
                'TABLE title, wordCount, updatedAt\nFROM notes\nSORT updatedAt DESC\nLIMIT 10',
            },
          });
        },
    };
  },
});
