/**
 * userKeypair.ts (E2-2) — per-user asymmetric keypair.
 *
 * The asymmetric counterpart of hybridCrypto.ts (which owns the symmetric FEK).
 * Each account has TWO keypairs:
 *   - X25519  (encryption) — used by E3 to wrap/unwrap vault keys
 *   - Ed25519 (signing)    — the identity; derives the fingerprint, signs the
 *                            encryption key to bind it (anti key-swap)
 *
 * Both private keys are packed (encPriv || signPriv) and wrapped as ONE AES-GCM
 * blob — base64(IV(12)||ciphertext) — under the SAME KEK as the FEK (PBKDF2-SHA-512,
 * 600k, AES-GCM-256). The blobs pushed to the server are opaque (no master key,
 * HARD RULE). Private keys never leave this module as raw bytes.
 *
 * Algo-agility (E2-10): every curve-specific operation goes through a per-key_algo
 * scheme registry, so generate/unwrap/derive/verify dispatch on key_algo and the
 * read paths never hard-code a curve. The AES-GCM wrap, KEK derivation and SHA-256
 * fingerprint are shared + algo-agnostic. Reads stay backward-compatible forever.
 *
 * Self-contained on purpose: the KEK params below MUST stay identical to
 * hybridCrypto.ts (deriveKEK) — kept here so the module is testable in isolation
 * (node/vitest) without pulling in renderer-only deps. A divergence in these
 * constants would silently orphan keypairs across the password/FEK paths.
 */

import { x25519, ed25519 } from '@noble/curves/ed25519.js';

// ── KEK params — MUST match hybridCrypto.ts ─────────────────────────────────
const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 256; // bits (AES-GCM)
const IV_LENGTH = 12; // bytes
const SALT_LENGTH = 16; // bytes

export const KEY_ALGO = 'x25519-ed25519';
export const KEY_VERSION = 1;

// ── Algo-agility registry (E2-10) ───────────────────────────────────────────
// All curve-specific operations live behind a per-key_algo scheme so the read
// paths (unwrap, public-key derivation, binding verify) never hard-code a curve.
// A future algo (e.g. a hybrid 'mlkem768-x25519') registers a new entry; the
// AES-GCM wrap, KEK derivation and SHA-256 fingerprint stay shared. Reads are
// permanently backward-compatible: an old key_algo keeps decrypting as long as its
// scheme is registered. HARD RULE: no 'post-quantum' claim until a real PQ scheme
// is actually implemented here — this only prepares the ground.
interface KeypairScheme {
  encPrivLen: number;
  signPrivLen: number;
  encPubLen: number;
  generateEncPriv(): Uint8Array;
  generateSignPriv(): Uint8Array;
  encPublic(encPriv: Uint8Array): Uint8Array;
  signPublic(signPriv: Uint8Array): Uint8Array;
  /** Sign the encryption public key with the identity key (enc↔identity binding). */
  bindSign(encPub: Uint8Array, signPriv: Uint8Array): Uint8Array;
  bindVerify(sig: Uint8Array, encPub: Uint8Array, signPub: Uint8Array): boolean;
  /** Ephemeral keypair for sealing a key to a recipient's public key. */
  generateEphemeral(): { priv: Uint8Array; pub: Uint8Array };
  /** Diffie-Hellman shared secret (recipient pub × our/ephemeral priv). */
  ecdh(priv: Uint8Array, pub: Uint8Array): Uint8Array;
}

const KEYPAIR_SCHEMES: Record<string, KeypairScheme> = {
  'x25519-ed25519': {
    encPrivLen: 32,
    signPrivLen: 32,
    encPubLen: 32,
    generateEncPriv: () => x25519.utils.randomSecretKey(),
    generateSignPriv: () => ed25519.utils.randomSecretKey(),
    encPublic: (k) => x25519.getPublicKey(k),
    signPublic: (k) => ed25519.getPublicKey(k),
    bindSign: (encPub, signPriv) => ed25519.sign(encPub, signPriv),
    bindVerify: (sig, encPub, signPub) => ed25519.verify(sig, encPub, signPub),
    generateEphemeral: () => {
      const priv = x25519.utils.randomSecretKey();
      return { priv, pub: x25519.getPublicKey(priv) };
    },
    ecdh: (priv, pub) => x25519.getSharedSecret(priv, pub),
  },
};

