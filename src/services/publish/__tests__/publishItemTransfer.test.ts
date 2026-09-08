/**
 * [C1] LA MIGRATION NE RESCELLE RIEN LOCALEMENT — le test le plus important
 * du parcours.
 *
 * CE QU'IL VERROUILLE, ET POURQUOI. L'implémentation précédente rescellait le
 * fichier LOCAL sous la clé entrante avant la bascule. Dès le premier élément
 * traité, une partie du coffre ne s'ouvrait plus qu'avec cette clé — que tous
 * les chemins de sortie autres que la réussite JETAIENT. Abandonner rendait
 * alors illisible tout ce qui avait été migré, et une simple indisponibilité du
 * trousseau suffisait à déclencher ce sort.
 *
 * Ces tests échouent si quiconque réintroduit une écriture dans le coffre sur
 * le chemin de migration — par le TYPE (le port du coffre n'a aucune méthode
 * d'écriture) et par le CONSTAT (les octets du coffre sont comparés avant/après,
 * y compris sur un abandon à mi-parcours).
 */

import crypto from 'crypto';
import { transferItem, type TransferPorts } from '../../../../electron/publish/itemTransfer';
import type { LedgerLine, PublishItem } from '../../../../electron/publish/types';
import { describe, it, expect } from 'vitest';

// ── Un coffre-jouet, en mémoire ─────────────────────────────────────────────

const ACTIVE_KEY = crypto.createHash('sha256').update('cle-active').digest();
const ACCOUNT_KEY = crypto.createHash('sha256').update('cle-du-compte').digest();

/** Scellement AES-256-GCM minimal — la forme du blob importe peu ici. */
function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

function open(key: Buffer, blob: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([decipher.update(blob.subarray(12, blob.length - 16)), decipher.final()]);
}

const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

interface World {
  /** Le coffre : chemin → octets. Aucun port n'a le droit d'y écrire. */
  vaultFiles: Map<string, Buffer>;
  /** Le répertoire de transport : tout ce qui a été écrit hors du coffre. */
  outboxFiles: Map<string, Buffer>;
  /** Chemins écrits, dans l'ordre — sert à prouver qu'aucun n'est du coffre. */
  writtenPaths: string[];
  /** Ce qui est parti sur le réseau : clé d'élément → octets envoyés. */
  uploaded: Map<string, Buffer>;
  ports: TransferPorts;
  /** Empreinte de TOUT le coffre — la comparaison avant/après. */
  vaultFingerprint(): string;
}

function makeWorld(
  files: Record<string, Buffer>,
  opts: { v3: Set<string> } = { v3: new Set() }
): World {
  const vaultFiles = new Map(Object.entries(files));
  const outboxFiles = new Map<string, Buffer>();
  const writtenPaths: string[] = [];
  const uploaded = new Map<string, Buffer>();

  const readVault = (p: string): Buffer => {
    const found = vaultFiles.get(p);
    if (!found) throw new Error(`ENOENT ${p}`);
    return found;
  };
  const readOutbox = (p: string): Buffer => {
    const found = outboxFiles.get(p);
    if (!found) throw new Error(`ENOENT ${p}`);
    return found;
  };

  const world: World = {
    vaultFiles,
    outboxFiles,
    writtenPaths,
    uploaded,
    vaultFingerprint: () =>
      [...vaultFiles.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([p, b]) => `${p}:${sha(b)}`)
        .join('|'),
    ports: {
      // ── LE PORT DU COFFRE : trois lectures, ZÉRO écriture ──
      vault: {
        isV3Container: async (p) => opts.v3.has(p),
        readAll: async (p) => readVault(p),
        sha256OfFile: async (p) => sha(readVault(p)),
      },
      outbox: {
        path: (name) => `/outbox/${name}`,
        transcodeFromVault: async (vaultPath, outPath) => {
          // « Transcodage » jouet : on ouvre sous la clé active, on rescelle
          // sous celle du compte — DANS L'OUTBOX, jamais dans le coffre.
          const plain = open(ACTIVE_KEY, readVault(vaultPath));
          outboxFiles.set(outPath, seal(ACCOUNT_KEY, plain));
          writtenPaths.push(outPath);
          return sha(plain);
        },
        plaintextShaUnderAccountKey: async (outPath) => sha(open(ACCOUNT_KEY, readOutbox(outPath))),
        write: async (outPath, data) => {
          outboxFiles.set(outPath, Buffer.from(data));
          writtenPaths.push(outPath);
        },
        remove: async (outPath) => {
          outboxFiles.delete(outPath);
        },
        sizeOf: async (outPath) => readOutbox(outPath).length,
        sha256OfFile: async (outPath) => sha(readOutbox(outPath)),
      },
      openRendererBlob: (blob) => open(ACTIVE_KEY, blob),
      sealRendererBlobForTransport: (plain) => seal(ACCOUNT_KEY, plain),
      openRendererBlobUnderAccountKey: (blob) => open(ACCOUNT_KEY, blob),
      sha256OfBuffer: (data) => sha(data),
      uploadFromPath: async (fileId, filePath) => {
        uploaded.set(fileId, Buffer.from(outboxFiles.get(filePath) ?? readVault(filePath)));
        return [`k/${fileId}/0`];
      },
      uploadFromBuffer: async (fileId, data) => {
        uploaded.set(fileId, Buffer.from(data));
        return [`k/${fileId}/0`];
      },
      multipartThreshold: 64 * 1024 * 1024,
      now: () => '2026-08-12T00:00:00.000Z',
    },
  };
  return world;
}

