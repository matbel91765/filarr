/**
 * capabilities — CE QUE FAIT UNE EXTENSION, avant ce qu'elle pèse.
 *
 * ── LE PROBLÈME ─────────────────────────────────────────────────────────────
 *
 * L'ancien écran n'affichait NULLE PART les types de fichiers qu'une extension
 * sait ouvrir. C'est pourtant la seule chose qu'une extension Filarr fasse : un
 * greffon est un éditeur qui revendique des extensions de fichier. On installait
 * donc à l'aveugle un objet dont la fonction n'était pas écrite à l'écran, tandis
 * que la version, le nombre de téléchargements et une empreinte de trente
 * chiffres, eux, étaient bien là.
 *
 * L'information EXISTE : elle est dans le manifeste SIGNÉ (`manifestJson`), et
 * pour ce qui est déjà installé, dans le registre en mémoire.
 *
 * ── LECTURE SEULE, DÉFENSIVE ────────────────────────────────────────────────
 *
 * `manifestJson` est la chaîne exacte qui a été signée : on la LIT, on ne la
 * ré-encode jamais, et rien de ce qu'on en tire ne remplace une vérification.
 * Elle vient du réseau : tout y est donc traité comme hostile (JSON invalide,
 * champs du mauvais type, mille extensions, extension `../../etc`). Le filtre
 * ci-dessous est le MÊME que celui du formulaire de publication.
 *
 * Module PUR côté parsing ; la partie « conflits » interroge le registre, en
 * lecture seule.
 */

import { listPlugins } from '../../../services/plugins/pluginRegistry';
/**
 * Les règles d'IMAGE sont celles du marché des modèles — mêmes en-têtes admis,
 * même plafond, même nombre. Deux listes blanches pour la même question
 * auraient fini par diverger, et la divergence se serait vue comme « ma
 * capture passe ici et pas là ».
 */
import {
  LAYOUT_PREVIEW_MAX_COUNT,
  isPreviewImage,
} from '../../../services/layouts/layoutMarketTypes';

/** Le même EXT_RE que la publication et le worker. */
const EXT_RE = /^[a-z0-9]{1,10}$/;
/** Une extension ne peut pas revendiquer cinquante types : au-delà, on écrête. */
const MAX_EXTENSIONS = 24;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export interface PluginCapabilities {
  /** Les extensions de fichier revendiquées, minuscules, sans point, dédupliquées. */
  extensions: string[];
  /**
   * Version minimale de Filarr exigée, si le manifeste la déclare.
   *
   * Le contrat de signature actuel ne porte PAS ce champ et ce module ne le
   * fabrique pas : il le lit s'il existe. C'est une lecture tournée vers
   * l'avenir — le jour où un manifeste le déclarera, l'écran saura déjà dire
   * « demande Filarr 3.2 » au lieu d'installer quelque chose d'inerte.
   */
  minAppVersion: string | null;
}

const EMPTY: PluginCapabilities = { extensions: [], minAppVersion: null };

/** Normalise une liste d'extensions servie — la même règle partout. */
export function normalizeExtensions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const ext = item.trim().toLowerCase().replace(/^\./, '');
    if (!EXT_RE.test(ext)) continue;
    if (!out.includes(ext)) out.push(ext);
    if (out.length >= MAX_EXTENSIONS) break;
  }
  return out;
}

/** Lit les capacités DANS les octets signés. Ne jette jamais. */
export function readCapabilities(manifestJson: unknown): PluginCapabilities {
  if (typeof manifestJson !== 'string' || manifestJson.length === 0) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    return EMPTY;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY;
  const obj = parsed as Record<string, unknown>;
  const min = obj.minAppVersion;
  return {
    extensions: normalizeExtensions(obj.extensions),
    minAppVersion: typeof min === 'string' && SEMVER_RE.test(min) ? min : null,
  };
}