/** Whether this build can operate on keys of `algo` (generate/wrap/unwrap/verify). */
export function isKeyAlgoSupported(algo: string): boolean {
  return Object.prototype.hasOwnProperty.call(KEYPAIR_SCHEMES, algo);
}

function scheme(algo: string): KeypairScheme {
  const s = KEYPAIR_SCHEMES[algo];
  if (!s) {
    // A key newer than this binary — refuse cleanly rather than wrap with the
    // wrong scheme (E2-10 criterion). The vault-share flow surfaces this to the user.
    throw new Error(
      `Unsupported key algorithm "${algo}" (this Filarr build is older than the key)`
    );
  }
  return s;
}

/**
 * Canonical form of a recovery phrase before it is fed to PBKDF2. MUST be applied
 * identically wherever the phrase derives a KEK (wrap AND unwrap, FEK AND keypair)
 * or the wrap/unwrap keys diverge. Matches the server's verification exactly
 * (`recoveryPhrase.toLowerCase().trim()`), so a phrase that passes server bcrypt
 * verification always unwraps locally. Generated phrases are already lowercase +
 * single-spaced, so this is a no-op on them (backward-compatible with existing
 * wraps). NOTE: account passwords are case-sensitive and must NOT use this.
 */
export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase.toLowerCase().trim();
}

export interface GeneratedKeypair {
  encPublicKey: string; // base64 (X25519)
  signPublicKey: string; // base64 (Ed25519 identity)
  encPublicKeySig: string; // base64 (Ed25519 sig over encPublicKey)
  wrappedPrivateKey: string; // base64(IV(12) || AES-GCM(encPriv || signPriv))
  kekSalt: string; // base64
  keyAlgo: string;
  keyVersion: number;
  fingerprint: string;
}

// Module-level private key material (raw bytes; mirror of hybridCrypto's _fek).
let _encPriv: Uint8Array | null = null;
let _signPriv: Uint8Array | null = null;
let _keyAlgo: string = KEY_ALGO; // algo of the loaded keypair (re-derivation dispatch)

// ── base64 helpers (match hybridCrypto.ts) ──────────────────────────────────
function uint8ToBase64(data: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ── KEK derivation (PBKDF2-SHA-512 600k → AES-GCM-256, encrypt/decrypt) ──────
async function deriveKEK(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-512' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

async function aesGcmWrap(kek: CryptoKey, plaintext: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, plaintext as BufferSource);
  const packed = new Uint8Array(IV_LENGTH + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), IV_LENGTH);
  return uint8ToBase64(packed);
}

async function aesGcmUnwrap(kek: CryptoKey, blobB64: string): Promise<Uint8Array> {
  const packed = base64ToUint8(blobB64);
  const iv = packed.slice(0, IV_LENGTH);
  const ct = packed.slice(IV_LENGTH);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ct as BufferSource);
  return new Uint8Array(pt);
}

// Pack two raw private keys → one buffer (enc || sign). Algo-agnostic.
function packPrivs(encPriv: Uint8Array, signPriv: Uint8Array): Uint8Array {
  const packed = new Uint8Array(encPriv.length + signPriv.length);
  packed.set(encPriv, 0);
  packed.set(signPriv, encPriv.length);
  return packed;
}

// Safety-number format (E2-7, Signal-style): SHA-256(signPublicKey) rendered as
// 6 groups of 5 decimal digits. Each group = a big-endian 5-byte slice mod 100000,
// zero-padded. Deterministic, language-neutral, read aloud out-of-band to verify a
// peer's key. NOTE: a single SHA-256 (not Signal's iterated KDF) — adequate for an
// out-of-band check, NOT a full key-transparency claim. Algo-agnostic.
const FINGERPRINT_CHUNKS = 6;
const FINGERPRINT_CHUNK_BYTES = 5;

/**
 * Fingerprint of the identity key: a Signal-style safety number derived
 * deterministically from SHA-256(signPublicKey). Same key → same number.
 */
