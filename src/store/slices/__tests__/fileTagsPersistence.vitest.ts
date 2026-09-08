/**
 * L'ÉTIQUETAGE NE MEURT PLUS AU RECHARGEMENT.
 *
 * ── LE DÉFAUT ───────────────────────────────────────────────────────────────
 *
 * `tagsSlice.fileTagMappings` était une table de session : `loadTags` relisait
 * l'état courant, `metadata.json` ne portait aucun champ, et fermer
 * l'application effaçait tout l'étiquetage sans un mot. La fonction avait l'air
 * de marcher — c'est ce qui la rendait coûteuse.
 *
 * ── CE QUE CES VECTEURS GARDENT ─────────────────────────────────────────────
 *
 *   · la tranche est ALIMENTÉE par les dossiers, et REMPLACÉE, jamais fusionnée
 *     (une étiquette retirée ailleurs doit disparaître ici) ;
 *   · le vocabulaire est COMPLÉTÉ, jamais amputé (une étiquette créée dans
 *     cette session et pas encore posée ne doit pas disparaître sous les
 *     doigts) ;
 *   · l'identifiant d'une étiquette est SON NOM NORMALISÉ, ce qui fait que
 *     « pitch » créé ici et « pitch » créé sur un téléphone sont la même
 *     étiquette.
 *
 * Le réducteur est éprouvé NU (`reducer(state, action)`), sans monter de
 * magasin : c'est la logique qu'on garde, pas le câblage de Redux.
 *
 *   npx vitest run src/store/slices/__tests__/fileTagsPersistence.vitest.ts
 */

import { describe, it, expect } from 'vitest';

import reducer, { hydrateFileTagsFromFolders, type TagsState } from '../tagsSlice';
import type { Folder, HierarchicalTag } from '../../../types';

function folder(over: Partial<Folder> & { id: string }): Folder {
  return { name: over.id, color: '#000', items: [], ...over } as Folder;
}

function tag(id: string): HierarchicalTag {
  return {
    id,
    name: id,
    parentId: null,
    color: '#87CEEB',
    aliases: [],
    usageCount: 0,
    children: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as HierarchicalTag;
}

/** L'état initial de la tranche, plus ce que le vecteur veut y poser. */
function etat(over: Partial<TagsState> = {}): TagsState {
  const initial = reducer(undefined, { type: '@@INIT' }) as TagsState;
  return { ...initial, ...over };
}

describe('hydrateFileTagsFromFolders — les dossiers sont la source', () => {
  it('remplit la table depuis `Folder.fileTags`', () => {
    const next = reducer(
      etat(),
      hydrateFileTagsFromFolders([
        folder({ id: 'd1', fileTags: { f1: ['pitch'] } }),
        folder({ id: 'd2', fileTags: { f2: ['archive', 'pitch'] } }),
      ])
    );
    expect(next.fileTagMappings).toEqual({ f1: ['pitch'], f2: ['archive', 'pitch'] });
  });

  it('REMPLACE la table au lieu de fusionner — une étiquette retirée ailleurs disparaît', () => {
    // Le point du défaut : une fusion laisserait vivre indéfiniment une
    // étiquette qu'un autre appareil vient d'enlever.
    const avant = etat({ fileTagMappings: { f1: ['pitch'], fantome: ['mort'] } });
    const next = reducer(
      avant,
      hydrateFileTagsFromFolders([folder({ id: 'd1', fileTags: { f1: ['pitch'] } })])
    );
    expect(next.fileTagMappings).toEqual({ f1: ['pitch'] });
    expect('fantome' in next.fileTagMappings).toBe(false);
  });

  it('NORMALISE à l’hydratation', () => {
    const next = reducer(
      etat(),
      hydrateFileTagsFromFolders([folder({ id: 'd1', fileTags: { f1: ['Pitch', 'PITCH'] } })])
    );
    expect(next.fileTagMappings.f1).toEqual(['pitch']);
  });

  it('ignore les dossiers à la CORBEILLE', () => {
    const next = reducer(
      etat(),
      hydrateFileTagsFromFolders([
        folder({ id: 'd1', fileTags: { f1: ['vivant'] } }),
        folder({ id: 'd2', fileTags: { f2: ['mort'] }, deletedAt: '2026-01-01' }),
      ])
    );
    expect(next.fileTagMappings).toEqual({ f1: ['vivant'] });
  });

  it('des dossiers SANS étiquette vident la table plutôt que de la figer', () => {
    const avant = etat({ fileTagMappings: { f1: ['pitch'] } });
    expect(
      reducer(avant, hydrateFileTagsFromFolders([folder({ id: 'd1' })])).fileTagMappings
    ).toEqual({});
  });
});

describe('le VOCABULAIRE est complété, jamais amputé', () => {
  it('inscrit les étiquettes trouvées dans les dossiers', () => {
    const next = reducer(
      etat(),
      hydrateFileTagsFromFolders([folder({ id: 'd1', fileTags: { f1: ['pitch', 'archive'] } })])
    );
    expect(next.tags.map((t) => t.id).sort()).toEqual(['archive', 'pitch']);
    // L'identifiant EST le nom normalisé : c'est ce qui fait converger deux
    // appareils qui écrivent le même mot.
    expect(next.tags.every((t) => t.id === t.name)).toBe(true);
  });

  it('ne recrée pas une étiquette déjà connue', () => {
    const avant = etat({ tags: [tag('pitch')] });
    const next = reducer(
      avant,
      hydrateFileTagsFromFolders([folder({ id: 'd1', fileTags: { f1: ['pitch'] } })])
    );
    expect(next.tags).toHaveLength(1);
  });

  it('GARDE une étiquette de la session que plus aucun dossier ne porte', () => {
    // L'amputer la ferait disparaître du sélecteur entre le moment où on la
    // crée et celui où on la pose.
    const avant = etat({ tags: [tag('toute-neuve')] });
    const next = reducer(avant, hydrateFileTagsFromFolders([folder({ id: 'd1' })]));
    expect(next.tags.map((t) => t.id)).toContain('toute-neuve');
  });
});
