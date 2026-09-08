/**
 * Block ID Extension — Filarr Notes
 *
 * Adds a `blockId` attribute to paragraphs and headings so transclusions
 * can target a single block via `![[Note^abc123]]`. The id is stored in the
 * ProseMirror JSON and serialized to a `data-block-id` HTML attribute.
 *
 * Block ids are generated lazily — `assignBlockIdHere` walks the current
 * selection's parent block, generates an id if missing, and writes it back.
 * The right-click "Copier le lien vers ce bloc" menu item calls this.
 */

import { Extension } from '@tiptap/core';
import { generateBlockId } from '../../../../services/notes/transclusionHelpers';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockId: {
      /**
       * Ensure the block at the current selection has a `blockId`. If it
       * already has one, leave it. Returns the id via the `onAssigned`
       * callback so the caller can put it on the clipboard.
       */
      assignBlockIdHere: (onAssigned: (id: string) => void) => ReturnType;
    };
  }
}

export const BlockIdExtension = Extension.create({
  name: 'blockId',

  /**
   * Attach `blockId` to the node types that make sense as embed targets.
   * Lists, blockquotes, code blocks etc. can be added later without
   * breaking compatibility — readers just won't find ids on them.
   */
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => {
              if (!attributes.blockId) return {};
              return { 'data-block-id': attributes.blockId };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      assignBlockIdHere:
        (onAssigned) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          // Walk up the position chain to the nearest block whose type we
          // augmented; that's where the id sits.
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              const existing = (node.attrs as { blockId?: string }).blockId;
              const id = existing || generateBlockId();
              if (!existing) {
                if (dispatch) {
                  const pos = $from.before(d);
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id });
                  dispatch(tr);
                }
              }
              onAssigned(id);
              return true;
            }
          }
          return false;
        },
    };
  },
});
