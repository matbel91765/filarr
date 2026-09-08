/**
 * Invitation en attente — captation du lien profond, conservation, restitution.
 *
 * POURQUOI UN IMPORT À EFFET DE BORD ET PAS UN useEffect. Le lien d'invitation
 * arrive sur `https://app.filarr.com/invite?token=…`, et l'application ne peut
 * pas le lire depuis son routeur : App.tsx monte un HashRouter (qui ne regarde
 * que `location.hash`) et il n'est monté qu'APRÈS la sélection de profil. Il
 * faut donc lire l'URL avant tout le reste — avant redux-persist, avant le
 * premier rendu, et surtout avant les `location.reload()` que sèment le
 * changement de profil et le verrouillage. Un effet React serait aussi joué
 * deux fois sous StrictMode : la seconde lecture ne trouverait plus rien,
 * l'URL ayant déjà été nettoyée.
 *
 * POURQUOI localStorage ET PAS sessionStorage. Le porteur doit traverser le
 * DÉTOUR DE VÉRIFICATION D'E-MAIL, qui n'est pas un rechargement mais une
 * fermeture d'onglet : `POST /auth/register` ne rend aucun jeton et
 * `POST /auth/login` refuse tant que l'adresse n'est pas vérifiée, si bien qu'un
 * invité sans compte DOIT quitter la page pour aller cliquer dans sa boîte mail.
 * sessionStorage meurt avec l'onglet — l'invitation mourait donc précisément
 * dans le seul parcours qui l'oblige à survivre. sessionStorage reste écrit en
 * second, pour les navigateurs qui refusent le stockage durable.
 * `profileStorage` ne convient toujours pas : il préfixe ses clés par
 * `p:<profileId>:` et aucun profil n'est actif à l'instant de la captation.
 *
 * UNE GARDE vient avec la durabilité, parce qu'un porteur qui ne meurt plus tout
 * seul doit mourir autrement : la PÉREMPTION, calée sur la durée de vie du jeton
 * côté Worker (7 jours, `INVITATION_TTL_MS` dans org.ts et `VAULT_INVITE_TTL_MS`
 * dans vaults.ts). Garder le porteur plus longtemps que ce qu'il transporte,
 * c'est promettre un écran qui ne peut plus aboutir.
 *
 * CE QUI N'EST PAS UNE GARDE : le compte connecté. localStorage est bien partagé
 * par tous les comptes du même navigateur, et une invitation ne doit pas être
 * PROPOSÉE à quelqu'un d'autre que son destinataire — mais c'est l'ADRESSE
 * INVITÉE qui le dit (`isForAnotherAccount`, comparée à l'aperçu public), pas
 * l'ordre des connexions. Lier le porteur au premier compte qui le voyait, puis
 * l'effacer au suivant, détruisait l'invitation dans le parcours que l'écran
 * prescrit lui-même : « déconnectez-vous, puis reconnectez-vous avec l'adresse
 * qui l'a reçue » se terminait par la disparition de l'invitation à la
 * reconnexion. Et un refus du serveur ne brûle plus rien : seule une invitation
 * déclarée MORTE par le serveur fait effacer le jeton (`isDeadInviteError`).
 *
 * POURQUOI UNE LISTE ET PAS UN SEUL PORTEUR. « Le dernier qui arrive gagne »
 * détruisait en silence une invitation VIVANTE, et pas dans un cas exotique :
 * c'est le cas nominal du produit. Un hôte qui partage deux coffres envoie deux
 * e-mails ; on les ouvre l'un après l'autre, et le second effaçait le premier
 * avant même que l'écran d'acceptation n'ait été monté. Les invitations sont
 * donc rangées par IDENTITÉ (nature + coffre + jeton), la plus récemment ouverte
 * en tête — c'est celle que l'utilisateur vient de demander — et régler l'une
 * n'efface qu'elle : la suivante prend sa place aussitôt.
 *
 * Ce module ne doit RIEN importer : il s'exécute avant le store, l'i18n et le
 * client HTTP.
 */

export type PendingInviteKind = 'org' | 'vault';

