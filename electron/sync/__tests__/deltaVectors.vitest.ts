/**
 * deltaVectors.vitest.ts — Conformance aux vecteurs croisés du format v2.
 *
 * C'est LA suite qui rend le lot 8 possible. Le bureau, l'application web et le
 * mobile rejouent tous `test-vectors/delta-v2.json` ; une surface qui ne le
 * rejoue pas est réputée non conforme, quel que soit l'état de son code.
 *
 * ── POURQUOI CETTE SUITE VAUT PLUS QUE LES AUTRES ────────────────────────────
 * Les vecteurs ont été produits par `scripts/gen-delta-vectors.mjs`, qui
 * RÉIMPLÉMENTE FastCDC et le format de bloc à partir de la spécification écrite
 * dans la fiche de parité, sans importer `cdc.ts` ni `portableBlockCrypto.ts`.
 * Un vecteur généré par le code qu'il vérifie enregistrerait un bogue au lieu
 * de le signaler ; ici les deux chemins sont indépendants, et un écart entre
 * eux est exactement ce qu'on veut voir.
 *
 * ── CE QUE LE MOBILE ET LE WEB DOIVENT REJOUER ───────────────────────────────
 * Frontières de découpage, blocs chiffrés, cas de refus, et lecture. Les entrées
 * sont des RECETTES (voir l'en-tête du générateur) : dix lignes à réimplémenter,
 * aucun octet à transporter.
 *
 * ── DEUX NIVEAUX D'EXIGENCE, ET IL FAUT LES DISTINGUER ───────────────────────
 * Chaque bloc porte un champ `conformance` :
 *   'bytes'   — bloc NON compressé. Tout est déterministe (en-tête, AAD,
 *               AES-GCM à nonce imposé) : une surface conforme doit reproduire
 *               l'objet stocké OCTET POUR OCTET.
 *   'decrypt' — bloc COMPRESSÉ. Seul le déchiffrement est opposable, parce que
 *               la RFC 1951 spécifie le DÉCODEUR et non l'encodeur. Exiger
 *               l'égalité binaire ici ferait échouer une surface parfaitement
 *               conforme — c'est ce que la session mobile a mesuré sur `fflate`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GEAR, cdcBoundaries, type CdcParams } from '../cdc';
import { FLAG_COMPRESSED, ERR_CORRUPT, parseBlockV2 } from '../blockFormat';
import { decryptBlockV2, encryptBlockV2, sha256Hex } from '../portableBlockCrypto';

interface Vectors {
  format: string;
  version: number;
  gear: { name: string; width: number; sample: Record<string, number> };
  cdcParams: { small: CdcParams; prod: CdcParams };
  cdc: Array<{ id: string; recipe: string; params: 'small' | 'prod'; inputSize: number; cuts: number[] }>;
  blockKeyHex: string;
  blockNonceHex: string;
  blocks: Array<{
    id: string;
    recipe: string;
    fileId: string;
    plaintextHash: string;
    plaintextSize: number;
    compressed: boolean;
    headerByte: number;
    storedSize: number;
    blobHex: string;
    conformance: 'bytes' | 'decrypt';
  }>;
  rejects: Array<{ id: string; mutate: string; expect: string }>;
}

const V: Vectors = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'test-vectors', 'delta-v2.json'), 'utf8')
);

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * Les recettes. À réimplémenter à l'identique sur chaque surface — c'est le
 * seul code que les vecteurs demandent de dupliquer, et il tient en dix lignes.
 */
