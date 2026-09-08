/**
 * vaultActivityModel — le fil d'activité, sans React ni réseau.
 *
 * DEUX RÈGLES DURES :
 *   · le curseur « vu » se compare en COUPLE (occurredAt, id) — jamais
 *     occurredAt seul : deux évènements à la même milliseconde sont départagés
 *     par id, exactement comme le keyset serveur ;
 *   · les clés i18n sont à UNDERSCORES (`member_invite_revoke`) : la taxonomie
 *     réelle contient la paire member.invite / member.invite.revoke, qui rend
 *     la forme imbriquée impossible (« invite » devrait être à la fois une
 *     chaîne et un objet — i18next n'a pas de self-value).
 *
 * LE SERVEUR NE DONNE JAMAIS D'ADRESSE, et c'est une décision (metadata-only),
 * pas une lacune : l'audit ne porte que `invite_id`. Le fil affichait donc « a
 * invité quelqu'un » — cinq lignes indiscernables pour cinq invitations, sans
 * aucun moyen de savoir laquelle avait été reprise.
 *
 * LA JOINTURE SE FAIT ICI, ET NULLE PART AILLEURS. Le client connaît déjà les
 * invitations du coffre (elles portent leur identifiant ET leur adresse) : il
 * peut donc nommer la personne sans que le serveur en apprenne quoi que ce soit,
 * et sans qu'une seule adresse entre dans le journal. C'est la même adresse que
 * les onglets Membres et Invitations affichent en clair juste à côté.
 *
 * ET QUAND L'INVITATION N'EST PLUS CONNUE, ON NE DEVINE PAS. Les invitations ne
 * sont lues que sur une fenêtre (réglées 14 jours, échues 30) et trois écrans
 * partagent ce modèle sans toutes les avoir : l'index est donc OPTIONNEL, et son
 * absence vaut « je ne sais pas », jamais « personne ». La formule sans nom
 * reste alors entière — c'est la règle de tout ce dossier, ne jamais tirer un
 * verdict d'une absence d'information.
 */

import type { VaultActivityEventDTO } from '../../../services/vault/vaultApi';

export interface SeenCursor {
  occurredAt: number;
  id: number;
}

/** `e` est-il postérieur au dernier point vu ? (couple, jamais le temps seul) */
export function isNewer(e: { occurredAt: number; id: number }, seen: SeenCursor | null): boolean {
  if (!seen) return true;
  if (e.occurredAt !== seen.occurredAt) return e.occurredAt > seen.occurredAt;
  return e.id > seen.id;
}

/** Le badge : combien de lignes de CETTE page sont neuves (borné à la page). */
export function unseenCount(
  events: Array<{ occurredAt: number; id: number }>,
  seen: SeenCursor | null
): number {
  return events.filter((e) => isNewer(e, seen)).length;
}

export interface ActivityRowContext {
  emailByUserId: Map<string, string>;
  nameByItemId: Map<string, string>;
  /**
   * L'adresse de chaque invitation CONNUE du client, par identifiant. Optionnel
   * : le volet de l'explorateur et la modale du clic droit rendent le même fil
   * sans avoir chargé les invitations. Absent ⇒ aucune ligne n'est nommée, et
   * c'est le bon comportement — pas un repli dégradé.
   */
  emailByInviteId?: ReadonlyMap<string, string>;
}

/**
 * LES CINQ ÉVÉNEMENTS QUI PARLENT D'UNE INVITATION, et la liste est FERMÉE.
 *
 * Ce sont exactement ceux dont l'allowlist de métadonnées (`audit.ts`) porte
 * `invite_id`, et exactement ceux dont le libellé existe en version nommée. La
 * dériver au hasard d'un `invite_id` croisé ailleurs fabriquerait une clé i18n
 * inexistante — que le composant rendrait telle quelle, en toutes lettres.
 */
const EVENEMENTS_D_INVITATION: ReadonlySet<string> = new Set([
  'member.invite',
  'member.invite.revoke',
  'member.invite.resend',
  'member.invite.decline',
  'member.invite.auto_resend',
]);

export interface ActivityRow {
  i18nKey: string;
  params: Record<string, string | number>;
  /** item_id dont le nom n'a pas pu être résolu — le COMPOSANT décide du
   *  fallback (« un élément supprimé » + id tronqué), pas le modèle. */
  unresolvedItemId: string | null;
}

function actorLabel(userId: string | null, ctx: ActivityRowContext): string | null {
  if (!userId) return null;
  return ctx.emailByUserId.get(userId) ?? userId.slice(0, 8);
}

/**
 * Une ligne du fil → sa clé i18n et ses paramètres. La clé est
 * `teamVaults.activity.event.<type à underscores>`, plus le suffixe
 * `_content`/`_meta` pour member.item.update (metadata.kind).
 */
