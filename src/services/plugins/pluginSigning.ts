/**
 * pluginSigning — la crypto de la place de marché, côté client. PUR (zéro
 * DOM, WebCrypto réel) — testable en vitest env node.
 *
 * LE MODÈLE. Le serveur est un relais d'octets réputé hostile : la seule
 * vérité est la signature Ed25519 de l'ÉDITEUR (identité de compte, E2-11)
 * posée sur les octets EXACTS de manifestJson — le hash du bundle vit DANS le
 * manifeste, une seule signature couvre tout. Le client vérifie à
 * l'installation ET à chaque chargement (IndexedDB est modifiable par toute
 * XSS ou tout processus local — un bundle stocké n'est jamais présumé intact).
 *
 * VERBATIM OU RIEN : manifestJson est une CHAÎNE de bout en bout (réseau, D1,
 * IndexedDB). Le parse n'arrive qu'APRÈS la vérification de signature — sinon
 * un JSON malveillant choisit ce que le parseur voit avant que la crypto ait
 * parlé.
 *
 * SUBSTITUTION FERMÉE : verifyInstalledPlugin exige manifest.id === slug
 * demandé ET manifest.version === version demandée — un serveur compromis ne
 * peut pas servir, sous le slug A, le manifeste validement signé du greffon B,
 * ni une ancienne version sous le nom d'une nouvelle. (Au premier install, la
 * garantie inter-éditeurs est le TOFU + l'empreinte affichée.)
 */

import { signWithIdentity, verifyWithIdentity, computeFingerprint } from '../auth/userKeypair';
import type { MarketplaceManifest } from './marketplaceTypes';

// MUST match infra/cloudflare-worker/src/marketplace.ts — le worker
// reconstruit IDENTITY_SIG_DOMAIN + PLUGIN_MANIFEST_DOMAIN + manifestJson ;
// ici signWithIdentity prépend LUI-MÊME le domaine identité, on ne passe que
// la partie greffon (motif device-wipes / wipe-ack).
export const PLUGIN_MANIFEST_DOMAIN = 'filarr.plugin.manifest.v1\n';

const ENC = new TextEncoder();

export type PluginVerifyErrorCode =
  | 'bad_signature'
  | 'bad_manifest'
  | 'manifest_mismatch'
  | 'hash_mismatch'
  | 'fingerprint_mismatch'
  | 'bad_trust'
  | 'publisher_key_changed'
  | 'version_rollback';

export class PluginVerifyError extends Error {
  code: PluginVerifyErrorCode;
  constructor(code: PluginVerifyErrorCode) {
    super(code);
    this.name = 'PluginVerifyError';
    this.code = code;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * UN SEUL JSON.stringify, au moment du publish — ces octets deviennent LA
 * vérité signée, jamais re-sérialisée ensuite.
 */
export function buildManifestJson(m: MarketplaceManifest): string {
  return JSON.stringify(m);
}

/**
 * Signe le manifeste avec la clé d'identité chargée. signWithIdentity prépend
 * le domaine identité et prend un keyAlgo optionnel (E2-10 : le jour où un
 * second algo existe, le passer ici) — aujourd'hui le défaut Ed25519 suffit.
 */
export async function signManifest(manifestJson: string): Promise<string> {
  return signWithIdentity(ENC.encode(PLUGIN_MANIFEST_DOMAIN + manifestJson));
}

/**
 * LA vérification — à l'installation ET à chaque chargement. Dans l'ordre (la
 * crypto parle avant le parseur, le parseur avant tout le reste) :
 *   1. signature Ed25519 sur les octets verbatim, contre la clé ÉPINGLÉE ;
 *   2. parse ;
 *   3. manifest.id/version === slug/version DEMANDÉS (anti-substitution) ;
 *   4. sha256(bundle) === manifest.bundleHash ;
 *   5. computeFingerprint(clé) === manifest.publisherFingerprint ;
 *   6. trust === 'sandboxed'.
 */
export async function verifyInstalledPlugin(p: {
  manifestJson: string;
  signature: string;
  signPublicKey: string;
  bundleBytes: Uint8Array;
  expected: { slug: string; version: string };
}): Promise<MarketplaceManifest> {
  const ok = await verifyWithIdentity(
    ENC.encode(PLUGIN_MANIFEST_DOMAIN + p.manifestJson),
    p.signature,
    p.signPublicKey
  );
  if (!ok) throw new PluginVerifyError('bad_signature');

  let parsed: unknown;
  try {
    parsed = JSON.parse(p.manifestJson);
  } catch {
    throw new PluginVerifyError('bad_manifest');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new PluginVerifyError('bad_manifest');
  const manifest = parsed as MarketplaceManifest;
  if (
    typeof manifest.id !== 'string' ||
    typeof manifest.version !== 'string' ||
    typeof manifest.name !== 'string' ||
    typeof manifest.bundleHash !== 'string' ||
    typeof manifest.publisherFingerprint !== 'string' ||
    !Array.isArray(manifest.extensions)
  ) {
    throw new PluginVerifyError('bad_manifest');
  }

  if (manifest.id !== p.expected.slug || manifest.version !== p.expected.version) {
    throw new PluginVerifyError('manifest_mismatch');
  }

  if ((await sha256Hex(p.bundleBytes)) !== manifest.bundleHash) {
    throw new PluginVerifyError('hash_mismatch');
  }

  if (
    (await computeFingerprint(base64ToBytes(p.signPublicKey))) !== manifest.publisherFingerprint
  ) {
    throw new PluginVerifyError('fingerprint_mismatch');
  }

  if (manifest.trust !== 'sandboxed') throw new PluginVerifyError('bad_trust');

  return manifest;
}
