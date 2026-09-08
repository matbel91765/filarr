/**
 * Fusion du CONTENEUR DE MISE EN PAGE — COPIE WEB de
 * `electron/sync/layoutMergeCore.ts`, ligne pour ligne à partir d'ici.
 *
 * ── POURQUOI UNE COPIE, ET PAS UN IMPORT ────────────────────────────────────
 * Même motif que `notesMerge.ts`, et même raison que celle écrite en tête du
 * module d'origine : le processus principal se compile avec
 * `electron/tsconfig.json`, dont la racine est `electron/`. Importer un module
 * de `src/` (ou l'inverse) déplacerait la racine commune du programme et donc
 * TOUTE l'arborescence émise dans `dist-electron`, ce qui casse
 * `package.json#main`. Le paquet web, symétriquement, ne peut pas embarquer un
 * module d'`electron/` : il n'est pas dans son programme de compilation.
 *
 * LA DUPLICATION EST DONC ASSUMÉE, ET ELLE EST SURVEILLÉE. Deux implémentations
 * de la même règle qui divergent, c'est un appareil qui arbitre autrement qu'un
 * autre : la disposition de l'un écrase celle de l'autre, ou la copie perdante
 * n'est pas conservée du même côté. `__tests__/layoutMergeParity.vitest.ts`
 * fait donc tourner les DEUX moteurs sur le même corpus et exige des documents
 * IDENTIQUES OCTET POUR OCTET (`JSON.stringify` du résultat), en plus de
 * l'égalité des constantes de protocole. Toute retouche ici doit être portée
 * là-bas, et réciproquement — le test le prouve ou casse.
 *
 * Le reste de ce fichier est la copie conforme du module d'origine ; son
 * en-tête de conception (modèle INSTANCE vs GABARIT, grain de fusion, LWW
 * strict, dispositions perdantes) y fait toujours foi.
 */

// ── Constantes de protocole ─────────────────────────────────────────────────

/** Clé de l'entrée de mise en page dans le manifeste de synchronisation. */
export const LAYOUT_META_FILE_ID = 'meta:layout';

/** Ressource passée à `notifyMetadataChanged` (qui préfixe par `meta:`). */
export const LAYOUT_META_RESOURCE_ID = 'layout';

/** Nom du blob scellé sur le disque, à la racine du dossier de profil. */
export const LAYOUT_BLOB_FILENAME = 'layout.enc';

/** Version de FORMAT du conteneur (pas une version de règle de fusion). */
export const LAYOUT_SCHEMA_VERSION = 1;

/** Durée de vie d'une disposition perdante conservée après arbitrage. */
export const SUPERSEDED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Plafond de dispositions perdantes conservées pour UNE vue. */
export const SUPERSEDED_MAX_PER_VIEW = 5;

/**
 * Horloge des vues issues de l'AMORÇAGE, jamais touchées par l'utilisateur.
 *
 * POURQUOI L'ÉPOQUE. Deux appareils peuvent amorcer en même temps (le second
 * n'a pas encore vu le manifeste distant). Si la vue amorcée portait l'heure de
 * l'amorçage, elle serait STRICTEMENT plus fraîche que la disposition réelle,
 * patiemment construite ailleurs — et l'écraserait. Datée de l'époque, elle
 * perd contre n'importe quelle vue lisible et ne gagne que là où le nuage n'a
 * RIEN. Le premier geste de l'utilisateur lui rend une vraie horloge.
 */
export const LAYOUT_SEED_CLOCK = '1970-01-01T00:00:00.000Z';

/**
 * Rôles connus à ce jour. La liste est INDICATIVE, jamais contraignante :
 * `LayoutSlotRole` reste un `string` pour qu'un gabarit venu de la place de
 * marché (ou d'une version plus récente) traverse la fusion et le disque sans
 * être amputé de ses emplacements inconnus.
 */
export const KNOWN_SLOT_ROLES = [
  'recents',
  'favorites',
  'folder-grid',
  'stats',
  'notes',
  'tasks',
  'calendar',
  'quick-actions',
  'search',
  'storage',
] as const;

// ── Types ───────────────────────────────────────────────────────────────────

/** Rôle SYMBOLIQUE d'un emplacement — jamais un identifiant local. */
export type LayoutSlotRole = string;

