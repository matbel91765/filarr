/**
 * Block Spacing Extension — Filarr Notes
 *
 * Adds per-block `lineSpacing` attribute to paragraph and heading nodes.
 * Values: multiplier (e.g. 1, 1.5, 2) applied as margin-bottom + line-height scaling.
 * When set, renders as inline style; when null, falls back to global --ss-spacing-scale.
 */

import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockSpacing: {
      setBlockSpacing: (scale: number) => ReturnType;
      unsetBlockSpacing: () => ReturnType;
    };
  }
}

const BLOCK_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote'];

export const BlockSpacingExtension = Extension.create({
  name: 'blockSpacing',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          lineSpacing: {
            default: null,
            parseHTML: (el) => {
              const v = el.getAttribute('data-line-spacing');
              return v ? Number(v) : null;
            },
            renderHTML: (attrs) => {
              if (attrs.lineSpacing == null) return {};
              return {
                'data-line-spacing': String(attrs.lineSpacing),
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setBlockSpacing:
        (scale: number) =>
        ({ tr, state }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (BLOCK_TYPES.includes(node.type.name)) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                lineSpacing: scale,
              });
              changed = true;
            }
          });
          return changed;
        },
      unsetBlockSpacing:
        () =>
        ({ tr, state }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (BLOCK_TYPES.includes(node.type.name) && node.attrs.lineSpacing != null) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                lineSpacing: null,
              });
              changed = true;
            }
          });
          return changed;
        },
    };
  },
});
