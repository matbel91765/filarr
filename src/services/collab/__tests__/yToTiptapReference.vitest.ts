/**
 * Contrôle croisé du retour au stockage.
 *
 * `yToTiptap` est écrit à la main. La seule preuve qui vaille, c'est de le
 * confronter à l'implémentation employée par l'extension `Collaboration`
 * (`yXmlFragmentToProsemirrorJSON` de `@tiptap/y-tiptap`) : si les deux
 * divergent, une note relue depuis le CRDT ne serait plus le document que
 * l'éditeur affichait.
 *
 * DEUX ÉCARTS SONT VOULUS, et testés comme tels plus bas :
 *
 *  1. `attrs` vide — la référence pose toujours `mark.attrs`, y compris `{}`
 *     (son garde `if (Object.keys(attrs))` teste un tableau, toujours vrai).
 *     Nous suivons la forme canonique de ProseMirror, qui est aussi celle que
 *     `editor.getJSON()` écrit déjà dans `notes.enc` hors session : une même
 *     note doit se sérialiser pareil quel que soit le chemin d'écriture.
 *  2. Racine — la référence ne met pas les éléments de premier niveau à plat,
 *     donc un `Y.XmlText` posé directement à la racine produirait chez elle un
 *     tableau imbriqué (JSON ProseMirror invalide). Nous aplatissons.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { yXmlFragmentToTiptapDoc, type TiptapNode } from '../yToTiptap';

/** Retire les `attrs: {}` que la référence ajoute, pour comparer le reste. */
function stripEmptyMarkAttrs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripEmptyMarkAttrs);
  if (!node || typeof node !== 'object') return node;
  const copy: Record<string, unknown> = { ...(node as Record<string, unknown>) };
  if (Array.isArray(copy.marks)) {
    copy.marks = copy.marks.map((m) => {
      const mark = { ...(m as Record<string, unknown>) };
      if (mark.attrs && Object.keys(mark.attrs as object).length === 0) delete mark.attrs;
      return mark;
    });
  }
  if (Array.isArray(copy.content)) copy.content = copy.content.map(stripEmptyMarkAttrs);
  return copy;
}

function build(): Y.XmlFragment {
  const frag = new Y.Doc().getXmlFragment('content');

  const heading = new Y.XmlElement('heading');
  heading.setAttribute('level', '2');
  const ht = new Y.XmlText();
  ht.insert(0, 'Un titre');
  heading.insert(0, [ht]);

  const para = new Y.XmlElement('paragraph');
  const pt = new Y.XmlText();
  pt.insert(0, 'du texte ');
  pt.insert(9, 'en gras', { bold: {} });
  pt.insert(16, ' puis un ');
  pt.insert(25, 'lien', { link: { href: 'https://filarr.com', target: '_blank' } });
  para.insert(0, [pt]);

  const list = new Y.XmlElement('bulletList');
  const item = new Y.XmlElement('listItem');
  const ip = new Y.XmlElement('paragraph');
  const it = new Y.XmlText();
  it.insert(0, 'un point');
  ip.insert(0, [it]);
  item.insert(0, [ip]);
  list.insert(0, [item]);

  const custom = new Y.XmlElement('inlineDatabase');
  custom.setAttribute('dbId', 'base-7');

  const vide = new Y.XmlElement('paragraph');

  frag.insert(0, [heading, para, list, custom, vide]);
  return frag;
}

describe('retour au stockage — confronté à l’implémentation de référence', () => {
  it('produit le même document (aux `attrs` vides près)', () => {
    const frag = build();
    expect(yXmlFragmentToTiptapDoc(frag)).toEqual(
      stripEmptyMarkAttrs(yXmlFragmentToProsemirrorJSON(frag))
    );
  });

  it('sur un fragment vide aussi', () => {
    const frag = new Y.Doc().getXmlFragment('content');
    expect(yXmlFragmentToTiptapDoc(frag)).toEqual(yXmlFragmentToProsemirrorJSON(frag));
  });

  it('omet `attrs` quand la marque n’en a pas — forme canonique de ProseMirror', () => {
    const frag = new Y.Doc().getXmlFragment('content');
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'gras', { bold: {} });
    p.insert(0, [t]);
    frag.insert(0, [p]);

    const mark = yXmlFragmentToTiptapDoc(frag).content[0].content![0].marks![0];
    expect(mark).toEqual({ type: 'bold' });
    expect('attrs' in mark).toBe(false);
  });

  it('retire l’empreinte des marques chevauchantes (`comment--aB3dEf90` → `comment`)', () => {
    // C'est ainsi que @tiptap/y-tiptap encode une marque déclarée `excludes: ''` :
    // sans ce retrait, la note relue porterait un type absent du schéma.
    const frag = new Y.Doc().getXmlFragment('content');
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'annoté', {
      'comment--aB3dEf90': { id: 'c1' },
      'comment--Zz09+/aB': { id: 'c2' },
      bold: {},
    });
    p.insert(0, [t]);
    frag.insert(0, [p]);

    const marks = yXmlFragmentToTiptapDoc(frag).content[0].content![0].marks!;
    expect(marks).toContainEqual({ type: 'comment', attrs: { id: 'c1' } });
    expect(marks).toContainEqual({ type: 'comment', attrs: { id: 'c2' } });
    expect(marks).toContainEqual({ type: 'bold' });
    // Aucune empreinte ne survit dans le nom de marque écrit en base.
    expect(marks.every((m) => !m.type.includes('--'))).toBe(true);
  });

  it('met la racine à plat là où la référence produirait un tableau imbriqué', () => {
    const frag = new Y.Doc().getXmlFragment('content');
    const t = new Y.XmlText();
    t.insert(0, 'texte nu à la racine');
    frag.insert(0, [t]);

    const content = yXmlFragmentToTiptapDoc(frag).content as TiptapNode[];
    expect(content).toEqual([{ type: 'text', text: 'texte nu à la racine' }]);
    expect(Array.isArray(content[0])).toBe(false);
  });
});
