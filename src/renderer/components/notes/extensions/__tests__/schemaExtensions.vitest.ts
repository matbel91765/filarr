/**
 * Garde-fou contre une PERTE DE DONNÉES silencieuse.
 *
 * Le produit monte trois surfaces TipTap : l'éditeur de notes (NoteEditor), le
 * rendu d'une version archivée (VersionRender) et l'éditeur de coffre partagé
 * (VaultNoteEditor) — ce dernier est ÉDITABLE et collaboratif malgré le nom
 * « readOnly » du module dont il tire ses extensions. Tant que les listes
 * étaient recopiées à la main, la divergence était invisible et coûteuse :
 * BlockId, FontSize et BlockSpacing manquaient côté coffre, donc éditer une
 * note partagée effaçait les ancres de bloc (cibles des transclusions), la
 * taille de police et l'espacement — ProseMirror ne conserve PAS un attribut
 * hors schéma, il le supprime au premier aller-retour.
 *
 * Ce que cette suite vérifie n'est donc pas « les listes sont identiques »
 * (elles ne doivent pas l'être : le menu slash n'a rien à faire dans un
 * aperçu), mais que les deux SCHÉMAS dérivés sont rigoureusement les mêmes —
 * mêmes nœuds, mêmes marques, mêmes attributs, mêmes valeurs par défaut.
 *
 * LANCEUR — vitest, à contre-emploi apparent de la règle « vitest = logique
 * pure » : le graphe d'import tire des vues React (ReactNodeViewRenderer), mais
 * `getSchema()` ne les instancie jamais, il ne lit que les specs. Jest CRA est
 * hors course ici pour une raison matérielle : `@tiptap/pm` est publié en ESM
 * et `node_modules` n'est pas transformé (« Unexpected token 'export' ») ; le
 * corriger demanderait un `transformIgnorePatterns` dans la configuration du
 * build. Les quelques globales de navigateur touchées AU CHARGEMENT des
 * modules sont bouchonnées ci-dessous.
 *
 *   npx vitest run src/renderer/components/notes/extensions/__tests__/schemaExtensions.vitest.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Schema } from '@tiptap/pm/model';

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
async function schemas() {
  const { getSchema } = await import('@tiptap/core');
  const { buildNoteSchemaExtensions } = await import('../schemaExtensions');
  const { buildSharedNoteExtensions } = await import('../../sharedNoteExtensions');
  return { getSchema, buildNoteSchemaExtensions, buildSharedNoteExtensions };
}

/**
 * Empreinte du schéma : pour chaque nœud et chaque marque, le nom des attributs
 * ET leur valeur par défaut. C'est exactement le niveau de détail qui décide de
 * ce qui survit à un aller-retour de document — un attribut absent est un
 * attribut effacé, une valeur par défaut différente est une valeur réécrite.
 */
function fingerprint(schema: Schema) {
  const attrsOf = (spec: { attrs?: Record<string, { default?: unknown }> }) =>
    Object.entries(spec.attrs ?? {})
      .map(([name, attr]) => `${name}=${JSON.stringify(attr.default ?? null)}`)
      .sort();

  return {
    nodes: Object.fromEntries(
      Object.entries(schema.nodes).map(([name, type]) => [name, attrsOf(type.spec)])
    ),
    marks: Object.fromEntries(
      Object.entries(schema.marks).map(([name, type]) => [name, attrsOf(type.spec)])
    ),
  };
}

