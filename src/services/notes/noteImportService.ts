/**
 * Note Import Service — Filarr Notes
 *
 * Imports notes from external files:
 * - .filarr (JSON backup with full metadata + TipTap content)
 * - .md (Markdown → TipTap JSON)
 * - .html (HTML → TipTap JSON via DOMParser)
 * - .txt (plain text → TipTap paragraphs)
 */
import {
  imageNode,
  isHtmlBlockStart,
  isListStart,
  isMathFence,
  isTableStart,
  bookmarkNode,
  matchStandaloneImage,
  matchStandaloneLink,
  parseHtmlBlock,
  parseList,
  parseMathBlock,
  parseTable,
} from './markdownBlocks';
import type { MarkdownImportOptions } from './markdownBlocks';

import type { Note } from '../../types/notes';
import { createNote } from './noteService';

// ==================== Types ====================

export type { MarkdownImportOptions } from './markdownBlocks';

export type ImportFormat = 'filarr' | 'markdown' | 'html' | 'txt';

export interface ImportResult {
  note: Partial<Note>;
  format: ImportFormat;
}

// ==================== Format Detection ====================

export function detectFormat(filename: string): ImportFormat {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'filarr':
      return 'filarr';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'html':
    case 'htm':
      return 'html';
    default:
      return 'txt';
  }
}

// ==================== Markdown → TipTap JSON ====================

export interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

