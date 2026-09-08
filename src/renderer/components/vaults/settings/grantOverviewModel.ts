/**
 * grantOverviewModel (F17) — les accès PONCTUELS d'un coffre, groupés par
 * personne puis par élément. Sans React, sans réseau, sans i18n.
 *
 * POURQUOI CETTE VUE EXISTE. Un grant d'élément scelle K_item à quelqu'un qui
 * n'est PAS membre du coffre : c'est la seule sortie de matière hors du
 * trombinoscope, et jusqu'ici elle ne se vérifiait qu'un fichier à la fois, en
 * ouvrant le dialogue de partage de chacun. Un hôte ne pouvait donc pas répondre
 * à « qui, en dehors de mes membres, peut encore lire quelque chose ici ? » —
 * la question que l'on se pose précisément le jour où quelqu'un s'en va.
 *
 * TROIS RÈGLES DURES :
 *
 *  1. AUCUNE LIGNE N'EST MASQUÉE. Un accès dont on ne sait pas nommer l'élément
 *     (coffre verrouillé, méta illisible, élément purgé) reste affiché avec sa
 *     personne et son bouton Révoquer. Le cacher ferait disparaître de l'écran
 *     l'accès le plus inquiétant des trois : celui qu'on ne comprend pas.
 *
 *  2. UNE ABSENCE D'INFORMATION N'EST PAS UN VERDICT. « L'élément a été
 *     supprimé » ne se conclut que d'une liste RÉELLEMENT lue (`knownItemIds`
 *     non nul). Un coffre jamais ouvert n'a aucun élément en mémoire : y écrire
 *     « supprimé » sur les cinq accès vivants serait le mensonge le plus
 *     rassurant possible. C'est la règle d'`unresolvedItemLabel`, d'`inSpace`
 *     (F08) et de `wrappedEpoch` (F10).
 *
 *  3. « À RÉPARER » VIENT DU SERVEUR. `stale` est calculé une seule fois, dans
 *     `GET /vaults/:id/grants` (`item_version > wrapped_for_version`) : deux
 *     clients qui le recalculeraient chacun de leur côté finiraient par en
 *     décider différemment. Ce modèle le TRANSPORTE, il ne le recalcule pas —
 *     il n'ajoute qu'une chose que le serveur ignore : un accès dont l'élément
 *     n'est plus là n'est pas RÉPARABLE, faute d'un K_item à resceller.
 *
 * LE RÉSUMÉ COMPTE DES ÉLÉMENTS, PAS DES ACCÈS : « 4 éléments partagés à
 * 2 personnes » — deux personnes sur le même fichier font UN élément partagé.
 * Compter les lignes gonflerait le chiffre exactement dans le cas qu'on
 * surveille (un même document ouvert à plusieurs extérieurs).
 *
 * SAUF LA TROISIÈME CLAUSE, QUI COMPTE DES ACCÈS — et le dit. `expiringThisWeek`
 * compte des LIGNES : deux extérieurs dont l'accès au même fichier s'éteint
 * vendredi font deux échéances, parce que ce sont deux accès qui tombent, et
 * c'est bien ce qu'on veut voir venir. Mélanger les unités sans le dire ferait
 * lire « 4 éléments partagés, à 2 personnes, 3 expirent cette semaine » comme
 * « 3 éléments sur 4 », d'où la phrase i18n qui NOMME l'unité
 * (`summaryExpiring` : « 3 accès expirent cette semaine »).
 *
 * « CETTE SEMAINE » VEUT DIRE « DANS LES SEPT JOURS QUI VIENNENT ». La route ne
 * sert que des accès VIVANTS (`expires_at > now` en SQL) : un accès déjà expiré
 * n'y figure pas, et compter des expirations passées n'aurait rien à compter.
 * `expired` reste calculé pour la course — quelques secondes entre la lecture et
 * l'affichage — plutôt que d'afficher « expire aujourd'hui » sur un accès mort.
 */

import type { VaultGrantDTO } from '../../../../services/vault/vaultApi';

/** Sept jours, en millisecondes — la fenêtre de « expire cette semaine ». */
export const GRANT_EXPIRY_SOON_MS = 7 * 86_400_000;

export interface GrantItemRow {
  grantId: string;
  itemId: string;
  /** Le titre déchiffré SUR CET APPAREIL, ou `null` : on ne sait pas nommer. */
  title: string | null;
  /** Aucun titre : la ligne le DIT, elle ne disparaît pas (règle 1). */
  unreadable: boolean;
  /** L'élément manque à une liste réellement lue (règle 2). */
  orphaned: boolean;
  /** Le rescellement est possible : stale ET l'élément est là (règle 3). */
  repairable: boolean;
  stale: boolean;
  role: string;
  /** L'échéance en ms, ou `null` (jamais, ou date illisible). */
  expiresAt: number | null;
  expired: boolean;
  expiringThisWeek: boolean;
  createdAt: number | null;
}

export interface GrantPersonRow {
  userId: string;
  /** L'adresse servie par le serveur — l'hôte l'a tapée lui-même pour partager. */
  email: string | null;
  /** Ce qu'on affiche : l'adresse, ou l'identifiant tronqué à défaut. */
  label: string;
  items: GrantItemRow[];
  staleCount: number;
  expiringCount: number;
}

export interface GrantOverview {
  people: GrantPersonRow[];
  summary: {
    /** Des ÉLÉMENTS distincts, pas des accès. */
    itemCount: number;
    personCount: number;
    grantCount: number;
    /** Des ACCÈS, eux — la phrase du résumé nomme l'unité (voir l'en-tête). */
    expiringThisWeek: number;
    staleCount: number;
    orphanCount: number;
  };
  empty: boolean;
}

