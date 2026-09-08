/**
 * rewrapPlan — CE QU'ON PEUT RÉPARER, CE QU'ON DOIT SAUTER, ET EN COMBIEN DE LOTS.
 *
 * POURQUOI CE MODÈLE EXISTE. Le re-key est paresseux : après une rotation, les
 * éléments restent scellés sous leur époque d'origine. Quelqu'un ajouté APRÈS ne
 * reçoit que la clé courante et voit « N éléments n'ont pas pu être déchiffrés »
 * — définitivement. Le re-scellement ouvre l'enveloppe avec l'ANCIENNE K_vault
 * et la referme avec la NOUVELLE ; il faut donc les DEUX clés, et c'est
 * exactement ce que ce modèle décide, sans React, sans réseau, sans traduction.
 *
 * LA RÈGLE QUI TRAVERSE LE FICHIER : ON NE DEVINE JAMAIS UNE CLÉ QU'ON N'A PAS.
 * Un élément dont l'époque n'est pas ouvrable ICI est SAUTÉ et COMPTÉ, avec son
 * époque — pas tenté, pas « réparé » en apparence. Le tenter enverrait une
 * enveloppe fabriquée à partir de rien, c'est-à-dire un élément définitivement
 * illisible : le défaut qu'on répare, rendu irréversible.
 *
 * ET « JE NE PEUX PAS OUVRIR LA CLÉ COURANTE » N'EST PAS « IL N'Y A RIEN À
 * FAIRE ». Sans elle on ne peut REFERMER aucune enveloppe : le plan est BLOQUÉ,
 * il le dit, et il ne se présente pas comme un travail achevé.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/rewrapPlan.vitest.ts
 */

import { describe, it, expect } from 'vitest';
import { planRewrap, type RewrapCandidate } from '../rewrapPlan';

const item = (id: string, epoch: number, version = 1): RewrapCandidate => ({
  id,
  version,
  wrappedUnderEpoch: epoch,
});

/** Toutes les époques s'ouvrent — le cas nominal d'un membre d'origine. */
const toutOuvert = () => true;

describe('planRewrap — ce qui est à re-sceller', () => {
  it('ne retient que les éléments sous une époque RÉVOLUE', () => {
    const plan = planRewrap({
      items: [item('a', 1), item('b', 2), item('c', 3)],
      currentKeyEpoch: 3,
      canOpenEpoch: toutOuvert,
    });
    expect(plan.batches.flat().map((i) => i.id)).toEqual(['a', 'b']);
    expect(plan.total).toBe(2);
    expect(plan.skipped).toEqual([]);
    expect(plan.blocked).toBe(false);
    expect(plan.empty).toBe(false);
  });

  it('un coffre déjà à jour rend un plan VIDE — rien à proposer', () => {
    const plan = planRewrap({
      items: [item('a', 4), item('b', 4)],
      currentKeyEpoch: 4,
      canOpenEpoch: toutOuvert,
    });
    expect(plan.empty).toBe(true);
    expect(plan.batches).toEqual([]);
    expect(plan.total).toBe(0);
  });

  it('un coffre JAMAIS OUVERT ici (items absents) ne rend aucun plan — pas un plan vide "rassurant"', () => {
    const plan = planRewrap({ items: undefined, currentKeyEpoch: 2, canOpenEpoch: toutOuvert });
    expect(plan.known).toBe(false);
    expect(plan.empty).toBe(true);
    expect(plan.total).toBe(0);
    expect(plan.skipped).toEqual([]);
  });

  it('une époque qui n’est pas un nombre fini n’est ni à jour ni en retard : on n’y touche pas', () => {
    const plan = planRewrap({
      items: [{ id: 'a', version: 1, wrappedUnderEpoch: Number.NaN }],
      currentKeyEpoch: 3,
      canOpenEpoch: toutOuvert,
    });
    expect(plan.total).toBe(0);
    expect(plan.skipped).toEqual([]);
  });

  it('une époque EN AVANCE compte comme à jour — notre fraîcheur n’accuse pas le serveur', () => {
    // `currentKeyEpoch` vient du résumé en mémoire ; il peut retarder d'une
    // rotation faite ailleurs. Ranger cet élément « à re-sceller » ferait
    // envoyer une enveloppe sous une clé plus ancienne que la sienne.
    const plan = planRewrap({
      items: [item('a', 5)],
      currentKeyEpoch: 4,
      canOpenEpoch: toutOuvert,
    });
    expect(plan.total).toBe(0);
    expect(plan.empty).toBe(true);
  });
});

