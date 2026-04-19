/**
 * PIN Service
 *
 * Hashing et verification de PIN via Web Crypto API (PBKDF2).
 * Utilise dans le mode local pour le verrouillage optionnel de l'application.
 *
 * Format du hash: pbkdf2-pin:<iterations>:<salt_hex>:<hash_hex>
 */

const PIN_ITERATIONS = 100_000;
const PIN_SALT_LENGTH = 16; // bytes

/**
 * Hash un PIN avec PBKDF2-SHA-256 + sel aleatoire
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PIN_SALT_LENGTH));
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('');

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PIN_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  return `pbkdf2-pin:${PIN_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verifie un PIN contre son hash (supporte ancien et nouveau format)
 */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (hash.startsWith('pbkdf2-pin:')) {
    // New format: pbkdf2-pin:<iterations>:<salt_hex>:<hash_hex>
    const parts = hash.split(':');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expectedHashHex = parts[3];
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial, 256
    );
    const computedHex = Array.from(new Uint8Array(derivedBits))
      .map((b) => b.toString(16).padStart(2, '0')).join('');

    // Timing-constant comparison
    if (computedHex.length !== expectedHashHex.length) return false;
    let result = 0;
    for (let i = 0; i < computedHex.length; i++) {
      result |= computedHex.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
    }
    return result === 0;
  }

  // Legacy format: plain SHA-256 hash — verify then caller should re-hash
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + 'filarr-pin-salt-v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const computed = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return computed === hash;
}

/**
 * Detecte si un hash utilise l'ancien format (SHA-256 simple)
 */
export function isLegacyPinHash(hash: string): boolean {
  return !hash.startsWith('pbkdf2-pin:');
}
