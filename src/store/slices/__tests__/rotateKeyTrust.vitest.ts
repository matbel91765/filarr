import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

/**
 * RETIRER UN MEMBRE, C'EST REMETTRE LA CLÉ DU COFFRE À TOUS LES AUTRES.
 *
 * La rotation engendre un K_vault' neuf et le scelle à chaque personne qui
 * reste, avec la clé publique que le serveur sert à cet instant. C'est
 * exactement le geste que l'invitation protège par un contrôle de transparence —
 * et la rotation ne faisait pas le même.
 *
 * Elle refusait déjà un journal réécrit et une clé qui n'est pas la dernière du
 * journal. Elle laissait passer, SANS RIEN DEMANDER, une empreinte qui a changé
 * depuis la dernière fois. Or l'invitation, elle, exige qu'un humain confirme ce
 * changement hors bande avant de sceller quoi que ce soit. Le chemin le moins
 * surveillé — automatique, déclenché par un geste d'administration banal, sans
 * écran — était donc le plus permissif des deux : un opérateur malveillant
 * n'avait qu'à substituer une clé et attendre le prochain retrait.
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
  /** Empreinte servie pour le pair restant, que le test fait bouger. */
  servedFingerprint: 'FP_BOB',
  servedEncKey: 'ENC_BOB',
  rotateCalls: [] as Array<{
    expectedPreviousEpoch?: number;
    wraps: Array<{ userId: string }>;
    removeUserIds?: string[];
    nameEncrypted?: string;
    nameIv?: string;
    settingsEncrypted?: string;
    settingsIv?: string;
  }>,
  /**
   * Ce que `GET /vaults/:id/settings` rend. `null` = la route a échoué (elle
   * n'est PAS un chemin critique de la rotation), `encrypted: null` = ce coffre
   * n'a jamais eu de bloc de réglages.
   */
  settings: null as {
    encrypted: {
      settingsEncrypted: string;
      settingsIv: string;
      settingsEpoch: number | null;
    } | null;
  } | null,
  /** Le bloc s'ouvre-t-il avec la clé de son époque ? (faux = scellé ailleurs) */
  blockReadable: true,
  /**
   * LE TROMBINOSCOPE SERVI, MUTABLE — c'est ce qui rend visible la relance
   * COMPLÈTE d'une préparation après un conflit d'époque : le tour suivant doit
   * relire cette liste-là, pas rejouer celle qu'il avait déjà en main.
   */
  members: [] as Array<{ userId: string; role: string; joinedAt: string }>,
  /** Ce que la liste devient quand le serveur refuse la rotation (F09). */
  membersAfterConflict: null as Array<{ userId: string; role: string; joinedAt: string }> | null,
  /** Les refus que `POST /rotate` rend, dans l'ordre, avant d'accepter. */
  rotateFailures: [] as Array<{ status: number; code: string }>,
  /** Ce que `GET /vaults` rend — `loadVaults` tourne entre deux tentatives. */
  vaultsFromServer: [] as unknown[],
  /** Les époques que CET appareil sait ouvrir. */
  unlockedEpochs: [1] as number[],
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
    apiListVaultMembers: vi.fn(async () => server.members),
    apiGetMemberPublicKey: vi.fn(async (userId: string) => ({
      userId,
      encPublicKey: userId === 'bob' ? server.servedEncKey : `ENC_${userId}`,
      signPublicKey: `SIGN_${userId}`,
      fingerprint: userId === 'bob' ? server.servedFingerprint : `FP_${userId}`,
      keyAlgo: 'x25519',
    })),
    // Journal VIDE : un compte ancien. Le premier passage épingle, les suivants
    // se comparent à cet épinglage — c'est là que le changement se voit.
    apiGetKeyLog: vi.fn(async () => []),
    apiRotateVault: vi.fn(
      async (
        _v: string,
        body: {
          expectedPreviousEpoch?: number;
          wraps: Array<{ userId: string }>;
          removeUserIds?: string[];
          nameEncrypted?: string;
          nameIv?: string;
          settingsEncrypted?: string;
          settingsIv?: string;
        }
      ) => {
        // La tentative est enregistrée AVANT le refus : c'est en comparant deux
        // tentatives qu'on voit si la préparation a été refaite ou rejouée.
        server.rotateCalls.push(body);
        const panne = server.rotateFailures.shift();
        if (!panne) return;
        // Un conflit d'époque vient d'un CHANGEMENT concurrent : la lecture
        // suivante doit donc trouver un autre trombinoscope, comme dans la vraie
        // vie. Sans cela, le banc éprouverait une relance dans un monde figé.
        if (server.membersAfterConflict) server.members = server.membersAfterConflict;
        const err = new Error(panne.code) as Error & { response?: unknown };
        err.response = { status: panne.status, data: { code: panne.code } };
        throw err;
      }
    ),
    apiGetVaultSettings: vi.fn(async () => {
      if (!server.settings) throw new Error('settings_load_failed');
      return { version: 1, settings: {}, updatedBy: null, updatedAt: null, ...server.settings };
    }),
    apiListVaults: vi.fn(async () => server.vaultsFromServer),
    apiEnsurePersonalSpace: vi.fn(async () => ({ orgId: 'org1' })),
  };
});

