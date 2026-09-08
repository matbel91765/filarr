/**
 * Le lien d'invitation doit SURVIVRE au parcours, et ne laisser aucune trace.
 *
 * CE QUI ÉTAIT CASSÉ. L'e-mail d'invitation pointe sur `/invite?token=…`, et
 * l'application ne pouvait pas le lire : son routeur est un HashRouter (aveugle
 * à `location.pathname`) monté seulement APRÈS la sélection de profil. Le jeton
 * arrivait donc dans une page qui l'ignorait, puis disparaissait au premier
 * rechargement — et il n'y avait aucun autre chemin pour accepter.
 *
 * Deux propriétés, et ce sont les deux qui manquaient :
 *   1. SURVIE — le jeton traverse onboarding, inscription, connexion et
 *      sélection de profil, dont trois rechargent la page ou remettent Redux à
 *      zéro. Il est donc relu après réévaluation complète du module.
 *   2. DISCRÉTION — il quitte immédiatement la barre d'adresse, l'historique et
 *      le referrer sortant. Un porteur d'authentification qui traîne dans une
 *      URL finit dans une capture d'écran ou un journal d'analytique.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const TOKEN = 'a'.repeat(64);
const OTHER_TOKEN = 'b'.repeat(64);
const VAULT = '11111111-2222-3333-4444-555555555555';
const ORG = '99999999-8888-7777-6666-555555555555';

/** sessionStorage minimal, partageable entre deux évaluations du module. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

interface FakeWindow {
  location: { pathname: string; search: string };
  localStorage: Storage;
  sessionStorage: Storage;
  history: { replaceState: (s: unknown, t: string, url?: string) => void };
  replaced: string[];
}

/**
 * `storage` tient le rôle de sessionStorage (l'onglet). `durable` tient celui de
 * localStorage : c'est LUI qui doit survivre à la fermeture de l'onglet — le
 * détour de vérification d'e-mail n'est pas un rechargement, c'est un départ.
 */
function installWindow(
  url: string,
  storage: Storage = fakeStorage(),
  durable: Storage = fakeStorage()
): FakeWindow {
  const u = new URL(url, 'https://app.filarr.com');
  const replaced: string[] = [];
  const w: FakeWindow = {
    location: { pathname: u.pathname, search: u.search },
    localStorage: durable,
    sessionStorage: storage,
    history: {
      replaceState: (_s, _t, next) => {
        replaced.push(String(next ?? ''));
        w.location.pathname = String(next ?? '/');
        w.location.search = '';
      },
    },
    replaced,
  };
  (globalThis as { window?: unknown }).window = w;
  return w;
}

/** Réévalue le module comme le ferait un rechargement de page. */
async function bootModule() {
  vi.resetModules();
  return import('../pendingInvite');
}

/** Ce que le stockage porte réellement : une LISTE d'invitations datées. */
interface StoredEntry {
  kind: string;
  token: string;
  savedAt: number;
  mutedFor?: string[];
}

function readEntries(store: Storage): StoredEntry[] {
  return JSON.parse(store.getItem('filarr.pending-invite') ?? '[]');
}

function writeEntries(store: Storage, entries: StoredEntry[]): void {
  store.setItem('filarr.pending-invite', JSON.stringify(entries));
}

beforeEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

// ── 1. Lecture d'un lien ─────────────────────────────────────────────────────

