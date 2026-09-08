/**
 * vaultManagementModel — les décisions de la page « Gérer le coffre », sans
 * React, sans réseau, sans traduction.
 *
 * TOUT ce qui se raisonne vit ici : quels onglets existent pour mon rôle, sur
 * lequel on atterrit, ce qu'une valeur d'URL vaut, et comment le trombinoscope
 * du coffre et l'annuaire de l'espace se fondent en lignes de tableau. Les
 * composants n'ont plus qu'à rendre.
 *
 * POURQUOI CE DÉCOUPAGE. Le règlement du dépôt est qu'un garde-fou qu'on n'a
 * pas vu échouer ne garde rien : ces règles-là (un lecteur ne voit pas les
 * invitations, personne ne se retire soi-même, un administrateur ne retire pas
 * un propriétaire, `?tab=nimporte-quoi` ne casse pas l'écran) se vérifient en
 * quelques lignes de vitest tant qu'elles sont des fonctions. Noyées dans un
 * composant, elles ne se vérifieraient qu'à l'œil, une fois.
 *
 * LE RÔLE N'EST QU'UN CONFORT D'ÉCRAN. Le serveur refait ses propres gardes
 * (`requireVaultRole` côté worker) sur chacune des routes citées : ce qui suit
 * range l'écran, ça n'autorise rien. Une page qui montrerait tout serait
 * seulement désagréable ; une page qui autoriserait serait un défaut.
 */

import type {
  SpaceDirectoryEntry,
  VaultInviteDTO,
  VaultMemberDTO,
} from '../../../../services/vault/vaultApi';

// ─────────────────────────────────────────────────────────────────────────────
// Les onglets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les six onglets décidés (D2) : Aperçu · Membres · Invitations · Activité ·
 * Réglages · Danger.
 */
export type VaultTabId =
  | 'overview'
  | 'members'
  | 'invitations'
  | 'activity'
  | 'settings'
  | 'danger';

/** L'ordre à l'écran, une fois pour toutes. */
export const VAULT_TAB_ORDER: readonly VaultTabId[] = [
  'overview',
  'members',
  'invitations',
  'activity',
  'settings',
  'danger',
];

/** Un rôle qui administre le coffre — la même règle que `isVaultAdminRole`. */
const isAdmin = (role: string): boolean => role === 'owner' || role === 'admin';

/** Les onglets réservés aux administrateurs du coffre. */
const ADMIN_ONLY_TABS: ReadonlySet<VaultTabId> = new Set<VaultTabId>(['invitations', 'settings']);

/**
 * Les onglets qu'un rôle voit.
 *
 * Deux disparaissent, et pour la même raison — la route qui les porte est
 * fermée en dessous d'admin, si bien qu'un membre n'aurait qu'un onglet en échec
 * permanent : `GET /:id/invites` pour les Invitations, `PUT /:id/settings` pour
 * les Réglages.
 *
 * LA LECTURE DES RÉGLAGES, ELLE, EST OUVERTE À TOUT LE MONDE, et l'onglet est
 * quand même caché : ce que ces règles changent pour un lecteur se voit là où
 * elles s'appliquent (un partage par élément qui n'est pas proposé, une
 * suppression qui n'est pas offerte), avec le mot qui l'explique. Un onglet
 * entier en lecture seule ne lui apprendrait rien de plus et lui ferait chercher
 * un bouton Enregistrer qui n'existe pas.
 *
 * Le Danger reste visible pour TOUS — « Quitter » est le geste dont un lecteur a
 * le plus besoin, et c'est le seul écran qui le porte.
 */
export function visibleVaultTabs(role: string): VaultTabId[] {
  return VAULT_TAB_ORDER.filter((id) => !ADMIN_ONLY_TABS.has(id) || isAdmin(role));
}

/** L'onglet d'atterrissage : le premier visible, donc l'Aperçu. */
export function defaultVaultTab(role: string): VaultTabId {
  return visibleVaultTabs(role)[0];
}

/**
 * Ce que vaut le `?tab=` d'une URL pour CE rôle.
 *
 * Trois cas retombent sur le défaut, et volontairement sans rien dire : absent
 * (on arrive par « Gérer »), inconnu (une URL tapée, un lien d'une version
 * future), ou légitime mais fermé à ce rôle (un lien « Invitations » transmis
 * à un lecteur). Aucun n'est une erreur de l'utilisateur : l'écran s'ouvre, il
 * ne se plaint pas.
 */
