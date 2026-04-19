/**
 * Transclusion Extension — Filarr Notes
 *
 * Custom TipTap Node for ![[note]] embeds.
 * Renders a bordered read-only card showing the referenced note content.
 * The parser already detects isEmbed in noteLinkParser.ts.
 */

import { Node, mergeAttributes } from '@tiptap/core';

export interface TransclusionAttributes {
  noteId: string;
  noteTitle: string;
  preview: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    transclusion: {
      insertTransclusion: (attrs: TransclusionAttributes) => ReturnType;
    };
  }
}

export const TransclusionExtension = Node.create({
  name: 'transclusion',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      noteId: { default: '' },
      noteTitle: { default: '' },
      preview: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-transclusion]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-transclusion': '',
        class: 'transclusion',
      }),
      [
        'div',
        { class: 'transclusion__header' },
        [
          'svg',
          { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' },
          ['path', { d: 'M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z' }],
          ['polyline', { points: '14,2 14,8 20,8' }],
        ],
        ['span', { class: 'transclusion__title' }, HTMLAttributes.noteTitle || 'Untitled'],
      ],
      ['div', { class: 'transclusion__content' }, HTMLAttributes.preview || ''],
    ];
  },

  addCommands() {
    return {
      insertTransclusion:
        (attrs: TransclusionAttributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },
});
