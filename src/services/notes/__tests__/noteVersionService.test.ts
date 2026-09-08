import { describe, it, expect, afterEach } from 'vitest';

/**
 * `window` N'EXISTE PAS DANS L'ENVIRONNEMENT `node` DE VITEST.
 *
 * Ces tests viennent de Jest, ou l'environnement JSDOM etait le defaut et ou
 * `window === globalThis`. Ils ne testent aucun DOM — ils posent seulement
 * `window.electron` pour doubler le pont IPC. Aliaser suffit donc, et evite
 * d'ajouter jsdom (une dependance de plusieurs megaoctets) pour cinq lignes.
 */
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window?: unknown }).window = globalThis;
}

/**
 * Tests for the renderer-side IPC facade.
 *
 * What we care about:
 *   - Correct channel names and argument order (contract with main).
 *   - Graceful degradation when the bridge is missing (tests, storybook).
 *   - Input validation on the client side (empty ids short-circuit).
 *   - Pure `diffVersions` produces the expected edit script.
 */

import {
  clearVersions,
  deleteVersion,
  diffVersions,
  getVersion,
  listVersions,
} from '../noteVersionService';

type InvokeCall = { channel: string; args: unknown[] };

function installBridge(invoke: (channel: string, ...args: unknown[]) => unknown): InvokeCall[] {
  const calls: InvokeCall[] = [];
  (window as any).electron = {
    ipcRenderer: {
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args });
        return invoke(channel, ...args);
      },
    },
  };
  return calls;
}

function uninstallBridge() {
  delete (window as any).electron;
}

describe('noteVersionService (renderer facade)', () => {
  afterEach(() => uninstallBridge());

  describe('listVersions', () => {
    it('invokes note-versions:list with the note id', async () => {
      const calls = installBridge(() => [
        { id: 'v1', savedAt: '2026-04-18T10:00:00Z', title: 'A', wordCount: 1, contentHash: 'h' },
      ]);
      const result = await listVersions('note-1');
      expect(calls).toEqual([{ channel: 'note-versions:list', args: ['note-1'] }]);
      expect(result).toHaveLength(1);
    });

    it('returns an empty array when the bridge is missing', async () => {
      expect((window as any).electron).toBeUndefined();
      const result = await listVersions('note-1');
      expect(result).toEqual([]);
    });

    it('returns an empty array when IPC throws', async () => {
      installBridge(() => {
        throw new Error('boom');
      });
      const result = await listVersions('note-1');
      expect(result).toEqual([]);
    });

    it('short-circuits on empty note id without invoking IPC', async () => {
      const calls = installBridge(() => []);
      const result = await listVersions('');
      expect(result).toEqual([]);
      expect(calls).toEqual([]);
    });

    it('coerces non-array responses to []', async () => {
      installBridge(() => 'not an array' as any);
      const result = await listVersions('note-1');
      expect(result).toEqual([]);
    });
  });

  describe('getVersion', () => {
    it('returns the content on success', async () => {
      installBridge(() => ({
        id: 'v1',
        noteId: 'n1',
        savedAt: '2026-04-18T10:00:00Z',
        title: 'T',
        wordCount: 3,
        contentHash: 'h',
        content: '{"type":"doc"}',
        plainText: 'hello world',
      }));
      const result = await getVersion('n1', 'v1');
      expect(result?.title).toBe('T');
      expect(result?.plainText).toBe('hello world');
    });

    it('returns null when note or version id is empty', async () => {
      const calls = installBridge(() => ({}));
      expect(await getVersion('', 'v1')).toBeNull();
      expect(await getVersion('n1', '')).toBeNull();
      expect(calls).toEqual([]);
    });
  });

  describe('deleteVersion', () => {
    it('forwards both ids to the main process', async () => {
      const calls = installBridge(() => true);
      const result = await deleteVersion('n1', 'v1');
      expect(result).toBe(true);
      expect(calls).toEqual([{ channel: 'note-versions:delete', args: ['n1', 'v1'] }]);
    });

    it('returns false when the bridge is missing', async () => {
      expect(await deleteVersion('n1', 'v1')).toBe(false);
    });
  });

  describe('clearVersions', () => {
    it('calls note-versions:clear', async () => {
      const calls = installBridge(() => true);
      const result = await clearVersions('n1');
      expect(result).toBe(true);
      expect(calls).toEqual([{ channel: 'note-versions:clear', args: ['n1'] }]);
    });
  });
});

describe('diffVersions', () => {
  it('marks identical lines as same', () => {
    const lines = diffVersions('a\nb\nc', 'a\nb\nc');
    expect(lines.map((l) => l.type)).toEqual(['same', 'same', 'same']);
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('detects additions at the end', () => {
    const lines = diffVersions('a\nb', 'a\nb\nc');
    expect(lines.map((l) => l.type)).toEqual(['same', 'same', 'added']);
    expect(lines[2].text).toBe('c');
  });

  it('detects deletions at the end', () => {
    const lines = diffVersions('a\nb\nc', 'a\nb');
    expect(lines.map((l) => l.type)).toEqual(['same', 'same', 'removed']);
    expect(lines[2].text).toBe('c');
  });

  it('detects a mid-string insertion via lookahead', () => {
    const lines = diffVersions('a\nc', 'a\nb\nc');
    const types = lines.map((l) => l.type);
    expect(types).toContain('added');
    expect(lines.find((l) => l.type === 'added')?.text).toBe('b');
    // The pre and post context stays as `same`.
    expect(lines[0]).toMatchObject({ type: 'same', text: 'a' });
  });

  it('detects a mid-string deletion', () => {
    const lines = diffVersions('a\nb\nc', 'a\nc');
    expect(lines.some((l) => l.type === 'removed' && l.text === 'b')).toBe(true);
  });

  it('falls back to replace when lookahead is exhausted', () => {
    const lines = diffVersions('x', 'y');
    expect(lines).toEqual([
      { type: 'removed', text: 'x', lineNumber: 1 },
      { type: 'added', text: 'y', lineNumber: 2 },
    ]);
  });

  it('handles completely empty inputs', () => {
    expect(diffVersions('', '')).toEqual([{ type: 'same', text: '', lineNumber: 1 }]);
  });

  it('numbers lines sequentially including insertions', () => {
    const lines = diffVersions('a\nb', 'a\nnew\nb');
    const nums = lines.map((l) => l.lineNumber);
    // Strictly increasing, no gaps.
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]).toBe(nums[i - 1] + 1);
    }
  });
});
