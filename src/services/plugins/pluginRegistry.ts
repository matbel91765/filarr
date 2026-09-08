/**
 * Le registre des greffons — l'unique porte d'entrée du cœur.
 *
 * Volontairement minuscule : enregistrer, refuser ce qu'on ne sait pas encore
 * servir, résoudre un éditeur par extension. Tout ce que le registre ne fait
 * PAS (télécharger du code, vérifier une signature, sandboxer) est documenté
 * dans pluginTypes.ts comme un futur explicite, pas comme un oubli.
 */

import type {
  EditorHost,
  EditorProvider,
  FilarrPlugin,
  SandboxedPluginSource,
} from './pluginTypes';
import { mountSandboxedEditor } from './sandbox/sandboxHost';
import { MAX_EDITOR_FILE_SIZE } from '../../constants/limits';

const plugins = new Map<string, FilarrPlugin>();
/**
 * Une extension peut avoir PLUSIEURS candidats, ordonnés : le premier est celui
 * qui ouvre par défaut. Les builtins passent avant les greffons tiers.
 *
 * C'était une Map vers UN provider, et un second prétendant faisait échouer
 * l'enregistrement entier. Un utilisateur ne pouvait donc jamais installer un
 * éditeur markdown : `.md` est pris par le greffon texte du cœur, et le refus
 * était atomique — le greffon tiers était rejeté en BLOC, y compris pour les
 * extensions que personne ne revendiquait.
 *
 * Le défaut ne change PAS : le premier candidat reste celui d'aujourd'hui.
 * La pluralité ne fait qu'ouvrir la porte à un choix explicite.
 */
const editorsByExtension = new Map<string, EditorProvider[]>();
const importersByExtension = new Map<string, EditorProvider>();
/** Le régime de confiance de chaque provider — rempli par les DEUX portes. */
const providerTrust = new WeakMap<EditorProvider, 'builtin' | 'sandboxed'>();

export class PluginRegistrationError extends Error {}

export function registerPlugin(plugin: FilarrPlugin): void {
  const { manifest } = plugin;
  if (manifest.trust !== 'builtin') {
    /**
     * LE REFUS EST PERMANENT pour du code en mémoire hôte : un objet
     * FilarrPlugin avec des fonctions mount() qui se dirait 'sandboxed'
     * serait un mensonge — son code s'exécuterait DANS l'hôte, avec les
     * octets déchiffrés. La voie sandboxée est registerSandboxedPlugin
     * (bundle-CHAÎNE, exécuté uniquement dans l'iframe).
     */
    throw new PluginRegistrationError(
      `Plugin "${manifest.id}": trust "${manifest.trust}" is not supported yet — only builtin plugins are served`
    );
  }
  if (plugins.has(manifest.id)) {
    throw new PluginRegistrationError(`Plugin "${manifest.id}" is already registered`);
  }
  const plan = planProviders(plugin.editors ?? []);
  plugins.set(manifest.id, plugin);
  commitProviders(plugin.editors ?? [], plan, 'builtin');
}

/**
 * L'indexation partagée des contributions — mêmes règles pour les deux portes,
 * et TOUT OU RIEN.
 *
 * POURQUOI EN DEUX TEMPS. L'indexation écrivait au fil de la boucle et jetait
 * au premier conflit : un greffon revendiquant ['ok', 'pris'] laissait '.ok'
 * indexé vers un provider dont le greffon n'était PAS enregistré — une
 * extension qui résout vers un éditeur fantôme, que rien ne pouvait plus
 * désinstaller (unregisterSandboxedPlugin ne connaît que les greffons
 * enregistrés). On calcule d'abord, on écrit ensuite.
 */
function planProviders(providers: EditorProvider[]): Map<string, EditorProvider> {
  const claimed = new Map<string, EditorProvider>();
  for (const provider of providers) {
    for (const ext of provider.contribution.extensions) {
      const cle = ext.toLowerCase();
      // LE CONFLIT INTERNE RESTE UNE ERREUR : deux contributions du MÊME
      // greffon sur la même extension est un bogue de configuration, que rien
      // ne peut départager sensément. Un conflit avec un AUTRE greffon, lui,
      // n'en est plus un — c'est un second candidat, et l'utilisateur
      // tranchera. Voir editorsByExtension.
      if (claimed.has(cle)) {
        throw new PluginRegistrationError(
          `Extension ".${cle}" is claimed twice by the same plugin`
        );
      }
      claimed.set(cle, provider);
    }
  }
  return claimed;
}

