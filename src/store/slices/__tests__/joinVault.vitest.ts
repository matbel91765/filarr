/**
 * Accepter une invitation à un coffre : viser le BON locataire, et dire la
 * vérité quand c'est refusé.
 *
 * CE QUI ÉTAIT CASSÉ. `POST /vaults/:id/join` lit son locataire dans l'en-tête
 * X-Org-Id, que le client ne sait remplir qu'avec le SIEN
 * (`resolveOrgHeader` : coffre connu → org active → org implicite). Or un coffre
 * qu'on n'a jamais listé n'est dans aucun index : la jointure partait donc
 * contre notre propre espace et revenait en 404 `vault_not_found`, sur une
 * invitation parfaitement valide. Le thunk n'avait d'ailleurs aucun appelant.
 *
 * Trois propriétés :
 *   1. VISÉE — l'org portée par le lien est punaisée avant l'appel ; les
 *      e-mails partis avant que le Worker ne l'ajoute déclenchent un sondage
 *      des espaces connus, borné par leur nombre.
 *   2. INNOCUITÉ DU SONDAGE — le Worker ne consomme le jeton qu'à sa toute
 *      dernière étape, après le contrôle du locataire : une tentative sur le
 *      mauvais espace ne brûle donc rien. Le modèle de serveur ci-dessous
 *      reproduit cet ORDRE, qui est ce qui rend le sondage acceptable.
 *   3. VÉRITÉ — chaque refus remonte avec son propre code, et l'ordre en deux
 *      temps (espace puis coffre) est nommé pour ce qu'il est.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { OrgSummary } from '../../../types/org';

const TOKEN = 'c'.repeat(64);
const VAULT = 'vault-1';
const MY_SPACE = 'my-space';
const HOST_SPACE = 'host-space';
const OTHER_SPACE = 'other-space';

// ── Contexte de locataire, tel que l'apiClient le tient ──────────────────────

/** L'index des locataires, modelé comme la vraie Map de l'apiClient. */
const vaultOrgIndex = new Map<string, string>();
let implicitOrg: string | null = null;
let activeOrg: string | null = null;

/** Le locataire punaisé pour LE coffre du test (raccourci de lecture). */
function pinned(vaultId = VAULT): string | null {
  return vaultOrgIndex.get(vaultId) ?? null;
}

vi.mock('../../../services/network/apiClient', () => ({
  default: {},
  getOrgContextId: (vaultId?: string) =>
    (vaultId ? vaultOrgIndex.get(vaultId) : undefined) ?? activeOrg ?? implicitOrg,
  getImplicitOrg: () => implicitOrg,
  setImplicitOrg: (id: string | null) => {
    implicitOrg = id;
  },
  setActiveOrg: (id: string | null) => {
    activeOrg = id;
  },
  rememberVaultOrg: (vaultId: string, orgId: string) => {
    if (vaultId && orgId) vaultOrgIndex.set(vaultId, orgId);
  },
  getRememberedVaultOrg: (vaultId: string) => vaultOrgIndex.get(vaultId) ?? null,
  forgetVaultOrg: (vaultId: string) => {
    vaultOrgIndex.delete(vaultId);
  },
  forgetVaultOrgs: () => {
    vaultOrgIndex.clear();
  },
}));

// ── Le Worker simulé, dans l'ordre exact de vaults.ts ────────────────────────

interface FakeServer {
  /** L'espace qui possède réellement le coffre. */
  vaultOrg: string;
  /** Les espaces où notre adhésion est active (orgAuthMiddleware). */
  memberships: Set<string>;
  token: string;
  expired: boolean;
  emailMatches: boolean;
  staleEpoch: boolean;
  alreadyMember: boolean;
}

