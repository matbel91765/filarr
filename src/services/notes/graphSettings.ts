/**
 * Réglages de la vue graphe — Filarr Notes
 *
 * Contrat partagé desktop/mobile calqué sur le graph.json d'Obsidian :
 * mêmes clés, mêmes bornes, mêmes défauts pour les réglages « standard »,
 * plus quelques clés propres à Filarr (clusters, heat map, carnets, graphe
 * local). Tout vit dans UN SEUL JSON localStorage (`filarr_graph_settings`)
 * pour que l'export/import de réglages reste trivial ; les anciennes clés
 * éparses (`filarr_graph_show_arrows`, `filarr_graph_local_mode`, …) sont
 * migrées au premier chargement puis ignorées.
 */

// ==================== Types ====================

export interface GraphColorGroup {
  /**
   * Requête de coloration. Syntaxe :
   *   - sous-chaîne du titre (insensible à la casse)
   *   - `tag:#x` ou `tag:x` — notes portant la balise x
   *   - `notebook:nom` — notes appartenant au carnet nommé (desktop only)
   */
  query: string;
  /** Couleur hex (#rrggbb) appliquée au PREMIER groupe qui matche. */
  color: string;
}

export interface GraphSettings {
  // ---- Clés au contrat Obsidian (mêmes bornes, mêmes défauts) ----
  search: string;
  /** Nœuds balises (#tag) reliés aux notes qui les portent. */
  showTags: boolean;
  /** Nœuds fichiers/dossiers. Défaut TRUE sur desktop : continuité produit. */
  showAttachments: boolean;
  /** « Fichiers existants seulement » : cache les liens non résolus. */
  hideUnresolved: boolean;
  /** Nœuds de degré 0 visibles. */
  showOrphans: boolean;
  /**
   * Calque de coloration PRIORITAIRE : un nœud qui matche un groupe garde
   * sa couleur même si les clusters ou la heat map sont actifs (priorité
   * groupes > heat map > clusters > type, comme Obsidian).
   */
  colorGroups: GraphColorGroup[];
  /** Desktop : conserve le défaut/persistance existants (true). */
  showArrow: boolean;
  /** -3..3, pas 0.1 — seuil de fondu des libellés au zoom. */
  textFadeMultiplier: number;
  /** 0.1..5, pas 0.1 */
  nodeSizeMultiplier: number;
  /** 0.1..5, pas 0.1 */
  lineSizeMultiplier: number;
  /** 0..1, pas 0.01 */
  centerStrength: number;
  /** 0..20, pas 0.1 */
  repelStrength: number;
  /** 0..1, pas 0.01 */
  linkStrength: number;
  /** 30..500, pas 1 */
  linkDistance: number;
  /** 1..5 — profondeur du graphe local. */
  localJumps: number;

  // ---- Clés propres à Filarr (persistées dans le même JSON) ----
  /** Graphe local : restreint au voisinage de la note ouverte. */
  localMode: boolean;
  /** Overlay carnets (hubs artificiels, opt-in). */
  showNotebooks: boolean;
  /** Coloration par clusters Louvain (exclusif avec la heat map). */
  showClusters: boolean;
  /** Coloration par récence (exclusif avec les clusters). */
  showHeatMap: boolean;
}

// ==================== Constantes ====================

export const GRAPH_SETTINGS_KEY = 'filarr_graph_settings';

// Anciennes clés éparses, lues UNE FOIS en fallback lors de la migration.
const LEGACY_KEY_ARROWS = 'filarr_graph_show_arrows';
const LEGACY_KEY_LOCAL_MODE = 'filarr_graph_local_mode';
const LEGACY_KEY_LOCAL_DEPTH = 'filarr_graph_local_depth';
const LEGACY_KEY_NOTEBOOKS = 'filarr_graph_show_notebooks';

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  search: '',
  showTags: false,
  showAttachments: true,
  hideUnresolved: false,
  showOrphans: true,
  colorGroups: [],
  showArrow: true,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
  centerStrength: 0.52,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 250,
  localJumps: 1,
  localMode: false,
  showNotebooks: false,
  showClusters: true,
  showHeatMap: false,
};