function parseInlineMarkdown(text: string): TipTapNode[] {
  const nodes: TipTapNode[] = [];
  // Regex handles: [[wiki-links]], ==highlight==, **bold**, *italic*, ~~strike~~, `code`, [link](url)
  // Order matters: wiki-links and highlights FIRST (more specific), then standard markdown
  const pattern =
    /(\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]|==(.+?)==|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`(.+?)`|\[([^\]]+?)\]\(([^)]+?)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // [[wiki-link]] or [[target|display]]
      // Keep as raw [[...]] text — Filarr's wikiLinkDecorationPlugin
      // detects these patterns and renders them as clickable chips
      const target = match[2];
      const alias = match[3];
      const raw = alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
      nodes.push({ type: 'text', text: raw });
    } else if (match[4]) {
      // ==highlight==
      nodes.push({ type: 'text', text: match[4], marks: [{ type: 'highlight' }] });
    } else if (match[5]) {
      // **bold**
      nodes.push({ type: 'text', text: match[5], marks: [{ type: 'bold' }] });
    } else if (match[6]) {
      // *italic*
      nodes.push({ type: 'text', text: match[6], marks: [{ type: 'italic' }] });
    } else if (match[7]) {
      // ~~strike~~
      nodes.push({ type: 'text', text: match[7], marks: [{ type: 'strike' }] });
    } else if (match[8]) {
      // `code`
      nodes.push({ type: 'text', text: match[8], marks: [{ type: 'code' }] });
    } else if (match[9] && match[10]) {
      // [text](url)
      nodes.push({
        type: 'text',
        text: match[9],
        marks: [{ type: 'link', attrs: { href: match[10] } }],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  if (nodes.length === 0 && text) {
    nodes.push({ type: 'text', text });
  }

  return nodes;
}

/**
 * Markdown -> document de note.
 *
 * `options.resolveAsset` est ce qui permet a un import d'archive (Notion,
 * Obsidian) de rapatrier ses images : sans lui, une image relative n'a aucun
 * fichier derriere elle et ne peut devenir qu'du texte.
 */
export function markdownToTipTap(
  md: string,
  options: MarkdownImportOptions = {}
): { title: string; doc: TipTapNode } {
  const lines = md.split('\n');
  const doc: TipTapNode = { type: 'doc', content: [] };
  // Numerote les pieces jointes de CETTE note : deux images d'une meme note ne
  // doivent pas partager un identifiant.
  let assetIndex = 0;
  let title = '';
  let i = 0;

  // Skip YAML front matter
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++; // skip closing ---
  }

  // Extract title from first H1
  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1 && !title) {
        title = text;
        i++;
        continue;
      }
      doc.content!.push({
        type: 'heading',
        attrs: { level },
        content: parseInlineMarkdown(text),
      });
      i++;
      continue;
    }

    // Code block
    const codeMatch = line.match(/^```(\w*)$/);
    if (codeMatch) {
      const lang = codeMatch[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      doc.content!.push({
        type: 'codeBlock',
        attrs: { language: lang },
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      doc.content!.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      doc.content!.push({
        type: 'blockquote',
        content: quoteLines.map((ql) => ({
          type: 'paragraph',
          content: parseInlineMarkdown(ql),
        })),
      });
      continue;
    }

    // Image seule sur sa ligne : la forme que produit un export d'archive.
    const image = matchStandaloneImage(line);
    if (image) {
      const node = imageNode(image.alt, image.href, assetIndex++, options);
      if (node) doc.content!.push(node as TipTapNode);
      i++;
      continue;
    }

    // Lien SEUL sur sa ligne : c'est la forme d'un bloc signet a l'export.
    // `options.linkAsBookmark` le demande explicitement — hors import
    // d'archive, un lien seul reste un lien.
    if (options.linkAsBookmark) {
      const link = matchStandaloneLink(line);
      if (link) {
        doc.content!.push(bookmarkNode(link.label, link.href) as TipTapNode);
        i++;
        continue;
      }
    }

    // Tableau Markdown (en-tete + ligne de separation).
    if (isTableStart(lines, i)) {
      const table = parseTable(lines, i, parseInlineMarkdown as never);
      doc.content!.push(table.node as TipTapNode);
      i = table.next;
      continue;
    }

    // Formule sur plusieurs lignes.
    if (isMathFence(line)) {
      const math = parseMathBlock(lines, i);
      doc.content!.push(math.node as TipTapNode);
      i = math.next;
      continue;
    }

    // Les deux seules balises HTML qu'un export Notion laisse passer.
    const htmlTag = isHtmlBlockStart(line);
    if (htmlTag) {
      const block = parseHtmlBlock(lines, i, htmlTag, parseInlineMarkdown as never);
      doc.content!.push(block.node as TipTapNode);
      i = block.next;
      continue;
    }

    // Listes (puces, numerotees, cases a cocher) AVEC leur imbrication.
    if (isListStart(line)) {
      const list = parseList(lines, i, parseInlineMarkdown as never);
      doc.content!.push(list.node as TipTapNode);
      i = list.next;
      continue;
    }

    // Task list
    const taskMatch = line.match(/^(\s*)- \[([ x])\] (.+)$/);
    if (taskMatch) {
      const items: TipTapNode[] = [];
      while (i < lines.length) {
        const tm = lines[i].match(/^(\s*)- \[([ x])\] (.+)$/);
        if (!tm) break;
        items.push({
          type: 'taskItem',
          attrs: { checked: tm[2] === 'x' },
          content: [{ type: 'paragraph', content: parseInlineMarkdown(tm[3]) }],
        });
        i++;
      }
      doc.content!.push({ type: 'taskList', content: items });
      continue;
    }

    // Unordered list
    if (/^\s*[-*+] /.test(line)) {
      const items: TipTapNode[] = [];
      while (i < lines.length && /^\s*[-*+] /.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*+] /, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineMarkdown(text) }],
        });
        i++;
      }
      doc.content!.push({ type: 'bulletList', content: items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const items: TipTapNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineMarkdown(text) }],
        });
        i++;
      }
      doc.content!.push({ type: 'orderedList', content: items });
      continue;
    }

    // Regular paragraph
    doc.content!.push({
      type: 'paragraph',
      content: parseInlineMarkdown(line),
    });
    i++;
  }

  return { title, doc };
}

// ==================== HTML → TipTap JSON ====================

export function htmlToTipTap(html: string): { title: string; doc: TipTapNode } {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, 'text/html');
  let title = '';

  // Try to get title from <title> or first <h1>
  const titleEl = parsed.querySelector('title');
  const h1El = parsed.querySelector('h1');
  title = h1El?.textContent || titleEl?.textContent || '';

  const body = parsed.body;
  const doc: TipTapNode = { type: 'doc', content: [] };

  // Compteur d'images embarquées : `fileId` doit rester unique DANS le
  // document. `Date.now()` seul ne suffit pas — plusieurs images d'un même
  // import tombent sur la même milliseconde.
  let importedImageCount = 0;

  function domToTipTap(el: Element): TipTapNode | null {
    const tag = el.tagName.toLowerCase();

    if (/^h[1-4]$/.test(tag)) {
      const level = parseInt(tag[1]);
      // Skip first h1 if it was used as title
      if (level === 1 && el === h1El && title) return null;
      return {
        type: 'heading',
        attrs: { level },
        content: inlineChildrenToNodes(el),
      };
    }

    if (tag === 'p') {
      return { type: 'paragraph', content: inlineChildrenToNodes(el) };
    }

    if (tag === 'ul') {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === 'li')
        .map((li) => ({
          type: 'listItem' as const,
          content: [{ type: 'paragraph' as const, content: inlineChildrenToNodes(li) }],
        }));
      return { type: 'bulletList', content: items };
    }

    if (tag === 'ol') {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === 'li')
        .map((li) => ({
          type: 'listItem' as const,
          content: [{ type: 'paragraph' as const, content: inlineChildrenToNodes(li) }],
        }));
      return { type: 'orderedList', content: items };
    }

    if (tag === 'blockquote') {
      const children = Array.from(el.children).map(domToTipTap).filter(Boolean) as TipTapNode[];
      if (children.length === 0) {
        children.push({ type: 'paragraph', content: inlineChildrenToNodes(el) });
      }
      return { type: 'blockquote', content: children };
    }

    if (tag === 'pre') {
      const codeEl = el.querySelector('code');
      const text = codeEl?.textContent || el.textContent || '';
      const langClass = codeEl?.className?.match(/language-(\w+)/);
      return {
        type: 'codeBlock',
        attrs: { language: langClass?.[1] || '' },
        content: [{ type: 'text', text }],
      };
    }

    if (tag === 'hr') {
      return { type: 'horizontalRule' };
    }

    if (tag === 'table') {
      const rows = Array.from(el.querySelectorAll('tr')).map((tr) => {
        const cells = Array.from(tr.children).map((cell) => {
          const isHeader = cell.tagName.toLowerCase() === 'th';
          return {
            type: isHeader ? 'tableHeader' : 'tableCell',
            content: [{ type: 'paragraph', content: inlineChildrenToNodes(cell) }],
          };
        });
        return { type: 'tableRow' as const, content: cells };
      });
      return { type: 'table', content: rows };
    }

    if (tag === 'img') {
      /**
       * PAS de nœud `image` : ce type N'EXISTE PAS dans le schéma de l'éditeur
       * (les images y sont des `fileEmbed`). ProseMirror ne l'ignore pas, il
       * le SUPPRIME au parse — l'image restait visible dans le JSON persisté
       * et à l'export, puis disparaissait définitivement dès que la note était
       * ouverte et qu'un seul caractère y était tapé (le write-back sérialise
       * le document parsé). Perte silencieuse, sans le moindre signal.
       *
       * Même prudence que le `parseHTML` de fileEmbedExtension sur `src` :
       * seules les data-URI d'IMAGE sont embarquées. Une URL distante serait
       * de toute façon bloquée par la CSP du renderer, et son chargement
       * ferait fuiter l'ouverture de la note vers cet hôte — on la conserve
       * donc comme LIEN, ce qui ne perd rien et n'appelle personne.
       */
      const src = el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || '';
      const width = Number.parseInt(el.getAttribute('width') || '', 10);

      if (/^data:image\//i.test(src)) {
        return {
          type: 'fileEmbed',
          attrs: {
            fileId: `imported-${Date.now()}-${importedImageCount++}`,
            fileName: alt || 'image',
            fileType: src.slice(5).split(/[;,]/)[0] || 'image/png',
            src,
            width: Number.isFinite(width) && width > 0 ? width : null,
          },
        };
      }

      if (!src) return alt ? { type: 'paragraph', content: [{ type: 'text', text: alt }] } : null;
      return {
        type: 'paragraph',
        content: [
          { type: 'text', text: alt || src, marks: [{ type: 'link', attrs: { href: src } }] },
        ],
      };
    }

    // Div or other block — try to recurse
    if (el.children.length > 0) {
      const children = Array.from(el.children).map(domToTipTap).filter(Boolean) as TipTapNode[];
      if (children.length > 0)
        return children.length === 1 ? children[0] : { type: 'doc', content: children };
    }

    // Fallback to paragraph
    const text = el.textContent?.trim();
    if (text) {
      return { type: 'paragraph', content: [{ type: 'text', text }] };
    }

    return null;
  }

  function inlineChildrenToNodes(el: Element | ChildNode): TipTapNode[] {
    const nodes: TipTapNode[] = [];
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent || '';
        if (text) nodes.push({ type: 'text', text });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as Element;
        const tag = childEl.tagName.toLowerCase();
        const innerNodes = inlineChildrenToNodes(childEl);

        const markMap: Record<string, string> = {
          strong: 'bold',
          b: 'bold',
          em: 'italic',
          i: 'italic',
          u: 'underline',
          s: 'strike',
          del: 'strike',
          code: 'code',
          mark: 'highlight',
        };

        if (markMap[tag]) {
          for (const n of innerNodes) {
            if (n.type === 'text') {
              n.marks = [...(n.marks || []), { type: markMap[tag] }];
            }
            nodes.push(n);
          }
        } else if (tag === 'a') {
          for (const n of innerNodes) {
            if (n.type === 'text') {
              n.marks = [
                ...(n.marks || []),
                { type: 'link', attrs: { href: childEl.getAttribute('href') || '' } },
              ];
            }
            nodes.push(n);
          }
        } else if (tag === 'br') {
          nodes.push({ type: 'hardBreak' });
        } else {
          nodes.push(...innerNodes);
        }
      }
    }
    return nodes;
  }

  for (const child of Array.from(body.children)) {
    const node = domToTipTap(child);
    if (node) {
      if (node.type === 'doc' && node.content) {
        doc.content!.push(...node.content);
      } else {
        doc.content!.push(node);
      }
    }
  }

  return { title, doc };
}

// ==================== Plain Text → TipTap JSON ====================

function textToTipTap(text: string): TipTapNode {
  const lines = text.split('\n');
  const content: TipTapNode[] = [];

  for (const line of lines) {
    if (line.trim()) {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
    } else {
      content.push({ type: 'paragraph' });
    }
  }

  return { type: 'doc', content };
}

// ==================== Import Functions ====================

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function extractPlainText(doc: TipTapNode): string {
  if (doc.text) return doc.text;
  if (!doc.content) return '';
  return doc.content.map(extractPlainText).join(doc.type === 'doc' ? '\n' : '');
}

export function importFromFilarr(content: string): ImportResult {
  const data = JSON.parse(content);
  if (!data.note) throw new Error('Invalid .filarr file: missing note data');

  return {
    format: 'filarr',
    note: {
      title: data.note.title || '',
      content: data.note.content || '',
      plainText: data.note.plainText || '',
      icon: data.note.icon,
      coverColor: data.note.coverColor,
      isPinned: data.note.isPinned || false,
      isDaily: data.note.isDaily || false,
      dailyDate: data.note.dailyDate,
      wordCount: data.note.wordCount || 0,
    },
  };
}

export function importFromMarkdown(content: string): ImportResult {
  const { title, doc } = markdownToTipTap(content);
  const plainText = extractPlainText(doc);

  return {
    format: 'markdown',
    note: {
      title: title || 'Imported Note',
      content: JSON.stringify(doc),
      plainText,
      wordCount: countWords(plainText),
    },
  };
}

export function importFromHtml(content: string): ImportResult {
  const { title, doc } = htmlToTipTap(content);
  const plainText = extractPlainText(doc);

  return {
    format: 'html',
    note: {
      title: title || 'Imported Note',
      content: JSON.stringify(doc),
      plainText,
      wordCount: countWords(plainText),
    },
  };
}

export function importFromText(content: string, filename: string): ImportResult {
  const doc = textToTipTap(content);
  const plainText = content;
  const title = filename.replace(/\.\w+$/, '').replace(/[_-]/g, ' ');

  return {
    format: 'txt',
    note: {
      title,
      content: JSON.stringify(doc),
      plainText,
      wordCount: countWords(plainText),
    },
  };
}

/**
 * Bulk import from a JSON file containing an array of pre-built notes.
 * Format: { notes: Note[] } or Note[]
 */
export function importBulkFromJson(content: string): Note[] {
  const data = JSON.parse(content);
  const rawNotes: Partial<Note>[] = Array.isArray(data) ? data : data.notes;
  if (!Array.isArray(rawNotes)) throw new Error('Invalid bulk JSON: expected array of notes');
  return rawNotes.map((n) => createNote(n));
}

/**
 * Import a note from a file. Returns partial Note data to be merged with createNote().
 */
export function importNoteFromFile(content: string, filename: string): Note {
  const format = detectFormat(filename);
  let result: ImportResult;

  switch (format) {
    case 'filarr':
      result = importFromFilarr(content);
      break;
    case 'markdown':
      result = importFromMarkdown(content);
      break;
    case 'html':
      result = importFromHtml(content);
      break;
    default:
      result = importFromText(content, filename);
  }

  return createNote(result.note);
}
