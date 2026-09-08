/**
 * vaultStatsModel — l'aperçu chiffré d'un coffre (F07), sans React ni réseau.
 *
 * CE QUE CE FICHIER DÉCIDE, ET POURQUOI PAS LE COMPOSANT. Une grille de
 * compteurs a ceci de traître qu'elle se lit comme un FAIT : personne ne
 * soupçonne un « 0 » d'être une omission, ni un pourcentage d'être celui du
 * quota de quelqu'un d'autre. Les cinq règles qui empêchent ça sont donc des
 * fonctions, éprouvées une fois pour toutes, plutôt que des `if` au milieu d'un
 * rendu :
 *
 *  1. LE RANG. `GET /:id/stats` est au rang **member**. Un lecteur ne doit pas
 *     déclencher l'appel : son 403 est une décision du worker, et l'afficher
 *     comme une panne ferait chercher un incident là où il n'y en a pas.
 *  2. LE PLANCHER. Le seau du worker est de 120 lectures par heure et par
 *     COFFRE — un client qui rafraîchit en boucle n'éteint pas son écran, il
 *     éteint celui de tout le monde. Trente secondes minimum entre deux
 *     TENTATIVES (pas entre deux succès : un refus rapide relancerait aussitôt).
 *     Le geste EXPLICITE a le sien, court (`STATS_GESTURE_FLOOR_MS`) : un clic
 *     est une demande, mais un bouton sans aucun plancher est une amorce
 *     d'amplification — s'acharner après un 429 éteindrait tout le coffre. Et
 *     quand c'est précisément un 429 qui a vidé l'écran, le bouton est désarmé
 *     (`mayRetryStats`) : le seau est vide, réessayer ne peut rien rendre.
 *  3. LE 429 N'EFFACE RIEN. « Trop de requêtes » n'est pas « le coffre est
 *     vide ». La dernière valeur reste à l'écran, marquée comme datée.
 *  4. LES COMPTEURS D'INVITATIONS SONT OMIS sous le rang admin. `in`, jamais
 *     `?? 0`.
 *  5. LA PART DU POOL N'EST PAS FORCÉMENT LA MIENNE. `GET /vaults/seats` répond
 *     pour l'espace AMBIANT (l'en-tête X-Org-Id), pas pour l'espace du coffre :
 *     chez un hôte qui m'a invité, ce serait MON quota affiché à côté de SON
 *     coffre. Sans preuve que les deux espaces sont le même, on n'affiche rien.
 */

import type { VaultSeatsDTO, VaultStatsDTO } from '../../../../services/vault/vaultApi';

// ─────────────────────────────────────────────────────────────────────────────
// La porte : qui a le droit de demander
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le rang qui ouvre `GET /:id/stats`. L'écart avec le viewer est délibéré côté
 * worker : un lecteur est le rang « lire le contenu, rien de plus », alors que
 * cet aperçu dresse l'INVENTAIRE du coffre (ce qu'il pèse, la ventilation des
 * dépôts, le décompte des rôles). Un rôle inconnu est traité comme un refus :
 * on ne demande pas au serveur de trancher à notre place.
 */
export function mayReadVaultStats(role: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'member';
}

// ─────────────────────────────────────────────────────────────────────────────
// L'état de la lecture, et son plancher
// ─────────────────────────────────────────────────────────────────────────────

/** Trente secondes entre deux tentatives — voir la règle 2 de l'en-tête. */
export const STATS_REFRESH_FLOOR_MS = 30_000;

/**
 * Le plancher du GESTE EXPLICITE (« Réessayer »). Un clic est une demande, pas
 * une boucle : lui opposer trente secondes désarmerait un bouton que quelqu'un
 * vient de presser. Mais le laisser SANS plancher est pire — le seau est de 120
 * lectures par heure et par COFFRE, partagé par tous ses membres : une personne
 * qui s'acharne après un 429 éteindrait les chiffres de tout le monde pour une
 * heure. Trois secondes gardent le bouton vivant sans en faire une amorce
 * d'amplification.
 */
export const STATS_GESTURE_FLOOR_MS = 3_000;

export interface VaultStatsState {
  stats: VaultStatsDTO | null;
  /**
   * Le code du dernier refus, ou `null`. Volontairement TU quand un 429 laisse
   * une valeur en place : le plafond est le nôtre, et le peindre en rouge
   * par-dessus des chiffres justes ferait passer notre propre borne pour un
   * incident du serveur.
   */
  error: string | null;
  /** La valeur affichée n'a pas pu être rafraîchie — elle date d'avant. */
  stale: boolean;
  /** La dernière TENTATIVE (succès ou refus) : c'est elle que borne le plancher. */
  lastAttemptAt: number | null;
  loading: boolean;
}

