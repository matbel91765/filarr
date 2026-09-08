/**
 * Clé de garde du compte — le pont du processus PRINCIPAL.
 *
 * Trois responsabilités, et rien d'autre :
 *
 *   1. RELAYER les routes du worker qui parlent de la clé de garde et des
 *      libellés scellés (le jeton porteur vit ici, pas dans le renderer) ;
 *   2. RANGER, sur demande EXPLICITE, la clé privée déverrouillée derrière le
 *      `safeStorage` d'Electron ;
 *   3. NE JAMAIS RIEN DÉCHIFFRER. Aucun sceau n'est ouvert ici, aucune KEK
 *      n'est dérivée ici — hormis l'Argon2 brut de `argon2Service`, qui rend
 *      des octets et ne les utilise pas.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE LE PRINCIPAL VOIT, ET CE QU'IL NE DOIT PAS VOIR
 * ════════════════════════════════════════════════════════════════════════
 * Le matériel de clé qui transite ici est CELUI DU SERVEUR : la publique en
 * clair (le serveur la voit aussi) et la privée EMBALLÉE (opaque, le serveur
 * la stocke telle quelle). Rien de neuf n'est exposé — c'est exactement ce
 * qu'un observateur du réseau obtiendrait.
 *
 * La privée DÉBALLÉE, elle, ne remonte ici que sur `rememberCustody`, c'est-
 * à-dire quand l'utilisateur a coché « se souvenir sur cet appareil ». Sans
 * cette case, elle ne quitte jamais la mémoire du renderer.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE COMPROMIS DE « SE SOUVENIR », DIT FRANCHEMENT
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'ON GAGNE : la liste des partages affiche les noms au lancement, sans
 * ressaisie. L'alternative honnête n'est pas « l'utilisateur retient mieux sa
 * phrase », c'est « l'utilisateur colle sa phrase dans un fichier texte ».
 *
 * CE QU'ON PERD : la privée existe AU REPOS sur la machine. `safeStorage` la
 * chiffre sous une clé du trousseau du système (DPAPI sous Windows, Keychain
 * sous macOS, libsecret sous Linux) — donc illisible par un autre compte
 * utilisateur, et illisible sur une autre machine. Elle reste lisible par tout
 * code s'exécutant SOUS CETTE SESSION UTILISATEUR, exactement comme les jetons
 * d'accès rangés juste à côté. C'est le même périmètre de confiance, pas un
 * nouveau.
 *
 * Trois garde-fous, tous vérifiés à la relecture et non à l'écriture :
 *   · un CONSENTEMENT QUI EXPIRE (14 jours, comme le site et le mobile) ;
 *   · une GARDE D'IDENTITÉ : l'entrée porte la publique du compte au moment de
 *     l'enregistrement, et une publique différente la DÉTRUIT au lieu de la
 *     servir — une privée qui n'ouvre plus rien n'a aucune raison de traîner ;
 *   · la DÉCONNEXION l'emporte (cf. `authService.logout`), comme les jetons.
 *
 * Le fichier vit dans le dossier d'auth du domaine ACTIF (`getAuthBasePath`) :
 * même profil, même domaine d'attente que les jetons. Un fichier global
 * servirait la clé du compte précédent après un changement de profil.
 */

import log from 'electron-log';
import { promises as fs } from 'fs';
import path from 'path';
import { safeStorage } from 'electron';

import { authenticatedApiCall, getAuthBasePath } from './authService';

const REMEMBER_FILE = '.custody_session.safe';

/** Durée du consentement — la même que le site et le mobile. */
export const CUSTODY_REMEMBER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Plafond du consentement demandable. Un appel ne peut pas s'auto-prolonger. */
const CUSTODY_REMEMBER_MAX_TTL_MS = CUSTODY_REMEMBER_TTL_MS;

// ── Types du contrat ────────────────────────────────────────────────────

/** Matériel de clé tel que `GET /account/custody-key` le rend. */
export interface CustodyKeyMaterial {
  custodyPublicKey: string;
  wrappedPrivateKey: string;
  kdfSalt: string;
  kdfScheme?: string;
}

/** Un libellé scellé, tel qu'il vient du listing du compte. */
export interface ShareLabelRow {
  id: string;
  /** Blob scellé base64, ou `null` quand rien n'est posé. */
  wrappedLabel: string | null;
}