let server: FakeServer;
let joinAttempts: Array<{ org: string | null; token: string }> = [];
/** Le jeton a-t-il été consommé ? La propriété n°2 se lit ici. */
let tokenConsumed = false;

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    // Même chaîne de contrôles que POST /vaults/:id/join, MÊME ORDRE : le jeton
    // n'est consommé qu'après le contrôle du locataire.
    apiJoinVault: vi.fn(async (vaultId: string, token: string) => {
      const org = vaultOrgIndex.get(vaultId) ?? activeOrg ?? implicitOrg;
      joinAttempts.push({ org, token });
      if (!org) throw new Error('org_required');
      if (!server.memberships.has(org)) throw new Error('org_forbidden');
      if (token !== server.token) throw new Error('invite_invalid');
      if (server.expired) throw new Error('invite_expired');
      if (!server.emailMatches) throw new Error('invite_email_mismatch');
      if (org !== server.vaultOrg) throw new Error('vault_not_found');
      if (server.staleEpoch) throw new Error('invite_stale_epoch');
      if (server.alreadyMember) throw new Error('already_member');
      tokenConsumed = true;
      return { role: 'member' };
    }),
    apiListVaults: vi.fn(async () => []),
    apiEnsurePersonalSpace: vi.fn(async () => {
      throw new Error('upgrade_required');
    }),
    apiCreateVault: vi.fn(),
  };
});

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: () => null,
  unlockVault: vi.fn(),
  isVaultUnlocked: () => false,
  lockVault: vi.fn(),
}));

vi.mock('../../../services/collab/collabSession', () => ({ purgeVaultCollab: vi.fn() }));

vi.mock('../../../services/auth/userKeypair', () => ({
  hasUserKeypair: () => false,
  getOwnPublicKey: vi.fn(async () => null),
  sealToPublicKey: vi.fn(),
  openSealed: vi.fn(),
  verifyKeypairIntegrity: vi.fn(),
  isKeyAlgoSupported: () => true,
}));

import vaultsReducer, { joinVault } from '../vaultsSlice';
import orgReducer from '../orgSlice';
import { apiJoinVault } from '../../../services/vault/vaultApi';

// ── Harnais ──────────────────────────────────────────────────────────────────

function personalOrg(id: string, role: string): OrgSummary {
  return {
    id,
    name: `${id}@example.com`,
    slug: null,
    tier: 'free',
    role: role as OrgSummary['role'],
    billingStatus: 'active',
    status: 'active',
    isPersonal: true,
  };
}

