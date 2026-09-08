/**
 * Identité d'une base inline à la COPIE.
 *
 * Deux bases qui portent la même identité font résoudre une relation sur la
 * mauvaise : des valeurs fausses, et rien à l'écran qui le dise. Ce qui est
 * vérifié ici est exactement ce qu'aucun typage ne peut promettre — quels
 * gestes sont des copies (collage, duplication de bloc, note dupliquée,
 * modèle), lesquels n'en sont PAS (couper/coller, glissé interne, la même note
 * ouverte deux fois), et qui garde l'identité quand deux blocs se la disputent.
 *
 * Le greffon est éprouvé sur un vrai document ProseMirror, avec un schéma
 * minimal : c'est la seule façon de tester les positions et le report des
 * transactions plutôt qu'une paraphrase de l'implémentation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { InlineDbData } from '../types';
import { serializeDbData } from '../types';
import { clearCutDbIdentities, dbIdentityPlugin } from '../dbIdentityPlugin';
import { collectInlineDbs, createInlineDbCollector, restampCopiedDbIds } from '../dbIndex';
import { createNewNote } from '../../../../../../store/slices/notesSlice';

/* ==================== Document d'essai ==================== */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    // Bloc conteneur : une base peut vivre imbriquée (callout, colonnes…)
    callout: { group: 'block', content: 'block+' },
    inlineDatabase: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: {
        title: { default: '' },
        dbId: { default: '' },
        data: { default: '{"properties":[],"rows":[]}' },
      },
    },
  },
});

function dataOf(viewId: string, targetDbId?: string): InlineDbData {
  return {
    properties: [
      { id: `p-${viewId}`, name: 'Nom', type: 'text' },
      ...(targetDbId
        ? [{ id: `p-rel-${viewId}`, name: 'Lien', type: 'relation' as const, targetDbId }]
        : []),
    ],
    rows: [{ id: `r-${viewId}`, cells: {} }],
    views: [{ id: viewId, name: 'Vue', type: 'table', filters: [], sorts: [] }],
  };
}

function dbNode(dbId: string, data: InlineDbData = dataOf('v-1')): PMNode {
  return schema.nodes.inlineDatabase.create({ dbId, data: serializeDbData(data) });
}

function para(text = 'texte'): PMNode {
  return schema.nodes.paragraph.create(null, schema.text(text));
}

function docOf(nodes: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, nodes);
}

function stateOf(nodes: PMNode[], isEditable = true): EditorState {
  return EditorState.create({
    doc: docOf(nodes),
    plugins: [dbIdentityPlugin({ isEditable: () => isEditable })],
  });
}

/** Identités des blocs base du document, dans l'ordre */
function idsOf(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.descendants((node) => {
    if (node.type.name !== 'inlineDatabase') return true;
    out.push(node.attrs.dbId as string);
    return false;
  });
  return out;
}

/** Position du n-ième bloc base */
function dbPos(state: EditorState, index = 0): number {
  const positions: number[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'inlineDatabase') return true;
    positions.push(pos);
    return false;
  });
  return positions[index];
}

function pluginOf(state: EditorState) {
  return state.plugins[0];
}

/** Vue de circonstance : le greffon n'en lit que `dragging` et `state` */
function fakeView(state: EditorState, dragging: unknown = null): EditorView {
  return { state, dragging } as unknown as EditorView;
}

function paste(
  state: EditorState,
  slice: Slice,
  at: number,
  dragging: unknown = null
): EditorState {
  const transform = pluginOf(state).props.transformPasted;
  const pasted = transform
    ? transform.call(pluginOf(state), slice, fakeView(state, dragging), false)
    : slice;
  return state.apply(state.tr.replaceRange(at, at, pasted));
}