function item(patch: Partial<PublishItem> = {}): PublishItem {
  return {
    key: 'item-1',
    kind: 'blob',
    localProfileId: 'p1',
    localPath: 'f1/blob.bin',
    size: 32,
    updatedAt: '2026-08-01T00:00:00.000Z',
    keyClass: 'active',
    ...patch,
  };
}

// ── 1. La règle, tenue par le TYPE ─────────────────────────────────────────

describe('C1 — le port du coffre ne peut pas écrire', () => {
  it('n expose QUE des lectures : réintroduire un rescellement exigerait d y ajouter une méthode', () => {
    const world = makeWorld({});
    expect(Object.keys(world.ports.vault).sort()).toEqual([
      'isV3Container',
      'readAll',
      'sha256OfFile',
    ]);
  });
});

// ── 2. La règle, tenue par le CONSTAT ──────────────────────────────────────

describe('C1 — le coffre est strictement inchangé', () => {
  it('blob format renderer : rechiffré EN MÉMOIRE, envoyé, et le fichier local ne bouge pas', async () => {
    const original = seal(ACTIVE_KEY, Buffer.from('contenu de l utilisateur'));
    const world = makeWorld({ '/vault/p1/f1/blob.bin': original });
    const before = world.vaultFingerprint();

    const line = await transferItem(item(), '/vault/p1/f1/blob.bin', null, world.ports);

    expect(world.vaultFingerprint()).toBe(before);
    expect(world.vaultFiles.get('/vault/p1/f1/blob.bin')?.equals(original)).toBe(true);
    // Ce qui est PARTI est bien scellé sous la clé du compte…
    expect(open(ACCOUNT_KEY, world.uploaded.get('item-1') as Buffer).toString()).toBe(
      'contenu de l utilisateur'
    );
    // …et rien du tout n'a été écrit sur le disque : pas même un fichier de
    // transport, puisque le blob tenait en mémoire.
    expect(world.writtenPaths).toEqual([]);
    expect(line.s).toBe('done');
  });

  it('conteneur V3 : le fichier de transport vit dans l OUTBOX, jamais dans le coffre', async () => {
    const original = seal(ACTIVE_KEY, Buffer.from('un gros conteneur'));
    const world = makeWorld(
      { '/vault/p1/f1/big.v3': original },
      { v3: new Set(['/vault/p1/f1/big.v3']) }
    );
    const before = world.vaultFingerprint();

    await transferItem(
      item({ key: 'item-v3', localPath: 'f1/big.v3' }),
      '/vault/p1/f1/big.v3',
      null,
      world.ports
    );

    expect(world.vaultFingerprint()).toBe(before);
    // Tout ce qui a été écrit l'a été HORS du coffre…
    expect(world.writtenPaths.length).toBeGreaterThan(0);
    for (const p of world.writtenPaths) {
      expect(p.startsWith('/outbox/')).toBe(true);
      expect(world.vaultFiles.has(p)).toBe(false);
    }
    // …et le fichier de transport ne SURVIT pas : il est supprimé dès l'envoi.
    expect(world.outboxFiles.size).toBe(0);
  });

  it('LE TEST LE PLUS IMPORTANT — abandonner à mi-parcours laisse le coffre INTACT et lisible', async () => {
    const contents = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const files: Record<string, Buffer> = {};
    contents.forEach((c, i) => {
      files[`/vault/p1/f1/${i}.bin`] = seal(ACTIVE_KEY, Buffer.from(c));
    });
    const world = makeWorld(files);
    const before = world.vaultFingerprint();

    // On traite les trois premiers, puis on « abandonne » — c'est-à-dire qu'on
    // s'arrête net, sans le moindre geste de nettoyage.
    for (let i = 0; i < 3; i++) {
      await transferItem(
        item({ key: `item-${i}`, localPath: `f1/${i}.bin` }),
        `/vault/p1/f1/${i}.bin`,
        null,
        world.ports
      );
    }

    // Le coffre est OCTET POUR OCTET celui du départ.
    expect(world.vaultFingerprint()).toBe(before);
    // Et surtout : TOUT s'ouvre encore avec la clé ACTIVE, y compris ce qui
    // vient d'être migré. C'est ce que l'implémentation précédente perdait dès
    // le premier élément — et que l'abandon rendait définitif.
    contents.forEach((c, i) => {
      const blob = world.vaultFiles.get(`/vault/p1/f1/${i}.bin`) as Buffer;
      expect(open(ACTIVE_KEY, blob).toString()).toBe(c);
    });
  });

  it('élément illisible : `damaged`, et pas un octet touché', async () => {
    // Scellé sous une clé que personne ne détient : il était perdu AVANT la
    // migration, il l'est encore après, et ses octets restent où ils sont.
    const foreign = seal(crypto.randomBytes(32), Buffer.from('perdu'));
    const world = makeWorld({ '/vault/p1/f1/blob.bin': foreign });
    const before = world.vaultFingerprint();

    const line = await transferItem(item(), '/vault/p1/f1/blob.bin', null, world.ports);

    expect(line).toEqual({
      k: 'item-1',
      s: 'damaged',
      why: 'corrupt',
      t: '2026-08-12T00:00:00.000Z',
    });
    expect(world.vaultFingerprint()).toBe(before);
    expect(world.writtenPaths).toEqual([]);
    expect(world.uploaded.size).toBe(0);
  });
});

