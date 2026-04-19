/**
 * Note Export Service — Filarr Notes
 *
 * Pure functions returning Blob/Uint8Array for multi-format export.
 * Formats: Markdown, HTML, PDF, DOCX, Filarr (JSON).
 *
 * Uses TipTap JSON content (note.content) for rich export with
 * formatting, headings, lists, code blocks, etc.
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import jsPDF from 'jspdf';
import type { Note } from '../../types/notes';

// ==================== Types ====================

export type ExportFormat = 'markdown' | 'html' | 'pdf' | 'docx' | 'filarr';

export interface ExportOptions {
  format: ExportFormat;
  includeMetadata?: boolean;
  includeLinks?: boolean;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

// ==================== TipTap JSON Types ====================

interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
}

// ==================== Helpers ====================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFilename(title: string): string {
  return (title || 'untitled')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function parseTipTapContent(content: string): TipTapNode | null {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ==================== TipTap JSON → Markdown ====================

function marksToMd(text: string, marks?: TipTapMark[]): string {
  if (!marks || marks.length === 0) return text;
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        result = `**${result}**`;
        break;
      case 'italic':
      case 'em':
        result = `*${result}*`;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'link':
        result = `[${result}](${(mark.attrs?.href as string) || ''})`;
        break;
      case 'highlight':
        result = `==${result}==`;
        break;
    }
  }
  return result;
}

function inlineContentToMd(nodes?: TipTapNode[]): string {
  if (!nodes) return '';
  return nodes
    .map((node) => {
      if (node.type === 'text') {
        return marksToMd(node.text || '', node.marks);
      }
      if (node.type === 'hardBreak') return '\n';
      if (node.type === 'mathInline') return `$${node.attrs?.content || ''}$`;
      return inlineContentToMd(node.content);
    })
    .join('');
}

function nodeToMarkdown(node: TipTapNode, indent: string = ''): string {
  switch (node.type) {
    case 'doc':
      return (node.content || []).map((c) => nodeToMarkdown(c, indent)).join('\n\n');

    case 'paragraph':
      return indent + inlineContentToMd(node.content);

    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
      const prefix = '#'.repeat(level);
      return `${prefix} ${inlineContentToMd(node.content)}`;
    }

    case 'bulletList':
      return (node.content || []).map((item) => nodeToMarkdown(item, indent)).join('\n');

    case 'orderedList':
      return (node.content || [])
        .map((item, i) => {
          const start = ((node.attrs?.start as number) || 1) + i;
          return nodeToMarkdown(item, indent).replace(
            new RegExp(`^${indent}- `),
            `${indent}${start}. `
          );
        })
        .join('\n');

    case 'listItem':
      return (node.content || [])
        .map((child, i) => {
          const md = nodeToMarkdown(child, indent + '  ');
          if (i === 0) return `${indent}- ${md.trimStart()}`;
          return md;
        })
        .join('\n');

    case 'taskList':
      return (node.content || []).map((item) => nodeToMarkdown(item, indent)).join('\n');

    case 'taskItem': {
      const checked = node.attrs?.checked ? 'x' : ' ';
      const content = (node.content || [])
        .map((child) => nodeToMarkdown(child, indent + '  '))
        .join('\n');
      return `${indent}- [${checked}] ${content.trimStart()}`;
    }

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) || '';
      const code = (node.content || []).map((c) => c.text || '').join('');
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case 'blockquote':
      return (node.content || [])
        .map((child) => nodeToMarkdown(child, indent))
        .join('\n')
        .split('\n')
        .map((line: string) => `> ${line}`)
        .join('\n');

    case 'horizontalRule':
      return '---';

    case 'table':
      return tableToMarkdown(node);

    case 'callout': {
      const type = (node.attrs?.type as string) || 'info';
      const body = (node.content || []).map((c) => nodeToMarkdown(c, indent)).join('\n');
      return `> [!${type}]\n${body
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}`;
    }

    case 'mathBlock':
      return `$$\n${node.attrs?.content || ''}\n$$`;

    case 'mermaid':
      return `\`\`\`mermaid\n${node.attrs?.content || ''}\n\`\`\``;

    case 'toggle':
    case 'toggleSummary': {
      const inner = (node.content || []).map((c) => nodeToMarkdown(c, indent)).join('\n');
      if (node.type === 'toggleSummary')
        return `<details><summary>${inlineContentToMd(node.content)}</summary>`;
      return `${inner}\n</details>`;
    }

    case 'image': {
      const src = (node.attrs?.src as string) || '';
      const alt = (node.attrs?.alt as string) || '';
      return `![${alt}](${src})`;
    }

    default:
      // For unknown nodes, try to recurse into content
      if (node.content) {
        return (node.content || []).map((c) => nodeToMarkdown(c, indent)).join('\n');
      }
      return node.text || '';
  }
}

function tableToMarkdown(node: TipTapNode): string {
  const rows = node.content || [];
  if (rows.length === 0) return '';

  const mdRows: string[][] = [];
  for (const row of rows) {
    const cells = (row.content || []).map((cell) => {
      const text = (cell.content || []).map((c) => inlineContentToMd(c.content)).join(' ');
      return text.trim();
    });
    mdRows.push(cells);
  }

  const colCount = Math.max(...mdRows.map((r) => r.length));
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    Math.max(3, ...mdRows.map((r) => (r[i] || '').length))
  );

  const formatRow = (cells: string[]) =>
    '| ' + colWidths.map((w, i) => (cells[i] || '').padEnd(w)).join(' | ') + ' |';
  const separator = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';

  const lines = [formatRow(mdRows[0]), separator];
  for (let i = 1; i < mdRows.length; i++) {
    lines.push(formatRow(mdRows[i]));
  }
  return lines.join('\n');
}

// ==================== TipTap JSON → HTML ====================

function marksToHtml(text: string, marks?: TipTapMark[]): string {
  if (!marks || marks.length === 0) return escapeHtml(text);
  let result = escapeHtml(text);
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        result = `<strong>${result}</strong>`;
        break;
      case 'italic':
      case 'em':
        result = `<em>${result}</em>`;
        break;
      case 'strike':
        result = `<s>${result}</s>`;
        break;
      case 'code':
        result = `<code>${result}</code>`;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'link': {
        const href = escapeHtml((mark.attrs?.href as string) || '');
        result = `<a href="${href}">${result}</a>`;
        break;
      }
      case 'highlight': {
        const color = (mark.attrs?.color as string) || 'yellow';
        result = `<mark style="background:${escapeHtml(color)}">${result}</mark>`;
        break;
      }
    }
  }
  return result;
}

function inlineContentToHtml(nodes?: TipTapNode[]): string {
  if (!nodes) return '';
  return nodes
    .map((node) => {
      if (node.type === 'text') return marksToHtml(node.text || '', node.marks);
      if (node.type === 'hardBreak') return '<br>';
      if (node.type === 'mathInline')
        return `<code class="math">${escapeHtml(String(node.attrs?.content || ''))}</code>`;
      return inlineContentToHtml(node.content);
    })
    .join('');
}

function nodeToHtml(node: TipTapNode): string {
  switch (node.type) {
    case 'doc':
      return (node.content || []).map(nodeToHtml).join('\n');

    case 'paragraph':
      return `<p>${inlineContentToHtml(node.content)}</p>`;

    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
      return `<h${level}>${inlineContentToHtml(node.content)}</h${level}>`;
    }

    case 'bulletList':
      return `<ul>\n${(node.content || []).map(nodeToHtml).join('\n')}\n</ul>`;

    case 'orderedList': {
      const start = (node.attrs?.start as number) || 1;
      return `<ol start="${start}">\n${(node.content || []).map(nodeToHtml).join('\n')}\n</ol>`;
    }

    case 'listItem':
      return `<li>${(node.content || []).map(nodeToHtml).join('')}</li>`;

    case 'taskList':
      return `<ul class="task-list">\n${(node.content || []).map(nodeToHtml).join('\n')}\n</ul>`;

    case 'taskItem': {
      const checked = node.attrs?.checked ? 'checked' : '';
      return `<li class="task-item"><input type="checkbox" ${checked} disabled> ${(node.content || []).map(nodeToHtml).join('')}</li>`;
    }

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) || '';
      const code = (node.content || []).map((c) => escapeHtml(c.text || '')).join('');
      return `<pre><code class="language-${escapeHtml(lang)}">${code}</code></pre>`;
    }

    case 'blockquote':
      return `<blockquote>\n${(node.content || []).map(nodeToHtml).join('\n')}\n</blockquote>`;

    case 'horizontalRule':
      return '<hr>';

    case 'table':
      return `<table>\n${(node.content || []).map(nodeToHtml).join('\n')}\n</table>`;

    case 'tableRow':
      return `<tr>${(node.content || []).map(nodeToHtml).join('')}</tr>`;

    case 'tableCell':
      return `<td>${(node.content || []).map(nodeToHtml).join('')}</td>`;

    case 'tableHeader':
      return `<th>${(node.content || []).map(nodeToHtml).join('')}</th>`;

    case 'callout': {
      const type = (node.attrs?.type as string) || 'info';
      return `<div class="callout callout-${escapeHtml(type)}">\n${(node.content || []).map(nodeToHtml).join('\n')}\n</div>`;
    }

    case 'mathBlock':
      return `<pre class="math-block">${escapeHtml(String(node.attrs?.content || ''))}</pre>`;

    case 'mermaid':
      return `<pre class="language-mermaid"><code>${escapeHtml(String(node.attrs?.content || ''))}</code></pre>`;

    case 'image': {
      const src = escapeHtml((node.attrs?.src as string) || '');
      const alt = escapeHtml((node.attrs?.alt as string) || '');
      return `<img src="${src}" alt="${alt}">`;
    }

    default:
      if (node.content) return (node.content || []).map(nodeToHtml).join('\n');
      return node.text ? escapeHtml(node.text) : '';
  }
}

// ==================== TipTap JSON → PDF lines ====================

interface PdfLine {
  text: string;
  fontSize: number;
  fontStyle: 'normal' | 'bold' | 'italic' | 'bolditalic';
  indent: number;
  spaceBefore?: number;
}

function nodeToPdfLines(node: TipTapNode, indent: number = 0): PdfLine[] {
  const lines: PdfLine[] = [];

  switch (node.type) {
    case 'doc':
      for (const child of node.content || []) {
        lines.push(...nodeToPdfLines(child, indent));
      }
      break;

    case 'paragraph':
      lines.push({
        text: inlineContentToMd(node.content),
        fontSize: 11,
        fontStyle: 'normal',
        indent,
      });
      break;

    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
      const sizes: Record<number, number> = { 1: 18, 2: 15, 3: 13, 4: 12 };
      lines.push({
        text: inlineContentToMd(node.content),
        fontSize: sizes[level] || 12,
        fontStyle: 'bold',
        indent,
        spaceBefore: 6,
      });
      break;
    }

    case 'bulletList':
    case 'taskList':
      for (const item of node.content || []) {
        lines.push(...nodeToPdfLines(item, indent));
      }
      break;

    case 'orderedList':
      (node.content || []).forEach((item, i) => {
        const start = ((node.attrs?.start as number) || 1) + i;
        const itemLines = nodeToPdfLines(item, indent);
        if (itemLines.length > 0) {
          itemLines[0].text = `${start}. ${itemLines[0].text.replace(/^[-•] /, '')}`;
        }
        lines.push(...itemLines);
      });
      break;

    case 'listItem':
      for (const child of node.content || []) {
        const childLines = nodeToPdfLines(child, indent + 8);
        if (childLines.length > 0) {
          childLines[0].text = `• ${childLines[0].text}`;
        }
        lines.push(...childLines);
      }
      break;

    case 'taskItem': {
      const checked = node.attrs?.checked ? '☑' : '☐';
      for (const child of node.content || []) {
        const childLines = nodeToPdfLines(child, indent + 8);
        if (childLines.length > 0) {
          childLines[0].text = `${checked} ${childLines[0].text}`;
        }
        lines.push(...childLines);
      }
      break;
    }

    case 'codeBlock': {
      const code = (node.content || []).map((c) => c.text || '').join('');
      for (const codeLine of code.split('\n')) {
        lines.push({ text: codeLine, fontSize: 9, fontStyle: 'normal', indent: indent + 4 });
      }
      break;
    }

    case 'blockquote':
      for (const child of node.content || []) {
        const childLines = nodeToPdfLines(child, indent + 10);
        for (const cl of childLines) {
          cl.fontStyle = 'italic';
        }
        lines.push(...childLines);
      }
      break;

    case 'horizontalRule':
      lines.push({ text: '────────────────────────', fontSize: 10, fontStyle: 'normal', indent });
      break;

    default:
      if (node.content) {
        for (const child of node.content) {
          lines.push(...nodeToPdfLines(child, indent));
        }
      } else if (node.text) {
        lines.push({ text: node.text, fontSize: 11, fontStyle: 'normal', indent });
      }
  }

  return lines;
}

// ==================== TipTap JSON → DOCX paragraphs ====================

function textRunsFromInline(nodes?: TipTapNode[]): TextRun[] {
  if (!nodes) return [];
  const runs: TextRun[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const hasBold = node.marks?.some((m) => m.type === 'bold' || m.type === 'strong');
      const hasItalic = node.marks?.some((m) => m.type === 'italic' || m.type === 'em');
      const hasStrike = node.marks?.some((m) => m.type === 'strike');
      const hasUnderline = node.marks?.some((m) => m.type === 'underline');
      const hasCode = node.marks?.some((m) => m.type === 'code');
      runs.push(
        new TextRun({
          text: node.text || '',
          bold: hasBold || undefined,
          italics: hasItalic || undefined,
          strike: hasStrike || undefined,
          underline: hasUnderline ? {} : undefined,
          font: hasCode ? 'Courier New' : undefined,
          size: 22,
        })
      );
    } else if (node.type === 'hardBreak') {
      runs.push(new TextRun({ break: 1 }));
    } else if (node.content) {
      runs.push(...textRunsFromInline(node.content));
    }
  }
  return runs;
}

function nodeToDocxParagraphs(node: TipTapNode, indent: number = 0): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  switch (node.type) {
    case 'doc':
      for (const child of node.content || []) {
        paragraphs.push(...nodeToDocxParagraphs(child, indent));
      }
      break;

    case 'paragraph':
      paragraphs.push(
        new Paragraph({
          children: textRunsFromInline(node.content),
          indent: indent > 0 ? { left: indent * 360 } : undefined,
        })
      );
      break;

    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
      };
      paragraphs.push(
        new Paragraph({
          children: textRunsFromInline(node.content),
          heading: headingMap[level] || HeadingLevel.HEADING_4,
        })
      );
      break;
    }

    case 'bulletList':
    case 'taskList':
      for (const item of node.content || []) {
        paragraphs.push(...nodeToDocxParagraphs(item, indent));
      }
      break;

    case 'orderedList':
      (node.content || []).forEach((item, i) => {
        const num = ((node.attrs?.start as number) || 1) + i;
        const children = item.content || [];
        for (const child of children) {
          const runs = textRunsFromInline(child.content);
          runs.unshift(new TextRun({ text: `${num}. `, bold: true, size: 22 }));
          paragraphs.push(
            new Paragraph({
              children: runs,
              indent: { left: (indent + 1) * 360 },
            })
          );
        }
      });
      break;

    case 'listItem':
      for (const child of node.content || []) {
        const runs = textRunsFromInline(child.content);
        runs.unshift(new TextRun({ text: '• ', size: 22 }));
        paragraphs.push(
          new Paragraph({
            children: runs,
            indent: { left: (indent + 1) * 360 },
          })
        );
      }
      break;

    case 'taskItem': {
      const checked = node.attrs?.checked ? '☑ ' : '☐ ';
      for (const child of node.content || []) {
        const runs = textRunsFromInline(child.content);
        runs.unshift(new TextRun({ text: checked, size: 22 }));
        paragraphs.push(
          new Paragraph({
            children: runs,
            indent: { left: (indent + 1) * 360 },
          })
        );
      }
      break;
    }

    case 'codeBlock': {
      const code = (node.content || []).map((c) => c.text || '').join('');
      for (const line of code.split('\n')) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: line, font: 'Courier New', size: 18 })],
            indent: { left: 360 },
          })
        );
      }
      break;
    }

    case 'blockquote':
      for (const child of node.content || []) {
        const runs = textRunsFromInline(child.content);
        for (const run of runs) {
          // TextRun properties are set at construction, so we wrap them
        }
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: '│ ', color: '888888', size: 22 }),
              ...textRunsFromInline(child.content)
                .map(
                  () =>
                    new TextRun({
                      text: inlineContentToMd(child.content),
                      italics: true,
                      size: 22,
                    })
                )
                .slice(0, 1),
            ],
            indent: { left: 360 },
          })
        );
      }
      break;

    case 'horizontalRule':
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: '─'.repeat(50), color: 'CCCCCC', size: 18 })],
          alignment: AlignmentType.CENTER,
        })
      );
      break;

    default:
      if (node.content) {
        for (const child of node.content) {
          paragraphs.push(...nodeToDocxParagraphs(child, indent));
        }
      } else if (node.text) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: node.text, size: 22 })] }));
      }
  }

  return paragraphs;
}

// ==================== Export Functions ====================

/**
 * Export note to Markdown format.
 */
