/**
 * MODÈLES DE MISE EN PAGE PARTAGEABLES — LE FORMAT DE FICHIER.
 *
 * ── CE QUE CE MODULE EST, ET CE QU'IL N'EST PAS ─────────────────────────────
 *
 * Il décrit le contenu d'un `.filarrlayout` : des types, des bornes, et les
 * quelques fonctions pures qui savent fabriquer un tel fichier ou lire ce qu'il
 * déclare. Il ne LIT rien (aucun disque, aucun store), ne rend rien, n'importe
 * ni React ni le registre de widgets. C'est ce qui permet au VALIDATEUR
 * (`layoutValidator.ts`) d'en dépendre et d'être exécutable tel quel côté worker
 * le jour où la v2 en ligne arrive.
 *
 * ── LE FORMAT EST FIGÉ ──────────────────────────────────────────────────────
 *
 * Dès qu'un fichier circule, il est hors de portée : on ne peut plus le
 * corriger, le migrer ni le rappeler. Les champs décrits ici ne changent donc
 * pas de sens ; une évolution passe par `formatVersion`, et un lecteur qui ne
 * connaît pas la version REFUSE au lieu de deviner.
 *
 * ── LA LIGNE QUI COMMANDE TOUT LE RESTE : `options` vs `bindings` ───────────
 *
 * Une mise en page contient NATURELLEMENT le contenu personnel de son auteur.
 * Le bloc « Tous les dossiers » réglé sur un dossier, la recherche enregistrée,
 * le coffre épinglé : ce ne sont pas des réglages, ce sont des LIAISONS À DU
 * CONTENU. Le format les sépare donc en deux champs qui n'ont pas les mêmes
 * droits :
 *
 *   · `options` — des paramètres GÉNÉRIQUES (nombre de lignes, tri, densité,
 *     style d'encadrement). Ils ne désignent rien qui existe chez quelqu'un.
 *     Ils voyagent tels quels.
 *   · `bindings` — des liaisons à du contenu. Elles NE VOYAGENT JAMAIS. À
 *     l'export, chacune est soit VIDÉE, soit remplacée par un EMPLACEMENT
 *     NOMMÉ : `{ slot: { label: 'Votre dossier de projets', accepts: 'folder' } }`
 *     — un libellé écrit pour un humain, jamais un identifiant.
 *
 * Le validateur d'import refuse STRUCTURELLEMENT tout `bindings` qui porterait
 * autre chose que cette forme-là. Ce n'est pas une politesse envers l'auteur du
 * fichier : c'est ce qui garantit qu'un fichier fabriqué à la main, hors de
 * notre interface, ne peut pas non plus transporter d'identifiant.
 */

// ==================== Constantes de protocole ====================

/** Discriminant du fichier. Un JSON qui ne le porte pas n'est pas des nôtres. */
export const LAYOUT_FILE_KIND = 'filarr.layout';

/** Version de FORMAT. Un lecteur qui ne la connaît pas refuse — il ne devine pas. */
export const LAYOUT_FILE_FORMAT_VERSION = 1;

/** Extension du fichier, sans le point. */
export const LAYOUT_FILE_EXTENSION = 'filarrlayout';

/**
 * Plafond de lecture, en OCTETS UTF-8 (jamais en `.length` : « 𝄞 » compte pour
 * un en JavaScript et pour quatre sur le disque, et c'est le disque qui décide
 * du coût). 256 Kio est très large pour une disposition — une centaine de blocs
 * avec leurs réglages tiennent dans quelques dizaines de kilo-octets — et
 * assez bas pour qu'un `JSON.parse` hostile ne puisse pas figer le processus.
 */
export const LAYOUT_FILE_MAX_BYTES = 256 * 1024;

/**
 * Préfixe du SEUL espace de noms de widgets qu'un fichier peut désigner.
 *
 * `core:<id>` renvoie au registre CLOS embarqué dans le binaire
 * (`widgetRegistry.ts`). Un fichier ne peut donc jamais nommer un module
 * arbitraire : au pire il nomme un identifiant que cette version ne connaît
 * pas, et le bloc s'affiche en tuile inerte.
 */
export const LAYOUT_CORE_PREFIX = 'core:';