/** Le presse-papiers vient d'un COUPER : le greffon l'apprend par l'événement DOM */
function cutAt(state: EditorState, pos: number): Slice {
  const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  const handlers = pluginOf(state).props.handleDOMEvents as
    | Record<string, (view: EditorView, event: Event) => boolean>
    | undefined;
  handlers?.cut?.(fakeView(selected), new Event('cut'));
  return selected.doc.slice(pos, pos + selected.doc.nodeAt(pos)!.nodeSize);
}

beforeEach(() => {
  // Registre des déplacements : partagé par tous les éditeurs, donc remis à zéro
  clearCutDbIdentities();
});

/* ==================== Collage ==================== */

describe('collage d’un bloc base', () => {
  it('copier/coller dans la MÊME note : la copie reçoit une identité neuve', () => {
    const state = stateOf([para(), dbNode('db-original'), para()]);
    const pos = dbPos(state);
    const slice = state.doc.slice(pos, pos + state.doc.nodeAt(pos)!.nodeSize);

    const next = paste(state, slice, state.doc.content.size);
    const ids = idsOf(next);
    expect(ids).toHaveLength(2);
    // L'original ne bouge JAMAIS : les relations qui le visent tiennent
    expect(ids[0]).toBe('db-original');
    expect(ids[1]).not.toBe('db-original');
    expect(ids[1]).not.toBe('');
  });

  it('coller dans une AUTRE note : identité neuve elle aussi', () => {
    const source = stateOf([dbNode('db-original')]);
    const pos = dbPos(source);
    const slice = source.doc.slice(pos, pos + source.doc.nodeAt(pos)!.nodeSize);

    const other = stateOf([para()]);
    const next = paste(other, slice, other.doc.content.size);
    expect(idsOf(next)).toHaveLength(1);
    expect(idsOf(next)[0]).not.toBe('db-original');
  });

  it('coller DEUX fois : deux identités distinctes, et distinctes de l’original', () => {
    const state = stateOf([dbNode('db-original')]);
    const pos = dbPos(state);
    const slice = state.doc.slice(pos, pos + state.doc.nodeAt(pos)!.nodeSize);

    const once = paste(state, slice, state.doc.content.size);
    const twice = paste(once, slice, once.doc.content.size);
    const ids = idsOf(twice);
    expect(ids[0]).toBe('db-original');
    expect(new Set(ids).size).toBe(3);
  });

  it('couper/coller DÉPLACE : l’identité voyage avec la base', () => {
    const source = stateOf([dbNode('db-original'), para()]);
    const slice = cutAt(source, dbPos(source));
    const cut = source.apply(
      source.tr.delete(dbPos(source), dbPos(source) + source.doc.nodeAt(dbPos(source))!.nodeSize)
    );

    // Recollé ailleurs — y compris dans une autre note (registre partagé)
    const target = stateOf([para()]);
    const moved = paste(target, slice, target.doc.content.size);
    expect(idsOf(moved)).toEqual(['db-original']);
    expect(idsOf(cut)).toEqual([]);
  });

  it('couper puis coller DEUX fois : le deuxième collage est une copie', () => {
    const source = stateOf([dbNode('db-original')]);
    const slice = cutAt(source, dbPos(source));
    const target = stateOf([para()]);
    const once = paste(target, slice, target.doc.content.size);
    const twice = paste(once, slice, once.doc.content.size);
    const ids = idsOf(twice);
    expect(ids[0]).toBe('db-original');
    expect(ids[1]).not.toBe('db-original');
  });

  it('un simple copier annule le déplacement annoncé par un couper', () => {
    const source = stateOf([dbNode('db-original')]);
    const slice = cutAt(source, dbPos(source));
    // L'utilisateur change d'avis et copie autre chose
    const handlers = pluginOf(source).props.handleDOMEvents as
      | Record<string, (view: EditorView, event: Event) => boolean>
      | undefined;
    handlers?.copy?.(fakeView(source), new Event('copy'));

    const target = stateOf([para()]);
    expect(idsOf(paste(target, slice, target.doc.content.size))[0]).not.toBe('db-original');
  });

  it('glissé-déposé INTERNE : le bloc déplacé garde son identité', () => {
    const state = stateOf([dbNode('db-original'), para()]);
    const pos = dbPos(state);
    const node = state.doc.nodeAt(pos)!;
    const slice = state.doc.slice(pos, pos + node.nodeSize);
    // Ce que fait ProseMirror d'un déplacement interne : `transformPasted`,
    // puis suppression de la source et insertion à la cible, en une transaction
    const transform = pluginOf(state).props.transformPasted!;
    const dropped = transform.call(pluginOf(state), slice, fakeView(state, { move: true }), false);
    const tr = state.tr.delete(pos, pos + node.nodeSize);
    tr.replaceRange(tr.doc.content.size, tr.doc.content.size, dropped);
    // Le glissé COPIÉ (Ctrl) laisserait, lui, un doublon : appendTransaction le voit
    expect(idsOf(state.apply(tr))).toEqual(['db-original']);
  });

  it('collage sans aucune base : le fragment ressort tel quel', () => {
    const state = stateOf([para()]);
    const slice = new Slice(docOf([para('collé')]).content, 0, 0);
    const transform = pluginOf(state).props.transformPasted!;
    expect(transform.call(pluginOf(state), slice, fakeView(state), false)).toBe(slice);
  });
});

