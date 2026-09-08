/**
 * deltaRead.vitest.ts — Le web lit ce que le bureau écrit en delta, v4 comme v5.
 *
 * Les blocs v4 sont construits ICI à la main d'après `deltaChunkCrypto.ts`
 * (node:crypto, AAD octet pour octet) : un lecteur qui ne relirait que ce
 * qu'il a lui-même scellé ne prouverait rien. Les blocs v5 viennent des
 * vecteurs partagés `test-vectors/delta-v2.json`, que le mobile reproduit aussi.
 */
import { describe, expect, it } from 'vitest';
import { createCipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DELTA_HKDF_INFO,
  ERR_DELTA_BLOCK_MISSING,
  ERR_DELTA_MANIFEST_ABSENT,
  MANIFEST_V4,
  MANIFEST_V5,
  base64ToBytes,
  buildAadV1,
  createDeltaTransport,
  decryptBlockV1,
  deriveDeltaKey,
  parseDeltaManifest,
  readDeltaFile,
  type DeltaTransport,
} from '../deltaRead';
import { decryptBlockV2, encryptBlockV2 } from '../portableBlockCrypto';
import { ERR_CORRUPT } from '../blockFormat';
import { decryptFekContainer, encryptFekContainer } from '../containerCrypto';

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const FEK = Uint8Array.from(createHash('sha256').update('fek de test delta web').digest());
const SALT_B64 = Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex').toString('base64');
const FILE_ID = 'dossier-éé/rapport-2026.pdf';

/** Miroir octet pour octet de `deltaChunkCrypto.buildBlockAad` (index constant 0). */
function aadV4Node(fileId: string, hashHex: string, size: number): Buffer {
  const fileIdBytes = Buffer.from(fileId, 'utf8');
  const aad = Buffer.alloc(8 + 1 + 2 + fileIdBytes.length + 4 + 32 + 4);
  let o = 0;
  o += Buffer.from('FILRDLT4', 'ascii').copy(aad, o);
  o = aad.writeUInt8(0x04, o);
  o = aad.writeUInt16BE(fileIdBytes.length, o);
  o += fileIdBytes.copy(aad, o);
  o = aad.writeUInt32BE(0, o);
  o += Buffer.from(hashHex, 'hex').copy(aad, o);
  aad.writeUInt32BE(size, o);
  return aad;
}

/** Miroir de `deltaChunkCrypto.encryptBlock` : nonce(12) ‖ chiffré ‖ tag(16). */
function sealV4(
  key: Uint8Array,
  fileId: string,
  plain: Uint8Array
): { hash: string; blob: Uint8Array } {
  const hash = sha256(plain);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), nonce, { authTagLength: 16 });
  cipher.setAAD(aadV4Node(fileId, hash, plain.length));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { hash, blob: Uint8Array.from(Buffer.concat([nonce, ct, cipher.getAuthTag()])) };
}

function keyNode(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(hkdfSync('sha256', FEK, Buffer.from(SALT_B64, 'base64'), DELTA_HKDF_INFO, 32))
  );
}

function manifestV4(
  blocks: Array<{ h: string; s: number }>,
  plain: Uint8Array,
  over: Record<string, unknown> = {}
) {
  return {
    fmt: 'filarr-delta-manifest',
    v: MANIFEST_V4,
    fileId: FILE_ID,
    algo: 'AES-256-GCM',
    blockSize: 8 * 1024 * 1024,
    totalSize: plain.length,
    blockCount: blocks.length,
    kdf: { name: 'HKDF-SHA256', salt: SALT_B64, info: DELTA_HKDF_INFO },
    plaintextChecksum: sha256(plain),
    blocks: blocks.map((b, i) => ({ i, h: b.h, s: b.s })),
    createdAt: '2026-09-05T20:00:00.000Z',
    ...over,
  };
}

function manifestV5(
  blocks: Array<{ h: string; s: number; e: number }>,
  plain: Uint8Array,
  over: Record<string, unknown> = {}
) {
  return {
    fmt: 'filarr-delta-manifest',
    v: MANIFEST_V5,
    fileId: FILE_ID,
    algo: 'AES-256-GCM',
    chunking: {
      name: 'fastcdc',
      gear: 'filarr-gear-v1',
      codec: 'deflate-raw',
      min: 1024,
      avg: 4096,
      max: 16384,
      maskBits: 12,
      normalization: 2,
    },
    totalSize: plain.length,
    blockCount: blocks.length,
    kdf: { name: 'HKDF-SHA256', salt: SALT_B64, info: DELTA_HKDF_INFO },
    plaintextChecksum: sha256(plain),
    blocks: blocks.map((b, i) => ({ i, h: b.h, s: b.s, e: b.e })),
    createdAt: '2026-09-05T20:00:00.000Z',
    ...over,
  };
}

