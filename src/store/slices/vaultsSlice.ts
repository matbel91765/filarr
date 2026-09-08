/**
 * vaultsSlice.ts (E3-3b) — renderer state for shared team vaults (E2EE).
 *
 * Holds only DECRYPTED METADATA (vault names, item titles/filenames) and opaque
 * wraps — never raw keys. K_vault lives in vaultKeyCache (module memory, purged on
 * lock); K_item is derived on demand from an item's wrapped_item_key and discarded.
 * This slice is BLACKLISTED from redux-persist (store/index.ts): vault content is
 * E2EE with the cloud as source of truth, so its plaintext metadata must never be
 * written to local persisted storage.
 *
 * Architecture (decision): vault content lives HERE, separate from notesSlice /
 * the local notes.db. Transclusion reads it through a unified selector (E3-3c).
 */

import { rememberExclusion, loadShareIntents } from '../../services/vault/shareIntentStore';
import {
  planVaultCatchUp,
  type CatchUpItem,
  type FolderShareIntent,
} from '../../services/vault/folderGrantPlan';
import {
  createSlice,
  createAction,
  createAsyncThunk,
  createSelector,
  type PayloadAction,
  type ThunkDispatch,
  type UnknownAction,
} from '@reduxjs/toolkit';
import {
  buildVaultCreatePayload,
  decryptVaultBlob,
  decryptVaultName,
  encryptVaultBlob,
  encryptVaultName,
  generateVaultKey,
  generateItemKey,
  wrapItemKey,
  unwrapItemKey,
  encryptItemChunk,
  decryptItemChunk,
  encryptItemMeta,
  decryptItemMeta,
  wrapVaultKeyForMember,
  wrapItemKeyForRecipient,
  type MemberPublicKey,
} from '../../services/vault/vaultCrypto';
import {
  unlockVault,
  getVaultKey,
  isVaultUnlocked,
  lockVault,
} from '../../services/vault/vaultKeyCache';
import {
  decodeVaultName,
  encodeVaultName,
  normalizeVaultAppearance,
  type VaultAppearance,
} from '../../services/vault/vaultNameEnvelope';
import { purgeVaultCollab } from '../../services/collab/collabSession';
import { getOwnPublicKey, hasUserKeypair } from '../../services/auth/userKeypair';
import {
  forgetVaultOrg,
  getOrgContextId,
  getRememberedVaultOrg,
  rememberVaultOrg,
} from '../../services/network/apiClient';
import { UNKNOWN_FAILURE_CODE } from '../../services/vault/vaultErrorMessages';
import { fetchOrgs, ensurePersonalSpace } from './orgSlice';
import { selectPersonalOrgId, selectSharedVaultOrgIds } from '../selectors/authSelectors';
import type { RootState } from '../index';
import { CHUNK_SIZE } from '../../services/crypto/chunkPipeline';
import { lockApp, clearCloudAuth } from './authSlice';
import { checkPeerKeyTransparency, getTofuFingerprint } from '../../services/vault/keyTransparency';
import {
  apiListVaults,
  apiCreateVault,
  apiListVaultItems,
  apiCreateVaultItem,
  apiUploadVaultItemChunk,
  apiFinalizeVaultItem,
  apiDownloadVaultItemChunk,
  apiDeclareVaultItemRevision,
  apiUploadVaultItemRevisionChunk,
  apiUpdateVaultItem,
  apiDeleteVaultItem,
  apiDeleteVault,
  apiListDeletedVaults,
  apiRestoreVault,
  apiListVaultItemRevisions,
  apiRenameVault,
  apiRenameVaultItem,
  apiDownloadVaultRevisionChunk,
  type VaultItemRevisionDTO,
  VaultItemVersionConflictError,
  apiGetMemberPublicKey,
  apiGetKeyLog,
  apiInviteVaultMember,
  apiAddVaultMember,
  apiJoinVault,
  apiLeaveVault,
  apiListVaultMembers,
  apiGetVaultKeyWraps,
  apiGetVaultSettings,
  apiRotateVault,
  classifyVaultFailure,
  apiListMyInvitations,
  apiListPendingGrants,
  apiListVaultGrants,
  type VaultGrantDTO,
  apiAcceptMyInvitation,
  apiDeclineMyInvitation,
  apiCreateItemGrant,
  apiListItemGrants,
  apiRevokeItemGrant,
  apiRewrapItemGrant,
  apiRewrapVaultItems,
  type RewrapItemEntry,
  GrantSetMismatchError,
  type ItemGrantDTO,
  type MyInvitationDTO,
  type AwaitingHostDTO,
  type ServerVaultDTO,
  type ServerVaultItemDTO,
  apiGetVaultActivityHeads,
  type VaultActivityHeadDTO,
} from '../../services/vault/vaultApi';
import { clearPendingInvite, readPendingInvites } from '../../services/invites/pendingInvite';
import {
  runGrantSweep,
  canGrantIn,
  type BlockedEntry,
} from '../../services/vault/pendingGrantSweep';
import { verifyPeerKey } from '../../services/vault/peerVerification';
// Le modèle du fil et son curseur « vu » sont PURS (aucun React, aucun réseau) :
// le sélecteur de pastille les lit d'ici sans faire remonter localStorage dans
// l'état — voir `selectUnseenVaultIds`.
import { unseenVaultIds } from '../../renderer/components/vaults/vaultActivityModel';
import { planRewrap } from '../../renderer/components/vaults/settings/rewrapPlan';
import { getSeenCursor } from '../../renderer/components/vaults/vaultActivitySeen';
import { reportToLog } from '../../services/platform/reportToLog';

// Plaintext bytes per chunk — the single shared pipeline constant (E3-6).
const ITEM_CONTENT_CHUNK_SIZE = CHUNK_SIZE;

export type VaultItemKind = 'note' | 'file' | 'transclusion';

export interface VaultItemMeta {
  title?: string;
  fileName?: string;
  mime?: string;
  /** Chemin du dossier CONTENANT, chiffré dans la méta — jamais vu du serveur.
   *  Grammaire et arbre : services/vault/vaultPaths.ts. Absent = racine. */
  path?: string;
  /** Élément MARQUEUR d'un dossier (vide compris) : caché de la liste, rangé
   *  dans meta.path, nommé par meta.title. itemType reste 'note' (0 chunk). */
  folderMarker?: boolean;
  /** Session d'édition (confort phase 3) — CHIFFRÉE sous K_item comme le reste
   *  de la méta ; héritée par la révision conservée via l'INSERT…SELECT du
   *  commit ; JAMAIS envoyée en clair. STRIPPÉE par défaut à la frontière des
   *  thunks : seuls VaultNoteEditor et PluginEditorModal la posent, via l'arg
   *  dédié `editSession` — un spread de méta ne la fait JAMAIS voyager. */
  editSession?: { id: string; at: number; participants: string[] };
  [key: string]: unknown;
}

export interface VaultSummary {
  id: string;
  organizationId: string;
  ownerUserId: string | null;
  /** Decrypted client-side. Empty string if the vault couldn't be unlocked. */
  name: string;
  currentKeyEpoch: number;
  /**
   * L'époque du wrap que NOUS détenons. Inférieure à `currentKeyEpoch` quand une
   * rotation est passée sans que personne ne nous ait re-scellé la clé : un état
   * dont le cadenas seul ne dit rien, et que l'écran confondait avec un coffre
   * simplement verrouillé.
   */
  wrappedVaultKeyEpoch: number;
  role: string;
  createdAt: string;
  /**
   * L'apparence PARTAGÉE du coffre (F14) : emoji, couleur, icône, rangés dans
   * l'enveloppe de `name_encrypted` et donc chiffrés sous K_vault comme le nom.
   * Absente pour tout coffre qui n'en a pas — l'immense majorité, et tous ceux
   * d'avant la fiche. La personnalisation « pour moi » vit ailleurs
   * (`vaultAppearanceLocal`) : elle ne doit jamais être scellée pour autrui.
   */
  appearance?: VaultAppearance;
  /**
   * LE GEL (F23) — le coffre est en LECTURE SEULE, pour tout le monde.
   *
   * IL VIT DANS LE RÉSUMÉ, ET PAS DANS UN CHARGEUR D'ÉCRAN, parce qu'il change
   * ce que TROIS surfaces ont le droit de proposer : l'explorateur (les boutons
   * d'écriture), la page de gestion (son bandeau et son interrupteur), et la
   * matrice des menus contextuels. Le lire trois fois, ce serait trois vérités
   * possibles au même instant sur un fait qui décide de la disparition de
   * boutons.
   *
   * `null` = pas gelé, et c'est le serveur qui l'affirme (`toVaultDTO` pose
   * `?? null` plutôt que d'omettre la clé). ABSENT vaut aussi « pas gelé » —
   * même discipline que `itemDeleteRequiresAdmin` dans la matrice des menus :
   * ne jamais RETIRER un geste sur une ignorance. Un worker d'avant 0079, ou un
   * résumé fabriqué par un test, se comporte donc comme avant la fiche, et le
   * serveur garde le dernier mot avec sa phrase (`vault_frozen`).
   *
   * `frozenBy` est un identifiant OPAQUE — l'écran le résout par le
   * trombinoscope, jamais par le serveur.
   */
  frozenAt?: string | null;
  frozenBy?: string | null;
  /**
   * QUI M'A FAIT ENTRER — identifiant OPAQUE de l'auteur de MON adhésion.
   *
   * Sert au bandeau « X vous a donné accès à … » de l'accueil : depuis l'ajout
   * direct (F06), on devient membre sans rien accepter, donc sans qu'aucune
   * invitation ne porte le nom de l'hôte. L'adresse, elle, se résout par le
   * trombinoscope, jamais ici — et quand rien ne se résout, la phrase se passe
   * de nom plutôt que d'en deviner un.
   */
  invitedBy?: string | null;
}

/** Un coffre à la corbeille, avec la date au-delà de laquelle il n'y sera plus. */
export interface DeletedVaultSummary extends VaultSummary {
  deletedAt: string | null;
  restorableUntil: string | null;
}

