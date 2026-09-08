/**
 * shareItemPicker — le CHOIX des éléments à partager dans un lot, en pur.
 *
 * POURQUOI. « Partager le dossier avec une personne » scellait TOUT le dossier
 * d'un bloc : un grant par fichier, sans qu'on puisse en laisser un de côté.
 * Or un dossier « Contrats » contient souvent le brouillon qu'on ne veut pas
 * montrer. Le dialogue propose donc la liste, tous cochés par défaut, groupés
 * par sous-dossier — et le scellement ne porte que sur ce qui reste coché.
 *
 * Tout ce qui décide (le groupement par chemin RELATIF, l'état d'une case de
 * groupe, les comptes, le filtre) vit ici sans React : un chemin de base mal
 * retiré ou une case de groupe qui n'inverse pas ce qu'elle montre sont des
 * défauts qui compilent — ils se prouvent sous vitest-node.
 */

import { normalizePath } from '../../../services/vault/vaultPaths';
import type { VaultItemLike } from './vaultExplorerModel';

/** Au-delà de ce nombre d'éléments, un champ de recherche rapide s'affiche. */
export const PICKER_SEARCH_THRESHOLD = 20;

export interface PickerGroup<T extends VaultItemLike> {
  /** Le chemin RELATIF au dossier partagé ('' = le dossier lui-même). */
  relativePath: string;
  items: T[];
}

export type GroupCheckState = 'all' | 'none' | 'some';

/** Le nom affiché d'un élément — le fichier, sinon le titre de la note. */
export function pickerItemName(item: VaultItemLike): string {
  return item.meta.fileName || item.meta.title || '';
}

/**
 * Le plus long préfixe de dossier commun à tous les éléments — la base par
 * défaut quand l'appelant ne la connaît pas (une sélection faite à la main).
 * Un seul élément à la racine suffit à ramener la base à la racine.
 */
export function commonBasePath(items: readonly VaultItemLike[]): string {
  if (items.length === 0) return '';
  let common: string[] | null = null;
  for (const it of items) {
    const segs = normalizePath(it.meta.path)
      .split('/')
      .filter((s) => s.length > 0);
    if (common === null) {
      common = segs;
      continue;
    }
    let k = 0;
    while (k < common.length && k < segs.length && common[k] === segs[k]) k++;
    common = common.slice(0, k);
    if (common.length === 0) break;
  }
  return (common ?? []).join('/');
}

/** `Contrats/2026/Q1` relatif à `Contrats` → `2026/Q1` ; hors de la base → le chemin entier. */
export function relativeTo(path: string | undefined, basePath: string): string {
  const p = normalizePath(path);
  const b = normalizePath(basePath);
  if (b === '') return p;
  if (p === b) return '';
  if (p.startsWith(`${b}/`)) return p.slice(b.length + 1);
  return p;
}

/**
 * Les éléments groupés par sous-dossier RELATIF à la base : le dossier partagé
 * lui-même en tête, puis ses sous-dossiers dans l'ordre du collator ; dans
 * chaque groupe, les éléments par nom. Un groupe vide n'existe pas — un
 * sous-dossier sans fichier n'a rien à cocher.
 */
export function groupBySubfolder<T extends VaultItemLike>(
  items: readonly T[],
  basePath: string | undefined,
  collator: { compare: (a: string, b: string) => number } = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  })
): PickerGroup<T>[] {
  const base = basePath === undefined ? commonBasePath(items) : normalizePath(basePath);
  const byRel = new Map<string, T[]>();
  for (const it of items) {
    const rel = relativeTo(it.meta.path, base);
    const bucket = byRel.get(rel);
    if (bucket) bucket.push(it);
    else byRel.set(rel, [it]);
  }
  const groups: PickerGroup<T>[] = [];
  for (const [relativePath, bucket] of byRel) {
    groups.push({
      relativePath,
      items: [...bucket].sort((a, b) => collator.compare(pickerItemName(a), pickerItemName(b))),
    });
  }
  groups.sort((a, b) => {
    if (a.relativePath === '') return -1;
    if (b.relativePath === '') return 1;
    return collator.compare(a.relativePath, b.relativePath);
  });
  return groups;
}

/** L'état de la case d'un groupe, déduit de ses éléments — jamais stocké à part. */
export function groupCheckState<T extends VaultItemLike>(
  group: PickerGroup<T>,
  checked: ReadonlySet<string>
): GroupCheckState {
  let n = 0;
  for (const it of group.items) if (checked.has(it.id)) n++;
  if (n === 0) return 'none';
  if (n === group.items.length) return 'all';
  return 'some';
}

/**
 * La case d'un groupe : tout coché → tout décocher ; sinon (rien ou partiel)
 * → tout cocher. Le partiel penche vers « tout », parce que c'est l'intention
 * la plus probable d'un clic sur une case à moitié pleine.
 */
export function toggleGroup<T extends VaultItemLike>(
  checked: ReadonlySet<string>,
  group: PickerGroup<T>
): Set<string> {
  const next = new Set(checked);
  const state = groupCheckState(group, checked);
  for (const it of group.items) {
    if (state === 'all') next.delete(it.id);
    else next.add(it.id);
  }
  return next;
}

/** Une case d'élément : l'élément entre ou sort, le reste tient. */
export function toggleItem(checked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(checked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** « Tout » : tous les éléments du lot. */
export function checkAll(items: readonly VaultItemLike[]): Set<string> {
  return new Set(items.map((i) => i.id));
}

/** « Aucun » : un ensemble neuf et vide. */
export function checkNone(): Set<string> {
  return new Set();
}

/** Les éléments COCHÉS, dans l'ordre du lot — ce que le scellement recevra. */
export function checkedItems<T extends VaultItemLike>(
  items: readonly T[],
  checked: ReadonlySet<string>
): T[] {
  return items.filter((i) => checked.has(i.id));
}

/** « N sur M » — le compteur de l'en-tête. */
export function pickerCounts(
  items: readonly VaultItemLike[],
  checked: ReadonlySet<string>
): { checked: number; total: number } {
  let n = 0;
  for (const it of items) if (checked.has(it.id)) n++;
  return { checked: n, total: items.length };
}

/**
 * Le filtre de la recherche rapide : sur le nom ET le chemin relatif, sans
 * casse. Un filtre ne change JAMAIS ce qui est coché — il ne fait que cacher ;
 * « Tout » / « Aucun » continuent de porter sur le lot entier, et le compteur
 * aussi, pour ne jamais laisser croire qu'un fichier hors filtre est sorti.
 */
export function filterGroups<T extends VaultItemLike>(
  groups: readonly PickerGroup<T>[],
  query: string
): PickerGroup<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];
  const out: PickerGroup<T>[] = [];
  for (const g of groups) {
    const pathMatches = g.relativePath.toLowerCase().includes(q);
    const items = pathMatches
      ? g.items
      : g.items.filter((it) => pickerItemName(it).toLowerCase().includes(q));
    if (items.length > 0) out.push({ relativePath: g.relativePath, items });
  }
  return out;
}
