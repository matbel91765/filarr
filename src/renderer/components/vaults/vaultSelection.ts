/**
 * vaultSelection — la SÉLECTION MULTIPLE de l'explorateur de coffre, en pur.
 *
 * POURQUOI UN MODULE À PART. La grammaire de sélection (Ctrl = basculer,
 * Shift = plage dans l'ordre AFFICHÉ, Ctrl+A = tout) et la résolution
 * « identifiants cochés → éléments réels » sont deux endroits où un
 * booléen inversé ou un préfixe oublié compile parfaitement et coûte cher :
 * une plage qui saute un élément, un dossier sélectionné dont on ne supprime
 * que la coque, un id nu qui traverse la frontière des deux mondes. Rien ici
 * n'importe React ni Redux : tout s'éprouve sous vitest-node.
 *
 * LES IDENTIFIANTS SONT CEUX D'AFFICHAGE — `vaultitem:<id>` pour un élément,
 * `vaultdir:<chemin>` pour un dossier — exactement ceux que portent les cartes
 * (`toVaultDisplayItems`). Un dossier de coffre n'a pas de ligne serveur : le
 * sélectionner, c'est sélectionner tout ce qui vit sous son chemin, comme le
 * fait déjà `planFolderDelete` pour la suppression récursive.
 */

import {
  normalizePath,
  isDescendantOrSelf,
  planFolderDelete,
  type MoveSource,
} from '../../../services/vault/vaultPaths';
import {
  VAULT_DIR_PREFIX,
  VAULT_ITEM_PREFIX,
  idFromItemId,
  pathFromDirId,
  type VaultItemLike,
} from './vaultExplorerModel';

// ─────────────────────────────────────────────────────────────────────────────
// La grammaire — des ensembles NEUFS, jamais mutés (l'état React l'exige)
// ─────────────────────────────────────────────────────────────────────────────

/** Ctrl/Cmd+clic ou case à cocher : l'élément entre ou sort, le reste tient. */
export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Shift+clic : la plage entre l'ancre et la cible, dans l'ordre AFFICHÉ
 * (dossiers puis fichiers triés — l'ordre que l'œil parcourt, pas l'ordre du
 * store). Sans ancre valable (jamais cliqué, ou l'ancre a quitté l'écran) la
 * plage se réduit à la cible : un Shift+clic ne doit jamais ne rien faire.
 */
