/**
 * Blocs Markdown que le convertisseur de base ne savait pas lire.
 *
 * POURQUOI CE MODULE — un export Notion (« Markdown & CSV », le format
 * recommandé) contient massivement : des tableaux, des listes imbriquées, des
 * images vers un dossier d'assets, des encadrés rendus en `<aside>`, des
 * dépliants en `<details>`. Le convertisseur ne connaissait ni l'un ni
 * l'autre : chaque ligne tombait dans le cas « paragraphe », et le tableau
 * arrivait dans la note sous forme de barres verticales, l'encadré sous forme
 * de balise HTML nue. « Import Notion pas complet », littéralement.
 *
 * Tout est PUR ici (aucun DOM, aucun état) : c'est ce qui rend ces cas
 * testables un par un, et c'est aussi ce qui permet à l'import Obsidian d'en
 * profiter sans rien changer chez lui.
 */

export interface MdNode {
  type: string;
  content?: MdNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

/** Une pièce jointe de l'archive, déjà décodée en data-URI. */
export interface ResolvedAsset {
  /** `data:<mime>;base64,…` */
  src: string;
  fileName: string;
  mime: string;
}

export interface MarkdownImportOptions {
  /**
   * Résout un chemin relatif (`Page%20abc/schema.png`) en pièce jointe.
   * Absent, les images relatives restent du texte — jamais une balise vers un
   * fichier qui n'existe pas dans le coffre.
   */
  resolveAsset?: (href: string) => ResolvedAsset | null;
  /**
   * Un lien SEUL sur sa ligne devient un signet (bloc carte).
   *
   * Reserve aux imports d'archive : c'est la forme qu'un bloc signet prend a
   * l'export. Hors de ce contexte, transformer tout lien isole en carte serait
   * une decision prise a la place de l'utilisateur.
   */
  linkAsBookmark?: boolean;
}

/** Fabrique de texte inline, injectée pour éviter un cycle d'imports. */
export type InlineParser = (text: string) => MdNode[];

// ==================== Images ====================

/** `![alt](href)` seul sur sa ligne — la forme qu'un export produit. */
const STANDALONE_IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export function matchStandaloneImage(line: string): { alt: string; href: string } | null {
  const m = line.trim().match(STANDALONE_IMAGE);
  return m ? { alt: m[1], href: m[2] } : null;
}

/**
 * Image d'un export → nœud de note.
 *
 * Les octets sont EMBARQUÉS (data-URI) quand l'archive les fournit : ils
 * voyagent alors chiffrés dans la note, comme toute image de Filarr. Une URL
 * distante ne devient JAMAIS une image : la CSP du renderer la bloquerait, et
 * la charger ferait fuiter l'ouverture de la note vers cet hôte — elle devient
 * un lien, ce qui ne perd rien et n'appelle personne.
 */
export function imageNode(
  alt: string,
  href: string,
  index: number,
  options: MarkdownImportOptions
): MdNode | null {
  const asset = options.resolveAsset?.(href) ?? null;
  if (asset) {
    return {
      type: 'fileEmbed',
      attrs: {
        fileId: `imported-${index}`,
        fileName: alt || asset.fileName,
        fileType: asset.mime,
        src: asset.src,
        width: null,
      },
    };
  }

  if (/^data:image\//i.test(href)) {
    return {
      type: 'fileEmbed',
      attrs: {
        fileId: `imported-${index}`,
        fileName: alt || 'image',
        fileType: href.slice(5).split(/[;,]/)[0] || 'image/png',
        src: href,
        width: null,
      },
    };
  }

  if (/^https?:\/\//i.test(href)) {
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: alt || href, marks: [{ type: 'link', attrs: { href } }] }],
    };
  }

  // Chemin relatif dont l'archive ne porte pas le fichier : garder le texte
  // alternatif plutôt qu'un lien mort ou rien du tout.
  return alt ? { type: 'paragraph', content: [{ type: 'text', text: alt }] } : null;
}

// ==================== Signets ====================

/** `[titre](https://…)` ou `<https://…>` seul sur sa ligne. */
const STANDALONE_LINK = /^\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\s*$/;
const BARE_URL = /^<?(https?:\/\/[^\s<>]+)>?\s*$/;