/**
 * Identifiant de vue : `home`, `folder:<uuid>`, `home:alt`. Le préfixe dit la
 * FAMILLE, ce qui suit est local à cet appareil-ci — d'où la règle « une vue ne
 * s'exporte jamais telle quelle ».
 */
export type LayoutViewId = string;

/** Un bloc posé dans une vue. */
export interface LayoutSlot {
  /** Identité stable du bloc DANS la vue (uuid) — pas un identifiant de dossier. */
  id: string;
  role: LayoutSlotRole;
  /** Composant de rendu. Distinct du rôle : deux types peuvent servir un rôle. */
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Réglages du bloc, opaques pour la fusion. */
  options?: Record<string, unknown>;
  /**
   * Attaches LOCALES (`folderId`, `noteId`, `tagId`…). C'est CE champ qui rend
   * une instance non exportable, et c'est lui que `instantiate` reconstruit à
   * partir du contexte quand on pose un gabarit.
   */
  binding?: Record<string, string>;
}

/** Une disposition écartée par l'arbitrage, gardée le temps qu'on la réclame. */
export interface SupersededLayout {
  slots: LayoutSlot[];
  /** Horloge de la version perdante, telle qu'elle était. */
  updatedAt: string;
  /** Instant de la mise de côté (c'est LUI qui décide de l'expiration). */
  savedAt: string;
  /** D'où venait la perdante : `local` = cet appareil, `remote` = le nuage. */
  side: 'local' | 'remote';
}

/** L'INSTANCE : ce qui est réellement affiché, et ce qui se synchronise. */
export interface LayoutView {
  id: LayoutViewId;
  slots: LayoutSlot[];
  /** HORLOGE PROPRE À CETTE ENTRÉE — la seule chose que la fusion arbitre. */
  updatedAt: string;
  /** Gabarit dont cette vue est issue, s'il y en a un. */
  templateId?: string;
  /** Dispositions perdantes conservées (30 jours). */
  superseded?: SupersededLayout[];
}

/** Emplacement d'un GABARIT : un rôle et une géométrie, jamais une attache. */
export interface LayoutTemplateSlot {
  role: LayoutSlotRole;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  options?: Record<string, unknown>;
}

/** Le GABARIT : partageable, sans le moindre identifiant local. */
export interface LayoutTemplate {
  id: string;
  name: string;
  slots: LayoutTemplateSlot[];
  updatedAt: string;
  /** Version du gabarit chez son auteur (place de marché). */
  version?: number;
  author?: string;
}

/** Le conteneur scellé dans `layout.enc`. */
export interface LayoutDocument {
  schema: number;
  views: Record<LayoutViewId, LayoutView>;
  /** Gabarits installés — même arbitrage LWW, au grain du gabarit. */
  templates: Record<string, LayoutTemplate>;
  /**
   * AMORÇAGE FAIT, marqué DANS le conteneur et pas en `localStorage` : la
   * marque doit survivre à `clearProfile()` et à un vidage du navigateur, sans
   * quoi un profil ré-amorcerait un document concurrent à chaque réinitialisation.
   */
  seededAt?: string;
  /** Dernier écrivain — informatif, jamais arbitré. */
  updatedAt?: string;
}

export interface LayoutMergeResult {
  merged: LayoutDocument;
  /** La fusion diffère du LOCAL → il faut réécrire `layout.enc`. */
  changedFromLocal: boolean;
  /** La fusion diffère du DISTANT → le local porte du neuf à pousser. */
  changedFromRemote: boolean;
  /** Vues dont l'arbitrage a écarté une disposition (une copie est conservée). */
  conflicts: LayoutViewId[];
}

// ── Outillage pur ───────────────────────────────────────────────────────────

type Dict = Record<string, unknown>;