function lcg(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

function materialize(recipe: string): Uint8Array {
  const idx = recipe.indexOf(':');
  const kind = recipe.slice(0, idx);
  const rest = recipe.slice(idx + 1).split(':');
  if (kind === 'zeros') return new Uint8Array(Number(rest[0]));
  if (kind === 'lcg') return lcg(Number(rest[0]), Number(rest[1]));
  if (kind === 'lcgHead') {
    const body = lcg(Number(rest[0]), Number(rest[1]));
    const out = new Uint8Array(body.length + 1);
    out[0] = 0x42;
    out.set(body, 1);
    return out;
  }
  if (kind === 'repeat') {
    const n = Number(rest[0]);
    const unit = new TextEncoder().encode(rest.slice(1).join(':'));
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = unit[i % unit.length];
    return out;
  }
  throw new Error(`recette inconnue : ${recipe}`);
}

describe('fichier de vecteurs', () => {
  it('est celui qu\'on attend', () => {
    expect(V.format).toBe('filarr-delta-vectors');
    expect(V.version).toBe(1);
    expect(V.cdc.length).toBeGreaterThanOrEqual(8);
    expect(V.blocks.length).toBeGreaterThanOrEqual(6);
  });

  it('décrit la même table Gear que l\'implémentation', () => {
    expect(V.gear.name).toBe('filarr-gear-v1');
    expect(V.gear.width).toBe(32);
    for (const [i, valeur] of Object.entries(V.gear.sample)) {
      expect(GEAR[Number(i)], `GEAR[${i}]`).toBe(valeur);
    }
  });
});

describe('frontières de découpage', () => {
  for (const cas of V.cdc) {
    it(`${cas.id} — ${cas.inputSize} octets, ${cas.cuts.length} blocs`, () => {
      const buf = materialize(cas.recipe);
      // La recette doit d'abord produire les bons octets : si celle-ci diverge,
      // tout le reste du vecteur est faux et le message doit le dire.
      expect(buf.length, 'la recette ne produit pas la bonne taille').toBe(cas.inputSize);
      const params = cas.params === 'prod' ? V.cdcParams.prod : V.cdcParams.small;
      expect(cdcBoundaries(buf, params)).toEqual(cas.cuts);
    });
  }

  it("l'insertion d'un octet en tête ne décale pas le découpage", () => {
    // Les deux cas jumeaux du vecteur, comparés entre eux : c'est le gain du
    // lot, mesuré sur des données que trois plateformes partagent.
    const sans = V.cdc.find((c) => c.id === 'lcg-petit');
    const avec = V.cdc.find((c) => c.id === 'lcg-insertion');
    expect(sans && avec).toBeTruthy();
    const communs = new Set(sans!.cuts.map((c) => c + 1));
    const partage = avec!.cuts.filter((c) => communs.has(c)).length / avec!.cuts.length;
    expect(partage).toBeGreaterThan(0.9);
  });
});

describe('blocs chiffrés — octet pour octet', () => {
  const key = hexToBytes(V.blockKeyHex);

  for (const cas of V.blocks) {
    describe(cas.id, () => {
      const blob = hexToBytes(cas.blobHex);

      it('la recette produit le clair attendu et son hachage', async () => {
        const plain = materialize(cas.recipe);
        expect(plain.length).toBe(cas.plaintextSize);
        expect(await sha256Hex(plain)).toBe(cas.plaintextHash);
      });

      it("l'en-tête stocké est celui du vecteur", () => {
        expect(blob[0]).toBe(cas.headerByte);
        expect(blob.length).toBe(cas.storedSize);
        const parsed = parseBlockV2(blob);
        expect(parsed.header.version).toBe(2);
        expect(parsed.header.compressed).toBe(cas.compressed);
      });

      it('se déchiffre vers le clair attendu', async () => {
        const plain = await decryptBlockV2(key, cas.fileId, blob, {
          hash: cas.plaintextHash,
          plaintextSize: cas.plaintextSize,
        });
        expect(Array.from(plain)).toEqual(Array.from(materialize(cas.recipe)));
      });

      it(`annonce la bonne exigence de conformité (${cas.conformance})`, () => {
        // 'bytes'   : bloc non compressé — reproductible octet pour octet.
        // 'decrypt' : bloc compressé — seul le déchiffrement est opposable.
        expect(cas.conformance).toBe(cas.compressed ? 'decrypt' : 'bytes');
      });

      if (!cas.compressed) {
        it('est REPRODUCTIBLE octet pour octet (nonce imposé)', async () => {
          // Uniquement pour les blocs non compressés : là, tout est
          // déterministe — en-tête, AAD, AES-GCM. Une surface conforme DOIT
          // retrouver exactement ces octets.
          const nonce = hexToBytes(V.blockNonceHex);
          const e = await encryptBlockV2(key, cas.fileId, materialize(cas.recipe), { nonce });
          expect(Buffer.from(e.blob).toString('hex')).toBe(cas.blobHex);
          expect(e.storedSize).toBe(cas.storedSize);
        });
      }
    });
  }

  /**
   * LA LIMITE, trouvée par la session mobile et figée ici.
   *
   * Le §5.2 du contrat exigeait l'objet stocké « octet pour octet, avec et sans
   * compression ». Ce n'est pas tenable pour les blocs compressés, et ce n'est
   * pas une non-conformité : la RFC 1951 spécifie le DÉCODEUR, pas l'encodeur.
   * Le découpage en blocs et le choix des arbres de Huffman sont libres, donc
   * deux compresseurs conformes produisent deux encodages valides et
   * différents du même clair — 78 octets via les flux, 79 via `fflate`, sur les
   * 65 536 zéros de nos propres vecteurs.
   *
   * Mes 40 premiers tests de conformité ne pouvaient PAS l'attraper : le
   * générateur de vecteurs et l'implémentation partagent le moteur de
   * compression. L'indépendance de `gen-delta-vectors.mjs` couvre FastCDC,
   * l'en-tête et l'AAD — pas le compresseur. C'est le seul angle mort de la
   * conception, et il a fallu une deuxième plateforme pour le voir.
   */
  describe('les blocs compressés ne sont PAS liés octet pour octet', () => {
    it("il reste au moins un bloc de CHAQUE sorte, sinon une exigence cesse d’etre exercee", () => {
      // Garde-fou repris de la session mobile, qui l'avait et pas moi.
      //
      // Le test d'égalité binaire vit dans un `if (!cas.compressed)` : si un
      // jour tous les vecteurs devenaient compressés, il cesserait simplement
      // de tourner, sans qu'aucune suite ne rougisse. Une exigence qu'on
      // n'exerce plus n'est pas une exigence satisfaite.
      expect(V.blocks.filter((b) => b.conformance === 'bytes').length).toBeGreaterThan(0);
      expect(V.blocks.filter((b) => b.conformance === 'decrypt').length).toBeGreaterThan(0);
    });

    it('chaque bloc compressé est marqué « decrypt » et non « bytes »', () => {
      const compresses = V.blocks.filter((b) => b.compressed);
      expect(compresses.length).toBeGreaterThan(0);
      for (const b of compresses) {
        expect(b.conformance, `${b.id} exigerait l'egalite binaire a tort`).toBe('decrypt');
      }
    });

    it("un rechiffrement peut donner d'autres octets tout en restant conforme", async () => {
      // On ne peut pas exhiber ici une divergence avec un autre moteur — le
      // bureau n'en a qu'un. Ce qu'on peut exiger, c'est que la conformité soit
      // définie par le DÉCHIFFREMENT, et ce test dit lequel des deux fait foi :
      // le blob de référence se déchiffre, quelle que soit la façon dont une
      // autre surface aurait compressé le même clair.
      const cas = V.blocks.find((b) => b.compressed)!;
      const plain = await decryptBlockV2(key, cas.fileId, hexToBytes(cas.blobHex), {
        hash: cas.plaintextHash,
        plaintextSize: cas.plaintextSize,
      });
      expect(Array.from(plain)).toEqual(Array.from(materialize(cas.recipe)));
    });
  });

  it('un bloc compressé est bien plus petit que son clair', () => {
    const c = V.blocks.find((b) => b.id === 'zeros-tres-compressible')!;
    expect(c.compressed).toBe(true);
    expect(c.storedSize).toBeLessThan(c.plaintextSize / 100);
  });

  it("un bloc incompressible n'a pas grossi au-delà du surcoût", () => {
    const c = V.blocks.find((b) => b.id === 'incompressible')!;
    expect(c.compressed).toBe(false);
    expect(c.storedSize).toBe(c.plaintextSize + 29);
  });
});

describe('refus — ce qui NE DOIT PAS se déchiffrer', () => {
  const key = hexToBytes(V.blockKeyHex);
  const cas = V.blocks.find((b) => b.id === 'incompressible')!;
  const attendu = { hash: cas.plaintextHash, plaintextSize: cas.plaintextSize };

  const mutate = (fn: (b: Uint8Array) => Uint8Array) => fn(hexToBytes(cas.blobHex));

  it('bit réservé 0x20, 0x40 ou 0x80 allumé', async () => {
    for (const bit of [0x20, 0x40, 0x80]) {
      const b = mutate((x) => { x[0] |= bit; return x; });
      await expect(decryptBlockV2(key, cas.fileId, b, attendu)).rejects.toThrow(ERR_CORRUPT);
    }
  });

  it('version de bloc inconnue', async () => {
    const b = mutate((x) => { x[0] = (x[0] & 0xf0) | 3; return x; });
    await expect(decryptBlockV2(key, cas.fileId, b, attendu)).rejects.toThrow(ERR_CORRUPT);
  });

  it('bit de compression retourné', async () => {
    const b = mutate((x) => { x[0] ^= FLAG_COMPRESSED; return x; });
    await expect(decryptBlockV2(key, cas.fileId, b, attendu)).rejects.toThrow(ERR_CORRUPT);
  });

  it('un octet du chiffré modifié', async () => {
    const b = mutate((x) => { x[20] ^= 0x01; return x; });
    await expect(decryptBlockV2(key, cas.fileId, b, attendu)).rejects.toThrow(ERR_CORRUPT);
  });

  it('objet tronqué', async () => {
    const b = hexToBytes(cas.blobHex).slice(0, -1);
    await expect(decryptBlockV2(key, cas.fileId, b, attendu)).rejects.toThrow(ERR_CORRUPT);
  });

  it('mauvais fileId', async () => {
    await expect(
      decryptBlockV2(key, 'un-autre-fichier', hexToBytes(cas.blobHex), attendu)
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('taille de clair annoncée différente', async () => {
    await expect(
      decryptBlockV2(key, cas.fileId, hexToBytes(cas.blobHex), {
        ...attendu,
        plaintextSize: attendu.plaintextSize - 1,
      })
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('hachage attendu différent — le bloc servi à la mauvaise position', async () => {
    const autre = V.blocks.find((b) => b.id === 'compressible')!;
    await expect(
      decryptBlockV2(key, cas.fileId, hexToBytes(cas.blobHex), {
        hash: autre.plaintextHash,
        plaintextSize: attendu.plaintextSize,
      })
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('le vecteur énumère bien tous ces refus', () => {
    // Si quelqu'un ajoute un cas de refus au vecteur sans écrire le test
    // correspondant ici, ce compte le signale.
    expect(V.rejects.length).toBe(9);
  });
});
