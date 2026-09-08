import { describe, it, expect } from 'vitest';
import { parseObsidianVault } from './obsidianImporter';
import type { SourceEntry, ExternalImportOptions } from '../externalImportService';

// Locks the behaviour of the LIVE Obsidian importer (it ships enabled), so the Notion work and any
// future refactor can't silently regress it. `node` vitest env → markdown path only.

const opts = (over: Partial<ExternalImportOptions> = {}): ExternalImportOptions => ({
  source: 'obsidian',
  sourcePath: '/vault',
  importTags: true,
  preserveLinks: true,
  ...over,
});

const file = (relativePath: string, content: string): SourceEntry => ({
  relativePath,
  content,
  isDirectory: false,
});

type ImportedNote = Awaited<ReturnType<typeof parseObsidianVault>>['notes'][number] & {
  _importTags?: string[];
  _folderName?: string;
};

describe('Obsidian importer', () => {
  it('titles the note from the filename and preserves [[wiki-links]] for chip rendering', async () => {
    const r = await parseObsidianVault(
      [file('Daily/Monday.md', 'Met with [[Project X]] today.')],
      opts()
    );
    expect(r.notes[0].title).toBe('Monday');
    expect(r.notes[0].content).toContain('[[Project X]]');
  });

  it('collects frontmatter tags + inline #tags, registering nested parent/child', async () => {
    const md = '---\ntags: [work, urgent]\n---\n\nSome #area/frontend work.';
    const r = await parseObsidianVault([file('Note.md', md)], opts());
    const note = r.notes[0] as ImportedNote;
    expect(note._importTags).toEqual(expect.arrayContaining(['work', 'urgent', 'frontend']));
    const frontend = r.tags.find((t) => t.name === 'frontend');
    expect(frontend?.parentName).toBe('area');
  });

  it('normalises [[Page#Section|Alias]] → [[Alias]] and [[Page#Section]] → [[Page]]', async () => {
    const r = await parseObsidianVault(
      [file('N.md', 'See [[Target Page#Heading|nice name]] and [[Other#sec]].')],
      opts()
    );
    const c = r.notes[0].content;
    expect(c).toContain('[[nice name]]');
    expect(c).toContain('[[Other]]');
  });

  it('maps the top-level folder to a notebook', async () => {
    const r = await parseObsidianVault([file('Work/Reports/Q1.md', '# Q1')], opts());
    const note = r.notes[0] as ImportedNote;
    expect(note._folderName).toBe('Work');
    expect(r.notebooks).toEqual([{ name: 'Work', noteIds: [r.notes[0].id] }]);
  });

  it('preprocesses ==highlight== and Obsidian callouts without losing the text', async () => {
    const r = await parseObsidianVault(
      [file('C.md', '==important==\n\n> [!note] Heads up')],
      opts()
    );
    expect(r.notes[0].plainText).toContain('important');
    expect(r.notes[0].plainText.toLowerCase()).toContain('heads up');
  });

  it('does not import tags when importTags is off', async () => {
    const r = await parseObsidianVault([file('N.md', '#keepme out')], opts({ importTags: false }));
    expect(r.tags).toHaveLength(0);
    const note = r.notes[0] as ImportedNote;
    expect(note._importTags ?? []).toHaveLength(0);
  });
});
