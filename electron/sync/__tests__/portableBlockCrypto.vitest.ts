/**
 * portableBlockCrypto.vitest.ts — Chiffrement portable des blocs delta v2.
 *
 * Les propriétés défendues, par ordre de gravité si elles tombaient :
 *
 *  1. UN BLOC SERVI À LA MAUVAISE POSITION EST REFUSÉ. L'AAD ne lie pas la
 *     position (c'est ce qui permet la déduplication), donc seule la
 *     revérification du hachage après déchiffrement ferme ce trou.
 *  2. LE BIT DE COMPRESSION NE PEUT PAS ÊTRE RETOURNÉ par qui stocke l'objet.
 *  3. LA DÉDUPLICATION MARCHE : le même clair à deux positions donne la même
 *     adresse, et le même objet stocké se déchiffre aux deux endroits.
 *  4. L'ADRESSE DE CONTENU EST CELLE DU CLAIR, jamais du compressé — sinon
 *     deux surfaces aux réglages différents cesseraient de dédupliquer.
 */

import { describe, it, expect } from 'vitest';
import {
  BLOCK_FORMAT_V2,
  ERR_CORRUPT,
  FLAG_COMPRESSED,
  KEY_SIZE,
  NONCE_SIZE,
  OVERHEAD_V2,
  parseBlockV2,
} from '../blockFormat';
import {
  decryptBlockV2,
  encryptBlockV2,
  sha256Hex,
  AAD_INDEX_USED,
} from '../portableBlockCrypto';

const KEY = new Uint8Array(KEY_SIZE).map((_, i) => (i * 7 + 3) & 0xff);
const AUTRE_KEY = new Uint8Array(KEY_SIZE).map((_, i) => (i * 11 + 5) & 0xff);
const NONCE = new Uint8Array(NONCE_SIZE).map((_, i) => (i * 3 + 1) & 0xff);
const TE = new TextEncoder();