/** Ce qu'un `requires[]` peut réclamer. `plugin` est RÉSERVÉ, refusé en v1. */
export type LayoutRequirementKind = 'core' | 'plugin';

/** Les vues qu'un modèle peut viser. */
export type LayoutFileTarget = 'home' | 'folder' | 'board';
export const LAYOUT_FILE_TARGETS: readonly LayoutFileTarget[] = ['home', 'folder', 'board'];

/**
 * Ce qu'un EMPLACEMENT NOMMÉ attend qu'on y dépose. Liste CLOSE : une liaison
 * dont on ne saurait pas dire ce qu'elle accepte ne peut pas devenir un
 * emplacement, elle est vidée.
 */
export type LayoutSlotAccepts = 'folder' | 'vault' | 'note' | 'tag' | 'board';
export const LAYOUT_SLOT_ACCEPTS: readonly LayoutSlotAccepts[] = [
  'folder',
  'vault',
  'note',
  'tag',
  'board',
];

/**
 * Clé d'options RÉSERVÉE, écrite à l'IMPORT sur les seuls blocs que cette
 * version ne sait pas rendre. Elle porte de quoi afficher une tuile inerte
 * honnête (le nom que l'auteur donnait au bloc, la version qu'il réclamait) et
 * rien d'autre. Le jour où le bloc existe, son composant l'ignore — les
 * lecteurs de réglages passent tous par le schéma déclaré du widget.
 */
export const LAYOUT_UNAVAILABLE_OPTION = 'filarr.unavailable';

export interface LayoutUnavailableInfo {
  /** Le type demandé, en clair, pour que la tuile puisse le dire. */
  type: string;
  /** Le nom que l'auteur donnait au bloc, s'il en donnait un. */
  title?: string;
  /** Version d'application réclamée par le fichier, si déclarée. */
  minAppVersion?: string;
}

// ==================== Bornes ====================

/**
 * Toutes les bornes en un seul endroit — c'est ce que le validateur applique et
 * ce que les tests citent. Elles sont larges pour l'usage honnête et fermes
 * pour le reste : aucune n'est là pour brider un auteur, toutes sont là pour
 * qu'un fichier hostile ne puisse pas faire travailler la machine indéfiniment.
 */
export const LAYOUT_LIMITS = {
  /** Blocs dans un fichier. Au-delà, la grille n'est plus une mise en page. */
  widgets: 120,
  name: 120,
  description: 600,
  /** Libellé d'un emplacement nommé : une phrase courte, lue par un humain. */
  slotLabel: 80,
  /** Icône : des points de code, pas des octets (un emoji en vaut plusieurs). */
  iconCodePoints: 4,
  category: 40,
  /** Identifiant du modèle, de ses blocs, et clés de `bindings`. */
  id: 64,
  /** Titre de secours d'un bloc. */
  title: 80,
  /** Profondeur maximale d'un objet de réglages. */
  optionsDepth: 4,
  /** Clés d'un objet de réglages, à chaque niveau. */
  optionsKeys: 32,
  /** Entrées d'un tableau de réglages. */
  optionsArray: 64,
  /** Longueur d'une chaîne de réglage. */
  optionsString: 240,
  /** Liaisons déclarées par un bloc. */
  bindings: 8,
  /** Entrées de `requires[]`. */
  requires: 8,
  /** Colonnes de la disposition maîtresse — miroir de `gridTypes`. */
  columns: 12,
  /** Rangées : un accueil de 400 rangées ne se lit pas, mais il ne casse rien. */
  rows: 400,
} as const;

// ==================== Le fichier ====================

/** Un emplacement NOMMÉ : ce qui remplace une liaison à l'export. */
export interface LayoutNamedSlot {
  /** Écrit pour un humain (« Votre dossier de projets »). JAMAIS un identifiant. */
  label: string;
  accepts: LayoutSlotAccepts;
}

/** La SEULE forme qu'une liaison peut prendre dans un fichier. */
export interface LayoutFileBinding {
  slot: LayoutNamedSlot;
}