vi.mock('../../../services/vault/vaultCrypto', () => ({
  // `vi.fn` : le nombre d'appels EST l'assertion quand il s'agit de savoir si un
  // second tour a engendré une clé NEUVE plutôt que de resservir la sienne.
  generateVaultKey: vi.fn(() => new Uint8Array(32)),
  wrapVaultKeyForMember: vi.fn(
    async (_k: Uint8Array, peer: { userId: string }) => `W_${peer.userId}`
  ),
  decryptVaultName: vi.fn(async () => 'nom'),
  unwrapItemKey: vi.fn(),
  decryptItemMeta: vi.fn(),
  decryptItemChunk: vi.fn(),
  generateItemKey: vi.fn(),
  encryptItemMeta: vi.fn(),
  encryptItemChunk: vi.fn(),
  wrapItemKey: vi.fn(),
  encryptVaultName: vi.fn(async () => ({ nameEncrypted: 'NOM_V2', nameIv: 'IV_V2' })),
  encryptVaultBlob: vi.fn(async () => ({ ciphertext: 'BLOC_V2', iv: 'BIV_V2' })),
  decryptVaultBlob: vi.fn(async () => {
    // Une clé qui n'ouvre pas LÈVE (tag AES-GCM) : c'est ce que la rotation doit
    // savoir absorber sans s'arrêter.
    if (!server.blockReadable) throw new Error('bad tag');
    return JSON.stringify({ v: 1, description: 'Contrats 2026' });
  }),
  wrapVaultKey: vi.fn(),
  unwrapVaultKey: vi.fn(),
}));

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  // ÉPOQUE PAR ÉPOQUE, comme le vrai cache : seule l'époque courante (1) est
  // ouverte ici. C'est ce qui permet de vérifier qu'un bloc scellé sous une
  // autre clé n'est PAS rescellé à l'aveugle.
  getVaultKey: (_vaultId: string, epoch: number) =>
    server.unlockedEpochs.includes(epoch) ? new Uint8Array(32) : null,
  unlockVault: vi.fn(async () => new Uint8Array(32)),
  isVaultUnlocked: () => true,
  lockVault: vi.fn(),
  lockVaultEverywhere: vi.fn(),
  putVaultKey: vi.fn(),
  clearAllVaultKeys: vi.fn(),
}));

vi.mock('../../../services/collab/collabSession', () => ({ purgeVaultCollab: vi.fn() }));

import vaultsReducer, {
  loadVaults,
  removeMember,
  removeMembers,
  rotateVaultKey,
} from '../vaultsSlice';
import type { VaultAppearance } from '../../../services/vault/vaultNameEnvelope';
import {
  apiGetMemberPublicKey,
  apiListVaultMembers,
  apiRotateVault,
} from '../../../services/vault/vaultApi';
import {
  decryptVaultBlob,
  decryptVaultName,
  encryptVaultBlob,
  encryptVaultName,
  generateVaultKey,
} from '../../../services/vault/vaultCrypto';

/**
 * `name` est paramétrable : un nom VIDE dans le store signifie que le
 * déchiffrement a échoué au dernier chargement, et ce cas-là doit se comporter
 * autrement — voir le test qui le nomme.
 */
function makeStore(name = 'Coffre', appearance?: VaultAppearance) {
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
            name,
            ...(appearance ? { appearance } : {}),
            currentKeyEpoch: 1,
            wrappedVaultKeyEpoch: 1,
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

/**
 * Un coffre qui porte une APPARENCE (F14) — l'emoji et la couleur vivent dans
 * l'enveloppe de `name_encrypted`, donc dans le résumé Redux à côté du nom.
 */
function makeStoreAvecApparence() {
  return makeStore('Coffre', { emoji: '\u{1F4C1}', color: '#22c55e' });
}

/** Épingle l'empreinte d'origine de Bob, comme le ferait une invitation passée. */
async function pinnerBob() {
  const store = makeStore();
  await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));
  server.rotateCalls = [];
  // L'épinglage seul doit rester : les appels de cette mise en place ne sont pas
  // ceux que le test observe.
  vi.clearAllMocks();
}

