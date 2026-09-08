/**
 * epochCoverage (F10) — qui détient quelle clé, et ce que la rotation laisse
 * derrière elle. Sans React, sans réseau, sans traduction.
 *
 * CE QU'UNE ROTATION FAIT, ET CE QU'ELLE NE FAIT PAS. Elle engendre K_vault' et
 * la scelle aux membres RESTANTS, dans le même appel. Trois populations ne
 * suivent pas toutes seules, et l'écran doit les nommer :
 *
 *   · les MEMBRES dont le scellé est resté à une époque antérieure. Le serveur
 *     sert `wrappedEpoch` aux administrateurs pour exactement cette raison ; un
 *     membre en retard ne lit pas les éléments neufs, et rien d'autre ne le
 *     dit — son cadenas est ouvert, son coffre est là, seuls les contenus
 *     récents lui sont fermés.
 *   · les INVITATIONS en attente, scellées sous l'ancienne clé. Les relancer ne
 *     peut qu'échouer (`invite_stale_epoch`) : la seule issue est de les
 *     réémettre. C'est le fait le plus contre-intuitif de la fiche — « Relancer »
 *     est le bouton qu'on essaie, et c'est celui qui ne peut pas marcher.
 *   · les ÉLÉMENTS déjà chiffrés, qui restent sous leur époque d'origine (le
 *     re-key est PARESSEUX, par conception : rescelle-t-on des gigaoctets à
 *     chaque départ ?). Ils restent lisibles par qui détient l'époque en
 *     question. v1 les COMPTE ; elle ne les rescelle pas, et le dit.
 *
 * LA RÈGLE QUI TRAVERSE TOUT LE FICHIER : une absence d'information n'est
 * jamais un verdict. `wrappedEpoch` manque en dessous du rang admin et chez un
 * worker d'avant la fiche ; le compter « à jour » fabriquerait une tranquillité,
 * le compter « en retard » fabriquerait une alerte. Il vaut INCONNU, il a sa
 * propre colonne, et les deux autres n'en parlent pas. Même règle que `inSpace`
 * (F08) et que la conservation légale (F19).
 */

import type { VaultInviteDTO } from '../../../../services/vault/vaultApi';

// ─────────────────────────────────────────────────────────────────────────────
// Les membres
// ─────────────────────────────────────────────────────────────────────────────

/** Le strict nécessaire d'une ligne de `/members` pour ce calcul. */
export interface MemberEpochRow {
  userId: string;
  /** L'époque du scellé que le serveur lui garde — absent = on ne sait pas. */
  wrappedEpoch?: number;
}

export interface MemberEpochCoverage<T extends MemberEpochRow> {
  /** Le serveur a-t-il servi au moins UNE époque ? Sinon, tout est inconnu. */
  known: boolean;
  /** Scellés à l'époque courante (ou au-delà — voir plus bas). */
  upToDate: T[];
  /** Scellés à une époque antérieure, les plus en retard d'abord. */
  behind: T[];
  /** Aucune époque servie pour eux : ni à jour ni en retard. */
  unknown: T[];
}

/**
 * Le trombinoscope rangé par époque de scellé.
 *
 * UN SCELLÉ EN AVANCE COMPTE COMME À JOUR, et ce n'est pas de la complaisance :
 * `currentKeyEpoch` vient du résumé en mémoire, qui peut être en retard sur le
 * serveur d'une rotation faite ailleurs. Ranger ce membre « en retard » serait
 * une alerte fabriquée par notre propre fraîcheur — l'écran accuserait le
 * serveur d'un défaut qui n'est que le sien.
 */
export function memberEpochCoverage<T extends MemberEpochRow>(
  rows: readonly T[],
  currentKeyEpoch: number
): MemberEpochCoverage<T> {
  const upToDate: T[] = [];
  const behind: T[] = [];
  const unknown: T[] = [];
  for (const r of rows) {
    if (typeof r.wrappedEpoch !== 'number' || !Number.isFinite(r.wrappedEpoch)) unknown.push(r);
    else if (r.wrappedEpoch >= currentKeyEpoch) upToDate.push(r);
    else behind.push(r);
  }
  // Les plus en retard d'abord : c'est par eux qu'on rattrape, et c'est eux qui
  // ont le plus d'éléments fermés.
  behind.sort((a, b) => (a.wrappedEpoch ?? 0) - (b.wrappedEpoch ?? 0));
  return { known: upToDate.length + behind.length > 0, upToDate, behind, unknown };
}