async function sealManifest(m: unknown): Promise<Uint8Array> {
  return encryptFekContainer(new TextEncoder().encode(JSON.stringify(m)), FEK);
}

function transportOf(sealed: Uint8Array | null, blobs: Map<string, Uint8Array>) {
  const demandes: string[] = [];
  const t: DeltaTransport = {
    getManifest: async () => sealed,
    getBlock: async (h) => {
      demandes.push(h);
      const b = blobs.get(h);
      if (!b) throw new Error(ERR_DELTA_BLOCK_MISSING);
      return b;
    },
  };
  return { t, demandes };
}

const lire = (t: DeltaTransport, extra: Partial<Parameters<typeof readDeltaFile>[0]> = {}) =>
  readDeltaFile({
    fekRaw: FEK,
    fileId: FILE_ID,
    transport: t,
    decryptManifest: (s) => decryptFekContainer(s, FEK),
    ...extra,
  });

describe('dérivation et AAD v4 — identiques au bureau', () => {
  it('la clé de fichier est HKDF-SHA-256(FEK, sel, "filarr-delta-v4", 32)', async () => {
    expect(Buffer.from(await deriveDeltaKey(FEK, SALT_B64)).toString('hex')).toBe(
      Buffer.from(keyNode()).toString('hex')
    );
    await expect(deriveDeltaKey(FEK, '')).rejects.toThrow(ERR_CORRUPT);
  });

  it("l'AAD d'un bloc v4 est celle de deltaChunkCrypto, fileId non-ASCII compris", () => {
    const h = sha256(new Uint8Array([1, 2, 3]));
    expect(Buffer.from(buildAadV1(FILE_ID, h, 3)).toString('hex')).toBe(
      aadV4Node(FILE_ID, h, 3).toString('hex')
    );
  });

  it('un bloc v4 scellé par node:crypto se déchiffre ; altéré, tronqué ou déplacé, il est refusé', async () => {
    const key = keyNode();
    const plain = randomBytes(5000);
    const { hash, blob } = sealV4(key, FILE_ID, plain);
    expect(
      Buffer.from(await decryptBlockV1(key, FILE_ID, hash, plain.length, blob)).toString('hex')
    ).toBe(plain.toString('hex'));
    const altere = Uint8Array.from(blob);
    altere[20] ^= 0x01;
    await expect(decryptBlockV1(key, FILE_ID, hash, plain.length, altere)).rejects.toThrow(
      ERR_CORRUPT
    );
    await expect(
      decryptBlockV1(key, FILE_ID, hash, plain.length, blob.subarray(0, 100))
    ).rejects.toThrow(ERR_CORRUPT);
    await expect(decryptBlockV1(key, 'autre-fichier', hash, plain.length, blob)).rejects.toThrow(
      ERR_CORRUPT
    );
    await expect(decryptBlockV1(key, FILE_ID, hash, plain.length - 1, blob)).rejects.toThrow(
      ERR_CORRUPT
    );
  });
});

describe('blocs v5 — vecteurs partagés test-vectors/delta-v2.json', () => {
  const pack = JSON.parse(
    readFileSync(join(process.cwd(), 'test-vectors', 'delta-v2.json'), 'utf8')
  ) as {
    blockKeyHex: string;
    blocks: Array<{
      id: string;
      fileId: string;
      plaintextHash: string;
      plaintextSize: number;
      compressed: boolean;
      blobHex: string;
    }>;
  };
  const key = Uint8Array.from(Buffer.from(pack.blockKeyHex, 'hex'));

  for (const b of pack.blocks) {
    it(`déchiffre « ${b.id} » (${b.compressed ? 'compressé' : 'brut'}, ${b.plaintextSize} o)`, async () => {
      const plain = await decryptBlockV2(
        key,
        b.fileId,
        Uint8Array.from(Buffer.from(b.blobHex, 'hex')),
        {
          hash: b.plaintextHash,
          plaintextSize: b.plaintextSize,
        }
      );
      expect(plain.length).toBe(b.plaintextSize);
      expect(sha256(plain)).toBe(b.plaintextHash);
    });
  }

  it('un bloc v5 sous un autre fileId est refusé', async () => {
    const b = pack.blocks[0];
    await expect(
      decryptBlockV2(key, 'pas-le-bon', Uint8Array.from(Buffer.from(b.blobHex, 'hex')), {
        hash: b.plaintextHash,
        plaintextSize: b.plaintextSize,
      })
    ).rejects.toThrow(ERR_CORRUPT);
  });
});

