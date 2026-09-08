import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

/**
 * L'AJOUT DIRECT (F06 / décision D1) — donner l'accès sans passer par un jeton.
 *
 * CE QUE CE CHEMIN SUPPOSE, ET QUI EST VRAI. Accepter une invitation de coffre
 * ne demandait JAMAIS la clé privée de l'invitée : le worker copiait le scellé
 * de `vault_invites` vers `vault_memberships`. Le jeton n'était donc pas une
 * opération de clé, mais un consentement — et l'entrée dans l'espace le porte
 * déjà. Pour quelqu'un qui est là, l'invitation n'ajoutait qu'un délai de sept
 * jours et une chose de plus qui pouvait expirer.
 *
 * CE QUE CE CHEMIN NE RELÂCHE PAS, et c'est tout l'objet de ces tests :
 *   — on ne scelle QUE la clé exactement vérifiée par la cérémonie (`peerKey`),
 *     jamais une clé re-téléchargée : la redemander rouvrirait la fenêtre où le
 *     serveur peut en substituer une autre entre le contrôle et le scellé ;
 *   — on ne scelle jamais à quelqu'un d'autre que la personne sous l'identifiant
 *     de qui l'adhésion est écrite (`peer_key_mismatch`) ;
 *   — coffre verrouillé, rien ne part : il n'y a matériellement pas de K_vault ;
 *   — les refus du serveur remontent VERBATIM, parce que « cette personne a déjà
 *     accès » et « elle n'est plus dans votre espace » appellent deux gestes
 *     opposés de la part de l'hôte.
 */

const tofu = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => tofu.get(k) ?? null,
  setItem: (k: string, v: string) => {
    tofu.set(k, v);
  },
  removeItem: (k: string) => {
    tofu.delete(k);
  },
};

const server = vi.hoisted(() => ({
  /** `null` = coffre verrouillé : la clé n'est pas en mémoire. */
  vaultKey: new Uint8Array(32) as Uint8Array | null,
  /** Le refus que `POST /members` rend, ou `null` quand il accepte. */
  addFailure: null as string | null,
}));

vi.mock('../../../services/network/apiClient', () => ({
  default: {},
  getOrgContextId: () => 'org1',
  getImplicitOrg: () => 'org1',
  setImplicitOrg: vi.fn(),
  setActiveOrg: vi.fn(),
  rememberVaultOrg: vi.fn(),
  getRememberedVaultOrg: () => 'org1',
  forgetVaultOrg: vi.fn(),
  forgetVaultOrgs: vi.fn(),
}));

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiAddVaultMember: vi.fn(async (_v: string, body: { userId: string; role: string }) => {
      if (server.addFailure) throw new Error(server.addFailure);
      return {
        userId: body.userId,
        role: body.role,
        joinedAt: '2026-08-28T10:00:00Z',
        email: 'zoe@x.io',
        inSpace: true,
      };
    }),
    apiInviteVaultMember: vi.fn(async () => undefined),
    apiGetMemberPublicKey: vi.fn(async (userId: string) => ({
      userId,
      encPublicKey: `ENC_${userId}`,
      signPublicKey: `SIGN_${userId}`,
      fingerprint: `FP_${userId}`,
      keyAlgo: 'x25519',
    })),
    apiGetKeyLog: vi.fn(async () => []),
    apiListPendingGrants: vi.fn(async () => [
      { inviteId: 'inv1', email: 'zoe@x.io', userId: 'u-zoe', role: 'member', hasKey: true },
    ]),
    apiListVaults: vi.fn(async () => []),
    apiEnsurePersonalSpace: vi.fn(async () => ({ orgId: 'org1' })),
  };
});

vi.mock('../../../services/vault/vaultCrypto', () => ({
  generateVaultKey: () => new Uint8Array(32),
  wrapVaultKeyForMember: vi.fn(
    async (_k: Uint8Array, peer: { userId: string }) => `W_${peer.userId}`
  ),
  decryptVaultName: vi.fn(async () => 'nom'),
  encryptVaultName: vi.fn(async () => ({ nameEncrypted: 'N', nameIv: 'IV' })),
  unwrapItemKey: vi.fn(),
  decryptItemMeta: vi.fn(),
  decryptItemChunk: vi.fn(),
  generateItemKey: vi.fn(),
  encryptItemMeta: vi.fn(),
  encryptItemChunk: vi.fn(),
  wrapItemKey: vi.fn(),
  wrapVaultKey: vi.fn(),
  unwrapVaultKey: vi.fn(),
}));

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: () => server.vaultKey,
  unlockVault: vi.fn(async () => new Uint8Array(32)),
  isVaultUnlocked: () => true,
  lockVault: vi.fn(),
  lockVaultEverywhere: vi.fn(),
  putVaultKey: vi.fn(),
  clearAllVaultKeys: vi.fn(),
}));

