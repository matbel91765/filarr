/**
 * vaultApi.ts (E3-3b) — thin HTTP layer for the shared-vault worker endpoints.
 *
 * Uses the authenticated renderer apiClient (Bearer + X-Org-Id interceptors, so
 * every call is org-scoped to the active org). Returns the opaque server DTOs;
 * all crypto (unwrap K_vault / K_item, decrypt name / meta / chunks) happens in
 * the slice via vaultCrypto + vaultKeyCache — the server only ever sees ciphertext.
 */

import apiClient from '../network/apiClient';
import { UNKNOWN_FAILURE_CODE } from './vaultErrorMessages';
import type { KeyLogEntry } from './keyTransparency';

export interface ServerVaultDTO {
  id: string;
  organizationId: string;
  ownerUserId: string | null;
  nameEncrypted: string;
  nameIv: string;
  currentKeyEpoch: number;
  role: string;
  wrappedVaultKey: string;
  wrappedVaultKeyEpoch: number;
  createdAt: string;
  /** Renseigné uniquement par la corbeille : date de suppression. */
  deletedAt?: string | null;
  /**
   * Une conservation légale est-elle en cours sur ce coffre (F19) ?
   *
   * SERVI PAR `GET /vaults/:id` SEULEMENT, et au rang admin SEULEMENT — jamais
   * par la LISTE. Absent ne vaut donc pas `false` : c'est « on ne sait pas »,
   * soit parce qu'on est en dessous du rang, soit parce que la donnée vient de
   * la liste. Les trois routes qui la font respecter (`delete`, `purge`, `PUT`)
   * répondent `legal_hold_active` de toute façon ; ce booléen ne sert qu'à
   * l'ANNONCER avant le clic plutôt qu'après.
   */
  legalHold?: boolean;
  /**
   * LE GEL (F23), RENDU À TOUT MEMBRE — contrairement à `legalHold`.
   *
   * L'écart n'est pas un oubli. Une conservation légale est un fait de
   * GOUVERNANCE, décidé hors du coffre et souvent confidentiel ; le gel est un
   * fait du COFFRE, que tous ses membres subissent à la seconde où il est posé
   * — leurs boutons d'écriture disparaissent, leurs enregistrements sont
   * refusés (409 `vault_frozen`). Le leur cacher ne protégerait rien : cela
   * transformerait un archivage volontaire en panne inexplicable.
   *
   * `undefined` sur un worker d'avant 0079 ; `null` veut dire « pas gelé », et
   * c'est le serveur qui le dit explicitement (`?? null` dans `toVaultDTO`)
   * plutôt que d'omettre la clé — une colonne oubliée dans un SELECT se lirait
   * sinon comme un coffre vivant.
   *
   * `frozenBy` est un identifiant OPAQUE, jamais une adresse : l'écran le
   * résout par le trombinoscope, comme partout ailleurs.
   */
  frozenAt?: string | null;
  frozenBy?: string | null;
  /**
   * QUI M'A FAIT ENTRER DANS CE COFFRE — mon adhésion à moi, jamais celle d'un
   * autre membre (le Worker ne projette que la ligne du demandeur).
   *
   * Depuis l'ajout direct (F06), on peut devenir membre sans avoir rien
   * accepté : le bandeau d'accueil annonce « X vous a donné accès à… », et il
   * lui faut un X. UN IDENTIFIANT OPAQUE, jamais une adresse : l'écran la
   * résout par le trombinoscope (`GET /vaults/:id/members`, qui la porte),
   * comme pour `frozenBy`. Absent sur un worker antérieur — la phrase se passe
   * alors de nom plutôt que d'en deviner un.
   */
  invitedBy?: string | null;
}

/** Un coffre à la corbeille, avec la date au-delà de laquelle il n'y sera plus. */
export interface DeletedVaultDTO extends ServerVaultDTO {
  restorableUntil: string | null;
}

export interface ServerVaultItemDTO {
  id: string;
  vaultId: string;
  ownerUserId: string | null;
  itemType: string;
  wrappedItemKey: string;
  wrappedUnderEpoch: number;
  encryptedMeta: string;
  encryptedMetaIv: string;
  totalChunks: number;
  sizeBytes: number;
  status: string;
  /** Optimistic-concurrency counter — echo it back as `expectedVersion` to update. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * The Worker's machine-readable `code` from a failed response. Axios flattens a
 * non-2xx into "Request failed with status code 409", which loses exactly the
 * part the UI needs to say something useful (a seat cap is not a network error).
 * Returns null when the failure carries no code (offline, 5xx, HTML gateway).
 */
export function serverErrorCode(e: unknown): string | null {
  const code = (e as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * A failure, reduced to ONE canonical code — the vocabulary VAULT_ERROR_KEYS speaks.
 *
 * WHY THIS EXISTS. "Check your connection" is the right sentence for exactly one of
 * the ways a vault call can fail, and the wrong one for every other: a plan that
 * doesn't include shared vaults, a space we were removed from, a Worker that threw.
 * Sending someone to reset their router because their subscription lapsed costs them
 * the one thing an error message is for. The server names its refusals with a `code`;
 * this recovers it, and when there is none, distinguishes the three remaining shapes
 * rather than collapsing them:
 *
 *   · a response with a status  → the server answered, so the network is FINE
 *   · an axios error with none  → nothing came back: DNS, TLS, timeout, offline
 *   · anything else             → our own thrown Error; not ours to classify (null),
 *                                 the caller's own fallback sentence is the honest one
 *
 * Returns null when no honest classification exists — never a guess.
 */
export function classifyVaultFailure(e: unknown): string | null {
  const code = serverErrorCode(e);
  if (code) return code;
  const err = e as { isAxiosError?: boolean; response?: { status?: number }; code?: unknown };
  // L'intercepteur de requête refuse LOCALEMENT une route authentifiée quand aucun
  // jeton n'a pu être obtenu — le rafraîchissement a échoué sur une panne, sans
  // détruire la session. Sans ce cas, la requête partait anonyme et son 401 se
  // lisait `session_expired`, TERMINAL : l'écran disait « reconnectez-vous » et
  // retirait « Réessayer », sur une coupure de quelques secondes.
  if (err?.code === 'network_unavailable') return 'network_unavailable';
  if (!err?.isAxiosError) return null;
  const status = err.response?.status;
  // No response object at all: the request never got an answer.
  if (typeof status !== 'number') return 'network_unavailable';
  if (status === 401) return 'session_expired';
  if (status === 403 || status === 404) {
    // Un 403/404 dont le CORPS n'est pas une enveloppe du Worker ne vient pas du
    // Worker : page de défi Cloudflare, règle WAF, requête mal routée vers un
    // domaine servi par Vercel. Le lire comme un refus d'autorisation ferait dire
    // « vous n'avez pas accès » à un incident d'infrastructure. Le corps absent
    // reste, lui, traité comme un refus : c'est la forme d'un 403 sans détail.
    const body = (e as { response?: { data?: unknown } }).response?.data;
    if (body !== undefined && body !== null && typeof body !== 'object') return 'server_error';
    // 403/404 with a Worker envelope but no code: refused, or scoped to a tenant
    // we're not in. Both mean "you don't have access here", which is a different
    // instruction from "retry".
    return 'org_forbidden';
  }
  if (status >= 500) return 'server_error';
  return null;
}

/**
 * Re-throw with the CANONICAL code as the message, so thunks can pass it upward.
 * Classification (not just `serverErrorCode`) so a request that never reached the
 * server arrives at the UI saying so, instead of borrowing the caller's fallback.
 */
function throwWithCode(e: unknown, fallback: string): never {
  throw new Error(classifyVaultFailure(e) ?? fallback);
}

// ── The shared space itself (tenant bootstrap) ───────────────────────────────

/** GET/POST /org/personal — the caller's personal space and what their plan allows. */
export interface PersonalSpaceDTO {
  /** Null only from the GET, for an account that has no space yet. */
  org: { id: string; name: string; isPersonal: boolean; status: string } | null;
  entitled: boolean;
  tier: string;
  memberLimit: number;
  /**
   * LES MEMBRES ACTIFS SEULS — ce n'est PAS l'occupation qui décide d'un refus
   * d'invitation. Celle-là compte aussi les invitations en attente et vit sur
   * `GET /vaults/seats` (`VaultSeatsDTO.membersUsed`). Aucun écran ne lit ce
   * champ-ci ; s'il en venait un jour un qui parle de sièges, c'est l'autre
   * qu'il doit lire — sans quoi il rejouerait le défaut du 30/08.
   */
  membersUsed: number;
}

/**
 * Provision (or simply return) the caller's personal space — the tenant every
 * shared-vault call is scoped to.
 *
 * IDEMPOTENT BY CONSTRUCTION, not by convention: the Worker reads before it inserts,
 * and a concurrent second INSERT is refused by the partial unique index on
 * (owner_user_id WHERE is_personal = 1), so the loser reads the winner's row. Calling
 * this on every cold start of the shared-vault screen creates at most one space, ever.
 *
 * The tier gate is the SERVER's: it reads `users.subscription_tier` (the column the
 * Stripe webhook maintains), never the JWT `tier` claim, which is a login-time
 * snapshot that stays stale for the life of the token after an upgrade or a downgrade.
 * A plan that doesn't include shared vaults comes back as 403 `upgrade_required`,
 * which is a sentence to show — not a failure to retry.
 */
export async function apiEnsurePersonalSpace(): Promise<PersonalSpaceDTO> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<PersonalSpaceDTO>>('/org/personal', {});
    if (!data.data?.org) throw new Error('shared_vault_no_context');
    return data.data;
  } catch (e) {
    throwWithCode(e, 'shared_vault_no_context');
  }
}

// ── Vaults ───────────────────────────────────────────────────────────────────

/**
 * The caller's vaults in ONE space. `orgId` names it explicitly because a user can
 * stand in several personal spaces (their own + every one they were invited into)
 * and this route lists a single tenant; the caller merges. Omit it to let the
 * ambient context decide (single-space user, or the Worker's own resolution).
 */
export async function apiListVaults(orgId?: string): Promise<ServerVaultDTO[]> {
  const { data } = await apiClient.get<ApiEnvelope<{ vaults: ServerVaultDTO[] }>>('/vaults', {
    headers: orgId ? { 'X-Org-Id': orgId } : undefined,
  });
  return data.data?.vaults ?? [];
}

/**
 * UN seul coffre, et la seule chose que la liste ne dit pas : `legalHold` (F19).
 *
 * POURQUOI CETTE ROUTE EN PLUS DE LA LISTE. `GET /vaults` sert tout ce dont
 * l'application a besoin en permanence, et la conservation légale n'en fait pas
 * partie : la calculer pour chaque coffre de chaque espace à chaque chargement
 * coûterait une requête par coffre pour une information qui ne concerne qu'un
 * écran. Elle est donc lue à l'ouverture de la page « Gérer le coffre », et là
 * seulement.
 */
export async function apiGetVault(vaultId: string): Promise<ServerVaultDTO | null> {
  try {
    const { data } = await apiClient.get<ApiEnvelope<{ vault: ServerVaultDTO }>>(
      `/vaults/${vaultId}`
    );
    return data.data?.vault ?? null;
  } catch {
    // COMPLÉMENT, JAMAIS CHEMIN CRITIQUE : la page vit déjà sur le résumé en
    // mémoire. Un échec ici laisse `legalHold` inconnu — donc rien d'affirmé —
    // au lieu de faire échouer un onglet entier.
    return null;
  }
}

export async function apiCreateVault(body: {
  nameEncrypted: string;
  nameIv: string;
  wrappedVaultKey: string;
}): Promise<ServerVaultDTO> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<{ vault: ServerVaultDTO }>>('/vaults', body);
    if (!data.data?.vault) throw new Error(data.error ?? 'Vault creation failed');
    return data.data.vault;
  } catch (e) {
    // `upgrade_required` / `org_required` must reach the UI as themselves.
    throwWithCode(e, (e as Error)?.message ?? 'Vault creation failed');
  }
}

// ── Items ────────────────────────────────────────────────────────────────────

export async function apiListVaultItems(vaultId: string): Promise<ServerVaultItemDTO[]> {
  const { data } = await apiClient.get<ApiEnvelope<{ items: ServerVaultItemDTO[] }>>(
    `/vaults/${vaultId}/items`
  );
  return data.data?.items ?? [];
}

export async function apiCreateVaultItem(
  vaultId: string,
  body: {
    itemType: 'note' | 'file' | 'transclusion';
    wrappedItemKey: string;
    wrappedUnderEpoch: number;
    encryptedMeta: string;
    encryptedMetaIv: string;
    totalChunks: number;
    sizeBytes: number;
  }
): Promise<ServerVaultItemDTO> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<{ item: ServerVaultItemDTO }>>(
      `/vaults/${vaultId}/items`,
      body
    );
    if (!data.data?.item) throw new Error(data.error ?? 'Item creation failed');
    return data.data.item;
  } catch (e) {
    // Le CODE doit survivre au transport : espace gelé, quota mutualisé plein,
    // plan de l'hôte arrêté, rôle insuffisant et panne réseau ont chacun une
    // phrase, et se réduisaient tous à « Impossible d'ajouter le fichier ».
    throwWithCode(e, 'item_create_failed');
  }
}

export async function apiUploadVaultItemChunk(
  vaultId: string,
  itemId: string,
  chunkIndex: number,
  bytes: Uint8Array
): Promise<void> {
  try {
    await apiClient.put(`/vaults/${vaultId}/items/${itemId}/chunk/${chunkIndex}`, bytes, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  } catch (e) {
    throwWithCode(e, 'item_upload_failed');
  }
}

export async function apiFinalizeVaultItem(
  vaultId: string,
  itemId: string
): Promise<ServerVaultItemDTO> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<{ item: ServerVaultItemDTO }>>(
      `/vaults/${vaultId}/items/${itemId}/finalize`,
      {}
    );
    if (!data.data?.item) throw new Error(data.error ?? 'Finalize failed');
    return data.data.item;
  } catch (e) {
    throwWithCode(e, 'item_finalize_failed');
  }
}