/* ==================== Duplication sans presse-papiers ==================== */

describe('duplication d’un bloc dans le document', () => {
  it('« Dupliquer » (menu de bloc) : la copie est re-frappée, l’original garde son identité', () => {
    const state = stateOf([dbNode('db-original'), para()]);
    const pos = dbPos(state);
    const node = state.doc.nodeAt(pos)!;
    const next = state.apply(
      state.tr.insert(pos + node.nodeSize, node.type.create(node.attrs, node.content, node.marks))
    );
    const ids = idsOf(next);
    expect(ids[0]).toBe('db-original');
    expect(ids[1]).not.toBe('db-original');
  });

  it('copie insérée AU-DESSUS : c’est elle qui change, jamais l’original', () => {
    const state = stateOf([para(), dbNode('db-original')]);
    const node = state.doc.nodeAt(dbPos(state))!;
    const next = state.apply(state.tr.insert(0, node.type.create(node.attrs)));
    const ids = idsOf(next);
    expect(ids[1]).toBe('db-original');
    expect(ids[0]).not.toBe('db-original');
  });

  it('base imbriquée (callout) : la duplication est vue là aussi', () => {
    const inner = schema.nodes.callout.create(null, [dbNode('db-original')]);
    const state = stateOf([inner, para()]);
    const node = state.doc.nodeAt(dbPos(state))!;
    const next = state.apply(state.tr.insert(state.doc.content.size, node.type.create(node.attrs)));
    const ids = idsOf(next);
    expect(ids[0]).toBe('db-original');
    expect(ids[1]).not.toBe('db-original');
  });

  it('une base d’AVANT les relations (sans attribut) : le doublon est vu sur l’identité dérivée', () => {
    const legacy = dataOf('v-ancienne');
    const state = stateOf([dbNode('', legacy), para()]);
    const node = state.doc.nodeAt(dbPos(state))!;
    const next = state.apply(state.tr.insert(state.doc.content.size, node.type.create(node.attrs)));
    const ids = idsOf(next);
    // L'original garde son absence d'attribut : rien n'est écrit sur lui
    expect(ids[0]).toBe('');
    expect(ids[1]).not.toBe('');
  });

  it('lecture seule (aperçu d’une version) : le document n’est JAMAIS réécrit', () => {
    const state = stateOf([dbNode('db-original'), para()], false);
    const node = state.doc.nodeAt(dbPos(state))!;
    const next = state.apply(state.tr.insert(state.doc.content.size, node.type.create(node.attrs)));
    expect(idsOf(next)).toEqual(['db-original', 'db-original']);
  });

  it('un doublon DÉJÀ présent n’est pas réparé au passage : seul l’inséré est re-frappé', () => {
    // Document d'avant la correction : deux blocs partagent une identité
    const state = stateOf([dbNode('db-original'), dbNode('db-original'), para()]);
    const node = state.doc.nodeAt(dbPos(state))!;
    const next = state.apply(state.tr.insert(state.doc.content.size, node.type.create(node.attrs)));
    const ids = idsOf(next);
    expect(ids.slice(0, 2)).toEqual(['db-original', 'db-original']);
    expect(ids[2]).not.toBe('db-original');
  });
});

