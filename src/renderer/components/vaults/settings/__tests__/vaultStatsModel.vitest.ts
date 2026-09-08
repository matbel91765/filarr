/**
 * vaultStatsModel — l'aperçu chiffré d'un coffre (F07), et les six façons dont
 * une grille de compteurs ment sans qu'aucun type ne bronche.
 *
 * CE QUE CES TESTS GARDENT, ET CE QUE CHACUN A COÛTÉ :
 *
 *  · LE RANG. `GET /:id/stats` est au rang **member** : appelée pour un lecteur,
 *    elle rend un 403 que l'écran afficherait comme une panne — une décision
 *    déguisée en incident. La porte est ici, pas dans le composant, parce qu'un
 *    `if` au milieu d'un rendu ne se relit jamais.
 *  · LE PLANCHER. Le seau serveur est de 120 lectures par heure et par coffre,
 *    et il est indexé sur le COFFRE : un client qui rafraîchit en boucle ne se
 *    punit pas lui-même, il éteint la page de tout le monde. Trente secondes
 *    entre deux tentatives, comptées depuis la TENTATIVE — pas depuis le succès,
 *    sinon un refus rapide relance immédiatement.
 *  · LE 429 N'EFFACE RIEN. « Trop de requêtes » n'est pas « le coffre est
 *    vide » : la dernière valeur connue reste à l'écran, marquée comme datée. La
 *    remplacer par des zéros inventerait un coffre vide, et un zéro se croit.
 *  · LES COMPTEURS D'INVITATIONS SONT OMIS SOUS LE RANG ADMIN, jamais rendus à
 *    zéro par le worker. Le test est `'pendingInviteCount' in stats` : un
 *    `?? 0` afficherait « 0 invitation en attente » à un membre qui n'a pas le
 *    droit de les lister — c'est-à-dire exactement l'écran vide qui a fait
 *    conclure à un accès perdu là où il n'y avait qu'un lien à réémettre.
 *  · LA PART DU POOL N'EST PAS LA MIENNE. `GET /vaults/seats` répond pour
 *    l'espace AMBIANT (l'en-tête X-Org-Id), pas pour l'espace du coffre : chez
 *    un hôte qui m'a invité, afficher MON quota à côté de SON coffre est un
 *    chiffre faux à l'endroit exact où il se lit comme vrai. Sans preuve que les
 *    deux espaces sont le même, on n'affiche RIEN.
 *  · L'ORDRE DES LISTES EST DÉTERMINISTE. Une ventilation par membre qui se
 *    réordonne d'un rendu à l'autre (égalités départagées par l'ordre d'arrivée
 *    de D1) donne à lire deux classements différents du même fait.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/vaultStatsModel.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import {
  IDLE_STATS,
  POOL_DANGER_PCT,
  POOL_WARNING_PCT,
  STATS_GESTURE_FLOOR_MS,
  STATS_REFRESH_FLOOR_MS,
  applyStatsOutcome,
  beginStatsFetch,
  hasInviteCounters,
  invalidateStats,
  mayReadVaultStats,
  mayRetryStats,
  memberUsage,
  poolShare,
  recentJoins,
  roleRows,
  shouldFetchStats,
  typeRows,
} from '../vaultStatsModel';
import type { VaultSeatsDTO, VaultStatsDTO } from '../../../../../services/vault/vaultApi';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');

const stats = (over: Partial<VaultStatsDTO> = {}): VaultStatsDTO => ({
  storageUsedBytes: 3_100_000,
  itemCount: 12,
  pendingUploads: 0,
  trashedCount: 2,
  trashedBytes: 4_096,
  retainedRevisionBytes: 1_024,
  memberCount: 3,
  roleCounts: { owner: 1, admin: 0, member: 1, viewer: 1 },
  liveGrantCount: 0,
  currentKeyEpoch: 1,
  createdAt: '2026-08-01T10:00:00.000Z',
  ownerUserId: 'u-moi',
  byMember: [],
  byType: { note: 7, file: 5, transclusion: 0 },
  ...over,
});

const seats = (over: Partial<VaultSeatsDTO> = {}): VaultSeatsDTO => ({
  seats: 2,
  viewers: 1,
  seatsPurchased: 3,
  tier: 'pro',
  ...over,
});

describe('mayReadVaultStats — la route est au rang member, pas viewer', () => {
  it('ouvre à member, admin, owner', () => {
    expect(mayReadVaultStats('member')).toBe(true);
    expect(mayReadVaultStats('admin')).toBe(true);
    expect(mayReadVaultStats('owner')).toBe(true);
  });

  it('refuse au lecteur — un 403 prévisible ne doit jamais s’afficher comme une panne', () => {
    expect(mayReadVaultStats('viewer')).toBe(false);
  });

  it('refuse un rôle inconnu : on ne demande pas au serveur de trancher à notre place', () => {
    expect(mayReadVaultStats('')).toBe(false);
    expect(mayReadVaultStats('guest')).toBe(false);
  });
});

describe('le plancher de rafraîchissement', () => {
  it('la toute première lecture part', () => {
    expect(shouldFetchStats(IDLE_STATS, NOW)).toBe(true);
  });

  it('ne repart pas avant trente secondes, MÊME après un refus', () => {
    const refuse = applyStatsOutcome(
      beginStatsFetch(IDLE_STATS, NOW),
      { ok: false, code: 'boom' },
      NOW
    );
    expect(shouldFetchStats(refuse, NOW + 1_000)).toBe(false);
    expect(shouldFetchStats(refuse, NOW + STATS_REFRESH_FLOOR_MS - 1)).toBe(false);
    expect(shouldFetchStats(refuse, NOW + STATS_REFRESH_FLOOR_MS)).toBe(true);
  });

  it('ne lance rien tant qu’une lecture est en vol', () => {
    expect(
      shouldFetchStats(beginStatsFetch(IDLE_STATS, NOW), NOW + 10 * STATS_REFRESH_FLOOR_MS)
    ).toBe(false);
  });

  it('le plancher se recale sur la réponse, jamais en arrière', () => {
    const enVol = beginStatsFetch(IDLE_STATS, NOW);
    const ok = applyStatsOutcome(enVol, { ok: true, stats: stats() }, NOW + 20_000);
    expect(ok.lastAttemptAt).toBe(NOW + 20_000);
    expect(shouldFetchStats(ok, NOW + 20_000 + STATS_REFRESH_FLOOR_MS)).toBe(true);
  });
});

describe('le geste explicite a son propre plancher, court et distinct', () => {
  /**
   * « Réessayer » ne doit pas contourner le seau. Il est de 120 lectures par
   * heure ET PAR COFFRE, partagé par tous ses membres : une personne qui
   * s’acharne sur le bouton après un 429 éteindrait les chiffres de tout le monde
   * pour une heure. Un plancher court garde le bouton vivant sans en faire une
   * amorce d’amplification — c’est le geste qui est explicite, pas le droit de
   * marteler.
   */
  it('reste bien plus court que le plancher ordinaire', () => {
    expect(STATS_GESTURE_FLOOR_MS).toBeGreaterThan(0);
    expect(STATS_GESTURE_FLOOR_MS).toBeLessThan(STATS_REFRESH_FLOOR_MS);
  });

  it('deux clics collés ne partent pas deux fois', () => {
    const refuse = applyStatsOutcome(
      beginStatsFetch(IDLE_STATS, NOW),
      { ok: false, code: 'rate_limited' },
      NOW
    );
    expect(shouldFetchStats(refuse, NOW + 200, STATS_GESTURE_FLOOR_MS)).toBe(false);
    expect(shouldFetchStats(refuse, NOW + STATS_GESTURE_FLOOR_MS, STATS_GESTURE_FLOOR_MS)).toBe(
      true
    );
  });

  it('ne contourne jamais une lecture en vol', () => {
    expect(shouldFetchStats(beginStatsFetch(IDLE_STATS, NOW), NOW + 1e6, 0)).toBe(false);
  });
});

