/**
 * Slash Command Extension — Filarr Notes
 *
 * TipTap extension that triggers a command palette when "/" is typed.
 * Uses @tiptap/suggestion for positioning and keyboard handling.
 */

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import {
  SLASH_COMMANDS,
  isVaultEmbedEnabled,
  getSlashLabel,
  getSlashDescription,
} from './SlashCommandMenu';
import type { SlashCommandItem } from './SlashCommandMenu';
import { recordSlashCommandUse } from './slashCommandRecents';
import i18n from '../../../i18n/config';
import store from '../../../store';
import { showWarningNotification } from '../../../store/slices/uiSlice';

export const SlashCommandPluginKey = new PluginKey('slashCommand');

/**
 * LES COMMANDES QUI VISENT L'ESPACE PERSONNEL, et qui n'ont donc rien à faire
 * dans une note de coffre partagé.
 *
 * Ce ne sont pas des commandes « moins utiles » ailleurs : ce sont des
 * commandes qui, dans un coffre, feraient exactement la chose que la section
 * « Coffres partagés » a été dessinée pour éviter — mêler du contenu local à
 * du contenu distant :
 *
 *   · `link-note` et `embed-note` posent les déclencheurs `[[` et `![[`. Leur
 *     autocomplétion est une extension de NoteEditor seul, absente ici : au
 *     mieux le déclencheur reste mort à l'écran, au pire la règle de saisie
 *     par titre résout vers une note PERSONNELLE et scelle son identifiant
 *     dans un document que d'autres membres liront — un lien qui, chez eux, ne
 *     mène nulle part ;
 *   · `sub-page` crée une sous-page dans `notesSlice`, c'est-à-dire sur le
 *     disque de cette machine, référencée depuis un document partagé ;
 *   · `vault-embed` n'est qu'un évènement de fenêtre attrapé par NoteEditor,
 *     qui héberge le sélecteur ; personne ne l'écoute dans un coffre ;
 *   · `dataview` interroge les notes personnelles, et n'aurait chez les autres
 *     membres aucune des lignes qu'il montre chez nous.
 *
 * La liste est nommée plutôt que déduite d'un groupe : `pages` contient
 * aujourd'hui les quatre premières, mais un groupe est un rangement d'écran,
 * et faire dépendre une frontière de données d'un choix de présentation, c'est
 * accepter qu'un jour on déplace une commande et qu'on ouvre la frontière sans
 * s'en apercevoir.
 */
export const PERSONAL_ONLY_SLASH_IDS: readonly string[] = [
  'link-note',
  'embed-note',
  'sub-page',
  'vault-embed',
  'dataview',
];

/**
 * Les commandes offertes pour une requête — L'AUTORITÉ UNIQUE du filtrage.
 *
 * Extrait de `addOptions` pour que l'éditeur de coffre partagé puisse écarter
 * les commandes ci-dessus SANS recopier la recherche (libellé traduit +
 * description + alias) : deux filtres, ce serait deux vérités sur ce que « / »
 * propose, et celle du coffre prendrait du retard à la première commande
 * ajoutée.
 */
export function buildSlashItems(
  query: string,
  options: { exclude?: readonly string[] } = {}
): SlashCommandItem[] {
  const exclude = new Set(options.exclude ?? []);
  // The vault-embed command is Teams/Enterprise only (E3-8c).
  if (!isVaultEmbedEnabled()) exclude.add('vault-embed');
  const base =
    exclude.size === 0 ? SLASH_COMMANDS : SLASH_COMMANDS.filter((i) => !exclude.has(i.id));
  if (!query) return base;
  const q = query.toLowerCase();
  // Filtre sur le libellé traduit (langue courante) + alias existants.
  return base.filter(
    (item) =>
      getSlashLabel(item).toLowerCase().includes(q) ||
      getSlashDescription(item).toLowerCase().includes(q) ||
      item.aliases?.some((a) => a.includes(q))
  );
}

/**
 * Prévient que la commande n'a rien pu faire ici.
 *
 * Passe par la file Redux plutôt que par `useNotification` : le callback du
 * plugin de suggestion s'exécute hors de tout composant React, donc hors du
 * Context. `ReduxNotificationsHost` draine cette file dans la MÊME pile de
 * toasts (design system), à condition que `metadata.source` soit posé — c'est
 * le contrat d'opt-in documenté dans ce hôte.
 */
function notifyCommandUnavailable(): void {
  store.dispatch(
    showWarningNotification(
      i18n.t('notes.slash.unavailableHere', {
        defaultValue: 'This command is not available here',
      }),
      { metadata: { source: 'notes-slash' } }
    )
  );
}

export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        // Par défaut @tiptap/suggestion exige un ESPACE avant le déclencheur
        // (allowedPrefixes = [' ']) : taper « / » collé au dernier mot d'une
        // puce n'ouvrait JAMAIS le menu — le geste naturel dans une liste.
        // null = comportement Notion (le menu s'ouvre même en plein mot, et se
        // referme dès que la requête ne matche plus). Contrepartie assumée :
        // « km/h » tapé à la main l'ouvre brièvement.
        allowedPrefixes: null,
        pluginKey: SlashCommandPluginKey,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: any;
          range: any;
          props: SlashCommandItem;
        }) => {
          // Le texte tapé est effacé AVANT que l'action ne s'exécute : sans
          // filet, toute action qui échoue laisse l'utilisateur avec son
          // « /quote » avalé et rien à la place — l'échec silencieux qui a
          // fait passer le bug des listes inaperçu. On le mémorise donc.
          const typed = editor.state.doc.textBetween(range.from, range.to, '', '');

          // Delete the "/" trigger and any query text
          editor.chain().focus().deleteRange(range).run();

          // Execute the command
          let applied = false;
          try {
            applied = props.action(editor) !== false;
          } catch (err) {
            // Une exception ici part dans le vide (gestionnaire ProseMirror) :
            // sans ce filet, le texte tapé reste supprimé et l'utilisateur ne
            // voit RIEN — l'échec silencieux sous une autre forme.
            console.error(`[slashCommand] "${props.id}" failed:`, err);
            applied = false;
          }

          if (applied) {
            // Seuls les SUCCÈS nourrissent les récents : une commande refusée
            // ici (« /table » dans une puce) ne doit pas venir squatter le haut
            // du menu à la prochaine ouverture.
            recordSlashCommandUse(props.id);
          }

          if (!applied) {
            // Réinsertion au caret, pas à `range.from` : une action qui a
            // échoué peut avoir tout de même bougé le document (sortie de
            // liste), ce qui périme les positions absolues d'avant. Après
            // `deleteRange`, le caret EST à l'endroit du texte effacé.
            editor.chain().focus().insertContent(typed).run();
            notifyCommandUnavailable();
          }
        },
        items: ({ query }: { query: string }): SlashCommandItem[] => buildSlashItems(query),
      } as Partial<SuggestionOptions<SlashCommandItem>>,
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