export interface ShareLabelListing {
  /** Envois du COMPTE — table `ephemeral_shares`, créés sur filarr.com. */
  sends: ShareLabelRow[];
  /** Envois de l'APPLICATION — table `shares`, créés par POST /sync/share. */
  appSends: ShareLabelRow[];
  /** Demandes de fichiers du compte. */
  requests: ShareLabelRow[];
  /**
   * LE SERVEUR SAIT-IL RANGER LE LIBELLÉ D'UN PARTAGE D'ORIGINE APP ?
   *
   * Ce qu'on peut affirmer : `appSends[]` existe et ses lignes portent le champ
   * `wrapped_label`. C'est le signe que le worker est au moins à la version qui
   * connaît la colonne — avant elle, `appSends` n'existait pas du tout et le
   * PATCH ne visait que `ephemeral_shares`.
   *
   * CE QUE ÇA NE PROUVE PAS, et le commentaire du mobile le dit trop fort : le
   * worker NORMALISE une colonne absente à `null` (`listAppSends`, repli
   * gradué). Un worker déployé AVANT sa migration 0090 rend donc le champ à
   * `null` sans savoir l'écrire. Ce résidu se voit à l'écriture, en 404, et
   * l'appelant le traite comme tel (`not-found`) — c'est pour ça que cette
   * raison existe. Le drapeau évite la promesse dans le cas MAJORITAIRE ; il ne
   * remplace pas la gestion du refus.
   */
  serverKnowsAppLabels: boolean;
}

type Result<T> = { success: true; data: T } | { success: false; error: string };

// ── Routes du worker ────────────────────────────────────────────────────

/**
 * Matériel COMPLET de la clé de garde du compte, ou `null` quand le serveur
 * AFFIRME qu'il n'y en a pas.
 *
 * `share:custodyKey` existait déjà mais ne rend que la PUBLIQUE : elle suffit à
 * sceller, jamais à ouvrir. Celui-ci rend en plus la privée emballée et son
 * sel, sans quoi aucun déverrouillage n'est possible sur cette machine.
 *
 * Un 404 vaut la même affirmation qu'un `data: null` : le compte n'a rien.
 * Tout le reste (panne, 5xx, 401) est un ÉCHEC et le dit — confondre « pas de
 * clé » et « je n'ai pas pu demander » ferait afficher « ce compte n'a pas de
 * coffre » sur une coupure réseau.
 */
export async function getCustodyKeyMaterial(): Promise<Result<CustodyKeyMaterial | null>> {
  const res = await authenticatedApiCall<CustodyKeyMaterial | null>('/account/custody-key', {
    method: 'GET',
  });
  if (!res.success) {
    if (res.httpStatus === 404) return { success: true, data: null };
    log.warn('[custodyService] getCustodyKeyMaterial failed:', res.error);
    return { success: false, error: res.error || 'Failed to read custody key' };
  }
  const d = res.data;
  if (!d || typeof d !== 'object' || typeof d.custodyPublicKey !== 'string') {
    return { success: true, data: null };
  }
  return { success: true, data: d };
}

interface AccountSharesEnvelope {
  sends?: { id?: unknown; wrapped_label?: unknown }[];
  appSends?: { id?: unknown; wrapped_label?: unknown }[];
  requests?: { id?: unknown; wrapped_label?: unknown }[];
}

function toLabelRows(rows: { id?: unknown; wrapped_label?: unknown }[] | undefined): ShareLabelRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ShareLabelRow[] = [];
  for (const r of rows) {
    if (typeof r?.id !== 'string' || r.id.length === 0) continue;
    out.push({
      id: r.id,
      wrappedLabel: typeof r.wrapped_label === 'string' && r.wrapped_label.length > 0
        ? r.wrapped_label
        : null,
    });
  }
  return out;
}

/**
 * Libellés scellés de TOUS les partages du compte.
 *
 * POURQUOI `/account/shares` ET NON `/sync/share`, que la liste du bureau
 * interroge déjà : parce que `/sync/share` ne rend PAS `wrapped_label`. Sa
 * requête énumère ses colonnes une à une et la nouvelle n'y est pas. Le champ
 * n'existe que dans le listing du COMPTE, où `listAppSends` le sert pour les
 * partages d'origine app et où `ephemeral_shares` le sert pour les envois du
 * site. Un appel de plus, donc, plutôt qu'un champ ajouté à une route qu'il
 * faudrait déployer.
 *
 * Ne LÈVE jamais sur une liste manquante : un compte sans envoi rend des
 * tableaux vides, et une panne rend un échec explicite que l'écran traduit en
 * « noms indisponibles », jamais en « aucun nom ».
 */