describe('invalidateStats — un effectif qui change périme les agrégats', () => {
  /**
   * Un retrait fait TOURNER la clé : `memberCount` et l’époque affichés
   * d’avant sont faux à la seconde où la rotation aboutit. Le plancher, lui, ne
   * sait pas distinguer « rien n’a bougé » de « tout vient de bouger » : sans
   * cette remise à zéro, la grille garderait ses chiffres pendant trente
   * secondes au moins — et indéfiniment si personne ne revient sur l’Aperçu.
   */
  it('rouvre le droit de relire, tout de suite', () => {
    const ok = applyStatsOutcome(
      beginStatsFetch(IDLE_STATS, NOW),
      { ok: true, stats: stats() },
      NOW
    );
    expect(shouldFetchStats(ok, NOW + 1_000)).toBe(false);
    expect(shouldFetchStats(invalidateStats(ok), NOW + 1_000)).toBe(true);
  });

  it('garde les chiffres à l’écran, en les disant datés', () => {
    const ok = applyStatsOutcome(
      beginStatsFetch(IDLE_STATS, NOW),
      { ok: true, stats: stats() },
      NOW
    );
    const perime = invalidateStats(ok);
    // Les effacer inventerait un coffre vide, exactement comme un 429 le ferait.
    expect(perime.stats).toBe(ok.stats);
    expect(perime.stale).toBe(true);
    expect(perime.error).toBeNull();
  });

  it('n’invente pas un « pas rafraîchi » quand il n’y a rien à l’écran', () => {
    expect(invalidateStats(IDLE_STATS).stale).toBe(false);
  });

  it('ne dérange pas une lecture en vol', () => {
    const enVol = beginStatsFetch(IDLE_STATS, NOW);
    expect(shouldFetchStats(invalidateStats(enVol), NOW + 1)).toBe(false);
  });
});

