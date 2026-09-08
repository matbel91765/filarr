import { Node, mergeAttributes } from '@tiptap/core';
import { mentionIndexText } from './indexText';

/**
 * MENTION D’UNE PERSONNE — le nœud, et rien que le nœud (lot 1).
 *
 * Une puce inline `@label` qui porte l’identifiant de la personne. Chiffrée
 * avec la note comme tout le reste : le serveur ne la voit jamais. Le menu de
 * suggestion (lot 2) et le signal qui prévient la personne (lot 3) viennent
 * après ; ce lot-ci ne fait que rendre le nœud CONNU des trois éditeurs.
 *
 * ═══ POURQUOI LE NŒUD DOIT ÊTRE PARTOUT AVANT LA PREMIÈRE MENTION ═══
 *
 * Un éditeur qui ignore ce nœud le LIT sans casser (le texte « @label » reste),
 * mais s’il ÉDITE la note, il réécrit le document sans l’attribut `userId` :
 * la mention redevient du texte, sans erreur. D’où la forme HTML commune,
 * figée avec le mobile et à ne plus bouger :
 *
 *   <span data-type="mention" data-user-id="…" data-label="…">@label</span>
 *
 * Bureau et web rangent le document en JSON ProseMirror ; le mobile en HTML.
 * `parseHTML` / `renderHTML` sont la traduction sans perte entre les deux.
 */
export const MENTION_NODE_NAME = 'mention';

export interface MentionAttrs {
  userId: string;
  label: string;
}

export const MentionExtension = Node.create({
  name: MENTION_NODE_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      userId: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-user-id') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-user-id': String(attrs.userId ?? ''),
        }),
      },
      label: {
        default: '',
        parseHTML: (el: HTMLElement) =>
          el.getAttribute('data-label') ?? (el.textContent ?? '').replace(/^@/, ''),
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-label': String(attrs.label ?? ''),
        }),
      },
    };
  },

  renderText({ node }) {
    return mentionIndexText(node.attrs);
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': MENTION_NODE_NAME, class: 'note-mention' }),
      `@${String(node.attrs.label ?? '')}`,
    ];
  },
});
