/**
 * Opérations sur un bloc de colonnes — logique PURE.
 *
 * Aucune position de document ici, aucun `dispatch` : on prend un nœud
 * `columns` et on rend ce qui doit le remplacer. C'est ce qui rend les cas
 * limites (colonne vide, dernière colonne, contenu à ne pas perdre) testables
 * sans éditeur.
 *
 * RÈGLE QUI GOUVERNE TOUT LE FICHIER : rien de ce que l'utilisateur a écrit ne
 * disparaît sans qu'il l'ait demandé. Retirer une colonne DÉPLACE son contenu
 * chez la voisine ; seule l'action « supprimer la disposition », explicite et
 * marquée comme destructrice, efface.
 */

import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Le schéma impose `column{2,4}` : hors de ces bornes, le nœud est invalide. */
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

/**
 * Une colonne « vide » = un seul bloc textuel sans texte, c'est-à-dire ce
 * qu'une colonne neuve contient. Rien à sauver quand on la retire.
 */
export function isEmptyColumn(column: PMNode): boolean {
  if (column.childCount === 0) return true;
  if (column.childCount > 1) return false;
  const only = column.child(0);
  return only.isTextblock && only.content.size === 0;
}

/** Contenu de toutes les colonnes, à plat, dans l'ordre de lecture. */
export function dissolvedContent(columns: PMNode): Fragment {
  const blocks: PMNode[] = [];
  columns.forEach((column) => {
    column.forEach((block) => blocks.push(block));
  });
  return Fragment.fromArray(blocks);
}

/**
 * Fusionne le contenu de `source` dans `target`.
 *
 * `sourceComesFirst` n'est pas un détail : retirer la PREMIÈRE colonne verse
 * dans la suivante, et son contenu doit alors passer DEVANT. Ajouté à la fin,
 * il inverserait l'ordre de lecture — le texte est toujours là, mais plus dans
 * le bon sens, et rien à l'écran ne le signale.
 *
 * Une cible vide est REMPLACÉE plutôt que complétée : sans ça, chaque fusion
 * laisserait un paragraphe fantôme en tête de la colonne survivante.
 */
function mergeColumns(target: PMNode, source: PMNode, sourceComesFirst: boolean): PMNode {
  if (isEmptyColumn(source)) return target;
  if (isEmptyColumn(target)) return target.type.create(target.attrs, source.content, target.marks);
  const merged = sourceComesFirst
    ? source.content.append(target.content)
    : target.content.append(source.content);
  return target.type.create(target.attrs, merged, target.marks);
}

/**
 * Colonnes restantes après retrait de celle d'indice `index`, son contenu
 * versé dans la voisine (la précédente, ou la suivante quand on retire la
 * première).
 *
 * Rend `null` quand il ne resterait qu'UNE colonne : le schéma l'interdit, et
 * une disposition à une colonne n'a de toute façon aucun sens — l'appelant
 * dissout alors le bloc, ce qui garde tout le contenu dans le fil du document.
 */
export function columnsWithout(columns: PMNode, index: number): PMNode | null {
  if (index < 0 || index >= columns.childCount) return columns;
  if (columns.childCount <= MIN_COLUMNS) return null;

  const kept: PMNode[] = [];
  const removed = columns.child(index);
  const neighbour = index > 0 ? index - 1 : 1;

  columns.forEach((column, _offset, i) => {
    if (i === index) return;
    kept.push(i === neighbour ? mergeColumns(column, removed, index < i) : column);
  });

  return columns.type.create(
    { ...columns.attrs, count: kept.length },
    Fragment.fromArray(kept),
    columns.marks
  );
}

/**
 * Le même bloc avec une colonne vide de plus. `null` au-delà de la limite du
 * schéma — l'appelant désactive alors son bouton plutôt que de tenter une
 * transaction que ProseMirror rejetterait en silence.
 */
export function columnsWithExtra(columns: PMNode): PMNode | null {
  if (columns.childCount >= MAX_COLUMNS) return null;
  const columnType = columns.type.schema.nodes.column;
  const paragraph = columns.type.schema.nodes.paragraph;
  if (!columnType || !paragraph) return null;

  const next = columns.type.create(
    { ...columns.attrs, count: columns.childCount + 1 },
    columns.content.append(Fragment.from(columnType.create(null, paragraph.create()))),
    columns.marks
  );
  return next;
}
