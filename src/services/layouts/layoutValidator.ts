/**
 * MODÈLES DE MISE EN PAGE — LE VALIDATEUR D'IMPORT.
 *
 * ── LE POSTULAT ─────────────────────────────────────────────────────────────
 *
 * Le fichier vient de quelqu'un d'autre. Pas d'un serveur qu'on contrôle, pas
 * d'un export qu'on a fabriqué : d'une pièce jointe, d'un forum, d'une clé USB.
 * Il est donc traité comme HOSTILE, du premier octet au dernier, et ce module
 * est la seule porte par laquelle il entre.
 *
 * Écrit à la main, sans `zod` ni `ajv` : le dépôt n'en a aucun, et en ajouter un
 * pour ce chantier ferait entrer une dépendance de plus dans le chemin le plus
 * sensible du produit. Écrit à la main, il est aussi PUR — ni React, ni store,
 * ni registre de widgets (la liste des types connus lui est DONNÉE) — donc
 * exécutable tel quel côté worker quand la v2 en ligne devra valider les mêmes
 * fichiers avec les mêmes règles. Un validateur qui ne serait pas partageable
 * finirait dupliqué, et deux copies divergent toujours.
 *
 * ── LES CINQ RÈGLES DURES ───────────────────────────────────────────────────
 *
 *  1. La chaîne est PLAFONNÉE en octets UTF-8 avant tout `JSON.parse`. Jamais
 *     de YAML, jamais d'`eval`, jamais de `new Function`.
 *  2. Aucune clé `__proto__` / `constructor` / `prototype`, à AUCUNE
 *     profondeur. Vérifié par parcours explicite avec `Object.keys`, et l'arbre
 *     est reconstruit sur `Object.create(null)` : même une clé qui traverserait
 *     le contrôle n'atteindrait pas un prototype.
 *  3. Aucune valeur de type URL, nulle part.
 *  4. Un type de widget ne peut être qu'un `core:<id>` du registre CLOS. Jamais
 *     un chemin de module, jamais un composant arbitraire.
 *  5. `requires[].kind === 'plugin'` est RÉSERVÉ et refusé en v1, avec un
 *     message qui le dit. L'écrire coûte dix lignes aujourd'hui et évite un
 *     changement de format cassant le jour où les greffons pourront en fournir.
 *
 * ── LA PARTITION, ET POURQUOI ELLE N'EST PAS UN FILTRE ──────────────────────
 *
 * Un widget inconnu n'est PAS une erreur : c'est un bloc d'une version plus
 * récente. Le supprimer en silence ferait d'un import un appauvrissement
 * invisible — l'utilisateur verrait « importé » et aurait perdu trois blocs
 * sans qu'aucune ligne ne le dise. Le validateur partitionne donc :
 *
 *   · `ok`       — bien formé, et le registre sait le rendre ;
 *   · `unknown`  — bien formé, mais absent de CE binaire. CONSERVÉ. Il occupera
 *                  son rectangle en tuile inerte et se réhydratera tout seul le
 *                  jour où la capacité arrive ;
 *   · `rejected` — forme illégale. Écarté, mais COMPTÉ, pour que le
 *                  récapitulatif d'import puisse dire « 12 appliqués, 1 en
 *                  attente, 1 ignoré » au lieu de mentir par omission.
 */

import {
  LAYOUT_FILE_FORMAT_VERSION,
  LAYOUT_FILE_KIND,
  LAYOUT_FILE_MAX_BYTES,
  LAYOUT_FILE_TARGETS,
  LAYOUT_LIMITS,
  LAYOUT_SLOT_ACCEPTS,
  codePointLength,
  coreWidgetId,
  isAppVersionString,
  isForbiddenKey,
  isUrlLike,
  looksLikeIdentifier,
  utf8ByteLength,
  type LayoutFile,
  type LayoutFileBinding,
  type LayoutFileTarget,
  type LayoutFileWidget,
  type LayoutRequirement,
  type LayoutSlotAccepts,
  type LayoutThemeSuggestion,
} from './layoutFormat';

