/**
 * syntaxHighlight — UNE table de langages, pour l'aperçu ET pour l'éditeur.
 *
 * ── POURQUOI ELLE EST PARTAGÉE ─────────────────────────────────────────────
 * La correspondance extension → langage vivait dans `TextPreview`. Le jour où
 * l'éditeur de code a eu besoin de la même chose, la recopier aurait garanti
 * la divergence : un `.tsx` coloré en aperçu et en texte brut dans l'éditeur,
 * ou l'inverse, selon celui des deux qu'on aurait pensé à mettre à jour. C'est
 * exactement le motif qui a produit six copies du nombre 140 dans ce dépôt.
 *
 * L'enregistrement des langages vit ici AUSSI : `hljs` est un singleton de
 * module, et l'enregistrer depuis deux endroits fait dépendre le résultat de
 * l'ordre des imports.
 *
 * ── POURQUOI PAS `highlightAuto` ───────────────────────────────────────────
 * La détection automatique de highlight.js coûte cher (elle essaie tous les
 * langages) et se trompe sur les fichiers courts. L'extension est une donnée
 * SÛRE que nous avons déjà : s'en servir est plus rapide et plus juste.
 */

import hljs from 'highlight.js/lib/core';

import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

let enregistre = false;

function enregistrerLangages(): void {
  if (enregistre) return;
  enregistre = true;
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('scss', scss);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('shell', bash);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('java', java);
  hljs.registerLanguage('csharp', csharp);
  hljs.registerLanguage('cpp', cpp);
  hljs.registerLanguage('c', cpp);
  hljs.registerLanguage('go', go);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('ruby', ruby);
  hljs.registerLanguage('php', php);
  hljs.registerLanguage('ini', ini);
  hljs.registerLanguage('dockerfile', dockerfile);
  hljs.registerLanguage('makefile', makefile);
  hljs.registerLanguage('diff', diff);
  hljs.registerLanguage('plaintext', plaintext);
}

enregistrerLangages();

/**
 * Extension → langage highlight.js.
 *
 * Les clés sont SANS point et en minuscules. `dockerfile`, `makefile` et
 * `gitignore` y figurent bien qu'ils soient des NOMS de fichier : l'appelant
 * passe le dernier segment, et pour `Dockerfile` c'est le nom entier.
 */
export const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  bat: 'bash',
  sql: 'sql',
  java: 'java',
  cs: 'csharp',
  cpp: 'cpp',
  cc: 'cpp',
  c: 'c',
  h: 'cpp',
  hpp: 'cpp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  ini: 'ini',
  conf: 'ini',
  toml: 'ini',
  env: 'ini',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  diff: 'diff',
  patch: 'diff',
  txt: 'plaintext',
  log: 'plaintext',
  csv: 'plaintext',
  tsv: 'plaintext',
  gitignore: 'plaintext',
};

/** Le langage d'une extension — `plaintext` quand on ne sait pas. */
export function languageForExtension(extension: string): string {
  return EXTENSION_LANGUAGE_MAP[extension.toLowerCase().replace(/^\./, '')] ?? 'plaintext';
}

/** Le langage d'un NOM de fichier (gère `Dockerfile`, `.gitignore`, `a.b.ts`). */
export function languageForFileName(fileName: string): string {
  const nu = fileName.toLowerCase();
  if (EXTENSION_LANGUAGE_MAP[nu]) return EXTENSION_LANGUAGE_MAP[nu];
  const point = nu.lastIndexOf('.');
  // `.gitignore` est un NOM, pas une extension : le dernier segment d'un nom
  // qui commence par un point est le nom lui-même.
  const cle = point > 0 ? nu.slice(point + 1) : nu.replace(/^\./, '');
  return EXTENSION_LANGUAGE_MAP[cle] ?? 'plaintext';
}

const ECHAPPEMENTS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ECHAPPEMENTS[c]);
}

/**
 * Colorer, en HTML — et NE JAMAIS rendre du texte non échappé.
 *
 * `hljs.highlight` échappe déjà ce qu'il colore ; le repli, lui, doit
 * échapper à la main. Un repli qui rendrait le texte brut ferait de chaque
 * fichier ouvert une surface d'injection : il suffirait d'un `<img onerror>`
 * dans un `.log` pour exécuter du script dans le renderer.
 */
export function highlightToHtml(code: string, fileName: string): string {
  const langage = languageForFileName(fileName);
  if (langage === 'plaintext') return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: langage, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

export { hljs };
