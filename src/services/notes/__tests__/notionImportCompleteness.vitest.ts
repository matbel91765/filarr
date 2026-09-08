/**
 * « Import Notion pas complet » — ce fichier fige ce qui manquait.
 *
 * Chaque cas ci-dessous correspond à un bloc qui arrivait dans la note sous
 * forme de texte brut (voire pas du tout) : tableau réduit à des barres
 * verticales, encadré affiché « <aside> 💡 … </aside> » en toutes lettres,
 * plan à trois niveaux mis à plat, et surtout images purement et simplement
 * perdues.
 */

import { describe, it, expect } from 'vitest';
import { markdownToTipTap } from '../noteImportService';
import { buildAssetIndex, base64Bytes, mimeOf } from '../importers/notionAssets';
import { csvToDatabase, inferType } from '../importers/notionCsvDatabase';
import type { SourceEntry } from '../externalImportService';

const PIXEL_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const entry = (
  relativePath: string,
  content: string,
  encoding?: 'utf8' | 'base64'
): SourceEntry => ({
  relativePath,
  content,
  isDirectory: false,
  ...(encoding ? { encoding } : {}),
});

const firstOfType = (doc: any, type: string): any =>
  doc.content?.find((node: any) => node.type === type);

// ==================== Images ====================

describe('images d un export', () => {
  const assets = buildAssetIndex([
    entry('Ma page abc123/schema.png', PIXEL_B64, 'base64'),
    entry('Ma page abc123.md', '# Ma page', 'utf8'),
  ]);

  it('rapatrie les octets dans la note (data-URI), lien URL-encodé compris', () => {
    const { doc } = markdownToTipTap('![Schéma](Ma%20page%20abc123/schema.png)', {
      resolveAsset: (href) => assets.resolve('Ma page abc123.md', href),
    });
    const embed = firstOfType(doc, 'fileEmbed');
    expect(embed).toBeTruthy();
    expect(embed.attrs.fileType).toBe('image/png');
    expect(embed.attrs.src).toBe(`data:image/png;base64,${PIXEL_B64}`);
    expect(embed.attrs.fileName).toBe('Schéma');
  });

  it('retrouve la pièce jointe par son nom quand le chemin ne colle pas', () => {
    // Les exports melangent parfois l'encodage entre le lien et le fichier.
    const found = assets.resolve('ailleurs/autre.md', 'schema.png');
    expect(found?.mime).toBe('image/png');
  });

  it('ne transforme JAMAIS une image distante en balise image', () => {
    // La CSP du renderer la bloquerait, et la charger ferait fuiter
    // l'ouverture de la note vers cet hôte.
    const { doc } = markdownToTipTap('![Logo](https://exemple.test/logo.png)');
    expect(firstOfType(doc, 'fileEmbed')).toBeUndefined();
    const paragraph = firstOfType(doc, 'paragraph');
    expect(paragraph.content[0].marks[0].attrs.href).toBe('https://exemple.test/logo.png');
  });

  it('écarte — et SIGNALE — une pièce jointe trop lourde', () => {
    const huge = buildAssetIndex([entry('p/gros.png', 'A'.repeat(12 * 1024 * 1024), 'base64')]);
    expect(huge.resolve('p/note.md', 'gros.png')).toBeNull();
    expect(huge.skipped).toEqual(['p/gros.png']);
  });

  it('ne prend pas un fichier texte pour une pièce jointe', () => {
    const index = buildAssetIndex([entry('page.md', '# titre', 'utf8')]);
    expect(index.total).toBe(0);
  });

  it('mesure la taille réelle sans décoder, et lit le type par extension', () => {
    expect(base64Bytes('AAAA')).toBe(3);
    expect(base64Bytes('AAA=')).toBe(2);
    expect(mimeOf('a/b/c.JPG')).toBe('image/jpeg');
    expect(mimeOf('sans-extension')).toBe('application/octet-stream');
  });
});

// ==================== Blocs Markdown ====================

