/**
 * dbIndex — Filarr Notes / bases inline
 *
 * Index des bases de données inline du coffre : `dbId → { note, titre, schéma,
 * lignes }`. Une relation vise une base qui vit dans une AUTRE note ; cet index
 * est le seul chemin qui les rapproche.
 *
 * Même technique que `selectSubPageParentMap` (le précédent maison) : préfiltre
 * par chaîne avant tout `JSON.parse`, parcours itératif du document TipTap,
 * tolérance totale aux contenus illisibles (la note est ignorée, jamais lancée).
 * Rien ne sort d'ici : tout est déjà en mémoire, déchiffré, côté client.
 */

import type { DbProperty, DbRow } from './types';
import { newId, parseDbData, resolveDbId } from './types';

/** Préfiltre : un document sans ce marqueur ne porte aucune base */
export const INLINE_DB_MARKER = '"inlineDatabase"';

/** Ce que l'index sait d'une base */
export interface InlineDbIndexEntry {
  dbId: string;
  noteId: string;
  noteTitle: string;
  /** Titre du bloc, ou à défaut celui de la note (jamais vide à l'affichage) */
  title: string;
  properties: DbProperty[];
  /**
   * Lignes de la base : la résolution d'une relation et le calcul d'un agrégat
   * les lisent. Elles sont déjà en mémoire (contenu de la note), l'index n'en
   * fait que des références — aucune copie.
   */
  rows: DbRow[];
}

/** Le peu qu'il faut connaître d'une note pour l'indexer */
export interface IndexableNote {
  id: string;
  title?: string;
  content?: string | null;
  deletedAt?: string | null;
}

interface TipTapNodeLike {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: unknown[];
}

/** Blocs base d'un document TipTap, dans l'ordre du document */
function walkDbNodes(doc: unknown): TipTapNodeLike[] {
  const found: TipTapNodeLike[] = [];
  const stack: unknown[] = [doc];
  while (stack.length) {
    const node = stack.pop() as TipTapNodeLike | null;
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'inlineDatabase') found.push(node);
    // Empilé à l'envers : le parcours suit alors l'ordre du document
    if (Array.isArray(node.content)) {
      for (let i = node.content.length - 1; i >= 0; i -= 1) stack.push(node.content[i]);
    }
  }
  return found;
}

/**
 * Bases portées par UNE note, dans l'ordre du document. Point d'entrée unique
 * de la lecture d'une note : c'est lui que le collecteur mémoïse.
 */
export function collectNoteDbs(note: IndexableNote): InlineDbIndexEntry[] {
  if (!note || note.deletedAt) return [];
  const content = note.content;
  // Note vide, contenu absent, ou aucun bloc base : rien à parcourir
  if (typeof content !== 'string' || !content.includes(INLINE_DB_MARKER)) return [];

  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    // Contenu illisible : note ignorée (jamais une exception qui casserait le rendu)
    return [];
  }

  const noteTitle = typeof note.title === 'string' ? note.title : '';
  const entries: InlineDbIndexEntry[] = [];
  for (const node of walkDbNodes(doc)) {
    const attrs = node.attrs ?? {};
    const raw = typeof attrs.data === 'string' ? attrs.data : '';
    // parseDbData est déjà tolérant : un JSON douteux rend une base vide
    const data = parseDbData(raw);
    const dbId = resolveDbId(attrs.dbId, data);
    // Coquille sans graine : aucune identité, donc rien à viser
    if (dbId === '') continue;
    const blockTitle = typeof attrs.title === 'string' ? attrs.title.trim() : '';
    entries.push({
      dbId,
      noteId: note.id,
      noteTitle,
      title: blockTitle !== '' ? blockTitle : noteTitle,
      properties: data.properties,
      rows: data.rows,
    });
  }
  return entries;
}

/**
 * Index de toutes les bases visibles. Les notes sont parcourues dans l'ordre
 * reçu et, à identité égale (deux bases ne devraient plus jamais en partager
 * une, cf. `restampDbNodes`, mais un document d'avant la correction le peut),
 * LA PREMIÈRE GAGNE : l'index reste déterministe d'un rendu à l'autre.
 */
export function collectInlineDbs(notes: Iterable<IndexableNote>): Map<string, InlineDbIndexEntry> {
  const index = new Map<string, InlineDbIndexEntry>();
  for (const note of notes) {
    for (const entry of collectNoteDbs(note)) {
      if (!index.has(entry.dbId)) index.set(entry.dbId, entry);
    }
  }
  return index;
}

