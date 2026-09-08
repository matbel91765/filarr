/**
 * Les DÉCISIONS de l'écran d'acceptation, sorties du composant.
 *
 * POURQUOI CE FICHIER EXISTE. Les règles de PendingInviteHost sont des jugements,
 * pas de l'affichage : ce qu'on conclut d'une réponse muette, ce qu'on fait d'une
 * exception, ce qu'on dit d'un jeton nu, et surtout QUAND on a le droit de
 * détruire l'invitation. Chacune s'est déjà trompée — et se tromper ici coûte un
 * jeton d'invitation, pas un pixel. Les tenir dans un module sans React, c'est
 * pouvoir les épingler une par une.
 *
 * ET L'ENCHAÎNEMENT AVEC, PAS SEULEMENT LES VERDICTS. Une contre-épreuve a remis
 * l'appel d'acceptation dans sa forme défectueuse — sans try/catch, repli
 * `invite_invalid` — et la suite est restée verte : les jugements étaient
 * épinglés, leur CÂBLAGE ne l'était pas. `runAcceptance` fait donc entrer
 * l'appel lui-même dans l'unité testée, en recevant ses effets de bord en
 * paramètres ; le composant n'est plus qu'un adaptateur.
 *
 * LE FIL CONDUCTEUR : ne jamais dériver d'une absence d'information un verdict
 * qui détruit quelque chose. Un refus TERMINAL retire seulement le bouton
 * « Réessayer » ; seul un refus qui affirme que l'invitation n'existe plus
 * (`isDeadInviteError`) autorise à effacer le jeton.
 */

import {
  isDeadInviteError,
  UNKNOWN_FAILURE_CODE,
} from '../../../services/vault/vaultErrorMessages';
import type { PendingInvite } from '../../../services/invites/pendingInvite';
import { isSameAccountAddress } from './inviteAccountMatch';

export { UNKNOWN_FAILURE_CODE };

export interface AcceptOrgResult {
  success: boolean;
  error?: string;
  code?: string;
  data?: { orgId?: string; role?: string };
}

/** Le pont IPC (bureau) ou son émulation web, injecté pour être remplaçable. */
export type InviteInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Le transport a REJETÉ, il n'a rien rendu du tout. Les deux plateformes
 * finissent sur un `fetch` nu (`apiFetch` sur le web, `fetchWithTimeout` à
 * travers `ipcMain.handle` sur le bureau) : hors ligne ou sur abandon, la
 * promesse part en exception au lieu de porter une enveloppe.
 */
export const TRANSPORT_REJECTED_CODE = 'network_unavailable';

/**
 * Le code d'un refus d'acceptation d'ESPACE, à partir de l'enveloppe rendue.
 *
 * JAMAIS `invite_invalid` en repli — c'était le défaut. Plusieurs échecs de
 * transport ne portent aucun `code` (`authService` fabrique `Session expired`,
 * `Refresh unavailable (network)`, `Unexpected server response (HTTP …)` ;
 * l'enveloppe web fabrique `HTTP 502`), et `invite_invalid` est TERMINAL,
 * traduit « invitation retirée ou déjà utilisée », et DESTRUCTEUR. L'écran
 * mentait donc, puis jetait le jeton. Les deux sources portent désormais un code
 * dérivé du statut ; ce repli-ci ne couvre plus que l'inconnu, et le dit.
 */
export function acceptOrgCode(res: AcceptOrgResult | undefined): string | null {
  if (res?.success) return null;
  return res?.code ?? UNKNOWN_FAILURE_CODE;
}

/**
 * Présente le jeton à la route des ESPACES et rend le code du refus, ou `null`.
 *
 * L'invoke est un PARAMÈTRE : c'est le seul moyen qu'un retour en arrière sur
 * cet appel — le repli inventé, l'exception non rattrapée — rougisse au lieu de
 * passer inaperçu derrière un composant que rien ne monte en test.
 */
export async function acceptOrgInvite(
  invoke: InviteInvoke | undefined,
  token: string
): Promise<string | null> {
  if (!invoke) return TRANSPORT_REJECTED_CODE;
  try {
    const res = (await invoke('org:acceptInvitation', token)) as AcceptOrgResult | undefined;
    return acceptOrgCode(res);
  } catch {
    return TRANSPORT_REJECTED_CODE;
  }
}

/**
 * Mène une acceptation à son terme et rend TOUJOURS un verdict : `null` en cas
 * de réussite, un code sinon.
 *
 * POURQUOI. Sans cela une exception laissait la modale sur « Acceptation… », les
 * deux boutons désactivés, plus aucune issue — ni « Plus tard », ni « Fermer »,
 * ni fermeture — et un rejet non géré par-dessus. Une acceptation qui ne peut
 * pas aboutir doit au moins pouvoir se refermer.
 */
export async function settleAcceptance(step: () => Promise<string | null>): Promise<string | null> {
  try {
    return await step();
  } catch {
    return UNKNOWN_FAILURE_CODE;
  }
}