describe('blocs que le convertisseur ignorait', () => {
  it('convertit un tableau, en-tête compris', () => {
    const { doc } = markdownToTipTap('| Nom | Rôle |\n| --- | --- |\n| Ada | Pionnière |');
    const table = firstOfType(doc, 'table');
    expect(table.content).toHaveLength(2);
    expect(table.content[0].content[0].type).toBe('tableHeader');
    expect(table.content[1].content[1].content[0].content[0].text).toBe('Pionnière');
  });

  it('complète une rangée trop courte plutôt que de perdre le tableau', () => {
    // Une rangee plus courte que l'en-tete rend le noeud INVALIDE : ProseMirror
    // rejetterait le tableau entier, donc silencieusement.
    const { doc } = markdownToTipTap('| a | b | c |\n| --- | --- | --- |\n| 1 |');
    const table = firstOfType(doc, 'table');
    expect(table.content[1].content).toHaveLength(3);
  });

  it('respecte l imbrication des listes', () => {
    const { doc } = markdownToTipTap('- Racine\n    - Enfant\n        - Petit-enfant\n- Suivant');
    const list = firstOfType(doc, 'bulletList');
    expect(list.content).toHaveLength(2);
    const child = list.content[0].content[1];
    expect(child.type).toBe('bulletList');
    expect(child.content[0].content[1].type).toBe('bulletList');
  });

  it('garde les cases à cocher, imbriquées elles aussi', () => {
    const { doc } = markdownToTipTap('- [x] Fait\n    - [ ] Reste');
    const list = firstOfType(doc, 'taskList');
    expect(list.content[0].attrs.checked).toBe(true);
    expect(list.content[0].content[1].content[0].attrs.checked).toBe(false);
  });

  it('ne mélange pas une liste à puces et une liste de tâches', () => {
    const { doc } = markdownToTipTap('- Puce\n- [ ] Tâche');
    const types = doc.content!.map((n: any) => n.type);
    expect(types).toContain('bulletList');
    expect(types).toContain('taskList');
  });

  it('transforme un <aside> Notion en encadré, emoji en titre', () => {
    const { doc } = markdownToTipTap('<aside>\n💡 Pense à relire.\n</aside>');
    const callout = firstOfType(doc, 'callout');
    expect(callout.attrs.type).toBe('info');
    expect(callout.attrs.title).toBe('💡');
    expect(callout.content[0].content[0].text).toBe('Pense à relire.');
  });

  it('transforme un <details> en bloc dépliable, résumé compris', () => {
    const { doc } = markdownToTipTap(
      '<details><summary>Voir le détail</summary>\nLe contenu.\n</details>'
    );
    const toggle = firstOfType(doc, 'toggleBlock');
    expect(toggle.content[0].type).toBe('toggleSummary');
    expect(toggle.content[0].content[0].text).toBe('Voir le détail');
    expect(toggle.content[1].content[0].text).toBe('Le contenu.');
  });

  it('garde une formule sur plusieurs lignes', () => {
    const { doc } = markdownToTipTap('$$\n\\frac{a}{b}\n$$');
    expect(firstOfType(doc, 'mathBlock').attrs.latex).toBe('\\frac{a}{b}');
  });

  it('n abîme pas ce qui marchait déjà (titre, code, citation)', () => {
    const { title, doc } = markdownToTipTap('# Titre\n\n```js\nconst a = 1;\n```\n\n> Citation');
    expect(title).toBe('Titre');
    expect(firstOfType(doc, 'codeBlock').attrs.language).toBe('js');
    expect(firstOfType(doc, 'blockquote')).toBeTruthy();
  });
});

// ==================== Bases de données ====================

