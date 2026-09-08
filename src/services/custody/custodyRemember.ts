/**
 * « Se souvenir de ce coffre sur cet appareil » — côté renderer.
 *
 * La règle de `custodySession` est nette : la privée de garde ne quitte jamais
 * la mémoire du processus. Ce module est son UNIQUE exception, et elle est
 * choisie — jamais un défaut.
 *
 * POURQUOI L'EXCEPTION EXISTE. L'argument « redemander la phrase entretient le
 * secret » tient tant que le déverrouillage est RARE. Il cesse de tenir quand
 * la liste des partages a besoin de la privée pour afficher un simple nom :
 * l'issue observée n'est pas « l'utilisateur retient mieux sa phrase », c'est
 * « l'utilisateur colle sa phrase dans un fichier texte ». On aurait alors le
 * pire des deux — la friction ET le secret mal rangé.
 *
 * OÙ VONT LES OCTETS. Dans le processus principal, chiffrés par le
 * `safeStorage` d'Electron (DPAPI / Keychain / libsecret), à côté des jetons
 * d'accès et sous le même domaine de profil. Le compromis complet est écrit
 * dans l'en-tête de `electron/custodyService.ts` — il n'a pas à être répété
 * ici, mais il doit être LU avant de toucher à ce module.
 *
 * CE QUE CE MODULE NE FAIT PAS : demander quoi que ce soit. Aucune biométrie
 * (le bureau n'en a pas de portable), aucune confirmation implicite. La seule
 * porte est la case à cocher de l'écran de déverrouillage, et le seul retour en
 * arrière est `forgetRememberedCustody`, que les réglages exposent.
 */

import { base64ToBytes, bytesToBase64, type CustodyKeyMaterial } from './custodyFormat';
import { setCustodyUnlocked } from './custodySession';

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function bridge(): Bridge | null {
  return window.electron?.ipcRenderer ?? null;
}

export interface RememberStatus {
  /** Vrai quand la machine sait chiffrer au repos : sinon, ne PAS offrir l'option. */
  available: boolean;
  /** Vrai quand une mémoire non échue existe. */
  remembered: boolean;
  /** Échéance du consentement (epoch ms), ou `null`. */
  expiresAt: number | null;
}

const UNAVAILABLE: RememberStatus = { available: false, remembered: false, expiresAt: null };

/**
 * État de l'option, sans jamais rendre la clé. Ne lève JAMAIS : c'est ce que lit
 * une case à cocher, et une case à cocher qui fait tomber l'écran des réglages
 * serait un prix absurde pour un confort.
 */
export async function rememberedCustodyStatus(): Promise<RememberStatus> {
  try {
    const ipc = bridge();
    if (!ipc) return UNAVAILABLE;
    const res = (await ipc.invoke('custody:rememberStatus')) as
      | { success?: boolean; data?: Partial<RememberStatus> }
      | undefined;
    if (!res?.success || !res.data) return UNAVAILABLE;
    return {
      available: res.data.available === true,
      remembered: res.data.remembered === true,
      expiresAt: typeof res.data.expiresAt === 'number' ? res.data.expiresAt : null,
    };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Range la privée déverrouillée. Rend `false` sans lever : un échec de mémoire
 * ne doit pas transformer un déverrouillage RÉUSSI en erreur — la session en
 * mémoire est intacte, et c'est elle qui compte pour l'instant présent.
 */
export async function rememberCustody(
  key: CustodyKeyMaterial,
  privateKey: Uint8Array
): Promise<boolean> {
  try {
    const ipc = bridge();
    if (!ipc) return false;
    const res = (await ipc.invoke('custody:remember', {
      custodyPublicKey: key.custodyPublicKey,
      privateKeyBase64: bytesToBase64(privateKey),
    })) as { success?: boolean; data?: boolean } | undefined;
    return res?.success === true && res.data === true;
  } catch {
    return false;
  }
}

/** Efface la mémoire — bouton « oublier ». Ne lève jamais. */
export async function forgetRememberedCustody(): Promise<void> {
  try {
    await bridge()?.invoke('custody:forget');
  } catch {
    // Sans conséquence : l'entrée expire d'elle-même, et la garde d'identité
    // la refuse si le compte a changé entre-temps.
  }
}

export type RestoreCustodyOutcome =
  /** La session est déverrouillée en mémoire. */
  | { status: 'restored' }
  /** Aucune mémoire (ou échue) : parcours normal, demander la phrase. */
  | { status: 'absent' }
  /** La mémoire ne correspond plus à ce compte : elle a été détruite. */
  | { status: 'mismatch' };

/**
 * Restaure la privée et ouvre la session, pour la clé que le SERVEUR vient
 * d'annoncer — c'est elle qui fait autorité. Une mémoire d'une autre publique
 * n'ouvre plus rien : le principal la détruit et rend `mismatch`, que l'écran
 * traduit par « ce coffre a changé, ressaisissez votre phrase ».
 *
 * Ne lève jamais : au pire on retombe sur `absent`, c'est-à-dire sur la saisie
 * de la phrase, qui reste le chemin toujours disponible.
 */
export async function restoreRememberedCustody(
  key: CustodyKeyMaterial
): Promise<RestoreCustodyOutcome> {
  try {
    const ipc = bridge();
    if (!ipc) return { status: 'absent' };
    const res = (await ipc.invoke('custody:recall', key.custodyPublicKey)) as
      | { success?: boolean; data?: { status?: string; privateKeyBase64?: string } }
      | undefined;
    if (!res?.success || !res.data) return { status: 'absent' };
    if (res.data.status === 'mismatch') return { status: 'mismatch' };
    if (res.data.status !== 'restored' || typeof res.data.privateKeyBase64 !== 'string') {
      return { status: 'absent' };
    }
    const priv = base64ToBytes(res.data.privateKeyBase64);
    // Une privée de mauvaise longueur n'ouvrirait rien et ferait échouer chaque
    // sceau en silence : mieux vaut retomber sur la saisie de la phrase.
    if (priv.length !== 32) return { status: 'absent' };
    setCustodyUnlocked(key, priv);
    return { status: 'restored' };
  } catch {
    return { status: 'absent' };
  }
}
