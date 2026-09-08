/**
 * Types partagés de la couche « édition vivante » côté éditeur.
 *
 * Ils décrivent uniquement ce dont l'interface a besoin. Le transport, le
 * chiffrement et le cycle de vie de la salle appartiennent au fournisseur
 * (`src/services/collab/collabProvider.ts`) ; ce module n'en dépend pas pour
 * que la barre de présence et ses tests restent purs.
 */

/**
 * État du canal, tel que publié par la session.
 *
 * `connected` (socket ouvert) et `synced` (rejeu du relais terminé) sont DEUX
 * états distincts : c'est le second, et lui seul, qui autorise l'éditeur à
 * semer le contenu du magasin dans un document partagé vide.
 */
/**
 * `denied` : le serveur a refusé l'accès à la salle — on n'est plus membre du
 * coffre. Distinct d'`offline`, qui est passager : les confondre laissait
 * l'exclusion se lire comme une coupure réseau.
 */
/**
 * `room-full` : le plafond de pairs simultanés est atteint.
 *
 * DISTINCT d'`offline`, qui dit « ça reviendra tout seul ». Ici la place ne se
 * libérera que si quelqu'un ferme la note ailleurs, ce qui peut ne jamais
 * arriver — et la sortie n'est pas d'attendre, c'est un coffre partagé.
 */
export type CollabStatus =
  | 'connecting'
  | 'connected'
  | 'synced'
  | 'offline'
  | 'denied'
  | 'room-full';

/** Identité locale envoyée dans l'awareness (nom affiché + couleur du curseur). */
export interface CollabIdentity {
  name: string;
  color: string;
}

/** Un participant, dérivé d'un état d'awareness. */
export interface CollabParticipant {
  /** clientID Yjs — stable pour la durée d'une session, opaque pour le relais. */
  clientId: number;
  name: string;
  color: string;
  /** Lettre affichée dans la pastille. */
  initial: string;
  /** Vrai pour l'appareil courant. */
  isLocal: boolean;
}

/**
 * Forme minimale d'un état d'awareness telle que l'écrit `CollaborationCaret`
 * (`awareness.setLocalStateField('user', { name, color })`).
 */
export interface AwarenessUserState {
  user?: { name?: unknown; color?: unknown } | null;
}