export async function apiDownloadVaultItemChunk(
  vaultId: string,
  itemId: string,
  chunkIndex: number
): Promise<Uint8Array> {
  const res = await apiClient.get<ArrayBuffer>(
    `/vaults/${vaultId}/items/${itemId}/chunk/${chunkIndex}`,
    { responseType: 'arraybuffer' }
  );
  return new Uint8Array(res.data);
}

/**
 * Une révision CONSERVÉE d'un élément — l'historique que le serveur gardait sans
 * que personne puisse le lire.
 *
 * Le serveur garde les trois dernières versions de chaque élément, les facture au
 * quota mutualisé de l'espace, expose deux routes pour les lire… et aucun client
 * ne les appelait. Un mauvais enregistrement était donc irrécupérable, alors que
 * le modèle de permissions — un membre peut écraser le travail d'un autre —
 * suppose exactement le contraire : il n'est acceptable que si l'on peut revenir
 * en arrière. Les octets étaient là, payés, et hors d'atteinte.
 */
export interface VaultItemRevisionDTO {
  id: string;
  itemId: string;
  /** La version de l'élément que cette révision portait avant d'être remplacée. */
  itemVersion: number;
  wrappedItemKey: string;
  wrappedUnderEpoch: number;
  encryptedMeta: string;
  encryptedMetaIv: string;
  totalChunks: number;
  sizeBytes: number;
  /**
   * Millisecondes epoch — c'est ce que le serveur envoie (`types.ts`,
   * `created_at: number`). Le typer en chaîne faisait afficher « 1770000000000 »
   * dans la liste des versions : `Date.parse` d'un nombre rend NaN, et le repli
   * de l'écran est d'imprimer la valeur brute.
   */
  createdAt: number;
}

/** Les révisions conservées d'un élément, la plus récente d'abord (tout membre). */
export async function apiListVaultItemRevisions(
  vaultId: string,
  itemId: string
): Promise<VaultItemRevisionDTO[]> {
  try {
    const { data } = await apiClient.get<ApiEnvelope<{ revisions: VaultItemRevisionDTO[] }>>(
      `/vaults/${vaultId}/items/${itemId}/revisions`
    );
    return data.data?.revisions ?? [];
  } catch (e) {
    throwWithCode(e, 'revisions_failed');
  }
}

/** Un morceau chiffré d'une révision conservée. */
export async function apiDownloadVaultRevisionChunk(
  vaultId: string,
  itemId: string,
  revisionId: string,
  chunkIndex: number
): Promise<Uint8Array> {
  const res = await apiClient.get<ArrayBuffer>(
    `/vaults/${vaultId}/items/${itemId}/revisions/${revisionId}/chunk/${chunkIndex}`,
    { responseType: 'arraybuffer' }
  );
  return new Uint8Array(res.data);
}

/**
 * La CORBEILLE d'un coffre — les éléments supprimés, pas encore purgés.
 *
 * La suppression était définitive à la seconde du clic, révisions comprises, là
 * où une note personnelle se récupère : un membre pouvait détruire d'un geste, et
 * sans retour possible, le travail de quelqu'un d'autre.
 */
export async function apiListDeletedVaultItems(vaultId: string): Promise<ServerVaultItemDTO[]> {
  try {
    const { data } = await apiClient.get<ApiEnvelope<{ items: ServerVaultItemDTO[] }>>(
      `/vaults/${vaultId}/items/deleted`
    );
    return data.data?.items ?? [];
  } catch (e) {
    throwWithCode(e, 'trash_failed');
  }
}

/** Sortir un élément de la corbeille — le quota est revérifié côté serveur. */
export async function apiRestoreVaultItem(vaultId: string, itemId: string): Promise<void> {
  try {
    await apiClient.post(`/vaults/${vaultId}/items/${itemId}/restore`, {});
  } catch (e) {
    throwWithCode(e, 'item_restore_failed');
  }
}

export async function apiDeleteVaultItem(vaultId: string, itemId: string): Promise<void> {
  await apiClient.delete(`/vaults/${vaultId}/items/${itemId}`);
}

// ── L'IRRÉVERSIBLE (F20) ─────────────────────────────────────────────────────
//
// Trois routes, une seule porte côté serveur : `owner`. Ce n'est pas de la
// prudence décorative — tant qu'aucune re-authentification n'est appliquée, la
// fenêtre de récupération est LA seule protection contre un compte
// administrateur compromis ; ce qui détruit sans retour reste donc au
// propriétaire, qui est aussi celui qui paie le stockage.

/**
 * Détruire UN élément définitivement — il doit déjà être à la corbeille.
 *
 * TROIS REFUS, ET LE TROISIÈME DIT L'INVERSE DES DEUX AUTRES :
 *  · 404 `item_not_found` — inconnu, VIVANT, ou d'un autre coffre : la route ne
 *    dit jamais lequel des trois, et le geste reste en deux temps ;
 *  · 409 `legal_hold_active` — une conservation légale porte sur ce contenu ;
 *  · 503 `purge_failed` — R2 a refusé, donc RIEN n'a été détruit et l'élément est
 *    TOUJOURS dans la corbeille. C'est le seul des trois qui invite à réessayer,
 *    et le repli de l'appelant (« impossible de détruire ») laisserait craindre
 *    une destruction à moitié faite : il a sa phrase à lui.
 */
export async function apiPurgeVaultItem(vaultId: string, itemId: string): Promise<void> {
  try {
    await apiClient.delete(`/vaults/${vaultId}/items/${itemId}/purge`);
  } catch (e) {
    throwWithCode(e, 'purge_item_failed');
  }
}

/**
 * Vider la corbeille du coffre — UNE PASSE, pas la totalité.
 *
 * Chaque élément coûte plusieurs allers-retours R2 (ses morceaux, ceux de chacune
 * de ses révisions) : une corbeille de mille éléments ne tient pas dans une
 * requête. La route rend donc `{ purged, remaining }` et c'est à l'appelant de
 * rappeler.
 *
 * LA CONDITION D'ARRÊT N'EST PAS `remaining > 0`, et c'est tout le sujet :
 * `destroyVaultItem` rend `false` quand R2 refuse durablement un objet, si bien
 * que la passe suivante retrouve les mêmes lignes et répond encore
 * `purged: 0, remaining: N`. Boucler là-dessus tourne jusqu'au 429 du seau (30
 * passes par heure et par COFFRE) — un quart d'heure de roue qui tourne pour
 * finir sur une erreur de débit. La règle vit dans `trashModel.emptyTrashStep`,
 * qui l'éprouve : rappeler tant que `purged > 0 && remaining > 0`, s'ARRÊTER sur
 * `purged === 0 && remaining > 0` et l'afficher comme un échec PARTIEL.
 */
/**
 * UN REFUS QUI A DÉJÀ DÉTRUIT — le compte que le serveur joint à son 409.
 *
 * POURQUOI UNE CLASSE, ENCORE. La route relit la conservation légale DANS sa
 * boucle (`TRASH_EMPTY_HOLD_RECHECK_EVERY`) : un hold posé pendant la passe
 * l'ARRÊTE, et elle répond `409 { code: 'legal_hold_active', purged: N }` après
 * avoir détruit N éléments POUR DE BON. Or `throwWithCode` réduit le refus à son
 * code et jette la réponse axios avec — le chiffre disparaissait entre le
 * serveur et l'écran. Sur un hold posé pendant la PREMIÈRE passe, l'appelant
 * n'avait rien à additionner et n'affichait que « une conservation légale est en
 * cours », c'est-à-dire « rien n'a bougé », alors que jusqu'à quarante-neuf
 * documents et toutes leurs versions n'existaient plus. Sur un geste sans
 * retour, c'est le pire des malentendus : on va ensuite chercher ce qui n'est
 * plus là.
 *
 * Le message reste le CODE, comme pour `VaultRetentionPolicyError` : les tables
 * de traduction et `errorText` continuent de fonctionner sans rien savoir d'elle.
 * Et un `purged` NUL ou aberrant ne l'arme pas — « arrêté après 0 élément
 * détruit » inventerait un demi-geste là où il n'y en a pas eu.
 */
export class VaultTrashPartialError extends Error {
  constructor(
    code: string,
    public readonly purged: number
  ) {
    super(code);
    this.name = 'VaultTrashPartialError';
  }
}

export async function apiEmptyVaultTrash(
  vaultId: string
): Promise<{ purged: number; remaining: number }> {
  let data: ApiEnvelope<{ purged: number; remaining: number }>;
  try {
    const res = await apiClient.post<ApiEnvelope<{ purged: number; remaining: number }>>(
      `/vaults/${vaultId}/trash/empty`,
      {}
    );
    data = res.data;
  } catch (e) {
    const compte = (e as { response?: { data?: { purged?: unknown } } })?.response?.data?.purged;
    if (typeof compte === 'number' && Number.isFinite(compte) && compte > 0) {
      throw new VaultTrashPartialError(
        classifyVaultFailure(e) ?? 'trash_empty_failed',
        Math.floor(compte)
      );
    }
    throwWithCode(e, 'trash_empty_failed');
  }
  // HORS DU `try`, comme pour les agrégats : dedans, ce diagnostic précis
  // retomberait dans le `catch` et en ressortirait aplati en
  // `trash_empty_failed`. Une enveloppe SANS compte n'est pas « rien à faire » :
  // conclure `0/0` annoncerait une corbeille vidée que personne n'a vidée.
  const d = data.data;
  if (!d || typeof d.purged !== 'number' || typeof d.remaining !== 'number') {
    throw new Error('trash_empty_malformed');
  }
  return { purged: d.purged, remaining: d.remaining };
}

// ── Updating an item (E3-12) ─────────────────────────────────────────────────
//
// Three steps, mirroring create (create → chunks → finalize): DECLARE the revision
// under a client-generated revisionId, stage its chunks, then commit with the
// `version` we read. The declaration is what lets the server quota-check the bytes
// before accepting a single one and reclaim the upload if we walk away; the commit
// is a compare-and-set — a stale version is REFUSED, never merged and never
// overwritten, so a concurrent editor can't silently lose their save.

/**
 * Raised on 409 item_version_conflict: someone committed a newer revision of this
 * item while we were editing. Carries the server's current version (retry with it
 * to overwrite deliberately) and its current item DTO (still opaque — decrypting
 * it is the caller's choice), so the UI can PROPOSE rather than clobber.
 */
export class VaultItemVersionConflictError extends Error {
  constructor(
    public readonly serverVersion: number | null,
    public readonly serverItem: ServerVaultItemDTO | null
  ) {
    super('item_version_conflict');
    this.name = 'VaultItemVersionConflictError';
  }
}

/**
 * Declare the revision we are about to stage. Nothing may be uploaded before this:
 * the server checks the declared size against the org's pooled quota, bounds how
 * many revisions of an item can be in flight, and records the row that makes an
 * abandoned upload reclaimable instead of stranded bytes nobody counts.
 */
export async function apiDeclareVaultItemRevision(
  vaultId: string,
  itemId: string,
  body: { revisionId: string; totalChunks: number; sizeBytes: number }
): Promise<void> {
  await apiClient.post(`/vaults/${vaultId}/items/${itemId}/revisions`, body);
}

export async function apiUploadVaultItemRevisionChunk(
  vaultId: string,
  itemId: string,
  revisionId: string,
  chunkIndex: number,
  bytes: Uint8Array
): Promise<void> {
  await apiClient.put(
    `/vaults/${vaultId}/items/${itemId}/revisions/${revisionId}/chunk/${chunkIndex}`,
    bytes,
    { headers: { 'Content-Type': 'application/octet-stream' } }
  );
}

/**
 * Commit the staged revision. Chunk count and size are NOT sent: they were declared
 * with the revision, and the server measures the real bytes from R2 anyway.
 */
/**
 * 409 grant_set_mismatch, TYPE : le serveur refuse un commit qui ne couvre pas
 * exactement les grants vivants, et sa reponse porte QUI resceller — le thunk
 * reconstruit et rejoue UNE fois sans round-trip supplementaire.
 */
export class GrantSetMismatchError extends Error {
  constructor(public readonly grants: Array<{ grantId: string; granteeUserId: string }>) {
    super('grant_set_mismatch');
    this.name = 'GrantSetMismatchError';
  }
}

export async function apiUpdateVaultItem(
  vaultId: string,
  itemId: string,
  body: {
    revisionId: string;
    expectedVersion: number;
    wrappedItemKey: string;
    wrappedUnderEpoch: number;
    encryptedMeta: string;
    encryptedMetaIv: string;
    /** E3-6 : K_item neuf rescelle pour CHAQUE grant vivant — exige l'egalite ensembliste. */
    grantRewraps?: Array<{ grantId: string; wrappedItemKey: string }>;
  }
): Promise<ServerVaultItemDTO> {
  try {
    const { data } = await apiClient.put<ApiEnvelope<{ item: ServerVaultItemDTO }>>(
      `/vaults/${vaultId}/items/${itemId}`,
      body
    );
    if (!data.data?.item) throw new Error(data.error ?? 'Item update failed');
    return data.data.item;
  } catch (e) {
    maybeThrowItemConflict(e);
    const err = e as {
      response?: {
        status?: number;
        data?: { code?: string; grants?: Array<{ grantId: string; granteeUserId: string }> };
      };
    };
    if (err.response?.status === 409 && err.response.data?.code === 'grant_set_mismatch') {
      throw new GrantSetMismatchError(err.response.data.grants ?? []);
    }
    throw e;
  }
}

/**
 * Reconnaître un 409 de version et le promouvoir en erreur TYPÉE — partagé par
 * le remplacement de contenu et le renommage, qui portent le même verrou et
 * doivent offrir la même résolution à l'écran.
 */
