/**
 * Les fondations du chargement des coffres (lot A, C1).
 *
 * DEUX PROPRIÉTÉS, et ce sont celles qui manquaient :
 *   1. UNE SEULE DEMANDE PAR SESSION — `ensureVaultsLoaded` porte sa garde DANS
 *      l'état (`initialLoadRequested`), pas dans une ref de composant. Quatre
 *      écrans qui la dispatchent au premier rendu font UNE requête ; un rejet
 *      légitime (hors ligne) ne rouvre pas la porte ; seul `loadVaults` nu — le
 *      geste explicite d'un « Réessayer » — recharge, et la déconnexion remet
 *      le compteur à zéro pour le compte suivant.
 *   2. UNE LISTE MÉMOÏSÉE — `selectVaults` rend la MÊME référence tant que ni
 *      l'ordre ni le dictionnaire n'ont changé, et `selectSharedVaults`
 *      (accueil) est ce même sélecteur, pas un second cache.
 *
 * Le transport est stubbé (pas de Worker en test unitaire) ; la slice, le
 * thunk, sa `condition` et les sélecteurs sont le vrai code.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

// ── Le serveur simulé ────────────────────────────────────────────────────────

let listVaultsCalls = 0;
let listVaultsFailure: (() => never) | null = null;
let serverVaults: Array<Record<string, unknown>> = [];

const dto = (id: string) => ({
  id,
  organizationId: 'space-1',
  ownerUserId: 'me',
  nameEncrypted: 'x',
  nameIv: 'y',
  wrappedVaultKey: 'z',
  wrappedVaultKeyEpoch: 1,
  currentKeyEpoch: 1,
  role: 'owner',
  createdAt: '',
});

// Un locataire ambiant DÉJÀ connu : l'échelle d'amorçage (fetchOrgs → création
// d'espace) est éprouvée ailleurs (sharedVaultBootstrap) et n'est pas le sujet.
vi.mock('../../../services/network/apiClient', () => ({
  default: {},
  getOrgContextId: (vaultId?: string) => (vaultId ? null : 'space-1'),
  getImplicitOrg: () => 'space-1',
  setImplicitOrg: vi.fn(),
  setActiveOrg: vi.fn(),
  rememberVaultOrg: vi.fn(),
  forgetVaultOrg: vi.fn(),
  forgetVaultOrgs: vi.fn(),
  getRememberedVaultOrg: () => null,
}));

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiListVaults: vi.fn(async () => {
      listVaultsCalls++;
      if (listVaultsFailure) listVaultsFailure();
      return serverVaults;
    }),
  };
});

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: () => null,
  unlockVault: vi.fn(async () => {
    throw new Error('locked in this suite');
  }),
  isVaultUnlocked: () => false,
  lockVault: vi.fn(),
}));

vi.mock('../../../services/collab/collabSession', () => ({ purgeVaultCollab: vi.fn() }));

// La paire de cles est un etat de MEMOIRE, pas de Redux : on la simule par un
// drapeau hisse (vi.hoisted) que le mock lit a chaque appel.
const keypairFlag = vi.hoisted(() => ({ present: false }));

vi.mock('../../../services/auth/userKeypair', () => ({
  hasUserKeypair: () => keypairFlag.present,
  getOwnPublicKey: vi.fn(async () => null),
  sealToPublicKey: vi.fn(),
  openSealed: vi.fn(),
  verifyKeypairIntegrity: vi.fn(),
  isKeyAlgoSupported: () => true,
}));

import vaultsReducer, {
  ensureVaultsLoaded,
  loadVaults,
  markVaultUnlocked,
  selectVaults,
  type VaultsState,
} from '../vaultsSlice';
import orgReducer from '../orgSlice';
import { clearCloudAuth } from '../authSlice';
import { selectSharedVaults } from '../../../renderer/components/home/homeSelectors';

// ── Harnais ──────────────────────────────────────────────────────────────────

function makeStore() {
  const auth = { cloudUser: { subscriptionTier: 'solo' } };
  return configureStore({
    reducer: { vaults: vaultsReducer, org: orgReducer, auth: () => auth },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
}

function networkError() {
  return Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
}

beforeEach(() => {
  vi.clearAllMocks();
  listVaultsCalls = 0;
  listVaultsFailure = null;
  serverVaults = [];
  keypairFlag.present = false;
});

// ── 1. Une seule demande par session ─────────────────────────────────────────

describe('ensureVaultsLoaded — la garde vit dans la slice', () => {
  it('charge UNE fois, quel que soit le nombre d’écrans qui le demandent', async () => {
    const store = makeStore();
    const first = await store.dispatch(ensureVaultsLoaded());
    const second = await store.dispatch(ensureVaultsLoaded());
    const third = await store.dispatch(ensureVaultsLoaded());

    expect(first.meta.requestStatus).toBe('fulfilled');
    // Un thunk arrêté par sa `condition` se signale ainsi — ce n'est pas une
    // erreur, c'est la garde qui a retenu.
    expect(second.meta.requestStatus).toBe('rejected');
    expect((second.meta as { condition?: boolean }).condition).toBe(true);
    expect((third.meta as { condition?: boolean }).condition).toBe(true);
    expect(listVaultsCalls).toBe(1);
    expect(store.getState().vaults.initialLoadRequested).toBe(true);
  });

  it('deux demandes dans le MÊME tick ne font qu’une requête', async () => {
    // Le premier rendu monte l'accueil, l'explorateur et la liste des notes
    // ensemble : leurs effets partent avant qu'aucun résultat ne soit revenu.
    const store = makeStore();
    await Promise.all([
      store.dispatch(ensureVaultsLoaded()),
      store.dispatch(ensureVaultsLoaded()),
      store.dispatch(ensureVaultsLoaded()),
    ]);
    expect(listVaultsCalls).toBe(1);
  });

  it('un échec TRANSITOIRE rouvre la porte — la course du démarrage se rattrape', async () => {
    /**
     * ── CE TEST DISAIT L'INVERSE, ET LA RÈGLE A CHANGÉ POUR UNE RAISON ──────
     *
     * Il exigeait que la porte reste fermée : « l'erreur reste affichée avec
     * son Réessayer ». L'intention était bonne — ne pas battre en boucle contre
     * un réseau mort — mais elle reposait sur une surface qui N'EXISTE PAS :
     * `vaults.error` n'est lu que par la boîte « Ajouter à un coffre ».
     * L'accueil, lui, n'affiche ni erreur ni bouton. Il n'y avait donc aucun
     * « Réessayer » à cliquer.
     *
     * Et le cas observé en production n'était même pas un réseau mort :
     * `apiClient` pose `network_unavailable` AUSSI quand il n'a pas encore de
     * jeton d'accès. Au démarrage, le droit aux coffres (lu dans l'utilisateur
     * mis en cache sur disque) arrive parfois AVANT le jeton — la requête part
     * et se fait rejeter sans même être envoyée.
     *
     * Une course perdue de quelques millisecondes coûtait alors TOUS les
     * coffres jusqu'au prochain lancement, qui reperdait la même course. C'est
     * pourquoi le développement marchait et pas le paquet : localhost charge
     * lentement, le jeton gagne ; un asar se déplie plus vite.
     *
     * Demander un clic parce que NOTRE jeton est arrivé en retard n'est pas
     * une bonne réponse. Trois tentatives espacées, puis on s'arrête.
     */
    const store = makeStore();
    listVaultsFailure = () => {
      throw networkError();
    };
    await store.dispatch(ensureVaultsLoaded());
    expect(store.getState().vaults.error).toBe('network_unavailable');
    expect(store.getState().vaults.initialLoadRequested).toBe(false);

    listVaultsFailure = null;
    await store.dispatch(ensureVaultsLoaded());
    expect(listVaultsCalls).toBe(2);
    expect(store.getState().vaults.error).toBeNull();
  });

  it('un refus DÉFINITIF garde la porte fermée — on ne bat pas contre un mur', async () => {
    // Un droit refusé ne changera pas en réessayant. Le distinguer d'une
    // course perdue est tout l'intérêt de la liste des codes transitoires :
    // sans elle, on rouvrirait aussi sur ce cas-là, et l'écran battrait en
    // boucle contre un serveur qui a déjà répondu non.
    const store = makeStore();
    listVaultsFailure = () => {
      throw Object.assign(new Error('vault_forbidden'), {
        isAxiosError: true,
        response: { status: 403, data: { code: 'vault_forbidden' } },
      });
    };
    await store.dispatch(ensureVaultsLoaded());
    expect(store.getState().vaults.initialLoadRequested).toBe(true);

    listVaultsFailure = null;
    await store.dispatch(ensureVaultsLoaded());
    expect(listVaultsCalls).toBe(1);
  });

  it('`loadVaults` nu recharge toujours : c’est le geste du « Réessayer »', async () => {
    const store = makeStore();
    await store.dispatch(ensureVaultsLoaded());
    await store.dispatch(loadVaults());
    await store.dispatch(loadVaults());
    expect(listVaultsCalls).toBe(3);

    // …et il compte comme demande : la garde implicite reste fermée après lui.
    await store.dispatch(ensureVaultsLoaded());
    expect(listVaultsCalls).toBe(3);
  });

  it('un `loadVaults` nu AVANT tout `ensure` ferme aussi la garde', async () => {
    const store = makeStore();
    await store.dispatch(loadVaults());
    await store.dispatch(ensureVaultsLoaded());
    expect(listVaultsCalls).toBe(1);
  });

  it('la déconnexion remet le compteur à zéro pour le compte suivant', async () => {
    const store = makeStore();
    await store.dispatch(ensureVaultsLoaded());
    store.dispatch(clearCloudAuth());
    expect(store.getState().vaults.initialLoadRequested).toBe(false);

    await store.dispatch(ensureVaultsLoaded());
    expect(listVaultsCalls).toBe(2);
  });
});

