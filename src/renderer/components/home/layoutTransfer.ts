/**
 * LE PONT entre une mise en page VÉCUE et un fichier PARTAGEABLE.
 *
 * `services/layouts/` ne connaît ni React ni le registre de widgets, et c'est
 * ce qui le rend exécutable côté serveur le jour de la v2. Ce module-ci est
 * l'autre moitié : il sait ce que CE binaire embarque (le registre clos), et il
 * traduit dans les deux sens.
 *
 *   · À L'EXPORT : des `LayoutSlot` (avec leurs attaches locales) vers un
 *     `LayoutFile` (sans la moindre attache). Le passage obligé est le PLAN
 *     D'ASSAINISSEMENT : une ligne par liaison, que l'utilisateur voit et
 *     arbitre AVANT que le fichier n'existe.
 *   · À L'IMPORT : un `LayoutFile` validé vers un `LayoutTemplate`, que
 *     `instantiate` sait poser sur une vue.
 *
 * ── CE QUI EST DÉLIBÉRÉMENT PERDU DANS LE VOYAGE ────────────────────────────
 *
 * Les identités d'emplacement (`slot.id`) ne sortent PAS : elles peuvent porter
 * l'heure de fabrication et servent d'identité stable dans le coffre de leur
 * auteur. Le fichier les remplace par des identités POSITIONNELLES (`w1`, `w2`)
 * qui ne disent rien de personne.
 */

import type {
  LayoutFile,
  LayoutFileWidget,
  LayoutNamedSlot,
  LayoutSlotAccepts,
  LayoutThemeSuggestion,
  LayoutUnavailableInfo,
} from '../../../services/layouts/layoutFormat';
import {
  LAYOUT_FILE_FORMAT_VERSION,
  LAYOUT_FILE_KIND,
  LAYOUT_LIMITS,
  LAYOUT_UNAVAILABLE_OPTION,
  coreType,
  coreWidgetId,
  isAppVersionString,
  newLayoutFileId,
  sanitizeOptions,
  widgetUid,
} from '../../../services/layouts/layoutFormat';
import type {
  LayoutSlot,
  LayoutTemplate,
  LayoutTemplateSlot,
} from '../../../services/layout/layoutTypes';
import { listWidgets, resolveWidget } from './widgetRegistry';

// ==================== Le registre, vu du format ====================

/**
 * Les identifiants de widgets que ce binaire sait rendre — c'est ce que le
 * validateur reçoit pour partitionner `ok` / `unknown`.
 *
 * Les ALIAS en font partie : ils désignent des widgets réellement présents (un
 * ancien nom qu'une définition continue de servir). Les traiter comme inconnus
 * ferait apparaître une tuile inerte pour un bloc que l'application affiche
 * parfaitement.
 */
export function knownCoreTypes(): ReadonlySet<string> {
  const set = new Set<string>();
  for (const definition of listWidgets()) {
    set.add(definition.type);
    for (const alias of definition.aliases ?? []) set.add(alias);
  }
  return set;
}

/**
 * La version de l'application, quand elle est LISIBLE comme une version.
 *
 * Le pont expose `getVersion()` sans type global, et le client web y répond
 * `2.13.0-web` — une chaîne que le validateur refuserait à la relecture. On ne
 * déclare donc que ce qui repassera : mieux vaut un `minAppVersion` absent
 * qu'un fichier que sa propre application rejette à l'import.
 */
