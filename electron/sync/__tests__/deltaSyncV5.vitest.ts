/**
 * deltaSyncV5.vitest.ts — Le chemin v5 de bout en bout, vraie cryptographie.
 *
 * Toutes les autres suites de ce chantier verifient des modules purs. Celle-ci
 * fait passer un VRAI fichier par un VRAI conteneur V3, un vrai decoupage par
 * contenu, un vrai chiffrement AES-GCM, un transport en memoire, puis rassemble
 * et compare les octets. C est la seule qui puisse dire que la bascule marche.
 *
 * Ce qui est defendu :
 *  1. L ALLER-RETOUR REND EXACTEMENT LES MEMES OCTETS. Sans ca, rien d autre
 *     n a d importance.
 *  2. UNE INSERTION EN TETE NE RETELEVERSE QU UNE POIGNEE DE BLOCS. C est le
 *     gain du chantier, mesure ici de bout en bout et pas sur un tampon.
 *  3. LE MANIFESTE EST UN v5 QUI PORTE LA TAILLE REELLE de chaque objet.
 *  4. UN BLOC ABIME OU MANQUANT FAIT ECHOUER LE RASSEMBLAGE, jamais passer un
 *     fichier faux.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encryptStreamToFileV3, decryptFileToFileV3 } from '../../streamCrypto';
import { downloadDeltaV5, isV5Manifest, uploadDeltaV5 } from '../deltaSyncV5';
import { readManifest } from '../deltaManifestV5';
import { MANIFEST_V5 } from '../deltaManifestShared';
import { ERR_CORRUPT } from '../blockFormat';
import type { DeltaCryptoShared as DeltaCrypto, DeltaTransportShared as DeltaTransport } from '../deltaShared';

const FEK = Buffer.alloc(32, 7);
const MANIFEST_KEY = Buffer.alloc(32, 11);

/** Transport en memoire : R2 et le verrou optimiste, sans reseau. */
function fakeTransport() {
  const blocks = new Map<string, Buffer>();
  let manifest: Buffer | null = null;
  let version = 0;
  let getCount = 0;

  const t: DeltaTransport = {
    async blocksExist(_p, _f, hashes) {
      return hashes.filter((h) => blocks.has(h));
    },
    async putBlock(_p, _f, hash, body) {
      if (blocks.has(hash)) return { deduped: true, size: blocks.get(hash)!.length };
      blocks.set(hash, Buffer.from(body));
      return { deduped: false, size: body.length };
    },
    async getBlock(_p, _f, hash) {
      getCount++;
      const b = blocks.get(hash);
      if (!b) throw new Error('absent');
      return b;
    },
    async getDeltaManifest() {
      return { manifest, version };
    },
    async putDeltaManifest(_p, _f, encrypted) {
      manifest = Buffer.from(encrypted);
      version += 1;
      return { version };
    },
    async gc() {
      return { skipped: false, deletedBytes: 0 };
    },
  } as unknown as DeltaTransport;

  return {
    transport: t,
    blocks,
    get manifest() {
      return manifest;
    },
    get version() {
      return version;
    },
    get getCount() {
      return getCount;
    },
    resetGetCount() {
      getCount = 0;
    },
  };
}

/**
 * Chiffrement du manifeste : XOR avec une cle fixe.
 *
 * Suffisant ici — ce que cette suite verifie, c est le format des BLOCS et le
 * rassemblage, pas la robustesse du scellement du manifeste, qui a ses propres
 * suites. Un XOR rend l aller-retour exact et lisible en cas d echec.
 */
const fakeCrypto: DeltaCrypto = {
  async getFek() {
    return FEK;
  },
  async encryptManifest(plain: Buffer) {
    const out = Buffer.from(plain);
    for (let i = 0; i < out.length; i++) out[i] ^= MANIFEST_KEY[i % MANIFEST_KEY.length];
    return out;
  },
  async decryptManifest(enc: Buffer) {
    const out = Buffer.from(enc);
    for (let i = 0; i < out.length; i++) out[i] ^= MANIFEST_KEY[i % MANIFEST_KEY.length];
    return out;
  },
} as unknown as DeltaCrypto;