describe('parseInviteLink', () => {
  it('lit une invitation d’ESPACE', async () => {
    const { parseInviteLink } = await bootModule();
    expect(parseInviteLink(`https://filarr.com/invite?token=${TOKEN}`)).toEqual({
      kind: 'org',
      token: TOKEN,
      orgId: undefined,
    });
  });

  it('lit une invitation de COFFRE avec le locataire de l’hôte', async () => {
    const { parseInviteLink } = await bootModule();
    expect(
      parseInviteLink(`https://filarr.com/vault-invite?token=${TOKEN}&vault=${VAULT}&org=${ORG}`)
    ).toEqual({ kind: 'vault', token: TOKEN, vaultId: VAULT, orgId: ORG });
  });

  it('accepte un lien de coffre SANS org — les e-mails déjà partis n’en ont pas', async () => {
    const { parseInviteLink } = await bootModule();
    const parsed = parseInviteLink(`https://filarr.com/vault-invite?token=${TOKEN}&vault=${VAULT}`);
    expect(parsed).toEqual({ kind: 'vault', token: TOKEN, vaultId: VAULT, orgId: undefined });
  });

  it('accepte un jeton nu collé à la main (le seul chemin sur le bureau)', async () => {
    const { parseInviteLink } = await bootModule();
    // `bare` retient l'HYPOTHÈSE faite ici — un code seul ne peut être présenté
    // qu'à la route des espaces — pour que le refus puisse la nommer plutôt que
    // d'annoncer une invitation « retirée », faux et terminal.
    expect(parseInviteLink(`  ${TOKEN}  `)).toEqual({ kind: 'org', token: TOKEN, bare: true });
  });

  it('ignore un `org` abîmé plutôt que de jeter tout le lien', async () => {
    // Le jeton reste l'autorité côté serveur et la jointure sait sonder les
    // locataires : refuser ici priverait l'utilisateur de son seul chemin.
    const { parseInviteLink } = await bootModule();
    const parsed = parseInviteLink(
      `https://filarr.com/vault-invite?token=${TOKEN}&vault=${VAULT}&org=<script>`
    );
    expect(parsed?.orgId).toBeUndefined();
    expect(parsed?.token).toBe(TOKEN);
  });

  it.each([
    ['une URL sans jeton', 'https://filarr.com/invite'],
    ['un jeton malformé', 'https://filarr.com/invite?token=nope'],
    ['un lien de coffre sans coffre', `https://filarr.com/vault-invite?token=${TOKEN}`],
    ['une autre page du site', `https://filarr.com/pricing?token=${TOKEN}`],
    ['du texte quelconque', 'bonjour'],
    ['une chaîne vide', '   '],
  ])('refuse %s', async (_label, input) => {
    const { parseInviteLink } = await bootModule();
    expect(parseInviteLink(input)).toBeNull();
  });
});

// ── 2. Captation + nettoyage de l'URL ────────────────────────────────────────

describe('captation au chargement de la page', () => {
  it('capte le jeton À L’IMPORT, avant tout rendu React', async () => {
    installWindow(`/vault-invite?token=${TOKEN}&vault=${VAULT}&org=${ORG}`);
    const { readPendingInvite } = await bootModule();
    expect(readPendingInvite()).toEqual({
      kind: 'vault',
      token: TOKEN,
      vaultId: VAULT,
      orgId: ORG,
    });
  });

  it('retire le jeton de la barre d’adresse, de l’historique et du referrer', async () => {
    const w = installWindow(`/invite?token=${TOKEN}`);
    await bootModule();
    expect(w.replaced).toEqual(['/']);
    expect(w.location.search).toBe('');
    expect(w.location.pathname).toBe('/');
  });

  it('ne réécrit RIEN quand la page n’est pas une invitation (cas Electron)', async () => {
    const w = installWindow('/index.html');
    const { readPendingInvite } = await bootModule();
    expect(readPendingInvite()).toBeNull();
    expect(w.replaced).toEqual([]);
  });
});

// ── 3. Survie au parcours ────────────────────────────────────────────────────

describe('survie à la connexion, à l’inscription et au choix de profil', () => {
  it('se relit après un rechargement complet de la page', async () => {
    const storage = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, storage);
    const first = await bootModule();
    expect(first.readPendingInvite()?.token).toBe(TOKEN);

    // Header.tsx, ManageProfilesModal et VaultPasswordLock rechargent tous la
    // page : le module est réévalué, et l'URL a déjà été nettoyée.
    installWindow('/', storage);
    const reloaded = await bootModule();
    expect(reloaded.readPendingInvite()).toEqual({ kind: 'org', token: TOKEN, orgId: undefined });
  });

  it('le dernier lien ouvert est présenté d’abord', async () => {
    const storage = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, storage);
    await bootModule();
    installWindow(`/invite?token=${OTHER_TOKEN}`, storage);
    const { readPendingInvite } = await bootModule();
    expect(readPendingInvite()?.token).toBe(OTHER_TOKEN);
  });

  it('n’est plus relue une fois consommée', async () => {
    installWindow(`/invite?token=${TOKEN}`);
    const { clearPendingInvite, readPendingInvite } = await bootModule();
    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
  });

  it('jette une entrée abîmée au lieu de la reproposer à chaque montage', async () => {
    const storage = fakeStorage();
    storage.setItem('filarr.pending-invite', '{"kind":"org","token":"trop-court"}');
    installWindow('/', storage);
    const { readPendingInvite } = await bootModule();
    expect(readPendingInvite()).toBeNull();
    expect(storage.getItem('filarr.pending-invite')).toBeNull();
  });
});