describe('applyStatsOutcome — un refus n’efface jamais un chiffre', () => {
  it('une lecture réussie remplace tout et éteint la marque « daté »', () => {
    const s = applyStatsOutcome(
      { ...IDLE_STATS, stale: true, error: 'rate_limited' },
      { ok: true, stats: stats({ itemCount: 40 }) },
      NOW
    );
    expect(s.stats?.itemCount).toBe(40);
    expect(s.error).toBeNull();
    expect(s.stale).toBe(false);
    expect(s.loading).toBe(false);
  });

  it('429 avec une valeur en main : on la GARDE, on la marque datée, sans crier au refus', () => {
    const avant = applyStatsOutcome(IDLE_STATS, { ok: true, stats: stats({ itemCount: 12 }) }, NOW);
    const apres = applyStatsOutcome(avant, { ok: false, code: 'rate_limited' }, NOW + 60_000);
    expect(apres.stats?.itemCount).toBe(12);
    expect(apres.stale).toBe(true);
    // Le plafond est le NÔTRE : le dire en rouge par-dessus des chiffres justes
    // ferait passer une borne que nous imposons pour un incident du serveur.
    expect(apres.error).toBeNull();
  });

  it('429 sans rien en main : on le DIT, et on n’invente pas un coffre vide', () => {
    const s = applyStatsOutcome(IDLE_STATS, { ok: false, code: 'rate_limited' }, NOW);
    expect(s.stats).toBeNull();
    expect(s.error).toBe('rate_limited');
  });

  it('une autre panne garde aussi la valeur, mais la nomme', () => {
    const avant = applyStatsOutcome(IDLE_STATS, { ok: true, stats: stats() }, NOW);
    const apres = applyStatsOutcome(
      avant,
      { ok: false, code: 'network_unavailable' },
      NOW + 60_000
    );
    expect(apres.stats).not.toBeNull();
    expect(apres.error).toBe('network_unavailable');
    expect(apres.stale).toBe(true);
  });
});