function compressible(n: number): Uint8Array {
  return TE.encode(JSON.stringify({ v: Array.from({ length: n }, (_, i) => ({ id: i, t: 'Réunion' })) }));
}
function incompressible(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

async function chiffrer(plain: Uint8Array, fileId = 'fichier-1') {
  return encryptBlockV2(KEY, fileId, plain, { nonce: NONCE });
}

describe('aller-retour', () => {
  it('rend exactement le clair, compressible ou non', async () => {
    for (const plain of [compressible(80), incompressible(4000), new Uint8Array(0), TE.encode('court')]) {
      const e = await chiffrer(plain);
      const back = await decryptBlockV2(KEY, 'fichier-1', e.blob, {
        hash: e.hash,
        plaintextSize: e.plaintextSize,
      });
      expect(Array.from(back)).toEqual(Array.from(plain));
    }
  });

  it('annonce une taille stockée qui correspond aux octets réels', async () => {
    // C'est `blocks[].e` du manifeste : la seule source de vérité du quota,
    // celle qui supprime la contradiction 28/29 par construction.
    const e = await chiffrer(compressible(200));
    expect(e.storedSize).toBe(e.blob.length);
    expect(e.blob.length).toBeGreaterThanOrEqual(OVERHEAD_V2);
  });

  it('compresse quand ça vaut le coup et le dit dans l\'en-tête', async () => {
    const e = await chiffrer(compressible(300));
    expect(e.compressed).toBe(true);
    expect(parseBlockV2(e.blob).header.compressed).toBe(true);
    expect(e.blob[0] & FLAG_COMPRESSED).toBe(FLAG_COMPRESSED);
    // Un bloc compressé DOIT être plus petit que le clair + surcoût.
    expect(e.storedSize).toBeLessThan(e.plaintextSize);
  });

  it('ne compresse pas ce qui ne s\'y prête pas', async () => {
    const e = await chiffrer(incompressible(9000));
    expect(e.compressed).toBe(false);
    expect(parseBlockV2(e.blob).header.compressed).toBe(false);
    expect(e.storedSize).toBe(e.plaintextSize + OVERHEAD_V2);
  });
});

describe('adresse de contenu', () => {
  it('est le SHA-256 du CLAIR, jamais du compressé', async () => {
    const plain = compressible(150);
    const e = await chiffrer(plain);
    expect(e.hash).toBe(await sha256Hex(plain));
    expect(e.compressed).toBe(true);
  });

  it('ne dépend pas du fichier ni du nonce — deux fichiers, même contenu, même adresse', async () => {
    const plain = compressible(60);
    const a = await encryptBlockV2(KEY, 'fichier-A', plain, { nonce: NONCE });
    const b = await encryptBlockV2(KEY, 'fichier-B', plain, { nonce: new Uint8Array(NONCE_SIZE).fill(9) });
    expect(a.hash).toBe(b.hash);
  });

  it('un nonce aléatoire donne deux objets différents pour le même clair', async () => {
    // Voulu : la déduplication porte sur l'ADRESSE (le hachage du clair), pas
    // sur l'égalité des octets chiffrés. Un chiffré déterministe rendrait deux
    // comptes comparables — exactement ce que la proposition 24 rejette.
    const plain = compressible(60);
    const a = await encryptBlockV2(KEY, 'f', plain);
    const b = await encryptBlockV2(KEY, 'f', plain);
    expect(a.hash).toBe(b.hash);
    expect(Array.from(a.blob)).not.toEqual(Array.from(b.blob));
  });
});

describe('déduplication — la position ne fait pas partie de la clé', () => {
  it('AAD_INDEX_USED vaut 0, et un même objet se déchiffre à n\'importe quelle position', async () => {
    expect(AAD_INDEX_USED).toBe(0);
    const plain = incompressible(2000, 5);
    const e = await chiffrer(plain);
    // Le manifeste peut référencer ce bloc en position 0, 7 ou 512 : rien dans
    // le déchiffrement ne dépend de la position, seulement du contenu attendu.
    for (const _position of [0, 7, 512]) {
      const back = await decryptBlockV2(KEY, 'fichier-1', e.blob, {
        hash: e.hash,
        plaintextSize: e.plaintextSize,
      });
      expect(back.length).toBe(plain.length);
    }
  });
});

describe('refus', () => {
  it('REFUSE un bloc servi avec le mauvais contenu attendu', async () => {
    // LA barrière que l'index constant rend nécessaire. Un serveur qui sert un
    // bloc légitime DU MÊME FICHIER à la mauvaise position produirait un
    // fichier faux sans qu'aucune vérification cryptographique ne bronche —
    // sauf celle-ci.
    const bloc1 = await chiffrer(incompressible(1500, 1));
    const bloc2 = await chiffrer(incompressible(1500, 2));
    await expect(
      decryptBlockV2(KEY, 'fichier-1', bloc1.blob, {
        hash: bloc2.hash,
        plaintextSize: bloc2.plaintextSize,
      })
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('REFUSE un bloc recollé dans un autre fichier', async () => {
    const e = await chiffrer(incompressible(800, 3), 'fichier-A');
    await expect(
      decryptBlockV2(KEY, 'fichier-B', e.blob, { hash: e.hash, plaintextSize: e.plaintextSize })
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('REFUSE une taille de clair annoncée différente', async () => {
    const e = await chiffrer(incompressible(800, 4));
    await expect(
      decryptBlockV2(KEY, 'fichier-1', e.blob, { hash: e.hash, plaintextSize: 799 })
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('REFUSE le bit de compression retourné par qui stocke l\'objet', async () => {
    // Sans liaison de l'octet d'en-tête dans l'AAD, un serveur pourrait allumer
    // ce bit et faire décompresser des octets qui ne l'ont jamais été.
    const e = await chiffrer(incompressible(1200, 6));
    expect(e.compressed).toBe(false);
    const trafique = Uint8Array.from(e.blob);
    trafique[0] |= FLAG_COMPRESSED;
    await expect(
      decryptBlockV2(KEY, 'fichier-1', trafique, { hash: e.hash, plaintextSize: e.plaintextSize })
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('REFUSE le bit de compression ÉTEINT sur un bloc compressé', async () => {
    const e = await chiffrer(compressible(200));
    expect(e.compressed).toBe(true);
    const trafique = Uint8Array.from(e.blob);
    trafique[0] &= ~FLAG_COMPRESSED;
    await expect(
      decryptBlockV2(KEY, 'fichier-1', trafique, { hash: e.hash, plaintextSize: e.plaintextSize })
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('REFUSE un bit réservé allumé', async () => {
    const e = await chiffrer(incompressible(600, 7));
    for (const bit of [0x20, 0x40, 0x80]) {
      const trafique = Uint8Array.from(e.blob);
      trafique[0] |= bit;
      await expect(
        decryptBlockV2(KEY, 'fichier-1', trafique, { hash: e.hash, plaintextSize: e.plaintextSize })
      ).rejects.toThrow(ERR_CORRUPT);
    }
  });

  it('REFUSE la mauvaise clé', async () => {
    const e = await chiffrer(incompressible(700, 8));
    await expect(
      decryptBlockV2(AUTRE_KEY, 'fichier-1', e.blob, { hash: e.hash, plaintextSize: e.plaintextSize })
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('REFUSE un octet modifié n\'importe où dans le chiffré', async () => {
    const e = await chiffrer(incompressible(1000, 9));
    for (const pos of [1, 5, 20, e.blob.length - 1]) {
      const trafique = Uint8Array.from(e.blob);
      trafique[pos] ^= 0x01;
      await expect(
        decryptBlockV2(KEY, 'fichier-1', trafique, { hash: e.hash, plaintextSize: e.plaintextSize }),
        `octet ${pos}`
      ).rejects.toThrow(ERR_CORRUPT);
    }
  });

  it('REFUSE un objet tronqué', async () => {
    const e = await chiffrer(incompressible(1000, 10));
    await expect(
      decryptBlockV2(KEY, 'fichier-1', e.blob.subarray(0, e.blob.length - 1), {
        hash: e.hash,
        plaintextSize: e.plaintextSize,
      })
    ).rejects.toThrow(ERR_CORRUPT);
  });

  it('refuse une clé de mauvaise taille', async () => {
    await expect(encryptBlockV2(new Uint8Array(16), 'f', TE.encode('x'))).rejects.toThrow();
  });
});

describe('en-tête produit', () => {
  it('porte toujours la version 2', async () => {
    for (const plain of [compressible(100), incompressible(3000, 11)]) {
      const e = await chiffrer(plain);
      expect(parseBlockV2(e.blob).header.version).toBe(BLOCK_FORMAT_V2);
    }
  });

  it('n\'allume jamais un bit réservé', async () => {
    const e = await chiffrer(compressible(100));
    expect(e.blob[0] & 0xe0).toBe(0);
  });
});