export function currentAppVersion(): string | undefined {
  try {
    const api = (window as unknown as { electronAPI?: { getVersion?: () => string } }).electronAPI;
    const raw = api?.getVersion?.();
    return isAppVersionString(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

// ==================== VIE PRIVÉE : le plan d'assainissement ====================

/**
 * Ce qu'une clé d'attache DÉSIGNE. Table CLOSE, et c'est la sécurité : une clé
 * qu'on ne sait pas nommer ne peut pas devenir un emplacement (on ne saurait
 * pas dire ce qu'il accepte), elle est donc VIDÉE. Le défaut penche du côté qui
 * ne fait rien sortir.
 */
const BINDING_ACCEPTS: Readonly<Record<string, LayoutSlotAccepts>> = {
  folderId: 'folder',
  parentId: 'folder',
  sourceFolderId: 'folder',
  vaultId: 'vault',
  noteId: 'note',
  tagId: 'tag',
  boardId: 'board',
};

/**
 * Les clés dont la valeur est du TEXTE LIBRE. Une recherche enregistrée est du
 * CONTENU au même titre qu'un nom de dossier — souvent davantage : « facture
 * avocat divorce » en dit plus long qu'un uuid. Elles ne peuvent pas devenir un
 * emplacement nommé (un emplacement se remplit en désignant un objet, pas en
 * retapant une requête) et sont toujours vidées.
 */
const FREE_TEXT_KEYS: ReadonlySet<string> = new Set([
  'query',
  'search',
  'q',
  'text',
  'filter',
  'term',
]);

export type BindingDisposition = 'clear' | 'slot';

/** Pourquoi une ligne n'a PAS le choix. `null` ⇒ elle l'a. */
export type BindingLock = 'free-text' | 'unknown-key';

export interface ExportBindingRow {
  slotId: string;
  /** Nom du bloc, tel qu'il s'affiche — la ligne doit se lire sans jargon. */
  widgetTitle: string;
  /** La clé d'attache (`folderId`…). Montrée : l'utilisateur a droit au détail. */
  key: string;
  accepts: LayoutSlotAccepts | null;
  lock: BindingLock | null;
  choice: BindingDisposition;
  /** Libellé de l'emplacement, éditable. Jamais un identifiant (le validateur le refuse). */
  label: string;
}

export interface ExportPlan {
  /** Blocs qui partiront dans le fichier. */
  widgets: number;
  /** Blocs écartés parce que leur type n'est pas exportable. */
  skipped: number;
  /** Une ligne par attache — LE tableau récapitulatif montré avant de valider. */
  rows: ExportBindingRow[];
}

/**
 * Construit le plan. Il ne fabrique RIEN : il décrit ce qui va se passer, pour
 * qu'on puisse le lire et le changer. C'est la seule raison d'être de cet
 * écran — un export qui « nettoie tout seul » demande de croire sur parole.
 */
export function planLayoutExport(
  slots: readonly LayoutSlot[],
  translate: (key: string) => string
): ExportPlan {
  const rows: ExportBindingRow[] = [];
  let widgets = 0;
  let skipped = 0;

  for (const slot of slots) {
    const definition = resolveWidget(slot.type);
    const exportable = coreType(definition?.type ?? slot.type) !== null;
    if (!exportable) {
      skipped += 1;
      continue;
    }
    widgets += 1;
    const title = definition ? translate(definition.titleKey) : slot.type;
    for (const [key, value] of Object.entries(slot.binding ?? {})) {
      if (typeof value !== 'string' || value === '') continue;
      const freeText = FREE_TEXT_KEYS.has(key);
      const accepts = BINDING_ACCEPTS[key] ?? null;
      const lock: BindingLock | null = freeText ? 'free-text' : accepts ? null : 'unknown-key';
      rows.push({
        slotId: slot.id,
        widgetTitle: title,
        key,
        accepts,
        lock,
        // Le défaut : garder un emplacement NOMMÉ quand on sait le nommer, vider
        // sinon. Une requête libre est toujours vidée, sans négociation.
        choice: lock === null ? 'slot' : 'clear',
        label: title,
      });
    }
  }

  return { widgets, skipped, rows };
}

export interface LayoutExportMeta {
  name: string;
  description: string;
  target: LayoutFile['target'];
  icon?: string;
  category?: string;
  /** Version de l'application qui exporte — la seule affirmation vraie possible. */
  appVersion?: string;
  /** Thème SUGGÉRÉ, jamais imposé à qui importera. */
  theme?: LayoutThemeSuggestion;
}

/**
 * Fabrique le fichier. Les `binding` d'origine ne sont JAMAIS lus ici pour
 * autre chose que retrouver la ligne correspondante du plan : leur valeur — le
 * fameux identifiant — n'entre à aucun moment dans l'objet produit.
 */
export function buildLayoutFile(
  slots: readonly LayoutSlot[],
  rows: readonly ExportBindingRow[],
  meta: LayoutExportMeta,
  translate: (key: string) => string
): LayoutFile {
  const widgets: LayoutFileWidget[] = [];

  for (const slot of slots) {
    const definition = resolveWidget(slot.type);
    const type = coreType(definition?.type ?? slot.type);
    if (type === null) continue;

    const widget: LayoutFileWidget = {
      uid: widgetUid(widgets.length),
      type,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
    };

    // Le titre de SECOURS : il ne renomme pas le bloc chez celui qui importe
    // (le registre reste maître de ses noms), il sert quand le bloc n'existe
    // pas encore chez lui et qu'il faut bien dire ce qui manque.
    if (definition) widget.title = translate(definition.titleKey).slice(0, LAYOUT_LIMITS.title);

    const options = sanitizeOptions(slot.options);
    if (options) widget.options = options;

    const bindings: Record<string, { slot: LayoutNamedSlot }> = {};
    for (const row of rows) {
      if (row.slotId !== slot.id) continue;
      if (row.choice !== 'slot' || row.accepts === null || row.lock !== null) continue;
      const label = row.label.trim().slice(0, LAYOUT_LIMITS.slotLabel);
      if (label === '') continue;
      bindings[row.key] = { slot: { label, accepts: row.accepts } };
    }
    if (Object.keys(bindings).length > 0) widget.bindings = bindings;

    widgets.push(widget);
  }

  const file: LayoutFile = {
    kind: LAYOUT_FILE_KIND,
    formatVersion: LAYOUT_FILE_FORMAT_VERSION,
    id: newLayoutFileId(),
    name: meta.name.trim().slice(0, LAYOUT_LIMITS.name),
    description: meta.description.trim().slice(0, LAYOUT_LIMITS.description),
    target: meta.target,
    widgets,
    requires: [{ kind: 'core', ...(meta.appVersion ? { minAppVersion: meta.appVersion } : {}) }],
    version: 1,
  };
  if (meta.theme) file.theme = meta.theme;
  if (meta.icon) file.icon = meta.icon;
  if (meta.category) file.category = meta.category.trim().slice(0, LAYOUT_LIMITS.category);
  return file;
}

// ==================== Import : le fichier redevient un gabarit ====================

/** Version d'application réclamée par le fichier, ou `null`. */
export function requiredAppVersion(file: LayoutFile): string | null {
  for (const requirement of file.requires) {
    if (requirement.kind === 'core' && requirement.minAppVersion) return requirement.minAppVersion;
  }
  return null;
}

/**
 * Le fichier devient un GABARIT, prêt pour `instantiate`.
 *
 * ── LES BLOCS INCONNUS TRAVERSENT ───────────────────────────────────────────
 *
 * Leur type est écrit SANS le préfixe `core:`, exactement comme celui d'un bloc
 * connu. C'est ce qui les fait se réhydrater tout seuls : le jour où une
 * version ajoute `crystal-ball` au registre, l'emplacement déjà posé dans la
 * mise en page le résout sans que rien n'ait à être réimporté. Écrire
 * `core:crystal-ball` dans l'emplacement aurait produit un bloc éternellement
 * inerte, et personne n'aurait su pourquoi.
 *
 * De quoi afficher la tuile inerte (le nom que l'auteur donnait au bloc, la
 * version réclamée) est rangé sous UNE clé de réglages réservée. Quand le bloc
 * existera, son composant l'ignorera : les lecteurs de réglages passent tous
 * par le schéma déclaré du widget, jamais par les clés présentes.
 */
export function templateFromLayoutFile(file: LayoutFile): LayoutTemplate {
  const minAppVersion = requiredAppVersion(file);

  const slots: LayoutTemplateSlot[] = [];
  for (const widget of file.widgets) {
    const id = coreWidgetId(widget.type);
    if (id === null) continue;
    const definition = resolveWidget(id);

    const options: Record<string, unknown> = { ...(widget.options ?? {}) };
    if (!definition) {
      const info: LayoutUnavailableInfo = {
        type: id,
        ...(widget.title ? { title: widget.title } : {}),
        ...(minAppVersion ? { minAppVersion } : {}),
      };
      options[LAYOUT_UNAVAILABLE_OPTION] = info;
    }

    const slot: LayoutTemplateSlot = {
      role: definition?.defaultRole ?? 'custom',
      type: id,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
    };
    if (Object.keys(options).length > 0) slot.options = options;
    slots.push(slot);
  }

  return {
    id: file.id,
    name: file.name,
    slots,
    // L'ÉPOQUE, comme les gabarits de code : un modèle qu'on vient d'importer ne
    // doit pas gagner un arbitrage de fusion contre celui qu'un autre appareil a
    // réellement modifié.
    updatedAt: '1970-01-01T00:00:00.000Z',
    version: file.version,
  };
}

/**
 * Lit la marque « bloc indisponible » d'un emplacement, ou `null`. Rendue ici
 * parce que c'est ce module qui l'écrit : les deux moitiés de la convention
 * doivent se lire au même endroit.
 */
export function readUnavailableInfo(
  options: Record<string, unknown> | undefined
): LayoutUnavailableInfo | null {
  const raw = options?.[LAYOUT_UNAVAILABLE_OPTION];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.type !== 'string') return null;
  return {
    type: record.type,
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.minAppVersion === 'string' ? { minAppVersion: record.minAppVersion } : {}),
  };
}
