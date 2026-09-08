/**
 * inviteLifecycleModel — LA VIE ENTIÈRE D'UNE INVITATION DE COFFRE, sans React,
 * sans réseau, sans traduction (F03).
 *
 * LE DÉFAUT QU'IL FERME. `listVaultInvites` filtre `expires_at > now` et
 * l'accusé des quatorze jours ne liste que `accepted|declined` : une invitation
 * expirée et une personne jamais invitée rendaient EXACTEMENT le même écran vide
 * chez l'hôte. C'est cette indiscernabilité qui a fait conclure à un accès perdu
 * (cas du 28/08) là où il n'y avait qu'un lien à réémettre.
 *
 * TROIS DÉCISIONS VIVENT ICI, et aucune ne se voit à la compilation :
 *
 *  1. QUAND une ligne est ÉCHUE. Le serveur le dit — `expired`, `revoked` — mais
 *     il ne le dit qu'après le passage de son balayage. Entre la péremption et
 *     le cron, la ligne reste `pending` avec une date passée : le verdict est
 *     donc AUSSI dérivé côté client, sans quoi l'écran affiche « expire le … »
 *     au passé, avec un bouton « Relancer » à côté.
 *
 *  2. QUAND « Relancer » est un MENSONGE. Une invitation scellée sous une époque
 *     révolue ne s'ouvrira jamais : l'époque d'un coffre ne fait que monter
 *     (`rotateVaultKey` : `newEpoch = prevEpoch + 1`, posé par compare-and-set)
 *     tandis que celle du scellé est figée à l'émission. Le serveur répond
 *     `invite_stale_epoch`, et réessayer ne peut que reproduire le même refus :
 *     le bouton doit dire « Réémettre ».
 *
 *  3. QUELLE ACTION propose une ligne échue. Réinviter directement (la personne
 *     est dans l'espace : on scelle sur-le-champ) ou l'inviter à nouveau DANS
 *     l'espace. Et quand l'annuaire n'a pas pu être lu, on ne devine PAS : le
 *     silence de la lecture faisait passer tout le monde pour un nouveau venu.
 *
 * AUCUNE DATE N'EST FABRIQUÉE. Deux formats circulent (l'ISO d'`expiresAt`, le
 * `'YYYY-MM-DD HH:MM:SS'` UTC de `settledAt`) et une valeur illisible rend
 * `null` plutôt qu'un `NaN` qu'un `toLocaleDateString` afficherait en « Invalid
 * Date ».
 */

import type { SpaceDirectoryEntry, VaultInviteDTO } from '../../../../services/vault/vaultApi';
import type { DirectoryState } from '../spaceDirectory';
import { isAssignableVaultRole, type AssignableVaultRole } from '../../sharing/shareDialogModel';

/** Le seuil « expire bientôt » : deux jours, comme la pastille orange du plan. */
export const EXPIRING_SOON_MS = 48 * 60 * 60 * 1000;

/** Le format que SQLite écrit (`datetime('now')`) : de l'UTC, sans le dire. */
const SQLITE_INSTANT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

/**
 * Un instant en millisecondes, quel que soit le format reçu — `null` si on ne
 * sait pas lire.
 *
 * `settledAt` arrive en `'YYYY-MM-DD HH:MM:SS'` : passé tel quel à `Date.parse`,
 * un navigateur le lit en heure LOCALE et la date affichée glisse d'un fuseau.
 * C'est de l'UTC, et on le lui dit. `expiresAt` / `createdAt` sont déjà ISO.
 */
