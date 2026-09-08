/**
 * fdocRender — lire un `.fdoc` sans l'éditeur qui l'a écrit.
 *
 * ── POURQUOI CE MODULE EXISTE ──────────────────────────────────────────────
 * `.fdoc` est le SEUL format que ce produit possède, et c'était le seul sans
 * aperçu : le panneau latéral répondait « Aperçu non disponible » au document
 * natif de Filarr. Ouvrir l'éditeur complet pour lire trois lignes est
 * disproportionné — et impossible dans les contextes où l'aperçu sert
 * justement à ne pas ouvrir (survol, panneau adossé, coup d'œil rapide).
 *
 * ── POURQUOI PAS TIPTAP EN LECTURE SEULE ───────────────────────────────────
 * Le rendu de l'éditeur vit dans le greffon vendorisé, avec ses ~40 extensions
 * et son ProseMirror. L'importer dans l'aperçu ferait entrer tout cela dans le
 * bundle du cœur pour afficher du texte statique. Un parcours de l'arbre JSON
 * suffit : le `.fdoc` est un document ProseMirror sérialisé, sa forme est
 * connue et stable (voir fdoc.ts du greffon).
 *
 * ── LA RÈGLE DE SÛRETÉ, ET ELLE EST ABSOLUE ────────────────────────────────
 * Ce module produit du HTML destiné à un `innerHTML`, à partir d'un fichier
 * que l'utilisateur n'a pas forcément écrit. TOUT texte est échappé, sans
 * exception, et les seuls attributs émis sont ceux d'une liste blanche. Un
 * `.fdoc` reçu par partage ne doit pas pouvoir exécuter de script dans un
 * renderer qui manipule des octets déchiffrés.
 *
 * Les images en sont l'exemple : le schéma du greffon impose déjà `data:` à
 * la source, mais l'aperçu ne peut pas s'appuyer sur une garde qui vit
 * ailleurs — un fichier fabriqué à la main n'est jamais passé par elle.
 */

const ECHAPPEMENTS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function echapper(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => ECHAPPEMENTS[c]);
}

interface NoeudPM {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: unknown;
  marks?: unknown;
}

/** Les marques de texte, et la balise qu'elles produisent. */
const MARQUES: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
  superscript: 'sup',
  subscript: 'sub',
};

/** Les nœuds de bloc, et leur balise. */
const BLOCS: Record<string, string> = {
  paragraph: 'p',
  blockquote: 'blockquote',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  taskList: 'ul',
  taskItem: 'li',
  table: 'table',
  tableRow: 'tr',
  tableCell: 'td',
  tableHeader: 'th',
};

function estTableau(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function rendreTexte(noeud: NoeudPM): string {
  const brut = typeof noeud.text === 'string' ? noeud.text : '';
  let html = echapper(brut);
  if (!estTableau(noeud.marks)) return html;
  // Les marques s'appliquent de l'INTÉRIEUR vers l'extérieur : la première du
  // tableau est la plus proche du texte.
  for (const marque of noeud.marks) {
    const nom = (marque as { type?: unknown })?.type;
    if (typeof nom !== 'string') continue;
    if (nom === 'link') {
      // Le lien perd son `href` : un aperçu ne navigue pas, et laisser une URL
      // cliquable dans un document reçu ouvrirait une surface de hameçonnage
      // que rien ici ne peut vérifier. Le texte, lui, reste souligné.
      html = `<u>${html}</u>`;
      continue;
    }
    const balise = MARQUES[nom];
    if (balise) html = `<${balise}>${html}</${balise}>`;
  }
  return html;
}

function rendreNoeud(noeud: unknown, profondeur: number): string {
  // Une profondeur bornée : un `.fdoc` fabriqué à la main peut porter un arbre
  // arbitrairement imbriqué, et une récursion sans garde fait tomber l'onglet.
  if (profondeur > 50 || !noeud || typeof noeud !== 'object') return '';
  const n = noeud as NoeudPM;
  const type = typeof n.type === 'string' ? n.type : '';

  if (type === 'text') return rendreTexte(n);
  if (type === 'hardBreak') return '<br>';
  if (type === 'horizontalRule') return '<hr>';

  const enfants = estTableau(n.content)
    ? n.content.map((c) => rendreNoeud(c, profondeur + 1)).join('')
    : '';

  if (type === 'doc') return enfants;

  if (type === 'heading') {
    const niveau = (n.attrs as { level?: unknown })?.level;
    const h = typeof niveau === 'number' && niveau >= 1 && niveau <= 6 ? niveau : 1;
    return `<h${h}>${enfants}</h${h}>`;
  }

  if (type === 'codeBlock') return `<pre><code>${enfants}</code></pre>`;

  if (type === 'image') {
    const src = (n.attrs as { src?: unknown })?.src;
    // `data:image/` UNIQUEMENT. Le schéma du greffon l'impose déjà, mais
    // l'aperçu ne peut pas s'y fier : un fichier fabriqué à la main n'est
    // jamais passé par cette garde, et une URL distante ferait de chaque
    // ouverture un pixel espion — fuite d'IP et d'heure de lecture.
    if (typeof src !== 'string' || !src.startsWith('data:image/')) return '';
    const alt = (n.attrs as { alt?: unknown })?.alt;
    return `<img src="${echapper(src)}" alt="${echapper(typeof alt === 'string' ? alt : '')}">`;
  }

  const balise = BLOCS[type];
  if (balise) return `<${balise}>${enfants}</${balise}>`;

  // Un type INCONNU (document écrit par une version plus récente) rend quand
  // même ses enfants : mieux vaut du texte sans sa mise en forme qu'un trou.
  return enfants;
}

export interface FdocApercu {
  html: string;
  /** Le nombre de mots, pour la ligne d'information de l'aperçu. */
  mots: number;
}

/**
 * Rendre un `.fdoc` en HTML de lecture. `null` quand les octets ne sont pas un
 * `.fdoc` — jamais un rendu approximatif.
 */
export function renderFdoc(bytes: Uint8Array): FdocApercu | null {
  let enveloppe: unknown;
  try {
    enveloppe = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  const env = enveloppe as { format?: unknown; content?: unknown };
  if (env?.format !== 'fdoc' || !env.content || typeof env.content !== 'object') return null;

  const html = rendreNoeud(env.content, 0);
  const texte = html.replace(/<[^>]*>/g, ' ');
  const mots = texte.split(/\s+/).filter((m) => m.length > 0).length;
  return { html, mots };
}
