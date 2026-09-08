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

// ── Derivation BRUTE a parametres EXPLICITES ────────────────────────────────

export interface Argon2RawRequest {
  password: string;
  /** Sel en base64 (standard ou url-safe), 8 octets minimum. */
  saltBase64: string;
  /** Cout memoire, en KiB. */
  memoryCost: number;
  /** Nombre de passes. */
  timeCost: number;
  /** Parallelisme. */
  parallelism: number;
  /** Longueur de sortie, en octets. */
  hashLength: number;
}

/**
 * Derive des octets bruts avec un profil Argon2id DONNE PAR L'APPELANT.
 *
 * POURQUOI PAS `argon2DeriveKey`, qui existe deja. Parce que son profil est
 * FIGE sur celui du PIN local (m=65536, t=3, p=4) et qu'il est IMPLICITE. La
 * cle de garde du compte, elle, doit reproduire OCTET POUR OCTET le profil du
 * site et du mobile (m=19456, t=2, p=1, 32 octets, `hash-wasm` cote site) :
 * derivee sous un autre profil, la KEK est simplement AUTRE, l'emballage
 * s'ouvre pas, et rien ne dit pourquoi. Reutiliser un canal a profil implicite
 * pour un protocole inter-clients est le piege exact que cette fonction ferme.
 *
 * Elle ne connait AUCUN profil par defaut : c'est le client du protocole qui
 * porte ses constantes (src/services/custody/custodyFormat.ts), pas ce module.
 *
 * Le mot de passe est encode en UTF-8 SANS normalisation Unicode — ce que fait
 * `hash-wasm` d'une chaine. Une phrase accentuee doit donner le meme condensat
 * des deux cotes.
 *
 * Les bornes ne sont pas de la politesse : `argon2.hash` avec un cout memoire
 * absurde alloue vraiment, dans le processus principal, et fige la fenetre.
 */
export async function argon2RawDerive(req: Argon2RawRequest): Promise<string> {
  if (typeof req?.password !== 'string') throw new Error('INVALID_ARGON2_REQUEST');
  const salt = Buffer.from(String(req.saltBase64).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (salt.length < 8) throw new Error('INVALID_ARGON2_SALT');
  const memoryCost = Number(req.memoryCost);
  const timeCost = Number(req.timeCost);
  const parallelism = Number(req.parallelism);
  const hashLength = Number(req.hashLength);
  if (
    !Number.isInteger(memoryCost) ||
    memoryCost < 8 ||
    memoryCost > 1048576 || // 1 Gio — au-dela, c'est une denegation de service
    !Number.isInteger(timeCost) ||
    timeCost < 1 ||
    timeCost > 16 ||
    !Number.isInteger(parallelism) ||
    parallelism < 1 ||
    parallelism > 16 ||
    !Number.isInteger(hashLength) ||
    hashLength < 16 ||
    hashLength > 64
  ) {
    throw new Error('INVALID_ARGON2_PARAMS');
  }
  const derived = (await argon2.hash(req.password, {
    type: argon2.argon2id,
    memoryCost,
    timeCost,
    parallelism,
    hashLength,
    salt,
    raw: true,
  })) as unknown as Buffer;
  return Buffer.from(derived).toString('base64');
}