beforeEach(() => {
  vi.clearAllMocks();
  tofu.clear();
  server.servedFingerprint = 'FP_BOB';
  server.servedEncKey = 'ENC_BOB';
  server.rotateCalls = [];
  // Par défaut : un coffre sans bloc de réglages — l'immense majorité, et le
  // comportement d'avant F13.
  server.settings = { encrypted: null };
  server.blockReadable = true;
  server.members = [
    { userId: 'moi', role: 'owner', joinedAt: '' },
    { userId: 'bob', role: 'member', joinedAt: '' },
    { userId: 'exclu', role: 'member', joinedAt: '' },
  ];
  server.membersAfterConflict = null;
  server.rotateFailures = [];
  server.vaultsFromServer = [];
  server.unlockedEpochs = [1];
});

describe('la rotation refuse une empreinte qui a changé', () => {
  it('scelle sans rien demander tant que la clé de chacun n’a pas bougé', async () => {
    const store = makeStore();

    const result = await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(removeMember.fulfilled.match(result)).toBe(true);
    expect(apiRotateVault).toHaveBeenCalledTimes(1);
    expect(server.rotateCalls[0].wraps.map((w) => w.userId).sort()).toEqual(['bob', 'moi']);
  });

  it('S’ARRÊTE quand la clé servie pour un membre restant a changé', async () => {
    await pinnerBob();
    // Le courtier glisse sa propre clé pour Bob. Aucun écran ne se serait ouvert :
    // le retrait est un geste d'administration ordinaire.
    server.servedFingerprint = 'FP_INTRUS';
    server.servedEncKey = 'ENC_INTRUS';
    const store = makeStore();

    const result = await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(removeMember.rejected.match(result)).toBe(true);
    // Rien n'a été scellé : la clé neuve n'a atteint personne.
    expect(apiRotateVault).not.toHaveBeenCalled();
  });

  it('nomme le membre ET l’empreinte, sans quoi la vérification hors bande n’a rien à comparer', async () => {
    await pinnerBob();
    server.servedFingerprint = 'FP_INTRUS';
    const store = makeStore();

    const result = await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(result.payload).toBe('peer_key_changed:bob:FP_INTRUS');
  });

  it('reprend lorsque l’administrateur a confirmé CETTE empreinte', async () => {
    await pinnerBob();
    server.servedFingerprint = 'FP_NOUVELLE';
    server.servedEncKey = 'ENC_NOUVELLE';
    const store = makeStore();

    const result = await store.dispatch(
      removeMember({
        vaultId: 'v1',
        userId: 'exclu',
        confirmedFingerprints: { bob: 'FP_NOUVELLE' },
      })
    );

    expect(removeMember.fulfilled.match(result)).toBe(true);
    expect(apiRotateVault).toHaveBeenCalledTimes(1);
  });

  it('une confirmation ne vaut QUE pour l’empreinte qu’elle nomme', async () => {
    // Sinon elle deviendrait un interrupteur : confirmé une fois, ouvert pour
    // n'importe quelle clé servie ensuite — y compris celle qui arrive juste
    // après, à la faveur de la course que la confirmation était censée fermer.
    await pinnerBob();
    server.servedFingerprint = 'FP_ENCORE_AUTRE';
    const store = makeStore();

    const result = await store.dispatch(
      removeMember({
        vaultId: 'v1',
        userId: 'exclu',
        confirmedFingerprints: { bob: 'FP_QUE_J_AI_VUE' },
      })
    );

    expect(removeMember.rejected.match(result)).toBe(true);
    expect(apiRotateVault).not.toHaveBeenCalled();
  });

  it('une confirmation pour QUELQU’UN D’AUTRE n’ouvre rien', async () => {
    await pinnerBob();
    server.servedFingerprint = 'FP_INTRUS';
    const store = makeStore();

    const result = await store.dispatch(
      removeMember({
        vaultId: 'v1',
        userId: 'exclu',
        confirmedFingerprints: { carole: 'FP_INTRUS' },
      })
    );

    expect(removeMember.rejected.match(result)).toBe(true);
    expect(apiRotateVault).not.toHaveBeenCalled();
  });
});

/**
 * LE NOM DU COFFRE EST CHIFFRÉ SOUS K_vault, DONC IL DOIT SUIVRE LA CLÉ.
 *
 * La rotation engendre K_vault' et le scelle à tout le monde, mais laissait le
 * nom scellé sous l'ancienne clé. Au rechargement suivant, `toVaultSummary`
 * l'ouvre avec le wrap de l'époque COURANTE — donc échoue, et retombe sur ''.
 * Autrement dit : au premier retrait de membre, le coffre perdait son nom pour
 * tous ses membres à la fois, l'hôte compris.
 */
