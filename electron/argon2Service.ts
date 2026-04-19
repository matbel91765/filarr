/**
 * Argon2 Service - Module Electron main process
 *
 * Wrapper autour du package `argon2` (N-API, binaires precompiles).
 * Expose des fonctions de hachage, verification et derivation de cle
 * utilisant Argon2id (OWASP 2024).
 *
 * Parametres:
 * - Variante: Argon2id (resistant aux attaques side-channel ET GPU)
 * - Memoire: 64 MB (65536 KiB)
 * - Iterations: 3
 * - Parallelisme: 4
 * - Sortie: 32 bytes (256 bits)
 */

import argon2 from 'argon2';
import crypto from 'crypto';

// OWASP 2024 recommended parameters for Argon2id
const ARGON2_OPTIONS: argon2.Options & { raw?: boolean } = {
  type: argon2.argon2id,
  memoryCost: 65536,    // 64 MB
  timeCost: 3,          // 3 iterations
  parallelism: 4,       // 4 threads
  hashLength: 32,       // 256-bit output
};

/**
 * Hash un mot de passe avec Argon2id.
 *
 * @param password - Mot de passe en clair
 * @param salt - Salt en hex (optionnel, genere automatiquement si absent)
 * @returns Hash encode au format standard Argon2: $argon2id$v=19$m=65536,t=3,p=4$salt$hash
 */
export async function argon2Hash(password: string, salt?: string): Promise<string> {
  const options: argon2.Options & { raw?: boolean } = {
    ...ARGON2_OPTIONS,
    raw: false,
  };

  if (salt) {
    options.salt = Buffer.from(salt, 'hex');
  }

  return await argon2.hash(password, options);
}

/**
 * Verifie un mot de passe contre un hash Argon2.
 *
 * @param hash - Hash encode au format $argon2id$...
 * @param password - Mot de passe a verifier
 * @returns true si le mot de passe correspond
 */
export async function argon2Verify(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Derive une cle 256-bit a partir d'un mot de passe et d'un salt.
 * Utilise Argon2id avec les memes parametres OWASP.
 *
 * @param password - Mot de passe en clair
 * @param salt - Salt en hex (32 chars = 16 bytes minimum)
 * @returns Cle derivee en hex (64 chars = 32 bytes)
 */
export async function argon2DeriveKey(password: string, salt: string): Promise<string> {
  const saltBuffer = Buffer.from(salt, 'hex');

  const derivedKey = await argon2.hash(password, {
    ...ARGON2_OPTIONS,
    salt: saltBuffer,
    raw: true,
  });

  return (derivedKey as Buffer).toString('hex');
}

/**
 * Genere un salt cryptographiquement securise.
 *
 * @param length - Longueur en bytes (defaut: 16)
 * @returns Salt en hex
 */
export function generateArgon2Salt(length: number = 16): string {
  return crypto.randomBytes(length).toString('hex');
}
