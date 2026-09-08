/**
 * epochCoverage (F10) — qui détient QUELLE clé du coffre, et ce que la rotation
 * laisse derrière elle.
 *
 * POURQUOI CE MODÈLE EXISTE. Une rotation engendre K_vault' et la scelle aux
 * membres RESTANTS. Trois populations ne suivent pas automatiquement :
 *   · un membre dont le scellé est resté à une époque antérieure (le serveur
 *     sert `wrappedEpoch` aux administrateurs — c'est ce champ qui le dit) ;
 *   · une invitation en attente scellée sous l'ancienne clé : la relancer ne
 *     peut qu'échouer (`invite_stale_epoch`), il faut la RÉÉMETTRE ;
 *   · les éléments déjà chiffrés, qui restent sous leur époque d'origine (le
 *     re-key est paresseux) et le RESTERONT : v1 les compte, ne les rescelle
 *     pas.
 *
 * LA RÈGLE QUI TRAVERSE TOUT LE FICHIER : une ABSENCE D'INFORMATION n'est
 * jamais un verdict. `wrappedEpoch` absent (rang en dessous d'admin, worker
 * d'avant la fiche) ne vaut ni « à jour » ni « en retard » — il vaut inconnu, et
 * l'écran ne compte pas quelqu'un dans une colonne où il n'est peut-être pas.
 * C'est la même règle que `inSpace` (F08) et que la conservation légale (F19).
 *
 * ET LE COMPTEUR D'ÉLÉMENTS NE MENT PAS PAR OMISSION : un coffre jamais ouvert
 * n'a AUCUN élément en mémoire ; annoncer « 0 élément ancien » y serait faux, et
 * c'est le pire des trois états possibles (rassurant et faux).
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/epochCoverage.vitest.ts
 */

import { describe, it, expect } from 'vitest';
import {
  inviteEpochCoverage,
  itemEpochCoverage,
  memberEpochCoverage,
  mySealVerdict,
  sealVerdictAlerts,
} from '../epochCoverage';
import { groupInvites } from '../inviteLifecycleModel';
import type { VaultInviteDTO } from '../../../../../services/vault/vaultApi';

const membre = (userId: string, wrappedEpoch?: number) => ({ userId, wrappedEpoch });

describe('la couverture des membres', () => {
  it('sépare à jour, en retard et inconnu — et ne devine rien', () => {
    const c = memberEpochCoverage([membre('a', 3), membre('b', 1), membre('c'), membre('d', 3)], 3);
    expect(c.upToDate.map((r) => r.userId)).toEqual(['a', 'd']);
    expect(c.behind.map((r) => r.userId)).toEqual(['b']);
    expect(c.unknown.map((r) => r.userId)).toEqual(['c']);
    expect(c.known).toBe(true);
  });

  it('AUCUN scellé connu = « on ne sait pas », pas « tout le monde est à jour »', () => {
    const c = memberEpochCoverage([membre('a'), membre('b')], 2);
    expect(c.known).toBe(false);
    expect(c.upToDate).toEqual([]);
    expect(c.behind).toEqual([]);
    expect(c.unknown).toHaveLength(2);
  });

  it('un scellé EN AVANCE sur l’époque connue de l’écran compte comme à jour', () => {
    // Le résumé en mémoire peut être en retard sur le serveur (une rotation
    // vient d'avoir lieu) : ranger ce membre « en retard » serait une alerte
    // fabriquée par notre propre fraîcheur.
    const c = memberEpochCoverage([membre('a', 4)], 3);
    expect(c.behind).toEqual([]);
    expect(c.upToDate.map((r) => r.userId)).toEqual(['a']);
  });

  it('les plus en retard d’abord : c’est par eux qu’on rattrape', () => {
    const c = memberEpochCoverage([membre('a', 2), membre('b', 1), membre('c', 3)], 4);
    expect(c.behind.map((r) => r.userId)).toEqual(['b', 'a', 'c']);
  });
});

describe('les invitations en attente scellées sous une clé révolue', () => {
  const invite = (id: string, epoch?: number): VaultInviteDTO => ({
    id,
    vaultId: 'v1',
    inviteeEmail: `${id}@x.test`,
    role: 'member',
    status: 'pending',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    ...(epoch === undefined ? {} : { wrappedVaultKeyEpoch: epoch }),
  });

  it('nomme celles qu’il faut réémettre, et laisse l’inconnu de côté', () => {
    const c = inviteEpochCoverage([invite('a', 1), invite('b', 3), invite('c')], 3);
    expect(c.toReissue.map((i) => i.id)).toEqual(['a']);
    expect(c.upToDate.map((i) => i.id)).toEqual(['b']);
    expect(c.unknown.map((i) => i.id)).toEqual(['c']);
  });

  /**
   * LE GARDE QUI COMPTE VRAIMENT. L'onglet Invitations marque chaque ligne
   * (`groupInvites` → `staleEpoch`) et la section « Clé du coffre » compte le
   * même fait. Deux comptes tirés du même champ finissent toujours par diverger
   * le jour où l'un des deux change de règle — et un compteur qui ne
   * correspond pas à la liste qu'il ouvre est pire que pas de compteur.
   */
  it('compte EXACTEMENT ce que l’onglet Invitations marque', () => {
    const invites = [invite('a', 1), invite('b', 3), invite('c'), invite('d', 2)];
    const groupes = groupInvites({
      invites,
      settled: [],
      lapsed: [],
      nowMs: Date.now(),
      currentKeyEpoch: 3,
      directory: [],
      directoryState: 'unavailable',
    });
    expect(inviteEpochCoverage(invites, 3).toReissue).toHaveLength(groupes.toReissue);
  });
});