/** L'écriture — appelée UNIQUEMENT après un planProviders sans conflit. */
function commitProviders(
  providers: EditorProvider[],
  plan: Map<string, EditorProvider>,
  trust: 'builtin' | 'sandboxed'
): void {
  for (const provider of providers) providerTrust.set(provider, trust);
  for (const [cle, provider] of plan) {
    const liste = editorsByExtension.get(cle) ?? [];
    liste.push(provider);
    // Les builtins d'abord : c'est ce qui garantit que le défaut d'aujourd'hui
    // ne bouge pas quand un greffon tiers revendique la même extension. `sort`
    // est stable en JS moderne, donc l'ordre d'enregistrement départage à
    // régime égal — premier arrivé, premier servi, comme avant.
    liste.sort(
      (a, b) =>
        (providerTrust.get(a) === 'sandboxed' ? 1 : 0) -
        (providerTrust.get(b) === 'sandboxed' ? 1 : 0)
    );
    editorsByExtension.set(cle, liste);
  }
  for (const provider of providers) {
    for (const ext of provider.contribution.imports ?? []) {
      const cle = ext.toLowerCase();
      if (!importersByExtension.has(cle)) importersByExtension.set(cle, provider);
    }
  }
}

/**
 * LA SECONDE PORTE : un greffon BAC À SABLE. Le code n'est qu'une CHAÎNE côté
 * hôte — le registre synthétise des EditorProvider dont mount() lance le pont
 * (iframe d'origine opaque, CSP sans réseau, sandboxHost.ts). host.collab est
 * volontairement IGNORÉ : pas de collaboration v1 pour du code non revu.
 */
export function registerSandboxedPlugin(source: SandboxedPluginSource): void {
  const { manifest } = source;
  if (manifest.trust !== 'sandboxed') {
    throw new PluginRegistrationError(
      `Plugin "${manifest.id}": registerSandboxedPlugin only serves trust "sandboxed" — a builtin has nothing to do here`
    );
  }
  if (typeof source.code !== 'string' || source.code.length === 0) {
    throw new PluginRegistrationError(`Plugin "${manifest.id}": empty sandboxed bundle`);
  }
  if (plugins.has(manifest.id)) {
    throw new PluginRegistrationError(`Plugin "${manifest.id}" is already registered`);
  }
  const providers: EditorProvider[] = (manifest.provides.editors ?? []).map((contribution) => ({
    contribution,
    mount: (host: EditorHost) =>
      mountSandboxedEditor({
        container: host.container,
        code: source.code,
        editorId: contribution.id,
        fileName: host.fileName,
        readOnly: host.readOnly,
        initialBytes: host.initialBytes,
        saveBytes: host.saveBytes,
        onDirty: host.onDirty,
        /**
         * Une panne du bac à sable se DIT. L'écraser en `onDirty(false)`
         * effaçait le drapeau « non enregistré » au moment précis où il
         * comptait le plus (le pont venait de mourir : les octets tapés ne
         * sont plus atteignables) et l'utilisateur pouvait fermer sans
         * avertissement. L'hôte reçoit le message et l'affiche.
         */
        onFatal: (message: string) => host.onFatal?.(message),
      }),
  }));
  // ATOMIQUE : le plan des extensions PASSE avant la moindre écriture — une
  // collision laissait auparavant l'id pris et des extensions à demi indexées.
  const plan = planProviders(providers);
  plugins.set(manifest.id, { manifest, editors: providers });
  commitProviders(providers, plan, 'sandboxed');
}

/**
 * Retire un greffon BAC À SABLE (désinstallation / désactivation marketplace,
 * effet immédiat). Volontairement refusé aux builtins : ils sont du cœur, ils
 * ne se désinstallent pas.
 */
export function unregisterSandboxedPlugin(pluginId: string): void {
  const plugin = plugins.get(pluginId);
  if (!plugin || plugin.manifest.trust !== 'sandboxed') return;
  plugins.delete(pluginId);
  const owned = new Set(plugin.editors ?? []);
  for (const [ext, liste] of [...editorsByExtension]) {
    // Retirer DU TABLEAU sans casser l'ordre des autres candidats : supprimer
    // la clé entière effacerait aussi l'éditeur builtin qui la partage.
    const reste = liste.filter((p) => !owned.has(p));
    if (reste.length === 0) editorsByExtension.delete(ext);
    else editorsByExtension.set(ext, reste);
  }
  for (const [ext, provider] of [...importersByExtension]) {
    if (owned.has(provider)) importersByExtension.delete(ext);
  }
}

/** Le régime de confiance d'un provider ('builtin' par défaut : les tests en
 *  construisent hors registre). */
export function trustOfProvider(provider: EditorProvider): 'builtin' | 'sandboxed' {
  return providerTrust.get(provider) ?? 'builtin';
}

