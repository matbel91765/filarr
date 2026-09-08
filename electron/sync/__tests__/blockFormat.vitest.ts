/**
 * blockFormat.vitest.ts — En-tête et AAD des blocs delta v2.
 *
 * Trois choses sont défendues ici, et elles ont chacune fait perdre des données
 * à quelqu'un, quelque part :
 *
 *  1. `AAD_CONSTANT_INDEX` ne bouge pas. Lier la position réelle rendrait
 *     indéchiffrable tout bloc qu'une modification a déplacé.
 *  2. Un bit réservé allumé fait ÉCHOUER la lecture. L'ignorer laisserait un
 *     lecteur d'aujourd'hui déchiffrer de travers un format de demain.
 *  3. L'octet d'en-tête est lié dans l'AAD. Sans ça, qui stocke l'objet peut
 *     allumer le bit de compression et faire décompresser du non-compressé.
 */

import { describe, it, expect } from 'vitest';
import {
  AAD_CONSTANT_INDEX,
  BLOCK_FORMAT_V2,
  BLOCK_MAGIC_V1,
  BLOCK_MAGIC_V2,
  ERR_CORRUPT,
  FLAG_COMPRESSED,
  FLAG_RESERVED_MASK,
  NONCE_SIZE,
  TAG_SIZE,
  OVERHEAD_V1,
  OVERHEAD_V2,
  buildAadV2,
  bytesToHex,
  decodeHeader,
  encodeHeader,
  frameBlockV2,
  hexToBytes,
  parseBlockV2,
  storedSizeOf,
} from '../blockFormat';

const HASH_A = 'a'.repeat(64);
const HASH_B = '0123456789abcdef'.repeat(4);

describe('constantes de format', () => {
  it("l'index lié dans l'AAD est la constante 0 — NE PAS CHANGER", () => {
    // Si ce test tombe, quelqu'un a remplacé la constante par la position
    // réelle du bloc. Conséquence : tout bloc déplacé par une modification
    // devient indéchiffrable, alors que son chiffré n'a pas changé (il a été
    // sauté par la déduplication). Lire l'en-tête de `deltaSync.ts` avant de
    // toucher à ça.
    expect(AAD_CONSTANT_INDEX).toBe(0);
  });

  it('les surcoûts valent 28 (v1) et 29 (v2)', () => {
    // Le bogue d'origine : deltaManifest disait 29 pour un format qui en
    // faisait 28. Les deux valeurs existent maintenant, chacune avec SA
    // version, et ne peuvent plus se confondre.
    expect(OVERHEAD_V1).toBe(28);
    expect(OVERHEAD_V2).toBe(29);
    expect(OVERHEAD_V2 - OVERHEAD_V1).toBe(1);
  });

  it('les deux magics diffèrent — un v1 ne peut pas passer pour un v2', () => {
    expect(BLOCK_MAGIC_V1).not.toBe(BLOCK_MAGIC_V2);
    expect(BLOCK_MAGIC_V1).toHaveLength(8);
    expect(BLOCK_MAGIC_V2).toHaveLength(8);
  });
});