describe('la rotation emporte le nom du coffre', () => {
  it('re-chiffre le nom sous la clé neuve et l’envoie au serveur', async () => {
    const store = makeStore();

    const result = await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(removeMember.fulfilled.match(result)).toBe(true);
    expect(encryptVaultName).toHaveBeenCalledTimes(1);
    // Le nom en clair vient du store (il n'existe déchiffré nulle part ailleurs).
    expect(vi.mocked(encryptVaultName).mock.calls[0][0]).toBe('Coffre');
    expect(server.rotateCalls[0].nameEncrypted).toBe('NOM_V2');
    expect(server.rotateCalls[0].nameIv).toBe('IV_V2');
  });

  it('n’envoie RIEN quand le nom du store est vide', async () => {
    // Un nom vide ne dit pas « ce coffre n'a pas de nom » : il dit que le
    // déchiffrement a échoué. Chiffrer '' écraserait un nom peut-être encore
    // récupérable — par exemple dès que la clé manquante redevient disponible.
    const store = makeStore('');

    const result = await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(removeMember.fulfilled.match(result)).toBe(true);
    expect(encryptVaultName).not.toHaveBeenCalled();
    expect(server.rotateCalls[0].nameEncrypted).toBeUndefined();
    expect(server.rotateCalls[0].nameIv).toBeUndefined();
  });
});

/**
 * LE BLOC DE RÉGLAGES SUIT LA CLÉ, EXACTEMENT COMME LE NOM (F13).
 *
 * `settings_encrypted` est scellé sous K_vault, dans une AUTRE colonne que le
 * nom et avec sa PROPRE époque. Une rotation qui ne le rescelle pas le rend
 * illisible pour tout le monde : la description disparaîtrait de l'en-tête au
 * premier retrait de membre, et l'écran afficherait un champ vide — c'est-à-dire
 * qu'il ferait croire à un texte effacé là où il suffit de le ré-enregistrer.
 *
 * MAIS UNE ROTATION EST UN GESTE DE SÉCURITÉ. Elle retire quelqu'un. Rien de ce
 * qui touche à une description ne doit pouvoir l'empêcher : ni une route de
 * réglages en panne, ni un bloc qu'on ne sait pas ouvrir. Dans ces cas-là on
 * n'envoie rien, le serveur garde l'ancienne époque, et l'onglet Réglages dira
 * « scellé sous une clé précédente : ré-enregistrez-le ».
 */
describe('la rotation rescelle le bloc de réglages', () => {
  it('re-chiffre le bloc sous la clé neuve et l’envoie avec les wraps', async () => {
    server.settings = {
      encrypted: { settingsEncrypted: 'BLOC_V1', settingsIv: 'BIV_V1', settingsEpoch: 1 },
    };
    const store = makeStore();

    const result = await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(removeMember.fulfilled.match(result)).toBe(true);
    expect(server.rotateCalls[0].settingsEncrypted).toBe('BLOC_V2');
    expect(server.rotateCalls[0].settingsIv).toBe('BIV_V2');
    // Ce qui est rescellé est le bloc ENTIER, tel qu'il a été lu — pas une
    // description reconstruite : les champs qu'une version plus récente y aurait
    // posés (apparence F14, règle OOB F25) doivent traverser la rotation.
    expect(vi.mocked(encryptVaultBlob).mock.calls[0][0]).toContain('Contrats 2026');
  });

  it('n’envoie rien quand ce coffre n’a pas de bloc', async () => {
    const store = makeStore();

    await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(server.rotateCalls[0].settingsEncrypted).toBeUndefined();
    expect(server.rotateCalls[0].settingsIv).toBeUndefined();
    expect(encryptVaultBlob).not.toHaveBeenCalled();
  });

  it('n’envoie rien — et RETIRE QUAND MÊME — quand le bloc ne s’ouvre pas', async () => {
    server.settings = {
      encrypted: { settingsEncrypted: 'BLOC_V1', settingsIv: 'BIV_V1', settingsEpoch: 1 },
    };
    server.blockReadable = false;
    const store = makeStore();

    const result = await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(removeMember.fulfilled.match(result)).toBe(true);
    expect(server.rotateCalls[0].settingsEncrypted).toBeUndefined();
    // Le retrait, lui, a bien eu lieu : c'est la seule chose qui compte ici.
    expect(server.rotateCalls[0].wraps.map((w) => w.userId).sort()).toEqual(['bob', 'moi']);
  });

  it('n’envoie rien quand on ignore sous quelle clé le bloc a été scellé', async () => {
    // Un worker d'avant F13 n'enregistrait pas d'époque. Le rescellement
    // supposerait alors la clé courante, et écraserait un bloc encore lisible
    // par quelqu'un d'autre avec un chiffré fabriqué depuis un texte faux.
    server.settings = {
      encrypted: { settingsEncrypted: 'BLOC_V1', settingsIv: 'BIV_V1', settingsEpoch: null },
    };
    const store = makeStore();

    await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(server.rotateCalls[0].settingsEncrypted).toBeUndefined();
    expect(decryptVaultBlob).not.toHaveBeenCalled();
  });

  it('n’envoie rien — et RETIRE QUAND MÊME — quand la route des réglages échoue', async () => {
    server.settings = null;
    const store = makeStore();

    const result = await store.dispatch(removeMember({ vaultId: 'v1', userId: 'exclu' }));

    expect(removeMember.fulfilled.match(result)).toBe(true);
    expect(server.rotateCalls[0].settingsEncrypted).toBeUndefined();
    // Et le nom, lui, part quand même : les deux blocs sont indépendants.
    expect(server.rotateCalls[0].nameEncrypted).toBe('NOM_V2');
  });
});

