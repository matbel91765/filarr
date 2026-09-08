import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { MENTION_NODE_NAME } from './mentionExtension';

/**
 * « PERSONNES » SOUS LE DÉCLENCHEUR « @ » — lot 2 des @mentions.
 *
 * Une personne qu’on peut mentionner est un MEMBRE DU COFFRE où vit la note :
 * c’est ce que le serveur exigera pour prévenir quelqu’un (lot 3), donc c’est
 * tout ce que le menu propose. Une note personnelle n’a personne à mentionner :
 * sans fournisseur de candidats, cette extension n’est pas montée du tout, et
 * le « @ » garde là-bas son rôle d’avant (liens, dates).
 *
 * Le menu ne se peint que s’il a au moins une personne à proposer : « @toto »
 * qui ne ressemble à personne laisse la frappe et la touche Entrée tranquilles
 * (la leçon du menu des liens wiki).
 */
export interface MentionCandidate {
  userId: string;
  /** Ce qui s’écrit dans la puce : nom d’affichage, sinon adresse. */
  label: string;
  /** Ligne secondaire du menu (rôle, adresse…), jamais dans la puce. */
  secondary?: string;
}

export type MentionCandidatesProvider = (
  query: string
) => MentionCandidate[] | Promise<MentionCandidate[]>;

export const MentionSuggestionPluginKey = new PluginKey('mentionSuggestion');

export const MentionSuggestionExtension = Extension.create({
  name: 'mentionSuggestion',

  addOptions() {
    return {
      suggestion: {
        char: '@',
        pluginKey: MentionSuggestionPluginKey,
        allowSpaces: false,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: any;
          range: any;
          props: MentionCandidate;
        }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: MENTION_NODE_NAME, attrs: { userId: props.userId, label: props.label } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        items: (): MentionCandidate[] => [],
      } as Partial<SuggestionOptions<MentionCandidate>>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

/**
 * Filtre PUR des candidats : insensible à la casse et aux accents, sur le
 * libellé et la ligne secondaire ; jamais soi-même (se prévenir n’a pas de
 * sens) ; huit au plus, dans l’ordre reçu. Une requête vide propose tout le
 * monde : c’est le geste « @ » puis choisir.
 */
export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
  selfUserId: string | null | undefined,
  limit = 8
): MentionCandidate[] {
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const q = fold(query.trim());
  const out: MentionCandidate[] = [];
  for (const c of candidates) {
    if (!c.userId || !c.label) continue;
    if (selfUserId && c.userId === selfUserId) continue;
    if (q && !fold(c.label).includes(q) && !fold(c.secondary ?? '').includes(q)) continue;
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
