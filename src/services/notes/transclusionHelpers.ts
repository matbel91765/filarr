/**
 * Transclusion helpers for Filarr Notes
 *
 * Walks ProseMirror JSON trees to extract a targeted subtree:
 * - `section`: heading slug → take the heading and everything until next
 *   heading at the same-or-higher level.
 * - `blockId`: any node carrying `attrs.blockId === <id>` → that single block.
 *
 * Slugification is deterministic so heading anchors stay stable across edits
 * unless the heading text itself changes.
 */

/** Minimal ProseMirror node shape — we only touch type, attrs, content. */
interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: unknown[];
}

interface PMDoc {
  type: 'doc';
  content?: PMNode[];
}

export interface TransclusionTarget {
  section?: string | null;
  blockId?: string | null;
}

/**
 * Slugify a heading's text into a stable id for `![[Note#Section]]` lookup.
 * Lowercases, strips diacritics, collapses whitespace into hyphens, removes
 * anything that isn't `[a-z0-9-]`.
 */
export function slugifyHeading(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Recursively collect the plain text of a node (for heading slug matching). */
function nodeText(node: PMNode): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(nodeText).join('');
}

/**
 * Extract a subtree from the doc. Returns a `doc` containing only the matching
 * section/block, or the original doc if no target is set. Returns `null` when
 * a target is set but nothing matches.
 */
export function extractSubtree(doc: unknown, target: TransclusionTarget): PMDoc | null {
  if (!doc || typeof doc !== 'object') return null;
  const root = doc as PMDoc;

  // No target → embed everything.
  if (!target.section && !target.blockId) {
    return root;
  }

  const content = root.content ?? [];
  const collected: PMNode[] = [];

  if (target.blockId) {
    const found = findByBlockId(content, target.blockId);
    if (!found) return null;
    collected.push(found);
  } else if (target.section) {
    const targetSlug = slugifyHeading(target.section);
    let captureLevel: number | null = null;
    for (const node of content) {
      if (captureLevel === null) {
        if (node.type === 'heading') {
          const slug = slugifyHeading(nodeText(node));
          const level = typeof node.attrs?.level === 'number' ? (node.attrs.level as number) : 1;
          if (slug === targetSlug) {
            captureLevel = level;
            collected.push(node);
          }
        }
      } else {
        // Stop when we hit another heading at the same level or higher
        // (smaller "level" number = more important in markdown).
        if (node.type === 'heading') {
          const level = typeof node.attrs?.level === 'number' ? (node.attrs.level as number) : 1;
          if (level <= captureLevel) break;
        }
        collected.push(node);
      }
    }
    if (collected.length === 0) return null;
  }

  return { type: 'doc', content: collected };
}

/**
 * Depth-first search for a node carrying `attrs.blockId === id`.
 * Block IDs live on paragraphs (and headings) via a dedicated TipTap extension.
 */
function findByBlockId(nodes: PMNode[], id: string): PMNode | null {
  for (const n of nodes) {
    if (n.attrs && (n.attrs as { blockId?: string }).blockId === id) {
      return n;
    }
    if (n.content) {
      const found = findByBlockId(n.content, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Generate a short, URL-safe random block id. Stable enough to embed inline
 * (e.g. `^a1b2c3`).
 */
export function generateBlockId(): string {
  // 6 chars of base36 entropy — collision-resistant within a single note.
  return Math.random().toString(36).slice(2, 8);
}

export interface HeadingEntry {
  text: string;
  level: number;
  slug: string;
  /**
   * Rang du titre dans l'ORDRE DU DOCUMENT (parcours en profondeur), titres
   * vides compris. C'est le même ordre que celui des `h1..h6` rendus dans le
   * DOM : un sommaire peut donc s'en servir comme ancre de défilement sans
   * refaire un parcours parallèle qui divergerait.
   */
  index: number;
}

/**
 * Walk a note's ProseMirror JSON and collect all heading nodes (H1-H4)
 * with their text, level, and slug. Used by the wiki-link autocomplete to
 * surface section targets after the user types `![[Note#`.
 *
 * Le parcours est RÉCURSIF : un titre posé dans un encadré (callout), une
 * colonne ou un dépliant est un titre comme un autre. C'est la seule source de
 * vérité des titres d'une note — le sommaire (`OutlinePanel`) la consomme lui
 * aussi, pour que l'autocomplétion `![[Note#` et le sommaire ne puissent pas
 * proposer deux listes différentes.
 */
export function extractHeadings(doc: unknown): HeadingEntry[] {
  if (!doc || typeof doc !== 'object') return [];
  const root = doc as PMDoc;
  const headings: HeadingEntry[] = [];
  function visit(node: PMNode) {
    if (node.type === 'heading') {
      const text = nodeText(node);
      const level = typeof node.attrs?.level === 'number' ? (node.attrs.level as number) : 1;
      // `index` compte AUSSI les titres vides : le DOM les rend (un `<h2>`
      // vide existe), donc les sauter décalerait toutes les ancres suivantes.
      headings.push({ text, level, slug: slugifyHeading(text), index: headings.length });
    }
    if (node.content) {
      for (const child of node.content) visit(child);
    }
  }
  for (const node of root.content ?? []) visit(node);
  return headings;
}

/**
 * Même chose depuis la forme PERSISTÉE (JSON sérialisé du magasin). Un JSON
 * illisible rend une liste vide : un sommaire ne doit jamais faire tomber
 * l'écran qui l'affiche.
 */
export function extractHeadingsFromJson(contentJson: string): HeadingEntry[] {
  if (!contentJson) return [];
  try {
    return extractHeadings(JSON.parse(contentJson));
  } catch {
    return [];
  }
}
