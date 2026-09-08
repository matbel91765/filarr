/**
 * Columns Extension — Filarr Notes
 *
 * Multi-column layout blocks (2 or 3 columns).
 * Each column is an editable content area.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { EditorState } from '@tiptap/pm/state';
import { ColumnsNodeView } from './ColumnsNodeView';
import { ColumnNodeView } from './ColumnNodeView';
import { columnsWithExtra, columnsWithout, dissolvedContent } from './columnOps';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      insertColumns: (count?: number) => ReturnType;
      /** Ajoute une colonne vide (4 au maximum). */
      addColumn: (pos?: number) => ReturnType;
      /** Retire une colonne ; son contenu rejoint la voisine. */
      removeColumn: (pos: number, index: number) => ReturnType;
      /** Défait la disposition en gardant tous les blocs, dans l'ordre. */
      dissolveColumns: (pos?: number) => ReturnType;
    };
  }
}

/**
 * Position du bloc `columns` visé : celle qu'on donne, ou celle qui enveloppe
 * la sélection. Rend `null` quand il n'y en a aucun — la commande sort alors
 * en `false`, ce que TipTap traduit par « pas applicable ici ».
 */
function columnsPosAt(state: EditorState, pos?: number): number | null {
  if (typeof pos === 'number') {
    return state.doc.nodeAt(pos)?.type.name === 'columns' ? pos : null;
  }
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'columns') return $from.before(depth);
  }
  return null;
}

// ==================== Column Container ====================

export const ColumnsExtension = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  defining: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      count: { default: 2 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-columns': '',
        class: `columns columns--${node.attrs.count}`,
        style: `display: grid; grid-template-columns: repeat(${node.attrs.count}, 1fr); gap: 16px;`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      insertColumns:
        (count = 2) =>
        ({ commands }) => {
          const cols = Array.from({ length: count }, () => ({
            type: 'column' as const,
            content: [{ type: 'paragraph' as const }],
          }));
          return commands.insertContent({
            type: this.name,
            attrs: { count },
            content: cols,
          });
        },

      addColumn:
        (pos?: number) =>
        ({ state, tr, dispatch }) => {
          const at = columnsPosAt(state, pos);
          if (at === null) return false;
          const node = state.doc.nodeAt(at);
          if (!node) return false;
          const next = columnsWithExtra(node);
          if (!next) return false; // déjà quatre colonnes
          if (dispatch) dispatch(tr.replaceWith(at, at + node.nodeSize, next));
          return true;
        },

      removeColumn:
        (pos: number, index: number) =>
        ({ state, tr, dispatch }) => {
          const at = columnsPosAt(state, pos);
          if (at === null) return false;
          const node = state.doc.nodeAt(at);
          if (!node) return false;
          // `null` = il ne resterait qu'une colonne : on dissout plutôt, ce qui
          // remet TOUT le contenu dans le fil au lieu d'en perdre la moitié.
          const next = columnsWithout(node, index);
          const replacement = next ?? dissolvedContent(node);
          if (dispatch) dispatch(tr.replaceWith(at, at + node.nodeSize, replacement));
          return true;
        },

      dissolveColumns:
        (pos?: number) =>
        ({ state, tr, dispatch }) => {
          const at = columnsPosAt(state, pos);
          if (at === null) return false;
          const node = state.doc.nodeAt(at);
          if (!node) return false;
          const content = dissolvedContent(node);
          if (content.childCount === 0) return false;
          if (dispatch) dispatch(tr.replaceWith(at, at + node.nodeSize, content));
          return true;
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnsNodeView as any);
  },
});

// ==================== Single Column ====================

export const ColumnExtension = Node.create({
  name: 'column',
  content: 'block+',
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-column': '',
        class: 'column',
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnNodeView as any);
  },
});
