/**
 * LE BON COMPTE, AVANT D'AGIR — ce qu'il faut faire quand l'adresse invitée et
 * l'adresse connectée ne sont pas la même.
 *
 * POURQUOI CE FICHIER EXISTE. Jusqu'ici, quelqu'un qui possède plusieurs comptes
 * — un perso, un pro : le cas ORDINAIRE — cliquait le lien reçu par e-mail,
 * appuyait sur « Accepter », et n'apprenait qu'APRÈS, par un refus du serveur
 * (`invite_email_mismatch`), qu'il s'était trompé de compte. Pour une invitation
 * de COFFRE c'était pire encore : aucun aperçu public n'existait, donc l'écran
 * ne pouvait rien nommer avant l'échec. L'aperçu de coffre existe maintenant
 * (`GET /vaults/invites/:token/preview`), et il rend enfin possible de trancher
 * AVANT le geste.
 *
 * ET LE CONSEIL DÉPEND DE LA PLATEFORME — c'est tout l'objet de ce module. Sur
 * le WEB il n'y a qu'une session par navigateur : changer de compte, c'est se
 * déconnecter. Sur le BUREAU il y a des PROFILS, chacun lié à son propre compte
 * cloud (`profile.cloudAccount.email`) : la bonne manœuvre n'est pas de se
 * déconnecter — ce serait détacher le compte de ce profil-ci — mais d'ouvrir
 * l'AUTRE profil. L'écran affichait pourtant le conseil du web partout, et sur
 * le bureau ce conseil était simplement FAUX.
 *
 * UN MODULE PUR, SANS REACT NI RÉSEAU : le verdict est un jugement, il doit
 * pouvoir être épinglé cas par cas. Les deux écrans qui s'en servent —
 * `PendingInviteHost` (après la sélection de profil) et `ProfilePicker` (AVANT,
 * quand aucune session n'existe encore) — n'en sont que des adaptateurs.
 *
 * CE QU'IL NE FAIT JAMAIS : conclure d'une ABSENCE d'information. Un aperçu qui
 * n'a pas répondu ne prouve rien — ni que l'adresse correspond, ni qu'elle ne
 * correspond pas — et le verdict le dit alors en toutes lettres
 * (`unknownRecipient`), pour que l'écran laisse « Accepter » et que le SERVEUR
 * tranche, comme il le faisait déjà. C'est la règle du dossier : ne jamais
 * dériver d'un silence un verdict qui ferme une porte.
 */

/** Un profil du bureau, réduit à ce que la décision regarde. */
export interface InviteProfileRef {
  id: string;
  name: string;
  /** L'adresse du compte cloud lié à ce profil, ou `null` s'il est local. */
  cloudEmail: string | null;
}

export interface InviteAccountMatchInput {
  /** L'adresse à qui l'invitation a été envoyée, selon l'aperçu public. */
  invitedEmail: string | null;
  /** L'adresse du compte actuellement connecté, ou `null` s'il n'y en a pas. */
  connectedEmail: string | null;
  platform: 'desktop' | 'web';
  /** Les profils du poste. Vide sur le web, qui n'en a pas. */
  profiles: InviteProfileRef[];
}

/**
 * Ce qu'il y a à faire. `kind` porte la décision ; les champs qui l'accompagnent
 * ne sont là que pour que l'écran puisse NOMMER la sortie plutôt que de la
 * décrire vaguement.
 */
export type InviteAccountVerdict =
  /** Les deux adresses sont la même : rien ne s'oppose à l'acceptation. */
  | { kind: 'accept' }
  /**
   * Aucune session. Sur le bureau, `profile` porte le profil DÉJÀ lié à
   * l'adresse invitée quand il en existe un — c'est celui-là qu'il faut ouvrir,
   * et le sélecteur de profils s'en sert pour le surligner.
   */
  | { kind: 'signIn'; profile: InviteProfileRef | null }
  /** Bureau : un profil est lié à l'adresse invitée. Il faut l'ouvrir. */
  | { kind: 'switchProfile'; profile: InviteProfileRef }
  /** Bureau : aucun profil n'est lié à cette adresse. Rien à ouvrir. */
  | { kind: 'noProfileForAddress' }
  /** Web : un AUTRE compte est connecté, et il n'y a qu'une session ici. */
  | { kind: 'switchAccount' }
  /** L'aperçu n'a rien dit : on ne peut rien affirmer, le serveur tranchera. */
  | { kind: 'unknownRecipient' };

