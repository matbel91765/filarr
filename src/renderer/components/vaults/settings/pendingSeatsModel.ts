/**
 * pendingSeatsModel — LES INVITÉES ONT UNE PLACE DANS LA LISTE DES MEMBRES.
 *
 * LE DÉFAUT QU'IL FERME, RAPPORTÉ APRÈS UN ESSAI RÉEL. « Il n'y a pas de moyen
 * de modifier le rôle d'une personne à qui on a envoyé une invitation vu qu'elle
 * apparaît pas dans la liste des membres. » C'était exact : le rôle d'une
 * invitation en attente se corrigeait bien (F18), mais UNIQUEMENT dans l'onglet
 * Invitations — c'est-à-dire ailleurs que là où l'on gère les rôles. Un hôte qui
 * vient d'inviter quelqu'un ouvre « Membres », n'y trouve personne, et conclut
 * que son geste n'a rien produit.
 *
 * ── DEUX GENRES DE SIÈGE, PARCE QUE L'HÔTE N'A FAIT QU'UN GESTE ──────────────
 *
 * ET LE PREMIER CORRECTIF NE COUVRAIT QUE LA MOITIÉ DU DÉFAUT (essai réel du
 * 31/08). L'hôte invite quelqu'un depuis le coffre, et Membres reste vide. La
 * table `vault_invites` était bel et bien VIDE en production : la personne
 * n'étant pas encore dans l'espace, son geste n'a PAS produit une invitation de
 * coffre mais une INTENTION d'accès (migration 0073) — une ligne
 * `org_invitations` portant `intended_vault_id`, `intended_vault_role` et
 * `intent_status`. Elle ne s'affichait que dans l'onglet Invitations, sous
 * « Accès en préparation », avec une pastille de rôle NON MODIFIABLE.
 *
 * OR POUR L'HÔTE IL N'EXISTE QU'UNE SEULE NOTION : quelqu'un qu'il a invité, et
 * dont il veut corriger le rang avant qu'il n'entre. Laquelle des deux moitiés
 * son geste a produite dépend d'un fait qu'il n'a pas choisi — la personne
 * était-elle déjà dans l'espace ? — et cette distinction est INTERNE. Ce fichier
 * rend donc UNE liste de sièges, de deux genres, portant le même geste :
 * corriger le rôle. Chaque ligne dit en revanche honnêtement ce qu'elle attend,
 * ce qui n'est pas la même chose (« invitée dans ce coffre » contre « invitée
 * dans votre espace, l'accès suit dès l'acceptation »).
 *
 * UN SIÈGE N'EST PAS UN MEMBRE, ET LE MODÈLE NE LES MÉLANGE JAMAIS. Une invitée
 * en attente n'a PAS de compte dans ce coffre, PAS de clé scellée qu'on puisse
 * révoquer, PAS de date d'entrée. Elle ne peut donc pas devenir une ligne du
 * trombinoscope : les gestes de ce tableau (retrait — donc rotation de K_vault —,
 * cérémonie d'empreinte, sélection de lot) portent tous sur un `userId` qui
 * n'existe pas encore. Ce fichier rend une liste À PART, à afficher à côté du
 * tableau, avec le seul geste qui ait un sens sur une promesse : corriger le rôle
 * qu'elle produira.
 *
 * CE QUE LE RÔLE D'UNE INVITATION NE TOUCHE PAS. Ni la clé, ni le porteur, ni la
 * date : `wrapped_vault_key` reste le même scellé, sous la même époque. Le rôle
 * décide de ce qu'on aura le droit de FAIRE une fois entré, jamais de ce qu'on
 * pourra LIRE. C'est pour cela que le corriger est un simple UPDATE côté serveur,
 * et que le lien déjà reçu continue de fonctionner. POUR UNE INTENTION C'EST
 * ENCORE PLUS VRAI : rien n'est scellé du tout, K_vault ne vit que sur les
 * appareils, et le rang promis attend en clair l'entrée de la personne.
 *
 * ON NE REND CORRIGIBLE QUE CE QUI EST ENCORE UNE PROMESSE. Une intention dont
 * l'accès a été ANNULÉ (`intent_status = 'canceled'` — l'invitation d'espace
 * orpheline) n'entre pas : le serveur borne son UPDATE à `pending` et refuserait,
 * et il aurait raison, puisque plus aucun accès à ce coffre n'arrivera au bout.
 * Elle garde sa ligne dans l'onglet Invitations, où le seul geste qui lui reste
 * — reprendre l'invitation d'espace, qui occupe encore une place — est offert.
 *
 * ET UNE FICHE NÉE D'UN BLOCAGE DE BALAYAGE N'EN EST PAS UNE NON PLUS : elle ne
 * porte aucun identifiant d'invitation (`accessJourneyModel` refuse d'en
 * fabriquer un), donc rien à corriger, et son rôle est un repli « lecteur » que
 * personne n'a choisi — l'afficher dans un menu le présenterait comme une
 * décision de l'hôte.
 *
 * LA RÈGLE QUI DEMANDE LE PLUS D'ATTENTION : UNE PERSONNE, UNE LIGNE. Entre
 * l'acceptation et la relecture des listes, la même adresse est à la fois un
 * membre (`/members` l'a déjà) et une invitation « en attente » (`/invites` ne le
 * sait pas encore). L'afficher deux fois dans le même écran poserait à l'hôte une
 * question sans réponse : laquelle des deux commande ? Le siège s'efface donc
 * devant l'adhésion — jamais l'inverse : `/members` est l'autorité sur qui
 * détient une clé. ENTRE LES DEUX GENRES DE SIÈGE, LA MÊME RÈGLE ET LE MÊME
 * SENS : l'invitation de coffre l'emporte sur l'intention, parce qu'elle est le
 * cran SUIVANT du même parcours — un scellé existe déjà, et c'est elle qui porte
 * le lien à retransmettre.
 *
 * ET ON NE CONCLUT PAS D'UN SILENCE. Un membre dont on n'a pas su résoudre
 * l'adresse (annuaire fermé aux invités, worker d'avant P2) n'écarte AUCUN
 * siège : « je ne connais pas son adresse » n'est pas « ce n'est pas elle ».
 * Effacer un siège sur cette base ferait disparaître de l'écran la seule ligne
 * qui porte le geste, exactement chez l'hôte qui n'a pas l'annuaire.
 */

