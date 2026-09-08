/**
 * vaultHeadsDiff — LA DÉCISION de la propagation vivante, isolée de son guetteur.
 *
 * CE QUE CES TESTS PROTÈGENT. Un guetteur qui recharge trop est pire qu'un
 * guetteur absent : il pilonne le worker, et il peut écraser ce que quelqu'un
 * est en train de faire. Un guetteur qui ne recharge pas assez ne se voit
 * jamais — il rend simplement la fonctionnalité fausse. Toute la décision vit
 * donc ici, en fonction pure, avec un test par verdict ET un test par
 * abstention.
 */

import { describe, it, expect } from 'vitest';
import {
  diffVaultHeads,
  prochainDelai,
  vaultTargetsFromPanels,
  INTERVALLE_MS,
  RECUL_MAX_MS,
  type VaultHead,
  type KnownVault,
  type HeadsDiffInput,
} from '../vaultHeadsDiff';

function head(vaultId: string, o: Partial<VaultHead> = {}): VaultHead {
  return {
    vaultId,
    itemsRevision: '1.1.0.1.0',
    memberCount: 2,
    settingsVersion: 1,
    currentKeyEpoch: 1,
    myWrappedEpoch: 1,
    frozenAt: null,
    deletedAt: null,
    ...o,
  };
}

function known(vaultId: string, o: Partial<KnownVault> = {}): KnownVault {
  return {
    vaultId,
    organizationId: 'org1',
    currentKeyEpoch: 1,
    wrappedVaultKeyEpoch: 1,
    frozenAt: null,
    ...o,
  };
}

function input(o: Partial<HeadsDiffInput> = {}): HeadsDiffInput {
  return {
    heads: [head('v1')],
    coveredOrgIds: ['org1'],
    known: [known('v1')],
    previous: { v1: head('v1') },
    visibleVaultIds: [],
    listedVaultIds: [],
    managedVaultIds: [],
    ...o,
  };
}

describe('diffVaultHeads — rien n’a bougé', () => {
  it('des têtes identiques ne déclenchent RIEN', () => {
    expect(diffVaultHeads(input())).toEqual({
      reloadVaults: false,
      reloadItems: [],
      reloadSettings: [],
      reloadManagement: [],
      goneVaultIds: [],
    });
  });

  it('le PREMIER tour (aucune tête précédente) ne recharge pas les éléments', () => {
    // Sans point de comparaison, tout paraîtrait neuf : le premier tour ne fait
    // qu'apprendre. Les faits que le MAGASIN porte déjà, eux, se comparent
    // quand même (voir plus bas) — mais pas la révision d'éléments, qu'il
    // ne porte pas.
    const d = diffVaultHeads(input({ previous: {}, visibleVaultIds: ['v1'] }));
    expect(d.reloadItems).toEqual([]);
    expect(d.reloadSettings).toEqual([]);
    expect(d.reloadVaults).toBe(false);
  });
});

describe('diffVaultHeads — les éléments', () => {
  it('révision changée ET coffre REGARDÉ → on relit ses éléments', () => {
    const d = diffVaultHeads(
      input({ heads: [head('v1', { itemsRevision: '2.2.0.2.0' })], visibleVaultIds: ['v1'] })
    );
    expect(d.reloadItems).toEqual(['v1']);
    expect(d.reloadVaults).toBe(false);
  });

  it("révision changée mais coffre PAS à l'écran → on ne relit rien", () => {
    // Le prix d'un déchiffrement complet de la liste pour un écran que
    // personne ne regarde ; il sera relu à l'ouverture, comme aujourd'hui.
    const d = diffVaultHeads(
      input({ heads: [head('v1', { itemsRevision: '2.2.0.2.0' })], visibleVaultIds: [] })
    );
    expect(d.reloadItems).toEqual([]);
  });

  it('deux coffres à l’écran (vue scindée) : seul celui qui a bougé est relu', () => {
    const d = diffVaultHeads(
      input({
        heads: [head('v1', { itemsRevision: '9.9.0.9.0' }), head('v2')],
        known: [known('v1'), known('v2')],
        previous: { v1: head('v1'), v2: head('v2') },
        visibleVaultIds: ['v1', 'v2'],
      })
    );
    expect(d.reloadItems).toEqual(['v1']);
  });
});