export interface GrantOverviewInput {
  grants: readonly VaultGrantDTO[];
  nowMs: number;
  /** Les titres connus localement (store vivant, puis corbeille). */
  titleByItemId: ReadonlyMap<string, string>;
  /**
   * Les éléments dont on a RÉELLEMENT lu la liste. `null` = on n'a pas lu (coffre
   * verrouillé, jamais ouvert) : personne n'est alors déclaré orphelin.
   */
  knownItemIds: ReadonlySet<string> | null;
}

/**
 * QUI FAIT AUTORITÉ SUR « CET ÉLÉMENT EXISTE ENCORE » — LA LISTE **ET** SON
 * COMPTE-RENDU.
 *
 * La règle 2 ci-dessus ne tient que si `knownItemIds` dit bien ce qu'il
 * prétend. Deux silences différents mènent au même `null`, et il faut les deux :
 *
 *  · AUCUNE LISTE. Un coffre jamais ouvert, ou verrouillé, n'a pas d'entrée dans
 *    le store. « Aucun élément » et « je n'ai pas lu » s'écrivent pareil
 *    (`undefined`), et seul le second est vrai.
 *  · AUCUN COMPTE-RENDU DE DÉCHIFFREMENT. `loadVaultItems` SAUTE en silence tout
 *    élément scellé sous une époque dont il n'a pas ramené la clé, et se résout
 *    quand même : la liste servie est AMPUTÉE et n'en dit rien — le manque ne
 *    vit que dans `decryptStatusByVault`. Or cette entrée-là n'est posée que par
 *    `loadVaultItems` : `addVaultItem` et `updateVaultItem` créent la liste sans
 *    elle. Lire ce compte-rendu ABSENT comme un « zéro indéchiffrable » faisait
 *    donc passer une liste d'un seul élément pour l'inventaire complet du
 *    coffre, et déclarait orphelins tous les accès aux autres.
 *
 * Un seul indéchiffrable suffit à retirer l'autorité : on ne sait plus qui
 * existe, on ne déclare personne supprimé, et chaque ligne retombe sur ce qui
 * est vrai (« illisible sur cet appareil »).
 */
export function authoritativeItemIds(
  items: readonly { id: string }[] | undefined | null,
  decryptStatus: { undecryptable: number } | undefined | null
): ReadonlySet<string> | null {
  if (!items || !decryptStatus) return null;
  if (decryptStatus.undecryptable > 0) return null;
  return new Set(items.map((i) => i.id));
}

/** Une date ISO → ms, ou `null` sur ce qu'on n'a pas su lire (jamais NaN). */
function parseInstant(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function buildGrantOverview(input: GrantOverviewInput): GrantOverview {
  const byPerson = new Map<string, GrantPersonRow>();
  const items = new Set<string>();
  let expiringThisWeek = 0;
  let staleCount = 0;
  let orphanCount = 0;

  for (const g of input.grants) {
    const title = input.titleByItemId.get(g.itemId) ?? null;
    // Règle 2 : « il n'est plus là » ne se dit que d'une liste qu'on a LUE.
    const orphaned = input.knownItemIds !== null && !input.knownItemIds.has(g.itemId);
    const expiresAt = parseInstant(g.expiresAt);
    const expired = expiresAt !== null && expiresAt <= input.nowMs;
    const expiringSoon =
      expiresAt !== null && !expired && expiresAt - input.nowMs <= GRANT_EXPIRY_SOON_MS;

    const row: GrantItemRow = {
      grantId: g.grantId,
      itemId: g.itemId,
      title,
      unreadable: title === null,
      orphaned,
      // Règle 3 : le serveur dit STALE, nous disons seulement s'il reste
      // quelque chose à resceller.
      repairable: g.stale && !orphaned,
      stale: g.stale,
      role: g.role,
      expiresAt,
      expired,
      expiringThisWeek: expiringSoon,
      createdAt: parseInstant(g.createdAt),
    };

    items.add(g.itemId);
    if (expiringSoon) expiringThisWeek += 1;
    if (g.stale) staleCount += 1;
    if (orphaned) orphanCount += 1;

    let person = byPerson.get(g.granteeUserId);
    if (!person) {
      person = {
        userId: g.granteeUserId,
        email: g.granteeEmail ?? null,
        // Un identifiant tronqué reste un libellé : jamais une chaîne vide, qui
        // rendrait une ligne d'accès anonyme au point de sembler décorative.
        label: g.granteeEmail ?? g.granteeUserId.slice(0, 8),
        items: [],
        staleCount: 0,
        expiringCount: 0,
      };
      byPerson.set(g.granteeUserId, person);
    }
    person.items.push(row);
    if (g.stale) person.staleCount += 1;
    if (expiringSoon) person.expiringCount += 1;
  }

  // Un ordre STABLE d'un rendu à l'autre : sans lui, la liste se réordonne au
  // gré du serveur et le bouton qu'on visait change de ligne sous le curseur.
  const people = [...byPerson.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  );

  return {
    people,
    summary: {
      itemCount: items.size,
      personCount: people.length,
      grantCount: input.grants.length,
      expiringThisWeek,
      staleCount,
      orphanCount,
    },
    empty: people.length === 0,
  };
}

/**
 * Les trois nombres de la phrase de résumé, tirés du MÊME calcul que la liste :
 * un compteur bâti à part finirait par annoncer autre chose que ce qui est
 * affiché dessous, et c'est le compteur qu'on croit.
 */
export function grantSummaryCounts(o: GrantOverview): {
  items: number;
  people: number;
  expiring: number;
} {
  return {
    items: o.summary.itemCount,
    people: o.summary.personCount,
    expiring: o.summary.expiringThisWeek,
  };
}
