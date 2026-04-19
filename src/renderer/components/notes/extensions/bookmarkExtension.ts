/**
 * Bookmark Extension — Filarr Notes
 *
 * Atom node for rich web link previews (bookmark cards).
 * Auto-fetches page metadata (title, description, image, favicon, domain)
 * via the `fetchPageMetadata` IPC handler in Electron's main process.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { BookmarkNodeView } from './BookmarkNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      insertBookmark: (url?: string) => ReturnType;
    };
  }
}

export const BookmarkExtension = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url:         { default: '' },
      title:       { default: '' },
      description: { default: '' },
      image:       { default: '' },
      favicon:     { default: '' },
      domain:      { default: '' },
      fetched:     { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-bookmark]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-bookmark': '',
        class: 'bookmark-card',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkNodeView as any);
  },

  addCommands() {
    return {
      insertBookmark:
        (url = '') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { url, fetched: false },
          });
        },
    };
  },
});
