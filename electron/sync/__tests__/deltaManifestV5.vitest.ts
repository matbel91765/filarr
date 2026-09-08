/**
 * deltaManifestV5.vitest.ts — Manifeste delta v5, et lecture du v4.
 *
 * Ce qui est défendu :
 *  1. UN LECTEUR v5 LIT LE v4. Les deux formats coexistent indéfiniment ;
 *     aucun fichier n'est migré.
 *  2. LA TAILLE STOCKÉE NE SE RECALCULE PLUS. En v5 elle est portée par `e` ;
 *     en v4 elle vaut `s + 28`, la valeur RÉELLE — c'est la correction du
 *     bogue où `deltaManifest` déclarait 29 pour un format qui en faisait 28.
 *  3. LE QUOTA DÉDUPLIQUE. Un bloc référencé deux fois n'occupe R2 qu'une fois.
 *  4. UN MANIFESTE MAL FORMÉ LÈVE. Il est authentifié par la FEK : s'il est
 *     abîmé, c'est un problème réel, jamais quelque chose à rattraper au mieux.
 */

import { describe, it, expect } from 'vitest';
import {
  buildManifestV5,
  readManifest,
  referencedHashes,
  storedBytesOf,
  type NormalizedBlock,
} from '../deltaManifestV5';
import {
  DELTA_MANIFEST_FMT,
  ERR_MANIFEST_INVALID,
  ERR_MANIFEST_PARSE,
  MANIFEST_V4,
  MANIFEST_V5,
} from '../deltaManifestShared';
import { OVERHEAD_V1 } from '../blockFormat';
import { CDC_V1 } from '../cdc';
import {
  DELTA_MANIFEST_FMT as PROD_FMT,
  DELTA_MANIFEST_VERSION as PROD_VERSION,
  DELTA_HKDF_INFO as PROD_HKDF_INFO,
} from '../deltaManifest';

const H = (n: number): string => n.toString(16).padStart(2, '0').repeat(32);
const KDF = { name: 'HKDF-SHA256', salt: 'c2FsdA==', info: 'filarr-delta-v4' };

function blocks(spec: Array<[hash: number, plain: number, stored: number]>): NormalizedBlock[] {
  return spec.map(([h, s, e], i) => ({ i, h: H(h), s, e }));
}

function v4Json(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    fmt: DELTA_MANIFEST_FMT,
    v: MANIFEST_V4,
    fileId: 'fichier-1',
    algo: 'AES-256-GCM',
    blockSize: 8 * 1024 * 1024,
    totalSize: 300,
    blockCount: 2,
    kdf: KDF,
    plaintextChecksum: H(0xaa),
    blocks: [
      { i: 0, h: H(1), s: 100 },
      { i: 1, h: H(2), s: 200 },
    ],
    createdAt: '2026-09-05T00:00:00Z',
    ...over,
  });
}

describe('les constantes ne divergent pas du chemin de production', () => {
  it('le magic et la version v4 sont les mêmes des deux côtés', () => {
    // La duplication est assumée (contrainte de racine de tsconfig), mais elle
    // doit être surveillée : deux vérités sur le même format, c'est le début
    // d'une divergence silencieuse.
    expect(DELTA_MANIFEST_FMT).toBe(PROD_FMT);
    expect(MANIFEST_V4).toBe(PROD_VERSION);
    expect(MANIFEST_V5).toBe(MANIFEST_V4 + 1);
  });

  it("le contexte de dérivation de clé ne change PAS avec la version du manifeste", () => {
    // Règle non négociable du contrat : `kdf.info` reste `filarr-delta-v4` même
    // en manifeste v5. La changer rendrait indéchiffrable tout fichier delta
    // existant. Même raisonnement que `filarr-share-v1` côté Send.
    const m = buildManifestV5({
      fileId: 'f', algo: 'AES-256-GCM', blocks: blocks([[1, 10, 39]]),
      kdf: KDF, plaintextChecksum: H(0xbb),
    });
    expect((m.kdf as { info: string }).info).toBe(PROD_HKDF_INFO);
    expect(PROD_HKDF_INFO).toBe('filarr-delta-v4');
  });
});

describe('lecture du v4 par un lecteur v5', () => {
  it('lit un manifeste v4 sans broncher', () => {
    const m = readManifest(v4Json());
    expect(m.version).toBe(MANIFEST_V4);
    expect(m.blockCount).toBe(2);
    expect(m.chunking).toBeNull();
    expect(m.blockSize).toBe(8 * 1024 * 1024);
  });

  it('synthétise la taille stockée à `s + 28`, la valeur RÉELLE', () => {
    // Le bogue d'origine : deltaManifest annonçait 29 pour un format qui en
    // faisait 28, donc le quota sur-comptait un octet par bloc depuis mars.
    const m = readManifest(v4Json());
    expect(OVERHEAD_V1).toBe(28);
    expect(m.blocks[0].e).toBe(100 + 28);
    expect(m.blocks[1].e).toBe(200 + 28);
  });

  it('exige `blockSize` en v4', () => {
    expect(() => readManifest(v4Json({ blockSize: undefined }))).toThrow(ERR_MANIFEST_INVALID);
  });
});

