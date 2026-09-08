/**
 * listAwareCommands — Filarr Notes
 *
 * Les transformations de bloc que ProseMirror refuse à l'intérieur d'un item
 * de liste, rendues applicables depuis TOUS les points d'entrée : menu slash,
 * barre d'outils, menu de la poignée de bloc.
 *
 * Extrait de `SlashCommandMenu.tsx` : la poignée de bloc vit dans un plugin
 * ProseMirror et la barre d'outils dans `NoteEditor`. Importer le composant
 * React du menu depuis l'un ou l'autre tirerait tout l'arbre React dans le
 * plugin et refermerait un cycle d'imports — d'où ce module qui ne dépend que
 * du type `Editor` et des primitives ProseMirror.
 */

import type { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { ReplaceAroundStep } from '@tiptap/pm/transform';

/**
 * Sort d'UN cran l'item de liste courant hors de SA liste, en scindant celle-ci
 * au-dessus et en dessous de l'item.
 *
 * Pourquoi ne pas simplement appeler `liftListItem` : sur un item NICHÉ,
 * `prosemirror-schema-list` bascule sur `liftToOuterList`, dont le
 * `ReplaceAroundStep` REPARENTE les sous-sœurs suivantes comme enfants de
 * l'item soulevé — au cran d'après elles sont déversées au niveau du document.
 * `/quote` sur B2 dans `ul(A(ul(B1,B2,B3)),C)` rendait ainsi B3 orpheline à la
 * racine et détachait C dans une troisième liste.
 *
 * On réimplémente donc `liftOutOfList` (non exporté par
 * `prosemirror-schema-list`) et on l'applique à la liste la PLUS PROCHE, quelle
 * que soit la profondeur : la citation se pose à la place exacte de la ligne,
 * les sœurs restent là où elles étaient.
 */
function dissolveListItemOnce(editor: Editor, itemTypeName: string): boolean {
  const { state } = editor;
  const itemType = state.schema.nodes[itemTypeName];
  if (!itemType) return false;

  const { $from, $to } = state.selection;
  const range = $from.blockRange(
    $to,
    (node) => node.childCount > 0 && node.firstChild?.type === itemType
  );
  if (!range) return false;

  const list = range.parent;
  const tr = state.tr;

  // Fusion des items couverts par la sélection en un seul : la poignée de bloc
  // sélectionne la liste ENTIÈRE (`selectBlockContent`) et promet de convertir
  // tous ses items d'un coup. Sans cette boucle, le pas ci-dessous ne verrait
  // qu'un item sur N et rendrait `false`.
  for (let pos = range.end, i = range.endIndex - 1, e = range.startIndex; i > e; i--) {
    pos -= list.child(i).nodeSize;
    tr.delete(pos - 1, pos + 1);
  }

  const $start = tr.doc.resolve(range.start);
  const item = $start.nodeAfter;
  if (!item || item.type !== itemType) return false;
  if (tr.mapping.map(range.end) !== range.start + item.nodeSize) return false;

  const atStart = range.startIndex === 0;
  const atEnd = range.endIndex === list.childCount;
  // Le parent RÉEL : `doc` pour une liste de premier niveau, le `listItem`
  // porteur pour une sous-liste. C'est lui qui doit accepter le contenu extrait.
  const parent = $start.node(-1);
  const indexBefore = $start.index(-1);
  const canReplace = parent.canReplace(
    indexBefore + (atStart ? 0 : 1),
    indexBefore + 1,
    item.content.append(atEnd ? Fragment.empty : Fragment.from(list.copy(Fragment.empty)))
  );
  if (!canReplace) return false;

  // Retire l'enveloppe `listItem` et referme la liste des côtés où l'item n'est
  // pas au bord ; là où il l'est, la liste est réécrite jusqu'à son extrémité.
  const start = $start.pos;
  const end = start + item.nodeSize;
  tr.step(
    new ReplaceAroundStep(
      start - (atStart ? 1 : 0),
      end + (atEnd ? 1 : 0),
      start + 1,
      end - 1,
      new Slice(
        (atStart ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))).append(
          atEnd ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))
        ),
        atStart ? 0 : 1,
        atEnd ? 0 : 1
      ),
      atStart ? 0 : 1
    )
  );
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Exécute une commande de bloc qui ne peut pas légalement s'appliquer dans un
 * item de liste, en sortant d'abord le caret de la liste quand il le faut.
 *
 * `listItem` est `content: "paragraph block*"` — son premier enfant DOIT être
 * un paragraphe. Envelopper ce paragraphe dans un `blockquote` (`content:
 * "block+"`) ou le changer en `heading` produit un document invalide : la
 * commande ProseMirror sous-jacente rend `false` et ne fait rien. Le menu
 * slash ayant supprimé le « /quote » tapé dans une étape séparée en amont,
 * l'utilisateur voyait son texte disparaître sans voir de citation arriver.
 *
 * Sortir de la liste d'abord est ce que l'utilisateur demande réellement :
 * « /quote » sur une puce veut dire « transforme cette ligne en citation »,
 * pas « imbrique une citation dans la puce ». La ligne est extraite À SA PLACE
 * (voir `dissolveListItemOnce`) : ses sœurs, y compris dans une sous-liste,
 * restent là où elles sont. Les listes imbriquées peuvent demander plusieurs
 * crans, d'où la boucle.
 */
export function applyOutsideList(
  editor: Editor,
  canApply: () => boolean,
  apply: () => boolean
): boolean {
  if (canApply()) return apply();

  const itemType = editor.isActive('taskItem') ? 'taskItem' : 'listItem';
  // Borné : un document imbriqué plus profond que ça est pathologique, et une
  // boucle non bornée ici figerait l'éditeur si la dissolution devenait no-op.
  for (let level = 0; level < 8 && editor.isActive(itemType); level++) {
    if (!dissolveListItemOnce(editor, itemType)) break;
    if (canApply()) return apply();
  }

  // Toujours pas applicable — on l'exécute quand même pour que l'appelant
  // reçoive le vrai résultat (et puisse prévenir l'utilisateur).
  return apply();
}

/**
 * Test d'applicabilité des commandes d'insertion, qui n'ont pas de `can()`
 * exploitable : `insertTable` annonce toujours un succès, puis pose la table
 * là où le schéma l'accepte — imbriquée DANS l'item de liste, sous la ligne
 * où l'utilisateur a tapé « / », ou en avalant toute la liste quand elle ne
 * contenait qu'un item vide. Le test se réduit donc à « le caret n'est pas
 * dans un item de liste ».
 */
export function isOutsideList(editor: Editor): boolean {
  return !editor.isActive('listItem') && !editor.isActive('taskItem');
}