/** Tout ce que l'acceptation fait AILLEURS qu'en elle-même. */
export interface AcceptanceDeps {
  invoke: InviteInvoke | undefined;
  /** Adhère au coffre. Rend le code du refus, ou `null` si c'est passé. */
  joinVault: (invite: PendingInvite) => Promise<string | null>;
  /**
   * Relit les espaces. D'eux dépendent l'entrée « Coffres partagés » d'un invité
   * gratuit et les locataires que le chargement des coffres interroge : sans ce
   * rafraîchissement, une acceptation réussie reste invisible.
   */
  refreshOrgs: () => Promise<void>;
  /**
   * Publie notre clé publique. Sans elle l'hôte ne peut pas sceller K_vault et
   * se heurte à `member_no_key`. Un échec n'est PAS bloquant : le garde de
   * /vaults redemande le mot de passe et reprend la main.
   */
  publishOwnKey: () => Promise<void>;
  /** Charge les coffres (branche ESPACE ; la jointure de coffre le fait déjà). */
  loadVaults: () => Promise<void>;
  /** Réussite : consommer le jeton, annoncer, naviguer. */
  onAccepted: (invite: PendingInvite) => void;
  /**
   * Une SEULE reprise après rafraîchissement de session, par invitation. Forme
   * de `useRef` pour que le composant passe la sienne telle quelle.
   */
  sessionRetried: { current: boolean };
}

/**
 * L'acceptation complète, du jeton au verdict.
 *
 * DEUX TEMPS, ET C'EST L'ARCHITECTURE. Une invitation d'ESPACE se règle contre
 * `POST /org/invitations/:token/accept` ; une invitation de COFFRE contre
 * `POST /vaults/:id/join`, qui exige déjà une adhésion active à l'espace de
 * l'hôte. Un coffre présenté avant l'espace ne rend donc pas une erreur
 * d'invitation mais un refus d'appartenance, et l'écran le dit dans ces termes.
 */
export async function runAcceptance(
  invite: PendingInvite,
  deps: AcceptanceDeps
): Promise<string | null> {
  return settleAcceptance(async () => {
    if (invite.kind === 'org') {
      let failure = await acceptOrgInvite(deps.invoke, invite.token);
      // Sur le web le jeton d'accès ne se re-frappe qu'une fois par chargement :
      // un onglet resté ouvert longtemps échoue en session_expired alors que le
      // cookie de refresh est encore bon. Une seule reprise, après avoir forcé
      // la relecture du compte.
      if (failure === 'session_expired' && !deps.sessionRetried.current) {
        deps.sessionRetried.current = true;
        try {
          await deps.invoke?.('auth:getMe');
        } catch {
          /* la reprise ci-dessous tranchera */
        }
        failure = await acceptOrgInvite(deps.invoke, invite.token);
      }
      if (failure) return failure;
      await deps.refreshOrgs();
      try {
        await deps.publishOwnKey();
      } catch {
        /* le garde de /vaults reprendra la main */
      }
      await deps.loadVaults();
      deps.onAccepted(invite);
      return null;
    }

    const failure = await deps.joinVault(invite);
    if (failure) return failure;
    await deps.refreshOrgs();
    deps.onAccepted(invite);
    return null;
  });
}

/**
 * Le code à AFFICHER, une fois prise en compte l'hypothèse faite sur un jeton nu.
 *
 * Un code recopié à la main est présenté à la route des ESPACES faute de mieux :
 * les deux sortes de jeton sont indiscernables (même alphabet, même longueur) et
 * seul le lien porte l'identifiant du coffre. Quand le serveur répond « connais
 * pas », la phrase de `invitation_not_found` — « retirée ou déjà utilisée » —
 * est donc fausse pour quelqu'un qui a simplement recopié le mauvais morceau de
 * son e-mail. Tout autre refus, lui, garde son sens : une adresse qui ne
 * correspond pas ne devient pas ambiguë parce qu'on a collé un code plutôt
 * qu'un lien.
 */
export function displayedInviteErrorCode(invite: PendingInvite, code: string): string {
  if (invite.bare && code === 'invitation_not_found') return 'invite_code_not_a_space_invite';
  return code;
}

/**
 * Le jeton CONSERVÉ ne peut plus rien produire : l'écran a le droit de l'effacer.
 *
 * Deux raisons, et deux seulement. Le serveur a affirmé un fait sur l'invitation
 * (`isDeadInviteError`) ; ou bien le jeton est un code nu qu'AUCUNE route ne peut
 * plus recevoir — il a été présenté à la seule à laquelle il pouvait l'être, et
 * la suite passe par le lien complet, qui remplacera le porteur de toute façon.
 *
 * Tout le reste est conservé, terminal compris : c'est la distinction que le
 * commentaire de `DEAD_INVITE_CODES` détaille, et la confondre avec « terminal »
 * était le défaut central de cet écran.
 */