export function resolveVaultTab(raw: string | undefined, role: string): VaultTabId {
  const allowed = visibleVaultTabs(role);
  return raw && (allowed as string[]).includes(raw) ? (raw as VaultTabId) : allowed[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Les lignes du trombinoscope
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultMemberRow extends VaultMemberDTO {
  /** L'adresse quand on a su la résoudre, l'identifiant sinon. Jamais vide. */
  label: string;
  isSelf: boolean;
  /** Puis-je retirer cette personne ? (rotation de clé — geste d'admin) */
  removable: boolean;
  /** Puis-je changer son rôle ici ? (jamais le propriétaire, jamais moi) */
  canChangeRole: boolean;
  /** Puis-je lui transmettre la propriété ? (propriétaire seul, jamais à soi) */
  transferable: boolean;
}

/**
 * La carte `userId → adresse`, dans l'ordre où l'on fait confiance aux sources.
 *
 * 1. L'ANNUAIRE de l'espace du coffre (P2) d'abord : il nomme aussi les gens
 *    qui ne sont pas encore dans le coffre, donc il est le seul à couvrir tout
 *    l'écran ;
 * 2. L'adresse portée par la ligne du coffre ensuite — c'est elle qui a fait
 *    disparaître les colonnes d'identifiants chez les invités, à qui l'annuaire
 *    reste fermé ;
 * 3. rien : l'appelant retombera sur l'identifiant.
 *
 * Un vieux Worker n'envoie ni l'un ni l'autre ; c'est prévu, et c'est pour ça
 * que `email` est optionnel dans le DTO.
 */
export function buildEmailIndex(
  directory: readonly SpaceDirectoryEntry[],
  members: readonly VaultMemberDTO[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of members) if (m.email) map[m.userId] = m.email;
  // L'annuaire écrase : posé en second, il gagne quand les deux répondent.
  for (const e of directory) if (e.email) map[e.userId] = e.email;
  return map;
}

/**
 * La carte `inviteId → adresse invitée` — ce qui permet au fil d'activité de
 * dire QUI a été invité.
 *
 * POURQUOI ELLE EXISTE, ET POURQUOI ELLE VIT CÔTÉ CLIENT. L'audit ne porte
 * JAMAIS d'adresse (règle dure de `audit.ts`) : le fil affichait donc « a invité
 * quelqu'un », cinq lignes indiscernables pour cinq invitations. Mais il porte
 * `metadata.invite_id`, et cette page a déjà lu les invitations du coffre, qui
 * portent leur identifiant ET leur adresse. La jointure se fait ici : le serveur
 * n'en apprend rien, et aucune adresse n'entre dans le journal.
 *
 * LES TROIS LISTES, ET PAS SEULEMENT LES VIVANTES. Une ligne du fil parle
 * souvent d'une invitation déjà réglée (« a repris l'invitation de … ») : ne
 * lire que `invites` laisserait anonymes précisément les événements qui
 * racontent une fin. La couverture reste bornée par ce que le serveur rend
 * (réglées 14 jours, échues 30) — au-delà, le fil garde sa formule sans nom
 * plutôt que d'inventer.
 */
export function buildInviteEmailIndex(
  ...listes: ReadonlyArray<readonly VaultInviteDTO[]>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const liste of listes) {
    // PREMIER ARRIVÉ, PREMIER SERVI : une même invitation ne peut pas figurer
    // dans deux listes (le serveur les partitionne par statut), et si cela
    // arrivait, la liste la plus fraîche est passée en premier par l'appelant.
    for (const i of liste) if (i.inviteeEmail && !map.has(i.id)) map.set(i.id, i.inviteeEmail);
  }
  return map;
}

/** Le libellé d'une personne, quelle que soit la source qui la nomme. */
export function displayName(userId: string, emailByUserId: Record<string, string>): string {
  return emailByUserId[userId] || userId;
}

export interface RosterContext {
  /** Mon identifiant de compte cloud — `null` si on ne le connaît pas encore. */
  myUserId: string | null;
  /** Mon rôle DANS CE COFFRE. */
  myRole: string;
}

/**
 * Les membres, fondus avec l'annuaire, triés par libellé.
 *
 * Les trois règles de capacité sont celles du serveur, reproduites telles
 * quelles :
 *  - un administrateur ne retire pas un propriétaire (le worker rend
 *    `vault_forbidden` sur `/rotate`) ;
 *  - personne ne change SON propre rôle — se rétrograder soi-même est le
 *    meilleur moyen de laisser un coffre sans personne pour le gérer — ni
 *    celui d'un propriétaire, dont la succession passe par le transfert ;
 *  - on ne se retire pas soi-même par ce bouton : « Quitter » est le geste, et
 *    il vit dans l'onglet Danger avec sa garde `last_owner`.
 */
export function buildMemberRows(
  members: readonly VaultMemberDTO[],
  emailByUserId: Record<string, string>,
  ctx: RosterContext
): VaultMemberRow[] {
  const admin = isAdmin(ctx.myRole);
  return [...members]
    .map((m) => {
      const isSelf = ctx.myUserId !== null && m.userId === ctx.myUserId;
      return {
        ...m,
        label: displayName(m.userId, emailByUserId),
        isSelf,
        removable: admin && !isSelf && (m.role !== 'owner' || ctx.myRole === 'owner'),
        canChangeRole: admin && !isSelf && m.role !== 'owner',
        transferable: ctx.myRole === 'owner' && !isSelf && m.role !== 'owner',
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Les gens de l'espace qui ne sont PAS dans le coffre — ce que l'ancien écran
 * ne montrait nulle part, alors que c'est exactement la question posée (« il
 * est dans mon espace, pourquoi n'a-t-il pas accès ? »).
 *
 * Rend une liste VIDE quand l'annuaire n'a pas pu être lu : on n'affirme rien
 * à partir d'une absence d'information (« terminal ≠ jetable »). C'est
 * `DirectoryNotice` qui dit alors qu'on n'a pas su lire.
 */
export function outsidersInSpace(
  directory: readonly SpaceDirectoryEntry[],
  members: readonly VaultMemberDTO[]
): SpaceDirectoryEntry[] {
  const known = new Set(members.map((m) => m.userId));
  return directory.filter((e) => !known.has(e.userId));
}

/**
 * Combien de membres par rôle — la ventilation de l'Aperçu. Un rôle absent
 * vaut zéro ; on ne fabrique pas de clés pour des rôles que le coffre n'a pas.
 */
export function countByRole(members: readonly VaultMemberDTO[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of members) out[m.role] = (out[m.role] ?? 0) + 1;
  return out;
}

/** L'état de gel prêt à être publié dans Redux (`vaultFreezeState`). */
export interface VaultFreezeFacts {
  vaultId: string;
  frozenAt: string | null;
  frozenBy: string | null;
}

/**
 * LE GEL QU'ON TIENT DÉJÀ DANS LA MAIN (F23).
 *
 * `frozenAt` n'entrait dans Redux que par `loadVaults` — qui ne repasse jamais
 * de lui-même — et par le réducteur que dispatche celui qui vient de cliquer sur
 * « Geler ». Autrement dit : le bandeau et le retrait des boutons ne servaient
 * qu'à l'AUTEUR du gel. Un second admin ouvrait « Gérer le coffre » et voyait
 * « non gelé », alors que la réponse fraîche de `GET /vaults/:id` — déjà chargée
 * pour y lire la conservation légale — portait la vérité.
 *
 * `null` QUAND ON N'A RIEN LU, et ce n'est pas un détail : `apiGetVault` avale
 * son propre échec et rend `null`. Le traduire en « pas gelé » effacerait un
 * bandeau vrai sur une panne de réseau — la règle du dossier, encore : jamais un
 * verdict tiré d'un silence. Un DTO SANS les colonnes (worker d'avant le gel)
 * est un cas différent : le coffre a bien été lu, et il n'est pas gelé pour ce
 * serveur-là.
 */
export function freezeStateFromVault(
  vaultId: string,
  vault: { frozenAt?: string | null; frozenBy?: string | null } | null | undefined
): VaultFreezeFacts | null {
  if (!vault) return null;
  return { vaultId, frozenAt: vault.frozenAt ?? null, frozenBy: vault.frozenBy ?? null };
}
