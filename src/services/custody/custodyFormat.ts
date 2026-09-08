/**
 * Clé de garde du compte — CONSTANTES ET DISPOSITIONS D'OCTETS (module PUR).
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE LE BUREAU NE SAVAIT PAS FAIRE, ET POURQUOI ÇA SE VOYAIT
 * ════════════════════════════════════════════════════════════════════════
 * Le bureau savait SCELLER vers la clé de garde (`sharing/custodySeal.ts`) :
 * à la création d'un partage, K_share part scellée sur la publique du compte,
 * ce qui n'exige aucun secret. Il n'a jamais su OUVRIR — pas de privée en
 * mémoire, pas de déballage, pas de session. Conséquence visible : la liste
 * « Mes partages » n'affichait qu'un identifiant tronqué, là où le site et le
 * mobile montrent le nom que l'utilisateur a donné à son lien.
 *
 * Ce module porte le contrat d'octets. Il est PUR (aucun import) pour la même
 * raison que son jumeau mobile : un contrat d'interopérabilité se relit et se
 * teste sans chaîne native, sans IPC, sans Electron.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE CANON, RELU DANS LES DEUX AUTRES CLIENTS
 * ════════════════════════════════════════════════════════════════════════
 * Références : `filarr-website/src/lib/custody-crypto.ts` (+
 * `file-request-crypto.ts`) et `filarr-mobile/src/services/custody/
 * custodyFormat.ts`. Un libellé scellé par l'un DOIT s'ouvrir chez les deux
 * autres — `custodyCrypto.vitest.ts` le vérifie sur vecteurs figés.
 *
 *   · paire X25519 ; publique = 32 octets bruts en base64url SANS remplissage,
 *     privée = 32 octets bruts ;
 *   · privée EMBALLÉE en AES-256-GCM sous une KEK Argon2id(m=19456, t=2, p=1,
 *     32 octets) dérivée d'une PHRASE DE RÉCUPÉRATION DÉDIÉE — jamais le mot
 *     de passe du compte, jamais transmise ; disposition `iv(12) ‖ ct ‖ tag`
 *     en base64 STANDARD ;
 *   · sel de KDF : 16 octets, base64 STANDARD ;
 *   · SCEAU : `ephPub(32) ‖ iv(12) ‖ ct ‖ tag(16)` en base64 STANDARD, clé =
 *     HKDF-SHA-256(secret partagé, sel = ephPub ‖ pubDestinataire, info =
 *     `filarr.filerequest.seal.v1`) → AES-256-GCM.
 *
 * LE SÉPARATEUR DE DOMAINE EST CELUI DES DEMANDES DE FICHIERS, pas un
 * identifiant « custody » qui serait plus logique : le site réutilise
 * `sealFileKey` tel quel pour la garde. En inventer un ici produirait des
 * sceaux que personne d'autre n'ouvrirait — l'interopérabilité prime sur
 * l'esthétique du nommage. `sharing/custodySeal.ts` porte déjà la constante
 * en dur pour le sens montant ; celle d'ici est sa jumelle documentaire.
 */

// ── Constantes du protocole ─────────────────────────────────────────────

/** Longueur d'une clé X25519, publique comme privée. */
export const X25519_KEY_LENGTH = 32;

/** IV AES-GCM des sceaux et des emballages. */
export const CUSTODY_IV_LENGTH = 12;

/** Sel de la dérivation Argon2id — 16 octets, comme le site. */
export const CUSTODY_SALT_LENGTH = 16;

/** Profil Argon2id de l'emballage — miroir de `CUSTODY_KDF` du site. */
export const CUSTODY_ARGON2_PARAMS = { m: 19456, t: 2, p: 1 } as const;

/** Longueur de la KEK dérivée. */
export const CUSTODY_KEK_LENGTH = 32;

/** Ancien schéma : clé emballée sous le MOT DE PASSE DU COMPTE (vu par le serveur). */
export const CUSTODY_SCHEME_LEGACY = 'account-password-v1';

/** Schéma courant : phrase de récupération dédiée, jamais transmise. */
export const CUSTODY_SCHEME_PASSPHRASE = 'passphrase-v1';

export type CustodyScheme = typeof CUSTODY_SCHEME_LEGACY | typeof CUSTODY_SCHEME_PASSPHRASE;

/** Matériel de clé tel que le worker le stocke et le rend. */
export interface CustodyKeyMaterial {
  /** X25519 publique, base64url — le serveur la voit, c'est voulu. */
  custodyPublicKey: string;
  /** Privée emballée, base64 `iv(12) ‖ ct+tag`. Opaque au serveur. */
  wrappedPrivateKey: string;
  /** Sel Argon2id, base64, 16 octets. */
  kdfSalt: string;
  /** Absent sur les enregistrements antérieurs au champ → hérité en LEGACY. */
  kdfScheme?: string;
}

/**
 * Schéma d'une clé stockée. L'ABSENCE du champ vaut LEGACY et non « courant » :
 * une clé écrite avant l'existence du champ a bien été emballée sous le mot de
 * passe du compte. Se tromper de sens ferait demander la mauvaise phrase, avec
 * un « phrase incorrecte » impossible à comprendre.
 */