// ==================== Helpers ====================

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function asNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  return clamp(n, min, max);
}

function asBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function asColorGroups(raw: unknown): GraphColorGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: GraphColorGroup[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as GraphColorGroup).query === 'string') {
      const rawColor = (item as GraphColorGroup).color;
      // La couleur alimente un <input type="color">, qui n'accepte QUE la
      // forme #rrggbb : toute autre chaîne (nom CSS, rgb(), forme courte
      // #abc, JSON corrompu) déclenche un warning React et affiche une
      // pastille noire. On retombe donc sur le bleu par défaut plutôt que
      // de propager une valeur que le contrôle refusera.
      const color =
        typeof rawColor === 'string' && /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#4a9eed';
      groups.push({ query: (item as GraphColorGroup).query, color });
    }
  }
  return groups;
}

/**
 * Borne chaque champ pour ne jamais injecter dans la simulation des
 * valeurs hors contrat (un JSON édité à la main ou corrompu ne doit pas
 * pouvoir faire exploser d3-force).
 */
export function sanitizeGraphSettings(
  raw: Partial<GraphSettings> | null | undefined
): GraphSettings {
  const d = DEFAULT_GRAPH_SETTINGS;
  const r = raw || {};
  const out: GraphSettings = {
    search: typeof r.search === 'string' ? r.search : d.search,
    showTags: asBoolean(r.showTags, d.showTags),
    showAttachments: asBoolean(r.showAttachments, d.showAttachments),
    hideUnresolved: asBoolean(r.hideUnresolved, d.hideUnresolved),
    showOrphans: asBoolean(r.showOrphans, d.showOrphans),
    colorGroups: asColorGroups(r.colorGroups),
    showArrow: asBoolean(r.showArrow, d.showArrow),
    textFadeMultiplier: asNumber(r.textFadeMultiplier, d.textFadeMultiplier, -3, 3),
    nodeSizeMultiplier: asNumber(r.nodeSizeMultiplier, d.nodeSizeMultiplier, 0.1, 5),
    lineSizeMultiplier: asNumber(r.lineSizeMultiplier, d.lineSizeMultiplier, 0.1, 5),
    centerStrength: asNumber(r.centerStrength, d.centerStrength, 0, 1),
    repelStrength: asNumber(r.repelStrength, d.repelStrength, 0, 20),
    linkStrength: asNumber(r.linkStrength, d.linkStrength, 0, 1),
    linkDistance: asNumber(r.linkDistance, d.linkDistance, 30, 500),
    localJumps: Math.round(asNumber(r.localJumps, d.localJumps, 1, 5)),
    localMode: asBoolean(r.localMode, d.localMode),
    showNotebooks: asBoolean(r.showNotebooks, d.showNotebooks),
    showClusters: asBoolean(r.showClusters, d.showClusters),
    showHeatMap: asBoolean(r.showHeatMap, d.showHeatMap),
  };

  // Exclusivité clusters/heat map. L'IU l'impose déjà (chaque bascule
  // éteint l'autre), mais un JSON corrompu ou édité à la main peut porter
  // les deux à true : le rendu suivrait la priorité documentée
  // (groupes > heat map > clusters > type, donc heat map gagne entre les
  // deux) tandis que la légende afficherait les clusters — incohérence
  // visible. On tranche ici, à la frontière d'entrée, dans le sens de la
  // priorité de coloration. Les groupes, eux, ne sont exclusifs de rien :
  // ils passent devant les deux calques et n'ont pas de légende propre
  // (leur couleur est visible dans le panneau, comme chez Obsidian).
  if (out.showHeatMap && out.showClusters) out.showClusters = false;

  return out;
}