interface NoteCacheEntry {
  content: string | null | undefined;
  title: string | undefined;
  entries: InlineDbIndexEntry[];
}

/**
 * Collecteur MÉMOÏSÉ PAR NOTE.
 *
 * Chaque bloc base du coffre est abonné à cet index : sans mémoïsation par
 * note, la moindre frappe dans n'importe quelle note relançait un `JSON.parse`
 * de TOUTES les notes porteuses, sur le fil principal. Ici, une note dont ni le
 * contenu ni le titre n'ont bougé rend ses entrées telles quelles — seule celle
 * qu'on modifie est relue.
 *
 * Et quand RIEN n'a changé (le cas de très loin le plus fréquent : on tape dans
 * une note sans base), l'index rendu est l'objet PRÉCÉDENT, à l'identique :
 * `useSelector` ne re-rend alors aucun bloc.
 *
 * Le cache est reconstruit à chaque passage à partir des notes vues : une note
 * supprimée en sort d'elle-même, il ne grossit donc pas indéfiniment.
 */
export function createInlineDbCollector(): (
  notes: Iterable<IndexableNote>
) => Map<string, InlineDbIndexEntry> {
  let cache = new Map<string, NoteCacheEntry>();
  let prevIds: string[] = [];
  let prevIndex = new Map<string, InlineDbIndexEntry>();

  return (notes) => {
    const next = new Map<string, NoteCacheEntry>();
    const ids: string[] = [];
    const collected: InlineDbIndexEntry[][] = [];
    let changed = false;

    for (const note of notes) {
      if (!note || note.deletedAt) continue;
      const hit = cache.get(note.id);
      let entries: InlineDbIndexEntry[];
      if (hit && hit.content === note.content && hit.title === note.title) {
        entries = hit.entries;
      } else {
        entries = collectNoteDbs(note);
        changed = true;
      }
      next.set(note.id, { content: note.content, title: note.title, entries });
      ids.push(note.id);
      collected.push(entries);
    }
    cache = next;

    // Mêmes notes, dans le même ordre, toutes inchangées : même index
    if (!changed && ids.length === prevIds.length && ids.every((id, i) => prevIds[i] === id)) {
      return prevIndex;
    }

    const index = new Map<string, InlineDbIndexEntry>();
    for (const entries of collected) {
      for (const entry of entries) if (!index.has(entry.dbId)) index.set(entry.dbId, entry);
    }
    prevIds = ids;
    prevIndex = index;
    return index;
  };
}

// ==================== Écrire dans la note d'en face ====================

/**
 * MODIFIE UNE BASE QUI VIT DANS UNE AUTRE NOTE, et rend le contenu complet de
 * cette note — à passer tel quel à `updateNoteContent`. Rend `null` quand rien
 * n'a pu être écrit avec certitude (note illisible, base absente, données du
 * bloc abîmées, mutation qui renonce) : l'appelant abandonne alors le geste, il
 * ne devine jamais.
 *
 * POURQUOI CETTE FONCTION EXISTE. Créer une ligne depuis le sélecteur de
 * relations — ou poser la colonne de rétroliens dans la base visée — c'est
 * écrire chez le voisin. Le précédent maison est la propagation des renommages
 * (`noteRenamePropagation`), qui réécrit le contenu de toutes les notes citant
 * l'ancien titre : même geste, mêmes garanties — tout est local et déjà
 * déchiffré, et la sauvegarde debouncée de l'app enregistre la note touchée
 * comme n'importe quelle autre modification.
 *
 * CE QU'ELLE NE FAIT PAS. Elle ne touche pas au bloc de la note OUVERTE dans
 * l'éditeur : là, c'est le document en mémoire de ProseMirror qui fait foi, et
 * il écraserait l'écriture à la frappe suivante. L'appelant doit écarter ce cas
 * (cf. `DatabaseTableView`).
 *
 * Le JSON du bloc est modifié au plus près (`mutate` ne touche qu'un champ) :
 * ce qu'un client plus récent aurait ajouté n'est pas perdu au passage — ce que
 * ferait un aller-retour par `parseDbData`, qui ne garde que ce qu'il connaît.
 */
