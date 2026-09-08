/**
 * Inline Database Extension — Filarr Notes
 *
 * Bloc base de données inline façon Notion v1, auto-contenu :
 * schéma + lignes stockés en JSON dans les attrs du nœud
 * (précédent maison exact : calendarBlockExtension).
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { InlineDatabaseNodeView } from './inlineDatabase/InlineDatabaseNodeView';
import { deriveDbId, makeDefaultData, serializeDbData } from './inlineDatabase/types';
import { dbIdentityPlugin } from './inlineDatabase/dbIdentityPlugin';
import { inlineDatabaseIndexText } from './indexText';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineDatabase: {
      insertInlineDatabase: () => ReturnType;
    };
  }
}

export const InlineDatabaseExtension = Node.create({
  name: 'inlineDatabase',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      title: { default: '' },
      view: { default: 'table' as 'table' | 'board' },
      groupBy: { default: '' },
      // Connecteur du bloc ('' = aucun) : pilote le bouton ⚡ de chaque ligne
      source: { default: '' },
      // Identité de la base, visée par les relations des autres bases. Frappée
      // ici à l'insertion et au premier commit ; absente (bases d'avant les
      // relations), elle se dérive des données à la lecture — voir `deriveDbId`
      // pour ce que cette dérivation garantit, et ce qu'elle ne garantit pas.
      // Une COPIE du bloc en reçoit une neuve (cf. `dbIdentityPlugin`).
      dbId: { default: '' },
      data: { default: '{"properties":[],"rows":[]}' }, // JSON InlineDbData
    };
  },

  /**
   * Titre, noms de colonnes puis VALEURS de cellules — bornées (cf.
   * `DB_INDEX_MAX_ROWS`). Le JSON brut de `data` n'entre jamais dans l'index :
   * il est fait d'identifiants, et `plainText` est persisté puis synchronisé.
   */
  renderText({ node }) {
    return inlineDatabaseIndexText(node.attrs);
  },

  parseHTML() {
    return [{ tag: 'div[data-inline-database]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-inline-database': '',
        class: 'inline-database',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineDatabaseNodeView as any);
  },

  /**
   * Identité unique à la copie : une base collée, dupliquée ou insérée deux
   * fois ne peut pas porter l'identité d'une autre — une relation la viserait
   * et lirait la mauvaise base.
   */
  addProseMirrorPlugins() {
    return [dbIdentityPlugin({ isEditable: () => this.editor?.isEditable !== false })];
  },

  addCommands() {
    return {
      insertInlineDatabase:
        () =>
        ({ commands }) => {
          const data = makeDefaultData();
          return commands.insertContent({
            type: this.name,
            attrs: {
              // Identité posée d'emblée, mais DÉRIVÉE des données : un client
              // qui jetterait l'attribut inconnu retrouverait la même valeur
              dbId: deriveDbId(data),
              data: serializeDbData(data),
            },
          });
        },
    };
  },
});
