/**
 * batchPlan.vitest.ts — Regroupement des petits objets.
 *
 * Ce qui est defendu :
 *  1. UN GROS OBJET NE REJOINT JAMAIS UN LOT. Il perdrait la reprise et le
 *     parallelisme pour un gain nul.
 *  2. UN LOT D UN SEUL ELEMENT N EN EST PAS UN. Le compter comme groupe
 *     fausserait la mesure du lot 93.
 *  3. L ORDRE D ENTREE EST PRESERVE. Un appelant qui a trie sa file ne doit
 *     pas voir son travail defait par le planificateur.
 *  4. UN LOT EST BORNE, en nombre ET en octets — sinon un echec coute une
 *     minute de rejeu.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_BYTES_PER_BATCH,
  DEFAULT_MAX_ITEMS_PER_BATCH,
  DEFAULT_MAX_ITEM_SIZE,
  planBatches,
  requestCount,
  requestsSaved,
  summarize,
  type BatchItem,
} from '../batchPlan';

const items = (n: number, size: number, prefix = 'o'): BatchItem[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, size }));

describe('regroupement des petits objets', () => {
  it('groupe mille petits objets en dix requetes', () => {
    // Le chiffre du lot : mille operations de classe A deviennent dix.
    const plan = planBatches(items(1000, 2048));
    expect(requestCount(plan)).toBe(10);
    expect(requestsSaved(plan)).toBe(990);
    expect(plan.every((g) => g.batched)).toBe(true);
  });

  it('respecte le plafond en NOMBRE d elements', () => {
    const plan = planBatches(items(250, 100));
    expect(plan).toHaveLength(3);
    expect(plan[0].items).toHaveLength(DEFAULT_MAX_ITEMS_PER_BATCH);
    expect(plan[2].items).toHaveLength(50);
  });

  it('respecte le plafond en OCTETS', () => {
    // Sans cette borne, cent objets de 250 Kio feraient un lot de 25 Mo a
    // refaire en entier au premier echec.
    const taille = 250 * 1024;
    const parLot = Math.floor(DEFAULT_MAX_BYTES_PER_BATCH / taille);
    const plan = planBatches(items(parLot * 2, taille));
    expect(plan.length).toBeGreaterThanOrEqual(2);
    for (const g of plan) expect(g.totalSize).toBeLessThanOrEqual(DEFAULT_MAX_BYTES_PER_BATCH);
  });
});

describe('les gros objets partent seuls', () => {
  it('un objet au-dessus du seuil n est jamais groupe', () => {
    const plan = planBatches([{ key: 'gros', size: DEFAULT_MAX_ITEM_SIZE + 1 }]);
    expect(plan).toHaveLength(1);
    expect(plan[0].batched).toBe(false);
    expect(requestsSaved(plan)).toBe(0);
  });

  it('un objet EXACTEMENT au seuil peut encore etre groupe', () => {
    const plan = planBatches([
      { key: 'a', size: DEFAULT_MAX_ITEM_SIZE },
      { key: 'b', size: 10 },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].batched).toBe(true);
  });

  it('un gros objet ne COUPE pas le lot en cours', () => {
    // Les petits qui suivent peuvent encore rejoindre ceux qui precedent :
    // couper la ferait deux requetes la ou une suffit.
    const plan = planBatches([
      { key: 'p1', size: 100 },
      { key: 'GROS', size: 10 * 1024 * 1024 },
      { key: 'p2', size: 100 },
    ]);
    const groupes = plan.filter((g) => g.batched);
    const seuls = plan.filter((g) => !g.batched);
    expect(seuls).toHaveLength(1);
    expect(seuls[0].items[0].key).toBe('GROS');
    expect(groupes).toHaveLength(1);
    expect(groupes[0].items.map((i) => i.key)).toEqual(['p1', 'p2']);
  });
});

describe('un lot d un seul element n en est pas un', () => {
  it('n est pas marque comme groupe', () => {
    // Le compter comme groupe ferait enregistrer une requete economisee qui ne
    // l est pas, et fausserait la mesure du lot 93.
    const plan = planBatches([{ key: 'seul', size: 100 }]);
    expect(plan).toHaveLength(1);
    expect(plan[0].batched).toBe(false);
    expect(requestsSaved(plan)).toBe(0);
  });

  it('deux elements, en revanche, economisent bien une requete', () => {
    const plan = planBatches(items(2, 100));
    expect(plan[0].batched).toBe(true);
    expect(requestsSaved(plan)).toBe(1);
  });
});

describe('ordre', () => {
  it('preserve l ordre d entree dans chaque lot', () => {
    // Un appelant qui a trie sa file — le plus court d abord, l interactif en
    // tete — ne doit pas voir son travail defait.
    const entree = items(5, 100);
    const plan = planBatches(entree);
    expect(plan[0].items.map((i) => i.key)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);
  });

  it('preserve l ordre entre les lots', () => {
    const plan = planBatches(items(250, 100), { maxItemsPerBatch: 100 });
    expect(plan[0].items[0].key).toBe('o0');
    expect(plan[1].items[0].key).toBe('o100');
    expect(plan[2].items[0].key).toBe('o200');
  });
});

describe('robustesse', () => {
  it('une entree vide rend un plan vide', () => {
    expect(planBatches([])).toEqual([]);
    expect(requestsSaved([])).toBe(0);
    expect(requestCount([])).toBe(0);
  });

  it('traite une taille absurde comme nulle plutot que de casser', () => {
    const plan = planBatches([
      { key: 'a', size: Number.NaN },
      { key: 'b', size: -5 },
      { key: 'c', size: 100 },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].items).toHaveLength(3);
    expect(plan[0].totalSize).toBe(100);
  });

  it('ne se bloque pas sur des plafonds degeneres', () => {
    // Un plafond a zero doit degrader vers « un element par lot », jamais
    // boucler ni perdre des elements.
    const plan = planBatches(items(5, 10), { maxItemsPerBatch: 0, maxBytesPerBatch: 0 });
    expect(plan.reduce((n, g) => n + g.items.length, 0)).toBe(5);
  });

  it('n oublie AUCUN element, quelle que soit la configuration', () => {
    const entree = [
      ...items(30, 1000, 'p'),
      { key: 'gros1', size: 5_000_000 },
      ...items(30, 1000, 'q'),
      { key: 'gros2', size: 9_000_000 },
      ...items(7, 300_000, 'm'),
    ];
    const plan = planBatches(entree);
    const vus = plan.flatMap((g) => g.items.map((i) => i.key));
    expect(vus.sort()).toEqual(entree.map((i) => i.key).sort());
  });
});

describe('resume chiffre', () => {
  it('dit ce que l instrumentation doit enregistrer', () => {
    const plan = planBatches([...items(1000, 2048), { key: 'gros', size: 8_000_000 }]);
    const s = summarize(plan);
    expect(s.before).toBe(1001);
    expect(s.after).toBe(11);
    expect(s.saved).toBe(990);
    expect(s.batchedItems).toBe(1000);
    // Le gros objet n est compte ni comme groupe, ni comme economie.
    expect(s.before - s.saved).toBe(s.after);
  });
});
