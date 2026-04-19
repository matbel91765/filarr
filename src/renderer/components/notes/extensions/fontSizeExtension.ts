/**
 * FontSize + FontFamily Extension — inline text styling via TextStyle mark.
 *
 * Adds `setFontSize('16px')` / `unsetFontSize()` commands.
 * Also registers fontFamily as a TextStyle attribute for inline font changes.
 * Renders as `<span style="font-size: ...; font-family: ...">`.
 */

import { Extension } from '@tiptap/core';
import '@tiptap/extension-text-style';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSizeExtension = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize || null,
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}` };
            },
          },
          fontFamily: {
            default: null,
            parseHTML: (el) => el.style.fontFamily || null,
            renderHTML: (attrs) => {
              if (!attrs.fontFamily) return {};
              return { style: `font-family: ${attrs.fontFamily}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});