export async function listShareLabels(): Promise<Result<ShareLabelListing>> {
  const res = await authenticatedApiCall<AccountSharesEnvelope>('/account/shares', {
    method: 'GET',
  });
  if (!res.success || !res.data) {
    log.warn('[custodyService] listShareLabels failed:', res.error);
    return { success: false, error: res.error || 'Failed to list share labels' };
  }
  const appSendsRaw = res.data.appSends;
  // Le champ doit être PRÉSENT dans la forme rendue — `null` compris. Un
  // worker d'avant `appSends` n'a pas le tableau du tout ; un worker qui l'a
  // sert toujours la clé, même quand la colonne manque encore.
  const serverKnowsAppLabels =
    Array.isArray(appSendsRaw) &&
    (appSendsRaw.length === 0 || appSendsRaw.some((r) => r != null && 'wrapped_label' in r));
  return {
    success: true,
    data: {
      sends: toLabelRows(res.data.sends),
      appSends: toLabelRows(appSendsRaw),
      requests: toLabelRows(res.data.requests),
      serverKnowsAppLabels,
    },
  };
}

export type ShareKind = 'send' | 'request';

export type SetShareLabelOutcome =
  | { success: true; data: 'saved' }
  /** Le serveur ne connaît pas cet identifiant — ou pas cette colonne. */
  | { success: true; data: 'not-found' }
  | { success: false; error: string };

/**
 * Pose (ou efface) le libellé scellé d'un partage.
 *
 * `null` efface, comme `''` côté worker — on envoie `null`, la seule des deux
 * formes qui se distingue d'un blob vide par accident.
 *
 * LE 404 N'EST PAS UNE PANNE, et c'est tout l'intérêt de le nommer : il
 * signifie « ce serveur ne sait pas ranger ce libellé-là » (partage inconnu,
 * ou colonne pas encore migrée). L'écran doit alors dire « enregistré sur cet
 * appareil » plutôt que « on réessaiera » — la seconde phrase est un mensonge
 * quand rien ne changera au prochain essai.
 */
export async function setShareLabel(
  kind: ShareKind,
  shareId: string,
  wrappedLabel: string | null
): Promise<SetShareLabelOutcome> {
  const segment = kind === 'send' ? 'sends' : 'requests';
  const res = await authenticatedApiCall<unknown>(
    `/account/${segment}/${encodeURIComponent(shareId)}`,
    { method: 'PATCH', body: JSON.stringify({ wrappedLabel }) }
  );
  if (res.success) return { success: true, data: 'saved' };
  if (res.httpStatus === 404) return { success: true, data: 'not-found' };
  return { success: false, error: res.error || 'Failed to save label' };
}

// ── « Se souvenir sur cet appareil » ────────────────────────────────────

interface RememberedCustody {
  /** Publique du compte à l'enregistrement — la garde d'identité. */
  pub: string;
  /** Privée X25519 (32 octets), base64. */
  priv: string;
  /** Fin du consentement (epoch ms). */
  exp: number;
}

function rememberPath(): string {
  return path.join(getAuthBasePath(), REMEMBER_FILE);
}

function isRemembered(value: unknown): value is RememberedCustody {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<RememberedCustody>;
  return (
    typeof v.pub === 'string' &&
    v.pub.length > 0 &&
    typeof v.priv === 'string' &&
    v.priv.length > 0 &&
    typeof v.exp === 'number' &&
    Number.isFinite(v.exp)
  );
}

/**
 * Range la privée pour `ttlMs`. Rend `false` sans jamais lever : un échec
 * d'écriture ne doit pas transformer un déverrouillage RÉUSSI en erreur — la
 * session en mémoire du renderer, elle, est intacte.
 *
 * REFUSE quand `safeStorage` n'est pas disponible (Linux sans trousseau,
 * session distante). Écrire la privée en clair « pour que ça marche quand
 * même » serait la seule vraie faute possible ici : l'utilisateur a coché une
 * case qui promet un chiffrement, pas un fichier lisible.
 */
