/**
 * Shared unwrap helper for block wrapper nodes (toggle, callout).
 *
 * These nodes are `defining: true`, which deliberately stops ProseMirror's
 * default Backspace from joining or lifting them — otherwise typing at the
 * start of a callout would silently dissolve it. The side effect was that
 * there was NO gesture left to remove one: the old Backspace handlers only
 * fired when the wrapper was already empty, so a toggle with any text in it
 * could not be deleted at all without selecting whole lines around it.
 *
 * This gives those handlers a real removal path: replace the wrapper with its
 * own children, so the block disappears and the text the user wrote survives.
 */

import type { Editor } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

/** Depth of the nearest ancestor of the given type, or null when not inside one. */
export function findWrapperDepth($from: ResolvedPos, typeName: string): number | null {
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === typeName) return depth;
  }
  return null;
}

/**
 * Replace the wrapper at `depth` with its children.
 *
 * `inlineChildTypes` names children that hold INLINE content rather than
 * blocks — the toggle's `toggleSummary`. Those get re-wrapped in a paragraph,
 * since splicing inline content straight into block position is not valid
 * against the schema. An empty one is dropped instead, so removing a toggle
 * whose summary was never filled in does not leave a blank line behind.
 */
export function unwrapBlockWrapper(
  editor: Editor,
  depth: number,
  inlineChildTypes: string[] = []
): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;

  const wrapper = $from.node(depth);
  const start = $from.before(depth);

  const replacement: PMNode[] = [];
  wrapper.forEach((child) => {
    if (inlineChildTypes.includes(child.type.name)) {
      if (child.content.size > 0) {
        replacement.push(paragraph.create(null, child.content));
      }
      return;
    }
    replacement.push(child);
  });

  // Never replace with nothing — that would delete the block the caret is in
  // and leave the selection dangling.
  if (replacement.length === 0) replacement.push(paragraph.create());

  const tr = state.tr.replaceWith(start, start + wrapper.nodeSize, replacement);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(start + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Delete the wrapper outright when the user selected the whole node (click on
 * its edge / drag handle) and pressed Backspace or Delete.
 */
export function deleteSelectedNodeOfType(editor: Editor, typeName: string): boolean {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === typeName) {
    return editor.commands.deleteSelection();
  }
  return false;
}