describe('base Notion (CSV) → base de données Filarr', () => {
  const rows = [
    ['Name', 'Status', 'Priorité', 'Échéance', 'Terminé', 'Estimation', 'Site'],
    ['Cadrage', 'En cours', 'Haute, Urgent', '2026-03-05', 'Yes', '3', 'https://a.test'],
    ['Plan', 'À faire', 'Basse', '2026-04-01', 'No', '5,5', 'https://b.test'],
    ['Bilan', 'En cours', 'Haute', '2026-05-02', 'No', '2', 'https://c.test'],
  ];

  const db = csvToDatabase(rows, 'Suivi', 'test');

  it('devine le type de chaque colonne à partir des valeurs', () => {
    const data = JSON.parse(db!.attrs.data as string);
    const byName = Object.fromEntries(data.properties.map((p: any) => [p.name, p.type]));
    expect(byName.Name).toBe('text');
    expect(byName.Status).toBe('select');
    expect(byName['Priorité']).toBe('multiSelect');
    expect(byName['Échéance']).toBe('date');
    expect(byName['Terminé']).toBe('checkbox');
    expect(byName.Estimation).toBe('number');
    expect(byName.Site).toBe('url');
  });

  it('écrit des cellules qui pointent sur de VRAIES options', () => {
    const data = JSON.parse(db!.attrs.data as string);
    const optionIds = new Set(
      data.properties.flatMap((p: any) => (p.options ?? []).map((o: any) => o.id))
    );
    const selectIds = new Set(
      data.properties.filter((p: any) => p.type === 'select').map((p: any) => p.id)
    );
    for (const row of data.rows) {
      for (const [key, value] of Object.entries(row.cells)) {
        if (selectIds.has(key)) expect(optionIds.has(value)).toBe(true);
      }
    }
  });

  it('ouvre en kanban quand une colonne de statut s y prête', () => {
    const data = JSON.parse(db!.attrs.data as string);
    expect(db!.attrs.view).toBe('board');
    expect(data.views[0].groupBy).toBe(db!.attrs.groupBy);
    expect(data.properties.some((p: any) => p.id === data.views[0].groupBy)).toBe(true);
  });

  it('reste un tableau quand aucune colonne ne fait un statut', () => {
    const plain = csvToDatabase(
      [
        ['Nom', 'Note'],
        ['A', 'Texte libre un'],
        ['B', 'Texte libre deux'],
      ],
      'Liste',
      'test2'
    );
    expect(plain!.attrs.view).toBe('table');
  });

  it('convertit les valeurs : nombre à virgule, case à cocher, date', () => {
    const data = JSON.parse(db!.attrs.data as string);
    const idOf = (name: string) => data.properties.find((p: any) => p.name === name).id;
    expect(data.rows[1].cells[idOf('Estimation')]).toBe(5.5);
    expect(data.rows[0].cells[idOf('Terminé')]).toBe(true);
    expect(data.rows[0].cells[idOf('Échéance')]).toBe('2026-03-05');
  });

  it('EST DÉTERMINISTE : deux imports donnent les mêmes octets', () => {
    const again = csvToDatabase(rows, 'Suivi', 'test');
    expect(JSON.stringify(again)).toBe(JSON.stringify(db));
  });

  it('ne fabrique rien à partir d un CSV vide ou sans ligne', () => {
    expect(csvToDatabase([], 'X', 'p')).toBeNull();
    expect(csvToDatabase([['a', 'b']], 'X', 'p')).toBeNull();
    expect(csvToDatabase([['a'], ['   ']], 'X', 'p')).toBeNull();
  });

  it('le doute profite au texte', () => {
    // Mal typer une colonne est PIRE que de la laisser en texte : la cellule
    // s'affiche vide et l'utilisateur croit à une perte.
    expect(inferType(['12', 'douze'])).toBe('text');
    expect(inferType(['2026-01-01', 'bientôt'])).toBe('text');
    expect(inferType([])).toBe('text');
    expect(inferType(['a@b.co', 'c@d.co'])).toBe('email');
  });
});

// ==================== Validité pour l'éditeur ====================

/**
 * Le verrou final : un nœud mal formé n'échoue pas, il est JETÉ au parse.
 * Ces conversions doivent donc tenir devant le VRAI schéma, pas seulement
 * devant les attentes de forme ci-dessus.
 */
