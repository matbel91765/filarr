/**
 * Toggle Block Extension — Filarr Notes
 *
 * Collapsible sections using <details>/<summary> HTML elements.
 * Uses a NodeView to handle click-to-toggle since ProseMirror
 * intercepts native <details> click behavior.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import {
  deleteSelectedNodeOfType,
  findWrapperDepth,
  unwrapBlockWrapper,
} from './unwrapBlockWrapper';

// ==================== Toggle Container ====================

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggleBlock: {
      insertToggle: (summary?: string) => ReturnType;
    };
  }
}

export const ToggleExtension = Node.create({
  name: 'toggleBlock',
  group: 'block',
  content: 'toggleSummary block+',
  defining: true,
  selectable: true,

  addAttributes() {
    return {
      open: { default: true },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'details',
      mergeAttributes(HTMLAttributes, {
        class: 'toggle-block',
        open: node.attrs.open ? 'true' : undefined,
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor, HTMLAttributes }) => {
      const details = document.createElement('details');
      details.classList.add('toggle-block');
      if (node.attrs.open) details.setAttribute('open', 'true');

      // Content hole — ProseMirror fills it with summary + block children
      const contentDOM = details;

      // Handle toggle click — only when clicking the disclosure marker area
      // (left ~24px of summary), not when the user clicks text to edit it.
      details.addEventListener('click', (e) => {
        const summary = (e.target as HTMLElement).closest('summary');
        if (!summary || summary.closest('details') !== details) return;

        // Check if click is on the marker area (the triangle arrow on the left)
        const summaryRect = summary.getBoundingClientRect();
        const clickX = e.clientX - summaryRect.left;
        // Marker area is roughly the first 24px on the left
        if (clickX > 24) return;

        e.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos != null) {
          const newOpen = !details.hasAttribute('open');
          if (newOpen) {
            details.setAttribute('open', 'true');
          } else {
            details.removeAttribute('open');
          }
          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              open: newOpen,
            })
          );
        }
      });

      return { dom: details, contentDOM };
    };
  },

  addCommands() {
    return {
      insertToggle:
        (summary = 'Toggle') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [
              { type: 'toggleSummary', content: [{ type: 'text', text: summary }] },
              { type: 'paragraph' },
            ],
          });
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

        // Backspace at the very start of the summary removes the toggle and
        // keeps everything inside it. This is the gesture that was missing:
        // previously this position was explicitly excluded, and `defining:
        // true` blocks ProseMirror's default lift, so a toggle containing any
        // text had no removal path at all.
        if ($from.parent.type.name === 'toggleSummary' && $from.parentOffset === 0) {
          return unwrapBlockWrapper(editor, depth, ['toggleSummary']);
        }

        // Backspace at the start of an empty body also dissolves the wrapper.
        const toggleNode = $from.node(depth);
        if (
          toggleNode.childCount <= 2 &&
          toggleNode.lastChild?.textContent === '' &&
          $from.parentOffset === 0
        ) {
          return unwrapBlockWrapper(editor, depth, ['toggleSummary']);
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

        // Forward-delete dissolves the toggle from an EMPTY summary only — the
        // one spot where Delete has nothing of its own to do. On a summary with
        // text, offset 0 still has a character to remove, and at the end of the
        // body Delete legitimately pulls the next block into the toggle;
        // hijacking either would break ordinary editing.
        if ($from.parent.type.name === 'toggleSummary' && $from.parent.content.size === 0) {
          return unwrapBlockWrapper(editor, depth, ['toggleSummary']);
        }

        return false;
      },

      // Remove the toggle AND everything inside it. Backspace/Delete
      // deliberately preserve the content, so without this the only way to
      // throw a whole toggle away was the drag-handle menu.
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

// ==================== Toggle Summary ====================

export const ToggleSummaryExtension = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'summary' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes, { class: 'toggle-block__summary' }), 0];
  },
});
