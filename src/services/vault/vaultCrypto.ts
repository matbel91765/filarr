/**
 * vaultCrypto.ts (E3-2) — shared team-vault crypto, renderer-side.
 *
 * A vault has ONE symmetric key K_vault (AES-256, generated here). It is sealed
 * PER MEMBER to that member's X25519 encryption public key using the E2-11
 * primitive sealToPublicKey() — so the server only ever stores opaque sealed
 * blobs (one per member of the same K_vault) and never a key in clear (HARD RULE:
 * no server master key). A member opens their own wrap with openSealed(), which
 * uses the private key loaded by userKeypair.ts (E2). The vault NAME is encrypted
 * under K_vault (HARD RULE: encrypted titles, no server-side search).
 *
 * Anti-MITM: before sealing K_vault to a member we REFUSE any public key whose
 * algo is unknown to this build (E2-10) or whose identity binding / fingerprint
 * fails verifyKeypairIntegrity (E2-7). A broker that substitutes a member's key
 * is rejected here rather than handed K_vault. The real out-of-band guarantee is
 * the user comparing the fingerprint (E2-7) / the key-transparency log (E3-7).
 *
 * Self-contained / PURE on purpose (like userKeypair.ts): no IPC / window /
 * network imports, so it is unit-testable in isolation (node/vitest). The seal
 * itself comes from userKeypair.ts (the only crypto dependency). Network calls
 * (POST /vaults, public-key lookup) and IPC live in the slice/sync layer (E3-8).
 */

import {
  sealToPublicKey,
  openSealed,
  verifyKeypairIntegrity,
  isKeyAlgoSupported,
} from '../auth/userKeypair';
import { encryptChunk, decryptChunk, importChunkKey } from '../crypto/chunkPipeline';

const IV_LENGTH = 12; // AES-GCM recommended
const K_VAULT_LENGTH = 32; // 256-bit AES key

// ── Errors ───────────────────────────────────────────────────────────────────

export type VaultKeyErrorCode = 'unsupported_key_algo' | 'key_integrity_failed';

/** Thrown when we refuse to seal K_vault to a member's public key (anti-MITM). */
export class VaultKeyError extends Error {
  constructor(
    public readonly code: VaultKeyErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'VaultKeyError';
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A member's public-key material, as returned by GET /account/public-key/:userId
 * (E2-8). The full set is required so we can verify the identity binding before
 * wrapping — a bare encPublicKey is not enough to trust.
 */
export interface MemberPublicKey {
  userId?: string;
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig?: string;
  fingerprint: string;
  keyAlgo: string;
  keyVersion?: number;
}

/** Opaque blobs ready to POST to the worker when creating a vault. */
export interface VaultCreatePayload {
  /** Raw K_vault, kept in renderer memory to encrypt items in the same session. */
  kVault: Uint8Array;
  nameEncrypted: string;
  nameIv: string;
  /** K_vault sealed to the OWNER's own public key. */
  wrappedVaultKey: string;
}

// ── K_vault generation + per-member wrapping ─────────────────────────────────

/** Generate a fresh 256-bit vault key. */
export function generateVaultKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(K_VAULT_LENGTH));
}

/**
 * Seal K_vault to a member's encryption public key (E2-11). REFUSES (throws
 * VaultKeyError) an unsupported algo or a key that fails its integrity check —
 * we never wrap a vault key to an unverified / substituted key. Only the member's
 * own private key can open the returned opaque blob.
 */
/**
 * LE GARDE COMMUN de tout scellement vers autrui (K_vault comme K_item).
 *
 * CRITICAL (anti-MITM): the fingerprint is SHA-256 over the SIGNING key only —
 * it says nothing about which ENCRYPTION key the secret is sealed to. The sole
 * proof that encPublicKey belongs to this identity is encPublicKeySig (the
 * enc↔identity binding). verifyKeypairIntegrity SKIPS that check when the sig
 * is absent (its permissive legacy path), so a compromised broker could serve
 * the victim's real signing key + fingerprint with an ATTACKER encryption key
 * and NO sig, pass the check, and have us seal to the attacker — invisible to
 * the victim's out-of-band fingerprint comparison. We therefore REQUIRE the
 * binding signature; refuse if it is missing. Jamais d'appel direct à
 * sealToPublicKey pour un destinataire : TOUJOURS ce garde d'abord.
 */
async function assertVerifiedRecipient(peer: MemberPublicKey): Promise<void> {
  if (!isKeyAlgoSupported(peer.keyAlgo)) {
    throw new VaultKeyError(
      'unsupported_key_algo',
      `Unsupported recipient key algorithm "${peer.keyAlgo}" — refusing to wrap`
    );
  }
  if (!peer.encPublicKeySig) {
    throw new VaultKeyError(
      'key_integrity_failed',
      'Recipient public key has no enc↔identity binding signature — refusing to wrap (possible key substitution)'
    );
  }
  const ok = await verifyKeypairIntegrity({
    encPublicKey: peer.encPublicKey,
    signPublicKey: peer.signPublicKey,
    encPublicKeySig: peer.encPublicKeySig,
    fingerprint: peer.fingerprint,
    keyAlgo: peer.keyAlgo,
  });
  if (!ok) {
    throw new VaultKeyError(
      'key_integrity_failed',
      'Recipient public key failed the integrity check — refusing to wrap (possible key substitution)'
    );
  }
}