// ── 3 bis. Survie au DÉTOUR DE VÉRIFICATION D'E-MAIL ─────────────────────────

/**
 * LE DÉFAUT QUE CECI FERME. `POST /auth/register` ne rend aucun jeton et
 * `POST /auth/login` refuse tant que l'adresse n'est pas vérifiée : un invité
 * sans compte DOIT donc quitter l'onglet pour aller cliquer dans sa boîte mail.
 * sessionStorage meurt avec l'onglet — l'invitation mourait exactement dans le
 * seul parcours qui l'oblige à survivre, et rien ne le rattrapait.
 */
describe('survie à la fermeture de l’onglet', () => {
  it('se relit dans un onglet NEUF, session vidée', async () => {
    const durable = fakeStorage();
    installWindow(`/vault-invite?token=${TOKEN}&vault=${VAULT}&org=${ORG}`, fakeStorage(), durable);
    await bootModule();

    // L'onglet est fermé : sessionStorage disparaît, localStorage reste.
    installWindow('/', fakeStorage(), durable);
    const { readPendingInvite } = await bootModule();

    expect(readPendingInvite()).toEqual({
      kind: 'vault',
      token: TOKEN,
      vaultId: VAULT,
      orgId: ORG,
    });
  });

  it('périme au bout de 7 jours, comme le jeton qu’il transporte', async () => {
    // Garder le porteur plus longtemps que le jeton (INVITATION_TTL_MS côté
    // org.ts, VAULT_INVITE_TTL_MS côté vaults.ts) reviendrait à rouvrir une
    // modale qui ne peut plus aboutir.
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, fakeStorage(), durable);
    await bootModule();

    const stored = readEntries(durable)[0];
    expect(typeof stored.savedAt).toBe('number');
    writeEntries(durable, [{ ...stored, savedAt: Date.now() - 8 * 24 * 3600 * 1000 }]);

    installWindow('/', fakeStorage(), durable);
    const { readPendingInvite } = await bootModule();
    expect(readPendingInvite()).toBeNull();
    expect(durable.getItem('filarr.pending-invite')).toBeNull();
  });

  it('garde un porteur encore valable', async () => {
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, fakeStorage(), durable);
    await bootModule();

    const stored = readEntries(durable)[0];
    writeEntries(durable, [{ ...stored, savedAt: Date.now() - 6 * 24 * 3600 * 1000 }]);

    installWindow('/', fakeStorage(), durable);
    const { readPendingInvite } = await bootModule();
    expect(readPendingInvite()?.token).toBe(TOKEN);
  });

  it('ne périme QUE l’invitation trop vieille, pas ses voisines', async () => {
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, fakeStorage(), durable);
    await bootModule();
    installWindow(`/invite?token=${OTHER_TOKEN}`, fakeStorage(), durable);
    await bootModule();

    const [recent, old] = readEntries(durable);
    expect(recent.token).toBe(OTHER_TOKEN);
    writeEntries(durable, [recent, { ...old, savedAt: Date.now() - 8 * 24 * 3600 * 1000 }]);

    installWindow('/', fakeStorage(), durable);
    const { readPendingInvites } = await bootModule();
    expect(readPendingInvites().map((i) => i.token)).toEqual([OTHER_TOKEN]);
  });

  it('est effacé pour de bon à l’acceptation, des DEUX stockages', async () => {
    const session = fakeStorage();
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, session, durable);
    const { clearPendingInvite } = await bootModule();
    clearPendingInvite();

    expect(durable.getItem('filarr.pending-invite')).toBeNull();
    expect(session.getItem('filarr.pending-invite')).toBeNull();

    installWindow('/', fakeStorage(), durable);
    const { readPendingInvite } = await bootModule();
    expect(readPendingInvite()).toBeNull();
  });
});