describe('parseDeltaManifest — mêmes refus que le bureau', () => {
  const plain = new Uint8Array(10);
  const h = sha256(plain);
  const ok4 = manifestV4([{ h, s: 10 }], plain);

  it('accepte un v4 et un v5 valides', () => {
    expect(parseDeltaManifest(JSON.stringify(ok4)).version).toBe(4);
    expect(parseDeltaManifest(JSON.stringify(ok4)).blocks[0].e).toBe(38);
    const ok5 = manifestV5([{ h, s: 10, e: 39 }], plain);
    expect(parseDeltaManifest(JSON.stringify(ok5)).codec).toBe('deflate-raw');
  });

  it('refuse : JSON cassé, mauvais fmt, v4 avec chunking, v5 avec blockSize, blocs non contigus, somme fausse, codec inconnu', () => {
    expect(() => parseDeltaManifest('{')).toThrow();
    expect(() => parseDeltaManifest(JSON.stringify({ ...ok4, fmt: 'autre' }))).toThrow();
    expect(() => parseDeltaManifest(JSON.stringify({ ...ok4, chunking: {} }))).toThrow();
    const ok5 = manifestV5([{ h, s: 10, e: 39 }], plain);
    expect(() => parseDeltaManifest(JSON.stringify({ ...ok5, blockSize: 8 }))).toThrow();
    expect(() =>
      parseDeltaManifest(JSON.stringify({ ...ok4, blocks: [{ i: 1, h, s: 10 }] }))
    ).toThrow();
    expect(() => parseDeltaManifest(JSON.stringify({ ...ok4, totalSize: 11 }))).toThrow();
    expect(() =>
      parseDeltaManifest(
        JSON.stringify({ ...ok5, chunking: { ...(ok5.chunking as object), codec: 'zstd' } })
      )
    ).toThrow();
    expect(() =>
      parseDeltaManifest(JSON.stringify({ ...ok4, blocks: [{ i: 0, h: 'zz', s: 10 }] }))
    ).toThrow();
  });
});

describe('readDeltaFile — bout en bout', () => {
  it('v4 : trois blocs dont un dupliqué → le fichier entier, le doublon demandé une seule fois, la progression rendue', async () => {
    const key = keyNode();
    const a = randomBytes(3000);
    const b = randomBytes(1500);
    const blocs = [sealV4(key, FILE_ID, a), sealV4(key, FILE_ID, b), sealV4(key, FILE_ID, a)];
    const plain = Uint8Array.from(Buffer.concat([a, b, a]));
    const blobs = new Map(blocs.map((x) => [x.hash, x.blob]));
    const m = manifestV4(
      [
        { h: blocs[0].hash, s: a.length },
        { h: blocs[1].hash, s: b.length },
        { h: blocs[2].hash, s: a.length },
      ],
      plain
    );
    const { t, demandes } = transportOf(await sealManifest(m), blobs);
    const progression: number[] = [];
    const out = await lire(t, { onProgress: (d) => progression.push(d) });
    expect(Buffer.from(out).toString('hex')).toBe(Buffer.from(plain).toString('hex'));
    expect(demandes.length).toBe(2);
    expect(progression.at(-1)).toBe(3);
  });

  it('v5 : blocs compressés et bruts (module portable), tailles stockées déclarées → le fichier entier', async () => {
    const key = keyNode();
    const compressible = Uint8Array.from(Buffer.alloc(20000, 'Compte rendu. '));
    const brut = randomBytes(700);
    const c1 = await encryptBlockV2(key, FILE_ID, compressible);
    const c2 = await encryptBlockV2(key, FILE_ID, brut);
    expect(c1.compressed).toBe(true);
    expect(c2.compressed).toBe(false);
    const plain = Uint8Array.from(Buffer.concat([compressible, brut]));
    const m = manifestV5(
      [
        { h: c1.hash, s: compressible.length, e: c1.storedSize },
        { h: c2.hash, s: brut.length, e: c2.storedSize },
      ],
      plain
    );
    const { t } = transportOf(
      await sealManifest(m),
      new Map([
        [c1.hash, c1.blob],
        [c2.hash, c2.blob],
      ])
    );
    const out = await lire(t);
    expect(Buffer.from(out).toString('hex')).toBe(Buffer.from(plain).toString('hex'));
  });

  it('manifeste absent → erreur nommée, jamais un fichier vide', async () => {
    const { t } = transportOf(null, new Map());
    await expect(lire(t)).rejects.toThrow(ERR_DELTA_MANIFEST_ABSENT);
  });

  it('bloc absent là-haut → erreur nommée', async () => {
    const key = keyNode();
    const a = randomBytes(100);
    const s = sealV4(key, FILE_ID, a);
    const { t } = transportOf(
      await sealManifest(manifestV4([{ h: s.hash, s: 100 }], a)),
      new Map()
    );
    await expect(lire(t)).rejects.toThrow(ERR_DELTA_BLOCK_MISSING);
  });

  it('empreinte du fichier fausse → corruption, même si chaque bloc est bon', async () => {
    const key = keyNode();
    const a = randomBytes(100);
    const s = sealV4(key, FILE_ID, a);
    const m = manifestV4([{ h: s.hash, s: 100 }], a, {
      plaintextChecksum: sha256(new Uint8Array(1)),
    });
    const { t } = transportOf(await sealManifest(m), new Map([[s.hash, s.blob]]));
    await expect(lire(t)).rejects.toThrow(ERR_CORRUPT);
  });

  it('une autre FEK ne lit ni le manifeste ni les blocs', async () => {
    const key = keyNode();
    const a = randomBytes(100);
    const s = sealV4(key, FILE_ID, a);
    const { t } = transportOf(
      await sealManifest(manifestV4([{ h: s.hash, s: 100 }], a)),
      new Map([[s.hash, s.blob]])
    );
    const autre = Uint8Array.from(randomBytes(32));
    await expect(
      readDeltaFile({
        fekRaw: autre,
        fileId: FILE_ID,
        transport: t,
        decryptManifest: (x) => decryptFekContainer(x, autre),
      })
    ).rejects.toThrow();
  });
});