import type { PendingInviteRow } from './inviteLifecycleModel';
import type { AccessJourney } from './accessJourneyModel';
import type { VaultMemberRow } from './vaultManagementModel';
import type { AssignableVaultRole } from '../../sharing/shareDialogModel';

/**
 * CE QUE LA LIGNE ATTEND, ET DONC QUELLE ROUTE CORRIGE SON RÔLE.
 *
 * `vaultInvite` — une invitation de COFFRE : K_vault est déjà scellée pour la
 * personne, il ne manque que son consentement. `PATCH /vaults/:id/invites/:id`.
 *
 * `accessIntent` — une INTENTION d'accès (0073) : rien n'est scellé, la personne
 * a été invitée dans l'ESPACE et l'accès au coffre suivra.
 * `PATCH /vaults/:id/pending-grants/:inviteId`.
 *
 * Le genre est PORTÉ par la ligne plutôt que deviné à l'affichage : les deux
 * identifiants se ressemblent (deux UUID), et envoyer l'un à la route de l'autre
 * rendrait un 404 que rien à l'écran n'expliquerait.
 */
export type PendingSeatKind = 'vaultInvite' | 'accessIntent';

/** Une place promise : ce que la liste des membres affiche d'une invitation. */
export interface PendingSeat {
  kind: PendingSeatKind;
  /** L'identifiant que portent le PATCH de rôle et la régénération du lien. */
  inviteId: string;
  email: string;
  /** Le rôle QUI SERA appliqué à l'acceptation — corrigible sur place. */
  role: AssignableVaultRole;
  /**
   * Le scellé date d'une époque révolue : le rôle reste corrigible (il n'est pas
   * scellé), mais AUCUN lien ne peut plus être régénéré pour cette invitation —
   * il pointerait vers une clé morte. Toujours faux sur une intention : il n'y a
   * pas de scellé du tout, donc pas d'époque à comparer.
   */
  staleEpoch: boolean;
  /**
   * Expire dans moins de 48 h — la même urgence que l'onglet Invitations, et
   * REPORTÉE de la ligne que la page a déjà classée, jamais recalculée.
   *
   * Toujours faux sur une intention, et c'est un refus délibéré : la trancher ici
   * demanderait un SECOND instant de référence, et deux verdicts « expire
   * bientôt » nés d'instants différents feraient clignoter la même personne d'une
   * section à l'autre. L'échéance, elle, est affichée telle que le serveur l'a
   * datée — un fait, pas une déduction.
   */
  urgent: boolean;
  /** L'échéance, quand le serveur l'a datée. Jamais un TTL deviné ici. */
  expiresAtMs: number | null;
  /**
   * L'invitation d'ESPACE n'a pas encore reçu de réponse. Vrai uniquement sur une
   * intention, et ce n'est pas cosmétique : la personne n'est PAS ENCORE dans
   * l'espace, alors qu'une intention mûre y est déjà et n'attend que son scellé.
   * Les deux appellent des mots opposés sous la même adresse.
   */
  awaitingSpaceReply: boolean;
}