export function matchStandaloneLink(line: string): { label: string; href: string } | null {
  const trimmed = line.trim();
  const linked = trimmed.match(STANDALONE_LINK);
  if (linked) return { label: linked[1], href: linked[2] };
  const bare = trimmed.match(BARE_URL);
  if (bare) return { label: '', href: bare[1] };
  return null;
}

/**
 * Lien seul sur sa ligne → SIGNET.
 *
 * C'est la forme qu'un bloc signet prend a l'export : Notion l'affiche en
 * carte, et il arrivait ici en simple texte souligne. Le titre connu est
 * conserve ; l'apercu, lui, se remplit a l'affichage (`fetched: false`) — on
 * n'appelle personne pendant un import.
 */
export function bookmarkNode(label: string, href: string): MdNode {
  let domain = '';
  try {
    domain = new URL(href).hostname.replace(/^www\./, '');
  } catch {
    domain = '';
  }
  return {
    type: 'bookmark',
    attrs: {
      url: href,
      title: label && label !== href ? label : '',
      description: '',
      image: '',
      favicon: '',
      domain,
      fetched: false,
    },
  };
}

// ==================== Tableaux ====================

const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const char of inner) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function isTableStart(lines: string[], i: number): boolean {
  return TABLE_ROW.test(lines[i] ?? '') && TABLE_SEPARATOR.test(lines[i + 1] ?? '');
}

/**
 * Tableau Markdown → nœud `table`.
 *
 * Les lignes suivantes plus courtes que l'en-tête sont COMPLÉTÉES par des
 * cellules vides : un tableau ProseMirror dont les rangées n'ont pas toutes le
 * même nombre de colonnes est invalide, et serait rejeté en bloc — donc perdu.
 */
export function parseTable(
  lines: string[],
  start: number,
  inline: InlineParser
): { node: MdNode; next: number } {
  const header = splitRow(lines[start]);
  const width = header.length;
  const rows: MdNode[] = [];

  const cell = (type: 'tableHeader' | 'tableCell', text: string): MdNode => ({
    type,
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [{ type: 'paragraph', ...(text ? { content: inline(text) } : {}) }],
  });

  rows.push({ type: 'tableRow', content: header.map((text) => cell('tableHeader', text)) });

  let i = start + 2; // en-tête + ligne de séparation
  while (i < lines.length && TABLE_ROW.test(lines[i])) {
    const cells = splitRow(lines[i]);
    const padded = Array.from({ length: width }, (_, c) => cells[c] ?? '');
    rows.push({ type: 'tableRow', content: padded.map((text) => cell('tableCell', text)) });
    i += 1;
  }

  return { node: { type: 'table', content: rows }, next: i };
}

// ==================== Listes imbriquées ====================

const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;

interface ListLine {
  indent: number;
  kind: 'bullet' | 'ordered' | 'task';
  checked: boolean;
  text: string;
}

function readListLine(line: string): ListLine | null {
  const task = line.match(TASK);
  if (task) {
    return {
      indent: task[1].length,
      kind: 'task',
      checked: task[2].toLowerCase() === 'x',
      text: task[3],
    };
  }
  const bullet = line.match(BULLET);
  if (bullet) {
    return { indent: bullet[1].length, kind: 'bullet', checked: false, text: bullet[2] };
  }
  const ordered = line.match(ORDERED);
  if (ordered) {
    return { indent: ordered[1].length, kind: 'ordered', checked: false, text: ordered[2] };
  }
  return null;
}

export function isListStart(line: string): boolean {
  return readListLine(line) !== null;
}

/**
 * Liste (éventuellement imbriquée) → nœud de liste.
 *
 * L'indentation était IGNORÉE : une arborescence à trois niveaux arrivait à
 * plat, et toute la hiérarchie d'un plan Notion disparaissait sans que rien ne
 * le signale. Une sous-liste devient ici un enfant de l'item du dessus, comme
 * ProseMirror l'attend.
 */
export function parseList(
  lines: string[],
  start: number,
  inline: InlineParser
): { node: MdNode; next: number } {
  const first = readListLine(lines[start]);
  if (!first) return { node: { type: 'paragraph' }, next: start + 1 };
  return buildList(lines, start, first.indent, inline);
}