/**
 * RETIRER PLUSIEURS PERSONNES, C'EST UNE SEULE ROTATION — ET C'EST LA SEULE QUI
 * PUISSE ABOUTIR.
 *
 * Le bandeau « hors de l'espace » (F08) montre les gens qui détiennent encore la
 * clé du coffre alors que leur appartenance à l'org est éteinte. Or resceller
 * K_vault' à quelqu'un exige de lire sa clé publique, et
 * `GET /account/public-key/:userId` répond 403 sur EXACTEMENT ce prédicat-là.
 * Dès qu'il y en a deux, un retrait par personne est donc un cul-de-sac dans les
 * deux sens : retirer A échoue en rescellant à B, retirer B échoue en rescellant
 * à A. Le thunk doit accepter le groupe entier, pour qu'aucun d'eux ne fasse
 * partie des « restants ».
 */
describe('la rotation retire un GROUPE en un seul appel', () => {
  it('ne rescelle qu’aux vrais restants et ne lit AUCUNE clé des partants', async () => {
    const store = makeStore();

    const result = await store.dispatch(removeMember({ vaultId: 'v1', userIds: ['bob', 'exclu'] }));

    expect(removeMember.fulfilled.match(result)).toBe(true);
    // UNE rotation, pas deux : l'époque n'avance que d'un cran.
    expect(server.rotateCalls).toHaveLength(1);
    expect([...(server.rotateCalls[0].removeUserIds ?? [])].sort()).toEqual(['bob', 'exclu']);
    expect(server.rotateCalls[0].wraps.map((w) => w.userId)).toEqual(['moi']);
    // La clé d'un partant n'est jamais demandée — c'est elle que le serveur
    // refuse, et c'est ce refus qui bloquait les deux boutons.
    const demandes = vi.mocked(apiGetMemberPublicKey).mock.calls.map((c) => c[0]);
    expect(demandes).not.toContain('bob');
    expect(demandes).not.toContain('exclu');
  });

  it('une cible déjà partie ne fait pas échouer le geste, mais zéro cible si', async () => {
    const store = makeStore();

    // « fantome » n'est plus dans la liste servie : le serveur refuserait
    // `not_a_member`, donc le thunk ne la lui envoie pas.
    const ok = await store.dispatch(removeMember({ vaultId: 'v1', userIds: ['exclu', 'fantome'] }));
    expect(removeMember.fulfilled.match(ok)).toBe(true);
    expect(server.rotateCalls[0].removeUserIds).toEqual(['exclu']);

    // Un store neuf : le premier retrait a fait recharger la liste des coffres
    // (vide dans ce banc), et le coffre n'est plus dans l'état.
    const rien = await makeStore().dispatch(removeMember({ vaultId: 'v1', userIds: ['fantome'] }));
    expect(removeMember.rejected.match(rien)).toBe(true);
    expect(rien.payload).toBe('member_not_in_vault');
  });
});

/**
 * F09 — LE RETRAIT GROUPÉ EST LE GESTE GÉNÉRAL, ET UN CONFLIT D'ÉPOQUE NE SE
 * REJOUE JAMAIS À L'AVEUGLE.
 *
 * La barre de sélection de l'onglet Membres retire N lignes cochées en UNE
 * rotation. Entre le moment où l'on lit le trombinoscope et celui où le serveur
 * écrit, quelqu'un d'autre peut avoir fait tourner la clé (409
 * `vault_epoch_conflict`) ou avoir REJOINT le coffre (400 `wrap_set_mismatch`).
 * Ce qu'on avait préparé ne vaut alors plus rien :
 *
 *   · les wraps portent une K_vault' déjà exposée à la tentative refusée ;
 *   · ils ne couvrent pas l'arrivant, que le serveur exige (sa garde porte sur
 *     la COUVERTURE des restants) ;
 *   · le nom et le bloc de réglages ont été rescellés sous cette clé-là.
 *
 * Renvoyer le même paquet sur la nouvelle époque, c'est verrouiller dehors
 * quelqu'un qui vient d'entrer. La préparation doit donc être REFAITE : relire
 * la liste, relire l'époque, engendrer une clé neuve, resceller.
 */