/**
 * La forme canonique d'une adresse pour la COMPARER — jamais pour l'afficher.
 * Les adresses arrivent telles que l'hôte les a tapées, la casse comprise ;
 * comparer les octets bruts laisserait « Alice@ex.com » invitée à côté de
 * « alice@ex.com » membre, c'est-à-dire la personne en double.
 */
function fold(raw: string | undefined | null): string {
  return (raw ?? '').trim().toLowerCase();
}

/**
 * LES DEUX ENDROITS OÙ L'ADRESSE D'UN MEMBRE PEUT SE TROUVER, et pourquoi lire
 * un seul des deux ne suffit pas.
 *
 * `email` vient de la ligne de `/members` — un worker d'avant P2 ne l'envoie
 * pas ; `label` est ce que `buildMemberRows` a su résoudre, l'ANNUAIRE compris,
 * et c'est donc le seul champ renseigné dans le cas le plus courant. Ne
 * regarder que `email` laisserait une invitée fraîchement acceptée s'afficher
 * une deuxième fois, en attente, à côté de son adhésion.
 *
 * MAIS `label` RETOMBE SUR L'IDENTIFIANT quand rien n'a été résolu : c'est un
 * silence, pas une adresse. Le `@` est ce qui distingue les deux — sans lui, un
 * identifiant de compte entrerait dans l'ensemble des adresses connues, où il ne
 * peut au mieux rien faire, et au pire écarter un siège au hasard.
 */
function knownEmails(members: readonly VaultMemberRow[]): Set<string> {
  const connues = new Set<string>();
  for (const m of members) {
    for (const brut of [m.email, m.label]) {
      const e = fold(brut);
      if (e.includes('@')) connues.add(e);
    }
  }
  return connues;
}

export interface PendingSeatsInput {
  /** Les invitations vivantes, telles que la PAGE les a déjà groupées. */
  pending: readonly PendingInviteRow[];
  /**
   * Les accès en préparation, tels que la PAGE les a déjà situés
   * (`buildAccessJourneys`). La MÊME liste que celle de l'onglet Invitations,
   * jamais un second calcul : deux fusions par adresse rendraient deux vérités
   * sur qui en est où.
   */
  intents: readonly AccessJourney[];
  /** Le trombinoscope : l'autorité sur qui détient déjà une clé. */
  members: readonly VaultMemberRow[];
}

