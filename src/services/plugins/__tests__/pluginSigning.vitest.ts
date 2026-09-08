/**
 * pluginSigning — la crypto marketplace côté client, WebCrypto réel (env
 * node). Ce qui se prouve, dans l'ordre où ça saignerait :
 *   · l'aller-retour sign → verify tient sur les octets VERBATIM, et le même
 *     JSON re-sérialisé (ordre de clés différent) est refusé ;
 *   · la substitution serveur est fermée : slug ou version qui ne correspond
 *     pas à la demande → manifest_mismatch, même signature valide ;
 *   · le test de CONCORDANCE DE DOMAINE : les octets signés côté client
 *     vérifient contre la reconstruction du WORKER (recopiée ici) — le test
 *     qui casse si un des deux domaines dérive.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  generateAndWrapKeypair,
  clearUserKeypair,
  type GeneratedKeypair,
} from '../../auth/userKeypair';
import {
  PLUGIN_MANIFEST_DOMAIN,
  buildManifestJson,
  signManifest,
  sha256Hex,
  verifyInstalledPlugin,
  PluginVerifyError,
} from '../pluginSigning';
import type { MarketplaceManifest } from '../marketplaceTypes';
import { compareSemver } from '../marketplaceTypes';

const BUNDLE = new Uint8Array([40, 102, 117, 110, 99, 41, 40, 41]);

let kp: GeneratedKeypair;
let manifest: MarketplaceManifest;
let manifestJson: string;
let signature: string;

beforeAll(async () => {
  kp = await generateAndWrapKeypair('mot-de-passe-test');
  manifest = {
    id: 'demo-pad',
    name: 'Bloc-notes démo',
    version: '1.2.3',
    description: 'Un éditeur',
    extensions: ['sbx'],
    bundleHash: await sha256Hex(BUNDLE),
    publisherFingerprint: kp.fingerprint,
    trust: 'sandboxed',
  };
  manifestJson = buildManifestJson(manifest);
  signature = await signManifest(manifestJson);
});

afterAll(() => clearUserKeypair());

const verify = (over: Partial<Parameters<typeof verifyInstalledPlugin>[0]> = {}) =>
  verifyInstalledPlugin({
    manifestJson,
    signature,
    signPublicKey: kp.signPublicKey,
    bundleBytes: BUNDLE,
    expected: { slug: 'demo-pad', version: '1.2.3' },
    ...over,
  });

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof PluginVerifyError ? e.code : 'NOT_A_VERIFY_ERROR';
  }
};

describe('aller-retour', () => {
  it('sign → verify rend le manifeste parsé', async () => {
    const m = await verify();
    expect(m.id).toBe('demo-pad');
    expect(m.extensions).toEqual(['sbx']);
  });

  it('le même JSON RE-SÉRIALISÉ (ordre de clés inversé) → bad_signature — le verbatim est le contrat', async () => {
    const reordered: Record<string, unknown> = {};
    for (const k of Object.keys(manifest).reverse())
      reordered[k] = (manifest as unknown as Record<string, unknown>)[k];
    expect(await codeOf(verify({ manifestJson: JSON.stringify(reordered) }))).toBe('bad_signature');
  });
});

describe('altérations', () => {
  it('un octet du bundle qui bouge → hash_mismatch', async () => {
    const tampered = BUNDLE.slice();
    tampered[0] ^= 1;
    expect(await codeOf(verify({ bundleBytes: tampered }))).toBe('hash_mismatch');
  });

  it('une signature d’une AUTRE clé → bad_signature', async () => {
    const autre = ed25519.utils.randomSecretKey();
    const autrePub = btoa(String.fromCharCode(...ed25519.getPublicKey(autre)));
    expect(await codeOf(verify({ signPublicKey: autrePub }))).toBe('bad_signature');
  });

  it('empreinte étrangère DANS le manifeste signé → fingerprint_mismatch', async () => {
    const evil = { ...manifest, publisherFingerprint: '11111 22222 33333 44444 55555 66666' };
    const json = buildManifestJson(evil);
    const sig = await signManifest(json);
    expect(await codeOf(verify({ manifestJson: json, signature: sig }))).toBe(
      'fingerprint_mismatch'
    );
  });

  it("trust 'builtin' même validement signé → bad_trust", async () => {
    const evil = { ...manifest, trust: 'builtin' as unknown as 'sandboxed' };
    const json = buildManifestJson(evil);
    const sig = await signManifest(json);
    expect(await codeOf(verify({ manifestJson: json, signature: sig }))).toBe('bad_trust');
  });
});

describe('anti-substitution serveur (manifest_mismatch)', () => {
  it('le manifeste validement signé du greffon B servi sous le slug A est refusé', async () => {
    expect(await codeOf(verify({ expected: { slug: 'autre-greffon', version: '1.2.3' } }))).toBe(
      'manifest_mismatch'
    );
  });

  it('une ANCIENNE version servie sous le nom d’une nouvelle est refusée', async () => {
    expect(await codeOf(verify({ expected: { slug: 'demo-pad', version: '9.9.9' } }))).toBe(
      'manifest_mismatch'
    );
  });
});

describe('concordance de domaine client↔worker', () => {
  it('les octets signés par signManifest vérifient contre la reconstruction du worker', async () => {
    // Recopie EXACTE de buildPluginManifestSignedBytes
    // (infra/cloudflare-worker/src/marketplace.ts) — si un des deux domaines
    // dérive, ce test casse.
    const workerBytes = new TextEncoder().encode(
      `filarr.identity.sig.v1\n${'filarr.plugin.manifest.v1\n'}${manifestJson}`
    );
    expect(PLUGIN_MANIFEST_DOMAIN).toBe('filarr.plugin.manifest.v1\n');
    const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    const pubBytes = Uint8Array.from(atob(kp.signPublicKey), (c) => c.charCodeAt(0));
    expect(ed25519.verify(sigBytes, workerBytes, pubBytes)).toBe(true);
  });
});

describe('compareSemver', () => {
  it('ordonne correctement (badge de mise à jour + anti-rollback)', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.10.0')).toBeLessThan(0);
  });
});