export async function wrapVaultKeyForMember(
  kVault: Uint8Array,
  peer: MemberPublicKey
): Promise<string> {
  await assertVerifiedRecipient(peer);
  return sealToPublicKey(kVault, peer.encPublicKey, peer.keyAlgo);
}

/**
 * E3-6 — sceller K_item à la clé publique d'un DESTINATAIRE de partage par
 * personne. Même garde anti-substitution que K_vault : un K_item scellé à une
 * clé non liée serait exactement l'attaque documentée ci-dessus, à l'échelle
 * d'un élément.
 */
export async function wrapItemKeyForRecipient(
  kItem: Uint8Array,
  peer: MemberPublicKey
): Promise<string> {
  await assertVerifiedRecipient(peer);
  return sealToPublicKey(kItem, peer.encPublicKey, peer.keyAlgo);
}

/** Rouvrir le K_item qui nous a été scellé (écran « Partagé avec moi »). */
export async function unwrapGrantedItemKey(wrapped: string): Promise<Uint8Array> {
  return openSealed(wrapped);
}

/**
 * Open OUR own wrap of K_vault using the private key currently loaded by
 * userKeypair.ts (E2). `keyAlgo` defaults to the loaded keypair's algo (the wrap
 * was sealed to our key, so it matches). Throws if no keypair is loaded or the
 * blob was tampered with (AES-GCM tag mismatch).
 */
export async function unwrapVaultKey(wrapped: string, keyAlgo?: string): Promise<Uint8Array> {
  return keyAlgo ? openSealed(wrapped, keyAlgo) : openSealed(wrapped);
}

// ── AES-GCM helpers (shared by vault name + items) ───────────────────────────

/** Import a raw 32-byte AES-256 key (K_vault or K_item) for the given usages. */
function importAesGcmKey(keyBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

/**
 * Chiffrer un TEXTE sous K_vault → {ciphertext, iv} en base64.
 *
 * LA PRIMITIVE COMMUNE de tout ce qu'un coffre garde en clair pour ses membres
 * et opaque pour le serveur : son nom (colonne `name_encrypted`) et, depuis
 * F13, son bloc de réglages (colonne `settings_encrypted` — description,
 * apparence, règle de vérification). Deux colonnes, DEUX époques possibles, mais
 * une seule et même opération : AES-GCM sous la clé du coffre, IV de 12 octets
 * tiré à chaque appel, sortie base64.
 *
 * Écrite une fois plutôt que recopiée : deux implémentations du même format
 * finiraient par diverger d'un octet, et un octet de plus ou de moins entre le
 * chiffrement et le déchiffrement ne se voit qu'au moment où plus personne ne
 * peut ouvrir ce que le coffre contient.
 */
export async function encryptVaultBlob(
  text: string,
  kVault: Uint8Array
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importAesGcmKey(kVault, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(text) as BufferSource
    )
  );
  return { ciphertext: uint8ToBase64(ct), iv: uint8ToBase64(iv) };
}

/** Déchiffrer un texte scellé par `encryptVaultBlob`. Lève sur mauvaise clé /
 *  altération (tag AES-GCM) — jamais de repli silencieux sur du vide. */
export async function decryptVaultBlob(
  ciphertext: string,
  iv: string,
  kVault: Uint8Array
): Promise<string> {
  const key = await importAesGcmKey(kVault, ['decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToUint8(iv) },
    key,
    base64ToUint8(ciphertext) as BufferSource
  );
  return new TextDecoder().decode(pt);
}

/** Encrypt a vault name under K_vault → opaque {nameEncrypted, nameIv} (base64). */
export async function encryptVaultName(
  name: string,
  kVault: Uint8Array
): Promise<{ nameEncrypted: string; nameIv: string }> {
  const { ciphertext, iv } = await encryptVaultBlob(name, kVault);
  return { nameEncrypted: ciphertext, nameIv: iv };
}

/** Decrypt a vault name encrypted under K_vault. Throws on a wrong key / tamper. */
export async function decryptVaultName(
  nameEncrypted: string,
  nameIv: string,
  kVault: Uint8Array
): Promise<string> {
  return decryptVaultBlob(nameEncrypted, nameIv, kVault);
}

// ── Per-item content keys (E3-3) ─────────────────────────────────────────────
//
// Each vault item has its own K_item (AES-256). K_item is wrapped SYMMETRICALLY
// under K_vault (distinct from the per-MEMBER asymmetric seal of K_vault). The
// item's content chunks are encrypted under K_item with the SAME IV(12)||ct+tag
// layout as shares, so the pipeline unifies cleanly in E3-6. Item metadata is
// encrypted under K_item too — so the item is self-contained (one key unlocks its
// content AND its title), which keeps a K_vault rotation (E3-5) cheap: only the
// wrapped_item_key is re-wrapped forward; K_item, chunks and meta are unchanged.
//
// Integrity scope: chunks carry NO AES-GCM additionalData (AAD), exactly like the
// share format we mirror. Per-item key uniqueness already blocks cross-item/cross-
// vault chunk substitution (a foreign chunk fails the GCM tag). The residual a
// compromised broker could attempt is intra-item chunk reorder/truncation; binding
// AAD=(itemId, index, total) — or authenticating a chunk-hash manifest under K_item
// — would close it, but must be done UNIFORMLY across share + vault in E3-6 to keep
// one pipeline. Tracked there, not duplicated here.

/** Generate a fresh 256-bit item content key. */
export function generateItemKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(K_VAULT_LENGTH));
}