// ==================== Ce que le validateur rend ====================

/** Un refus qui porte sur le FICHIER : rien n'est utilisable. */
export type LayoutFileErrorCode =
  | 'not-a-string'
  | 'too-large'
  | 'not-json'
  | 'not-object'
  | 'forbidden-key'
  | 'bad-kind'
  | 'unsupported-version'
  | 'bad-header'
  | 'bad-requires'
  | 'plugin-required'
  | 'no-widgets';

/** Un refus qui porte sur UN bloc : le reste du fichier survit. */
export type LayoutWidgetRejectCode =
  | 'not-object'
  | 'bad-uid'
  | 'duplicate-uid'
  | 'bad-type'
  | 'bad-geometry'
  | 'bad-title'
  | 'bad-options'
  | 'bad-bindings'
  | 'binding-identifier'
  | 'url-value'
  | 'over-limit';

export interface LayoutRejectedWidget {
  /** Position dans le tableau d'origine — la seule identité sûre d'un rebut. */
  index: number;
  /** Son `uid`, s'il en avait un de lisible. */
  uid: string | null;
  code: LayoutWidgetRejectCode;
}

export interface LayoutValidationOk {
  status: 'ok';
  /**
   * Le fichier RECONSTRUIT : en-tête assaini, `widgets` = `ok` puis `unknown`,
   * dans l'ordre d'origine. C'est CET objet qu'on stocke et qu'on applique —
   * jamais celui que `JSON.parse` a rendu.
   */
  file: LayoutFile;
  ok: LayoutFileWidget[];
  unknown: LayoutFileWidget[];
  rejected: LayoutRejectedWidget[];
}

export interface LayoutValidationError {
  status: 'error';
  code: LayoutFileErrorCode;
}

export type LayoutValidation = LayoutValidationOk | LayoutValidationError;

export interface LayoutValidateOptions {
  /**
   * Les identifiants de widgets que CE binaire sait rendre (`greeting`,
   * `pins`…), sans le préfixe `core:`. Donnés et non importés : c'est ce qui
   * garde ce module pur et exécutable côté serveur, où aucun composant React
   * n'existe.
   */
  knownTypes: ReadonlySet<string>;
}

// ==================== Outillage ====================

type Dict = Record<string, unknown>;

function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * PARCOURS EXPLICITE de tout l'arbre : refuse les trois clés dangereuses à
 * n'importe quelle profondeur et RECONSTRUIT chaque objet sur `Object.create(null)`.
 *
 * Pourquoi reconstruire alors qu'on refuse déjà ? Parce que les deux protègent
 * de choses différentes. Le refus attrape le fichier hostile ; la
 * reconstruction attrape TOUT LE RESTE — un objet sans prototype n'a ni
 * `toString`, ni `hasOwnProperty`, ni `valueOf` empruntés, donc aucun de nos
 * accès ultérieurs (`raw.name`, `Object.keys`) ne peut ramener une valeur qui
 * ne vient pas du fichier. `JSON.parse` seul rend des objets qui héritent de
 * `Object.prototype` : `parsed.constructor` y répond quelque chose même quand
 * le fichier ne dit rien.
 *
 * Rend `null` si une clé interdite a été rencontrée.
 */
export function safeReviveTree(value: unknown, depth = 0): { value: unknown } | null {
  // 32 : bien au-delà de toute donnée légitime de ce format, et assez bas pour
  // qu'un JSON profondément imbriqué ne fasse pas déborder la pile ici.
  if (depth > 32) return null;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const entry of value) {
      const revived = safeReviveTree(entry, depth + 1);
      if (!revived) return null;
      out.push(revived.value);
    }
    return { value: out };
  }
  if (isPlainObject(value)) {
    const out = Object.create(null) as Dict;
    for (const key of Object.keys(value)) {
      if (isForbiddenKey(key)) return null;
      const revived = safeReviveTree(value[key], depth + 1);
      if (!revived) return null;
      out[key] = revived.value;
    }
    return { value: out };
  }
  return { value };
}