// ── 3 ter. Le compte connecté ne décide RIEN du sort du porteur ──────────────

/**
 * LE DÉFAUT QUE CECI FERME. Le porteur était lié au PREMIER compte qui le voyait,
 * puis effacé dès qu'un autre se présentait. C'était le parcours prescrit par
 * l'écran lui-même qui se trouvait détruit : sur une adresse qui ne correspond
 * pas, le message dit « déconnectez-vous, puis reconnectez-vous avec l'adresse
 * qui l'a reçue » — et cette reconnexion, précisément parce qu'elle amenait une
 * AUTRE identité, effaçait l'invitation. Le message promettait donc l'inverse de
 * ce qui se passait, comme l'effacement sur refus terminal, et par la même
 * confusion : « ce n'est pas le bon compte » n'est pas « cette invitation est
 * morte ».
 *
 * Ce qu'il fallait empêcher — proposer à bob@ l'invitation d'alice@ sur un poste
 * partagé — est désormais décidé par l'ADRESSE INVITÉE (`isForAnotherAccount`),
 * qui est la seule chose qui le sache, et sans rien détruire.
 */
describe('le porteur attend son destinataire', () => {
  it('n’expose aucun moyen de le détruire au vu du compte connecté', async () => {
    const mod = await bootModule();
    expect((mod as Record<string, unknown>).bindPendingInviteToIdentity).toBeUndefined();
  });

  it('survit à une déconnexion PUIS à une reconnexion sur un autre compte', async () => {
    // Le parcours nominal d'une non-correspondance d'adresse, de bout en bout :
    // c'est celui que l'ancien lien à l'identité coupait en deux.
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, fakeStorage(), durable);
    await bootModule();

    // Déconnexion : la page recharge, le module est réévalué.
    installWindow('/', fakeStorage(), durable);
    const afterLogout = await bootModule();
    expect(afterLogout.readPendingInvite()?.token).toBe(TOKEN);

    // Reconnexion avec l'adresse destinataire : re-rechargement.
    installWindow('/', fakeStorage(), durable);
    const afterLogin = await bootModule();
    expect(afterLogin.readPendingInvite()?.token).toBe(TOKEN);
  });

  it('ne garde aucune trace du compte dans le stockage', async () => {
    // Le porteur ne transporte que l'invitation et sa date : rien qui puisse
    // servir, plus tard, à décider de sa destruction au vu d'une identité.
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, fakeStorage(), durable);
    await bootModule();

    const entries = readEntries(durable);
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0]).sort()).toEqual(['kind', 'savedAt', 'token']);
  });

  it('reste effaçable explicitement, et prévient l’abonné', async () => {
    installWindow(`/invite?token=${TOKEN}`);
    const { subscribePendingInvite, clearPendingInvite } = await bootModule();
    const seen: Array<string | null> = [];
    const off = subscribePendingInvite((i) => seen.push(i?.token ?? null));

    clearPendingInvite();
    off();

    expect(seen).toEqual([TOKEN, null]);
  });
});

// ── 3 quater. DEUX invitations, et aucune détruite ───────────────────────────

/**
 * LE DÉFAUT QUE CETTE SECTION FERME. `setPendingInvite` écrasait le porteur sans
 * condition — « le dernier qui arrive gagne » — et l'invitation remplacée était
 * VIVANTE. Ce n'est pas un cas exotique mais le cas NOMINAL du produit : un hôte
 * qui partage deux coffres envoie deux e-mails, qu'on ouvre l'un après l'autre.
 * Le second effaçait le premier avant même que l'écran d'acceptation n'existe,
 * et rien n'en informait personne.
 */