/** Wrap K_item symmetrically under K_vault → base64(IV(12)||ciphertext+tag). */
export async function wrapItemKey(kItem: Uint8Array, kVault: Uint8Array): Promise<string> {
  const key = await importAesGcmKey(kVault, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, kItem as BufferSource)
  );
  const blob = new Uint8Array(IV_LENGTH + ct.length);
  blob.set(iv, 0);
  blob.set(ct, IV_LENGTH);
  return uint8ToBase64(blob);
}

/** Open K_item from its symmetric wrap under K_vault. Throws on wrong key / tamper. */
export async function unwrapItemKey(wrapped: string, kVault: Uint8Array): Promise<Uint8Array> {
  const key = await importAesGcmKey(kVault, ['decrypt']);
  const blob = base64ToUint8(wrapped);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.slice(0, IV_LENGTH) },
    key,
    blob.slice(IV_LENGTH) as BufferSource
  );
  return new Uint8Array(pt);
}

/** Encrypt one content chunk under K_item → IV(12)||ciphertext+tag (raw bytes).
 *  Uses the SHARED chunk pipeline (E3-6) — byte-identical to share chunks. */
export async function encryptItemChunk(
  plaintext: Uint8Array,
  kItem: Uint8Array
): Promise<Uint8Array> {
  return encryptChunk(plaintext, await importChunkKey(kItem, ['encrypt']));
}

/** Decrypt one content chunk (IV(12)||ciphertext+tag) under K_item (shared pipeline). */
export async function decryptItemChunk(chunk: Uint8Array, kItem: Uint8Array): Promise<Uint8Array> {
  return decryptChunk(chunk, await importChunkKey(kItem, ['decrypt']));
}

/** Encrypt item metadata (title/filename/…) under K_item → {encryptedMeta, encryptedMetaIv}. */
export async function encryptItemMeta(
  meta: unknown,
  kItem: Uint8Array
): Promise<{ encryptedMeta: string; encryptedMetaIv: string }> {
  const key = await importAesGcmKey(kItem, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(meta)) as BufferSource
    )
  );
  return { encryptedMeta: uint8ToBase64(ct), encryptedMetaIv: uint8ToBase64(iv) };
}

/** Decrypt item metadata under K_item → the parsed object. Throws on wrong key / tamper. */
export async function decryptItemMeta<T = unknown>(
  encryptedMeta: string,
  encryptedMetaIv: string,
  kItem: Uint8Array
): Promise<T> {
  const key = await importAesGcmKey(kItem, ['decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToUint8(encryptedMetaIv) },
    key,
    base64ToUint8(encryptedMeta) as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

// ── Convenience: build the create-vault payload ──────────────────────────────

/**
 * One-shot helper for the create-vault flow: generate K_vault, encrypt the name
 * under it, and seal it to the OWNER's own public key. The owner's key still goes
 * through the integrity check (consistency with the member path). Returns the
 * opaque blobs to POST plus the raw K_vault for the session.
 */
export async function buildVaultCreatePayload(
  name: string,
  ownerPublicKey: MemberPublicKey
): Promise<VaultCreatePayload> {
  const kVault = generateVaultKey();
  const { nameEncrypted, nameIv } = await encryptVaultName(name, kVault);
  const wrappedVaultKey = await wrapVaultKeyForMember(kVault, ownerPublicKey);
  return { kVault, nameEncrypted, nameIv, wrappedVaultKey };
}

// ── base64 helpers (self-contained; mirror userKeypair.ts) ───────────────────

function uint8ToBase64(data: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  return btoa(bin);
}

// Return the concrete ArrayBuffer-backed type so the result is directly usable as
// a BufferSource (AES-GCM iv / data) under TS 5.9's generic-typed-array lib.
function base64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
