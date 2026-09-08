/**
 * installedPlugins — installer, charger, vérifier À CHAQUE FOIS.
 *
 * La chaîne complète : catalogue → téléchargement → verifyInstalledPlugin
 * (signature verbatim + anti-substitution slug/version + hash + empreinte +
 * trust) → TOFU (la clé épinglée arbitre, jamais d'écrasement silencieux) →
 * IndexedDB → registerSandboxedPlugin (le bundle reste une CHAÎNE côté hôte,
 * exécutée uniquement dans l'iframe bac à sable).
 *
 * AUCUN eval/import()/new Function ici — l'exécution est l'affaire exclusive
 * du bac à sable (sandboxHost.ts). Ce module vérifie, range, enregistre.
 *
 * Au chargement, la vérification se fait contre la clé ÉPINGLÉE du record —
 * une écriture IndexedDB directe (XSS, processus local) qui altère bundle,
 * manifeste ou clé rend le greffon 'broken_signature' : rien n'est enregistré.
 */

import {
  editorsForFileName,
  registerSandboxedPlugin,
  unregisterSandboxedPlugin,
  listPlugins,
  editorForFileName,
  PluginRegistrationError,
} from './pluginRegistry';
import type { FilarrPluginManifest } from './pluginTypes';
import { verifyInstalledPlugin, PluginVerifyError } from './pluginSigning';
import {
  installedPluginsList,
  installedPluginGet,
  installedPluginPut,
  installedPluginDelete,
  installedPluginSetEnabled,
  type InstalledPluginRecord,
} from './pluginStorage';
import { apiGetMarketplacePlugin, apiDownloadPluginBundle } from './marketplaceApi';
import {
  compareSemver,
  type InstalledPluginStatus,
  type MarketplaceManifest,
} from './marketplaceTypes';

export interface LoadedPluginState {
  slug: string;
  name: string;
  installedVersion: string;
  enabled: boolean;
  status: InstalledPluginStatus;
  publisherFingerprint: string;
}

/** Le manifeste du registre, synthétisé depuis le manifeste marketplace
 *  VÉRIFIÉ. L'id de contribution est stable ; displayName = le nom publié. */
function toRegistryManifest(m: MarketplaceManifest): FilarrPluginManifest {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    trust: 'sandboxed',
    provides: {
      editors: [
        {
          id: `${m.id}-editor`,
          extensions: m.extensions,
          displayName: m.name,
        },
      ],
    },
  };
}

function decodeBundle(bundle: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(bundle));
}

/**
 * CE greffon, dans CETTE version, sert-il RÉELLEMENT ses extensions ?
 *
 * POURQUOI PAS `message.includes('already registered')`. Un statut de sécurité
 * ne se lit pas dans une phrase anglaise : renommer le message du registre
 * (ou le traduire) aurait fait passer un greffon en 'active' — ou l'inverse —
 * sans qu'aucun test ne bronche. Pire, la phrase couvrait aussi le cas où un
 * greffon du MÊME id mais d'une AUTRE version occupait la place : l'UI
 * annonçait « actif » pour du code qui n'était pas celui du record. On
 * interroge donc l'état réel : le greffon est là, dans la bonne version, et
 * chacune de ses extensions résout vers UN DE SES providers.
 */
function isRegisteredAndServing(m: MarketplaceManifest): boolean {
  const plugin = listPlugins().find((p) => p.manifest.id === m.id);
  if (!plugin || plugin.manifest.trust !== 'sandboxed') return false;
  if (plugin.manifest.version !== m.version) return false;
  const owned = new Set(plugin.editors ?? []);
  // `editorsForFileName` et non `editorForFileName` : une extension peut avoir
  // plusieurs candidats, et ce greffon peut n'être pas le premier. Interroger
  // le seul préféré déclarerait « non enregistré » un greffon qui l'est —
  // c'est-à-dire un mensonge dans l'autre sens.
  return m.extensions.every((ext) =>
    editorsForFileName(`_.${String(ext).toLowerCase()}`).some((p) => owned.has(p))
  );
}

