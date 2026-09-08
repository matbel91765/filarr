/**
 * Notion Export Importer
 *
 * Parses a Notion ZIP export (Markdown — recommended — or HTML):
 * - Strips Notion's hex-UUID filename suffix ("Page Title abc123def456.md" → "Page Title")
 * - Converts content → TipTap JSON
 * - Rewrites Notion's internal page links `[text](Page%20<hash>.md)` → `[[Page Title]]` so they
 *   render as Filarr link chips AND resolve to linkedNoteIds in the downstream linking phase
 * - Maps top-level export folders → notebooks (parity with the Obsidian importer)
 * - Assigns Select/Multi-Select values from CSV database exports as tags, matched to each page
 */

import type { Note } from '../../../types/notes';
import { createNote } from '../noteService';
import { markdownToTipTap, htmlToTipTap, extractPlainText, countWords } from '../noteImportService';
import { buildAssetIndex } from './notionAssets';
import { csvToDatabase } from './notionCsvDatabase';
import type {
  SourceEntry,
  ExternalImportOptions,
  ExternalImportResult,
  ProgressCallback,
} from '../externalImportService';

// ==================== Notion-specific helpers ====================

/**
 * Strip characters that break Filarr wiki-link syntax. Like Obsidian, a note title can't contain
 * `[`, `]` or `|` — left in, they corrupt the emitted `[[title]]` (truncated chip + visible garbage)
 * and prevent the downstream resolver from matching. Applied to every derived title so the title and
 * any link pointing at it stay consistent.
 */
function wikiSafe(title: string): string {
  return title
    .replace(/[[\]]/g, '') // brackets break `[[ ... ]]`
    .replace(/\|/g, '-') // pipe is the wiki-link alias separator
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Notion appends a hex UUID to filenames: "Page Title abc12345def67.md" → "Page Title" */
function cleanNotionTitle(filename: string): string {
  // Remove file extension
  const withoutExt = filename.replace(/\.(md|html|htm|csv)$/i, '');
  // Remove Notion's hex UUID suffix (20+ hex chars at the end, separated by a space)
  const cleaned = withoutExt.replace(/\s+[a-f0-9]{20,}$/i, '');
  // Also handle underscore-separated UUIDs
  return wikiSafe(cleaned.replace(/_[a-f0-9]{20,}$/i, '').trim() || withoutExt);
}

/** Check if file is an importable content file. */
function isContentFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.html') || lower.endsWith('.htm');
}

/** basename of a (possibly nested) path */
function baseName(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Rewrite Notion internal page links to Filarr wiki-links.
 *
 * Notion markdown links look like `[Some Page](Some%20Page%20<hash>.md)` — URL-encoded, possibly
 * nested. We resolve the href to a known content file and emit `[[<clean target title>]]` (the
 * target's wiki-safe title, so the downstream resolver matches it), leaving images (`![..](..)`),
 * external URLs (`http(s)://`, `mailto:`) and links to unknown targets untouched.
 */
function rewriteNotionLinks(
  body: string,
  hrefToTitle: Map<string, string>
): { text: string; converted: number } {
  // Cheap short-circuit: no markdown links → nothing to do (also dodges pathological bracket runs).
  if (!body.includes('](')) return { text: body, converted: 0 };

  let converted = 0;
  const text = body.replace(
    /(!?)\[([^\]]*)\]\(([^)]+)\)/g,
    (full: string, bang: string, _label: string, href: string) => {
      if (bang === '!') return full; // image embed — handled elsewhere
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(href) || /^mailto:/i.test(href)) return full; // external
      let decoded = href;
      try {
        decoded = decodeURIComponent(href);
      } catch {
        /* keep the raw href if it isn't valid percent-encoding */
      }
      const clean = decoded.split('#')[0].split('?')[0];
      if (!/\.(md|html?|csv)$/i.test(clean)) return full; // not a link to a content file
      const title = hrefToTitle.get(clean) ?? hrefToTitle.get(baseName(clean));
      if (!title) return full; // unknown target — keep the original link
      converted++;
      return `[[${title}]]`;
    }
  );
  return { text, converted };
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ==================== Main Parser ====================

