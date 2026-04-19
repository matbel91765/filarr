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

export type CalloutType =
  | 'info' | 'warning' | 'success' | 'error'
  | 'tip' | 'important' | 'note' | 'bug'
  | 'example' | 'quote';

export const CALLOUT_TYPES: { type: CalloutType; icon: string; color: string }[] = [
  { type: 'info',      icon: '\u2139\uFE0F', color: '#3498db' },
  { type: 'warning',   icon: '\u26A0\uFE0F', color: '#f39c12' },
  { type: 'success',   icon: '\u2705',       color: '#27ae60' },
  { type: 'error',     icon: '\u274C',       color: '#e74c3c' },
  { type: 'tip',       icon: '\uD83D\uDCA1', color: '#00bcd4' },
  { type: 'important', icon: '\uD83D\uDD25', color: '#e91e63' },
  { type: 'note',      icon: '\uD83D\uDCDD', color: '#607d8b' },
  { type: 'bug',       icon: '\uD83D\uDC1B', color: '#ff5722' },
  { type: 'example',   icon: '\uD83D\uDCD6', color: '#9c27b0' },
  { type: 'quote',     icon: '\u275D',       color: '#9b59b6' },
];

export function getCalloutMeta(type: CalloutType) {
  return CALLOUT_TYPES.find(c => c.type === type) || CALLOUT_TYPES[0];
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
    return [{
      tag: 'div[data-callout]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        return {
          type: el.getAttribute('data-callout-type') || 'info',
          collapsed: el.getAttribute('data-collapsed') === 'true',
          title: el.getAttribute('data-callout-title') || '',
        };
      },
    }];
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
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === this.name) {
            const calloutNode = $from.node(d);
            if (
              calloutNode.childCount === 1 &&
              calloutNode.firstChild?.textContent === '' &&
              $from.parentOffset === 0
            ) {
              return editor.commands.lift(this.name);
            }
          }
        }
        return false;
      },
    };
  },
});
