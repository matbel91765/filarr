/**
 * Heading Collapser Extension — Filarr Notes
 *
 * Adds fold/unfold buttons on headings. Clicking collapses all content
 * below the heading until the next heading of same or higher level.
 * Decorations are computed purely in plugin state — no dispatching from view.update().
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

const collapserKey = new PluginKey('headingCollapser');

// External mutable set — survives across state.apply() calls
const collapsedPositions = new Set<string>();

/** Create a stable key for a heading (using its text content as fallback for position shifts) */
function headingKey(doc: any, pos: number): string {
  const node = doc.nodeAt(pos);
  if (!node) return `h-${pos}`;
  const level = node.attrs?.level || 1;
  let text = '';
  node.forEach((child: any) => {
    if (child.isText) text += child.text;
  });
  return `h${level}-${text.slice(0, 40)}-${pos}`;
}

function buildDecorations(doc: any, view: EditorView | null): DecorationSet {
  const decorations: Decoration[] = [];

  // Collect headings
  const headings: { pos: number; level: number; endPos: number; key: string }[] = [];
  doc.forEach((node: any, pos: number) => {
    if (node.type.name === 'heading') {
      const key = headingKey(doc, pos);
      headings.push({ pos, level: node.attrs.level || 1, endPos: pos + node.nodeSize, key });
    }
  });

  // Add fold/unfold buttons
  for (const h of headings) {
    const isCollapsed = collapsedPositions.has(h.key);

    const widget = Decoration.widget(h.pos, () => {
      const btn = document.createElement('button');
      btn.className = `heading-collapser-btn heading-collapser-btn--level-${h.level} ${isCollapsed ? 'is-collapsed' : ''}`;
      btn.textContent = isCollapsed ? '▶' : '▼';
      btn.title = isCollapsed ? 'Expand' : 'Collapse';
      btn.contentEditable = 'false';

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (collapsedPositions.has(h.key)) {
          collapsedPositions.delete(h.key);
        } else {
          collapsedPositions.add(h.key);
        }

        // Dispatch a no-op transaction with meta to trigger decoration rebuild
        if (view) {
          view.dispatch(view.state.tr.setMeta(collapserKey, 'toggle'));
        }
      });

      return btn;
    }, { side: -1 });

    decorations.push(widget);
  }

  // Hide content under collapsed headings
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (!collapsedPositions.has(h.key)) continue;

    const contentStart = h.endPos;
    let contentEnd = doc.content.size;

    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        contentEnd = headings[j].pos;
        break;
      }
    }

    // Add inline decorations to each top-level node in the collapsed range
    if (contentStart < contentEnd) {
      doc.nodesBetween(contentStart, contentEnd, (node: any, pos: number) => {
        if (pos >= contentStart && pos + node.nodeSize <= contentEnd) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: 'heading-collapsed-content',
              style: 'display: none;',
            })
          );
          return false; // Don't descend into children
        }
        return true;
      });
    }
  }

  return DecorationSet.create(doc, decorations);
}

export const HeadingCollapserExtension = Extension.create({
  name: 'headingCollapser',

  addProseMirrorPlugins() {
    let currentView: EditorView | null = null;

    return [
      new Plugin({
        key: collapserKey,
        state: {
          init(_: any, state: EditorState) {
            return buildDecorations(state.doc, null);
          },
          apply(tr: Transaction, oldSet: DecorationSet, _oldState: EditorState, newState: EditorState) {
            // Rebuild if doc changed or if we got a toggle meta
            if (tr.docChanged || tr.getMeta(collapserKey)) {
              return buildDecorations(newState.doc, currentView);
            }
            return oldSet;
          },
        },
        props: {
          decorations(state: EditorState) {
            return this.getState(state) || DecorationSet.empty;
          },
        },
        view(view: EditorView) {
          currentView = view;
          return {
            update(newView: EditorView) {
              currentView = newView;
              // Do NOT dispatch here — decorations are rebuilt in state.apply()
            },
            destroy() {
              currentView = null;
            },
          };
        },
      }),
    ];
  },
});
