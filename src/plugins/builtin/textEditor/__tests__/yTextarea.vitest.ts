import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';

/**
 * La liaison Y.Text ↔ textarea — la pièce qui rend un `.txt` de coffre
 * co-éditable. Deux propriétés portent tout : la saisie locale devient
 * l'ÉPISSURE MINIMALE exacte (un textarea n'en produit qu'une à la fois), et
 * une édition distante ne fait pas sauter le curseur sous la frappe.
 */

// Environnement node : un textarea minimal supporté par la liaison.
class FauxTextarea {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  private listeners = new Map<string, Array<() => void>>();
  addEventListener(type: string, fn: () => void) {
    const l = this.listeners.get(type) ?? [];
    l.push(fn);
    this.listeners.set(type, l);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn)
    );
  }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  /** Simule une frappe : nouvelle valeur + position de curseur + évènement. */
  taper(value: string, curseur: number) {
    this.value = value;
    this.selectionStart = this.selectionEnd = curseur;
    for (const fn of this.listeners.get('input') ?? []) fn();
  }
}

import { bindYTextToTextarea } from '../yTextarea';

let doc: Y.Doc;
let ytext: Y.Text;
let ta: FauxTextarea;

beforeEach(() => {
  doc = new Y.Doc();
  ytext = doc.getText('content');
  ta = new FauxTextarea();
});

describe('bindYTextToTextarea', () => {
  it('une frappe locale devient l’épissure minimale dans le Y.Text', () => {
    ytext.insert(0, 'bonjour monde');
    const b = bindYTextToTextarea(ytext, ta as unknown as HTMLTextAreaElement);
    expect(ta.value).toBe('bonjour monde');

    ta.taper('bonjour cher monde', 12);

    expect(ytext.toString()).toBe('bonjour cher monde');
    b.destroy();
  });

  it('un remplacement de sélection produit UNE suppression + UNE insertion', () => {
    ytext.insert(0, 'le chat dort');
    const b = bindYTextToTextarea(ytext, ta as unknown as HTMLTextAreaElement);

    ta.taper('le chien dort', 8);

    expect(ytext.toString()).toBe('le chien dort');
    b.destroy();
  });

  it('une édition distante AVANT le curseur le décale au lieu de le faire sauter', () => {
    ytext.insert(0, 'abcdef');
    const b = bindYTextToTextarea(ytext, ta as unknown as HTMLTextAreaElement);
    ta.setSelectionRange(4, 4); // le curseur est entre d et e

    // Un pair insère « XY » au tout début.
    ytext.insert(0, 'XY');

    expect(ta.value).toBe('XYabcdef');
    expect(ta.selectionStart).toBe(6); // toujours entre d et e
    b.destroy();
  });

  it('une édition distante APRÈS le curseur ne le bouge pas', () => {
    ytext.insert(0, 'abcdef');
    const b = bindYTextToTextarea(ytext, ta as unknown as HTMLTextAreaElement);
    ta.setSelectionRange(2, 2);

    ytext.insert(6, '!!!');

    expect(ta.value).toBe('abcdef!!!');
    expect(ta.selectionStart).toBe(2);
    b.destroy();
  });

  it('deux liaisons sur le même document convergent — la co-édition en miniature', () => {
    const doc2 = new Y.Doc();
    const ytext2 = doc2.getText('content');
    // Relais manuel : chaque mise à jour de l'un s'applique à l'autre.
    doc.on('update', (u: Uint8Array) => Y.applyUpdate(doc2, u));
    doc2.on('update', (u: Uint8Array) => Y.applyUpdate(doc, u));
    const ta2 = new FauxTextarea();
    const b1 = bindYTextToTextarea(ytext, ta as unknown as HTMLTextAreaElement);
    const b2 = bindYTextToTextarea(ytext2, ta2 as unknown as HTMLTextAreaElement);

    ta.taper('salut', 5);
    ta2.taper('salut !', 7);

    expect(ta.value).toBe('salut !');
    expect(ta2.value).toBe('salut !');
    b1.destroy();
    b2.destroy();
  });

  it('destroy débranche tout — plus aucun écho après démontage', () => {
    const b = bindYTextToTextarea(ytext, ta as unknown as HTMLTextAreaElement);
    b.destroy();

    ytext.insert(0, 'fantôme');

    expect(ta.value).toBe('');
  });
});
