/**
 * Le contenu ATOMIQUE doit entrer dans l'index de recherche.
 *
 * LE DÉFAUT D'ORIGINE. Aucune extension ne définissait `renderText`, donc
 * `getText()` de ProseMirror survolait tous les nœuds `atom:` : la source d'un
 * diagramme mermaid, une formule LaTeX, les cellules d'une base inline, les
 * évènements d'un calendrier n'entraient jamais dans `note.plainText`, seul
 * champ (avec le titre) que `noteSearchService` indexe. Ces contenus étaient
 * INTROUVABLES, sans le moindre signal que la recherche ne les voyait pas.
 *
 * Cette suite éprouve le module PUR (`indexText.ts`) qui produit ce texte, et
 * vérifie séparément que chaque extension concernée le branche bien : les deux
 * moitiés doivent tenir, un formateur parfait qu'aucune extension n'appelle ne
 * corrigerait rien.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NODE_INDEX_TEXT_MAX,
  DB_INDEX_MAX_ROWS,
  bookmarkIndexText,
  calendarIndexText,
  clampIndexText,
  dataviewIndexText,
  embedIndexText,
  fileEmbedIndexText,
  footnoteIndexText,
  inlineDatabaseIndexText,
  mathIndexText,
  mathInlineIndexText,
  mentionIndexText,
  mermaidIndexText,
  subPageIndexText,
  tocIndexText,
} from '../indexText';

describe('texte d’index des blocs à attribut unique', () => {
  it('rend la SOURCE d’un diagramme mermaid, libellés compris', () => {
    const code = 'graph TD\n  A[Facture client] --> B[Relance impayée]';
    const text = mermaidIndexText({ code });
    expect(text).toContain('Facture client');
    expect(text).toContain('Relance impayée');
  });

  it('rend la formule LaTeX telle que saisie', () => {
    expect(mathIndexText({ latex: 'E = mc^2' })).toBe('E = mc^2');
  });

  it('borde la formule INLINE d’espaces pour ne pas souder les mots voisins', () => {
    // Sans marge, « voir$x$suite » deviendrait un jeton unique et « voir »
    // ne serait plus trouvable : c'est le piège des nœuds inline.
    const text = mathInlineIndexText({ latex: 'x_i' });
    expect(text.startsWith(' ')).toBe(true);
    expect(text.endsWith(' ')).toBe(true);
    expect(text.trim()).toBe('x_i');
  });

  it('rend la requête dataview', () => {
    expect(dataviewIndexText({ query: 'TABLE title FROM notes' })).toContain('FROM notes');
  });

  it('rend le contenu d’une note de bas de page, bordé', () => {
    expect(footnoteIndexText({ content: 'Voir le contrat cadre' })).toBe(' Voir le contrat cadre ');
  });

  it('rend le NOM du fichier incrusté, jamais son data-URI', () => {
    const text = fileEmbedIndexText({
      fileName: 'devis-toiture.pdf',
      fileType: 'application/pdf',
      src: 'data:image/png;base64,' + 'A'.repeat(5000),
    });
    expect(text).toBe('devis-toiture.pdf');
    expect(text).not.toContain('base64');
  });

  it('rend le titre d’une sous-page, pas son identifiant', () => {
    const text = subPageIndexText({ noteId: '8f2c0a41-dead-beef', title: 'Compte rendu du 12' });
    expect(text).toBe('Compte rendu du 12');
    expect(text).not.toContain('8f2c0a41');
  });

  it('rend titre et URL d’une incrustation', () => {
    const text = embedIndexText({ title: 'Keynote 2026', url: 'https://youtu.be/abcdefghijk' });
    expect(text).toContain('Keynote 2026');
    expect(text).toContain('youtu.be');
  });

  it('rend ce que la carte de marque-page affiche, pas ses images', () => {
    const text = bookmarkIndexText({
      title: 'Guide fiscal',
      description: 'Barèmes 2026',
      domain: 'impots.gouv.fr',
      url: 'https://impots.gouv.fr/guide',
      image: 'https://cdn.example/preview.png',
      favicon: 'https://cdn.example/fav.ico',
    });
    expect(text).toContain('Guide fiscal');
    expect(text).toContain('Barèmes 2026');
    expect(text).toContain('impots.gouv.fr');
    expect(text).not.toContain('preview.png');
  });

  it('n’indexe RIEN pour le sommaire : ses titres sont déjà indexés à leur place', () => {
    expect(tocIndexText()).toBe('');
  });

  it('ne jette jamais sur des attributs absents ou biscornus', () => {
    // `renderText` tourne dans `getText()`, donc dans le write-back : une
    // exception ici ne dégraderait pas la recherche, elle empêcherait de
    // SAUVEGARDER. Tout doit retomber sur la chaîne vide.
    expect(mermaidIndexText(null)).toBe('');
    expect(mathIndexText(undefined)).toBe('');
    expect(calendarIndexText({ events: '{ pas du json' })).toBe('');
    expect(inlineDatabaseIndexText({ data: 42 })).toBe('');
    expect(inlineDatabaseIndexText({ data: '{"properties":null,"rows":"nope"}' })).toBe('');
  });
});

describe('calendrier inline', () => {
  it('rend date + texte de chaque évènement, jamais le JSON brut', () => {
    const events = JSON.stringify([
      { id: 'e1', date: '2026-09-03', text: 'Rendez-vous notaire', color: 'blue' },
      { id: 'e2', date: '2026-09-11', text: 'Livraison chantier', color: 'red' },
    ]);
    const text = calendarIndexText({ title: 'Septembre', events });
    expect(text).toContain('Septembre');
    expect(text).toContain('2026-09-03');
    expect(text).toContain('Rendez-vous notaire');
    expect(text).toContain('Livraison chantier');
    // Ni identifiants ni couleurs : du bruit qui ferait remonter n'importe quoi.
    expect(text).not.toContain('e1');
    expect(text).not.toContain('blue');
    expect(text).not.toContain('{');
  });
});

// ==================== Base de données inline ====================

function makeDb(rowCount: number) {
  const properties = [
    { id: 'p1', name: 'Client', type: 'text' },
    { id: 'p2', name: 'Statut', type: 'select', options: [{ id: 'o1', label: 'Signé' }] },
    { id: 'p3', name: 'Montant', type: 'number' },
    { id: 'p4', name: 'Suivi', type: 'checkbox' },
    { id: 'p5', name: 'Fiche', type: 'note' },
  ];
  const rows = [];
  for (let i = 0; i < rowCount; i += 1) {
    rows.push({
      id: `r${i}`,
      cells: {
        p1: `Client${i}`,
        p2: 'o1',
        p3: 1000 + i,
        p4: true,
        p5: 'note-uuid-aaaa',
      },
    });
  }
  return JSON.stringify({ properties, rows });
}

describe('base de données inline', () => {
  it('rend les VALEURS de cellules et les noms de colonnes, pas la structure', () => {
    const text = inlineDatabaseIndexText({ title: 'Affaires', data: makeDb(2) });
    expect(text).toContain('Affaires');
    expect(text).toContain('Client'); // nom de colonne
    expect(text).toContain('Client0'); // valeur de cellule
    expect(text).toContain('1000');
    // L'identifiant d'option est résolu en LIBELLÉ : « o1 » ne se cherche pas.
    expect(text).toContain('Signé');
    expect(text).not.toContain('o1');
    // Ni JSON brut, ni identifiants de ligne, ni cellules opaques.
    expect(text).not.toContain('{');
    expect(text).not.toContain('"cells"');
    expect(text).not.toContain('r0');
    expect(text).not.toContain('note-uuid-aaaa');
    expect(text).not.toContain('true');
  });

  it('résout les libellés d’un multiSelect', () => {
    const data = JSON.stringify({
      properties: [
        {
          id: 'p1',
          name: 'Tags',
          type: 'multiSelect',
          options: [
            { id: 'a', label: 'urgent' },
            { id: 'b', label: 'export' },
          ],
        },
      ],
      rows: [{ id: 'r1', cells: { p1: ['a', 'b'] } }],
    });
    const text = inlineDatabaseIndexText({ data });
    expect(text).toContain('urgent');
    expect(text).toContain('export');
  });

  it('BORNE une grosse base : 500 lignes ne produisent pas 500 lignes d’index', () => {
    // `plainText` est persisté dans le coffre chiffré et remonte au nuage à
    // chaque édition : une base non bornée ferait grossir la note d'un ordre
    // de grandeur pour une valeur de recherche nulle.
    const text = inlineDatabaseIndexText({ title: 'Grosse base', data: makeDb(500) });
    expect(text.length).toBeLessThanOrEqual(NODE_INDEX_TEXT_MAX);
    expect(text).toContain('Client0');
    // Bien au-delà du plafond de lignes : rien de cette ligne ne peut sortir.
    expect(text).not.toContain(`Client${DB_INDEX_MAX_ROWS + 50}`);
  });
});

describe('plafond par nœud', () => {
  it('coupe sur une frontière de mot pour ne pas fabriquer de faux jeton', () => {
    const raw = Array.from({ length: 400 }, (_, i) => `mot${i}`).join(' ');
    const text = clampIndexText(raw);
    expect(text.length).toBeLessThanOrEqual(NODE_INDEX_TEXT_MAX);
    // La coupe ne laisse pas un mot tronqué du genre « mot12 » devenu « mot1 ».
    expect(text.endsWith(' ')).toBe(false);
    const last = text.split(' ').pop() as string;
    expect(raw.split(' ')).toContain(last);
  });

  it('aplatit les blancs : l’index n’a que faire de la mise en page', () => {
    expect(clampIndexText('  a\n\n  b\t c ')).toBe('a b c');
  });

  it('coupe quand même un texte sans aucun espace', () => {
    const text = clampIndexText('x'.repeat(2000));
    expect(text.length).toBe(NODE_INDEX_TEXT_MAX);
  });
});

// ==================== Branchement réel des extensions ====================

/**
 * Un formateur que personne n'appelle ne corrige rien — et une LISTE ÉCRITE À
 * LA MAIN des extensions à vérifier ne corrige rien non plus : elle ne tombe
 * jamais quand on ajoute un nœud atomique en l'oubliant. C'est précisément ce
 * qui est arrivé à `transclusion` et `inlineDate`, restés muets sans qu'aucun
 * test ne le dise.
 *
 * Le garde-fou est donc DÉRIVÉ DU SCHÉMA : on construit le schéma réel des
 * notes, on retient tout nœud `isAtom`, et on exige pour chacun soit une
 * entrée dans `INDEXED_ATOMS`, soit une exclusion NOMMÉE ci-dessous. Ajouter
 * un nœud atomique sans le brancher fait désormais tomber cette suite.
 *
 * On ne se contente pas de lire la source : `expect(src).toContain('return
 * X(')` laisserait passer un `return mermaidIndexText(node)` qui ne produirait
 * que du vide. On APPELLE le `toText` que TipTap pose sur la spec du nœud,
 * avec un nœud réel, et on exige que la valeur de l'attribut ressorte.
 *
 * LANCEUR — vitest, même contrainte que schemaExtensions.vitest.ts : le graphe
 * d'import tire des NodeViews React, mais `getSchema()` ne les instancie
 * jamais. Les globales touchées au CHARGEMENT sont bouchonnées.
 */

