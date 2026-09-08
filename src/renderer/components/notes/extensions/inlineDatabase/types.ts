/**
 * Inline Database — Filarr Notes
 *
 * Contrat de données partagé du bloc base de données inline.
 * Modèle auto-contenu façon Notion v1 : schéma + lignes sérialisés
 * en JSON dans les attrs du nœud TipTap (précédent : calendarBlock).
 */

import i18n from '../../../../../i18n/config';
// Module PUR, sans import du dossier : aucun cycle possible
import { formatDisplayDate, resolveLocale } from './cellFormats';
// Type SEUL (effacé à la compilation) : aucun cycle d'imports à l'exécution
import type { DbLinkContext } from './relations';

import * as profileStorage from '../../../../../services/core/profileStorage';
import { isCalculation } from './columnCalculations';
import type { DbCalculation } from './columnCalculations';
export type PropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'checkbox'
  | 'date'
  | 'url'
  | 'email'
  | 'phone'
  | 'rating'
  | 'progress'
  | 'note'
  | 'createdTime'
  | 'updatedTime'
  | 'relation'
  | 'rollup'
  | 'formula'
  | 'person';

const VALID_TYPES: readonly PropertyType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'checkbox',
  'date',
  'url',
  'email',
  'phone',
  'rating',
  'progress',
  'note',
  'createdTime',
  'updatedTime',
  'relation',
  'rollup',
  'formula',
  'person',
];

/** Agrégats d'une propriété rollup — calculés à l'affichage, jamais stockés */
export type DbAggregate =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'checked'
  | 'percentChecked'
  | 'notEmpty'
  | 'list';

export const DB_AGGREGATES: readonly DbAggregate[] = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'checked',
  'percentChecked',
  'notEmpty',
  'list',
];

/** Le seul agrégat qui ne vise aucune propriété de la base cible */
export function aggregateNeedsTarget(aggregate: DbAggregate): boolean {
  return aggregate !== 'count';
}

/**
 * SENS d'une propriété relation. `out` (défaut, jamais écrit) : les liens sont
 * choisis à la main et stockés dans la cellule. `in` : RÉTROLIENS — la colonne
 * ne stocke rien et liste les lignes d'en face qui pointent ici (cf. l'en-tête
 * de `relations.ts` pour le pourquoi de ce choix).
 */
export type DbRelationDirection = 'out' | 'in';

export interface DbSelectOption {
  id: string;
  label: string;
  /** Nom d'une couleur de DB_OPTION_COLORS (résolue en token via optionColorValue) */
  color: string;
}

export interface DbProperty {
  id: string;
  name: string;
  type: PropertyType;
  options?: DbSelectOption[];
  /**
   * select/multiSelect uniquement : option posée d'office sur toute nouvelle
   * ligne (multiSelect → seule dans le tableau). Un seul défaut par propriété.
   * Toléré au parse même s'il ne pointe sur rien : c'est l'application qui vérifie.
   */
  defaultOptionId?: string;
  /**
   * relation uniquement : identité (`dbId`) de la base visée — la base SOURCE
   * quand la relation est un rétrolien. Conservée telle quelle même quand la
   * base est introuvable — une note pas encore chargée n'est pas une base
   * supprimée, et effacer la cible perdrait le lien.
   */
  targetDbId?: string;
  /** relation : sens de lecture (absent = `out`, le sens historique) */
  direction?: DbRelationDirection;
  /**
   * relation `in` : propriété relation de la base SOURCE dont on lit l'envers.
   * Champ distinct de `viaPropertyId` (qui désigne une propriété de CETTE base
   * et que `sanitizeSchema` efface hors des agrégats) : les deux ne vivent pas
   * dans le même monde et les confondre viderait la colonne à chaque commit.
   */
  sourcePropertyId?: string;
  /**
   * relation `out` : un seul lien à la fois — le choix suivant REMPLACE le
   * précédent au lieu de s'y ajouter. N'efface jamais rien tout seul : une
   * cellule qui portait déjà plusieurs liens les garde (cf. `trimToSingleLinks`).
   */
  single?: boolean;
  /** rollup : propriété relation de CETTE base par laquelle passer */
  viaPropertyId?: string;
  /** rollup : propriété à agréger DANS la base visée par la relation */
  targetPropertyId?: string;
  /** rollup : opération d'agrégation (défaut `count` si absente) */
  aggregate?: DbAggregate;
  /**
   * formula : l'expression, telle que l'utilisateur l'a écrite.
   *
   * La VALEUR, elle, n'est jamais stockée dans les cellules : elle est dérivée
   * à l'affichage. Une valeur figée survivrait au changement de la formule et
   * afficherait un chiffre périmé que rien ne signale.
   */
  formula?: string;
}

