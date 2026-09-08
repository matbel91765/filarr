/**
 * Argon2id de la clé de garde — la SEULE primitive que le renderer ne sait
 * pas faire lui-même.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN ALLER-RETOUR IPC PLUTÔT QU'UNE BIBLIOTHÈQUE
 * ════════════════════════════════════════════════════════════════════════
 * Tout le reste du protocole de garde tient dans ce que le renderer a déjà :
 * X25519 vient de `@noble/curves`, HKDF et AES-GCM de `crypto.subtle`.
 * Argon2, non — WebCrypto ne le connaît pas, et il n'existe pas de repli
 * acceptable (PBKDF2 dériverait une AUTRE KEK, donc une clé que ni le site ni
 * le mobile n'ouvriraient).
 *
 * Deux voies étaient possibles :
 *
 *   1. `hash-wasm`, ce que fait le SITE. Il n'est pas installé ici, et
 *      l'ajouter aux dépendances du bureau pour une seule dérivation
 *      ponctuelle ferait entrer un WASM dans le bundle du renderer.
 *   2. Le paquet natif `argon2`, DÉJÀ une dépendance du bureau et déjà exposé
 *      au renderer par `crypto:argon2Hash`/`Verify`/`DeriveKey`. Il vit dans
 *      le processus principal (N-API), et c'est très bien : la dérivation
 *      OWASP bloque son fil ~50 ms, ce qui gèlerait la fenêtre si elle
 *      tournait dans le renderer.
 *
 * On prend la seconde. Le canal ajouté est `crypto:argon2Raw` — RAW, avec les
 * paramètres passés EXPLICITEMENT, parce que `crypto:argon2DeriveKey` existant
 * est figé sur le profil du PIN local (m=65536, t=3, p=4) : le réutiliser
 * dériverait une KEK que personne d'autre ne reproduirait. Le partage d'un
 * canal dont le profil est implicite est exactement le piège que ce
 * commentaire ferme.
 *
 * CE QUI NE TRANSITE PAS. La phrase de récupération transite bien par l'IPC
 * vers le processus principal — inévitable, c'est lui qui tient Argon2 — mais
 * elle n'est ni journalisée, ni écrite, ni transmise au serveur ; le principal
 * rend la KEK et oublie tout. La clé PRIVÉE, elle, ne quitte JAMAIS le
 * renderer : le déballage AES-GCM se fait ici.
 */

import { base64ToBytes, bytesToBase64, CUSTODY_ARGON2_PARAMS } from './custodyFormat';

export interface Argon2idParams {
  /** Coût mémoire, en KiB. */
  m: number;
  /** Nombre de passes. */
  t: number;
  /** Parallélisme (toujours 1 — `hash-wasm` du site est mono-fil). */
  p: number;
}

export type CustodyArgon2Fn = (
  passphrase: string,
  salt: Uint8Array,
  params: Argon2idParams,
  outputLength: number
) => Promise<Uint8Array>;

/** Implémentation nominale : le paquet natif du processus principal. */
const ipcArgon2id: CustodyArgon2Fn = async (passphrase, salt, params, outputLength) => {
  const bridge = window.electron?.ipcRenderer;
  if (!bridge) throw new Error('ARGON2_UNAVAILABLE');
  const res = (await bridge.invoke('crypto:argon2Raw', {
    password: passphrase,
    saltBase64: bytesToBase64(salt),
    memoryCost: params.m,
    timeCost: params.t,
    parallelism: params.p,
    hashLength: outputLength,
  })) as { success?: boolean; data?: string; error?: string } | undefined;
  if (!res?.success || typeof res.data !== 'string') {
    throw new Error(res?.error || 'ARGON2_UNAVAILABLE');
  }
  return base64ToBytes(res.data);
};

let override: CustodyArgon2Fn | null = null;

/**
 * Substitue l'implémentation. RÉSERVÉ aux tests : sous vitest il n'y a ni
 * fenêtre ni pont IPC, et le vecteur croisé veut pouvoir injecter la KEK
 * attendue plutôt que payer 19 Mio de mémoire par assertion. Rend la
 * précédente, pour une restauration symétrique.
 */
export function setCustodyArgon2(fn: CustodyArgon2Fn | null): CustodyArgon2Fn | null {
  const previous = override;
  override = fn;
  return previous;
}

/**
 * Dérive la KEK. Les paramètres par défaut sont ceux du site : les changer
 * ORPHELINERAIT toutes les clés déjà publiées, puisque seul le SEL est stocké,
 * jamais le profil.
 */
export async function custodyArgon2id(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2idParams = CUSTODY_ARGON2_PARAMS,
  outputLength = 32
): Promise<Uint8Array> {
  const fn = override ?? ipcArgon2id;
  const derived = await fn(passphrase, salt, params, outputLength);
  if (derived.length !== outputLength) throw new Error('ARGON2_LENGTH_MISMATCH');
  return derived;
}

/**
 * Sonde de disponibilité. Le déverrouillage repose ENTIÈREMENT sur cette
 * primitive : mieux vaut le découvrir avant d'offrir un champ de saisie que
 * pendant l'appui sur « Déverrouiller ».
 *
 * Profil minuscule à dessein — la sonde doit coûter des microsecondes, pas les
 * 19 Mio du vrai profil, car l'écran la déclenche au montage.
 */
export async function isCustodyArgon2Available(): Promise<boolean> {
  if (override !== null) return true;
  try {
    const probe = await ipcArgon2id('probe', new Uint8Array(16), { m: 8, t: 1, p: 1 }, 32);
    return probe.length === 32;
  } catch {
    return false;
  }
}