// ── 3. La ligne de registre, autosuffisante ────────────────────────────────

describe('la ligne de registre porte tout ce dont le manifeste et la preuve ont besoin', () => {
  it('UNE seule ligne `done`, avec ses empreintes de transport', async () => {
    const world = makeWorld({ '/vault/p1/f1/blob.bin': seal(ACTIVE_KEY, Buffer.from('x')) });
    const line = await transferItem(item(), '/vault/p1/f1/blob.bin', null, world.ports);

    // Le défaut fermé ici : la version précédente écrivait `uploaded` PUIS
    // `done`, et comme le registre ne retient que la DERNIÈRE ligne d'une clé,
    // la seconde effaçait `r`/`n`/`ch`/`ks`. Le manifeste naissait alors avec un
    // condensat vide, et la preuve le rejetait — à juste titre.
    expect(line.s).toBe('done');
    expect(typeof line.r).toBe('string');
    expect(typeof line.c).toBe('string');
    expect(line.n).toBeGreaterThan(0);
    expect(line.ch).toBe(1);
    expect(line.ks).toEqual(['k/item-1/0']);
  });

  it('un élément sous clé MACHINE part tel quel, sans empreinte de clair', async () => {
    const bytes = Buffer.from('v2:des octets de conteneur machine');
    const world = makeWorld({ '/vault/p1/f1/meta.json': bytes });
    const line = await transferItem(
      item({ key: 'meta:f1', kind: 'folder-meta', keyClass: 'machine', size: bytes.length }),
      '/vault/p1/f1/meta.json',
      null,
      world.ports
    );

    expect(line.s).toBe('done');
    // Pas de `c` : rien n'a été rechiffré, donc il n'y a pas d'empreinte de
    // clair à comparer entre appareils. En inventer une ferait boucler la
    // détection de changement du cycle ordinaire.
    expect(line.c).toBeUndefined();
    expect(world.uploaded.get('meta:f1')?.equals(bytes)).toBe(true);
  });

  it('une ligne `uploaded` HÉRITÉE se conclut sans réenvoyer', async () => {
    const world = makeWorld({ '/vault/p1/f1/blob.bin': seal(ACTIVE_KEY, Buffer.from('x')) });
    const previous: LedgerLine = {
      k: 'item-1',
      s: 'uploaded',
      c: 'clair',
      r: 'chiffre',
      n: 99,
      ch: 2,
      ks: ['a', 'b'],
      t: 't',
    };

    const line = await transferItem(item(), '/vault/p1/f1/blob.bin', previous, world.ports);

    expect(line).toEqual({
      k: 'item-1',
      s: 'done',
      c: 'clair',
      r: 'chiffre',
      n: 99,
      ch: 2,
      ks: ['a', 'b'],
      t: '2026-08-12T00:00:00.000Z',
    });
    expect(world.uploaded.size).toBe(0); // le transfert n'a PAS été repayé
  });
});
