/**
 * Obsidian Vault Importer
 *
 * Parses an Obsidian vault directory:
 * - .md files → TipTap JSON notes
 * - YAML frontmatter → metadata (tags, aliases, dates)
 * - Wiki-links [[note]] → preserved (Filarr uses same format)
 * - #tags and nested #parent/child → HierarchicalTag
 * - Folder structure → note parentId hierarchy
 */

import type { Note } from '../../../types/notes';
import { createNote } from '../noteService';
import { markdownToTipTap, extractPlainText, countWords } from '../noteImportService';
import type {
  SourceEntry,
  ExternalImportOptions,
  ExternalImportResult,
  ProgressCallback,
} from '../externalImportService';

// ==================== Frontmatter Parser ====================

interface FrontmatterData {
  tags?: string[];
  aliases?: string[];
  date?: string;
  created?: string;
  cssclass?: string;
  [key: string]: unknown;
}

function parseFrontmatter(content: string): { frontmatter: FrontmatterData; body: string } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlLines = lines.slice(1, endIndex);
  const frontmatter: FrontmatterData = {};

  for (const line of yamlLines) {
    const match = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();

    // Parse array values: [tag1, tag2] or - tag1
    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      frontmatter[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }

  // Also handle YAML list format (- item)
  let currentKey = '';
  const listItems: string[] = [];
  for (const line of yamlLines) {
    const keyMatch = line.match(/^(\w+)\s*:\s*$/);
    if (keyMatch) {
      if (currentKey && listItems.length > 0) {
        frontmatter[currentKey] = [...listItems];
        listItems.length = 0;
      }
      currentKey = keyMatch[1];
      continue;
    }
    const itemMatch = line.match(/^\s*-\s+(.+)$/);
    if (itemMatch && currentKey) {
      listItems.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  if (currentKey && listItems.length > 0) {
    frontmatter[currentKey] = [...listItems];
  }

  const body = lines.slice(endIndex + 1).join('\n');
  return { frontmatter, body };
}

// ==================== Tag Extraction ====================

function extractInlineTags(content: string): string[] {
  const tags = new Set<string>();
  // Match #tag but not inside code blocks or URLs
  const tagPattern = /(?:^|\s)#([\w/-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(content)) !== null) {
    const tag = match[1];
    // Skip numeric-only tags (like #1, #123)
    if (!/^\d+$/.test(tag)) {
      tags.add(tag);
    }
  }
  return Array.from(tags);
}

// ==================== Obsidian Syntax Preprocessing ====================

/**
 * Clean Obsidian-specific syntax before passing to the generic Markdown parser.
 * - Strips %% comment blocks %%
 * - Converts ![[embed]] transclusions to [[embed]] links
 * - Converts ![alt](url) images to text placeholders or removes badges
 * - Strips <button> and other raw HTML Obsidian artifacts
 * - Converts Obsidian callouts (> [!type]) to blockquotes
 */
function preprocessObsidian(md: string): string {
  let result = md;

  // 1. Remove %% comment blocks %% (single-line and multi-line)
  result = result.replace(/%%[\s\S]*?%%/g, '');

  // 2. Convert ==highlight== to **bold** (TipTap highlight mark via inline parser)
  result = result.replace(/==([^=]+)==/g, '**$1**');

  // 3. Clean wiki-links: [[Page#Section|Alias]] → [[Alias]], [[Page#Section]] → [[Page]]
  result = result.replace(/\[\[([^\]|#]+)#[^\]|]*\|([^\]]+)\]\]/g, '[[$2]]'); // with alias → use alias
  result = result.replace(/\[\[([^\]|#]+)#[^\]]*\]\]/g, '[[$1]]'); // without alias → use page name
  result = result.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '[[$2]]'); // [[page|alias]] → [[alias]]

  // 4. Convert ![[embed]] transclusions to plain [[link]] references
  result = result.replace(/!\[\[([^\]]+)\]\]/g, '[[embed:$1]]');

  // 5. Convert ![alt](url) Markdown images to [Image: alt](url) links
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    if (url.includes('shields.io') || url.includes('badge') || url.includes('img.shields')) {
      return '';
    }
    return alt ? `[${alt}](${url})` : `[Image](${url})`;
  });

  // 6. Convert inline HTML to markdown equivalent or strip it
  // <a href="url">text</a> → [text](url)
  result = result.replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  // <strong>text</strong> / <b>text</b> → **text**
  result = result.replace(/<(?:strong|b)>(.*?)<\/(?:strong|b)>/gi, '**$1**');
  // <em>text</em> / <i>text</i> → *text*
  result = result.replace(/<(?:em|i)>(.*?)<\/(?:em|i)>/gi, '*$1*');
  // <code>text</code> → `text`
  result = result.replace(/<code>(.*?)<\/code>/gi, '`$1`');
  // <br> / <br/> → newline
  result = result.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining HTML tags (span, div, button, etc.) — keep inner text
  result = result.replace(/<[^>]+>/g, '');

  // 7. Convert Obsidian callouts > [!note] to standard blockquotes
  result = result.replace(/^>\s*\[!(\w+)\]\s*(.*)$/gm, '> **$1**: $2');

  // 8. Clean up excessive blank lines left by stripping
  result = result.replace(/\n{4,}/g, '\n\n\n');

  return result;
}

// ==================== Main Parser ====================

/** Yield to the event loop so the UI can repaint */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** True if this entry is a Markdown file the Obsidian importer handles. */
export function isObsidianMarkdown(entry: SourceEntry): boolean {
  return !entry.isDirectory && /\.(md|markdown)$/i.test(entry.relativePath);
}

/**
 * Incremental vault parser.
 *
 * Split out of `parseObsidianVault` so a large vault can be imported in
 * batches: the caller reads a few hundred files, feeds them here, and drops
 * the raw strings before reading the next batch. Cross-file state (the tag
 * registry, the folder→notebook map) lives on the instance, so batching
 * produces exactly the same result as one big array — peak memory is the
 * batch, not the vault.
 */
export class ObsidianVaultAccumulator {
  private readonly options: ExternalImportOptions;
  private readonly allTags = new Map<
    string,
    { name: string; parentName?: string; color?: string }
  >();
  /** Top-level folder name → IDs of the notes below it (becomes a notebook). */
  private readonly folderNotes = new Map<string, string[]>();
  private readonly notes: Note[] = [];
  private readonly errors: string[] = [];
  private readonly warnings: string[] = [];

  constructor(options: ExternalImportOptions) {
    this.options = options;
  }

  /** Number of notes converted so far — drives batched progress reporting. */
  get count(): number {
    return this.notes.length;
  }

  /** Convert one Markdown entry. Non-Markdown entries are ignored. */
  addEntry(entry: SourceEntry): void {
    if (!isObsidianMarkdown(entry)) return;

    try {
      // Parse frontmatter
      const { frontmatter, body: rawBody } = parseFrontmatter(entry.content);

      // Preprocess Obsidian-specific syntax before Markdown conversion
      const body = preprocessObsidian(rawBody);

      // Convert markdown to TipTap
      const { title: mdTitle, doc } = markdownToTipTap(body);

      // Determine title: filename without .md extension (Obsidian convention)
      const fileName = entry.relativePath.split('/').pop() || '';
      const fileTitle = fileName.replace(/\.md$|\.markdown$/i, '');
      const title = mdTitle || fileTitle;

      // Extract plain text
      const plainText = extractPlainText(doc);

      // Collect tags
      const noteTags: string[] = [];
      if (this.options.importTags) {
        // From frontmatter
        const fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
        for (const tag of fmTags) {
          noteTags.push(tag);
        }

        // From inline #tags in content
        const inlineTags = extractInlineTags(body);
        for (const tag of inlineTags) {
          if (!noteTags.includes(tag)) {
            noteTags.push(tag);
          }
        }

        // Register all tags (handle nested tags like parent/child)
        for (const tagName of noteTags) {
          if (tagName.includes('/')) {
            const parts = tagName.split('/');
            let parentName: string | undefined;
            for (const part of parts) {
              if (!this.allTags.has(part)) {
                this.allTags.set(part, { name: part, parentName });
              }
              parentName = part;
            }
          } else if (!this.allTags.has(tagName)) {
            this.allTags.set(tagName, { name: tagName });
          }
        }
      }

      // Parse dates from frontmatter
      const createdAt =
        frontmatter.created || frontmatter.date
          ? new Date(String(frontmatter.created || frontmatter.date)).toISOString()
          : new Date().toISOString();

      // Determine top-level folder for notebook mapping
      const pathParts = entry.relativePath.split('/');
      const topLevelFolder = pathParts.length > 1 ? pathParts[0] : null;

      // Create note
      const note = createNote({
        title,
        content: JSON.stringify(doc),
        plainText,
        wordCount: countWords(plainText),
        notebookId: undefined, // Will be set by caller after notebooks are created
        createdAt,
        updatedAt: new Date().toISOString(),
        tagIds: [],
      });

      // Store tag names on the note temporarily for later resolution
      (note as Note & { _importTags?: string[]; _folderName?: string })._importTags = noteTags.map(
        (t) => (t.includes('/') ? t.split('/').pop()! : t)
      );

      // Track folder → note mapping
      if (topLevelFolder) {
        (note as Note & { _folderName?: string })._folderName = topLevelFolder;
        const existing = this.folderNotes.get(topLevelFolder) || [];
        existing.push(note.id);
        this.folderNotes.set(topLevelFolder, existing);
      }

      this.notes.push(note);
    } catch (err) {
      this.errors.push(
        `Failed to import ${entry.relativePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /** Convert a batch of entries. */
  addBatch(entries: SourceEntry[]): void {
    for (const entry of entries) {
      this.addEntry(entry);
    }
  }

  /** Record a non-fatal problem to surface in the wizard's summary. */
  addWarning(message: string): void {
    this.warnings.push(message);
  }

  /** Collapse the accumulated state into the shape the wizard consumes. */
  finalize(): ExternalImportResult {
    const tags = Array.from(this.allTags.values());
    return {
      notes: this.notes,
      tags,
      notebooks: Array.from(this.folderNotes.entries()).map(([name, noteIds]) => ({
        name,
        noteIds,
      })),
      notesImported: this.notes.length,
      tagsCreated: tags.length,
      linksResolved: 0,
      warnings: this.warnings,
      errors: this.errors,
    };
  }
}

/**
 * One-shot vault parse: convert an array of already-read entries.
 *
 * Prefer `ObsidianVaultAccumulator` when the source may be large — this
 * signature requires every file's content to be in memory at once.
 */
export async function parseObsidianVault(
  entries: SourceEntry[],
  options: ExternalImportOptions,
  onProgress?: ProgressCallback
): Promise<ExternalImportResult> {
  const mdFiles = entries.filter(isObsidianMarkdown);
  const accumulator = new ObsidianVaultAccumulator(options);

  for (let i = 0; i < mdFiles.length; i++) {
    // Yield every 200 files so the UI can repaint progress
    if (i % 200 === 0) {
      onProgress?.({
        phase: 'converting',
        current: i,
        total: mdFiles.length,
        detail: mdFiles[i].relativePath,
      });
      await yieldToUI();
    }
    accumulator.addEntry(mdFiles[i]);
  }

  return accumulator.finalize();
}