/**
 * Une fiche d'accès mérite-t-elle un siège corrigible ?
 *
 * TROIS CONDITIONS, ET CHACUNE FERME UN GESTE QUI ÉCHOUERAIT.
 *
 * `inviteId` — c'est la ligne `org_invitations` que le PATCH vise. Une fiche née
 * d'un blocage de balayage n'en porte pas (`accessJourneyModel` refuse d'en
 * inventer un) : sans lui, le menu de rôle n'aurait rien à envoyer, et son rôle
 * affiché serait un repli « lecteur » que personne n'a choisi.
 *
 * `!intentCanceled` — l'accès promis a été RETIRÉ. Le serveur borne son UPDATE à
 * `intent_status = 'pending'` et refuserait ; et il aurait raison, puisque plus
 * aucun accès à ce coffre n'arrivera au bout. Ce qui reste à faire pour cette
 * ligne — reprendre l'invitation d'espace qui occupe encore une place — n'est pas
 * un rang, et vit dans l'onglet Invitations.
 *
 * `currentStep !== null` — tous les crans sont franchis : la personne est entrée.
 * Sa ligne est celle du trombinoscope, et c'est là que son rôle se change.
 *
 * Une fonction plutôt qu'un filtre en ligne : c'est la règle qui décide si un
 * menu de rôle s'affiche, et elle doit pouvoir échouer dans un test.
 */
export function intentSeatable(j: AccessJourney): boolean {
  return j.inviteId !== null && !j.intentCanceled && j.currentStep !== null;
}

/**
 * Les sièges à montrer sous le trombinoscope, dans l'ordre où on les lit.
 *
 * L'ordre est celui du tableau par défaut (adresse croissante) : les deux listes
 * sont lues l'une après l'autre, et deux tris différents feraient chercher la
 * même personne à deux endroits selon qu'elle est entrée ou non. Les deux genres
 * de siège sont MÊLÉS dans ce tri, et c'est le point : l'hôte cherche une
 * personne, pas la moitié du produit dont elle relève.
 */
export function pendingSeats(input: PendingSeatsInput): PendingSeat[] {
  const déjàMembres = knownEmails(input.members);
  const vus = new Set<string>();
  const sièges: PendingSeat[] = [];

  for (const row of input.pending) {
    const clé = fold(row.email);
    // Une adresse illisible ne devient pas un siège anonyme : le geste porterait
    // un menu de rôle sans dire de qui, et l'onglet Invitations la montre déjà
    // avec tout son détail.
    if (clé === '' || déjàMembres.has(clé)) continue;
    // Deux invitations vivantes pour la même adresse (relance d'espace + coffre)
    // ne font qu'un siège : deux menus de rôle côte à côte pour une personne
    // laisseraient croire à deux accès distincts.
    if (vus.has(clé)) continue;
    vus.add(clé);
    sièges.push({
      kind: 'vaultInvite',
      inviteId: row.invite.id,
      email: row.email,
      role: row.role,
      staleEpoch: row.staleEpoch,
      urgent: row.urgent,
      expiresAtMs: row.atMs,
      awaitingSpaceReply: false,
    });
  }

  // LES INTENTIONS PASSENT EN SECOND, ET C'EST CET ORDRE QUI TRANCHE LES
  // DOUBLONS. Une même personne peut porter les deux (l'intention a été honorée,
  // son invitation de coffre est partie, la liste des intentions n'a pas encore
  // été relue) : l'invitation de coffre est le cran SUIVANT du même parcours, et
  // c'est elle qui porte le lien à retransmettre.
  for (const j of input.intents) {
    if (!intentSeatable(j)) continue;
    const clé = fold(j.email);
    if (clé === '' || déjàMembres.has(clé) || vus.has(clé)) continue;
    vus.add(clé);
    sièges.push({
      kind: 'accessIntent',
      // `intentSeatable` vient de garantir qu'il existe.
      inviteId: j.inviteId as string,
      email: j.email,
      role: j.role,
      // Rien n'est scellé : pas d'époque à comparer, donc jamais de lien de
      // coffre à réémettre depuis cette ligne.
      staleEpoch: false,
      urgent: false,
      expiresAtMs: j.spaceInviteExpiresAtMs,
      awaitingSpaceReply: j.awaitingSpaceReply,
    });
  }

  return sièges.sort((a, b) => a.email.localeCompare(b.email, undefined, { sensitivity: 'base' }));
}