export interface PendingInvite {
  /** 'org' = invitation d'espace (étape 1) ; 'vault' = invitation à un coffre (étape 2). */
  kind: PendingInviteKind;
  token: string;
  /** Coffre visé (invitation de coffre uniquement). */
  vaultId?: string;
  /**
   * Locataire de l'HÔTE. Absent des e-mails partis avant que le Worker ne
   * l'ajoute au lien : la jointure doit alors sonder les locataires connus.
   */
  orgId?: string;
  /**
   * Jeton NU, recopié à la main plutôt qu'ouvert depuis un lien.
   *
   * Les deux sortes de jeton sont indiscernables (même alphabet, même longueur)
   * et seul le lien porte l'identifiant du coffre : un code seul ne peut donc
   * être présenté qu'à la route des ESPACES. Le marquer permet de dire la vérité
   * quand le serveur répond « inconnu » — c'est peut-être un code de COFFRE,
   * auquel cas « invitation retirée » serait faux, et terminal.
   */
  bare?: boolean;
}

/** Ce que le stockage porte réellement, en plus de l'invitation elle-même. */
interface StoredInvite extends PendingInvite {
  /** Instant de captation : sans lui, rien ne peut périmer un porteur durable. */
  savedAt: number;
  /**
   * Les comptes qui ont demandé à ne plus VOIR cette invitation — en condensat,
   * jamais en clair (voir `accountDigest`). Ne touche pas au jeton : l'invitation
   * reste entière pour son destinataire, seul l'écran se tait pour les autres.
   */
  mutedFor?: string[];
}

const STORAGE_KEY = 'filarr.pending-invite';

/** Calé sur le Worker : org.ts INVITATION_TTL_MS === vaults.ts VAULT_INVITE_TTL_MS. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Combien d'invitations vivantes on accepte de garder de front.
 *
 * POURQUOI UNE BORNE. Le porteur est durable et n'a plus de fin naturelle autre
 * que la péremption : sans plafond, n'importe quelle page pourrait empiler des
 * liens et se servir du stockage du navigateur comme d'un dépôt sans fin. Cinq
 * couvre très largement le cas réel — un hôte qui partage plusieurs coffres
 * envoie un e-mail par coffre — et au-delà c'est la PLUS ANCIENNE qui cède, la
 * plus proche de périmer d'elle-même.
 */
const MAX_PENDING_INVITES = 5;

/** Jetons du Worker : 64 caractères hexadécimaux. La borne reste large pour
 *  ne pas rejeter un futur jeton base64url. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,512}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Copie mémoire : Safari en navigation privée et les navigateurs à cookies
 * bloqués font jeter les deux stockages. Perdre le jeton là serait perdre
 * l'invitation ; la copie mémoire tient au moins jusqu'au premier rechargement.
 */
let memoryCopy: StoredInvite[] = [];

type Listener = (invite: PendingInvite | null) => void;
const listeners = new Set<Listener>();

/**
 * Les stockages à écrire, du plus durable au plus volatil. localStorage
 * d'abord : c'est lui qui traverse la fermeture d'onglet du détour de
 * vérification d'e-mail. Un stockage qui jette à la simple lecture de la
 * propriété (contexte restreint) est simplement absent de la liste.
 */
function stores(): Storage[] {
  const found: Storage[] = [];
  if (typeof window === 'undefined') return found;
  try {
    if (window.localStorage) found.push(window.localStorage);
  } catch {
    /* stockage durable refusé */
  }
  try {
    if (window.sessionStorage) found.push(window.sessionStorage);
  } catch {
    /* stockage de session refusé */
  }
  return found;
}

function isValid(value: unknown): value is PendingInvite {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'org' && v.kind !== 'vault') return false;
  if (typeof v.token !== 'string' || !TOKEN_RE.test(v.token)) return false;
  if (v.kind === 'vault' && (typeof v.vaultId !== 'string' || !ID_RE.test(v.vaultId))) return false;
  if (v.orgId !== undefined && (typeof v.orgId !== 'string' || !ID_RE.test(v.orgId))) return false;
  if (v.bare !== undefined && typeof v.bare !== 'boolean') return false;
  if (
    v.mutedFor !== undefined &&
    (!Array.isArray(v.mutedFor) || v.mutedFor.some((m) => typeof m !== 'string'))
  ) {
    return false;
  }
  return true;
}

/**
 * L'IDENTITÉ d'une invitation : ce qui distingue deux liens reçus.
 *
 * Le jeton suffirait presque, mais deux natures d'invitation portent le même
 * alphabet et la même longueur ; le coffre entre donc dans la clé pour qu'une
 * même chaîne recopiée à la main puis rouverte par son lien complet ne se
 * fasse pas passer pour l'entrée déjà rangée.
 */
function inviteIdentity(invite: PendingInvite): string {
  return `${invite.kind}:${invite.vaultId ?? ''}:${invite.token}`;
}