describe('plusieurs invitations en attente', () => {
  it('garde les deux, la plus récente en tête', async () => {
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, fakeStorage(), durable);
    await bootModule();
    installWindow(
      `/vault-invite?token=${OTHER_TOKEN}&vault=${VAULT}&org=${ORG}`,
      fakeStorage(),
      durable
    );
    const { readPendingInvites, readPendingInvite } = await bootModule();

    expect(readPendingInvites().map((i) => i.token)).toEqual([OTHER_TOKEN, TOKEN]);
    expect(readPendingInvite()?.token).toBe(OTHER_TOKEN);
  });

  it('régler l’une laisse l’autre intacte, et la présente aussitôt', async () => {
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, fakeStorage(), durable);
    await bootModule();
    installWindow(`/invite?token=${OTHER_TOKEN}`, fakeStorage(), durable);
    const { readPendingInvite, clearPendingInvite } = await bootModule();

    clearPendingInvite({ kind: 'org', token: OTHER_TOKEN });

    // La première n'a pas attendu un redémarrage : elle prend la place.
    expect(readPendingInvite()?.token).toBe(TOKEN);
    expect(readEntries(durable).map((e) => e.token)).toEqual([TOKEN]);
  });

  it('l’abonné voit la suivante arriver dès que la précédente est réglée', async () => {
    installWindow('/');
    const { subscribePendingInvite, setPendingInvite, clearPendingInvite } = await bootModule();
    const seen: Array<string | null> = [];
    const off = subscribePendingInvite((i) => seen.push(i?.token ?? null));

    setPendingInvite({ kind: 'org', token: TOKEN });
    setPendingInvite({ kind: 'org', token: OTHER_TOKEN });
    clearPendingInvite({ kind: 'org', token: OTHER_TOKEN });
    off();

    expect(seen).toEqual([TOKEN, OTHER_TOKEN, TOKEN]);
  });

  it('rouvrir le MÊME lien ne crée pas une seconde invitation', async () => {
    installWindow('/');
    const { setPendingInvite, readPendingInvites } = await bootModule();
    setPendingInvite({ kind: 'org', token: TOKEN });
    setPendingInvite({ kind: 'org', token: TOKEN });
    expect(readPendingInvites()).toHaveLength(1);
  });

  it('distingue un code NU du lien complet du même coffre', async () => {
    // Les deux sortes de jeton sont indiscernables : c'est la nature ET le
    // coffre qui font l'identité, pas la seule chaîne.
    installWindow('/');
    const { setPendingInvite, readPendingInvites } = await bootModule();
    setPendingInvite({ kind: 'org', token: TOKEN, bare: true });
    setPendingInvite({ kind: 'vault', token: TOKEN, vaultId: VAULT });
    expect(readPendingInvites()).toHaveLength(2);
  });

  it('borne la liste : une invitation n’est pas un stockage sans fin', async () => {
    installWindow('/');
    const { setPendingInvite, readPendingInvites } = await bootModule();
    const tokens = Array.from({ length: 9 }, (_, i) => `${i}`.repeat(64));
    for (const token of tokens) setPendingInvite({ kind: 'org', token });

    const kept = readPendingInvites().map((i) => i.token);
    expect(kept).toHaveLength(5);
    // Ce sont les PLUS ANCIENNES qui cèdent — les plus proches de périmer.
    expect(kept).toEqual(tokens.slice(-5).reverse());
  });

  it('efface tout quand on ne désigne rien', async () => {
    installWindow('/');
    const { setPendingInvite, clearPendingInvite, readPendingInvites } = await bootModule();
    setPendingInvite({ kind: 'org', token: TOKEN });
    setPendingInvite({ kind: 'org', token: OTHER_TOKEN });
    clearPendingInvite();
    expect(readPendingInvites()).toEqual([]);
  });

  it('relit une entrée de l’ANCIENNE forme, un seul objet', async () => {
    // Une invitation captée par la version précédente ne doit pas disparaître
    // à la mise à jour de l'application.
    const durable = fakeStorage();
    durable.setItem(
      'filarr.pending-invite',
      JSON.stringify({ kind: 'org', token: TOKEN, savedAt: Date.now() })
    );
    installWindow('/', fakeStorage(), durable);
    const { readPendingInvite } = await bootModule();
    expect(readPendingInvite()?.token).toBe(TOKEN);
  });
});

// ── 3 quinquies. Poste partagé : se taire sans rien détruire ─────────────────