export const IDLE_STATS: VaultStatsState = {
  stats: null,
  error: null,
  stale: false,
  lastAttemptAt: null,
  loading: false,
};

/** Peut-on (re)demander les agrégats maintenant ? */
export function shouldFetchStats(
  state: VaultStatsState,
  nowMs: number,
  floorMs: number = STATS_REFRESH_FLOOR_MS
): boolean {
  if (state.loading) return false;
  if (state.lastAttemptAt === null) return true;
  return nowMs - state.lastAttemptAt >= floorMs;
}

/**
 * Le départ d'une lecture. La tentative est datée ICI, avant la réponse : un
 * refus qui revient en dix millisecondes ne doit pas rouvrir immédiatement le
 * droit de recommencer.
 */
export function beginStatsFetch(state: VaultStatsState, nowMs: number): VaultStatsState {
  return { ...state, loading: true, lastAttemptAt: nowMs };
}

/**
 * « Ce qui est à l'écran ne décrit plus ce coffre. » Un retrait fait TOURNER la
 * clé : l'effectif et l'époque affichés sont faux à la seconde où la rotation
 * aboutit, et le plancher, lui, ne sait pas distinguer « rien n'a bougé » de
 * « tout vient de bouger ». Il est donc rouvert — la relecture est provoquée par
 * un geste réel, jamais par une boucle — et les chiffres RESTENT à l'écran,
 * marqués comme datés : les effacer inventerait un coffre vide, exactement comme
 * un 429 le ferait.
 */
export function invalidateStats(prev: VaultStatsState): VaultStatsState {
  return { ...prev, lastAttemptAt: null, stale: prev.stats !== null };
}

/**
 * « RÉESSAYER » A-T-IL LA MOINDRE CHANCE D'ABOUTIR ?
 *
 * Le bandeau de refus (et son bouton) ne s'affiche qu'avec un `error` en main —
 * donc, sur un 429, seulement quand il ne reste AUCUN chiffre à l'écran (la
 * règle 3 tait le plafond tant qu'on a de quoi montrer). Or ce refus-là dit
 * précisément que le seau du coffre est vide : 120 lectures par heure, pour tous
 * ses membres à la fois. Avec le plancher de geste (trois secondes), s'acharner
 * autorise quelque 1 200 tentatives par heure dont pas une ne peut aboutir — et
 * chacune retarde le retour des chiffres pour tout le monde. Le bouton est donc
 * désarmé sur CE code, et sur lui seul : une panne réseau, elle, se retente, et
 * revenir sur la page relance de toute façon une lecture propre.
 */
export function mayRetryStats(state: VaultStatsState): boolean {
  if (state.loading) return false;
  return state.error !== 'rate_limited';
}

export type StatsOutcome = { ok: true; stats: VaultStatsDTO } | { ok: false; code: string };