describe('diffVaultHeads — les réglages', () => {
  it('settingsVersion changée → relecture des réglages, même hors écran', () => {
    // Les réglages décident de ce que TROIS surfaces s'autorisent (suppression
    // réservée aux admins, partage par élément, plafond d'expiration) : les
    // laisser périmés fait proposer un geste que le serveur refusera.
    const d = diffVaultHeads(input({ heads: [head('v1', { settingsVersion: 2 })] }));
    expect(d.reloadSettings).toEqual(['v1']);
    expect(d.reloadItems).toEqual([]);
    expect(d.reloadVaults).toBe(false);
  });
});

describe('diffVaultHeads — le résumé du coffre', () => {
  it("l'effectif a changé → loadVaults", () => {
    const d = diffVaultHeads(input({ heads: [head('v1', { memberCount: 3 })] }));
    expect(d.reloadVaults).toBe(true);
  });

  it('une ROTATION de clé (currentKeyEpoch) → loadVaults', () => {
    const d = diffVaultHeads(input({ heads: [head('v1', { currentKeyEpoch: 2 })] }));
    expect(d.reloadVaults).toBe(true);
  });

  it('MON wrap a changé d’époque (on m’a rescellé la clé) → loadVaults', () => {
    const d = diffVaultHeads(input({ heads: [head('v1', { myWrappedEpoch: 2 })] }));
    expect(d.reloadVaults).toBe(true);
  });

  it('le GEL vient d’être posé → loadVaults', () => {
    const d = diffVaultHeads(input({ heads: [head('v1', { frozenAt: '2026-08-30 10:00:00' })] }));
    expect(d.reloadVaults).toBe(true);
  });

  it('le gel vient d’être LEVÉ → loadVaults', () => {
    const d = diffVaultHeads(
      input({
        heads: [head('v1', { frozenAt: null })],
        known: [known('v1', { frozenAt: '2026-08-30 10:00:00' })],
        previous: { v1: head('v1', { frozenAt: '2026-08-30 10:00:00' }) },
      })
    );
    expect(d.reloadVaults).toBe(true);
  });

  it("l'hôte a SUPPRIMÉ le coffre → loadVaults (il tombera de la liste)", () => {
    const d = diffVaultHeads(input({ heads: [head('v1', { deletedAt: '2026-08-30 11:00:00' })] }));
    expect(d.reloadVaults).toBe(true);
  });

  it('un coffre supprimé DÉJÀ retiré de notre liste ne relance rien (sinon : boucle)', () => {
    // Le worker continue de servir sa tête (c'est ainsi qu'on apprend la
    // suppression) ; `loadVaults`, lui, l'a déjà écarté. Sans cette règle, les
    // deux se contrediraient tous les 25 secondes, pour toujours.
    const d = diffVaultHeads(
      input({
        heads: [head('v1', { deletedAt: '2026-08-30 11:00:00' })],
        known: [],
        previous: { v1: head('v1', { deletedAt: '2026-08-30 11:00:00' }) },
      })
    );
    expect(d.reloadVaults).toBe(false);
    expect(d.goneVaultIds).toEqual([]);
  });

  it('un coffre INCONNU du magasin apparaît (on vient de m’y ajouter) → loadVaults', () => {
    const d = diffVaultHeads(
      input({ heads: [head('v1'), head('v2')], previous: { v1: head('v1') } })
    );
    expect(d.reloadVaults).toBe(true);
  });

  it('la page « Gérer le coffre » ouverte est prévenue en plus du magasin', () => {
    const d = diffVaultHeads(
      input({ heads: [head('v1', { memberCount: 3 })], managedVaultIds: ['v1'] })
    );
    expect(d.reloadManagement).toEqual(['v1']);
  });

  it("la page de gestion d'un AUTRE coffre n'est pas rechargée", () => {
    const d = diffVaultHeads(
      input({ heads: [head('v1', { memberCount: 3 })], managedVaultIds: ['v2'] })
    );
    expect(d.reloadManagement).toEqual([]);
  });
});