export function rangeSelection(
  orderedIds: readonly string[],
  anchor: string | null,
  target: string
): string[] {
  const end = orderedIds.indexOf(target);
  if (end === -1) return [];
  const start = anchor === null ? -1 : orderedIds.indexOf(anchor);
  if (start === -1) return [target];
  return orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** Shift+clic AJOUTE la plage à la sélection existante (patron de l'explorateur perso). */
export function extendSelectionWithRange(
  selected: ReadonlySet<string>,
  orderedIds: readonly string[],
  anchor: string | null,
  target: string
): Set<string> {
  const next = new Set(selected);
  for (const id of rangeSelection(orderedIds, anchor, target)) next.add(id);
  return next;
}

/** Ctrl+A : tout ce qui est VISIBLE — fichiers ET dossiers. */
export function selectAllIds(orderedIds: readonly string[]): Set<string> {
  return new Set(orderedIds);
}

/**
 * La sélection RÉELLE : ce qui est coché ET encore à l'écran. Un élément
 * supprimé par un autre membre, ou sorti par la recherche, ne compte plus —
 * sans quoi le compteur de la barre mentirait, et une action porterait sur un
 * fantôme. Calculé à chaque rendu plutôt que synchronisé : pas d'état de plus.
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  orderedIds: readonly string[]
): Set<string> {
  const visible = new Set(orderedIds);
  const next = new Set<string>();
  for (const id of selected) if (visible.has(id)) next.add(id);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// La résolution — des identifiants d'affichage aux éléments réels
// ─────────────────────────────────────────────────────────────────────────────

/** Un CONTENU : ni marqueur de dossier, ni fil de discussion — la règle de `toVaultDisplayItems`. */
export function isContentItem(item: VaultItemLike): boolean {
  return !item.meta.folderMarker && !item.meta.threadFor;
}

/**
 * Les contenus sous un dossier (lui compris), dans l'ordre du store. Les
 * marqueurs et les fils sont des implémentations, pas du contenu : on ne les
 * partage pas, on ne les télécharge pas.
 */
export function folderDescendantFiles<T extends VaultItemLike>(
  allItems: readonly T[],
  folderPath: string
): T[] {
  const from = normalizePath(folderPath);
  return allItems.filter(
    (i) => isContentItem(i) && isDescendantOrSelf(normalizePath(i.meta.path), from)
  );
}

export interface ResolvedSelection<T extends VaultItemLike> {
  /** Les éléments cochés DIRECTEMENT (contenus seulement). */
  items: T[];
  /** Les chemins des dossiers cochés, normalisés, sans doublon. */
  folderPaths: string[];
  /**
   * Les contenus sous les dossiers cochés, hors ceux déjà cochés directement
   * (un fichier coché dans un dossier lui aussi coché ne compte qu'une fois).
   */
  descendants: T[];
  /** `items` + `descendants` — ce que voit une action RÉCURSIVE (partage, suppression). */
  allFiles: T[];
  /** Les sources d'un « Déplacer » : les éléments nommés et les dossiers entiers. */
  moveSources: MoveSource[];
}

/**
 * Identifiants cochés → éléments et dossiers réels. Un id sans préfixe connu
 * ou un id d'élément absent du store (supprimé entre-temps) est ignoré, pas
 * inventé. Les dossiers imbriqués l'un dans l'autre ne comptent leurs
 * descendants qu'une fois.
 */
export function resolveSelection<T extends VaultItemLike>(
  selected: ReadonlySet<string>,
  allItems: readonly T[]
): ResolvedSelection<T> {
  const byId = new Map<string, T>();
  for (const it of allItems) byId.set(it.id, it);

  const items: T[] = [];
  const folderPaths: string[] = [];
  const seenPaths = new Set<string>();
  for (const id of selected) {
    if (id.startsWith(VAULT_ITEM_PREFIX)) {
      const it = byId.get(idFromItemId(id));
      if (it && isContentItem(it)) items.push(it);
    } else if (id.startsWith(VAULT_DIR_PREFIX)) {
      const p = normalizePath(pathFromDirId(id));
      // La racine n'est pas un dossier sélectionnable ; un doublon non plus.
      if (p && !seenPaths.has(p)) {
        seenPaths.add(p);
        folderPaths.push(p);
      }
    }
  }

  // Un dossier coché SOUS un autre dossier coché n'ajoute rien : ses contenus
  // sont déjà ceux de l'ancêtre. On ne garde que les plus hauts — sinon un
  // « Déplacer » planifierait deux destinations pour les mêmes fichiers selon
  // l'ordre du clic, et un plan de suppression compterait deux fois.
  const topFolderPaths = folderPaths.filter(
    (p) => !folderPaths.some((other) => other !== p && isDescendantOrSelf(p, other))
  );
  folderPaths.length = 0;
  folderPaths.push(...topFolderPaths);

  const direct = new Set(items.map((i) => i.id));
  const descendants: T[] = [];
  const seenDesc = new Set<string>();
  for (const it of allItems) {
    if (!isContentItem(it) || direct.has(it.id) || seenDesc.has(it.id)) continue;
    const p = normalizePath(it.meta.path);
    if (folderPaths.some((f) => isDescendantOrSelf(p, f))) {
      seenDesc.add(it.id);
      descendants.push(it);
    }
  }

  return {
    items,
    folderPaths,
    descendants,
    allFiles: [...items, ...descendants],
    moveSources: [
      ...items.map((i): MoveSource => ({ kind: 'item', id: i.id })),
      ...folderPaths.map((path): MoveSource => ({ kind: 'folder', path })),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Le plan de suppression d'une sélection — la matrice élément par élément
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectionDeletePlan {
  /** Les ids à supprimer : contenus des éléments cochés, puis les plans de dossiers. */
  deletions: string[];
  /** Combien de contenus la matrice a REFUSÉS — la confirmation le dit. */
  skipped: number;
  /** Combien de contenus la sélection couvre au total (cochés + sous les dossiers). */
  totalContent: number;
}

/**
 * La suppression d'une sélection = les éléments cochés passés à la matrice
 * (`canDelete`, le même prédicat que le serveur) + le plan récursif de chaque
 * dossier coché (`planFolderDelete`, marqueurs compris, profond → racine). Les
 * FILS de discussion des fichiers supprimés suivent leur fichier, comme le
 * fait le geste unitaire — best-effort : un fil que la matrice refuse reste.
 *
 * Aucun id en double, même quand un fichier coché vit sous un dossier coché :
 * un DELETE rejoué serait un `item_not_found` compté comme succès, mais
 * fausserait la progression.
 */
export function planSelectionDelete<T extends VaultItemLike>(
  allItems: readonly T[],
  resolved: ResolvedSelection<T>,
  canDelete: (item: T) => boolean
): SelectionDeletePlan {
  const deletions: string[] = [];
  const planned = new Set<string>();
  let skipped = 0;
  let totalContent = 0;

  const threadsByFile = new Map<string, T>();
  for (const it of allItems) {
    if (it.meta.threadFor) threadsByFile.set(it.meta.threadFor, it);
  }
  const push = (id: string) => {
    if (planned.has(id)) return;
    planned.add(id);
    deletions.push(id);
  };

  for (const it of resolved.items) {
    totalContent++;
    if (!canDelete(it)) {
      skipped++;
      continue;
    }
    push(it.id);
    const thread = threadsByFile.get(it.id);
    if (thread && canDelete(thread)) push(thread.id);
  }

  for (const path of resolved.folderPaths) {
    const plan = planFolderDelete(allItems, path, canDelete);
    // Le plan du dossier compte TOUS ses contenus ; ceux déjà cochés
    // directement l'ont été ci-dessus (total ET refus) — on ne les recompte pas.
    const direct = resolved.items.filter((i) =>
      isDescendantOrSelf(normalizePath(i.meta.path), path)
    );
    const directRefused = direct.filter((i) => !canDelete(i)).length;
    totalContent += Math.max(0, plan.totalContent - direct.length);
    skipped += Math.max(0, plan.skippedContent - directRefused);
    for (const id of plan.deletions) push(id);
  }

  return { deletions, skipped, totalContent };
}
