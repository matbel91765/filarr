/**
 * Garde-fou : les listes de `blockSize.ts` désignent-elles de VRAIS nœuds ?
 *
 * LE DÉFAUT QU'IL ATTRAPE. `RESIZABLE_BLOCK_TYPES` et
 * `HEIGHT_RESIZABLE_BLOCK_TYPES` sont des tableaux de chaînes. Écrire
 * `'mermaid'` au lieu de `'mermaidBlock'` compile, passe le linter, et se
 * comporte comme si tout allait bien : `addGlobalAttributes` pose simplement
 * l'attribut sur un type qui n'existe pas. La vue, elle, garde sa poignée — on
 * tire, on voit le bloc bouger (le style est écrit en direct sur le DOM), puis
 * `updateAttributes` écrit un attribut HORS SCHÉMA que ProseMirror supprime au
 * premier aller-retour. Le réglage « ne tient pas » sans qu'aucune erreur ne
 * soit levée nulle part.
 *
 * C'est la même famille que les pertes silencieuses déjà connues de l'éditeur,
 * et c'est pour ça que la vérification se fait contre le SCHÉMA CONSTRUIT plutôt
 * que contre une liste recopiée : `getSchema()` est la seule autorité sur ce
 * qu'un document peut porter.
 *
 * CE QUE `schemaExtensions.vitest.ts` NE COUVRE PAS. Il compare les deux
 * schémas L'UN À L'AUTRE : un nom de type fautif y est fautif des deux côtés,
 * donc invisible. Il faut confronter les listes au schéma lui-même.
 *
 * LANCEUR — vitest, pour la même raison que la suite voisine : `getSchema()` ne
 * lit que les specs, il n'instancie aucune vue React.
 *
 *   npx vitest run src/renderer/components/notes/extensions/__tests__/blockSizeSchema.vitest.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Schema } from '@tiptap/pm/model';

/** Bouchons minimaux : le store Redux, atteint par une vue de bloc, lit `localStorage` au chargement. */
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
async function build(): Promise<{
  schema: Schema;
  width: readonly string[];
  height: readonly string[];
}> {
  const { getSchema } = await import('@tiptap/core');
  const { buildNoteSchemaExtensions } = await import('../schemaExtensions');
  const { RESIZABLE_BLOCK_TYPES, HEIGHT_RESIZABLE_BLOCK_TYPES } = await import('../blockSize');
  return {
    schema: getSchema(
      buildNoteSchemaExtensions({
        starterKit: { undoRedo: false },
        tableResizable: true,
        resolveTransclusionByTitle: () => undefined,
      }) as never
    ),
    width: RESIZABLE_BLOCK_TYPES,
    height: HEIGHT_RESIZABLE_BLOCK_TYPES,
  };
}

/** Les nœuds du schéma qui portent réellement cet attribut. */
function carriers(schema: Schema, attr: string): string[] {
  return Object.entries(schema.nodes)
    .filter(([, type]) => Object.prototype.hasOwnProperty.call(type.spec.attrs ?? {}, attr))
    .map(([name]) => name)
    .sort();
}

describe('les listes de blockSize désignent de vrais nœuds', () => {
  it('chaque type déclaré redimensionnable EXISTE dans le schéma', async () => {
    const { schema, width, height } = await build();
    for (const name of [...width, ...height]) {
      expect(Object.keys(schema.nodes)).toContain(name);
    }
  });

  it('`blockWidthPx` atterrit exactement sur les types listés — ni plus, ni moins', async () => {
    const { schema, width } = await build();
    expect(carriers(schema, 'blockWidthPx')).toEqual([...width].sort());
  });

  it('`blockHeightPx` atterrit exactement sur les types listés — ni plus, ni moins', async () => {
    const { schema, height } = await build();
    expect(carriers(schema, 'blockHeightPx')).toEqual([...height].sort());
  });

  it('un bloc réglable en hauteur est toujours réglable en largeur', async () => {
    const { width, height } = await build();
    // L'inverse est permis (`embedUrl` a un rapport d'image), mais une hauteur
    // sans largeur donnerait une poignée dont un seul axe répond — le défaut
    // qu'on vient précisément de corriger.
    for (const name of height) {
      expect(width).toContain(name);
    }
  });

  it("l'image garde sa largeur à elle", async () => {
    const { schema, width } = await build();
    // Deux largeurs sur le même nœud se contrediraient sans que rien à l'écran
    // ne dise laquelle gagne. `fileEmbed` porte `width` (en pixels), pas `blockWidthPx`.
    expect(width).not.toContain('fileEmbed');
    expect(Object.keys(schema.nodes.fileEmbed.spec.attrs ?? {})).toContain('width');
    expect(carriers(schema, 'blockWidthPx')).not.toContain('fileEmbed');
  });

  it("l'ancien système en pourcentage ne laisse aucun attribut derrière lui", async () => {
    const { schema } = await build();
    // `blockWidth` valait un POURCENTAGE ; le relire comme des pixels donnerait
    // un bloc de 50 px. Aucun nœud ne doit plus le porter.
    for (const stale of ['blockWidth', 'blockHeight', 'blockAlign']) {
      expect(carriers(schema, stale)).toEqual([]);
    }
  });
});
