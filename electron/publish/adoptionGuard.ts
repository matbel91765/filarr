/**
 * La garde d'adoption de FEK — et sa TROISIÈME issue.
 *
 * LE PROBLÈME QU'ELLE RÉPARE. Un poste servi en local pendant des semaines,
 * puis relié à un compte : l'appairage réussit, la clé du compte arrive, et la
 * garde refuse de l'adopter parce que le coffre porte déjà N éléments scellés
 * sous une AUTRE clé. La garde a raison — adopter les rendrait illisibles pour
 * toujours. Mais un refus sans porte de sortie est un cul-de-sac, et le travail
 * de l'utilisateur reste prisonnier de l'appareil.
 *
 * D'où `publish` : à l'instant EXACT du refus, l'appareil détient les DEUX
 * clés — la sienne, qui lit son contenu, et celle du compte, qui vient
 * d'arriver. C'est la seule fenêtre où la migration est réalisable, et c'est
 * donc là qu'on l'offre.
 *
 * CE MODULE EST PUR. Aucun accès disque, aucun `electron` : il décide, il ne
 * fait rien. Les tests le prennent tel quel.
 */

import type { FekAdoptionDecision } from './types';

/**
 * L'état de la clé locale, tel que l'appelant a réussi (ou non) à l'établir.
 *
 * `'unreadable'` n'est PAS une erreur de programme : c'est le coffre verrouillé,
 * l'état normal avant déverrouillage. On le distingue de `'absent'` parce que
 * les deux mènent à des conduites opposées — l'un ouvre, l'autre ferme.
 */
export type LocalKeyState = 'absent' | 'unreadable' | { raw: Uint8Array };

export interface FekAdoptionInput {
  localKey: LocalKeyState;
  /** La clé du compte, déjà déballée : on ne décide que sur du vérifié. */
  incomingKey: Uint8Array;
  /**
   * Nombre d'éléments chiffrés présents sur cet appareil. Compté sur le DISQUE,
   * pas dans un index applicatif : c'est ce qui deviendrait illisible, et le
   * disque est la seule source qui ne mente pas.
   */
  localContentCount: number;
}

/**
 * Comparaison d'octets à temps constant, y compris sur des longueurs
 * différentes.
 *
 * POURQUOI : sans elle, le temps de réponse de la garde fuirait le préfixe
 * commun entre la clé locale et une clé entrante choisie par un attaquant —
 * la garde deviendrait un oracle sur la clé du coffre. `crypto.timingSafeEqual`
 * n'est pas utilisable ici : il LÈVE sur des longueurs différentes, ce qui est
 * en soi une fuite, et il tirerait `node:crypto` dans un module pur.
 */
export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  // La différence de longueur entre dans l'accumulateur au lieu de court-circuiter.
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (i < a.length ? a[i] : 0) ^ (i < b.length ? b[i] : 0);
  }
  return diff === 0;
}

/**
 * Le verdict. L'ORDRE des tests est normatif — chaque marche ferme un cas que
 * la suivante traiterait mal :
 *
 *  1. pas de clé locale  → adoption directe. C'est l'amorçage neuf, il doit
 *     rester fluide ; rien ne peut être orphelin puisque rien n'est scellé.
 *  2. coffre vide        → adoption directe. Il n'y a rien à publier, et
 *     proposer une migration sur un coffre vide serait une cérémonie creuse.
 *  3. clé locale illisible → REFUS. On ne migre JAMAIS ce qu'on ne peut pas
 *     lire : sans la clé qui ouvre le contenu, la migration ne pourrait pas
 *     déchiffrer, et « tenter puis échouer à mi-chemin » est pire que refuser.
 *  4. clés identiques    → adoption directe. Un ré-appairage du même compte ne
 *     doit pas déclencher une migration de plusieurs heures pour rien.
 *  5. sinon              → PUBLIER. Les deux clés sont là, la sortie existe.
 */
export function decideFekAdoption(input: FekAdoptionInput): FekAdoptionDecision {
  if (input.localKey === 'absent') {
    return { kind: 'adopt', reason: 'no-local-key' };
  }

  if (input.localContentCount <= 0) {
    return { kind: 'adopt', reason: 'empty-vault' };
  }

  if (input.localKey === 'unreadable') {
    return { kind: 'refuse', reason: 'unverifiable-local-key' };
  }

  if (constantTimeEquals(input.localKey.raw, input.incomingKey)) {
    return { kind: 'adopt', reason: 'same-key' };
  }

  return { kind: 'publish', reason: 'content-under-other-key' };
}
