/**
 * Hiérarchie de la carte mentale — hypothèse secondaire de D8.
 *
 * Un titre H2 posé dans un encadré SANS H1 avant lui doit devenir enfant de
 * la racine et rester cliquable (`pos >= 0`, rang identique à celui du
 * sommaire). Si la pile de construction l'orphelinait, le nœud n'apparaîtrait
 * pas dans la carte et le clic ne pourrait jamais atteindre l'éditeur.
 */

import { describe, it, expect } from 'vitest';
import { buildMindMapTree } from '../MindMapView';

const doc = (content: unknown[]) => JSON.stringify({ type: 'doc', content });
const heading = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: text ? [{ type: 'text', text }] : [],
});
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const callout = (content: unknown[]) => ({ type: 'callout', attrs: { type: 'info' }, content });

describe('buildMindMapTree', () => {
  it('un H2 imbriqué dans un encadré, sans H1 avant lui, est enfant de la racine et cliquable', () => {
    const tree = buildMindMapTree(
      doc([para('intro'), callout([para('note'), heading(2, 'Dans l’encadré')]), para('fin')]),
      'Ma note'
    );
    expect(tree.children).toHaveLength(1);
    const h2 = tree.children[0];
    expect(h2.text).toBe('Dans l’encadré');
    expect(h2.level).toBe(2);
    expect(h2.pos).toBe(0);
    expect(h2.id).toBe('h-0');
  });

  it('le rang (pos) survit au filtrage des titres vides : le clic vise le titre affiché', () => {
    const tree = buildMindMapTree(
      doc([heading(1, ''), heading(1, 'Un'), callout([heading(2, 'Deux')]), heading(1, 'Trois')]),
      'Ma note'
    );
    const texts = tree.children.map((n) => [n.text, n.pos]);
    expect(texts).toEqual([
      ['Un', 1],
      ['Trois', 3],
    ]);
    expect(tree.children[0].children.map((n) => [n.text, n.pos])).toEqual([['Deux', 2]]);
  });

  it('un H1 après un H2 orphelin remonte au niveau de la racine', () => {
    const tree = buildMindMapTree(doc([heading(2, 'Orphelin'), heading(1, 'Chapitre')]), 'Ma note');
    expect(tree.children.map((n) => n.text)).toEqual(['Orphelin', 'Chapitre']);
    expect(tree.children[0].children).toHaveLength(0);
  });

  it('un H3 sous un H2 orphelin reste sous ce H2', () => {
    const tree = buildMindMapTree(
      doc([callout([heading(2, 'Section'), heading(3, 'Sous-section')])]),
      'Ma note'
    );
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].children.map((n) => n.text)).toEqual(['Sous-section']);
  });

  it('sans titre, seule la racine existe', () => {
    expect(buildMindMapTree(doc([para('rien')]), 'Ma note').children).toEqual([]);
  });
});