// ─────────────────────────────────────────────────────────────────────────────
// Les invitations en attente
// ─────────────────────────────────────────────────────────────────────────────

export interface InviteEpochCoverage {
  /** Scellées sous une clé révolue : à RÉÉMETTRE, jamais à relancer. */
  toReissue: VaultInviteDTO[];
  upToDate: VaultInviteDTO[];
  /** Sans époque servie — un worker d'avant F03. On n'en dit rien. */
  unknown: VaultInviteDTO[];
}

/**
 * Les invitations en attente, rangées par époque de scellé.
 *
 * LE MÊME FAIT QUE `staleEpoch` DE `inviteLifecycleModel`, ET C'EST VOULU :
 * l'onglet Invitations MARQUE chaque ligne, la section « Clé du coffre » les
 * COMPTE. Un test confronte les deux sur la même entrée — deux lectures d'un
 * même champ finissent toujours par diverger le jour où l'une change de règle,
 * et un compteur qui ne correspond pas à la liste qu'il ouvre est pire que pas
 * de compteur du tout.
 */
export function inviteEpochCoverage(
  invites: readonly VaultInviteDTO[],
  currentKeyEpoch: number
): InviteEpochCoverage {
  const toReissue: VaultInviteDTO[] = [];
  const upToDate: VaultInviteDTO[] = [];
  const unknown: VaultInviteDTO[] = [];
  for (const i of invites) {
    if (typeof i.wrappedVaultKeyEpoch !== 'number') unknown.push(i);
    else if (i.wrappedVaultKeyEpoch < currentKeyEpoch) toReissue.push(i);
    else upToDate.push(i);
  }
  return { toReissue, upToDate, unknown };
}

// ─────────────────────────────────────────────────────────────────────────────
// Les éléments
// ─────────────────────────────────────────────────────────────────────────────

/** Le strict nécessaire d'un élément du coffre pour ce comptage. */
export interface ItemEpochRow {
  wrappedUnderEpoch: number;
}

export interface ItemEpochCoverage {
  /**
   * A-t-on la liste des éléments ? `false` = ce coffre n'a jamais été ouvert
   * dans cette session, et AUCUN chiffre ne doit être affiché.
   */
  known: boolean;
  total: number;
  /** Combien sont scellés sous une époque révolue. */
  old: number;
  /** Le détail par époque, la plus ancienne d'abord. */
  byEpoch: Array<{ epoch: number; count: number }>;
}

/**
 * Combien d'éléments restent scellés sous une clé d'avant.
 *
 * `undefined` N'EST PAS UNE LISTE VIDE, et c'est tout l'objet du champ `known`.
 * Un coffre qu'on n'a pas ouvert n'a aucun élément en mémoire : afficher
 * « 0 élément ancien » y serait rassurant ET faux — le pire des trois états.
 * L'écran dit alors « ouvrez le coffre pour le savoir », ce qui est vrai.
 *
 * Le compte ne porte QUE sur ce que cet appareil a chargé : ce n'est pas
 * l'inventaire du coffre (les statistiques du serveur le donnent), c'est ce
 * qu'on peut affirmer sans lui.
 */