export interface DbRow {
  id: string;
  /**
   * Clé = property id. text/url/email/phone→string, number→number,
   * checkbox→boolean, date→'YYYY-MM-DD', select→optionId,
   * multiSelect→optionId[], rating→0-5, progress→0-100, note→noteId,
   * relation→identifiants de LIGNES de la base visée (string[]).
   * rollup : AUCUNE entrée — la valeur est calculée à l'affichage.
   */
  cells: Record<string, unknown>;
  /** ISO — posé à la création de la ligne (types createdTime) */
  createdAt?: string;
  /** ISO — posé à chaque modification des cells (types updatedTime) */
  updatedAt?: string;
  /**
   * SOUS-ELEMENT : identifiant de la ligne parente.
   *
   * Un parent absent (filtre, supprime, cycle) ne fait jamais disparaitre
   * l'enfant : il remonte a la racine — voir `rowTree.ts`.
   */
  parentId?: string;
}

// ==================== Vues enregistrées, filtres, tris ====================

// Réglages du plateau : définis avec la logique qui les consomme (`boardLayout`),
// et seulement RÉFÉRENCÉS ici. Les redéclarer donnerait deux formes de la même
// chose, qui divergeraient au premier ajout de réglage.
export type { BoardSettings } from './boardLayout';
import type { BoardSettings } from './boardLayout';

export type DbViewType = 'table' | 'board' | 'calendar' | 'gallery';

/**
 * Opérateurs de filtre, groupés par famille de type (cf. FAMILY_OPS dans
 * viewEngine). Un même mot ne sert jamais deux familles avec deux sens :
 * `contains` vaut sous-chaîne pour le texte et appartenance pour le
 * multi-sélection, ce qui est le même geste mental.
 */
export type DbFilterOp =
  // texte / url / email / téléphone
  | 'contains'
  | 'notContains'
  | 'equals'
  // nombre / progression / évaluation
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  // sélection
  | 'is'
  | 'isNot'
  // case à cocher
  | 'isChecked'
  | 'isUnchecked'
  // date / créé / modifié
  | 'before'
  | 'after'
  | 'on'
  // toutes familles (sauf case à cocher)
  | 'isEmpty'
  | 'isNotEmpty';

const VALID_OPS: readonly DbFilterOp[] = [
  'contains',
  'notContains',
  'equals',
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'is',
  'isNot',
  'isChecked',
  'isUnchecked',
  'before',
  'after',
  'on',
  'isEmpty',
  'isNotEmpty',
];

export interface DbFilter {
  id: string;
  propertyId: string;
  op: DbFilterOp;
  /**
   * Terme de comparaison : texte, nombre, `YYYY-MM-DD`, ou id d'option pour
   * select/multiSelect. Absent pour les opérateurs qui n'en veulent pas
   * (vide, cochée…) — et toléré absent sur les autres : un filtre incomplet
   * est INERTE (il ne masque rien) plutôt que destructeur.
   */
  value?: string | number | boolean;
}

export type DbSortDirection = 'asc' | 'desc';

export interface DbSort {
  propertyId: string;
  direction: DbSortDirection;
}

export interface DbView {
  id: string;
  name: string;
  type: DbViewType;
  /** Combinaison ET uniquement en v1 (aucun OU, ni groupe imbriqué) */
  filters: DbFilter[];
  /** Multi-niveaux, appliqués dans l'ordre du tableau */
  sorts: DbSort[];
  /** Vue board : propriété select qui fait les colonnes (par vue) */
  groupBy?: string;
  /**
   * Largeur en pixels de chaque colonne, par identifiant de propriété. Réglage
   * DE VUE : la même colonne peut être large ici et étroite dans la vue d'à
   * côté. Une propriété absente de la table prend la largeur d'office de son
   * type (`defaultColumnWidth`), ce qui laisse une base neuve lisible sans
   * qu'on ait rien réglé.
   */
  columnWidths?: Record<string, number>;
  /**
   * Proprietes MASQUEES dans cette vue.
   *
   * Reglage DE VUE, comme les largeurs : la meme base peut montrer douze
   * colonnes dans sa vue « tout » et trois dans sa vue « suivi ». Masquer n'est
   * jamais supprimer — la donnee reste dans la ligne, et reapparait des qu'on
   * ra-affiche la colonne.
   */
  hiddenPropertyIds?: string[];
  /**
   * Ordre d'affichage des proprietes DANS CETTE VUE.
   *
   * Les identifiants absents de cette liste s'affichent apres, dans l'ordre du
   * schema : une colonne ajoutee plus tard apparait donc a la fin plutot que de
   * disparaitre — une liste d'ordre incomplete ne doit jamais masquer quoi que
   * ce soit.
   */
  propertyOrder?: string[];
  /**
   * Calcul affiche en pied de chaque colonne (Somme, Moyenne, % coches...).
   *
   * Reglage DE VUE : la vue « tout » peut compter les lignes pendant que la vue
   * « ce trimestre » somme un montant. Cle = identifiant de propriete.
   */
  calculations?: Record<string, DbCalculation>;
  /**
   * Vue calendrier : propriete de type date qui range les lignes dans le mois.
   *
   * Absente, la vue prend la PREMIERE colonne de type date : un calendrier qui
   * n'affiche rien parce qu'on ne lui a pas designe sa colonne est un
   * calendrier casse.
   */
  dateProperty?: string;
  /**
   * Vue kanban : plafonds d'en-cours, second axe, résumé de colonne, taille des
   * cartes. Réglage DE VUE — la même base peut se piloter « par statut, plafonné »
   * ici et se répartir « par personne » dans la vue d'à côté.
   */
  board?: BoardSettings;
}