function patchDbInNoteContent(
  content: string,
  dbId: string,
  mutate: (raw: Record<string, unknown>) => boolean
): string | null {
  if (typeof content !== 'string' || dbId === '' || !content.includes(INLINE_DB_MARKER)) {
    return null;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return null;
  }

  for (const node of walkDbNodes(doc)) {
    const attrs = node.attrs ?? {};
    const raw = typeof attrs.data === 'string' ? attrs.data : '';
    // Même résolution d'identité que l'index : ce que l'utilisateur a visé
    if (resolveDbId(attrs.dbId, parseDbData(raw)) !== dbId) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    if (!mutate(parsed as Record<string, unknown>)) return null;
    node.attrs = { ...attrs, data: JSON.stringify(parsed) };
    try {
      return JSON.stringify(doc);
    } catch {
      return null;
    }
  }
  // Base absente de cette note (bloc supprimé entre l'index et le clic)
  return null;
}

/** Ajoute une ligne à une base qui vit dans une autre note (cf. `patchDbInNoteContent`) */
export function appendRowToNoteContent(content: string, dbId: string, row: DbRow): string | null {
  return patchDbInNoteContent(content, dbId, (raw) => {
    // La ligne est ajoutée EN FIN : l'identité dérivée d'une base sans attribut
    // se lit sur sa PREMIÈRE ligne, insérer en tête la changerait
    raw.rows = [...(Array.isArray(raw.rows) ? raw.rows : []), row];
    return true;
  });
}

/**
 * Ajoute une COLONNE à une base qui vit dans une autre note. Sert à poser la
 * colonne de rétroliens dans la base visée, en un clic, depuis la relation qui
 * la vise — l'équivalent de la propriété miroir de Notion, à ceci près que la
 * colonne posée ne stocke RIEN : elle se recalcule (cf. `relations.ts`).
 *
 * Idempotent : une colonne de même identité déjà présente fait renoncer, plutôt
 * que d'en poser une seconde.
 */
export function appendPropertyToNoteContent(
  content: string,
  dbId: string,
  property: DbProperty
): string | null {
  return patchDbInNoteContent(content, dbId, (raw) => {
    const props = Array.isArray(raw.properties) ? raw.properties : [];
    const already = props.some(
      (p) => !!p && typeof p === 'object' && (p as DbProperty).id === property.id
    );
    if (already) return false;
    // Ajoutée EN FIN, comme le bouton « + » de la table : l'identité dérivée
    // d'une base sans attribut se lit sur sa PREMIÈRE propriété
    raw.properties = [...props, property];
    return true;
  });
}

// ==================== Identité d'une COPIE ====================

/** Attributs d'un bloc base, tels que le nœud TipTap les porte */
export interface DbNodeAttrs {
  dbId?: unknown;
  data?: unknown;
}

/** Attributs à réécrire sur un bloc re-frappé (`data` seulement si une relation a suivi) */
export interface RestampedDbAttrs {
  dbId: string;
  data?: string;
}

/** Identité neuve, unique dans le lot en cours (deux copies d'un même geste) */
function freshDbId(taken: Set<string>): string {
  let id = newId();
  while (taken.has(id)) id = newId();
  taken.add(id);
  return id;
}

/**
 * Réécrit les cibles de relation d'une base copiée. Le JSON d'origine est
 * conservé au plus près (seuls les `targetDbId` concernés changent) : un champ
 * qu'un client plus récent aurait ajouté n'est pas perdu au passage — ce que
 * ferait un aller-retour par `parseDbData`, qui ne garde que ce qu'il connaît.
 */
