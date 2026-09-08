/**
 * Validation du déchiffrement des conteneurs de sync contre le pack de
 * vecteurs dorés (`filarr-mobile/spec/golden-vectors.json`) — le CONTRAT DE
 * FORMAT inter-plateformes. Chaque octet de ces vecteurs sort des écrivains
 * de production desktop ; si ce test passe, le lecteur web est compatible.
 *
 * Le pack vit dans le dépôt frère : si absent sur la machine de CI, la suite
 * est SKIPPÉE avec un avertissement — jamais un faux vert silencieux.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decryptFekContainer,
  decryptMachineContainerBinary,
  decryptMachineContainerText,
  decryptV3Buffer,
} from '../containerCrypto';

const PACK_PATH = 'c:/Users/Mathis/Documents/Dev_General/filarr-mobile/spec/golden-vectors.json';
const packAvailable = existsSync(PACK_PATH);

interface PackCase {
  id: string;
  key?: string;
  plaintextSha256: string;
  ciphertext: string;
  variant?: string;
  format?: string;
  plaintextUtf8?: string;
  plaintext?: string;
}

const pack = packAvailable
  ? (JSON.parse(readFileSync(PACK_PATH, 'utf8')) as {
      key: { hex: string };
      cases: PackCase[];
      manifests: { cases: PackCase[] };
      machineContainers: { keyOfThisPack: { hex: string }; cases: PackCase[] };
    })
  : null;

const hexToBytes = (h: string) =>
  new Uint8Array((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const b64ToBytes = (b: string) => Uint8Array.from(Buffer.from(b, 'base64'));

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

describe.skipIf(!packAvailable)('conteneurs de sync vs vecteurs dorés', () => {
  it('manifestes fek:/fkz: — tous les cas déchiffrent à l’octet près', async () => {
    for (const c of pack!.manifests.cases) {
      const fek = hexToBytes(c.key ?? pack!.key.hex);
      const plain = await decryptFekContainer(b64ToBytes(c.ciphertext), fek);
      expect(await sha256Hex(plain), c.id).toBe(c.plaintextSha256);
    }
  });

  it('conteneurs clé machine — texte hex (v2:/v1:/sans marqueur) et binaire', async () => {
    const machineKey = hexToBytes(pack!.machineContainers.keyOfThisPack.hex);
    for (const c of pack!.machineContainers.cases) {
      if (c.variant === 'text-hex') {
        const container = Buffer.from(c.ciphertext, 'base64').toString('utf8');
        const obj = await decryptMachineContainerText(container, machineKey);
        expect(obj, c.id).toBeTruthy();
        if (c.plaintextUtf8) {
          // Égalité STRUCTURELLE avec le clair de référence de l'écrivain desktop.
          expect(obj, c.id).toEqual(JSON.parse(c.plaintextUtf8));
        }
      } else {
        const plain = await decryptMachineContainerBinary(b64ToBytes(c.ciphertext), machineKey);
        expect(await sha256Hex(plain), c.id).toBe(c.plaintextSha256);
      }
    }
  });

  it('blobs V3 — les 8 cas whole-buffer déchiffrent à l’octet près', async () => {
    for (const c of pack!.cases.filter((x) => x.format === 'V3')) {
      const fek = hexToBytes(c.key ?? pack!.key.hex);
      const plain = await decryptV3Buffer(b64ToBytes(c.ciphertext), fek);
      expect(await sha256Hex(plain), c.id).toBe(c.plaintextSha256);
    }
  });

  it('V3 négatifs — troncature/version/réservé/chunks échangés sont rejetés', async () => {
    const packFull = JSON.parse(readFileSync(PACK_PATH, 'utf8')) as {
      key: { hex: string };
      cases: Array<{ id: string; ciphertext: string }>;
      negativeCases: Array<{
        id: string;
        baseCase: string;
        key: string;
        mutations: Array<{ op: string; offset?: number; value?: number; [k: string]: unknown }>;
      }>;
    };
    for (const n of packFull.negativeCases.filter((x) => x.id.startsWith('neg-v3'))) {
      const base = packFull.cases.find((c) => c.id === n.baseCase);
      if (!base) continue;
      let blob = b64ToBytes(base.ciphertext);
      let supported = true;
      for (const m of n.mutations) {
        if (m.op === 'setByte' && typeof m.offset === 'number' && typeof m.value === 'number') {
          blob[m.offset] = m.value;
        } else if (m.op === 'truncate' && typeof (m as { length?: number }).length === 'number') {
          blob = blob.subarray(0, (m as unknown as { length: number }).length);
        } else if (m.op === 'swapRanges') {
          const { a, b } = m as unknown as {
            a: { offset: number; length: number };
            b: { offset: number; length: number };
          };
          const tmpA = blob.slice(a.offset, a.offset + a.length);
          const tmpB = blob.slice(b.offset, b.offset + b.length);
          blob.set(tmpB, a.offset);
          blob.set(tmpA, b.offset);
        } else {
          supported = false;
        }
      }
      if (!supported) continue;
      await expect(decryptV3Buffer(blob, hexToBytes(n.key)), n.id).rejects.toThrow();
    }
  });
});

// ── Conteneur clé machine v3 (HKDF) — vecteurs partagés bureau/web/mobile ────
//
// Contrat gelé le 2026-09-05 (fiche conteneur-machine-v3-hkdf) : disposition de
// `v2:`, clé HKDF-SHA-256(clé machine, sel, "filarr-container-v3", 32). Les
// vecteurs sont ceux que le bureau reproduit à l'octet ; ici on prouve que le
// web les OUVRE, texte et binaire, et refuse les négatifs.

import { readFileSync as lireVecteurs } from 'node:fs';
import { join as joindre } from 'node:path';
import {
  decryptMachineContainerBinary as ouvreMachineBinaire,
  decryptMachineContainerText as ouvreMachineTexte,
  isMachineBinaryContainer as estConteneurMachine,
} from '../containerCrypto';

describe('conteneur clé machine v3 — le web lit ce que le bureau scelle', () => {
  const pack = JSON.parse(
    lireVecteurs(joindre(process.cwd(), 'test-vectors', 'machine-container-v3.json'), 'utf8')
  ) as {
    machineKeyHex: string;
    vectors: Array<{
      name: string;
      kind: 'text' | 'binary';
      plaintext?: string;
      plaintextHex?: string;
      container?: string;
      containerHex?: string;
    }>;
    negatives: Array<{ name: string; container: string }>;
  };
  const versOctets = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
  const cle = versOctets(pack.machineKeyHex);

  for (const v of pack.vectors) {
    it(`ouvre « ${v.name} »`, async () => {
      if (v.kind === 'text') {
        expect(await ouvreMachineTexte(v.container!, cle)).toEqual(JSON.parse(v.plaintext!));
      } else {
        const octets = versOctets(v.containerHex!);
        expect(estConteneurMachine(octets)).toBe(true);
        expect(Buffer.from(await ouvreMachineBinaire(octets, cle)).toString('hex')).toBe(
          v.plaintextHex
        );
      }
    });
  }

  for (const n of pack.negatives) {
    it(`refuse — ${n.name}`, async () => {
      await expect(ouvreMachineTexte(n.container, cle)).rejects.toThrow();
    });
  }

  it('une autre clé machine ne lit rien', async () => {
    const autre = new Uint8Array(32).fill(7);
    await expect(ouvreMachineTexte(pack.vectors[0].container!, autre)).rejects.toThrow();
  });
});
