/**
 * cdc.vitest.ts — Découpage défini par le contenu.
 *
 * Ce que ces suites protègent, par ordre d'importance :
 *
 *  1. LA TABLE GEAR EST LA BONNE. Elle est livrée en constantes (le navigateur
 *     et React Native n'ont pas `node:crypto`), donc rien n'empêcherait une
 *     recopie de travers de passer inaperçue. On la redérive ici.
 *  2. LES FRONTIÈRES NE DÉPENDENT PAS DE LA TAILLE DES LECTURES. C'est la
 *     propriété qui rend la déduplication possible entre appareils, et sa
 *     violation serait SILENCIEUSE : rien ne casse, le stockage double.
 *  3. UNE INSERTION EN TÊTE NE DÉCALE PAS TOUT. C'est la raison d'être du lot,
 *     et ce que la frontière fixe de 8 Mio ne savait pas faire.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  GEAR,
  GEAR_NAME,
  CDC_V1,
  highMask,
  masksOf,
  nextCut,
  cdcBoundaries,
  CdcSplitter,
  type CdcParams,
} from '../cdc';

/** Octets reproductibles — un générateur congruentiel, pas `Math.random()`. */
function pseudoRandom(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

/** Paramètres réduits : mêmes propriétés, suites mille fois plus rapides. */
const SMALL: CdcParams = { min: 64, avg: 256, max: 1024, maskBits: 8, normalization: 2 };

describe('table Gear', () => {
  it('vaut exactement SHA-256("filarr-gear-v1|" + i), 4 premiers octets gros-boutiste', () => {
    expect(GEAR).toHaveLength(256);
    for (let i = 0; i < 256; i++) {
      const attendu = createHash('sha256').update(`${GEAR_NAME}|${i}`, 'utf8').digest().readUInt32BE(0);
      expect(GEAR[i], `GEAR[${i}] diverge de la dérivation`).toBe(attendu);
    }
  });

  it('ne contient aucun doublon — sinon deux octets seraient indistinguables', () => {
    expect(new Set(Array.from(GEAR)).size).toBe(256);
  });
});

describe('masques', () => {
  it('highMask rend bien des bits contigus de poids fort', () => {
    expect(highMask(1)).toBe(0x80000000);
    expect(highMask(18)).toBe(0xffffc000);
    expect(highMask(22)).toBe(0xfffffc00);
    expect(highMask(31)).toBe(0xfffffffe);
  });

  it('compte le bon nombre de bits à 1', () => {
    for (const bits of [1, 8, 18, 20, 22, 31]) {
      const m = highMask(bits);
      let ones = 0;
      for (let b = 0; b < 32; b++) if (m & (1 << b)) ones++;
      expect(ones).toBe(bits);
    }
  });

  it('refuse un nombre de bits hors bornes plutôt que de dégrader en silence', () => {
    // 32 bits rendrait 0xFFFFFFFF : plus aucune frontière, tous les blocs
    // coupés à `max`. Une panne muette qu'on préfère transformer en erreur.
    expect(() => highMask(0)).toThrow();
    expect(() => highMask(32)).toThrow();
    expect(() => highMask(1.5)).toThrow();
  });

  it('le masque strict est plus exigeant que le permissif', () => {
    const { strict, lenient } = masksOf(CDC_V1);
    // Plus de bits à 1 = frontière plus rare = blocs plus gros avant la cible.
    const ones = (m: number) => { let n = 0; for (let b = 0; b < 32; b++) if (m & (1 << b)) n++; return n; };
    expect(ones(strict)).toBe(CDC_V1.maskBits + CDC_V1.normalization);
    expect(ones(lenient)).toBe(CDC_V1.maskBits - CDC_V1.normalization);
    expect(ones(strict)).toBeGreaterThan(ones(lenient));
  });
});

describe('nextCut — bornes', () => {
  it('ne rend jamais moins que `min`, sauf en fin de flux', () => {
    const buf = pseudoRandom(20_000, 7);
    let pos = 0;
    const tailles: number[] = [];
    while (pos < buf.length) {
      const n = nextCut(buf, pos, SMALL);
      tailles.push(n);
      pos += n;
    }
    // Tous sauf le dernier respectent le plancher.
    for (const t of tailles.slice(0, -1)) expect(t).toBeGreaterThanOrEqual(SMALL.min);
    expect(tailles.at(-1)).toBeGreaterThan(0);
  });

  it('ne rend jamais plus que `max`', () => {
    // Un tampon constant ne produit presque aucune frontière : c'est le pire
    // cas, celui qui exerce la coupure forcée.
    const buf = new Uint8Array(10_000); // que des zéros
    let pos = 0;
    while (pos < buf.length) {
      const n = nextCut(buf, pos, SMALL);
      expect(n).toBeLessThanOrEqual(SMALL.max);
      expect(n).toBeGreaterThan(0);
      pos += n;
    }
  });

  it('rend 0 sur un tampon épuisé', () => {
    const buf = pseudoRandom(100, 3);
    expect(nextCut(buf, 100, SMALL)).toBe(0);
    expect(nextCut(buf, 200, SMALL)).toBe(0);
  });

  it('rend tout le reste quand il tient sous `min`', () => {
    const buf = pseudoRandom(SMALL.min - 1, 5);
    expect(nextCut(buf, 0, SMALL)).toBe(buf.length);
  });
});

describe('cdcBoundaries', () => {
  it('couvre tout le tampon, sans trou ni recouvrement', () => {
    const buf = pseudoRandom(50_000, 11);
    const bornes = cdcBoundaries(buf, SMALL);
    expect(bornes.at(-1)).toBe(buf.length);
    for (let i = 1; i < bornes.length; i++) expect(bornes[i]).toBeGreaterThan(bornes[i - 1]);
  });

  it('est déterministe', () => {
    const buf = pseudoRandom(30_000, 13);
    expect(cdcBoundaries(buf, SMALL)).toEqual(cdcBoundaries(buf, SMALL));
  });

  it('produit une taille moyenne dans le bon ordre de grandeur', () => {
    const buf = pseudoRandom(400_000, 17);
    const bornes = cdcBoundaries(buf, SMALL);
    const moyenne = buf.length / bornes.length;
    // La normalisation resserre la distribution autour de la cible ; on
    // vérifie l'ordre de grandeur, pas une valeur exacte.
    expect(moyenne).toBeGreaterThan(SMALL.min);
    expect(moyenne).toBeLessThan(SMALL.max);
  });
});

describe('LA propriété du lot — une insertion en tête ne décale pas tout', () => {
  it('la très grande majorité des blocs survit à un octet inséré au début', () => {
    const original = pseudoRandom(200_000, 19);
    const modifie = new Uint8Array(original.length + 1);
    modifie[0] = 0x42;
    modifie.set(original, 1);

    const decoupe = (b: Uint8Array) => {
      const out: string[] = [];
      let pos = 0;
      for (const fin of cdcBoundaries(b, SMALL)) {
        out.push(createHash('sha256').update(b.subarray(pos, fin)).digest('hex'));
        pos = fin;
      }
      return out;
    };

    const a = decoupe(original);
    const b = decoupe(modifie);
    const communs = new Set(a).size === 0 ? 0 : a.filter((h) => b.includes(h)).length;
    const partage = communs / a.length;

    // Avec une frontière FIXE, ce partage vaudrait 0 : tout est décalé d'un
    // octet, donc aucun bloc n'est identique. C'est exactement le défaut que ce
    // module supprime. On exige que la resynchronisation soit franche.
    expect(partage).toBeGreaterThan(0.9);
  });

  it('une modification au milieu ne touche qu\'un voisinage borné', () => {
    const original = pseudoRandom(200_000, 23);
    const modifie = Uint8Array.from(original);
    modifie[100_000] ^= 0xff;

    const hachages = (b: Uint8Array) => {
      const out: string[] = [];
      let pos = 0;
      for (const fin of cdcBoundaries(b, SMALL)) {
        out.push(createHash('sha256').update(b.subarray(pos, fin)).digest('hex'));
        pos = fin;
      }
      return out;
    };
    const a = hachages(original);
    const b = new Set(hachages(modifie));
    const perdus = a.filter((h) => !b.has(h)).length;
    // Un seul octet changé ne doit invalider qu'une poignée de blocs.
    expect(perdus).toBeLessThanOrEqual(3);
  });
});

describe('CdcSplitter — indépendance vis-à-vis de la taille des lectures', () => {
  /**
   * LE test qui compte. Deux appareils lisent le même fichier avec des tailles
   * de lecture différentes (disque local contre flux réseau, par exemple). S'ils
   * n'obtiennent pas les mêmes blocs, la déduplication cesse de fonctionner —
   * sans qu'aucune erreur ne soit levée nulle part.
   */
  function viaSplitter(data: Uint8Array, tailleLecture: number): string[] {
    const s = new CdcSplitter(SMALL);
    const blocs: Uint8Array[] = [];
    for (let i = 0; i < data.length; i += tailleLecture) {
      blocs.push(...s.push(data.subarray(i, Math.min(i + tailleLecture, data.length))));
    }
    blocs.push(...s.flush());
    return blocs.map((b) => createHash('sha256').update(b).digest('hex'));
  }

  it('donne les mêmes blocs quelle que soit la taille des `push`', () => {
    const data = pseudoRandom(120_000, 29);
    const reference = viaSplitter(data, data.length);
    for (const taille of [1, 7, 64, 333, 1024, 4096, 65_536]) {
      expect(viaSplitter(data, taille), `taille de lecture ${taille}`).toEqual(reference);
    }
  });

  it('donne exactement le même découpage que cdcBoundaries', () => {
    const data = pseudoRandom(120_000, 31);
    let pos = 0;
    const attendu: string[] = [];
    for (const fin of cdcBoundaries(data, SMALL)) {
      attendu.push(createHash('sha256').update(data.subarray(pos, fin)).digest('hex'));
      pos = fin;
    }
    expect(viaSplitter(data, 997)).toEqual(attendu);
  });

  it('reconstitue exactement les octets d\'origine', () => {
    const data = pseudoRandom(90_000, 37);
    const s = new CdcSplitter(SMALL);
    const blocs: Uint8Array[] = [];
    for (let i = 0; i < data.length; i += 5000) {
      blocs.push(...s.push(data.subarray(i, Math.min(i + 5000, data.length))));
    }
    blocs.push(...s.flush());
    const total = blocs.reduce((n, b) => n + b.length, 0);
    expect(total).toBe(data.length);
    const rejoint = new Uint8Array(total);
    let o = 0;
    for (const b of blocs) { rejoint.set(b, o); o += b.length; }
    expect(Buffer.from(rejoint).equals(Buffer.from(data))).toBe(true);
  });

  it('gère un flux vide et un flux plus court que `min`', () => {
    expect(new CdcSplitter(SMALL).flush()).toEqual([]);
    const s = new CdcSplitter(SMALL);
    expect(s.push(new Uint8Array(0))).toEqual([]);
    const petit = pseudoRandom(10, 41);
    expect(s.push(petit)).toEqual([]);
    const restes = s.flush();
    expect(restes).toHaveLength(1);
    expect(restes[0].length).toBe(10);
  });

  it('tient un flux nettement plus grand que `max` sans exploser', () => {
    const data = pseudoRandom(SMALL.max * 40, 43);
    const s = new CdcSplitter(SMALL);
    let total = 0;
    for (let i = 0; i < data.length; i += 3001) {
      for (const b of s.push(data.subarray(i, Math.min(i + 3001, data.length)))) {
        expect(b.length).toBeLessThanOrEqual(SMALL.max);
        total += b.length;
      }
    }
    for (const b of s.flush()) total += b.length;
    expect(total).toBe(data.length);
  });
});

describe('paramètres de production', () => {
  it('CDC_V1 est cohérent et ses masques sont constructibles', () => {
    expect(CDC_V1.min).toBeLessThanOrEqual(CDC_V1.avg);
    expect(CDC_V1.avg).toBeLessThanOrEqual(CDC_V1.max);
    expect(1 << CDC_V1.maskBits).toBe(CDC_V1.avg);
    expect(() => masksOf(CDC_V1)).not.toThrow();
  });

  it('refuse des paramètres incohérents', () => {
    const mauvais: CdcParams = { min: 100, avg: 50, max: 10, maskBits: 8, normalization: 2 };
    expect(() => nextCut(pseudoRandom(500, 47), 0, mauvais)).toThrow();
  });
});
