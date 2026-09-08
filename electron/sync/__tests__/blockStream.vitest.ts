/**
 * blockStream.vitest.ts — Adaptateur entre blocs delta et troncons V3.
 *
 * Ce qui est defendu :
 *  1. LES DEUX DECOUPAGES SONT INDEPENDANTS. C est tout l objet du module, et
 *     l obstacle reel de la bascule v5 : un bloc `cdc-v1` ne coincide plus avec
 *     un troncon V3 de 8 Mio.
 *  2. `read` REND EXACTEMENT CE QU ON DEMANDE, OU LEVE. Rendre moins ferait
 *     ecrire un troncon court sans que personne le sache, et le fichier final
 *     serait tronque en silence.
 *  3. UNE TAILLE DE BLOC QUI MENT EST REFUSEE. L accepter ferait glisser tout
 *     le reste du fichier.
 */

import { describe, it, expect } from 'vitest';
import {
  BlockStreamReader,
  ERR_STREAM_SHORT,
  ERR_STREAM_SIZE,
  chunkLengths,
  type StreamBlockRef,
} from '../blockStream';

/** Octets reproductibles. */
function seq(start: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (start + i) & 0xff;
  return out;
}

/** Construit un flux a partir de tailles de blocs, avec des octets traçables. */
function build(sizes: number[]) {
  const blocs: Uint8Array[] = [];
  let curseur = 0;
  for (const s of sizes) {
    blocs.push(seq(curseur, s));
    curseur += s;
  }
  const refs: StreamBlockRef[] = sizes.map((s, i) => ({ hash: `h${i}`, size: s }));
  const attendu = new Uint8Array(sizes.reduce((a, b) => a + b, 0));
  let o = 0;
  for (const b of blocs) {
    attendu.set(b, o);
    o += b.length;
  }
  return { refs, blocs, attendu };
}

const fetcherFor = (blocs: Uint8Array[]) => async (_ref: StreamBlockRef, i: number) => blocs[i];

describe('lecture de base', () => {
  it('rend les octets dans l ordre, a travers plusieurs blocs', async () => {
    const { refs, blocs, attendu } = build([10, 20, 30]);
    const r = new BlockStreamReader(refs, fetcherFor(blocs));
    const lu = await r.read(60);
    expect(Array.from(lu)).toEqual(Array.from(attendu));
    expect(r.exhausted).toBe(true);
  });

  it('rend 0 octet sans rien chercher', async () => {
    let appels = 0;
    const r = new BlockStreamReader([{ hash: 'h', size: 5 }], async () => {
      appels++;
      return seq(0, 5);
    });
    expect((await r.read(0)).length).toBe(0);
    expect(appels).toBe(0);
  });

  it('compte les octets rendus', async () => {
    const { refs, blocs } = build([16, 16]);
    const r = new BlockStreamReader(refs, fetcherFor(blocs));
    await r.read(20);
    expect(r.bytesProduced).toBe(20);
    await r.read(12);
    expect(r.bytesProduced).toBe(32);
  });

  it('annonce la taille totale du manifeste', () => {
    const { refs, blocs } = build([7, 11, 13]);
    expect(new BlockStreamReader(refs, fetcherFor(blocs)).totalSize).toBe(31);
  });
});

describe('LA propriete : les deux decoupages sont independants', () => {
  it('un bloc peut chevaucher deux troncons', async () => {
    // Blocs de 3, troncons de 5 : aucune frontiere ne coincide. C est le cas
    // nominal apres la bascule, et celui que le chemin v4 ne savait pas traiter.
    const { refs, blocs, attendu } = build([3, 3, 3, 3, 3]);
    const r = new BlockStreamReader(refs, fetcherFor(blocs));
    const morceaux: Uint8Array[] = [];
    for (const n of chunkLengths(15, 5)) morceaux.push(await r.read(n));
    expect(morceaux.map((m) => m.length)).toEqual([5, 5, 5]);
    const rejoint = new Uint8Array(15);
    let o = 0;
    for (const m of morceaux) {
      rejoint.set(m, o);
      o += m.length;
    }
    expect(Array.from(rejoint)).toEqual(Array.from(attendu));
  });

  it('plusieurs blocs peuvent tenir dans un seul troncon', async () => {
    const { refs, blocs, attendu } = build([2, 2, 2, 2, 2, 2, 2, 2]);
    const r = new BlockStreamReader(refs, fetcherFor(blocs));
    const lu = await r.read(16);
    expect(Array.from(lu)).toEqual(Array.from(attendu));
  });

  it('un bloc peut couvrir plusieurs troncons', async () => {
    const { refs, blocs, attendu } = build([100]);
    const r = new BlockStreamReader(refs, fetcherFor(blocs));
    const a = await r.read(30);
    const b = await r.read(30);
    const c = await r.read(40);
    expect([...a, ...b, ...c]).toEqual(Array.from(attendu));
  });

  it('des tailles de blocs quelconques se relisent par des troncons quelconques', async () => {
    // La generalisation des trois cas ci-dessus. Si celui-ci passe pour toutes
    // ces combinaisons, l independance est reelle et pas anecdotique.
    const cas: Array<[number[], number]> = [
      [[1, 1, 1, 1, 1], 2],
      [[5, 1, 9, 3], 4],
      [[64, 64, 64], 100],
      [[1000], 7],
      [[3, 0, 4, 0, 5], 6],
    ];
    for (const [tailles, troncon] of cas) {
      const { refs, blocs, attendu } = build(tailles);
      const r = new BlockStreamReader(refs, fetcherFor(blocs));
      const rejoint = new Uint8Array(attendu.length);
      let o = 0;
      for (const n of chunkLengths(attendu.length, troncon)) {
        const m = await r.read(n);
        rejoint.set(m, o);
        o += m.length;
      }
      expect(Array.from(rejoint), `${tailles} par ${troncon}`).toEqual(Array.from(attendu));
      expect(r.exhausted).toBe(true);
    }
  });
});