/* ==================== Ce qui n'est PAS une duplication ==================== */

describe('ce qui n’est pas une copie', () => {
  it('LA MÊME NOTE OUVERTE DEUX FOIS : chaque éditeur garde l’identité intacte', () => {
    const first = stateOf([dbNode('db-original'), para()]);
    const second = stateOf([dbNode('db-original'), para()]);
    // On tape dans les deux : deux documents, un seul bloc chacun
    const a = first.apply(first.tr.insertText('a', first.doc.content.size - 1));
    const b = second.apply(second.tr.insertText('b', second.doc.content.size - 1));
    expect(idsOf(a)).toEqual(['db-original']);
    expect(idsOf(b)).toEqual(['db-original']);
  });

  it('CHARGER une note (remplacement complet du document) ne re-frappe rien', () => {
    const state = stateOf([para()]);
    const loaded = state.apply(
      state.tr.replaceWith(0, state.doc.content.size, [dbNode('db-original'), para()])
    );
    expect(idsOf(loaded)).toEqual(['db-original']);
  });

  it('frapper le contenu d’une base (édition ordinaire) ne touche pas son identité', () => {
    const state = stateOf([dbNode('db-original')]);
    const pos = dbPos(state);
    const node = state.doc.nodeAt(pos)!;
    const next = state.apply(
      state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        data: serializeDbData(dataOf('v-1')),
      })
    );
    expect(idsOf(next)).toEqual(['db-original']);
  });

  it('déplacer un bloc (couper puis réinsérer sans presse-papiers) garde l’identité', () => {
    const state = stateOf([dbNode('db-original'), para()]);
    const pos = dbPos(state);
    const node = state.doc.nodeAt(pos)!;
    const tr = state.tr.delete(pos, pos + node.nodeSize);
    tr.insert(tr.doc.content.size, node.type.create(node.attrs));
    expect(idsOf(state.apply(tr))).toEqual(['db-original']);
  });
});

/* ==================== Relations internes à la copie ==================== */

describe('relations internes à une copie', () => {
  function targetOf(state: EditorState, index: number): string | undefined {
    const nodes: PMNode[] = [];
    state.doc.descendants((node) => {
      if (node.type.name !== 'inlineDatabase') return true;
      nodes.push(node);
      return false;
    });
    const data = JSON.parse(nodes[index].attrs.data as string);
    return data.properties.find((p: { type: string }) => p.type === 'relation')?.targetDbId;
  }

  it('collage de DEUX bases liées : la relation copiée vise la COPIE', () => {
    const cible = dbNode('db-cible', dataOf('v-cible'));
    const source = dbNode('db-source', dataOf('v-source', 'db-cible'));
    const state = stateOf([cible, source]);
    const slice = state.doc.slice(dbPos(state, 0), state.doc.content.size);

    const other = stateOf([para()]);
    const pasted = paste(other, slice, other.doc.content.size);
    const ids = idsOf(pasted);
    expect(ids[0]).not.toBe('db-cible');
    expect(targetOf(pasted, 1)).toBe(ids[0]);
  });

  it('une relation qui visait l’EXTÉRIEUR de la copie ne bouge pas', () => {
    const state = stateOf([dbNode('db-source', dataOf('v-source', 'db-ailleurs'))]);
    const pos = dbPos(state);
    const slice = state.doc.slice(pos, pos + state.doc.nodeAt(pos)!.nodeSize);
    const other = stateOf([para()]);
    const pasted = paste(other, slice, other.doc.content.size);
    expect(targetOf(pasted, 0)).toBe('db-ailleurs');
  });
});