/** Une chaîne bornée, non vide, sans URL. */
function readText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '' || value.length > max) return null;
  if (isUrlLike(value)) return null;
  return value;
}

/** Un entier fini dans un intervalle fermé. */
function readInt(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw)) return null;
  if (raw < min || raw > max) return null;
  return raw;
}

/** Aucune URL nulle part, à n'importe quelle profondeur. */
function containsUrl(value: unknown, depth = 0): boolean {
  if (depth > 32) return true;
  if (typeof value === 'string') return isUrlLike(value);
  if (Array.isArray(value)) return value.some((entry) => containsUrl(entry, depth + 1));
  if (isPlainObject(value)) {
    return Object.keys(value).some((key) => isUrlLike(key) || containsUrl(value[key], depth + 1));
  }
  return false;
}

// ==================== Réglages ====================

/**
 * Relit un objet de réglages. Contrairement à l'assainissement d'export, on ne
 * RÉPARE rien ici : un réglage hors bornes fait REJETER le bloc. Un fichier
 * étranger qui décrit mal ses réglages décrit peut-être mal autre chose, et
 * réparer silencieusement en ferait un bloc dont personne n'a écrit le contenu.
 */

/** Sentinelle : `undefined` est une valeur possible, l'échec ne peut pas l'être. */
const FAIL = Symbol('option-rejected');

function readOptions(raw: unknown, depth = 0): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null;
  if (depth >= LAYOUT_LIMITS.optionsDepth) return null;
  const keys = Object.keys(raw);
  if (keys.length > LAYOUT_LIMITS.optionsKeys) return null;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === '' || key.length > LAYOUT_LIMITS.id) return null;
    const value = readOptionValue(raw[key], depth + 1);
    if (value === FAIL) return null;
    out[key] = value;
  }
  return out;
}

function readOptionValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : FAIL;
  if (typeof value === 'string') {
    if (value.length > LAYOUT_LIMITS.optionsString) return FAIL;
    if (isUrlLike(value)) return FAIL;
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= LAYOUT_LIMITS.optionsDepth) return FAIL;
    if (value.length > LAYOUT_LIMITS.optionsArray) return FAIL;
    const out: unknown[] = [];
    for (const entry of value) {
      const clean = readOptionValue(entry, depth + 1);
      if (clean === FAIL) return FAIL;
      out.push(clean);
    }
    return out;
  }
  if (isPlainObject(value)) {
    const nested = readOptions(value, depth);
    return nested === null ? FAIL : nested;
  }
  return FAIL;
}

// ==================== Liaisons ====================

const BINDING_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

/**
 * LA RÈGLE STRUCTURELLE DE LA VIE PRIVÉE.
 *
 * Une liaison ne peut être QUE `{ slot: { label, accepts } }`. Pas une chaîne,
 * pas un objet avec un champ de plus, pas un `slot` accompagné d'un `folderId`
 * « au cas où ». Toute autre forme fait rejeter le bloc.
 *
 * C'est ce qui rend la promesse tenable pour un fichier qu'on n'a PAS fabriqué :
 * notre dialogue d'export vide ou remplace les liaisons, mais rien n'oblige un
 * fichier venu d'ailleurs à être passé par notre dialogue. La garantie ne peut
 * donc pas vivre à l'export — elle vit ici, à la lecture, où elle s'applique à
 * tout le monde.
 *
 * Rend le code de rejet, ou `null` si la liaison est acceptable.
 */