describe('un conflit d’époque relance la préparation ENTIÈRE', () => {
  /** Le coffre tel que le serveur le rend après la rotation d'un tiers. */
  const vaultApresConflit = [
    {
      id: 'v1',
      organizationId: 'org1',
      ownerUserId: 'moi',
      nameEncrypted: 'NOM',
      nameIv: 'IV',
      currentKeyEpoch: 2,
      wrappedVaultKey: 'W',
      wrappedVaultKeyEpoch: 2,
      role: 'owner',
      createdAt: '',
    },
  ];

  it('relit le trombinoscope, l’époque, et scelle une clé NEUVE au nouvel arrivant', async () => {
    server.rotateFailures = [{ status: 409, code: 'vault_epoch_conflict' }];
    // Pendant notre préparation : Carole entre, et la clé tourne (époque 2).
    server.membersAfterConflict = [
      { userId: 'moi', role: 'owner', joinedAt: '' },
      { userId: 'bob', role: 'member', joinedAt: '' },
      { userId: 'carole', role: 'member', joinedAt: '' },
      { userId: 'exclu', role: 'member', joinedAt: '' },
    ];
    server.vaultsFromServer = vaultApresConflit;
    server.unlockedEpochs = [1, 2];
    const store = makeStore();

    const result = await store.dispatch(removeMembers({ vaultId: 'v1', userIds: ['exclu'] }));

    expect(removeMembers.fulfilled.match(result)).toBe(true);
    expect(server.rotateCalls).toHaveLength(2);
    // Le premier tour ignorait Carole et visait l'époque 1.
    expect(server.rotateCalls[0].expectedPreviousEpoch).toBe(1);
    expect(server.rotateCalls[0].wraps.map((w) => w.userId).sort()).toEqual(['bob', 'moi']);
    // Le second a TOUT relu : la nouvelle époque, et un scellé pour Carole —
    // sans quoi le serveur l'aurait enfermée dehors avec son propre coffre.
    expect(server.rotateCalls[1].expectedPreviousEpoch).toBe(2);
    expect(server.rotateCalls[1].wraps.map((w) => w.userId).sort()).toEqual([
      'bob',
      'carole',
      'moi',
    ]);
    // Une clé NEUVE par tentative : la précédente a voyagé jusqu'au serveur,
    // qui l'a refusée — la resservir reviendrait à sceller un secret déjà sorti.
    expect(generateVaultKey).toHaveBeenCalledTimes(2);
    // Et le nom repart sous CETTE clé-là : rescellé une fois par tentative (P1).
    expect(encryptVaultName).toHaveBeenCalledTimes(2);
    // La preuve que la liste a été RELUE, et non rejouée de mémoire.
    expect(apiListVaultMembers).toHaveBeenCalledTimes(2);
  });

  it('absorbe aussi un `wrap_set_mismatch` — c’est le même accident, vu d’en face', async () => {
    // 400, pas 409 : le serveur ne se plaint pas de l'époque mais de la
    // couverture. La parade est identique (relire, recalculer).
    server.rotateFailures = [{ status: 400, code: 'wrap_set_mismatch' }];
    server.membersAfterConflict = [
      { userId: 'moi', role: 'owner', joinedAt: '' },
      { userId: 'bob', role: 'member', joinedAt: '' },
      { userId: 'carole', role: 'member', joinedAt: '' },
      { userId: 'exclu', role: 'member', joinedAt: '' },
    ];
    server.vaultsFromServer = vaultApresConflit;
    server.unlockedEpochs = [1, 2];
    const store = makeStore();

    const result = await store.dispatch(removeMembers({ vaultId: 'v1', userIds: ['exclu'] }));

    expect(removeMembers.fulfilled.match(result)).toBe(true);
    expect(server.rotateCalls[1].wraps.map((w) => w.userId)).toContain('carole');
  });

  it('s’arrête au bout de trois tours et le DIT, plutôt que de tourner en rond', async () => {
    server.rotateFailures = [
      { status: 409, code: 'vault_epoch_conflict' },
      { status: 409, code: 'vault_epoch_conflict' },
      { status: 409, code: 'vault_epoch_conflict' },
    ];
    server.vaultsFromServer = [
      { ...vaultApresConflit[0], currentKeyEpoch: 1, wrappedVaultKeyEpoch: 1 },
    ];
    const store = makeStore();

    const result = await store.dispatch(removeMembers({ vaultId: 'v1', userIds: ['exclu'] }));

    expect(removeMembers.rejected.match(result)).toBe(true);
    // Le code est celui que `vaultErrorMessages` sait traduire en « quelqu'un
    // d'autre vient de modifier ce coffre : réessayez » — pas un message brut.
    expect(result.payload).toBe('vault_epoch_conflict');
    expect(server.rotateCalls).toHaveLength(3);
  });
});