vi.mock('../../../services/collab/collabSession', () => ({ purgeVaultCollab: vi.fn() }));

import vaultsReducer, {
  addMemberDirect,
  grantSealedManually,
  sweepPendingGrants,
} from '../vaultsSlice';
import { apiAddVaultMember, apiInviteVaultMember } from '../../../services/vault/vaultApi';
import { wrapVaultKeyForMember } from '../../../services/vault/vaultCrypto';

/** La clé publique que la cérémonie a vérifiée — celle-là, et pas une autre. */
const VERIFIEE = {
  userId: 'u-zoe',
  encPublicKey: 'ENC_VERIFIEE',
  signPublicKey: 'SIGN_VERIFIEE',
  fingerprint: 'FP_VERIFIEE',
  keyAlgo: 'x25519',
};

function makeStore() {
  return configureStore({
    reducer: {
      vaults: vaultsReducer,
      org: () => ({ orgs: [], currentOrgId: 'org1', spaceMode: 'personal' }),
      auth: () => ({ cloudUser: { subscriptionTier: 'pro' } }),
    },
    preloadedState: {
      vaults: {
        vaults: {
          v1: {
            id: 'v1',
            organizationId: 'org1',
            ownerUserId: 'moi',
            name: 'Coffre',
            currentKeyEpoch: 3,
            wrappedVaultKeyEpoch: 3,
            role: 'owner',
            createdAt: '',
          },
        },
        vaultIds: ['v1'],
        itemsByVault: {},
        decryptStatusByVault: {},
        loadFailureByVault: {},
        rewrapProgress: {},
        noteContentByRef: {},
        unlockedVaultIds: ['v1'],
        activityHeads: [],
        activitySeenVersion: 0,
        deletedVaults: [],
        deletedVaultsLoading: false,
        myInvitations: [],
        myInvitationsLoading: false,
        awaitingHost: [],
        blockedGrants: [],
        loading: false,
        error: null,
        initialLoadRequested: false,
        listLoadedOnce: false,
        lastLoadHadKeypair: false,
      },
    },
  });
}

const donnerAcces = (over: Record<string, unknown> = {}) =>
  addMemberDirect({
    vaultId: 'v1',
    userId: 'u-zoe',
    email: 'zoe@x.io',
    role: 'member' as const,
    peerKey: VERIFIEE,
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  tofu.clear();
  server.vaultKey = new Uint8Array(32);
  server.addFailure = null;
});