/**
 * Ce greffon ouvre-t-il PAR DÉFAUT au moins une de ses extensions ?
 *
 * Enregistré ne veut plus dire atteignable : depuis que le registre accepte
 * plusieurs candidats, un greffon peut être parfaitement en place et n'ouvrir
 * jamais rien, parce qu'un autre passe devant sur chacune de ses extensions.
 * L'annoncer « actif » serait promettre un geste qui n'existe pas.
 */
function ouvreParDefaut(m: MarketplaceManifest): boolean {
  const plugin = listPlugins().find((p) => p.manifest.id === m.id);
  if (!plugin) return false;
  const owned = new Set(plugin.editors ?? []);
  return m.extensions.some((ext) => {
    const prefere = editorForFileName(`_.${String(ext).toLowerCase()}`);
    return prefere !== null && owned.has(prefere);
  });
}

/** Vérifie un record et, si activé, l'enregistre au registre. Ne jette jamais
 *  — l'échec devient un statut honnête que l'UI affiche. */
/**
 * Le filtre de politique d'organisation, posé par l'application au démarrage.
 *
 * ── POURQUOI UNE FONCTION INJECTÉE ET NON UNE LECTURE DU MAGASIN ─────────────
 *
 * Ce module est un service : il ne connaît ni Redux, ni React, et ses tests
 * l'appellent sans l'un ni l'autre. Lui faire lire l'état global le rendrait
 * impossible à éprouver seul et lierait le chargement des extensions au cycle de
 * vie de l'interface.
 *
 * ── LE DÉFAUT EST « TOUT PASSE », ET C'EST VOULU ─────────────────────────────
 *
 * Tant que personne n'a posé de filtre — au démarrage, dans les tests, sur un
 * compte sans organisation — rien n'est bloqué. Une politique ABSENTE n'est pas
 * une politique restrictive : déduire un blocage d'une information manquante
 * priverait de ses extensions un utilisateur qui n'a jamais eu d'organisation.
 *
 * Et ce filtre reste du CONFORT : le vrai verrou est le refus du Worker sur le
 * paquet, qui tient quel que soit l'état du poste.
 */
let orgPluginFilter: (slug: string) => boolean = () => true;

/** Pose le filtre (l'application le fait dès que la politique est connue). */
export function setOrgPluginFilter(filter: (slug: string) => boolean): void {
  orgPluginFilter = filter;
}

async function verifyAndRegister(rec: InstalledPluginRecord): Promise<LoadedPluginState> {
  const base = {
    slug: rec.slug,
    installedVersion: rec.installedVersion,
    enabled: rec.enabled,
    publisherFingerprint: rec.publisherFingerprint,
  };

  // AVANT toute vérification cryptographique et tout enregistrement : une
  // extension que l'organisation refuse ne doit pas voir son code atteindre le
  // registre, fût-il valide. L'ordre compte — vérifier d'abord reviendrait à
  // exécuter ce qu'on prétend interdire.
  if (!orgPluginFilter(rec.slug)) {
    return { ...base, name: rec.slug, status: 'blocked_by_org' };
  }
  let manifest: MarketplaceManifest;
  try {
    manifest = await verifyInstalledPlugin({
      manifestJson: rec.manifestJson,
      signature: rec.signature,
      signPublicKey: rec.pinnedSignPublicKey,
      bundleBytes: new Uint8Array(rec.bundle),
      expected: { slug: rec.slug, version: rec.installedVersion },
    });
  } catch {
    return { ...base, name: rec.slug, status: 'broken_signature' };
  }

  if (!rec.enabled) return { ...base, name: manifest.name, status: 'disabled' };

  try {
    registerSandboxedPlugin({
      manifest: toRegistryManifest(manifest),
      code: decodeBundle(rec.bundle),
    });
    return {
      ...base,
      name: manifest.name,
      status: ouvreParDefaut(manifest) ? 'active' : 'shadowed',
    };
  } catch (e) {
    // Déjà en place (rechargement d'écran) = actif — mais SEULEMENT si le
    // registre le confirme. Un conflit d'extension avec un builtin, lui, reste
    // honnête et visible.
    if (e instanceof PluginRegistrationError && isRegisteredAndServing(manifest)) {
      return {
        ...base,
        name: manifest.name,
        status: ouvreParDefaut(manifest) ? 'active' : 'shadowed',
      };
    }
    return { ...base, name: manifest.name, status: 'register_failed' };
  }
}