/**
 * UN SEUL GESTE, DEUX NOMS — et le TYPE D'ACTION ne bouge pas.
 *
 * `removeMember` est le cas particulier de `removeMembers` : le même créateur
 * d'action, pas une enveloppe qui redispatcherait. Ce détail est un garde-fou :
 * `shareIndexSlice` écoute la chaîne littérale `vaults/removeMember/fulfilled`
 * pour périmer les pastilles de partage. Un préfixe renommé aurait laissé ce
 * listener muet — l'effectif du rail et des cartes serait resté celui d'avant le
 * retrait, sans la moindre erreur pour le signaler.
 */
describe('removeMember est le cas particulier de removeMembers', () => {
  it('partage le créateur d’action ET son type', () => {
    expect(removeMember).toBe(removeMembers);
    expect(removeMembers.fulfilled.type).toBe('vaults/removeMember/fulfilled');
  });

  it('retire une seule personne par la forme groupée, et l’inverse', async () => {
    const store = makeStore();
    const un = await store.dispatch(removeMembers({ vaultId: 'v1', userIds: ['exclu'] }));
    expect(removeMembers.fulfilled.match(un)).toBe(true);
    expect(server.rotateCalls[0].removeUserIds).toEqual(['exclu']);
  });
});

/**
 * F10 — RENOUVELER LA CLÉ SANS RETIRER PERSONNE.
 *
 * C'est le MÊME geste que le retrait, moins les cibles : une époque de plus, une
 * clé neuve scellée à tout le monde, le nom et le bloc de réglages rescellés.
 * D'où un seul thunk et un seul chemin — deux implémentations auraient fini par
 * diverger sur ce qui coûte le plus cher à rater (le rescellement du nom, P1).
 *
 * LE TABLEAU VIDE DOIT PARTIR TEL QUEL, et c'est le point qu'un test doit
 * tenir : `removeUserIds: []` est ce qui distingue « je renouvelle » de « je
 * n'ai personne à retirer, donc je m'arrête ». Le garde d'origine refusait tout
 * geste sans cible (`member_not_in_vault`) — parfaitement juste pour un retrait,
 * et exactement ce qui rendait la rotation volontaire impossible.
 */
describe('la rotation volontaire (F10)', () => {
  it('part avec un tableau de retraits VIDE et rescelle à TOUT LE MONDE', async () => {
    const store = makeStore();

    const result = await store.dispatch(rotateVaultKey({ vaultId: 'v1', removeUserIds: [] }));

    expect(rotateVaultKey.fulfilled.match(result)).toBe(true);
    expect(server.rotateCalls).toHaveLength(1);
    // Le tableau vide EST le corps de la requête, pas une omission.
    expect(server.rotateCalls[0].removeUserIds).toEqual([]);
    expect(server.rotateCalls[0].wraps.map((w) => w.userId).sort()).toEqual([
      'bob',
      'exclu',
      'moi',
    ]);
    expect(server.rotateCalls[0].expectedPreviousEpoch).toBe(1);
  });

  it('emporte le nom et le bloc de réglages, comme un retrait', async () => {
    server.settings = {
      encrypted: { settingsEncrypted: 'BLOC_V1', settingsIv: 'BIV_V1', settingsEpoch: 1 },
    };
    const store = makeStore();

    await store.dispatch(rotateVaultKey({ vaultId: 'v1', removeUserIds: [] }));

    expect(server.rotateCalls[0].nameEncrypted).toBe('NOM_V2');
    expect(server.rotateCalls[0].settingsEncrypted).toBe('BLOC_V2');
  });

  it('refuse toujours un RETRAIT sans cible — l’absence de cible n’est pas un renouvellement', async () => {
    // La distinction est le tout du garde : `removeUserIds: []` est une
    // intention explicite ; `userIds: []` est un geste qui a perdu sa cible.
    const store = makeStore();
    const rien = await store.dispatch(removeMembers({ vaultId: 'v1', userIds: [] }));
    expect(removeMembers.rejected.match(rien)).toBe(true);
    expect(rien.payload).toBe('member_not_in_vault');
    expect(server.rotateCalls).toHaveLength(0);
  });

  it('une rotation volontaire vérifie la confiance comme un retrait', async () => {
    // Le geste scelle K_vault' à tout le monde : c'est EXACTEMENT la surface que
    // la vérification de transparence protège, et elle ne doit pas s'assouplir
    // parce que personne ne part.
    await pinnerBob();
    server.servedFingerprint = 'FP_BOB_2';
    server.servedEncKey = 'ENC_BOB_2';

    const result = await makeStore().dispatch(rotateVaultKey({ vaultId: 'v1', removeUserIds: [] }));

    expect(rotateVaultKey.rejected.match(result)).toBe(true);
    expect(result.payload).toBe('peer_key_changed:bob:FP_BOB_2');
  });

  it('rotateVaultKey et removeMembers sont le MÊME créateur d’action', async () => {
    // Le type d'action reste `vaults/removeMember`, que `shareIndexSlice` écoute
    // littéralement : un renouvellement périme les pastilles comme un retrait.
    expect(rotateVaultKey).toBe(removeMembers);
  });
});