export function custodySchemeOf(key: Pick<CustodyKeyMaterial, 'kdfScheme'>): CustodyScheme {
  return key.kdfScheme === CUSTODY_SCHEME_PASSPHRASE
    ? CUSTODY_SCHEME_PASSPHRASE
    : CUSTODY_SCHEME_LEGACY;
}

// ── Codes d'erreur ──────────────────────────────────────────────────────
//
// Ce sont des CODES, pas des phrases : l'interface les traduit
// (`custodyUnlockErrorOf`), les tests les comparent, et ils sont les mêmes
// mots que le mobile et le site. Un message français ici obligerait chaque
// appelant à faire de la reconnaissance de chaîne traduite.

/** Erreur unique de lecture d'un sceau. */
export const ERR_SEAL_DECRYPT_FAILED = 'SEAL_DECRYPT_FAILED';

/** Erreur d'une clé X25519 de longueur invalide. */
export const ERR_INVALID_CUSTODY_KEY = 'INVALID_CUSTODY_KEY';

/** Erreur d'un emballage illisible (trop court, tronqué). */
export const ERR_CORRUPT_CUSTODY = 'CORRUPT_CUSTODY';

/** Erreur d'une phrase qui ne déverrouille pas. */
export const ERR_WRONG_PASSPHRASE = 'WRONG_PASSPHRASE';

// ── Encodages ───────────────────────────────────────────────────────────
//
// `btoa`/`atob` plutôt que `Buffer` : le renderer est un navigateur, et
// `sharing/custodySeal.ts` — l'autre moitié du même protocole — encode déjà
// ainsi. Deux encodeurs dans un même protocole, c'est un encodeur qui
// divergera.

export function bytesToBase64(data: Uint8Array): string {
  const CHUNK = 8192;
  let bin = '';
  for (let i = 0; i < data.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, data.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

export function bytesToBase64Url(data: Uint8Array): string {
  return bytesToBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Décode du base64 OU du base64url. Les deux formes circulent dans le MÊME
 * enregistrement (publique en url-safe, emballage en standard) : exiger la
 * bonne variante par champ n'ajouterait qu'un motif d'échec.
 */
export function base64ToBytes(input: string): Uint8Array {
  let s = input.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const pad = s.length % 4;
  if (pad === 2) s += '==';
  else if (pad === 3) s += '=';
  else if (pad === 1) throw new Error('Invalid base64 input');
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Disposition de l'emballage de la clé privée ─────────────────────────

export interface WrappedKeyParts {
  iv: Uint8Array;
  ciphertextWithTag: Uint8Array;
}

/** Assemble `iv(12) ‖ ct+tag` puis encode en base64 STANDARD. */
export function packWrappedKey(parts: WrappedKeyParts): string {
  const out = new Uint8Array(new ArrayBuffer(parts.iv.length + parts.ciphertextWithTag.length));
  out.set(parts.iv, 0);
  out.set(parts.ciphertextWithTag, parts.iv.length);
  return bytesToBase64(out);
}

/** Découpe un emballage. LÈVE `CORRUPT_CUSTODY` s'il est trop court. */
export function parseWrappedKey(wrappedBase64: string): WrappedKeyParts {
  let blob: Uint8Array;
  try {
    blob = base64ToBytes(wrappedBase64);
  } catch {
    throw new Error(ERR_CORRUPT_CUSTODY);
  }
  if (blob.length <= CUSTODY_IV_LENGTH) throw new Error(ERR_CORRUPT_CUSTODY);
  return {
    iv: blob.subarray(0, CUSTODY_IV_LENGTH),
    ciphertextWithTag: blob.subarray(CUSTODY_IV_LENGTH),
  };
}

// ── Validation d'un enregistrement serveur ──────────────────────────────

/**
 * Vrai si l'objet a la forme d'un enregistrement de clé exploitable.
 *
 * Une clé MAL FORMÉE est traitée comme ABSENTE plutôt que fatale : l'écran
 * doit pouvoir dire « ce compte n'a pas de coffre » sans tomber. Le bureau ne
 * sait de toute façon pas en créer une — c'est le site ou le mobile qui la
 * publie, et le premier écrit gagne côté worker.
 */
export function isCustodyKeyMaterial(value: unknown): value is CustodyKeyMaterial {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  if (
    typeof o.custodyPublicKey !== 'string' ||
    typeof o.wrappedPrivateKey !== 'string' ||
    typeof o.kdfSalt !== 'string'
  ) {
    return false;
  }
  if (o.custodyPublicKey.length === 0 || o.wrappedPrivateKey.length === 0) return false;
  // La publique DOIT faire 32 octets : c'est la seule des trois valeurs dont
  // la longueur est connue d'avance, et une publique tronquée produirait des
  // sceaux que personne n'ouvrirait jamais.
  try {
    if (base64ToBytes(o.custodyPublicKey).length !== X25519_KEY_LENGTH) return false;
  } catch {
    return false;
  }
  return true;
}