function maybeThrowItemConflict(e: unknown): void {
  const err = e as {
    response?: {
      status?: number;
      data?: { code?: string; serverVersion?: number; serverItem?: ServerVaultItemDTO | null };
    };
  };
  if (err.response?.status === 409 && err.response.data?.code === 'item_version_conflict') {
    throw new VaultItemVersionConflictError(
      err.response.data.serverVersion ?? null,
      err.response.data.serverItem ?? null
    );
  }
}

/** Une entrée du lot de re-scellement : l'élément, sa version lue, sa nouvelle enveloppe. */
export interface RewrapItemEntry {
  itemId: string;
  /** La version lue — le serveur en fait son compare-and-set. */
  version: number;
  /** K_item refermé sous K_vault de l'époque COURANTE (opaque pour le serveur). */
  wrappedItemKey: string;
}

export interface RewrapItemsResult {
  rewrapped: number;
  /** Une écriture concurrente a bougé la version : à relire et à refaire. */
  conflicts: Array<{ itemId: string; serverVersion: number }>;
}

/**
 * RE-SCELLER SOUS LA CLÉ COURANTE les éléments restés à une époque ancienne.
 *
 * SEULE L'ENVELOPPE VOYAGE. K_item est stable : le contenu et la méta ne sont ni
 * relus ni renvoyés — quelques centaines d'octets par élément, pas un
 * téléversement. Le serveur ne voit qu'un blob opaque de plus.
 *
 * L'ÉPOQUE EST DÉCLARÉE, PAS DEVINÉE. Le serveur ne peut pas savoir sous quelle
 * clé le client a refermé : il la vérifie contre la sienne et refuse 409
 * `vault_epoch_conflict` si une rotation est passée entre-temps. Sans ce champ,
 * une rotation concurrente ferait estampiller « époque N+1 » des enveloppes
 * fermées avec la clé de l'époque N — plus personne ne les ouvrirait.
 *
 * UN CONFLIT DE VERSION N'EST PAS UNE ERREUR : il revient dans `conflicts`, le
 * reste du lot est passé, et l'appelant relit puis repropose.
 */
export async function apiRewrapVaultItems(
  vaultId: string,
  body: { wrappedUnderEpoch: number; items: RewrapItemEntry[] }
): Promise<RewrapItemsResult> {
  const { data } = await apiClient.post<ApiEnvelope<RewrapItemsResult>>(
    `/vaults/${vaultId}/items/rewrap`,
    body
  );
  return { rewrapped: data.data?.rewrapped ?? 0, conflicts: data.data?.conflicts ?? [] };
}

// ── Lifecycle: public-key lookup + invite / join / leave (E3-4) ──────────────

export interface MemberPublicKeyDTO {
  userId: string;
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig?: string;
  fingerprint: string;
  keyAlgo: string;
  keyVersion: number;
}

/** Resolve a fellow org member's public key (E2-8). Throws on 404 no_public_key. */
export async function apiGetMemberPublicKey(userId: string): Promise<MemberPublicKeyDTO> {
  const { data } = await apiClient.get<ApiEnvelope<MemberPublicKeyDTO>>(
    `/account/public-key/${userId}`
  );
  if (!data.data) throw new Error(data.error ?? 'No public key for this member');
  return data.data;
}

/** Une personne joignable dans l'espace du coffre : de quoi router une adresse. */
export interface SpaceDirectoryEntry {
  userId: string;
  email: string;
}

/**
 * L'annuaire de l'espace DU COFFRE — les gens à qui on peut sceller la clé.
 *
 * POURQUOI PAS `GET /org/:orgId/members`. C'est ce que toute la surface coffre
 * appelait, et cette route exige `VIEW_MEMBERS` : un droit d'ESPACE que la
 * matrice ne donne qu'à ses propriétaires et administrateurs. Un invité entre
 * toujours en `viewer` — donc un admin de coffre reçu chez quelqu'un d'autre se
 * voyait refuser la lecture, et l'écran avalait le refus : les adresses
 * redevenaient des identifiants, et toute adresse tapée dans la ligne
 * d'invitation passait pour celle d'un « nouveau venu », y compris celle d'un
 * voisin d'espace à qui on aurait pu sceller sur-le-champ.
 *
 * La route de coffre pose la porte au bon endroit — le rôle DE COFFRE — et ne
 * rend que `userId` + `email` des membres ACTIFS : rien de la console d'espace.
 *
 * ELLE NE MANGE PAS SON ERREUR. C'est tout l'objet de la fiche : un appelant
 * doit pouvoir distinguer « je n'ai pas su lire » de « il n'y a personne », et
 * le dire. Voir `classifyDirectoryFailure`.
 */
export async function apiListVaultDirectory(vaultId: string): Promise<SpaceDirectoryEntry[]> {
  const { data } = await apiClient.get<ApiEnvelope<{ members: SpaceDirectoryEntry[] }>>(
    `/vaults/${vaultId}/directory`
  );
  return data.data?.members ?? [];
}

/**
 * Les deux seules choses qu'un écran ait à faire d'un échec d'annuaire.
 *
 *  - `forbidden`   : le serveur a refusé le DROIT de lire (403). Réessayer n'y
 *                    changera rien — c'est une phrase à afficher, pas un bouton.
 *  - `unavailable` : tout le reste — réseau, 5xx, coffre introuvable le temps
 *                    d'un basculement de locataire. On n'affirme RIEN du droit
 *                    de l'appelant à partir d'une absence d'information
 *                    (« terminal ≠ jetable ») : on propose de réessayer.
 *
 * Volontairement PLUS GROSSIER que `classifyVaultFailure`, qui replie 403 ET 404
 * sur un même `org_forbidden` : ici un 404 doit rester réessayable, sans quoi
 * l'écran dirait « lecture réservée » sur un coffre momentanément introuvable.
 */
export function classifyDirectoryFailure(e: unknown): 'forbidden' | 'unavailable' {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (status === 403) return 'forbidden';
  // Le code du Worker fait foi quand il est là : `vault_forbidden` est le refus
  // que `requireVaultRole` rend à un membre ou un lecteur du coffre.
  if (serverErrorCode(e) === 'vault_forbidden') return 'forbidden';
  return 'unavailable';
}

/**
 * LE LIEN D'INVITATION, RENDU UNE SEULE FOIS (F16).
 *
 * Le serveur ne conserve que le SHA-256 du jeton : cette URL n'existe QUE dans
 * la réponse qui vient de la fabriquer, et aucune relecture ne pourra la
 * reconstruire. Elle est absente des trois routes de liste, par construction.
 *
 * C'EST UN PORTEUR, AVEC LES QUATRE RÈGLES D'HYGIÈNE QUI VONT AVEC (§7 du plan) :
 * jamais dans Redux, jamais dans localStorage, hors des fils d'ariane Sentry
 * (`services/platform/crashReporter`), et effacé du presse-papiers après ~60 s.
 * Le type l'annonce OPTIONNEL parce qu'un worker d'avant la fiche n'en renvoie
 * pas : l'écran ne montre alors simplement pas les deux boutons — il n'invente
 * pas d'URL, et il ne prétend pas qu'elle a échoué.
 */
export interface InviteLinkOnce {
  /** L'URL d'acceptation, ou `undefined` : le serveur ne l'a pas servie. */
  inviteUrl?: string;
}

export async function apiInviteVaultMember(
  vaultId: string,
  body: {
    inviteeUserId: string;
    inviteeEmail: string;
    role: 'admin' | 'member' | 'viewer';
    wrappedVaultKey: string;
    lang?: string;
  }
): Promise<InviteLinkOnce> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<{ inviteUrl?: string }>>(
      `/vaults/${vaultId}/invites`,
      body
    );
    return { inviteUrl: data.data?.inviteUrl };
  } catch (e) {
    // seat_limit_reached / already_member / not_org_member / rate_limited … the UI
    // says something different for each, so the code must survive the transport.
    throwWithCode(e, 'invite_failed');
  }
}

/**
 * L'AJOUT DIRECT (F06) — faire entrer quelqu'un QUI EST DÉJÀ DANS L'ESPACE,
 * sans jeton, sans e-mail, sans péremption.
 *
 * POURQUOI C'EST LÉGITIME, ET POURQUOI ÇA N'AFFAIBLIT RIEN. Accepter une
 * invitation de coffre ne demandait jamais la clé privée de l'invitée : le
 * worker COPIAIT le scellé de `vault_invites` vers `vault_memberships`. Le
 * jeton n'était donc pas une opération cryptographique mais un CONSENTEMENT — et
 * ce consentement, l'entrée dans l'espace le porte déjà. Pour quelqu'un qui est
 * là, l'invitation n'ajoutait qu'un délai de sept jours et une chose de plus
 * qui pouvait expirer (le cas rapporté du 28/08 : une personne active dans
 * l'espace depuis cinq jours, et aucun accès nulle part).
 *
 * `wrappedVaultKey` est K_vault de l'ÉPOQUE COURANTE, scellée à la clé publique
 * exactement VÉRIFIÉE par la cérémonie d'empreinte. Le serveur ne fait qu'écrire
 * ce que le client lui tend : il ne fabrique jamais d'accès.
 *
 * La voie « invitation par jeton » (`apiInviteVaultMember`) reste entière pour
 * qui n'est pas encore dans l'espace — elle n'est pas remplacée, elle cesse
 * d'être le seul chemin.
 */
export async function apiAddVaultMember(
  vaultId: string,
  body: {
    userId: string;
    role: 'admin' | 'member' | 'viewer';
    wrappedVaultKey: string;
    /**
     * La langue de CELUI QUI DONNE l'accès, pour l'avis que le Worker poste à la
     * personne ajoutée — elle n'apprenait rien jusqu'ici. Le serveur ne stocke
     * aucune préférence de langue de destinataire : c'est le même compromis que
     * les invitations. Absente, il retombe sur l'anglais.
     */
    lang?: string;
  }
): Promise<VaultMemberDTO> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<{ member: VaultMemberDTO | null }>>(
      `/vaults/${vaultId}/members`,
      body
    );
    const member = data.data?.member;
    // Le 201 sans ligne n'est PAS un échec d'adhésion : le worker a écrit, il
    // n'a pas su relire. On rend une ligne minimale plutôt que de faire croire à
    // un refus — l'appelant recharge de toute façon derrière.
    return member ?? { userId: body.userId, role: body.role, joinedAt: new Date().toISOString() };
  } catch (e) {
    // already_member / not_org_member / host_plan_lapsed / rate_limited : l'écran
    // dit autre chose pour chacun, le code doit donc survivre au transport.
    throwWithCode(e, 'add_member_failed');
  }
}

/** Une invitation de coffre encore en attente — ce que la révocation vise. */
export interface VaultInviteDTO {
  id: string;
  vaultId: string;
  inviteeEmail: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  /**
   * L'ÉPOQUE SOUS LAQUELLE LE SCELLÉ A ÉTÉ FAIT. Optionnelle parce qu'un worker
   * d'avant F03 ne l'envoie pas — et une absence ne s'interprète JAMAIS comme
   * « à jour » : les écrans n'affirment « à réémettre » que sur un nombre
   * réellement reçu. Quand elle est inférieure à l'époque courante du coffre,
   * relancer l'invitation ne peut qu'échouer (`invite_stale_epoch`) : la seule
   * issue est de la réémettre sous un scellé neuf.
   */
  wrappedVaultKeyEpoch?: number;
  /** L'instant du règlement — porté seulement par l'accusé (`includeSettled`). */
  settledAt?: string | null;
  /**
   * LA FRISE D'ÉTAT (F22, 0078) : Envoyée → Relancée ×N → réglée.
   *
   * TROIS FAITS, TOUS PRODUITS PAR LE SERVEUR OU PAR L'HÔTE, AUCUN PAR L'INVITÉ.
   * `resendCount` / `lastResentAt` comptent et datent les relances MANUELLES ;
   * `remindedAt` date le rappel automatique du cron (F21), dont l'événement
   * d'activité n'a délibérément pas d'acteur. Il n'y a pas de `seenAt` : le
   * parcours réel passe par un lien cliqué, pas par le chargement d'une image
   * dans une boîte de réception — le signal serait faux la plupart du temps, et
   * ce serait de la donnée comportementale sur un tiers.
   *
   * OPTIONNELS PARCE QU'UN WORKER D'AVANT 0078 NE LES ENVOIE PAS, et l'absence
   * ne se lit jamais comme « zéro » : `inviteTimelineModel` fait alors
   * disparaître le cran plutôt que d'affirmer qu'on n'a jamais relancé.
   */
  resendCount?: number;
  lastResentAt?: string | null;
  remindedAt?: string | null;
}

/**
 * Les invitations VIVANTES d'un coffre (admin de coffre).
 *
 * POURQUOI CETTE LISTE EXISTE. Une invitation porte K_vault DÉJÀ scellée pour son
 * destinataire : c'est un porteur valide sept jours, et il n'y avait aucun moyen
 * de savoir lesquels étaient dehors, ni de les reprendre. Elle sert aussi à
 * expliquer un refus `already_invited` : soit une invitation est réellement en
 * attente et on la voit, soit il n'y en a pas et le refus serait un défaut.
 *
 * Ni le condensat du jeton ni le scellé ne sortent du serveur (toVaultInviteDTO).
 */
export async function apiListVaultInvites(vaultId: string): Promise<VaultInviteDTO[]> {
  try {
    const res = await apiClient.get(`/vaults/${vaultId}/invites`);
    return (res.data?.data?.invites ?? []) as VaultInviteDTO[];
  } catch {
    // Une liste illisible n'est pas fatale : le panneau affiche les membres, et
    // l'invitation reste révocable dès que la lecture repasse.
    return [];
  }
}

/**
 * La liste vivante PLUS l'accusé PLUS les échues.
 *
 * `settled` : les invitations réglées des quatorze derniers jours, avec leur
 * sort (« Acceptée » / « Refusée »). C'est la seule réponse que l'hôte reçoit —
 * pas d'e-mail de refus, par décision produit.
 *
 * `lapsed` (F03) : les expirées et révoquées des trente derniers jours, plus les
 * `pending` déjà échues que le balayage du worker n'a pas encore vues. SANS
 * ELLES, une invitation morte et une personne jamais invitée rendaient le MÊME
 * écran vide — l'indiscernabilité qui a fait conclure à un accès perdu là où il
 * n'y avait qu'un lien à réémettre. Demandée seulement quand l'écran sait les
 * montrer : un worker plus ancien ignore le mot et rend simplement `undefined`,
 * jamais un refus.
 */
