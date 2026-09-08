import { describe, it, expect } from 'vitest';
import {
  EMPTY_PINS,
  encodePinsDoc,
  isPinned,
  mergePins,
  parsePinsDoc,
  pinClock,
  pinnedIds,
  withPin,
  withoutPin,
  type PinsDoc,
} from './pinsModel';

/**
 * MES ÉPINGLES — la fusion, et pourquoi les tombstones ne sont pas du zèle.
 *
 * Deux appareils du même compte écrivent chacun de leur côté ; le serveur
 * refuse le second et lui rend l'état du premier ; le second fusionne. Sans
 * tombstone, cette fusion serait une union et une épingle retirée ICI
 * ressusciterait dès que l'autre appareil écrit. Le mobile applique la même
 * règle (fiche épingles) : par identifiant, horloge la plus haute gagnante.
 */

const doc = (items: Array<[string, number]>, unpinned: Array<[string, number]> = []): PinsDoc => ({
  v: 1,
  items: items.map(([id, at]) => ({ id, at })),
  unpinned: unpinned.map(([id, at]) => ({ id, at })),
});

describe('mergePins — par identifiant, horloge la plus haute gagnante', () => {
  it('une épingle retirée sur un appareil ne ressuscite pas quand l’autre écrit', () => {
    // A épingle x à t=10 ; B, parti du même état, retire x à t=20 ; A écrit
    // une autre chose à t=30 sans toucher x. Fusion : x reste retiré.
    const a = doc([
      ['x', 10],
      ['y', 30],
    ]);
    const b = doc([], [['x', 20]]);
    expect(pinnedIds(mergePins(a, b))).toEqual(['y']);
    expect(pinnedIds(mergePins(b, a))).toEqual(['y']); // commutative
  });

  it('ré-épingler après un retrait l’emporte si c’est plus récent', () => {
    const a = doc([], [['x', 20]]);
    const b = doc([['x', 25]]);
    expect(isPinned(mergePins(a, b), 'x')).toBe(true);
  });

  it('à horloge ÉGALE, le retrait l’emporte — le même départage sur tous les appareils', () => {
    const a = doc([['x', 20]]);
    const b = doc([], [['x', 20]]);
    expect(isPinned(mergePins(a, b), 'x')).toBe(false);
    expect(isPinned(mergePins(b, a), 'x')).toBe(false);
  });

  it('est associative : trois appareils fusionnent dans n’importe quel ordre', () => {
    const a = doc([
      ['x', 10],
      ['y', 12],
    ]);
    const b = doc([['z', 15]], [['y', 14]]);
    const c = doc([['y', 16]], [['x', 11]]);
    const abc = mergePins(mergePins(a, b), c);
    const cba = mergePins(c, mergePins(b, a));
    expect(pinnedIds(abc)).toEqual(pinnedIds(cba));
    expect(pinnedIds(abc)).toEqual(['y', 'z']);
  });

  it('borne les tombstones : la liste ne grossit pas sans fin', () => {
    const beaucoup = doc(
      [],
      Array.from({ length: 500 }, (_, i) => [`t${i}`, i] as [string, number])
    );
    expect(mergePins(beaucoup, EMPTY_PINS).unpinned.length).toBe(200);
    // Ce sont les plus RÉCENTES qui restent.
    expect(mergePins(beaucoup, EMPTY_PINS).unpinned[0]).toEqual({ id: 't499', at: 499 });
  });
});

describe('withPin / withoutPin — les gestes', () => {
  it('épingler puis retirer laisse une tombstone, pas un trou', () => {
    let d = withPin(EMPTY_PINS, 'x', 10);
    expect(pinnedIds(d)).toEqual(['x']);
    d = withoutPin(d, 'x', 11);
    expect(pinnedIds(d)).toEqual([]);
    expect(d.unpinned).toEqual([{ id: 'x', at: 11 }]);
  });

  it('les plus récents en tête', () => {
    const d = withPin(withPin(EMPTY_PINS, 'a', 1), 'b', 2);
    expect(pinnedIds(d)).toEqual(['b', 'a']);
  });
});

describe('parse / encode — tolérant en lecture, canonique en écriture', () => {
  it('un blob illisible, d’une autre version ou mal formé vaut « aucune épingle »', () => {
    expect(parsePinsDoc(null)).toEqual(EMPTY_PINS);
    expect(parsePinsDoc('pas du json')).toEqual(EMPTY_PINS);
    expect(parsePinsDoc('{"v":2,"items":[{"id":"x","at":1}]}')).toEqual(EMPTY_PINS);
    expect(
      parsePinsDoc('{"v":1,"items":[{"id":42},{"id":"ok","at":"1"},{"id":"y","at":3}]}')
    ).toEqual(doc([['y', 3]]));
  });

  it('encode une forme canonique : dédoublonnée et triée', () => {
    const brut: PinsDoc = {
      v: 1,
      items: [
        { id: 'x', at: 1 },
        { id: 'x', at: 5 },
        { id: 'y', at: 3 },
      ],
      unpinned: [],
    };
    expect(JSON.parse(encodePinsDoc(brut))).toEqual(
      doc([
        ['x', 5],
        ['y', 3],
      ])
    );
  });
});

describe('pinClock — une horloge qui ne recule jamais sur cet appareil', () => {
  it('deux gestes dans la même milliseconde ne sont jamais à égalité', () => {
    const a = pinClock(1000);
    const b = pinClock(1000);
    expect(b).toBeGreaterThan(a);
    // Une horloge système remise en arrière ne fait pas reculer les gestes.
    expect(pinClock(500)).toBeGreaterThan(b);
  });
});