export interface VaultItemSummary {
  id: string;
  vaultId: string;
  ownerUserId: string | null;
  itemType: string;
  /** Decrypted item metadata (title / filename / mime …). */
  meta: VaultItemMeta;
  /** Opaque wrap kept so the content can be downloaded + decrypted on demand. */
  wrappedItemKey: string;
  wrappedUnderEpoch: number;
  totalChunks: number;
  sizeBytes: number;
  status: string;
  /** Server version to echo back when saving — the optimistic-concurrency guard. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function toVaultSummary(dto: ServerVaultDTO): Promise<VaultSummary> {
  // Pin the tenant this vault was found in, so every later call about it is scoped
  // to that space and not to whichever one happens to be ambient.
  rememberVaultOrg(dto.id, dto.organizationId);
  let name = '';
  /**
   * L'APPARENCE VOYAGE DANS LE NOM (F14). `name_encrypted` porte soit un nom nu
   * (tous les coffres d'avant la fiche, et tous ceux qui n'ont pas d'apparence),
   * soit une enveloppe JSON versionnée. Le décodage est TOLÉRANT par
   * construction — il ne lève jamais et rend le texte entier comme nom quand il
   * ne reconnaît pas d'enveloppe — sans quoi un nom qui commence par une
   * accolade ferait afficher « Verrouillé » sur un coffre parfaitement lisible.
   */
  let appearance: VaultAppearance | undefined;
  try {
    // The membership wrap is the CURRENT-epoch K_vault; cache it under its epoch.
    const kVault = await unlockVault(dto.id, dto.wrappedVaultKeyEpoch, dto.wrappedVaultKey);
    const enveloppe = decodeVaultName(
      await decryptVaultName(dto.nameEncrypted, dto.nameIv, kVault)
    );
    name = enveloppe.name;
    appearance = enveloppe.appearance;
  } catch (err) {
    // Couldn't unlock (locked / no keypair / substituted key) — surface the vault
    // without a name rather than dropping it; the UI prompts to unlock. E3-8 may
    // distinguish a benign locked state from an integrity failure (VaultKeyError).
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[vaults] could not unlock/decrypt vault ${dto.id}:`, err);
    }
    name = '';
    appearance = undefined;
  }
  return {
    id: dto.id,
    organizationId: dto.organizationId,
    ownerUserId: dto.ownerUserId,
    name,
    ...(appearance ? { appearance } : {}),
    currentKeyEpoch: dto.currentKeyEpoch,
    wrappedVaultKeyEpoch: dto.wrappedVaultKeyEpoch,
    role: dto.role,
    createdAt: dto.createdAt,
    /**
     * LE GEL (F23). `?? null` et non `dto.frozenAt` nu : un worker d'avant 0079
     * n'envoie pas le champ, et laisser passer `undefined` mettrait dans l'état
     * une troisième valeur (« on ne sait pas ») que rien ne sait afficher. Ici,
     * ne pas savoir se comporte comme « pas gelé » — c'est le comportement
     * d'avant la fiche, et le serveur garde le dernier mot avec sa phrase
     * (`vault_frozen`, déjà traduite).
     */
    frozenAt: dto.frozenAt ?? null,
    frozenBy: dto.frozenBy ?? null,
    // `?? null` pour la même raison : un worker antérieur n'envoie pas le champ,
    // et « on ne sait pas qui » doit se comporter comme « personne de nommé ».
    invitedBy: dto.invitedBy ?? null,
  };
}

async function toItemSummary(dto: ServerVaultItemDTO, vaultId: string): Promise<VaultItemSummary> {
  // The item's K_item is wrapped under K_vault of the item's OWN epoch (which may
  // be older than the current one, after a lazy re-key). Resolve that epoch's key.
  const kVault = getVaultKey(vaultId, dto.wrappedUnderEpoch);
  if (!kVault) throw new Error(`No K_vault cached for epoch ${dto.wrappedUnderEpoch}`);
  let meta: VaultItemMeta = {};
  const kItem = await unwrapItemKey(dto.wrappedItemKey, kVault);
  try {
    meta = await decryptItemMeta<VaultItemMeta>(dto.encryptedMeta, dto.encryptedMetaIv, kItem);
  } finally {
    kItem.fill(0);
  }
  return {
    id: dto.id,
    vaultId: dto.vaultId,
    ownerUserId: dto.ownerUserId,
    itemType: dto.itemType,
    meta,
    wrappedItemKey: dto.wrappedItemKey,
    wrappedUnderEpoch: dto.wrappedUnderEpoch,
    totalChunks: dto.totalChunks,
    sizeBytes: dto.sizeBytes,
    status: dto.status,
    version: dto.version ?? 1,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

// ── Thunks ───────────────────────────────────────────────────────────────────

// E4-2 escrow: record a recovery copy of each unlocked vault's key — once per (org, vault, epoch)
// per session. Best-effort + fire-and-forget: a no-op unless the org has escrow on AND this member
// consented (the Worker re-checks both + vault membership), and it never blocks or fails a load.
const escrowRecorded = new Set<string>();
async function recordEscrowCopies(
  orgId: string | null,
  vaults: { id: string; currentKeyEpoch: number }[],
  unlockedIds: string[]
): Promise<void> {
  if (!orgId) return;
  try {
    const { apiGetOrgPublicKey } = await import('../../services/org/orgKeysApi');
    const pub = await apiGetOrgPublicKey(orgId).catch(() => null);
    if (!pub || pub.escrowPolicy === 'off') return;
    const { recordVaultRecoveryCopy } = await import('../../services/org/orgKeySync');
    const unlocked = new Set(unlockedIds);
    for (const v of vaults) {
      if (!unlocked.has(v.id)) continue;
      const k = `${orgId}|${v.id}|${v.currentKeyEpoch}`;
      if (escrowRecorded.has(k)) continue;
      const kVault = getVaultKey(v.id, v.currentKeyEpoch);
      if (!kVault) continue;
      escrowRecorded.add(k);
      void recordVaultRecoveryCopy(orgId, v.id, kVault, v.currentKeyEpoch).catch(() => undefined);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Lock ONE vault — key cache AND live collaboration, always together.
 *
 * `lockVault` alone only zeroes K_vault. A live room keyed on that same K_vault
 * would keep relaying the contents of a vault we just declared closed, and its
 * derived room key would survive in memory — the exact opposite of what the
 * collab key module promises. Every path that locks a vault goes through here.
 */
function lockVaultEverywhere(vaultId: string): void {
  lockVault(vaultId);
  try {
    purgeVaultCollab(vaultId);
  } catch {
    /* la collaboration ne doit jamais empêcher un verrouillage */
  }
}

/**
 * The tenants to list vaults from: ours, plus every space that invited us.
 *
 * An account can legitimately know of NONE — not because anything failed, but because
 * its personal space was never created (auto-provisioning at register postdates the
 * account, and the backfill missed it). That is not a reason to refuse: it is a reason
 * to create it. So the ladder is refresh → provision → refresh, and only a step that
 * the SERVER refuses stops it, carrying its own reason (upgrade_required for a plan
 * that doesn't include shared vaults, network_unavailable when nothing answered).
 *
 * Throws the canonical code; returns the tenant list otherwise (possibly relying on
 * the ambient context, which is right for a single-space user).
 */
async function resolveVaultTenants(
  getState: () => unknown,
  // The thunkAPI's own dispatch type, not AppDispatch: this module is one of the
  // slices the store is BUILT from, so borrowing the assembled store's type here
  // would be circular. It only ever dispatches two thunks, and this accepts both.
  dispatch: ThunkDispatch<unknown, unknown, UnknownAction>
): Promise<string[]> {
  // What ends the ladder is holding a space OF OUR OWN — `selectPersonalOrgId`
  // demands role 'owner' — not merely knowing SOME tenant. Being a guest in
  // someone else's space also fills the tenant list, and stopping there would skip
  // provisioning for exactly the population this exists for: an account with no
  // space of its own that happens to have been invited somewhere. It would then
  // create its vault against the ambient context, the Worker's silent fallback
  // would file it under a space the client never learns, and the next refresh
  // would find it outside `liveIds` and lock it away.
  const ownTenant = (): boolean =>
    selectPersonalOrgId(getState() as RootState) !== null || !!getOrgContextId();

  let orgIds = selectSharedVaultOrgIds(getState() as RootState);
  if (ownTenant()) return orgIds;

  // Boot race, or a session that just came back online — re-read before concluding.
  await dispatch(fetchOrgs());
  orgIds = selectSharedVaultOrgIds(getState() as RootState);
  if (ownTenant()) return orgIds;

  // Genuinely no space. Create it (idempotent, tier-gated on the server), which also
  // refreshes the org list so the invite picker and the roster have their tenant too.
  const outcome = await dispatch(ensurePersonalSpace());
  if (outcome.meta.requestStatus === 'rejected') {
    // A guest with no space of their own is a legitimate, fully working state: the
    // vaults shared with them live in the HOST's space, and the free plan is exactly
    // what an invited guest is expected to be on. Refusing here would hide the very
    // invitation they were given. Only a caller with nowhere at all to look fails —
    // and creating still refuses server-side, with its own reason.
    if (orgIds.length > 0) return orgIds;
    throw new Error(String(outcome.payload ?? 'shared_vault_no_context'));
  }
  orgIds = selectSharedVaultOrgIds(getState() as RootState);
  if (orgIds.length === 0 && !getOrgContextId()) throw new Error('shared_vault_no_context');
  return orgIds;
}

/** List the caller's vaults in the active org, unlocking + decrypting each name. */
export const loadVaults = createAsyncThunk(
  'vaults/load',
  async (_: void, { getState, dispatch, rejectWithValue }) => {
    try {
      const orgIds = await resolveVaultTenants(getState, dispatch);
      const prevIds = (getState() as { vaults: VaultsState }).vaults.vaultIds;
      // ONE list out of ALL of them — the user is never told there is more than one
      // space. A space that fails is skipped rather than blanking the others; only an
      // across-the-board failure is an error.
      const results = await Promise.allSettled(
        orgIds.length > 0 ? orgIds.map((id) => apiListVaults(id)) : [apiListVaults()]
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      if (ok.length === 0) {
        throw (results[0] as PromiseRejectedResult).reason;
      }
      const dtos = ok.flatMap((r) => (r as PromiseFulfilledResult<ServerVaultDTO[]>).value);
      const vaults = await Promise.all(dtos.map(toVaultSummary));
      const liveIds = new Set(vaults.map((v) => v.id));
      // Forward-only revocation: a vault we no longer belong to (admin removal / lazy
      // re-key) must stop resolving. Zero its cached K_vault here (side effect kept out
      // of the reducer); the reducer prunes the decrypted bodies/metadata it leaves.
      for (const id of prevIds) if (!liveIds.has(id)) lockVaultEverywhere(id);
      const unlockedIds = vaults
        .filter((v) => isVaultUnlocked(v.id, v.currentKeyEpoch))
        .map((v) => v.id);
      const orgId =
        (getState() as { org?: { currentOrgId?: string | null } }).org?.currentOrgId ?? null;
      void recordEscrowCopies(orgId, vaults, unlockedIds);
      // La liste `unlockedIds` vaut ce que vaut la paire de clés à CET instant :
      // chargée avant le mot de passe, elle est vide sans que rien ne soit faux.
      // On le dit dans le résultat pour que la garde d’`ensureVaultsLoaded`
      // sache qu’un rechargement s’impose dès que la clé arrive.
      // TOUJOURS dire ce qui a été chargé — pas seulement les échecs. Un
      // chargement qui RÉUSSIT avec zéro coffre est indiscernable, à l'écran,
      // d'un chargement jamais parti : deux soirées de diagnostic à l'aveugle
      // (2026-09-01) faute de cette ligne. Identifiants d'espaces tronqués :
      // c'est un journal, pas un inventaire.
      reportToLog(
        'vaults',
        `chargement OK : ${vaults.length} coffre(s) via ${
          orgIds.length > 0 ? orgIds.map((o) => o.slice(0, 8)).join(',') : 'contexte ambiant'
        } (clés: ${hasUserKeypair() ? 'oui' : 'pas encore'})`
      );
      return { vaults, unlockedIds, hadKeypair: hasUserKeypair() };
    } catch (e) {
      // Classify BEFORE falling back to the message: what the screen says next has to
      // match what actually went wrong. resolveVaultTenants already throws canonical
      // codes, so its own messages pass through untouched.
      return rejectWithValue(
        classifyVaultFailure(e) ?? (e as Error).message ?? 'Failed to load vaults'
      );
    }
  }
);

/**
 * LE PREMIER CHARGEMENT DE LA SESSION — une seule fois, quel que soit le nombre
 * d'écrans qui le réclament.
 *
 * POURQUOI ICI ET PAS DANS LES COMPOSANTS. La garde « une tentative par montage »
 * vivait en trois exemplaires (l'accueil, le hook des cibles d'ajout, la vue des
 * coffres), chacun avec sa propre ref : trois gardes indépendantes, c'est trois
 * requêtes identiques au premier rendu, dont aucune ne voit encore le résultat
 * des autres. La mémoire de « a-t-on déjà demandé ? » est un fait de SESSION,
 * pas de composant — elle vit donc dans l'état, où elle est unique, et où la
 * déconnexion (`clearCloudAuth`) la remet à zéro avec le reste.
 *
 * LE DRAPEAU EST POSÉ PAR `pending`, le nôtre ET celui de `loadVaults` : un
 * « Réessayer » explicite compte comme une demande, et deux `ensure` dispatchés
 * dans le même tick ne passent pas tous deux la `condition` — le premier pose
 * le drapeau de façon synchrone avant que le second ne soit évalué.
 *
 * `loadVaults` nu reste le geste des relances explicites (« Réessayer », après
 * une jointure, une rotation…) : lui n'a aucune garde, et c'est voulu.
 */
export const ensureVaultsLoaded = createAsyncThunk(
  'vaults/ensureLoaded',
  async (_: void, { dispatch }) => {
    await dispatch(loadVaults());
  },
  {
    condition: (_arg, { getState }) => {
      const v = (getState() as { vaults: VaultsState }).vaults;
      if (!v.initialLoadRequested) return true;
      // LE CAS QUI RENDAIT UN COFFRE « VERROUILLÉ » APRÈS LE MOT DE PASSE. Le
      // premier chargement part au démarrage (VaultsBootstrapHost), souvent AVANT
      // que la paire de clés soit en mémoire : K_vault n’a pas pu être déballée,
      // et la garde « déjà demandé » interdisait ensuite tout rechargement — seul
      // le « Réessayer » (loadVaults nu) ouvrait le coffre. Un chargement fait sans
      // la clé ne compte donc pas comme définitif : dès qu’elle est là, on
      // repasse UNE fois (le résultat suivant portera hadKeypair = true).
      return !v.loading && !v.lastLoadHadKeypair && hasUserKeypair();
    },
  }
);

/** Create a vault: generate K_vault, seal it to our own key, encrypt the name. */
export const createVault = createAsyncThunk(
  'vaults/create',
  async (args: { name: string }, { getState, dispatch, rejectWithValue }) => {
    try {
      // Creating needs a tenant just as much as listing does, and this is reachable
      // before a load has settled. Same ladder, same refusals — so a plan that doesn't
      // include shared vaults is told so here too, rather than after the crypto ran.
      await resolveVaultTenants(getState, dispatch);
      const ownPub = await getOwnPublicKey();
      if (!ownPub) return rejectWithValue('Unlock your account before creating a vault');
      const payload = await buildVaultCreatePayload(args.name, ownPub);
      payload.kVault.fill(0); // re-derived into the cache from the server wrap below
      const dto = await apiCreateVault({
        nameEncrypted: payload.nameEncrypted,
        nameIv: payload.nameIv,
        wrappedVaultKey: payload.wrappedVaultKey,
      });
      return await toVaultSummary(dto);
    } catch (e) {
      return rejectWithValue(
        classifyVaultFailure(e) ?? (e as Error).message ?? 'Failed to create vault'
      );
    }
  }
);

/**
 * Make sure every epoch's K_vault this member can hold is unlocked in the cache,
 * so OLD items (wrapped under an earlier epoch after a lazy re-key) stay readable.
 * The current epoch comes from the membership wrap (loadVaults); older epochs from
 * the key-wrap history. Best-effort: a missing historical key just makes that
 * epoch's items undecryptable, surfaced per-item in loadVaultItems.
 */
async function ensureEpochKeys(vaultId: string): Promise<boolean> {
  let wraps: Array<{ epoch: number; wrappedVaultKey: string }>;
  try {
    wraps = await apiGetVaultKeyWraps(vaultId);
  } catch (err) {
    // History fetch FAILED (vs "no history") — return false so the caller treats
    // any resulting undecryptable old items as a TRANSIENT fetch issue (retry),
    // not as tamper/data loss.
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[vaults] key-wrap history fetch failed for ${vaultId}:`, err);
    }
    return false;
  }
  for (const w of wraps) {
    if (!isVaultUnlocked(vaultId, w.epoch)) {
      try {
        await unlockVault(vaultId, w.epoch, w.wrappedVaultKey);
      } catch (err) {
        // An old-epoch wrap that won't open (tampered/foreign) fails closed (AES-GCM
        // tag) — skip it, but make it observable in dev.
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[vaults] could not open epoch ${w.epoch} wrap for ${vaultId}:`, err);
        }
      }
    }
  }
  return true;
}

/** List + decrypt a vault's items (requires the vault to be unlocked). */
export const loadVaultItems = createAsyncThunk(
  'vaults/loadItems',
  async (args: { vaultId: string }, { getState, dispatch, rejectWithValue }) => {
    const vault = (getState() as { vaults: VaultsState }).vaults.vaults[args.vaultId];
    if (!vault) return rejectWithValue('Unknown vault');
    if (!getVaultKey(args.vaultId, vault.currentKeyEpoch))
      return rejectWithValue('Vault is locked');
    // Pull historical-epoch keys so items from before a re-key still decrypt.
    const historyAvailable = await ensureEpochKeys(args.vaultId);
    try {
      const dtos = await apiListVaultItems(args.vaultId);
      const items: VaultItemSummary[] = [];
      let undecryptable = 0;
      for (const dto of dtos) {
        try {
          items.push(await toItemSummary(dto, args.vaultId));
        } catch (err) {
          // Skip an item we can't decrypt (e.g. wrapped under an epoch key we don't
          // hold) rather than failing the whole list, but COUNT it — the count is
          // surfaced on state so the UI (E3-8) can show "N items couldn't be
          // decrypted — retry" instead of silently dropping them.
          undecryptable++;
          if (process.env.NODE_ENV === 'development') {
            console.warn(
              `[vaults] could not decrypt item ${dto.id} in vault ${args.vaultId}:`,
              err
            );
          }
        }
      }
      /*
        LE RATTRAPAGE DES PARTAGES DE DOSSIER PART D'ICI, et d'ici seulement.

        C'est le seul endroit du code qui sait à la fois que le coffre est
        DÉVERROUILLÉ (on vient d'en déchiffrer les éléments) et que la liste
        est FRAÎCHE. Le poser dans les écrans aurait voulu dire le poser dans
        les six qui appellent `loadVaultItems` — et l'oublier dans le septième.

        FIRE-AND-FORGET, et pas seulement par confort : `await` ferait dépendre
        l'affichage des éléments de deux requêtes de plus et d'autant de
        scellements. Sa porte « une fois par session » vit dans son `condition`.
      */
      void dispatch(catchUpFolderShares({ vaultId: args.vaultId }));
      return { vaultId: args.vaultId, items, undecryptable, historyAvailable };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'Failed to load vault items');
    }
  }
);

/**
 * L'AVANCEMENT DU RE-SCELLEMENT, lot par lot.
 *
 * `createAction` PLUTÔT QU'UN RÉDUCTEUR DE LA SLICE, pour une raison d'ordre :
 * les réducteurs de `createSlice` ne sont disponibles qu'après sa création, tout
 * en bas du fichier, et ce thunk vit ici — au milieu des autres gestes sur les
 * éléments, là où on le cherche. Un `createAction` nommé se déclare où on s'en
 * sert et se traite dans `extraReducers`, sans rien devoir à l'ordre du fichier.
 */
export const vaultRewrapProgress = createAction<{
  vaultId: string;
  done: number;
  total: number;
}>('vaults/rewrapProgress');

/**
 * RE-SCELLER LES ÉLÉMENTS RESTÉS SOUS UNE ÉPOQUE ANCIENNE (admin de coffre).
 *
 * LE DÉFAUT QU'IL FERME, ET IL A ÉTÉ VU EN PRODUCTION. Un coffre tourne de clé
 * parce qu'on retire quelqu'un ; ses éléments restent sous l'époque d'avant — le
 * re-key est PARESSEUX par conception. Une personne ajoutée APRÈS ne reçoit que
 * la clé de l'époque courante : elle lit « N éléments n'ont pas pu être
 * déchiffrés », et rien, jamais, ne lève cet état. Autrement dit : n'importe qui
 * ajouté après n'importe quelle rotation reçoit un coffre amputé de son
 * histoire, en silence. `itemEpochCoverage` le COMPTAIT depuis F10 ; ceci le
 * répare.
 *
 * CE QUE ÇA COÛTE — PRESQUE RIEN, et c'est ce qui rend le geste possible.
 * `encrypted_meta` et les morceaux R2 sont chiffrés sous K_item, et K_item est
 * STABLE (0019) : seule l'ENVELOPPE de K_item sous K_vault est refaite. Ouvrir
 * avec l'ancienne K_vault, refermer avec la courante. Aucun octet de contenu
 * n'est téléchargé, aucun n'est renvoyé.
 *
 * ON NE DEVINE JAMAIS UNE CLÉ QU'ON N'A PAS. Un élément dont l'époque ne s'ouvre
 * pas sur CET appareil est SAUTÉ et COMPTÉ (`planRewrap` s'en charge), jamais
 * tenté : envoyer une enveloppe fabriquée sans la clé rendrait l'élément
 * illisible pour TOUT LE MONDE — le défaut qu'on répare, rendu irréversible. Un
 * membre qui détient cette époque-là finira le travail, et l'écran le dit.
 *
 * K_item NE SURVIT PAS À SON USAGE : `.fill(0)` dans un `finally`, comme partout
 * ailleurs dans cette slice.
 *
 * DEUX CONFLITS, DEUX REPRISES, TOUTES DEUX BORNÉES (le patron de
 * `rotateVaultKey`) :
 *   · une VERSION qui a bougé (quelqu'un a édité l'élément entre notre lecture
 *     et le lot) revient dans `conflicts` sans faire échouer le reste : on relit
 *     les éléments et on repropose au tour suivant ;
 *   · une ÉPOQUE qui a bougé (quelqu'un a fait tourner la clé pendant qu'on
 *     préparait) fait refuser le lot ENTIER en 409 : on relit le coffre — donc la
 *     nouvelle époque et le nouveau wrap — et on rescelle sous la bonne clé.
 * Sans borne, deux administrateurs actifs se relanceraient l'un l'autre.
 */
export const rewrapStaleItems = createAsyncThunk(
  'vaults/rewrapStaleItems',
  async (args: { vaultId: string }, { getState, dispatch, rejectWithValue }) => {
    const MAX_ROUNDS = 3;
    let rewrapped = 0;
    let unreadable = 0;
    let conflictsLeft = 0;
    let skipped = 0;
    let skippedEpochs: number[] = [];
    let envoye = false;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const state = (getState() as { vaults: VaultsState }).vaults;
        const vault = state.vaults[args.vaultId];
        if (!vault) return rejectWithValue('Unknown vault');

        // Les clés des époques ANCIENNES — sans elles rien ne s'OUVRE. Le même
        // mécanisme que la lecture (loadVaultItems), pour la même raison.
        await ensureEpochKeys(args.vaultId);
        const kCourante = getVaultKey(args.vaultId, vault.currentKeyEpoch);

        const items = state.itemsByVault[args.vaultId];
        const plan = planRewrap({
          items,
          currentKeyEpoch: vault.currentKeyEpoch,
          canOpenEpoch: (epoch) => isVaultUnlocked(args.vaultId, epoch),
        });
        skipped = plan.skipped.length;
        skippedEpochs = plan.skippedEpochs;
        // Sans la clé COURANTE on ne peut REFERMER aucune enveloppe : ce n'est
        // pas « rien à faire », c'est « pas ici, pas maintenant ».
        // UN CODE, PAS UNE PHRASE : c'est l'écran qui traduit, et « verrouillé »
        // n'y a pas la même issue que « rotation concurrente ».
        if (!kCourante || plan.blocked) return rejectWithValue('vault_locked');
        if (plan.total === 0) break;

        const parId = new Map((items ?? []).map((i) => [i.id, i]));
        let faits = 0;
        let conflitsCeTour = 0;
        dispatch(vaultRewrapProgress({ vaultId: args.vaultId, done: 0, total: plan.total }));

        for (const lot of plan.batches) {
          const entrees: RewrapItemEntry[] = [];
          for (const cand of lot) {
            const source = parId.get(cand.id);
            const kAncienne = getVaultKey(args.vaultId, cand.wrappedUnderEpoch);
            if (!source || !kAncienne) continue; // le plan l'avait déjà écarté
            let kItem: Uint8Array | null = null;
            try {
              kItem = await unwrapItemKey(source.wrappedItemKey, kAncienne);
              entrees.push({
                itemId: cand.id,
                version: cand.version,
                wrappedItemKey: await wrapItemKey(kItem, kCourante),
              });
            } catch {
              // La bonne époque, et pourtant l'enveloppe ne s'ouvre pas : elle ne
              // vaut rien (substituée, corrompue). On la COMPTE — la remplacer à
              // l'aveugle graverait n'importe quoi à sa place.
              unreadable++;
            } finally {
              kItem?.fill(0);
            }
          }
          if (entrees.length === 0) continue;
          const res = await apiRewrapVaultItems(args.vaultId, {
            wrappedUnderEpoch: vault.currentKeyEpoch,
            items: entrees,
          });
          envoye = true;
          rewrapped += res.rewrapped;
          conflitsCeTour += res.conflicts.length;
          faits += lot.length;
          dispatch(vaultRewrapProgress({ vaultId: args.vaultId, done: faits, total: plan.total }));
        }

        conflictsLeft = conflitsCeTour;
        if (conflitsCeTour === 0) break;
        // Des versions ont bougé : on relit, et le tour suivant repart d'un état
        // frais (les éléments réparés ne sont simplement plus dans le plan).
        await dispatch(loadVaultItems({ vaultId: args.vaultId }));
      }
    } catch (e) {
      if (isRetryableRotateConflict(e)) {
        // Une rotation est passée : le coffre relu porte la nouvelle époque et
        // notre nouveau wrap. On ne rejoue pas ici — l'écran repropose, avec un
        // compteur qui n'a pas bougé plutôt qu'un faux succès.
        await dispatch(loadVaults());
        await dispatch(loadVaultItems({ vaultId: args.vaultId }));
        return rejectWithValue('vault_epoch_conflict');
      }
      return rejectWithValue(
        classifyVaultFailure(e) ?? (e as Error).message ?? 'Failed to rewrap items'
      );
    }

    // L'ÉCRAN DOIT REFLÉTER L'ÉTAT, pas notre compte : c'est le rechargement qui
    // fait tomber le compteur d'éléments anciens et disparaître l'avertissement
    // de déchiffrement, et lui seul dit la vérité si le serveur a fait autrement.
    if (envoye) await dispatch(loadVaultItems({ vaultId: args.vaultId }));
    return {
      vaultId: args.vaultId,
      rewrapped,
      skipped,
      skippedEpochs,
      unreadable,
      conflictsLeft,
    };
  }
);

/**
 * Add an item to a vault: generate K_item, wrap it under K_vault, encrypt the meta
 * + content chunks under K_item, upload, finalize. `content` is plaintext bytes.
 */
export const addVaultItem = createAsyncThunk(
  'vaults/addItem',
  async (
    args: { vaultId: string; itemType: VaultItemKind; meta: VaultItemMeta; content: Uint8Array },
    { getState, rejectWithValue }
  ) => {
    // Une CRÉATION n'appartient jamais à une session d'édition passée : un
    // spread de méta (« Garder les deux ») ne doit pas l'y coller.
    if (args.meta.editSession) {
      const { editSession: _dropped, ...rest } = args.meta;
      args = { ...args, meta: rest };
    }
    const vault = (getState() as { vaults: VaultsState }).vaults.vaults[args.vaultId];
    if (!vault) return rejectWithValue('Unknown vault');
    // New content is always wrapped under the CURRENT-epoch K_vault.
    const kVault = getVaultKey(args.vaultId, vault.currentKeyEpoch);
    if (!kVault) return rejectWithValue('Vault is locked');

    const kItem = generateItemKey();
    try {
      const wrappedItemKey = await wrapItemKey(kItem, kVault);
      const { encryptedMeta, encryptedMetaIv } = await encryptItemMeta(args.meta, kItem);

      const totalChunks =
        args.content.length === 0 ? 0 : Math.ceil(args.content.length / ITEM_CONTENT_CHUNK_SIZE);
      // Advisory size hint (plaintext + per-chunk AES-GCM IV(12)+tag(16) overhead).
      // The server re-measures the TRUE encrypted byte total from R2 at finalize,
      // so this value is not trusted for the quota counter.
      const sizeBytes = args.content.length + totalChunks * 28;

      const created = await apiCreateVaultItem(args.vaultId, {
        itemType: args.itemType,
        wrappedItemKey,
        wrappedUnderEpoch: vault.currentKeyEpoch,
        encryptedMeta,
        encryptedMetaIv,
        totalChunks,
        sizeBytes,
      });

      // Stream: encrypt one chunk, upload it, drop it — so we never hold the whole
      // encrypted copy in memory (peak ≈ plaintext + one 16 MB chunk, not 2×).
      for (let i = 0; i < totalChunks; i++) {
        const off = i * ITEM_CONTENT_CHUNK_SIZE;
        const enc = await encryptItemChunk(
          args.content.subarray(off, off + ITEM_CONTENT_CHUNK_SIZE),
          kItem
        );
        await apiUploadVaultItemChunk(args.vaultId, created.id, i, enc);
      }
      const finalized = await apiFinalizeVaultItem(args.vaultId, created.id);

      return await toItemSummary(finalized, args.vaultId);
    } catch (e) {
      // A 409 vault_epoch_conflict here means a concurrent re-key advanced the epoch;
      // the create 409s BEFORE any chunk upload (no orphaned R2 bytes), so the caller
      // simply retries. (Auto refresh-and-retry parity with removeMember is deferred.)
      return rejectWithValue((e as Error).message ?? 'Failed to add item');
    } finally {
      kItem.fill(0);
    }
  }
);

/**
 * Renommer un élément — la méta seule voyage, re-chiffrée sous le K_item
 * EXISTANT de l'élément (celui de SON époque), IV frais. Ni contenu, ni clé,
 * ni emplacement de rétention : corriger une faute de frappe coûtait jusqu'ici
 * un re-téléversement entier.
 */
export const renameVaultItem = createAsyncThunk(
  'vaults/renameItem',
  async (
    args: { vaultId: string; itemId: string; name: string },
    { getState, dispatch, rejectWithValue }
  ) => {
    const state = (getState() as { vaults: VaultsState }).vaults;
    const item = (state.itemsByVault[args.vaultId] ?? []).find((i) => i.id === args.itemId);
    if (!item) return rejectWithValue('Unknown item');
    const kVault = getVaultKey(args.vaultId, item.wrappedUnderEpoch);
    if (!kVault) return rejectWithValue('Vault is locked');

    const kItem = await unwrapItemKey(item.wrappedItemKey, kVault);
    try {
      const champNom = item.itemType === 'note' ? 'title' : 'fileName';
      const { encryptedMeta, encryptedMetaIv } = await encryptItemMeta(
        { ...item.meta, [champNom]: args.name },
        kItem
      );
      const dto = await apiRenameVaultItem(args.vaultId, args.itemId, {
        expectedVersion: item.version,
        encryptedMeta,
        encryptedMetaIv,
      });
      const summary = dto ? await toItemSummary(dto, args.vaultId) : null;
      return { vaultId: args.vaultId, item: summary };
    } catch (e) {
      if (e instanceof VaultItemVersionConflictError) {
        // Même monnaie que le remplacement : la liste se rafraîchit, le refus
        // porte la version et l'élément du serveur.
        let serverItem: VaultItemSummary | null = null;
        if (e.serverItem) {
          try {
            serverItem = await toItemSummary(e.serverItem, args.vaultId);
          } catch {
            serverItem = null;
          }
        }
        void dispatch(loadVaultItems({ vaultId: args.vaultId }));
        return rejectWithValue({
          code: 'item_version_conflict',
          serverVersion: e.serverVersion,
          serverItem,
        } as VaultItemConflict);
      }
      return rejectWithValue((e as Error).message ?? 'Failed to rename item');
    } finally {
      kItem.fill(0);
    }
  }
);

/**
 * E3-6 — partager UN element avec UNE personne. La ceremonie est celle de
 * l'invitation (transparence + TOFU) : bloquer 'tampered_log' /
 * 'served_not_latest', exiger la confirmation UI sur 'changed'
 * (acceptPeerKeyChange a deja ete appele par l'ecran quand `confirmed`).
 * K_item est deballe sous l'epoque de L'ELEMENT (pas la courante), scelle a la
 * cle VERIFIEE du destinataire, et le serveur garde la version (CAS).
 */
export const createItemGrant = createAsyncThunk(
  'vaults/createItemGrant',
  async (
    args: {
      vaultId: string;
      itemId: string;
      granteeUserId: string;
      expiresInDays?: number;
      /** L'empreinte que l'écran a fait confirmer hors bande sur 'changed'. */
      confirmedFingerprint?: string;
    },
    { getState, rejectWithValue }
  ) => {
    const state = (getState() as { vaults: VaultsState }).vaults;
    const item = (state.itemsByVault[args.vaultId] ?? []).find((i) => i.id === args.itemId);
    if (!item) return rejectWithValue('item_not_found');
    try {
      const peer = await apiGetMemberPublicKey(args.granteeUserId);
      const log = await apiGetKeyLog(args.granteeUserId);
      const verdict = await checkPeerKeyTransparency(
        args.granteeUserId,
        { encPublicKey: peer.encPublicKey, fingerprint: peer.fingerprint },
        log
      );
      if (verdict === 'tampered_log' || verdict === 'served_not_latest') {
        return rejectWithValue(verdict);
      }
      if (verdict === 'changed' && args.confirmedFingerprint !== peer.fingerprint) {
        // L'empreinte part avec le refus : l'écran l'affiche et exige la
        // confirmation hors bande — la même cérémonie qu'à l'invitation.
        return rejectWithValue(`changed:${peer.fingerprint}`);
      }
      const kVault = getVaultKey(args.vaultId, item.wrappedUnderEpoch);
      if (!kVault) return rejectWithValue('vault_locked');
      const kItem = await unwrapItemKey(item.wrappedItemKey, kVault);
      try {
        const wrapped = await wrapItemKeyForRecipient(kItem, peer);
        const grant = await apiCreateItemGrant(args.vaultId, args.itemId, {
          granteeUserId: args.granteeUserId,
          wrappedItemKey: wrapped,
          itemVersion: item.version,
          ...(args.expiresInDays ? { expiresInDays: args.expiresInDays } : {}),
        });
        return { vaultId: args.vaultId, itemId: args.itemId, grant };
      } finally {
        kItem.fill(0);
      }
    } catch (e) {
      return rejectWithValue((e as Error)?.message || UNKNOWN_FAILURE_CODE);
    }
  }
);

/** Le rapport d'un lot de grants : ce qui a été scellé, sauté, et où ça s'est arrêté. */
export interface ItemGrantsBatchResult {
  vaultId: string;
  granteeUserId: string;
  /** Les éléments effectivement scellés pour cette personne. */
  granted: string[];
  /** Déjà partagés avec elle (`already_granted`) : ni scellés, ni une erreur. */
  skipped: string[];
  total: number;
}

/** Le rejet d'un lot : le code du PREMIER échec, et le bilan jusqu'à lui. */
export interface ItemGrantsBatchFailure extends ItemGrantsBatchResult {
  code: string;
  /** L'élément sur lequel le lot s'est arrêté. */
  failedItemId: string;
}

/**
 * Partager PLUSIEURS éléments (un dossier, une sélection) avec UNE personne.
 *
 * Le grant est PAR ÉLÉMENT côté serveur — un dossier de coffre n'est qu'un
 * préfixe de `meta.path`, il n'a pas de ligne à laquelle sceller quoi que ce
 * soit. Ce thunk n'est donc qu'une BOUCLE SÉQUENTIELLE sur `createItemGrant`,
 * et c'est délibéré : (1) chaque scellement rejoue la vérification de clé,
 * pas seulement le premier — la cérémonie TOFU a été faite UNE fois à
 * l'écran, mais c'est le thunk unitaire qui garde la garde ; (2) ce sont ses
 * `fulfilled` que `shareIndexSlice` écoute pour tenir les badges « partagé »
 * à jour élément par élément — court-circuiter le thunk unitaire les
 * rendrait muets ; (3) un refus (clé qui a tourné, coffre verrouillé, réseau)
 * doit ARRÊTER la file avec son vrai message et le compte de ce qui est passé,
 * pas laisser N échecs parallèles sur la même cause.
 *
 * `already_granted` n'est PAS un échec : re-partager un dossier où trois
 * fichiers étaient déjà partagés avec cette personne doit sceller les autres
 * et dire « 3 déjà partagés », pas s'arrêter au premier.
 */
export const createItemGrants = createAsyncThunk<
  ItemGrantsBatchResult,
  {
    vaultId: string;
    itemIds: string[];
    granteeUserId: string;
    expiresInDays?: number;
    confirmedFingerprint?: string;
  },
  { rejectValue: ItemGrantsBatchFailure }
>('vaults/createItemGrants', async (args, { dispatch, rejectWithValue }) => {
  const { itemIds, ...single } = args;
  const granted: string[] = [];
  const skipped: string[] = [];
  for (const itemId of itemIds) {
    const r = await dispatch(createItemGrant({ ...single, itemId }));
    if (createItemGrant.fulfilled.match(r)) {
      granted.push(itemId);
      continue;
    }
    const code = typeof r.payload === 'string' ? r.payload : UNKNOWN_FAILURE_CODE;
    if (code === 'already_granted') {
      skipped.push(itemId);
      continue;
    }
    return rejectWithValue({
      vaultId: args.vaultId,
      granteeUserId: args.granteeUserId,
      granted,
      skipped,
      total: itemIds.length,
      code,
      failedItemId: itemId,
    });
  }
  return {
    vaultId: args.vaultId,
    granteeUserId: args.granteeUserId,
    granted,
    skipped,
    total: itemIds.length,
  };
});

/**
 * Revoquer un grant. L'acces SERVEUR est coupe a l'instant du DELETE ; la
 * ROTATION DE K_ITEM qui suit est ce qui rend la revocation cryptographique —
 * le destinataire detient peut-etre encore l'ancien K_item, le nouveau contenu
 * repart sous un K_item neuf via le chemin E3-12 existant (son CAS sur version
 * EST la rotation). Les grants RESTANTS sont rescelles par le meme commit.
 */
export const revokeItemGrant = createAsyncThunk(
  'vaults/revokeItemGrant',
  async (
    args: {
      vaultId: string;
      itemId: string;
      grantId: string;
      /**
       * REQUIS, et c'est le point : révoquer et EXCLURE sont le même geste.
       *
       * Sans exclusion, un rattrapage de partage de dossier rescellerait cet
       * accès au prochain balayage — il défairait la révocation, silencieusement,
       * des semaines plus tard. Le rendre obligatoire force les deux sites
       * d'appel à le fournir : un troisième chemin de révocation ne compilera
       * pas sans se poser la question.
       */
      granteeUserId: string;
    },
    { getState, dispatch, rejectWithValue }
  ) => {
    try {
      const { remainingGrants } = await apiRevokeItemGrant(args.vaultId, args.itemId, args.grantId);
      // Rotation : re-telecharger puis re-committer le MEME contenu — K_item neuf.
      const state = (getState() as { vaults: VaultsState }).vaults;
      const item = (state.itemsByVault[args.vaultId] ?? []).find((i) => i.id === args.itemId);
      if (item) {
        try {
          const content = await downloadVaultItemContent(args.vaultId, item);
          const r = await dispatch(
            updateVaultItem({
              vaultId: args.vaultId,
              itemId: args.itemId,
              expectedVersion: item.version,
              meta: item.meta,
              content,
            })
          );
          if (updateVaultItem.rejected.match(r)) {
            // 409 : quelqu'un a ecrit entre-temps — SON commit a de toute facon
            // minte un K_item neuf (rotation faite par un autre chemin).
            const code = (r.payload as { code?: string })?.code ?? r.payload;
            if (code !== 'item_version_conflict') {
              return rejectWithValue('grant_revoked_rotation_failed');
            }
          }
        } catch {
          // La revocation serveur a EU lieu ; la rotation se rejouera au
          // prochain commit (chaque edition mint un K_item neuf de toute facon).
          return rejectWithValue('grant_revoked_rotation_failed');
        }
      }
      /*
        L'EXCLUSION EST ÉCRITE ICI, PAS CHEZ L'APPELANT.

        Deux écrans révoquent déjà (le panneau des accès et le dialogue de
        partage) ; les brancher un par un, c'est accepter que le troisième
        l'oublie. Ici, tous les chemins passent.

        L'échec n'annule PAS la révocation : l'accès EST retiré côté serveur, et
        rendre une erreur ferait croire le contraire. `rememberExclusion` ne fait
        rien quand aucune intention ne couvre cet élément — le cas courant.
      */
      const itemPath = item?.meta?.path ?? '';
      const epoch =
        (getState() as { vaults: VaultsState }).vaults.vaults?.[args.vaultId]?.currentKeyEpoch ?? 0;
      void rememberExclusion(args.vaultId, epoch, args.granteeUserId, args.itemId, itemPath).catch(
        () => undefined
      );

      return { vaultId: args.vaultId, itemId: args.itemId, grantId: args.grantId, remainingGrants };
    } catch (e) {
      return rejectWithValue((e as Error)?.message || UNKNOWN_FAILURE_CODE);
    }
  }
);

/**
 * RÉPARER UN ACCÈS « À RESCELLER » (F17).
 *
 * CE QU'EST UN GRANT STALE. Le scellé d'un accès ponctuel vise UNE version de
 * l'élément (`wrapped_for_version`). Chaque commit mint un K_item neuf et
 * rescelle tous les grants vivants du même coup — mais un grant né pendant la
 * fenêtre lecture→CAS d'un commit concurrent rate ce train : son wrap ouvre une
 * version dépassée, et le destinataire ne lit plus rien. Le serveur le dit
 * (`stale`) ; jusqu'ici seul un nouvel enregistrement de l'élément le réparait,
 * ce qui n'arrive jamais sur un document qu'on ne touche plus.
 *
 * ON RE-LIT L'ÉLÉMENT AU SERVEUR, ET C'EST LE FOND DU GESTE. Le K_item du store
 * peut être celui d'AVANT le commit qui a rendu ce grant caduc : le resceller
 * redonnerait au destinataire une clé qui n'ouvre toujours rien, et le serveur
 * l'accepterait (le wrap est opaque pour lui) — une réparation qui ne répare
 * pas, sans une seule erreur à l'écran. On repart donc du DTO frais : sa version
 * est celle que la route de rescellement exige, et son `wrappedItemKey` est le
 * K_item courant.
 *
 * LA CLÉ DU DESTINATAIRE EST CONFRONTÉE À SON ÉPINGLE, exactement comme la
 * boucle de rescellement d'`updateVaultItem` : un TOFU qui a CHANGÉ n'est jamais
 * accepté en silence — l'écran rejoue la cérémonie. Un pair jamais épinglé passe,
 * comme là-bas : ce geste ne durcit pas la règle, il ne l'affaiblit pas non plus.
 *
 * NE TOUCHE PAS À L'ÉTAT : le nombre de grants n'a pas bougé (on répare, on
 * n'ajoute rien), donc `shareIndexSlice` n'a rien à recompter. C'est l'écran qui
 * relit sa liste.
 */
export const rewrapItemGrant = createAsyncThunk(
  'vaults/rewrapItemGrant',
  async (
    args: { vaultId: string; itemId: string; grantId: string; granteeUserId: string },
    { getState, rejectWithValue }
  ) => {
    const state = (getState() as { vaults: VaultsState }).vaults;
    if (!state.vaults[args.vaultId]) return rejectWithValue('vault_not_found');
    try {
      // Le DTO FRAIS : ni la version ni le K_item du store ne font autorité ici.
      const dtos = await apiListVaultItems(args.vaultId);
      const dto = dtos.find((d) => d.id === args.itemId);
      if (!dto) return rejectWithValue('item_not_found');

      /**
       * L'ÉPOQUE DE L'ÉLÉMENT N'EST PAS FORCÉMENT EN CACHE, et c'est le cas
       * NORMAL ici. Un grant devient `stale` sur un élément qu'on ne touche
       * plus : c'est exactement celui qui n'a pas été réenregistré depuis la
       * dernière rotation, donc celui qui est scellé sous une époque ANCIENNE,
       * dont K_vault ne s'obtient que par l'historique des wraps. Sans ce
       * rattrapage, « Réparer » répondait `vault_locked` sur un coffre
       * parfaitement déverrouillé — un message faux sur le seul geste qui
       * pouvait rendre l'accès. Best-effort et SEULEMENT en cas de manque : la
       * lecture d'historique n'a pas à coûter un aller-retour au cas courant.
       */
      let kVault = getVaultKey(args.vaultId, dto.wrappedUnderEpoch);
      if (!kVault) {
        await ensureEpochKeys(args.vaultId).catch(() => false);
        kVault = getVaultKey(args.vaultId, dto.wrappedUnderEpoch);
      }
      if (!kVault) return rejectWithValue('vault_locked');

      const served = await apiGetMemberPublicKey(args.granteeUserId);
      const pinned = getTofuFingerprint(args.granteeUserId);
      if (pinned && pinned !== served.fingerprint) {
        return rejectWithValue('grantee_key_changed');
      }

      const kItem = await unwrapItemKey(dto.wrappedItemKey, kVault);
      try {
        await apiRewrapItemGrant(args.vaultId, args.itemId, args.grantId, {
          wrappedItemKey: await wrapItemKeyForRecipient(kItem, served),
          itemVersion: dto.version,
        });
      } finally {
        kItem.fill(0);
      }
      return { vaultId: args.vaultId, itemId: args.itemId, grantId: args.grantId };
    } catch (e) {
      return rejectWithValue((e as Error)?.message || UNKNOWN_FAILURE_CODE);
    }
  }
);

/**
 * Codes SYSTÉMIQUES : le lot entier échouerait pour la même cause — on BREAK au
 * premier, pour ne pas empiler N fois la même erreur. Convention réelle de
 * cette base (uploadFiles) : apiRenameVaultItem rejette une PLAIN Error dont le
 * MESSAGE est le code (throwWithCode) — classifyVaultFailure n'y verrait
 * jamais rien (il exige la forme axios). Les 409 arrivent TYPÉS
 * (VaultItemVersionConflictError, avant throwWithCode) et restent LOCAUX.
 */
/**
 * Les échecs de chargement qui MÉRITENT une seconde chance.
 *
 * Volontairement COURTE. `vault_forbidden` ou `upgrade_required` ne changeront
 * pas en réessayant : les réessayer ferait battre l'application contre un mur
 * en boucle. Ces trois-là, si — un réseau qui revient, un jeton qui arrive, un
 * serveur qui se remet.
 */
const TRANSIENT_LOAD_FAILURES: ReadonlySet<string> = new Set([
  'network_unavailable',
  'server_error',
  'shared_vault_no_context',
]);

const SYSTEMIC_MOVE_FAILURES: ReadonlySet<string> = new Set([
  'host_plan_lapsed',
  'org_read_only',
  'upgrade_required',
  'pooled_quota_exceeded',
  'session_expired',
  'network_unavailable',
  'server_error',
  'org_forbidden',
  'vault_forbidden',
  'vault_not_found',
]);

/**
 * moveVaultItems — la boucle N-PATCH des dossiers (déplacement, renommage de
 * dossier), avec échec partiel STRUCTURÉ.
 *
 * PAS DE TRANSACTION, ET C'EST DIT : chaque élément est un PATCH /meta sous CAS
 * de version. Un renommage de dossier interrompu laisse DEUX dossiers visibles
 * (préfixes implicites), chacun avec sa part — reprenable, jamais corrompu.
 * C'est la propriété qui rend le non-rollback acceptable.
 *
 * JAMAIS rejected pour un échec partiel : les succès doivent atterrir dans le
 * store. `failed` porte le reste, l'écran propose « Reprendre » — et la reprise
 * RECALCULE son plan depuis le store frais (jamais l'ancien plan : les items
 * déjà déplacés ne matchent plus l'ancien préfixe, l'idempotence est par
 * construction).
 */
export const moveVaultItems = createAsyncThunk(
  'vaults/moveItems',
  async (
    args: { vaultId: string; moves: Array<{ itemId: string; meta: VaultItemMeta }> },
    { getState, dispatch }
  ) => {
    // Démarrage à froid : les wraps d'époques anciennes ne sont peut-être pas
    // chargés — sans ce best-effort, des 'vault_locked' évitables.
    await ensureEpochKeys(args.vaultId).catch(() => false);

    const applied: VaultItemSummary[] = [];
    const failed: Array<{ itemId: string; error: string }> = [];
    for (const move of args.moves) {
      // Relire l'item DANS LE STORE à chaque tour : version et époque FRAÎCHES
      // (un tour précédent peut avoir déclenché un reload).
      const state = (getState() as { vaults: VaultsState }).vaults;
      const item = (state.itemsByVault[args.vaultId] ?? []).find((i) => i.id === move.itemId);
      if (!item) {
        failed.push({ itemId: move.itemId, error: 'item_not_found' });
        continue;
      }
      const kVault = getVaultKey(args.vaultId, item.wrappedUnderEpoch);
      if (!kVault) {
        // Rotation passée par là : l'époque de CET item n'est pas déballée.
        // Local à l'élément — la boucle continue.
        failed.push({ itemId: move.itemId, error: 'vault_locked' });
        continue;
      }
      const kItem = await unwrapItemKey(item.wrappedItemKey, kVault);
      try {
        const { encryptedMeta, encryptedMetaIv } = await encryptItemMeta(move.meta, kItem);
        const dto = await apiRenameVaultItem(args.vaultId, move.itemId, {
          expectedVersion: item.version,
          encryptedMeta,
          encryptedMetaIv,
        });
        const summary = dto ? await toItemSummary(dto, args.vaultId) : null;
        // Un DTO nul est un succès sans écho — le reload final réconciliera.
        if (summary) applied.push(summary);
      } catch (e) {
        if (e instanceof VaultItemVersionConflictError) {
          // Quelqu'un a touché CET élément — local, on continue les suivants.
          failed.push({ itemId: move.itemId, error: 'item_version_conflict' });
          continue;
        }
        const code = e instanceof Error ? e.message : String(e);
        failed.push({ itemId: move.itemId, error: code });
        if (SYSTEMIC_MOVE_FAILURES.has(code)) break;
      } finally {
        kItem.fill(0);
      }
    }
    if (failed.length > 0) {
      // L'état serveur a divergé de ce qu'on croyait : recharger avant que
      // l'écran ne propose une reprise calculée sur du périmé.
      await dispatch(loadVaultItems({ vaultId: args.vaultId }));
    }
    return { vaultId: args.vaultId, applied, failed };
  }
);

/**
 * Codes SYSTÉMIQUES d'un lot de SUPPRESSIONS : les mêmes que le déplacement,
 * plus le hold légal (E9-6) qui condamne tout le lot. `vault_forbidden` y
 * reste juste : le 403 d'un DELETE peut être PAR élément (owner check), mais
 * le partitionnement client par canDelete garantit qu'un 403 en cours de lot
 * ne peut venir que d'une démotion de rôle — qui condamne bien le reste.
 */
const SYSTEMIC_DELETE_FAILURES: ReadonlySet<string> = new Set([
  ...SYSTEMIC_MOVE_FAILURES,
  'legal_hold_active',
]);

/**
 * deleteVaultItems — la boucle N-DELETE de la suppression récursive de
 * dossier, à échec partiel structuré (même contrat que moveVaultItems : jamais
 * rejected pour un partiel). Soft-delete : la corbeille (30 j) est le filet
 * qui rend la récursion acceptable — aucune purge ici.
 *
 * ATTENTION CONVENTION D'ERREUR : apiDeleteVaultItem laisse remonter
 * l'AxiosError BRUT (pas de throwWithCode) — on classifie donc ici via
 * classifyVaultFailure, qui lit e.response.data.code : 'item_not_found' et
 * 'legal_hold_active' passent. Lire e.message serait toujours faux.
 */
export const deleteVaultItems = createAsyncThunk(
  'vaults/deleteItems',
  async (args: { vaultId: string; itemIds: string[] }, { dispatch }) => {
    const applied: string[] = [];
    const failed: Array<{ itemId: string; error: string }> = [];
    for (const itemId of args.itemIds) {
      try {
        await apiDeleteVaultItem(args.vaultId, itemId);
        applied.push(itemId);
      } catch (e) {
        const code = classifyVaultFailure(e) ?? 'item_delete_failed';
        if (code === 'item_not_found') {
          // Déjà parti (reprise, ou course avec un autre membre) : un SUCCÈS —
          // le compter en échec rendrait la reprise infinie.
          applied.push(itemId);
          continue;
        }
        failed.push({ itemId, error: code });
        if (SYSTEMIC_DELETE_FAILURES.has(code)) break;
      }
    }
    if (failed.length > 0) {
      await dispatch(loadVaultItems({ vaultId: args.vaultId }));
    }
    return { vaultId: args.vaultId, applied, failed };
  }
);

/** Rejection payload of updateVaultItem when someone else saved first (E3-12). */
export interface VaultItemConflict {
  code: 'item_version_conflict';
  /** The version the server now holds — retry with it to overwrite deliberately. */
  serverVersion: number | null;
  /**
   * The item the server actually holds, DECRYPTED here (title + wrapped K_item), so
   * the UI can show what it would have overwritten — and download its body with
   * downloadVaultItemContent — before the user decides. The Worker pays to send it
   * with the 409 precisely so this decision needs no extra round-trip. Null when the
   * server sent nothing (the item was deleted) or we can no longer decrypt it.
   */
  serverItem: VaultItemSummary | null;
}

/** Type guard so a caller can tell a conflict from a plain error message. */
export function isVaultItemConflict(payload: unknown): payload is VaultItemConflict {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as VaultItemConflict).code === 'item_version_conflict'
  );
}

/**
 * Update an existing vault item: same crypto path as addVaultItem (fresh K_item,
 * wrapped under the CURRENT-epoch K_vault, meta + chunks encrypted under it), but
 * DECLARED + staged as a REVISION and committed with the `version` we read.
 *
 * A fresh K_item per revision is deliberate: it keeps every write path identical
 * to create (one key unlocks an item's content AND its title), carries the item
 * forward past a lazy re-key, and means the retired revision's chunks are not even
 * decryptable with the new key.
 *
 * NEVER overwrites blindly: a 409 comes back as a VaultItemConflict rejection
 * carrying the server's version AND its current item, decrypted here so the caller
 * can show it. The caller keeps the user's text and decides — retry with
 * serverVersion (overwrite on purpose) or adopt the other version. We also refresh
 * the item list on a conflict: whatever this client believed about the item is
 * provably stale, and the rest of the UI must not keep rendering it.
 */
export const updateVaultItem = createAsyncThunk(
  'vaults/updateItem',
  async (
    args: {
      vaultId: string;
      itemId: string;
      /** The version the editor was opened on (optimistic-concurrency guard). */
      expectedVersion: number;
      meta: VaultItemMeta;
      content: Uint8Array;
      /** La session d'édition de CE commit — l'UNIQUE porte d'entrée : tout
       *  editSession hérité par spread de meta est strippé (sinon « Remplacer
       *  le fichier » des jours plus tard collerait le geste dans une session
       *  d'époque avec ses participants — fausse attribution). */
      editSession?: { id: string; at: number; participants: string[] };
    },
    { getState, dispatch, rejectWithValue }
  ) => {
    // STRIP par défaut, réinjection seulement explicite — la garde d'intégrité
    // des sessions (couvre restore, remplacement, écrasement, rename, move).
    const { editSession: _inherited, ...metaRest } = args.meta;
    const cleanMeta: VaultItemMeta = args.editSession
      ? { ...metaRest, editSession: args.editSession }
      : metaRest;
    args = { ...args, meta: cleanMeta };
    const state = (getState() as { vaults: VaultsState }).vaults;
    const vault = state.vaults[args.vaultId];
    if (!vault) return rejectWithValue('Unknown vault');
    const existing = (state.itemsByVault[args.vaultId] ?? []).find((i) => i.id === args.itemId);
    // New content is always wrapped under the CURRENT-epoch K_vault.
    const kVault = getVaultKey(args.vaultId, vault.currentKeyEpoch);
    if (!kVault) return rejectWithValue('Vault is locked');

    const kItem = generateItemKey();
    try {
      const wrappedItemKey = await wrapItemKey(kItem, kVault);
      const { encryptedMeta, encryptedMetaIv } = await encryptItemMeta(args.meta, kItem);

      const totalChunks =
        args.content.length === 0 ? 0 : Math.ceil(args.content.length / ITEM_CONTENT_CHUNK_SIZE);
      // Declared size (plaintext + per-chunk AES-GCM IV(12)+tag(16)); the server
      // quota-checks this figure up front and re-measures the true bytes at commit.
      const sizeBytes = args.content.length + totalChunks * 28;
      const revisionId = crypto.randomUUID();

      // Declare BEFORE uploading: a revision the server hasn't admitted takes no
      // chunks (and a refusal here costs zero staged bytes).
      await apiDeclareVaultItemRevision(args.vaultId, args.itemId, {
        revisionId,
        totalChunks,
        sizeBytes,
      });

      // Stage the revision one chunk at a time (peak ≈ plaintext + one chunk).
      // These bytes are inert server-side until the commit below swaps them in.
      for (let i = 0; i < totalChunks; i++) {
        const off = i * ITEM_CONTENT_CHUNK_SIZE;
        const enc = await encryptItemChunk(
          args.content.subarray(off, off + ITEM_CONTENT_CHUNK_SIZE),
          kItem
        );
        await apiUploadVaultItemRevisionChunk(args.vaultId, args.itemId, revisionId, i, enc);
      }

      /**
       * E3-6 — LE RESCELLEMENT OBLIGATOIRE. Ce commit mint un K_item NEUF :
       * chaque grant vivant doit repartir scelle dessus, sinon l'acces du
       * destinataire meurt en silence (le serveur l'impose : grant_set_mismatch).
       * TOFU NON-INTERACTIF ici : une cle de destinataire qui a CHANGE depuis
       * l'epinglage n'est JAMAIS acceptee en silence — rejet 'grantee_key_changed',
       * l'UI rejoue la ceremonie de confirmation (la meme qu'a l'invitation).
       */
      const buildRewraps = async (
        grantList: Array<{ id: string; granteeUserId: string; expiresAt: string | null }>
      ) => {
        const out: Array<{ grantId: string; wrappedItemKey: string }> = [];
        for (const g of grantList) {
          if (g.expiresAt && Date.parse(g.expiresAt) <= Date.now()) continue;
          const served = await apiGetMemberPublicKey(g.granteeUserId);
          const pinned = getTofuFingerprint(g.granteeUserId);
          if (pinned && pinned !== served.fingerprint) {
            throw new Error('grantee_key_changed');
          }
          out.push({
            grantId: g.id,
            wrappedItemKey: await wrapItemKeyForRecipient(kItem, served),
          });
        }
        return out;
      };
      const grants = await apiListItemGrants(args.vaultId, args.itemId);
      let grantRewraps = await buildRewraps(grants);

      let updated;
      try {
        updated = await apiUpdateVaultItem(args.vaultId, args.itemId, {
          revisionId,
          expectedVersion: args.expectedVersion,
          wrappedItemKey,
          wrappedUnderEpoch: vault.currentKeyEpoch,
          encryptedMeta,
          encryptedMetaIv,
          grantRewraps,
        });
      } catch (err) {
        if (!(err instanceof GrantSetMismatchError)) throw err;
        // Un grant est ne ou a ete revoque entre notre lecture et le commit :
        // la reponse porte la liste VRAIE — reconstruire et rejouer UNE fois.
        grantRewraps = await buildRewraps(
          err.grants.map((g) => ({
            id: g.grantId,
            granteeUserId: g.granteeUserId,
            expiresAt: null,
          }))
        );
        updated = await apiUpdateVaultItem(args.vaultId, args.itemId, {
          revisionId,
          expectedVersion: args.expectedVersion,
          wrappedItemKey,
          wrappedUnderEpoch: vault.currentKeyEpoch,
          encryptedMeta,
          encryptedMetaIv,
          grantRewraps,
        });
      }

      const summary = await toItemSummary(updated, args.vaultId);
      // Keep the transclusion cache live for NOTE items (same memory-only, never
      // persisted cache loadVaultNoteContent fills), so open embeds show the save
      // immediately instead of a stale body. File bytes stay out of Redux.
      // Le SIDECAR de fil de fichier (meta.threadFor) est un itemType 'note'
      // par contrainte de schéma, mais son clair ne doit JAMAIS entrer dans le
      // store ni transiter le pipeline d'actions — même règle que
      // downloadVaultItemContent.
      const noteText =
        (existing?.itemType ?? updated.itemType) === 'note' && !args.meta.threadFor
          ? new TextDecoder().decode(args.content)
          : undefined;
      return { vaultId: args.vaultId, item: summary, noteText };
    } catch (e) {
      if (e instanceof VaultItemVersionConflictError) {
        // Decrypt the server's item HERE (the wraps travel with the 409) so the UI
        // can show its title and pull its body without another round-trip. A failure
        // to decrypt is not fatal: the conflict itself still has to reach the user.
        let serverItem: VaultItemSummary | null = null;
        if (e.serverItem) {
          try {
            serverItem = await toItemSummary(e.serverItem, args.vaultId);
          } catch {
            serverItem = null;
          }
        }
        // Our view of this item is provably stale — refresh the list so the browser,
        // open transclusions and any other member's cache stop showing a dead
        // version. Fire-and-forget: the conflict must surface now, not after a fetch.
        void dispatch(loadVaultItems({ vaultId: args.vaultId }));
        return rejectWithValue({
          code: 'item_version_conflict',
          serverVersion: e.serverVersion,
          serverItem,
        } as VaultItemConflict);
      }
      /**
       * UNE COUPURE N'EST PAS UN REFUS DU COFFRE, et c'est ici que la
       * distinction se perd ou se garde.
       *
       * Les trois étapes d'une révision (déclaration, morceaux, commit)
       * relaient l'erreur d'axios telle quelle : hors ligne, elle arrivait à
       * l'écran sous la forme « Network Error », qu'aucune table ne traduit —
       * l'éditeur servait donc son repli, « impossible d'enregistrer, rien n'a
       * été modifié dans le coffre ». Littéralement vrai, et faux de sens : le
       * coffre n'a rien refusé, il n'a pas été atteint, et rien n'annonçait de
       * reprise.
       *
       * `classifyVaultFailure` est l'autorité, et sa preuve est la REQUÊTE :
       * une erreur axios sans objet `response` n'a jamais reçu de réponse. Elle
       * ne consulte pas `navigator.onLine`, qui ment dans les deux sens.
       */
      return rejectWithValue(
        classifyVaultFailure(e) ?? (e as Error).message ?? 'Failed to update item'
      );
    } finally {
      kItem.fill(0);
    }
  }
);

/**
 * Download + decrypt an item's full content → plaintext bytes. NOT a thunk on
 * purpose: a download mutates no Redux state, and routing many MB of decrypted
 * bytes through the action pipeline would expose them to dev tooling (redux-logger
 * / devtools serializableCheck) — mirroring how personal file download returns a
 * path, not bytes, through Redux. Callers await the bytes and consume them
 * out-of-band (render / save). Throws if the vault is locked or a chunk fails.
 */
export async function downloadVaultItemContent(
  vaultId: string,
  item: VaultItemSummary
): Promise<Uint8Array> {
  // Open the item under the K_vault of ITS epoch (older than current after a re-key).
  const kVault = getVaultKey(vaultId, item.wrappedUnderEpoch);
  if (!kVault) throw new Error('Vault is locked for this item');
  const kItem = await unwrapItemKey(item.wrappedItemKey, kVault);
  try {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < item.totalChunks; i++) {
      const enc = await apiDownloadVaultItemChunk(vaultId, item.id, i);
      const plain = await decryptItemChunk(enc, kItem);
      parts.push(plain);
      total += plain.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  } finally {
    kItem.fill(0);
  }
}

/** Une révision, une fois ses métadonnées déchiffrées ici. */
export interface VaultRevisionSummary {
  id: string;
  itemVersion: number;
  meta: VaultItemMeta;
  totalChunks: number;
  sizeBytes: number;
  /** Millisecondes epoch, comme le serveur les envoie. */
  createdAt: number;
  wrappedItemKey: string;
  wrappedUnderEpoch: number;
  /** Faux quand la clé de l'époque de cette révision n'est pas disponible. */
  readable: boolean;
}

/**
 * L'historique d'un élément, déchiffré pour l'affichage.
 *
 * CHAQUE RÉVISION A SA PROPRE ÉPOQUE. Une rotation de K_vault n'a jamais
 * re-scellé les anciennes révisions : chacune porte l'époque sous laquelle elle a
 * été écrite, et s'ouvre avec la clé de CETTE époque. Une révision dont l'époque
 * n'est plus en cache est donc listée mais marquée illisible — la taire ferait
 * disparaître de l'historique une version qui existe, ce qui est pire que de dire
 * qu'on ne peut pas l'ouvrir.
 *
 * Pas un thunk : lire un historique ne mute aucun état, et faire transiter des
 * métadonnées déchiffrées par le pipeline Redux les exposerait aux outils de
 * développement — même raison que `downloadVaultItemContent`.
 */
export async function listVaultItemRevisions(
  vaultId: string,
  itemId: string
): Promise<VaultRevisionSummary[]> {
  const dtos = await apiListVaultItemRevisions(vaultId, itemId);
  const out: VaultRevisionSummary[] = [];
  for (const dto of dtos) {
    const kVault = getVaultKey(vaultId, dto.wrappedUnderEpoch);
    let meta: VaultItemMeta = {};
    let readable = false;
    if (kVault) {
      const kItem = await unwrapItemKey(dto.wrappedItemKey, kVault);
      try {
        meta = await decryptItemMeta<VaultItemMeta>(dto.encryptedMeta, dto.encryptedMetaIv, kItem);
        readable = true;
      } catch {
        // Métadonnées illisibles : la révision existe quand même, on la montre.
      } finally {
        kItem.fill(0);
      }
    }
    out.push({
      id: dto.id,
      itemVersion: dto.itemVersion,
      meta,
      totalChunks: dto.totalChunks,
      sizeBytes: dto.sizeBytes,
      createdAt: dto.createdAt,
      wrappedItemKey: dto.wrappedItemKey,
      wrappedUnderEpoch: dto.wrappedUnderEpoch,
      readable,
    });
  }
  return out;
}

/** Contenu déchiffré d'une révision — même chemin que l'élément vivant. */
export async function downloadVaultRevisionContent(
  vaultId: string,
  itemId: string,
  revision: VaultRevisionSummary
): Promise<Uint8Array> {
  const kVault = getVaultKey(vaultId, revision.wrappedUnderEpoch);
  if (!kVault) throw new Error('Vault is locked for this revision');
  const kItem = await unwrapItemKey(revision.wrappedItemKey, kVault);
  try {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < revision.totalChunks; i++) {
      const enc = await apiDownloadVaultRevisionChunk(vaultId, itemId, revision.id, i);
      const plain = await decryptItemChunk(enc, kItem);
      parts.push(plain);
      total += plain.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  } finally {
    kItem.fill(0);
  }
}

/**
 * Restaurer une révision — en écrivant une NOUVELLE version, jamais en revenant
 * en arrière dans l'histoire.
 *
 * Le contenu d'autrefois est re-déposé par le chemin de mise à jour ordinaire :
 * il repasse donc par le quota mutualisé, par le compare-and-set de version et
 * par la re-cryptographie sous l'époque COURANTE. Restaurer n'efface rien —
 * l'état qu'on quitte devient lui-même une révision, et une restauration
 * malheureuse se défait comme n'importe quel enregistrement.
 */
export const restoreVaultItemRevision = createAsyncThunk(
  'vaults/restoreRevision',
  async (
    args: {
      vaultId: string;
      itemId: string;
      expectedVersion: number;
      revision: VaultRevisionSummary;
    },
    { getState, dispatch, rejectWithValue }
  ) => {
    try {
      const content = await downloadVaultRevisionContent(args.vaultId, args.itemId, args.revision);
      // Restaurer une révision restaure le CONTENU, pas l'EMPLACEMENT : la méta
      // de la révision précède les dossiers (ou en connaît un vieux) et
      // l'écrire en bloc re-téléporterait silencieusement le fichier dans son
      // ancien dossier. Le path (et le marqueur) VIVANTS priment.
      const current = (
        (getState() as { vaults: VaultsState }).vaults.itemsByVault[args.vaultId] ?? []
      ).find((i) => i.id === args.itemId);
      await dispatch(
        updateVaultItem({
          vaultId: args.vaultId,
          itemId: args.itemId,
          expectedVersion: args.expectedVersion,
          meta: current
            ? {
                ...args.revision.meta,
                path: current.meta.path,
                folderMarker: current.meta.folderMarker,
              }
            : args.revision.meta,
          content,
        })
      ).unwrap();
      return { itemId: args.itemId };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'restore_failed');
    }
  }
);

/**
 * Download + decrypt a vault NOTE item's body into the slice cache (memory only,
 * never persisted), keyed by `${vaultId}:${itemId}`. Backs E3-3c transclusion: a
 * personal note stores only the `vault:<vaultId>:<itemId>` REFERENCE, and the embed
 * renders the body live from this cache. If the vault's items aren't loaded yet we
 * load them first so the item (and its wrapped K_item) is resolvable. Fails closed
 * when the vault is locked / access was lost (downloadVaultItemContent throws).
 */
export const loadVaultNoteContent = createAsyncThunk(
  'vaults/loadNoteContent',
  async (args: { vaultId: string; itemId: string }, { getState, dispatch, rejectWithValue }) => {
    const find = () =>
      ((getState() as { vaults: VaultsState }).vaults.itemsByVault[args.vaultId] ?? []).find(
        (i) => i.id === args.itemId
      );
    let item = find();
    if (!item) {
      await dispatch(loadVaultItems({ vaultId: args.vaultId }));
      item = find();
    }
    if (!item) return rejectWithValue('item_not_found');
    try {
      const bytes = await downloadVaultItemContent(args.vaultId, item);
      return { ref: `${args.vaultId}:${args.itemId}`, content: new TextDecoder().decode(bytes) };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'decrypt_failed');
    }
  }
);

/** Delete an item (soft-delete server-side; remove from the slice). */
export const deleteVaultItem = createAsyncThunk(
  'vaults/deleteItem',
  async (args: { vaultId: string; itemId: string }, { rejectWithValue }) => {
    try {
      await apiDeleteVaultItem(args.vaultId, args.itemId);
      return { vaultId: args.vaultId, itemId: args.itemId };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'Failed to delete item');
    }
  }
);

/**
 * Invite a fellow org member: resolve their public key (E2-8), seal the EXISTING
 * K_vault to it (the integrity check inside wrapVaultKeyForMember refuses a
 * substituted/unverifiable key), and POST the wrap. O(1) — no existing member is
 * touched. A 404 means the member hasn't set up their encryption key yet.
 *
 * PLUS AUCUN ÉCRAN NE L'APPELLE DEPUIS F06. La ligne d'invitation unique
 * (`sharing/InviteRow`) et le balayage des intentions passent par
 * `addMemberDirect` ci-dessous quand la personne est DÉJÀ dans l'espace — ce qui
 * est le cas de tout le monde ici, puisqu'on ne sait sceller qu'à une clé qu'on
 * peut résoudre, et qu'on ne résout que les gens de l'espace. Ce thunk reste
 * parce que la voie « invitation par jeton » demeure la bonne pour qui n'est pas
 * encore entré dans l'espace (le worker l'émet toujours), et parce qu'il est
 * l'ancêtre éprouvé du suivant : le supprimer ferait disparaître ses tests.
 */
export const inviteMember = createAsyncThunk(
  'vaults/invite',
  async (
    args: {
      vaultId: string;
      inviteeUserId: string;
      inviteeEmail: string;
      role: 'admin' | 'member' | 'viewer';
      lang?: string;
      /**
       * The invitee's public key, ALREADY verified by the caller (E3-8 invite UI ran
       * the key-transparency + TOFU check and the admin confirmed the fingerprint
       * out-of-band). When present we seal to THIS exact key instead of re-fetching —
       * closing the TOCTOU where the server could swap the served key between the UI's
       * verification and this seal. Falls back to a fresh fetch when omitted.
       */
      peerKey?: MemberPublicKey;
    },
    { getState, rejectWithValue }
  ) => {
    const vault = (getState() as { vaults: VaultsState }).vaults.vaults[args.vaultId];
    if (!vault) return rejectWithValue('Unknown vault');
    // Invite seals the CURRENT-epoch K_vault to the new member.
    const kVault = getVaultKey(args.vaultId, vault.currentKeyEpoch);
    if (!kVault) return rejectWithValue('Vault is locked');

    let peer: MemberPublicKey;
    if (args.peerKey) {
      peer = args.peerKey;
    } else {
      try {
        peer = (await apiGetMemberPublicKey(args.inviteeUserId)) as MemberPublicKey;
      } catch {
        return rejectWithValue('member_no_key'); // invitee has no published keypair yet
      }
    }
    // Fail closed: never seal K_vault to a key whose userId doesn't match the invitee
    // we record the wrap under. wrapVaultKeyForMember only checks the key's OWN
    // identity binding, not that it's the RIGHT person's — so a stale/mis-passed
    // peerKey (e.g. the UI's post-paint selection race) would otherwise seal to the
    // wrong member silently. The fetch path returns userId === inviteeUserId by
    // construction; this asserts it for the caller-supplied path too.
    if (peer.userId && peer.userId !== args.inviteeUserId) {
      return rejectWithValue('peer_key_mismatch');
    }
    try {
      const wrappedVaultKey = await wrapVaultKeyForMember(kVault, peer);
      /**
       * LE LIEN RENDU PAR LE 201 EST DÉLIBÉRÉMENT JETÉ ICI (F16).
       *
       * `apiInviteVaultMember` le rend — le serveur ne le rendra plus jamais —
       * mais la valeur de retour de ce thunk devient une ACTION Redux, donc un
       * état persistable, inspectable dans les devtools et recopié dans tout
       * export d'état. Un porteur d'accès n'a rien à y faire (§7 du plan). Les
       * écrans qui doivent proposer « Copier le lien » appellent la fonction
       * d'API directement et gardent l'URL dans leur état LOCAL, effacé à la
       * fermeture.
       */
      await apiInviteVaultMember(args.vaultId, {
        inviteeUserId: args.inviteeUserId,
        inviteeEmail: args.inviteeEmail,
        role: args.role,
        wrappedVaultKey,
        lang: args.lang,
      });
      return { vaultId: args.vaultId, inviteeEmail: args.inviteeEmail };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'Failed to invite member');
    }
  }
);

/**
 * DONNER L'ACCÈS SUR-LE-CHAMP (F06, décision D1) — l'adhésion, pas l'invitation.
 *
 * MÊME CRYPTOGRAPHIE QUE `inviteMember`, AUTRE DESTINATION. On scelle K_vault de
 * l'époque courante à la clé publique de la personne et on POSTe le scellé ; la
 * seule différence est que le worker écrit une ADHÉSION au lieu d'un porteur à
 * sept jours. C'est légitime parce que l'acceptation ne faisait que copier ce
 * même scellé : le jeton était un consentement, et l'entrée dans l'espace le
 * porte déjà (voir l'en-tête d'`apiAddVaultMember`).
 *
 * LA CLÉ EST CELLE QUE LA CÉRÉMONIE A VÉRIFIÉE, ET ELLE EST OBLIGATOIRE. Pas de
 * repli « je la retéléchargerai » comme dans `inviteMember` : la re-demander
 * rouvrirait exactement la fenêtre où un serveur malveillant peut substituer une
 * clé entre le contrôle de transparence et le scellé. L'appelant a déjà la
 * bonne — `kv.sealArgs.peerKey` — il n'a aucune raison d'en demander une autre.
 *
 * NE TOUCHE PAS À L'ÉTAT : c'est l'appelant qui relit (`reload()` +
 * `afterRosterChange()`), parce que lui seul sait ce que son écran affiche.
 */
export const addMemberDirect = createAsyncThunk(
  'vaults/addMemberDirect',
  async (
    args: {
      vaultId: string;
      userId: string;
      /** Pour le message de succès seulement : le serveur lit l'adresse canonique. */
      email: string;
      role: 'admin' | 'member' | 'viewer';
      /** La clé EXACTEMENT vérifiée par la cérémonie — jamais re-téléchargée. */
      peerKey: MemberPublicKey;
      /**
       * La langue de l'hôte, pour l'avis d'accès que le Worker poste à la
       * personne ajoutée. Facultative : le serveur retombe sur l'anglais, et le
       * chemin d'accès lui-même ne dépend d'aucun e-mail.
       */
      lang?: string;
    },
    { getState, rejectWithValue }
  ) => {
    const vault = (getState() as { vaults: VaultsState }).vaults.vaults[args.vaultId];
    if (!vault) return rejectWithValue('Unknown vault');
    // L'époque COURANTE : sceller sous une époque révolue produirait un membre
    // incapable de lire une seule ligne de ce coffre.
    const kVault = getVaultKey(args.vaultId, vault.currentKeyEpoch);
    if (!kVault) return rejectWithValue('Vault is locked');
    // Fail closed, comme à l'invitation : `wrapVaultKeyForMember` ne vérifie que
    // la cohérence INTERNE de la clé, pas qu'elle appartient à la bonne
    // personne. Une sélection qui a bougé pendant la cérémonie scellerait sinon
    // le coffre à quelqu'un d'autre, sous l'identifiant de la personne choisie.
    if (args.peerKey.userId && args.peerKey.userId !== args.userId) {
      return rejectWithValue('peer_key_mismatch');
    }
    try {
      const wrappedVaultKey = await wrapVaultKeyForMember(kVault, args.peerKey);
      const member = await apiAddVaultMember(args.vaultId, {
        userId: args.userId,
        role: args.role,
        wrappedVaultKey,
        lang: args.lang,
      });
      return { vaultId: args.vaultId, member };
    } catch (e) {
      // VERBATIM : « déjà membre » et « plus dans votre espace » appellent deux
      // gestes opposés de la part de l'hôte.
      return rejectWithValue((e as Error).message ?? 'add_member_failed');
    }
  }
);

/**
 * Refus qui ne disent RIEN du coffre lui-même, seulement du locataire visé : la
 * requête est partie contre le mauvais espace. Le Worker ne consomme le jeton
 * qu'à sa toute dernière étape (vaults.ts, `acceptVaultInvite`), après le
 * contrôle `vault.organization_id !== orgId` — un mauvais locataire répond donc
 * 404 sans brûler l'invitation, ce qui est précisément ce qui rend un sondage
 * sûr. Tout autre code est une décision : y insister ne changerait rien.
 */
const JOIN_WRONG_TENANT_CODES: ReadonlySet<string> = new Set([
  'vault_not_found',
  'org_required',
  'org_forbidden',
  'not_a_member',
]);

/** Le locataire refuse notre appartenance : c'est l'invitation d'ESPACE qui manque. */
const JOIN_NOT_A_MEMBER_CODES: ReadonlySet<string> = new Set(['org_forbidden', 'not_a_member']);

/**
 * Accept an invite by token, then refresh (loadVaults unlocks the new K_vault).
 *
 * `orgId` vient du lien d'invitation : POST /vaults/:id/join lit son locataire
 * dans X-Org-Id, et le client ne sait remplir que le SIEN. Sans lui la jointure
 * viserait notre propre espace et repartirait en 404. Les e-mails envoyés avant
 * que le Worker ne porte ce paramètre n'en ont pas : on essaie alors, un par un,
 * les espaces qu'on connaît — borné par leur nombre, et sans risque pour le
 * jeton (voir JOIN_WRONG_TENANT_CODES). Et quand on n'en connaît AUCUN, on ne
 * part pas quand même : voir le refus `vault_join_needs_space` ci-dessous.
 */
export const joinVault = createAsyncThunk(
  'vaults/join',
  async (
    args: { vaultId: string; token: string; orgId?: string },
    { getState, dispatch, rejectWithValue }
  ) => {
    const tenants = (): string[] => [...new Set(selectSharedVaultOrgIds(getState() as RootState))];
    let known = tenants();
    /**
     * La liste des locataires a-t-elle été LUE, ou seulement pas remplie ?
     *
     * Le sélecteur documente lui-même l'ambiguïté (« Empty = no context yet —
     * org list not loaded / offline ») : une liste vide dit à la fois « je
     * n'appartiens à aucun espace » et « je n'ai pas pu le savoir ». Les
     * confondre rendait un verdict TERMINAL, sans bouton « Réessayer », à qui
     * n'avait qu'à attendre le réseau.
     */
    let listUnreadable = false;
    if (known.length === 0) {
      // Course au démarrage, ou session tout juste revenue en ligne : relire la
      // liste avant de conclure qu'il n'y a nulle part où viser.
      const refreshed = await dispatch(fetchOrgs());
      listUnreadable = fetchOrgs.rejected.match(refreshed);
      known = tenants();
    }
    const attempts = args.orgId ? [args.orgId, ...known.filter((id) => id !== args.orgId)] : known;

    // JAMAIS de jointure sans locataire. Sans X-Org-Id le Worker bascule sur
    // `personalFallback` (rbac.ts), qui PROVISIONNE un espace personnel — et le
    // refuse en 403 `upgrade_required` sur un palier gratuit. Un invité gratuit
    // ouvrant un lien de coffre sans `org=` (donc tous les e-mails déjà partis,
    // la raison même du sondage) s'entendait ainsi vendre un abonnement pour un
    // espace que son HÔTE paie. Il n'y a rien à tenter tant que l'invitation
    // d'ESPACE n'a pas été acceptée : c'est elle qui crée l'adhésion.
    //
    // …SAUF quand la liste n'a pas pu être LUE. « Acceptez d'abord l'invitation
    // à l'espace » est alors faux, et surtout terminal : l'écran retire son
    // bouton « Réessayer » à quelqu'un pour qui réessayer était exactement la
    // bonne chose à faire. Une panne de lecture rend un code TRANSITOIRE.
    if (attempts.length === 0) {
      return rejectWithValue(
        listUnreadable ? 'vault_join_space_unknown' : 'vault_join_needs_space'
      );
    }

    // Ce que l'index portait AVANT le sondage : un coffre déjà listé y a son
    // vrai locataire, et l'effacer au premier démenti le renverrait au contexte
    // ambiant pour tous ses appels suivants.
    const pinnedBefore = getRememberedVaultOrg(args.vaultId);

    let lastCode = 'vault_not_found';
    let sawMembershipRefusal = false;

    for (const orgId of attempts) {
      rememberVaultOrg(args.vaultId, orgId);
      try {
        const r = await apiJoinVault(args.vaultId, args.token);
        await dispatch(loadVaults());
        return { vaultId: args.vaultId, role: r.role };
      } catch (e) {
        // JAMAIS `invite_invalid` en repli : c'est un verdict du serveur (« ce
        // jeton n'existe plus »), et l'écran d'acceptation efface le porteur
        // dessus. Le fabriquer sur une exception muette détruisait une
        // invitation vivante.
        lastCode = (e as Error)?.message || UNKNOWN_FAILURE_CODE;
        // Restaurer l'hypothèse d'origine plutôt que de dépunaiser : un lien
        // périmé ne doit pas emporter l'index d'un coffre légitime.
        if (pinnedBefore) rememberVaultOrg(args.vaultId, pinnedBefore);
        else forgetVaultOrg(args.vaultId);
        if (JOIN_NOT_A_MEMBER_CODES.has(lastCode)) sawMembershipRefusal = true;
        if (!JOIN_WRONG_TENANT_CODES.has(lastCode)) return rejectWithValue(lastCode);
      }
    }

    // Épuisé sur des refus d'appartenance : l'ordre en deux temps n'a pas été
    // suivi. Dire « ce coffre n'existe plus » serait faux ET décourageant.
    if (sawMembershipRefusal) return rejectWithValue('vault_join_needs_space');
    return rejectWithValue(lastCode);
  }
);

/**
 * LE BALAYAGE DES INTENTIONS (0073) — le second geste de l'hôte, rendu inutile.
 *
 * Lancé après chaque chargement des coffres, c'est-à-dire à chaque fois que
 * l'hôte ouvre l'écran : le moment exact où « quelqu'un attend-il quelque chose
 * de moi ? » se pose. Aucun sondage périodique — une invitation n'est pas un
 * message instantané, et le scellement n'a pas besoin d'être immédiat, seulement
 * d'être CERTAIN d'arriver.
 *
 * NE REJETTE JAMAIS. C'est une greffe sur un écran qui marche sans elle ; la
 * faire échouer bruyamment échangerait un confort contre une panne.
 *
 * La vérification de clé n'est PAS automatisée : `runGrantSweep` refuse de
 * sceller sous un verdict de transparence qui demande un humain, et remonte le
 * cas au lieu de l'exécuter. Voir pendingGrantSweep.ts.
 *
 * PORTÉE FACULTATIVE (F04, « Réessayer maintenant »). Sans argument, le balayage
 * passe sur TOUS les coffres — c'est ce que fait `VaultsBootstrapHost` au
 * déverrouillage. Avec `vaultIds`, il ne regarde que ceux-là : la fiche « Où en
 * est l'accès de X ? » offre une reprise immédiate sans faire repartir un tour
 * complet (et donc sans risquer un e-mail pour un coffre qu'on ne regardait
 * pas). La portée voyage jusqu'au réducteur, qui ne remplace alors que la part
 * correspondante de `blockedGrants` — remplacer tout effacerait les blocages
 * des autres coffres, qu'on n'a pas réexaminés.
 *
 * UN SEUL BALAYAGE À LA FOIS, ET LA GARDE VIT ICI. Elle vivait dans une `ref`
 * de `VaultsBootstrapHost`, qui ne voyait donc pas les dispatches venus d'un
 * écran. Deux passages qui se croisent scellent deux fois la même personne : le
 * serveur refuse le second, et l'hôte lit un refus là où tout s'est bien passé.
 */
let grantSweepInFlight = false;

export const sweepPendingGrants = createAsyncThunk(
  'vaults/sweepPendingGrants',
  async (args: { vaultIds?: string[]; lang?: string } | void, { getState, dispatch }) => {
    grantSweepInFlight = true;
    try {
      const scope = args?.vaultIds ?? null;
      const state = (getState() as { vaults: VaultsState }).vaults;
      const candidates = state.vaultIds
        .filter((id) => !scope || scope.includes(id))
        .map((id) => ({
          id,
          role: state.vaults[id]?.role ?? 'viewer',
          // Un coffre verrouillé ne porte pas K_vault en mémoire : il n'y a
          // matériellement rien à sceller, et le tenter ne produirait qu'un refus.
          unlocked: state.unlockedVaultIds.includes(id),
        }));

      const outcome = await runGrantSweep(candidates, {
        listGrants: (vaultId) => apiListPendingGrants(vaultId),
        // La clé VÉRIFIÉE est passée telle quelle au scellement : la redemander
        // rouvrirait la fenêtre où le serveur peut en substituer une autre entre
        // le contrôle et le scellé. L'enchaînement lui-même vit dans
        // `peerVerification`, partagé avec « Réinviter » et « Vérifier sa clé
        // maintenant » — deux copies d'un contrôle anti-substitution finiraient
        // par diverger en silence.
        verify: verifyPeerKey,
        /**
         * AJOUT DIRECT, PLUS INVITATION (F06). Une intention mûre veut dire que
         * la personne est DÉJÀ active dans l'espace de l'hôte : lui envoyer un
         * jeton ajoutait un e-mail, une attente et une péremption à sept jours
         * pour un consentement qu'elle avait donné en entrant — et c'est cette
         * péremption qui a produit le cas rapporté. Les verdicts de
         * transparence, eux, ne bougent pas d'un cran : `runGrantSweep` a déjà
         * refusé tout ce qui demande un humain avant d'arriver ici.
         */
        seal: async ({ vaultId, grant, peerKey }) => {
          const result = await dispatch(
            addMemberDirect({
              vaultId,
              userId: grant.userId,
              email: grant.email,
              role: grant.role,
              peerKey: peerKey as MemberPublicKey,
              // Le balayage est AUTOMATIQUE, mais il agit pour l'hôte : l'avis
              // d'accès part donc dans SA langue, comme s'il avait cliqué. Sans
              // elle, la personne ajoutée par le balayage recevrait de l'anglais
              // là où le même geste fait à la main lui aurait parlé français.
              lang: args?.lang,
            })
          );
          return addMemberDirect.rejected.match(result)
            ? ((result.payload as string) ?? 'seal_failed')
            : null;
        },
      });

      return { ...outcome, scope };
    } finally {
      grantSweepInFlight = false;
    }
  },
  {
    // Un balayage déjà en vol REFUSE le suivant, d'où qu'il vienne — le
    // déverrouillage d'un coffre ou le bouton « Réessayer maintenant » de la
    // fiche. `condition` s'exécute avant `pending` : le second dispatch est
    // simplement annulé, sans `pending` ni requête.
    condition: () => !grantSweepInFlight,
  }
);

/**
 * LE RATTRAPAGE DES PARTAGES DE DOSSIER — la seconde moitié du geste.
 *
 * ── CE QU'IL FERME ──────────────────────────────────────────────────────────
 *
 * Partager « ce dossier sauf trois fichiers » scelle un accès pour chaque
 * élément PRÉSENT. Un fichier déposé le lendemain n'a d'accès pour personne :
 * personne n'était là pour le sceller. L'hôte, lui, croit avoir partagé un
 * DOSSIER — il ne reviendra pas vérifier, et la personne d'en face ne peut pas
 * savoir qu'il manque quelque chose.
 *
 * Ce balayage rattrape, à l'ouverture du coffre, UNE FOIS PAR SESSION. Pas de
 * sondage : un fichier partagé avec une seconde de retard n'est pas un
 * problème, un fichier jamais partagé en est un.
 *
 * ── POURQUOI IL NE PEUT PAS SE TROMPER DANS LE MAUVAIS SENS ─────────────────
 *
 * Trois refus, dans cet ordre, et chacun ferme une fuite :
 *
 *   1. LE DOCUMENT ILLISIBLE ARRÊTE TOUT. Les exclusions vivent dedans. Un
 *      client qui ne sait pas l'ouvrir (coffre verrouillé, époque de clé qu'il
 *      n'a pas) ne connaît PAS ce qui a été retiré : rattraper à l'aveugle
 *      rendrait accessible exactement ce qu'on avait décoché.
 *   2. LA BORNE DE DATE écarte ce qui existait au moment du partage — donc les
 *      décochés et les révoqués — sans avoir à s'en souvenir (`folderGrantPlan`).
 *   3. LA VÉRIFICATION DE CLÉ n'est PAS relâchée : `createItemGrant` refait le
 *      contrôle de transparence à chaque scellement et REFUSE `changed` sans
 *      empreinte confirmée hors bande. Ce balayage ne lui en passe aucune —
 *      une clé qui a tourné attend donc un humain, comme au premier partage.
 *      C'est pour cela qu'il n'y a pas de garde de plus ici : une seconde copie
 *      du contrôle anti-substitution finirait par diverger de la première.
 *
 * ── NE REJETTE JAMAIS, N'AFFICHE RIEN ───────────────────────────────────────
 *
 * C'est une greffe sur un écran qui marche sans elle. Un rattrapage qui ferait
 * échouer l'ouverture d'un coffre échangerait un confort contre une panne, et
 * une erreur affichée pour un geste que l'utilisateur n'a pas demandé
 * l'inquiéterait sans lui donner quoi faire. Ce qui échoue est simplement
 * repris à la session suivante.
 */
const folderCatchUpDone = new Set<string>();

/** Le déverrouillage change ce qu'on sait lire : le rattrapage redevient dû. */
export function resetFolderCatchUp(): void {
  folderCatchUpDone.clear();
}

/**
 * TOUT CE QUE LE RATTRAPAGE DOIT LIRE, en un seul endroit.
 *
 * ── POURQUOI CETTE FONCTION EXISTE, ET CE N'EST PAS DU RANGEMENT ────────────
 *
 * La porte « une fois par coffre et par session » ne doit se fermer que sur une
 * tentative qui a pu LIRE. Deux fois aujourd'hui la marque était posée trop
 * tôt : d'abord avant la lecture des intentions (un coffre verrouillé coûtait
 * la session), puis avant celle des accès vivants (une coupure de trois
 * secondes coûtait la session). Deux fois la même faute, corrigée deux fois par
 * déplacement d'une ligne.
 *
 * Tant que la porte vit à côté du réseau, le PROCHAIN appel qu'on ajoutera aura
 * le même défaut — et il se relira comme correct. Rassembler les lectures ici
 * rend la propriété structurelle : la marque se pose sur ce que CETTE fonction
 * rend, donc une lecture ajoutée plus tard est couverte par construction, sans
 * que personne ait à y penser.
 *
 * (Observation de la session mobile, chez qui le découpage donnait la propriété
 * gratuitement : la porte vivait dans le module pur, le réseau chez l'appelant.)
 *
 * Rend `null` dès qu'une lecture manque ou refuse — l'appelant s'arrête SANS
 * fermer la porte.
 */
async function lireLeNecessaireAuRattrapage(
  vaultId: string,
  state: VaultsState
): Promise<{ intents: FolderShareIntent[]; items: CatchUpItem[]; grants: VaultGrantDTO[] } | null> {
  const vault = state.vaults[vaultId];
  // Seul un hôte peut faire entrer quelqu'un ; un membre ordinaire n'a rien à
  // rattraper et le serveur le lui refuserait N fois de suite.
  if (!vault || !canGrantIn(vault.role ?? 'viewer')) return null;
  // Un coffre verrouillé ne porte pas K_vault : il n'y a matériellement rien à
  // lire, et rien à sceller.
  if (!state.unlockedVaultIds.includes(vaultId)) return null;

  const loaded = await loadShareIntents(vaultId);
  // `readable: false` n'est PAS « aucune intention » : c'est « le document
  // existe et nous ne savons pas l'ouvrir ». Rattraper à l'aveugle rendrait
  // accessible exactement ce qu'on avait décoché.
  if (!loaded.readable) return null;

  const items = (state.itemsByVault[vaultId] ?? []) as CatchUpItem[];

  /*
    `apiListVaultGrants` REMONTE ses échecs, et c'est voulu : une liste vide
    rendue sur une panne répondrait « personne n'a accès », la pire des
    réponses fausses. Planifier avec cette liste-là ne serait pas dangereux —
    le serveur répond `already_granted` — mais on retenterait le scellement de
    tout ce qui est déjà accordé, à chaque ouverture.
  */
  const grants = await apiListVaultGrants(vaultId);
  return { intents: loaded.document.intents, items, grants };
}

export const catchUpFolderShares = createAsyncThunk(
  'vaults/catchUpFolderShares',
  async (args: { vaultId: string }, { getState, dispatch }) => {
    const vide = { vaultId: args.vaultId, sealed: 0, grantees: 0 };
    try {
      const state = (getState() as { vaults: VaultsState }).vaults;
      const lu = await lireLeNecessaireAuRattrapage(args.vaultId, state);
      // Une lecture manquante ou refusée : on s'arrête SANS fermer la porte.
      if (!lu) return vide;

      /*
        LA PORTE SE FERME ICI, ET SEULEMENT ICI.

        Tout ce qu'il fallait lire l'a été. Ce qui suit ne lit plus rien —
        un calcul pur, puis des scellements dont l'échec est traité
        personne par personne. Une lecture ajoutée plus tard ira dans
        `lireLeNecessaireAuRattrapage`, donc AVANT cette ligne, sans que
        personne ait à y penser : c'est ce qui rend la propriété
        structurelle plutôt que dépendante d'une vigilance.
      */
      folderCatchUpDone.add(args.vaultId);

      if (lu.intents.length === 0 || lu.items.length === 0) return vide;
      const plan = planVaultCatchUp(lu.items, lu.intents, lu.grants);
      if (plan.length === 0) return vide;

      let sealed = 0;
      for (const cible of plan) {
        const r = await dispatch(
          createItemGrants({
            vaultId: args.vaultId,
            itemIds: cible.itemIds,
            granteeUserId: cible.granteeUserId,
          })
        );
        // Un refus sur UNE personne (sa clé a tourné, elle n'en a pas publié)
        // ne doit pas priver les autres de leur rattrapage : on passe à la
        // suivante. Le lot lui-même s'arrête au premier échec, et son bilan
        // partiel compte — ce qui est scellé l'est.
        const bilan = createItemGrants.fulfilled.match(r)
          ? r.payload
          : (r.payload as { granted?: string[] } | undefined);
        sealed += bilan?.granted?.length ?? 0;
      }
      return { vaultId: args.vaultId, sealed, grantees: plan.length };
    } catch {
      return vide;
    }
  },
  {
    /*
      UNE FOIS PAR COFFRE ET PAR SESSION, ET LA GARDE EST ICI.

      `loadVaultItems` se rejoue après CHAQUE mutation d'élément (dépôt,
      renommage, rescellement) : sans cette porte, déposer dix fichiers
      déclencherait dix balayages, chacun lisant les intentions et TOUS les
      accès du coffre.

      La marque, elle, se pose seulement quand le document a pu être LU (voir
      le corps). Deux dispatches qui se croiseraient avant cette lecture
      passeraient donc tous les deux — et c'est sans conséquence : le second ne
      trouve plus rien à sceller, ou reçoit `already_granted`, qui n'est pas une
      erreur. Fermer cette course coûterait un verrou pour rien, là où l'ouvrir
      dans l'autre sens — marquer avant de savoir — coûterait le rattrapage de
      toute la session.
    */
    condition: (args: { vaultId: string }) => !folderCatchUpDone.has(args.vaultId),
  }
);

/**
 * La boîte de réception d'invitations du COMPTE (GET /me/invitations).
 *
 * Complément du lien e-mail, pas remplacement : l'e-mail perdu, filtré ou ouvert
 * sur le mauvais appareil n'est plus le seul chemin — l'écran des coffres
 * montre ce qui attend l'adresse du compte, à travers tous les locataires.
 */
export const fetchMyInvitations = createAsyncThunk('vaults/fetchMyInvitations', async () => {
  return apiListMyInvitations();
});

/**
 * Les têtes du fil d'activité de TOUS les coffres — une requête, pour la
 * pastille des cartes de l'accueil (lot A, C4). CATCH SILENCIEUX : pas de
 * pastille vaut mieux qu'une erreur à l'écran, et un échec rend `null` pour que
 * le réducteur GARDE les têtes précédentes plutôt que d'éteindre des pastilles
 * encore justes.
 */
export const loadVaultActivityHeads = createAsyncThunk(
  'vaults/loadActivityHeads',
  async (): Promise<VaultActivityHeadDTO[] | null> => {
    try {
      const r = await apiGetVaultActivityHeads();
      return r.heads;
    } catch {
      return null;
    }
  }
);

/**
 * Accepte par IDENTIFIANT — le serveur a déjà scellé K_vault pour nous, il ne
 * manque que le oui.
 *
 * ORDRE NON NÉGOCIABLE : `rememberVaultOrg` AVANT `loadVaults`. Le coffre
 * accepté vit dans le locataire de l'INVITATION, pas dans le contexte ambiant ;
 * charger d'abord ferait résoudre le nouveau coffre contre le mauvais espace et
 * le déballage de K_vault échouerait au premier passage.
 *
 * RÉCONCILIATION DU PORTEUR : si un lien e-mail pour le MÊME coffre traîne dans
 * localStorage, l'acceptation par identifiant le rend caduc — on l'efface pour
 * que l'écran d'acceptation ne repropose pas un jeton que le serveur vient de
 * régler (il répondrait `invite_invalid` et brûlerait la confiance, pas le jeton).
 */
export const acceptMyInvitation = createAsyncThunk(
  'vaults/acceptMyInvitation',
  async (args: { inviteId: string }, { dispatch, rejectWithValue }) => {
    try {
      const r = await apiAcceptMyInvitation(args.inviteId);
      rememberVaultOrg(r.vaultId, r.orgId);
      for (const pending of readPendingInvites()) {
        if (pending.kind === 'vault' && pending.vaultId === r.vaultId) {
          clearPendingInvite(pending);
        }
      }
      await dispatch(loadVaults());
      await dispatch(fetchMyInvitations());
      return { vaultId: r.vaultId, orgId: r.orgId, role: r.role };
    } catch (e) {
      return rejectWithValue((e as Error)?.message || UNKNOWN_FAILURE_CODE);
    }
  }
);

/** Refuse une invitation — l'hôte voit « Refusée » dans son accusé, sans e-mail. */
export const declineMyInvitation = createAsyncThunk(
  'vaults/declineMyInvitation',
  async (args: { inviteId: string }, { dispatch, rejectWithValue }) => {
    try {
      await apiDeclineMyInvitation(args.inviteId);
    } catch (e) {
      const code = (e as Error)?.message || UNKNOWN_FAILURE_CODE;
      // `invite_settled` : réglée entre l'affichage et le clic — recharger
      // suffit, l'erreur n'a rien à dire de plus que la liste fraîche.
      await dispatch(fetchMyInvitations());
      if (code !== 'invite_settled') return rejectWithValue(code);
      return { inviteId: args.inviteId };
    }
    await dispatch(fetchMyInvitations());
    return { inviteId: args.inviteId };
  }
);

/** Leave a vault (self). Purges the cached K_vault — we no longer hold access. */
export const leaveVault = createAsyncThunk(
  'vaults/leave',
  async (args: { vaultId: string }, { rejectWithValue }) => {
    try {
      await apiLeaveVault(args.vaultId);
      lockVaultEverywhere(args.vaultId);
      return { vaultId: args.vaultId };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'Failed to leave vault');
    }
  }
);

/**
 * Renommer un coffre — le nom est re-chiffré ICI, sous K_vault.
 *
 * Sous l'époque COURANTE, comme tout ce qu'on écrit : le nom d'un coffre n'a
 * jamais eu de raison de rester scellé à une époque révolue, et l'y laisser le
 * rendrait illisible pour qui n'a que la clé récente.
 */
export const renameVault = createAsyncThunk(
  'vaults/rename',
  async (args: { vaultId: string; name: string }, { getState, rejectWithValue }) => {
    const state = (getState() as { vaults: VaultsState }).vaults;
    const vault = state.vaults[args.vaultId];
    if (!vault) return rejectWithValue('Unknown vault');
    const kVault = getVaultKey(args.vaultId, vault.currentKeyEpoch);
    if (!kVault) return rejectWithValue('Vault is locked');

    try {
      // L'ENVELOPPE ENTIÈRE, PAS LE SEUL NOM (F14). L'apparence est rangée dans
      // la même colonne : n'écrire que le nom l'effacerait pour tout le monde,
      // sans erreur nulle part — on renomme un coffre bien plus souvent qu'on
      // ne le repeint, et le défaut serait donc découvert très tard.
      const { nameEncrypted, nameIv } = await encryptVaultName(
        encodeVaultName({ name: args.name, appearance: vault.appearance }),
        kVault
      );
      await apiRenameVault(args.vaultId, nameEncrypted, nameIv);
      return { vaultId: args.vaultId, name: args.name };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'rename_failed');
    }
  }
);

/**
 * L'APPARENCE DU COFFRE, POUR TOUT LE MONDE (F14).
 *
 * Le même geste que renommer, par l'autre bout : on rescelle l'enveloppe
 * entière sous la clé de l'époque courante, avec le nom qu'on a et l'apparence
 * qu'on vient de choisir. La portée « pour moi » ne passe PAS par ici — elle
 * n'a rien à faire dans un chiffré partagé, et vit en localStorage
 * (`vaultAppearanceLocal`).
 *
 * UN NOM VIDE ARRÊTE LE GESTE, et c'est la même règle qu'à la rotation : un nom
 * vide ne veut pas dire « ce coffre n'a pas de nom », il veut dire que le
 * déchiffrement a échoué au dernier chargement. Sceller `{"v":1,"n":""}` par-
 * dessus détruirait pour de bon un nom qui redeviendrait lisible dès que la clé
 * manquante revient — on refuse plutôt que d'écraser à l'aveugle.
 *
 * DETTE PAYÉE : le passage par `apiRenameVault` faisait écrire `vault.rename`
 * au worker, donc l'onglet « Activité » annonçait « a renommé le coffre » à
 * chaque repeinte, sous les yeux de tous les membres. Le geste était le bon
 * (c'est la même écriture chiffrée), c'était le RÉCIT qui était faux — et le
 * serveur ne pouvait pas trancher, puisqu'il ne déchiffre rien. Il accepte
 * désormais un `change` que le client seul peut renseigner, et écrit
 * `vault.appearance` (voir `CHANGES-2026-09.md`, §2).
 */
export const setVaultAppearance = createAsyncThunk(
  'vaults/setAppearance',
  async (
    args: { vaultId: string; appearance: VaultAppearance | undefined },
    { getState, rejectWithValue }
  ) => {
    const state = (getState() as { vaults: VaultsState }).vaults;
    const vault = state.vaults[args.vaultId];
    if (!vault) return rejectWithValue('Unknown vault');
    const kVault = getVaultKey(args.vaultId, vault.currentKeyEpoch);
    if (!kVault) return rejectWithValue('Vault is locked');
    if (!vault.name) return rejectWithValue('vault_name_unreadable');

    try {
      const { nameEncrypted, nameIv } = await encryptVaultName(
        encodeVaultName({ name: vault.name, appearance: args.appearance }),
        kVault
      );
      // `'appearance'` : c'est la SEULE chose qui distingue ce geste d'un
      // renommage pour un serveur qui ne déchiffre rien.
      await apiRenameVault(args.vaultId, nameEncrypted, nameIv, 'appearance');
      // CE QU'ON RANGE EST CE QU'ON A SCELLÉ. `encodeVaultName` normalise avant
      // de chiffrer ; rendre l'argument BRUT ferait afficher dans les cartes et
      // le fil d'Ariane un emoji multi-graphèmes (ou une couleur hors palette)
      // que l'enveloppe, elle, n'a jamais porté — jusqu'au prochain
      // `loadVaults`, qui le ferait disparaître sans explication.
      return { vaultId: args.vaultId, appearance: normalizeVaultAppearance(args.appearance) };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'rename_failed');
    }
  }
);

/**
 * Supprimer le coffre — pour tout le monde, pas seulement pour soi.
 *
 * Le retrait de l'état local est le MÊME que celui d'un départ (`leaveVault`) :
 * dans les deux cas le coffre cesse d'être accessible à cet appareil, et laisser
 * traîner ses éléments déchiffrés ou ses clés en mémoire serait pire ici, où
 * l'objet est censé disparaître. `lockVaultEverywhere` purge le cache de clés.
 *
 * La suppression reste rétractable côté serveur pendant sa grâce ; c'est
 * volontairement le serveur qui garde cette mémoire, pas le client.
 */
export const deleteVault = createAsyncThunk(
  'vaults/delete',
  async (args: { vaultId: string }, { rejectWithValue }) => {
    try {
      const { restorableUntil } = await apiDeleteVault(args.vaultId);
      lockVaultEverywhere(args.vaultId);
      return { vaultId: args.vaultId, restorableUntil };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'Failed to delete vault');
    }
  }
);

/**
 * LA CORBEILLE DES COFFRES — la moitié manquante de la suppression.
 *
 * `apiRestoreVault` existait sans un seul appelant, et rien ne listait les
 * coffres supprimés : la liste ordinaire les écarte, par construction. La
 * promesse « récupérable pendant trente jours », faite à deux endroits de
 * l'interface, ne menait donc nulle part.
 *
 * On réutilise `toVaultSummary` — donc le nom est déchiffré comme partout
 * ailleurs, avec la copie scellée de K_vault que le propriétaire détient
 * toujours. Un coffre sans nom lisible reste listé : c'est un coffre à
 * récupérer, pas un coffre à cacher.
 */
export const loadDeletedVaults = createAsyncThunk(
  'vaults/loadDeleted',
  async (_: void, { rejectWithValue }) => {
    try {
      const dtos = await apiListDeletedVaults();
      return await Promise.all(
        dtos.map(async (dto) => ({
          ...(await toVaultSummary(dto)),
          deletedAt: dto.deletedAt ?? null,
          restorableUntil: dto.restorableUntil,
        }))
      );
    } catch (e) {
      return rejectWithValue(
        classifyVaultFailure(e) ?? (e as Error).message ?? 'Failed to load deleted vaults'
      );
    }
  }
);

/**
 * Rétracter une suppression. La liste vivante est rechargée derrière : c'est elle
 * qui fait réapparaître le coffre, avec sa clé et ses éléments, plutôt qu'une
 * reconstruction locale qui divergerait du serveur.
 */
export const restoreVault = createAsyncThunk(
  'vaults/restore',
  async (args: { vaultId: string }, { dispatch, rejectWithValue }) => {
    try {
      await apiRestoreVault(args.vaultId);
      await dispatch(loadVaults());
      return { vaultId: args.vaultId };
    } catch (e) {
      return rejectWithValue((e as Error).message ?? 'Failed to restore vault');
    }
  }
);

// A rotation is RETRYABLE when a concurrent membership change made our roster/epoch
// stale: a 409 vault_epoch_conflict (CAS lost) OR a 400 wrap_set_mismatch (a member
// JOINED between our roster read and the server's). Both are absorbed by re-reading
// the roster + epoch and recomputing within the retry budget.
function isRetryableRotateConflict(e: unknown): boolean {
  const err = e as { response?: { status?: number; data?: { code?: string } } };
  const status = err?.response?.status;
  const code = err?.response?.data?.code;
  return (
    (status === 409 && code === 'vault_epoch_conflict') ||
    (status === 400 && code === 'wrap_set_mismatch')
  );
}

/**
 * Le BLOC DE RÉGLAGES (F13) rescellé sous la clé neuve — ou rien.
 *
 * MÊME RAISON QUE LE NOM (P1), AUTRE COLONNE. `settings_encrypted` est scellé
 * sous K_vault avec sa PROPRE époque : une rotation qui le laisse en place le
 * rend illisible pour tout le monde, et l'onglet Réglages afficherait alors une
 * description vide — c'est-à-dire un texte qu'on croirait effacé, là où il
 * suffit de le ré-enregistrer.
 *
 * QUATRE FAÇONS DE NE RIEN ENVOYER, ET AUCUNE N'ARRÊTE LA ROTATION. Retirer
 * quelqu'un d'un coffre est un geste de SÉCURITÉ : rien de ce qui touche à une
 * description n'a le droit de l'empêcher.
 *   · la route des réglages échoue          → on ne sait pas s'il y a un bloc ;
 *   · il n'y en a pas                       → rien à resceller ;
 *   · son époque est inconnue ou n'est pas   → on ignore sous quelle clé il a été
 *     l'époque courante                        scellé, et l'ouvrir est exclu ;
 *   · il ne s'ouvre pas (tag AES-GCM)       → on ne fabrique pas un chiffré à
 *                                              partir d'un texte qu'on n'a pas lu.
 * Dans ces quatre cas, le serveur garde l'ancien couple ET son ancienne époque,
 * si bien que `settingsSealVerdict` dira « scellé sous une clé précédente » et
 * que l'écran proposera de le ré-enregistrer. C'est exactement l'inverse
 * d'écraser en silence ce qui est peut-être encore récupérable ailleurs.
 *
 * LE BLOC EST RESCELLÉ ENTIER, tel qu'il a été lu — jamais reconstruit depuis
 * les champs que CETTE version comprend : l'apparence (F14) et la règle de
 * vérification (F25) doivent traverser la rotation intactes.
 */
async function rescellerReglages(
  vaultId: string,
  currentEpoch: number,
  kNew: Uint8Array
): Promise<{ settingsEncrypted: string; settingsIv: string } | undefined> {
  try {
    const stored = await apiGetVaultSettings(vaultId);
    const bloc = stored.encrypted;
    if (!bloc || bloc.settingsEpoch !== currentEpoch) return undefined;
    const kOld = getVaultKey(vaultId, bloc.settingsEpoch);
    if (!kOld) return undefined;
    const clair = await decryptVaultBlob(bloc.settingsEncrypted, bloc.settingsIv, kOld);
    const { ciphertext, iv } = await encryptVaultBlob(clair, kNew);
    return { settingsEncrypted: ciphertext, settingsIv: iv };
  } catch {
    return undefined;
  }
}

/**
 * Faire tourner la clé du coffre = LAZY RE-KEY (E3-5). Generate a fresh K_vault', re-wrap it to
 * every REMAINING member (resolved + integrity-checked via E2-8), and atomically
 * rotate (epoch+1) while deleting the target — serialised by the compare-and-set
 * (E3-10). On a 409 epoch conflict (a concurrent membership change) we re-fetch and
 * recompute, bounded. CAVEAT (surface in the UI before calling, E3-8): the removed
 * member keeps whatever content they ALREADY downloaded — this is forward-only
 * revocation; new items under K_vault' are out of their reach.
 *
 * PLUSIEURS CIBLES EN UN SEUL APPEL, ET CE N'EST PAS UN CONFORT (F08). Resceller
 * K_vault' à un membre exige de lire sa clé publique, et
 * `GET /account/public-key/:userId` répond 403 `org_forbidden` dès que son
 * appartenance à l'espace n'est plus active — c'est-à-dire pour EXACTEMENT les
 * gens que le bandeau « hors de l'espace » désigne. Avec deux d'entre eux, un
 * retrait par personne échouait dans les deux sens : retirer A s'arrête en
 * rescellant à B, retirer B s'arrête en rescellant à A. En les passant tous à la
 * même rotation, aucun ne fait partie des « restants » et le geste aboutit — le
 * serveur l'accepte déjà (`removeUserIds` est un tableau, et sa garde ne porte
 * que sur la couverture des restants).
 *
 * LE GROUPE EST LE CAS GÉNÉRAL, UNE PERSONNE EN EST LE CAS PARTICULIER (F09).
 * La barre de sélection de l'onglet Membres retire N lignes cochées d'un coup ;
 * un bouton de ligne en retire une. Ce sont le MÊME geste — une rotation, une
 * seule époque de plus, un seul rescellement du nom et du bloc de réglages — et
 * deux implémentations finiraient par diverger sur ce qui coûte le plus cher à
 * rater. D'où un seul thunk, exporté sous ses trois noms.
 *
 * ET LE RETRAIT LUI-MÊME N'EST QU'UN CAS DE LA ROTATION (F10). « Renouveler la
 * clé sans retirer personne » est le MÊME geste avec zéro cible : une époque de
 * plus, une clé neuve scellée à chacun, le nom et le bloc de réglages
 * rescellés. En faire un second thunk aurait dupliqué les quatre choses qui
 * coûtent cher à rater — la vérification de transparence avant chaque scellé,
 * le rescellement de l'enveloppe (P1/F14), celui du bloc de réglages (F13) et
 * la reprise complète après conflit d'époque — et la copie aurait pris du
 * retard sur l'original au premier correctif. Le nom canonique est donc
 * `rotateVaultKey` ; `removeMembers` et `removeMember` restent le même créateur
 * d'action, sous leur nom d'usage.
 *
 * CE QU'UNE ROTATION VOLONTAIRE PROTÈGE, ET CE QU'ELLE NE PEUT PAS PROTÉGER :
 * elle met les éléments FUTURS sous une clé que personne d'autre n'a jamais
 * détenue. Les wraps historiques restent servis aux membres restants (sans quoi
 * ils perdraient l'accès à tout l'existant), et les éléments déjà chiffrés
 * restent sous leur époque d'origine. L'écran doit le dire avant le clic — un
 * bouton « renouveler la clé » qui laisserait croire à une remise à zéro serait
 * une promesse de sécurité que le zéro-connaissance ne tient pas.
 *
 * ET LE CONFLIT D'ÉPOQUE NE SE REJOUE JAMAIS À L'AVEUGLE. Un 409
 * `vault_epoch_conflict` (quelqu'un d'autre a fait tourner la clé entre notre
 * lecture et notre écriture) ou un 400 `wrap_set_mismatch` (quelqu'un a REJOINT
 * entre-temps) reprend la préparation ENTIÈRE au tour suivant : nouvelle liste
 * de membres, nouvelle époque, K_vault' NEUVE, wraps recalculés, nom et bloc
 * rescellés sous cette clé-là. Renvoyer les mêmes wraps sur la nouvelle époque
 * scellerait une clé que le membre arrivé entre-temps ne recevrait jamais — ou
 * pire, rescellerait une clé déjà exposée par la tentative précédente.
 */
export const rotateVaultKey = createAsyncThunk(
  'vaults/removeMember',
  async (
    args: {
      vaultId: string;
      /** La cible unique — la forme d'origine, celle de tous les retraits d'une ligne. */
      userId?: string;
      /** Les cibles, quand le geste en emporte plusieurs (F08) : UNE seule rotation. */
      userIds?: string[];
      /**
       * LA FORME GÉNÉRALE (F10) : les personnes à retirer, TABLEAU VIDE COMPRIS.
       *
       * `removeUserIds: []` est une intention explicite — « renouvelle la clé,
       * ne retire personne » — et c'est ce qui la distingue de `userIds: []`,
       * qui est un retrait ayant perdu sa cible et doit continuer d'échouer. Le
       * champ vaut donc par sa PRÉSENCE, pas par son contenu : une longueur
       * nulle ne peut pas porter cette différence à elle seule.
       */
      removeUserIds?: string[];
      /**
       * Empreintes que l'administrateur vient de confirmer hors bande, par
       * membre. Une entrée n'autorise QUE l'empreinte exacte qu'elle porte : une
       * clé substituée après la confirmation ne passe pas davantage qu'avant.
       */
      confirmedFingerprints?: Record<string, string>;
    },
    { getState, dispatch, rejectWithValue }
  ) => {
    // La rotation VOLONTAIRE se reconnaît à la présence du champ, pas à sa
    // longueur : voir le commentaire de `removeUserIds`.
    const rotationSeule = args.removeUserIds !== undefined && args.removeUserIds.length === 0;
    const demandes = args.removeUserIds ?? args.userIds ?? (args.userId ? [args.userId] : []);
    if (demandes.length === 0 && !rotationSeule) return rejectWithValue('member_not_in_vault');
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const vault = (getState() as { vaults: VaultsState }).vaults.vaults[args.vaultId];
      if (!vault) return rejectWithValue('Unknown vault');
      if (!getVaultKey(args.vaultId, vault.currentKeyEpoch))
        return rejectWithValue('Vault is locked');

      const members = await apiListVaultMembers(args.vaultId);
      // Une cible qui n'est DÉJÀ plus là ne part pas au serveur : il refuserait
      // le lot entier (`not_a_member`) pour une ligne que quelqu'un d'autre vient
      // de retirer, alors que le reste du geste est parfaitement valide.
      const cibles = new Set(demandes.filter((id) => members.some((m) => m.userId === id)));
      // Zéro cible arrête un RETRAIT (toutes les personnes visées sont déjà
      // parties : le geste n'a plus d'objet) mais pas un renouvellement, dont
      // c'est justement l'état normal.
      if (cibles.size === 0 && !rotationSeule) return rejectWithValue('member_not_in_vault');
      const remaining = members.filter((m) => !cibles.has(m.userId));

      const kNew = generateVaultKey();
      try {
        // Re-wrap K_vault' to each remaining member. A member who can't be wrapped
        // (no published key / failed integrity / unsupported algo) FAILS CLOSED and
        // names itself so the UI can tell the admin which member to fix.
        const wraps: Array<{ userId: string; wrappedVaultKey: string }> = [];
        for (const m of remaining) {
          let peer: MemberPublicKey;
          try {
            peer = (await apiGetMemberPublicKey(m.userId)) as MemberPublicKey;
          } catch {
            return rejectWithValue(`member_no_key:${m.userId}`);
          }

          /**
           * LA MÊME VÉRIFICATION QU'À L'INVITATION, et pour la même raison.
           *
           * L'invitation impose de confronter la clé servie au journal de clés du
           * pair et à l'empreinte épinglée : c'est le garde-fou contre un courtier
           * qui substituerait sa propre clé. La ROTATION rescellait K_vault' à
           * chaque membre restant avec la clé servie à cet instant, sans rien
           * vérifier — alors qu'elle scelle exactement le même secret aux mêmes
           * gens. Un opérateur malveillant n'avait donc qu'à attendre le prochain
           * retrait de membre, geste d'administration parfaitement banal, pour
           * recevoir la nouvelle clé du coffre : aucun écran, aucune alerte,
           * aucune trace, là où la même substitution est bloquée à l'invitation.
           *
           * TROIS refus FERMENT la rotation en nommant le membre en cause : un
           * journal qui ne recalcule pas (le serveur a réécrit l'histoire), une
           * clé servie qui n'est pas la dernière du journal (substitution), et un
           * CHANGEMENT d'empreinte non confirmé.
           *
           * Le troisième manquait, et c'était le trou. L'invitation, elle, exige
           * qu'un humain confirme une empreinte qui a changé, hors bande, avant
           * de sceller quoi que ce soit. La rotation laissait passer le même
           * changement SANS RIEN DEMANDER — alors qu'elle est déclenchée par un
           * geste d'administration banal et se déroule sans écran. Le chemin le
           * moins surveillé était donc le plus permissif des deux, ce qui est
           * exactement l'inverse de ce qu'on veut : un opérateur malveillant
           * n'avait qu'à substituer une clé et attendre le prochain retrait.
           *
           * `confirmedFingerprints` est la confirmation hors bande de l'écran,
           * portée par membre : elle vaut pour CETTE empreinte et pour ce membre,
           * jamais comme un interrupteur global.
           */
          try {
            const log = await apiGetKeyLog(m.userId);
            const status = await checkPeerKeyTransparency(
              m.userId,
              { encPublicKey: peer.encPublicKey, fingerprint: peer.fingerprint },
              log
            );
            if (status === 'tampered_log' || status === 'served_not_latest') {
              return rejectWithValue(`${status}:${m.userId}`);
            }
            if (
              status === 'changed' &&
              args.confirmedFingerprints?.[m.userId] !== peer.fingerprint
            ) {
              // L'empreinte part avec le refus : l'écran doit pouvoir l'afficher
              // pour que la vérification hors bande porte sur quelque chose.
              return rejectWithValue(`peer_key_changed:${m.userId}:${peer.fingerprint}`);
            }
          } catch {
            // Journal illisible : on ne scelle PAS à l'aveugle. Une rotation
            // remise à plus tard coûte moins qu'une clé remise au mauvais
            // destinataire.
            return rejectWithValue(`key_log_unavailable:${m.userId}`);
          }

          try {
            wraps.push({
              userId: m.userId,
              wrappedVaultKey: await wrapVaultKeyForMember(kNew, peer),
            });
          } catch (e) {
            const code = (e as { code?: string }).code ?? 'wrap_failed';
            return rejectWithValue(`${code}:${m.userId}`);
          }
        }
        /**
         * LE NOM SUIT LA CLÉ, sinon le coffre perd son nom pour tout le monde.
         *
         * `name_encrypted` est scellé sous K_vault de l'époque courante. La
         * rotation en engendre une neuve et la scelle à chaque membre, mais le
         * nom restait, lui, sous l'ancienne : au chargement suivant,
         * `toVaultSummary` l'ouvre avec le wrap de l'époque COURANTE, échoue, et
         * retombe sur ''. Au PREMIER retrait de membre, le coffre s'affichait
         * donc « Verrouillé » chez tous ses membres, l'hôte compris. Il part
         * dans le même appel — et le serveur l'écrit dans le même lot, sous la
         * même garde d'époque que les wraps.
         *
         * SEULEMENT si le nom est non vide : un nom vide ne dit pas « ce coffre
         * n'a pas de nom », il dit que le déchiffrement a échoué au dernier
         * chargement (coffre verrouillé, clé absente, wrap d'une autre époque).
         * Chiffrer '' écraserait pour de bon un nom qui redeviendra peut-être
         * lisible dès que la clé manquante reviendra.
         *
         * ET C'EST L'ENVELOPPE ENTIÈRE QUI PART (F14), pas le seul nom décodé :
         * l'emoji, la couleur et l'icône vivent dans la MÊME colonne. Resceller
         * le nom nu les effacerait pour tout le monde, en silence, à chaque
         * rotation — un défaut qu'aucune erreur ne signalerait et qu'on
         * découvrirait des semaines plus tard, en constatant que les coffres ont
         * perdu leurs couleurs.
         */
        const rescelle = vault.name
          ? await encryptVaultName(
              encodeVaultName({ name: vault.name, appearance: vault.appearance }),
              kNew
            )
          : undefined;
        const reglages = await rescellerReglages(args.vaultId, vault.currentKeyEpoch, kNew);
        await apiRotateVault(args.vaultId, {
          expectedPreviousEpoch: vault.currentKeyEpoch,
          removeUserIds: [...cibles],
          wraps,
          ...rescelle,
          ...reglages,
        });
        // Refresh: loadVaults pulls the new epoch + our new membership wrap and
        // unlocks K_vault' into the cache.
        await dispatch(loadVaults());
        // If we removed OURSELVES, the vault is gone from state (no longer a member)
        // → purge our now-stale K_vault from memory (mirrors leaveVault).
        if (!(getState() as { vaults: VaultsState }).vaults.vaults[args.vaultId]) {
          lockVaultEverywhere(args.vaultId);
        }
        // `removedUserId` (le premier retiré) est CONSERVÉ PAR PRUDENCE, sans
        // lecteur connu : `shareIndexSlice` n'écoute que le TYPE de l'action et
        // ne lit que `vaultId` pour périmer son agrégat — un retrait groupé le
        // périme donc exactement pareil. Le champ ne coûte rien et garde la
        // forme historique du payload pour un abonné qu'on n'aurait pas vu.
        return {
          vaultId: args.vaultId,
          removedUserId: [...cibles][0],
          removedUserIds: [...cibles],
        };
      } catch (e) {
        if (isRetryableRotateConflict(e) && attempt < MAX_RETRIES - 1) {
          await dispatch(loadVaults()); // re-fetch epoch + roster, recompute next loop
          continue;
        }
        return rejectWithValue(
          isRetryableRotateConflict(e)
            ? 'vault_epoch_conflict'
            : ((e as Error).message ?? 'Failed to remove member')
        );
      } finally {
        kNew.fill(0);
      }
    }
    return rejectWithValue('vault_epoch_conflict');
  }
);

/**
 * Retirer un GROUPE : le nom historique de la même rotation. Conservé parce que
 * la moitié de la page l'appelle ainsi, et parce qu'il dit ce que le geste fait
 * quand il a des cibles.
 */
export const removeMembers = rotateVaultKey;

/**
 * Retirer UNE personne : le cas particulier de `removeMembers`, et le même
 * créateur d'action.
 *
 * Ce n'est PAS une enveloppe qui redispatcherait : le type d'action reste
 * `vaults/removeMember`, écouté littéralement par `shareIndexSlice`
 * (`MEMBER_REMOVED_ACTION`) pour périmer les pastilles de partage. Un nouveau
 * préfixe aurait laissé ce listener muet — l'effectif du rail et des cartes
 * serait resté celui d'avant le retrait, sans erreur nulle part.
 */
export const removeMember = removeMembers;

// ── Slice ────────────────────────────────────────────────────────────────────

export interface VaultDecryptStatus {
  /** Items in this vault that couldn't be decrypted on the last load. */
  undecryptable: number;
  /** Whether the historical key-wrap fetch succeeded (false → likely transient). */
  historyAvailable: boolean;
}

export interface VaultsState {
  vaults: Record<string, VaultSummary>;
  vaultIds: string[];
  itemsByVault: Record<string, VaultItemSummary[]>;
  /** Per-vault decrypt health, so the UI can surface "N items couldn't be decrypted". */
  decryptStatusByVault: Record<string, VaultDecryptStatus>;
  /**
   * LE CHARGEMENT D'UN COFFRE A ECHOUE — par coffre, avec la raison.
   *
   * ── POURQUOI CE CHAMP EXISTE ─────────────────────────────────────────────
   *
   * `loadVaultItems` avait un `.fulfilled` et AUCUN `.rejected`. Un echec
   * n'ecrivait donc rien nulle part : le coffre restait absent de
   * `itemsByVault`, et l'ecran, qui deduit « charge » de la seule presence
   * d'une entree, affichait « Chargement des notes... » INDEFINIMENT.
   *
   * Ce n'est pas un detail d'affichage. C'est le miroir exact de la lecon des
   * invitations (« terminal != jetable ») : la, on tirait un verdict definitif
   * d'une absence d'information ; ici, on presentait un etat TRANSITOIRE pour
   * une situation dont on ne sortait jamais. Dans les deux cas, l'absence
   * d'information etait lue comme une information.
   *
   * La date sert a l'ecran : « la derniere tentative a echoue » se lit
   * autrement selon qu'elle date de trois secondes ou d'une heure.
   */
  loadFailureByVault: Record<string, { message: string; at: string }>;
  /**
   * Le re-scellement en cours, par coffre : elements envoyes / elements prevus.
   * Presente UNIQUEMENT pendant le geste (efface a la fin, succes comme echec) —
   * une barre de progression figee a 100 %% raconterait un travail qui dure.
   */
  rewrapProgress: Record<string, { done: number; total: number }>;
  /** Decrypted vault-NOTE bodies for E3-3c transclusion, keyed `${vaultId}:${itemId}`.
   *  Memory only (slice is persist-blacklisted) and purged on session lock. */
  noteContentByRef: Record<string, string>;
  unlockedVaultIds: string[];
  /**
   * La TÊTE du fil d'activité de chaque coffre — UNE requête pour toutes les
   * cartes (lot A, C4). Sert à la pastille « activité nouvelle » de l'accueil.
   */
  activityHeads: VaultActivityHeadDTO[];
  /**
   * Compteur sans valeur propre : il ne fait que RÉVEILLER `selectUnseenVaultIds`
   * quand un curseur « vu jusqu'ici » a bougé. Le curseur lui-même vit dans
   * localStorage (vaultActivitySeen.ts), que rien n'observe — sans ce compteur,
   * un sélecteur mémoïsé garderait la pastille allumée sur un fil déjà lu.
   */
  activitySeenVersion: number;
  /** Les coffres supprimés que le propriétaire peut encore reprendre. */
  deletedVaults: DeletedVaultSummary[];
  deletedVaultsLoading: boolean;
  /** Ce qui attend l'adresse du compte, à travers tous les locataires (/me). */
  myInvitations: MyInvitationDTO[];
  myInvitationsLoading: boolean;
  /**
   * Les accès PROMIS mais pas encore arrivés (0073) — vus par l'INVITÉE.
   *
   * Rien à accepter ici, aucun bouton : c'est un état. Il existe parce qu'un
   * écran vide ne disait pas la différence entre « personne ne vous a invité »
   * et « votre hôte doit encore vous sceller la clé », et que cette confusion
   * envoyait recoller un lien d'espace déjà consommé.
   */
  awaitingHost: AwaitingHostDTO[];
  /**
   * Ce que le balayage n'a PAS pu accorder tout seul — vu par l'HÔTE.
   *
   * Volontairement dans l'état plutôt qu'en notification volatile : une clé à
   * vérifier hors bande est une action qui attend, pas un événement qui passe.
   */
  blockedGrants: BlockedEntry[];
  loading: boolean;
  error: string | null;
  /**
   * Un chargement de la liste a-t-il DÉJÀ été demandé dans cette session ?
   * C'est la garde d'`ensureVaultsLoaded` — posée dès `pending` (pas à
   * `fulfilled`) pour qu'un rejet légitime (hors ligne, offre expirée) ne
   * fasse pas boucler l'écran qui redemande. Remise à zéro à la déconnexion.
   */
  initialLoadRequested: boolean;
  /**
   * La liste a-t-elle ABOUTI au moins une fois dans cette session ?
   *
   * DISTINCT D'`initialLoadRequested`, ET C'EST TOUT L'INTÉRÊT : celui-là est
   * posé dès `pending`, donc il est vrai pendant que la liste est encore vide.
   * Le bandeau « on vous a donné accès » sème son registre à partir de la
   * liste : le semer sur une liste pas encore arrivée le remplirait de rien,
   * et le chargement suivant annoncerait TOUS les coffres du compte comme
   * neufs — exactement la salve du premier lancement qu'on cherche à éviter.
   * Posé à `fulfilled` seulement, remis à zéro à la déconnexion.
   */
  listLoadedOnce: boolean;
  /**
   * Le dernier `loadVaults` abouti disposait-il de la paire de clés ? Tant que
   * non, `ensureVaultsLoaded` accepte de recharger quand elle apparaît : c’est
   * ce qui déverrouille les coffres après la saisie du mot de passe sans
   * exiger un « Réessayer ».
   */
  lastLoadHadKeypair: boolean;
  // UNE JOINTURE NE LAISSE RIEN ICI, ET C'EST DÉLIBÉRÉ. Son refus part par le
  // payload du thunk, que l'écran d'acceptation traduit avec `joinErrorKey` — la
  // table écrite pour le JOIGNANT. Un champ de slice supplémentaire n'avait
  // aucun lecteur et invitait au contraire : `error` appartient au chargement de
  // la liste, que `VaultsList` rend via `vaultErrorKey`, la table de l'HÔTE, et
  // seulement quand la liste est vide — exactement la situation d'un invité. Un
  // refus de jointure écrit dans un état partagé finit donc par s'afficher avec
  // les mots de l'hôte (« votre offre est pleine », « cette personne a déjà
  // accès ») sous un bouton « Réessayer » qui relance `loadVaults`.
}

const initialState: VaultsState = {
  vaults: {},
  vaultIds: [],
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

const vaultsSlice = createSlice({
  name: 'vaults',
  initialState,
  reducers: {
    markVaultUnlocked(state, action: PayloadAction<string>) {
      if (!state.unlockedVaultIds.includes(action.payload)) {
        state.unlockedVaultIds.push(action.payload);
      }
    },
    /**
     * LE COFFRE VIENT D'ÊTRE GELÉ OU DÉGELÉ (F23) — le résumé suit, tout de suite.
     *
     * POURQUOI UN RÉDUCTEUR ET PAS UN `loadVaults()`. Le gel décide de la
     * disparition de TOUS les boutons d'écriture de l'explorateur ; entre le
     * clic et la fin d'un rechargement complet de la liste, l'écran continuerait
     * de proposer « Envoyer » sur un coffre que le serveur vient de fermer. Un
     * rechargement complet coûte en plus un déchiffrement de nom par coffre,
     * pour changer deux champs d'une seule ligne.
     *
     * LA CHARGE UTILE EST L'ÉTAT RELU PAR LA ROUTE, jamais celui qu'on espérait :
     * `/freeze` sur un coffre DÉJÀ gelé rend la date du PREMIER gel, et une
     * course perdue rend `null`. Recopier ici « gelé maintenant » afficherait à
     * tous les membres une date que la base n'a pas.
     *
     * Un coffre absent de l'état n'est pas créé : ce réducteur MET À JOUR, il
     * n'invente pas une ligne dont il n'aurait ni le nom déchiffré ni la clé.
     */
    vaultFreezeState(
      state,
      action: PayloadAction<{ vaultId: string; frozenAt: string | null; frozenBy: string | null }>
    ) {
      const v = state.vaults[action.payload.vaultId];
      if (!v) return;
      v.frozenAt = action.payload.frozenAt;
      v.frozenBy = action.payload.frozenBy;
    },
    /**
     * Le fil de CE coffre vient d'être lu : `setSeenCursor` a déjà écrit le
     * curseur dans localStorage, il ne reste qu'à réveiller le sélecteur. Le
     * payload (l'identifiant) n'est pas stocké — il documente le geste.
     */
    vaultActivitySeen(state, _action: PayloadAction<string>) {
      state.activitySeenVersion += 1;
    },
    /**
     * L'ACCÈS VIENT D'ÊTRE SCELLÉ À LA MAIN — la pastille n'a plus lieu d'être.
     *
     * LE DÉFAUT QUE CE RÉDUCTEUR FERME. `blockedGrants` n'était réécrit qu'au
     * balayage suivant, c'est-à-dire au prochain déverrouillage de coffre. Un
     * hôte qui comparait l'empreinte et donnait l'accès sur-le-champ continuait
     * donc de lire « en attente de votre vérification » pour quelqu'un qui était
     * déjà membre — une phrase qui réclame un geste déjà fait, ce qui est la
     * meilleure façon de le faire refaire.
     *
     * On retire par IDENTIFIANT quand on l'a (c'est ce que le scellement vise)
     * et par ADRESSE sinon : les deux sont portés par l'entrée, et une entrée
     * d'un vieux balayage peut n'avoir que la seconde.
     */
    grantSealedManually(
      state,
      action: PayloadAction<{ vaultId: string; userId?: string; email?: string }>
    ) {
      const { vaultId, userId, email } = action.payload;
      const target = email?.trim().toLowerCase();
      // Sans personne à viser, on ne vide rien : un payload incomplet ne doit
      // pas effacer les blocages de tout un coffre.
      if (!userId && !target) return;
      state.blockedGrants = state.blockedGrants.filter(
        (b) =>
          b.vaultId !== vaultId ||
          !((userId && b.userId === userId) || (target && b.email.toLowerCase() === target))
      );
    },
  },
  extraReducers: (builder) => {
    builder
      // Le drapeau de session est posé par les DEUX `pending` : celui de la
      // garde et celui du chargement nu — une relance explicite compte aussi.
      .addCase(ensureVaultsLoaded.pending, (state) => {
        state.initialLoadRequested = true;
      })
      .addCase(loadVaults.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.initialLoadRequested = true;
      })
      .addCase(loadVaults.fulfilled, (state, action) => {
        state.loading = false;
        const live = new Set(action.payload.vaults.map((v) => v.id));
        // Purge decrypted state for any vault we lost access to (admin removal / lazy
        // re-key), so a removed member's already-open transclusions stop resolving the
        // plaintext body (the K_vault itself was zeroed in the thunk).
        for (const id of state.vaultIds) {
          if (!live.has(id)) {
            delete state.itemsByVault[id];
            delete state.decryptStatusByVault[id];
            delete state.loadFailureByVault[id];
          }
        }
        for (const ref of Object.keys(state.noteContentByRef)) {
          const sep = ref.indexOf(':');
          if (sep > 0 && !live.has(ref.slice(0, sep))) delete state.noteContentByRef[ref];
        }
        state.vaults = {};
        state.vaultIds = [];
        for (const v of action.payload.vaults) {
          state.vaults[v.id] = v;
          state.vaultIds.push(v.id);
        }
        state.unlockedVaultIds = action.payload.unlockedIds;
        state.lastLoadHadKeypair = action.payload.hadKeypair;
        state.listLoadedOnce = true;
      })
      .addCase(loadVaults.rejected, (state, action) => {
        state.loading = false;
        const reason = (action.payload as string) ?? 'Failed to load vaults';
        state.error = reason;
        /**
         * ⚠ UNE PANNE TRANSITOIRE NE DOIT PAS COÛTER LA SESSION ENTIÈRE.
         *
         * ── LE DÉFAUT, OBSERVÉ EN PRODUCTION ────────────────────────────────
         *
         * `[renderer:vaults] chargement des coffres échoué : network_unavailable`
         * à 05:55:14, c'est-à-dire au démarrage — et plus jamais un mot.
         *
         * Ce code-là ne veut pas dire « pas de réseau » : `apiClient` le pose
         * aussi quand il n'a PAS ENCORE de jeton d'accès (« No access token
         * available »). Or `VaultsBootstrapHost` demande la liste dès que le
         * droit est connu, et le droit vient de l'utilisateur mis en cache sur
         * disque — donc parfois AVANT que le jeton n'arrive du processus
         * principal.
         *
         * La garde d'`ensureVaultsLoaded` refuse ensuite tout rechargement de
         * la session (elle n'en autorise un que pour l'arrivée de la clé). Une
         * course perdue de quelques millisecondes au démarrage coûtait donc
         * TOUS les coffres, jusqu'au prochain lancement — et le lancement
         * suivant reperdait la même course, puisqu'elle se joue toujours dans
         * le même ordre.
         *
         * C'est aussi pourquoi le développement marchait et pas le paquet :
         * `npm start` charge lentement depuis localhost, le jeton gagne ; un
         * asar se déplie plus vite et la requête part la première.
         *
         * Une demande qui a ÉCHOUÉ TRANSITOIREMENT n'a donc pas « eu lieu » :
         * on rouvre la porte, et l'hôte réessaie.
         */
        if (TRANSIENT_LOAD_FAILURES.has(reason)) state.initialLoadRequested = false;
        /**
         * ⚠ CET ÉCHEC N'ÉTAIT VISIBLE NULLE PART.
         *
         * `state.error` n'est lu que par la boîte « Ajouter à un coffre ».
         * L'accueil, lui, affiche simplement une page sans coffres — ce qui
         * ressemble à un compte qui n'en a pas. Et en production les outils de
         * développement sont REFERMÉS de force (`main.ts`) : il n'y a pas de
         * console non plus.
         *
         * Un chargement de coffres qui rate au démarrage ne laissait donc
         * aucune trace, nulle part. On l'écrit dans le journal du processus
         * principal — le seul endroit qu'on puisse relire après coup, et celui
         * que l'utilisateur sait envoyer.
         *
         * La raison est un code interne (`shared_vault_no_context`, un statut
         * HTTP), jamais une donnée de l'utilisateur.
         */
        reportToLog('vaults', `chargement des coffres échoué : ${reason}`);
      })
      .addCase(fetchMyInvitations.pending, (state) => {
        state.myInvitationsLoading = true;
      })
      .addCase(fetchMyInvitations.fulfilled, (state, action) => {
        state.myInvitationsLoading = false;
        state.myInvitations = action.payload.invitations;
        state.awaitingHost = action.payload.awaitingHost;
      })
      .addCase(fetchMyInvitations.rejected, (state) => {
        // L'API répond déjà [] sur l'illisible ; ici on ne garde jamais un
        // chargement éternel.
        state.myInvitationsLoading = false;
      })
      .addCase(loadVaultActivityHeads.fulfilled, (state, action) => {
        // `null` = échec réseau : on garde les têtes d'avant (voir le thunk).
        if (action.payload) state.activityHeads = action.payload;
      })
      .addCase(acceptMyInvitation.fulfilled, (state, action) => {
        // Retrait optimiste — le refetch qui suit fera foi.
        state.myInvitations = state.myInvitations.filter(
          (i) => i.vaultId !== action.payload.vaultId
        );
      })
      .addCase(declineMyInvitation.fulfilled, (state, action) => {
        state.myInvitations = state.myInvitations.filter((i) => i.id !== action.payload.inviteId);
      })
      .addCase(sweepPendingGrants.fulfilled, (state, action) => {
        // REMPLACÉ, jamais fusionné : ce que le balayage vient de voir fait foi.
        // Accumuler laisserait à l'écran une personne dont la clé a été vérifiée
        // entre-temps, avec une phrase qui réclame un geste déjà fait.
        //
        // …DANS SA PORTÉE, et seulement là. Un balayage lancé pour UN coffre
        // (« Réessayer maintenant ») n'a rien examiné des autres : écraser toute
        // la liste effacerait des blocages encore vrais, et l'hôte cesserait de
        // voir ce qui l'attend ailleurs.
        const { blocked, scope } = action.payload;
        state.blockedGrants = scope
          ? [...state.blockedGrants.filter((b) => !scope.includes(b.vaultId)), ...blocked]
          : blocked;
      })
      .addCase(createVault.fulfilled, (state, action) => {
        const v = action.payload;
        state.vaults[v.id] = v;
        if (!state.vaultIds.includes(v.id)) state.vaultIds.unshift(v.id);
        if (isVaultUnlocked(v.id, v.currentKeyEpoch) && !state.unlockedVaultIds.includes(v.id)) {
          state.unlockedVaultIds.push(v.id);
        }
      })
      .addCase(loadVaultItems.pending, (state, action) => {
        // Une tentative EN COURS n'est pas un echec. Sans cet effacement, un
        // coffre qui a echoue une fois garderait son aveu pendant toute la
        // nouvelle tentative, et l'ecran dirait « echec » d'un chargement qui
        // est en train de reussir.
        delete state.loadFailureByVault[action.meta.arg.vaultId];
      })
      .addCase(loadVaultItems.fulfilled, (state, action) => {
        state.itemsByVault[action.payload.vaultId] = action.payload.items;
        state.decryptStatusByVault[action.payload.vaultId] = {
          undecryptable: action.payload.undecryptable,
          historyAvailable: action.payload.historyAvailable,
        };
        delete state.loadFailureByVault[action.payload.vaultId];
      })
      .addCase(loadVaultItems.rejected, (state, action) => {
        /**
         * ⚠ LE COFFRE VISE VIENT DE L'ARGUMENT, PAS DU PAYLOAD.
         *
         * Un rejet n'a pas de payload qui le nomme -- c'est exactement la
         * remarque deja ecrite quelques lignes plus bas pour
         * `rewrapStaleItems.rejected`. Le depot avait deja paye cette lecon.
         */
        state.loadFailureByVault[action.meta.arg.vaultId] = {
          // La raison BRUTE. La remplacer par un « echec » generique est
          // precisement ce qui rendait ce diagnostic impossible depuis l'ecran.
          message: action.error?.message ?? '',
          at: new Date().toISOString(),
        };
      })
      // Le re-scellement (F10) : l'avancement vit le temps du geste, pas plus.
      .addCase(vaultRewrapProgress, (state, action) => {
        state.rewrapProgress[action.payload.vaultId] = {
          done: action.payload.done,
          total: action.payload.total,
        };
      })
      .addCase(rewrapStaleItems.fulfilled, (state, action) => {
        delete state.rewrapProgress[action.payload.vaultId];
      })
      .addCase(rewrapStaleItems.rejected, (state, action) => {
        // Le coffre visé vient de l'ARGUMENT : un rejet n'a pas de payload qui
        // le nomme, et laisser la barre en place ferait croire à un geste en cours.
        delete state.rewrapProgress[action.meta.arg.vaultId];
      })
      .addCase(addVaultItem.fulfilled, (state, action) => {
        const item = action.payload;
        const list = state.itemsByVault[item.vaultId] ?? [];
        state.itemsByVault[item.vaultId] = [item, ...list.filter((i) => i.id !== item.id)];
      })
      .addCase(updateVaultItem.fulfilled, (state, action) => {
        const { vaultId, item, noteText } = action.payload;
        const list = state.itemsByVault[vaultId];
        // Replace IN PLACE — an edit must not reshuffle the list under the user.
        if (list) {
          const idx = list.findIndex((i) => i.id === item.id);
          if (idx >= 0) list[idx] = item;
          else list.unshift(item);
        } else {
          state.itemsByVault[vaultId] = [item];
        }
        if (noteText !== undefined) {
          state.noteContentByRef[`${vaultId}:${item.id}`] = noteText;
        }
      })
      .addCase(deleteVaultItem.fulfilled, (state, action) => {
        const list = state.itemsByVault[action.payload.vaultId];
        if (list) {
          state.itemsByVault[action.payload.vaultId] = list.filter(
            (i) => i.id !== action.payload.itemId
          );
        }
        // Fuite latente corrigée : le clair d'une note supprimée sort du cache.
        delete state.noteContentByRef[`${action.payload.vaultId}:${action.payload.itemId}`];
      })
      .addCase(renameVault.fulfilled, (state, action) => {
        const v = state.vaults[action.payload.vaultId];
        if (v) v.name = action.payload.name;
      })
      .addCase(setVaultAppearance.fulfilled, (state, action) => {
        const v = state.vaults[action.payload.vaultId];
        if (!v) return;
        // `delete` plutôt qu'`undefined` : « aucune apparence » est l'absence du
        // champ partout ailleurs (l'enveloppe, le DTO), et laisser une clé à
        // `undefined` ferait diverger les comparaisons de références.
        if (action.payload.appearance) v.appearance = action.payload.appearance;
        else delete v.appearance;
      })
      .addCase(deleteVault.fulfilled, (state, action) => {
        // Exactement le nettoyage d'un départ : le coffre n'est plus accessible
        // à cet appareil, et ses éléments déchiffrés n'ont plus rien à y faire.
        const id = action.payload.vaultId;
        delete state.vaults[id];
        delete state.itemsByVault[id];
        delete state.decryptStatusByVault[id];
        delete state.loadFailureByVault[id];
        for (const ref of Object.keys(state.noteContentByRef)) {
          if (ref.startsWith(`${id}:`)) delete state.noteContentByRef[ref];
        }
        state.vaultIds = state.vaultIds.filter((v) => v !== id);
        state.unlockedVaultIds = state.unlockedVaultIds.filter((v) => v !== id);
      })
      .addCase(leaveVault.fulfilled, (state, action) => {
        const id = action.payload.vaultId;
        delete state.vaults[id];
        delete state.itemsByVault[id];
        delete state.decryptStatusByVault[id];
        delete state.loadFailureByVault[id];
        for (const ref of Object.keys(state.noteContentByRef)) {
          if (ref.startsWith(`${id}:`)) delete state.noteContentByRef[ref];
        }
        state.vaultIds = state.vaultIds.filter((v) => v !== id);
        state.unlockedVaultIds = state.unlockedVaultIds.filter((v) => v !== id);
      })
      .addCase(loadVaultNoteContent.fulfilled, (state, action) => {
        state.noteContentByRef[action.payload.ref] = action.payload.content;
      })
      // Purge decrypted vault-note bodies on session lock (mirrors the K_vault cache
      // purge in vaultKeyCache) so plaintext doesn't linger in memory after lock.
      .addCase(lockApp, (state) => {
        state.noteContentByRef = {};
      })
      /**
       * La déconnexion vide TOUT ce que le compte précédent avait déchiffré.
       *
       * Le verrouillage n'efface que les corps de notes, ce qui suffit puisqu'on
       * reste le même utilisateur. Ici l'identité change : les noms de coffres,
       * les titres d'éléments et les états de déchiffrement appartiennent à
       * quelqu'un d'autre, et `loadVaults.rejected` ne purge rien — le suivant
       * lirait donc les coffres du précédent à l'écran si son propre chargement
       * échouait.
       */
      .addCase(deleteVaultItems.fulfilled, (state, action) => {
        const { vaultId, applied } = action.payload;
        const gone = new Set(applied);
        const list = state.itemsByVault[vaultId];
        if (list) state.itemsByVault[vaultId] = list.filter((i) => !gone.has(i.id));
        // Le contenu déchiffré d'une note supprimée ne reste pas en mémoire.
        for (const id of applied) delete state.noteContentByRef[`${vaultId}:${id}`];
      })
      .addCase(moveVaultItems.fulfilled, (state, action) => {
        const list = state.itemsByVault[action.payload.vaultId];
        if (!list) return;
        for (const summary of action.payload.applied) {
          const i = list.findIndex((it) => it.id === summary.id);
          if (i !== -1) list[i] = summary;
        }
      })
      .addCase(renameVaultItem.fulfilled, (state, action) => {
        const { vaultId, item } = action.payload;
        if (!item) return;
        const liste = state.itemsByVault[vaultId];
        if (!liste) return;
        const i = liste.findIndex((x) => x.id === item.id);
        if (i >= 0) liste[i] = item;
      })
      .addCase(loadDeletedVaults.pending, (state) => {
        state.deletedVaultsLoading = true;
      })
      .addCase(loadDeletedVaults.fulfilled, (state, action) => {
        state.deletedVaultsLoading = false;
        state.deletedVaults = action.payload;
      })
      .addCase(loadDeletedVaults.rejected, (state) => {
        // Une corbeille illisible ne doit pas mentir sur son contenu : on la vide
        // plutôt que de laisser la précédente à l'écran.
        state.deletedVaultsLoading = false;
        state.deletedVaults = [];
      })
      .addCase(restoreVault.fulfilled, (state, action) => {
        state.deletedVaults = state.deletedVaults.filter((v) => v.id !== action.payload.vaultId);
      })
      .addCase(clearCloudAuth, (state) => {
        // Le rattrapage des partages de dossier est « une fois par session ».
        // La session, c'est CE compte : sans cette remise à zéro, le compte
        // suivant hériterait des coffres déjà balayés et ne rattraperait
        // jamais les siens.
        resetFolderCatchUp();
        state.vaults = {};
        state.vaultIds = [];
        state.itemsByVault = {};
        state.noteContentByRef = {};
        state.unlockedVaultIds = [];
        state.decryptStatusByVault = {};
        state.deletedVaults = [];
        state.deletedVaultsLoading = false;
        state.error = null;
        // Les têtes du fil appartiennent aux coffres du compte précédent.
        state.activityHeads = [];
        // Le compte suivant a droit à SON premier chargement.
        state.initialLoadRequested = false;
        // Le registre « déjà vu » du compte suivant est le SIEN : sa liste doit
        // repartir d'un semis, sinon ses coffres arriveraient annoncés.
        state.listLoadedOnce = false;
        state.lastLoadHadKeypair = false;
      });
  },
});

export const { markVaultUnlocked, vaultActivitySeen, grantSealedManually, vaultFreezeState } =
  vaultsSlice.actions;
export default vaultsSlice.reducer;

// ── Selectors ────────────────────────────────────────────────────────────────

interface WithVaults {
  vaults: VaultsState;
}

export const selectDeletedVaults = (s: WithVaults): DeletedVaultSummary[] => s.vaults.deletedVaults;
/**
 * La liste des coffres, MÉMOÏSÉE : même référence tant que ni l'ordre ni le
 * dictionnaire n'ont changé. Un `.map()` nu fabriquait un tableau neuf à
 * chaque appel, donc `useSelector` re-rendait chaque lecteur à CHAQUE action du
 * store — et les dépendances d'effet bâties dessus repartaient avec lui.
 * `selectSharedVaults` (accueil) est un alias de celui-ci : un seul cache.
 */
export const selectVaults = createSelector(
  [(s: WithVaults) => s.vaults.vaultIds, (s: WithVaults) => s.vaults.vaults],
  (vaultIds, vaultsById): VaultSummary[] =>
    vaultIds.map((id) => vaultsById[id]).filter((v): v is VaultSummary => !!v)
);
export const selectVaultById = (s: WithVaults, id: string): VaultSummary | undefined =>
  s.vaults.vaults[id];
export const selectVaultItems = (s: WithVaults, vaultId: string): VaultItemSummary[] =>
  s.vaults.itemsByVault[vaultId] ?? [];
export const selectIsVaultUnlocked = (s: WithVaults, id: string): boolean =>
  s.vaults.unlockedVaultIds.includes(id);
export const selectVaultDecryptStatus = (
  s: WithVaults,
  vaultId: string
): VaultDecryptStatus | undefined => s.vaults.decryptStatusByVault[vaultId];
/** Decrypted vault-note body for E3-3c transclusion, by `${vaultId}:${itemId}` ref. */
export const selectVaultNoteContent = (s: WithVaults, ref: string): string | undefined =>
  s.vaults.noteContentByRef[ref];

/** Typage STRUCTUREL (pas `RootState`) : testable avec un store réduit. */
interface WithVaultsAndUser extends WithVaults {
  auth: { cloudUser: { id: string } | null };
}

/**
 * Les coffres dont le fil a bougé depuis le dernier « vu » — la pastille des
 * cartes (lot A, C4). MÉMOÏSÉ sur trois entrées :
 *   · les têtes (une requête, `loadVaultActivityHeads`) ;
 *   · `activitySeenVersion`, qui n'entre PAS dans le calcul mais le RÉVEILLE :
 *     le curseur « vu » vit dans localStorage, que rien n'observe, et sans ce
 *     compteur le cache rendrait le même Set après une lecture du fil ;
 *   · l'utilisateur, parce que le curseur est indexé par (utilisateur, coffre).
 * Même référence de Set tant que rien n'a bougé : les cartes mémoïsées qui le
 * reçoivent ne re-rendent pas à chaque action du store.
 */
export const selectUnseenVaultIds = createSelector(
  [
    (s: WithVaultsAndUser) => s.vaults.activityHeads,
    (s: WithVaultsAndUser) => s.vaults.activitySeenVersion,
    (s: WithVaultsAndUser) => s.auth.cloudUser?.id ?? null,
  ],
  (heads, _seenVersion, userId): ReadonlySet<string> =>
    userId ? unseenVaultIds(heads, (vaultId) => getSeenCursor(userId, vaultId)) : new Set()
);