describe('ce qui sort de l import est acceptable par l éditeur', () => {
  it('un document portant tous les blocs convertis se recharge intact', async () => {
    const { getSchema } = await import('@tiptap/core');
    const { Node: PMNode } = await import('@tiptap/pm/model');
    const StarterKit = (await import('@tiptap/starter-kit')).default;
    const TaskList = (await import('@tiptap/extension-task-list')).default;
    const TaskItem = (await import('@tiptap/extension-task-item')).default;
    const { Table } = await import('@tiptap/extension-table');
    const { TableRow } = await import('@tiptap/extension-table-row');
    const { TableCell } = await import('@tiptap/extension-table-cell');
    const { TableHeader } = await import('@tiptap/extension-table-header');
    const { CalloutExtension } =
      await import('../../../renderer/components/notes/extensions/calloutExtension');
    const { ToggleExtension, ToggleSummaryExtension } =
      await import('../../../renderer/components/notes/extensions/toggleExtension');
    const { MathBlockExtension } =
      await import('../../../renderer/components/notes/extensions/mathExtension');
    const { FileEmbedExtension } =
      await import('../../../renderer/components/notes/extensions/fileEmbedExtension');
    const { InlineDatabaseExtension } =
      await import('../../../renderer/components/notes/extensions/inlineDatabaseExtension');

    const schema = getSchema([
      StarterKit,
      TaskList,
      TaskItem,
      Table,
      TableRow,
      TableCell,
      TableHeader,
      CalloutExtension,
      ToggleExtension,
      ToggleSummaryExtension,
      MathBlockExtension,
      FileEmbedExtension,
      InlineDatabaseExtension,
    ]);

    const assets = buildAssetIndex([entry('p/img.png', PIXEL_B64, 'base64')]);
    const { doc } = markdownToTipTap(
      [
        '# Page',
        '',
        '![Vue](img.png)',
        '',
        '| Colonne | Autre |',
        '| --- | --- |',
        '| a | b |',
        '',
        '- Racine',
        '    - Enfant',
        '',
        '- [x] Fait',
        '',
        '<aside>💡 Astuce</aside>',
        '',
        '<details><summary>Plus</summary>Contenu</details>',
        '',
        '$$',
        'x^2',
        '$$',
      ].join('\n'),
      { resolveAsset: (href) => assets.resolve('p/page.md', href) }
    );

    const db = csvToDatabase(
      [
        ['Nom', 'Statut'],
        ['A', 'En cours'],
        ['B', 'En cours'],
      ],
      'Base',
      'schema-test'
    );
    doc.content!.push({ type: 'inlineDatabase', attrs: db!.attrs } as never);

    const parsed = PMNode.fromJSON(schema, doc);
    expect(() => parsed.check()).not.toThrow();
    // Aller-retour : un nœud refusé aurait disparu au passage.
    const kinds = new Set<string>();
    parsed.descendants((node) => void kinds.add(node.type.name));
    for (const expected of [
      'fileEmbed',
      'table',
      'bulletList',
      'taskList',
      'callout',
      'toggleBlock',
      'mathBlock',
      'inlineDatabase',
    ]) {
      expect(kinds.has(expected)).toBe(true);
    }
  });
});

// ==================== Ce que montre une page réelle ====================

/**
 * Écarts relevés en comparant une page importée à la même page dans Notion :
 * une base inline y devenait un lien mort, et un signet un simple texte
 * souligné. Les deux ont la même cause — l'export ne les distingue que par la
 * FORME de la ligne.
 */