/**
 * Un condensat court et STABLE de l'adresse d'un compte, pour la mise en
 * sourdine. FNV-1a : ce n'est pas une garantie cryptographique et ça n'a pas à
 * en être une — c'est une CLÉ, pas un secret. Ce qu'on refuse, c'est d'écrire
 * l'adresse d'un compte en clair dans un stockage partagé par tous les comptes
 * du poste : le porteur ne doit rien apprendre à qui le lit.
 */
function accountDigest(account: string): string {
  let hash = 0x811c9dc5;
  const normalized = account.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** L'invitation seule, sans les champs de tenue de registre. */
function publicPart(stored: StoredInvite): PendingInvite {
  const { savedAt: _savedAt, mutedFor: _mutedFor, ...invite } = stored;
  return invite;
}

function notify(invite: PendingInvite | null): void {
  for (const listener of [...listeners]) {
    try {
      listener(invite);
    } catch {
      /* un abonné qui jette ne doit pas priver les autres de l'invitation */
    }
  }
}

/**
 * Lit un lien d'invitation, ou un jeton nu collé à la main.
 *
 * Un `vault`/`org` non conforme est IGNORÉ plutôt que rejeté : le jeton reste
 * l'autorité côté serveur, et la jointure sait retomber sur un sondage des
 * locataires connus. Refuser tout le lien pour un paramètre abîmé priverait
 * l'utilisateur du seul chemin dont il dispose.
 */
export function parseInviteLink(raw: string): PendingInvite | null {
  const input = (raw ?? '').trim();
  if (!input) return null;

  // Jeton nu : seule l'invitation d'ESPACE est joignable ainsi — une invitation
  // de coffre a besoin de l'identifiant du coffre, qui n'est que dans le lien.
  // `bare` retient cette HYPOTHÈSE, pour que le refus puisse la nommer.
  if (TOKEN_RE.test(input) && !input.includes('/')) {
    return { kind: 'org', token: input, bare: true };
  }

  let url: URL;
  try {
    url = new URL(input, 'https://placeholder.invalid');
  } catch {
    return null;
  }

  const path = url.pathname.replace(/\/+$/, '');
  const token = url.searchParams.get('token') ?? '';
  if (!TOKEN_RE.test(token)) return null;

  const orgId = url.searchParams.get('org') ?? undefined;
  const cleanOrg = orgId && ID_RE.test(orgId) ? orgId : undefined;

  if (path.endsWith('/vault-invite')) {
    const vaultId = url.searchParams.get('vault') ?? '';
    if (!ID_RE.test(vaultId)) return null;
    return { kind: 'vault', token, vaultId, orgId: cleanOrg };
  }
  if (path.endsWith('/invite')) {
    return { kind: 'org', token, orgId: cleanOrg };
  }
  return null;
}

function removeEverywhere(): void {
  for (const store of stores()) {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      /* stockage indisponible */
    }
  }
}

/** Ne garde que les entrées lisibles et encore vivantes, l'ordre préservé. */
function sanitize(entries: unknown[]): StoredInvite[] {
  const kept: StoredInvite[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isValid(entry)) continue;
    const stored = entry as StoredInvite;
    const savedAt = typeof stored.savedAt === 'number' ? stored.savedAt : 0;
    // Un porteur plus vieux que le jeton qu'il transporte ne peut plus mener
    // qu'à un refus : l'effacer vaut mieux que rouvrir la modale pour rien.
    if (Date.now() - savedAt > INVITE_TTL_MS) continue;
    const id = inviteIdentity(stored);
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push({ ...stored, savedAt });
    if (kept.length >= MAX_PENDING_INVITES) break;
  }
  return kept;
}

/**
 * Les invitations rangées, la plus récemment ouverte en tête.
 *
 * Une entrée de l'ANCIENNE forme (un seul objet, avant la liste) est relue comme
 * une liste d'un élément : une invitation captée par la version précédente ne
 * doit pas disparaître à la mise à jour.
 */
