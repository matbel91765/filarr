/**
 * LA COLORATION — et l'échappement, qui compte davantage.
 *
 * Ce module produit du HTML qui part dans un `innerHTML`. Un repli qui rendrait
 * le texte brut ferait de chaque fichier ouvert une surface d'injection : il
 * suffirait d'un `<img onerror>` dans un `.log` pour exécuter du script dans le
 * renderer, qui manipule des octets déchiffrés. C'est le premier test du
 * fichier, et ce n'est pas un hasard.
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  highlightToHtml,
  languageForExtension,
  languageForFileName,
} from '../syntaxHighlight';

describe('l’échappement', () => {
  it('neutralise le balisage', () => {
    expect(escapeHtml('<img onerror="x">')).toBe('&lt;img onerror=&quot;x&quot;&gt;');
  });

  it('échappe même sur le chemin PLAINTEXT, où rien ne colore', () => {
    // `plaintext` court-circuite highlight.js : sans échappement explicite ici,
    // tout `.txt` et tout `.log` deviendraient une surface d'injection.
    const html = highlightToHtml('<script>alert(1)</script>', 'notes.txt');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('échappe aussi ce qu’il colore', () => {
    const html = highlightToHtml('const a = "<b>";', 'a.ts');
    expect(html).not.toContain('<b>');
  });

  it('ne laisse pas passer un fichier au langage INCONNU', () => {
    const html = highlightToHtml('<svg onload=1>', 'x.inconnu');
    expect(html).not.toContain('<svg');
  });
});

describe('le langage', () => {
  it('se déduit de l’extension, en ignorant la casse et le point', () => {
    expect(languageForExtension('TS')).toBe('typescript');
    expect(languageForExtension('.py')).toBe('python');
  });

  it('retombe sur plaintext plutôt que de deviner', () => {
    // La détection automatique de highlight.js se trompe sur les fichiers
    // courts ; l'extension est une donnée sûre qu'on a déjà.
    expect(languageForExtension('zzz')).toBe('plaintext');
  });

  it('reconnaît les NOMS de fichier qui ne sont pas des extensions', () => {
    expect(languageForFileName('Dockerfile')).toBe('dockerfile');
    expect(languageForFileName('Makefile')).toBe('makefile');
    expect(languageForFileName('.gitignore')).toBe('plaintext');
  });

  it('prend le DERNIER segment d’un nom composé', () => {
    expect(languageForFileName('composant.test.tsx')).toBe('typescript');
    expect(languageForFileName('archive.tar.gz')).toBe('plaintext');
  });

  it('colore vraiment quand il connaît le langage', () => {
    const html = highlightToHtml('const x = 1;', 'a.ts');
    expect(html).toContain('hljs-');
  });
});
