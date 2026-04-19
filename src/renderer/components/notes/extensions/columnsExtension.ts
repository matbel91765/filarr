/**
 * Columns Extension — Filarr Notes
 *
 * Multi-column layout blocks (2 or 3 columns).
 * Each column is an editable content area.
 */

import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      insertColumns: (count?: number) => ReturnType;
    };
  }
}

// ==================== Column Container ====================

export const ColumnsExtension = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  defining: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      count: { default: 2 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-columns': '',
        class: `columns columns--${node.attrs.count}`,
        style: `display: grid; grid-template-columns: repeat(${node.attrs.count}, 1fr); gap: 16px;`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      insertColumns:
        (count = 2) =>
        ({ commands }) => {
          const cols = Array.from({ length: count }, () => ({
            type: 'column' as const,
            content: [{ type: 'paragraph' as const }],
          }));
          return commands.insertContent({
            type: this.name,
            attrs: { count },
            content: cols,
          });
        },
    };
  },
});

// ==================== Single Column ====================

export const ColumnExtension = Node.create({
  name: 'column',
  content: 'block+',
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-column': '',
        class: 'column',
      }),
      0,
    ];
  },
});