/** Le joignant possède son propre espace et est invité dans celui de l'hôte. */
function makeStore(orgs: OrgSummary[]) {
  return configureStore({
    reducer: {
      vaults: vaultsReducer,
      org: orgReducer,
      auth: () => ({ cloudUser: { subscriptionTier: 'free' } }),
    },
    preloadedState: {
      org: {
        orgs,
        currentOrgId: null,
        spaceMode: 'personal' as const,
        loading: false,
        error: null,
      },
    },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
}

const guestOrgs = [personalOrg(MY_SPACE, 'owner'), personalOrg(HOST_SPACE, 'viewer')];

/**
 * Ce que `GET /org` rendrait à un `fetchOrgs`. Le thunk ne relit la liste que
 * lorsqu'il n'a AUCUN locataire : cette variable est donc le seul moyen de
 * distinguer « le store n'était pas encore hydraté » de « ce compte n'a
 * réellement nulle part où viser ».
 */
let orgListFromServer: OrgSummary[] = [];

/** `GET /org` échoue-t-il ? C'est la SEULE façon de distinguer « aucun espace »
 *  de « je n'ai pas pu le savoir ». */
let orgListReadable = true;

beforeEach(() => {
  vi.clearAllMocks();
  vaultOrgIndex.clear();
  activeOrg = null;
  implicitOrg = MY_SPACE;
  orgListFromServer = [];
  orgListReadable = true;
  (globalThis as { window?: unknown }).window = {
    electron: {
      ipcRenderer: {
        invoke: async (channel: string) => {
          if (channel !== 'org:list') return { success: true };
          return orgListReadable
            ? { success: true, data: { orgs: orgListFromServer } }
            : { success: false, error: 'Refresh unavailable (network)' };
        },
      },
    },
  };
  joinAttempts = [];
  tokenConsumed = false;
  server = {
    vaultOrg: HOST_SPACE,
    memberships: new Set([MY_SPACE, HOST_SPACE]),
    token: TOKEN,
    expired: false,
    emailMatches: true,
    staleEpoch: false,
    alreadyMember: false,
  };
});

// ── 1. La visée ──────────────────────────────────────────────────────────────

describe('joinVault — le locataire visé', () => {
  it('utilise l’org portée par le lien, d’un seul coup', async () => {
    const store = makeStore(guestOrgs);
    const res = await store.dispatch(
      joinVault({ vaultId: VAULT, token: TOKEN, orgId: HOST_SPACE })
    );

    expect(res.meta.requestStatus).toBe('fulfilled');
    expect(joinAttempts).toEqual([{ org: HOST_SPACE, token: TOKEN }]);
  });

  it('sans org dans le lien, ne se contente PAS du contexte ambiant', async () => {
    // Le bug d'origine : la requête partait contre notre propre espace et
    // revenait 404 sur une invitation parfaitement valide.
    const store = makeStore(guestOrgs);
    const res = await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(res.meta.requestStatus).toBe('fulfilled');
    expect(joinAttempts.map((a) => a.org)).toEqual([MY_SPACE, HOST_SPACE]);
    expect(tokenConsumed).toBe(true);
  });

  it('une tentative sur le mauvais espace ne brûle pas le jeton', async () => {
    const store = makeStore(guestOrgs);
    await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    // Le premier essai a échoué en vault_not_found APRÈS les contrôles du
    // jeton — c'est cet ordre qui rend le sondage acceptable.
    expect(joinAttempts[0].org).toBe(MY_SPACE);
    expect(joinAttempts).toHaveLength(2);
  });

  it('essaie l’org du lien D’ABORD, puis retombe sur les espaces connus', async () => {
    const store = makeStore(guestOrgs);
    // Un `org` périmé (le coffre a changé d'espace) ne doit pas condamner la
    // jointure : le hachage du jeton reste l'autorité.
    const res = await store.dispatch(
      joinVault({ vaultId: VAULT, token: TOKEN, orgId: OTHER_SPACE })
    );

    expect(joinAttempts.map((a) => a.org)).toEqual([OTHER_SPACE, MY_SPACE, HOST_SPACE]);
    expect(res.meta.requestStatus).toBe('fulfilled');
  });

  it('dépunaise l’hypothèse démentie plutôt que de la laisser traîner', async () => {
    server.vaultOrg = 'nowhere';
    const store = makeStore(guestOrgs);
    await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    // Un locataire faux qui survivrait dans l'index ferait échouer tous les
    // appels ultérieurs à ce coffre.
    expect(pinned()).toBeNull();
  });

  /**
   * LE DÉFAUT QUE CECI FERME. Le sondage écrasait l'entrée d'index d'un coffre
   * DÉJÀ listé, puis la SUPPRIMAIT au premier démenti. Un lien périmé — ou une
   * simple faute de frappe dans la saisie manuelle — dépunaisait donc un coffre
   * parfaitement légitime, dont tous les appels suivants repartaient contre le
   * contexte ambiant : 404 sur chaque item, jusqu'au prochain `loadVaults()`.
   */
  it('restaure le locataire d’un coffre déjà indexé au lieu de l’effacer', async () => {
    vaultOrgIndex.set(VAULT, HOST_SPACE); // le coffre a déjà été listé
    server.token = 'd'.repeat(64); // le jeton du lien est périmé
    const store = makeStore(guestOrgs);

    const res = await store.dispatch(
      joinVault({ vaultId: VAULT, token: TOKEN, orgId: OTHER_SPACE })
    );

    expect(res.meta.requestStatus).toBe('rejected');
    expect(pinned()).toBe(HOST_SPACE);
  });

  /**
   * LE DÉFAUT QUE CECI FERME. Sans locataire connu, la jointure partait quand
   * même — une tentative `null`, donc SANS X-Org-Id. Le Worker bascule alors sur
   * `personalFallback` (rbac.ts) → `provisionPersonalOrg`, qui répond 403
   * `upgrade_required` sur un palier gratuit. Autrement dit : l'invité GRATUIT
   * ouvrant un lien de coffre sans `org=` — c'est-à-dire tous les e-mails déjà
   * partis, la raison même du sondage — s'entendait proposer un abonnement pour
   * un espace que son HÔTE paie.
   */
  it('sans aucun espace connu, ne part PAS sans locataire', async () => {
    const store = makeStore([]);
    const res = await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(res.meta.requestStatus).toBe('rejected');
    expect(res.payload).toBe('vault_join_needs_space');
    // Aucun appel réseau : il n'y avait rien à viser.
    expect(joinAttempts).toEqual([]);
  });

  /**
   * LE DÉFAUT QUE CECI FERME. Une liste de locataires vide dit DEUX choses, et
   * le sélecteur le documente lui-même (« Empty = no context yet — org list not
   * loaded / offline ») : « je n'appartiens à aucun espace » et « je n'ai pas PU
   * lire la liste ». Les confondre rendait `vault_join_needs_space`, dont la
   * phrase prescrit d'accepter d'abord l'invitation à l'espace — peut-être déjà
   * acceptée — et qui est TERMINAL : l'écran retirait son bouton « Réessayer » à
   * quelqu'un pour qui attendre le réseau aurait suffi.
   */
  it('ne conclut PAS « aucun espace » quand la liste n’a pas pu être lue', async () => {
    const store = makeStore([]);
    orgListReadable = false;

    const res = await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(res.meta.requestStatus).toBe('rejected');
    expect(res.payload).toBe('vault_join_space_unknown');
    expect(res.payload).not.toBe('vault_join_needs_space');
    // Toujours aucun appel à l'aveugle : ne rien savoir n'autorise pas à viser.
    expect(joinAttempts).toEqual([]);
  });

  it('conclut bien « aucun espace » quand la liste a été lue et qu’elle est vide', async () => {
    const store = makeStore([]);
    orgListReadable = true;
    orgListFromServer = [];

    const res = await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(res.payload).toBe('vault_join_needs_space');
  });

  it('une liste illisible n’empêche pas de viser l’org portée par le lien', async () => {
    // Le lien nomme le locataire : il n'y a rien à lire pour savoir où aller.
    const store = makeStore([]);
    orgListReadable = false;

    const res = await store.dispatch(
      joinVault({ vaultId: VAULT, token: TOKEN, orgId: HOST_SPACE })
    );

    expect(res.meta.requestStatus).toBe('fulfilled');
    expect(joinAttempts).toEqual([{ org: HOST_SPACE, token: TOKEN }]);
  });

  it('relit les espaces avant de conclure qu’il n’y en a aucun', async () => {
    // Course au démarrage : le store est vide, mais le compte a bien un espace.
    const store = makeStore([]);
    server.memberships = new Set([MY_SPACE]);
    server.vaultOrg = MY_SPACE;
    orgListFromServer = [personalOrg(MY_SPACE, 'owner')];

    const res = await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(res.meta.requestStatus).toBe('fulfilled');
    expect(joinAttempts).toEqual([{ org: MY_SPACE, token: TOKEN }]);
  });
});

// ── 2. Le sondage s'arrête sur une décision ──────────────────────────────────

describe('joinVault — quand cesser de chercher', () => {
  it.each([
    ['une invitation expirée', { expired: true }, 'invite_expired'],
    ['une adresse qui ne correspond pas', { emailMatches: false }, 'invite_email_mismatch'],
    ['une clé de coffre changée depuis', { staleEpoch: true }, 'invite_stale_epoch'],
    ['une adhésion déjà en place', { alreadyMember: true }, 'already_member'],
  ])('s’arrête net sur %s', async (_label, patch, expected) => {
    Object.assign(server, patch);
    // Le coffre est dans NOTRE espace : le premier essai atteint donc bien le
    // contrôle en question, et rien ne justifie d'en tenter un second.
    server.vaultOrg = MY_SPACE;
    const store = makeStore(guestOrgs);
    const res = await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(res.meta.requestStatus).toBe('rejected');
    expect(res.payload).toBe(expected);
    expect(joinAttempts).toHaveLength(1);
  });

  it('un jeton révoqué est définitif, quel que soit l’espace', async () => {
    server.token = 'd'.repeat(64);
    const store = makeStore(guestOrgs);
    const res = await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(res.payload).toBe('invite_invalid');
    expect(joinAttempts).toHaveLength(1);
  });
});

// ── 3. L'ordre en deux temps, nommé ──────────────────────────────────────────

describe('joinVault — le coffre avant l’espace', () => {
  it('dit d’accepter l’invitation à l’espace, pas « vous n’avez pas accès »', async () => {
    // L'invité n'a pas encore accepté l'invitation d'ESPACE : le Worker répond
    // 403 org_forbidden depuis son middleware, un code que rien ne distingue
    // d'un refus d'autorisation ordinaire — sauf le client, qui vient
    // d'épuiser tous les locataires auxquels il appartient.
    server.memberships = new Set([MY_SPACE]);
    const store = makeStore(guestOrgs);
    const res = await store.dispatch(
      joinVault({ vaultId: VAULT, token: TOKEN, orgId: HOST_SPACE })
    );

    expect(res.meta.requestStatus).toBe('rejected');
    expect(res.payload).toBe('vault_join_needs_space');
  });

  it('un coffre réellement disparu reste un coffre disparu', async () => {
    server.vaultOrg = 'nowhere';
    const store = makeStore(guestOrgs);
    const res = await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(res.payload).toBe('vault_not_found');
  });
});

// ── 4. Le refus va à l'appelant, pas dans un état partagé ────────────────────

describe('joinVault — l’état de la jointure', () => {
  it('remonte le refus par le payload, seul canal que l’écran d’acceptation lit', async () => {
    server.expired = true;
    server.vaultOrg = MY_SPACE;
    const store = makeStore(guestOrgs);
    const res = await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(res.payload).toBe('invite_expired');
  });

  /**
   * LE DÉFAUT QUE CECI FERME. Le refus atterrissait dans `vaults.error`, partagé
   * avec le chargement de la LISTE. `VaultsList` rend cette valeur via
   * `vaultErrorKey` — la table CÔTÉ HÔTE, celle que `JOIN_ERROR_KEYS` existe
   * pour ne pas réutiliser — et seulement quand la liste est vide : exactement
   * la situation d'un invité. Un « invitation envoyée à une autre adresse »
   * s'affichait donc derrière la modale, avec les mots de l'hôte, sous un bouton
   * « Réessayer » qui relançait `loadVaults` et non la jointure.
   */
  it('n’écrit RIEN dans l’erreur de la liste', async () => {
    server.expired = true;
    server.vaultOrg = MY_SPACE;
    const store = makeStore(guestOrgs);
    await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN }));

    expect(store.getState().vaults.error).toBeNull();
    expect(store.getState().vaults.loading).toBe(false);
  });

  it('rafraîchit la liste des coffres après une jointure réussie', async () => {
    const store = makeStore(guestOrgs);
    await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN, orgId: HOST_SPACE }));

    // Sans ce rafraîchissement le coffre rejoint n'apparaîtrait qu'au prochain
    // démarrage — une réussite invisible.
    const { apiListVaults } = await import('../../../services/vault/vaultApi');
    expect(apiListVaults).toHaveBeenCalled();
    expect(store.getState().vaults.error).toBeNull();
  });

  it('appelle bien la couche HTTP de jointure', async () => {
    const store = makeStore(guestOrgs);
    await store.dispatch(joinVault({ vaultId: VAULT, token: TOKEN, orgId: HOST_SPACE }));
    expect(apiJoinVault).toHaveBeenCalledWith(VAULT, TOKEN);
  });
});
