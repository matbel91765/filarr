/**
 * installedPlugins — la chaîne installer/charger/vérifier, stockage et API
 * mockés (IndexedDB absent en env node), CRYPTO RÉELLE. Ce qui se prouve :
 *   · un record valide devient un éditeur bac à sable ACTIF (la convergence
 *     marketplace → registerSandboxedPlugin) ;
 *   · un record altéré (bundle, manifeste ou clé) → 'broken_signature',
 *     RIEN n'est enregistré au registre ;
 *   · TOFU : une mise à jour signée par une autre clé jette
 *     publisher_key_changed SANS écrire ; acceptNewPublisherKey ré-épingle ;
 *   · anti-rollback : une version plus ancienne jette version_rollback.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';

vi.mock('../pluginStorage', () => ({
  installedPluginsList: vi.fn(async () => []),
  installedPluginGet: vi.fn(async () => null),
  installedPluginPut: vi.fn(async () => {}),
  installedPluginDelete: vi.fn(async () => {}),
  installedPluginSetEnabled: vi.fn(async () => {}),
}));

vi.mock('../marketplaceApi', () => ({
  apiGetMarketplacePlugin: vi.fn(),
  apiDownloadPluginBundle: vi.fn(),
}));

import {
  generateAndWrapKeypair,
  clearUserKeypair,
  type GeneratedKeypair,
} from '../../auth/userKeypair';
import { buildManifestJson, signManifest, sha256Hex } from '../pluginSigning';
import type { MarketplaceManifest } from '../marketplaceTypes';
import * as storage from '../pluginStorage';
import * as api from '../marketplaceApi';
import { loadInstalledPlugins, installPlugin, uninstallPlugin } from '../installedPlugins';
import {
  __resetPluginRegistryForTests,
  editorForFileName,
  registerSandboxedPlugin,
  trustOfProvider,
} from '../pluginRegistry';
import type { InstalledPluginRecord } from '../pluginStorage';

const BUNDLE = new TextEncoder().encode('(()=>{ /* greffon */ })()');

let kp: GeneratedKeypair;