/** Charge (vérifie + enregistre) tous les greffons installés d'un compte. */
export async function loadInstalledPlugins(userId: string): Promise<LoadedPluginState[]> {
  const records = await installedPluginsList(userId);
  const out: LoadedPluginState[] = [];
  for (const rec of records) {
    out.push(await verifyAndRegister(rec));
  }
  return out;
}

// Un seul chargement de démarrage par compte — les écrans suivants passent
// par refreshInstalledPlugins (le thunk) qui relit l'état.
const bootLoads = new Map<string, Promise<LoadedPluginState[]>>();

/** Idempotent — appelé au démarrage des surfaces qui résolvent des éditeurs. */
export function ensureInstalledPluginsLoaded(userId: string): Promise<LoadedPluginState[]> {
  let p = bootLoads.get(userId);
  if (!p) {
    p = loadInstalledPlugins(userId).catch(() => []);
    bootLoads.set(userId, p);
  }
  return p;
}

export interface InstallOptions {
  /** Geste explicite de l'utilisateur devant l'écran TOFU — ré-épingle la clé. */
  acceptNewPublisherKey?: boolean;
  /** Geste explicite : accepter d'installer une version PLUS ANCIENNE. */
  allowRollback?: boolean;
}

/**
 * Installe (ou met à jour vers) slug@version. Vérifie TOUT avant d'écrire :
 * TOFU (clé épinglée), anti-rollback, signature/hash/empreinte/substitution.
 */
export async function installPlugin(
  userId: string,
  slug: string,
  version: string,
  opts: InstallOptions = {}
): Promise<LoadedPluginState> {
  const detail = await apiGetMarketplacePlugin(slug);
  const dto = detail.versions.find((v) => v.version === version);
  if (!dto) throw new PluginVerifyError('manifest_mismatch');

  const existing = await installedPluginGet(userId, slug);

  // TOFU : une mise à jour signée par une AUTRE clé peut être un éditeur
  // compromis côté serveur. Jamais d'écrasement silencieux — seul le geste
  // explicite ré-épingle.
  if (
    existing &&
    existing.pinnedSignPublicKey !== dto.signPublicKey &&
    !opts.acceptNewPublisherKey
  ) {
    throw new PluginVerifyError('publisher_key_changed');
  }
  // Anti-rollback : un serveur compromis ne repousse pas une version
  // vulnérable sous couvert de « mise à jour ». (Réinstaller la même version
  // reste permis — c'est la réparation d'un record cassé.)
  if (existing && compareSemver(version, existing.installedVersion) < 0 && !opts.allowRollback) {
    throw new PluginVerifyError('version_rollback');
  }

  const pinnedKey =
    existing && !opts.acceptNewPublisherKey ? existing.pinnedSignPublicKey : dto.signPublicKey;

  const bundleBytes = await apiDownloadPluginBundle(slug, version);
  const manifest = await verifyInstalledPlugin({
    manifestJson: dto.manifestJson,
    signature: dto.signature,
    signPublicKey: pinnedKey,
    bundleBytes,
    expected: { slug, version },
  });

  const rec: InstalledPluginRecord = {
    slug,
    installedVersion: version,
    manifestJson: dto.manifestJson,
    signature: dto.signature,
    pinnedSignPublicKey: pinnedKey,
    publisherFingerprint: manifest.publisherFingerprint,
    bundle: bundleBytes.slice().buffer,
    enabled: existing?.enabled ?? true,
    installedAt: new Date().toISOString(),
  };
  await installedPluginPut(userId, rec);

  // Remplacement à chaud : l'ancienne version (si enregistrée) cède la place.
  unregisterSandboxedPlugin(slug);
  return verifyAndRegister(rec);
}

export async function uninstallPlugin(userId: string, slug: string): Promise<void> {
  await installedPluginDelete(userId, slug);
  unregisterSandboxedPlugin(slug);
}

export async function setPluginEnabled(
  userId: string,
  slug: string,
  enabled: boolean
): Promise<void> {
  await installedPluginSetEnabled(userId, slug, enabled);
  if (!enabled) {
    unregisterSandboxedPlugin(slug);
    return;
  }
  const rec = await installedPluginGet(userId, slug);
  if (rec) await verifyAndRegister({ ...rec, enabled: true });
}
