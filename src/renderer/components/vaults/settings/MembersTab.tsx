/**
 * MembersTab — qui peut déchiffrer ce coffre, et les trois gestes qui changent
 * cette réponse : le rôle, le transfert de propriété, le retrait.
 *
 * DÉPLACÉ, PAS RÉÉCRIT. Le contenu vient de `VaultMembersPanel`, le volet
 * latéral que cette page remplace : mêmes appels, mêmes gardes, mêmes messages
 * d'erreur. Trois choses seulement ont changé, et ce sont celles de la fiche :
 *   - la liste ne se charge plus ici (P3 : `useVaultManagement` la sert) ;
 *   - chaque geste réussi appelle `afterRosterChange()`, si bien qu'un
 *     changement de rôle ou un transfert réveille enfin les pastilles du rail
 *     et des cartes — `shareIndexSlice` n'écoutait que l'invitation, le retrait
 *     et le départ ;
 *   - l'état vide « Aucun membre » a disparu : il décrivait une situation
 *     impossible (un coffre a toujours son propriétaire) et s'affichait en
 *     réalité sur une panne de lecture. Une panne dit maintenant qu'elle en est
 *     une, et propose de réessayer.
 *
 * INVITER EST L'ACTION PRIMAIRE DE LA PAGE, ET ELLE EST À DEMEURE (F02). Le
 * bouton « Ajouter des personnes » ouvrait l'ancien `InviteMemberModal` — une
 * boîte par-dessus la page, avec deux boutons sans rapport et son propre code
 * pour le même geste. Elle a été supprimée : la ligne d'invitation est celle du
 * dialogue de partage (`sharing/InviteRow`), posée en tête de l'onglet. Un clic
 * de moins, et surtout un seul comportement à tenir juste.
 *
 * SEUL DANS LE COFFRE : LE TABLEAU CÈDE LA PLACE (F05). Quand on est le seul
 * membre, la table d'une ligne n'apprend rien — le rôle est dans l'en-tête de la
 * page, l'identité du propriétaire dans l'Aperçu — alors que la seule chose
 * utile à dire est ce qu'il faut faire ensuite. L'état vide la remplace donc, et
 * son bouton pose la main dans le champ juste au-dessus plutôt que de renvoyer
 * chercher. Il n'y a PAS d'état « aucun membre » : un coffre a toujours son
 * propriétaire, et cette phrase-là ne s'affichait jamais que sur une panne.
 *
 * « DANS L'ESPACE DE CE COFFRE, SANS ACCÈS » — LA SECTION QUI MANQUAIT. C'est
 * le défaut 3 du plan (§1) : cet état n'était visible NULLE PART, sinon comme
 * une ligne parmi d'autres dans le sélecteur « Person » de l'ancien modal —
 * supprimé avec lui. Résultat : un hôte dont l'espace compte une personne
 * active voit un coffre où il est seul, un champ vide qui attend une adresse,
 * et rien qui relie les deux (« je ne vois toujours pas matbel »). La section
 * nomme ces gens, dit lesquels ont déjà une invitation dehors, et son bouton
 * REMPLIT la ligne d'invitation au lieu de simplement la désigner. Elle se
 * place au-dessus du tableau, donc au-dessus de l'état vide « Vous êtes
 * seul » : c'est exactement là qu'on la cherche.
 *
 * ELLE NE DIT PAS « VOTRE ESPACE », ET CE N'EST PAS UN DÉTAIL DE STYLE.
 * L'annuaire vient de `GET /vaults/:id/directory` : c'est l'espace QUI POSSÈDE
 * LE COFFRE, et la route existe précisément pour qu'un administrateur de coffre
 * invité chez quelqu'un d'autre puisse le lire (P2). Pour cet hôte-là, « votre
 * espace » désignait l'espace d'un tiers comme étant le sien — c'est-à-dire
 * qu'il se trompait exactement sur le cas que la route a été écrite pour
 * servir. Le titre nomme donc le coffre, pas le lecteur.
 *
 * ELLE NE S'AFFICHE QUE SUR UN ANNUAIRE LU. `directory.state !== 'ok'` rend une
 * liste vide, et une section vide se lirait « il n'y a personne dans votre
 * espace » — l'affirmation que P2 s'est employé à faire disparaître. La ligne
 * d'invitation dit déjà, juste au-dessus, qu'on n'a pas su lire.
 *
 * DEUX AJOUTS, ET ILS PARLENT DE CLÉS PLUTÔT QUE DE DROITS.
 *
 * F08 — « HORS DE L'ESPACE, MAIS TOUJOURS LA CLÉ ». Retirer quelqu'un d'un
 * ESPACE ne fait pas tourner les clés de ses coffres (P3) : son scellé reste
 * valide. Le serveur lui refuse ses requêtes, mais ce qu'elle a déjà téléchargé
 * reste lisible, et une ré-admission lui rouvrirait tout sans nouvelle
 * vérification. Le bandeau dit exactement ça — pas « accès révoqué », qui serait
 * faux — et son bouton nomme le seul geste qui ferme vraiment la porte : le
 * retrait DU COFFRE, qui fait tourner K_vault. La liste vient d'un modèle pur
 * qui REFUSE de conclure sur un silence : `inSpace` absent (worker d'avant P2)
 * vaut « on ne sait pas », jamais « hors ».
 *
 * ET LE BOUTON LES EMPORTE TOUS D'UN COUP, parce qu'un retrait par personne est
 * un cul-de-sac dès qu'il y en a deux : la rotation rescelle la clé neuve à
 * chaque RESTANT, et `GET /account/public-key/:userId` refuse (403
 * `org_forbidden`) exactement les gens que ce bandeau désigne. Retirer A
 * s'arrêterait sur B, retirer B sur A. `removeTogether` n'existe donc que s'il
 * ne laisse personne derrière ; sinon le bandeau dit pourquoi il ne propose rien
 * plutôt que d'offrir un geste qui échouera.
 *
 * LE BANDEAU EST RÉSERVÉ À QUI GÈRE LE COFFRE, comme la ligne « À traiter » de
 * l'Aperçu (`buildTodoRows` rend `[]` sans le droit). Un lecteur lisait sinon
 * une alerte rouge, un paragraphe inquiétant et « Ne peut pas être retirée
 * d'ici » sur chaque ligne — deux lectures du même fait, dont une inutilisable.
 * Le FAIT, lui, ne disparaît pour personne : la pastille « Hors de l'espace »
 * reste sur la ligne du tableau, pour tous les rôles.
 *
 * F15 — LA CARTE « VOUS ». La cérémonie du numéro de sécurité est symétrique :
 * l'hôte lit l'empreinte de son invité dans la ligne d'invitation, et l'invité
 * n'avait nulle part où lire la sienne. Elle est donc rendue pour TOUS les
 * rôles, lecteurs compris.
 *
 * F09 — CHERCHER, FILTRER, TRIER, ET AGIR SUR PLUSIEURS LIGNES. Passé une
 * dizaine de personnes, la seule façon de retrouver quelqu'un était de lire tout
 * le tableau ; et le seul geste de masse possible était de répéter le même clic,
 * ce qui, pour un retrait, veut dire une ROTATION DE CLÉ PAR PERSONNE. La barre
 * au-dessus du tableau et la barre flottante en bas ferment les deux : un seul
 * appel de rotation pour tout un lot, et une sélection que le modèle nettoie
 * (jamais le propriétaire, jamais soi-même, jamais une ligne qu'un filtre
 * cache). Tout ce qui se raisonne est dans `memberRosterModel`, éprouvé.
 *
 * F11 — LA COLONNE « CONFIANCE », et ce qu'elle répare. Le serveur est un
 * COURTIER de clés publiques : jusqu'ici, la clé d'un pair n'était confrontée à
 * son journal qu'au moment de lui sceller quelque chose. Une substitution
 * restait donc invisible jusqu'au prochain partage — peut-être jamais. La page
 * regarde maintenant d'elle-même à l'ouverture (`useMemberKeyWatch`, par pages
 * de vingt, cache de 24 h), la colonne dit ce qu'elle a trouvé, et un clic ouvre
 * le numéro de sécurité avec le seul geste qui vaut : « j'ai comparé ce
 * numéro », qui appelle la MÊME primitive que l'invitation.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Avatar, Button, ConfirmModal, EmptyState, Input, Modal, Select } from '../../ui';
import { useNotification } from '../../ui/Notification';
import { Table, Column } from '../../ui/Table/Table';
import {
  AdminSection,
  CopyableId,
  InfoCallout,
  RelativeTime,
  StatusBadge,
} from '../../settings/enterprise/AdminPrimitives';
import { vaultErrorKey, errorText } from '../../../../services/vault/vaultErrorMessages';
import type { AppDispatch, RootState } from '../../../../store';
import { loadVaults, selectVaultById } from '../../../../store/slices/vaultsSlice';
import { selectSharedVaultOrgId } from '../../../../store/selectors/authSelectors';
import {
  apiSetVaultMemberRole,
  apiTransferVaultOwnership,
} from '../../../../services/vault/vaultApi';
import { InviteRow, vaultRoleOptions, type InviteRowHandle } from '../../sharing/InviteRow';
import { useRemoveVaultMember } from '../useRemoveVaultMember';
import { VAULT_ROLE_TONE } from './vaultRoleTone';
import { CANDIDATE_SECTION_LIMIT, spaceCandidates } from './spaceCandidatesModel';
import { orphanedMembers } from './orphanedMembers';
import { MySecurityCard } from './MySecurityCard';
import { MemberCardList } from './MemberCardList';
import { MemberSelectionBar } from './MemberSelectionBar';
import { MemberTrustModal, TRUST_TONE } from './MemberTrustModal';
import {
  DEFAULT_ROSTER_SORT,
  ROSTER_FILTERS,
  applySelectionChange,
  isSelectable,
  rosterPlaceholderKey,
  rosterView,
  selectedRows,
  visibleSelection,
  type RosterFilterId,
  type RosterSort,
  type RosterSortKey,
} from './memberRosterModel';
import { PendingSeatsSection } from './PendingSeatsSection';
import { pendingSeats } from './pendingSeatsModel';
import { usePendingInviteActions } from './usePendingInviteActions';
import { VaultGrantsSection } from './VaultGrantsSection';
import type { PendingInviteRow } from './inviteLifecycleModel';
import type { AccessJourney } from './accessJourneyModel';
import type { VaultGrants } from './useVaultGrants';
import type { MemberKeyWatch } from './useMemberKeyWatch';
import type { VaultMemberRow } from './vaultManagementModel';
import type { VaultManagement } from './useVaultManagement';
import type { VaultSettingsEmptyStates } from './vaultSettingsEmptyStates';
import type { LayoutBreakpoint } from '../../../styles/breakpoints';

interface Props {
  vaultId: string;
  /** L'époque courante du coffre — la carte « Vous » dit ce qu'elle sait ouvrir. */
  currentKeyEpoch: number;
  mgmt: VaultManagement;
  /**
   * LES INVITÉES EN ATTENTE, groupées UNE FOIS par la page — la même liste que
   * l'onglet Invitations, jamais un second groupement.
   *
   * Cet onglet les affiche parce que c'est ICI qu'on vient corriger un rôle :
   * une personne invitée n'apparaissait nulle part dans la liste des membres, si
   * bien que son rôle n'était modifiable qu'à un endroit où on ne le cherche
   * pas. Deux `groupInvites` (un par onglet) rendraient deux verdicts « expire
   * bientôt » d'instants différents pour la même ligne.
   */
  pendingInvites: readonly PendingInviteRow[];
  /**
   * LES ACCÈS EN PRÉPARATION, situés UNE FOIS par la page (`buildAccessJourneys`)
   * — la même liste que l'onglet Invitations, jamais un second calcul.
   *
   * ILS SONT ICI PARCE QUE L'HÔTE N'A FAIT QU'UN GESTE (défaut du 31/08).
   * Inviter quelqu'un depuis le coffre produit une invitation de COFFRE si la
   * personne est déjà dans l'espace, et une INTENTION d'accès (0073) sinon.
   * L'essai réel est tombé sur le second cas : `vault_invites` VIDE, et Membres
   * muet — le rôle promis n'était corrigible nulle part. La distinction est
   * interne, elle ne regarde pas l'hôte : les deux genres s'affichent donc dans
   * la même section, avec le même menu.
   */
  journeys: readonly AccessJourney[];
  /**
   * Le détail d'une invitation — frise des relances, révocation, échues — et
   * celui d'un accès en préparation — la fiche en cinq crans, le renvoi de
   * l'invitation d'espace, l'annulation de l'accès promis — restent à l'onglet
   * Invitations : la section renvoie, elle ne recopie pas.
   */
  onGoToInvitations?: () => void;
  /**
   * Les verdicts « contenu / vide / erreur », décidés UNE fois par la page :
   * l'Aperçu et cet onglet doivent compter la même chose, et deux calculs
   * finiraient par diverger (même raison que `groups` et `journeys`).
   */
  states: VaultSettingsEmptyStates;
  /**
   * Poser la main dans le champ d'invitation dès l'arrivée — l'onglet
   * Invitations envoie ici depuis son propre état vide, et un bouton qui change
   * seulement d'écran laisse le geste à moitié fait.
   */
  autoFocusInvite?: boolean;
  /**
   * Le contrôle des clés (F11), tenu par la PAGE et non par cet onglet : le
   * bandeau rouge de l'en-tête et cette colonne doivent nommer les mêmes gens,
   * et deux contrôles indépendants, c'est deux fois les lectures et deux
   * verdicts qui finissent par diverger.
   */
  trust: MemberKeyWatch;
  /**
   * Les accès ponctuels (F17), lus par la PAGE pour la même raison que les
   * statistiques : cet onglet est démonté à chaque clic de la barre, et un
   * chargeur posé ici referait un `GET /:id/grants` à chaque retour.
   */
  grants: VaultGrants;
  /** Les titres déchiffrés par la page — la section les affiche, elle ne les lit pas. */
  nameByItemId: ReadonlyMap<string, string>;
  /**
   * Les éléments dont la page a RÉELLEMENT lu la liste, ET EN ENTIER. `null` =
   * pas lue, ou lue à trous : aucun accès n'est alors déclaré orphelin (règle
   * « pas de verdict sur un silence »).
   */
  knownItemIds: ReadonlySet<string> | null;
  /**
   * F28 — LA BANDE DE LA PAGE, mesurée par elle sur son CONTENEUR (jamais sur la
   * fenêtre). En `compact`, le tableau n'est PAS MONTÉ : six colonnes de largeur
   * fixe réclament près de 800 px à elles seules et pousseraient le corps
   * horizontalement, en emportant les onglets et l'en-tête. Les cartes rendent
   * exactement les mêmes gestes (`MemberCardList`).
   */
  band: LayoutBreakpoint;
}

const MembersIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

/**
 * Le même dessin, mais DIMENSIONNÉ. `MembersIcon` vit dans l'en-tête d'une
 * `AdminSection`, dont la CSS lui donne sa taille ; posé nu dans un état vide,
 * un SVG sans `width`/`height` se replie sur la taille par défaut d'un élément
 * remplacé et occupe une bande de trois cents pixels.
 */
const MembersGlyph = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

/**
 * La silhouette avec un « + » — la section des candidats, pour qu'elle ne se
 * confonde pas d'un coup d'œil avec le trombinoscope juste en dessous, qui porte
 * déjà le groupe.
 */
const AddPersonIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M19 8v6M22 11h-6" />
  </svg>
);

/**
 * À partir de combien de lignes la barre de recherche apparaît. En dessous, le
 * tableau se lit d'un coup d'œil et deux contrôles de plus ne feraient
 * qu'encombrer — c'est le même raisonnement que le plafond de la section des
 * candidats.
 *
 * SAUF QUAND UNE CLÉ A CHANGÉ. Le filtre « Clé changée » est le seul moyen
 * d'isoler les gens que le bandeau rouge désigne, et un coffre de cinq
 * personnes n'y avait pas droit : le seuil cachait la barre, donc le filtre,
 * donc le geste. Un contrôle en trop se justifie très bien le jour où il y a
 * une alerte à trier.
 */
