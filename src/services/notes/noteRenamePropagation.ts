/**
 * Propagates a note rename to every note that references it.
 *
 * When a note's title changes, any other note that contains
 * `[[OldTitle]]`, `![[OldTitle]]`, or aliased variants like
 * `[[OldTitle|alias]]` needs its content rewritten so the links stay
 * pointing at something resolvable. The transclusion node already binds
 * to a stable `noteId` so its header text auto-updates, but plain
 * wiki-links live as text inside the ProseMirror tree and don't.
 *
 * The walker visits every text node in the JSON tree, applies
 * `renameWikiLinkTarget` to its `.text`, and reports which notes
 * actually changed so the caller can dispatch the minimal set of
 * `updateNoteContent` actions.
 *
 * Also updates the `plainText` mirror (used by search), since that's
 * built from the same wiki-link source.
 */

import { renameWikiLinkTarget, stripWikiLinks } from './noteLinkParser';
import type { Note } from '../../types/notes';

interface PMTextNode {
  type: string;
  text?: string;
  content?: PMTextNode[];
  marks?: unknown[];
  attrs?: Record<string, unknown>;
}

export interface PropagationUpdate {
  id: string;
  content: string;
  plainText: string;
}

/** Walk the tree; mutates text nodes in place; returns true if anything changed. */
function rewriteTextNodes(node: PMTextNode, oldName: string, newName: string): boolean {
  let changed = false;
  if (node.text) {
    const updated = renameWikiLinkTarget(node.text, oldName, newName);
    if (updated !== node.text) {
      node.text = updated;
      changed = true;
    }
  }
  if (node.content) {
    for (const child of node.content) {
      if (rewriteTextNodes(child, oldName, newName)) changed = true;
    }
  }
  // Transclusion nodes carry the old title in `noteTitle` for display
  // when the source has been deleted — keep it in sync so the live
  // node header still matches when the source still exists.
  if (
    node.type === 'transclusion' &&
    node.attrs &&
    (node.attrs as { noteTitle?: string }).noteTitle &&
    (node.attrs as { noteTitle?: string }).noteTitle?.toLowerCase() === oldName.toLowerCase()
  ) {
    (node.attrs as { noteTitle?: string }).noteTitle = newName;
    changed = true;
  }
  return changed;
}

/**
 * Compute the set of content updates needed when `oldName` becomes
 * `newName`. Returns one entry per affected note; pass each to
 * `updateNoteContent` to apply.
 *
 * The caller is responsible for excluding the renamed note itself (its
 * title change is handled separately via `updateNote`).
 */
export function computeRenameUpdates(
  notes: Note[],
  oldName: string,
  newName: string,
  excludeId: string
): PropagationUpdate[] {
  if (!oldName || !newName || oldName === newName) return [];
  const updates: PropagationUpdate[] = [];

  for (const note of notes) {
    if (note.id === excludeId) continue;
    if (note.deletedAt) continue;
    if (!note.content) continue;
    // Quick reject: if the source text doesn't even mention the old name,
    // there's no chance we'll change anything. Saves a JSON parse per note.
    if (!note.content.toLowerCase().includes(oldName.toLowerCase())) continue;

    let json: PMTextNode;
    try {
      json = JSON.parse(note.content) as PMTextNode;
    } catch {
      continue;
    }
    const changed = rewriteTextNodes(json, oldName, newName);
    if (!changed) continue;

    const newContent = JSON.stringify(json);
    const newPlainText = stripWikiLinks(
      // Re-derive plainText from the new content by stripping wiki-link
      // markup from concatenated text. We don't have a full ProseMirror →
      // plaintext renderer here, but stripWikiLinks on the existing
      // plainText handles the rename targets correctly.
      renameWikiLinkTarget(note.plainText ?? '', oldName, newName)
    );

    updates.push({ id: note.id, content: newContent, plainText: newPlainText });
  }

  return updates;
}