/** Une adresse vide n'est pas une adresse : elle vaut « inconnue ». */
function normalize(email: string | null | undefined): string | null {
  const trimmed = (email ?? '').trim().toLowerCase();
  return trimmed || null;
}

/**
 * Deux écritures de la MÊME adresse.
 *
 * Casse et espaces de bord ignorés : l'adresse vient d'un côté d'un aperçu
 * serveur, de l'autre d'un formulaire humain, et « Alice@Example.COM » n'est pas
 * un autre compte que « alice@example.com ». On ne va pas plus loin (ni points
 * dans la partie locale, ni sous-adressage `+`) : ces règles-là appartiennent au
 * fournisseur de messagerie, pas à nous, et les appliquer ferait dire à cet
 * écran que deux comptes distincts n'en sont qu'un.
 */
export function isSameAccountAddress(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalize(a);
  const right = normalize(b);
  return left !== null && right !== null && left === right;
}

/**
 * Le profil du poste lié à cette adresse, ou `null`.
 *
 * Le PREMIER qui correspond : deux profils sur le même compte cloud sont
 * parfaitement légitimes (travail / archives), et l'un ou l'autre mène à la même
 * session — c'est l'adresse qui décide de l'acceptation, pas le profil.
 */
export function findProfileForAddress(
  profiles: InviteProfileRef[],
  email: string | null | undefined
): InviteProfileRef | null {
  const target = normalize(email);
  if (!target) return null;
  return profiles.find((p) => normalize(p.cloudEmail) === target) ?? null;
}

/**
 * Le verdict, dans l'ordre où les questions se posent réellement.
 *
 * 1. PAS DE SESSION d'abord, et avant même de savoir à qui l'invitation est
 *    destinée : il n'y a rien à comparer, et rien à corriger — il faut se
 *    connecter. Sur le bureau on dit tout de même DANS QUEL PROFIL, quand
 *    l'adresse est connue et qu'un profil lui est lié ; c'est ce que le
 *    sélecteur de profils surligne.
 * 2. ADRESSE INVITÉE INCONNUE ensuite : l'aperçu a échoué (hors ligne, plafond
 *    de requêtes, invitation morte). On ne conclut rien.
 * 3. MÊME ADRESSE : accepter.
 * 4. ÉCART, enfin — et c'est là que la plateforme décide du conseil.
 */
export function inviteAccountMatch(input: InviteAccountMatchInput): InviteAccountVerdict {
  const invited = normalize(input.invitedEmail);
  const connected = normalize(input.connectedEmail);
  // Le web n'a pas de profils. S'il en arrivait quand même (un appelant qui
  // passe la liste sans regarder la plateforme), les ignorer vaut mieux que
  // proposer d'ouvrir un profil qui n'existe pas dans ce navigateur.
  const profiles = input.platform === 'desktop' ? input.profiles : [];

  if (!connected) {
    return { kind: 'signIn', profile: findProfileForAddress(profiles, invited) };
  }
  if (!invited) return { kind: 'unknownRecipient' };
  if (invited === connected) return { kind: 'accept' };

  if (input.platform === 'web') return { kind: 'switchAccount' };

  const profile = findProfileForAddress(profiles, invited);
  return profile ? { kind: 'switchProfile', profile } : { kind: 'noProfileForAddress' };
}

/**
 * L'acceptation a-t-elle encore un sens à proposer ?
 *
 * Le seul verdict qui la RETIRE est celui qui affirme un écart — et il n'est
 * rendu que quand les deux adresses sont connues. Un aperçu muet laisse le
 * bouton en place : c'est le serveur qui tranche, et son refus ne détruit rien.
 */
export function verdictAllowsAccept(verdict: InviteAccountVerdict): boolean {
  return verdict.kind === 'accept' || verdict.kind === 'unknownRecipient';
}