describe('planRewrap — ce qu’on saute plutôt que de le deviner', () => {
  it('une époque non ouvrable ici : SAUTÉE et comptée, avec son époque', () => {
    const plan = planRewrap({
      items: [item('a', 1), item('b', 2), item('c', 2)],
      currentKeyEpoch: 3,
      // Cet appareil n'a jamais reçu la clé de l'époque 1.
      canOpenEpoch: (e) => e !== 1,
    });
    expect(plan.batches.flat().map((i) => i.id)).toEqual(['b', 'c']);
    expect(plan.total).toBe(2);
    expect(plan.skipped.map((i) => i.id)).toEqual(['a']);
    expect(plan.skippedEpochs).toEqual([1]);
  });

  it('les époques sautées sont uniques et croissantes — c’est une phrase, pas une liste brute', () => {
    const plan = planRewrap({
      items: [item('a', 3), item('b', 1), item('c', 3), item('d', 2)],
      currentKeyEpoch: 4,
      canOpenEpoch: (e) => e === 4 || e === 2,
    });
    expect(plan.skippedEpochs).toEqual([1, 3]);
    expect(plan.batches.flat().map((i) => i.id)).toEqual(['d']);
  });

  it('sans la clé COURANTE, le plan est BLOQUÉ : on ne peut REFERMER aucune enveloppe', () => {
    const plan = planRewrap({
      items: [item('a', 1), item('b', 2)],
      currentKeyEpoch: 3,
      // Les anciennes s'ouvrent, la courante non (coffre verrouillé ici).
      canOpenEpoch: (e) => e < 3,
    });
    expect(plan.blocked).toBe(true);
    expect(plan.batches).toEqual([]);
    expect(plan.total).toBe(0);
    // Rien n'est présenté comme « fait » : les deux restent à réparer.
    expect(plan.skipped.map((i) => i.id)).toEqual(['a', 'b']);
    expect(plan.empty).toBe(false);
  });
});

describe('planRewrap — les lots', () => {
  it('découpe au plafond du serveur et garde l’ordre', () => {
    const items = Array.from({ length: 5 }, (_, i) => item(`i${i}`, 1));
    const plan = planRewrap({
      items,
      currentKeyEpoch: 2,
      canOpenEpoch: toutOuvert,
      batchSize: 2,
    });
    expect(plan.batches.map((b) => b.map((i) => i.id))).toEqual([
      ['i0', 'i1'],
      ['i2', 'i3'],
      ['i4'],
    ]);
    expect(plan.total).toBe(5);
  });

  it('un lot unique quand tout tient dedans', () => {
    const plan = planRewrap({
      items: [item('a', 1), item('b', 1)],
      currentKeyEpoch: 2,
      canOpenEpoch: toutOuvert,
    });
    expect(plan.batches).toHaveLength(1);
  });

  it('la version de chaque élément voyage avec lui — c’est le compare-and-set du serveur', () => {
    const plan = planRewrap({
      items: [item('a', 1, 7)],
      currentKeyEpoch: 2,
      canOpenEpoch: toutOuvert,
    });
    expect(plan.batches[0][0]).toMatchObject({ id: 'a', version: 7, wrappedUnderEpoch: 1 });
  });
});