export async function apiListVaultInvitesWithSettled(
  vaultId: string,
  opts: { lapsed?: boolean } = {}
): Promise<{ invites: VaultInviteDTO[]; settled: VaultInviteDTO[]; lapsed: VaultInviteDTO[] }> {
  try {
    const res = await apiClient.get(`/vaults/${vaultId}/invites`, {
      params: { include: opts.lapsed ? 'settled,lapsed' : 'settled' },
    });
    return {
      invites: (res.data?.data?.invites ?? []) as VaultInviteDTO[],
      settled: (res.data?.data?.settled ?? []) as VaultInviteDTO[],
      lapsed: (res.data?.data?.lapsed ?? []) as VaultInviteDTO[],
    };
  } catch {
    return { invites: [], settled: [], lapsed: [] };
  }
}

/**
 * Relance une invitation en attente avec un porteur NEUF — l'ancien lien meurt
 * à l'instant (unicité du condensat), la même K_vault scellée repart, et le
 * serveur renvoie l'e-mail. `invite_stale_epoch` signifie qu'une rotation est
 * passée par là : le seul chemin honnête est révoquer puis réinviter.
 */
export async function apiResendVaultInvite(
  vaultId: string,
  inviteId: string,
  lang?: string
): Promise<InviteLinkOnce & { invite: VaultInviteDTO | null }> {
  try {
    const { data } = await apiClient.post<
      ApiEnvelope<{ invite: VaultInviteDTO | null; inviteUrl?: string }>
    >(`/vaults/${vaultId}/invites/${inviteId}/resend`, lang ? { lang } : {});
    // Le lien NEUF (F16) : la relance a régénéré le jeton, donc l'ancien est
    // mort à l'instant. Rendu ici, une fois — voir `InviteLinkOnce`.
    return { invite: data.data?.invite ?? null, inviteUrl: data.data?.inviteUrl };
  } catch (e) {
    throwWithCode(e, 'invite_resend_failed');
  }
}

/** La tête du fil de CHAQUE coffre — le point « activité nouvelle » du rail. */
export interface VaultActivityHeadDTO {
  vaultId: string;
  occurredAt: number;
  id: number;
}

export async function apiGetVaultActivityHeads(): Promise<{
  recorded: boolean;
  heads: VaultActivityHeadDTO[];
}> {
  try {
    const res = await apiClient.get('/vaults/activity/heads');
    const d = res.data?.data;
    return {
      recorded: d?.recorded !== false,
      heads: (d?.heads ?? []) as VaultActivityHeadDTO[],
    };
  } catch (e) {
    throwWithCode(e, 'activity_load_failed');
  }
}

/**
 * LA TÊTE DE FRAÎCHEUR de chaque coffre — le signal de la propagation vivante.
 *
 * DISTINCTE DE `apiGetVaultActivityHeads`, ET C'EST TOUT L'INTÉRÊT. Le fil
 * d'activité n'est ÉCRIT que dans une org journalisée : dans un espace personnel
 * gratuit il est structurellement vide, et sa tête ne bougerait jamais. Celle-ci
 * ne lit aucun journal, seulement l'état des tables — elle répond à tout le monde.
 *
 * `orgId` est EXPLICITE pour la même raison que dans `apiListVaults` : la route
 * est portée par un espace, et un compte peut en connaître plusieurs (le sien,
 * plus chacun de ceux qui l'ont invité). L'appelant fusionne — et doit savoir
 * lesquels ont répondu, sans quoi une absence passerait pour une exclusion.
 */
export interface VaultHeadDTO {
  vaultId: string;
  /** Chaîne OPAQUE : à comparer, jamais à interpréter. */
  itemsRevision: string;
  memberCount: number;
  settingsVersion: number;
  currentKeyEpoch: number;
  myWrappedEpoch: number;
  frozenAt: string | null;
  deletedAt: string | null;
}

export async function apiGetVaultHeads(orgId?: string): Promise<VaultHeadDTO[]> {
  const res = await apiClient.get<ApiEnvelope<{ heads: VaultHeadDTO[] }>>('/vaults/heads', {
    headers: orgId ? { 'X-Org-Id': orgId } : undefined,
  });
  return res.data.data?.heads ?? [];
}

// ── E3-6 : partage par personne d'un élément (item grants) ───────────────────

/** Un grant vu par le TITULAIRE — jamais le wrap scellé. */
export interface ItemGrantDTO {
  id: string;
  granteeUserId: string;
  granteeEmail: string | null;
  role: string;
  wrappedForVersion: number;
  /** Le wrap est en retard sur la version réelle : l'accès est mort jusqu'au rescellement. */
  stale: boolean;
  expiresAt: string | null;
  createdAt: string;
}

/** Une entrée « Partagé avec moi » — le wrap DU DESTINATAIRE + la méta opaque. */
export interface SharedWithMeEntryDTO {
  grantId: string;
  itemId: string;
  vaultId: string;
  itemType: string;
  wrappedItemKey: string;
  wrappedForVersion: number;
  itemVersion: number;
  encryptedMeta: string;
  encryptedMetaIv: string;
  totalChunks: number;
  sizeBytes: number;
  grantedByUserId: string | null;
  grantedByEmail: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Partage un élément avec UNE personne — K_item déjà scellé à SA clé. */
export async function apiCreateItemGrant(
  vaultId: string,
  itemId: string,
  body: {
    granteeUserId: string;
    wrappedItemKey: string;
    itemVersion: number;
    expiresInDays?: number;
  }
): Promise<ItemGrantDTO> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<{ grant: ItemGrantDTO }>>(
      `/vaults/${vaultId}/items/${itemId}/grants`,
      body
    );
    if (!data.data?.grant) throw new Error('grant_create_failed');
    return data.data.grant;
  } catch (e) {
    throwWithCode(e, 'grant_create_failed');
  }
}

export async function apiListItemGrants(vaultId: string, itemId: string): Promise<ItemGrantDTO[]> {
  try {
    const res = await apiClient.get(`/vaults/${vaultId}/items/${itemId}/grants`);
    return (res.data?.data?.grants ?? []) as ItemGrantDTO[];
  } catch {
    // Une liste illisible n'est pas fatale : le panneau vit sans elle, et le
    // COMMIT, lui, revérifie côté serveur (grant_set_mismatch fait autorité).
    return [];
  }
}

/**
 * UN accès ponctuel vu depuis LE COFFRE (F17) — la même ligne que
 * `ItemGrantDTO`, plus les deux champs qu'un panneau par élément n'a pas besoin
 * de dire : de QUEL élément il s'agit, et à quelle version cet élément en est.
 *
 * `stale` est calculé PAR LE SERVEUR (`item_version > wrapped_for_version`) et
 * transporté tel quel : deux clients qui le recalculeraient finiraient par en
 * décider différemment, et c'est ce verdict qui décide d'un bouton « Réparer ».
 */
export interface VaultGrantDTO {
  grantId: string;
  itemId: string;
  granteeUserId: string;
  /** Affichage seulement — l'hôte a tapé cette adresse lui-même pour partager. */
  granteeEmail: string | null;
  role: string;
  expiresAt: string | null;
  wrappedForVersion: number;
  itemVersion: number;
  /** Le wrap ouvre une version dépassée : l'accès est mort jusqu'au rescellement. */
  stale: boolean;
  createdAt: string;
}

/**
 * TOUS les accès ponctuels VIVANTS d'un coffre (admin). C'est la seule sortie de
 * matière hors du trombinoscope, et elle ne se vérifiait jusqu'ici qu'un fichier
 * à la fois.
 *
 * Contrairement à `apiListItemGrants`, l'échec REMONTE : ce panneau-là existe
 * pour répondre « qui, en dehors de mes membres, peut encore lire ? », et une
 * liste vide rendue sur une panne répondrait « personne » — la pire des réponses
 * fausses. L'écran distingue donc le vide du refus.
 */
export async function apiListVaultGrants(vaultId: string): Promise<VaultGrantDTO[]> {
  try {
    const res = await apiClient.get<ApiEnvelope<{ grants: VaultGrantDTO[] }>>(
      `/vaults/${vaultId}/grants`
    );
    return res.data?.data?.grants ?? [];
  } catch (e) {
    throwWithCode(e, 'grants_load_failed');
  }
}

/** Révoque — l'accès serveur est coupé à l'instant ; la rotation K_item suit côté client. */
export async function apiRevokeItemGrant(
  vaultId: string,
  itemId: string,
  grantId: string
): Promise<{ remainingGrants: number }> {
  try {
    const { data } = await apiClient.delete<ApiEnvelope<{ remainingGrants: number }>>(
      `/vaults/${vaultId}/items/${itemId}/grants/${grantId}`
    );
    return { remainingGrants: data.data?.remainingGrants ?? 0 };
  } catch (e) {
    throwWithCode(e, 'grant_revoke_failed');
  }
}

/** Répare un grant né stale (commit concurrent entre lecture et CAS). */
export async function apiRewrapItemGrant(
  vaultId: string,
  itemId: string,
  grantId: string,
  body: { wrappedItemKey: string; itemVersion: number }
): Promise<void> {
  try {
    await apiClient.post(`/vaults/${vaultId}/items/${itemId}/grants/${grantId}/rewrap`, body);
  } catch (e) {
    throwWithCode(e, 'grant_rewrap_failed');
  }
}

// ── Agrégats de partage (lot B) — des comptes, jamais des identités ──────────

/** L'agrégat d'UN coffre : son effectif + le nombre de grants vivants par élément. */
export interface VaultShareSummaryDTO {
  memberCount: number;
  /** Un élément sans grant vivant n'a pas d'entrée : zéro se lit par absence. */
  grants: Array<{ itemId: string; count: number }>;
}

/** L'effectif de CHAQUE coffre de l'appelant — la pastille du rail. */
export interface VaultShareHeadDTO {
  vaultId: string;
  memberCount: number;
}

/**
 * Les pastilles de la liste d'éléments. Un agrégat illisible n'est pas fatal :
 * la liste vit sans ses pastilles, et le panneau des accès par élément reste la
 * source nominative quand on l'ouvre — d'où `null`, jamais une exception.
 */
export async function apiGetVaultShareSummary(
  vaultId: string
): Promise<VaultShareSummaryDTO | null> {
  try {
    const res = await apiClient.get(`/vaults/${vaultId}/share-summary`);
    const d = res.data?.data;
    if (!d || typeof d !== 'object' || !Array.isArray(d.grants)) return null;
    return {
      memberCount: typeof d.memberCount === 'number' ? d.memberCount : 0,
      grants: (d.grants as Array<{ itemId?: unknown; count?: unknown }>)
        .filter((g) => typeof g?.itemId === 'string' && typeof g?.count === 'number')
        .map((g) => ({ itemId: g.itemId as string, count: g.count as number })),
    };
  } catch {
    return null;
  }
}

/** Les pastilles du rail — même tolérance : `null` plutôt qu'un rail cassé. */
export async function apiGetVaultShareHeads(): Promise<VaultShareHeadDTO[] | null> {
  try {
    const res = await apiClient.get('/vaults/share-heads');
    const heads = res.data?.data?.heads;
    if (!Array.isArray(heads)) return null;
    return (heads as Array<{ vaultId?: unknown; memberCount?: unknown }>)
      .filter((h) => typeof h?.vaultId === 'string' && typeof h?.memberCount === 'number')
      .map((h) => ({ vaultId: h.vaultId as string, memberCount: h.memberCount as number }));
  } catch {
    return null;
  }
}

/** Tout ce qui m'a été partagé, tous espaces confondus (la route ignore X-Org-Id). */
export async function apiListSharedWithMe(): Promise<SharedWithMeEntryDTO[]> {
  try {
    const res = await apiClient.get('/shared-with-me');
    return (res.data?.data?.entries ?? []) as SharedWithMeEntryDTO[];
  } catch (e) {
    throwWithCode(e, 'shared_with_me_load_failed');
  }
}

export async function apiDownloadSharedChunk(itemId: string, index: number): Promise<Uint8Array> {
  try {
    const res = await apiClient.get(`/shared-with-me/${itemId}/chunk/${index}`, {
      responseType: 'arraybuffer',
    });
    return new Uint8Array(res.data as ArrayBuffer);
  } catch (e) {
    throwWithCode(e, 'shared_chunk_failed');
  }
}

// ── Fil d'activité d'un coffre ───────────────────────────────────────────────

/** Une ligne du fil — métadonnées opaques, JAMAIS d'adresse ni de forensique. */
export interface VaultActivityEventDTO {
  id: number;
  actorUserId: string | null;
  eventType: string;
  targetId: string | null;
  occurredAt: number;
  metadata: Record<string, unknown> | null;
}

export interface VaultActivityPage {
  events: VaultActivityEventDTO[];
  nextCursor: string | null;
  /** false = l'écriture d'audit est coupée ici (espace personnel / offre sans
   *  journal) : le fil est STRUCTURELLEMENT vide, l'écran doit le dire. */
  recorded: boolean;
}

/**
 * Le fil d'activité du coffre (tout membre, viewer compris). La résolution des
 * noms (adresses, titres d'éléments) est STRICTEMENT client — le serveur ne
 * livre que des identifiants opaques.
 */