export interface LayoutFileWidget {
  /** Identité du bloc DANS le fichier. Fabriquée à l'export (`w1`, `w2`…). */
  uid: string;
  /** `core:<id>` — voir `LAYOUT_CORE_PREFIX`. */
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Nom de secours, affiché quand le lecteur ne connaît pas ce bloc. */
  title?: string;
  /** Réglages GÉNÉRIQUES. Jamais une liaison à du contenu. */
  options?: Record<string, unknown>;
  /** Liaisons, sous la seule forme « emplacement nommé ». */
  bindings?: Record<string, LayoutFileBinding>;
}

export interface LayoutRequirement {
  kind: LayoutRequirementKind;
  minAppVersion?: string;
}

/**
 * Thème SUGGÉRÉ. Jamais imposé : appliquer le thème de l'auteur en même temps
 * que sa disposition ferait d'un essai de mise en page une reconfiguration de
 * l'application, et il faudrait deviner comment revenir en arrière.
 */
export interface LayoutThemeSuggestion {
  themeId: string;
  fontId: string;
}

export interface LayoutFile {
  kind: typeof LAYOUT_FILE_KIND;
  formatVersion: number;
  id: string;
  name: string;
  description: string;
  target: LayoutFileTarget;
  widgets: LayoutFileWidget[];
  theme?: LayoutThemeSuggestion;
  requires: LayoutRequirement[];
  version: number;
  icon?: string;
  category?: string;
}

// ==================== Mesures ====================

let encoder: TextEncoder | null = null;

/**
 * Taille en OCTETS UTF-8.
 *
 * `chaine.length` compte des unités UTF-16 : il sous-estime tout ce qui sort du
 * plan latin (un idéogramme = 1 unité, 3 octets) et se trompe d'un facteur 3
 * sur un fichier entièrement écrit en japonais. Le plafond porte sur ce qui est
 * réellement lu, donc sur des octets.
 */
export function utf8ByteLength(value: string): number {
  if (!encoder) encoder = new TextEncoder();
  return encoder.encode(value).length;
}

/** Points de code (et non unités UTF-16) — pour écrêter une icône emoji. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

// ==================== Grammaire des types ====================

/** Identifiant de widget acceptable : minuscules, chiffres, tirets. */
const CORE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `core:<id>` → `<id>`, ou `null` si ce n'est pas un type de widget légal. */
export function coreWidgetId(type: unknown): string | null {
  if (typeof type !== 'string') return null;
  if (!type.startsWith(LAYOUT_CORE_PREFIX)) return null;
  const id = type.slice(LAYOUT_CORE_PREFIX.length);
  return CORE_ID_RE.test(id) ? id : null;
}

/** `<id>` → `core:<id>`. Rend `null` si l'identifiant n'est pas exportable. */
export function coreType(id: string): string | null {
  return CORE_ID_RE.test(id) ? `${LAYOUT_CORE_PREFIX}${id}` : null;
}

// ==================== URL : nulle part, jamais ====================

/**
 * Une valeur qui RESSEMBLE à une URL, sous n'importe quelle forme.
 *
 * Aucun champ du format n'a de raison d'en contenir une : ni image distante, ni
 * lien d'auteur, ni « en savoir plus ». Un modèle est une disposition, pas une
 * page. Autoriser une seule URL quelque part, c'est autoriser un fichier
 * anodin à faire sortir une requête de la machine de celui qui l'ouvre — donc à
 * confirmer qu'il l'a ouvert, et à qui.
 *
 * Le test est volontairement LARGE (il attrape `//exemple`, `data:`,
 * `javascript:`, `www.`) : un faux positif coûte une chaîne refusée dans un
 * réglage, un faux négatif coûte une fuite.
 */