// ── 2. La liste mémoïsée ─────────────────────────────────────────────────────

// ── 1 bis. Un chargement fait SANS la cle n'est pas definitif ─────────────────

describe('ensureVaultsLoaded — un chargement sans la paire de clés se rejoue quand elle arrive', () => {
  it('recharge UNE fois quand la clé apparaît, puis referme la garde', async () => {
    // Le scenario reel : VaultsBootstrapHost charge au demarrage, AVANT le mot de
    // passe ; l'utilisateur deverrouille ; le gate redemande ; le coffre s'ouvre
    // sans « Reessayer ».
    serverVaults = [dto('v1')];
    const store = makeStore();
    await store.dispatch(ensureVaultsLoaded());
    expect(listVaultsCalls).toBe(1);
    expect(store.getState().vaults.lastLoadHadKeypair).toBe(false);

    // Toujours sans cle : la garde tient, pas de boucle.
    const again = await store.dispatch(ensureVaultsLoaded());
    expect((again.meta as { condition?: boolean }).condition).toBe(true);
    expect(listVaultsCalls).toBe(1);

    // La cle arrive (mot de passe saisi) : UN rechargement.
    keypairFlag.present = true;
    const withKey = await store.dispatch(ensureVaultsLoaded());
    expect(withKey.meta.requestStatus).toBe('fulfilled');
    expect(listVaultsCalls).toBe(2);
    expect(store.getState().vaults.lastLoadHadKeypair).toBe(true);

    // Et plus jamais tant que la session dure.
    const after = await store.dispatch(ensureVaultsLoaded());
    expect((after.meta as { condition?: boolean }).condition).toBe(true);
    expect(listVaultsCalls).toBe(2);
  });

  it('un chargement fait AVEC la clé est définitif : la garde ne rouvre pas', async () => {
    keypairFlag.present = true;
    const store = makeStore();
    await store.dispatch(ensureVaultsLoaded());
    const again = await store.dispatch(ensureVaultsLoaded());
    expect((again.meta as { condition?: boolean }).condition).toBe(true);
    expect(listVaultsCalls).toBe(1);
  });

  it('ne recharge pas pendant qu’un chargement est en vol', async () => {
    const store = makeStore();
    await store.dispatch(ensureVaultsLoaded());
    keypairFlag.present = true;
    const a = store.dispatch(ensureVaultsLoaded());
    const b = store.dispatch(ensureVaultsLoaded());
    await Promise.all([a, b]);
    expect(listVaultsCalls).toBe(2);
  });
});

