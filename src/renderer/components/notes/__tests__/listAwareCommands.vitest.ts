/**
 * `/quote` (et Titre, Code) sur une puce doit transformer CETTE ligne À SA
 * PLACE, sans démolir la liste autour.
 *
 * Le défaut historique était invisible à `tsc` et invisible sur une liste
 * plate : seule une puce NICHÉE le révélait. `liftListItem` bascule sur
 * `liftToOuterList` dès que l'item a un `listItem` pour grand-parent, et ce
 * chemin REPARENTE les sous-sœurs suivantes sous l'item soulevé — au cran
 * d'après elles atterrissaient à la racine du document, et la sœur du niveau
 * externe se retrouvait détachée dans une troisième liste.
 *
 * Ces cas sont figés ici parce qu'ils couvrent les douze points d'entrée du
 * produit (menu slash, barre d'outils, menu de la poignée de bloc) d'un seul
 * jeu d'assertions : tous appellent `applyOutsideList`.
 *
 * Montage sans DOM : `getSchema` donne le VRAI schéma de l'éditeur de notes
 * (mêmes extensions que `NoteEditor`), et l'éditeur est réduit au contrat que
 * `applyOutsideList` consomme réellement — `state`, `view.dispatch`,
 * `isActive`. Les commandes passées en `canApply`/`apply` sont les vraies
 * commandes ProseMirror derrière `toggleBlockquote`.
 */

import { describe, it, expect } from 'vitest';
import { getSchema, type Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { wrapIn } from '@tiptap/pm/commands';
import { applyOutsideList, isOutsideList } from '../listAwareCommands';

const schema = getSchema([
  StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3, 4] }, link: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
]);

// ---- constructeurs de documents -------------------------------------------

const para = (text?: string): PMNode =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
const li = (...content: PMNode[]): PMNode => schema.nodes.listItem.create(null, content);
const ul = (...items: PMNode[]): PMNode => schema.nodes.bulletList.create(null, items);
const task = (...content: PMNode[]): PMNode => schema.nodes.taskItem.create(null, content);
const taskList = (...items: PMNode[]): PMNode => schema.nodes.taskList.create(null, items);
const docOf = (...content: PMNode[]): PMNode => schema.nodes.doc.create(null, content);

/** Sérialisation compacte : `bulletList(listItem(paragraph("A")))`. */
function fmt(node: PMNode): string {
  if (node.isText) return JSON.stringify(node.text);
  const kids: string[] = [];
  node.forEach((child) => kids.push(fmt(child)));
  return `${node.type.name}(${kids.join(',')})`;
}

// ---- éditeur minimal -------------------------------------------------------

interface Harness {
  editor: Editor;
  /** Pose un caret à la fin du n-ième paragraphe du document. */
  caretInParagraph: (index: number) => void;
  /** Sélectionne le contenu entier du bloc de premier niveau à `pos` (poignée). */
  selectBlockContent: (pos: number) => void;
  quote: () => boolean;
  doc: () => string;
}

function mount(initial: PMNode): Harness {
  let state = EditorState.create({ doc: initial, schema });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };

  const editor = {
    get state() {
      return state;
    },
    view: { dispatch },
    isActive(name: string) {
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name === name) return true;
      }
      return false;
    },
  } as unknown as Editor;

  const paragraphEnds = () => {
    const ends: number[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph') ends.push(pos + 1 + node.content.size);
      return true;
    });
    return ends;
  };

  return {
    editor,
    caretInParagraph(index) {
      const pos = paragraphEnds()[index];
      if (pos == null) throw new Error(`paragraphe ${index} introuvable`);
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    },
    selectBlockContent(pos) {
      // VERBATIM `dragHandlePlugin.selectBlockContent` : la poignée désigne le
      // bloc de premier niveau, donc la LISTE entière, pas la ligne survolée.
      const node = state.doc.nodeAt(pos);
      if (!node) throw new Error(`aucun bloc en ${pos}`);
      const $from = state.doc.resolve(Math.min(pos + 1, state.doc.content.size));
      const $to = state.doc.resolve(Math.min(pos + node.nodeSize - 1, state.doc.content.size));
      dispatch(state.tr.setSelection(TextSelection.between($from, $to)));
    },
    quote() {
      // `toggleBlockquote` sur un document sans citation = `wrapIn(blockquote)`.
      return applyOutsideList(
        editor,
        () => wrapIn(schema.nodes.blockquote)(state),
        () => wrapIn(schema.nodes.blockquote)(state, dispatch)
      );
    },
    doc: () => fmt(state.doc),
  };
}