function remapRelationTargets(raw: unknown, remap: Map<string, string>): string | undefined {
  if (typeof raw !== 'string' || raw === '' || remap.size === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const properties = (parsed as { properties?: unknown }).properties;
  if (!Array.isArray(properties)) return undefined;
  let changed = false;
  for (const prop of properties) {
    if (!prop || typeof prop !== 'object') continue;
    const holder = prop as { targetDbId?: unknown };
    if (typeof holder.targetDbId !== 'string') continue;
    const next = remap.get(holder.targetDbId);
    if (next === undefined || next === holder.targetDbId) continue;
    holder.targetDbId = next;
    changed = true;
  }
  return changed ? JSON.stringify(parsed) : undefined;
}

/**
 * RE-FRAPPE L'IDENTITÉ D'UN LOT DE BLOCS COPIÉS (ordre du document).
 *
 * Deux bases ne peuvent pas porter la même identité : une relation viserait
 * l'une et lirait l'autre — des chiffres faux, sans rien à l'écran qui le dise.
 * Toute copie (note dupliquée, modèle, collage, duplication de bloc) reçoit
 * donc une identité neuve.
 *
 * Les relations INTERNES à la copie suivent : celle qui visait une base du lot
 * vise désormais SA copie, celle qui visait l'extérieur ne bouge pas. Les
 * LIGNES ne sont jamais touchées — les identifiants de lignes liées gardent
 * leur sens dans la copie, qui porte exactement les mêmes lignes.
 */
export function restampDbNodes(nodes: DbNodeAttrs[]): RestampedDbAttrs[] {
  const taken = new Set<string>();
  const remap = new Map<string, string>();
  const fresh = nodes.map(() => freshDbId(taken));

  nodes.forEach((node, i) => {
    const before = resolveDbId(
      node.dbId,
      parseDbData(typeof node.data === 'string' ? node.data : '')
    );
    // Copie d'une copie (deux blocs de même identité dans le lot) : la première
    // correspondance gagne, pour que le résultat ne dépende pas du hasard
    if (before !== '' && !remap.has(before)) remap.set(before, fresh[i]);
  });

  return nodes.map((node, i) => {
    const data = remapRelationTargets(node.data, remap);
    return { dbId: fresh[i], ...(data !== undefined ? { data } : {}) };
  });
}

/**
 * Contenu d'une note COPIÉE (note dupliquée, modèle appliqué) : chacune de ses
 * bases reçoit une identité neuve. Appelé à la CRÉATION de la note — aucune
 * relation ne peut encore viser ces blocs-là, rien n'est donc cassé au passage.
 *
 * Tolérant de bout en bout : un contenu qui n'est pas du JSON, ou qui ne porte
 * aucune base, est rendu tel quel.
 */
export function restampCopiedDbIds(content: string): string {
  if (typeof content !== 'string' || !content.includes(INLINE_DB_MARKER)) return content;
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return content;
  }
  const blocks = walkDbNodes(doc);
  if (blocks.length === 0) return content;
  const stamped = restampDbNodes(blocks.map((block) => block.attrs ?? {}));
  blocks.forEach((block, i) => {
    block.attrs = { ...(block.attrs ?? {}), ...stamped[i] };
  });
  try {
    return JSON.stringify(doc);
  } catch {
    return content;
  }
}

/**
 * Contenu d'un document FUSIONNÉ où une même base apparaît DEUX FOIS : la
 * première occurrence garde son identité, les suivantes en reçoivent une neuve.
 *
 * POURQUOI CE N'EST PAS `restampCopiedDbIds`. Une note fusionnée n'est pas une
 * copie : elle REMPLACE l'originale, sous le même id. Re-frapper TOUTES ses
 * bases — ce que ferait la fonction de copie — casserait toutes les relations
 * du coffre qui les visaient, alors qu'aucune n'a bougé. Seul le SURPLUS est
 * re-frappé, et le surplus seul.
 *
 * D'OÙ VIENT LE DOUBLON. « Garder les deux » d'une résolution de conflit
 * (`mergedDocument`) pose côte à côte les deux versions d'un bloc modifié des
 * deux côtés — donc deux bases de MÊME identité dans un seul document. Le
 * document est écrit directement au magasin, sans éditeur monté : le greffon
 * d'identité (`dbIdentityPlugin`), qui re-frappe collages et duplications, ne
 * tourne pas là. Cette fonction est sa doublure pour ce chemin-là.
 *
 * Tolérant de bout en bout, comme le reste du module : un contenu illisible, ou
 * sans base, ou sans doublon, est rendu tel quel.
 */
export function restampDuplicateDbIds(content: string): string {
  if (typeof content !== 'string' || !content.includes(INLINE_DB_MARKER)) return content;
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return content;
  }
  const blocks = walkDbNodes(doc);
  // Un seul bloc ne peut se disputer son identité avec personne
  if (blocks.length < 2) return content;

  const seen = new Set<string>();
  const duplicates: TipTapNodeLike[] = [];
  for (const block of blocks) {
    const attrs = block.attrs ?? {};
    const raw = typeof attrs.data === 'string' ? attrs.data : '';
    // Même résolution d'identité que l'index : ce que les relations visent
    const dbId = resolveDbId(attrs.dbId, parseDbData(raw));
    // Coquille sans graine : aucune identité, donc aucun doublon possible
    if (dbId === '') continue;
    if (seen.has(dbId)) duplicates.push(block);
    else seen.add(dbId);
  }
  if (duplicates.length === 0) return content;

  const stamped = restampDbNodes(duplicates.map((block) => block.attrs ?? {}));
  duplicates.forEach((block, i) => {
    block.attrs = { ...(block.attrs ?? {}), ...stamped[i] };
  });
  try {
    return JSON.stringify(doc);
  } catch {
    return content;
  }
}