describe('diffVaultHeads — le coffre qui DISPARAÎT', () => {
  it('un coffre connu absent de la réponse : il ne nous appartient plus', () => {
    const d = diffVaultHeads(input({ heads: [], known: [known('v1')] }));
    expect(d.goneVaultIds).toEqual(['v1']);
    // Le verrouillage n'est PAS refait ici : `loadVaults` verrouille déjà tout
    // identifiant sorti de sa liste. On demande le rechargement, lui ferme.
    expect(d.reloadVaults).toBe(true);
  });

  it('LE PIÈGE MULTI-ESPACES : un coffre d’un espace NON couvert n’est jamais déclaré perdu', () => {
    // La route est portée par un espace (X-Org-Id) ; la liste du magasin, elle,
    // fusionne TOUS les espaces. Sans ce filtre, sonder mon espace perso
    // verrouillerait tous les coffres où l'on m'a invité — la perte d'accès la
    // plus spectaculaire qu'on puisse s'infliger tout seul.
    const d = diffVaultHeads(
      input({
        heads: [head('v1')],
        coveredOrgIds: ['org1'],
        known: [known('v1'), known('vAilleurs', { organizationId: 'org2' })],
      })
    );
    expect(d.goneVaultIds).toEqual([]);
    expect(d.reloadVaults).toBe(false);
  });

  it('aucun espace couvert (toutes les requêtes ont échoué) → aucune conclusion', () => {
    const d = diffVaultHeads(input({ heads: [], coveredOrgIds: [], known: [known('v1')] }));
    expect(d.goneVaultIds).toEqual([]);
    expect(d.reloadVaults).toBe(false);
  });
});

describe('rememberVaultHeads — la mémoire du tour précédent', () => {
  it('ne retient QUE les espaces couverts : un espace muet garde sa mémoire', async () => {
    const { rememberVaultHeads } = await import('../vaultHeadsDiff');
    const memoire = rememberVaultHeads(
      { v1: head('v1'), vAilleurs: head('vAilleurs') },
      [head('v1', { memberCount: 5 })],
      ['org1'],
      [known('v1'), known('vAilleurs', { organizationId: 'org2' })]
    );
    expect(memoire.v1.memberCount).toBe(5);
    // Non couvert : sa tête d'avant survit, sinon le tour suivant la croirait
    // neuve et rechargerait pour rien.
    expect(memoire.vAilleurs.memberCount).toBe(2);
  });

  it("oublie un coffre COUVERT qui a disparu (sinon sa mémoire ne s'éteint jamais)", async () => {
    const { rememberVaultHeads } = await import('../vaultHeadsDiff');
    const memoire = rememberVaultHeads({ v1: head('v1') }, [], ['org1'], [known('v1')]);
    expect(memoire.v1).toBeUndefined();
  });
});

describe('prochainDelai — le recul', () => {
  it('régime normal : la cadence nominale', () => {
    expect(prochainDelai(0)).toBe(INTERVALLE_MS);
    expect(prochainDelai(-1)).toBe(INTERVALLE_MS);
  });

  it('double à chaque échec consécutif', () => {
    expect(prochainDelai(1)).toBe(INTERVALLE_MS * 2);
    expect(prochainDelai(2)).toBe(INTERVALLE_MS * 4);
    expect(prochainDelai(3)).toBe(INTERVALLE_MS * 8);
  });

  it('plafonne à cinq minutes — un worker en peine ne doit pas être martelé', () => {
    expect(prochainDelai(20)).toBe(RECUL_MAX_MS);
    expect(prochainDelai(1000)).toBe(RECUL_MAX_MS);
  });
});

