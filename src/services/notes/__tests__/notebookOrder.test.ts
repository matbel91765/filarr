/**
 * LE RANGEMENT FAIT AU TÉLÉPHONE TIENT SUR L'ORDINATEUR.
 *
 * Ce que ces vecteurs gardent, dans cet ordre d'importance :
 *   1. une bibliothèque SANS rang rend EXACTEMENT la liste d'avant (le tri par
 *      nom), sinon la correction déplacerait les carnets de tout le monde ;
 *   2. un rang posé au téléphone est honoré ici ;
 *   3. le comparateur est celui du mobile, cas limites compris.
 */

import { describe, it, expect } from 'vitest';

import { compareNotebookSiblings, notebookRank } from '../notebookOrder';

const nb = (id: string, name: string, order?: number) => ({
  id,
  name,
  ...(order === undefined ? {} : { order }),
});

const noms = (list: { name?: string }[]) => list.map((x) => x.name);

describe('rang effectif', () => {
  it('un rang absent est +Infinity — donc à la fin', () => {
    expect(notebookRank(nb('a', 'A'))).toBe(Number.POSITIVE_INFINITY);
    expect(notebookRank(nb('a', 'A', 0))).toBe(0);
    expect(notebookRank(nb('a', 'A', -3))).toBe(-3);
  });

  it('un rang qui n’est pas un nombre FINI ne range rien', () => {
    // Un NaN rendrait toutes les comparaisons fausses, et l'ordre de la
    // fratrie deviendrait celui de `Object.values` — c'est-à-dire aucun.
    expect(notebookRank({ id: 'a', name: 'A', order: NaN })).toBe(Number.POSITIVE_INFINITY);
    expect(notebookRank({ id: 'a', name: 'A', order: Infinity })).toBe(Number.POSITIVE_INFINITY);
    expect(notebookRank({ id: 'a', name: 'A', order: '2' as unknown as number })).toBe(
      Number.POSITIVE_INFINITY
    );
  });
});

describe('la fratrie SANS rang — rien ne bouge', () => {
  it('reste triée par nom, comme avant la correction', () => {
    const list = [nb('3', 'Zèbre'), nb('1', 'Archive'), nb('2', 'Maison')];
    expect(noms([...list].sort(compareNotebookSiblings))).toEqual(['Archive', 'Maison', 'Zèbre']);
  });

  it('deux homonymes gardent un ordre STABLE (départage par identifiant)', () => {
    const a = nb('nb_2', 'Perso');
    const b = nb('nb_1', 'Perso');
    expect([a, b].sort(compareNotebookSiblings)[0].id).toBe('nb_1');
    expect([b, a].sort(compareNotebookSiblings)[0].id).toBe('nb_1');
  });

  it('un nom manquant ne fait pas tomber le tri', () => {
    const list = [{ id: 'b', name: 'A' }, { id: 'a' }];
    expect(() => [...list].sort(compareNotebookSiblings)).not.toThrow();
    expect([...list].sort(compareNotebookSiblings)[0].id).toBe('a');
  });
});

describe('la fratrie AVEC rang — le rangement du téléphone est honoré', () => {
  it('le rang l’emporte sur le nom', () => {
    const list = [nb('1', 'Archive', 2), nb('2', 'Maison', 0), nb('3', 'Zèbre', 1)];
    expect(noms([...list].sort(compareNotebookSiblings))).toEqual(['Maison', 'Zèbre', 'Archive']);
  });

  it('les carnets SANS rang passent APRÈS ceux qui en ont un', () => {
    // Un carnet arrivé du nuage après le rangement ne saute pas en tête.
    const list = [nb('1', 'Aaa'), nb('2', 'Zzz', 0), nb('3', 'Bbb')];
    expect(noms([...list].sort(compareNotebookSiblings))).toEqual(['Zzz', 'Aaa', 'Bbb']);
  });

  it('à rang ÉGAL, le nom départage', () => {
    const list = [nb('1', 'Zèbre', 5), nb('2', 'Archive', 5)];
    expect(noms([...list].sort(compareNotebookSiblings))).toEqual(['Archive', 'Zèbre']);
  });

  it('un rang 0 est un rang, pas une absence', () => {
    const list = [nb('1', 'Aaa'), nb('2', 'Zzz', 0)];
    expect(noms([...list].sort(compareNotebookSiblings))).toEqual(['Zzz', 'Aaa']);
  });

  it('un rang NÉGATIF passe devant', () => {
    const list = [nb('1', 'Aaa', 0), nb('2', 'Zzz', -1)];
    expect(noms([...list].sort(compareNotebookSiblings))).toEqual(['Zzz', 'Aaa']);
  });
});

describe('parité avec le comparateur du mobile', () => {
  /**
   * Le vecteur est recopié de `compareSiblings`
   * (`filarr-mobile/src/services/notes/notebooks/model.ts`) : mêmes entrées,
   * même sortie attendue. Les deux applications doivent rendre LA MÊME liste.
   */
  it('rang, puis nom, puis identifiant — dans cet ordre', () => {
    const list = [
      nb('nb_e', 'Beta'),
      nb('nb_d', 'Alpha'),
      nb('nb_c', 'Gamma', 1),
      nb('nb_b', 'Gamma', 0),
      nb('nb_a', 'Gamma', 1),
    ];
    expect([...list].sort(compareNotebookSiblings).map((x) => x.id)).toEqual([
      'nb_b',
      'nb_a',
      'nb_c',
      'nb_d',
      'nb_e',
    ]);
  });
});