export function parseInstant(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = SQLITE_INSTANT.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

/** Pourquoi une invitation est retombée — deux phrases, deux gestes différents. */
export type LapsedCause = 'expired' | 'revoked';

/**
 * Ce qu'il faut faire pour redonner sa chance à quelqu'un.
 *
 * `reinvite` : la personne est dans l'espace, on scelle K_vault sur-le-champ
 * après la cérémonie d'empreinte. `reinviteToSpace` : elle n'y est plus, il faut
 * la réinviter DANS l'espace avec l'intention (0073). `unknown` : l'annuaire
 * n'a pas pu être lu — on ne propose rien plutôt que de proposer à côté.
 */
export type ReissueKind = 'reinvite' | 'reinviteToSpace' | 'unknown';

export interface ReissuePlan {
  kind: ReissueKind;
  /** Le compte visé, quand l'annuaire l'a nommé. Seul `reinvite` en a un. */
  userId: string | null;
}

/** Ce que toutes les lignes partagent, quelle que soit leur section. */
export interface InviteRowBase {
  invite: VaultInviteDTO;
  /** L'adresse, telle qu'elle a été tapée par l'hôte. */
  email: string;
  /** Le rôle de coffre voulu, ramené à ce que le serveur accepte. */
  role: AssignableVaultRole;
  /** L'instant qui compte pour CETTE section (péremption ou règlement). */
  atMs: number | null;
  /** Le scellé date-t-il d'une époque révolue ? (jamais affirmé sans le champ) */
  staleEpoch: boolean;
  /** Ce qu'on peut faire pour cette personne, selon l'annuaire. */
  action: ReissuePlan;
}

export interface PendingInviteRow extends InviteRowBase {
  /** Expire dans moins de 48 h — la pastille orange. */
  urgent: boolean;
}

export interface SettledInviteRow extends InviteRowBase {
  /** `accepted` ou `declined` : le sort que l'accusé rapporte. */
  status: string;
}

export interface LapsedInviteRow extends InviteRowBase {
  cause: LapsedCause;
}

/**
 * Une invitation est-elle retombée ?
 *
 * Le serveur le dit pour les deux premiers cas ; le troisième est la fenêtre
 * entre la péremption et le passage du cron, où la ligne est encore `pending`.
 * Une date ILLISIBLE ne conclut rien : on ne déclare pas morte une invitation
 * qu'un vieux worker aurait mal datée.
 */
export function isLapsed(invite: VaultInviteDTO, nowMs: number): boolean {
  if (invite.status === 'expired' || invite.status === 'revoked') return true;
  if (invite.status !== 'pending') return false;
  const ms = parseInstant(invite.expiresAt);
  return ms !== null && ms <= nowMs;
}

/** Reprise volontaire ou simple péremption — deux phrases distinctes à l'écran. */
export function lapsedCause(invite: VaultInviteDTO): LapsedCause {
  return invite.status === 'revoked' ? 'revoked' : 'expired';
}

/**
 * Le scellé de cette invitation est-il d'une époque révolue ?
 *
 * L'ABSENCE DU CHAMP N'EST PAS UN ZÉRO. Un worker d'avant F03 ne l'envoie pas ;
 * le lire comme zéro marquerait « à réémettre » toutes les invitations d'un
 * coffre qui a tourné une fois, et remplacerait un bouton qui marche par un
 * bouton qui refait tout le travail.
 */
export function isStaleEpoch(invite: VaultInviteDTO, currentKeyEpoch: number): boolean {
  return typeof invite.wrappedVaultKeyEpoch === 'number'
    ? invite.wrappedVaultKeyEpoch < currentKeyEpoch
    : false;
}

const canon = (email: string): string => email.trim().toLowerCase();

/**
 * Ce qu'on peut proposer pour cette adresse, d'après l'annuaire de l'espace.
 *
 * L'ÉTAT DE LA LECTURE DÉCIDE AVANT SON CONTENU. Un annuaire refusé (403 : la
 * route est réservée, et un admin de coffre invité chez quelqu'un d'autre y a
 * droit depuis P2, mais la panne reste possible) rend une liste vide, qui se
 * lirait « cette personne n'est pas dans l'espace » — le défaut d'origine, celui
 * qui proposait une invitation d'espace à des gens qui y étaient déjà.
 */
export function reissueAction(
  email: string,
  directory: readonly SpaceDirectoryEntry[],
  directoryState: DirectoryState
): ReissuePlan {
  if (directoryState !== 'ok') return { kind: 'unknown', userId: null };
  const target = canon(email);
  const entry = directory.find((e) => canon(e.email) === target);
  return entry
    ? { kind: 'reinvite', userId: entry.userId }
    : { kind: 'reinviteToSpace', userId: null };
}

/** Le rôle de coffre voulu, ramené à ce que le serveur accepte. */
function reissueRole(raw: string): AssignableVaultRole {
  // Moindre privilège sur l'inconnu : réémettre en « lecteur » se corrige d'un
  // menu, réémettre en « administrateur » donne des droits que personne n'a
  // demandés.
  return isAssignableVaultRole(raw) ? raw : 'viewer';
}

export interface GroupInvitesInput {
  /** Les invitations que le serveur tient pour vivantes. */
  invites: readonly VaultInviteDTO[];
  /** L'accusé des quatorze jours (`include=settled`). */
  settled: readonly VaultInviteDTO[];
  /** Les échues des trente jours (`include=lapsed`). */
  lapsed: readonly VaultInviteDTO[];
  nowMs: number;
  currentKeyEpoch: number;
  directory: readonly SpaceDirectoryEntry[];
  directoryState: DirectoryState;
}

export interface InviteGroups {
  pending: PendingInviteRow[];
  settled: SettledInviteRow[];
  lapsed: LapsedInviteRow[];
  /** Combien de lignes en attente meurent sous 48 h — le compteur de l'Aperçu. */
  expiringSoon: number;
  /** Combien de lignes en attente sont à réémettre (époque révolue). */
  toReissue: number;
  /**
   * L'INSTANT DONT CES SECTIONS SONT DATÉES — publié, pas gardé pour soi.
   *
   * Tout ce que rend cette fonction (« échue ou en attente », « expire sous
   * 48 h ») est un verdict PRIS À UN INSTANT, et l'écran le garde tant que les
   * listes ne changent pas. Ce qui s'affiche SOUS une ligne — la frise, qui
   * applique la même règle — doit donc lire la même horloge : relire
   * `Date.now()` au rendu suivant faisait dire « Expirée » à la frise sous une
   * ligne toujours rangée dans « En attente », avec sa pastille orange et son
   * bouton « Prolonger ». Une même règle nourrie de deux instants rend deux
   * verdicts ; l'instant voyage donc avec le résultat.
   */
  nowMs: number;
}

/**
 * Les trois sections de l'onglet Invitations, prêtes à rendre.
 *
 * DEUX SOURCES SE RECOUVRENT, ET C'EST VOULU. Le worker range les `pending`
 * déjà périmées dans `lapsed` ; le client, lui, les repère aussi dans
 * `invites` (il ne dépend donc pas du cron pour dire la vérité). L'union est
 * dédoublonnée PAR IDENTIFIANT : sans cela, la même ligne s'afficherait dans
 * deux sections, ce qui laisserait croire à deux invitations.
 */
export function groupInvites(input: GroupInvitesInput): InviteGroups {
  const { nowMs, currentKeyEpoch, directory, directoryState } = input;

  const base = (invite: VaultInviteDTO, atMs: number | null): InviteRowBase => ({
    invite,
    email: invite.inviteeEmail,
    role: reissueRole(invite.role),
    atMs,
    staleEpoch: isStaleEpoch(invite, currentKeyEpoch),
    action: reissueAction(invite.inviteeEmail, directory, directoryState),
  });

  const pending: PendingInviteRow[] = [];
  /** Les échues, indexées pour que les deux sources ne se doublent pas. */
  const lapsedById = new Map<string, VaultInviteDTO>();

  for (const invite of input.invites) {
    if (isLapsed(invite, nowMs)) {
      lapsedById.set(invite.id, invite);
      continue;
    }
    const expiresMs = parseInstant(invite.expiresAt);
    pending.push({
      ...base(invite, expiresMs),
      urgent: expiresMs !== null && expiresMs - nowMs <= EXPIRING_SOON_MS,
    });
  }
  for (const invite of input.lapsed) {
    if (!lapsedById.has(invite.id)) lapsedById.set(invite.id, invite);
  }

  const lapsed: LapsedInviteRow[] = [...lapsedById.values()]
    .map((invite) => ({
      // La date qui compte est celle du RÈGLEMENT quand on l'a (une révocation
      // n'a pas attendu sa péremption pour arriver), la péremption sinon.
      ...base(invite, parseInstant(invite.settledAt) ?? parseInstant(invite.expiresAt)),
      cause: lapsedCause(invite),
    }))
    // Les plus récentes d'abord : c'est celles-là qu'on vient rattraper. Une
    // date manquante finit la liste plutôt que de sauter en tête.
    .sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0));

  const settled: SettledInviteRow[] = input.settled.map((invite) => ({
    ...base(invite, parseInstant(invite.settledAt)),
    status: invite.status,
  }));

  return {
    pending,
    settled,
    lapsed,
    expiringSoon: pending.filter((r) => r.urgent).length,
    toReissue: pending.filter((r) => r.staleEpoch).length,
    // L'instant qui a servi à TOUT ce qui précède, rendu tel quel : c'est lui
    // que la frise de chaque ligne emprunte.
    nowMs,
  };
}