describe('refus', () => {
  it('LEVE plutot que de rendre moins que demande', async () => {
    // Rendre un prefixe silencieux ferait ecrire un troncon court, et le
    // fichier final serait tronque sans que rien ne le signale.
    const { refs, blocs } = build([4, 4]);
    const r = new BlockStreamReader(refs, fetcherFor(blocs));
    await expect(r.read(9)).rejects.toThrow(ERR_STREAM_SHORT);
  });

  it('REFUSE un bloc dont la taille ne correspond pas au manifeste', async () => {
    // Le manifeste est authentifie par la FEK. Un bloc d une autre taille
    // signale une incoherence reelle, et l accepter ferait glisser tout le
    // reste du fichier d autant d octets.
    const refs: StreamBlockRef[] = [{ hash: 'h0', size: 10 }];
    const r = new BlockStreamReader(refs, async () => seq(0, 9));
    await expect(r.read(9)).rejects.toThrow(ERR_STREAM_SIZE);
  });

  it('refuse une longueur de lecture absurde', async () => {
    const { refs, blocs } = build([4]);
    const r = new BlockStreamReader(refs, fetcherFor(blocs));
    await expect(r.read(-1)).rejects.toThrow(ERR_STREAM_SIZE);
    await expect(r.read(1.5)).rejects.toThrow(ERR_STREAM_SIZE);
  });

  it('propage l echec du recuperateur', async () => {
    const r = new BlockStreamReader([{ hash: 'h', size: 4 }], async () => {
      throw new Error('bloc absent');
    });
    await expect(r.read(4)).rejects.toThrow('bloc absent');
  });
});

describe('cas limites', () => {
  it('un flux vide est epuise d emblee', async () => {
    const r = new BlockStreamReader([], async () => new Uint8Array(0));
    expect(r.exhausted).toBe(true);
    expect(r.totalSize).toBe(0);
    await expect(r.read(1)).rejects.toThrow(ERR_STREAM_SHORT);
  });

  it('des blocs de taille NULLE ne bloquent pas la lecture', async () => {
    // Un bloc vide est licite dans le manifeste mais ne fait pas avancer la
    // lecture : sans l enchainement, `read` boucle indefiniment.
    const { refs, blocs, attendu } = build([0, 0, 5, 0, 5, 0]);
    const r = new BlockStreamReader(refs, fetcherFor(blocs));
    expect(Array.from(await r.read(10))).toEqual(Array.from(attendu));
  });

  it('ne cherche un bloc qu une seule fois', async () => {
    // Le recuperateur est libre de mettre en cache, mais l adaptateur ne doit
    // pas lui demander deux fois le meme index : ce serait payer deux fois le
    // dechiffrement.
    const { refs, blocs } = build([8, 8, 8]);
    const vus: number[] = [];
    const r = new BlockStreamReader(refs, async (_ref, i) => {
      vus.push(i);
      return blocs[i];
    });
    await r.read(4);
    await r.read(4);
    await r.read(8);
    await r.read(8);
    expect(vus).toEqual([0, 1, 2]);
  });

  it('n est pas epuise tant qu il reste des octets dans le bloc courant', async () => {
    const { refs, blocs } = build([10]);
    const r = new BlockStreamReader(refs, fetcherFor(blocs));
    await r.read(4);
    expect(r.exhausted).toBe(false);
    await r.read(6);
    expect(r.exhausted).toBe(true);
  });
});

describe('decoupe en troncons', () => {
  it('rend le dernier troncon plus court', () => {
    expect(chunkLengths(25, 10)).toEqual([10, 10, 5]);
    expect(chunkLengths(30, 10)).toEqual([10, 10, 10]);
  });

  it('rend une liste vide pour une taille nulle', () => {
    expect(chunkLengths(0, 10)).toEqual([]);
  });

  it('refuse des parametres absurdes', () => {
    expect(() => chunkLengths(-1, 10)).toThrow(ERR_STREAM_SIZE);
    expect(() => chunkLengths(10, 0)).toThrow(ERR_STREAM_SIZE);
    expect(() => chunkLengths(10, -5)).toThrow(ERR_STREAM_SIZE);
  });

  it('la somme des troncons vaut toujours le total', () => {
    for (const [total, taille] of [[0, 8], [1, 8], [7, 8], [8, 8], [9, 8], [1000, 7]]) {
      expect(chunkLengths(total, taille).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});
