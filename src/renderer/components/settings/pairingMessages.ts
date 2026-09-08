/**
 * Traduction des MOTIFS d'échec d'appairage en messages utilisateur.
 *
 * Le process principal ne renvoie pas une phrase mais un motif court
 * (`sas-rejected`, `commit-mismatch`, …). C'est délibéré : la phrase dépend de
 * la langue, et surtout un « erreur réseau » générique après une divergence de
 * nombres serait un MENSONGE DANGEREUX. L'utilisateur doit apprendre que
 * quelqu'un a peut-être tenté de s'interposer — c'est la seule information qui
 * lui permette de réagir (changer de réseau, se méfier).
 *
 * Trois motifs sont des ÉVÉNEMENTS DE SÉCURITÉ et non des incidents :
 * `sas-rejected`, `commit-mismatch` et `unwrap-failed`. Leur formulation ne
 * doit ni dramatiser ni banaliser, et surtout ne jamais proposer de
 * « continuer quand même » : il n'existe aucune reprise possible d'une session
 * détruite. Un réessai repart d'un code neuf, d'une paire de clés neuve et
 * d'un secret neuf.
 */

import type { TFunction } from 'i18next';

export type PairingFailureReason =
  | 'sas-rejected'
  | 'commit-mismatch'
  | 'unwrap-failed'
  | 'expired'
  | 'cancelled'
  | 'peer-too-old'
  | 'role-taken'
  | 'invalid-code'
  | 'network'
  /**
   * BIFURCATION, pas échec : le coffre porte du contenu sous une autre clé, et
   * le parcours « Publier ce coffre sur le compte » prend le relais. Ce motif
   * ne devrait jamais atteindre `pairingFailureMessage` — l'appelant l'aiguille
   * avant. Il figure ici pour que le type reste exhaustif.
   */
  | 'publish-required'
  | 'vault-locked';

export function pairingFailureMessage(
  t: TFunction,
  reason: string | undefined,
  fallback: string
): string {
  switch (reason) {
    case 'sas-rejected':
      return t(
        'pairing.error.sasRejected',
        "Appairage annulé. Les nombres ne correspondaient pas — quelqu'un a peut-être tenté d'intercepter la connexion. Recommencez ; si l'écart persiste, changez de réseau."
      );
    case 'commit-mismatch':
      return t(
        'pairing.error.commitMismatch',
        "Appairage interrompu : l'autre appareil n'a pas présenté la clé qu'il avait annoncée."
      );
    case 'unwrap-failed':
      return t('pairing.error.unwrapFailed', "La clé reçue n'a pas pu être vérifiée.");
    case 'expired':
      return t('pairing.error.expired', 'Code expiré. Générez-en un nouveau.');
    case 'role-taken':
      return t(
        'pairing.error.roleTaken',
        'Un autre appareil a déjà utilisé ce code. Générez-en un nouveau.'
      );
    case 'peer-too-old':
      // Message imposé par la spécification, même sens sur les trois
      // plateformes. La seule issue est la mise à jour : pas de
      // « réessayer », pas de « continuer quand même », pas de mode
      // compatibilité. Un repli vers l'ancien protocole serait un repli vers
      // « le serveur peut lire la clé de votre coffre ».
      return t(
        'pairing.error.peerTooOld',
        "Cet appareil utilise une version d'appairage plus ancienne. Mettez Filarr à jour sur l'autre appareil, puis recommencez. (L'ancienne méthode a été retirée : elle ne permettait pas de garantir que personne ne s'interpose entre vos deux appareils.)"
      );
    case 'vault-locked':
      // La sortie EXISTE et elle est nommée : déverrouiller, puis recommencer.
      // On ne migre jamais ce qu'on ne peut pas lire, mais on ne laisse pas non
      // plus l'utilisateur sans geste à faire.
      return t(
        'pairing.error.vaultLocked',
        "Ce coffre est verrouillé : Filarr ne peut pas lire son contenu, donc ni l'adopter ni le publier sans risque. Déverrouillez le coffre, puis recommencez l'appairage."
      );
    case 'invalid-code':
      return t('pairing.join.invalidCode', 'Code invalide ou expiré');
    default:
      return fallback;
  }
}

/**
 * Vrai si le motif interdit un simple « Réessayer » sur le même écran.
 *
 * Pour un pair trop ancien, réessayer ne peut RIEN changer tant que l'autre
 * appareil n'a pas été mis à jour : proposer le bouton entraînerait des
 * boucles d'échec et laisserait croire à un aléa. Pour un rôle déjà pris ou un
 * refus de SAS, le code est brûlé côté serveur — il faut en générer un neuf,
 * pas rejouer l'ancien.
 */
export function pairingFailureIsTerminal(reason: string | undefined): boolean {
  return reason === 'peer-too-old' || reason === 'role-taken' || reason === 'commit-mismatch';
}