/* ==================== Note dupliquée / modèle ==================== */

describe('contenu de note copié (note dupliquée, modèle)', () => {
  function contentWith(nodes: unknown[]): string {
    return JSON.stringify({ type: 'doc', content: nodes });
  }

  function dbBlock(dbId: string, data: InlineDbData) {
    return { type: 'inlineDatabase', attrs: { title: 'T', dbId, data: serializeDbData(data) } };
  }

  it('chaque base de la copie reçoit une identité neuve', () => {
    const content = contentWith([dbBlock('db-original', dataOf('v-1'))]);
    const copie = restampCopiedDbIds(content);
    const index = collectInlineDbs([{ id: 'n2', title: '', content: copie }]);
    expect(index.has('db-original')).toBe(false);
    expect(index.size).toBe(1);
    // L'original, lui, n'a pas été touché : c'est une copie du CONTENU
    expect(collectInlineDbs([{ id: 'n1', title: '', content }]).has('db-original')).toBe(true);
  });

  it('les relations internes suivent, les lignes ne bougent pas', () => {
    const content = contentWith([
      dbBlock('db-cible', dataOf('v-cible')),
      dbBlock('db-source', dataOf('v-source', 'db-cible')),
      { type: 'paragraph', content: [{ type: 'text', text: 'après' }] },
    ]);
    const copie = JSON.parse(restampCopiedDbIds(content));
    const cible = copie.content[0].attrs;
    const source = JSON.parse(copie.content[1].attrs.data);
    expect(cible.dbId).not.toBe('db-cible');
    expect(source.properties.find((p: { type: string }) => p.type === 'relation').targetDbId).toBe(
      cible.dbId
    );
    // Le reste du document est intact
    expect(copie.content[2]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'après' }],
    });
    expect(JSON.parse(copie.content[0].attrs.data).rows).toEqual(dataOf('v-cible').rows);
  });

  it('une base d’avant les relations reçoit une identité EXPLICITE', () => {
    const legacy = { properties: [{ id: 'p-1', name: 'A', type: 'text' }], rows: [] };
    const content = JSON.stringify({
      type: 'doc',
      content: [{ type: 'inlineDatabase', attrs: { data: JSON.stringify(legacy) } }],
    });
    const copie = JSON.parse(restampCopiedDbIds(content));
    expect(copie.content[0].attrs.dbId).toBeTruthy();
    expect(copie.content[0].attrs.dbId).not.toBe('db@p:p-1');
  });

  it('un contenu sans base, vide ou illisible ressort TEL QUEL', () => {
    const plain = contentWith([{ type: 'paragraph' }]);
    expect(restampCopiedDbIds(plain)).toBe(plain);
    expect(restampCopiedDbIds('')).toBe('');
    const cassee = '{"type":"doc","content":[{"type":"inlineDatabase"';
    expect(restampCopiedDbIds(cassee)).toBe(cassee);
  });

  /** Le thunk réel, avec un état de circonstance : c'est LUI que « Dupliquer » appelle */
  async function newNoteContent(
    payload: { title?: string; content?: string; templateId?: string },
    templates: unknown[] = []
  ): Promise<string> {
    const dispatch = (action: unknown) => action;
    const getState = () => ({ notes: { templates } });
    const run = createNewNote(payload) as unknown as (
      d: unknown,
      g: unknown,
      e: unknown
    ) => Promise<{ payload: { content: string } }>;
    const action = await run(dispatch, getState, undefined);
    return action.payload.content;
  }

  it('DUPLIQUER UNE NOTE : la note créée ne partage aucune identité avec l’originale', async () => {
    const content = contentWith([dbBlock('db-original', dataOf('v-1'))]);
    const copie = await newNoteContent({ title: 'Note (copy)', content });
    const index = collectInlineDbs([
      { id: 'n1', title: '', content },
      { id: 'n2', title: '', content: copie },
    ]);
    // Deux bases distinctes : sans re-frappe, l'index n'en verrait qu'UNE
    expect(index.size).toBe(2);
    expect(index.has('db-original')).toBe(true);
  });

  it('MODÈLE appliqué : chaque note créée depuis le modèle a sa propre identité', async () => {
    const template = {
      id: 'tpl-1',
      name: 'Suivi',
      content: contentWith([dbBlock('db-modele', dataOf('v-1'))]),
      variables: [],
    };
    const first = await newNoteContent({ templateId: 'tpl-1' }, [template]);
    const second = await newNoteContent({ templateId: 'tpl-1' }, [template]);
    const index = collectInlineDbs([
      { id: 'n1', title: '', content: first },
      { id: 'n2', title: '', content: second },
    ]);
    expect(index.size).toBe(2);
    expect(index.has('db-modele')).toBe(false);
  });

  it('une note créée sans contenu ne coûte rien', async () => {
    expect(await newNoteContent({ title: 'Vide' })).toBe('');
  });
});

