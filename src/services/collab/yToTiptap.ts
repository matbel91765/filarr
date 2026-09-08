/**
 * Y.XmlFragment → JSON TipTap (ProseMirror).
 *
 * C'est le RETOUR AU STOCKAGE : le CRDT est la vérité de la session vivante,
 * `notes.enc` reste la vérité durable, et ce module fait le pont entre les deux.
 *
 * Écrit à la main plutôt que pris dans `y-prosemirror` : ce paquet n'est pas
 * installé (il arrive en dépendance transitive de `@tiptap/y-tiptap`, absent
 * du node_modules à ce jour) et la conversion sans schéma tient en trente
 * lignes. La correspondance est celle de y-prosemirror, à l'octet près :
 *
 *   Y.XmlElement  → { type: nodeName, attrs?, content? }
 *   Y.XmlText     → une suite de { type:'text', text, marks? } issue du delta
 *   attributs de delta → marques (`{ type, attrs? }`)
 *
 * Aucune connaissance du schéma n'est requise, donc aucun nœud personnalisé de
 * Filarr (base en ligne, transclusion, carte mémoire…) n'est perdu au passage.
 */

import * as Y from 'yjs';

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}

interface DeltaOp {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

/**
 * Les marques CHEVAUCHANTES (celles déclarées `excludes: ''`, dont plusieurs
 * instances peuvent couvrir le même texte — commentaires, surlignages…) sont
 * stockées par `@tiptap/y-tiptap` sous une clé suffixée d'une empreinte :
 * `comment--aB3dEf90`. Sans ce retrait, la note relue depuis le CRDT porterait
 * un type de marque inexistant dans le schéma et le nœud serait rejeté.
 * Même expression que `yattr2markname` de la bibliothèque.
 */
const HASHED_MARK_NAME = /^(.*)(--[a-zA-Z0-9+/=]{8})$/;

function markNameFromAttribute(attrName: string): string {
  return HASHED_MARK_NAME.exec(attrName)?.[1] ?? attrName;
}

/**
 * `attrs` n'est posé que s'il y a vraiment des attributs — c'est la forme
 * canonique de ProseMirror (`Mark.toJSON`), donc celle que `editor.getJSON()`
 * écrit déjà dans `notes.enc` hors session. Écart DÉLIBÉRÉ avec
 * `yXmlFragmentToProsemirrorJSON`, qui pose toujours `attrs` (son test
 * `if (Object.keys(attrs))` porte sur un tableau, toujours vrai) : aligner le
 * CRDT sur l'éditeur évite qu'une même note change de sérialisation selon le
 * chemin d'écriture.
 */
function marksFromAttributes(attributes: Record<string, unknown>): TiptapMark[] {
  return Object.keys(attributes).map((key) => {
    const type = markNameFromAttribute(key);
    const attrs = attributes[key];
    if (attrs && typeof attrs === 'object' && Object.keys(attrs as object).length > 0) {
      return { type, attrs: attrs as Record<string, unknown> };
    }
    return { type };
  });
}

function serializeText(item: Y.XmlText): TiptapNode[] {
  const delta = item.toDelta() as DeltaOp[];
  const out: TiptapNode[] = [];
  for (const op of delta) {
    if (typeof op.insert !== 'string') continue; // embed non textuel — ignoré
    const node: TiptapNode = { type: 'text', text: op.insert };
    if (op.attributes && Object.keys(op.attributes).length > 0) {
      node.marks = marksFromAttributes(op.attributes);
    }
    out.push(node);
  }
  return out;
}

function serializeItem(
  item: Y.XmlElement | Y.XmlText | Y.XmlHook | Y.AbstractType<unknown>
): TiptapNode[] {
  if (item instanceof Y.XmlText) return serializeText(item);
  if (item instanceof Y.XmlElement) {
    const node: TiptapNode = { type: item.nodeName };
    const attrs = item.getAttributes() as Record<string, unknown>;
    if (attrs && Object.keys(attrs).length > 0) node.attrs = attrs;
    const children = item.toArray();
    if (children.length > 0) {
      const content: TiptapNode[] = [];
      for (const child of children) content.push(...serializeItem(child));
      if (content.length > 0) node.content = content;
    }
    return [node];
  }
  return [];
}

/** Document TipTap complet à partir du fragment `content` d'un Y.Doc. */
export function yXmlFragmentToTiptapDoc(fragment: Y.XmlFragment): TiptapDoc {
  const content: TiptapNode[] = [];
  for (const item of fragment.toArray()) content.push(...serializeItem(item));
  return { type: 'doc', content };
}

/**
 * Forme sérialisée telle que le magasin de notes l'attend : `Note.content`
 * est une CHAÎNE de JSON TipTap, pas un objet.
 */
export function yXmlFragmentToNoteContent(fragment: Y.XmlFragment): string {
  return JSON.stringify(yXmlFragmentToTiptapDoc(fragment));
}

/** Extrait texte brut, pour l'indexation de recherche et `plainText`. */
export function tiptapDocToPlainText(doc: TiptapDoc | TiptapNode): string {
  const parts: string[] = [];
  const walk = (node: TiptapNode, depth: number): void => {
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text);
      return;
    }
    if (node.content) {
      for (const child of node.content) walk(child, depth + 1);
    }
    // Un bloc de premier niveau termine sa ligne — sinon deux paragraphes
    // se recolleraient en un seul mot dans l'index de recherche.
    if (depth <= 1 && node.type !== 'text') parts.push('\n');
  };
  walk(doc as TiptapNode, 0);
  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