/**
 * F14 — L'ENVELOPPE ENTIÈRE SUIT LA CLÉ, PAS SEULEMENT LE NOM.
 *
 * L'apparence (emoji, couleur, icône) est rangée DANS `name_encrypted`. Une
 * rotation qui rescellerait le seul nom décodé effacerait donc silencieusement
 * l'emoji et la couleur du coffre — un « défaut » qu'aucune erreur ne
 * signalerait, et qu'on découvrirait des semaines plus tard. C'est le
 * commentaire laissé dans `removeMember` à l'époque de P1, rendu exécutable.
 */
describe('le chargement DÉCODE l’enveloppe (F14)', () => {
  /**
   * LE PENDANT DU RESCELLEMENT, ET IL COMPTE AUTANT. `name_encrypted` porte
   * désormais soit un nom nu, soit une enveloppe JSON. Si `toVaultSummary` ne
   * décodait pas, la barre d'onglets, les cartes de l'accueil et le fil
   * d'Ariane afficheraient `{"v":1,"n":…}` en guise de nom — sur tous les
   * coffres personnalisés à la fois, et sans la moindre erreur pour le dire.
   */
  const dto = {
    id: 'v1',
    organizationId: 'org1',
    ownerUserId: 'moi',
    nameEncrypted: 'NOM',
    nameIv: 'IV',
    currentKeyEpoch: 1,
    wrappedVaultKey: 'W',
    wrappedVaultKeyEpoch: 1,
    role: 'owner',
    createdAt: '',
  };

  it('range le NOM et l’APPARENCE, jamais le JSON brut', async () => {
    server.vaultsFromServer = [dto];
    vi.mocked(decryptVaultName).mockResolvedValueOnce(
      JSON.stringify({ v: 1, n: 'Coffre', emoji: '\u{1F4C1}', color: '#22c55e' })
    );
    const store = makeStore();

    await store.dispatch(loadVaults());

    const v = store.getState().vaults.vaults.v1;
    expect(v.name).toBe('Coffre');
    expect(v.appearance).toEqual({ emoji: '\u{1F4C1}', color: '#22c55e' });
  });

  it('un nom nu reste un nom, et le coffre n’a pas d’apparence', async () => {
    server.vaultsFromServer = [dto];
    vi.mocked(decryptVaultName).mockResolvedValueOnce('Contrats 2026');
    const store = makeStore();

    await store.dispatch(loadVaults());

    const v = store.getState().vaults.vaults.v1;
    expect(v.name).toBe('Contrats 2026');
    expect(v.appearance).toBeUndefined();
  });
});

describe('la rotation emporte l’enveloppe entière (F14)', () => {
  it('rescelle le nom ET l’apparence', async () => {
    const store = makeStoreAvecApparence();

    await store.dispatch(rotateVaultKey({ vaultId: 'v1', removeUserIds: [] }));

    const clair = vi.mocked(encryptVaultName).mock.calls[0][0];
    expect(JSON.parse(clair)).toEqual({ v: 1, n: 'Coffre', emoji: '📁', color: '#22c55e' });
  });

  it('un coffre sans apparence rescelle le NOM NU — lisible d’un client d’avant F14', async () => {
    const store = makeStore();

    await store.dispatch(rotateVaultKey({ vaultId: 'v1', removeUserIds: [] }));

    expect(vi.mocked(encryptVaultName).mock.calls[0][0]).toBe('Coffre');
  });
});