describe('addMemberDirect — l’adhésion est créée sur-le-champ', () => {
  it('scelle K_vault à la clé VÉRIFIÉE et poste userId + rôle + scellé', async () => {
    const store = makeStore();

    const r = await store.dispatch(donnerAcces());

    expect(addMemberDirect.fulfilled.match(r)).toBe(true);
    // La clé passée par la cérémonie, à l'identité : re-la chercher rouvrirait
    // le TOCTOU que la vérification vient précisément de fermer.
    expect(vi.mocked(wrapVaultKeyForMember).mock.calls[0][1]).toBe(VERIFIEE);
    expect(apiAddVaultMember).toHaveBeenCalledWith('v1', {
      userId: 'u-zoe',
      role: 'member',
      wrappedVaultKey: 'W_u-zoe',
    });
    // Aucune invitation n'est émise : c'est tout le point de la fiche.
    expect(apiInviteVaultMember).not.toHaveBeenCalled();
  });

  it('rend la ligne du membre telle que le trombinoscope la servira', async () => {
    const store = makeStore();

    const r = await store.dispatch(donnerAcces());

    expect(r.payload).toMatchObject({
      vaultId: 'v1',
      member: { userId: 'u-zoe', role: 'member', email: 'zoe@x.io', inSpace: true },
    });
  });

  it('REFUSE un coffre verrouillé — il n’y a pas de clé à sceller', async () => {
    server.vaultKey = null;
    const store = makeStore();

    const r = await store.dispatch(donnerAcces());

    expect(addMemberDirect.rejected.match(r)).toBe(true);
    expect(r.payload).toBe('Vault is locked');
    expect(apiAddVaultMember).not.toHaveBeenCalled();
  });

  it('REFUSE une clé publique qui n’est pas celle de la personne visée', async () => {
    // Une sélection qui a bougé pendant la cérémonie scellerait sinon le coffre
    // à quelqu'un d'autre, sous l'identifiant de la personne choisie.
    const store = makeStore();

    const r = await store.dispatch(
      donnerAcces({ peerKey: { ...VERIFIEE, userId: 'quelqu-un-d-autre' } })
    );

    expect(addMemberDirect.rejected.match(r)).toBe(true);
    expect(r.payload).toBe('peer_key_mismatch');
    expect(apiAddVaultMember).not.toHaveBeenCalled();
  });

  it('remonte le refus du serveur VERBATIM (already_member)', async () => {
    // « Cette personne a déjà accès » et « elle n'est plus dans votre espace »
    // appellent deux gestes opposés : les fondre en « échec » les perd.
    server.addFailure = 'already_member';
    const store = makeStore();

    const r = await store.dispatch(donnerAcces());

    expect(addMemberDirect.rejected.match(r)).toBe(true);
    expect(r.payload).toBe('already_member');
  });

  it('un coffre inconnu du store ne part pas à l’aveugle', async () => {
    const store = makeStore();
    const r = await store.dispatch(donnerAcces({ vaultId: 'fantome' }));
    expect(addMemberDirect.rejected.match(r)).toBe(true);
    expect(apiAddVaultMember).not.toHaveBeenCalled();
  });
});

/**
 * LE BALAYAGE DES INTENTIONS SCELLE MAINTENANT PAR AJOUT DIRECT.
 *
 * Une intention mûre (0073) veut dire que la personne est DÉJÀ active dans
 * l'espace de l'hôte : lui envoyer une invitation de coffre ajoutait un e-mail,
 * une attente et une péremption à sept jours pour un consentement qu'elle avait
 * déjà donné en entrant. Les verdicts de transparence, eux, ne bougent pas d'un
 * cran : `runGrantSweep` refuse toujours de sceller sous `changed`,
 * `served_not_latest` ou `tampered_log`.
 */
describe('sweepPendingGrants — la promesse est tenue sans invitation', () => {
  it('fait entrer la personne directement, sans émettre d’invitation', async () => {
    const store = makeStore();

    const r = await store.dispatch(sweepPendingGrants());

    expect(apiAddVaultMember).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiAddVaultMember).mock.calls[0][1]).toMatchObject({
      userId: 'u-zoe',
      role: 'member',
    });
    expect(apiInviteVaultMember).not.toHaveBeenCalled();
    expect(r.payload).toMatchObject({ granted: [{ vaultId: 'v1', email: 'zoe@x.io' }] });
  });

  it('un refus de l’ajout est remonté comme blocage, pas comme accès accordé', async () => {
    server.addFailure = 'rate_limited';
    const store = makeStore();

    const r = await store.dispatch(sweepPendingGrants());

    expect(r.payload).toMatchObject({
      granted: [],
      blocked: [{ vaultId: 'v1', email: 'zoe@x.io', userId: 'u-zoe', reason: 'seal_failed' }],
    });
  });

  /**
   * LA PORTÉE (F04, « Réessayer maintenant »). La fiche « Où en est l'accès de
   * X ? » relance le balayage POUR CE COFFRE. Sans portée, le réducteur
   * remplaçait toute la liste des blocages par ce qu'un tour partiel avait vu :
   * les blocages des autres coffres — qu'on n'a même pas interrogés —
   * disparaissaient, et l'hôte cessait de voir ce qui l'attendait ailleurs.
   */
  it('un balayage CIBLÉ ne touche qu’à la part de la liste qu’il a examinée', async () => {
    server.addFailure = 'rate_limited';
    const store = makeStore();
    // Un blocage venu d'un autre coffre, posé par un tour précédent.
    const ailleurs = {
      vaultId: 'v-autre',
      email: 'bob@x.io',
      userId: 'u-bob',
      reason: 'key_unverified' as const,
    };
    store.dispatch({
      type: sweepPendingGrants.fulfilled.type,
      payload: { granted: [], blocked: [ailleurs], scope: null },
    });

    await store.dispatch(sweepPendingGrants({ vaultIds: ['v1'] }));

    const blocked = store.getState().vaults.blockedGrants;
    expect(blocked).toContainEqual(ailleurs);
    expect(blocked).toContainEqual({
      vaultId: 'v1',
      email: 'zoe@x.io',
      userId: 'u-zoe',
      reason: 'seal_failed',
    });
  });

  it('refuse un second balayage tant que le premier est en vol', async () => {
    // Deux passages qui se croisent scellent deux fois la même personne : le
    // serveur refuse le second, et l'hôte lit un refus là où tout s'est bien
    // passé. La garde vivait dans une `ref` de l'hôte de démarrage, qui ne
    // voyait donc pas les dispatches venus d'un écran.
    const store = makeStore();

    const [premier, second] = await Promise.all([
      store.dispatch(sweepPendingGrants()),
      store.dispatch(sweepPendingGrants()),
    ]);

    expect(sweepPendingGrants.fulfilled.match(premier)).toBe(true);
    // Le second est ANNULÉ par la garde : pas de `fulfilled`, pas de requête.
    expect(sweepPendingGrants.fulfilled.match(second)).toBe(false);
    expect(apiAddVaultMember).toHaveBeenCalledTimes(1);
  });

  it('et laisse repartir le suivant une fois le premier retombé', async () => {
    const store = makeStore();
    await store.dispatch(sweepPendingGrants());
    const encore = await store.dispatch(sweepPendingGrants());
    expect(sweepPendingGrants.fulfilled.match(encore)).toBe(true);
  });
});

