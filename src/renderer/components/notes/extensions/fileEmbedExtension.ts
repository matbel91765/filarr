/**
 * File Embed Extension — Filarr Notes
 *
 * Custom TipTap Node for embedding images and files inline.
 * Uses a React NodeView for images (with resize handles) and
 * renderHTML fallback for SSR/export.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { FileEmbedNodeView } from './FileEmbedNodeView';
import { copyNoteImage } from '../../../../services/notes/noteImageClipboard';
import { notifyImageCopyFailed } from './fileEmbedFeedback';
import { fileEmbedIndexText } from './indexText';

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
    return [
      { tag: 'div[data-file-embed]' },
      {
        // Images pasted as HTML (screenshot tools, other editors). Only inline
        // `data:` URIs are accepted: a remote src would be blocked by the
        // renderer CSP and would leak the note's content to that host.
        tag: 'img[src]',
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === 'string') return false;
          const src = element.getAttribute('src') || '';
          if (!/^data:image\//i.test(src)) return false;
          const width = Number.parseInt(element.getAttribute('width') || '', 10);
          return {
            fileId: `pasted-${Date.now()}`,
            fileName: element.getAttribute('alt') || 'image',
            fileType: src.slice(5).split(/[;,]/)[0] || 'image/png',
            src,
            width: Number.isFinite(width) && width > 0 ? width : null,
          };
        },
      },
    ];
  },

  /**
   * Le NOM du fichier, et lui seul : `src` peut porter un data-URI de plusieurs
   * mégaoctets, qui noierait l'index (et la note chiffrée) en base64.
   */
  renderText({ node }) {
    return fileEmbedIndexText(node.attrs);
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
      ['div', { class: 'file-embed__icon' }, ['span', {}, getFileIcon(attrs.fileType || '')]],
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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('fileEmbedImageCopy'),
        props: {
          handleDOMEvents: {
            copy: (_view, event) => handleImageCopy(_view, event as ClipboardEvent),
          },
        },
      }),
    ];
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

/**
 * Ctrl+C sur une image sélectionnée.
 *
 * Laissé à ProseMirror, ce raccourci ne dépose que du HTML : le presse-papiers
 * n'a alors AUCUN bitmap, et le collage dans Paint, Word ou une messagerie ne
 * donne rien. On prend donc la main pour écrire l'image elle-même (le canal
 * principal y ajoute le HTML, pour que le collage dans Filarr recrée bien un
 * `fileEmbed`).
 *
 * Toute autre sélection — un fichier non-image, du texte autour — retombe sur
 * le comportement natif.
 */
function handleImageCopy(view: EditorView, event: ClipboardEvent): boolean {
  const { selection } = view.state;
  if (!(selection instanceof NodeSelection)) return false;
  const node = selection.node;
  if (node.type.name !== 'fileEmbed') return false;

  const src = node.attrs.src as string | null;
  if (!src || !/^data:image\//i.test(src)) return false;

  // L'écriture du presse-papiers est ASYNCHRONE (pont IPC ou API navigateur) :
  // impossible de la faire tenir dans l'évènement. On coupe donc le
  // comportement natif et on prévient si l'écriture échoue — un presse-papiers
  // silencieusement inchangé est exactement le défaut qu'on corrige.
  event.preventDefault();
  void copyNoteImage(src, String(node.attrs.fileName || 'image')).then((ok) => {
    if (!ok) notifyImageCopyFailed();
  });
  return true;
}

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