describe('écriture puis lecture du v5', () => {
  const m5 = buildManifestV5({
    fileId: 'fichier-2',
    algo: 'AES-256-GCM',
    blocks: blocks([[1, 1000, 300], [2, 2000, 2029]]),
    kdf: KDF,
    plaintextChecksum: H(0xcc),
    createdAt: '2026-09-05T01:00:00Z',
    device: 'poste-1',
  });

  it('fait l’aller-retour', () => {
    const m = readManifest(JSON.stringify(m5));
    expect(m.version).toBe(MANIFEST_V5);
    expect(m.fileId).toBe('fichier-2');
    expect(m.device).toBe('poste-1');
    expect(m.blockCount).toBe(2);
    expect(m.totalSize).toBe(3000);
  });

  it('porte la taille stockée RÉELLE, pas une reconstitution', () => {
    const m = readManifest(JSON.stringify(m5));
    // Le premier bloc est compressé : 1 000 octets de clair, 300 stockés.
    // AUCUNE constante de surcoût ne peut retrouver ça.
    expect(m.blocks[0].e).toBe(300);
    expect(m.blocks[0].s).toBe(1000);
    expect(m.blocks[1].e).toBe(2029);
  });

  it('décrit le découpage et le codec', () => {
    const m = readManifest(JSON.stringify(m5));
    expect(m.chunking).not.toBeNull();
    expect(m.chunking!.name).toBe('cdc-v1');
    expect(m.chunking!.gear).toBe('filarr-gear-v1');
    expect(m.chunking!.codec).toBe('deflate-raw');
    expect(m.chunking!.min).toBe(CDC_V1.min);
    expect(m.chunking!.avg).toBe(CDC_V1.avg);
    expect(m.chunking!.max).toBe(CDC_V1.max);
    expect(m.chunking!.maskBits).toBe(CDC_V1.maskBits);
  });

  it('accepte un fichier sans aucun bloc compressé (codec nul)', () => {
    const sansCodec = buildManifestV5({
      fileId: 'f', algo: 'AES-256-GCM', blocks: blocks([[1, 10, 39]]),
      kdf: KDF, plaintextChecksum: H(0xbb), codec: null,
    });
    expect(readManifest(JSON.stringify(sansCodec)).chunking!.codec).toBeNull();
  });

  it('n’écrit PAS `blockSize` en v5', () => {
    expect(m5.blockSize).toBeUndefined();
  });

  it('REFUSE un v5 qui porterait aussi `blockSize`', () => {
    // Un manifeste qui porte les deux descriptions du découpage est ambigu, et
    // un lecteur pourrait suivre la mauvaise. On refuse au lieu d’ignorer.
    const ambigu = { ...m5, blockSize: 8 * 1024 * 1024 };
    expect(() => readManifest(JSON.stringify(ambigu))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('REFUSE un v5 sans découpage', () => {
    const sans = { ...m5, chunking: undefined };
    expect(() => readManifest(JSON.stringify(sans))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('REFUSE un v5 dont un bloc n’a pas de taille stockée', () => {
    const sansE = {
      ...m5,
      blocks: [{ i: 0, h: H(1), s: 1000 }, { i: 1, h: H(2), s: 2000 }],
    };
    expect(() => readManifest(JSON.stringify(sansE))).toThrow(ERR_MANIFEST_INVALID);
  });
});

describe('validation', () => {
  it('refuse un JSON illisible', () => {
    expect(() => readManifest('{pas du json')).toThrow(ERR_MANIFEST_PARSE);
  });

  it('refuse un magic étranger', () => {
    expect(() => readManifest(v4Json({ fmt: 'autre-chose' }))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('refuse une version inconnue', () => {
    for (const v of [3, 6, 0, -1]) {
      expect(() => readManifest(v4Json({ v }))).toThrow(ERR_MANIFEST_INVALID);
    }
  });

  it('refuse des index non contigus — un trou tronquerait le fichier en silence', () => {
    const troue = v4Json({
      blocks: [{ i: 0, h: H(1), s: 100 }, { i: 2, h: H(2), s: 200 }],
    });
    expect(() => readManifest(troue)).toThrow(ERR_MANIFEST_INVALID);
  });

  it('refuse un décompte de blocs qui ment', () => {
    expect(() => readManifest(v4Json({ blockCount: 3 }))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('refuse une taille totale incohérente', () => {
    expect(() => readManifest(v4Json({ totalSize: 999 }))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('refuse un hachage qui n’est pas un SHA-256 hexadécimal minuscule', () => {
    for (const h of ['A'.repeat(64), 'z'.repeat(64), 'ab', '']) {
      const mauvais = v4Json({ blocks: [{ i: 0, h, s: 300 }], blockCount: 1 });
      expect(() => readManifest(mauvais)).toThrow(ERR_MANIFEST_INVALID);
    }
  });

  it('refuse un descripteur de clé incomplet', () => {
    expect(() => readManifest(v4Json({ kdf: { name: 'HKDF-SHA256' } }))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('refuse un découpage aux masques inconstructibles', () => {
    const m = buildManifestV5({
      fileId: 'f', algo: 'AES-256-GCM', blocks: blocks([[1, 10, 39]]),
      kdf: KDF, plaintextChecksum: H(0xbb),
    });
    // maskBits + normalisation > 31 : `highMask` refuserait au premier octet,
    // avec un message qui accuserait le découpage alors que la faute est ici.
    const casse = { ...m, chunking: { ...(m.chunking as object), maskBits: 30, normalization: 2 } };
    expect(() => readManifest(JSON.stringify(casse))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('préserve les champs inconnus d’un client plus récent', () => {
    const m = readManifest(v4Json({ quelqueChoseDeFutur: { a: 1 } }));
    expect(m.extra.quelqueChoseDeFutur).toEqual({ a: 1 });
  });
});

describe('arithmétique du quota', () => {
  it('DÉDUPLIQUE : un bloc référencé deux fois n’occupe R2 qu’une fois', () => {
    // Compter chaque position sur-facturerait un fichier très répétitif — et
    // c’est exactement le genre de fichier que la déduplication sert à
    // rendre bon marché.
    const m = readManifest(
      JSON.stringify(
        buildManifestV5({
          fileId: 'f', algo: 'AES-256-GCM',
          blocks: blocks([[1, 100, 128], [1, 100, 128], [2, 50, 78]]),
          kdf: KDF, plaintextChecksum: H(0xbb),
        })
      )
    );
    expect(m.blockCount).toBe(3);
    expect(m.totalSize).toBe(250);
    expect(storedBytesOf(m)).toBe(128 + 78);
  });

  it('les hachages référencés sont ce que le ramasse-miettes doit préserver', () => {
    const m = readManifest(v4Json());
    expect(referencedHashes(m)).toEqual(new Set([H(1), H(2)]));
  });

  it('un manifeste vide est licite et ne stocke rien', () => {
    const vide = buildManifestV5({
      fileId: 'f', algo: 'AES-256-GCM', blocks: [], kdf: KDF, plaintextChecksum: H(0xbb),
    });
    const m = readManifest(JSON.stringify(vide));
    expect(m.blockCount).toBe(0);
    expect(storedBytesOf(m)).toBe(0);
  });
});

describe('les deux formats sont MUTUELLEMENT EXCLUSIFS', () => {
  // Question posee par la session mobile le 2026-09-05 : « confirme-moi qu un
  // v4 n a jamais de `chunking` ni de `codec`, sinon je dois prevoir la
  // combinaison ». La bonne reponse n est pas une promesse mais une garantie :
  // le lecteur REFUSE la combinaison, il ne l interprete pas.
  it('un v4 qui porterait un decoupage est REFUSE', () => {
    expect(() => readManifest(v4Json({ chunking: { name: 'cdc-v1' } }))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('un v4 qui porterait un codec est REFUSE', () => {
    expect(() => readManifest(v4Json({ codec: 'deflate-raw' }))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('un v5 qui porterait une frontiere fixe est REFUSE', () => {
    const m5 = buildManifestV5({
      fileId: 'f', algo: 'AES-256-GCM', blocks: blocks([[1, 10, 39]]),
      kdf: KDF, plaintextChecksum: H(0xbb),
    });
    expect(() => readManifest(JSON.stringify({ ...m5, blockSize: 8388608 }))).toThrow(ERR_MANIFEST_INVALID);
  });

  it('le constructeur v4 n ecrit ni decoupage ni codec', () => {
    // La garantie a la SOURCE : si quelqu un ajoutait ces champs au
    // constructeur v4, ce test tomberait avant que le lecteur ne les refuse.
    const m4 = JSON.parse(v4Json());
    expect(m4.chunking).toBeUndefined();
    expect(m4.codec).toBeUndefined();
    expect(m4.blockSize).toBeDefined();
  });
});