export function isUrlLike(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return true;
  if (/^\/\//.test(trimmed)) return true;
  if (/:\/\//.test(trimmed)) return true;
  if (/^(?:data|javascript|vbscript|file|blob|about|mailto|tel):/i.test(trimmed)) return true;
  if (/^www\./i.test(trimmed)) return true;
  return false;
}

/**
 * Une chaîne qui ressemble à un IDENTIFIANT plutôt qu'à un libellé.
 *
 * Sert au refus structurel du côté import : un « emplacement nommé » dont le
 * libellé serait un uuid transporterait exactement ce que la transformation
 * était censée retirer, avec un champ de plus pour le cacher.
 */
export function looksLikeIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
  if (/^[0-9a-f]{16,}$/i.test(trimmed)) return true;
  // Une suite compacte, longue, sans espace et sans lettre accentuée : c'est un
  // jeton, pas une phrase. Le seuil de 16 laisse passer « Documents 2026 » (qui
  // a un espace) comme « Sauvegardes » (qui est court).
  if (trimmed.length >= 16 && !/\s/.test(trimmed) && /^[A-Za-z0-9_-]+$/.test(trimmed)) return true;
  return false;
}

// ==================== Versions ====================

const VERSION_RE = /^\d{1,4}(?:\.\d{1,4}){0,2}$/;

export function isAppVersionString(value: unknown): value is string {
  return typeof value === 'string' && VERSION_RE.test(value);
}

/**
 * Compare deux versions `x.y.z`. Rend < 0, 0 ou > 0. Les composants manquants
 * valent 0 (`2.14` = `2.14.0`). Une chaîne illisible vaut `0.0.0` — ce module
 * ne lève jamais : il est appelé sur des données venues d'un fichier.
 */
export function compareAppVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const parts = VERSION_RE.test(v) ? v.split('.') : [];
    return [0, 1, 2].map((i) => Number.parseInt(parts[i] ?? '0', 10) || 0);
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

// ==================== Fabrication ====================

/**
 * Identité d'un modèle exporté. Aléatoire et sans rapport avec le coffre : elle
 * ne doit rien dire de qui l'a fabriqué. Deux exports de la même disposition
 * donnent deux modèles distincts, ce qui est correct — ce sont deux publications.
 */
export function newLayoutFileId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `lay-${Date.now().toString(36)}-${random}`;
}

/** Un identifiant de bloc DANS le fichier : positionnel, donc muet. */
export function widgetUid(index: number): string {
  return `w${index + 1}`;
}

/**
 * Recopie un objet de réglages en ne gardant que ce qui peut voyager :
 * scalaires JSON, tableaux et objets simples, dans les bornes de
 * `LAYOUT_LIMITS`. Tout le reste (fonction, `undefined`, cycle, URL, clé
 * dangereuse) est écarté SANS ERREUR — c'est un assainissement, pas une
 * validation : l'export ne doit jamais échouer parce qu'un réglage local était
 * exotique, il doit produire un fichier propre.
 */
export function sanitizeOptions(raw: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth >= LAYOUT_LIMITS.optionsDepth) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const key of Object.keys(raw)) {
    if (kept >= LAYOUT_LIMITS.optionsKeys) break;
    if (isForbiddenKey(key)) continue;
    if (key.length > LAYOUT_LIMITS.id) continue;
    const value = sanitizeOptionValue((raw as Record<string, unknown>)[key], depth + 1);
    if (value === undefined) continue;
    out[key] = value;
    kept += 1;
  }
  return kept > 0 ? out : undefined;
}

function sanitizeOptionValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    if (isUrlLike(value)) return undefined;
    return value.length > LAYOUT_LIMITS.optionsString
      ? value.slice(0, LAYOUT_LIMITS.optionsString)
      : value;
  }
  if (Array.isArray(value)) {
    if (depth >= LAYOUT_LIMITS.optionsDepth) return undefined;
    const out: unknown[] = [];
    for (const entry of value.slice(0, LAYOUT_LIMITS.optionsArray)) {
      const clean = sanitizeOptionValue(entry, depth + 1);
      if (clean !== undefined) out.push(clean);
    }
    return out;
  }
  if (typeof value === 'object') return sanitizeOptions(value, depth);
  return undefined;
}

/**
 * Les trois clés qui font d'un `JSON.parse` une prise de contrôle. Refusées à
 * n'importe quelle profondeur, par parcours explicite — voir le validateur.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

/**
 * Sérialise un fichier. Indenté : un `.filarrlayout` se lit, se relit et
 * s'inspecte à la main — c'est la première chose que fera quiconque hésite à
 * ouvrir celui d'un inconnu, et le format n'a rien à cacher.
 */
export function serializeLayoutFile(file: LayoutFile): string {
  return JSON.stringify(file, null, 2);
}

/** Nom de fichier proposé au dialogue d'enregistrement. */
export function suggestedFileName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48);
  return `${base || 'mise-en-page'}.${LAYOUT_FILE_EXTENSION}`;
}