describe('les éléments scellés sous une époque ancienne', () => {
  const item = (id: string, epoch: number) => ({ id, wrappedUnderEpoch: epoch });

  it('compte les anciens et les groupe par époque, la plus ancienne d’abord', () => {
    const c = itemEpochCoverage([item('a', 1), item('b', 1), item('c', 2), item('d', 3)], 3);
    expect(c.known).toBe(true);
    expect(c.total).toBe(4);
    expect(c.old).toBe(3);
    expect(c.byEpoch).toEqual([
      { epoch: 1, count: 2 },
      { epoch: 2, count: 1 },
    ]);
  });

  it('un coffre jamais ouvert ne rend AUCUN chiffre — pas « zéro »', () => {
    const c = itemEpochCoverage(undefined, 3);
    expect(c.known).toBe(false);
    expect(c.old).toBe(0);
    expect(c.byEpoch).toEqual([]);
  });

  it('un coffre ouvert et vide est connu, et sans ancien', () => {
    const c = itemEpochCoverage([], 3);
    expect(c.known).toBe(true);
    expect(c.total).toBe(0);
    expect(c.old).toBe(0);
  });

  it('à l’époque 1, rien n’est ancien', () => {
    const c = itemEpochCoverage([item('a', 1), item('b', 1)], 1);
    expect(c.old).toBe(0);
    expect(c.byEpoch).toEqual([]);
  });
});

describe('l’auto-contrôle : MON scellé de l’époque courante s’ouvre-t-il ?', () => {
  it('à jour et ouvrable : rien à dire', () => {
    expect(
      mySealVerdict({
        currentKeyEpoch: 3,
        wrappedVaultKeyEpoch: 3,
        canOpenCurrent: true,
        deviceHasKeys: true,
      })
    ).toBe('ok');
  });

  it('un scellé RESTÉ à une époque antérieure : personne ne m’a rescellé', () => {
    expect(
      mySealVerdict({
        currentKeyEpoch: 3,
        wrappedVaultKeyEpoch: 2,
        canOpenCurrent: false,
        deviceHasKeys: true,
      })
    ).toBe('behind');
  });

  it('le bon numéro d’époque mais rien qui s’ouvre : le scellé ne vaut rien', () => {
    // C'est le cas que le seul numéro d'époque ne voit pas : le serveur dit
    // qu'on détient l'époque courante, et pourtant la clé n'est pas là.
    expect(
      mySealVerdict({
        currentKeyEpoch: 3,
        wrappedVaultKeyEpoch: 3,
        canOpenCurrent: false,
        deviceHasKeys: true,
      })
    ).toBe('unreadable');
  });

  it('un coffre dont on ignore l’époque ne déclenche AUCUNE alerte', () => {
    expect(
      mySealVerdict({
        currentKeyEpoch: 0,
        wrappedVaultKeyEpoch: 0,
        canOpenCurrent: false,
        deviceHasKeys: true,
      })
    ).toBe('unknown');
  });

  /**
   * LE CAS QUE L'ÉPOQUE 1 SEULE NE COUVRAIT PAS. Un appareil sans paire de clés
   * (première ouverture avant l'import, session verrouillée, mot de passe de
   * contrainte) n'ouvre RIEN — pas ce scellé-ci en particulier. Déduire de ce
   * silence que le scellé « ne vaut rien » et afficher le nom d'un
   * administrateur à qui demander une rotation, c'est nommer un coupable à
   * partir d'une absence : la faute même que ce fichier interdit partout
   * ailleurs.
   */
  it('sans paire de clés sur cet appareil, rien ne s’ouvre — et personne n’est accusé', () => {
    expect(
      mySealVerdict({
        currentKeyEpoch: 3,
        wrappedVaultKeyEpoch: 3,
        canOpenCurrent: false,
        deviceHasKeys: false,
      })
    ).toBe('locked');
    expect(sealVerdictAlerts('locked')).toBe(false);
  });

  it('un scellé RESTÉ en arrière reste un fait du serveur, même appareil verrouillé', () => {
    // « Mon wrap est à l'époque 2 alors que le coffre est à la 3 » ne se déduit
    // d'aucune absence : c'est le serveur qui le dit, et le remède (redemander
    // une rotation) est le bon, clé chargée ici ou non.
    expect(
      mySealVerdict({
        currentKeyEpoch: 3,
        wrappedVaultKeyEpoch: 2,
        canOpenCurrent: false,
        deviceHasKeys: false,
      })
    ).toBe('behind');
  });

  it('une clé du coffre déjà ouverte en session vaut « ok », paire chargée ou non', () => {
    // Le cache mémoire de K_vault survit à un effacement de la paire ; ce qui
    // s'ouvre s'ouvre, et l'affirmer n'invente rien.
    expect(
      mySealVerdict({
        currentKeyEpoch: 3,
        wrappedVaultKeyEpoch: 3,
        canOpenCurrent: true,
        deviceHasKeys: false,
      })
    ).toBe('ok');
  });

  it('un coffre simplement verrouillé à l’époque 1 n’accuse personne d’une rotation ratée', () => {
    // Sans rotation (époque 1), une clé absente veut dire « déverrouillez » —
    // demander à un administrateur de refaire une rotation qui n'a jamais eu
    // lieu enverrait chercher un coupable inexistant.
    expect(
      mySealVerdict({
        currentKeyEpoch: 1,
        wrappedVaultKeyEpoch: 1,
        canOpenCurrent: false,
        deviceHasKeys: true,
      })
    ).toBe('locked');
  });
});