export async function apiGetVaultActivity(
  vaultId: string,
  opts: {
    cursor?: string;
    limit?: number;
    /**
     * Les types d'événements demandés (`types=a,b`), filtrés PAR LE SERVEUR.
     *
     * La frise des clés (F10) n'a besoin que des `vault.rotate` : les lire en
     * paginant le fil entier ferait dépendre l'écran de ce qui s'est passé
     * ENTRE deux rotations — sur un coffre actif, la première page n'en
     * contiendrait aucune et la frise serait vide alors que le serveur les a.
     */
    types?: readonly string[];
    /**
     * L'AUTEUR DES LIGNES (F12), un identifiant opaque — jamais une adresse : le
     * serveur ne connaît que des identifiants, et lui envoyer une adresse ferait
     * de cette route un oracle d'existence de comptes. Un identifiant INCONNU
     * rend une liste vide, pas une erreur, et c'est délibéré côté worker.
     */
    actor?: string | null;
    /** Bornes INCLUSIVES en millisecondes, comme le worker les lit. */
    since?: number;
    until?: number;
  } = {}
): Promise<VaultActivityPage> {
  try {
    const res = await apiClient.get(`/vaults/${vaultId}/activity`, {
      params: {
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
        ...(opts.limit ? { limit: opts.limit } : {}),
        ...(opts.types && opts.types.length > 0 ? { types: opts.types.join(',') } : {}),
        ...(opts.actor ? { actor: opts.actor } : {}),
        // `Number.isFinite` plutôt qu'une vérité JS : `since: 0` est une borne
        // légitime (l'époque Unix), et `0` est faux.
        ...(Number.isFinite(opts.since) ? { since: opts.since } : {}),
        ...(Number.isFinite(opts.until) ? { until: opts.until } : {}),
      },
    });
    const d = res.data?.data;
    return {
      events: (d?.events ?? []) as VaultActivityEventDTO[],
      nextCursor: (d?.nextCursor ?? null) as string | null,
      recorded: d?.recorded !== false,
    };
  } catch (e) {
    throwWithCode(e, 'activity_load_failed');
  }
}

// ── /me — la boîte de réception d'invitations du COMPTE ──────────────────────

/**
 * Une invitation vue par son DESTINATAIRE. Le nom d'org est en clair par
 * conception (il voyage déjà dans l'e-mail) ; le nom du coffre est E2EE et
 * n'apparaît qu'après l'entrée. `stale` : une rotation a rendu le scellé caduc
 * — l'écran doit dire « demandez une nouvelle invitation », pas offrir un
 * bouton mort.
 */
export interface MyInvitationDTO {
  id: string;
  vaultId: string;
  orgId: string;
  orgName: string | null;
  role: string;
  expiresAt: string;
  createdAt: string;
  invitedByEmail: string | null;
  stale: boolean;
}

/**
 * Un accès PROMIS mais pas encore arrivé (0073).
 *
 * Ce n'est pas une invitation : il n'y a rien à accepter, aucun bouton. C'est
 * l'état de quelqu'un qui a rejoint l'espace de son hôte et dont le scellé
 * n'est pas encore parti. Sans lui, cet écran est rigoureusement identique à
 * celui de quelqu'un que personne n'a jamais invité nulle part — et c'est cette
 * confusion qui pousse à recoller un lien d'espace déjà consommé.
 *
 * Ni identifiant ni nom de coffre : on n'en est pas encore membre.
 */
export interface AwaitingHostDTO {
  orgId: string;
  orgName: string | null;
  role: string;
  since: string;
}

/**
 * Ce qui attend l'adresse de CE compte, à travers tous les locataires — la
 * moitié manquante du parcours : l'e-mail perdu n'est plus le seul chemin.
 *
 * Rend DEUX listes, et elles ne se confondent pas : `invitations` demande une
 * réponse, `awaitingHost` n'en demande aucune et se contente de nommer une
 * attente.
 */
export async function apiListMyInvitations(): Promise<{
  invitations: MyInvitationDTO[];
  awaitingHost: AwaitingHostDTO[];
}> {
  try {
    const res = await apiClient.get('/me/invitations');
    return {
      invitations: (res.data?.data?.invitations ?? []) as MyInvitationDTO[],
      awaitingHost: (res.data?.data?.awaitingHost ?? []) as AwaitingHostDTO[],
    };
  } catch {
    // Illisible n'est pas fatal : l'écran des coffres vit sans la boîte.
    return { invitations: [], awaitingHost: [] };
  }
}

/** Accepte par identifiant — le miroir de /join, sans jeton dans l'URL. */
export async function apiAcceptMyInvitation(
  inviteId: string
): Promise<{ vaultId: string; orgId: string; role: string }> {
  try {
    const { data } = await apiClient.post<
      ApiEnvelope<{ vaultId: string; orgId: string; role: string }>
    >(`/me/invitations/${inviteId}/accept`);
    const d = data.data;
    if (!d?.vaultId || !d?.orgId) throw new Error('invite_invalid');
    return { vaultId: d.vaultId, orgId: d.orgId, role: d.role ?? 'member' };
  } catch (e) {
    throwWithCode(e, 'invite_invalid');
  }
}

/** Refuse — la réponse que le produit ne savait pas porter. */
export async function apiDeclineMyInvitation(inviteId: string): Promise<void> {
  try {
    await apiClient.post(`/me/invitations/${inviteId}/decline`);
  } catch (e) {
    // `invite_settled` : réglée entre l'affichage et le clic — l'écran recharge.
    throwWithCode(e, 'invite_decline_failed');
  }
}

/**
 * Corriger le rôle d'une invitation EN ATTENTE (F18, admin de coffre).
 *
 * CE QUE ÇA REMPLACE : révoquer puis réinviter. Deux e-mails, un lien mort chez
 * la personne, un scellé neuf — pour changer un mot. Or le rôle d'une invitation
 * n'est PAS scellé : il est écrit en clair dans la ligne, et c'est
 * l'acceptation qui le recopie dans l'adhésion. Le corriger ne touche donc ni la
 * clé, ni le porteur, ni la date : le lien déjà envoyé reste valide et mène au
 * bon rôle.
 *
 * `invite_not_found` couvre les quatre cas indiscernables (inconnue, d'un autre
 * coffre, déjà acceptée, déjà révoquée) — l'écran relit plutôt que de deviner.
 */
export async function apiPatchVaultInviteRole(
  vaultId: string,
  inviteId: string,
  role: 'admin' | 'member' | 'viewer'
): Promise<string> {
  try {
    const { data } = await apiClient.patch<ApiEnvelope<{ role: string }>>(
      `/vaults/${vaultId}/invites/${inviteId}`,
      { role }
    );
    return data.data?.role ?? role;
  } catch (e) {
    throwWithCode(e, 'role_change_failed');
  }
}

/**
 * Corriger le RANG PROMIS d'une intention d'accès (0073) — l'autre moitié du
 * même geste humain.
 *
 * POURQUOI IL Y A DEUX APPELS POUR UNE SEULE NOTION. Inviter quelqu'un depuis un
 * coffre produit une invitation de coffre SI la personne est déjà dans l'espace,
 * et une intention d'accès sinon. L'hôte, lui, n'a fait qu'un geste et ne voit
 * qu'une personne invitée : c'est l'écran qui choisit la route, jamais lui.
 *
 * Rien n'est scellé à ce stade — c'est la définition d'une intention — donc
 * corriger le rang ne touche ni clé, ni porteur, ni échéance : le lien d'espace
 * déjà reçu reste valide et mènera au bon rôle.
 *
 * `intent_not_found` couvre les quatre cas indiscernables (inconnue, d'un autre
 * coffre, déjà honorée, déjà annulée) : l'écran relit plutôt que de deviner. Le
 * repli `role_change_failed` est celui de sa jumelle — même phrase pour le même
 * geste raté.
 */
export async function apiPatchPendingGrantRole(
  vaultId: string,
  inviteId: string,
  role: 'admin' | 'member' | 'viewer'
): Promise<string> {
  try {
    const { data } = await apiClient.patch<ApiEnvelope<{ role: string }>>(
      `/vaults/${vaultId}/pending-grants/${inviteId}`,
      { role }
    );
    return data.data?.role ?? role;
  } catch (e) {
    throwWithCode(e, 'role_change_failed');
  }
}

// ── Réglages du coffre (F13) ─────────────────────────────────────────────────

/**
 * Ce que `GET /vaults/:id/settings` rend — deux moitiés et leur version.
 *
 * `version: 0` signifie « aucune ligne enregistrée » : c'est la valeur à
 * renvoyer en `expectedVersion` pour la PREMIÈRE écriture. Ce n'est pas une
 * erreur et ce n'est pas non plus « version inconnue » — un coffre jamais réglé
 * tourne sur les défauts, qui sont le comportement d'avant F13.
 *
 * `encrypted.settingsEpoch` voyage AVEC le bloc, et c'est ce qui permet de dire
 * « ce bloc a été scellé sous une clé qui a changé depuis » plutôt que
 * d'afficher un écran vide après une rotation faite par un client d'avant.
 */