/**
 * Bornes d'une largeur de colonne. Elles vivent ici parce que le parse les
 * applique : une valeur hors bornes venue d'un document abîmé est ramenée dans
 * le cadre plutôt que jetée — la colonne reste utilisable.
 */
export const DB_COL_MIN_WIDTH = 72;
export const DB_COL_MAX_WIDTH = 900;

export function clampColumnWidth(px: number): number {
  if (!Number.isFinite(px)) return DB_COL_MIN_WIDTH;
  return Math.round(Math.max(DB_COL_MIN_WIDTH, Math.min(DB_COL_MAX_WIDTH, px)));
}

/**
 * Modele de ligne : des cellules pre-remplies, nommees.
 *
 * Appartient a la BASE et non a une vue : « Bogue critique » ou « Point
 * hebdomadaire » decrit ce qu'on cree, pas la facon de le regarder.
 */
export interface DbRowTemplate {
  id: string;
  name: string;
  /** Cle = identifiant de propriete, comme dans `DbRow.cells`. */
  cells: Record<string, unknown>;
}

export interface InlineDbData {
  properties: DbProperty[];
  rows: DbRow[];
  /** Modeles de ligne proposes par le bouton « Nouvelle ligne ». */
  rowTemplates?: DbRowTemplate[];
  /**
   * Absent sur les bases d'avant les vues : `ensureViews` en fabrique alors
   * une depuis les attrs `view`/`groupBy` du nœud (migration sans perte).
   */
  views?: DbView[];
  activeViewId?: string;
}

/** Interface DÉFINITIVE des vues Table/Board (les agents suivants remplacent le corps, pas la signature) */
export interface DatabaseViewProps {
  /** Données COMPLÈTES : toute mutation part d'ici (jamais de visibleRows) */
  data: InlineDbData;
  /**
   * Lignes que la vue active laisse voir (filtrées puis triées). Sert au RENDU
   * seul : une ligne masquée reste dans `data.rows` et n'est jamais supprimée.
   */
  visibleRows: DbRow[];
  groupBy: string;
  /** Cellules à poser d'office sur une nouvelle ligne pour qu'elle soit visible ici */
  rowDefaults: Record<string, unknown>;
  onChange: (next: InlineDbData) => void;
  onGroupByChange: (propertyId: string) => void;
  /** Connecteur choisi au niveau du bloc ('' = aucun) — pilote le bouton ⚡ */
  source?: string;
  /**
   * Résolution des bases visées par les relations (index des notes du coffre).
   * Optionnel : sans lui, relations et agrégats s'affichent « indisponibles »
   * plutôt que vides — jamais une valeur perdue, jamais un plantage.
   */
  linkCtx?: DbLinkContext;
  /** Bases proposées comme cible d'une relation (celle-ci comprise) */
  dbCatalog?: DbCatalogEntry[];
  /**
   * Vue REGARDÉE, telle que le bloc l'a résolue (l'onglet choisi sur cet
   * appareil prime sur celui qu'enregistre le document). C'est elle que la
   * table corrige pour ranger ses largeurs de colonnes : la déduire de
   * `data.activeViewId` viserait la mauvaise vue tant qu'aucune écriture n'a eu
   * lieu. Optionnelle : sans elle, repli sur l'onglet enregistré.
   */
  activeView?: DbView;
}

/** Une base qu'une relation peut viser, telle que l'éditeur de propriété la propose */
export interface DbCatalogEntry {
  dbId: string;
  /** Titre du bloc, sinon celui de la note qui le porte */
  label: string;
  /** Schéma de la cible : le sélecteur d'agrégat y choisit la propriété à agréger */
  properties: DbProperty[];
  /** Vrai pour la base courante (une relation vers soi-même est légitime) */
  self?: boolean;
  /**
   * Note qui porte la base. Deux bases peuvent s'appeler pareil : sans le nom
   * de leur note, la liste des cibles ne se départage pas.
   */
  noteId?: string;
  noteTitle?: string;
}