/**
 * LES CAPTURES D'UNE EXTENSION, lues DANS les octets signés.
 *
 * ⚠ CE QUI SORT D'ICI VA DANS UN `src`. Le manifeste est lu pour l'affichage
 * AVANT toute vérification de signature (une fiche s'ouvre sans installer), et
 * il vient du serveur : rien n'y est cru sur parole.
 *
 * `isPreviewImage` ferme par LISTE BLANCHE d'en-têtes — PNG, JPEG, WebP, GIF,
 * et une taille bornée. L'absence de SVG est le point entier : un SVG est un
 * document, qui peut porter des scripts et des références externes, et le
 * poser dans une balise `img` d'une page qui manipule des clés serait ouvrir
 * une porte pour une vignette.
 *
 * Ne jette jamais : une fiche dont les captures sont illisibles s'affiche sans
 * captures, elle ne disparaît pas.
 */
export function readPreviews(manifestJson: unknown): readonly string[] {
  if (typeof manifestJson !== 'string' || manifestJson.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const raw = (parsed as Record<string, unknown>).previews;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const image of raw) {
    if (typeof image !== 'string' || !isPreviewImage(image)) continue;
    out.push(image);
    if (out.length >= LAYOUT_PREVIEW_MAX_COUNT) break;
  }
  return out;
}

/** Compare deux semver stricts. Un champ manquant vaut zéro. */
function compare(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * L'application est-elle assez récente ?
 *
 * « Je ne sais pas » se dit OUI : une version d'app illisible (0.0.0 en dev,
 * une préversion) ne doit pas bloquer une installation légitime — un blocage
 * fondé sur une donnée absente est le pire des refus, il ne s'explique pas.
 */
export function appVersionSatisfies(minAppVersion: string | null, appVersion: string): boolean {
  if (!minAppVersion) return true;
  if (!SEMVER_RE.test(appVersion)) return true;
  return compare(appVersion, minAppVersion) >= 0;
}

export interface ExtensionConflict {
  ext: string;
  /** Le nom lisible de ce qui occupe déjà la place. */
  heldBy: string;
}

/**
 * Quelles extensions revendiquées sont DÉJÀ prises ?
 *
 * Le registre est « premier arrivé, premier servi » et refuse en bloc : une
 * extension qui revendique `.md` alors que l'éditeur intégré le sert déjà
 * s'installe correctement, se vérifie correctement… et finit en
 * `register_failed`, c'est-à-dire installée mais inerte. Le dire AVANT
 * l'installation transforme une panne muette en un choix informé.
 *
 * `selfId` exclut le greffon lui-même : réinstaller ou mettre à jour ne doit pas
 * se signaler comme un conflit avec soi-même.
 */
export function extensionConflicts(extensions: string[], selfId?: string): ExtensionConflict[] {
  if (extensions.length === 0) return [];
  const owners = new Map<string, string>();
  for (const plugin of listPlugins()) {
    if (plugin.manifest.id === selfId) continue;
    for (const provider of plugin.editors ?? []) {
      for (const ext of provider.contribution.extensions) {
        const key = String(ext).toLowerCase();
        if (!owners.has(key)) owners.set(key, plugin.manifest.name || plugin.manifest.id);
      }
    }
  }
  const out: ExtensionConflict[] = [];
  for (const ext of extensions) {
    const heldBy = owners.get(ext);
    if (heldBy) out.push({ ext, heldBy });
  }
  return out;
}

/**
 * Les capacités RÉELLEMENT SERVIES par un greffon installé — celles du registre,
 * pas celles du catalogue. C'est la différence entre « ce que l'auteur annonce »
 * et « ce que votre application ouvre effectivement en ce moment ».
 */
export function servedExtensions(pluginId: string): string[] {
  const plugin = listPlugins().find((p) => p.manifest.id === pluginId);
  if (!plugin) return [];
  const out: string[] = [];
  for (const provider of plugin.editors ?? []) {
    for (const ext of provider.contribution.extensions) {
      const key = String(ext).toLowerCase();
      if (!out.includes(key)) out.push(key);
    }
  }
  return out;
}