/**
 * LE DÉFAUT QUE CETTE SECTION FERME. L'écran « ce n'est pas votre invitation »
 * revenait à CHAQUE démarrage pour un compte qui n'est pas le destinataire, sans
 * autre issue que d'attendre sept jours : « Plus tard » ne survit pas au
 * redémarrage, et effacer le jeton aurait détruit l'invitation de son vrai
 * destinataire. La sourdine sépare les deux.
 */
describe('mise en sourdine par compte', () => {
  it('se tait pour ce compte-ci et pour lui seul', async () => {
    installWindow('/');
    const { setPendingInvite, muteInviteForAccount, readPendingInvite } = await bootModule();
    const invite = { kind: 'org' as const, token: TOKEN };
    setPendingInvite(invite);

    muteInviteForAccount(invite, 'bob@example.com');

    expect(readPendingInvite('bob@example.com')).toBeNull();
    expect(readPendingInvite('BOB@Example.com ')).toBeNull(); // même personne
    expect(readPendingInvite('alice@example.com')?.token).toBe(TOKEN);
    // Et sans compte nommé — la livraison aux abonnés — rien n'est filtré.
    expect(readPendingInvite()?.token).toBe(TOKEN);
  });

  it('ne touche JAMAIS au jeton', async () => {
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, fakeStorage(), durable);
    const { muteInviteForAccount } = await bootModule();
    muteInviteForAccount({ kind: 'org', token: TOKEN }, 'bob@example.com');

    const entries = readEntries(durable);
    expect(entries).toHaveLength(1);
    expect(entries[0].token).toBe(TOKEN);
    // Elle survit au redémarrage, et attend toujours son destinataire.
    installWindow('/', fakeStorage(), durable);
    const reloaded = await bootModule();
    expect(reloaded.readPendingInvite('alice@example.com')?.token).toBe(TOKEN);
    expect(reloaded.readPendingInvite('bob@example.com')).toBeNull();
  });

  it('n’écrit AUCUNE adresse en clair dans un stockage partagé', async () => {
    const durable = fakeStorage();
    installWindow(`/invite?token=${TOKEN}`, fakeStorage(), durable);
    const { muteInviteForAccount } = await bootModule();
    muteInviteForAccount({ kind: 'org', token: TOKEN }, 'bob@example.com');

    const raw = durable.getItem('filarr.pending-invite')!;
    expect(raw).not.toContain('bob@example.com');
    expect(raw).not.toContain('bob');
    expect(readEntries(durable)[0].mutedFor).toHaveLength(1);
  });

  it('laisse passer l’invitation SUIVANTE quand la première est en sourdine', async () => {
    installWindow('/');
    const { setPendingInvite, muteInviteForAccount, readPendingInvite } = await bootModule();
    setPendingInvite({ kind: 'org', token: TOKEN });
    setPendingInvite({ kind: 'org', token: OTHER_TOKEN });

    muteInviteForAccount({ kind: 'org', token: OTHER_TOKEN }, 'bob@example.com');

    expect(readPendingInvite('bob@example.com')?.token).toBe(TOKEN);
  });

  it('sans compte connecté, ne met rien en sourdine', async () => {
    installWindow('/');
    const { setPendingInvite, muteInviteForAccount, readPendingInvite } = await bootModule();
    setPendingInvite({ kind: 'org', token: TOKEN });
    muteInviteForAccount({ kind: 'org', token: TOKEN }, null);
    expect(readPendingInvite()?.token).toBe(TOKEN);
  });
});

// ── 4. Dégradation ───────────────────────────────────────────────────────────

describe('sessionStorage indisponible (navigation privée, cookies bloqués)', () => {
  it('capte quand même, sans jeter — la copie mémoire prend le relais', async () => {
    const hostile = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    installWindow(`/invite?token=${TOKEN}`, hostile);

    const { readPendingInvite, clearPendingInvite } = await bootModule();
    expect(readPendingInvite()?.token).toBe(TOKEN);
    expect(() => clearPendingInvite()).not.toThrow();
    expect(readPendingInvite()).toBeNull();
  });
});

// ── 5. Livraison à l'écran d'acceptation ─────────────────────────────────────