function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const has = (o: Dict, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Comparaison structurelle insensible à l'ordre des CLÉS (l'ordre des tableaux compte). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) {
      if (!has(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return a !== a && b !== b; // NaN
}

/**
 * Horloge d'une entrée. Une horloge ABSENTE ou illisible vaut -∞ : elle n'est
 * PAS autoritaire, et c'est délibéré — un document écrit par une version qui
 * ignore `updatedAt` ne doit jamais pouvoir effacer une disposition datée.
 */
export function clockOf(entry: unknown): number {
  if (!isPlainObject(entry)) return -Infinity;
  const raw = entry.updatedAt;
  if (typeof raw !== 'string') return -Infinity;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? -Infinity : ms;
}

/** Horodatage ISO exploitable en millisecondes, ou `null`. */
function parseIso(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

// ── Normalisation défensive ─────────────────────────────────────────────────

function normalizeSlot(raw: unknown): LayoutSlot | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const slot: LayoutSlot = {
    id: raw.id,
    role: typeof raw.role === 'string' ? raw.role : 'custom',
    type: typeof raw.type === 'string' ? raw.type : 'unknown',
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: num(raw.w, 1),
    h: num(raw.h, 1),
  };
  if (isPlainObject(raw.options)) slot.options = raw.options;
  if (isPlainObject(raw.binding)) {
    const binding: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.binding)) {
      if (typeof v === 'string') binding[k] = v;
    }
    slot.binding = binding;
  }
  return slot;
}

function normalizeSlots(raw: unknown): LayoutSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutSlot[] = [];
  for (const entry of raw) {
    const slot = normalizeSlot(entry);
    if (slot) out.push(slot);
  }
  return out;
}

function normalizeSuperseded(raw: unknown): SupersededLayout[] {
  if (!Array.isArray(raw)) return [];
  const out: SupersededLayout[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    out.push({
      slots: normalizeSlots(entry.slots),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : LAYOUT_SEED_CLOCK,
      savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : LAYOUT_SEED_CLOCK,
      side: entry.side === 'remote' ? 'remote' : 'local',
    });
  }
  return out;
}

function normalizeView(id: string, raw: unknown): LayoutView | null {
  if (!isPlainObject(raw)) return null;
  const view: LayoutView = {
    id,
    slots: normalizeSlots(raw.slots),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : LAYOUT_SEED_CLOCK,
  };
  if (typeof raw.templateId === 'string') view.templateId = raw.templateId;
  const superseded = normalizeSuperseded(raw.superseded);
  if (superseded.length > 0) view.superseded = superseded;
  return view;
}

function normalizeTemplate(id: string, raw: unknown): LayoutTemplate | null {
  if (!isPlainObject(raw)) return null;
  const slots: LayoutTemplateSlot[] = [];
  if (Array.isArray(raw.slots)) {
    for (const entry of raw.slots) {
      if (!isPlainObject(entry)) continue;
      const num = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      const slot: LayoutTemplateSlot = {
        role: typeof entry.role === 'string' ? entry.role : 'custom',
        type: typeof entry.type === 'string' ? entry.type : 'unknown',
        x: num(entry.x, 0),
        y: num(entry.y, 0),
        w: num(entry.w, 1),
        h: num(entry.h, 1),
      };
      if (isPlainObject(entry.options)) slot.options = entry.options;
      slots.push(slot);
    }
  }
  const template: LayoutTemplate = {
    id,
    name: typeof raw.name === 'string' ? raw.name : id,
    slots,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : LAYOUT_SEED_CLOCK,
  };
  if (typeof raw.version === 'number') template.version = raw.version;
  if (typeof raw.author === 'string') template.author = raw.author;
  return template;
}

/** Le document VIDE — jamais amorcé, jamais écrit tel quel sans décision. */
export function createEmptyLayoutDocument(): LayoutDocument {
  return { schema: LAYOUT_SCHEMA_VERSION, views: {}, templates: {} };
}

/**
 * Relit un JSON arbitraire (venu du disque ou du nuage) comme un document de
 * mise en page. RIEN n'est jeté par méfiance : un rôle inconnu, un type inconnu
 * ou une option exotique traversent intacts — seules les formes irrécupérables
 * (une vue qui n'est pas un objet, un emplacement sans identité) sont écartées,
 * parce qu'elles ne désignent rien qu'on puisse afficher.
 */
export function normalizeLayoutDocument(raw: unknown): LayoutDocument {
  const doc = createEmptyLayoutDocument();
  if (!isPlainObject(raw)) return doc;
  if (typeof raw.schema === 'number') doc.schema = raw.schema;
  if (isPlainObject(raw.views)) {
    for (const [id, value] of Object.entries(raw.views)) {
      const view = normalizeView(id, value);
      if (view) doc.views[id] = view;
    }
  }
  if (isPlainObject(raw.templates)) {
    for (const [id, value] of Object.entries(raw.templates)) {
      const template = normalizeTemplate(id, value);
      if (template) doc.templates[id] = template;
    }
  }
  if (typeof raw.seededAt === 'string') doc.seededAt = raw.seededAt;
  if (typeof raw.updatedAt === 'string') doc.updatedAt = raw.updatedAt;
  return doc;
}

