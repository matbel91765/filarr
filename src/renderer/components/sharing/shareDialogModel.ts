/**
 * shareDialogModel — la partie PURE du dialogue de partage unifié (ShareDialog).
 *
 * POURQUOI UN MODULE À PART. Le dialogue compose des briques existantes
 * (cérémonie d'empreinte, corps de partage par personne, boîtes de lien,
 * ajout au coffre) et n'a d'original que ses DÉCISIONS : quelles sections
 * montrer pour quelle cible et quel rôle, et — surtout — laquelle des deux
 * voies d'invitation prendre quand l'hôte tape une adresse. Ces décisions sont
 * exactement ce qui ne se voit pas à la compilation (un booléen inversé compile
 * très bien) et ce qui coûterait cher : proposer une invitation d'espace à
 * quelqu'un qui y est déjà, ou une cérémonie de scellement pour quelqu'un dont
 * on ne peut pas résoudre la clé. Ce fichier n'importe ni React, ni Redux, ni
 * le réseau : il s'éprouve sous vitest-node tel quel.
 *
 * La matrice de droits n'est PAS redite ici : `isVaultAdminRole` et
 * `canEditVault` viennent de `vaultExplorerModel`, la même que celle des menus
 * et du serveur. Deux matrices finiraient par diverger.
 */

import type { FileItem } from '../../../types';
import type { VaultItemSummary } from '../../../store/slices/vaultsSlice';
import type {
  SpaceDirectoryEntry,
  VaultMemberDTO,
  VaultSeatsDTO,
} from '../../../services/vault/vaultApi';
import type { BlockedEntry } from '../../../services/vault/pendingGrantSweep';
import { isVaultAdminRole, canEditVault } from '../vaults/vaultExplorerModel';