const threeBullets = () => docOf(ul(li(para('one')), li(para('two')), li(para('three'))));

const nested = () =>
  docOf(ul(li(para('A'), ul(li(para('B1')), li(para('B2')), li(para('B3')))), li(para('C'))));

const threeTasks = () => docOf(taskList(task(para('t1')), task(para('t2')), task(para('t3'))));

// ---- 1. listes plates : ne pas régresser -----------------------------------

describe('applyOutsideList — puce de premier niveau', () => {
  it('scinde la liste sous la 1re puce et pose la citation au-dessus', () => {
    const h = mount(threeBullets());
    h.caretInParagraph(0);

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(blockquote(paragraph("one")),bulletList(listItem(paragraph("two")),listItem(paragraph("three"))))'
    );
  });

  it('coupe la liste en deux autour de la puce du milieu', () => {
    const h = mount(threeBullets());
    h.caretInParagraph(1);

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(bulletList(listItem(paragraph("one"))),blockquote(paragraph("two")),bulletList(listItem(paragraph("three"))))'
    );
  });

  it('pose la citation sous la liste quand la dernière puce est visée', () => {
    const h = mount(threeBullets());
    h.caretInParagraph(2);

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(bulletList(listItem(paragraph("one")),listItem(paragraph("two"))),blockquote(paragraph("three")))'
    );
  });
});

// ---- 2. puce unique : la ligne DEVIENT la citation --------------------------

describe('applyOutsideList — puce unique', () => {
  it('remplace la liste par la citation (comportement attendu, pas un défaut)', () => {
    const h = mount(docOf(ul(li(para('solo')))));
    h.caretInParagraph(0);

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe('doc(blockquote(paragraph("solo")))');
  });

  it('marche aussi sur une puce vide fraîchement créée', () => {
    const h = mount(docOf(ul(li(para()))));
    h.caretInParagraph(0);

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe('doc(blockquote(paragraph()))');
  });
});

// ---- 3. sous-puce : LE défaut corrigé --------------------------------------

