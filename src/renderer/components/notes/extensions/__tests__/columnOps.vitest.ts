/**
 * Retirer une colonne ne doit JAMAIS avaler ce qu'elle contenait.
 *
 * C'est le seul risque réel de cette fonctionnalité : le bloc n'ayant eu
 * aucune commande jusqu'ici, tout ce qui est verrouillé ci-dessous est neuf —
 * et une fusion ratée fait disparaître du texte sans rien afficher.
 *
 * Montage sans DOM : `getSchema` donne le VRAI schéma (mêmes extensions que
 * l'éditeur de notes), donc les contraintes `column{2,4}` et `block+` sont
 * celles du produit, pas une imitation.
 */

import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { ColumnExtension, ColumnsExtension } from '../columnsExtension';
import {
  columnsWithExtra,
  columnsWithout,
  dissolvedContent,
  isEmptyColumn,
  MAX_COLUMNS,
} from '../columnOps';

const schema: Schema = getSchema([StarterKit, ColumnsExtension, ColumnExtension]);

/** Colonne portant un paragraphe par texte donné ; sans texte = colonne vide. */
function column(...texts: string[]): PMNode {
  const paragraphs = texts.length
    ? texts.map((t) => schema.nodes.paragraph.create(null, schema.text(t)))
    : [schema.nodes.paragraph.create()];
  return schema.nodes.column.create(null, paragraphs);
}

function columns(...cols: PMNode[]): PMNode {
  return schema.nodes.columns.create({ count: cols.length }, cols);
}

/** Tout le texte du nœud, dans l'ordre de lecture — le seul témoin qui compte. */
function textsOf(node: PMNode | null): string[] {
  const out: string[] = [];
  node?.descendants((child) => {
    if (child.isText && child.text) out.push(child.text);
  });
  return out;
}

describe('isEmptyColumn', () => {
  it('reconnaît la colonne neuve (un paragraphe vide)', () => {
    expect(isEmptyColumn(column())).toBe(true);
  });

  it('ne confond pas « vide » et « un seul mot »', () => {
    expect(isEmptyColumn(column('a'))).toBe(false);
  });
});

describe('columnsWithout', () => {
  it('verse le contenu de la colonne retirée dans la précédente', () => {
    const before = columns(column('gauche'), column('milieu'), column('droite'));
    const after = columnsWithout(before, 1);
    expect(after).not.toBeNull();
    expect(after!.childCount).toBe(2);
    // Rien de perdu, et l'ordre de lecture est conservé.
    expect(textsOf(after)).toEqual(['gauche', 'milieu', 'droite']);
    expect(textsOf(after!.child(0))).toEqual(['gauche', 'milieu']);
  });

  it('retirer la PREMIÈRE colonne verse dans la suivante', () => {
    const before = columns(column('un'), column('deux'), column('trois'));
    const after = columnsWithout(before, 0);
    expect(textsOf(after)).toEqual(['un', 'deux', 'trois']);
    expect(textsOf(after!.child(0))).toEqual(['un', 'deux']);
  });

  it('ne laisse pas de paragraphe fantôme quand la voisine est vide', () => {
    const before = columns(column(), column('texte'), column('autre'));
    const after = columnsWithout(before, 1);
    // La colonne d'accueil était vide : elle est REMPLACÉE, pas complétée.
    expect(after!.child(0).childCount).toBe(1);
    expect(textsOf(after!.child(0))).toEqual(['texte']);
  });

  it('met le compte à jour (c est lui qui dessine la grille)', () => {
    const after = columnsWithout(columns(column('a'), column('b'), column('c')), 2);
    expect(after!.attrs.count).toBe(2);
  });

  it('rend `null` à deux colonnes — il n en resterait qu une, interdite', () => {
    expect(columnsWithout(columns(column('a'), column('b')), 0)).toBeNull();
  });

  it('rend le bloc inchangé sur un indice hors bornes', () => {
    const before = columns(column('a'), column('b'), column('c'));
    expect(columnsWithout(before, 9)).toBe(before);
  });

  it('produit toujours un nœud VALIDE pour le schéma', () => {
    const after = columnsWithout(columns(column('a'), column('b'), column('c')), 1);
    expect(() => after!.check()).not.toThrow();
  });
});

describe('dissolvedContent', () => {
  it('rend tous les blocs à plat, dans l ordre de lecture', () => {
    const block = columns(column('a1', 'a2'), column('b1'));
    const fragment = dissolvedContent(block);
    expect(fragment.childCount).toBe(3);
    const texts: string[] = [];
    fragment.forEach((child) => child.descendants((n) => void (n.isText && texts.push(n.text!))));
    expect(texts).toEqual(['a1', 'a2', 'b1']);
  });
});

describe('columnsWithExtra', () => {
  it('ajoute une colonne vide et met le compte à jour', () => {
    const after = columnsWithExtra(columns(column('a'), column('b')));
    expect(after!.childCount).toBe(3);
    expect(after!.attrs.count).toBe(3);
    expect(isEmptyColumn(after!.child(2))).toBe(true);
    expect(() => after!.check()).not.toThrow();
  });

  it('refuse au-delà de la limite du schéma', () => {
    const full = columns(column('a'), column('b'), column('c'), column('d'));
    expect(full.childCount).toBe(MAX_COLUMNS);
    expect(columnsWithExtra(full)).toBeNull();
  });
});
