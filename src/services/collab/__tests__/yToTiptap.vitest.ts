import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  yXmlFragmentToTiptapDoc,
  yXmlFragmentToNoteContent,
  tiptapDocToPlainText,
} from '../yToTiptap';

function fragment(): Y.XmlFragment {
  return new Y.Doc().getXmlFragment('content');
}

function paragraph(text: string, marks?: Record<string, Record<string, unknown>>): Y.XmlElement {
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text, marks);
  p.insert(0, [t]);
  return p;
}

describe('retour au stockage — Y.XmlFragment → JSON TipTap', () => {
  it('rend un document vide comme un doc sans contenu', () => {
    expect(yXmlFragmentToTiptapDoc(fragment())).toEqual({ type: 'doc', content: [] });
  });

  it('convertit un paragraphe simple', () => {
    const frag = fragment();
    frag.insert(0, [paragraph('bonjour')]);
    expect(yXmlFragmentToTiptapDoc(frag)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bonjour' }] }],
    });
  });

  it('reporte les marques, avec et sans attributs', () => {
    const frag = fragment();
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'gras', { bold: {} });
    t.insert(4, ' et lien', { link: { href: 'https://filarr.com' } });
    p.insert(0, [t]);
    frag.insert(0, [p]);

    const doc = yXmlFragmentToTiptapDoc(frag);
    const content = doc.content[0].content!;
    expect(content[0]).toEqual({ type: 'text', text: 'gras', marks: [{ type: 'bold' }] });
    expect(content[1]).toEqual({
      type: 'text',
      text: ' et lien',
      marks: [{ type: 'link', attrs: { href: 'https://filarr.com' } }],
    });
  });

  it('conserve les attributs d’un nœud personnalisé (base en ligne, transclusion…)', () => {
    const frag = fragment();
    const node = new Y.XmlElement('inlineDatabase');
    node.setAttribute('dbId', 'base-7');
    node.setAttribute('view', 'table');
    frag.insert(0, [node]);

    expect(yXmlFragmentToTiptapDoc(frag)).toEqual({
      type: 'doc',
      content: [{ type: 'inlineDatabase', attrs: { dbId: 'base-7', view: 'table' } }],
    });
  });

  it('descend dans les structures imbriquées', () => {
    const frag = fragment();
    const list = new Y.XmlElement('bulletList');
    const item = new Y.XmlElement('listItem');
    item.insert(0, [paragraph('un point')]);
    list.insert(0, [item]);
    frag.insert(0, [list]);

    const doc = yXmlFragmentToTiptapDoc(frag);
    expect(doc.content[0].type).toBe('bulletList');
    expect(doc.content[0].content![0].content![0].content![0]).toEqual({
      type: 'text',
      text: 'un point',
    });
  });

  it('sérialise dans la forme attendue par `Note.content` (une chaîne)', () => {
    const frag = fragment();
    frag.insert(0, [paragraph('à écrire dans notes.enc')]);
    const serialized = yXmlFragmentToNoteContent(frag);
    expect(typeof serialized).toBe('string');
    expect(JSON.parse(serialized)).toEqual(yXmlFragmentToTiptapDoc(frag));
  });

  it('extrait un texte brut indexable, sans recoller deux blocs', () => {
    const frag = fragment();
    frag.insert(0, [paragraph('premier bloc'), paragraph('second bloc')]);
    const text = tiptapDocToPlainText(yXmlFragmentToTiptapDoc(frag));
    expect(text).toBe('premier bloc\nsecond bloc');
  });

  it('survit à un fragment dont le contenu a été produit par une fusion CRDT', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const fa = a.getXmlFragment('content');
    const fb = b.getXmlFragment('content');
    fa.insert(0, [paragraph('venu du bureau')]);
    fb.insert(0, [paragraph('venu du navigateur')]);

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const textA = tiptapDocToPlainText(yXmlFragmentToTiptapDoc(fa));
    const textB = tiptapDocToPlainText(yXmlFragmentToTiptapDoc(fb));
    expect(textA).toBe(textB);
    expect(textA).toContain('venu du bureau');
    expect(textA).toContain('venu du navigateur');
  });
});