describe('applyOutsideList — sous-puce imbriquée', () => {
  it('transforme la sous-puce du milieu SANS déraciner ses sœurs ni la sœur externe', () => {
    const h = mount(nested());
    h.caretInParagraph(2); // B2

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(bulletList(' +
        'listItem(paragraph("A"),bulletList(listItem(paragraph("B1"))),' +
        'blockquote(paragraph("B2")),' +
        'bulletList(listItem(paragraph("B3")))),' +
        'listItem(paragraph("C"))))'
    );
  });

  it('garde B2 et B3 sous A quand la 1re sous-puce est visée', () => {
    const h = mount(nested());
    h.caretInParagraph(1); // B1

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(bulletList(' +
        'listItem(paragraph("A"),blockquote(paragraph("B1")),' +
        'bulletList(listItem(paragraph("B2")),listItem(paragraph("B3")))),' +
        'listItem(paragraph("C"))))'
    );
  });

  it('garde la citation sous A quand la dernière sous-puce est visée', () => {
    const h = mount(nested());
    h.caretInParagraph(3); // B3

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(bulletList(' +
        'listItem(paragraph("A"),bulletList(listItem(paragraph("B1")),listItem(paragraph("B2"))),' +
        'blockquote(paragraph("B3"))),' +
        'listItem(paragraph("C"))))'
    );
  });

  it('ne remonte pas la feuille au-delà de son propre niveau (imbrication 3)', () => {
    const h = mount(docOf(ul(li(para('A'), ul(li(para('B'), ul(li(para('X')), li(para('Y')))))))));
    h.caretInParagraph(2); // X

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(bulletList(listItem(paragraph("A"),bulletList(listItem(paragraph("B"),' +
        'blockquote(paragraph("X")),' +
        'bulletList(listItem(paragraph("Y"))))))))'
    );
  });
});

// ---- 4. poignée de bloc : la liste ENTIÈRE d'un coup ------------------------

describe('applyOutsideList — sélection multi-items (poignée de bloc)', () => {
  it('convertit les trois puces en une seule citation à trois lignes', () => {
    const h = mount(threeBullets());
    h.selectBlockContent(0);

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe('doc(blockquote(paragraph("one"),paragraph("two"),paragraph("three")))');
  });

  it('avale la sous-liste avec son porteur sans perdre de contenu', () => {
    const h = mount(docOf(ul(li(para('A'), ul(li(para('B1')), li(para('B2')))), li(para('C')))));
    h.selectBlockContent(0);

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(blockquote(paragraph("A"),' +
        'bulletList(listItem(paragraph("B1")),listItem(paragraph("B2"))),' +
        'paragraph("C")))'
    );
  });
});

// ---- 5. listes de tâches ----------------------------------------------------

describe('applyOutsideList — listes de tâches', () => {
  it('scinde la liste de tâches autour de la tâche visée', () => {
    const h = mount(threeTasks());
    h.caretInParagraph(1);

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(taskList(taskItem(paragraph("t1"))),blockquote(paragraph("t2")),taskList(taskItem(paragraph("t3"))))'
    );
  });

  it('traite la sous-tâche imbriquée à sa place, comme une sous-puce', () => {
    const h = mount(
      docOf(
        taskList(
          task(para('A'), taskList(task(para('B1')), task(para('B2')), task(para('B3')))),
          task(para('C'))
        )
      )
    );
    h.caretInParagraph(2); // B2

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(taskList(' +
        'taskItem(paragraph("A"),taskList(taskItem(paragraph("B1"))),' +
        'blockquote(paragraph("B2")),' +
        'taskList(taskItem(paragraph("B3")))),' +
        'taskItem(paragraph("C"))))'
    );
  });
});

// ---- 6. contrat de retour ---------------------------------------------------

describe('applyOutsideList — contrat', () => {
  it('applique directement, sans toucher à la liste, quand la commande est déjà légale', () => {
    const h = mount(docOf(para('plain'), ul(li(para('one')))));
    h.caretInParagraph(0);

    expect(h.quote()).toBe(true);
    expect(h.doc()).toBe(
      'doc(blockquote(paragraph("plain")),bulletList(listItem(paragraph("one"))))'
    );
  });

  it('rend le résultat de `apply` — `false` déclenche le toast et la réinsertion du texte tapé', () => {
    const h = mount(docOf(ul(li(para('one')))));
    h.caretInParagraph(0);
    let applyCalls = 0;

    const result = applyOutsideList(
      h.editor,
      () => false,
      () => {
        applyCalls += 1;
        return false;
      }
    );

    expect(result).toBe(false);
    expect(applyCalls).toBeGreaterThan(0);
  });

  it('ne boucle pas indéfiniment quand la commande reste inapplicable', () => {
    const h = mount(nested());
    h.caretInParagraph(2);
    let canApplyCalls = 0;

    applyOutsideList(
      h.editor,
      () => {
        canApplyCalls += 1;
        return false;
      },
      () => false
    );

    // 1 test initial + au plus 8 crans de boucle
    expect(canApplyCalls).toBeLessThanOrEqual(9);
  });
});

// ---- 7. garde d'insertion ---------------------------------------------------

describe('isOutsideList', () => {
  it('rend faux dans une puce et dans une tâche, vrai dans un paragraphe nu', () => {
    const inBullet = mount(docOf(ul(li(para('one')))));
    inBullet.caretInParagraph(0);
    expect(isOutsideList(inBullet.editor)).toBe(false);

    const inTask = mount(threeTasks());
    inTask.caretInParagraph(0);
    expect(isOutsideList(inTask.editor)).toBe(false);

    const plain = mount(docOf(para('plain')));
    plain.caretInParagraph(0);
    expect(isOutsideList(plain.editor)).toBe(true);
  });
});