export interface VaultSettingsReadDTO {
  version: number;
  /** Le document EN CLAIR, tel quel — c'est `readVaultSettings` qui le valide. */
  settings: unknown;
  encrypted: {
    settingsEncrypted: string;
    settingsIv: string;
    settingsEpoch: number | null;
  } | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Lire les réglages — ouvert à TOUT membre, lecteurs compris : ces règles
 *  contraignent leur application, et une règle qu'on subit sans la lire ne se
 *  comprend pas. */
export async function apiGetVaultSettings(vaultId: string): Promise<VaultSettingsReadDTO> {
  try {
    const { data } = await apiClient.get<ApiEnvelope<VaultSettingsReadDTO>>(
      `/vaults/${vaultId}/settings`
    );
    if (!data.data) throw new Error('settings_malformed');
    return data.data;
  } catch (e) {
    throwWithCode(e, 'settings_load_failed');
  }
}

/**
 * Enregistrer les réglages (admin), en COMPARE-AND-SET sur `expectedVersion`.
 *
 * `patch` est PARTIEL et fusionné par le serveur : envoyer le document entier
 * remettrait au défaut les champs qu'une version plus récente aurait ajoutés.
 * `encrypted` est un TRIPLET INDIVISIBLE — les trois ou aucun : la moitié d'un
 * couple écrirait un blob que rien n'ouvrira, et un bloc sans époque déclarée
 * obligerait le serveur à en inventer une.
 *
 * Deux 409 distincts, et il ne faut pas les confondre :
 *  · `settings_version_conflict` — quelqu'un a enregistré pendant qu'on
 *    éditait : relire, puis proposer de réappliquer ;
 *  · `vault_epoch_conflict` — le bloc a été scellé sous une clé que la rotation
 *    a laissée derrière : resceller sous K_vault courante.
 *
 * Le serveur joint sa propre `serverVersion` / `serverEpoch` au refus ; on ne
 * les lit PAS ici. `throwWithCode` réduit l'échec à son code canonique, et
 * l'écran relit de toute façon (`GET /settings`) pour montrer ce qui est
 * enregistré avant de proposer de réappliquer : une version prise dans un
 * message d'erreur, sans les valeurs qui vont avec, ne permettrait que de
 * réécrire par-dessus quelque chose qu'on n'a pas vu.
 */
/**
 * Le 400 `retention_over_policy`, avec le plafond que le serveur a joint.
 *
 * POURQUOI UNE CLASSE PLUTÔT QU'UN CODE NU. `throwWithCode` réduit tout refus à
 * son code canonique, et la réponse axios n'existe plus après lui : le plafond
 * (`limit`, en jours) serait perdu. Or c'est précisément ce qui distingue une
 * phrase utile — « l'espace plafonne à quatorze jours, choisissez cette durée ou
 * moins » — d'une phrase qui laisse chercher : ce refus-ci ne dit pas que la
 * valeur est mal formée, il dit qu'un administrateur d'ESPACE l'a plafonnée
 * ailleurs. Le message reste le code, comme partout, pour que les tables de
 * traduction et `errorText` continuent de fonctionner sans rien savoir de cette
 * classe. Même précédent que `VaultItemVersionConflictError`.
 */
export class VaultRetentionPolicyError extends Error {
  constructor(public readonly limitDays: number | null) {
    super('retention_over_policy');
    this.name = 'VaultRetentionPolicyError';
  }
}

/** Le triplet scellé du document d'intentions — opaque, comme celui des réglages. */
export interface ShareIntentsBlob {
  intentsEncrypted: string;
  intentsIv: string;
  intentsEpoch: number;
}

/**
 * Lit le document d'intentions de partage. Tout membre peut le lire : il est
 * chiffré, donc en réserver la lecture n'ajouterait aucune confidentialité et
 * empêcherait le rattrapage de tourner chez la personne qui détient la clé.
 */
export async function apiGetVaultShareIntents(
  vaultId: string
): Promise<{ version: number; encrypted: ShareIntentsBlob | null; serverNow: string | null }> {
  const { data } = await apiClient.get<
    ApiEnvelope<{
      version: number;
      encrypted: ShareIntentsBlob | null;
      /** L'heure du SERVEUR — la seule comparable à `created_at` d'un élément. */
      serverNow?: string;
    }>
  >(`/vaults/${vaultId}/share-intents`);
  return {
    version: data.data?.version ?? 0,
    encrypted: data.data?.encrypted ?? null,
    // `null` quand le serveur ne rend pas encore ce champ : c'est à l'appelant
    // de dire ce qu'il fait de son absence, pas à cette couche de deviner.
    serverNow: data.data?.serverNow ?? null,
  };
}

/**
 * Écrit le document ENTIER, sous compare-and-set.
 *
 * NE JETTE PAS SUR UN CONFLIT — il rend `{ ok: false, code }`. Perdre la course
 * n'est pas une panne : c'est un autre administrateur qui a écrit entre-temps,
 * et l'appelant doit relire puis réappliquer son geste. Une exception
 * remonterait jusqu'à un « échec » affiché, là où « recommencez » est la vérité.
 */
/**
 * Ce qu'on ENVOIE. `sealedEpoch` en entrée, `intentsEpoch` en sortie : même
 * asymétrie que pour les réglages, et même raison — l'un est une AFFIRMATION du
 * client sur la clé qu'il vient d'employer, l'autre l'état enregistré qu'il
 * relit. Les confondre inviterait à renvoyer ce qu'on a lu sans se demander
 * sous quelle clé on vient de sceller.
 */
export interface ShareIntentsWrite {
  intentsEncrypted: string;
  intentsIv: string;
  sealedEpoch: number;
}

export async function apiPutVaultShareIntents(
  vaultId: string,
  body: { expectedVersion: number; encrypted: ShareIntentsWrite | null }
): Promise<{ ok: true; version: number } | { ok: false; code: string }> {
  try {
    const { data } = await apiClient.put<ApiEnvelope<{ version: number }>>(
      `/vaults/${vaultId}/share-intents`,
      body
    );
    return { ok: true, version: data.data?.version ?? body.expectedVersion + 1 };
  } catch (e) {
    return { ok: false, code: serverErrorCode(e) || 'share_intents_save_failed' };
  }
}

export async function apiPutVaultSettings(
  vaultId: string,
  body: {
    expectedVersion: number;
    patch?: Record<string, unknown>;
    encrypted?: { settingsEncrypted: string; settingsIv: string; sealedEpoch: number };
  }
): Promise<{ version: number }> {
  try {
    const { data } = await apiClient.put<ApiEnvelope<{ version: number }>>(
      `/vaults/${vaultId}/settings`,
      body
    );
    return { version: data.data?.version ?? body.expectedVersion + 1 };
  } catch (e) {
    if (serverErrorCode(e) === 'retention_over_policy') {
      const limit = (e as { response?: { data?: { limit?: unknown } } })?.response?.data?.limit;
      // Le plafond n'est PAS inventé quand il manque : `null` fait dire à l'écran
      // « l'espace plafonne » sans citer un nombre que personne n'a servi.
      throw new VaultRetentionPolicyError(typeof limit === 'number' ? limit : null);
    }
    throwWithCode(e, 'settings_save_failed');
  }
}

/** Reprend une invitation en attente (admin de coffre). */
export async function apiRevokeVaultInvite(vaultId: string, inviteId: string): Promise<void> {
  try {
    await apiClient.delete(`/vaults/${vaultId}/invites/${inviteId}`);
  } catch (e) {
    // invite_not_found quand elle vient d'être acceptée ou révoquée ailleurs :
    // l'écran le dit plutôt que de prétendre avoir agi.
    throwWithCode(e, 'invite_revoke_failed');
  }
}

/**
 * Bring someone INTO the shared space by email — step one of adding a person who
 * isn't there yet (on a personal plan the space starts with exactly one person, its
 * owner, so this is the normal path).
 *
 * TWO STEPS, AND THAT IS THE MODEL, not a shortcut we skipped. K_vault is sealed to
 * a specific public key, so a vault invitation can only be issued to an account we
 * can already resolve a key for. The email invitation makes them resolvable; the
 * vault invitation (apiInviteVaultMember) then seals to them. Nothing here weakens
 * the E2EE path: the server still never sees a key it could open.
 *
 * `role` is the SPACE role, deliberately the lowest one that fits: 'viewer' for a
 * read-only guest, 'editor' otherwise — 'editor' carries no management permission at
 * all (see the RBAC matrix), so a guest can never reach anything administrative.
 *
 * Failure codes worth a sentence of their own: seat_limit_reached (plan cap — the
 * upsell), already_member, invalid_email, rate_limited.
 */
/**
 * Inviter quelqu'un dans l'ESPACE — et, du même geste, déclarer l'INTENTION de
 * lui donner accès à un coffre (0073).
 *
 * POURQUOI LES DEUX ENSEMBLE. L'hôte n'a jamais voulu « ajouter une personne à
 * mon espace » : il veut partager un coffre. Les deux temps CRYPTOGRAPHIQUES
 * sont irréductibles — K_vault se scelle à une clé publique, et un compte qui
 * n'existe pas encore n'en a pas — mais les deux GESTES ne l'étaient pas. Le
 * second se déclenche désormais tout seul, côté hôte, dès que la clé de
 * l'invitée devient résolvable.
 *
 * `intendedVaultId` absent = invitation d'espace ordinaire, comportement
 * inchangé. Présent et refusé (coffre inconnu, rôle insuffisant), c'est TOUTE la
 * requête qui échoue : envoyer l'invitation en laissant tomber la partie coffre
 * reproduirait exactement le défaut qu'on ferme.
 */
export async function apiInviteToVaultSpace(
  orgId: string,
  body: {
    email: string;
    role: 'editor' | 'viewer';
    lang?: string;
    intendedVaultId?: string;
    intendedVaultRole?: 'admin' | 'member' | 'viewer';
  }
): Promise<InviteLinkOnce & { expiresAt: string | null }> {
  try {
    const { data } = await apiClient.post<
      ApiEnvelope<{ invitation?: { expiresAt?: string } | null; inviteUrl?: string }>
    >(`/org/${orgId}/invitations`, body);
    // Le lien d'acceptation, rendu une seule fois (F16) — voir `InviteLinkOnce`.
    // Quand l'e-mail n'arrive pas (filtre, boîte pleine, aiguillage), c'est le
    // SEUL moyen de transmettre l'invitation autrement.
    //
    // L'ÉCHÉANCE VIENT AVEC, et elle n'est pas décorative : le QR affiche « ne
    // fonctionne que pour cette adresse et expire le … ». La déduire d'un TTL
    // écrit en dur côté client ferait afficher une date fausse le jour où le
    // serveur change d'avis — `null` quand on ne l'a pas, et la phrase se tait.
    return { inviteUrl: data.data?.inviteUrl, expiresAt: data.data?.invitation?.expiresAt ?? null };
  } catch (e) {
    throwWithCode(e, 'invite_failed');
  }
}

/**
 * Une intention MÛRE : quelqu'un est entré dans l'espace et attend son scellé.
 *
 * `hasKey` à faux n'est pas une erreur — c'est un compte qui n'a pas encore
 * ouvert l'application une première fois. Rien à sceller pour l'instant, et rien
 * à signaler comme un incident.
 */
export interface PendingGrantDTO {
  inviteId: string;
  email: string;
  userId: string;
  role: 'admin' | 'member' | 'viewer';
  hasKey: boolean;
}

/**
 * Une intention IMMATURE : l'invitation d'espace est partie, personne n'a répondu.
 *
 * LE DÉFAUT QU'ELLE FERME (rapporté le 30/08). Une personne invitée depuis la
 * ligne d'invitation d'un coffre n'apparaissait NULLE PART tant qu'elle n'avait
 * pas répondu : la liste des invitations de coffre est vide (rien n'est scellé
 * avant son arrivée dans l'espace — c'est le modèle 0073, et il est juste) et la
 * liste des intentions mûres l'écarte à raison. L'hôte lisait « aucune
 * invitation » après avoir invité quelqu'un.
 *
 * PAS DE `userId`, ET CE N'EST PAS UN OUBLI : il n'existe généralement pas encore
 * de compte pour cette adresse. C'est même l'état nominal des premières heures.
 */
export interface AwaitingSpaceIntentDTO {
  /** L'invitation d'ESPACE porteuse de la promesse — ce que « Annuler » vise. */
  inviteId: string;
  email: string;
  intendedRole: 'admin' | 'member' | 'viewer';
  /** ISO8601, ou le format `datetime('now')` de SQLite : à parser avec précaution. */
  createdAt: string;
  expiresAt: string;
  /**
   * L'ÉTAT DE LA PROMESSE — `'pending'`, `'canceled'`, `'granted'`.
   *
   * Depuis le siège perdu du 30/08, cette liste ne rend plus seulement les
   * invitations qu'on attend : elle rend TOUTE invitation d'espace encore
   * vivante pour ce coffre, y compris celle dont l'accès promis a été retiré.
   * Ce sont deux situations opposées — l'une aboutira, l'autre occupe une place
   * pour rien pendant que son lien ouvre toujours l'espace — et il n'existe
   * aucun autre écran pour la révoquer.
   *
   * `undefined` sur un worker d'avant le correctif : ne se lit PAS « annulée ».
   */
  intentStatus?: string | null;
}

/** Les deux âges d'une promesse d'accès, lus d'un seul coup. */
export interface VaultAccessIntents {
  /** MÛRES : la personne est dans l'espace, il ne manque que le scellé. */
  grants: PendingGrantDTO[];
  /** EN ATTENTE DE RÉPONSE : invitée dans l'espace, elle n'y est pas encore. */
  awaitingSpace: AwaitingSpaceIntentDTO[];
}

/**
 * Les promesses d'accès de CE coffre (GET /vaults/:id/pending-grants).
 *
 * LES DEUX MOITIÉS EN UNE LECTURE, et c'est le point : elles répondent à une
 * seule question — « à qui ai-je promis ce coffre, et où en est-elle ? » — et
 * doivent dater du MÊME instant. Deux appels, et l'écran pourrait montrer la
 * même personne « en attente de sa réponse » d'un côté et « à sceller » de
 * l'autre, ce qui est la confusion même qu'on supprime.
 *
 * Réservée aux admins du coffre. Illisible n'est pas fatal : le balayage est un
 * confort, pas un chemin critique — l'invitation manuelle depuis le sélecteur
 * reste entière. `awaitingSpace` manque sur un worker d'avant cette fiche, et
 * l'absence retombe alors sur une liste vide : on ne prétend pas savoir.
 */
export async function apiListVaultAccessIntents(vaultId: string): Promise<VaultAccessIntents> {
  try {
    const { data } = await apiClient.get<ApiEnvelope<Partial<VaultAccessIntents>>>(
      `/vaults/${vaultId}/pending-grants`
    );
    return { grants: data.data?.grants ?? [], awaitingSpace: data.data?.awaitingSpace ?? [] };
  } catch {
    return { grants: [], awaitingSpace: [] };
  }
}

/**
 * Ce qui attend d'être SCELLÉ, et rien d'autre — la moitié que le balayage
 * consomme. Il n'a que faire de qui n'a pas encore répondu : il n'y a rien à
 * sceller pour quelqu'un qui n'est pas là, et lui passer la seconde liste ne
 * ferait que lui donner du travail impossible à refuser une fois par passage.
 */
export async function apiListPendingGrants(vaultId: string): Promise<PendingGrantDTO[]> {
  return (await apiListVaultAccessIntents(vaultId)).grants;
}

/**
 * L'HÔTE SE RAVISE (F04) — l'intention 0073 est annulée, l'invitation d'espace
 * reste.
 *
 * POURQUOI C'EST UN GESTE À PART. « J'ai promis un accès à cette personne » et
 * « je l'ai fait entrer dans mon espace » sont deux faits distincts, et jusqu'ici
 * seul le second était réversible. Une promesse faite par erreur — mauvaise
 * adresse, mauvais coffre, décision revue — n'avait aucune sortie : le balayage
 * la reprenait à chaque déverrouillage, indéfiniment.
 *
 * CE QU'ELLE FAIT AUSSI DEPUIS LE 30/08 : elle révoque l'invitation d'ESPACE que
 * ce même geste avait fait partir, quand celle-ci n'a pas encore été acceptée.
 * La laisser vivante était le défaut — elle occupait une place (l'écran affichait
 * « 2 sur 3 » pendant que le serveur refusait), plus aucune liste ne la montrait,
 * et son lien ouvrait toujours l'espace. `spaceInviteRevoked` dit si une place
 * vient d'être rendue, parce que c'est ce que l'hôte a besoin de lire.
 *
 * CE QU'ELLE NE FAIT TOUJOURS PAS : retirer quelqu'un DÉJÀ entré dans l'espace,
 * ni toucher à un accès déjà scellé.
 *
 * Le 404 `intent_not_found` est UNIFORME (inconnue, d'un autre coffre, déjà
 * honorée, déjà refermée des deux côtés) : la réponse ne sert jamais d'oracle,
 * et la phrase de l'écran ne prétend donc pas savoir laquelle des quatre.
 */
export interface CanceledGrantDTO {
  /** Une place vient d'être rendue : l'invitation d'espace est morte. */
  spaceInviteRevoked: boolean;
}

export async function apiCancelPendingGrant(
  vaultId: string,
  inviteId: string
): Promise<CanceledGrantDTO> {
  try {
    const { data } = await apiClient.post<{ success: boolean; spaceInviteRevoked?: boolean }>(
      `/vaults/${vaultId}/pending-grants/${inviteId}/cancel`,
      {}
    );
    // Un worker d'avant le correctif ne dit rien : on n'annonce pas une place
    // rendue qu'on n'a pas vue revenir.
    return { spaceInviteRevoked: data?.spaceInviteRevoked === true };
  } catch (e) {
    throwWithCode(e, 'intent_cancel_failed');
    // `throwWithCode` lève toujours ; TypeScript veut néanmoins une sortie.
    throw e;
  }
}

/**
 * Occupancy + entitlement of the shared space (GET /vaults/seats).
 *
 * `memberLimit` / `membersUsed` are the PERSONAL-space ceiling (null for a real org,
 * whose ceiling is its purchased seats). They exist so the UI can say "3 of 3" and
 * offer the upgrade BEFORE an invitation is refused, rather than only after.
 *
 * `membersUsed` EST CE QUE LA GARDE COMPTE : membres actifs + invitations d'espace
 * encore vivantes (`activeMembers + pendingInvites`). Il ne rendait que les membres
 * jusqu'au 30/08, et c'est ce désaccord qui affichait « 2 personnes sur 3 » avec un
 * bouton Inviter actif, pour un refus « votre offre est pleine » APRÈS le clic. Les
 * deux nombres du détail sont là pour l'EXPLIQUER — « 2 membres et 1 invitation en
 * attente » — et pour nommer la sortie immédiate : annuler l'invitation.
 * `undefined` sur un worker plus ancien : « je ne sais pas », jamais « zéro ».
 */
export interface VaultSeatsDTO {
  seats: number;
  viewers: number;
  seatsPurchased: number;
  tier: string;
  isPersonal?: boolean;
  entitled?: boolean;
  memberLimit?: number | null;
  membersUsed?: number | null;
  activeMembers?: number | null;
  pendingInvites?: number | null;
  pooledStorageLimit?: number;
  pooledStorageUsed?: number;
}

export async function apiGetVaultSeats(): Promise<VaultSeatsDTO | null> {
  try {
    const { data } = await apiClient.get<ApiEnvelope<VaultSeatsDTO>>('/vaults/seats');
    return data.data ?? null;
  } catch {
    // Occupancy is advisory: never let it break the screen it decorates.
    return null;
  }
}

/**
 * Accepte une invitation de coffre. Le locataire vient de l'en-tête X-Org-Id, que
 * `rememberVaultOrg(vaultId, orgId)` doit avoir posé AVANT l'appel : un coffre
 * jamais listé n'est dans aucun index, et la requête partirait sinon contre notre
 * propre espace (404 vault_not_found).
 *
 * La classification est obligatoire ici comme chez les voisins : sans elle axios
 * aplatit le refus en « Request failed with status code 403 » et l'écran
 * d'acceptation ne peut plus distinguer une invitation expirée d'une adresse qui
 * ne correspond pas — les deux seules choses que l'utilisateur peut corriger.
 *
 * LE REPLI EST CELUI DE L'INCONNU, jamais `invite_invalid`. Ce repli ne sert que
 * lorsque la classification RENONCE — c'est-à-dire quand on ne sait rien. Or
 * `invite_invalid` est un verdict du serveur qui dit « ce jeton n'existe plus » :
 * le fabriquer sur une ignorance faisait effacer par l'écran d'acceptation une
 * invitation parfaitement vivante. Même règle que la branche ESPACE.
 */
export async function apiJoinVault(vaultId: string, token: string): Promise<{ role: string }> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<{ vaultId: string; role: string }>>(
      `/vaults/${vaultId}/join`,
      { token }
    );
    return { role: data.data?.role ?? 'member' };
  } catch (e) {
    throwWithCode(e, UNKNOWN_FAILURE_CODE);
  }
}