describe('en-tête', () => {
  it('compose et décompose sans perte', () => {
    for (const compressed of [false, true]) {
      const byte = encodeHeader({ version: BLOCK_FORMAT_V2, compressed });
      expect(decodeHeader(byte)).toEqual({ version: BLOCK_FORMAT_V2, compressed });
    }
  });

  it('le bit de compression est bien le bit 4', () => {
    expect(encodeHeader({ version: BLOCK_FORMAT_V2, compressed: true }) & FLAG_COMPRESSED).toBe(FLAG_COMPRESSED);
    expect(encodeHeader({ version: BLOCK_FORMAT_V2, compressed: false }) & FLAG_COMPRESSED).toBe(0);
  });

  it("n'allume jamais un bit réservé", () => {
    for (let v = 0; v <= 0x0f; v++) {
      for (const compressed of [false, true]) {
        expect(encodeHeader({ version: v, compressed }) & FLAG_RESERVED_MASK).toBe(0);
      }
    }
  });

  it('REFUSE un octet dont un bit réservé est allumé', () => {
    // Le réflexe habituel est d'ignorer les bits inconnus. C'est le mauvais
    // ici : un futur format pourrait s'en servir pour dire « chiffré
    // autrement », et un lecteur d'aujourd'hui déchiffrerait de travers en
    // croyant réussir.
    for (const bit of [0x20, 0x40, 0x80]) {
      expect(() => decodeHeader(BLOCK_FORMAT_V2 | bit)).toThrow(ERR_CORRUPT);
    }
  });

  it('refuse une version qui déborderait sur les bits réservés', () => {
    expect(() => encodeHeader({ version: 16, compressed: false })).toThrow();
    expect(() => encodeHeader({ version: -1, compressed: false })).toThrow();
  });

  it('refuse un octet hors bornes', () => {
    expect(() => decodeHeader(256)).toThrow(ERR_CORRUPT);
    expect(() => decodeHeader(-1)).toThrow(ERR_CORRUPT);
    expect(() => decodeHeader(1.5)).toThrow(ERR_CORRUPT);
  });
});

describe('hexadécimal', () => {
  it('fait l\'aller-retour', () => {
    expect(bytesToHex(hexToBytes(HASH_B))).toBe(HASH_B);
  });

  it('refuse ce qui n\'est pas un SHA-256 hexadécimal minuscule de 64 caractères', () => {
    expect(() => hexToBytes('a'.repeat(63))).toThrow(ERR_CORRUPT);
    expect(() => hexToBytes('a'.repeat(65))).toThrow(ERR_CORRUPT);
    expect(() => hexToBytes('A'.repeat(64))).toThrow(ERR_CORRUPT); // majuscules
    expect(() => hexToBytes('g'.repeat(64))).toThrow(ERR_CORRUPT);
    expect(() => hexToBytes('')).toThrow(ERR_CORRUPT);
  });
});

describe('AAD v2', () => {
  const base = { fileId: 'abc123', plaintextHash: HASH_A, plaintextSize: 1024 };
  const header = encodeHeader({ version: BLOCK_FORMAT_V2, compressed: false });

  it('commence par le magic v2', () => {
    const aad = buildAadV2(base, header);
    expect(new TextDecoder().decode(aad.subarray(0, 8))).toBe(BLOCK_MAGIC_V2);
  });

  it('est déterministe', () => {
    expect(buildAadV2(base, header)).toEqual(buildAadV2(base, header));
  });

  it('CHANGE quand le bit de compression change — c\'est ce qui interdit de le retourner', () => {
    const compresse = encodeHeader({ version: BLOCK_FORMAT_V2, compressed: true });
    expect(buildAadV2(base, compresse)).not.toEqual(buildAadV2(base, header));
  });

  it('change avec le fileId — interdit de recoller un bloc dans un autre fichier', () => {
    expect(buildAadV2({ ...base, fileId: 'autre' }, header)).not.toEqual(buildAadV2(base, header));
  });

  it('change avec le hachage du clair — interdit la substitution de contenu', () => {
    expect(buildAadV2({ ...base, plaintextHash: HASH_B }, header)).not.toEqual(buildAadV2(base, header));
  });

  it('change avec la taille du clair — interdit la troncature', () => {
    expect(buildAadV2({ ...base, plaintextSize: 1023 }, header)).not.toEqual(buildAadV2(base, header));
  });

  it('ne dépend PAS de la position du bloc', () => {
    // Corollaire direct de AAD_CONSTANT_INDEX : deux blocs de même contenu à
    // deux positions différentes produisent le même AAD, donc le même chiffré
    // peut servir aux deux. C'est ce qui rend la déduplication possible.
    const aad = buildAadV2(base, header);
    const view = new DataView(aad.buffer, aad.byteOffset, aad.byteLength);
    const posIndex = 8 + 1 + 2 + new TextEncoder().encode(base.fileId).length;
    expect(view.getUint32(posIndex, false)).toBe(0);
  });

  it('refuse un fileId de plus de 65 535 octets', () => {
    expect(() => buildAadV2({ ...base, fileId: 'x'.repeat(70_000) }, header)).toThrow(ERR_CORRUPT);
  });

  it('refuse une taille non représentable', () => {
    expect(() => buildAadV2({ ...base, plaintextSize: -1 }, header)).toThrow(ERR_CORRUPT);
    expect(() => buildAadV2({ ...base, plaintextSize: 2 ** 33 }, header)).toThrow(ERR_CORRUPT);
    expect(() => buildAadV2({ ...base, plaintextSize: 1.5 }, header)).toThrow(ERR_CORRUPT);
  });

  it('gère un fileId non ASCII sans se tromper de longueur', () => {
    // La longueur préfixée est en OCTETS, pas en caractères. Un accent occupe
    // deux octets : compter les caractères décalerait tout le reste de l'AAD.
    const aad = buildAadV2({ ...base, fileId: 'éé' }, header);
    const view = new DataView(aad.buffer, aad.byteOffset, aad.byteLength);
    expect(view.getUint16(9, false)).toBe(4);
  });
});