export async function rememberCustody(input: {
  custodyPublicKey: string;
  privateKeyBase64: string;
  ttlMs?: number;
}): Promise<boolean> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (
      typeof input?.custodyPublicKey !== 'string' ||
      input.custodyPublicKey.length === 0 ||
      typeof input?.privateKeyBase64 !== 'string' ||
      input.privateKeyBase64.length === 0
    ) {
      return false;
    }
    const ttl = Math.min(
      Math.max(1, Number(input.ttlMs) || CUSTODY_REMEMBER_TTL_MS),
      CUSTODY_REMEMBER_MAX_TTL_MS
    );
    const record: RememberedCustody = {
      pub: input.custodyPublicKey,
      priv: input.privateKeyBase64,
      exp: Date.now() + ttl,
    };
    const file = rememberPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, safeStorage.encryptString(JSON.stringify(record)), { mode: 0o600 });
    return true;
  } catch (err) {
    log.warn('[custodyService] rememberCustody failed:', err);
    return false;
  }
}

export type RecallOutcome =
  /** Rien de rangé (ou échu, et l'entrée a été détruite). */
  | { status: 'absent' }
  /** La mémoire ne correspond plus à ce compte : elle a été détruite. */
  | { status: 'mismatch' }
  /** La privée, base64. À charge du renderer de la déballer en mémoire. */
  | { status: 'restored'; privateKeyBase64: string };

/**
 * Relit la mémoire pour la clé que le SERVEUR vient d'annoncer — c'est elle
 * qui fait autorité. Une mémoire d'une autre publique n'ouvre plus rien : elle
 * est DÉTRUITE plutôt que rendue.
 */
export async function recallCustody(custodyPublicKey: string): Promise<RecallOutcome> {
  let record: RememberedCustody;
  try {
    if (!safeStorage.isEncryptionAvailable()) return { status: 'absent' };
    const encrypted = await fs.readFile(rememberPath());
    const parsed: unknown = JSON.parse(safeStorage.decryptString(encrypted));
    if (!isRemembered(parsed)) {
      await clearRememberedCustody();
      return { status: 'absent' };
    }
    record = parsed;
  } catch {
    // Fichier absent, trousseau changé, JSON abîmé : dans tous les cas il n'y
    // a rien d'utilisable, et rien à signaler à l'utilisateur — il ressaisit.
    return { status: 'absent' };
  }
  if (record.exp <= Date.now()) {
    await clearRememberedCustody();
    return { status: 'absent' };
  }
  if (record.pub !== custodyPublicKey) {
    await clearRememberedCustody();
    return { status: 'mismatch' };
  }
  return { status: 'restored', privateKeyBase64: record.priv };
}

export interface RememberStatus {
  /** Vrai quand la machine sait chiffrer : sinon l'option ne doit pas être offerte. */
  available: boolean;
  /** Vrai quand une mémoire NON ÉCHUE existe. */
  remembered: boolean;
  /** Échéance du consentement (epoch ms), ou `null`. */
  expiresAt: number | null;
}

/**
 * État de l'option, SANS jamais rendre la clé. C'est ce que lit l'interrupteur
 * des réglages : lui servir `recallCustody` ferait passer la privée par l'IPC
 * pour peindre une case à cocher.
 */
export async function rememberedCustodyStatus(): Promise<RememberStatus> {
  const available = (() => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  })();
  if (!available) return { available: false, remembered: false, expiresAt: null };
  try {
    const encrypted = await fs.readFile(rememberPath());
    const parsed: unknown = JSON.parse(safeStorage.decryptString(encrypted));
    if (!isRemembered(parsed) || parsed.exp <= Date.now()) {
      await clearRememberedCustody();
      return { available: true, remembered: false, expiresAt: null };
    }
    return { available: true, remembered: true, expiresAt: parsed.exp };
  } catch {
    return { available: true, remembered: false, expiresAt: null };
  }
}

/**
 * Efface la mémoire — bouton « oublier », déconnexion, garde d'identité en
 * échec. Ne lève jamais : au pire l'entrée survit jusqu'à son échéance, et la
 * garde d'identité la refusera si le compte a changé.
 */
export async function clearRememberedCustody(): Promise<void> {
  await fs.unlink(rememberPath()).catch(() => {});
}
