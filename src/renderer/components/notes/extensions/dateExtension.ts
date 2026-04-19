/**
 * Inline Date Picker Extension — Filarr Notes
 *
 * Inline date node that renders a formatted date with click-to-pick.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DateNodeView } from './DateNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineDate: {
      insertDate: (date?: string) => ReturnType;
    };
  }
}

export const DateExtension = Node.create({
  name: 'inlineDate',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      date: { default: new Date().toISOString().slice(0, 10) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-inline-date]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-inline-date': '',
        class: 'inline-date',
      }),
      node.attrs.date,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DateNodeView as any);
  },

  addCommands() {
    return {
      insertDate:
        (date) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { date: date || new Date().toISOString().slice(0, 10) },
          });
        },
    };
  },
});