/**
 * Nœuds atomiques dont le texte d'index est VOLONTAIREMENT vide, avec la
 * raison. Une exclusion sans raison écrite n'a pas sa place ici.
 */
const ATOMS_WITHOUT_INDEX_TEXT: Record<string, string> = {
  text: 'nœud feuille de ProseMirror : c’est le texte lui-même, déjà indexé',
  hardBreak: 'saut de ligne dur — aucun contenu',
  horizontalRule: 'filet horizontal — aucun contenu',
  tableOfContents:
    'reflet des titres, déjà indexés à leur place ; l’indexer les compterait deux fois',
};

/**
 * Nœud atomique → attribut qui doit RESSORTIR dans le texte d'index, et
 * valeur de démonstration. La valeur est choisie discriminante : on exige
 * qu'elle apparaisse telle quelle dans la sortie, ce qui prouve que le
 * `renderText` reçoit bien `node.attrs` et le traverse.
 */
const INDEXED_ATOMS: Record<string, { attr: string; value: string }> = {
  mermaidBlock: { attr: 'code', value: 'graph TD A[Facture client]' },
  mathBlock: { attr: 'latex', value: 'E = mc^2 marqueurBloc' },
  mathInline: { attr: 'latex', value: 'x_marqueurInline' },
  calendarBlock: { attr: 'title', value: 'Jalons du trimestre' },
  inlineDatabase: { attr: 'title', value: 'Suivi des relances' },
  dataviewBlock: { attr: 'query', value: 'TABLE statut FROM #facture' },
  embedUrl: { attr: 'title', value: 'Démonstration produit' },
  bookmark: { attr: 'title', value: 'Barème kilométrique 2026' },
  footnote: { attr: 'content', value: 'précisions sur le calcul' },
  fileEmbed: { attr: 'fileName', value: 'devis-2026-09.pdf' },
  subPage: { attr: 'title', value: 'Annexe technique' },
  transclusion: { attr: 'noteTitle', value: 'Compte rendu du 12' },
  inlineDate: { attr: 'date', value: '2026-09-03' },
  mention: { attr: 'label', value: 'Mathis' },
};

