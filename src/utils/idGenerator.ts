/**
 * Utilitaire pour la génération d'identifiants uniques
 *
 * Sécurité : utilise une source CSPRNG (`crypto.randomUUID` ou
 * `crypto.getRandomValues`) pour éviter les IDs prévisibles par timing ou
 * par seed partagé — indispensable car certains IDs servent d'identifiant
 * de ressource (notes, fichiers, profils) ou de corrélation.
 */

const cryptoRef: Crypto | undefined =
  typeof globalThis !== 'undefined' && typeof globalThis.crypto !== 'undefined'
    ? (globalThis.crypto as Crypto)
    : undefined;

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    cryptoRef.getRandomValues(out);
    return out;
  }
  throw new Error('CSPRNG unavailable: globalThis.crypto.getRandomValues is required');
}

/**
 * Génère un identifiant unique court (22 chars, ~128 bits d'entropie).
 * Utilise base36 pour la lisibilité.
 */
export const generateUniqueId = (): string => {
  const bytes = randomBytes(16);
  let out = '';
  // Encode every 4 bytes as a base36 u32 to get a human-ish string
  for (let i = 0; i < bytes.length; i += 4) {
    const n =
      ((bytes[i] << 24) >>> 0) +
      ((bytes[i + 1] ?? 0) << 16) +
      ((bytes[i + 2] ?? 0) << 8) +
      (bytes[i + 3] ?? 0);
    out += n.toString(36).padStart(7, '0');
  }
  return out.slice(0, 22);
};

/**
 * Génère un UUID v4 conforme RFC 4122 via `crypto.randomUUID()` quand
 * disponible, sinon via `crypto.getRandomValues()` (jamais via Math.random).
 */
export const generateUUID = (): string => {
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  // RFC 4122 v4 via getRandomValues
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Alias: UUID v4. */
export const generateId = generateUUID;

/** ID court: UUID v4 sans tirets. */
export const generateShortId = (): string => generateUUID().replace(/-/g, '');
