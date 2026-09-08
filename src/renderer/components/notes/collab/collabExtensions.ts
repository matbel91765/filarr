/**
 * Montage TipTap de la session vivante.
 *
 * Deux extensions seulement, et rien quand aucune session n'existe : la
 * configuration hors session doit rester strictement celle d'avant.
 */

import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import type { AnyExtension } from '@tiptap/core';
import type { StarterKitOptions } from '@tiptap/starter-kit';
import type { XmlFragment } from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { CollabIdentity } from './collabTypes';

export interface CollabMountInput {
  fragment: XmlFragment;
  awareness: Awareness;
  user: CollabIdentity;
}

/**
 * Options du StarterKit de l'éditeur de notes.
 *
 * `undoRedo: false` n'est pas un réglage de confort : Yjs apporte son propre
 * historique (yUndoPlugin, porté par l'extension Collaboration) et laisser
 * celui de ProseMirror actif ferait annuler les frappes des autres appareils.
 */
export function starterKitOptions(collabActive: boolean): Partial<StarterKitOptions> {
  const base: Partial<StarterKitOptions> = {
    codeBlock: false,
    heading: { levels: [1, 2, 3, 4] },
    link: false,
  };
  return collabActive ? { ...base, undoRedo: false } : base;
}

/**
 * Extensions à ajouter quand une session est vivante ; tableau vide sinon.
 *
 * `CollaborationCaret` attend un objet « provider » dont il ne lit que
 * `.awareness` — le contrat nous donne l'awareness directement, on l'emballe.
 */
export function buildCollabExtensions(input: CollabMountInput | null): AnyExtension[] {
  if (!input) return [];
  return [
    Collaboration.configure({ fragment: input.fragment }),
    CollaborationCaret.configure({
      provider: { awareness: input.awareness },
      user: { name: input.user.name, color: input.user.color },
    }),
  ];
}