function readStoredList(): StoredInvite[] {
  for (const store of stores()) {
    let raw: string | null = null;
    try {
      raw = store.getItem(STORAGE_KEY);
    } catch {
      continue;
    }
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      removeEverywhere(); // entrée abîmée : ne pas la relire à chaque montage
      return memoryCopy;
    }
    const list = sanitize(Array.isArray(parsed) ? parsed : [parsed]);
    if (list.length === 0) {
      removeEverywhere();
      // Une entrée illisible ne dit rien de la copie mémoire, qui peut porter
      // une invitation captée dans un stockage hostile ; une entrée PÉRIMÉE, si.
      memoryCopy = memoryCopy.filter((m) => Date.now() - m.savedAt <= INVITE_TTL_MS);
      return memoryCopy;
    }
    // La purge (péremption, doublons, débordement) est réécrite tout de suite :
    // sans quoi elle est refaite à chaque lecture, et le plafond ne borne rien.
    if (!Array.isArray(parsed) || list.length !== parsed.length) persist(list);
    else memoryCopy = list;
    return list;
  }
  return memoryCopy;
}

/**
 * L'invitation à PROPOSER, ou `null`.
 *
 * `forAccount` retire de la course celles que ce compte-ci a mises en sourdine :
 * sur un poste partagé, l'invitation d'un autre ne doit pas revenir à chaque
 * démarrage. Omettre le paramètre ne filtre rien — c'est ce que fait la
 * livraison aux abonnés, qui ne connaît aucun compte.
 */
export function readPendingInvite(forAccount?: string | null): PendingInvite | null {
  const digest = forAccount ? accountDigest(forAccount) : null;
  const found = readStoredList().find((i) => !digest || !i.mutedFor?.includes(digest));
  return found ? publicPart(found) : null;
}

/** Toutes les invitations en attente, la plus récente en tête. */
export function readPendingInvites(): PendingInvite[] {
  return readStoredList().map(publicPart);
}

function persist(list: StoredInvite[]): void {
  memoryCopy = list;
  if (list.length === 0) {
    removeEverywhere();
    return;
  }
  const serialized = JSON.stringify(list);
  for (const store of stores()) {
    try {
      store.setItem(STORAGE_KEY, serialized);
    } catch {
      /* la copie mémoire reste */
    }
  }
}

/**
 * Applique une modification en RELISANT le stockage juste avant d'écrire.
 *
 * POURQUOI. Chaque mutation était un lire-modifier-écrire sur un instantané pris
 * à son début. Deux onglets ouverts coup sur coup — le cas nominal, un hôte qui
 * partage deux coffres envoie deux e-mails — écrivaient chacun leur liste par
 * dessus l'autre, et la première invitation disparaissait sans un mot. Relire au
 * dernier moment fait que chaque onglet part de ce que l'autre a réellement
 * rangé.
 *
 * Ce n'est PAS une transaction : `localStorage` n'en offre pas, et deux écritures
 * séparées de quelques microsecondes peuvent encore se croiser. Le geste humain
 * qu'on protège se compte en secondes, donc la fenêtre restante est théorique —
 * mais elle existe, et l'écouteur `storage` ci-dessous est ce qui la rattrape à
 * l'affichage.
 */
function mutate(transform: (current: StoredInvite[]) => StoredInvite[]): void {
  persist(transform(readStoredList()).slice(0, MAX_PENDING_INVITES));
}

/**
 * Range une invitation SANS toucher aux autres.
 *
 * Réouvrir le même lien remet simplement l'entrée en tête, avec une date de
 * captation fraîche : c'est la même invitation, pas une seconde.
 *
 * `unmuteFor` LÈVE la sourdine de ce compte, et n'a de sens que pour un geste
 * EXPLICITE — coller le lien à la main. Sans lui, recoller son propre lien après
 * s'être trompé de compte au moment de la sourdine était un néant parfait : la
 * sourdine était reconduite, `readPendingInvite` écartait l'entrée, la fenêtre de
 * saisie se refermait et il ne se passait rien. La captation d'URL, elle, ne
 * passe pas ce drapeau : un lien rouvert depuis la boîte mail d'un autre ne doit
 * pas défaire un choix pris ici.
 */
export function setPendingInvite(
  invite: PendingInvite,
  options?: { unmuteFor?: string | null }
): void {
  if (!isValid(invite)) return;
  const id = inviteIdentity(invite);
  const lifted = options?.unmuteFor ? accountDigest(options.unmuteFor) : null;
  mutate((previous) => {
    const carried = previous.find((i) => inviteIdentity(i) === id);
    const mutedFor = (carried?.mutedFor ?? []).filter((d) => d !== lifted);
    return [
      {
        ...invite,
        savedAt: Date.now(),
        ...(mutedFor.length ? { mutedFor } : {}),
      },
      ...previous.filter((i) => inviteIdentity(i) !== id),
    ];
  });
  notify(readPendingInvite());
}