describe('objet stocké v2', () => {
  const header = encodeHeader({ version: BLOCK_FORMAT_V2, compressed: true });
  const nonce = new Uint8Array(NONCE_SIZE).fill(7);
  const corps = new Uint8Array(100).fill(9);

  it('assemble puis découpe sans perte', () => {
    const blob = frameBlockV2(header, nonce, corps);
    expect(blob.length).toBe(1 + NONCE_SIZE + corps.length);
    const parsed = parseBlockV2(blob);
    expect(parsed.headerByte).toBe(header);
    expect(parsed.header).toEqual({ version: BLOCK_FORMAT_V2, compressed: true });
    expect(Array.from(parsed.nonce)).toEqual(Array.from(nonce));
    expect(Array.from(parsed.ciphertextAndTag)).toEqual(Array.from(corps));
  });

  it('refuse un nonce de mauvaise taille', () => {
    expect(() => frameBlockV2(header, new Uint8Array(11), corps)).toThrow(ERR_CORRUPT);
    expect(() => frameBlockV2(header, new Uint8Array(13), corps)).toThrow(ERR_CORRUPT);
  });

  it('refuse un objet trop court AVANT de tenter quoi que ce soit', () => {
    // Sans cette garde, `subarray` rendrait des vues vides et l'échec
    // surviendrait plus loin, avec un message qui désignerait la mauvaise cause.
    for (const n of [0, 1, 13, OVERHEAD_V2 - 1]) {
      expect(() => parseBlockV2(new Uint8Array(n))).toThrow(ERR_CORRUPT);
    }
    // À la taille minimale exacte, un objet VALIDE passe — il faut donc un
    // en-tête correct : un tampon de zéros porterait une version 0 et serait
    // refusé pour une tout autre raison, ce qui ne testerait pas la longueur.
    const minimal = frameBlockV2(header, nonce, new Uint8Array(TAG_SIZE));
    expect(minimal.length).toBe(OVERHEAD_V2);
    expect(() => parseBlockV2(minimal)).not.toThrow();
  });

  it('refuse une version de bloc inconnue', () => {
    const blob = frameBlockV2(encodeHeader({ version: 3, compressed: false }), nonce, corps);
    expect(() => parseBlockV2(blob)).toThrow(ERR_CORRUPT);
  });

  it('refuse un bit réservé allumé dans l\'objet stocké', () => {
    const blob = frameBlockV2(header, nonce, corps);
    blob[0] |= 0x80;
    expect(() => parseBlockV2(blob)).toThrow(ERR_CORRUPT);
  });
});

describe('taille stockée', () => {
  it('distingue les deux versions', () => {
    expect(storedSizeOf(1000, 2)).toBe(1029);
    expect(storedSizeOf(1000, 1)).toBe(1028);
  });
});