export function resolveActivityRow(e: VaultActivityEventDTO, ctx: ActivityRowContext): ActivityRow {
  const meta = e.metadata ?? {};
  let key = e.eventType.replace(/\./g, '_');
  if (e.eventType === 'member.item.update') {
    key += meta.kind === 'content' ? '_content' : '_meta';
  }

  const params: Record<string, string | number> = {};
  const actor = actorLabel(e.actorUserId, ctx);
  if (actor) params.actor = actor;

  // member.remove : la personne RETIRÉE est la cible, résolue comme un acteur.
  if (e.eventType === 'member.remove' && e.targetId) {
    params.target = actorLabel(e.targetId, ctx) ?? e.targetId.slice(0, 8);
  }
  /**
   * QUI A ÉTÉ INVITÉ. Résolu LOCALEMENT depuis l'identifiant que l'audit porte —
   * le serveur, lui, n'a jamais vu passer d'adresse et n'en verra pas passer.
   * Le libellé nommé est une clé SŒUR (suffixe `_named`), pas une interpolation
   * conditionnelle : une phrase à trou où le trou reste vide se lit
   * « a invité  », et il n'y a pas de bonne façon de rattraper ça à l'affichage.
   */
  if (EVENEMENTS_D_INVITATION.has(e.eventType)) {
    const inviteId = typeof meta.invite_id === 'string' ? meta.invite_id : null;
    const invitee = inviteId ? ctx.emailByInviteId?.get(inviteId) : undefined;
    // Réglée depuis plus de quatorze jours, échue depuis plus de trente, ou
    // simplement jamais chargée : on garde la formule sans nom. Rendre
    // l'identifiant à la place ne dirait rien à personne, et inventer serait pire.
    if (invitee) {
      params.invitee = invitee;
      key += '_named';
    }
  }
  if (typeof meta.role === 'string') params.role = meta.role;
  if (typeof meta.removed === 'number') params.removed = meta.removed;
  if (typeof meta.new_epoch === 'number') params.epoch = meta.new_epoch;
  if (typeof meta.grace_days === 'number') params.graceDays = meta.grace_days;

  let unresolvedItemId: string | null = null;
  const itemId = typeof meta.item_id === 'string' ? meta.item_id : null;
  if (itemId) {
    const name = ctx.nameByItemId.get(itemId);
    if (name) params.item = name;
    else unresolvedItemId = itemId;
  }

  return { i18nKey: `teamVaults.activity.event.${key}`, params, unresolvedItemId };
}

export type UnresolvedItemLabel = 'deleted' | 'unknown';

/**
 * QUE PEUT-ON DIRE D'UN `item_id` QU'ON N'A PAS SU NOMMER ?
 *
 * « Un élément supprimé » est un VERDICT : il affirme qu'une chose a disparu.
 * Il ne se tire que d'une liste RÉELLEMENT consultée — un index absent ne prouve
 * pas la disparition, il prouve qu'on n'a pas lu la liste. C'est la règle que ce
 * dossier applique partout ailleurs (ne jamais conclure d'une absence
 * d'information), et elle a un cas réel : l'Aperçu construisait son contexte
 * avec une Map toujours vide, si bien que les quatre phrases les plus fréquentes
 * d'un coffre habité (contenu remplacé, renommage, mise à la corbeille,
 * restauration) se lisaient « … d'un élément supprimé (a1b2c3d4) » pour une note
 * parfaitement vivante.
 *
 * LE VERDICT SE TIRE DE LA LISTE, PAS DE L'INDEX DES NOMS. Compter les entrées
 * de `nameByItemId` était un raccourci vers la même question, et il se trompait
 * deux fois : une liste AMPUTÉE (des éléments sautés faute de clé d'époque) a un
 * index non vide et n'a pourtant aucune autorité ; et un élément bien présent
 * mais SANS nom (`fileName` et `title` vides) n'entre pas dans l'index alors
 * qu'il existe. On prend donc l'ensemble qui fait autorité — `null` quand on n'a
 * pas lu, ou pas tout lu (`authoritativeItemIds`) — et on n'accuse la
 * suppression que d'un identifiant qui en est réellement absent.
 *
 * Le libellé lui-même reste au composant, comme le repli : le modèle ne connaît
 * ni i18n ni troncature d'identifiant.
 */
export function unresolvedItemLabel(
  itemId: string,
  knownItemIds: ReadonlySet<string> | null
): UnresolvedItemLabel {
  if (knownItemIds === null) return 'unknown';
  return knownItemIds.has(itemId) ? 'unknown' : 'deleted';
}

/**
 * Les coffres dont la TÊTE du fil est plus récente que le dernier point vu —
 * le point du rail. Comparaison en COUPLE (occurredAt, id), jamais le temps
 * seul ; l'accès localStorage reste dans vaultActivitySeen.ts, le modèle ne le
 * touche jamais.
 */
export function unseenVaultIds(
  heads: ReadonlyArray<{ vaultId: string; occurredAt: number; id: number }>,
  cursorFor: (vaultId: string) => SeenCursor | null
): Set<string> {
  const out = new Set<string>();
  for (const head of heads) {
    if (isNewer(head, cursorFor(head.vaultId))) out.add(head.vaultId);
  }
  return out;
}
