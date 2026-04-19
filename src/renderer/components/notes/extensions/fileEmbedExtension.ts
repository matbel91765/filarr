/**
 * File Embed Extension — Filarr Notes
 *
 * Custom TipTap Node for embedding images and files inline.
 * Uses a React NodeView for images (with resize handles) and
 * renderHTML fallback for SSR/export.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FileEmbedNodeView } from './FileEmbedNodeView';

export interface FileEmbedAttributes {
  fileId: string;
  fileName: string;
  fileType: string;
  src: string | null;
  width: number | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileEmbed: {
      insertFileEmbed: (attrs: FileEmbedAttributes) => ReturnType;
    };
  }
}

export const FileEmbedExtension = Node.create({
  name: 'fileEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      fileId: { default: '' },
      fileName: { default: '' },
      fileType: { default: '' },
      src: { default: null },
      width: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, { 'data-file-embed': '' });
    const isImage = /^image\//i.test(attrs.fileType || '');
    const style = attrs.width ? `width: ${attrs.width}px` : '';

    if (isImage && attrs.src) {
      return [
        'div',
        { ...attrs, class: 'file-embed file-embed--image', style },
        ['img', { src: attrs.src, alt: attrs.fileName, class: 'file-embed__img' }],
        ['span', { class: 'file-embed__caption' }, attrs.fileName],
      ];
    }

    return [
      'div',
      { ...attrs, class: 'file-embed file-embed--file' },
      [
        'div',
        { class: 'file-embed__icon' },
        ['span', {}, getFileIcon(attrs.fileType || '')],
      ],
      [
        'div',
        { class: 'file-embed__info' },
        ['span', { class: 'file-embed__name' }, attrs.fileName],
        ['span', { class: 'file-embed__type' }, attrs.fileType || 'File'],
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileEmbedNodeView as any);
  },

  addCommands() {
    return {
      insertFileEmbed:
        (attrs: FileEmbedAttributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },
});

function getFileIcon(fileType: string): string {
  if (/^image/i.test(fileType)) return '\uD83D\uDDBC\uFE0F';
  if (/pdf/i.test(fileType)) return '\uD83D\uDCC4';
  if (/spreadsheet|excel|csv/i.test(fileType)) return '\uD83D\uDCCA';
  if (/word|document/i.test(fileType)) return '\uD83D\uDCDD';
  if (/zip|archive|rar/i.test(fileType)) return '\uD83D\uDCE6';
  if (/video/i.test(fileType)) return '\uD83C\uDFAC';
  if (/audio/i.test(fileType)) return '\uD83C\uDFB5';
  return '\uD83D\uDCCE';
}
