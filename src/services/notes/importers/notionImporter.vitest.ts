import { describe, it, expect } from 'vitest';
import { parseNotionExport } from './notionImporter';
import type { SourceEntry, ExternalImportOptions } from '../externalImportService';

// Characterises + locks the Notion importer. The historical bug: it built a title map for internal
// links and never used it, so cross-page links broke. These run in the `node` vitest env, so only
// the markdown path is exercised (the HTML path needs DOMParser).

const opts = (over: Partial<ExternalImportOptions> = {}): ExternalImportOptions => ({
  source: 'notion',
  sourcePath: '/export',
  importTags: true,
  preserveLinks: true,
  ...over,
});

const file = (relativePath: string, content: string): SourceEntry => ({
  relativePath,
  content,
  isDirectory: false,
});

type ImportedNote = Awaited<ReturnType<typeof parseNotionExport>>['notes'][number] & {
  _importTags?: string[];
  _folderName?: string;
};

describe('Notion importer', () => {
  it('strips the hex-UUID suffix from the page title', async () => {
    const r = await parseNotionExport(
      [file('My Page abc1234567890abcdef1234.md', '# My Page\n\nHello world.')],
      opts()
    );
    expect(r.notesImported).toBe(1);
    expect(r.notes[0].title).toBe('My Page');
  });

  it('rewrites a Notion internal link to a [[wiki-link]] (the title map is actually used now)', async () => {
    const entries = [
      file(
        'Alpha aaaaaaaaaaaaaaaaaaaa.md',
        'See [Beta](Beta%20bbbbbbbbbbbbbbbbbbbb.md) for details.'
      ),
      file('Beta bbbbbbbbbbbbbbbbbbbb.md', '# Beta\n\nThe target page.'),
    ];
    const r = await parseNotionExport(entries, opts());
    const alpha = r.notes.find((n) => n.title === 'Alpha')!;
    expect(alpha.content).toContain('[[Beta]]');
    expect(alpha.content).not.toContain('Beta%20'); // the raw href is gone
    expect(r.linksResolved).toBe(1);
  });

  it('leaves external links and images untouched', async () => {
    const r = await parseNotionExport(
      [
        file(
          'Links abcdefabcdefabcdefab.md',
          'A [site](https://example.com) and an ![pic](photo%20xx.png).'
        ),
      ],
      opts()
    );
    const c = r.notes[0].content;
    expect(c).not.toContain('[['); // nothing converted to a wiki-link
    expect(c).toContain('https://example.com');
  });

  it('maps the top-level export folder to a notebook (parity with Obsidian)', async () => {
    const r = await parseNotionExport(
      [file('Projects abcdefabcdefabcdefab/Task one cdcdcdcdcdcdcdcdcdcd.md', '# Task one')],
      opts()
    );
    const note = r.notes[0] as ImportedNote;
    expect(note.title).toBe('Task one');
    expect(note._folderName).toBe('Projects');
    expect(r.notebooks).toEqual([{ name: 'Projects', noteIds: [r.notes[0].id] }]);
  });

  it('assigns CSV database Select values as tags, matched to the page by title — no orphan tags', async () => {
    const entries = [
      file('Carbonara abcdefabcdefabcdefab.md', '# Carbonara'),
      file(
        'Recipes abcdefabcdefabcdefab.csv',
        'Name,Tags\nCarbonara,"dinner,italian"\nGhost,breakfast'
      ),
    ];
    const r = await parseNotionExport(entries, opts());
    const note = r.notes.find((n) => n.title === 'Carbonara') as ImportedNote;
    expect(note._importTags).toEqual(expect.arrayContaining(['dinner', 'italian']));
    const tagNames = r.tags.map((t) => t.name);
    expect(tagNames).toEqual(expect.arrayContaining(['dinner', 'italian']));
    // "Ghost" matched no imported page → its tag must NOT be created as an orphan
    expect(tagNames).not.toContain('breakfast');
  });

  it('warns (and does not throw) when the export has no content files', async () => {
    const r = await parseNotionExport([file('cover.png', 'binary')], opts());
    expect(r.notesImported).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  // ---- regression: review findings C1, C2, C5, C6 ----

  it('C1: imports pages whose title contains a double underscore (no silent drop)', async () => {
    const r = await parseNotionExport(
      [file('My__Note abcdefabcdefabcdefab.md', '# My__Note\n\nKept.')],
      opts()
    );
    expect(r.notesImported).toBe(1);
    expect(r.notes[0].title).toBe('My__Note');
  });

  it('C2: sanitises [ ] | in titles/links so the chip is not corrupted and still resolves', async () => {
    const entries = [
      file(
        'Index aaaaaaaaaaaaaaaaaaaa.md',
        'See [the spec](Spec%20%5Bv2%5D%20bbbbbbbbbbbbbbbbbbbb.md).'
      ),
      file('Spec [v2] bbbbbbbbbbbbbbbbbbbb.md', '# Spec'),
    ];
    const r = await parseNotionExport(entries, opts());
    const target = r.notes.find((n) => n.title === 'Spec v2'); // brackets stripped from the title
    expect(target).toBeTruthy();
    const index = r.notes.find((n) => n.title === 'Index')!;
    expect(index.content).toContain('[[Spec v2]]'); // safe + resolvable
    expect(index.content).not.toContain('[[Spec [v2]'); // not the corrupted/truncated form
  });

  it('C5: a quoted multi-line CSV cell does not break the next row’s tags', async () => {
    const csv = 'Name,Notes,Tags\n"Recipe","line1\nline2",dinner\nSoup,simple,lunch';
    const entries = [
      file('Recipe abcdefabcdefabcdefab.md', '# Recipe'),
      file('Soup abcdefabcdefabcdefab.md', '# Soup'),
      file('DB abcdefabcdefabcdefab.csv', csv),
    ];
    const r = await parseNotionExport(entries, opts());
    const recipe = r.notes.find((n) => n.title === 'Recipe') as ImportedNote;
    const soup = r.notes.find((n) => n.title === 'Soup') as ImportedNote;
    expect(recipe._importTags).toEqual(['dinner']);
    expect(soup._importTags).toEqual(['lunch']);
  });

  it('C6: a free-text column like "Prototype" is not mistaken for a tag column', async () => {
    const csv = 'Name,Prototype\nWidget,SomeFreeText';
    const entries = [
      file('Widget abcdefabcdefabcdefab.md', '# Widget'),
      file('DB abcdefabcdefabcdefab.csv', csv),
    ];
    const r = await parseNotionExport(entries, opts());
    const widget = r.notes.find((n) => n.title === 'Widget') as ImportedNote;
    expect(widget._importTags ?? []).toHaveLength(0);
    expect(r.tags).toHaveLength(0);
  });

  it('C3: warns when two pages share a clean title', async () => {
    const entries = [
      file('Meeting aaaaaaaaaaaaaaaaaaaa.md', '# Meeting'),
      file('Meeting bbbbbbbbbbbbbbbbbbbb.md', '# Meeting'),
    ];
    const r = await parseNotionExport(entries, opts());
    expect(r.warnings.some((w) => /duplicat/i.test(w))).toBe(true);
  });
});