describe('selectVaults — même référence tant que l’état ne change pas', () => {
  it('rend la même référence sur deux lectures du même état', async () => {
    serverVaults = [dto('v1'), dto('v2')];
    const store = makeStore();
    await store.dispatch(loadVaults());

    const a = selectVaults(store.getState());
    const b = selectVaults(store.getState());
    expect(a).toBe(b);
    expect(a.map((v) => v.id)).toEqual(['v1', 'v2']);
  });

  it('survit à une action qui ne touche ni l’ordre ni le dictionnaire', async () => {
    serverVaults = [dto('v1')];
    const store = makeStore();
    await store.dispatch(loadVaults());
    const before = selectVaults(store.getState());

    // `unlockedVaultIds` change, pas la liste : un lecteur de la liste n'a
    // aucune raison de re-rendre.
    store.dispatch(markVaultUnlocked('v1'));
    expect(selectVaults(store.getState())).toBe(before);
  });

  it('change de référence quand la liste change réellement', async () => {
    serverVaults = [dto('v1')];
    const store = makeStore();
    await store.dispatch(loadVaults());
    const before = selectVaults(store.getState());

    serverVaults = [dto('v1'), dto('v2')];
    await store.dispatch(loadVaults());
    const after = selectVaults(store.getState());
    expect(after).not.toBe(before);
    expect(after.map((v) => v.id)).toEqual(['v1', 'v2']);
  });

  it('filtre un identifiant sans résumé plutôt que de rendre un trou', () => {
    const vaults: VaultsState = {
      vaults: {},
      vaultIds: ['fantome'],
      itemsByVault: {},
      decryptStatusByVault: {},
      loadFailureByVault: {},
      rewrapProgress: {},
      noteContentByRef: {},
      unlockedVaultIds: [],
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
    };
    expect(selectVaults({ vaults })).toEqual([]);
  });

  it('`selectSharedVaults` (accueil) EST `selectVaults` — un seul cache', () => {
    expect(selectSharedVaults).toBe(selectVaults);
  });
});