/**
 * Efface une invitation RÉGLÉE — celle-là et aucune autre.
 *
 * Sans argument, efface tout : c'est le geste explicite d'un appelant qui veut
 * repartir de zéro, pas la conséquence d'une acceptation. Une acceptation ne
 * peut rien affirmer des invitations qu'elle n'a pas présentées au serveur.
 */
export function clearPendingInvite(invite?: PendingInvite): void {
  if (!invite) {
    persist([]);
    notify(null);
    return;
  }
  const id = inviteIdentity(invite);
  mutate((current) => current.filter((i) => inviteIdentity(i) !== id));
  notify(readPendingInvite());
}

/**
 * Met une invitation en sourdine POUR CE COMPTE — sans jamais toucher au jeton.
 *
 * POURQUOI. Sur un poste partagé, l'invitation d'Alice était reproposée à Bob à
 * chaque démarrage, sans autre issue que d'attendre sept jours : la seule sortie
 * offerte, « Plus tard », ne survit pas au redémarrage, et effacer le jeton
 * aurait détruit l'invitation d'Alice. La sourdine sépare enfin les deux :
 * l'écran se tait pour Bob, l'invitation attend Alice.
 */
export function muteInviteForAccount(invite: PendingInvite, account: string | null): void {
  if (!account) return;
  const digest = accountDigest(account);
  const id = inviteIdentity(invite);
  mutate((current) =>
    current.map((i) =>
      inviteIdentity(i) === id && !i.mutedFor?.includes(digest)
        ? { ...i, mutedFor: [...(i.mutedFor ?? []), digest] }
        : i
    )
  );
  notify(readPendingInvite());
}

/**
 * S'abonne aux invitations en attente. L'abonné reçoit IMMÉDIATEMENT celle qui
 * dort déjà (même mécanique que la file d'ouvertures .filarr) : l'écran
 * d'acceptation n'est monté qu'après le déverrouillage, bien après la captation.
 *
 * Ce qui est livré est la TÊTE de la liste, sans filtrage de compte : ce module
 * n'en connaît aucun. À l'abonné, qui sait qui est connecté, de relire avec
 * `readPendingInvite(email)` — c'est aussi ce qui fait ressortir une invitation
 * mise de côté quand l'identité change.
 */
export function subscribePendingInvite(listener: Listener): () => void {
  listeners.add(listener);
  const current = readPendingInvite();
  if (current) {
    try {
      listener(current);
    } catch {
      /* ignore */
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Retire le jeton de la barre d'adresse, de l'historique et du referrer sortant.
 * Appelé UNIQUEMENT quand une invitation a été effectivement lue : sous Electron
 * l'URL est interne (`app://…`), rien n'y est jamais capté, donc rien n'y est
 * réécrit.
 */
function scrubLocation(): void {
  try {
    window.history?.replaceState?.(null, '', '/');
  } catch {
    /* history indisponible (contexte restreint) */
  }
}

/**
 * Un AUTRE onglet a rangé ou réglé une invitation : la copie mémoire d'ici est
 * périmée, et l'écran continuerait d'en proposer une déjà acceptée ailleurs — ou
 * d'ignorer celle qui vient d'arriver. L'événement `storage` n'est émis QUE vers
 * les autres onglets, donc il ne peut pas boucler sur nos propres écritures.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    // `localStorage` FAIT FOI : c'est le seul stockage que les deux onglets
    // partagent. La copie mémoire et le sessionStorage de CET onglet-ci portent
    // encore l'état que l'événement vient de démentir — les réaligner, sinon on
    // continuerait de proposer une invitation acceptée ailleurs.
    memoryCopy = [];
    let shared: unknown = null;
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      shared = raw ? JSON.parse(raw) : null;
    } catch {
      /* stockage durable indisponible ou entrée abîmée : on repart de rien */
    }
    persist(sanitize(Array.isArray(shared) ? shared : shared ? [shared] : []));
    notify(readPendingInvite());
  });
}

/** Lit l'URL courante, met l'invitation de côté et nettoie la barre d'adresse. */
export function captureInviteFromLocation(): PendingInvite | null {
  if (typeof window === 'undefined' || !window.location) return null;
  const { pathname, search } = window.location;
  const invite = parseInviteLink(`${pathname}${search}`);
  if (!invite) return null;
  setPendingInvite(invite);
  scrubLocation();
  return invite;
}

captureInviteFromLocation();