async function makeRecord(
  over: Partial<InstalledPluginRecord> = {}
): Promise<InstalledPluginRecord> {
  const manifest: MarketplaceManifest = {
    id: 'demo-pad',
    name: 'Bloc-notes',
    version: '1.0.0',
    description: '',
    extensions: ['sbx'],
    bundleHash: await sha256Hex(BUNDLE),
    publisherFingerprint: kp.fingerprint,
    trust: 'sandboxed',
  };
  const manifestJson = buildManifestJson(manifest);
  const bundleCopy = BUNDLE.slice();
  return {
    slug: 'demo-pad',
    installedVersion: '1.0.0',
    manifestJson,
    signature: await signManifest(manifestJson),
    pinnedSignPublicKey: kp.signPublicKey,
    publisherFingerprint: kp.fingerprint,
    bundle: bundleCopy.buffer,
    enabled: true,
    installedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

beforeAll(async () => {
  kp = await generateAndWrapKeypair('mot-de-passe-test');
});
afterAll(() => clearUserKeypair());

beforeEach(() => {
  vi.clearAllMocks();
  __resetPluginRegistryForTests();
});

describe('loadInstalledPlugins', () => {
  it('un record valide devient un éditeur bac à sable ACTIF, résolu par extension', async () => {
    vi.mocked(storage.installedPluginsList).mockResolvedValue([await makeRecord()]);
    const states = await loadInstalledPlugins('u1');
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe('active');
    expect(states[0].name).toBe('Bloc-notes');
    const provider = editorForFileName('essai.sbx');
    expect(provider).not.toBeNull();
    expect(trustOfProvider(provider!)).toBe('sandboxed');
  });

  it('un bundle altéré en IndexedDB → broken_signature, RIEN au registre', async () => {
    const rec = await makeRecord();
    new Uint8Array(rec.bundle)[0] ^= 1;
    vi.mocked(storage.installedPluginsList).mockResolvedValue([rec]);
    const states = await loadInstalledPlugins('u1');
    expect(states[0].status).toBe('broken_signature');
    expect(editorForFileName('essai.sbx')).toBeNull();
  });

  it('une clé épinglée substituée → broken_signature (la vérification se fait contre ELLE)', async () => {
    const autre = ed25519.utils.randomSecretKey();
    const rec = await makeRecord({
      pinnedSignPublicKey: btoa(String.fromCharCode(...ed25519.getPublicKey(autre))),
    });
    vi.mocked(storage.installedPluginsList).mockResolvedValue([rec]);
    const states = await loadInstalledPlugins('u1');
    expect(states[0].status).toBe('broken_signature');
  });

  it('désactivé → disabled, pas enregistré', async () => {
    vi.mocked(storage.installedPluginsList).mockResolvedValue([
      await makeRecord({ enabled: false }),
    ]);
    const states = await loadInstalledPlugins('u1');
    expect(states[0].status).toBe('disabled');
    expect(editorForFileName('essai.sbx')).toBeNull();
  });
});

describe('installPlugin — TOFU et anti-rollback', () => {
  async function serveVersion(version: string, signerKp?: { json?: string }) {
    const manifest: MarketplaceManifest = {
      id: 'demo-pad',
      name: 'Bloc-notes',
      version,
      description: '',
      extensions: ['sbx'],
      bundleHash: await sha256Hex(BUNDLE),
      publisherFingerprint: kp.fingerprint,
      trust: 'sandboxed',
    };
    const manifestJson = signerKp?.json ?? buildManifestJson(manifest);
    vi.mocked(api.apiGetMarketplacePlugin).mockResolvedValue({
      slug: 'demo-pad',
      name: 'Bloc-notes',
      description: '',
      latestVersion: version,
      publisherFingerprint: kp.fingerprint,
      downloads: 0,
      status: 'published',
      updatedAt: '',
      ownedByMe: false,
      versions: [
        {
          version,
          manifestJson,
          signature: await signManifest(manifestJson),
          signPublicKey: kp.signPublicKey,
          bundleHash: await sha256Hex(BUNDLE),
          sizeBytes: BUNDLE.byteLength,
          createdAt: '',
        },
      ],
    });
    vi.mocked(api.apiDownloadPluginBundle).mockResolvedValue(BUNDLE.slice());
  }

  it('installe, épingle la clé, enregistre — le record écrit porte la clé du serveur', async () => {
    await serveVersion('1.0.0');
    const state = await installPlugin('u1', 'demo-pad', '1.0.0');
    expect(state.status).toBe('active');
    const rec = vi.mocked(storage.installedPluginPut).mock.calls[0][1];
    expect(rec.pinnedSignPublicKey).toBe(kp.signPublicKey);
  });

  it('mise à jour signée par une AUTRE clé → publisher_key_changed SANS écriture ; le geste explicite ré-épingle', async () => {
    await serveVersion('2.0.0');
    const autrePin = btoa(
      String.fromCharCode(...ed25519.getPublicKey(ed25519.utils.randomSecretKey()))
    );
    vi.mocked(storage.installedPluginGet).mockResolvedValue(
      await makeRecord({ pinnedSignPublicKey: autrePin })
    );

    await expect(installPlugin('u1', 'demo-pad', '2.0.0')).rejects.toMatchObject({
      code: 'publisher_key_changed',
    });
    expect(storage.installedPluginPut).not.toHaveBeenCalled();

    const state = await installPlugin('u1', 'demo-pad', '2.0.0', { acceptNewPublisherKey: true });
    expect(state.status).toBe('active');
    const rec = vi.mocked(storage.installedPluginPut).mock.calls[0][1];
    expect(rec.pinnedSignPublicKey).toBe(kp.signPublicKey); // ré-épinglée
  });

  it('une version PLUS ANCIENNE → version_rollback sauf geste explicite', async () => {
    await serveVersion('0.9.0');
    vi.mocked(storage.installedPluginGet).mockResolvedValue(await makeRecord());
    await expect(installPlugin('u1', 'demo-pad', '0.9.0')).rejects.toMatchObject({
      code: 'version_rollback',
    });
    const state = await installPlugin('u1', 'demo-pad', '0.9.0', { allowRollback: true });
    expect(state.status).toBe('active');
  });

  it('un manifeste servi sous le mauvais slug → manifest_mismatch, rien d’écrit', async () => {
    await serveVersion('1.0.0');
    // Le serveur ment : la version existe mais son manifeste dit un autre id.
    const menteur = await api.apiGetMarketplacePlugin('demo-pad');
    const evil: MarketplaceManifest = {
      ...(JSON.parse(menteur.versions[0].manifestJson) as MarketplaceManifest),
      id: 'autre-greffon',
    };
    const evilJson = buildManifestJson(evil);
    menteur.versions[0].manifestJson = evilJson;
    menteur.versions[0].signature = await signManifest(evilJson);
    vi.mocked(api.apiGetMarketplacePlugin).mockResolvedValue(menteur);

    await expect(installPlugin('u1', 'demo-pad', '1.0.0')).rejects.toMatchObject({
      code: 'manifest_mismatch',
    });
    expect(storage.installedPluginPut).not.toHaveBeenCalled();
  });
});

describe("le statut 'active' se lit dans le REGISTRE, jamais dans un message", () => {
  it('un rechargement d’écran retrouve « actif » — le plugin sert bien ses extensions', async () => {
    vi.mocked(storage.installedPluginsList).mockResolvedValue([await makeRecord()]);
    expect((await loadInstalledPlugins('u1'))[0].status).toBe('active');
    // Deuxième passage : registerSandboxedPlugin jette « already registered ».
    // Le verdict ne vient PAS de cette phrase mais de l'état réel du registre.
    const états = await loadInstalledPlugins('u1');
    expect(états[0].status).toBe('active');
    expect(editorForFileName('essai.sbx')).not.toBeNull();
  });

  it('un id déjà pris par un AUTRE plugin → register_failed, pas « actif » par accident', async () => {
    /**
     * Le même id, un autre code, d'autres extensions : le registre refuse avec
     * le message « already registered » — et l'ancienne lecture par
     * `message.includes` en concluait « actif », affichant vert un plugin dont
     * PAS UNE extension ne résolvait vers lui.
     */
    registerSandboxedPlugin({
      manifest: {
        id: 'demo-pad',
        name: 'Un imposteur',
        version: '9.9.9',
        trust: 'sandboxed',
        provides: { editors: [{ id: 'x', extensions: ['autre'], displayName: 'x' }] },
      },
      code: '(()=>{})()',
    });

    vi.mocked(storage.installedPluginsList).mockResolvedValue([await makeRecord()]);
    const états = await loadInstalledPlugins('u1');
    expect(états[0].status).toBe('register_failed');
    expect(editorForFileName('essai.sbx')).toBeNull();
  });
});

describe('uninstallPlugin', () => {
  it('retire le record ET le registre — l’extension ne résout plus', async () => {
    vi.mocked(storage.installedPluginsList).mockResolvedValue([await makeRecord()]);
    await loadInstalledPlugins('u1');
    expect(editorForFileName('essai.sbx')).not.toBeNull();

    await uninstallPlugin('u1', 'demo-pad');
    expect(storage.installedPluginDelete).toHaveBeenCalledWith('u1', 'demo-pad');
    expect(editorForFileName('essai.sbx')).toBeNull();
  });
});