function readBindings(
  raw: unknown
): { value: Record<string, LayoutFileBinding> } | LayoutWidgetRejectCode {
  if (!isPlainObject(raw)) return 'bad-bindings';
  const keys = Object.keys(raw);
  if (keys.length === 0 || keys.length > LAYOUT_LIMITS.bindings) return 'bad-bindings';
  const out: Record<string, LayoutFileBinding> = {};
  for (const key of keys) {
    if (!BINDING_KEY_RE.test(key)) return 'bad-bindings';
    const entry = raw[key];
    // Le cas qui compte : `{ folderId: 'a3f…' }`. Un identifiant en clair,
    // exactement ce que le format interdit de transporter.
    if (typeof entry === 'string') return 'binding-identifier';
    if (!isPlainObject(entry)) return 'bad-bindings';
    const entryKeys = Object.keys(entry);
    // EXACTEMENT `slot`, et rien d'autre : un champ compagnon serait la
    // cachette évidente pour l'identifiant qu'on vient d'interdire.
    if (entryKeys.length !== 1 || entryKeys[0] !== 'slot') return 'binding-identifier';
    const slot = entry.slot;
    if (!isPlainObject(slot)) return 'bad-bindings';
    const slotKeys = Object.keys(slot).sort();
    if (slotKeys.length !== 2 || slotKeys[0] !== 'accepts' || slotKeys[1] !== 'label') {
      return 'binding-identifier';
    }
    const label = readText(slot.label, LAYOUT_LIMITS.slotLabel);
    if (label === null) return 'bad-bindings';
    // Un libellé qui est un jeton n'est pas un libellé : c'est l'identifiant
    // qu'on a interdit, déguisé en texte.
    if (looksLikeIdentifier(label)) return 'binding-identifier';
    const accepts = slot.accepts;
    if (
      typeof accepts !== 'string' ||
      !LAYOUT_SLOT_ACCEPTS.includes(accepts as LayoutSlotAccepts)
    ) {
      return 'bad-bindings';
    }
    out[key] = { slot: { label, accepts: accepts as LayoutSlotAccepts } };
  }
  return { value: out };
}

// ==================== Un bloc ====================

function readWidget(
  raw: unknown,
  index: number,
  seen: Set<string>
): { widget: LayoutFileWidget; coreId: string } | LayoutRejectedWidget {
  const reject = (
    code: LayoutWidgetRejectCode,
    uid: string | null = null
  ): LayoutRejectedWidget => ({ index, uid, code });

  if (!isPlainObject(raw)) return reject('not-object');

  const uid = readText(raw.uid, LAYOUT_LIMITS.id);
  if (uid === null || !/^[A-Za-z0-9_-]+$/.test(uid)) return reject('bad-uid');
  if (seen.has(uid)) return reject('duplicate-uid', uid);

  const coreId = coreWidgetId(raw.type);
  if (coreId === null) return reject('bad-type', uid);

  const x = readInt(raw.x, 0, LAYOUT_LIMITS.columns - 1);
  const y = readInt(raw.y, 0, LAYOUT_LIMITS.rows);
  const w = readInt(raw.w, 1, LAYOUT_LIMITS.columns);
  const h = readInt(raw.h, 1, LAYOUT_LIMITS.rows);
  if (x === null || y === null || w === null || h === null) return reject('bad-geometry', uid);
  // Un bloc qui déborde de la grille maîtresse ne décrit aucune disposition
  // affichable : le solveur le repousserait ailleurs, et la mise en page rendue
  // ne serait plus celle que l'auteur a dessinée.
  if (x + w > LAYOUT_LIMITS.columns) return reject('bad-geometry', uid);

  const widget: LayoutFileWidget = { uid, type: raw.type as string, x, y, w, h };

  if (raw.title !== undefined) {
    const title = readText(raw.title, LAYOUT_LIMITS.title);
    if (title === null) return reject('bad-title', uid);
    widget.title = title;
  }

  if (raw.options !== undefined) {
    const options = readOptions(raw.options);
    if (options === null) return reject('bad-options', uid);
    if (containsUrl(options)) return reject('url-value', uid);
    if (Object.keys(options).length > 0) widget.options = options;
  }

  if (raw.bindings !== undefined) {
    const bindings = readBindings(raw.bindings);
    if (typeof bindings === 'string') return reject(bindings, uid);
    widget.bindings = bindings.value;
  }

  return { widget, coreId };
}

