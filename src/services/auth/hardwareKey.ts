/**
 * Hardware Security Key — WebAuthn PRF layer (feature #7).
 *
 * Drives navigator.credentials.create/get with the PRF (hmac-secret) extension
 * and hands the resulting 32-byte secret to hybridCrypto, which derives a KEK
 * and wraps/unwraps the FEK. This module never touches the FEK itself.
 *
 * Origin requirements: WebAuthn needs a secure context with a valid rp.id —
 * dev runs on http://localhost:3000 (rp.id 'localhost'), packaged builds load
 * over app://filarr.app (rp.id 'filarr.app', see main.ts). An enrollment is
 * bound to BOTH the device and the origin it was created on, which is fine:
 * the hw wrap is local-only by design and the password always works.
 *
 * Lockout safety: enrolling never replaces the password wrap — it adds an
 * alternative unlock. Losing the key = fall back to password, nothing lost.
 */

import { enrollHardwareKey, initFromHardwareKey, getHardwareKeyInfo } from './hybridCrypto';

const PRF_SALT_LENGTH = 32;

// ── base64url helpers (credential ids use the URL-safe alphabet) ─────────────

function bufToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBuf(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Standard base64 (the encoding hybridCrypto uses for salts). */
function base64ToBuf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ── capability check ─────────────────────────────────────────────────────────

/**
 * Whether this renderer can attempt WebAuthn at all. True requires a secure
 * context (localhost in dev, app://filarr.app packaged — NOT file://) and the
 * PublicKeyCredential API. PRF support is per-authenticator and only
 * discoverable by actually trying, so this is necessary-not-sufficient.
 */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof window.PublicKeyCredential === 'function'
  );
}

function rpId(): string {
  return window.location.hostname; // 'localhost' in dev, 'filarr.app' packaged
}

// ── PRF plumbing ─────────────────────────────────────────────────────────────

/**
 * Run an assertion against `credentialId` with the PRF extension evaluating
 * `salt`, and return the 32-byte PRF output. This is the shared core of both
 * enrollment (first PRF evaluation) and unlock (re-evaluation).
 */
async function getPrfOutput(credentialId: string, salt: Uint8Array): Promise<Uint8Array> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credIdBuf = base64urlToBuf(credentialId);
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as BufferSource,
      rpId: rpId(),
      allowCredentials: [{ type: 'public-key', id: credIdBuf as BufferSource }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: salt as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error('Authenticator returned no assertion');
  }
  const ext = assertion.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prfFirst = ext.prf?.results?.first;
  if (!prfFirst) {
    throw new Error('This security key does not support the PRF extension');
  }
  return new Uint8Array(prfFirst);
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Enroll a hardware key as an additional vault unlock method. The vault must
 * already be unlocked (hybridCrypto holds the FEK). Two authenticator touches:
 * one to create the credential, one to evaluate the PRF for the wrap.
 */
export async function enrollHardwareKeyWebAuthn(profileName: string): Promise<void> {
  if (!isWebAuthnAvailable()) {
    throw new Error('WebAuthn is not available in this context');
  }

  // 1. Create a credential with the PRF extension requested.
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { id: rpId(), name: 'Filarr' },
      user: {
        id: userId as BufferSource,
        name: profileName || 'Filarr vault',
        displayName: profileName || 'Filarr vault',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Credential creation was cancelled');
  }
  const createExt = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean };
  };
  if (createExt.prf?.enabled === false) {
    throw new Error('This security key does not support the PRF extension');
  }

  // 2. Evaluate the PRF over a fresh random salt (some authenticators only
  //    expose PRF results on get(), not create() — so we always assert).
  const credentialId = bufToBase64url(credential.rawId);
  const salt = crypto.getRandomValues(new Uint8Array(PRF_SALT_LENGTH));
  const prfOutput = await getPrfOutput(credentialId, salt);

  // 3. Hand off to the crypto core: derive KEK, wrap FEK, persist locally.
  await enrollHardwareKey(prfOutput, credentialId, salt);
}

/**
 * Unlock the vault with the enrolled hardware key (one authenticator touch).
 * Loads the FEK into memory + safeStorage exactly like the password path.
 */
export async function unlockWithHardwareKey(): Promise<void> {
  if (!isWebAuthnAvailable()) {
    throw new Error('WebAuthn is not available in this context');
  }
  const info = await getHardwareKeyInfo();
  if (!info.enrolled || !info.credentialId || !info.salt) {
    throw new Error('No hardware key is enrolled on this device');
  }
  const salt = base64ToBuf(info.salt);
  const prfOutput = await getPrfOutput(info.credentialId, salt);
  await initFromHardwareKey(prfOutput);
}