function buildList(
  lines: string[],
  index: number,
  indent: number,
  inline: InlineParser
): { node: MdNode; next: number } {
  const kind = readListLine(lines[index])!.kind;
  const items: MdNode[] = [];
  let i = index;

  while (i < lines.length) {
    const parsed = readListLine(lines[i]);
    if (!parsed || parsed.indent < indent) break;
    // Un changement de nature au MEME niveau ferme la liste : une puce et une
    // case a cocher ne peuvent pas cohabiter dans le meme noeud.
    if (parsed.indent === indent && parsed.kind !== kind) break;

    if (parsed.indent > indent) {
      // Sous-liste : elle appartient au dernier item ouvert.
      const nested = buildList(lines, i, parsed.indent, inline);
      const parent = items[items.length - 1];
      if (parent?.content) parent.content.push(nested.node);
      else
        items.push({
          type: kind === 'task' ? 'taskItem' : 'listItem',
          content: [{ type: 'paragraph' }, nested.node],
        });
      i = nested.next;
      continue;
    }

    items.push({
      type: kind === 'task' ? 'taskItem' : 'listItem',
      ...(kind === 'task' ? { attrs: { checked: parsed.checked } } : {}),
      content: [{ type: 'paragraph', ...(parsed.text ? { content: inline(parsed.text) } : {}) }],
    });
    i += 1;
  }

  const type = kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList';
  return { node: { type, content: items }, next: i };
}

// ==================== HTML de Notion : encadrés et dépliants ====================

/** Retire les balises d'une portion HTML pour n'en garder que le texte. */
function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Bloc HTML ouvert par `<aside>` ou `<details>` — Notion n'en produit pas d'autres. */
export function isHtmlBlockStart(line: string): 'aside' | 'details' | null {
  const trimmed = line.trim().toLowerCase();
  if (trimmed.startsWith('<aside')) return 'aside';
  if (trimmed.startsWith('<details')) return 'details';
  return null;
}

/**
 * `<aside>` → encadré, `<details>` → bloc dépliable.
 *
 * Ce sont les deux seules balises que l'export Markdown de Notion laisse
 * passer telles quelles ; sans ce traitement, l'utilisateur retrouve
 * « <aside> 💡 ... </aside> » écrit en toutes lettres dans sa note.
 */
export function parseHtmlBlock(
  lines: string[],
  start: number,
  tag: 'aside' | 'details',
  inline: InlineParser
): { node: MdNode; next: number } {
  const closing = `</${tag}>`;
  const collected: string[] = [];
  let i = start;
  let depth = 0;

  while (i < lines.length) {
    const line = lines[i];
    depth += (line.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
    depth -= (line.match(new RegExp(closing, 'gi')) || []).length;
    collected.push(line);
    i += 1;
    if (depth <= 0) break;
  }

  const html = collected.join('\n');

  if (tag === 'details') {
    const summaryMatch = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const summary = stripTags(summaryMatch?.[1] ?? '') || 'Détails';
    const body = stripTags(html.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, ''));
    return {
      node: {
        // `toggleBlock`, PAS `toggle` : un type qui n'existe pas dans le schema
        // n'echoue pas, il est jete au parse — le bloc entier disparaitrait.
        type: 'toggleBlock',
        attrs: { open: false },
        content: [
          { type: 'toggleSummary', content: inline(summary) },
          { type: 'paragraph', ...(body ? { content: inline(body) } : {}) },
        ],
      },
      next: i,
    };
  }

  const body = stripTags(html);
  // Notion ouvre presque toujours un encadré par son emoji : il devient le
  // titre de l'encadré plutôt qu'un caractère perdu en tête de phrase.
  const emoji = body.match(/^(\p{Extended_Pictographic}️?)\s*/u);
  const text = emoji ? body.slice(emoji[0].length) : body;

  return {
    node: {
      type: 'callout',
      attrs: { type: 'info', collapsed: false, title: emoji ? emoji[1] : '' },
      content: [{ type: 'paragraph', ...(text ? { content: inline(text) } : {}) }],
    },
    next: i,
  };
}

// ==================== Mathématiques ====================

export function isMathFence(line: string): boolean {
  return line.trim() === '$$';
}

export function parseMathBlock(lines: string[], start: number): { node: MdNode; next: number } {
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && lines[i].trim() !== '$$') {
    body.push(lines[i]);
    i += 1;
  }
  return {
    node: { type: 'mathBlock', attrs: { latex: body.join('\n').trim() } },
    next: i + 1,
  };
}