export function shouldConsumeInvite(code: string | null): boolean {
  if (!code) return false;
  if (code === 'invite_code_not_a_space_invite') return true;
  return isDeadInviteError(code);
}

/** Où en est l'écran d'acceptation : avant, pendant, ou après un refus. */
export type InvitePhase = 'confirm' | 'working' | 'failed';

/**
 * Ce que FERMER fait du jeton — quelle que soit la MANIÈRE de fermer.
 *
 * LE DÉFAUT QUE CECI FERME. Le bouton de pied appliquait le verdict tandis que
 * la croix, Échap et le clic hors de la fenêtre conservaient toujours. Sur une
 * invitation réellement morte, sortir par la croix laissait donc un porteur
 * incapable de produire quoi que ce soit, qui rouvrait la même fenêtre à chaque
 * démarrage pendant sept jours. La décision appartient au VERDICT, pas au geste :
 * toutes les sorties passent désormais par ici.
 *
 * Hors phase d'échec il n'y a AUCUN verdict — rien n'a encore été demandé au
 * serveur, ou la réponse n'est pas revenue — et fermer ne détruit donc rien.
 */
export function consumeOnClose(phase: InvitePhase, code: string | null): boolean {
  return phase === 'failed' && shouldConsumeInvite(code);
}

/**
 * L'invitation vise une AUTRE adresse que le compte connecté.
 *
 * POURQUOI PRÉEMPTER LE SERVEUR. Le porteur est durable et partagé par tous les
 * comptes du même navigateur : Alice ouvre son lien et ne se connecte jamais,
 * Bob se connecte, et l'invitation d'Alice — avec le nom de l'espace — lui est
 * proposée. Le serveur la refusera, mais on aura montré à Bob quelque chose qui
 * ne le regarde pas. L'adresse invitée, elle, est publique pour qui tient le
 * jeton (c'est la règle de la route d'aperçu) : la comparer suffit, et ne coûte
 * aucun aller-retour.
 *
 * LES DEUX SORTES D'INVITATION, DÉSORMAIS. Ce prédicat n'a jamais rien eu de
 * spécifique à l'espace — c'est une comparaison d'adresses — mais il ne pouvait
 * s'appliquer qu'à lui : seule l'invitation d'espace avait un aperçu public,
 * donc `invitedEmail` restait nul pour un coffre et la garde ne se déclenchait
 * jamais. L'aperçu de coffre existe maintenant
 * (`apiGetVaultInvitationPreview`), et l'écran l'interroge pour les deux : la
 * même comparaison protège enfin les deux parcours.
 *
 * Inconnue malgré tout (aperçu hors ligne, sous plafond de requêtes, ou refusé) :
 * on ne conclut rien — le serveur reste l'autorité, et son refus ne détruit plus
 * rien.
 *
 * La normalisation est celle d'`inviteAccountMatch` et il n'y en a qu'une : deux
 * règles de comparaison qui divergeraient d'un cheveu feraient dire à cet écran
 * et au verdict qui l'habille deux choses contraires sur la même adresse.
 */
export function isForAnotherAccount(
  invitedEmail: string | null | undefined,
  accountEmail: string | null | undefined
): boolean {
  if (!invitedEmail || !accountEmail) return false;
  return !isSameAccountAddress(invitedEmail, accountEmail);
}

/**
 * Le serveur vient d'affirmer que ce COMPTE n'est pas le destinataire.
 *
 * POURQUOI CE PRÉDICAT EXISTE. `isForAnotherAccount` compare l'adresse invitée à
 * celle du compte, mais l'aperçu public n'est demandé que pour une invitation
 * d'ESPACE : une invitation de COFFRE n'en a aucun, `invitedEmail` reste nul, la
 * branche « poste partagé » n'est jamais montée — et c'est elle qui portait
 * l'unique bouton « Ne plus me la proposer ». Quelqu'un qui ouvrait le lien d'un
 * collègue voyait donc la fenêtre d'acceptation ordinaire, acceptait, recevait un
 * refus JUSTEMENT non destructeur (le jeton appartient à son vrai destinataire),
 * et revoyait la même fenêtre à chaque démarrage pendant sept jours, sans issue.
 *
 * Ici le refus dit ce que l'aperçu ne pouvait pas dire, pour les deux sortes
 * d'invitation. La sourdine est PAR COMPTE et ne touche jamais au jeton :
 * l'invitation reste entière pour la personne qu'elle vise.
 *
 * Volontairement restreint à cette famille : `session_expired` ou une panne ne
 * disent rien du destinataire, et proposer d'y faire taire l'invitation
 * inviterait à jeter la sienne sur un incident passager.
 */
const WRONG_RECIPIENT_CODES: ReadonlySet<string> = new Set([
  'invite_email_mismatch',
  'invitation_email_mismatch',
  'invitee_mismatch',
]);

export function isWrongRecipientError(code: string | null | undefined): boolean {
  if (!code) return false;
  return WRONG_RECIPIENT_CODES.has(code.split(':')[0]);
}