const ROSTER_TOOLBAR_FROM = 6;

export const MembersTab: React.FC<Props> = ({
  vaultId,
  currentKeyEpoch,
  mgmt,
  pendingInvites,
  journeys,
  onGoToInvitations,
  states,
  autoFocusInvite,
  trust,
  grants,
  nameByItemId,
  knownItemIds,
  band,
}) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const [toPromote, setToPromote] = useState<VaultMemberRow | null>(null);
  const [ownBusy, setBusy] = useState(false);

  /**
   * L'ÉCRAN EST-IL ENCORE LÀ ? Un lot de dix changements de rôle est SÉQUENTIEL :
   * il tient plusieurs secondes, et rien n'empêche de quitter la page pendant ce
   * temps-là. Ses `setState` de fin (la progression, `busy`) tomberaient alors
   * sur un composant démonté. C'est le garde du hook voisin
   * (`useRemoveVaultMember`), pour exactement la même raison.
   *
   * `afterRosterChange()`, lui, reste appelé DANS TOUS LES CAS : il ne touche pas
   * à cet écran, il réveille les pastilles du rail et des cartes — un lot qui
   * aboutit après qu'on a quitté la page a quand même changé l'effectif.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * La ligne d'invitation, atteignable par sa POIGNÉE — pas par un sélecteur
   * DOM : l'état vide ci-dessous et l'arrivée depuis l'onglet Invitations y
   * posent tous deux le focus, et un `querySelector('input[type=email]')` se
   * tairait le jour où un autre champ e-mail apparaît sur la page.
   */
  const inviteRef = useRef<InviteRowHandle>(null);
  useEffect(() => {
    if (autoFocusInvite) inviteRef.current?.focus();
  }, [autoFocusInvite]);

  /**
   * L'espace DU COFFRE, pas le mien : un administrateur de coffre peut être
   * l'invité de l'espace de quelqu'un d'autre, et c'est LÀ qu'un nouveau venu
   * doit entrer. Viser le mien inviterait la personne au mauvais endroit, puis
   * échouerait à lui donner accès.
   */
  const vaultOrgId = useSelector(
    (s: RootState) => selectVaultById(s, vaultId)?.organizationId ?? null
  );
  const mySpaceOrgId = useSelector(selectSharedVaultOrgId);
  const orgId = vaultOrgId ?? mySpaceOrgId;

  /**
   * Les gens de l'espace qui n'ont pas accès. Plafonnée BEAUCOUP plus haut que
   * la liste déroulante du champ (vingt-cinq contre huit) : la section répond à
   * « qui n'a pas accès ? », et la rabattre au même chiffre rendrait les deux
   * surfaces redondantes. Elle a un plafond quand même — « l'annuaire est borné
   * par ses sièges » vaut d'un espace personnel partagé, pas d'un espace
   * d'entreprise à plusieurs centaines de sièges, où la section rendrait autant
   * de lignes d'un coup. Ce qui dépasse est DIT, avec le geste qui y mène.
   */
  const candidates = useMemo(
    () =>
      spaceCandidates({
        directory: mgmt.directory.state === 'ok' ? mgmt.directory.entries : [],
        members: mgmt.members,
        invites: mgmt.invites,
        myUserId: mgmt.myUserId,
        limit: CANDIDATE_SECTION_LIMIT,
      }),
    [mgmt.directory.state, mgmt.directory.entries, mgmt.members, mgmt.invites, mgmt.myUserId]
  );

  /**
   * « Voir la ligne » : la personne tapée a déjà accès, sa ligne est dans le
   * tableau juste en dessous — on l'y amène et on la surligne, plutôt que de
   * laisser chercher dans une liste qui peut compter vingt-cinq noms.
   */
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (highlighted) highlightRef.current?.scrollIntoView({ block: 'center' });
  }, [highlighted, mgmt.rows]);

  /**
   * Le retrait (donc la rotation de la clé), avec sa réserve et son arrêt sur
   * empreinte changée : le hook partagé avec le dialogue de partage. Ses deux
   * ConfirmModals sont rendues UNE fois, en bas.
   */
  const removal = useRemoveVaultMember(vaultId, {
    displayName: mgmt.display,
    // Ce que l'écran sait et que le hook ne peut pas deviner : un
    // `member_no_key` visant quelqu'un de sorti de l'espace n'est pas une clé
    // « pas encore configurée », c'est le serveur qui refuse de la servir.
    isOutOfSpace: (userId) => mgmt.rows.some((r) => r.userId === userId && r.inSpace === false),
    onRemoved: async () => {
      await mgmt.reload();
      mgmt.afterRosterChange();
    },
  });
  const busy = ownBusy || removal.busy;

  /**
   * F08 — CEUX QUI DÉTIENNENT ENCORE LA CLÉ SANS ÊTRE DANS L'ESPACE. Le verdict
   * vient du modèle, qui refuse de le déduire d'un silence : `inSpace` absent
   * (worker d'avant P2) vaut « on ne sait pas », jamais « hors ». Le geste
   * proposé fait TOURNER la clé du coffre — le déclencher sur une absence
   * d'information serait le pire coût possible de « terminal ≠ jetable ».
   */
  const orphans = useMemo(() => orphanedMembers(mgmt.rows), [mgmt.rows]);

  /**
   * Relire la page ET réveiller les agrégats partagés, après TOUT geste — la
   * règle de `useVaultManagement`, et l'unique invalidation de l'écran.
   * Mémoïsé sur les deux rappels du chargeur (stables) : recréée à chaque rendu,
   * elle ferait changer d'identité les fonctions du hook d'invitation à chaque
   * frappe dans le champ de recherche.
   */
  const { reload, afterRosterChange } = mgmt;
  const afterInviteChange = useCallback(async () => {
    await reload();
    afterRosterChange();
  }, [reload, afterRosterChange]);

  /**
   * LES DEUX GESTES D'UNE INVITATION EN ATTENTE, partagés avec l'onglet
   * Invitations : corriger le rôle (aucune clé touchée) et régénérer le lien
   * (l'ancien meurt à l'instant — c'est le hook qui porte cette vérité).
   */
  const inviteActions = usePendingInviteActions(vaultId, {
    onDone: afterInviteChange,
    lang: i18n.language,
  });

  /**
   * Les places promises, à côté du trombinoscope. Le modèle efface un siège dont
   * l'adresse est DÉJÀ celle d'un membre : entre l'acceptation et la relecture
   * des listes, la même personne est un membre pour `/members` et une invitation
   * vivante pour `/invites`, et l'afficher deux fois poserait une question sans
   * réponse — laquelle des deux commande ?
   */
  const seats = useMemo(
    () => pendingSeats({ pending: pendingInvites, intents: journeys, members: mgmt.rows }),
    [pendingInvites, journeys, mgmt.rows]
  );

  /**
   * F09 — CE QUE LA BARRE AU-DESSUS DU TABLEAU DÉCIDE. Rien n'est calculé ici :
   * `rosterView` filtre, trie, et dit lesquelles de ses lignes une case à cocher
   * peut atteindre. Le filtre « Clé changée » est alimenté par le contrôle des
   * clés de F11 — c'est le seul endroit du tableau où les deux fiches se
   * touchent.
   */
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RosterFilterId>('all');
  const [sort, setSort] = useState<RosterSort>(DEFAULT_ROSTER_SORT);
  const view = useMemo(
    () =>
      rosterView({
        rows: mgmt.rows,
        query: { search, filter, sort },
        keyChanged: trust.keyChanged,
      }),
    [mgmt.rows, search, filter, sort, trust.keyChanged]
  );

  /**
   * CE QU'ON DIT QUAND IL N'Y A AUCUNE LIGNE — une seule fois, pour les DEUX
   * surfaces.
   *
   * La table portait ses replis, la bande compacte n'en portait aucun : un
   * chargement en cours, un filtre stérile et un coffre où l'on est seul y
   * donnaient tous les trois la même surface blanche. La phrase est choisie par
   * le modèle (`rosterPlaceholderKey`, éprouvé à part) et passée telle quelle
   * aux deux branches — pas deux `if` jumeaux qui divergeront.
   *
   * `rosterLoading` reste distinct parce que la `Table` sait faire son propre
   * squelette : elle n'affichera pas `emptyMessage` pendant ce temps-là, et
   * l'avoir déjà traduit ne coûte rien.
   */
  const rosterLoading = mgmt.loading && mgmt.rows.length === 0;
  const rosterEmpty = t(rosterPlaceholderKey({ loading: rosterLoading, filtered: view.filtered }));

  /**
   * La sélection SURVIT au filtre (revenir en arrière retrouve ses cases), mais
   * un geste ne porte que sur l'intersection avec ce qui est à l'écran :
   * `visibleSelection` est appliqué à l'ENTRÉE comme à la SORTIE, si bien que le
   * compte de la barre flottante et ce que le geste emporte sont, par
   * construction, la même chose.
   */
  const [selected, setSelected] = useState<string[]>([]);
  const visible = useMemo(() => visibleSelection(selected, view), [selected, view]);
  const picked = useMemo(() => selectedRows(selected, view), [selected, view]);

  /** Le lot de changements de rôle en vol : sa boîte, son rôle, sa progression. */
  const [roleLot, setRoleLot] = useState(false);
  const [lotRole, setLotRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [lotProgress, setLotProgress] = useState<{ done: number; total: number } | null>(null);

  /** La personne dont on regarde le numéro de sécurité (F11). */
  const [trustFor, setTrustFor] = useState<string | null>(null);
  const trustRow = useMemo(
    () => mgmt.rows.find((r) => r.userId === trustFor) ?? null,
    [mgmt.rows, trustFor]
  );

  /**
   * CHANGER LE RÔLE DE PLUSIEURS PERSONNES : N appels, SÉQUENTIELS, puis UN seul
   * rechargement.
   *
   * Séquentiels parce que la route est une écriture par membre et qu'un lot
   * parallèle rendrait un échec au milieu illisible (« lesquels sont passés ? »).
   * Un seul `reload()` parce que dix rechargements pour dix lignes, c'est dix
   * fois la même lecture — et neuf états intermédiaires affichés à l'écran.
   *
   * UN ÉCHEC N'EFFACE PAS CE QUI A ABOUTI : le message dit combien sont passés
   * avant, et la liste rechargée montre la vérité. Taire le compte ferait
   * recommencer un lot déjà à moitié appliqué.
   */
  const applyRoleLot = async () => {
    const cibles = picked;
    setRoleLot(false);
    if (cibles.length === 0) return;
    setBusy(true);
    setLotProgress({ done: 0, total: cibles.length });
    let faits = 0;
    try {
      for (const m of cibles) {
        if (m.role !== lotRole) await apiSetVaultMemberRole(vaultId, m.userId, lotRole);
        faits += 1;
        if (mountedRef.current) setLotProgress({ done: faits, total: cibles.length });
      }
      success(t('teamVaults.settings.bulk.roleDone', { count: faits }));
      if (mountedRef.current) setSelected([]);
    } catch (e) {
      error(
        t('teamVaults.settings.bulk.rolePartial', {
          done: faits,
          total: cibles.length,
          error: t(vaultErrorKey(errorText(e), 'teamVaults.errors.roleChangeFailed')),
        })
      );
    } finally {
      if (mountedRef.current) {
        setLotProgress(null);
        setBusy(false);
        // Le rechargement a lieu même après un échec : c'est lui qui dit ce qui
        // est VRAIMENT passé, plutôt que ce que l'écran croyait. Il n'a plus de
        // destinataire si la page est partie — les pastilles, elles, si.
        await mgmt.reload();
      }
      mgmt.afterRosterChange();
    }
  };

  /**
   * Changer le rôle d'un membre, sans lui coûter son historique. Le seul
   * contournement d'avant était de le retirer puis de le réinviter — or un
   * retrait fait TOURNER la clé, si bien qu'il revenait sans pouvoir lire une
   * ligne de ce qui existait avant. Rien n'est re-chiffré ici : le rôle décide
   * de ce qu'on a le droit de faire, pas de ce qu'on peut lire.
   */
  const changeRole = async (m: VaultMemberRow, role: 'admin' | 'member' | 'viewer') => {
    if (role === m.role) return;
    setBusy(true);
    try {
      await apiSetVaultMemberRole(vaultId, m.userId, role);
      success(t('teamVaults.members.roleChanged'));
      if (mountedRef.current) await mgmt.reload();
      mgmt.afterRosterChange();
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.roleChangeFailed')));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  /**
   * Transmettre la propriété. Rien n'est re-chiffré : le destinataire est déjà
   * membre, il détient déjà sa copie scellée de la clé. On recharge les coffres
   * parce que NOTRE rôle change aussi — on devient administrateur, et l'onglet
   * Danger doit perdre sa zone de suppression dans la foulée.
   */
  const confirmTransfer = async () => {
    const target = toPromote;
    setToPromote(null);
    if (!target) return;
    setBusy(true);
    try {
      await apiTransferVaultOwnership(vaultId, target.userId);
      success(t('teamVaults.members.transferred'));
      // Les coffres se relisent quoi qu'il arrive : NOTRE rôle vient de changer,
      // et l'onglet Danger doit perdre sa zone de suppression même si on est
      // déjà ailleurs dans l'application.
      await dispatch(loadVaults());
      if (mountedRef.current) await mgmt.reload();
      mgmt.afterRosterChange();
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.transferFailed')));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const columns: Column<VaultMemberRow>[] = [
    {
      key: 'member',
      header: t('teamVaults.members.col.member', 'Member'),
      // Trié PAR LE MODÈLE, pas par la `Table` : son tri interne compare des
      // `String(ReactNode)`, ce qui, sur une cellule faite d'un avatar et de
      // deux badges, ne classe rien. On lui passe donc `sortBy`/`onSort`, ce qui
      // la met en mode contrôlé et lui fait rendre les lignes telles quelles.
      sortable: true,
      accessor: (m) => (
        <span
          className={`flex items-center gap-2 min-w-0 rounded-md ${
            m.userId === highlighted ? 'ring-1 ring-[var(--color-primary-500)] px-1.5 py-0.5' : ''
          }`}
          ref={m.userId === highlighted ? highlightRef : undefined}
        >
          {/* La pastille prend l'IDENTIFIANT pour graine : une adresse qui se
              met à être résolue (l'annuaire arrive une frame plus tard) ne doit
              pas faire sauter la couleur de la ligne. */}
          <Avatar label={m.label} seed={m.userId} size="sm" title={null} />
          <span className="truncate" style={{ color: 'var(--color-text-primary)' }}>
            {m.label}
            {m.isSelf && (
              <span className="ent-hint" style={{ marginLeft: 6 }}>
                ({t('teamVaults.members.you')})
              </span>
            )}
          </span>
          {/* « Hors de l'espace » n'est affirmé que si le serveur l'a dit :
              `inSpace` absent (vieux Worker) n'est pas « non ». */}
          {m.inSpace === false && (
            <StatusBadge tone="warning" title={t('teamVaults.settings.members.outOfSpaceHint')}>
              {t('teamVaults.settings.members.outOfSpace')}
            </StatusBadge>
          )}
        </span>
      ),
    },
    {
      key: 'role',
      header: t('teamVaults.members.col.role', 'Role'),
      width: '150px',
      sortable: true,
      accessor: (m) =>
        m.canChangeRole ? (
          <Select
            value={m.role}
            // `ariaLabel`, pas `aria-label` : ce Select n'est pas un élément du
            // DOM, il ne relaie que la propriété qu'il déclare.
            ariaLabel={t('teamVaults.members.roleFor', { name: m.label })}
            disabled={busy}
            onChange={(v) =>
              void changeRole(m, (Array.isArray(v) ? v[0] : v) as 'admin' | 'member' | 'viewer')
            }
            // Le MÊME ordre et les mêmes clés que la ligne d'invitation : un
            // menu qui se réordonne selon la porte par laquelle on est entré
            // retourne le geste qu'on vient d'apprendre à l'autre endroit.
            options={vaultRoleOptions(t)}
          />
        ) : (
          <StatusBadge tone={VAULT_ROLE_TONE[m.role] ?? 'neutral'}>
            {t(`teamVaults.role.${m.role}`, m.role)}
          </StatusBadge>
        ),
    },
    /**
     * F11 — LA CONFIANCE. Le badge est un BOUTON, et c'est le point : un verdict
     * seul ne se vérifie contre rien, c'est le NUMÉRO qu'on lit à voix haute, et
     * il est de l'autre côté du clic.
     *
     * La colonne est retirée (voir plus bas) pour qui ne gère pas le coffre : le
     * contrôle n'est alors pas lancé du tout (§2.4), et une colonne de tirets
     * ferait croire à une information manquante plutôt qu'à une information
     * qu'on n'a pas demandée.
     */
    {
      key: 'trust',
      header: t('teamVaults.members.col.trust'),
      width: '150px',
      accessor: (m) => {
        const v = trust.verdicts[m.userId];
        // Pas encore de verdict pour cette ligne (le contrôle avance par pages
        // de vingt) : on ne met RIEN plutôt qu'un « inconnu » qui se lirait
        // comme un résultat.
        if (!v) return <span className="ent-hint">—</span>;
        return (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('teamVaults.settings.trust.open', { name: m.label })}
            onClick={() => setTrustFor(m.userId)}
          >
            <StatusBadge tone={TRUST_TONE[v.state]} dot>
              {t(`teamVaults.settings.trust.state.${v.state}`)}
            </StatusBadge>
          </Button>
        );
      },
    },
    {
      key: 'joined',
      header: t('teamVaults.members.col.joined', 'Joined'),
      width: '130px',
      sortable: true,
      accessor: (m) => {
        const ms = Date.parse(m.joinedAt);
        return Number.isNaN(ms) ? <span className="ent-hint">—</span> : <RelativeTime ms={ms} />;
      },
    },
    {
      key: 'userId',
      header: t('teamVaults.members.col.userId', 'User ID'),
      width: '150px',
      accessor: (m) => <CopyableId value={m.userId} />,
    },
    {
      /**
       * 240 ET PAS 210, PARCE QUE 210 NE SUFFISAIT PAS — et que personne ne
       * pouvait s'en apercevoir.
       *
       * La largeur déclarée n'était pas appliquée du tout (`flex: 1` la rendait
       * inerte, voir `cellStyle`) : le chiffre écrit ici n'a jamais été confronté
       * au contenu réel. Une fois la largeur rendue effective, l'addition se
       * vérifie : « Transmettre » et « Retirer » (les libellés FRANÇAIS, les plus
       * longs des deux langues) valent ~190 px avec leurs marges intérieures et
       * l'espace entre eux, plus les 24 px de marge de la cellule en taille `sm`
       * — soit ~214 px. À 210, la cellule aurait recoupé les boutons, exactement
       * le défaut qu'on ferme, et l'`overflow: hidden` l'aurait fait en silence.
       */
      key: 'actions',
      header: '',
      width: '240px',
      align: 'right',
      accessor: (m) => (
        <div className="flex items-center justify-end gap-1.5">
          {m.transferable && (
            <Button variant="ghost" size="sm" onClick={() => setToPromote(m)} disabled={busy}>
              {t('teamVaults.members.transfer')}
            </Button>
          )}
          {m.removable && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => removal.requestRemove(m)}
              disabled={busy}
            >
              {t('teamVaults.members.remove')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  /**
   * CE QUE LE TABLEAU MONTRE VRAIMENT — deux retraits, et deux raisons qui n'ont
   * rien à voir.
   *
   * « CONFIANCE » ne s'affiche que pour qui gère le coffre : c'est là que le
   * contrôle des clés tourne (voir `VaultSettingsView`). RETIRÉE, pas vide : une
   * colonne de tirets se lirait comme une panne.
   *
   * « IDENTIFIANT » NE SURVIT QU'EN BANDE LARGE, et c'est l'autre moitié du
   * défaut « Transmettre rogné ». Une fois les largeurs déclarées rendues réelles
   * (`cellStyle`), l'addition se pose enfin : 48 px de case à cocher + 150 (rôle)
   * + 150 (confiance) + 130 (arrivée) + 150 (identifiant) + 240 (actions) = 868,
   * avant même la colonne « Membre » et son plancher de 120. La bande MOYENNE
   * commence à 840 : la carte se serait mise à défiler horizontalement d'un bout
   * à l'autre de la bande, pour montrer un identifiant opaque. Sans lui,
   * l'addition retombe à 718 + 120 = 838, et la bande tient d'un pixel.
   *
   * C'EST DONC LUI QU'ON RETIRE, ET PAS UN AUTRE. Il ne porte aucun geste, ne se
   * trie pas, et n'apprend rien qu'on lise — c'est une chaîne à COPIER, pour un
   * signalement ou une commande. Les cartes de la bande compacte ne l'affichent
   * déjà pas : cette règle prolonge la leur d'un cran, au lieu d'inventer un
   * troisième comportement. Toutes les autres colonnes portent un geste (le menu
   * de rôle, le badge de confiance, les deux boutons) ou répondent à une question
   * qu'on se pose vraiment (« depuis quand est-elle là ? »).
   */
  const shownColumns = columns.filter(
    (c) => (c.key !== 'trust' || mgmt.canManage) && (c.key !== 'userId' || band === 'wide')
  );

  return (
    <div className="space-y-4">
      {/* F08 — LE SEUL BANDEAU QUI PARLE D'UN ACCÈS EN COURS, donc le premier.
          Il passe AVANT la ligne d'invitation et avant la carte « Vous » (le
          plan §2.4 les énumère dans l'autre ordre, mais c'est une liste de
          contenus, pas une mise en page) : les voisins de ce dossier posent
          leurs callouts de danger tout en haut — l'Aperçu fait exactement ça
          avec l'époque en retard et la panne de lecture — et un `role="alert"`
          enterré sous deux cartes n'alerte personne.

          LE TEXTE NE PROMET RIEN QU'IL NE TIENNE. « Accès révoqué » serait faux :
          la personne détient toujours un scellé valide de K_vault. Ce qui est
          vrai, c'est que le serveur lui refuse ses requêtes (son appartenance à
          l'espace n'est plus active), que ce qu'elle a déjà téléchargé reste
          lisible, et qu'une ré-admission dans l'espace lui rouvrirait tout sans
          nouvelle vérification. Le seul geste qui ferme vraiment la porte est le
          retrait DU COFFRE, parce que lui fait tourner la clé — c'est le bouton,
          et il porte son vrai nom. */}
      {mgmt.canManage && orphans.count > 0 && (
        <div>
          <InfoCallout tone="danger">
            {/* `role="alert"` sur le SEUL titre, pas sur le bandeau entier : une
                région live assertive qui contient une liste et un bouton
                « Retirer » fait relire tout le bloc à chaque changement et met
                un contrôle focalisable dans une annonce. La phrase suffit à
                dire le fait ; le geste, lui, se trouve en naviguant. */}
            <p className="text-sm font-medium m-0" role="alert">
              {t('teamVaults.settings.outOfSpace.title', { count: orphans.count })}
            </p>
            <p className="text-xs m-0 mt-1">{t('teamVaults.settings.outOfSpace.body')}</p>
            <ul className="list-none m-0 mt-2 p-0 flex flex-col gap-1.5">
              {orphans.rows.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 min-w-0">
                  <Avatar label={m.label} seed={m.userId} size="sm" title={null} />
                  <span className="truncate text-sm">{m.label}</span>
                  {m.isSelf && <span className="ent-hint">({t('teamVaults.members.you')})</span>}
                  {/* La ligne qui FERME le geste est nommée là où on la lit :
                      on ne se retire pas soi-même par ici (« Quitter » vit dans
                      l'onglet Danger), et un administrateur ne retire pas le
                      propriétaire. */}
                  {!m.removable && (
                    <span className="ml-auto shrink-0 ent-hint">
                      {t('teamVaults.settings.outOfSpace.notRemovable')}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {/* UN SEUL BOUTON, ET IL LES EMPORTE TOUS. Un retrait par personne
                était un cul-de-sac dès qu'il y en avait deux : la rotation
                rescelle K_vault' à chaque RESTANT, et la clé publique d'un
                sorti de l'espace est refusée (403 `org_forbidden`, le même
                prédicat que celui qui allume ce bandeau). Retirer A échouait
                donc sur B et retirer B sur A. Le modèle ne propose le geste que
                s'il n'en laisse aucun derrière. */}
            {orphans.removeTogether.length > 0 ? (
              <div className="mt-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => removal.requestRemoveMany(orphans.removeTogether)}
                >
                  {t('teamVaults.settings.outOfSpace.remove', {
                    count: orphans.removeTogether.length,
                  })}
                </Button>
              </div>
            ) : (
              <p className="text-xs m-0 mt-2">
                {t('teamVaults.settings.outOfSpace.blocked', {
                  names: orphans.blockers.map((m) => m.label).join(', '),
                })}
              </p>
            )}
          </InfoCallout>
        </div>
      )}

      {/* L'ACTION PRIMAIRE DE LA PAGE, à demeure et en tête — plus derrière un
          bouton qui ouvrait une boîte. Réservée à qui gère le coffre : le
          serveur refait sa propre garde, ceci ne fait que ranger l'écran. */}
      {mgmt.canManage && (
        <AdminSection
          title={t('teamVaults.members.inviteTitle')}
          description={t('teamVaults.settings.members.inviteHint')}
          icon={<MembersIcon />}
        >
          <InviteRow
            ref={inviteRef}
            vaultId={vaultId}
            orgId={orgId}
            directory={mgmt.directory.entries}
            directoryState={mgmt.directory.state}
            onRetryDirectory={mgmt.directory.reload}
            vaultMembers={mgmt.members}
            pendingInvites={mgmt.invites}
            // Le rôle que CE coffre donne par défaut (F13) — pré-sélectionné,
            // jamais imposé : le menu reste à côté et l'emporte dès qu'on y
            // touche.
            defaultRole={mgmt.settings.settings.defaultInviteRole}
            onSeeRow={setHighlighted}
            onDone={async () => {
              await mgmt.reload();
              mgmt.afterRosterChange();
            }}
          />
        </AdminSection>
      )}

      {/* F15 — « VOUS ». Elle est ici, et pour tous les rôles : la cérémonie du
          numéro de sécurité est SYMÉTRIQUE. L'hôte voit l'empreinte de son
          invité dans la ligne d'invitation juste au-dessus ; l'invité, lui,
          n'avait nulle part où lire la sienne — on lui demandait donc une
          comparaison qu'il ne pouvait pas faire. C'est aussi le seul endroit où
          l'on vérifie que la clé publiée sous MON nom est bien la mienne. */}
      <MySecurityCard
        vaultId={vaultId}
        myUserId={mgmt.myUserId}
        currentKeyEpoch={currentKeyEpoch}
      />

      {/* LA SECTION QUI MANQUAIT — voir l'en-tête. Elle ne s'affiche que pour
          qui peut agir, sur un annuaire réellement lu, et quand il y a
          quelqu'un à nommer : une section vide dirait « votre espace est vide »
          à un hôte dont on n'a simplement pas pu lire l'annuaire. */}
      {mgmt.canManage && candidates.total > 0 && (
        <AdminSection
          title={t('teamVaults.invite.candidates.title', { count: candidates.total })}
          description={t('teamVaults.invite.candidates.hint')}
          icon={<AddPersonIcon />}
        >
          <ul className="m-0 p-0 list-none flex flex-col gap-1">
            {candidates.items.map((c) => (
              <li key={c.userId} className="flex items-center gap-2 min-w-0 py-1">
                {/* La teinte prend l'IDENTIFIANT pour graine, comme les lignes
                    du tableau : la même personne garde sa couleur d'une section
                    à l'autre. */}
                <Avatar label={c.email} seed={c.userId} size="sm" title={null} />
                <span className="truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {c.email}
                </span>
                {/* Une invitation déjà partie n'empêche RIEN — quelqu'un de
                    l'espace reçoit l'accès sur-le-champ (F06) — mais la taire
                    ferait croire qu'on n'a rien fait pour cette personne. */}
                {c.pendingInvite && (
                  <StatusBadge tone="info">
                    {t('teamVaults.invite.candidates.pendingBadge')}
                  </StatusBadge>
                )}
                <span className="ml-auto shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    // Le bouton REMPLIT la ligne d'invitation et y pose la main :
                    // un bouton qui se contenterait d'y renvoyer laisserait le
                    // geste à moitié fait, et l'adresse à retaper.
                    onClick={() => inviteRef.current?.prefill(c.email)}
                  >
                    {/* PAS « Donner l'accès » : c'est l'étiquette EXACTE du
                        bouton d'envoi de la ligne d'invitation juste au-dessus,
                        qui, lui, accorde vraiment. Deux boutons identiquement
                        libellés à l'écran, dont un ne fait que pré-remplir un
                        champ, mentent sur le geste — la cérémonie du numéro de
                        sécurité impose ce détour, l'étiquette doit le dire. */}
                    {t('teamVaults.invite.candidates.prepare')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {/* Ce que le plafond laisse de côté est DIT, avec le geste qui y mène
              — même règle que la liste déroulante du champ. Une section qui
              s'arrête en silence ferait conclure que la personne cherchée n'est
              pas dans l'espace : c'est le défaut exact que cette section
              répare. */}
          {candidates.hidden > 0 && (
            <p className="text-xs m-0 mt-2 text-[var(--color-text-tertiary)]">
              {t('teamVaults.invite.candidates.sectionMore', { count: candidates.hidden })}
            </p>
          )}
        </AdminSection>
      )}

      {/* CEUX QUI VONT ENTRER, JUSTE AU-DESSUS DE CEUX QUI SONT ENTRÉS.
          Une personne invitée n'apparaissait NULLE PART ici : son rôle ne se
          corrigeait qu'à l'onglet Invitations, c'est-à-dire ailleurs que là où
          l'on gère les rôles — un hôte qui vient d'inviter quelqu'un ouvrait
          « Membres », n'y trouvait personne, et concluait que son geste n'avait
          rien produit. La section est distincte du tableau parce qu'un siège
          promis n'est pas un membre : pas de clé scellée, pas de compte, donc
          aucun des gestes du tableau. Réservée à qui gère le coffre — les
          invitations ne sont même pas chargées pour les autres. */}
      {mgmt.canManage && (
        <PendingSeatsSection
          seats={seats}
          actions={inviteActions}
          disabled={busy}
          onGoToInvitations={onGoToInvitations}
        />
      )}

      <AdminSection
        title={t('teamVaults.members.title')}
        description={t('teamVaults.members.subtitle')}
        icon={<MembersIcon />}
        actions={
          /* « N vérifiés sur M » (F11). Il ne s'affiche qu'une fois un contrôle
             passé : « 0 vérifiés sur 5 » avant toute lecture décrirait l'état de
             notre ignorance, pas celui du coffre. */
          trust.counter.total > 0 && (
            <>
              <span className="ent-hint">
                {trust.checking
                  ? t('teamVaults.settings.trust.checking')
                  : t('teamVaults.settings.trust.counter', {
                      verified: trust.counter.verified,
                      total: trust.counter.total,
                    })}
              </span>
              {/* Le contrôle ne repasse qu'une fois par jour et par personne
                  (cache de 24 h) : sans ce bouton, une clé qui vient de tourner
                  resterait affichée « vue » jusqu'au lendemain, sans aucun moyen
                  de demander à regarder. */}
              <Button variant="ghost" size="sm" disabled={trust.checking} onClick={trust.recheck}>
                {t('teamVaults.settings.trust.recheck')}
              </Button>
            </>
          )
        }
        flush
      >
        {states.members.kind === 'error' ? (
          // Une panne de LECTURE, pas un coffre vide : on garde le refus à
          // l'écran (une notification s'efface, et l'écran ment ensuite) et on
          // propose le seul geste qui vaille. La classification du code vient du
          // modèle — « votre offre est pleine » et « le réseau a hoqueté »
          // n'appellent pas la même réaction.
          <div role="alert" className="flex flex-col items-start gap-2 p-4">
            <p className="text-sm text-[var(--color-text-primary)] m-0">
              {t(states.members.key ?? 'teamVaults.errors.membersLoad')}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void mgmt.reload()}
              disabled={mgmt.loading}
            >
              {t('teamVaults.retry')}
            </Button>
          </div>
        ) : states.members.kind === 'empty' ? (
          /* SEUL DANS LE COFFRE. La table d'une ligne (la mienne) n'apprend
             rien de plus que l'en-tête de la page ; ce qui manque, c'est le
             geste suivant — et son bouton le rend, sans faire chercher la
             ligne d'invitation qui est déjà à l'écran. */
          <EmptyState
            icon={<MembersGlyph />}
            title={t(`${states.members.key}.title`)}
            description={t(`${states.members.key}.body`)}
            action={
              states.members.action === 'focusInvite'
                ? {
                    label: t(`${states.members.key}.action`),
                    onClick: () => inviteRef.current?.focus(),
                  }
                : undefined
            }
          />
        ) : (
          /* L'annuaire manquant est dit UNE fois, dans la ligne d'invitation
             juste au-dessus : c'est là qu'il change quelque chose (on ne sait
             plus router une adresse). Le répéter ici, à trente pixels et mot
             pour mot, ferait lire les deux comme du décor. Il prive aussi la
             table de quelques noms — l'identifiant prend le relais, et la
             colonne reste lisible. */
          <>
            {/* F09 — LA BARRE. Elle n'apparaît qu'à partir de quelques lignes :
                sur un coffre à trois personnes, un champ de recherche et une
                liste déroulante coûtent deux contrôles pour un tableau qu'on lit
                d'un coup d'œil. */}
            {(mgmt.rows.length >= ROSTER_TOOLBAR_FROM || trust.keyChanged.size > 0) && (
              <div style={{ padding: 'var(--spacing-4) var(--spacing-5) 0' }}>
                <div className="ent-toolbar">
                  <div className="ent-toolbar__field" style={{ flex: '1 1 240px' }}>
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('teamVaults.settings.roster.searchPlaceholder')}
                      aria-label={t('teamVaults.settings.roster.searchLabel')}
                      size="sm"
                      fullWidth
                    />
                  </div>
                  <div className="ent-toolbar__field">
                    <Select
                      value={filter}
                      onChange={(v) => setFilter((Array.isArray(v) ? v[0] : v) as RosterFilterId)}
                      ariaLabel={t('teamVaults.settings.roster.filterLabel')}
                      size="sm"
                      options={ROSTER_FILTERS.map((id) => ({
                        value: id,
                        label: t(`teamVaults.settings.roster.filter.${id}`),
                      }))}
                    />
                  </div>
                  <div className="ent-toolbar__spacer" />
                  {/* Ce que le filtre laisse de côté est DIT : un tableau
                      raccourci sans un mot ferait conclure que des gens ont
                      disparu du coffre. */}
                  {view.filtered && (
                    <>
                      <span className="ent-hint">
                        {t('teamVaults.settings.roster.showing', {
                          shown: view.rows.length,
                          total: view.total,
                        })}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSearch('');
                          setFilter('all');
                        }}
                      >
                        {t('teamVaults.settings.roster.clear')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* F28 — SOUS 840, DES CARTES, ET LE TABLEAU N'EST PAS MONTÉ DU TOUT.
                Le cacher en CSS le laisserait mesurer sa largeur naturelle, donc
                pousser : c'est exactement le débordement horizontal qu'on veut
                empêcher. Les gestes sont les MÊMES fermetures — aucune seconde
                implémentation de « changer le rôle » ni de « retirer ». */}
            {band === 'compact' ? (
              <MemberCardList
                rows={view.rows}
                selected={visible}
                selectable={mgmt.canManage}
                busy={busy}
                trust={trust}
                highlighted={highlighted}
                showTrust={mgmt.canManage}
                // La MÊME phrase que la table juste à côté, choisie une fois.
                emptyMessage={rosterEmpty}
                // Le modèle reste le dernier mot, comme pour la table : il retire
                // ce qu'un filtre cache, et se garde d'un appelant qui oublierait
                // le prédicat.
                onToggle={(userId, checked) =>
                  setSelected(
                    applySelectionChange(
                      checked ? [...visible, userId] : visible.filter((id) => id !== userId),
                      view,
                      selected
                    )
                  )
                }
                onChangeRole={(m, role) => void changeRole(m, role)}
                onOpenTrust={setTrustFor}
                onTransfer={setToPromote}
                onRemove={(m) => removal.requestRemove(m)}
              />
            ) : (
              <Table
                columns={shownColumns}
                data={view.rows}
                keyExtractor={(m) => m.userId}
                loading={rosterLoading}
                emptyMessage={rosterEmpty}
                // La sélection n'existe que pour qui gère le coffre : ses deux
                // gestes sont refusés à tous les autres par le serveur.
                selectable={mgmt.canManage}
                selectedRows={visible}
                // LES DEUX LIGNES QU'AUCUN GESTE DE LOT N'ATTEINT — le
                // propriétaire et la mienne — n'ont plus de case du tout : la
                // règle est celle du serveur, `buildMemberRows` l'a déjà calculée,
                // et la table n'a donc rien à deviner. C'est aussi ce qui rend sa
                // case d'en-tête lisible : sans ce prédicat elle restait
                // éternellement à moitié cochée.
                isRowSelectable={isSelectable}
                // Une case qui se lit « ligne 3 » ne dit pas QUI on s'apprête à
                // retirer.
                rowSelectionLabel={(m) =>
                  t('teamVaults.settings.roster.selectMember', { name: m.label })
                }
                // Le modèle reste le dernier mot : il retire ce qu'un filtre
                // cache, et se garde d'une table qui oublierait le prédicat.
                onSelectionChange={(ids) => setSelected(applySelectionChange(ids, view, selected))}
                sortBy={sort.key}
                sortDirection={sort.direction}
                onSort={(key, direction) => setSort({ key: key as RosterSortKey, direction })}
                stickyHeader
                striped
                size="sm"
              />
            )}
          </>
        )}
      </AdminSection>

      {/* F17 — « ACCÈS PONCTUELS », EN BAS ET RÉSERVÉE AUX ADMINISTRATEURS.
          C'est la seule sortie de matière hors du trombinoscope : des gens qui
          ne sont pas dans la table ci-dessus, et qui lisent pourtant quelque
          chose ici. Elle est SOUS le trombinoscope parce qu'elle en est
          l'exception, pas le sujet ; et réservée à qui gère parce que la route
          l'est (`requireVaultRole 'admin'`), et que les trois gestes qu'elle
          porte le sont aussi. */}
      {mgmt.canManage && (
        <VaultGrantsSection
          vaultId={vaultId}
          grants={grants}
          nameByItemId={nameByItemId}
          knownItemIds={knownItemIds}
          // Le point d'invalidation UNIQUE de la page : la liste relue ET les
          // agrégats partagés réveillés (`grantCountByItem` des cartes, résumé
          // du coffre, statistiques de l'Aperçu). Révoquer un accès ici doit
          // éteindre le badge « partagé » de l'élément, pas dans une minute.
          onChanged={async () => {
            await grants.reload();
            mgmt.afterRosterChange();
          }}
        />
      )}

      {/* F09 — LA BARRE FLOTTANTE, hors de la carte pour qu'elle colle au bas de
          la fenêtre et suive le défilement. */}
      {mgmt.canManage && (
        <MemberSelectionBar
          selectedCount={visible.length}
          selectableCount={view.selectableIds.length}
          disabled={busy}
          progress={
            lotProgress
              ? { ...lotProgress, label: t('teamVaults.settings.bulk.roleWorking') }
              : null
          }
          onSelectAll={() => setSelected(view.selectableIds)}
          onClear={() => setSelected([])}
          onChangeRole={() => setRoleLot(true)}
          onRemove={() => removal.requestRemoveMany(picked)}
        />
      )}

      {removal.overlays}

      {/* CHANGER LE RÔLE D'UN LOT. Elle NOMME les gens : « 4 personnes » ne dit
          pas lesquelles, et la sélection vit en bas de l'écran, hors de vue
          quand la boîte s'ouvre. */}
      <Modal
        isOpen={roleLot}
        onClose={() => setRoleLot(false)}
        title={t('teamVaults.settings.bulk.roleTitle')}
        size="md"
      >
        <div style={{ padding: 'var(--spacing-4)' }} className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-text-secondary)] m-0">
            {t('teamVaults.settings.bulk.roleHint')}
          </p>
          <p className="text-sm m-0 text-[var(--color-text-primary)]">
            {picked.map((m) => m.label).join(', ')}
          </p>
          <Select
            label={t('teamVaults.settings.bulk.roleLabel')}
            value={lotRole}
            onChange={(v) =>
              setLotRole((Array.isArray(v) ? v[0] : v) as 'admin' | 'member' | 'viewer')
            }
            options={vaultRoleOptions(t)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRoleLot(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || picked.length === 0}
              onClick={() => void applyRoleLot()}
            >
              {t('teamVaults.settings.bulk.roleApply')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* F11 — LE NUMÉRO DE SÉCURITÉ D'UN MEMBRE, et le seul geste qui
          transforme « vu » en « vérifié ». */}
      <MemberTrustModal
        member={trustRow ? { userId: trustRow.userId, label: trustRow.label } : null}
        verdict={trustFor ? (trust.verdicts[trustFor] ?? null) : null}
        onClose={() => setTrustFor(null)}
        onConfirm={trust.confirm}
      />

      <ConfirmModal
        isOpen={!!toPromote}
        onClose={() => setToPromote(null)}
        onConfirm={() => void confirmTransfer()}
        title={t('teamVaults.members.transferTitle')}
        message={t('teamVaults.members.transferConfirm', { name: toPromote?.label ?? '' })}
        confirmText={t('teamVaults.members.transfer')}
        variant="danger"
      />
    </div>
  );
};

export default MembersTab;
