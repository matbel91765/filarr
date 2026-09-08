/**
 * Quand faut-il convertir un collage en Markdown ?
 *
 * Se tromper dans un sens laisse un mur de texte à reformater ; dans l'autre,
 * une phrase collée se met à restructurer le document. Ces tests figent la
 * frontière — et surtout les cas où il ne faut PAS convertir, qui sont les plus
 * faciles à casser en élargissant la détection.
 */

import { describe, it, expect } from 'vitest';
import { hasRichHtml, looksLikeMarkdown } from '../markdownPaste';

describe('looksLikeMarkdown — ce qui doit être converti', () => {
  it('reconnaît les marqueurs de bloc', () => {
    expect(looksLikeMarkdown('## Titre\n\nSuite')).toBe(true);
    expect(looksLikeMarkdown('- un\n- deux')).toBe(true);
    expect(looksLikeMarkdown('1. un\n2. deux')).toBe(true);
    expect(looksLikeMarkdown('> une citation\nsuite')).toBe(true);
    expect(looksLikeMarkdown('| a | b |\n| --- | --- |')).toBe(true);
    expect(looksLikeMarkdown('texte\n\n---\n\nautre')).toBe(true);
  });

  it('accepte un titre ou un bloc de code seuls sur une ligne', () => {
    expect(looksLikeMarkdown('# Titre')).toBe(true);
    expect(looksLikeMarkdown('```js')).toBe(true);
  });
});

describe('looksLikeMarkdown — ce qui doit être laissé tranquille', () => {
  it('ne convertit pas une phrase, même avec du gras ou un lien', () => {
    // Le gras et les liens ne sont pas des marqueurs de BLOC : coller une
    // phrase ne doit pas restructurer le document.
    expect(looksLikeMarkdown('Voir **le rapport** et [le site](https://x.test)')).toBe(false);
  });

  it('ne convertit pas un « - todo » collé dans une liste existante', () => {
    // Une seule ligne commençant par un tiret : le convertir créerait une
    // liste dans la liste, exactement là où on voulait juste un item.
    expect(looksLikeMarkdown('- acheter du pain')).toBe(false);
  });

  it('ne convertit ni le vide, ni un mot, ni une URL seule', () => {
    expect(looksLikeMarkdown('')).toBe(false);
    expect(looksLikeMarkdown('  ')).toBe(false);
    expect(looksLikeMarkdown('ok')).toBe(false);
    expect(looksLikeMarkdown('https://exemple.test/page')).toBe(false);
  });

  it('ne prend pas un tiret cadratin pour un séparateur', () => {
    expect(looksLikeMarkdown('Une phrase\nUne autre — avec un tiret')).toBe(false);
  });

  it('ne prend pas une soustraction pour une puce', () => {
    expect(looksLikeMarkdown('total\n-42\n')).toBe(false);
  });
});

describe('hasRichHtml — laisser la main à ProseMirror', () => {
  it('reconnaît un HTML riche venu d une page web', () => {
    expect(hasRichHtml('<h1>Titre</h1><p>texte</p>')).toBe(true);
    expect(hasRichHtml('<ul><li>a</li></ul>')).toBe(true);
    expect(hasRichHtml('<table><tr><td>a</td></tr></table>')).toBe(true);
  });

  it('ne prend pas le HTML d un terminal pour du HTML riche', () => {
    // Un terminal ou un éditeur de code enveloppe le texte dans un <span> ou
    // un <pre> : s'en remettre à lui rendrait le collage Markdown inopérant
    // là où il sert le plus.
    expect(hasRichHtml('<span style="color:#fff">## Titre</span>')).toBe(false);
    expect(hasRichHtml('<pre>- un\n- deux</pre>')).toBe(false);
    expect(hasRichHtml('')).toBe(false);
    expect(hasRichHtml(null)).toBe(false);
  });
});
