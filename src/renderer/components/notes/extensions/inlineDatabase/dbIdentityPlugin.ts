/**
 * dbIdentityPlugin — Filarr Notes / bases inline
 *
 * UNE BASE, UNE IDENTITÉ. Le `dbId` d'un bloc est ce que visent les relations
 * des autres bases ; deux blocs qui le partagent font résoudre une relation sur
 * la mauvaise base — des valeurs fausses, et rien à l'écran qui le dise.
 *
 * Or copier un bloc copie ses attributs. Ce greffon re-frappe donc l'identité
 * AU MOMENT DE LA COPIE, sur les deux chemins que ProseMirror offre :
 *  - `transformPasted` : un collage (et un dépôt venu d'ailleurs) est une
 *    copie ; chaque base collée reçoit une identité neuve ;
 *  - `appendTransaction` : tout ce qui insère un bloc sans passer par le
 *    presse-papiers (menu « Dupliquer », glissé-copié, insertion programmée) —
 *    un bloc inséré dont l'identité est DÉJÀ portée par un autre bloc du
 *    document est re-frappé, l'autre ne bouge jamais.
 *
 * Deux gestes ne sont PAS des copies, et gardent l'identité :
 *  - couper/coller, qui DÉPLACE une base (registre `cutIdentities` ci-dessous) ;
 *  - glisser-déposer à l'intérieur de l'éditeur, que ProseMirror fait aussi
 *    passer par `transformPasted`.
 *
 * Et la même note ouverte deux fois n'est pas une duplication : chaque éditeur
 * a son document, qui ne porte qu'UN bloc — rien n'y est jamais re-frappé.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Mapping } from '@tiptap/pm/transform';
import { parseDbData, resolveDbId } from './types';
import type { DbNodeAttrs } from './dbIndex';
import { restampDbNodes } from './dbIndex';

export const DB_IDENTITY_PLUGIN_KEY = new PluginKey('inlineDatabaseIdentity');

const DB_NODE = 'inlineDatabase';

/** Le peu qu'on lit de la vue : un glissé interne y est reconnaissable */
interface ViewLike {
  dragging?: unknown;
}

/**
 * Identités EN TRANSIT : celles qu'un couper vient de retirer d'un document.
 * Couper/coller déplace une base, il ne la duplique pas — son identité doit
 * donc survivre au voyage, y compris vers une autre note, d'où un registre
 * partagé par tous les éditeurs de la fenêtre. Un simple copier l'efface : le
 * presse-papiers ne porte alors plus un déplacement.
 */
let cutIdentities = new Set<string>();

/** Le presse-papiers porte un DÉPLACEMENT de ces bases */
export function markDbIdentitiesCut(ids: Iterable<string>): void {
  cutIdentities = new Set(ids);
}

/** Le presse-papiers porte une COPIE : plus aucun déplacement en cours */
export function clearCutDbIdentities(): void {
  if (cutIdentities.size > 0) cutIdentities = new Set();
}

/**
 * Ce collage est-il le déplacement annoncé ? Consommé au premier collage :
 * coller une deuxième fois fait bien, cette fois, une copie.
 */
export function consumeCutDbIdentity(id: string): boolean {
  if (id === '' || !cutIdentities.has(id)) return false;
  cutIdentities.delete(id);
  return true;
}

/** Identité effective d'un bloc : l'attribut s'il en porte un, sinon la dérivée */
function identityOf(node: PMNode): string {
  const attrs = node.attrs as DbNodeAttrs;
  return resolveDbId(attrs.dbId, parseDbData(typeof attrs.data === 'string' ? attrs.data : ''));
}

/** Blocs base d'un fragment, dans l'ordre du document */
function dbNodesIn(fragment: Fragment): PMNode[] {
  const found: PMNode[] = [];
  fragment.descendants((node) => {
    if (node.type.name !== DB_NODE) return true;
    found.push(node);
    return false;
  });
  return found;
}

/** Même parcours, mais qui reconstruit : chaque bloc base passe par `replace` */
function mapDbNodes(fragment: Fragment, replace: (node: PMNode) => PMNode): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((child) => {
    if (child.type.name === DB_NODE) out.push(replace(child));
    else if (child.content.size > 0) out.push(child.copy(mapDbNodes(child.content, replace)));
    else out.push(child);
  });
  return Fragment.fromArray(out);
}

/**
 * Ce lot a-t-il inséré un bloc base ? Garde-fou de coût : `appendTransaction`
 * est appelé à CHAQUE frappe, et l'inspection ci-dessous parcourt le document
 * entier. Une frappe de texte n'insère qu'un nœud texte — on ressort ici.
 */
function insertsDbNode(transactions: readonly Transaction[]): boolean {
  for (const tr of transactions) {
    for (const step of tr.steps) {
      const slice = (step as { slice?: Slice }).slice;
      if (!slice || slice.content.size === 0) continue;
      let found = false;
      slice.content.descendants((node) => {
        if (found) return false;
        if (node.type.name !== DB_NODE) return true;
        found = true;
        return false;
      });
      if (found) return true;
    }
  }
  return false;
}

