/**
 * Block Size Extension — Filarr Notes
 *
 * Deux attributs globaux, `blockWidthPx` et `blockHeightPx`, posés sur les
 * blocs qui savent offrir une poignée de redimensionnement. C'est le pendant,
 * pour la base inline / le kanban / le schéma / le calendrier, de la taille que
 * l'image règle depuis toujours — la hauteur en plus, parce qu'un kanban de
 * trente cartes pousse tout le reste de la note hors de l'écran.
 *
 * LES DEUX LISTES NE SONT PAS LA MÊME. `embedUrl` porte une largeur mais pas de
 * hauteur : une vidéo a un rapport d'image, sa hauteur découle de sa largeur.
 *
 * CE MODULE DÉFINIT DU SCHÉMA. Il doit donc être enregistré dans
 * `schemaExtensions.ts`, jamais dans la liste d'un seul éditeur : un attribut
 * absent du schéma d'une surface n'y est pas « ignoré », il est SUPPRIMÉ au
 * premier aller-retour. Éditer une note partagée depuis un coffre effacerait
 * silencieusement toutes les largeurs — et l'effacement se propagerait aux
 * autres membres par le CRDT. Le garde-fou est `schemaExtensions.vitest.ts`,
 * qui compare les empreintes des deux schémas attribut par attribut.
 *
 * PAS DE DÉCORATIONS, contrairement à la tentative précédente. Une
 * `Decoration.node` pose ses attributs sur le DOM EXTÉRIEUR du nœud — pour une
 * vue React, l'enveloppe `.react-renderer` créée par TipTap, et non le
 * `NodeViewWrapper` qu'on écrit soi-même. Une règle CSS visant `.inline-db` ne
 * pouvait donc jamais s'appliquer : c'est ce qui faisait qu'un kanban ne
 * bougeait pas d'un pixel alors que le document, lui, avait bien enregistré sa
 * taille. Ici, c'est la vue elle-même qui lit `node.attrs` et se pose son style
 * — la seule façon d'être sûr que ce qu'on règle est bien ce qu'on voit.
 *
 * La valeur voyage en `data-block-w`, lisible telle quelle à l'export HTML : un
 * document exporté garde ses largeurs.
 */

import { Extension } from '@tiptap/core';
import {
  HEIGHT_RESIZABLE_BLOCK_TYPES,
  RESIZABLE_BLOCK_TYPES,
  parseBlockHeight,
  parseBlockWidth,
} from './blockSize';
import './blockSize.css';

export const BlockSizeExtension = Extension.create({
  name: 'blockSize',

  addGlobalAttributes() {
    return [
      {
        types: [...RESIZABLE_BLOCK_TYPES],
        attributes: {
          blockWidthPx: {
            default: null,
            parseHTML: (el) => parseBlockWidth(el.getAttribute('data-block-w')),
            renderHTML: (attrs) => {
              const width = parseBlockWidth(attrs.blockWidthPx);
              // La variable CSS accompagne l'attribut parce que la largeur est
              // LIBRE (473 px est une valeur légitime) : une feuille de style ne
              // peut pas énumérer les cas, et un document EXPORTÉ n'a pas de
              // vue React pour la poser à sa place.
              return width === null
                ? {}
                : { 'data-block-w': String(width), style: `--block-w:${width}` };
            },
          },
        },
      },
      {
        types: [...HEIGHT_RESIZABLE_BLOCK_TYPES],
        attributes: {
          blockHeightPx: {
            default: null,
            parseHTML: (el) => parseBlockHeight(el.getAttribute('data-block-h')),
            renderHTML: (attrs) => {
              const height = parseBlockHeight(attrs.blockHeightPx);
              return height === null
                ? {}
                : { 'data-block-h': String(height), style: `--block-h:${height}` };
            },
          },
        },
      },
    ];
  },
});
