/**
 * cdcProof.vitest.ts — LA GARDE DOIT ÉCHOUER SUR L'ANCIEN DÉCOUPAGE.
 *
 * Un test qui passe ne prouve rien tant qu'on n'a pas vu la version fautive
 * échouer. Cette suite fait tourner LE MÊME scénario d'insertion sur les deux
 * découpages et exige que le découpage à taille FIXE — celui qu'on remplace —
 * perde absolument tout, là où le découpage par contenu garde presque tout.
 *
 * Si un jour la première assertion cesse de valoir 0, c'est que le scénario ne
 * teste plus ce qu'il prétend tester, et que la suite voisine `cdc.vitest.ts`
 * passe pour une raison qui n'est pas la bonne.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { cdcBoundaries, type CdcParams } from '../cdc';

const SMALL: CdcParams = { min: 64, avg: 256, max: 1024, maskBits: 8, normalization: 2 };

function pseudoRandom(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}
const h = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Découpage à taille FIXE — la logique actuelle de `deltaManifest` (8 Mio). */
function blocsFixes(b: Uint8Array, taille: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < b.length; i += taille) {
    out.push(h(b.subarray(i, Math.min(i + taille, b.length))));
  }
  return out;
}

function blocsCdc(b: Uint8Array): string[] {
  const out: string[] = [];
  let pos = 0;
  for (const fin of cdcBoundaries(b, SMALL)) {
    out.push(h(b.subarray(pos, fin)));
    pos = fin;
  }
  return out;
}

const partage = (a: string[], b: string[]): number => {
  const set = new Set(b);
  return a.filter((x) => set.has(x)).length / a.length;
};

describe('taille fixe contre contenu — un octet inséré en tête', () => {
  const original = pseudoRandom(200_000, 19);
  const modifie = new Uint8Array(original.length + 1);
  modifie[0] = 0x42;
  modifie.set(original, 1);

  it("le découpage FIXE perd TOUT — c'est le défaut qu'on corrige", () => {
    // Chaque bloc est décalé d'un octet : aucun hachage ne survit. C'est
    // exactement ce que fait aujourd'hui la frontière de 8 Mio sur un fichier
    // dont le début bouge.
    expect(partage(blocsFixes(original, SMALL.avg), blocsFixes(modifie, SMALL.avg))).toBe(0);
  });

  it('le découpage PAR CONTENU garde presque tout', () => {
    expect(partage(blocsCdc(original), blocsCdc(modifie))).toBeGreaterThan(0.9);
  });

  it("l'écart entre les deux EST le gain du lot", () => {
    const fixe = partage(blocsFixes(original, SMALL.avg), blocsFixes(modifie, SMALL.avg));
    const cdc = partage(blocsCdc(original), blocsCdc(modifie));
    expect(cdc - fixe).toBeGreaterThan(0.9);
  });
});

describe('taille fixe contre contenu — un octet modifié au milieu', () => {
  const original = pseudoRandom(200_000, 23);
  const modifie = Uint8Array.from(original);
  modifie[100_000] ^= 0xff;

  it('les deux découpages s\'en sortent : sans décalage, la taille fixe suffit', () => {
    // Honnêteté du dossier : le découpage fixe n'est PAS mauvais partout. Sur
    // une modification en place, il ne perd qu'un bloc. Son défaut est le
    // DÉCALAGE, pas la modification — d'où le test précédent.
    const fixe = partage(blocsFixes(original, SMALL.avg), blocsFixes(modifie, SMALL.avg));
    const cdc = partage(blocsCdc(original), blocsCdc(modifie));
    expect(fixe).toBeGreaterThan(0.9);
    expect(cdc).toBeGreaterThan(0.9);
  });
});