describe('abonnement', () => {
  it('délivre IMMÉDIATEMENT l’invitation qui dort déjà', async () => {
    installWindow(`/invite?token=${TOKEN}`);
    const { subscribePendingInvite } = await bootModule();
    const seen: Array<string | null> = [];
    const off = subscribePendingInvite((i) => seen.push(i?.token ?? null));
    // L'écran n'est monté qu'après le déverrouillage, bien après la captation :
    // sans livraison immédiate l'invitation ne serait jamais vue.
    expect(seen).toEqual([TOKEN]);
    off();
  });

  it('délivre la saisie manuelle puis la consommation', async () => {
    installWindow('/');
    const { subscribePendingInvite, setPendingInvite, clearPendingInvite } = await bootModule();
    const seen: Array<string | null> = [];
    const off = subscribePendingInvite((i) => seen.push(i?.token ?? null));
    setPendingInvite({ kind: 'org', token: TOKEN });
    clearPendingInvite();
    off();
    setPendingInvite({ kind: 'org', token: OTHER_TOKEN });
    expect(seen).toEqual([TOKEN, null]);
  });
});

// ── Deux onglets ─────────────────────────────────────────────────────────────

/**
 * DEUX ONGLETS ÉCRIVENT LE MÊME STOCKAGE, et c'est le cas nominal : un hôte qui
 * partage deux coffres envoie deux e-mails, qu'on ouvre l'un après l'autre.
 * Chaque mutation était un lire-modifier-écrire sur un instantané pris à son
 * début, donc le second onglet écrasait l'invitation du premier — perdue, sans
 * un mot, alors qu'elle était parfaitement vivante.
 */
describe('deux onglets', () => {
  it('ne piétine pas l’invitation rangée par l’autre onglet', async () => {
    const durable = fakeStorage();
    installWindow('/', fakeStorage(), durable);
    const { setPendingInvite, readPendingInvites } = await bootModule();

    // Cet onglet-ci range la sienne, et sa copie mémoire ne connaît qu'elle.
    setPendingInvite({ kind: 'org', token: TOKEN });
    // L'AUTRE onglet range la sienne — nous n'en savons rien.
    writeEntries(durable, [
      { kind: 'org', token: OTHER_TOKEN, savedAt: Date.now() },
      ...readEntries(durable),
    ]);
    // Puis cet onglet-ci écrit de nouveau. Sans relecture au dernier moment, il
    // repartirait de son instantané périmé et effacerait celle d'en face.
    setPendingInvite({ kind: 'org', token: TOKEN });

    expect(
      readPendingInvites()
        .map((i) => i.token)
        .sort()
    ).toEqual([TOKEN, OTHER_TOKEN].sort());
  });

  it('efface UNIQUEMENT celle qui est réglée, même après une écriture d’en face', async () => {
    const durable = fakeStorage();
    installWindow('/', fakeStorage(), durable);
    const { setPendingInvite, clearPendingInvite, readPendingInvites } = await bootModule();

    setPendingInvite({ kind: 'org', token: TOKEN });
    writeEntries(durable, [
      { kind: 'org', token: OTHER_TOKEN, savedAt: Date.now() },
      ...readEntries(durable),
    ]);
    clearPendingInvite({ kind: 'org', token: TOKEN });

    expect(readPendingInvites().map((i) => i.token)).toEqual([OTHER_TOKEN]);
  });

  it('reprend la main quand l’autre onglet a tout réglé', async () => {
    const durable = fakeStorage();
    const w = installWindow('/', fakeStorage(), durable);
    const listeners: Array<(e: StorageEvent) => void> = [];
    (w as unknown as { addEventListener: unknown }).addEventListener = (
      type: string,
      fn: (e: StorageEvent) => void
    ) => {
      if (type === 'storage') listeners.push(fn);
    };

    const { setPendingInvite, subscribePendingInvite } = await bootModule();
    setPendingInvite({ kind: 'org', token: TOKEN });
    const seen: Array<string | null> = [];
    const off = subscribePendingInvite((i) => seen.push(i?.token ?? null));

    // L'autre onglet accepte : le stockage se vide, mais notre copie mémoire
    // continuerait de proposer une invitation déjà consommée ailleurs.
    durable.removeItem('filarr.pending-invite');
    for (const fn of listeners) fn({ key: 'filarr.pending-invite' } as StorageEvent);

    expect(seen).toEqual([TOKEN, null]);
    off();
  });
});