describe('schéma partagé des notes', () => {
  it('donne le même schéma à l’éditeur de notes et aux surfaces de coffre/version', async () => {
    const { getSchema, buildNoteSchemaExtensions, buildSharedNoteExtensions } = await schemas();

    // Les options passées ici sont celles, DIVERGENTES, des deux appelants
    // réels : redimensionnement de tableau et résolveur de transclusion côté
    // éditeur, historique ProseMirror coupé côté session collaborative. Aucune
    // ne doit déplacer le schéma d'un iota.
    const editorSchema = getSchema(
      buildNoteSchemaExtensions({
        starterKit: { undoRedo: false },
        tableResizable: true,
        resolveTransclusionByTitle: () => undefined,
      }) as never
    );
    const sharedSchema = getSchema(buildSharedNoteExtensions() as never);
    const collabSchema = getSchema(
      buildSharedNoteExtensions({ starterKit: { undoRedo: false } }) as never
    );

    expect(fingerprint(sharedSchema)).toEqual(fingerprint(editorSchema));
    expect(fingerprint(collabSchema)).toEqual(fingerprint(editorSchema));
    // Le nœud `mention` (lot 1 des @mentions) est dans le schéma partagé, avec ses deux attributs.
    expect(fingerprint(editorSchema).nodes.mention).toEqual(['label=""', 'userId=""']);
  });

  it('porte les trois attributs globaux dont l’absence effaçait du contenu', async () => {
    const { getSchema, buildSharedNoteExtensions } = await schemas();
    const schema = getSchema(buildSharedNoteExtensions() as never);

    // Ancre de bloc : la cible des transclusions ![[Note^abc123]].
    for (const node of ['paragraph', 'heading']) {
      expect(Object.keys(schema.nodes[node].spec.attrs ?? {})).toContain('blockId');
    }
    // Espacement par bloc.
    for (const node of ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote']) {
      expect(Object.keys(schema.nodes[node].spec.attrs ?? {})).toContain('lineSpacing');
    }
    // Taille et famille de police, portées par la marque textStyle.
    const textStyle = Object.keys(schema.marks.textStyle.spec.attrs ?? {});
    expect(textStyle).toContain('fontSize');
    expect(textStyle).toContain('fontFamily');
  });

  it('enregistre l’inventaire complet des nœuds et des marques', async () => {
    const { getSchema, buildSharedNoteExtensions } = await schemas();
    const schema = getSchema(buildSharedNoteExtensions() as never);

    // Inventaire figé volontairement : un nœud retiré du module partagé rend
    // ILLISIBLE tout document déjà écrit avec lui (le contenu est jeté au
    // parse). Ajouter une entrée ici doit être un geste conscient.
    expect(Object.keys(schema.nodes).sort()).toEqual(
      [
        'blockquote',
        'bookmark',
        'bulletList',
        'callout',
        'calendarBlock',
        'codeBlock',
        'column',
        'columns',
        'dataviewBlock',
        'doc',
        'embedUrl',
        'fileEmbed',
        'footnote',
        'hardBreak',
        'heading',
        'horizontalRule',
        'inlineDatabase',
        'inlineDate',
        'listItem',
        'mathBlock',
        'mathInline',
        'mermaidBlock',
        'mention',
        'orderedList',
        'paragraph',
        'subPage',
        'table',
        'tableCell',
        'tableHeader',
        'tableOfContents',
        'tableRow',
        'taskItem',
        'taskList',
        'text',
        'toggleBlock',
        'toggleSummary',
        'transclusion',
      ].sort()
    );

    // `underline` vient du StarterKit 3 (l'enregistrer en plus émettrait
    // « Duplicate extension names ») : l'assertion garantit qu'il est bien là
    // sans extension dédiée.
    expect(Object.keys(schema.marks).sort()).toEqual(
      [
        'bold',
        'code',
        'comment',
        'highlight',
        'italic',
        'link',
        'strike',
        'textStyle',
        'underline',
      ].sort()
    );
  });

  it('ne laisse pas les extensions d’interaction toucher au schéma', async () => {
    const { getSchema, buildNoteSchemaExtensions } = await schemas();
    const { Extension } = await import('@tiptap/core');

    // Une extension d'interaction typique : un nom, aucun apport de schéma.
    const Interaction = Extension.create({ name: 'testInteraction' });
    const withSlots = getSchema(
      buildNoteSchemaExtensions({
        slots: {
          afterStarterKit: [Interaction],
          afterCodeBlock: [Interaction],
          afterBlockId: [Interaction],
          afterComment: [Interaction],
          afterFootnote: [Interaction],
          trailing: [Interaction],
        },
      }) as never
    );

    expect(fingerprint(withSlots)).toEqual(
      fingerprint(getSchema(buildNoteSchemaExtensions() as never))
    );
  });
});

describe('source unique du schéma', () => {
  /**
   * Le vrai risque de rechute n'est pas qu'on modifie le module partagé, c'est
   * qu'on rebranche une extension de schéma DIRECTEMENT dans une surface, en
   * n'en faisant profiter qu'elle. Ce test lit le code : aucune des trois
   * surfaces TipTap ne doit importer un module d'extension de schéma.
   */
  it('interdit à toute surface TipTap d’importer une extension de schéma en direct', () => {
    const root = resolve(__dirname, '../../../../..'); // → src/
    const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

    // Modules de schéma = ceux qu'importe schemaExtensions.ts lui-même : la
    // liste se met à jour toute seule quand le module partagé grandit.
    const shared = read('renderer/components/notes/extensions/schemaExtensions.ts');
    const schemaModules = [...shared.matchAll(/from '\.\/([A-Za-z0-9_-]+)'/g)].map((m) => m[1]);
    expect(schemaModules.length).toBeGreaterThan(15);

    const surfaces = [
      'renderer/components/notes/NoteEditor.tsx',
      'renderer/components/vaults/VaultNoteEditor.tsx',
      'renderer/components/notes/versioning/VersionRender.tsx',
      'renderer/components/notes/sharedNoteExtensions.ts',
    ];

    for (const surface of surfaces) {
      const source = read(surface);
      const imported = [...source.matchAll(/from '[^']*extensions\/([A-Za-z0-9_-]+)'/g)].map(
        (m) => m[1]
      );
      const offenders = imported.filter((mod) => schemaModules.includes(mod));
      expect({ surface, offenders }).toEqual({ surface, offenders: [] });
    }
  });
});
