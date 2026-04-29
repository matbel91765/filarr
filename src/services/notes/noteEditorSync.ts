/**
 * Editor content sync helper — Filarr Notes
 *
 * Encapsulates the "push Redux note.content into the live TipTap editor"
 * step used by NoteEditor's resync useEffect. Factored out so the
 * round-trip-short-circuit behavior is trivially testable without
 * spinning up TipTap + React + Redux.
 *
 * Hot path: on every keystroke the onUpdate debounce dispatches a
 * Redux content update. Redux then feeds note.content back into the
 * resync effect. Re-parsing the same string here on every cycle is
 * pure waste and scales O(n) with note size — the `lastSyncedRef`
 * short-circuit makes that round-trip O(1).
 */

// Uses `any` on the content parameter so the real TipTap Editor (which
// accepts `Content | Node | Fragment`) satisfies EditorLike without a
// cast, while test mocks only have to implement `commands.setContent`.
// Return type is left wide (TipTap returns boolean, we ignore it).
export type EditorLike = {
  commands: {
    // eslint-disable-next-line
    setContent: (content: any, opts?: { emitUpdate?: boolean }) => unknown;
  };
};

export type SyncResult = 'skipped' | 'cleared' | 'set';

/**
 * Sync `noteContent` into `editor` if (and only if) it differs from
 * the last value this editor instance emitted. Updates `lastSyncedRef`
 * in place so the next call can short-circuit.
 *
 * Returns what happened, primarily so tests can assert behavior.
 */
export function syncEditorContent(
  editor: EditorLike | null,
  noteContent: string | undefined,
  lastSyncedRef: { current: string | null }
): SyncResult {
  if (!editor) return 'skipped';

  if (!noteContent) {
    if (lastSyncedRef.current === '') return 'skipped';
    editor.commands.setContent('', { emitUpdate: false });
    lastSyncedRef.current = '';
    return 'cleared';
  }

  if (noteContent === lastSyncedRef.current) return 'skipped';

  try {
    const parsed = JSON.parse(noteContent);
    editor.commands.setContent(parsed, { emitUpdate: false });
  } catch {
    editor.commands.setContent(noteContent, { emitUpdate: false });
  }
  lastSyncedRef.current = noteContent;
  return 'set';
}