/** Octets reproductibles et incompressibles. */
function lcg(n: number, seed: number): Buffer {
  const out = Buffer.alloc(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'filarr-v5-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

/** Ecrit un conteneur V3-FEK a partir d un clair en memoire. */
async function writeV3(plain: Buffer, name: string): Promise<string> {
  const p = join(dir, name);
  await encryptStreamToFileV3(FEK, plain.length, p, async (index, plainLen) => {
    const start = index * 8 * 1024 * 1024;
    return plain.subarray(start, start + plainLen);
  });
  return p;
}

async function readV3(path: string, name: string): Promise<Buffer> {
  const out = join(dir, name);
  await decryptFileToFileV3(FEK, path, out);
  return readFile(out);
}

async function roundTrip(plain: Buffer, harness = fakeTransport()) {
  const src = await writeV3(plain, 'source.enc');
  const up = await uploadDeltaV5({
    profileId: 'p1',
    fileId: 'f1',
    localPath: src,
    transport: harness.transport,
    crypto: fakeCrypto,
  });

  const clair = await fakeCrypto.decryptManifest(harness.manifest!);
  const manifest = readManifest(clair.toString('utf-8'));

  const dest = join(dir, 'dest.enc');
  const down = await downloadDeltaV5(
    {
      profileId: 'p1',
      fileId: 'f1',
      destPath: dest,
      tmpPath: join(dir, 'dest.tmp'),
      transport: harness.transport,
      crypto: fakeCrypto,
    },
    manifest,
    harness.version
  );

  const relu = await readV3(dest, 'relu.bin');
  return { up, down, manifest, relu, harness, clairManifeste: clair.toString('utf-8') };
}

describe('aller-retour', () => {
  it('rend EXACTEMENT les memes octets', async () => {
    const plain = lcg(3 * 1024 * 1024, 42);
    const { relu, up, down } = await roundTrip(plain);
    expect(relu.equals(plain)).toBe(true);
    expect(up.totalSize).toBe(plain.length);
    expect(down.totalSize).toBe(plain.length);
    expect(up.plaintextChecksum).toBe(createHash('sha256').update(plain).digest('hex'));
  }, 60_000);

  it('marche sur un fichier plus GRAND qu un troncon V3', async () => {
    // Le cas ou blocs et troncons ne coincident plus du tout : 10 Mio de clair,
    // troncons V3 de 8 Mio, blocs cdc entre 256 Kio et 4 Mio.
    const plain = lcg(10 * 1024 * 1024, 7);
    const { relu, manifest } = await roundTrip(plain);
    expect(relu.equals(plain)).toBe(true);
    expect(manifest.blockCount).toBeGreaterThan(2);
  }, 120_000);

  it('marche sur un fichier plus PETIT qu un bloc', async () => {
    const plain = lcg(1000, 3);
    const { relu, manifest } = await roundTrip(plain);
    expect(relu.equals(plain)).toBe(true);
    expect(manifest.blockCount).toBe(1);
  }, 60_000);

  it('marche sur un fichier VIDE', async () => {
    const { relu, manifest } = await roundTrip(Buffer.alloc(0));
    expect(relu.length).toBe(0);
    expect(manifest.totalSize).toBe(0);
  }, 60_000);

  it('marche sur un fichier TRES compressible', async () => {
    const plain = Buffer.alloc(2 * 1024 * 1024, 0);
    const { relu, up } = await roundTrip(plain);
    expect(relu.equals(plain)).toBe(true);
    expect(up.compressionSavedBytes).toBeGreaterThan(0);
    // Un fichier de zeros doit tenir dans une fraction infime de sa taille.
    expect(up.transferredBytes).toBeLessThan(plain.length / 100);
  }, 60_000);
});

describe('le manifeste produit', () => {
  it('est un v5', async () => {
    const { manifest, clairManifeste } = await roundTrip(lcg(500_000, 1));
    expect(manifest.version).toBe(MANIFEST_V5);
    expect(isV5Manifest(clairManifeste)).toBe(true);
  }, 60_000);

  it('porte la taille REELLE de chaque objet stocke', async () => {
    const { manifest, harness } = await roundTrip(Buffer.alloc(1_500_000, 0));
    for (const b of manifest.blocks) {
      const objet = harness.blocks.get(b.h);
      expect(objet, `bloc ${b.h.slice(0, 8)} absent`).toBeDefined();
      expect(b.e).toBe(objet!.length);
      // Sur du contenu compressible, la taille stockee est TRES inferieure a
      // celle du clair : aucune constante de surcout ne pourrait la deviner.
      expect(b.e).toBeLessThan(b.s);
    }
  }, 60_000);

  it('n annonce PAS de codec quand aucun bloc n est compresse', async () => {
    const { manifest, up } = await roundTrip(lcg(1_000_000, 9));
    expect(up.compressionSavedBytes).toBe(0);
    expect(manifest.chunking?.codec).toBeNull();
  }, 60_000);

  it('garde le contexte de derivation en v4 malgre le manifeste v5', async () => {
    // Non negociable : le changer rendrait indechiffrable tout fichier delta
    // existant.
    const { manifest } = await roundTrip(lcg(300_000, 5));
    expect(manifest.kdf.info).toBe('filarr-delta-v4');
  }, 60_000);
});

describe('LE gain du chantier, mesure de bout en bout', () => {
  it('une insertion en tete ne reteleverse qu une poignee de blocs', async () => {
    const base = lcg(8 * 1024 * 1024, 21);
    const harness = fakeTransport();

    const src1 = await writeV3(base, 'v1.enc');
    const premier = await uploadDeltaV5({
      profileId: 'p1', fileId: 'f1', localPath: src1,
      transport: harness.transport, crypto: fakeCrypto,
    });

    const modifie = Buffer.concat([Buffer.from('X'.repeat(64)), base]);
    const src2 = await writeV3(modifie, 'v2.enc');
    const second = await uploadDeltaV5({
      profileId: 'p1', fileId: 'f1', localPath: src2,
      transport: harness.transport, crypto: fakeCrypto,
    });

    // Avec la frontiere FIXE de 8 Mio, tout aurait ete reteleverse. Ici la
    // deduplication doit retrouver la tres grande majorite des blocs.
    expect(second.blocksReused).toBeGreaterThan(0);
    const part = second.blocksReused / (second.blocksReused + second.blocksUploaded);
    expect(part).toBeGreaterThan(0.7);
    expect(second.transferredBytes).toBeLessThan(premier.transferredBytes / 2);
  }, 180_000);

  it('un fichier inchange ne reteleverse RIEN', async () => {
    const plain = lcg(2 * 1024 * 1024, 33);
    const harness = fakeTransport();
    const src = await writeV3(plain, 'a.enc');
    await uploadDeltaV5({
      profileId: 'p1', fileId: 'f1', localPath: src,
      transport: harness.transport, crypto: fakeCrypto,
    });
    const second = await uploadDeltaV5({
      profileId: 'p1', fileId: 'f1', localPath: src,
      transport: harness.transport, crypto: fakeCrypto,
    });
    expect(second.blocksUploaded).toBe(0);
    expect(second.transferredBytes).toBe(0);
  }, 120_000);
});

describe('refus au rassemblage', () => {
  it('un bloc MANQUANT fait echouer, jamais passer un fichier tronque', async () => {
    const plain = lcg(2 * 1024 * 1024, 77);
    const harness = fakeTransport();
    const src = await writeV3(plain, 'a.enc');
    await uploadDeltaV5({
      profileId: 'p1', fileId: 'f1', localPath: src,
      transport: harness.transport, crypto: fakeCrypto,
    });
    const clair = await fakeCrypto.decryptManifest(harness.manifest!);
    const manifest = readManifest(clair.toString('utf-8'));

    harness.blocks.delete(manifest.blocks[0].h);

    await expect(
      downloadDeltaV5(
        {
          profileId: 'p1', fileId: 'f1',
          destPath: join(dir, 'x.enc'), tmpPath: join(dir, 'x.tmp'),
          transport: harness.transport, crypto: fakeCrypto,
        },
        manifest,
        harness.version
      )
    ).rejects.toThrow();
  }, 120_000);

  it('un bloc ABIME fait echouer', async () => {
    const plain = lcg(1_500_000, 88);
    const harness = fakeTransport();
    const src = await writeV3(plain, 'a.enc');
    await uploadDeltaV5({
      profileId: 'p1', fileId: 'f1', localPath: src,
      transport: harness.transport, crypto: fakeCrypto,
    });
    const clair = await fakeCrypto.decryptManifest(harness.manifest!);
    const manifest = readManifest(clair.toString('utf-8'));

    const cible = manifest.blocks[0].h;
    const objet = harness.blocks.get(cible)!;
    objet[objet.length - 1] ^= 0x01; // le tag GCM

    await expect(
      downloadDeltaV5(
        {
          profileId: 'p1', fileId: 'f1',
          destPath: join(dir, 'y.enc'), tmpPath: join(dir, 'y.tmp'),
          transport: harness.transport, crypto: fakeCrypto,
        },
        manifest,
        harness.version
      )
    ).rejects.toThrow(ERR_CORRUPT);
  }, 120_000);
});

describe('deduplication a la lecture', () => {
  it('un bloc reference plusieurs fois n est cherche QU UNE fois', async () => {
    // Un fichier de zeros produit des blocs identiques en cascade : sans cache,
    // on paierait le dechiffrement autant de fois qu il y a de positions.
    //
    // 12 Mio et non 4 : sur un contenu CONSTANT, l empreinte glissante repasse
    // par les memes valeurs et le masque ne trouve JAMAIS de frontiere, si bien
    // que toutes les coupes tombent sur `max` (4 Mio). Un fichier de 4 Mio de
    // zeros ne fait donc qu UN bloc, et n exerce pas la deduplication. C est la
    // meme limite du procede que le banc de mesure documente : sans gravite,
    // mais il faut la connaitre pour ecrire un test qui teste vraiment.
    const plain = Buffer.alloc(12 * 1024 * 1024, 0);
    const harness = fakeTransport();
    const src = await writeV3(plain, 'z.enc');
    await uploadDeltaV5({
      profileId: 'p1', fileId: 'f1', localPath: src,
      transport: harness.transport, crypto: fakeCrypto,
    });
    const clair = await fakeCrypto.decryptManifest(harness.manifest!);
    const manifest = readManifest(clair.toString('utf-8'));

    harness.resetGetCount();
    await downloadDeltaV5(
      {
        profileId: 'p1', fileId: 'f1',
        destPath: join(dir, 'w.enc'), tmpPath: join(dir, 'w.tmp'),
        transport: harness.transport, crypto: fakeCrypto,
      },
      manifest,
      harness.version
    );
    const distincts = new Set(manifest.blocks.map((b) => b.h)).size;
    // Trois blocs de 4 Mio, tous identiques : une seule adresse de contenu.
    expect(manifest.blockCount).toBe(3);
    expect(distincts).toBe(1);
    expect(harness.getCount).toBe(distincts);
  }, 120_000);
});

describe('LA BASCULE — le drapeau decide du format ECRIT, jamais du format LU', () => {
  const AVANT = process.env.FILARR_DELTA_V5;
  afterEach(() => {
    if (AVANT === undefined) delete process.env.FILARR_DELTA_V5;
    else process.env.FILARR_DELTA_V5 = AVANT;
  });

  it('drapeau ETEINT : uploadDelta ecrit du v4', async () => {
    delete process.env.FILARR_DELTA_V5;
    const { uploadDelta } = await import('../deltaSync');
    const harness = fakeTransport();
    const plain = lcg(1_200_000, 55);
    const src = await writeV3(plain, 'off.enc');
    await uploadDelta({
      profileId: 'p1', fileId: 'f1', localPath: src,
      transport: harness.transport as never, crypto: fakeCrypto as never,
    });
    const clair = (await fakeCrypto.decryptManifest(harness.manifest!)).toString('utf-8');
    expect(readManifest(clair).version).toBe(4);
    expect(isV5Manifest(clair)).toBe(false);
  }, 120_000);

  it('drapeau ALLUME : uploadDelta ecrit du v5', async () => {
    process.env.FILARR_DELTA_V5 = '1';
    const { uploadDelta } = await import('../deltaSync');
    const harness = fakeTransport();
    const plain = lcg(1_200_000, 55);
    const src = await writeV3(plain, 'on.enc');
    await uploadDelta({
      profileId: 'p1', fileId: 'f1', localPath: src,
      transport: harness.transport as never, crypto: fakeCrypto as never,
    });
    const clair = (await fakeCrypto.decryptManifest(harness.manifest!)).toString('utf-8');
    expect(readManifest(clair).version).toBe(MANIFEST_V5);
  }, 120_000);

  it('un fichier ecrit en v5 se relit meme apres EXTINCTION du drapeau', async () => {
    // LE test qui justifie tout le design du drapeau. Si la lecture etait
    // gatee, eteindre le drapeau apres une bascule rendrait illisibles les
    // fichiers deja ecrits — une bascule reversible se transformerait en perte
    // de donnees.
    process.env.FILARR_DELTA_V5 = '1';
    const { uploadDelta, downloadDelta } = await import('../deltaSync');
    const harness = fakeTransport();
    const plain = lcg(2_000_000, 66);
    const src = await writeV3(plain, 'bascule.enc');
    await uploadDelta({
      profileId: 'p1', fileId: 'f1', localPath: src,
      transport: harness.transport as never, crypto: fakeCrypto as never,
    });

    // RETOUR EN ARRIERE : le drapeau s eteint.
    delete process.env.FILARR_DELTA_V5;

    const dest = join(dir, 'apres.enc');
    await downloadDelta({
      profileId: 'p1', fileId: 'f1', destPath: dest, tmpPath: join(dir, 'apres.tmp'),
      transport: harness.transport as never, crypto: fakeCrypto as never,
    });
    const relu = await readV3(dest, 'apres.bin');
    expect(relu.equals(plain)).toBe(true);
  }, 180_000);

  it('n allume PAS le v5 sur une valeur qui ressemble a un non', async () => {
    // `Boolean(raw)` allumerait le v5 sur `FILARR_DELTA_V5=0`. On compare a des
    // valeurs explicites.
    const { isDeltaV5WriteEnabled } = await import('../deltaFormat');
    for (const v of ['0', 'false', '', 'no', 'oui', 'TRUE']) {
      process.env.FILARR_DELTA_V5 = v;
      expect(isDeltaV5WriteEnabled(), `valeur ${JSON.stringify(v)}`).toBe(false);
    }
    for (const v of ['1', 'true']) {
      process.env.FILARR_DELTA_V5 = v;
      expect(isDeltaV5WriteEnabled(), `valeur ${v}`).toBe(true);
    }
  });
});

describe('« aucun manifeste » ne doit pas dire « donnees abimees »', () => {
  // Trouve par la session mobile en portant la lecture delta : confondre les
  // deux motifs met tout compte possedant un fichier delta dont l index a
  // disparu en erreur PERMANENTE, sur un stockage parfaitement sain.
  it('un manifeste absent leve DeltaUnavailableError, pas une corruption', async () => {
    const { downloadDelta, DeltaUnavailableError, DeltaBlockMissingError } = await import('../deltaSync');
    const vide = fakeTransport(); // aucun manifeste n a ete commite
    let leve: unknown = null;
    try {
      await downloadDelta({
        profileId: 'p1', fileId: 'f1',
        destPath: join(dir, 'n.enc'), tmpPath: join(dir, 'n.tmp'),
        transport: vide.transport as never, crypto: fakeCrypto as never,
      });
    } catch (e) {
      leve = e;
    }
    expect(leve).toBeInstanceOf(DeltaUnavailableError);
    // Et surtout PAS l autre : c est elle qui bloquait le repli et qui
    // annoncait une donnee endommagee.
    expect(leve).not.toBeInstanceOf(DeltaBlockMissingError);
  }, 60_000);

  it('son message ne parle pas de bloc introuvable', async () => {
    const { downloadDelta } = await import('../deltaSync');
    const vide = fakeTransport();
    await expect(
      downloadDelta({
        profileId: 'p1', fileId: 'f1',
        destPath: join(dir, 'm.enc'), tmpPath: join(dir, 'm.tmp'),
        transport: vide.transport as never, crypto: fakeCrypto as never,
      })
    ).rejects.toThrow(/Manifeste delta absent/);
  }, 60_000);

  it('un manifeste PRESENT mais abime reste, lui, une corruption', async () => {
    // La distinction n a de sens que si l autre cas continue de lever
    // franchement : des octets illisibles ne sont pas un index manquant.
    const { downloadDelta } = await import('../deltaSync');
    const harness = fakeTransport();
    const plain = lcg(600_000, 123);
    const src = await writeV3(plain, 'abime.enc');
    await uploadDeltaV5({
      profileId: 'p1', fileId: 'f1', localPath: src,
      transport: harness.transport, crypto: fakeCrypto,
    });
    // On casse le manifeste chiffre : il existe, il est simplement illisible.
    harness.manifest!.fill(0xff, 0, 16);
    await expect(
      downloadDelta({
        profileId: 'p1', fileId: 'f1',
        destPath: join(dir, 'k.enc'), tmpPath: join(dir, 'k.tmp'),
        transport: harness.transport as never, crypto: fakeCrypto as never,
      })
    ).rejects.toThrow();
  }, 120_000);
});