export function exportToMarkdown(note: Note, options?: ExportOptions): ExportResult {
  let md = `# ${note.title || 'Untitled'}\n\n`;

  if (options?.includeMetadata) {
    md += `---\n`;
    md += `created: ${note.createdAt}\n`;
    md += `modified: ${note.updatedAt}\n`;
    md += `words: ${note.wordCount}\n`;
    if (note.isDaily) md += `daily: ${note.dailyDate}\n`;
    md += `---\n\n`;
  }

  const doc = parseTipTapContent(note.content);
  if (doc) {
    md += nodeToMarkdown(doc);
  } else {
    md += note.plainText || '';
  }

  if (options?.includeLinks && note.linkedNoteIds.length > 0) {
    md += `\n\n## Linked Notes\n\n`;
    for (const id of note.linkedNoteIds) {
      md += `- [[${id}]]\n`;
    }
  }

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  return {
    blob,
    filename: `${sanitizeFilename(note.title)}.md`,
    mimeType: 'text/markdown',
  };
}

/**
 * Export note to HTML format.
 */
export function exportToHTML(note: Note, options?: ExportOptions): ExportResult {
  const doc = parseTipTapContent(note.content);
  const bodyHtml = doc ? nodeToHtml(doc) : `<p>${escapeHtml(note.plainText || '')}</p>`;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(note.title || 'Untitled')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.7; }
    h1 { font-size: 2rem; margin-bottom: 0.5em; }
    h2 { font-size: 1.5rem; }
    h3 { font-size: 1.25rem; }
    .meta { color: #888; font-size: 0.85rem; margin-bottom: 2em; }
    p { margin: 0.5em 0; }
    pre { background: #f5f5f5; padding: 1em; border-radius: 6px; overflow-x: auto; }
    code { background: #f0f0f0; padding: 0.15em 0.3em; border-radius: 3px; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 3px solid #ddd; margin: 1em 0; padding-left: 1em; color: #666; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    .task-list { list-style: none; padding-left: 0; }
    .task-item { display: flex; align-items: baseline; gap: 0.5em; }
    mark { padding: 0.1em 0.2em; border-radius: 2px; }
    hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
    img { max-width: 100%; height: auto; }
    .callout { border-left: 4px solid #4682B4; background: #f0f7ff; padding: 1em; margin: 1em 0; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(note.title || 'Untitled')}</h1>`;

  if (options?.includeMetadata) {
    html += `\n  <div class="meta">
    Created: ${new Date(note.createdAt).toLocaleDateString()} |
    Modified: ${new Date(note.updatedAt).toLocaleDateString()} |
    ${note.wordCount} words
  </div>`;
  }

  html += `\n  ${bodyHtml}`;
  html += `\n</body>\n</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  return {
    blob,
    filename: `${sanitizeFilename(note.title)}.html`,
    mimeType: 'text/html',
  };
}

/**
 * Export note to PDF format.
 */
export function exportToPDF(note: Note, options?: ExportOptions): ExportResult {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 20;
  const maxWidth = pageWidth - margin * 2;
  let y = 25;

  const ensureSpace = (needed: number) => {
    if (y + needed > pdf.internal.pageSize.getHeight() - 20) {
      pdf.addPage();
      y = 20;
    }
  };

  // Title
  pdf.setFontSize(20);
  pdf.setFont('helvetica', 'bold');
  const titleLines = pdf.splitTextToSize(note.title || 'Untitled', maxWidth);
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 8 + 5;

  // Metadata
  if (options?.includeMetadata) {
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(128);
    pdf.text(
      `Created: ${new Date(note.createdAt).toLocaleDateString()} | Modified: ${new Date(note.updatedAt).toLocaleDateString()} | ${note.wordCount} words`,
      margin,
      y
    );
    y += 10;
    pdf.setTextColor(0);
  }

  // Body — use TipTap JSON for rich structure
  const doc = parseTipTapContent(note.content);
  const pdfLines = doc
    ? nodeToPdfLines(doc)
    : [{ text: note.plainText || '', fontSize: 11, fontStyle: 'normal' as const, indent: 0 }];

  for (const line of pdfLines) {
    if (line.spaceBefore) y += line.spaceBefore;

    pdf.setFontSize(line.fontSize);
    pdf.setFont('helvetica', line.fontStyle === 'bolditalic' ? 'bolditalic' : line.fontStyle);

    const offsetX = margin + (line.indent || 0);
    const availableWidth = maxWidth - (line.indent || 0);
    const wrapped = pdf.splitTextToSize(line.text || '', availableWidth);
    const lineHeight = line.fontSize * 0.5;

    for (const wl of wrapped) {
      ensureSpace(lineHeight);
      pdf.text(wl, offsetX, y);
      y += lineHeight;
    }
    y += 1; // small gap between blocks
  }

  const blob = pdf.output('blob');
  return {
    blob,
    filename: `${sanitizeFilename(note.title)}.pdf`,
    mimeType: 'application/pdf',
  };
}

/**
 * Export note to DOCX format.
 */
export async function exportToDOCX(note: Note, options?: ExportOptions): Promise<ExportResult> {
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      text: note.title || 'Untitled',
      heading: HeadingLevel.HEADING_1,
    })
  );

  // Metadata
  if (options?.includeMetadata) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Created: ${new Date(note.createdAt).toLocaleDateString()} | Modified: ${new Date(note.updatedAt).toLocaleDateString()} | ${note.wordCount} words`,
            size: 18,
            color: '888888',
            italics: true,
          }),
        ],
      })
    );
    children.push(new Paragraph({ text: '' }));
  }

  // Body — use TipTap JSON for rich structure
  const tipTapDoc = parseTipTapContent(note.content);
  if (tipTapDoc) {
    children.push(...nodeToDocxParagraphs(tipTapDoc));
  } else {
    // Fallback to plainText
    for (const line of (note.plainText || '').split('\n').filter((l) => l.trim())) {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 22 })] }));
    }
  }

  const docxDoc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBlob(docxDoc);
  return {
    blob: buffer,
    filename: `${sanitizeFilename(note.title)}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

/**
 * Export note to Filarr JSON format (full metadata + content + links).
 */
export function exportToFilarr(note: Note): ExportResult {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    note: {
      id: note.id,
      title: note.title,
      content: note.content,
      plainText: note.plainText,
      linkedNoteIds: note.linkedNoteIds,
      linkedFileIds: note.linkedFileIds,
      linkedFolderIds: note.linkedFolderIds,
      isDaily: note.isDaily,
      dailyDate: note.dailyDate,
      icon: note.icon,
      coverColor: note.coverColor,
      wordCount: note.wordCount,
      isPinned: note.isPinned,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  return {
    blob,
    filename: `${sanitizeFilename(note.title)}.filarr`,
    mimeType: 'application/json',
  };
}

/**
 * Export a note in the specified format.
 */
export async function exportNote(note: Note, options: ExportOptions): Promise<ExportResult> {
  switch (options.format) {
    case 'markdown':
      return exportToMarkdown(note, options);
    case 'html':
      return exportToHTML(note, options);
    case 'pdf':
      return exportToPDF(note, options);
    case 'docx':
      return exportToDOCX(note, options);
    case 'filarr':
      return exportToFilarr(note);
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }
}