export function itemEpochCoverage(
  items: readonly ItemEpochRow[] | undefined,
  currentKeyEpoch: number
): ItemEpochCoverage {
  if (!items) return { known: false, total: 0, old: 0, byEpoch: [] };
  const parEpoque = new Map<number, number>();
  for (const it of items) {
    const e = it.wrappedUnderEpoch;
    if (!Number.isFinite(e) || e >= currentKeyEpoch) continue;
    parEpoque.set(e, (parEpoque.get(e) ?? 0) + 1);
  }
  const byEpoch = [...parEpoque.entries()]
    .map(([epoch, count]) => ({ epoch, count }))
    .sort((a, b) => a.epoch - b.epoch);
  return {
    known: true,
    total: items.length,
    old: byEpoch.reduce((n, r) => n + r.count, 0),
    byEpoch,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// L'auto-contrôle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ok` — mon scellé est à l'époque courante et il s'ouvre.
 * `behind` — le serveur me garde une époque ANTÉRIEURE : personne ne m'a
 *   rescellé lors de la dernière rotation (client bogué, wrap perdu).
 * `unreadable` — le bon numéro d'époque, et pourtant rien ne s'ouvre : le
 *   scellé qu'on me garde ne vaut rien (clé substituée, wrap corrompu).
 * `locked` — rien ne s'ouvre ICI : ou bien cet appareil n'a pas la paire de
 *   clés (première ouverture avant l'import, session verrouillée, mot de passe
 *   de contrainte), ou bien le coffre en est encore à l'époque 1 et aucune
 *   rotation n'a jamais eu lieu. Dans les deux cas, personne n'est en cause.
 * `unknown` — on ne connaît pas encore l'époque du coffre.
 */
export type MySealVerdict = 'ok' | 'behind' | 'unreadable' | 'locked' | 'unknown';

/**
 * MON scellé de l'époque courante s'ouvre-t-il ? — le garde-fou contre le
 * lock-out (§7 du plan).
 *
 * POURQUOI IL EXISTE. Une rotation est faite par le client de quelqu'un
 * d'autre : c'est SON application qui rescelle K_vault' à chacun. Un client
 * bogué, une clé publique mal résolue, un wrap écrit à moitié, et un membre se
 * retrouve avec un coffre visible dont plus rien ne s'ouvre — sans le moindre
 * message, puisque de son côté tout a l'air normal. L'écran ne peut pas le
 * réparer (il faudrait la clé, qu'on n'a justement pas) ; il peut NOMMER
 * l'administrateur à qui demander une nouvelle rotation, et c'est tout ce qui
 * manquait.
 *
 * LES DEUX SYMPTÔMES SONT DISTINCTS, et le second est le plus vicieux : un
 * numéro d'époque à jour ne prouve RIEN sur ce que le scellé contient. C'est
 * pour cela que le verdict ne se déduit pas du seul `wrappedVaultKeyEpoch` — il
 * demande à la clé si elle s'ouvre.
 *
 * « JE N'OUVRE RIEN ICI » N'EST PAS « CE SCELLÉ-CI NE VAUT RIEN », et la
 * distinction décide d'une accusation nominative. `canOpenCurrent === false` a
 * une cause banale qui n'a rien à voir avec le coffre : la paire de clés du
 * compte n'est pas chargée sur cet appareil — première ouverture avant l'import,
 * session verrouillée (`clearVaultKeys()`), branche de contrainte. Aucun scellé,
 * d'aucune époque, ne s'ouvre alors ; en conclure que CELUI-CI est corrompu et
 * afficher « demandez à Alice de refaire la rotation » désigne un coupable à
 * partir d'une absence. C'est pour cela que `deviceHasKeys` est un paramètre
 * OBLIGATOIRE et non une commodité : l'oublier rendait l'ancienne version
 * accusatrice dès l'époque 2, et un booléen optionnel se serait oublié pareil.
 *
 * ET L'ÉPOQUE 1 NE DÉNONCE PERSONNE non plus. Sans rotation, une clé absente
 * veut dire « déverrouillez votre coffre » ; envoyer chercher un administrateur
 * qui referait une rotation jamais faite serait un faux coupable.
 *
 * « EN RETARD » RESTE DIT, MÊME APPAREIL SANS CLÉS, et l'ordre des tests le dit
 * exprès : « le serveur me garde un wrap de l'époque 2 alors que le coffre est
 * à la 3 » ne se déduit d'aucune absence — c'est le serveur qui l'affirme, le
 * fait tient que la clé soit chargée ici ou non, et le remède (redemander une
 * rotation) est le bon dans les deux cas.
 */
export function mySealVerdict(input: {
  currentKeyEpoch: number;
  /** L'époque du wrap que le serveur me garde (résumé du coffre). */
  wrappedVaultKeyEpoch: number;
  /** La clé de l'époque courante est-elle réellement ouverte ici ? */
  canOpenCurrent: boolean;
  /** La paire de clés du COMPTE est-elle chargée sur cet appareil ? */
  deviceHasKeys: boolean;
}): MySealVerdict {
  const { currentKeyEpoch, wrappedVaultKeyEpoch, canOpenCurrent, deviceHasKeys } = input;
  if (!Number.isFinite(currentKeyEpoch) || currentKeyEpoch < 1) return 'unknown';
  // Le cache mémoire de K_vault survit à l'effacement de la paire : ce qui
  // s'ouvre s'ouvre, et l'affirmer n'invente rien.
  if (canOpenCurrent) return 'ok';
  if (wrappedVaultKeyEpoch > 0 && wrappedVaultKeyEpoch < currentKeyEpoch) return 'behind';
  if (!deviceHasKeys) return 'locked';
  if (currentKeyEpoch === 1) return 'locked';
  return 'unreadable';
}

/** Le verdict demande-t-il d'aller voir un administrateur ? */
export function sealVerdictAlerts(v: MySealVerdict): boolean {
  return v === 'behind' || v === 'unreadable';
}