export interface DuplicateDbNode {
  pos: number;
  node: PMNode;
}

/**
 * Blocs base à re-frapper après ce lot de transactions.
 *
 * Un bloc est un DOUBLON quand son identité est portée par un autre bloc du
 * document. Celui qui la garde est le bloc qui était DÉJÀ là (l'original ne
 * bouge jamais, même quand la copie est collée au-dessus de lui) ; à défaut —
 * tout le document vient d'être remplacé — le premier dans l'ordre du document.
 * Un bloc que ce lot n'a pas inséré n'est jamais re-frappé : lire ou charger
 * une note ne doit rien réécrire.
 */
export function duplicatedDbNodes(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState
): DuplicateDbNode[] {
  // Ce qui SURVIT du document d'avant : les positions reportées à travers le lot
  const mapping = new Mapping();
  for (const tr of transactions) mapping.appendMapping(tr.mapping);
  const survivors = new Set<number>();
  oldState.doc.descendants((node, pos) => {
    if (node.type.name !== DB_NODE) return true;
    const mapped = mapping.mapResult(pos);
    if (!mapped.deleted) {
      const at = newState.doc.nodeAt(mapped.pos);
      if (at && at.type.name === DB_NODE && identityOf(at) === identityOf(node)) {
        survivors.add(mapped.pos);
      }
    }
    return false;
  });

  // Recensement des identités du nouveau document
  const positions = new Map<string, number[]>();
  newState.doc.descendants((node, pos) => {
    if (node.type.name !== DB_NODE) return true;
    const id = identityOf(node);
    // Coquille sans graine : aucune identité, donc rien à viser ni à re-frapper
    if (id === '') return false;
    const list = positions.get(id);
    if (list) list.push(pos);
    else positions.set(id, [pos]);
    return false;
  });

  const out: DuplicateDbNode[] = [];
  for (const list of positions.values()) {
    if (list.length < 2) continue;
    const keeper = list.find((pos) => survivors.has(pos)) ?? list[0];
    for (const pos of list) {
      if (pos === keeper || survivors.has(pos)) continue;
      const node = newState.doc.nodeAt(pos);
      if (node) out.push({ pos, node });
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

export interface DbIdentityPluginOptions {
  /**
   * Un aperçu en lecture seule (historique des versions) ne réécrit JAMAIS le
   * document, fût-ce pour le réparer.
   */
  isEditable?: () => boolean;
}

export function dbIdentityPlugin(options: DbIdentityPluginOptions = {}): Plugin {
  const { isEditable } = options;

  return new Plugin({
    key: DB_IDENTITY_PLUGIN_KEY,

    props: {
      handleDOMEvents: {
        cut: (view) => {
          markDbIdentitiesCut(
            dbNodesIn(view.state.selection.content().content).map((node) => identityOf(node))
          );
          // Jamais consommé : ProseMirror fait le couper comme d'habitude
          return false;
        },
        copy: () => {
          clearCutDbIdentities();
          return false;
        },
      },

      transformPasted: (slice, view) => {
        // Glissé-déposé INTERNE : ProseMirror passe aussi par ici, et déplacer
        // un bloc dans sa note n'est pas le copier. Le glissé-COPIÉ (Ctrl)
        // laisse, lui, un doublon dans le document — `appendTransaction` s'en
        // charge, avec le document sous les yeux.
        if ((view as unknown as ViewLike)?.dragging) return slice;

        const nodes = dbNodesIn(slice.content);
        if (nodes.length === 0) return slice;

        const moving = nodes.map((node) => consumeCutDbIdentity(identityOf(node)));
        const copied = nodes.filter((_, i) => !moving[i]);
        if (copied.length === 0) return slice;

        const stamped = restampDbNodes(copied.map((node) => node.attrs as DbNodeAttrs));
        let seen = 0;
        let next = 0;
        const content = mapDbNodes(slice.content, (node) => {
          if (moving[seen++]) return node;
          const attrs = { ...node.attrs, ...stamped[next++] };
          return node.type.create(attrs, node.content, node.marks);
        });
        return new Slice(content, slice.openStart, slice.openEnd);
      },
    },

    appendTransaction: (transactions, oldState, newState) => {
      if (isEditable && !isEditable()) return null;
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (!insertsDbNode(transactions)) return null;

      const targets = duplicatedDbNodes(transactions, oldState, newState);
      if (targets.length === 0) return null;

      const stamped = restampDbNodes(targets.map((t) => t.node.attrs as DbNodeAttrs));
      const tr = newState.tr;
      targets.forEach((target, i) => {
        // Frapper des attributs ne change pas la taille d'un bloc : les
        // positions relevées restent valides d'une frappe à l'autre
        tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, ...stamped[i] });
      });
      return tr;
    },
  });
}