describe('hasInviteCounters — omis n’est pas zéro', () => {
  it('faux quand le serveur n’a pas servi les champs (rang en dessous d’admin)', () => {
    expect(hasInviteCounters(stats())).toBe(false);
  });

  it('vrai même à zéro : un admin a le droit de lire « aucune invitation »', () => {
    expect(hasInviteCounters(stats({ pendingInviteCount: 0, lapsedInviteCount: 0 }))).toBe(true);
  });
});

describe('roleRows — l’ordre du coffre, sans les rôles absents', () => {
  it('garde owner → admin → member → viewer et jette les zéros', () => {
    expect(roleRows({ owner: 1, admin: 0, member: 3, viewer: 2 })).toEqual([
      { role: 'owner', count: 1 },
      { role: 'member', count: 3 },
      { role: 'viewer', count: 2 },
    ]);
  });
});

/**
 * LE BOUTON QUI NE PEUT RIEN DONNER. « Réessayer » ne s'affiche qu'avec un
 * refus en main, donc — sur un 429 — seulement quand il ne reste AUCUN chiffre
 * à l'écran. Or le seau est de 120 lectures par heure et par COFFRE, partagé
 * par tous ses membres : avec le plancher de geste (3 s), s'acharner autorise
 * ~1 200 tentatives par heure sur un seau qui n'en accepte que 120, et pas une
 * seule ne peut aboutir. Le bouton est donc désarmé sur ce code-là, et sur
 * celui-là seulement : une panne réseau, elle, se réessaie.
 */
describe('mayRetryStats — désarmé exactement là où réessayer ne peut rien', () => {
  it('un 429 sans chiffre en main ferme le bouton', () => {
    const refus = applyStatsOutcome(IDLE_STATS, { ok: false, code: 'rate_limited' }, NOW);
    expect(refus.error).toBe('rate_limited');
    expect(mayRetryStats(refus)).toBe(false);
  });

  it('toute autre panne garde son Réessayer — le réseau, lui, se retente', () => {
    const refus = applyStatsOutcome(IDLE_STATS, { ok: false, code: 'stats_load_failed' }, NOW);
    expect(mayRetryStats(refus)).toBe(true);
  });

  it('une lecture en vol ne se redemande pas (deux réponses écriraient dans le désordre)', () => {
    expect(mayRetryStats(beginStatsFetch(IDLE_STATS, NOW))).toBe(false);
  });

  it('un 429 QUI GARDE ses chiffres ne ferme rien : le bandeau ne s’affiche même pas', () => {
    const avant = applyStatsOutcome(IDLE_STATS, { ok: true, stats: stats() }, NOW);
    const refus = applyStatsOutcome(avant, { ok: false, code: 'rate_limited' }, NOW + 60_000);
    expect(refus.error).toBeNull();
    expect(mayRetryStats(refus)).toBe(true);
  });
});

describe('typeRows — les trois familles, toujours', () => {
  it('rend note, file et transclusion même à zéro (absente se lirait « inconnue »)', () => {
    expect(typeRows({ note: 0, file: 2, transclusion: 0 })).toEqual([
      { kind: 'note', count: 0 },
      { kind: 'file', count: 2 },
      { kind: 'transclusion', count: 0 },
    ]);
  });
});

describe('memberUsage — un classement stable', () => {
  it('trie par octets décroissants, puis par éléments, puis par identifiant', () => {
    const out = memberUsage([
      { userId: 'u-b', itemCount: 1, bytes: 100 },
      { userId: 'u-a', itemCount: 9, bytes: 900 },
      { userId: 'u-c', itemCount: 4, bytes: 100 },
      { userId: 'u-a2', itemCount: 4, bytes: 100 },
    ]);
    expect(out.map((r) => r.userId)).toEqual(['u-a', 'u-a2', 'u-c', 'u-b']);
  });

  it('n’altère pas la liste d’origine', () => {
    const src = [
      { userId: 'u-b', itemCount: 1, bytes: 1 },
      { userId: 'u-a', itemCount: 1, bytes: 2 },
    ];
    memberUsage(src);
    expect(src[0].userId).toBe('u-b');
  });
});

