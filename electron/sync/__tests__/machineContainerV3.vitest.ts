/**
 * machineContainerV3.vitest.ts — Le conteneur `v3:` reproduit les vecteurs À
 * L'OCTET, refuse tout ce qui n'est pas lui, et le drapeau d'écriture dit ce
 * qu'il dit.
 *
 * Les vecteurs viennent de `test-vectors/machine-container-v3.json`, écrits par
 * une implémentation de référence INDÉPENDANTE (scripts/gen-machine-container-v3-vectors.mjs,
 * node:crypto nu). Deux implémentations qui s'accordent sur les mêmes octets
 * valent mieux qu'un aller-retour d'un module avec lui-même — et ce sont ces
 * mêmes vecteurs que le web et le mobile doivent reproduire.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as crypto from 'node:crypto';
import {
  ERR_MACHINE_V3_MALFORMED,
  MACHINE_MARKER_V3,
  MACHINE_V3_FLAG,
  MACHINE_V3_HKDF_INFO,
  deriveMachineKeyV3,
  isMachineV3WriteEnabled,
  machineContainerNeedsRewrite,
  setServerMachineV3Write,
  machineWriteVersion,
  openMachineV3Bytes,
  openMachineV3Text,
  sealMachineV3Bytes,
  sealMachineV3Text,
} from '../../machineContainerV3';

interface Vecteur {
  name: string;
  kind: 'text' | 'binary';
  saltHex: string;
  ivHex: string;
  derivedKeyHex: string;
  plaintext?: string;
  plaintextHex?: string;
  container?: string;
  containerHex?: string;
}
interface Pack {
  machineKeyHex: string;
  info: string;
  vectors: Vecteur[];
  negatives: Array<{ name: string; container: string; expect: 'reject' }>;
}

const PACK = JSON.parse(
  readFileSync(join(process.cwd(), 'test-vectors', 'machine-container-v3.json'), 'utf8')
) as Pack;
const KEY = Buffer.from(PACK.machineKeyHex, 'hex');
const hx = (h: string) => Buffer.from(h, 'hex');

describe('vecteurs partagés — reproduits à l’octet', () => {
  it('le contexte HKDF est celui du contrat', () => {
    expect(PACK.info).toBe(MACHINE_V3_HKDF_INFO);
    expect(MACHINE_V3_HKDF_INFO).toBe('filarr-container-v3');
  });

  for (const v of PACK.vectors) {
    it(`${v.name} — clé dérivée, scellement, ouverture`, () => {
      const salt = hx(v.saltHex);
      const iv = hx(v.ivHex);
      expect(deriveMachineKeyV3(KEY, salt).toString('hex')).toBe(v.derivedKeyHex);
      if (v.kind === 'text') {
        const container = sealMachineV3Text(KEY, v.plaintext!, { salt, iv });
        expect(container).toBe(v.container);
        expect(openMachineV3Text(KEY, v.container!).toString('utf8')).toBe(v.plaintext);
      } else {
        const container = sealMachineV3Bytes(KEY, hx(v.plaintextHex!), { salt, iv });
        expect(container.toString('hex')).toBe(v.containerHex);
        expect(openMachineV3Bytes(KEY, hx(v.containerHex!)).toString('hex')).toBe(v.plaintextHex);
      }
    });
  }

  for (const n of PACK.negatives) {
    it(`négatif — ${n.name}`, () => {
      // Un `v2:` n'est pas un `v3:`, un tag altéré ne passe pas, un corps trop
      // court non plus : dans tous les cas, exception — jamais un clair douteux.
      expect(() => openMachineV3Text(KEY, n.container)).toThrow();
    });
  }
});

describe('scellement / ouverture', () => {
  it('aller-retour texte et binaire avec un nonce frais, clair vide compris', () => {
    const t = sealMachineV3Text(KEY, JSON.stringify({ a: 1, e: 'été' }));
    expect(t.startsWith(MACHINE_MARKER_V3)).toBe(true);
    expect(JSON.parse(openMachineV3Text(KEY, t).toString('utf8'))).toEqual({ a: 1, e: 'été' });

    const b = sealMachineV3Bytes(KEY, Buffer.from([1, 2, 3]));
    expect(openMachineV3Bytes(KEY, b)).toEqual(Buffer.from([1, 2, 3]));

    const vide = sealMachineV3Bytes(KEY, Buffer.alloc(0));
    expect(openMachineV3Bytes(KEY, vide)).toEqual(Buffer.alloc(0));
  });

  it('deux scellements du même clair diffèrent (sel et IV frais) mais s’ouvrent tous deux', () => {
    const a = sealMachineV3Text(KEY, '{"x":1}');
    const b = sealMachineV3Text(KEY, '{"x":1}');
    expect(a).not.toBe(b);
    expect(openMachineV3Text(KEY, a).toString()).toBe('{"x":1}');
    expect(openMachineV3Text(KEY, b).toString()).toBe('{"x":1}');
  });

  it('un `v2:` (PBKDF2) relabellisé `v3:` échoue au tag — le marqueur est lié par la dérivation', () => {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const k2 = crypto.pbkdf2Sync(KEY, salt, 600000, 32, 'sha512');
    const c = crypto.createCipheriv('aes-256-gcm', k2, iv);
    const ct = Buffer.concat([c.update('{"v":2}', 'utf8'), c.final()]);
    const v2 = 'v2:' + salt.toString('hex') + iv.toString('hex') + ct.toString('hex') + c.getAuthTag().toString('hex');
    expect(() => openMachineV3Text(KEY, 'v3:' + v2.slice(3))).toThrow();
  });

  it('une autre clé machine, un octet du chiffré altéré, un hex impair : refusés', () => {
    const t = sealMachineV3Text(KEY, '{"secret":true}');
    const autre = crypto.randomBytes(32);
    expect(() => openMachineV3Text(autre, t)).toThrow();
    const corps = t.slice(3);
    const pos = 64 + 4; // dans le chiffré (après sel et IV)
    const altere = corps.slice(0, pos) + (corps[pos] === '0' ? '1' : '0') + corps.slice(pos + 1);
    expect(() => openMachineV3Text(KEY, 'v3:' + altere)).toThrow();
    expect(() => openMachineV3Text(KEY, 'v3:' + corps.slice(1))).toThrow(ERR_MACHINE_V3_MALFORMED);
    expect(() => openMachineV3Text(KEY, 'v2:' + corps)).toThrow(ERR_MACHINE_V3_MALFORMED);
  });

  it('un sel qui n’a pas 16 octets est refusé à la dérivation', () => {
    expect(() => deriveMachineKeyV3(KEY, Buffer.alloc(12))).toThrow(/16/);
    expect(() => deriveMachineKeyV3(Buffer.alloc(0), Buffer.alloc(16))).toThrow(/vide/);
  });
});

describe('le drapeau FILARR_MACHINE_CONTAINER_V3', () => {
  const avant = process.env[MACHINE_V3_FLAG];
  afterEach(() => {
    if (avant === undefined) delete process.env[MACHINE_V3_FLAG];
    else process.env[MACHINE_V3_FLAG] = avant;
  });
  const pose = (v: string | undefined) => {
    if (v === undefined) delete process.env[MACHINE_V3_FLAG];
    else process.env[MACHINE_V3_FLAG] = v;
  };

  it('absent, vide ou inconnu : rien ne s’écrit en v3', () => {
    for (const v of [undefined, '', '0', 'oui', 'v3']) {
      pose(v);
      expect(isMachineV3WriteEnabled('notes')).toBe(false);
      expect(isMachineV3WriteEnabled('all')).toBe(false);
      expect(machineWriteVersion('notes')).toBe('v2');
    }
  });

  it('`notes` n’allume que le coffre de notes', () => {
    pose('notes');
    expect(isMachineV3WriteEnabled('notes')).toBe(true);
    expect(isMachineV3WriteEnabled('all')).toBe(false);
    expect(machineWriteVersion('notes')).toBe('v3');
    expect(machineWriteVersion('all')).toBe('v2');
  });

  it('`1`, `true`, `all` (et la casse) allument tout', () => {
    for (const v of ['1', 'true', 'all', 'TRUE', ' All ']) {
      pose(v);
      expect(isMachineV3WriteEnabled('notes')).toBe(true);
      expect(isMachineV3WriteEnabled('all')).toBe(true);
    }
  });

  it('réécriture : jamais de rétrogradation, toujours la montée depuis v1 / sans marqueur', () => {
    pose(undefined);
    expect(machineContainerNeedsRewrite('v3:abcd')).toBe(false);
    expect(machineContainerNeedsRewrite('v2:abcd')).toBe(false);
    expect(machineContainerNeedsRewrite('v1:abcd')).toBe(true);
    expect(machineContainerNeedsRewrite('abcdef')).toBe(true);
    expect(machineContainerNeedsRewrite(Buffer.from('v3:xyz'))).toBe(false);
    pose('notes');
    expect(machineContainerNeedsRewrite('v2:abcd', 'notes')).toBe(true);
    expect(machineContainerNeedsRewrite('v2:abcd', 'all')).toBe(false);
    expect(machineContainerNeedsRewrite('v3:abcd', 'notes')).toBe(false);
    pose('all');
    expect(machineContainerNeedsRewrite('v2:abcd')).toBe(true);
    expect(machineContainerNeedsRewrite('v3:abcd')).toBe(false);
  });
});

describe('l’interrupteur SERVEUR (capabilities.machineContainerV3Write)', () => {
  const avant = process.env[MACHINE_V3_FLAG];
  afterEach(() => {
    setServerMachineV3Write(false);
    if (avant === undefined) delete process.env[MACHINE_V3_FLAG];
    else process.env[MACHINE_V3_FLAG] = avant;
  });

  it('allumé par le serveur, on écrit v3 partout — même sans variable d’environnement', () => {
    delete process.env[MACHINE_V3_FLAG];
    setServerMachineV3Write(true);
    expect(isMachineV3WriteEnabled('notes')).toBe(true);
    expect(isMachineV3WriteEnabled('all')).toBe(true);
    expect(machineWriteVersion('all')).toBe('v3');
    expect(machineContainerNeedsRewrite('v2:abcd')).toBe(true);
    expect(machineContainerNeedsRewrite('v3:abcd')).toBe(false);
  });

  it('éteint par le serveur, la variable d’environnement reprend la main ; rien → v2', () => {
    setServerMachineV3Write(true);
    setServerMachineV3Write(false);
    delete process.env[MACHINE_V3_FLAG];
    expect(isMachineV3WriteEnabled('all')).toBe(false);
    process.env[MACHINE_V3_FLAG] = 'notes';
    expect(isMachineV3WriteEnabled('notes')).toBe(true);
    expect(isMachineV3WriteEnabled('all')).toBe(false);
  });
});
