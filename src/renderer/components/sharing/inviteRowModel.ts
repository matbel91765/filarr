/**
 * inviteRowModel — CE QUE LA LIGNE D'INVITATION ANNONCE AVANT LE CLIC.
 *
 * LE DÉFAUT QUE CE FICHIER FERME (F02). L'ancien écran demandait à l'hôte de
 * deviner : deux boutons sans rapport dans une même boîte (« Invite » visait
 * l'ESPACE, « Give access » visait le COFFRE), et rien, nulle part, ne disait
 * lequel des deux allait faire quoi pour l'adresse qu'on venait de taper. On
 * apprenait l'issue après coup, par un toast d'erreur. Ici, la pastille dit
 * pendant la frappe ce qui va se passer, et le bouton porte le nom de ce
 * geste-là : « Donner l'accès » quand la personne est dans l'espace (l'accès est
 * scellé maintenant), « Inviter » quand elle n'y est pas (un e-mail part, et
 * l'accès suivra tout seul).
 *
 * POURQUOI C'EST PUR, ET SÉPARÉ DU COMPOSANT. Cinq états, chacun avec sa phrase,
 * son bouton et son activation : un booléen inversé compile parfaitement et ne
 * se voit qu'à l'œil, une fois, sur l'état qu'on a pensé à ouvrir. Ici les cinq
 * s'éprouvent en quelques lignes de vitest — y compris ceux qu'on n'atteint
 * qu'avec un annuaire en panne ou un espace plein, c'est-à-dire précisément ceux
 * que personne ne rejoue à la main.
 *
 * NI REACT, NI RÉSEAU, NI TRADUCTION : ce module rend des CLÉS i18n, jamais des
 * phrases — la ligne existe en deux langues et personne ne relit la seconde.
 */

import type { InviteRouteEx } from './shareDialogModel';

/** Ce que l'écran sait au moment de rendre la ligne. */
export interface InviteRowFlags {
  /**
   * La cérémonie d'empreinte autorise le scellement (`kv.canProceed`). Faux tant
   * qu'elle vérifie, faux quand elle a BLOQUÉ (journal falsifié, clé servie qui
   * n'est pas la dernière), faux quand la clé a changé et que l'hôte n'a pas
   * confirmé l'avoir comparée hors bande.
   */
  keyReady: boolean;
  /** La clé a changé depuis la dernière fois (`kv.needsConfirm`) : le bouton le dit. */
  needsConfirm: boolean;
  /** Le plafond de sièges de l'espace interdit un nouvel arrivant. */
  seatBlocked: boolean;
  /** On connaît l'espace du coffre — sans lui, aucune invitation d'espace n'a de cible. */
  hasOrg: boolean;
  /** Un envoi est déjà en vol : on ne le double pas. */
  sending: boolean;
}

export interface InviteRowView {
  kind: InviteRouteEx['kind'];
  /** La pastille — `null` quand il n'y a rien d'honnête à dire (champ vide). */
  noticeKey: string | null;
  /** `warn` : quelque chose empêche d'agir et l'hôte doit le voir. */
  noticeTone: 'neutral' | 'warn';
  /** Le libellé du bouton principal — il NOMME le geste, pas l'écran. */
  buttonKey: string;
  /** Le bouton est-il actionnable ? */
  canSend: boolean;
  /** La cérémonie du numéro de sécurité est-elle dépliée sous la ligne ? */
  showCeremony: boolean;
  /** Proposer « Voir la ligne » — la personne a déjà accès, elle est dans la liste. */
  showSeeRow: boolean;
}

/**
 * Les clés i18n, groupées pour qu'un renommage se voie d'un coup d'œil.
 *
 * DEUX D'ENTRE ELLES SONT REPRISES de l'ancien écran, délibérément :
 * `sendSpaceInvite` (« Inviter ») est le même geste sous le même mot, et
 * `spaceFull` est déjà la phrase du plafond, avec sa proposition de montée
 * d'offre. En inventer des jumelles n'aurait servi qu'à les traduire deux fois,
 * puis à les laisser diverger.
 */
const K = {
  routeMember: 'teamVaults.invite.route.member',
  routeNewcomer: 'teamVaults.invite.route.newcomer',
  routeInVault: 'teamVaults.invite.route.inVault',
  routeUnknown: 'teamVaults.invite.route.unknown',
  /** Prend `{{limit}}` : le composant le passe depuis `seatGate`. */
  routeSpaceFull: 'teamVaults.members.spaceFull',
  giveAccess: 'teamVaults.invite.giveAccess',
  confirmAndGiveAccess: 'teamVaults.invite.confirmAndGiveAccess',
  sendSpaceInvite: 'teamVaults.members.sendSpaceInvite',
} as const;

export const INVITE_ROW_KEYS = K;

export function inviteRowView(route: InviteRouteEx, flags: InviteRowFlags): InviteRowView {
  const base = {
    kind: route.kind,
    noticeTone: 'neutral' as const,
    showCeremony: false,
    showSeeRow: false,
  };

  switch (route.kind) {
    case 'member':
      // « L'accès sera donné maintenant » est une PROMESSE qu'on peut tenir : la
      // personne est dans l'espace, sa clé est résolvable, le scellement part
      // avec celle que la cérémonie vient de vérifier. Aucun siège consommé,
      // donc aucun plafond à consulter — c'est ce que l'ancien modal avait
      // faux, en désactivant le champ entier dès que l'espace était plein.
      return {
        ...base,
        noticeKey: K.routeMember,
        buttonKey: flags.needsConfirm ? K.confirmAndGiveAccess : K.giveAccess,
        canSend: flags.keyReady && !flags.sending,
        showCeremony: true,
      };

    case 'newcomer':
      // Un e-mail part, et l'intention (0073) le suit : l'accès sera scellé tout
      // seul à l'acceptation. La seule chose qui puisse l'empêcher est le
      // plafond de l'espace — dit AVANT que l'invitation ne soit brûlée.
      return {
        ...base,
        noticeKey: flags.seatBlocked ? K.routeSpaceFull : K.routeNewcomer,
        noticeTone: flags.seatBlocked ? 'warn' : 'neutral',
        buttonKey: K.sendSpaceInvite,
        canSend: flags.hasOrg && !flags.seatBlocked && !flags.sending,
      };

    case 'inVault':
      // Rien à envoyer, et le dire vaut mieux qu'un `already_member` du serveur
      // après un aller-retour. La ligne existe déjà, plus bas : on y emmène.
      return {
        ...base,
        noticeKey: K.routeInVault,
        buttonKey: K.giveAccess,
        canSend: false,
        showSeeRow: true,
      };

    case 'unknown':
      // On n'affirme rien à partir d'une absence d'information. Le bouton reste
      // éteint : inviter à l'aveugle, c'est promettre une invitation d'espace à
      // quelqu'un qui y est peut-être déjà.
      return {
        ...base,
        noticeKey: K.routeUnknown,
        noticeTone: 'warn',
        buttonKey: K.giveAccess,
        canSend: false,
      };

    default:
      // Champ vide ou adresse incomplète : PAS DE MESSAGE. Reprocher une adresse
      // à moitié tapée est le meilleur moyen de faire lire les vrais messages
      // comme du bruit.
      return { ...base, noticeKey: null, buttonKey: K.giveAccess, canSend: false };
  }
}