/**
 * Recoller son propre lien, après s'être trompé de compte au moment de la
 * sourdine, était un néant parfait : `setPendingInvite` reconduisait `mutedFor`,
 * `readPendingInvite` écartait l'entrée, la fenêtre de saisie se refermait et il
 * ne se passait RIEN — aucun message, aucune erreur, aucun écran.
 */
describe('lever la sourdine — le geste explicite de coller un lien', () => {
  it('rend l’invitation à celui qui la recolle', async () => {
    installWindow('/');
    const { setPendingInvite, muteInviteForAccount, readPendingInvite } = await bootModule();
    const invite = { kind: 'org' as const, token: TOKEN };
    setPendingInvite(invite);
    muteInviteForAccount(invite, 'bob@example.com');
    expect(readPendingInvite('bob@example.com')).toBeNull();

    setPendingInvite(invite, { unmuteFor: 'bob@example.com' });

    expect(readPendingInvite('bob@example.com')?.token).toBe(TOKEN);
  });

  it('ne lève QUE la sienne — la sourdine des autres comptes tient', async () => {
    installWindow('/');
    const { setPendingInvite, muteInviteForAccount, readPendingInvite } = await bootModule();
    const invite = { kind: 'org' as const, token: TOKEN };
    setPendingInvite(invite);
    muteInviteForAccount(invite, 'bob@example.com');
    muteInviteForAccount(invite, 'carol@example.com');

    setPendingInvite(invite, { unmuteFor: 'bob@example.com' });

    expect(readPendingInvite('bob@example.com')?.token).toBe(TOKEN);
    expect(readPendingInvite('carol@example.com')).toBeNull();
  });

  it('sans le drapeau, la sourdine est reconduite — une captation d’URL ne défait rien', async () => {
    // Un lien rouvert depuis la boîte mail d'un AUTRE ne doit pas annuler un
    // choix pris ici : seul le collage manuel est un geste de ce compte.
    installWindow('/');
    const { setPendingInvite, muteInviteForAccount, readPendingInvite } = await bootModule();
    const invite = { kind: 'org' as const, token: TOKEN };
    setPendingInvite(invite);
    muteInviteForAccount(invite, 'bob@example.com');

    setPendingInvite(invite);

    expect(readPendingInvite('bob@example.com')).toBeNull();
  });
});

/**
 * L'INVENTAIRE. Le module range jusqu'à cinq invitations et n'en propose qu'une :
 * la tête de liste. Rien n'est perdu — régler la première fait remonter la
 * suivante — mais après un « Plus tard », plus rien dans l'application ne disait
 * qu'il restait quelque chose à accepter. `readPendingInvites` existait pour ça et
 * n'avait aucun appelant de production : la fonction était là, la surface non.
 */
describe('readPendingInvites — la liste que l’écran des réglages affiche', () => {
  it('rend TOUTES les invitations vivantes, la plus récente en tête', async () => {
    installWindow('/');
    const { setPendingInvite, readPendingInvites } = await bootModule();
    setPendingInvite({ kind: 'org', token: TOKEN });
    setPendingInvite({ kind: 'vault', token: OTHER_TOKEN, vaultId: VAULT });

    const all = readPendingInvites();
    expect(all).toHaveLength(2);
    expect(all[0].token).toBe(OTHER_TOKEN);
    expect(all[1].token).toBe(TOKEN);
  });

  it('reprendre une invitation la remet en tête, donc à l’écran', async () => {
    installWindow('/');
    const { setPendingInvite, readPendingInvites, readPendingInvite } = await bootModule();
    const first = { kind: 'org' as const, token: TOKEN };
    setPendingInvite(first);
    setPendingInvite({ kind: 'vault', token: OTHER_TOKEN, vaultId: VAULT });
    expect(readPendingInvite()?.token).toBe(OTHER_TOKEN);

    setPendingInvite(first); // « Reprendre »

    expect(readPendingInvite()?.token).toBe(TOKEN);
    expect(readPendingInvites()).toHaveLength(2); // et l'autre est toujours là
  });
});
