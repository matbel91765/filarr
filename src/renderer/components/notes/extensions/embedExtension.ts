/**
 * Embed URL Extension — Filarr Notes
 *
 * Embeds external URLs with rich previews (YouTube, etc.) as iframes,
 * or as a styled link card for unsupported URLs.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { EmbedNodeView } from './EmbedNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embedUrl: {
      insertEmbed: (url: string) => ReturnType;
    };
  }
}

export const EmbedExtension = Node.create({
  name: 'embedUrl',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      embedType: { default: 'link' }, // 'youtube' | 'vimeo' | 'twitter' | 'link'
      embedId: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-embed-url]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-embed-url': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedNodeView as any);
  },

  addCommands() {
    return {
      insertEmbed:
        (url: string) =>
        ({ commands }) => {
          const { type, id } = detectEmbedType(url);
          return commands.insertContent({
            type: this.name,
            attrs: { url, embedType: type, embedId: id },
          });
        },
    };
  },
});

function detectEmbedType(url: string): { type: string; id: string } {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return { type: 'youtube', id: ytMatch[1] };

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return { type: 'vimeo', id: vimeoMatch[1] };

  return { type: 'link', id: '' };
}
