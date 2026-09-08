/**
 * Insérer N colonnes doit produire UN bloc de N colonnes.
 *
 * Écrit en enquêtant sur des colonnes empilées verticalement : il fallait
 * savoir si le document portait bien quatre colonnes (défaut d'affichage) ou
 * si le bloc avait été défait à l'insertion (défaut de modèle). C'était bien
 * l'affichage — la grille était partie dans une règle CSS que deux des trois
 * surfaces d'édition n'appliquent pas. Le test reste : il ferme l'autre moitié
 * de la question pour de bon.
 */

import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { Node as PMNode } from '@tiptap/pm/model';
import { ColumnExtension, ColumnsExtension } from '../columnsExtension';

const schema = getSchema([StarterKit, ColumnsExtension, ColumnExtension]);

/** Ce que produit la commande `insertColumns(count)`. */
function insertColumnsJson(count: number) {
  return {
    type: 'columns',
    attrs: { count },
    content: Array.from({ length: count }, () => ({
      type: 'column',
      content: [{ type: 'paragraph' }],
    })),
  };
}

describe('insertColumns', () => {
  for (const count of [2, 3, 4]) {
    it(`${count} colonnes tiennent dans un seul bloc`, () => {
      const node = PMNode.fromJSON(schema, insertColumnsJson(count));
      expect(() => node.check()).not.toThrow();

      // Insertion réelle : ProseMirror « ajuste » la tranche insérée, et un
      // nœud qu'il refuserait serait défait en blocs de premier niveau — ce
      // qui ressemblerait, à l'écran, à des colonnes empilées.
      const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create());
      const state = EditorState.create({ doc, schema });
      const next = state.apply(state.tr.replaceSelectionWith(node));

      const blocks: string[] = [];
      next.doc.forEach((child) => blocks.push(child.type.name));
      expect(blocks).toContain('columns');
      expect(next.doc.child(blocks.indexOf('columns')).childCount).toBe(count);
    });
  }

  it('cinq colonnes sont refusées par le schéma', () => {
    expect(() => PMNode.fromJSON(schema, insertColumnsJson(5)).check()).toThrow();
  });
});