// ─────────────────────────────────────────────────────────────────────────────
// La cible — discriminée, jamais devinée
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ce sur quoi le dialogue s'ouvre. Quatre natures, parce que les quatre ne se
 * partagent pas par les mêmes voies : un coffre se partage par ADHÉSION, un
 * élément de coffre par GRANT ou par lien, un fichier personnel par lien ou en
 * entrant dans un coffre, une note personnelle UNIQUEMENT en entrant dans un
 * coffre (il n'existe pas de lien public pour une note).
 */
export type ShareTarget =
  | { kind: 'vault'; vaultId: string }
  | { kind: 'vaultItem'; vaultId: string; item: VaultItemSummary; itemName: string }
  /**
   * PLUSIEURS éléments d'un même coffre — un dossier (ses descendants,
   * fichiers seulement) ou une sélection. Le grant reste par élément : le
   * dialogue scelle chacun en séquence (`createItemGrants`). `name` est ce que
   * l'en-tête affiche (le nom du dossier, ou « N éléments »). `basePath` est le
   * dossier d'où part le lot (le dossier partagé, ou le dossier courant d'une
   * sélection) : le choix des éléments s'y groupe par sous-dossier RELATIF ;
   * absent, le dialogue prend le préfixe commun.
   */
  | {
      kind: 'vaultItems';
      vaultId: string;
      items: VaultItemSummary[];
      name: string;
      basePath?: string;
    }
  | { kind: 'personalFile'; file: FileItem; folderId: string }
  | { kind: 'personalNote'; noteId: string; name: string };

/** Le nom qu'affiche l'en-tête, quelle que soit la nature de la cible. */
export function shareTargetName(target: ShareTarget, vaultName: string, untitled: string): string {
  switch (target.kind) {
    case 'vault':
      return vaultName || untitled;
    case 'vaultItem':
      return target.itemName || untitled;
    case 'vaultItems':
      return target.name || untitled;
    case 'personalFile':
      return target.file.name || untitled;
    default:
      return target.name || untitled;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Les sections — quoi montrer à qui
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareDialogContext {
  /** Hors nuage, RIEN ne se partage : le dialogue ne s'ouvre même pas. */
  accountMode: 'local' | 'cloud';
  /** Mon rôle dans le coffre concerné (cibles `vault` / `vaultItem`) ; ignoré sinon. */
  myRole: string;
  /**
   * Au moins un coffre déverrouillé où je peux écrire MAINTENANT
   * (`writableAddTargets` sur `useVaultAddTargets`). Les coffres GELÉS n'y
   * comptent pas : la section s'ouvrirait sur une boîte dont aucune destination
   * n'est sélectionnable.
   */
  hasAddTargets: boolean;
  /** Politique d'org : aucun lien de partage externe. */
  externalSharesDisabled: boolean;
}

/**
 * Les sections du dialogue. Une section absente = « cette voie n'existe pas
 * pour cette cible / ce rôle » — on RETIRE plutôt que de griser, comme le menu
 * contextuel : un bloc grisé invite à chercher pourquoi, un bloc absent dit
 * simplement que ce rôle consulte.
 */
export interface ShareDialogSections {
  /** INVITER dans le coffre (adresse + rôle + cérémonie inline). Admin/owner. */
  invite: boolean;
  /** PERSONNES AYANT ACCÈS au coffre (membres + invitations en attente). */
  people: boolean;
  /** Partage d'UN élément de coffre avec UNE personne (grant K_item). Admin/owner. */
  itemGrant: boolean;
  /** Lien public — instantané, ne suit pas les éditions. */
  link: boolean;
  /** « Ajouter au coffre partagé… » — la voie d'entrée des contenus personnels. */
  addToVault: boolean;
  /** « Voir l'activité » du coffre (pied). */
  activity: boolean;
  /** « Paramètres avancés » → NAVIGUE vers la page « Gérer le coffre » (pied). Coffre seul. */
  advanced: boolean;
}

const NO_SECTIONS: ShareDialogSections = {
  invite: false,
  people: false,
  itemGrant: false,
  link: false,
  addToVault: false,
  activity: false,
  advanced: false,
};

export function shareDialogSections(
  target: ShareTarget,
  ctx: ShareDialogContext
): ShareDialogSections {
  // Règle 13 : en mode local, tout ce qui touche au partage se rend nul.
  if (ctx.accountMode !== 'cloud') return NO_SECTIONS;

  switch (target.kind) {
    case 'vault': {
      const admin = isVaultAdminRole(ctx.myRole);
      return {
        ...NO_SECTIONS,
        invite: admin,
        people: true,
        activity: true,
        advanced: true,
      };
    }
    case 'vaultItem': {
      const admin = isVaultAdminRole(ctx.myRole);
      const isFile = target.item.itemType === 'file';
      return {
        ...NO_SECTIONS,
        // Même règle que `vaultFileCaps.shareWithPerson` : un marqueur de
        // dossier n'est pas un contenu, il ne se partage pas.
        itemGrant: admin && !target.item.meta.folderMarker,
        // Même règle que `vaultFileCaps.share` : un fichier, un rôle qui écrit,
        // et une org qui n'interdit pas les liens externes.
        link: isFile && canEditVault(ctx.myRole) && !ctx.externalSharesDisabled,
        activity: true,
      };
    }
    case 'vaultItems': {
      // Un LOT (dossier, sélection) : le partage par personne seulement — un
      // lien public porte sur UN élément, il n'existe pas pour un lot. Vide,
      // le lot n'a rien à sceller : la section ne s'affiche pas.
      const admin = isVaultAdminRole(ctx.myRole);
      const shareable = target.items.filter((i) => !i.meta.folderMarker);
      return {
        ...NO_SECTIONS,
        itemGrant: admin && shareable.length > 0,
        activity: true,
      };
    }
    case 'personalFile':
      return {
        ...NO_SECTIONS,
        link: !ctx.externalSharesDisabled,
        addToVault: ctx.hasAddTargets,
      };
    default:
      // Une note personnelle n'a PAS de lien public : le coffre partagé est sa
      // seule voie de partage — et le dialogue le dit en toutes lettres.
      return { ...NO_SECTIONS, addToVault: ctx.hasAddTargets };
  }
}

/** Le dialogue a-t-il quelque chose à montrer ? (Sinon l'entrée de menu ment.) */
export function hasAnyShareSection(sections: ShareDialogSections): boolean {
  return Object.values(sections).some(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// L'invitation — UNE ligne, DEUX voies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Où mène l'adresse que l'hôte vient de taper.
 *
 *  - `member`  : la personne est DÉJÀ dans l'espace → on peut résoudre sa clé,
 *                la cérémonie d'empreinte se déplie sous la ligne et le
 *                scellement (thunk `inviteMember`) part avec `sealArgs` ;
 *  - `newcomer`: personne de l'espace ne porte cette adresse → invitation
 *                d'ESPACE avec intention (0073), aucune cérémonie maintenant :
 *                le balayage scellera quand la clé deviendra résolvable ;
 *  - `inVault` : la personne a déjà accès à CE coffre — rien à envoyer, et le
 *                dire vaut mieux qu'un `already_member` du serveur ;
 *  - `empty`   : rien de tapé (ou pas une adresse) — pas de bouton actif.
 *
 * La comparaison est insensible à la casse et aux espaces : c'est ce que fait
 * le serveur en normalisant l'e-mail à l'invitation.
 *
 * L'ANNUAIRE NE REND QUE DES ACTIFS (P2) : le filtre `status === 'active'` qui
 * vivait ici a disparu avec la source qui l'imposait. `GET /vaults/:id/directory`
 * écarte les suspendus et les seulement-invités côté serveur, là où le statut
 * d'espace est un fait ; ce modèle n'a donc plus à connaître ce vocabulaire, et
 * ne demande que les deux champs dont il se sert. Une entrée absente de
 * l'annuaire — inactive, ou tout simplement inconnue — reste un `newcomer`, et
 * c'est le serveur qui tranchera.
 */
export type InviteRoute =
  | { kind: 'member'; member: SpaceDirectoryEntry }
  | { kind: 'newcomer'; email: string }
  | { kind: 'inVault'; member: SpaceDirectoryEntry }
  | { kind: 'empty' };

/**
 * La même chose, PLUS l'aveu d'ignorance.
 *
 * `unknown` : l'annuaire de l'espace n'a pas pu être lu (P2 — 403 pour un admin
 * de coffre invité, ou simple panne). Sans lui, « cette personne est nouvelle »
 * est une AFFIRMATION qu'on n'a pas les moyens de faire : c'est exactement le
 * silence qui transformait tout le monde en nouveau venu et proposait une
 * invitation d'espace à des gens qui y étaient déjà. On ne route donc pas à
 * l'aveugle — la ligne le dit et propose de relire.
 */
export type InviteRouteEx = InviteRoute | { kind: 'unknown' };

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/** Assez pour distinguer « une adresse » d'un mot : le serveur valide le reste. */
const looksLikeEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function inviteRoute(
  rawEmail: string,
  directory: readonly SpaceDirectoryEntry[],
  vaultMemberUserIds: ReadonlySet<string> | readonly string[]
): InviteRoute {
  const email = normalizeEmail(rawEmail);
  if (!email || !looksLikeEmail(email)) return { kind: 'empty' };
  const inVault =
    vaultMemberUserIds instanceof Set
      ? vaultMemberUserIds
      : new Set(vaultMemberUserIds as readonly string[]);
  const member = directory.find((m) => !!m.email && normalizeEmail(m.email) === email);
  if (!member) return { kind: 'newcomer', email };
  if (inVault.has(member.userId)) return { kind: 'inVault', member };
  return { kind: 'member', member };
}

/**
 * Le routage, sachant CE QU'ON SAIT de l'annuaire.
 *
 * Trois règles, dans cet ordre, et l'ordre est le fond du sujet :
 *  1. rien de tapé (ou pas encore une adresse) reste `empty` QUOI QU'IL ARRIVE :
 *     un champ vide n'a aucune raison de porter un message alarmant sur un
 *     annuaire qu'on ne lui a pas encore demandé de lire ;
 *  2. quelqu'un que la liste du COFFRE connaît déjà reste `inVault` : ce fait-là
 *     ne vient pas de l'annuaire mais de `/members`, et il reste vrai ;
 *  3. tout le reste, annuaire illisible, devient `unknown` — jamais `newcomer`.
 *     Le prix de la prudence est un bouton en moins le temps d'une relecture ;
 *     le prix de l'inverse était une invitation d'espace envoyée à quelqu'un qui
 *     y était déjà, avec un 409 pour toute explication.
 */
export function inviteRouteWithDirectory(
  rawEmail: string,
  directory: readonly SpaceDirectoryEntry[],
  directoryState: 'ok' | 'forbidden' | 'unavailable',
  vaultMemberUserIds: ReadonlySet<string> | readonly string[]
): InviteRouteEx {
  const route = inviteRoute(rawEmail, directory, vaultMemberUserIds);
  if (route.kind === 'empty' || route.kind === 'inVault') return route;
  return directoryState === 'ok' ? route : { kind: 'unknown' };
}

/**
 * Le plafond de sièges de l'espace, lu AVANT tout refus — le patron
 * d'InviteMemberModal. Une vraie org ne rapporte pas de `memberLimit` (son
 * plafond, ce sont ses sièges achetés) : tout ce bloc est donc « perso
 * seulement ». Consultatif : le serveur refuse de toute façon ; l'intérêt est
 * de proposer la montée d'offre AVANT qu'une invitation ne soit brûlée.
 */
export interface SeatGate {
  memberLimit: number | null;
  /**
   * L'OCCUPATION TELLE QUE LE SERVEUR LA COMPTE POUR REFUSER : membres actifs
   * PLUS invitations d'espace encore vivantes. Le serveur ne rendait que les
   * membres jusqu'au 30/08 — d'où « 2 personnes sur 3 », bouton actif, et un
   * bandeau rouge « votre offre est pleine » APRÈS le clic.
   */
  membersUsed: number | null;
  /** Le détail, pour l'EXPLIQUER. `null` sur un worker d'avant le correctif. */
  activeMembers: number | null;
  /**
   * Les invitations parties dont personne n'a encore répondu. Chacune tient une
   * place, et chacune se rend d'un clic depuis l'onglet Invitations : c'est la
   * sortie immédiate, celle qu'il faut nommer avant la montée d'offre.
   */
  pendingInvites: number | null;
  /** Vrai seulement quand les DEUX nombres sont connus et que le plafond est atteint. */
  spaceFull: boolean;
}

export function seatGate(seats: VaultSeatsDTO | null): SeatGate {
  const nombre = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const memberLimit = nombre(seats?.memberLimit);
  const membersUsed = nombre(seats?.membersUsed);
  return {
    memberLimit,
    membersUsed,
    activeMembers: nombre(seats?.activeMembers),
    pendingInvites: nombre(seats?.pendingInvites),
    spaceFull: memberLimit !== null && membersUsed !== null && membersUsed >= memberLimit,
  };
}

/**
 * L'invitation d'ESPACE consomme un siège ; le scellement à quelqu'un qui y est
 * déjà n'en consomme aucun. Le plafond ne bloque donc que la voie `newcomer`.
 */
export function inviteBlockedBySeats(route: InviteRouteEx, gate: SeatGate): boolean {
  return route.kind === 'newcomer' && gate.spaceFull;
}

/**
 * Les blocages du balayage (0073) qui concernent CE coffre : ce que l'hôte doit
 * encore vérifier à la main. Un même compte est souvent l'hôte de plusieurs
 * coffres — la liste globale se filtre ici.
 */
export function blockedGrantsForVault(
  blocked: readonly BlockedEntry[],
  vaultId: string
): BlockedEntry[] {
  return blocked.filter((b) => b.vaultId === vaultId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Les personnes ayant accès — qui peut changer quoi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qui peut changer le rôle de qui — les MÊMES exclusions que la page « Gérer le
 * coffre » (`vaultManagementModel.buildMemberRows`).
 * Un propriétaire ne se change pas ici (sa succession passe par le transfert,
 * qui promeut et rétrograde d'un seul geste) et personne ne change son PROPRE
 * rôle : se rétrograder soi-même est le meilleur moyen de laisser un coffre
 * sans personne pour le gérer. Le serveur refuse les deux (`selfRoleChange`).
 */
export function canChangeVaultMemberRole(
  member: Pick<VaultMemberDTO, 'userId' | 'role'>,
  myUserId: string | null,
  myRole: string
): boolean {
  return isVaultAdminRole(myRole) && member.role !== 'owner' && member.userId !== myUserId;
}

/**
 * Qui peut retirer qui — la règle de la page « Gérer le coffre » : un
 * administrateur ne retire pas un propriétaire, seul un propriétaire le peut ;
 * et personne ne se retire soi-même par ce geste (c'est « quitter »).
 */
export function canRemoveVaultMember(
  member: Pick<VaultMemberDTO, 'userId' | 'role'>,
  myUserId: string | null,
  myRole: string
): boolean {
  return (
    isVaultAdminRole(myRole) &&
    member.userId !== myUserId &&
    (member.role !== 'owner' || myRole === 'owner')
  );
}

/** Les rôles proposés à l'invitation et au changement de rôle — jamais `owner`. */
export const ASSIGNABLE_VAULT_ROLES = ['member', 'viewer', 'admin'] as const;
export type AssignableVaultRole = (typeof ASSIGNABLE_VAULT_ROLES)[number];

export const isAssignableVaultRole = (v: string): v is AssignableVaultRole =>
  (ASSIGNABLE_VAULT_ROLES as readonly string[]).includes(v);

/** Une ligne de la liste d'accès, triée : moi d'abord, puis par libellé. */
export interface AccessRow extends VaultMemberDTO {
  /**
   * L'e-mail quand on l'a, sinon l'identifiant. DEUX sources, dans cet ordre :
   * l'annuaire d'espace quand il est lisible (il couvre aussi les invitations
   * en attente), puis l'adresse que la ligne du coffre porte elle-même depuis
   * P2 — celle-là arrive à TOUT membre, y compris un lecteur à qui l'annuaire
   * est fermé, et c'est ce qui a fait disparaître les colonnes d'identifiants.
   */
  label: string;
  isSelf: boolean;
  canChangeRole: boolean;
  canRemove: boolean;
}

export function buildAccessRows(
  members: readonly VaultMemberDTO[],
  emailByUserId: Readonly<Record<string, string>>,
  myUserId: string | null,
  myRole: string
): AccessRow[] {
  return [...members]
    .map((m) => ({
      ...m,
      label: emailByUserId[m.userId] || m.email || m.userId,
      isSelf: m.userId === myUserId,
      canChangeRole: canChangeVaultMemberRole(m, myUserId, myRole),
      canRemove: canRemoveVaultMember(m, myUserId, myRole),
    }))
    .sort((a, b) => {
      // Moi en tête : c'est le repère depuis lequel on lit les autres.
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}