export async function parseNotionExport(
  entries: SourceEntry[],
  options: ExternalImportOptions,
  onProgress?: ProgressCallback
): Promise<ExternalImportResult> {
  const result: ExternalImportResult = {
    notes: [],
    tags: [],
    notebooks: [],
    notesImported: 0,
    tagsCreated: 0,
    linksResolved: 0,
    warnings: [],
    errors: [],
  };

  const contentFiles = entries.filter((e) => !e.isDirectory && isContentFile(e.relativePath));

  if (contentFiles.length === 0) {
    result.warnings.push(
      'No content files found in the Notion export. Make sure you exported as HTML or Markdown.'
    );
    return result;
  }

  // HTML exports import their content but NOT their internal links (link rewriting is markdown-only).
  if (contentFiles.some((e) => /\.html?$/i.test(e.relativePath))) {
    result.warnings.push(
      'HTML export detected — re-export as “Markdown & CSV” for reliable internal links between pages.'
    );
  }

  // ---- Pass 1: map every content file (full path + basename) → its clean page title ----
  // Built BEFORE conversion so internal links can resolve to targets that appear later in the list.
  const hrefToTitle = new Map<string, string>();
  const titleCounts = new Map<string, number>();

  /**
   * Les BASES aussi, alors qu'elles ne sont pas des « fichiers de contenu ».
   *
   * Une base inline posee dans une page est exportee comme un lien vers son
   * CSV : sans cette entree, le lien ne resolvait vers rien et la base arrivait
   * en lien mort au milieu de la note, alors meme qu'on l'importe par ailleurs
   * comme une vraie base. Les deux bouts se rejoignent ici.
   */
  for (const entry of entries) {
    if (entry.isDirectory || !entry.relativePath.toLowerCase().endsWith('.csv')) continue;
    const file = baseName(entry.relativePath);
    // `_all.csv` et la vue nommee designent LA MEME base : meme titre pour les deux
    const title = cleanNotionTitle(file.replace(/_all\.csv$/i, '.csv'));
    hrefToTitle.set(entry.relativePath, title);
    hrefToTitle.set(file, title);
  }

  for (const entry of contentFiles) {
    const file = baseName(entry.relativePath);
    const title = cleanNotionTitle(file);
    hrefToTitle.set(entry.relativePath, title); // nested-path href
    hrefToTitle.set(file, title); // basename href
    titleCounts.set(title.toLowerCase(), (titleCounts.get(title.toLowerCase()) || 0) + 1);
  }

  // Duplicate page titles can't be told apart by the title-based link resolver → warn, don't fail.
  const dupTitles = Array.from(titleCounts.entries())
    .filter(([, n]) => n > 1)
    .map(([t]) => t);
  if (dupTitles.length > 0) {
    result.warnings.push(
      `${dupTitles.length} page title(s) are duplicated (e.g. ${dupTitles
        .slice(0, 3)
        .join(', ')}) — links to them may resolve to the wrong page.`
    );
  }

  // ---- Pieces jointes : images et fichiers ranges a cote des pages ----
  // Les octets sont EMBARQUES dans la note (data-URI), donc chiffres avec elle.
  // Sans cet index, chaque `![...](Ma%20page%20abc/img.png)` d'un export Notion
  // finissait en texte brut : toutes les images de l'export etaient perdues.
  const assets = buildAssetIndex(entries);

  // CSV database properties (Select/Multi-Select) → tags, keyed by lowercased page title.
  const csvTagsByTitle = options.importTags
    ? collectNotionCsvTags(
        entries.filter((e) => !e.isDirectory && e.relativePath.toLowerCase().endsWith('.csv'))
      )
    : new Map<string, string[]>();
  const allTagNames = new Set<string>();

  // ---- Pass 2: convert content + create notes ----
  const folderNotes = new Map<string, string[]>(); // top-level folder name → note IDs
  let linksConverted = 0;
  let databasesImported = 0;

  for (let i = 0; i < contentFiles.length; i++) {
    const entry = contentFiles[i];

    if (i % 50 === 0) {
      onProgress?.({
        phase: 'converting',
        current: i,
        total: contentFiles.length,
        detail: entry.relativePath,
      });
      await yieldToUI();
    }

    try {
      const fileName = baseName(entry.relativePath);
      const isHtml = /\.html?$/i.test(fileName);
      const cleanTitle = cleanNotionTitle(fileName);

      let title: string;
      let doc: { type: string; content?: unknown[] };
      let plainText: string;

      if (isHtml) {
        // HTML export: parsing needs DOMParser; internal-link rewriting does not apply here (warned above).
        const parsed = htmlToTipTap(entry.content);
        title = cleanTitle || wikiSafe(parsed.title);
        doc = parsed.doc;
        plainText = extractPlainText(parsed.doc);
      } else {
        const { text: linkedBody, converted } = rewriteNotionLinks(entry.content, hrefToTitle);
        linksConverted += converted;
        const parsed = markdownToTipTap(linkedBody, {
          resolveAsset: (href) => assets.resolve(entry.relativePath, href),
          linkAsBookmark: true,
        });
        // The filename is Notion's authoritative page title; prefer it so internal links resolve.
        title = cleanTitle || wikiSafe(parsed.title);
        doc = parsed.doc;
        plainText = extractPlainText(parsed.doc);
      }

      const note = createNote({
        title,
        content: JSON.stringify(doc),
        plainText,
        wordCount: countWords(plainText),
        notebookId: undefined, // resolved by the wizard from _folderName / targetNotebookId
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Tags from the matching CSV database row (best-effort, by page title).
      const csvTags = csvTagsByTitle.get(cleanTitle.toLowerCase());
      if (csvTags && csvTags.length > 0) {
        (note as Note & { _importTags?: string[] })._importTags = csvTags;
        for (const t of csvTags) allTagNames.add(t);
      }

      // Top-level folder → notebook (parity with the Obsidian importer).
      const pathParts = entry.relativePath.split('/');
      if (pathParts.length > 1) {
        const folder = cleanNotionTitle(pathParts[0]);
        (note as Note & { _folderName?: string })._folderName = folder;
        const existing = folderNotes.get(folder) || [];
        existing.push(note.id);
        folderNotes.set(folder, existing);
      }

      result.notes.push(note);
      result.notesImported++;
    } catch (err) {
      result.errors.push(
        `Failed to import ${entry.relativePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ---- Passe 3 : les BASES DE DONNEES ----
  // Une base est l'objet central de Notion, et l'export en range une par CSV.
  // Jusqu'ici on n'en tirait que des etiquettes : la table, ses colonnes, ses
  // types et ses lignes partaient a la poubelle — l'utilisateur perdait
  // exactement ce pour quoi il se servait de Notion.
  const csvEntries = entries.filter(
    (e) => !e.isDirectory && e.relativePath.toLowerCase().endsWith('.csv')
  );
  for (const [index, csv] of pickDatabaseCsvs(csvEntries).entries()) {
    try {
      // Le `_all` doit tomber ICI AUSSI : sinon la note s'appelle
      // « test abc123_all » alors que le lien de la page vise « test », et les
      // deux ne se rejoignent plus.
      const dbTitle = cleanNotionTitle(baseName(csv.relativePath).replace(/_all\.csv$/i, '.csv'));
      const database = csvToDatabase(parseCsv(csv.content), dbTitle, `notion-db-${index}`);
      if (!database) continue;

      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: dbTitle }] },
          { type: 'inlineDatabase', attrs: database.attrs },
        ],
      };
      const plainText = `${dbTitle}\n${database.rowCount} lignes`;

      const note = createNote({
        title: dbTitle,
        content: JSON.stringify(doc),
        plainText,
        wordCount: countWords(plainText),
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const parts = csv.relativePath.split('/');
      if (parts.length > 1) {
        const folder = cleanNotionTitle(parts[0]);
        (note as Note & { _folderName?: string })._folderName = folder;
        const existing = folderNotes.get(folder) || [];
        existing.push(note.id);
        folderNotes.set(folder, existing);
      }

      result.notes.push(note);
      result.notesImported++;
      databasesImported++;
    } catch (err) {
      result.errors.push(
        `Failed to import database ${csv.relativePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (databasesImported > 0) {
    result.warnings.push(
      `${databasesImported} Notion database(s) imported as editable tables — check the column types, they were inferred from the values.`
    );
  }
  if (assets.skipped.length > 0) {
    result.warnings.push(
      `${assets.skipped.length} attachment(s) were too large to embed and were left out (e.g. ${assets.skipped
        .slice(0, 3)
        .map((path) => baseName(path))
        .join(', ')}).`
    );
  }

  // Count of internal links rewritten in-content. The downstream linking phase counts cross-note
  // matches and may overwrite this with the resolved-edge count; both are meaningful.
  result.linksResolved = linksConverted;

  result.notebooks = Array.from(folderNotes.entries()).map(([name, noteIds]) => ({
    name,
    noteIds,
  }));

  result.tags = Array.from(allTagNames).map((name) => ({ name }));
  result.tagsCreated = result.tags.length;

  return result;
}

/**
 * Un CSV par BASE, pas un par vue.
 *
 * Notion exporte une vue par fichier, et ajoute un `_all.csv` qui porte toutes
 * les lignes. Importer les deux creerait deux notes pour la meme base, dont une
 * incomplete. On garde donc le `_all` quand il existe, sinon le premier vu.
 */
function pickDatabaseCsvs(csvFiles: SourceEntry[]): SourceEntry[] {
  const chosen = new Map<string, SourceEntry>();

  for (const csv of csvFiles) {
    const name = baseName(csv.relativePath).replace(/\.csv$/i, '');
    const isAll = /_all$/i.test(name);
    const key = cleanNotionTitle(name.replace(/_all$/i, '')).toLowerCase();
    const existing = chosen.get(key);
    if (!existing || isAll) chosen.set(key, csv);
  }

  return Array.from(chosen.values());
}

// ==================== CSV Database → Tags ====================

/** Header names (lowercased, exact) we treat as Select/Multi-Select tag columns. */
const TAG_HEADERS = new Set([
  'tag',
  'tags',
  'category',
  'categories',
  'status',
  'type',
  'label',
  'labels',
]);

/**
 * Build a `lowercased page title → tag values` map from Notion CSV database exports.
 * The first column ("Name"/"Title") holds the page title; tag columns (header is an exact match in
 * {@link TAG_HEADERS}) hold the values we treat as tags. Only tags for pages that were actually
 * imported are kept (no orphan tags).
 */
function collectNotionCsvTags(csvFiles: SourceEntry[]): Map<string, string[]> {
  const byTitle = new Map<string, string[]>();

  for (const csv of csvFiles) {
    try {
      const rows = parseCsv(csv.content);
      if (rows.length < 2) continue;

      const headers = rows[0].map((h) => h.toLowerCase());
      // The title column is whichever is "name"/"title", else the first column.
      let nameIdx = headers.findIndex((h) => h === 'name' || h === 'title');
      if (nameIdx === -1) nameIdx = 0;

      const tagColumnIndices: number[] = [];
      for (let i = 0; i < headers.length; i++) {
        if (i === nameIdx) continue;
        if (TAG_HEADERS.has(headers[i])) tagColumnIndices.push(i);
      }
      if (tagColumnIndices.length === 0) continue;

      for (let row = 1; row < rows.length; row++) {
        const cells = rows[row];
        const pageTitle = cells[nameIdx]?.trim();
        if (!pageTitle) continue;

        const tags = new Set(byTitle.get(pageTitle.toLowerCase()) || []);
        for (const idx of tagColumnIndices) {
          const cell = cells[idx]?.trim();
          if (!cell) continue;
          // Multi-select values are comma-separated within the cell.
          for (const val of cell.split(',')) {
            const trimmed = val.trim();
            if (trimmed && trimmed.length < 50) tags.add(trimmed);
          }
        }
        if (tags.size > 0) byTitle.set(pageTitle.toLowerCase(), Array.from(tags));
      }
    } catch {
      // CSV parsing is best-effort — a malformed database file shouldn't fail the whole import.
    }
  }

  return byTitle;
}

/**
 * Parse CSV content into rows of trimmed cells, honouring quoted fields that contain commas,
 * newlines and escaped quotes (`""`). Tokenises the whole string rather than pre-splitting on `\n`,
 * so a quoted multi-line cell stays in one record.
 */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  let sawAny = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (ch === ',') {
      row.push(cur.trim());
      cur = '';
      sawAny = true;
    } else if (ch === '\n') {
      row.push(cur.trim());
      rows.push(row);
      row = [];
      cur = '';
      sawAny = false;
    } else if (ch !== '\r') {
      cur += ch;
      sawAny = true;
    }
  }
  if (sawAny || cur.length > 0 || row.length > 0) {
    row.push(cur.trim());
    rows.push(row);
  }
  return rows;
}