/** L'arrivée d'une réponse — un refus ne remplace JAMAIS un chiffre par un zéro. */
export function applyStatsOutcome(
  prev: VaultStatsState,
  outcome: StatsOutcome,
  nowMs: number
): VaultStatsState {
  if (outcome.ok) {
    return {
      stats: outcome.stats,
      error: null,
      stale: false,
      lastAttemptAt: nowMs,
      loading: false,
    };
  }
  const garde = prev.stats !== null;
  return {
    stats: prev.stats,
    // Un plafond que nous nous imposons ne se dit pas comme une panne TANT QU'ON
    // A ENCORE QUELQUE CHOSE À MONTRER ; sans valeur en main, il faut bien
    // expliquer l'écran vide, et là il redevient un message.
    error: outcome.code === 'rate_limited' && garde ? null : outcome.code,
    stale: garde,
    lastAttemptAt: nowMs,
    loading: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ce que la grille montre
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le serveur a-t-il servi les compteurs d'invitations ? Ils sont OMIS sous le
 * rang admin, jamais rendus à zéro : `in` est le seul test honnête. Un `?? 0`
 * afficherait « 0 invitation en attente » à un membre qui n'a pas le droit de
 * les lister — c'est-à-dire exactement l'écran vide qui a fait conclure à un
 * accès perdu là où il n'y avait qu'un lien à réémettre.
 */
export function hasInviteCounters(
  stats: VaultStatsDTO
): stats is VaultStatsDTO & { pendingInviteCount: number; lapsedInviteCount: number } {
  return 'pendingInviteCount' in stats;
}

export type VaultRoleKey = 'owner' | 'admin' | 'member' | 'viewer';

const ROLE_ORDER: readonly VaultRoleKey[] = ['owner', 'admin', 'member', 'viewer'];

/**
 * La ventilation par rôle, dans l'ordre du coffre. Les rôles ABSENTS sortent :
 * « 4 membres » ne dit pas s'il reste quelqu'un pour administrer, mais
 * « viewer 0 » n'apprend rien non plus et allonge la ligne.
 */
export function roleRows(
  roleCounts: VaultStatsDTO['roleCounts']
): Array<{ role: VaultRoleKey; count: number }> {
  return ROLE_ORDER.map((role) => ({ role, count: roleCounts[role] ?? 0 })).filter(
    (r) => r.count > 0
  );
}

export type VaultItemKind = 'note' | 'file' | 'transclusion';

const TYPE_ORDER: readonly VaultItemKind[] = ['note', 'file', 'transclusion'];

/**
 * Les trois familles, TOUJOURS, y compris à zéro — c'est la règle du worker et
 * elle vaut ici pour la même raison : une famille absente de la liste se lirait
 * « inconnue » là où elle veut dire « aucun ».
 */
export function typeRows(
  byType: VaultStatsDTO['byType']
): Array<{ kind: VaultItemKind; count: number }> {
  return TYPE_ORDER.map((kind) => ({ kind, count: byType[kind] ?? 0 }));
}

export interface MemberUsage {
  userId: string;
  itemCount: number;
  bytes: number;
}

/**
 * Qui a déposé quoi, du plus lourd au plus léger. Les égalités sont départagées
 * jusqu'au bout (éléments, puis identifiant) : D1 ne promet aucun ordre, et un
 * classement qui change d'un rendu à l'autre donne à lire deux vérités du même
 * fait. La liste d'origine n'est jamais triée en place.
 */
export function memberUsage(byMember: readonly MemberUsage[]): MemberUsage[] {
  return [...byMember].sort(
    (a, b) => b.bytes - a.bytes || b.itemCount - a.itemCount || a.userId.localeCompare(b.userId)
  );
}

/**
 * Les derniers arrivés. Une date ILLISIBLE passe en dernier : « on ne sait pas
 * quand » n'est pas « à l'instant », et la remonter en tête de la carte des
 * arrivées récentes serait exactement ce mensonge-là.
 */
export function recentJoins<T extends { userId: string; joinedAt: string }>(
  members: readonly T[],
  limit = 5
): T[] {
  const clef = (m: T) => {
    const ms = Date.parse(m.joinedAt);
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  };
  return [...members]
    .sort((a, b) => clef(b) - clef(a) || a.userId.localeCompare(b.userId))
    .slice(0, Math.max(0, limit));
}

// ─────────────────────────────────────────────────────────────────────────────
// La part du pool
// ─────────────────────────────────────────────────────────────────────────────

/** Au-delà, le pool mérite d'être signalé ; au-delà du second, il presse. */
export const POOL_WARNING_PCT = 80;
export const POOL_DANGER_PCT = 95;

export interface PoolShare {
  /** Le plafond mutualisé de l'espace, en octets. */
  limit: number;
  /** Ce que l'espace ENTIER consomme — `null` si le serveur ne l'a pas dit. */
  used: number | null;
  vaultBytes: number;
  /** La part de ce coffre dans le plafond, en % (0-100). */
  vaultPct: number;
  /** Le remplissage du pool, en % — `null` tant qu'on ne connaît pas `used`. */
  poolPct: number | null;
  /** Le ton de la jauge, `null` quand on ne sait pas ce que le pool contient. */
  tone: 'ok' | 'warning' | 'danger' | null;
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / total) * 1000) / 10));
}

/**
 * La part du coffre dans le stockage mutualisé de SON espace — ou `null`.
 *
 * `sameSpace` est le garde de la règle 5 : `GET /vaults/seats` répond pour
 * l'espace ambiant. Chez un hôte qui m'a invité, la réponse parle de MON espace
 * et le coffre appartient au SIEN ; afficher les deux côte à côte donnerait un
 * chiffre faux à l'endroit exact où il se lit comme vrai. On préfère ne rien
 * dire : la fiche d'identité nomme déjà l'espace, et son propriétaire y lira sa
 * jauge chez lui.
 */
export function poolShare(input: {
  vaultBytes: number;
  seats: VaultSeatsDTO | null;
  sameSpace: boolean;
}): PoolShare | null {
  if (!input.sameSpace || !input.seats) return null;
  const limit = input.seats.pooledStorageLimit ?? 0;
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const used =
    typeof input.seats.pooledStorageUsed === 'number' ? input.seats.pooledStorageUsed : null;
  const poolPct = used === null ? null : pct(used, limit);
  return {
    limit,
    used,
    vaultBytes: input.vaultBytes,
    vaultPct: pct(input.vaultBytes, limit),
    poolPct,
    tone:
      poolPct === null
        ? null
        : poolPct >= POOL_DANGER_PCT
          ? 'danger'
          : poolPct >= POOL_WARNING_PCT
            ? 'warning'
            : 'ok',
  };
}