/**
 * Bouchons minimaux : le store Redux, atteint par la vue du bloc « fichier
 * embarqué », lit `localStorage` au chargement du module. Rien de tout cela
 * n'intervient dans la construction du schéma.
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

/** Import différé : les bouchons ci-dessus doivent être posés avant. */
async function noteSchema() {
  const { getSchema } = await import('@tiptap/core');
  const { buildNoteSchemaExtensions } = await import('../schemaExtensions');
  return getSchema(buildNoteSchemaExtensions() as never);
}

describe('branchement de renderText', () => {
  it('tout nœud atomique du schéma est branché OU exclu nommément', async () => {
    const schema = await noteSchema();
    const atoms = Object.entries(schema.nodes)
      .filter(([, type]) => type.isAtom)
      .map(([name]) => name)
      .sort();

    const declared = [
      ...Object.keys(INDEXED_ATOMS),
      ...Object.keys(ATOMS_WITHOUT_INDEX_TEXT),
    ].sort();

    // Dans les DEUX sens : un nœud atomique oublié fait tomber le test, et une
    // entrée qui ne correspond à aucun nœud (renommage, suppression) aussi.
    expect(atoms).toEqual(declared);
  });

  for (const [name, { attr, value }] of Object.entries(INDEXED_ATOMS)) {
    it(`${name} : renderText reçoit node.attrs et rend « ${attr} »`, async () => {
      const schema = await noteSchema();
      const type = schema.nodes[name];
      expect(type, `nœud ${name} absent du schéma`).toBeTruthy();

      const toText = type.spec.toText;
      expect(typeof toText, `${name} ne déclare aucun renderText`).toBe('function');

      // `create` complète seul les attributs manquants par leurs défauts.
      const node = type.create({ [attr]: value });
      const rendered = String(
        (toText as (p: { node: unknown; pos: number; parent: unknown; index: number }) => string)({
          node,
          pos: 0,
          parent: node,
          index: 0,
        })
      );
      expect(rendered).toContain(value);
    });
  }

  it('les nœuds exclus n’apportent aucun jeton à l’index', async () => {
    const schema = await noteSchema();
    for (const name of Object.keys(ATOMS_WITHOUT_INDEX_TEXT)) {
      const toText = schema.nodes[name]?.spec.toText;
      if (!toText) continue; // text/hardBreak/horizontalRule n'en déclarent pas.
      const node = schema.nodes[name].createAndFill();
      expect(node).toBeTruthy();
      const rendered = (
        toText as (p: { node: unknown; pos: number; parent: unknown; index: number }) => string
      )({ node: node!, pos: 0, parent: node!, index: 0 });
      // `hardBreak` rend un saut de ligne (StarterKit) : c'est de la mise en
      // page, pas un jeton. Ce qu'on interdit, c'est du CONTENU.
      expect(String(rendered).trim()).toBe('');
    }
  });

  it('le nœud math déclare DEUX renderText (bloc et inline)', () => {
    const src = readFileSync(join(__dirname, '..', 'mathExtension.ts'), 'utf-8');
    expect(src.split('renderText(').length - 1).toBe(2);
  });
});

describe('mention', () => {
  it('indexe « @label », jamais l’identifiant', () => {
    expect(mentionIndexText({ userId: 'u-42', label: 'Mathis' }).trim()).toBe('@Mathis');
    expect(mentionIndexText({ userId: 'u-42', label: '' }).trim()).toBe('');
    expect(mentionIndexText({ userId: 'u-42' })).not.toContain('u-42');
  });
});
