/**
 * Comment Extension — Filarr Notes
 *
 * Inline comments as marks on text ranges.
 * Stores comment data in a side-store (Redux), mark only carries the comment ID.
 */

import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (commentId: string) => ReturnType;
      unsetComment: () => ReturnType;
      removeCommentById: (commentId: string) => ReturnType;
    };
  }
}

export const CommentExtension = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.commentId) return {};
          return { 'data-comment-id': attributes.commentId };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0];
  },

  addCommands() {
    return {
      setComment:
        (commentId: string) =>
        ({ commands }) => {
          return commands.setMark(this.name, { commentId });
        },
      unsetComment:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
      removeCommentById:
        (commentId: string) =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks[this.name];
          if (!markType) return false;
          const ranges: { from: number; to: number }[] = [];
          state.doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type === markType && mark.attrs.commentId === commentId) {
                ranges.push({ from: pos, to: pos + node.nodeSize });
              }
            });
          });
          if (ranges.length === 0) return false;
          ranges.forEach(({ from, to }) => {
            tr.removeMark(from, to, markType);
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