// ==================== Palette ====================

/** Couleurs d'options select/multiSelect — tokens thème (tiennent en dark ET papier/terracotta) */
export const DB_OPTION_COLORS: { id: string; value: string }[] = [
  { id: 'gray', value: 'var(--color-neutral-400)' },
  { id: 'red', value: 'var(--color-folder-red)' },
  { id: 'orange', value: 'var(--color-folder-orange)' },
  { id: 'amber', value: 'var(--color-folder-amber)' },
  { id: 'green', value: 'var(--color-folder-green)' },
  { id: 'teal', value: 'var(--color-folder-teal)' },
  { id: 'blue', value: 'var(--color-folder-blue)' },
  { id: 'indigo', value: 'var(--color-folder-indigo)' },
  { id: 'purple', value: 'var(--color-folder-purple)' },
  { id: 'pink', value: 'var(--color-folder-pink)' },
];

export function optionColorValue(color: string): string {
  const found = DB_OPTION_COLORS.find((c) => c.id === color);
  return found ? found.value : DB_OPTION_COLORS[0].value;
}

// ==================== Libellés des types de propriété ====================

/**
 * Nom lisible de chaque type de colonne. Table PARTAGÉE : l'éditeur de
 * propriété et l'en-tête de la table y lisent le même mot, et le balayage i18n
 * n'a qu'un endroit à vérifier. Toute nouvelle valeur de `PropertyType` doit
 * apparaître ici — le typage `Record<PropertyType, …>` le fait échouer à la
 * compilation si on l'oublie.
 */
export const PROPERTY_TYPE_LABELS: Record<PropertyType, { key: string; fallback: string }> = {
  text: { key: 'notes.inlineDb.typeText', fallback: 'Text' },
  number: { key: 'notes.inlineDb.typeNumber', fallback: 'Number' },
  select: { key: 'notes.inlineDb.typeSelect', fallback: 'Select' },
  multiSelect: { key: 'notes.inlineDb.typeMultiSelect', fallback: 'Multi-select' },
  checkbox: { key: 'notes.inlineDb.typeCheckbox', fallback: 'Checkbox' },
  date: { key: 'notes.inlineDb.typeDate', fallback: 'Date' },
  url: { key: 'notes.inlineDb.typeUrl', fallback: 'URL' },
  email: { key: 'notes.inlineDb.typeEmail', fallback: 'Email' },
  phone: { key: 'notes.inlineDb.typePhone', fallback: 'Phone' },
  rating: { key: 'notes.inlineDb.typeRating', fallback: 'Rating' },
  progress: { key: 'notes.inlineDb.typeProgress', fallback: 'Progress' },
  note: { key: 'notes.inlineDb.typeNote', fallback: 'Note' },
  relation: { key: 'notes.inlineDb.typeRelation', fallback: 'Relation' },
  rollup: { key: 'notes.inlineDb.typeRollup', fallback: 'Rollup' },
  createdTime: { key: 'notes.inlineDb.typeCreatedTime', fallback: 'Created time' },
  updatedTime: { key: 'notes.inlineDb.typeUpdatedTime', fallback: 'Last edited time' },
  formula: { key: 'notes.inlineDb.typeFormula', fallback: 'Formula' },
  person: { key: 'notes.inlineDb.typePerson', fallback: 'Person' },
};

/**
 * Libellé traduit d'un type. Lu à CHAQUE rendu (et non mémoïsé au module) :
 * les vues se re-rendent au changement de langue, le mot suit.
 */
export function propertyTypeLabel(type: PropertyType): string {
  const entry = PROPERTY_TYPE_LABELS[type];
  return entry ? i18n.t(entry.key, { defaultValue: entry.fallback }) : '';
}

// ==================== Connecteurs (source du bloc) ====================

/**
 * Libellés i18n des sources de la liste blanche partagée — le sélecteur du
 * header et l'infobulle du ⚡ lisent la même table (aucun texte en dur).
 */
export const CONNECTOR_SOURCE_LABELS: Record<string, { key: string; fallback: string }> = {
  books: { key: 'notes.inlineDb.sourceBooks', fallback: 'Books' },
  anime: { key: 'notes.inlineDb.sourceAnime', fallback: 'Anime' },
  tv: { key: 'notes.inlineDb.sourceTv', fallback: 'TV shows' },
  movies: { key: 'notes.inlineDb.sourceMovies', fallback: 'Movies' },
};

// ==================== Clé TMDB (source Films) ====================

/**
 * Clé d'API TMDB, saisie par l'utilisateur dans Paramètres → Confidentialité.
 * Elle vit LOCALEMENT sur cet appareil (localStorage, jamais synchronisée) et
 * ne voyage que comme paramètre de l'appel amont TMDB : en direct depuis le
 * processus principal en desktop, via le proxy de la liste blanche en web.
 * Les autres sources (livres, animes, séries) n'ont besoin d'aucune clé.
 */
