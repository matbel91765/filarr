/**
 * Wiki-Link Decoration Plugin — Filarr Notes
 *
 * ProseMirror plugin that finds [[...]] patterns in the document
 * and renders them as clean inline chips (hiding brackets and type prefix).
 * Uses separate decorations for brackets, prefix, and display name.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const WIKI_LINK_RE = /\[\[(?:(note|file|folder):)?([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export const wikiLinkDecorationKey = new PluginKey('wikiLinkDecoration');

function buildDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text = node.text || '';
    let match;
    WIKI_LINK_RE.lastIndex = 0;

    while ((match = WIKI_LINK_RE.exec(text)) !== null) {
      const fullMatch = match[0];
      const linkType = match[1] || 'note';
      const target = match[2];
      const alias = match[3]; // optional |alias
      const start = pos + match.index;

      // Calculate positions of each segment
      const openBracket = start; // [[
      const afterOpen = openBracket + 2;

      let prefixEnd = afterOpen;
      if (match[1]) {
        // Has type prefix like "file:" or "folder:"
        prefixEnd = afterOpen + match[1].length + 1; // +1 for the ":"
      }

      let nameEnd: number;
      if (alias) {
        // [[type:target|alias]] — hide target, show alias
        const pipePos = prefixEnd + target.length;
        nameEnd = pipePos + 1 + alias.length; // +1 for "|"
      } else {
        nameEnd = prefixEnd + target.length;
      }

      const closeBracket = nameEnd; // ]]
      const end = closeBracket + 2;

      // Sanity check
      if (end !== start + fullMatch.length) continue;

      // 1. Hide opening brackets [[
      decorations.push(
        Decoration.inline(openBracket, afterOpen, {
          class: 'wiki-link-syntax',
        })
      );

      // 2. Hide type prefix (file:, folder:, note:)
      if (match[1]) {
        decorations.push(
          Decoration.inline(afterOpen, prefixEnd, {
            class: 'wiki-link-syntax',
          })
        );
      }

      // 3. Style the display name (or full target|alias range)
      if (alias) {
        // Hide target part, show alias
        decorations.push(
          Decoration.inline(prefixEnd, prefixEnd + target.length + 1, {
            class: 'wiki-link-syntax',
          })
        );
        decorations.push(
          Decoration.inline(prefixEnd + target.length + 1, nameEnd, {
            class: `wiki-link-name wiki-link-name--${linkType}`,
            'data-link-type': linkType,
            'data-link-target': target,
          })
        );
      } else {
        decorations.push(
          Decoration.inline(prefixEnd, nameEnd, {
            class: `wiki-link-name wiki-link-name--${linkType}`,
            'data-link-type': linkType,
            'data-link-target': target,
          })
        );
      }

      // 4. Hide closing brackets ]]
      decorations.push(
        Decoration.inline(closeBracket, end, {
          class: 'wiki-link-syntax',
        })
      );

      // 5. Wrap the entire thing for hover detection
      decorations.push(
        Decoration.inline(start, end, {
          class: `wiki-link wiki-link--${linkType}`,
          'data-link-type': linkType,
          'data-link-target': target,
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const WikiLinkDecorationExtension = Extension.create({
  name: 'wikiLinkDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: wikiLinkDecorationKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc);
          },
          apply(tr, oldSet) {
            if (tr.docChanged) {
              return buildDecorations(tr.doc);
            }
            return oldSet.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
