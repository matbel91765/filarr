/**
 * Callout Extension — Filarr Notes
 *
 * Interactive callout blocks with:
 * - 10 types (info, warning, success, error, tip, important, note, bug, example, quote)
 * - Collapsible body via chevron toggle
 * - Editable title line
 * - Type picker popover (click the icon)
 * - React NodeView via CalloutNodeView
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CalloutNodeView } from './CalloutNodeView';
import {
  deleteSelectedNodeOfType,
  findWrapperDepth,
  unwrapBlockWrapper,
} from './unwrapBlockWrapper';

export type CalloutType =
  | 'info'
  | 'warning'
  | 'success'
  | 'error'
  | 'tip'
  | 'important'
  | 'note'
  | 'bug'
  | 'example'
  | 'quote';

export const CALLOUT_TYPES: { type: CalloutType; icon: string; color: string }[] = [
  { type: 'info', icon: '\u2139\uFE0F', color: '#3498db' },
  { type: 'warning', icon: '\u26A0\uFE0F', color: '#f39c12' },
  { type: 'success', icon: '\u2705', color: '#27ae60' },
  { type: 'error', icon: '\u274C', color: '#e74c3c' },
  { type: 'tip', icon: '\uD83D\uDCA1', color: '#00bcd4' },
  { type: 'important', icon: '\uD83D\uDD25', color: '#e91e63' },
  { type: 'note', icon: '\uD83D\uDCDD', color: '#607d8b' },
  { type: 'bug', icon: '\uD83D\uDC1B', color: '#ff5722' },
  { type: 'example', icon: '\uD83D\uDCD6', color: '#9c27b0' },
  { type: 'quote', icon: '\u275D', color: '#9b59b6' },
];

export function getCalloutMeta(type: CalloutType) {
  return CALLOUT_TYPES.find((c) => c.type === type) || CALLOUT_TYPES[0];
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      insertCallout: (type?: CalloutType) => ReturnType;
      setCalloutType: (type: CalloutType) => ReturnType;
      toggleCalloutCollapse: () => ReturnType;
    };
  }
}

export const CalloutExtension = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      type: { default: 'info' as CalloutType },
      collapsed: { default: false },
      title: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          return {
            type: el.getAttribute('data-callout-type') || 'info',
            collapsed: el.getAttribute('data-collapsed') === 'true',
            title: el.getAttribute('data-callout-title') || '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = node.attrs.type || 'info';
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': '',
        'data-callout-type': type,
        'data-collapsed': String(!!node.attrs.collapsed),
        'data-callout-title': node.attrs.title || '',
        class: `callout callout--${type}`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView as any);
  },

  addCommands() {
    return {
      insertCallout:
        (type: CalloutType = 'info') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { type, collapsed: false, title: '' },
            content: [{ type: 'paragraph' }],
          });
        },
      setCalloutType:
        (type: CalloutType) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, { type });
        },
      toggleCalloutCollapse:
        () =>
        ({ tr, state }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'callout') {
              const pos = $from.before(d);
              const node = $from.node(d);
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                collapsed: !node.attrs.collapsed,
              });
              return true;
            }
          }
          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        // Whole block selected (drag handle / edge click) — just remove it.
        if (deleteSelectedNodeOfType(editor, this.name)) return true;

        const { $from, empty } = editor.state.selection;
        if (!empty) return false;

        const depth = findWrapperDepth($from, this.name);
        if (depth === null) return false;

        // Backspace at the very start of the callout dissolves it and keeps
        // the text. Previously this only worked on an EMPTY callout, so one
        // with content could not be removed by keyboard at all.
        if ($from.parentOffset === 0 && $from.index(depth) === 0) {
          return unwrapBlockWrapper(editor, depth);
        }

        return false;
      },

      Delete: ({ editor }) => {
        // Whole block selected (drag handle / edge click) — just remove it.
        if (deleteSelectedNodeOfType(editor, this.name)) return true;

        const { $from, empty } = editor.state.selection;
        if (!empty) return false;

        const depth = findWrapperDepth($from, this.name);
        if (depth === null) return false;

        // Forward-delete dissolves the callout from an EMPTY one only — the
        // mirror of Backspace, and the one spot where Delete has nothing of its
        // own to do (`isolating: true` already stops it from pulling the next
        // block in). As soon as the callout holds anything, Delete keeps its
        // ordinary meaning; hijacking it there would break normal editing.
        const calloutNode = $from.node(depth);
        if (
          calloutNode.childCount <= 1 &&
          $from.depth === depth + 1 &&
          $from.parent.content.size === 0
        ) {
          return unwrapBlockWrapper(editor, depth);
        }

        return false;
      },

      // Remove the callout AND everything inside it. Backspace/Delete
      // deliberately preserve the content, so without this the only way to
      // throw a whole callout away was the drag-handle menu.
      'Mod-Shift-Backspace': ({ editor }) => {
        if (deleteSelectedNodeOfType(editor, this.name)) return true;

        const { $from } = editor.state.selection;
        const depth = findWrapperDepth($from, this.name);
        if (depth === null) return false;

        const start = $from.before(depth);
        const tr = editor.state.tr.delete(start, start + $from.node(depth).nodeSize);
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