// ── Dispositions perdantes ──────────────────────────────────────────────────

/** Deux copies perdantes sont la même si elles disent la même chose au même instant. */
const supersededKey = (entry: SupersededLayout): string =>
  `${entry.side}|${entry.updatedAt}|${JSON.stringify(entry.slots)}`;

/**
 * Union, expiration (30 jours d'après `savedAt`) et plafond. La plus RÉCENTE
 * survit au plafond : c'est celle que l'utilisateur a la moindre chance
 * d'avoir oubliée.
 */
export function pruneSuperseded(entries: SupersededLayout[], nowMs: number): SupersededLayout[] {
  const floor = nowMs - SUPERSEDED_TTL_MS;
  const seen = new Set<string>();
  const kept: SupersededLayout[] = [];
  for (const entry of entries) {
    const savedAt = parseIso(entry.savedAt);
    if (savedAt === null || savedAt < floor) continue;
    const key = supersededKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  kept.sort((a, b) => (parseIso(b.savedAt) ?? 0) - (parseIso(a.savedAt) ?? 0));
  return kept.slice(0, SUPERSEDED_MAX_PER_VIEW);
}

/**
 * Applique l'expiration à TOUT le document. Rend `true` si quelque chose a
 * changé — l'appelant n'écrit que dans ce cas (une purge qui réécrirait le
 * fichier à chaque lecture ferait repartir un cycle de sync pour rien).
 */
export function pruneDocumentSuperseded(doc: LayoutDocument, nowMs: number): boolean {
  let changed = false;
  for (const view of Object.values(doc.views)) {
    if (!view.superseded || view.superseded.length === 0) continue;
    const kept = pruneSuperseded(view.superseded, nowMs);
    if (kept.length === view.superseded.length && deepEqual(kept, view.superseded)) continue;
    changed = true;
    if (kept.length === 0) delete view.superseded;
    else view.superseded = kept;
  }
  return changed;
}

// ── Fusion ──────────────────────────────────────────────────────────────────

/** La SUBSTANCE d'une vue : ce qui s'affiche, sans l'horloge ni les archives. */
function sameViewBody(a: LayoutView, b: LayoutView): boolean {
  return deepEqual(a.slots, b.slots) && a.templateId === b.templateId;
}

/** Idem pour un gabarit. */
function sameTemplateBody(a: LayoutTemplate, b: LayoutTemplate): boolean {
  return (
    deepEqual(a.slots, b.slots) &&
    a.name === b.name &&
    a.version === b.version &&
    a.author === b.author
  );
}

function toSuperseded(
  view: LayoutView,
  side: 'local' | 'remote',
  nowIso: string
): SupersededLayout {
  return { slots: view.slots, updatedAt: view.updatedAt, savedAt: nowIso, side };
}

/**
 * Arbitrage d'UNE vue présente des deux côtés.
 *
 * Contenus identiques : rien n'est en jeu, on adopte simplement l'horloge la
 * plus fraîche — sans quoi le distant resterait éternellement « plus frais » et
 * la remontée repartirait à chaque cycle sur un document que personne n'a
 * touché.
 */
function resolveView(
  local: LayoutView,
  remote: LayoutView,
  nowIso: string,
  nowMs: number
): { view: LayoutView; conflicted: boolean } {
  const lc = clockOf(local);
  const rc = clockOf(remote);

  if (sameViewBody(local, remote)) {
    const superseded = pruneSuperseded(
      [...(local.superseded ?? []), ...(remote.superseded ?? [])],
      nowMs
    );
    const view: LayoutView = {
      ...local,
      updatedAt: rc > lc ? remote.updatedAt : local.updatedAt,
    };
    if (superseded.length > 0) view.superseded = superseded;
    else delete view.superseded;
    return { view, conflicted: false };
  }

  // Divergence réelle. STRICTEMENT plus frais pour que le distant l'emporte —
  // égalité et horloge illisible laissent le local en place.
  const remoteWins = rc > lc;
  const winner = remoteWins ? remote : local;
  const loser = remoteWins ? local : remote;

  const superseded = pruneSuperseded(
    [
      toSuperseded(loser, remoteWins ? 'local' : 'remote', nowIso),
      ...(local.superseded ?? []),
      ...(remote.superseded ?? []),
    ],
    nowMs
  );
  const view: LayoutView = { ...winner };
  if (superseded.length > 0) view.superseded = superseded;
  else delete view.superseded;
  return { view, conflicted: true };
}

function resolveTemplate(local: LayoutTemplate, remote: LayoutTemplate): LayoutTemplate {
  if (sameTemplateBody(local, remote)) {
    return clockOf(remote) > clockOf(local) ? { ...local, updatedAt: remote.updatedAt } : local;
  }
  return clockOf(remote) > clockOf(local) ? remote : local;
}

/**
 * Fusion pure d'un document local avec son homologue distant.
 *
 * Ne lit ni n'écrit rien : l'appelant décide de réécrire (`changedFromLocal`) et
 * de remonter (`changedFromRemote`).
 *
 * `nowIso`/`nowMs` ne servent qu'à dater et expirer les dispositions perdantes
 * (et à ce que les tests les pilotent) : la fusion reste pure.
 */
export function mergeLayoutDocuments(
  localInput: unknown,
  remoteInput: unknown,
  now: { iso: string; ms: number } = { iso: new Date().toISOString(), ms: Date.now() }
): LayoutMergeResult {
  const local = normalizeLayoutDocument(localInput);
  const remote = normalizeLayoutDocument(remoteInput);

  const merged = createEmptyLayoutDocument();
  merged.schema = Math.max(local.schema, remote.schema);

  const conflicts: LayoutViewId[] = [];

  // ── Vues : union par identifiant, arbitrage AU GRAIN DE LA VUE ────────────
  for (const [id, view] of Object.entries(local.views)) {
    const kept: LayoutView = { ...view };
    const superseded = pruneSuperseded(view.superseded ?? [], now.ms);
    if (superseded.length > 0) kept.superseded = superseded;
    else delete kept.superseded;
    merged.views[id] = kept;
  }
  for (const [id, remoteView] of Object.entries(remote.views)) {
    const localView = local.views[id];
    if (!localView) {
      const kept: LayoutView = { ...remoteView };
      const superseded = pruneSuperseded(remoteView.superseded ?? [], now.ms);
      if (superseded.length > 0) kept.superseded = superseded;
      else delete kept.superseded;
      merged.views[id] = kept;
      continue;
    }
    const { view, conflicted } = resolveView(localView, remoteView, now.iso, now.ms);
    merged.views[id] = view;
    if (conflicted) conflicts.push(id);
  }

  // ── Gabarits : même règle, au grain du gabarit ────────────────────────────
  for (const [id, template] of Object.entries(local.templates)) {
    merged.templates[id] = template;
  }
  for (const [id, remoteTemplate] of Object.entries(remote.templates)) {
    const localTemplate = local.templates[id];
    merged.templates[id] = localTemplate
      ? resolveTemplate(localTemplate, remoteTemplate)
      : remoteTemplate;
  }

  // ── Marque d'amorçage : la PLUS ANCIENNE gagne ────────────────────────────
  // Deux appareils qui ont amorcé chacun de leur côté doivent converger sur UN
  // amorçage, et c'est le premier qui compte. Sans cette règle, la marque
  // pouvait reculer et rouvrir la porte à un ré-amorçage.
  const seedLocal = parseIso(local.seededAt);
  const seedRemote = parseIso(remote.seededAt);
  if (seedLocal !== null && seedRemote !== null) {
    merged.seededAt = seedLocal <= seedRemote ? local.seededAt : remote.seededAt;
  } else if (local.seededAt !== undefined) {
    merged.seededAt = local.seededAt;
  } else if (remote.seededAt !== undefined) {
    merged.seededAt = remote.seededAt;
  }

  // `updatedAt` du conteneur est informatif : on garde le plus récent lisible.
  const docLocal = parseIso(local.updatedAt);
  const docRemote = parseIso(remote.updatedAt);
  if (docLocal !== null || docRemote !== null) {
    merged.updatedAt =
      (docRemote ?? -Infinity) > (docLocal ?? -Infinity) ? remote.updatedAt : local.updatedAt;
  }

  return {
    merged,
    changedFromLocal: !deepEqual(merged, local),
    changedFromRemote: !deepEqual(merged, remote),
    conflicts,
  };
}
