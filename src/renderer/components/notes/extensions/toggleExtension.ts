/**
 * Toggle Block Extension — Filarr Notes
 *
 * Collapsible sections using <details>/<summary> HTML elements.
 * Uses a NodeView to handle click-to-toggle since ProseMirror
 * intercepts native <details> click behavior.
 */

import { Node, mergeAttributes } from '@tiptap/core';

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
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === this.name) {
            const toggleNode = $from.node(d);
            if (
              toggleNode.childCount <= 2 &&
              toggleNode.lastChild?.textContent === '' &&
              $from.parentOffset === 0 &&
              $from.parent.type.name !== 'toggleSummary'
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
