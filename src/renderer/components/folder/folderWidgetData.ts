/**
 * Dossiers personnalisables — CE QUE LES BLOCS CONTEXTUELS LISENT.
 *
 * Des fonctions PURES, prenant les tranches du store telles quelles. Elles ne
 * sont pas des `createSelector` : un sélecteur mémoïsé se paramètre mal (il
 * faudrait une fabrique par dossier, donc un cache qui grandit avec le nombre de
 * dossiers visités), alors qu'ici la clé varie à chaque écran. Les blocs les
 * appellent dans un `useMemo` dont les dépendances sont les tranches elles-mêmes
 * — références stables tant que le store ne change pas —, ce qui donne la même
 * garantie sans le cache.
 */

import type { Folder, Item } from '../../../types';
import type { Note } from '../../../types/notes';

type ById<T> = Record<string, T>;

/** Le contenu DIRECT d'un dossier, dossiers et fichiers mélangés. */
export function directItems(
  foldersById: ById<Folder>,
  filesById: ById<Item>,
  folderId: string | null
): Item[] {
  if (!folderId) return [];
  const folder = foldersById[folderId];
  if (!folder?.items) return [];
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const entry of folder.items as unknown[]) {
    const id =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && 'id' in entry
          ? String((entry as { id: unknown }).id)
          : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const resolved = filesById[id] ?? foldersById[id];
    if (resolved && !(resolved as { deletedAt?: string }).deletedAt) out.push(resolved as Item);
  }
  return out;
}

/** Les sous-dossiers directs, dans l'ordre du dossier. */
export function directSubfolders(
  foldersById: ById<Folder>,
  filesById: ById<Item>,
  folderId: string | null
): Folder[] {
  return directItems(foldersById, filesById, folderId).filter(
    (item): item is Folder => 'items' in item
  );
}

export interface SubtreeStats {
  files: number;
  folders: number;
  bytes: number;
}

/**
 * Le poids d'un dossier, sous-dossiers compris.
 *
 * `visited` n'est pas de la prudence gratuite : l'arbre vient du disque et d'une
 * fusion, et un cycle (un dossier redevenu son propre ancêtre après un
 * déplacement arbitré des deux côtés) ferait tourner cette fonction sans fin —
 * dans un `useMemo`, donc en gelant l'écran sans le moindre message.
 */
export function subtreeStats(
  foldersById: ById<Folder>,
  filesById: ById<Item>,
  folderId: string | null
): SubtreeStats {
  const stats: SubtreeStats = { files: 0, folders: 0, bytes: 0 };
  if (!folderId) return stats;
  const visited = new Set<string>();
  const stack: string[] = [folderId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const item of directItems(foldersById, filesById, current)) {
      if ('items' in item) {
        stats.folders += 1;
        stack.push(item.id);
      } else {
        stats.files += 1;
        stats.bytes +=
          typeof (item as { size?: unknown }).size === 'number'
            ? (item as { size: number }).size
            : 0;
      }
    }
  }
  return stats;
}

/** Les notes vivantes rangées DANS ce dossier, les plus récentes d'abord. */
export function notesOfFolder(notesById: ById<Note>, folderId: string | null): Note[] {
  if (!folderId) return [];
  return Object.values(notesById)
    .filter((note) => !!note && !note.deletedAt && note.parentId === folderId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export interface FolderTask {
  noteId: string;
  noteTitle: string;
  text: string;
}

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const typed = node as { type?: string; text?: string; content?: unknown[] };
  if (typed.type === 'text') return typed.text ?? '';
  if (Array.isArray(typed.content)) return typed.content.map(textOf).join('');
  return '';
}

/**
 * Les cases à cocher NON COCHÉES des notes d'un dossier.
 *
 * Le contenu d'une note est du JSON ProseMirror rangé en chaîne : il est lu au
 * vol, sans monter d'éditeur. Une note illisible (contenu tronqué, format d'une
 * version future) est SAUTÉE — un bloc qui ne sait pas lire une note doit
 * afficher les autres, pas disparaître.
 */
export function pendingTasks(notes: readonly Note[], limit: number): FolderTask[] {
  const out: FolderTask[] = [];
  for (const note of notes) {
    let doc: unknown;
    try {
      doc = JSON.parse(note.content);
    } catch {
      continue;
    }
    const stack: unknown[] = [doc];
    while (stack.length > 0 && out.length < limit) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const typed = node as { type?: string; attrs?: { checked?: unknown }; content?: unknown[] };
      if (typed.type === 'taskItem' && typed.attrs?.checked !== true) {
        const text = textOf(typed).trim();
        if (text.length > 0) {
          out.push({ noteId: note.id, noteTitle: note.title, text });
        }
      }
      if (Array.isArray(typed.content)) {
        // Empilé à l'envers pour que la lecture reste dans l'ordre du document.
        for (let i = typed.content.length - 1; i >= 0; i -= 1) stack.push(typed.content[i]);
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Le contenu d'un dossier, le plus récemment touché d'abord. */
export function byRecency<T extends { updatedAt?: string; createdAt?: string }>(
  items: readonly T[]
): T[] {
  return [...items].sort((a, b) => {
    const dateA = a.updatedAt || a.createdAt || '';
    const dateB = b.updatedAt || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });
}
