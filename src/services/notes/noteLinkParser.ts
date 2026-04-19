/**
 * Wiki-Link Parser for Filarr Notes
 *
 * Parses [[wiki-links]] in note content, supporting:
 * - [[note-name]]          → link to note
 * - [[file:filename]]      → link to file
 * - [[folder:foldername]]  → link to folder
 * - [[target|alias]]       → aliased link
 * - ![[target]]            → embed
 */

import type { ParsedLink, WikiLinkType } from '../../types/notes';

/** Regex to match wiki-links: !?[[type:target|alias]] */
const WIKI_LINK_REGEX = /(!?)\[\[(?:(note|file|folder):)?([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Parse all wiki-links from a text string.
 */
export function parseWikiLinks(text: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  WIKI_LINK_REGEX.lastIndex = 0;

  while ((match = WIKI_LINK_REGEX.exec(text)) !== null) {
    const [raw, embedPrefix, typeStr, target, alias] = match;
    const type: WikiLinkType = (typeStr as WikiLinkType) || 'note';

    links.push({
      raw,
      type,
      target: target.trim(),
      alias: alias?.trim(),
      isEmbed: embedPrefix === '!',
      start: match.index,
      end: match.index + raw.length,
    });
  }

  return links;
}

/**
 * Extract all linked note names from text content.
 */
export function extractNoteLinks(text: string): string[] {
  return parseWikiLinks(text)
    .filter((l) => l.type === 'note' && !l.isEmbed)
    .map((l) => l.target);
}

/**
 * Extract all linked file names from text content.
 */
export function extractFileLinks(text: string): string[] {
  return parseWikiLinks(text)
    .filter((l) => l.type === 'file')
    .map((l) => l.target);
}

/**
 * Extract all linked folder names from text content.
 */
export function extractFolderLinks(text: string): string[] {
  return parseWikiLinks(text)
    .filter((l) => l.type === 'folder')
    .map((l) => l.target);
}

/**
 * Replace wiki-link targets in text (for rename propagation).
 */
export function renameWikiLinkTarget(
  text: string,
  oldName: string,
  newName: string,
  type: WikiLinkType = 'note'
): string {
  const prefix = type === 'note' ? '' : `${type}:`;
  const escapedOld = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(\\[\\[(?:${type}:)?)${escapedOld}((?:\\|[^\\]]*)?\\]\\])`,
    'g'
  );
  return text.replace(pattern, `$1${prefix}${newName}$2`);
}

/**
 * Build a plain-text version by stripping wiki-link markup.
 * [[note|alias]] → alias, [[note]] → note
 */
export function stripWikiLinks(text: string): string {
  return text.replace(WIKI_LINK_REGEX, (_match, _embed, _type, target, alias) => {
    return alias || target;
  });
}

/**
 * Count the total number of wiki-links in text.
 */
export function countWikiLinks(text: string): number {
  return parseWikiLinks(text).length;
}