// ==================== L'en-tête ====================

function readTheme(raw: unknown): LayoutThemeSuggestion | null {
  if (!isPlainObject(raw)) return null;
  const themeId = readText(raw.themeId, LAYOUT_LIMITS.id);
  const fontId = readText(raw.fontId, LAYOUT_LIMITS.id);
  if (themeId === null || fontId === null) return null;
  return { themeId, fontId };
}

/**
 * `requires[]`. Rend un code d'erreur FATAL, parce qu'une exigence mal lue ne
 * peut pas être ignorée : c'est précisément le champ qui dit ce que le fichier
 * a besoin de trouver pour signifier ce qu'il prétend signifier.
 */
function readRequires(raw: unknown): { value: LayoutRequirement[] } | LayoutFileErrorCode {
  if (raw === undefined) return { value: [{ kind: 'core' }] };
  if (!Array.isArray(raw) || raw.length > LAYOUT_LIMITS.requires) return 'bad-requires';
  const out: LayoutRequirement[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) return 'bad-requires';
    const kind = entry.kind;
    // RÉSERVÉ POUR LA SUITE, refusé maintenant, et dit franchement. Un modèle
    // qui réclame un greffon décrit une disposition qu'on ne saurait pas rendre
    // — l'appliquer en ignorant l'exigence donnerait une page trouée dont
    // personne ne saurait dire ce qui manque.
    if (kind === 'plugin') return 'plugin-required';
    if (kind !== 'core') return 'bad-requires';
    const requirement: LayoutRequirement = { kind: 'core' };
    if (entry.minAppVersion !== undefined) {
      if (!isAppVersionString(entry.minAppVersion)) return 'bad-requires';
      requirement.minAppVersion = entry.minAppVersion;
    }
    out.push(requirement);
  }
  return { value: out.length > 0 ? out : [{ kind: 'core' }] };
}

// ==================== La porte ====================

/**
 * Valide une CHAÎNE lue sur le disque (ou reçue du réseau, demain).
 *
 * L'entrée est bien la chaîne et pas un objet déjà analysé : le plafond de
 * taille et le refus du `JSON.parse` hostile n'ont de sens qu'avant l'analyse,
 * et un appelant qui aurait déjà parsé aurait déjà payé le coût qu'on cherche à
 * éviter.
 */