/**
 * CE QUE CETTE LIGNE ATTEND, DIT À L'HÔTE — trois attentes, pas une.
 *
 * POURQUOI C'EST DANS LE MODÈLE ET PAS DANS LE JSX. C'est une DÉCISION, au même
 * titre que `rosterPlaceholderKey` : trois situations qui se ressemblent à
 * l'écran appellent trois conduites opposées de la part de l'hôte, et se tromper
 * de phrase, c'est l'envoyer relancer un e-mail là où il n'a qu'à comparer une
 * empreinte. Une décision de cette nature doit pouvoir ÉCHOUER dans un test.
 *
 *  · `vaultInvite` — K_vault est DÉJÀ scellée pour la personne. On attend son
 *    consentement, rien d'autre ; le geste utile est de lui retransmettre le
 *    lien.
 *
 *  · `accessIntent` + `awaitingSpaceReply` — elle n'est PAS ENCORE dans
 *    l'espace. Rien n'est scellé, rien ne peut l'être ; le geste utile est de
 *    relancer l'invitation d'ESPACE, et il vit dans l'onglet Invitations.
 *
 *  · `accessIntent` sans réponse en attente — elle est DANS l'espace, et il ne
 *    manque que le scellé. Le geste utile est la cérémonie d'empreinte, qui n'a
 *    rien à voir avec un e-mail.
 *
 * Dire « en attente » aux trois serait vrai et inutile : c'est exactement le
 * silence poli que toute cette page existe pour supprimer.
 */
export function seatBadgeKey(seat: Pick<PendingSeat, 'kind' | 'awaitingSpaceReply'>): string {
  if (seat.kind !== 'accessIntent') return 'teamVaults.settings.pendingSeats.badge';
  return seat.awaitingSpaceReply
    ? 'teamVaults.settings.pendingSeats.badgeSpaceInvited'
    : 'teamVaults.settings.pendingSeats.badgeToSeal';
}

export function seatHintKey(seat: Pick<PendingSeat, 'kind' | 'awaitingSpaceReply'>): string {
  if (seat.kind !== 'accessIntent') return 'teamVaults.settings.pendingSeats.badgeHint';
  return seat.awaitingSpaceReply
    ? 'teamVaults.settings.pendingSeats.badgeSpaceInvitedHint'
    : 'teamVaults.settings.pendingSeats.badgeToSealHint';
}

/**
 * CE QU'ON A LE DROIT DE PROPOSER POUR RETROUVER UN LIEN.
 *
 * `regenerate` : fabriquer un porteur neuf (l'ancien meurt à l'instant). C'est le
 * SEUL chemin honnête — le serveur ne garde qu'un condensat du lien, un lien
 * perdu ne se réaffiche pas.
 *
 * `reissueFirst` : une rotation de clé est passée. Le scellé de l'invitation est
 * daté d'une époque révolue, le serveur refusera la relance
 * (`invite_stale_epoch`), et un lien neuf pointerait de toute façon vers une clé
 * morte. Proposer le bouton quand même reviendrait à promettre un geste dont on
 * SAIT qu'il rapportera un refus — l'écran nomme le fait et le seul chemin qui
 * reste (révoquer, puis réinviter avec un scellé frais).
 *
 * `none` : CE SIÈGE N'A PAS DE LIEN DE COFFRE À RETROUVER. Une intention n'a
 * jamais émis de porteur de coffre — c'est l'invitation d'ESPACE qui circule, et
 * elle se relance depuis l'onglet Invitations, où le geste porte son vrai nom.
 * Offrir « Retrouver le lien » ici enverrait un identifiant d'`org_invitations`
 * à la route des invitations de coffre : un 404 que rien à l'écran n'expliquerait.
 *
 * Une fonction plutôt qu'un `? :` dans le JSX : c'est la seule règle de cet
 * écran qui décide d'après un fait du serveur, et elle doit pouvoir échouer dans
 * un test avant qu'on lui fasse confiance.
 */
export type SeatLinkOffer = 'regenerate' | 'reissueFirst' | 'none';

export function seatLinkOffer(
  seat: Pick<PendingSeat, 'staleEpoch'> & { kind?: PendingSeatKind }
): SeatLinkOffer {
  if (seat.kind === 'accessIntent') return 'none';
  return seat.staleEpoch ? 'reissueFirst' : 'regenerate';
}

export default pendingSeats;
