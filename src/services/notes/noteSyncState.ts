/**
 * ÉTAT DE SYNCHRONISATION D'UNE NOTE — dérivation pure, sans Redux.
 *
 * ═══ CE QUE CE MODULE DISAIT DE FAUX, ET POURQUOI ═══
 *
 * Il comparait deux horloges : `note.updatedAt > sync.lastSyncAt`. C'était une
 * DÉDUCTION, présentée à l'utilisateur comme un fait, et elle mentait dans deux
 * situations parfaitement ordinaires :
 *
 *  1. AU CHANGEMENT DE PROFIL. `lastSyncAt` repart à `null`, et la règle
 *     « pas d'horodatage = sale » faisait afficher « non synchronisée » sur
 *     TOUTES les notes du coffre, jusqu'à ce qu'un premier cycle conclue.
 *  2. SUR UNE NOTE REÇUE D'UN AUTRE APPAREIL. Elle porte l'horloge de CET
 *     appareil-là. Si elle est en avance de quelques secondes — deux machines
 *     n'ont jamais exactement la même heure — la note reste « non
 *     synchronisée » INDÉFINIMENT, alors qu'elle vient d'arriver du nuage.
 *     C'est le cas signalé le 2026-09-01, capture à l'appui.
 *
 * ═══ CE QUI LE REMPLACE ═══
 *
 * L'ACCUSÉ DU MOTEUR PRIME SUR L'HORLOGE. Toutes les notes vivent dans un seul
 * conteneur (`notes.enc`) remonté d'un bloc : quand le moteur dit que cette
 * entrée n'a plus rien en attente, LE NUAGE A TOUT, et aucune note ne peut être
 * en retard. Ce n'est plus une supposition, c'est le statut que le processus
 * principal publie (`sync-file-status-changed` sur `meta:notes`).
 *
 * L'horloge ne sert plus qu'à une chose, et seulement quand le moteur a
 * effectivement quelque chose en attente : dire LAQUELLE des notes est
 * concernée. Se tromper là est sans gravité — on montre « en attente » sur une
 * note qui l'est déjà presque.
 *
 * ═══ CE QUE ÇA NE PRÉTEND PAS ÊTRE ═══
 *
 * En v1, un état PAR NOTE n'existe pas : le conteneur est un tout. Ce module ne
 * fabrique donc aucune précision qu'il n'a pas — il se contente de ne plus
 * affirmer le contraire de ce que le moteur sait. Le format v2 (une note, un
 * objet) porte un vrai accusé par note ; quand un profil y sera passé, cette
 * fonction pourra le lire au lieu de raisonner sur le conteneur entier.
 */

import type { Note } from '../../types/notes';
import type { FileStatus, SyncState } from '../../store/slices/syncSlice';

export type NoteSyncState = 'synced' | 'syncing' | 'pending' | 'offline';

export interface SyncInput {
  state: SyncState;
  lastSyncAt: string | null;
  /**
   * Statut de l'entrée `meta:notes` tel que le MOTEUR le publie.
   *
   * `'synced'` = le nuage a tout, aucune note ne peut être en retard.
   * `undefined` = le moteur n'a rien dit (démarrage, ou version antérieure du
   * processus principal) : on retombe alors sur l'horloge, faute de mieux.
   */
  notesEntryStatus?: FileStatus;
}

/**
 * La note a-t-elle été modifiée depuis le dernier cycle abouti ?
 *
 * ⚠ HEURISTIQUE, ET RIEN DE PLUS. Elle compare des horodatages qui peuvent
 * venir d'appareils différents. Elle ne sert QUE à désigner laquelle des notes
 * est concernée quand le moteur a déjà dit qu'il restait quelque chose — jamais
 * à décider qu'il reste quelque chose.
 *
 * Sans horodatage de cycle, elle ne conclut RIEN : `false`. C'est l'inverse de
 * ce qu'elle faisait, et c'est le premier des deux mensonges corrigés — un
 * profil qu'on vient d'ouvrir n'a pas « toutes ses notes en attente ».
 */
export function isNoteDirty(note: Pick<Note, 'updatedAt'>, lastSyncAt: string | null): boolean {
  if (!lastSyncAt) return false;
  return note.updatedAt > lastSyncAt;
}

/**
 * Dérive l'état visible d'une note.
 *
 *  - `synced`  — le nuage a cette version.
 *  - `syncing` — un transfert est en vol et cette note en fait partie.
 *  - `pending` — écrit ici, pas encore accepté là-haut.
 *  - `offline` — pas de connexion ; tout repartira au retour.
 *
 * Hors mode nuage, les appelants ne rendent rien du tout ; `synced` reste le
 * repli sûr pour que personne n'ait à traiter un cas de plus.
 */
export function getNoteSyncState(note: Pick<Note, 'updatedAt'>, sync: SyncInput): NoteSyncState {
  /**
   * L'ACCUSÉ D'ABORD, ET IL PRIME SUR TOUT. Le moteur dit que l'entrée des notes
   * n'a plus rien à remonter : le conteneur entier est là-haut, donc cette note
   * aussi. Aucune comparaison d'horloge ne peut contredire ça — et c'est
   * précisément une comparaison d'horloge qui affichait « non synchronisée » sur
   * des notes parfaitement à jour.
   *
   * Tout statut AUTRE que « à remonter » vaut la même chose ici : un conflit ou
   * une descente en attente ne veulent pas dire que le nuage a perdu quelque
   * chose que nous aurions.
   */
  if (sync.notesEntryStatus !== undefined && sync.notesEntryStatus !== 'pending_upload') {
    return 'synced';
  }

  /**
   * Ici seulement l'horloge entre en jeu — pour désigner LAQUELLE des notes est
   * concernée, jamais pour décider qu'il reste quelque chose. Sans horodatage de
   * cycle elle ne désigne personne : un profil qu'on vient d'ouvrir n'a pas
   * « toutes ses notes en attente ».
   */
  if (!isNoteDirty(note, sync.lastSyncAt)) return 'synced';

  // Une note écrite hors connexion n'attend pas son tour, elle attend le
  // réseau — et ce n'est pas la même chose à réparer.
  if (sync.state === 'offline') return 'offline';
  if (sync.state === 'syncing') return 'syncing';
  return 'pending';
}
