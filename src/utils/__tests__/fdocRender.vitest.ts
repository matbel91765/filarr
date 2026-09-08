/**
 * L'APERÇU D'UN DOCUMENT REÇU — et pourquoi la sûreté passe avant le rendu.
 *
 * Ce module produit du HTML pour un `innerHTML`, à partir d'un fichier que
 * l'utilisateur n'a pas forcément écrit : un `.fdoc` arrive par partage, par
 * coffre d'équipe, par import. Le renderer qui l'affiche manipule des octets
 * déchiffrés. C'est pour ça que les tests d'échappement viennent en premier —
 * un aperçu qui rend mal est gênant, un aperçu qui exécute est une brèche.
 */

import { describe, it, expect } from 'vitest';
import { renderFdoc } from '../fdocRender';

const fdoc = (content: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ format: 'fdoc', version: 3, content }));

const paragraphe = (texte: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text: texte, ...(marks ? { marks } : {}) }],
});

const doc = (...enfants: unknown[]) => ({ type: 'doc', content: enfants });

describe('la sûreté', () => {
  it('échappe le texte du document', () => {
    const html = renderFdoc(fdoc(doc(paragraphe('<script>alert(1)</script>'))))!.html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('REFUSE une image distante — ce serait un pixel espion', () => {
    // Une URL distante ferait de chaque ouverture une fuite d'IP et d'heure de
    // lecture vers un tiers. Le schéma du greffon l'interdit déjà, mais un
    // fichier fabriqué à la main n'est jamais passé par cette garde.
    const html = renderFdoc(
      fdoc(doc({ type: 'image', attrs: { src: 'https://tiers.example/p.gif' } }))
    )!.html;
    expect(html).toBe('');
  });

  it('accepte une image en data:', () => {
    const html = renderFdoc(
      fdoc(doc({ type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'x' } }))
    )!.html;
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
  });

  it('échappe les attributs d’image', () => {
    const html = renderFdoc(
      fdoc(doc({ type: 'image', attrs: { src: 'data:image/png;base64,AA', alt: '"><script>' } }))
    )!.html;
    expect(html).not.toContain('<script>');
  });

  it('ne rend pas un lien CLIQUABLE', () => {
    // Un aperçu ne navigue pas, et une URL cliquable dans un document reçu est
    // une surface de hameçonnage que rien ici ne peut vérifier.
    const html = renderFdoc(
      fdoc(doc(paragraphe('cliquez', [{ type: 'link', attrs: { href: 'https://x' } }])))
    )!.html;
    expect(html).not.toContain('href');
    expect(html).toContain('cliquez');
  });

  it('survit à un arbre profondément imbriqué', () => {
    // Une récursion sans garde ferait tomber l'onglet sur un fichier fabriqué.
    let noeud: unknown = { type: 'paragraph', content: [{ type: 'text', text: 'fond' }] };
    for (let i = 0; i < 500; i += 1) noeud = { type: 'blockquote', content: [noeud] };
    expect(() => renderFdoc(fdoc(doc(noeud)))).not.toThrow();
  });
});

describe('le rendu', () => {
  it('rend les titres à leur niveau', () => {
    const html = renderFdoc(
      fdoc(doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'T' }] }))
    )!.html;
    expect(html).toBe('<h2>T</h2>');
  });

  it('borne un niveau de titre aberrant plutôt que d’émettre <h99>', () => {
    const html = renderFdoc(
      fdoc(doc({ type: 'heading', attrs: { level: 99 }, content: [{ type: 'text', text: 'T' }] }))
    )!.html;
    expect(html).toBe('<h1>T</h1>');
  });

  it('applique les marques de l’intérieur vers l’extérieur', () => {
    const html = renderFdoc(
      fdoc(doc(paragraphe('gras', [{ type: 'bold' }, { type: 'italic' }])))
    )!.html;
    expect(html).toBe('<p><em><strong>gras</strong></em></p>');
  });

  it('rend listes, citations, tableaux et séparateurs', () => {
    const html = renderFdoc(
      fdoc(
        doc(
          { type: 'bulletList', content: [{ type: 'listItem', content: [paragraphe('a')] }] },
          { type: 'horizontalRule' },
          {
            type: 'table',
            content: [
              { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraphe('c')] }] },
            ],
          }
        )
      )
    )!.html;
    expect(html).toContain('<ul><li><p>a</p></li></ul>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<table><tr><td><p>c</p></td></tr></table>');
  });

  it('rend les enfants d’un type INCONNU plutôt qu’un trou', () => {
    // Un document écrit par une version plus récente doit rester lisible :
    // mieux vaut du texte sans sa mise en forme qu'une page blanche.
    const html = renderFdoc(
      fdoc(doc({ type: 'futurBloc2027', content: [paragraphe('toujours là')] }))
    )!.html;
    expect(html).toContain('toujours là');
  });

  it('compte les mots', () => {
    expect(renderFdoc(fdoc(doc(paragraphe('un deux trois'))))!.mots).toBe(3);
  });
});

describe('le refus', () => {
  it('rend null sur ce qui n’est pas un fdoc', () => {
    expect(renderFdoc(new TextEncoder().encode('{"format":"autre"}'))).toBeNull();
    expect(renderFdoc(new TextEncoder().encode('pas du json'))).toBeNull();
    expect(renderFdoc(new Uint8Array([0xff, 0xfe]))).toBeNull();
  });
});