/**
 * Charge les réglages. Si le JSON unifié n'existe pas encore, migre les
 * anciennes clés éparses (lecture unique en fallback) — elles ne sont pas
 * supprimées pour rester compatibles avec un retour en arrière de version,
 * mais ne sont plus jamais écrites.
 */
export function loadGraphSettings(): GraphSettings {
  try {
    const raw = localStorage.getItem(GRAPH_SETTINGS_KEY);
    if (raw) {
      return sanitizeGraphSettings(JSON.parse(raw));
    }
  } catch {
    // JSON illisible → repartir des défauts (+ migration ci-dessous)
  }

  // Migration des clés héritées — chaque lecture protégée individuellement
  // car localStorage peut être désactivé.
  const migrated: Partial<GraphSettings> = {};
  try {
    // Défaut historique : flèches ON sauf opt-out explicite '0'.
    migrated.showArrow = localStorage.getItem(LEGACY_KEY_ARROWS) !== '0';
    migrated.localMode = localStorage.getItem(LEGACY_KEY_LOCAL_MODE) === '1';
    const depth = parseInt(localStorage.getItem(LEGACY_KEY_LOCAL_DEPTH) || '1', 10);
    migrated.localJumps = Number.isFinite(depth) ? clamp(depth, 1, 5) : 1;
    migrated.showNotebooks = localStorage.getItem(LEGACY_KEY_NOTEBOOKS) === '1';
  } catch {
    // localStorage indisponible → défauts purs
  }
  return sanitizeGraphSettings(migrated);
}

/** Persiste les réglages. Silencieux sur quota plein — même politique que l'existant. */
export function saveGraphSettings(settings: GraphSettings): void {
  try {
    localStorage.setItem(GRAPH_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota plein / localStorage désactivé : les réglages restent en mémoire
    // pour la session, on ne spamme pas l'utilisateur pour si peu.
  }
}

// ==================== Fondu du texte (formule partagée) ====================

/**
 * Alpha du libellé selon le zoom. Formule EXACTE du contrat partagé
 * desktop/mobile — ne pas la « corriger » d'un côté sans l'autre :
 *   T = 1.1 * 2^(-textFadeMultiplier)
 *   alpha = clamp01((scale - T*0.55) / (T*0.45))
 * Les nœuds importants (degré >= 10) s'évaluent avec scale*1.5 pour que
 * leurs libellés apparaissent plus tôt au dézoom.
 */
export function labelAlpha(scale: number, textFadeMultiplier: number): number {
  const T = 1.1 * Math.pow(2, -textFadeMultiplier);
  const a = (scale - T * 0.55) / (T * 0.45);
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

// ==================== Requêtes de groupes ====================

export type GraphGroupQuery =
  | { kind: 'substring'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'notebook'; value: string }
  | null;

/**
 * Analyse une requête de groupe. Retourne null pour une requête vide
 * (un groupe vide ne matche jamais — comportement Obsidian).
 */
export function parseGroupQuery(raw: string): GraphGroupQuery {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('tag:')) {
    // `tag:#x` et `tag:x` sont équivalents.
    const value = lower.slice(4).replace(/^#/, '').trim();
    return value ? { kind: 'tag', value } : null;
  }
  if (lower.startsWith('notebook:')) {
    const value = lower.slice(9).trim();
    return value ? { kind: 'notebook', value } : null;
  }
  return { kind: 'substring', value: lower };
}

// Note : la normalisation des titres pour la résolution de liens N'EST PAS
// ici. Elle vit avec son unique autorité, `linkResolutionKey` dans
// `noteService.ts`, aux côtés de `resolveLinks` — une copie locale « alignée
// par commentaire » avait déjà divergé (espaces repliés + fragment retiré
// côté graphe, casse seule côté service), ce qui faisait disparaître du
// graphe les liens tombant entre les deux normalisations.