/** L'extension d'un nom de fichier, en minuscules, sans le point. */
function extensionDe(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * TOUS les éditeurs qui revendiquent cette extension, du préféré au dernier.
 *
 * C'est la liste qu'un choix « ouvrir avec » présentera. Elle est ordonnée :
 * builtins d'abord, puis les greffons tiers dans leur ordre d'installation.
 */
export function editorsForFileName(fileName: string): EditorProvider[] {
  return editorsByExtension.get(extensionDe(fileName)) ?? [];
}

/** L'éditeur qui ouvre cette extension PAR DÉFAUT, s'il existe. */
export function editorForFileName(fileName: string): EditorProvider | null {
  return editorsByExtension.get(extensionDe(fileName))?.[0] ?? null;
}

/**
 * Cet éditeur accepte-t-il d'ouvrir un fichier de CETTE taille ?
 *
 * L'aperçu avait sa garde, l'éditeur n'en avait aucune — alors qu'il est plus
 * coûteux (tout le clair en état React, plus un arbre ProseMirror côté
 * documents). Un fichier trop gros ne doit pas ouvrir un éditeur qui gèlera :
 * l'appelant retombe alors sur l'aperçu ou l'application système, qui savent
 * fenêtrer.
 *
 * Une taille INCONNUE passe. On ne refuse que sur une mesure, jamais sur son
 * absence : bloquer un fichier parce qu'on ignore sa taille fermerait l'éditeur
 * sur des fichiers parfaitement ouvrables.
 */
export function editorAcceptsSize(provider: EditorProvider, size: number | undefined): boolean {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return true;
  return size <= (provider.contribution.maxBytes ?? MAX_EDITOR_FILE_SIZE);
}

/** L'éditeur qui sait IMPORTER cette extension (ouvrir, puis sauver en natif). */
export function importerForFileName(fileName: string): EditorProvider | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return importersByExtension.get(ext) ?? null;
}

export function listPlugins(): FilarrPlugin[] {
  return [...plugins.values()];
}

/** Une entrée du menu « Nouveau document ». */
export interface NewDocumentFormat {
  ext: string;
  label: string;
  seed?: () => Uint8Array | Promise<Uint8Array>;
}

/**
 * Les formats que « Nouveau document » propose de créer.
 *
 * OPT-IN. Cette fonction remplace un `registeredEditorExtensions()` qui
 * rendait TOUTE extension ouvrable : quand l'éditeur de code en a revendiqué
 * une quarantaine, le menu est passé de deux entrées à une cinquantaine, dont
 * « texte (.txt) ». Et comme la création écrit zéro octet, le fichier neuf
 * s'ouvrait vide — indiscernable, pour qui le relit, d'un fichier vidé.
 *
 * Le libellé vient du greffon et le tri est fait ici : un menu dont l'ordre
 * dépend de l'ordre d'enregistrement bouge sous la souris.
 */
export function newDocumentFormats(): NewDocumentFormat[] {
  const formats: NewDocumentFormat[] = [];
  const vus = new Set<string>();
  for (const liste of editorsByExtension.values()) {
    for (const provider of liste) {
      for (const offre of provider.contribution.newDocument ?? []) {
        const ext = offre.ext.toLowerCase();
        // Deux greffons peuvent proposer la même extension : le premier
        // enregistré gagne, comme pour l'ouverture — un menu à deux
        // « Nouveau .md » ne dirait pas lequel des deux on obtient.
        if (vus.has(ext)) continue;
        vus.add(ext);
        formats.push({ ext, label: offre.label, seed: offre.seed });
      }
    }
  }
  return formats.sort((a, b) => a.label.localeCompare(b.label));
}
/**
 * Les extensions qu'un éditeur ENREGISTRÉ sait ouvrir nativement, avec le
 * libellé publié — la source unique du menu « Nouveau document ».
 *
 * POURQUOI ICI. Sans ce recensement, un plugin d'édition installé restait
 * inatteignable : rien dans le produit ne crée un `.kanban`, et l'éditeur ne
 * s'ouvre que sur un fichier existant. Le registre est le seul à savoir qui
 * revendique quoi ; la liste est triée pour que le menu ne danse pas d'un
 * rendu à l'autre.
 */
export function registeredEditorExtensions(): { ext: string; displayName: string }[] {
  return (
    [...editorsByExtension.entries()]
      // Le libellé est celui du candidat PRÉFÉRÉ : c'est lui qui s'ouvrira, et
      // annoncer le nom d'un autre mentirait sur ce que fera le clic.
      .map(([ext, liste]) => ({ ext, displayName: liste[0].contribution.displayName }))
      .sort((a, b) => a.ext.localeCompare(b.ext))
  );
}

/** Réservé aux tests : le registre est un état de module, il doit se remettre à zéro. */
export function __resetPluginRegistryForTests(): void {
  plugins.clear();
  editorsByExtension.clear();
  importersByExtension.clear();
}
