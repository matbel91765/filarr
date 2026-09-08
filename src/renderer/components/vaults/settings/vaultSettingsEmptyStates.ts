/**
 * vaultSettingsEmptyStates — CE QUE CHAQUE SECTION DE LA PAGE MONTRE QUAND ELLE
 * N'A RIEN À MONTRER (F05), sans React, sans réseau, sans traduction.
 *
 * LE DÉFAUT QU'IL FERME, ET IL N'EN A QU'UN. Un écran qui ne sait pas lire et un
 * écran qui n'a rien à lire rendaient le MÊME vide. C'est cette confusion-là,
 * exactement, qui a fait conclure à un accès perdu le 28/08 : une liste
 * d'invitations vide parce que la route avait échoué se lisait « personne n'a
 * jamais été invité ». L'ordre de décision ci-dessous est donc figé, et c'est
 * tout l'objet du fichier :
 *
 *      erreur  >  chargement  >  vide  >  contenu
 *
 * UNE ERREUR N'EST JAMAIS UN ÉTAT VIDE. Elle rend `error`, elle porte le seul
 * geste qui vaille (Réessayer), et elle passe AVANT le compte : un compteur à
 * zéro construit sur une lecture ratée est un mensonge, pas une information.
 *
 * UN CHARGEMENT N'EST JAMAIS UN ÉTAT VIDE NON PLUS. Tant que la lecture est en
 * vol, la section rend `content` — c'est-à-dire son propre chargeur — parce
 * qu'afficher « vous êtes seul dans ce coffre » pendant deux cents millisecondes
 * apprend à ne plus lire la phrase quand elle devient vraie.
 *
 * POURQUOI C'EST PUR ET SÉPARÉ. Ces règles ne se voient pas à la compilation
 * (un `||` mis pour un `&&` compile parfaitement) et ne se rejouent pas à la
 * main : personne ne débranche le réseau pour vérifier qu'un onglet dit
 * « impossible de lire » plutôt que « aucune invitation ». Ici les cas
 * s'éprouvent en quelques lignes de vitest, y compris ceux-là.
 *
 * CE MODULE REND DES CLÉS i18n, JAMAIS DES PHRASES : la page existe en deux
 * langues et personne ne relit la seconde.
 */

import { vaultErrorKey } from '../../../../services/vault/vaultErrorMessages';
import type { VaultTabId } from './vaultManagementModel';

// ─────────────────────────────────────────────────────────────────────────────
// Le verdict
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `content` : la section a de quoi rendre — ou est en train de le lire.
 * `empty`   : elle a lu, et il n'y a rien. Le texte dit QUOI FAIRE.
 * `error`   : elle n'a pas su lire. Jamais confondu avec le précédent.
 */
export type VaultSectionKind = 'content' | 'empty' | 'error';

/**
 * Le geste que porte l'état, quand il en porte un.
 *
 *  · `retry`        — relire (la seule réponse à une panne) ;
 *  · `focusInvite`  — poser la main dans le champ de la ligne d'invitation, qui
 *                     est déjà à l'écran, juste au-dessus ;
 *  · `goToInviteRow`— changer d'onglet POUR y arriver (depuis les Invitations) ;
 *  · `upgrade`      — le parcours d'offre, pour un plafond ou un fil non journalisé.
 */
export type VaultSectionAction = 'retry' | 'focusInvite' | 'goToInviteRow' | 'upgrade';

export interface VaultSectionState {
  kind: VaultSectionKind;
  /** La clé i18n de la phrase — `null` quand il y a du contenu à rendre. */
  key: string | null;
  /** Le geste, seulement quand l'écran peut réellement l'offrir. */
  action?: VaultSectionAction;
}

/** Un état sans rien à dire : la section rend son contenu (ou son chargeur). */
const CONTENU: VaultSectionState = { kind: 'content', key: null };