export function validateLayoutFile(raw: unknown, options: LayoutValidateOptions): LayoutValidation {
  if (typeof raw !== 'string') return { status: 'error', code: 'not-a-string' };
  // EN OCTETS, avant tout le reste.
  if (utf8ByteLength(raw) > LAYOUT_FILE_MAX_BYTES) return { status: 'error', code: 'too-large' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'error', code: 'not-json' };
  }

  const revived = safeReviveTree(parsed);
  if (!revived) return { status: 'error', code: 'forbidden-key' };
  const doc = revived.value;
  if (!isPlainObject(doc)) return { status: 'error', code: 'not-object' };

  if (doc.kind !== LAYOUT_FILE_KIND) return { status: 'error', code: 'bad-kind' };
  if (doc.formatVersion !== LAYOUT_FILE_FORMAT_VERSION) {
    return { status: 'error', code: 'unsupported-version' };
  }

  const id = readText(doc.id, LAYOUT_LIMITS.id);
  const name = readText(doc.name, LAYOUT_LIMITS.name);
  if (id === null || name === null) return { status: 'error', code: 'bad-header' };

  const target = doc.target;
  if (typeof target !== 'string' || !LAYOUT_FILE_TARGETS.includes(target as LayoutFileTarget)) {
    return { status: 'error', code: 'bad-header' };
  }

  // La description est facultative mais jamais absente du modèle rendu : une
  // chaîne vide se rend, un `undefined` se teste partout où il passe.
  let description = '';
  if (doc.description !== undefined && doc.description !== '') {
    const read = readText(doc.description, LAYOUT_LIMITS.description);
    if (read === null) return { status: 'error', code: 'bad-header' };
    description = read;
  }

  const version = readInt(doc.version === undefined ? 1 : doc.version, 1, 100000);
  if (version === null) return { status: 'error', code: 'bad-header' };

  const requires = readRequires(doc.requires);
  if (typeof requires === 'string') return { status: 'error', code: requires };

  const file: LayoutFile = {
    kind: LAYOUT_FILE_KIND,
    formatVersion: LAYOUT_FILE_FORMAT_VERSION,
    id,
    name,
    description,
    target: target as LayoutFileTarget,
    widgets: [],
    requires: requires.value,
    version,
  };

  if (doc.theme !== undefined) {
    const theme = readTheme(doc.theme);
    // Une suggestion illisible est OUBLIÉE, pas fatale : elle n'est qu'une
    // suggestion, et refuser tout un modèle pour un nom de thème mal écrit
    // serait disproportionné.
    if (theme) file.theme = theme;
  }

  if (doc.icon !== undefined) {
    const icon = typeof doc.icon === 'string' ? doc.icon.trim() : '';
    if (icon !== '' && !isUrlLike(icon) && codePointLength(icon) <= LAYOUT_LIMITS.iconCodePoints) {
      file.icon = icon;
    }
  }

  if (doc.category !== undefined) {
    const category = readText(doc.category, LAYOUT_LIMITS.category);
    if (category !== null) file.category = category;
  }

  if (!Array.isArray(doc.widgets)) return { status: 'error', code: 'no-widgets' };
  if (doc.widgets.length === 0) return { status: 'error', code: 'no-widgets' };

  const ok: LayoutFileWidget[] = [];
  const unknown: LayoutFileWidget[] = [];
  const rejected: LayoutRejectedWidget[] = [];
  const seen = new Set<string>();

  doc.widgets.forEach((entry, index) => {
    if (ok.length + unknown.length >= LAYOUT_LIMITS.widgets) {
      // Au-delà du plafond, les blocs restants sont COMPTÉS et non ignorés : le
      // récapitulatif dira qu'il en manque, ce qui vaut mieux qu'une mise en
      // page tronquée dont l'auteur croirait qu'elle est arrivée entière.
      rejected.push({ index, uid: null, code: 'over-limit' });
      return;
    }
    const result = readWidget(entry, index, seen);
    if ('code' in result) {
      rejected.push(result);
      return;
    }
    seen.add(result.widget.uid);
    if (options.knownTypes.has(result.coreId)) ok.push(result.widget);
    else unknown.push(result.widget);
  });

  if (ok.length === 0 && unknown.length === 0) return { status: 'error', code: 'no-widgets' };

  // L'ORDRE D'ORIGINE est conservé : la géométrie est absolue, mais l'ordre du
  // tableau décide de l'empilement au rendu et de la lecture au clavier.
  const byUid = new Map<string, LayoutFileWidget>();
  for (const widget of [...ok, ...unknown]) byUid.set(widget.uid, widget);
  file.widgets = [];
  for (const entry of doc.widgets) {
    if (!isPlainObject(entry) || typeof entry.uid !== 'string') continue;
    const widget = byUid.get(entry.uid.trim());
    if (widget && !file.widgets.includes(widget)) file.widgets.push(widget);
  }

  return { status: 'ok', file, ok, unknown, rejected };
}

/**
 * Le récapitulatif chiffré d'un import — « 12 appliqués, 1 en attente,
 * 1 ignoré ». Calculé ici pour que l'interface n'ait pas à recompter, et pour
 * que le test puisse vérifier les trois nombres au même endroit.
 */
export function importSummary(result: LayoutValidationOk): {
  applied: number;
  pending: number;
  ignored: number;
} {
  return {
    applied: result.ok.length,
    pending: result.unknown.length,
    ignored: result.rejected.length,
  };
}