/**
 * Aperçu PUBLIC d'une invitation d'espace (GET /org/invitations/:token) : nom de
 * l'espace + rôle, sans session. Sert à dire ce qu'on rejoint AVANT de le
 * rejoindre, y compris quand on n'est pas encore connecté.
 *
 * L'ADRESSE INVITÉE EST REMAPPÉE, ET C'EST DÉLIBÉRÉ. Le Worker l'appelle `email`
 * — le nom qu'ont déjà ses autres charges utiles d'invitation, que renommer
 * casserait. Ici elle devient `invitedEmail` : à côté de l'adresse du compte
 * connecté, un champ nommé `email` ne dit pas DE QUI il parle, et c'est
 * précisément la confusion que cet écran existe pour lever. Sans ce remappage la
 * ligne « Envoyée à … » ne s'affichait jamais et la garde de poste partagé ne
 * pouvait rien comparer : le champ était rendu tel quel, donc toujours absent.
 *
 * Le nom du coffre, lui, n'a toujours aucun équivalent — il est chiffré de bout
 * en bout et le serveur ne l'a pas. L'ADRESSE INVITÉE, elle, en a désormais un :
 * `apiGetVaultInvitationPreview`, plus bas.
 */
export interface OrgInvitationPreview {
  orgName: string | null;
  role: string;
  invitedEmail?: string;
}

/** Ce que la route rend réellement, avant remappage. */
interface OrgInvitationPreviewDTO {
  orgName: string | null;
  role: string;
  email?: string;
}

export async function apiGetOrgInvitationPreview(
  token: string
): Promise<OrgInvitationPreview | null> {
  try {
    const { data } = await apiClient.get<ApiEnvelope<OrgInvitationPreviewDTO>>(
      `/org/invitations/${encodeURIComponent(token)}`
    );
    const preview = data.data;
    if (!preview) return null;
    return {
      orgName: preview.orgName ?? null,
      role: preview.role,
      invitedEmail: preview.email,
    };
  } catch {
    // Un aperçu est un ornement : son échec ne doit jamais empêcher d'essayer
    // d'accepter, seul le serveur tranche à l'acceptation.
    return null;
  }
}

/**
 * Aperçu PUBLIC d'une invitation de COFFRE
 * (GET /vaults/invites/:token/preview) : à quelle adresse a-t-elle été envoyée,
 * et pour quel rôle. Rien d'autre.
 *
 * LE DÉFAUT QUE CECI FERME. L'invitation d'espace a son aperçu public depuis
 * toujours ; celle de coffre n'en avait aucun — le nom du coffre étant chiffré,
 * rien n'avait été prévu. Conséquence : quelqu'un qui possède plusieurs comptes
 * (un perso, un pro : le cas ORDINAIRE) cliquait, appuyait sur « Accepter », et
 * n'apprenait qu'ENSUITE, par un 403 `invite_email_mismatch`, qu'il s'était
 * trompé de compte. L'adresse invitée est publique pour qui tient le jeton —
 * c'est le raisonnement, mot pour mot, de l'aperçu d'espace — et la servir avant
 * le geste ne coûte donc aucun secret.
 *
 * MÊME TOLÉRANCE QUE L'APERÇU D'ESPACE : un échec rend `null` et n'empêche
 * JAMAIS d'essayer d'accepter. Hors ligne, sous plafond de requêtes (429) ou
 * derrière un défi d'infrastructure, l'écran doit continuer de proposer
 * « Accepter » et laisser le serveur trancher — conclure d'un silence que
 * l'adresse ne correspond pas enfermerait quelqu'un qui a le bon compte.
 *
 * UNE SEULE EXCEPTION, ET ELLE EST UN FAIT AFFIRMÉ : le 410 `invite_expired`.
 * Le serveur y dit que l'invitation a expiré — pas qu'il n'a pas pu répondre.
 * Le rendre permet à l'écran de le dire AVANT le geste (« demandez-en une
 * nouvelle ») au lieu de faire vivre l'acceptation entière pour en arriver au
 * même refus. `invite_invalid` (404/409) n'est délibérément PAS distingué : le
 * Worker confond volontairement « inconnue » et « consommée ou révoquée », et
 * ce n'est pas ici qu'on inventerait la nuance.
 */
export interface VaultInvitationPreview {
  invitedEmail: string | null;
  role: string | null;
  /** Le serveur a affirmé que l'invitation a expiré (410). */
  expired?: boolean;
}

/** Ce que la route rend réellement, avant remappage. */
interface VaultInvitationPreviewDTO {
  email?: string;
  role?: string;
}

export async function apiGetVaultInvitationPreview(
  token: string
): Promise<VaultInvitationPreview | null> {
  try {
    const { data } = await apiClient.get<ApiEnvelope<VaultInvitationPreviewDTO>>(
      `/vaults/invites/${encodeURIComponent(token)}/preview`
    );
    const preview = data.data;
    if (!preview) return null;
    // Même remappage que l'aperçu d'espace, et pour la même raison : à côté de
    // l'adresse du compte connecté, un champ nommé `email` ne dit pas DE QUI il
    // parle — et c'est précisément la confusion que cet écran existe pour lever.
    return { invitedEmail: preview.email ?? null, role: preview.role ?? null };
  } catch (e) {
    if (serverErrorCode(e) === 'invite_expired') {
      return { invitedEmail: null, role: null, expired: true };
    }
    return null;
  }
}

export async function apiLeaveVault(vaultId: string): Promise<void> {
  try {
    await apiClient.delete(`/vaults/${vaultId}/members/me`);
  } catch (e) {
    // `last_owner` doit ARRIVER à l'écran : sans ce relais, le seul utilisateur
    // qui puisse recevoir ce refus lisait « Impossible de quitter le coffre » et
    // se croyait devant une panne, alors que la réponse lui disait quoi faire.
    throwWithCode(e, 'leave_failed');
  }
}

/**
 * Ce que le geste RACONTE, quand le serveur ne peut pas le deviner.
 *
 * L'icône et la couleur PARTAGÉES d'un coffre voyagent dans la même enveloppe
 * scellée que son nom : côté serveur, renommer et repeindre sont le même couple
 * opaque. Le fil d'activité annonçait donc « a renommé le coffre » à chaque
 * changement de couleur, sous les yeux de tous les membres. Le serveur ne
 * PEUT pas trancher — il ne déchiffre rien : c'est le client qui le dit.
 *
 * Contrat : `PATCH /vaults/:id` accepte `change` (`'name'` par défaut) et écrit
 * `vault.rename` ou `vault.appearance` au journal
 * (`infra/cloudflare-worker/docs/CHANGES-2026-09.md`, §2).
 */
export type VaultPatchChange = 'name' | 'appearance';

/**
 * Renommer un coffre — ou le repeindre. Le nom part CHIFFRÉ : le serveur ne
 * range qu'un couple opaque, comme à la création.
 *
 * `change` est OMIS quand il vaut `'name'`, et ce n'est pas de la coquetterie :
 * un serveur qui n'a pas encore cet incrément reçoit alors exactement le corps
 * d'avant. Un `change: 'appearance'` envoyé à un tel serveur est ignoré comme
 * n'importe quel champ inconnu — le geste aboutit, seul le récit reste celui
 * d'avant. Aucun des deux sens ne casse.
 */
export async function apiRenameVault(
  vaultId: string,
  nameEncrypted: string,
  nameIv: string,
  change: VaultPatchChange = 'name'
): Promise<void> {
  try {
    await apiClient.patch(`/vaults/${vaultId}`, {
      nameEncrypted,
      nameIv,
      ...(change === 'name' ? {} : { change }),
    });
  } catch (e) {
    throwWithCode(e, 'rename_failed');
  }
}

/**
 * Changer le rôle d'un membre — sans rotation, donc sans lui coûter son
 * historique. Le seul contournement d'avant (retirer puis réinviter) faisait
 * tourner la clé et rendait illisible pour lui tout ce qui existait avant.
 */
export async function apiSetVaultMemberRole(
  vaultId: string,
  userId: string,
  role: 'admin' | 'member' | 'viewer'
): Promise<void> {
  try {
    await apiClient.patch(`/vaults/${vaultId}/members/${userId}`, { role });
  } catch (e) {
    throwWithCode(e, 'role_change_failed');
  }
}

/**
 * Supprimer un coffre (propriétaire du coffre uniquement).
 *
 * RÉVERSIBLE, ET C'EST TOUT L'INTÉRÊT. Le serveur pose `revoked_at` : l'accès
 * tombe dans la seconde — la primitive d'accès filtre les révoqués, donc les
 * vingt et une routes répondent 404 — mais rien n'est détruit avant l'expiration
 * du délai de grâce, que la réponse date explicitement. Passé ce délai, une
 * tâche périodique purge les octets R2 puis la ligne.
 *
 * Rend la date jusqu'à laquelle `apiRestoreVault` peut encore rétracter le geste.
 */
export async function apiDeleteVault(vaultId: string): Promise<{ restorableUntil: string | null }> {
  try {
    const { data } = await apiClient.delete<ApiEnvelope<{ restorableUntil: string }>>(
      `/vaults/${vaultId}`
    );
    return { restorableUntil: data.data?.restorableUntil ?? null };
  } catch (e) {
    throwWithCode(e, 'vault_delete_failed');
  }
}

/**
 * Transmettre la propriété d'un coffre à un membre existant.
 *
 * Le produit RÉCLAMAIT ce geste sans l'offrir : quitter un coffre dont on est le
 * dernier propriétaire est refusé avec « Transmettez la propriété à quelqu'un
 * avant de le quitter », et rien nulle part ne permettait de le faire.
 *
 * Aucune re-cryptographie : le destinataire était déjà membre, donc il détient
 * déjà sa copie scellée de K_vault. Seul le rôle change.
 */
export async function apiTransferVaultOwnership(vaultId: string, toUserId: string): Promise<void> {
  try {
    await apiClient.post(`/vaults/${vaultId}/transfer`, { toUserId });
  } catch (e) {
    throwWithCode(e, 'vault_transfer_failed');
  }
}

// ── GELER / DÉGELER (F23) ────────────────────────────────────────────────────
//
// ARCHIVER SANS SUPPRIMER. Un projet terminé n'avait aucune sortie honnête : le
// laisser ouvert, c'est accepter qu'on y écrive encore par inadvertance dans un
// coffre que plus personne ne relit ; le supprimer, c'est promettre la
// destruction de tout son contenu à échéance. Le gel est l'entre-deux que tout
// classeur physique offre : on le ferme.
//
// CE QUE LE GEL ARRÊTE, ET RIEN D'AUTRE : les écritures de CONTENU (dépôt,
// remplacement, renommage, déplacement, suppression, restauration, scellé d'un
// accès ponctuel) répondent 409 `vault_frozen`. Retirer quelqu'un, révoquer une
// invitation, renouveler la clé, changer les réglages, quitter, transmettre,
// supprimer le coffre et DÉGELER restent ouverts — sans quoi geler suffirait à
// rendre son propre accès irrévocable.
//
// LES DEUX ROUTES SONT IDEMPOTENTES et rendent l'état RELU : geler un coffre
// déjà gelé rend la date du PREMIER gel, sans réécrire ni journaliser. C'est
// cette date-là que tous les membres verront, et la fabriquer côté client
// afficherait « gelé à l'instant » sur un coffre fermé la semaine dernière.

/** Ce que `/freeze` et `/unfreeze` rendent : l'état RELU en base, jamais espéré. */
export interface VaultFreezeStateDTO {
  frozenAt: string | null;
  frozenBy: string | null;
}

/**
 * Geler le coffre (admin+). Le résultat est l'état relu : sur un coffre DÉJÀ
 * gelé, c'est la date du premier gel — et sur une course perdue (coffre révoqué
 * entre le contrôle de rôle et l'UPDATE), c'est `null`, c'est-à-dire la vérité.
 */
export async function apiFreezeVault(vaultId: string): Promise<VaultFreezeStateDTO> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<VaultFreezeStateDTO>>(
      `/vaults/${vaultId}/freeze`,
      {}
    );
    return { frozenAt: data.data?.frozenAt ?? null, frozenBy: data.data?.frozenBy ?? null };
  } catch (e) {
    throwWithCode(e, 'vault_freeze_failed');
  }
}