/**
 * `grantSealedManually` — LA PASTILLE NE SURVIT PLUS À SA PROPRE CAUSE (F04).
 *
 * `blockedGrants` n'était réécrit qu'au balayage suivant, c'est-à-dire au
 * prochain déverrouillage de coffre. Un hôte qui comparait l'empreinte et
 * donnait l'accès sur-le-champ continuait donc de lire « en attente de votre
 * vérification » pour quelqu'un qui était déjà membre — une phrase qui réclame
 * un geste déjà fait, ce qui est la meilleure façon de le faire refaire.
 */
describe('grantSealedManually', () => {
  const etat = (blocked: unknown[]) => {
    const store = makeStore();
    store.dispatch({
      type: sweepPendingGrants.fulfilled.type,
      payload: { granted: [], blocked, scope: null },
    });
    return store;
  };

  const zoe = {
    vaultId: 'v1',
    email: 'Zoe@X.io',
    userId: 'u-zoe',
    reason: 'key_unverified' as const,
  };
  const bob = { vaultId: 'v1', email: 'bob@x.io', userId: 'u-bob', reason: 'no_key' as const };

  it('retire l’entrée de la personne qu’on vient de sceller', () => {
    const store = etat([zoe, bob]);
    store.dispatch(grantSealedManually({ vaultId: 'v1', userId: 'u-zoe' }));
    expect(store.getState().vaults.blockedGrants).toEqual([bob]);
  });

  it('sait aussi la retirer par ADRESSE — une vieille entrée n’a que celle-là', () => {
    const store = etat([zoe]);
    store.dispatch(grantSealedManually({ vaultId: 'v1', email: 'zoe@x.io' }));
    expect(store.getState().vaults.blockedGrants).toEqual([]);
  });

  it('ne touche pas au même compte dans un AUTRE coffre', () => {
    const ailleurs = { ...zoe, vaultId: 'v2' };
    const store = etat([zoe, ailleurs]);
    store.dispatch(grantSealedManually({ vaultId: 'v1', userId: 'u-zoe' }));
    expect(store.getState().vaults.blockedGrants).toEqual([ailleurs]);
  });

  it('un payload sans personne ne vide RIEN', () => {
    // Sinon un appel maladroit effacerait tous les blocages d'un coffre, et
    // l'hôte perdrait de vue ce qui l'attend sans que rien ne se soit passé.
    const store = etat([zoe, bob]);
    store.dispatch(grantSealedManually({ vaultId: 'v1' }));
    expect(store.getState().vaults.blockedGrants).toEqual([zoe, bob]);
  });
});