/**
 * Les clés, groupées pour qu'un renommage se voie d'un coup d'œil.
 *
 * TROIS D'ENTRE ELLES SONT REPRISES de l'existant, délibérément :
 * `activity.notRecorded` et `activity.empty` sont déjà les deux phrases que
 * `VaultActivityPanel` distingue depuis toujours — F05 ne leur ajoute qu'un
 * geste — et `members.spaceFull` reste le repli du plafond quand on ne sait pas
 * que l'espace est personnel. En inventer des jumelles n'aurait servi qu'à les
 * traduire deux fois, puis à les laisser diverger.
 */
export const VAULT_EMPTY_KEYS = {
  /** Sous-clés `.title` / `.body` / `.action`. */
  membersAlone: 'teamVaults.settings.empty.membersAlone',
  /** Sous-clés `.title` / `.body` / `.action`. */
  invitations: 'teamVaults.settings.empty.invitations',
  /** Une ligne, pas un état vide pleine hauteur. */
  todo: 'teamVaults.settings.empty.todo',
  /** Prend `{{used}}`, `{{limit}}`, `{{offers}}`. */
  seatsFull: 'teamVaults.settings.empty.seatsFull',
  /** Prend `{{used}}`, `{{limit}}` — plus rien au-dessus à proposer. */
  seatsFullTop: 'teamVaults.settings.empty.seatsFullTop',
  /**
   * DES INVITATIONS TIENNENT DES PLACES : la phrase nomme l'annulation AVANT la
   * montée d'offre. Prend `{{used}}`, `{{limit}}`, `{{members}}`, `{{pending}}`
   * et `{{offers}}`.
   */
  seatsFullPending: 'teamVaults.settings.empty.seatsFullPending',
  /** Le même, sans offre au-dessus. Prend `{{used}}`, `{{limit}}`, `{{members}}`, `{{pending}}`. */
  seatsFullTopPending: 'teamVaults.settings.empty.seatsFullTopPending',
  /** Le repli d'avant : on ignore si l'espace est personnel. Prend `{{limit}}`. */
  seatsFullUnknown: 'teamVaults.members.spaceFull',
  /** Une offre nommée — « Pro (10) ». Prend `{{tier}}` et `{{limit}}`. */
  seatOffer: 'teamVaults.settings.empty.offer',
  /** Le préfixe des noms d'offres : `${seatTier}.pro`, `${seatTier}.teams`. */
  seatTier: 'teamVaults.settings.empty.tier',
  activityNotRecorded: 'teamVaults.activity.notRecorded',
  activityEmpty: 'teamVaults.activity.empty',
  activityFailed: 'teamVaults.activity.loadFailed',
  /** Le repli d'une lecture d'effectif refusée — la phrase de l'onglet Membres. */
  loadFailed: 'teamVaults.errors.membersLoad',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Ce que la page sait
// ─────────────────────────────────────────────────────────────────────────────

/** Les compteurs du chargeur unique (`useVaultManagement` + les modèles purs). */
export interface VaultSettingsCounts {
  /** Les membres du coffre, propriétaire inclus. */
  members: number;
  /** Les invitations encore dehors. */
  pending: number;
  /** Les invitations réglées des 14 derniers jours. */
  settled: number;
  /** Les invitations échues des 30 derniers jours. */
  lapsed: number;
  /** Les accès en préparation qui attendent ENCORE quelque chose. */
  preparing: number;
  /** Les lignes de la carte « À traiter » (déjà filtrées à `count > 0`). */
  todo: number;
}

/** L'état de la lecture — l'ordre « erreur > chargement » se joue ici. */
export interface VaultSettingsLoad {
  loading: boolean;
  /** Le refus MÉMORISÉ (`useVaultManagement.error`), jamais avalé. */
  error: string | null;
}

export interface VaultSettingsEmptyInput {
  counts: VaultSettingsCounts;
  load: VaultSettingsLoad;
  /** owner/admin : décide des états qui portent un geste d'invitation. */
  canManage: boolean;
}

/**
 * Les trois sections que le chargeur UNIQUE de la page alimente. Le fil
 * d'activité et le plafond de sièges ont leurs propres lectures, donc leurs
 * propres fonctions plus bas — les fondre ici obligerait la page à connaître des
 * chargements qu'elle ne fait pas.
 */
export interface VaultSettingsEmptyStates {
  members: VaultSectionState;
  invitations: VaultSectionState;
  todo: VaultSectionState;
}

// ─────────────────────────────────────────────────────────────────────────────
// L'erreur, d'abord et toujours
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le refus de lecture, traduit et porteur de son bouton — ou `null` s'il n'y en
 * a pas. Extrait pour que les quatre sections ne puissent pas en donner quatre
 * lectures différentes.
 *
 * La classification passe par `vaultErrorKey` : « votre offre est pleine » et
 * « le réseau a hoqueté » appellent des réactions opposées, et seul le serveur
 * sait laquelle des deux s'est produite.
 */
export function loadFailureState(error: string | null): VaultSectionState | null {
  if (!error) return null;
  return { kind: 'error', key: vaultErrorKey(error, VAULT_EMPTY_KEYS.loadFailed), action: 'retry' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Membres
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L'onglet Membres.
 *
 * « AUCUN MEMBRE » N'EXISTE PAS, ET NE DOIT EXISTER NULLE PART. Un coffre a
 * toujours son propriétaire : un effectif à zéro ne décrit aucune situation
 * atteignable, il décrit une lecture qui n'a rien rapporté. Zéro et un tombent
 * donc dans le MÊME état — « vous êtes seul » — parce que c'est la seule chose
 * vraie des deux, et parce que l'alternative (« aucun membre pour l'instant »)
 * est précisément la phrase qui s'affichait sur les pannes.
 *
 * Le geste n'est proposé qu'à qui gère le coffre : la ligne d'invitation n'est
 * rendue que pour lui, et un bouton qui met le focus dans un champ absent ne
 * fait rien du tout.
 */
export function membersEmptyState(input: VaultSettingsEmptyInput): VaultSectionState {
  const failed = loadFailureState(input.load.error);
  if (failed) return failed;
  if (input.load.loading) return CONTENU;
  if (input.counts.members > 1) return CONTENU;
  return {
    kind: 'empty',
    key: VAULT_EMPTY_KEYS.membersAlone,
    ...(input.canManage ? { action: 'focusInvite' as const } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Invitations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L'onglet Invitations — vide seulement quand LES QUATRE sections le sont.
 *
 * Les quatre comptent, et pas seulement « en attente » : une invitation échue,
 * un accusé récent ou un accès en préparation sont autant de raisons de garder
 * l'écran tel qu'il est. Ne regarder que `pending` remplacerait par un état vide
 * la liste des échues — c'est-à-dire l'information même que la fiche F03 a
 * ajoutée pour cesser de confondre « expirée » et « jamais invitée ».
 *
 * Un membre simple n'a pas cet onglet (`visibleVaultTabs`) ; s'il l'atteignait,
 * il n'aurait pas la ligne d'invitation non plus, donc pas de geste à proposer.
 */
export function invitationsEmptyState(input: VaultSettingsEmptyInput): VaultSectionState {
  const failed = loadFailureState(input.load.error);
  if (failed) return failed;
  if (input.load.loading) return CONTENU;
  const { pending, settled, lapsed, preparing } = input.counts;
  if (pending + settled + lapsed + preparing > 0) return CONTENU;
  return {
    kind: 'empty',
    key: VAULT_EMPTY_KEYS.invitations,
    ...(input.canManage ? { action: 'goToInviteRow' as const } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// « À traiter » (Aperçu)
// ─────────────────────────────────────────────────────────────────────────────

/** Les cinq choses que la carte « À traiter » sait compter. */
export type VaultTodoKey =
  | 'outOfSpace'
  | 'accessInPreparation'
  | 'expiringSoon'
  | 'toReissue'
  | 'lapsed';

export interface VaultTodoRow {
  key: VaultTodoKey;
  count: number;
  /** L'onglet où LE geste existe déjà — la carte n'en reproduit aucun. */
  tab: VaultTabId;
}

export interface VaultTodoInput {
  canManage: boolean;
  /**
   * Les membres du coffre que le serveur DIT sortis de l'espace (F08). Jamais
   * déduit d'un silence : `inSpace` absent vaut « on ne sait pas », et
   * `orphanedMembers` est le seul à en juger.
   */
  outOfSpace: number;
  /** Les accès en préparation qui attendent ENCORE quelque chose. */
  preparing: number;
  expiringSoon: number;
  toReissue: number;
  lapsed: number;
}

/**
 * Les lignes de la carte « À traiter », construites UNE fois.
 *
 * POURQUOI ICI ET PAS DANS LA CARTE. Savoir si la section est vide EXIGE de
 * savoir ce qu'elle contient : la page a besoin du compte pour choisir entre
 * « rien à traiter » et la liste, et la carte a besoin des lignes pour les
 * rendre. Deux calculs — un pour le verdict, un pour l'affichage — finiraient
 * par diverger, et l'écran dirait « rien à traiter » au-dessus d'une liste de
 * trois entrées.
 *
 * Une ligne à zéro n'existe pas : une carte qui affiche cinq zéros apprend à
 * ne plus la lire.
 */
export function buildTodoRows(input: VaultTodoInput): VaultTodoRow[] {
  if (!input.canManage) return [];
  const rows: VaultTodoRow[] = [
    // EN TÊTE, et c'est délibéré : c'est la seule ligne qui porte sur un accès
    // EN COURS plutôt que sur une invitation qui attend. Quelqu'un détient une
    // clé qu'il ne devrait plus avoir ; les autres lignes parlent de portes qui
    // ne se sont pas encore ouvertes. C'est aussi la seule dont le geste vit
    // dans l'onglet Membres.
    { key: 'outOfSpace', count: input.outOfSpace, tab: 'members' },
    { key: 'accessInPreparation', count: input.preparing, tab: 'invitations' },
    { key: 'expiringSoon', count: input.expiringSoon, tab: 'invitations' },
    { key: 'toReissue', count: input.toReissue, tab: 'invitations' },
    { key: 'lapsed', count: input.lapsed, tab: 'invitations' },
  ];
  return rows.filter((r) => r.count > 0);
}

/**
 * La carte « À traiter » de l'Aperçu.
 *
 * UNE LIGNE, PAS UN ÉTAT VIDE PLEINE HAUTEUR : c'est un index, et un index sans
 * entrée est une bonne nouvelle qui tient en trois mots. Lui donner l'appareil
 * complet (icône, titre, bouton) donnerait à « tout va bien » le poids visuel
 * d'un problème.
 *
 * Elle n'existe pas pour qui ne gère pas le coffre : rien de ce qu'elle compte
 * ne lui est ni visible ni actionnable.
 */
export function todoEmptyState(input: VaultSettingsEmptyInput): VaultSectionState {
  if (!input.canManage) return CONTENU;
  const failed = loadFailureState(input.load.error);
  if (failed) return failed;
  if (input.load.loading) return CONTENU;
  if (input.counts.todo > 0) return CONTENU;
  return { kind: 'empty', key: VAULT_EMPTY_KEYS.todo };
}

/** Les trois sections que le chargeur unique de la page alimente. */
export function vaultSettingsEmptyStates(input: VaultSettingsEmptyInput): VaultSettingsEmptyStates {
  return {
    members: membersEmptyState(input),
    invitations: invitationsEmptyState(input),
    todo: todoEmptyState(input),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Activité
// ─────────────────────────────────────────────────────────────────────────────

/** Ce que le fil sait de lui-même. Sa lecture est la SIENNE, pas celle de la page. */
export interface VaultActivityInput {
  loading: boolean;
  error: string | null;
  /**
   * L'écriture d'audit est-elle allumée pour cet espace ? `null` tant qu'aucune
   * page n'a répondu — et `null` n'est PAS « non » : un vieux worker qui ne
   * renvoie pas le champ ne doit pas faire dire à l'écran que le plan ne
   * journalise rien.
   */
  recorded: boolean | null;
  events: number;
}

/**
 * L'onglet Activité — TROIS vides, et ce sont trois faits différents.
 *
 *  · « non enregistrée sur ce plan » : le fil est COUPÉ (espace personnel, offre
 *    sans journal). Ce n'est ni une panne ni une absence d'événement : c'est une
 *    propriété du plan, et la seule réponse est la montée d'offre — que l'écran
 *    ne proposait nulle part.
 *  · « aucune activité encore » : le journal tourne, il n'a rien à raconter.
 *    Rien à faire, donc aucun bouton : proposer « Réessayer » ferait passer un
 *    coffre neuf pour un coffre en panne.
 *  · l'échec de lecture, qui garde son Retry comme partout ailleurs.
 *
 * `VaultActivityPanel` distinguait déjà les trois ; ce modèle ne les déplace pas,
 * il leur attache leur geste et les rend éprouvables.
 */
export function activityEmptyState(input: VaultActivityInput): VaultSectionState {
  if (input.error) {
    return {
      kind: 'error',
      key: vaultErrorKey(input.error, VAULT_EMPTY_KEYS.activityFailed),
      action: 'retry',
    };
  }
  if (input.loading) return CONTENU;
  if (input.recorded === false) {
    return { kind: 'empty', key: VAULT_EMPTY_KEYS.activityNotRecorded, action: 'upgrade' };
  }
  if (input.events > 0) return CONTENU;
  return { kind: 'empty', key: VAULT_EMPTY_KEYS.activityEmpty };
}

// ─────────────────────────────────────────────────────────────────────────────
// Le plafond de l'espace — la ligne d'invitation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les plafonds d'un espace PERSONNEL, par offre. Miroir en lecture seule de
 * `PERSONAL_ORG_MEMBER_LIMIT` (`infra/cloudflare-worker/src/personalOrg.ts:62`) :
 * le serveur reste l'autorité, et refuse de toute façon. Ce qui se joue ici est
 * de proposer la montée d'offre AVANT qu'une invitation ne soit brûlée — donc de
 * savoir NOMMER l'offre au-dessus, ce que le seul `memberLimit` reçu ne permet
 * pas.
 *
 * `enterprise` n'y figure pas : ce n'est pas une offre qu'on propose depuis un
 * espace personnel plein, et son plafond y est celui de `teams`.
 */
export const PERSONAL_TIER_LIMITS: readonly { tier: 'solo' | 'pro' | 'teams'; limit: number }[] = [
  { tier: 'solo', limit: 3 },
  { tier: 'pro', limit: 10 },
  { tier: 'teams', limit: 25 },
];

export interface SeatUpgradeOffer {
  tier: 'pro' | 'teams';
  limit: number;
}

/**
 * Les offres qui lèveraient RÉELLEMENT le plafond, dans l'ordre.
 *
 * On part du plafond REÇU, pas du nom de l'offre : c'est le serveur qui a
 * tranché, et un compte dont le `tier` ne figure pas dans la table (offre
 * inconnue, valeur future) doit quand même se voir proposer ce qui est plus
 * grand que ce qu'il a. Un `limit` déjà au sommet rend une liste vide — et une
 * liste vide vaut « ne proposez rien », jamais « proposez au hasard ».
 */
export function seatUpgradeOffers(memberLimit: number | null): SeatUpgradeOffer[] {
  if (memberLimit === null) return [];
  const offres: SeatUpgradeOffer[] = [];
  for (const p of PERSONAL_TIER_LIMITS) {
    // `solo` n'est jamais une montée : c'est le plancher payant.
    if (p.tier === 'solo' || p.limit <= memberLimit) continue;
    offres.push({ tier: p.tier, limit: p.limit });
  }
  return offres;
}

/**
 * Ce que la ligne d'invitation sait du plan de l'espace (`GET /vaults/seats`).
 *
 * Les trois champs sont OPTIONNELS, et pas par confort : un worker plus ancien
 * n'en renvoie aucun, et `undefined` doit se lire « je ne sais pas », jamais
 * « zéro » ni « non ». C'est ce que le DTO déclare, et ce contrat-là remonte
 * intact jusqu'ici.
 */
export interface VaultSeatsPlan {
  memberLimit?: number | null;
  /** L'occupation QUI DÉCIDE : membres actifs + invitations encore vivantes. */
  membersUsed?: number | null;
  activeMembers?: number | null;
  /**
   * Les invitations parties, sans réponse. Chacune tient une place et se rend
   * d'un clic (onglet Invitations) : quand il y en a, c'est CETTE sortie qu'il
   * faut nommer d'abord — proposer de payer pendant qu'une place se libère
   * gratuitement est la pire des impasses.
   */
  pendingInvites?: number | null;
  /** `undefined` sur un vieux worker : ce n'est pas « non ». */
  isPersonal?: boolean;
}

export interface VaultSeatsState extends VaultSectionState {
  /** Les offres à nommer dans la phrase — vide quand il n'y en a pas. */
  offers: SeatUpgradeOffer[];
}

/**
 * L'espace est-il plein, et que dire alors ?
 *
 * CINQ PHRASES, PARCE QU'ON NE SAIT PAS TOUJOURS LA MÊME CHOSE, ET QUE LES
 * SORTIES NE SONT PAS LES MÊMES :
 *  · espace personnel PLEIN AVEC des invitations en attente → on nomme les deux
 *    sorties, et l'ANNULATION D'ABORD : elle rend une place à l'instant, sans
 *    rien payer. C'est le cas du 30/08, où « passez à l'offre supérieure » était
 *    la seule sortie nommée alors qu'un clic suffisait ;
 *  · le même, déjà au sommet → l'annulation, sans promesse d'offre ;
 *  · espace personnel plein sans invitation en attente → la phrase d'avant :
 *    retirer quelqu'un, ou monter d'offre ;
 *  · espace personnel déjà au sommet → même phrase sans promesse d'offre : un
 *    bouton « passez à l'offre supérieure » qui ne mène à rien de plus grand
 *    ferait perdre un aller-retour pour rien ;
 *  · on ignore si l'espace est personnel (vieux worker) → la phrase générique
 *    d'avant, sans bouton. On n'affirme pas un plafond personnel à partir d'une
 *    absence d'information.
 *
 * `pendingInvites` INCONNU (worker d'avant le correctif) NE VAUT PAS ZÉRO : on
 * retombe alors sur les phrases d'avant, qui ne promettent rien de faux.
 *
 * Une VRAIE org ne passe jamais par ici : le worker ne lui rend ni `memberLimit`
 * ni `membersUsed` (son plafond, ce sont ses sièges achetés).
 */
export function seatsFullState(plan: VaultSeatsPlan | null): VaultSeatsState {
  const limit = plan?.memberLimit ?? null;
  const used = plan?.membersUsed ?? null;
  if (limit === null || used === null || used < limit) return { ...CONTENU, offers: [] };
  if (plan?.isPersonal !== true) {
    return { kind: 'empty', key: VAULT_EMPTY_KEYS.seatsFullUnknown, offers: [] };
  }
  const offers = seatUpgradeOffers(limit);
  const enAttente = typeof plan.pendingInvites === 'number' && plan.pendingInvites > 0;
  if (offers.length > 0) {
    return {
      kind: 'empty',
      key: enAttente ? VAULT_EMPTY_KEYS.seatsFullPending : VAULT_EMPTY_KEYS.seatsFull,
      action: 'upgrade',
      offers,
    };
  }
  return {
    kind: 'empty',
    key: enAttente ? VAULT_EMPTY_KEYS.seatsFullTopPending : VAULT_EMPTY_KEYS.seatsFullTop,
    offers: [],
  };
}