export async function computeFingerprint(signPublicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', signPublicKey as BufferSource)
  );
  const groups: string[] = [];
  for (let i = 0; i < FINGERPRINT_CHUNKS; i++) {
    let n = 0;
    for (let j = 0; j < FINGERPRINT_CHUNK_BYTES; j++) {
      n = n * 256 + digest[i * FINGERPRINT_CHUNK_BYTES + j];
    }
    groups.push((n % 100000).toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

/**
 * Verify the integrity of a public-key blob served by the broker (E2-7, anti-MITM):
 *   1. the fingerprint matches SHA-256(signPublicKey) — catches an inconsistent /
 *      substituted served blob (criterion: a recomputed fingerprint that differs
 *      raises an alert);
 *   2. the encryption key is signed by the identity key (the enc↔identity binding
 *      from E2-2), verified via the key's own scheme (E2-10) — a broker can't swap
 *      the encryption key under a stable identity.
 * Returns false for an UNSUPPORTED key_algo (E2-10): we can't validate a scheme we
 * don't know, so the vault-share flow (E2-8/E3) must refuse to wrap to that key.
 * The real anti-MITM guarantee is the OUT-OF-BAND comparison of the fingerprint.
 */
export async function verifyKeypairIntegrity(pub: {
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig?: string;
  fingerprint: string;
  keyAlgo?: string;
}): Promise<boolean> {
  if (pub.keyAlgo && !isKeyAlgoSupported(pub.keyAlgo)) return false;
  const signPub = base64ToUint8(pub.signPublicKey);
  if ((await computeFingerprint(signPub)) !== pub.fingerprint) return false;
  if (pub.encPublicKeySig) {
    try {
      return scheme(pub.keyAlgo ?? KEY_ALGO).bindVerify(
        base64ToUint8(pub.encPublicKeySig),
        base64ToUint8(pub.encPublicKey),
        signPub
      );
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Generate both keypairs, wrap the private keys under the password KEK, and keep
 * the private keys in module memory. Returns the opaque blobs to push to the
 * server (E2-3).
 */
export async function generateAndWrapKeypair(password: string): Promise<GeneratedKeypair> {
  const s = scheme(KEY_ALGO);
  const encPriv = s.generateEncPriv();
  const encPub = s.encPublic(encPriv);
  const signPriv = s.generateSignPriv();
  const signPub = s.signPublic(signPriv);
  // Bind the encryption key to the identity so a malicious broker can't swap it.
  const encPubSig = s.bindSign(encPub, signPriv);

  const packed = packPrivs(encPriv, signPriv);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const kek = await deriveKEK(password, salt);
  const wrappedPrivateKey = await aesGcmWrap(kek, packed);

  _encPriv = encPriv;
  _signPriv = signPriv;
  _keyAlgo = KEY_ALGO;
  notifyKeypairPresence();

  return {
    encPublicKey: uint8ToBase64(encPub),
    signPublicKey: uint8ToBase64(signPub),
    encPublicKeySig: uint8ToBase64(encPubSig),
    wrappedPrivateKey,
    kekSalt: uint8ToBase64(salt),
    keyAlgo: KEY_ALGO,
    keyVersion: KEY_VERSION,
    fingerprint: await computeFingerprint(signPub),
  };
}

/**
 * Generate a fresh keypair and return its public material + the RAW packed private key
 * (encPriv||signPriv), WITHOUT wrapping it under a password KEK. The caller seals the
 * packed private key to recipients via sealToPublicKey — this is how the E4 ORG keypair
 * lives: sealed to each admin's per-user public key, never under a password and never on
 * the server in clear. The caller MUST zero `privatePacked` after sealing.
 */
export async function generateSealableKeypair(): Promise<{
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig: string;
  fingerprint: string;
  keyAlgo: string;
  keyVersion: number;
  privatePacked: Uint8Array;
}> {
  const s = scheme(KEY_ALGO);
  const encPriv = s.generateEncPriv();
  const encPub = s.encPublic(encPriv);
  const signPriv = s.generateSignPriv();
  const signPub = s.signPublic(signPriv);
  const encPubSig = s.bindSign(encPub, signPriv);
  const privatePacked = packPrivs(encPriv, signPriv);
  encPriv.fill(0);
  signPriv.fill(0);
  return {
    encPublicKey: uint8ToBase64(encPub),
    signPublicKey: uint8ToBase64(signPub),
    encPublicKeySig: uint8ToBase64(encPubSig),
    fingerprint: await computeFingerprint(signPub),
    keyAlgo: KEY_ALGO,
    keyVersion: KEY_VERSION,
    privatePacked,
  };
}

/**
 * Re-derive the PUBLIC material (enc + sign pubkeys, fingerprint) from a packed private key
 * (encPriv||signPriv). Used to PROVE a reconstructed key is the one we expect: the E4 Shamir
 * re-split combines k shares into a private key, then checks the derived public key matches the
 * org's CURRENT public key before re-splitting — a wrong/garbage combine that derives a different
 * key is refused (storing its shares would permanently brick recovery). Does not zero `packed`
 * (the caller owns it); zeroes its own slices.
 */
export async function derivePublicFromPacked(
  packed: Uint8Array,
  keyAlgo: string = KEY_ALGO
): Promise<{ encPublicKey: string; signPublicKey: string; fingerprint: string }> {
  const s = scheme(keyAlgo);
  const encPriv = packed.slice(0, s.encPrivLen);
  const signPriv = packed.slice(s.encPrivLen, s.encPrivLen + s.signPrivLen);
  try {
    const encPub = s.encPublic(encPriv);
    const signPub = s.signPublic(signPriv);
    return {
      encPublicKey: uint8ToBase64(encPub),
      signPublicKey: uint8ToBase64(signPub),
      fingerprint: await computeFingerprint(signPub),
    };
  } finally {
    encPriv.fill(0);
    signPriv.fill(0);
  }
}

/**
 * Open a blob sealed to the org (or any) keypair, using an EXPLICIT private key rather
 * than the module-loaded user keypair. The packed private key (encPriv||signPriv) comes
 * from unsealing an org_admin_wrapped_keys blob with the admin's own keypair (openSealed).
 * Used by the E4 reset flow to unwrap a member's recovery copy with the org private key.
 */
export async function openSealedWithPriv(
  sealed: string,
  privatePacked: Uint8Array,
  keyAlgo: string = KEY_ALGO
): Promise<Uint8Array> {
  const s = scheme(keyAlgo);
  const encPriv = privatePacked.slice(0, s.encPrivLen);
  const blob = base64ToUint8(sealed);
  const ephPub = blob.slice(0, s.encPubLen);
  const iv = blob.slice(s.encPubLen, s.encPubLen + IV_LENGTH);
  const ct = blob.slice(s.encPubLen + IV_LENGTH);
  const shared = s.ecdh(encPriv, ephPub);
  const kek = await sealKekFromShared(shared, packPrivs(ephPub, s.encPublic(encPriv)), 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ct as BufferSource);
  encPriv.fill(0);
  return new Uint8Array(pt);
}

/**
 * Sign an arbitrary message with the loaded identity (Ed25519) key. Used for non-repudiable
 * consent (E4-3 escrow consent / E4-9 revocation): the member signs a canonical message
 * proving agreement, verifiable later against their published signing public key. Throws if
 * no keypair is loaded.
 */
// Domain-separation tag so a message-signature can NEVER collide with the enc↔identity
// binding use of the same key (which signs a bare 32-byte enc public key). The signed bytes
// are DOMAIN || message, distinct from any binding signature.
const IDENTITY_SIG_DOMAIN = new TextEncoder().encode('filarr.identity.sig.v1\n');
function withIdentityDomain(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(IDENTITY_SIG_DOMAIN.length + message.length);
  out.set(IDENTITY_SIG_DOMAIN, 0);
  out.set(message, IDENTITY_SIG_DOMAIN.length);
  return out;
}

export async function signWithIdentity(
  message: Uint8Array,
  keyAlgo: string = KEY_ALGO
): Promise<string> {
  const { signPriv } = requireLoaded();
  return uint8ToBase64(scheme(keyAlgo).bindSign(withIdentityDomain(message), signPriv));
}

/** Verify a signWithIdentity signature against a signing public key. Never throws. */
export async function verifyWithIdentity(
  message: Uint8Array,
  signatureB64: string,
  signPublicKeyB64: string,
  keyAlgo: string = KEY_ALGO
): Promise<boolean> {
  try {
    return scheme(keyAlgo).bindVerify(
      base64ToUint8(signatureB64),
      withIdentityDomain(message),
      base64ToUint8(signPublicKeyB64)
    );
  } catch {
    return false;
  }
}

/**
 * Re-derive the private keys from the wrapped blob + password and load them into
 * module memory. `keyAlgo` selects the scheme (defaults to the current algo for
 * existing callers); the read path never hard-codes a curve. Throws on a wrong
 * password (AES-GCM tag mismatch) or an unsupported algo.
 */
export async function unwrapPrivateKey(
  password: string,
  data: { wrappedPrivateKey: string; kekSalt: string },
  keyAlgo: string = KEY_ALGO
): Promise<void> {
  const s = scheme(keyAlgo);
  const salt = base64ToUint8(data.kekSalt);
  const kek = await deriveKEK(password, salt);
  const packed = await aesGcmUnwrap(kek, data.wrappedPrivateKey); // throws on bad password
  if (packed.length !== s.encPrivLen + s.signPrivLen) {
    throw new Error('Unexpected unwrapped keypair length');
  }
  _encPriv = packed.slice(0, s.encPrivLen);
  _signPriv = packed.slice(s.encPrivLen);
  _keyAlgo = keyAlgo;
  notifyKeypairPresence();
}

/** Raw private keys for in-process use only (E3 vault wrapping). Never exported off-device. */
export function getEncryptionPrivateKey(): Uint8Array | null {
  return _encPriv;
}
export function getSigningPrivateKey(): Uint8Array | null {
  return _signPriv;
}
export function hasUserKeypair(): boolean {
  return _encPriv !== null && _signPriv !== null;
}
export function clearUserKeypair(): void {
  _encPriv?.fill(0);
  _signPriv?.fill(0);
  _encPriv = null;
  _signPriv = null;
  _keyAlgo = KEY_ALGO;
  notifyKeypairPresence();
}

// ── Observation de la PRÉSENCE de la paire de clés ──────────────────────────
//
// POURQUOI. La paire vit dans la mémoire de ce module, posée PARESSEUSEMENT
// (mot de passe saisi après le démarrage, gate à la demande, restauration PRF)
// et effacée à la déconnexion. Or l'état dérivé d'une clé en mémoire n'est
// jamais définitif tant qu'elle n'était pas là : une liste lue sans clé, un
// coffre « verrouillé » faute de K_vault. Sans signal, ces états restaient
// figés jusqu'à un « Réessayer » manuel. Ici, le strict minimum : un Set de
// listeners, notifié à chaque CHANGEMENT de présence (pose ou effacement, pas
// à chaque affectation), zéro dépendance — le module doit rester testable en
// node, hors renderer. Le listener ne reçoit qu'un booléen : jamais la clé.
type KeypairPresenceListener = (present: boolean) => void;
const _presenceListeners = new Set<KeypairPresenceListener>();
let _lastNotifiedPresence = false;

/** S'abonner aux changements de présence ; retourne le désabonnement. */
export function subscribeUserKeypair(listener: KeypairPresenceListener): () => void {
  _presenceListeners.add(listener);
  return () => {
    _presenceListeners.delete(listener);
  };
}

/**
 * À appeler après TOUTE affectation de _encPriv/_signPriv. Un listener qui
 * jette n'empêche ni la pose de la clé ni les autres listeners : l'appelant
 * (déverrouillage, déconnexion) ne doit jamais échouer à cause d'un abonné.
 */
function notifyKeypairPresence(): void {
  const present = hasUserKeypair();
  if (present === _lastNotifiedPresence) return;
  _lastNotifiedPresence = present;
  // Copie : un listener qui se désabonne pendant la notification ne doit pas
  // perturber l'itération.
  for (const listener of Array.from(_presenceListeners)) {
    try {
      listener(present);
    } catch {
      /* un abonné défaillant ne casse pas la pose de la clé */
    }
  }
}

/**
 * OUR own public-key material (for sealing a vault key to ourselves at vault
 * creation — E3). Returns null if no keypair is loaded. Shape matches the
 * MemberPublicKey that vaultCrypto.wrapVaultKeyForMember expects, so the owner's
 * self-wrap goes through the SAME integrity-checked path as any member's.
 */
export async function getOwnPublicKey(): Promise<{
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig: string;
  fingerprint: string;
  keyAlgo: string;
  keyVersion: number;
} | null> {
  if (!_encPriv || !_signPriv) return null;
  const pub = await currentPublicMaterial();
  return { ...pub, keyAlgo: _keyAlgo, keyVersion: KEY_VERSION };
}

// ── Re-wrap / recovery (E2-5) ───────────────────────────────────────────────

function requireLoaded(): { encPriv: Uint8Array; signPriv: Uint8Array } {
  if (!_encPriv || !_signPriv) {
    throw new Error('User keypair not loaded — cannot re-wrap');
  }
  return { encPriv: _encPriv, signPriv: _signPriv };
}

/** Pack the in-memory private keys and wrap them under a fresh KEK from `secret`. */
async function wrapPackedUnder(
  secret: string
): Promise<{ wrappedPrivateKey: string; kekSalt: string }> {
  const { encPriv, signPriv } = requireLoaded();
  const packed = packPrivs(encPriv, signPriv);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const kek = await deriveKEK(secret, salt);
  return { wrappedPrivateKey: await aesGcmWrap(kek, packed), kekSalt: uint8ToBase64(salt) };
}

/** Public material recomputed from the in-memory private keys (deterministic). */
async function currentPublicMaterial(): Promise<{
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig: string;
  fingerprint: string;
}> {
  const { encPriv, signPriv } = requireLoaded();
  const s = scheme(_keyAlgo);
  const encPub = s.encPublic(encPriv);
  const signPub = s.signPublic(signPriv);
  return {
    encPublicKey: uint8ToBase64(encPub),
    signPublicKey: uint8ToBase64(signPub),
    encPublicKeySig: uint8ToBase64(s.bindSign(encPub, signPriv)),
    fingerprint: await computeFingerprint(signPub),
  };
}

/**
 * Re-wrap the loaded keypair under a new secret (password change / recovery).
 * The public keys + fingerprint are UNCHANGED (the identity is stable — signing is
 * deterministic), so vault keys wrapped to the public key stay valid. The keypair's
 * own algo is preserved (a re-wrap is not a re-key).
 */
export async function rewrapLoadedKeypair(newSecret: string): Promise<GeneratedKeypair> {
  const pub = await currentPublicMaterial();
  const wrapped = await wrapPackedUnder(newSecret);
  return { ...pub, ...wrapped, keyAlgo: _keyAlgo, keyVersion: KEY_VERSION };
}

/** Wrap the loaded private keys under the recovery phrase (rotating salt/IV). */
export async function wrapLoadedRecovery(
  recoveryPhrase: string
): Promise<{ recoveryWrappedPrivateKey: string; recoverySalt: string }> {
  // Normalize the phrase (NOT the password path) so wrap/unwrap KEKs always match.
  const { wrappedPrivateKey, kekSalt } = await wrapPackedUnder(
    normalizeRecoveryPhrase(recoveryPhrase)
  );
  return { recoveryWrappedPrivateKey: wrappedPrivateKey, recoverySalt: kekSalt };
}

// ── Alternate unlock paths (E2-9): hardware-key (PRF) + decoy ────────────────

/**
 * Wrap the loaded private keys under an ARBITRARY AES-GCM KEK (not password-
 * derived) → base64(IV||ciphertext). Used by the WebAuthn-PRF path: the KEK comes
 * from deriveKEKFromPrf (HKDF over the authenticator's PRF output), so the keypair
 * follows the FEK onto the hardware key. The KEK must allow 'encrypt'.
 */
export async function wrapLoadedUnderKey(kek: CryptoKey): Promise<string> {
  const { encPriv, signPriv } = requireLoaded();
  return aesGcmWrap(kek, packPrivs(encPriv, signPriv));
}

/**
 * Unwrap private keys produced by wrapLoadedUnderKey and load them into module
 * memory. `keyAlgo` selects the scheme. The KEK must allow 'decrypt'. Throws on a
 * wrong key (GCM tag mismatch) or an unsupported algo.
 */
export async function unwrapPrivateKeyUnderKey(
  kek: CryptoKey,
  blobB64: string,
  keyAlgo: string = KEY_ALGO
): Promise<void> {
  const s = scheme(keyAlgo);
  const packed = await aesGcmUnwrap(kek, blobB64); // throws on bad key
  if (packed.length !== s.encPrivLen + s.signPrivLen) {
    throw new Error('Unexpected unwrapped keypair length');
  }
  _encPriv = packed.slice(0, s.encPrivLen);
  _signPriv = packed.slice(s.encPrivLen);
  _keyAlgo = keyAlgo;
  notifyKeypairPresence();
}

/**
 * Generate a fresh keypair wrapped under `password`, WITHOUT touching module
 * memory (the currently-loaded keypair stays loaded). Used to seed the decoy
 * profile's OWN independent keypair (E2-9 deniability): the decoy is never a wrap
 * of the real private key — it is a separate identity under the duress password.
 */
export async function generateDetachedKeypair(password: string): Promise<GeneratedKeypair> {
  const s = scheme(KEY_ALGO);
  const encPriv = s.generateEncPriv();
  const encPub = s.encPublic(encPriv);
  const signPriv = s.generateSignPriv();
  const signPub = s.signPublic(signPriv);
  const encPubSig = s.bindSign(encPub, signPriv);

  const packed = packPrivs(encPriv, signPriv);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const kek = await deriveKEK(password, salt);
  const wrappedPrivateKey = await aesGcmWrap(kek, packed);
  const fingerprint = await computeFingerprint(signPub);
  // Detached: nothing retains these raw secrets, so zero them now (best-effort
  // heap hygiene for duress-adjacent material) rather than wait for GC.
  packed.fill(0);
  encPriv.fill(0);
  signPriv.fill(0);

  return {
    encPublicKey: uint8ToBase64(encPub),
    signPublicKey: uint8ToBase64(signPub),
    encPublicKeySig: uint8ToBase64(encPubSig),
    wrappedPrivateKey,
    kekSalt: uint8ToBase64(salt),
    keyAlgo: KEY_ALGO,
    keyVersion: KEY_VERSION,
    fingerprint,
  };
}

// ── Seal to a public key (the keypair's purpose; consumed by E3 vault sharing) ─
// Anonymous ECIES-style seal: an ephemeral X25519 key × the recipient's encryption
// public key → HKDF-SHA-256 → AES-GCM. The recipient opens it with their private
// key. The sealed blob is base64(ephPub || IV(12) || ciphertext). No private key is
// needed to SEAL (only the recipient's public key), so any member can wrap a vault
// key to a peer resolved via the public-key lookup (E2-8).
const HKDF_INFO_SEAL = 'filarr.userkey.seal.v1';

async function sealKekFromShared(
  shared: Uint8Array,
  salt: Uint8Array,
  usage: 'encrypt' | 'decrypt'
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', shared as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode(HKDF_INFO_SEAL),
    },
    base,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    [usage]
  );
}

/**
 * Seal `plaintext` (e.g. a 32-byte vault key) to a recipient's encryption public
 * key. `keyAlgo` is the RECIPIENT's algo (E2-10 dispatch); throws on an unsupported
 * one (refuse to wrap with the wrong scheme rather than silently). Returns an
 * opaque base64 blob the recipient opens with openSealed().
 */
export async function sealToPublicKey(
  plaintext: Uint8Array,
  recipientEncPublicKey: string,
  keyAlgo: string = KEY_ALGO
): Promise<string> {
  const s = scheme(keyAlgo);
  const recipientPub = base64ToUint8(recipientEncPublicKey);
  const eph = s.generateEphemeral();
  const shared = s.ecdh(eph.priv, recipientPub);
  // Bind the KDF to BOTH public keys (ephemeral + recipient) so the ciphertext is
  // tied to the intended recipient — standard sealed-box hardening.
  const kek = await sealKekFromShared(shared, packPrivs(eph.pub, recipientPub), 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, plaintext as BufferSource)
  );
  eph.priv.fill(0); // ephemeral private key is done — zero it
  const blob = new Uint8Array(eph.pub.length + IV_LENGTH + ct.length);
  blob.set(eph.pub, 0);
  blob.set(iv, eph.pub.length);
  blob.set(ct, eph.pub.length + IV_LENGTH);
  return uint8ToBase64(blob);
}

/**
 * Open a blob sealed to OUR encryption public key, using the loaded private key.
 * `keyAlgo` defaults to the loaded keypair's algo (E2-10). Throws on a wrong
 * recipient / tampered blob (AES-GCM tag mismatch) or if no keypair is loaded.
 */
export async function openSealed(sealed: string, keyAlgo: string = _keyAlgo): Promise<Uint8Array> {
  const { encPriv } = requireLoaded();
  const s = scheme(keyAlgo);
  const blob = base64ToUint8(sealed);
  const ephPub = blob.slice(0, s.encPubLen);
  const iv = blob.slice(s.encPubLen, s.encPubLen + IV_LENGTH);
  const ct = blob.slice(s.encPubLen + IV_LENGTH);
  const shared = s.ecdh(encPriv, ephPub);
  // Same KDF binding as seal: ephemeral + OUR (recipient) public key.
  const kek = await sealKekFromShared(shared, packPrivs(ephPub, s.encPublic(encPriv)), 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ct as BufferSource);
  return new Uint8Array(pt);
}
