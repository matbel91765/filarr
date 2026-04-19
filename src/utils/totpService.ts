/**
 * TOTP Service - Time-based One-Time Password (RFC 6238)
 *
 * Implementation pure TypeScript utilisant Web Crypto API (HMAC-SHA1).
 * Zero dependance npm.
 *
 * Standards implementes:
 * - RFC 4648: Base32 encoding
 * - RFC 4226: HOTP (HMAC-based One-Time Password)
 * - RFC 6238: TOTP (Time-based One-Time Password)
 */

// ==================== BASE32 ====================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode une chaine Base32 (RFC 4648) en Uint8Array.
 * Accepte les espaces et tirets (ignores), insensible a la casse.
 */
export function base32Decode(encoded: string): Uint8Array {
  // Nettoyer : majuscules, retirer espaces/tirets/padding
  const clean = encoded.toUpperCase().replace(/[\s\-=]/g, '');

  if (clean.length === 0) {
    return new Uint8Array(0);
  }

  // Valider les caracteres
  for (const char of clean) {
    if (BASE32_ALPHABET.indexOf(char) === -1) {
      throw new Error(`Caractere Base32 invalide: ${char}`);
    }
  }

  // Decoder par groupes de 5 bits
  const bits: number[] = [];
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    // Ajouter 5 bits
    for (let i = 4; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }

  // Convertir bits en octets (groupes de 8)
  const bytes: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j];
    }
    bytes.push(byte);
  }

  return new Uint8Array(bytes);
}

// ==================== HOTP (RFC 4226) ====================

/**
 * Genere un code HOTP (HMAC-based One-Time Password).
 *
 * @param secret - Cle secrete en bytes (Uint8Array)
 * @param counter - Compteur (bigint pour precision 64-bit)
 * @param digits - Nombre de chiffres du code (defaut: 6)
 * @returns Code OTP sous forme de chaine zero-padded
 */
export async function generateHOTP(
  secret: Uint8Array,
  counter: bigint,
  digits: number = 6
): Promise<string> {
  // Encoder le counter en 8 octets big-endian
  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  // BigInt -> 2 x uint32 big-endian
  counterView.setUint32(0, Number(counter >> 32n) >>> 0);
  counterView.setUint32(4, Number(counter & 0xFFFFFFFFn) >>> 0);

  // Importer la cle HMAC-SHA1
  const key = await crypto.subtle.importKey(
    'raw',
    secret.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  // Signer le counter
  const signature = await crypto.subtle.sign('HMAC', key, counterBuffer);
  const hmac = new Uint8Array(signature);

  // Troncature dynamique (RFC 4226 Section 5.4)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  // Modulo 10^digits
  const otp = binary % Math.pow(10, digits);

  // Zero-pad
  return otp.toString().padStart(digits, '0');
}

// ==================== TOTP (RFC 6238) ====================

export interface TOTPOptions {
  period?: number;    // Duree d'une periode en secondes (defaut: 30)
  digits?: number;    // Nombre de chiffres (defaut: 6)
  algorithm?: string; // Algorithme HMAC (defaut: 'SHA-1') - seul SHA-1 supporte pour l'instant
}

/**
 * Genere un code TOTP (Time-based One-Time Password).
 *
 * @param secretBase32 - Secret encode en Base32
 * @param options - Options TOTP (period, digits)
 * @returns Code TOTP sous forme de chaine
 */
export async function generateTOTP(
  secretBase32: string,
  options: TOTPOptions = {}
): Promise<string> {
  const { period = 30, digits = 6 } = options;

  const secret = base32Decode(secretBase32);
  if (secret.length === 0) {
    throw new Error('Secret TOTP invalide');
  }

  const counter = BigInt(Math.floor(Date.now() / 1000 / period));
  return generateHOTP(secret, counter, digits);
}

// ==================== UTILITAIRES ====================

/**
 * Retourne le nombre de secondes restantes dans la periode TOTP courante.
 */
export function getRemainingSeconds(period: number = 30): number {
  return period - (Math.floor(Date.now() / 1000) % period);
}

/**
 * Retourne l'index de la periode TOTP courante (pour detecter les changements).
 */
export function getCurrentPeriodIndex(period: number = 30): number {
  return Math.floor(Date.now() / 1000 / period);
}

/**
 * Valide qu'une chaine est un secret TOTP Base32 valide.
 * Accepte les espaces et tirets.
 */
export function isValidTOTPSecret(secret: string): boolean {
  if (!secret || secret.trim().length === 0) {
    return false;
  }

  const clean = secret.toUpperCase().replace(/[\s\-=]/g, '');
  if (clean.length < 8) {
    return false; // Minimum 8 caracteres Base32 (40 bits = 5 bytes)
  }

  for (const char of clean) {
    if (BASE32_ALPHABET.indexOf(char) === -1) {
      return false;
    }
  }

  return true;
}

/**
 * Construit une URI otpauth:// pour affichage QR code.
 *
 * Format: otpauth://totp/ISSUER:ACCOUNT?secret=SECRET&issuer=ISSUER&algorithm=SHA1&digits=6&period=30
 */
export function buildOTPAuthURI(
  secret: string,
  issuer: string,
  account: string
): string {
  const cleanSecret = secret.toUpperCase().replace(/[\s\-=]/g, '');
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(account);

  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${cleanSecret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

export default {
  base32Decode,
  generateHOTP,
  generateTOTP,
  getRemainingSeconds,
  getCurrentPeriodIndex,
  isValidTOTPSecret,
  buildOTPAuthURI,
};
