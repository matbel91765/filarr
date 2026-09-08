/**
 * Coller du Markdown dans une note.
 *
 * Coller un extrait de README, une réponse d'assistant ou un bout de
 * documentation déposait jusqu'ici un mur de texte : les `##`, les `- `, les
 * `|` et les blocs de code restaient tels quels, à reformater à la main.
 *
 * La décision délicate n'est pas la conversion — `markdownToTipTap` sait déjà
 * la faire — c'est de savoir QUAND l'appliquer. Se tromper dans un sens laisse
 * du texte brut, dans l'autre transforme une phrase innocente en titre. D'où
 * une exigence : il faut un marqueur de BLOC reconnaissable, pas seulement du
 * gras ou un lien au fil du texte.
 */

/** Un marqueur de bloc en début de ligne, seul signal fiable. */
const BLOCK_MARKERS: RegExp[] = [
  /^\s{0,3}#{1,6}\s+\S/m, // titre
  /^\s{0,3}[-*+]\s+\S/m, // puce
  /^\s{0,3}\d+[.)]\s+\S/m, // liste numérotée
  /^\s{0,3}>\s+\S/m, // citation
  /^\s{0,3}```/m, // bloc de code
  /^\s{0,3}\|.+\|\s*$/m, // tableau
  /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/m, // séparateur
  /^\s{0,3}!\[[^\]]*\]\([^)]+\)\s*$/m, // image seule
];

/**
 * Ce texte mérite-t-il d'être converti ?
 *
 * Deux garde-fous délibérés :
 *  - un marqueur de bloc EST exigé. « **gras** » ou « [lien](url) » au milieu
 *    d'une phrase ne suffisent pas : coller une phrase ne doit pas restructurer
 *    le document ;
 *  - un tiret unique en tête d'un texte d'une seule ligne ne compte pas. C'est
 *    le cas du « - todo » qu'on colle dans une liste existante, et le convertir
 *    y créerait une liste dans la liste.
 */
export function looksLikeMarkdown(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;

  const lines = trimmed.split('\n');
  if (lines.length === 1) {
    // Une seule ligne : seuls un titre, un bloc de code ou une image sont
    // assez explicites pour justifier une conversion.
    return /^\s{0,3}#{1,6}\s+\S/.test(trimmed) || /^\s{0,3}```/.test(trimmed);
  }

  return BLOCK_MARKERS.some((marker) => marker.test(trimmed));
}

/**
 * Le presse-papiers porte-t-il un HTML riche ?
 *
 * Copier depuis une page web ou un traitement de texte fournit du `text/html`
 * que ProseMirror sait déjà lire, et bien mieux que nous : dans ce cas on ne
 * touche à rien. Un `text/html` réduit à un `<span>` ou un `<pre>` (ce que
 * produisent les terminaux et beaucoup d'éditeurs de code) n'est PAS du HTML
 * riche — s'en remettre à lui rendrait le collage Markdown inopérant là où il
 * sert le plus.
 */
export function hasRichHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  return /<(h[1-6]|ul|ol|li|table|blockquote|img|a\s)/i.test(html);
}