describe('blocs reconnus à leur forme', () => {
  it('un lien seul sur sa ligne devient un signet', () => {
    const { doc } = markdownToTipTap('[Filarr — Vos fichiers](https://filarr.com)', {
      linkAsBookmark: true,
    });
    const bookmark = firstOfType(doc, 'bookmark');
    expect(bookmark.attrs.url).toBe('https://filarr.com');
    expect(bookmark.attrs.title).toBe('Filarr — Vos fichiers');
    expect(bookmark.attrs.domain).toBe('filarr.com');
    // L'aperçu se remplit à l'affichage : un import n'appelle personne.
    expect(bookmark.attrs.fetched).toBe(false);
  });

  it('reconnaît aussi une URL nue', () => {
    const { doc } = markdownToTipTap('<https://exemple.test/a>', { linkAsBookmark: true });
    expect(firstOfType(doc, 'bookmark').attrs.url).toBe('https://exemple.test/a');
  });

  it('hors import, un lien seul reste un lien', () => {
    // Transformer tout lien isolé en carte serait décider à la place de
    // l'utilisateur dans ses notes de tous les jours.
    const { doc } = markdownToTipTap('[Filarr](https://filarr.com)');
    expect(firstOfType(doc, 'bookmark')).toBeUndefined();
    expect(firstOfType(doc, 'paragraph').content[0].marks[0].type).toBe('link');
  });

  it('un lien DANS une phrase n est jamais un signet', () => {
    const { doc } = markdownToTipTap('Voir [le site](https://filarr.com) pour la suite.', {
      linkAsBookmark: true,
    });
    expect(firstOfType(doc, 'bookmark')).toBeUndefined();
  });
});

// ==================== Une page complète, de bout en bout ====================

describe('page « Bienvenue sur Notion » (export réel)', () => {
  it('la base inline citée dans la page rejoint la note qui la porte', async () => {
    const { parseNotionExport } = await import('../importers/notionImporter');

    const page = [
      '# Bienvenue sur Notion !',
      '',
      '- [x] Créer un compte Notion',
      '- [ ]  Cliquez ci-dessous et tapez `/`',
      '    - [ ] Tapez `/page` pour ajouter une page',
      '',
      '## Test',
      '',
      '[Test Page](Test%20Page%20aaaaaaaaaaaaaaaaaaaaaaaa.md)',
      '',
      '[Filarr — Vos fichiers](https://filarr.com)',
      '',
      '[test](test%20bbbbbbbbbbbbbbbbbbbbbbbb.csv)',
    ].join('\n');

    const result = await parseNotionExport(
      [
        entry('Bienvenue sur Notion ! cccccccccccccccccccccccc.md', page),
        entry('Test Page aaaaaaaaaaaaaaaaaaaaaaaa.md', '# Test Page'),
        entry(
          'test bbbbbbbbbbbbbbbbbbbbbbbb.csv',
          'Nom,Statut\nPremière,En cours\nSeconde,En cours\n'
        ),
      ],
      { importTags: false } as never
    );

    const titles = result.notes.map((note) => note.title);
    expect(titles).toContain('Bienvenue sur Notion !');
    // La base est importée comme note À PART ENTIÈRE…
    expect(titles).toContain('test');

    const main = result.notes.find((note) => note.title === 'Bienvenue sur Notion !')!;
    // …et la page la cite par un lien wiki, pas par un lien mort vers un CSV.
    expect(main.content).toContain('[[test]]');
    expect(main.content).toContain('[[Test Page]]');
    expect(main.content).not.toContain('.csv');

    // Le signet est une carte, la liste garde son imbrication.
    const doc = JSON.parse(main.content);
    const kinds = new Set<string>();
    const walk = (nodes: any[]) => {
      for (const node of nodes ?? []) {
        kinds.add(node.type);
        walk(node.content);
      }
    };
    walk(doc.content);
    expect(kinds.has('bookmark')).toBe(true);
    expect(kinds.has('taskList')).toBe(true);

    // La note de base porte bien une base de données, avec ses deux lignes.
    const dbNote = result.notes.find((note) => note.title === 'test')!;
    const dbDoc = JSON.parse(dbNote.content);
    const dbNode = dbDoc.content.find((n: any) => n.type === 'inlineDatabase');
    expect(dbNode).toBeTruthy();
    expect(JSON.parse(dbNode.attrs.data).rows).toHaveLength(2);
  });
});
