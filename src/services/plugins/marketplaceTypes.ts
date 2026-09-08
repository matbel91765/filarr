/**
 * marketplaceTypes — les formes de la place de marché de greffons (P2).
 *
 * Un listing marketplace est du contenu PUBLIÉ volontairement public (nom,
 * description) — pas de la donnée chiffrée. Mais c'est du texte ATTAQUANT côté
 * affichage : rendu texte brut uniquement, jamais de HTML.
 */

/**
 * Les SIX catégories du marketplace — source unique de l'UI et du publish.
 * Miroir exact de MARKETPLACE_CATEGORIES du worker
 * (infra/cloudflare-worker/src/marketplace.ts) : les deux listes doivent
 * rester identiques, un publish avec une septième valeur est refusé en 400.
 */
export const MARKETPLACE_CATEGORIES = [
  'editors',
  'productivity',
  'data',
  'media',
  'fun',
  'other',
] as const;

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

const CATEGORY_SET: ReadonlySet<string> = new Set(MARKETPLACE_CATEGORIES);

/**
 * La catégorie SERVIE est une donnée hostile — la colonne D1 n'est pas signée.
 *
 * Elle finit en clé i18n (`marketplace.categories.${cat}`) et en fragment de
 * className : une valeur inventée y injecterait une clé inexistante (i18next
 * affiche alors la clé BRUTE, c'est-à-dire le texte du serveur) ou une classe
 * arbitraire. On la ramène donc dans la liste AVANT tout usage — hors liste,
 * absente ou d'un autre type ⇒ 'other'.
 */
export function normalizeCategory(raw: unknown): MarketplaceCategory {
  return typeof raw === 'string' && CATEGORY_SET.has(raw) ? (raw as MarketplaceCategory) : 'other';
}

/**
 * L'icône SERVIE, écrêtée pour l'affichage.
 *
 * Le worker borne à 8 points de code au publish, mais la colonne n'est pas
 * signée : une base modifiée pourrait servir mille emojis et faire déborder la
 * carte. L'écrêtage se fait en POINTS DE CODE ([...s]), jamais en unités
 * UTF-16 — couper au milieu d'une paire de substitution fabriquerait un
 * caractère de remplacement. Le rendu, lui, reste du texte brut React dans un
 * <bdi> : c'est LA défense, pas cette fonction.
 */
export function clampIcon(raw: unknown, maxCodePoints = 8): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const points = [...raw];
  return points.slice(0, maxCodePoints).join('');
}

/** Le manifeste signé — la CHAÎNE manifestJson est la vérité, jamais
 *  re-sérialisée ; cette interface n'est que sa lecture APRÈS vérification. */
export interface MarketplaceManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  extensions: string[];
  /** sha256 hex minuscule du bundle — le hash vit DANS le manifeste : une
   *  seule signature couvre manifeste + octets. */
  bundleHash: string;
  /** Rendu 6×5 chiffres de la clé de l'éditeur (computeFingerprint). */
  publisherFingerprint: string;
  trust: 'sandboxed';
  /**
   * OPTIONNELS (P3-B). Ils voyagent DANS les octets signés — et leur absence
   * est légale : tout manifeste publié avant P3 reste valide au publish, à la
   * vérification et au chargement. Ne JAMAIS les ajouter à un manifestJson
   * existant : la signature couvre les octets tels qu'ils ont été signés.
   */
  icon?: string;
  category?: MarketplaceCategory;
  /**
   * LES CAPTURES D'ÉCRAN — jusqu'à quatre, la première faisant la couverture.
   *
   * Ajoutées après coup, comme `icon` et `category`, et pour la même raison :
   * une fiche d'extension ne montrait RIEN de ce que l'extension fait à
   * l'écran. Un emoji et deux phrases, pour décider d'exécuter du code d'un
   * inconnu dans son bac à sable.
   *
   * ⚠ MÊME RÈGLE QUE LES DEUX AUTRES : on AJOUTE, on ne renomme jamais, et on
   * n'ajoute JAMAIS ce champ à un `manifestJson` déjà signé — la signature
   * couvre les octets tels qu'ils ont été signés. Un manifeste publié avant ce
   * champ reste valide partout.
   *
   * Elles voyagent DANS le manifeste signé, donc elles sont couvertes par la
   * signature — mais le manifeste est lu AVANT vérification pour l'affichage
   * du catalogue : toute image lue ici passe par `isPreviewImage` avant d'être
   * posée dans un `src`. Voir `readPreviews`.
   */
  previews?: string[];
}

export interface MarketplacePluginSummary {
  slug: string;
  name: string;
  description: string;
  latestVersion: string;
  publisherFingerprint: string;
  downloads: number;
  /** 'unlisted' n'apparaît que sur SES propres greffons. */
  status: 'published' | 'unlisted';
  updatedAt: string;
  ownedByMe: boolean;
  /** Miroirs D1 du manifeste — NON SIGNÉS : normalizeCategory / clampIcon
   *  AVANT tout usage en clé i18n, className ou rendu. */
  icon?: string | null;
  category?: string | null;
}

export interface MarketplaceVersionDTO {
  version: string;
  /** Les octets exacts signés — transportés en chaîne de bout en bout. */
  manifestJson: string;
  signature: string;
  signPublicKey: string;
  bundleHash: string;
  sizeBytes: number;
  createdAt: string;
}

export interface MarketplacePluginDetail extends MarketplacePluginSummary {
  versions: MarketplaceVersionDTO[];
}

/**
 * L'état d'un greffon installé, vu de l'UI :
 *  · active — vérifié et enregistré, l'éditeur bac à sable répond ;
 *  · disabled — vérifié mais volontairement coupé ;
 *  · broken_signature — la vérification au chargement a échoué : rien n'est
 *    enregistré, l'utilisateur désinstalle/réinstalle ;
 *  · register_failed — vérifié mais refusé par le registre (identifiant déjà
 *    pris, ou greffon qui revendique deux fois la même extension) ;
 *  · shadowed — vérifié et ENREGISTRÉ, mais un autre éditeur ouvre par défaut
 *    chacune de ses extensions. Le distinguer d'`active` n'est pas un détail :
 *    dire « actif » d'un greffon qu'aucun geste n'atteint est exactement le
 *    genre de promesse que l'interface ne tient pas. Un conflit d'extension ne
 *    refuse plus l'enregistrement (voir editorsByExtension) — il produit ce
 *    statut-ci ;
 *  · blocked_by_org — vérifié, intact, mais la politique de l'organisation ne
 *    l'autorise pas (place de marché coupée, extensions bloquées, ou absent de
 *    la liste blanche). Un statut À PART, et pas 'disabled' : « désactivé » est
 *    un geste de l'utilisateur, qu'il peut défaire, et le lui dire l'enverrait
 *    chercher un interrupteur qui ne changera rien. Ici la décision vient
 *    d'ailleurs, l'interface le nomme, et la seule issue est d'en parler à son
 *    administrateur.
 */
export type InstalledPluginStatus =
  | 'active'
  | 'disabled'
  | 'broken_signature'
  | 'register_failed'
  | 'shadowed'
  | 'blocked_by_org';

/** Semver strict a-t-il trois champs numériques ? (le worker impose ^\d+\.\d+\.\d+$) */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
