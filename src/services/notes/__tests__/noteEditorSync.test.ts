/**
 * Regression guard for Bug 3 — long notes used to rerun
 * `JSON.stringify(editor.getJSON())` on every round-trip save, turning
 * keystroke latency into O(n) work. The fix adds a ref cache so
 * round-trips short-circuit in O(1). These tests pin that behavior.
 */

import { syncEditorContent } from '../noteEditorSync';
import { describe, it, expect, vi } from 'vitest';

function makeMockEditor() {
  return {
    commands: {
      setContent: vi.fn(),
    },
  };
}

describe('syncEditorContent', () => {
  it('does nothing when the editor is not mounted yet', () => {
    const ref = { current: null as string | null };
    const result = syncEditorContent(null, '{"type":"doc"}', ref);
    expect(result).toBe('skipped');
    expect(ref.current).toBe(null);
  });

  it('sets initial content and caches it', () => {
    const editor = makeMockEditor();
    const ref = { current: null as string | null };
    const content = JSON.stringify({ type: 'doc', content: [] });

    const result = syncEditorContent(editor, content, ref);

    expect(result).toBe('set');
    expect(editor.commands.setContent).toHaveBeenCalledTimes(1);
    expect(editor.commands.setContent).toHaveBeenCalledWith(
      { type: 'doc', content: [] },
      { emitUpdate: false }
    );
    expect(ref.current).toBe(content);
  });

  it('short-circuits round-trip saves without touching the editor', () => {
    // This is the hot path: typing → debounced onUpdate writes `json` to
    // the ref, dispatches to Redux, Redux feeds note.content back here,
    // we should do *nothing*. Previously this path called
    // JSON.stringify(editor.getJSON()) on every pass.
    const editor = makeMockEditor();
    const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
    const ref = { current: content };

    const result = syncEditorContent(editor, content, ref);

    expect(result).toBe('skipped');
    expect(editor.commands.setContent).not.toHaveBeenCalled();
  });

  it('re-syncs when external content diverges from the cache', () => {
    // e.g. restoring a previous version through the version-history
    // panel dispatches updateNoteContent, and the live editor must
    // pick it up even though its own last-emitted snapshot differs.
    const editor = makeMockEditor();
    const oldContent = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
    const newContent = JSON.stringify({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 } }],
    });
    const ref = { current: oldContent };

    const result = syncEditorContent(editor, newContent, ref);

    expect(result).toBe('set');
    expect(editor.commands.setContent).toHaveBeenCalledTimes(1);
    expect(ref.current).toBe(newContent);
  });

  it('clears the editor when note.content becomes empty', () => {
    const editor = makeMockEditor();
    const ref = { current: JSON.stringify({ type: 'doc' }) };

    const result = syncEditorContent(editor, '', ref);

    expect(result).toBe('cleared');
    expect(editor.commands.setContent).toHaveBeenCalledWith('', { emitUpdate: false });
    expect(ref.current).toBe('');
  });

  it('skips clearing when already empty', () => {
    const editor = makeMockEditor();
    const ref = { current: '' };

    const result = syncEditorContent(editor, '', ref);

    expect(result).toBe('skipped');
    expect(editor.commands.setContent).not.toHaveBeenCalled();
  });

  it('falls back to raw string when note.content is not valid JSON', () => {
    // Defensive path: legacy notes could hold raw text. The old inline
    // code had this fallback; the extracted helper must keep it.
    const editor = makeMockEditor();
    const ref = { current: null as string | null };

    const result = syncEditorContent(editor, 'plain text not json', ref);

    expect(result).toBe('set');
    expect(editor.commands.setContent).toHaveBeenCalledWith('plain text not json', {
      emitUpdate: false,
    });
    expect(ref.current).toBe('plain text not json');
  });

  it('bug-3 regression: skipping is O(1) even when content is huge', () => {
    // If anyone ever reintroduces a `JSON.stringify(editor.getJSON())`
    // comparison, this test still passes on small docs but would blow
    // past the budget on a 1 MB doc. We pin a tight budget here.
    const editor = makeMockEditor();
    const hugeParagraphs = Array.from({ length: 20000 }, (_, i) => ({
      type: 'paragraph',
      content: [
        { type: 'text', text: `Paragraph ${i} with plenty of filler text to grow the doc` },
      ],
    }));
    const huge = JSON.stringify({ type: 'doc', content: hugeParagraphs });
    const ref = { current: huge };

    const iterations = 5000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      syncEditorContent(editor, huge, ref);
    }
    const elapsed = performance.now() - start;

    expect(editor.commands.setContent).not.toHaveBeenCalled();
    // 5000 round-trips on a ~2 MB doc should finish well under 200ms
    // on any reasonable machine — identity-compare is O(1). The old
    // JSON.stringify(editor.getJSON()) path would take several
    // seconds for the same workload, so this budget is tight enough
    // to catch a regression and loose enough to survive slow CI.
    expect(elapsed).toBeLessThan(200);
  });
});