/**
 * Dégeler le coffre (admin+).
 *
 * NI DROIT D'ÉCRITURE NI `blockWhenFrozen` sur cette route, et c'est délibéré :
 * un coffre gelé doit pouvoir se rouvrir, sans quoi geler suffirait à se rendre
 * inaccessible à soi-même. Un gel qu'on ne peut pas défaire n'est plus un
 * rangement, c'est une perte.
 *
 * UNE RÉSERVE, ET ELLE EST RÉELLE : le routeur des coffres monte
 * `orgAuthMiddleware` sans `allowWhenFrozen`, qui refuse en 403 `org_read_only`
 * TOUTE méthode autre qu'une lecture dès que l'espace est suspendu ou sa
 * facturation arrêtée. Dégeler est un POST : sur un abonnement échu, il faudra
 * d'abord renouveler. La conséquence pratique est faible — l'espace entier est
 * de toute façon en lecture seule — mais la promesse n'est pas « quoi qu'il
 * arrive », et l'écran le dit déjà par `hostPlanLapsed`, distinct de
 * `vaultFrozen`.
 */
export async function apiUnfreezeVault(vaultId: string): Promise<VaultFreezeStateDTO> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<VaultFreezeStateDTO>>(
      `/vaults/${vaultId}/unfreeze`,
      {}
    );
    return { frozenAt: data.data?.frozenAt ?? null, frozenBy: data.data?.frozenBy ?? null };
  } catch (e) {
    throwWithCode(e, 'vault_unfreeze_failed');
  }
}

/**
 * LA CORBEILLE DES COFFRES — ce que le propriétaire a supprimé et peut reprendre.
 *
 * `apiRestoreVault` existait, sa route serveur aussi, et rien ne pouvait dire à
 * quel coffre l'adresser : la liste ordinaire écarte les supprimés. La
 * restauration était une route sans porte, pendant que l'écran de suppression et
 * le panneau des membres promettaient tous deux trente jours pour se raviser.
 */
export async function apiListDeletedVaults(): Promise<DeletedVaultDTO[]> {
  const { data } =
    await apiClient.get<ApiEnvelope<{ vaults: DeletedVaultDTO[] }>>('/vaults/deleted');
  return data.data?.vaults ?? [];
}

/**
 * Renommer un élément : réécrire sa méta SEULE, sous verrou de version.
 * Le 409 porte la version et l'élément du serveur, exactement comme le
 * remplacement de contenu — même erreur, même résolution à l'écran.
 */
export async function apiRenameVaultItem(
  vaultId: string,
  itemId: string,
  body: { expectedVersion: number; encryptedMeta: string; encryptedMetaIv: string }
): Promise<ServerVaultItemDTO | null> {
  try {
    const { data } = await apiClient.patch<ApiEnvelope<{ item: ServerVaultItemDTO | null }>>(
      `/vaults/${vaultId}/items/${itemId}/meta`,
      body
    );
    return data.data?.item ?? null;
  } catch (e) {
    maybeThrowItemConflict(e);
    throwWithCode(e, 'item_rename_failed');
  }
}

/** Rétracter une suppression tant que la purge n'est pas passée. */
export async function apiRestoreVault(vaultId: string): Promise<void> {
  try {
    await apiClient.post(`/vaults/${vaultId}/restore`, {});
  } catch (e) {
    throwWithCode(e, 'vault_restore_failed');
  }
}

/**
 * Détruire MAINTENANT un coffre déjà à la corbeille (F20, propriétaire).
 *
 * DEUX ISSUES POSITIVES, ET ELLES NE SE DISENT PAS PAREIL. `purged: true` veut
 * dire que les octets ET la ligne sont partis ; `inProgress: true` veut dire que
 * la marque de non-retour est posée — la restauration est déjà refusée — mais
 * que R2 n'a pas fini (ou qu'une autre passe s'en occupe), et que le balayage
 * terminera. Annoncer « c'est fait » dans le second cas serait faux dans le seul
 * sens qui compte : quelqu'un pourrait croire ses octets partis alors qu'ils
 * s'en vont encore.
 *
 * `vault_not_deleted` (409) est le refus attendu sur un coffre VIVANT : purger
 * n'est pas un raccourci pour supprimer, le geste reste en deux temps.
 */
export async function apiPurgeVault(
  vaultId: string
): Promise<{ purged: boolean; inProgress: boolean }> {
  try {
    const { data } = await apiClient.post<ApiEnvelope<{ purged: boolean; inProgress: boolean }>>(
      `/vaults/${vaultId}/purge`,
      {}
    );
    // ON LIT LE CHAMP QUE LA ROUTE SERT, on ne le recalcule pas. Dériver
    // `inProgress` de `!purged` réécrit le contrat côté client : le jour où la
    // route gagne un état « ni purgé ni en cours » (un refus mou, une passe
    // reportée), l'écran annoncerait « purge engagée » à tort. La dérivation
    // reste le REPLI d'une enveloppe muette, pas la lecture normale — et ce
    // repli se lit « engagée », jamais « terminée » : sur un geste sans retour,
    // l'ignorance doit pencher du côté qui ne promet rien.
    const purged = data.data?.purged === true;
    const servi = data.data?.inProgress;
    return {
      purged,
      inProgress: typeof servi === 'boolean' ? servi : !purged,
    };
  } catch (e) {
    throwWithCode(e, 'vault_purge_failed');
  }
}

// ── Removal / lazy re-key (E3-5) ─────────────────────────────────────────────

export interface VaultMemberDTO {
  userId: string;
  role: string;
  joinedAt: string;
  /** Nom d'affichage (0092) — ce qu'affichent les puces de mention et le trombinoscope. */
  displayName?: string;
  /**
   * L'adresse du membre — servie par le coffre lui-même depuis P2.
   *
   * OPTIONNELLE, ET ÇA COMPTE : un Worker d'avant cette fiche ne l'envoie pas,
   * et l'app doit continuer de retomber sur l'identifiant plutôt que d'afficher
   * « undefined ». C'est aussi ce qui rend les adresses lisibles aux membres et
   * aux lecteurs, à qui l'annuaire reste fermé.
   */
  email?: string;
  /**
   * Cette personne est-elle encore dans l'espace du coffre ? Absent d'un vieux
   * Worker — auquel cas on ne sait pas, et on n'affirme rien.
   */
  inSpace?: boolean;
  /**
   * L'ÉPOQUE DU SCELLÉ QUE LE SERVEUR GARDE POUR CETTE PERSONNE (F10).
   *
   * Servie aux ADMINISTRATEURS seulement — le worker ne l'ajoute que sur
   * demande explicite de la route. Son absence ne vaut donc PAS « à jour » :
   * elle veut dire « ce rang ne la voit pas », ou « ce worker ne la sert pas ».
   * Inférieure à l'époque courante, elle désigne quelqu'un que la dernière
   * rotation n'a pas rescellé : son coffre s'ouvre, mais les éléments récents
   * lui restent fermés — et rien d'autre ne le dit.
   */
  wrappedEpoch?: number;
}

export async function apiListVaultMembers(vaultId: string): Promise<VaultMemberDTO[]> {
  const { data } = await apiClient.get<ApiEnvelope<{ members: VaultMemberDTO[] }>>(
    `/vaults/${vaultId}/members`
  );
  return data.data?.members ?? [];
}

// ── Les agrégats d'un coffre (F07) ───────────────────────────────────────────

/**
 * L'inventaire d'un coffre : des ENTIERS et des identifiants opaques, rien de
 * plus. Aucun titre, aucun nom, aucune adresse — le serveur ne les a pas, et
 * cette route ne fait pas exception.
 *
 * LES DEUX DERNIERS CHAMPS SONT OMIS SOUS LE RANG ADMIN, jamais rendus à zéro.
 * `GET /:id/invites` exige déjà ce rang : servir le nombre à un membre lui
 * donnerait par la bande ce que la liste lui refuse. Ils sont donc OPTIONNELS
 * ici, et le seul test honnête est `'pendingInviteCount' in stats` — un `?? 0`
 * afficherait « aucune invitation en attente » à quelqu'un qui n'en sait rien.
 */
export interface VaultStatsDTO {
  storageUsedBytes: number;
  itemCount: number;
  pendingUploads: number;
  trashedCount: number;
  trashedBytes: number;
  retainedRevisionBytes: number;
  memberCount: number;
  roleCounts: { owner: number; admin: number; member: number; viewer: number };
  liveGrantCount: number;
  currentKeyEpoch: number;
  createdAt: string | null;
  ownerUserId: string | null;
  byMember: Array<{ userId: string; itemCount: number; bytes: number }>;
  byType: { note: number; file: number; transclusion: number };
  /** Admin seulement — OMIS en dessous, à tester par `in`, jamais par `?? 0`. */
  pendingInviteCount?: number;
  /** Admin seulement — même règle. */
  lapsedInviteCount?: number;
}

/**
 * Les agrégats du coffre — rang **member**, pas viewer.
 *
 * NE PAS APPELER POUR UN LECTEUR : le worker répond 403, et un refus prévisible
 * affiché comme une panne fait passer une décision pour un incident. La porte
 * est `mayReadVaultStats` (vaultStatsModel), du côté qui décide d'appeler.
 *
 * LE SEAU EST INDEXÉ SUR LE COFFRE (120/h), pas sur l'appelant : un client qui
 * rafraîchirait en boucle n'éteindrait pas son propre écran, mais celui de tous
 * les membres. D'où le plancher de trente secondes côté client, et la règle que
 * le 429 GARDE la dernière valeur au lieu de la remplacer par des zéros.
 *
 * L'échec est CLASSIFIÉ (`throwWithCode`) : sans lui, axios aplatit le 429 en
 * « Request failed with status code 429 » et l'appelant ne peut plus distinguer
 * « trop de requêtes » (garder ce qu'on affiche) d'une vraie panne.
 */
export async function apiGetVaultStats(vaultId: string): Promise<VaultStatsDTO> {
  let data: ApiEnvelope<{ stats: VaultStatsDTO }>;
  try {
    const res = await apiClient.get<ApiEnvelope<{ stats: VaultStatsDTO }>>(
      `/vaults/${vaultId}/stats`
    );
    data = res.data;
  } catch (e) {
    throwWithCode(e, 'stats_load_failed');
  }
  // Une enveloppe SANS `stats` est une panne, pas un coffre vide : rendre des
  // zéros ici inventerait un inventaire que personne n'a calculé. Le contrôle est
  // HORS du try — dedans, son `stats_malformed` retombait dans le catch et en
  // ressortait aplati en `stats_load_failed`, c'est-à-dire un diagnostic précis
  // (« le serveur n'a pas répondu ce qu'on lui demandait ») perdu en route.
  const stats = data.data?.stats;
  if (!stats) throw new Error('stats_malformed');
  return stats;
}

/** The caller's own K_vault wraps across all epochs (historical-item read). */
export async function apiGetVaultKeyWraps(
  vaultId: string
): Promise<Array<{ epoch: number; wrappedVaultKey: string }>> {
  const { data } = await apiClient.get<
    ApiEnvelope<{ keyWraps: Array<{ epoch: number; wrappedVaultKey: string }> }>
  >(`/vaults/${vaultId}/key-wraps`);
  return data.data?.keyWraps ?? [];
}

/**
 * A peer's append-only key-transparency log (E3-7), for chain verification + TOFU.
 *
 * UNE ENVELOPPE SANS `entries` EST UNE ERREUR, PAS UN JOURNAL VIDE. Le repli sur
 * `[]` transformait « le serveur n'a pas répondu ce qu'on lui demandait » en « ce
 * pair n'a pas encore de journal » — c'est-à-dire précisément le cas le plus
 * permissif de la vérification, qu'un courtier malveillant peut donc obtenir en
 * omettant un champ. Un journal réellement vide arrive comme `entries: []` et
 * reste distinct.
 */
export async function apiGetKeyLog(userId: string): Promise<KeyLogEntry[]> {
  const { data } = await apiClient.get<ApiEnvelope<{ userId: string; entries: KeyLogEntry[] }>>(
    `/account/keys/log/${userId}`
  );
  const entries = data.data?.entries;
  if (!Array.isArray(entries)) {
    throw new Error('key_log_malformed');
  }
  return entries;
}

/** Re-key the vault (epoch+1), optionally removing members. 409 on epoch conflict. */
export async function apiRotateVault(
  vaultId: string,
  body: {
    expectedPreviousEpoch: number;
    removeUserIds: string[];
    wraps: Array<{ userId: string; wrappedVaultKey: string }>;
    /**
     * Le nom du coffre rescellé sous K_vault' — chiffré sous l'ancienne clé, il
     * deviendrait illisible dès la rotation commise. Les DEUX ou AUCUN : le
     * serveur refuse la moitié du couple (400), qui n'ouvrirait rien.
     */
    nameEncrypted?: string;
    nameIv?: string;
    /**
     * Le BLOC DE RÉGLAGES (F13) rescellé sous K_vault' — même raison que le nom,
     * et même règle : les DEUX ou AUCUN. Omis quand il n'y a pas de bloc, ou
     * quand on n'a pas su le lire : le laisser sous son ancienne clé le rend
     * illisible, mais le serveur en garde l'époque et l'écran dit alors « scellé
     * sous une clé précédente : ré-enregistrez-le ». Envoyer un bloc qu'on n'a
     * pas su ouvrir écraserait, lui, ce qui est encore récupérable.
     */
    settingsEncrypted?: string;
    settingsIv?: string;
  }
): Promise<{ newEpoch: number }> {
  const { data } = await apiClient.post<ApiEnvelope<{ newEpoch: number }>>(
    `/vaults/${vaultId}/rotate`,
    body
  );
  return { newEpoch: data.data?.newEpoch ?? body.expectedPreviousEpoch + 1 };
}