const TMDB_KEY_STORAGE = 'filarr-tmdb-api-key';

/** Page où obtenir une clé gratuite (affichée quand elle manque). */
export const TMDB_API_KEY_URL = 'https://www.themoviedb.org/settings/api';

export function getTmdbApiKey(): string {
  try {
    return profileStorage.getItemWithLegacyFallback(TMDB_KEY_STORAGE)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setTmdbApiKey(value: string): void {
  try {
    const v = value.trim();
    if (v) profileStorage.setItem(TMDB_KEY_STORAGE, v);
    else profileStorage.removeItem(TMDB_KEY_STORAGE);
  } catch {
    /* localStorage indisponible : la source Films restera sans clé */
  }
}

// ==================== Onglet de vue regardé (préférence LOCALE) ====================

/**
 * Quel onglet de vue on regarde est une préférence d'AFFICHAGE, pas un contenu :
 * elle vit sur cet appareil (localStorage, jamais synchronisée), comme la clé
 * TMDB ci-dessus. Le document, lui, ne l'enregistre qu'au passage d'une
 * écriture réelle — voir InlineDatabaseNodeView.
 */
const ACTIVE_VIEW_PREFIX = 'filarr-inline-db-view:';

/**
 * Clé locale d'un bloc, dérivée de l'id de sa PREMIÈRE vue : ces ids sont
 * générés une fois et ne bougent plus. Les faire porter l'identité évite
 * d'écrire un attr d'identité dans le document — précisément l'écriture que
 * cette préférence locale cherche à supprimer.
 */
export function viewPrefKey(views: DbView[] | undefined): string {
  const first = views?.[0];
  return first ? `${ACTIVE_VIEW_PREFIX}${first.id}` : '';
}

export function readActiveViewPref(key: string): string | null {
  if (!key) return null;
  try {
    return profileStorage.getItemWithLegacyFallback(key);
  } catch {
    return null;
  }
}

export function writeActiveViewPref(key: string, viewId: string): void {
  if (!key) return;
  try {
    profileStorage.setItem(key, viewId);
  } catch {
    /* localStorage indisponible : l'onglet ne sera pas retenu d'une session à l'autre */
  }
}

/**
 * Langue transmise aux connecteurs : bornée au motif partagé de la liste
 * blanche (`fr-FR`, `en-US`…), donc jamais la locale OS brute.
 */
export function connectorLang(): string {
  return (i18n.language || '').toLowerCase().startsWith('fr') ? 'fr-FR' : 'en-US';
}

// ==================== Helpers purs ====================

/** Même mécanisme d'ID que les events du calendarBlock */
export function newId(): string {
  return `db-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ==================== Identité stable d'une base (dbId) ====================

/**
 * IDENTITÉ D'UNE BASE — dérivée d'abord, frappée ensuite.
 *
 * Une relation vise une base, il lui faut donc un identifiant. Les bases nées
 * avant les relations n'en portent aucun : plutôt que de réécrire toutes les
 * notes qui en contiennent une (un simple aperçu salirait la note et la ferait
 * remonter au nuage), l'identité est DÉRIVÉE de la première graine des données,
 * à la lecture, par une fonction pure — l'index et le bloc lui-même calculent
 * donc la même valeur sans s'être parlé.
 *
 * Graines, dans l'ordre : l'id de la 1re vue (posé une fois à la création et
 * jamais régénéré — c'est déjà la clé locale de `viewPrefKey`), puis la 1re
 * propriété, puis la 1re ligne. Le préfixe `db@` les distingue d'un identifiant
 * frappé.
 *
 * CE QUE LA DÉRIVATION GARANTIT — et ce qu'elle ne garantit pas :
 *  - une base née AVEC ses vues (tout ce qui est créé depuis) a une graine
 *    définitive : l'id de sa 1re vue ne bouge plus, ni au tri, ni au filtre, ni
 *    à la suppression de colonnes ;
 *  - une base d'AVANT les vues, elle, se dérive de sa 1re propriété (ou de sa
 *    1re ligne) : supprimer cette colonne, ou la déplacer, CHANGE son identité
 *    tant que l'attribut n'a pas été frappé. C'est justement pourquoi le
 *    premier vrai commit fige la valeur dans l'attribut du nœud (cf. `commit`
 *    dans InlineDatabaseNodeView) : après lui, plus rien ne la fait bouger.
 *    La fenêtre à risque est donc courte — de l'ouverture d'une note ancienne
 *    à sa première écriture — mais elle existe : une relation créée pendant
 *    cette fenêtre vers une base ancienne qu'on remanie AVANT de l'avoir
 *    commitée pointera dans le vide (« base indisponible », liens conservés).
 *
 * Frapper l'attribut ne change rien à la valeur lue (c'est la même), donc
 * aucune relation déjà créée ne se casse au passage ; et un client qui
 * ignorerait l'attribut (schéma TipTap plus ancien, qui jette les attrs
 * inconnus) laisse l'identité se re-dériver à l'identique.
 */
export function deriveDbId(data: InlineDbData): string {
  const view = data.views?.[0]?.id;
  if (typeof view === 'string' && view !== '') return `db@v:${view}`;
  const prop = data.properties[0]?.id;
  if (typeof prop === 'string' && prop !== '') return `db@p:${prop}`;
  const row = data.rows[0]?.id;
  if (typeof row === 'string' && row !== '') return `db@r:${row}`;
  // Coquille vide : aucune graine, donc aucune identité — rien à viser non plus
  return '';
}

/**
 * Identité retenue pour un bloc : l'attribut s'il en porte un, sinon la valeur
 * dérivée. À appeler sur les données BRUTES (avant `ensureViews`, qui
 * fabriquerait une vue au vol et donc une graine différente à chaque rendu).
 */
export function resolveDbId(attrDbId: unknown, data: InlineDbData): string {
  const attr = typeof attrDbId === 'string' ? attrDbId.trim() : '';
  return attr !== '' ? attr : deriveDbId(data);
}

/** Identifiants de lignes portés par une cellule relation (dédoublonnés) */
export function relationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string' || v === '' || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Cellules d'office d'une nouvelle ligne : une par propriété select/multiSelect
 * dont le defaultOptionId pointe sur une option qui existe encore.
 */
export function defaultCells(properties: DbProperty[]): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const p of properties) {
    if (p.type !== 'select' && p.type !== 'multiSelect') continue;
    const id = p.defaultOptionId;
    if (!id || !(p.options ?? []).some((o) => o.id === id)) continue;
    cells[p.id] = p.type === 'select' ? id : [id];
  }
  return cells;
}

/**
 * Point unique de création de ligne : createdAt posé ici (jamais au montage).
 * `overrides` a le dernier mot sur les défauts du schéma (le board impose la
 * colonne où l'on clique) ; une valeur `undefined` y signifie « laisse vide ».
 */
export function newRow(properties: DbProperty[], overrides: Record<string, unknown> = {}): DbRow {
  const cells = defaultCells(properties);
  for (const [propId, value] of Object.entries(overrides)) {
    if (value === undefined) delete cells[propId];
    else cells[propId] = value;
  }
  return { id: newId(), cells, createdAt: new Date().toISOString() };
}

/** Point unique d'horodatage : à appeler sur toute ligne dont les cells changent */
export function touchRow(row: DbRow): DbRow {
  return { ...row, updatedAt: new Date().toISOString() };
}

/** Date+heure locale compacte des colonnes createdTime/updatedTime (vue ET export) */
export function formatDbTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Langue de l'app, pas la locale OS
  return d.toLocaleString(i18n.language || undefined, { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Date d'une cellule (`YYYY-MM-DD`) mise en forme dans la LANGUE DE L'APP.
 * Point unique : la cellule de la table, la pastille d'une relation, l'agrégat
 * « liste des valeurs » et la carte du board doivent lire la même chose — un
 * ISO brut à côté d'une date habillée se remarque tout de suite.
 */
export function formatDbDate(iso: string | undefined): string {
  if (!iso) return '';
  return formatDisplayDate(iso, resolveLocale(i18n.language));
}

/**
 * Vue neuve : nom i18n figé à la création (comme les propriétés par défaut),
 * aucun filtre ni tri. `groupBy` n'est porté que par les vues board.
 */
export function makeDefaultView(type: DbViewType = 'table', groupBy?: string): DbView {
  return {
    id: newId(),
    name: i18n.t('notes.inlineDb.mainView', { defaultValue: 'Main view' }),
    type,
    filters: [],
    sorts: [],
    ...(groupBy ? { groupBy } : {}),
  };
}

/* ---- Parse tolérant des vues : une entrée douteuse est jetée, jamais lancée ---- */

function parseFilters(raw: unknown): DbFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: DbFilter[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const { id, propertyId, op, value } = f as Record<string, unknown>;
    if (typeof id !== 'string' || typeof propertyId !== 'string') continue;
    if (typeof op !== 'string' || !(VALID_OPS as readonly string[]).includes(op)) continue;
    const keepValue =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    out.push({
      id,
      propertyId,
      op: op as DbFilterOp,
      ...(keepValue ? { value: value as string | number | boolean } : {}),
    });
  }
  return out;
}

function parseSorts(raw: unknown): DbSort[] {
  if (!Array.isArray(raw)) return [];
  const out: DbSort[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const { propertyId, direction } = s as Record<string, unknown>;
    if (typeof propertyId !== 'string') continue;
    if (direction !== 'asc' && direction !== 'desc') continue;
    out.push({ propertyId, direction });
  }
  return out;
}

/**
 * Largeurs de colonnes d'une vue. Une entrée illisible est ignorée (la colonne
 * reprend la largeur d'office de son type), une valeur hors bornes est ramenée
 * dans le cadre : jamais une colonne de 3 px qu'on ne saurait plus rattraper.
 */
function parseColumnWidths(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [propId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (propId === '' || typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[propId] = clampColumnWidth(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Calculs de pied de colonne ; les valeurs inconnues sont ecartees. */
function parseCalculations(raw: unknown): Record<string, DbCalculation> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, DbCalculation> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key !== '' && isCalculation(value) && value !== 'none') out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Liste d'identifiants, dedoublonnee ; `undefined` quand il n'y a rien a garder. */
function parseIdList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value === 'string' && value !== '' && !out.includes(value)) out.push(value);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Réglages du plateau kanban.
 *
 * TOUT champ doit être lu ICI. Un réglage qu'on ajoute à `BoardSettings` sans
 * l'ajouter à ce parse existe en mémoire et disparaît au premier aller-retour
 * du document : la case se recoche toute seule, et on cherche le bug côté vue.
 */
function parseBoardSettings(raw: unknown): BoardSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { swimlaneBy, summaryBy, wipLimits, collapsed, hideEmpty, colorCards, cardSize } =
    raw as Record<string, unknown>;

  const limits: Record<string, number> = {};
  if (wipLimits && typeof wipLimits === 'object' && !Array.isArray(wipLimits)) {
    for (const [key, value] of Object.entries(wipLimits as Record<string, unknown>)) {
      // Un plafond ≤ 0 n'est pas un plafond, c'est une colonne interdite : on
      // l'écarte plutôt que d'afficher une colonne en dépassement permanent.
      if (key !== '' && typeof value === 'number' && Number.isFinite(value) && value > 0) {
        limits[key] = Math.round(value);
      }
    }
  }

  const out: BoardSettings = {
    ...(typeof swimlaneBy === 'string' && swimlaneBy !== '' ? { swimlaneBy } : {}),
    ...(typeof summaryBy === 'string' && summaryBy !== '' ? { summaryBy } : {}),
    ...(Object.keys(limits).length > 0 ? { wipLimits: limits } : {}),
    ...(parseIdList(collapsed) ? { collapsed: parseIdList(collapsed) } : {}),
    ...(hideEmpty === true ? { hideEmpty: true } : {}),
    ...(colorCards === true ? { colorCards: true } : {}),
    ...(cardSize === 'compact' || cardSize === 'tall' ? { cardSize } : {}),
  };
  // Objet vide = comme une absence : pas de `board: {}` qui alourdirait chaque
  // vue enregistrée sans rien dire.
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseViews(raw: unknown): DbView[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: DbView[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const {
      id,
      name,
      type,
      filters,
      sorts,
      groupBy,
      columnWidths,
      hiddenPropertyIds,
      propertyOrder,
      calculations,
      dateProperty,
      board,
    } = v as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    const widths = parseColumnWidths(columnWidths);
    out.push({
      id,
      name,
      type: type === 'board' || type === 'calendar' || type === 'gallery' ? type : 'table',
      filters: parseFilters(filters),
      sorts: parseSorts(sorts),
      ...(typeof groupBy === 'string' && groupBy !== '' ? { groupBy } : {}),
      ...(widths ? { columnWidths: widths } : {}),
      ...(parseIdList(hiddenPropertyIds)
        ? { hiddenPropertyIds: parseIdList(hiddenPropertyIds) }
        : {}),
      ...(parseIdList(propertyOrder) ? { propertyOrder: parseIdList(propertyOrder) } : {}),
      ...(parseCalculations(calculations) ? { calculations: parseCalculations(calculations) } : {}),
      ...(typeof dateProperty === 'string' && dateProperty !== '' ? { dateProperty } : {}),
      ...(parseBoardSettings(board) ? { board: parseBoardSettings(board) } : {}),
    });
  }
  // Tableau vide (ou tout jeté) = comme une absence : la migration reprend la main
  return out.length > 0 ? out : undefined;
}

/** Modeles de ligne ; une entree sans nom ou sans cellules est ecartee. */
function parseRowTemplates(raw: unknown): DbRowTemplate[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: DbRowTemplate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, cells } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || name.trim() === '') continue;
    out.push({
      id,
      name,
      cells: cells && typeof cells === 'object' ? (cells as Record<string, unknown>) : {},
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Parse tolérant : toute entrée invalide retombe sur une base vide */
export function parseDbData(json: string): InlineDbData {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return { properties: [], rows: [] };
    const views = parseViews(parsed.views);
    const properties = Array.isArray(parsed.properties)
      ? parsed.properties
          .filter(
            (p: unknown): p is DbProperty =>
              !!p &&
              typeof p === 'object' &&
              typeof (p as DbProperty).id === 'string' &&
              typeof (p as DbProperty).name === 'string' &&
              typeof (p as DbProperty).type === 'string'
          )
          // type inconnu → text ; options non conformes filtrées
          .map(
            (p: DbProperty): DbProperty => ({
              id: p.id,
              name: p.name,
              type: (VALID_TYPES as readonly string[]).includes(p.type) ? p.type : 'text',
              options: Array.isArray(p.options)
                ? p.options.filter(
                    (o) =>
                      !!o &&
                      typeof o.id === 'string' &&
                      typeof o.label === 'string' &&
                      typeof o.color === 'string'
                  )
                : undefined,
              defaultOptionId:
                typeof p.defaultOptionId === 'string' ? p.defaultOptionId : undefined,
              // Cible et agrégat sont tolérés même s'ils ne pointent sur rien :
              // une base visée peut n'être pas encore chargée, et rien ne
              // justifierait de perdre la configuration en la lisant
              targetDbId: typeof p.targetDbId === 'string' ? p.targetDbId : undefined,
              // Sens inconnu (client plus récent, donnée abîmée) → sens sortant :
              // le pire des cas montre une cellule vide et modifiable, jamais
              // une colonne qui prétend calculer quelque chose
              direction: p.direction === 'in' ? 'in' : undefined,
              sourcePropertyId:
                typeof p.sourcePropertyId === 'string' ? p.sourcePropertyId : undefined,
              single: p.single === true ? true : undefined,
              viaPropertyId: typeof p.viaPropertyId === 'string' ? p.viaPropertyId : undefined,
              targetPropertyId:
                typeof p.targetPropertyId === 'string' ? p.targetPropertyId : undefined,
              aggregate: (DB_AGGREGATES as readonly string[]).includes(p.aggregate as string)
                ? (p.aggregate as DbAggregate)
                : undefined,
            })
          )
      : [];
    const rows = Array.isArray(parsed.rows)
      ? parsed.rows
          .filter(
            (r: unknown): r is DbRow =>
              !!r && typeof r === 'object' && typeof (r as DbRow).id === 'string'
          )
          .map((r: DbRow) => ({
            id: r.id,
            cells: r.cells && typeof r.cells === 'object' ? r.cells : {},
            createdAt: typeof r.createdAt === 'string' ? r.createdAt : undefined,
            updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
            // Un parent qui ne designe rien est tolere ici : `buildRowTree`
            // remonte la ligne a la racine plutot que de la perdre.
            parentId: typeof r.parentId === 'string' && r.parentId !== '' ? r.parentId : undefined,
          }))
      : [];
    const rowTemplates = parseRowTemplates(parsed.rowTemplates);
    return {
      properties,
      rows,
      ...(rowTemplates ? { rowTemplates } : {}),
      ...(views ? { views } : {}),
      ...(typeof parsed.activeViewId === 'string' ? { activeViewId: parsed.activeViewId } : {}),
    };
  } catch {
    return { properties: [], rows: [] };
  }
}

export function serializeDbData(data: InlineDbData): string {
  return JSON.stringify(data);
}

export function makeDefaultData(): InlineDbData {
  const nameProp: DbProperty = {
    id: newId(),
    name: i18n.t('notes.inlineDb.defaultNameProp', { defaultValue: 'Name' }),
    type: 'text',
  };
  const statusOptions: DbSelectOption[] = [
    {
      id: newId(),
      label: i18n.t('notes.inlineDb.statusTodo', { defaultValue: 'To do' }),
      color: 'gray',
    },
    {
      id: newId(),
      label: i18n.t('notes.inlineDb.statusDoing', { defaultValue: 'In progress' }),
      color: 'blue',
    },
    {
      id: newId(),
      label: i18n.t('notes.inlineDb.statusDone', { defaultValue: 'Done' }),
      color: 'green',
    },
  ];
  const statusProp: DbProperty = {
    id: newId(),
    name: i18n.t('notes.inlineDb.defaultStatusProp', { defaultValue: 'Status' }),
    type: 'select',
    options: statusOptions,
    // Toute nouvelle ligne naît « À faire » (1re colonne du kanban)
    defaultOptionId: statusOptions[0].id,
  };
  const properties = [nameProp, statusProp];
  // La base naît avec sa vue : seules les bases d'avant la fonctionnalité
  // passent par la migration
  const view = makeDefaultView('table');
  return {
    properties,
    rows: [newRow(properties), newRow(properties), newRow(properties)],
    views: [view],
    activeViewId: view.id,
  };
}