describe('createDeltaTransport — les deux routes du worker', () => {
  const H = 'a'.repeat(64);
  function deps(reponses: Array<{ status: number; body?: Uint8Array }>, manifest: string | null) {
    const appels: string[] = [];
    let i = 0;
    let rafraichi = 0;
    return {
      appels,
      rafraichi: () => rafraichi,
      d: {
        apiFetch: async (path: string) => {
          appels.push(path);
          return { status: 200, body: { success: true, data: { manifest, version: 3 } } };
        },
        ensureAccessToken: async () => 'jeton',
        refreshViaCookie: async () => {
          rafraichi++;
          return true;
        },
        resolveApiBase: () => 'https://api.test',
        fetch: async (url: string | URL | Request) => {
          appels.push(String(url));
          const r = reponses[Math.min(i++, reponses.length - 1)];
          return new Response(r.body ? Buffer.from(r.body) : null, { status: r.status });
        },
      } as unknown as Parameters<typeof createDeltaTransport>[2],
    };
  }

  it('le manifeste arrive en base64 et redevient des octets ; null reste null', async () => {
    const b64 = Buffer.from('fek:xyz').toString('base64');
    const { d } = deps([], b64);
    const t = createDeltaTransport('p1', 'f1', d);
    expect(Buffer.from((await t.getManifest())!).toString()).toBe('fek:xyz');
    const { d: d2 } = deps([], null);
    expect(await createDeltaTransport('p1', 'f1', d2).getManifest()).toBeNull();
    expect(base64ToBytes(b64)).toEqual(Uint8Array.from(Buffer.from('fek:xyz')));
  });

  it('un bloc : octets bruts sous jeton ; 404 → erreur nommée ; 401 → un rejeu après renouvellement', async () => {
    const octets = new Uint8Array([9, 8, 7]);
    const { d, appels } = deps([{ status: 200, body: octets }], null);
    const t = createDeltaTransport('p1', 'f1', d);
    expect(await t.getBlock(H)).toEqual(octets);
    expect(appels.at(-1)).toBe(`https://api.test/sync/delta/block/p1/f1/${H}`);

    const { d: d404 } = deps([{ status: 404 }], null);
    await expect(createDeltaTransport('p1', 'f1', d404).getBlock(H)).rejects.toThrow(
      ERR_DELTA_BLOCK_MISSING
    );

    const { d: d401, rafraichi } = deps([{ status: 401 }, { status: 200, body: octets }], null);
    expect(await createDeltaTransport('p1', 'f1', d401).getBlock(H)).toEqual(octets);
    expect(rafraichi()).toBe(1);

    await expect(t.getBlock('pas-une-empreinte')).rejects.toThrow(ERR_CORRUPT);
  });
});

describe('câblage — fetchCloudFile route les entrées delta AVANT la garde multipart', () => {
  const src = readFileSync(
    join(process.cwd(), 'src', 'platform', 'web', 'sync', 'readSync.ts'),
    'utf8'
  );
  it('importe et appelle readDeltaFileFromCloud, avant le refus « gros fichier (multipart) »', () => {
    expect(src).toContain("import { readDeltaFileFromCloud } from './deltaRead';");
    const appel = src.indexOf('readDeltaFileFromCloud(cached.profileId, fileId, fekRaw)');
    const garde = src.indexOf('gros fichier (multipart');
    expect(appel).toBeGreaterThan(-1);
    expect(garde).toBeGreaterThan(-1);
    expect(appel).toBeLessThan(garde);
  });
});