describe("vaultTargetsFromPanels — ce qu'on regarde vraiment", () => {
  const panneau = (activeTabId: string, tabs: Array<{ id: string; route: string }>) => ({
    activeTabId,
    tabs,
  });

  it("l'onglet ACTIF compte, l'onglet en arrière-plan non", () => {
    const r = vaultTargetsFromPanels([
      panneau('a', [
        { id: 'a', route: '/vault-folder/v1' },
        { id: 'b', route: '/vault-folder/vCache' },
      ]),
    ]);
    expect(r.visibleVaultIds).toEqual(['v1']);
  });

  it('la vue SCINDÉE en montre deux à la fois', () => {
    const r = vaultTargetsFromPanels([
      panneau('a', [{ id: 'a', route: '/vault-folder/v1' }]),
      panneau('c', [{ id: 'c', route: '/vault-folder/v2?item=xyz' }]),
    ]);
    expect(r.visibleVaultIds).toEqual(['v1', 'v2']);
  });

  it("la page « Gérer le coffre » est À L'ÉCRAN *et* gérée", () => {
    const r = vaultTargetsFromPanels([
      panneau('a', [{ id: 'a', route: '/vault-folder/v1?view=settings&tab=membres' }]),
    ]);
    expect(r.visibleVaultIds).toEqual(['v1']);
    expect(r.managedVaultIds).toEqual(['v1']);
  });

  it('une route qui n’est pas un coffre ne donne rien', () => {
    const r = vaultTargetsFromPanels([
      panneau('a', [{ id: 'a', route: '/' }]),
      panneau('b', [{ id: 'b', route: '/settings' }]),
      panneau('c', []),
    ]);
    expect(r).toEqual({ visibleVaultIds: [], managedVaultIds: [] });
  });

  it('le même coffre dans les deux panneaux ne compte qu’une fois', () => {
    const r = vaultTargetsFromPanels([
      panneau('a', [{ id: 'a', route: '/vault-folder/v1' }]),
      panneau('b', [{ id: 'b', route: '/vault-folder/v1?view=settings' }]),
    ]);
    expect(r.visibleVaultIds).toEqual(['v1']);
    expect(r.managedVaultIds).toEqual(['v1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LES COFFRES LISTÉS AILLEURS QUE DANS LEUR EXPLORATEUR
//
// La section « Coffres partagés » de l'onglet Notes montre les notes de
// PLUSIEURS coffres à la fois, hors de toute route `/vault-folder/…`. Sans elle,
// « regardé » se réduisait à l'onglet actif d'un panneau — et une note ajoutée
// par quelqu'un d'autre n'apparaissait donc jamais dans cette section.
//
// Ce qu'on garde ici, c'est la BORNE : la section déclare ce qu'elle affiche, et
// rien d'autre ne s'y ajoute. Le jour où quelqu'un y verserait tous les coffres
// connus, le guetteur déchiffrerait en boucle des listes que personne ne regarde
// — le contraire exact de ce que la propagation vivante a coûté à écrire.
// ─────────────────────────────────────────────────────────────────────────────

describe('diffVaultHeads — les coffres LISTÉS hors de leur explorateur', () => {
  it('un coffre listé voit ses éléments relus quand sa révision bouge', () => {
    const d = diffVaultHeads(
      input({ heads: [head('v1', { itemsRevision: '2.2.0.2.0' })], listedVaultIds: ['v1'] })
    );
    expect(d.reloadItems).toEqual(['v1']);
  });

  it('un coffre NI regardé NI listé ne coûte rien', () => {
    const d = diffVaultHeads(
      input({ heads: [head('v1', { itemsRevision: '2.2.0.2.0' })], listedVaultIds: [] })
    );
    expect(d.reloadItems).toEqual([]);
  });

  it('listé ET regardé ne se recharge qu UNE fois', () => {
    // Deux dispatches `loadVaultItems` pour le même coffre, ce serait deux
    // déchiffrements de la même liste à chaque tour de 25 secondes.
    const d = diffVaultHeads(
      input({
        heads: [head('v1', { itemsRevision: '2.2.0.2.0' })],
        visibleVaultIds: ['v1'],
        listedVaultIds: ['v1'],
      })
    );
    expect(d.reloadItems).toEqual(['v1']);
  });

  it('sans tête précédente, un coffre listé n apprend rien non plus', () => {
    // Premier tour : l'écran vient d'être chargé, il est déjà à jour. La règle
    // est la même que pour un coffre regardé — on apprend sans conclure.
    const d = diffVaultHeads(input({ previous: {}, listedVaultIds: ['v1'] }));
    expect(d.reloadItems).toEqual([]);
  });
});