/* ==================== Index mémoïsé par note ==================== */

describe('collecteur mémoïsé', () => {
  const note = (id: string, viewId: string, title = '') => ({
    id,
    title,
    content: JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'inlineDatabase',
          attrs: { dbId: `db-${viewId}`, data: serializeDbData(dataOf(viewId)) },
        },
      ],
    }),
  });

  it('rend le MÊME index tant que rien ne change (aucun bloc n’est re-rendu)', () => {
    const collect = createInlineDbCollector();
    const notes = [note('n1', 'v1'), note('n2', 'v2')];
    const first = collect(notes);
    expect(collect(notes)).toBe(first);
    // Même contenu, objets de note neufs : la mémoïsation porte sur le CONTENU
    expect(collect([{ ...notes[0] }, { ...notes[1] }])).toBe(first);
  });

  it('ne relit que la note qui a changé', () => {
    const collect = createInlineDbCollector();
    const notes = [note('n1', 'v1'), note('n2', 'v2')];
    const first = collect(notes);
    const changed = collect([notes[0], { ...notes[1], content: notes[1].content + ' ' }]);
    expect(changed).not.toBe(first);
    // L'entrée de la note inchangée est le MÊME objet : elle n'a pas été reparsée
    expect(changed.get('db-v1')).toBe(first.get('db-v1'));
    expect(changed.get('db-v2')).not.toBe(first.get('db-v2'));
  });

  it('suit le titre de la note (il sert de titre de repli au bloc)', () => {
    const collect = createInlineDbCollector();
    const notes = [note('n1', 'v1', 'Avant')];
    expect(collect(notes).get('db-v1')?.title).toBe('Avant');
    expect(collect([{ ...notes[0], title: 'Après' }]).get('db-v1')?.title).toBe('Après');
  });

  it('une note supprimée ou ajoutée refait l’index', () => {
    const collect = createInlineDbCollector();
    const notes = [note('n1', 'v1'), note('n2', 'v2')];
    const first = collect(notes);
    const removed = collect([notes[0]]);
    expect(removed).not.toBe(first);
    expect([...removed.keys()]).toEqual(['db-v1']);
    expect(collect([{ ...notes[0], deletedAt: '2026-01-01T00:00:00.000Z' }]).size).toBe(0);
  });

  it('donne exactement le même index que la collecte non mémoïsée', () => {
    const notes = [note('n1', 'v1'), note('n2', 'v2')];
    const collect = createInlineDbCollector();
    expect([...collect(notes).entries()]).toEqual([...collectInlineDbs(notes).entries()]);
  });
});

/* ==================== Sélection de texte : aucun effet ==================== */

describe('garde-fou de coût', () => {
  it('une frappe de texte ne déclenche aucun parcours de document', () => {
    const state = stateOf([dbNode('db-original'), para()]);
    const typed = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1))
    );
    expect(idsOf(typed.apply(typed.tr.insertText('x')))).toEqual(['db-original']);
  });
});