describe('poolShare — le quota de QUI ?', () => {
  it('ne dit rien quand le coffre vit dans l’espace de quelqu’un d’autre', () => {
    expect(
      poolShare({
        vaultBytes: 3_100_000,
        seats: seats({ pooledStorageLimit: 10_000_000, pooledStorageUsed: 5_000_000 }),
        sameSpace: false,
      })
    ).toBeNull();
  });

  it('ne dit rien sans plafond servi — un pool sans borne n’a pas de part', () => {
    expect(poolShare({ vaultBytes: 10, seats: seats(), sameSpace: true })).toBeNull();
    expect(
      poolShare({ vaultBytes: 10, seats: seats({ pooledStorageLimit: 0 }), sameSpace: true })
    ).toBeNull();
    expect(poolShare({ vaultBytes: 10, seats: null, sameSpace: true })).toBeNull();
  });

  it('rend la part du coffre et le remplissage du pool', () => {
    const p = poolShare({
      vaultBytes: 2_500_000,
      seats: seats({ pooledStorageLimit: 10_000_000, pooledStorageUsed: 8_000_000 }),
      sameSpace: true,
    });
    expect(p?.vaultPct).toBe(25);
    expect(p?.poolPct).toBe(80);
    expect(p?.tone).toBe('warning');
  });

  it('les seuils : ok, puis warning, puis danger', () => {
    const tone = (used: number) =>
      poolShare({
        vaultBytes: 0,
        seats: seats({ pooledStorageLimit: 100, pooledStorageUsed: used }),
        sameSpace: true,
      })?.tone;
    expect(tone(POOL_WARNING_PCT - 1)).toBe('ok');
    expect(tone(POOL_WARNING_PCT)).toBe('warning');
    expect(tone(POOL_DANGER_PCT)).toBe('danger');
  });

  it('sans consommation servie, on borne ce qu’on affirme : la part du coffre, rien du pool', () => {
    const p = poolShare({
      vaultBytes: 50,
      seats: seats({ pooledStorageLimit: 100 }),
      sameSpace: true,
    });
    expect(p?.vaultPct).toBe(50);
    expect(p?.poolPct).toBeNull();
    expect(p?.tone).toBeNull();
  });

  it('une part au-dessus du plafond reste bornée à cent (jauge, pas débordement)', () => {
    const p = poolShare({
      vaultBytes: 300,
      seats: seats({ pooledStorageLimit: 100, pooledStorageUsed: 300 }),
      sameSpace: true,
    });
    expect(p?.vaultPct).toBe(100);
    expect(p?.poolPct).toBe(100);
  });
});

describe('recentJoins — les derniers arrivés', () => {
  const m = (userId: string, joinedAt: string) => ({ userId, joinedAt });

  it('rend les cinq plus récents, du plus récent au plus ancien', () => {
    const out = recentJoins([
      m('u1', '2026-01-01T00:00:00.000Z'),
      m('u2', '2026-06-01T00:00:00.000Z'),
      m('u3', '2026-03-01T00:00:00.000Z'),
      m('u4', '2026-08-01T00:00:00.000Z'),
      m('u5', '2026-02-01T00:00:00.000Z'),
      m('u6', '2026-07-01T00:00:00.000Z'),
    ]);
    expect(out.map((x) => x.userId)).toEqual(['u4', 'u6', 'u2', 'u3', 'u5']);
  });

  it('une date illisible passe en dernier — « on ne sait pas » n’est pas « à l’instant »', () => {
    const out = recentJoins([
      m('u-sans', 'pas une date'),
      m('u-vieux', '2020-01-01T00:00:00.000Z'),
    ]);
    expect(out.map((x) => x.userId)).toEqual(['u-vieux', 'u-sans']);
  });
});
