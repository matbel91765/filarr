/**
 * Clé de garde du compte — OPÉRATIONS du bureau.
 *
 * CE QUE LE BUREAU FAIT ICI, ET CE QU'IL NE FAIT PAS :
 *
 *   · DÉVERROUILLER (`unlockCustody`) — déballer la privée depuis la phrase de
 *     récupération. C'est la nouveauté : sans elle, aucun libellé scellé
 *     n'était lisible sur cette machine.
 *   · OUVRIR (`openSecret`, `openJson`) — lire un sceau avec cette privée.
 *   · SCELLER (`sealJson`) — déléguée à `sharing/custodySeal.ts`, qui la
 *     faisait déjà pour K_share. Sceller n'exige QUE la publique : un bureau
 *     verrouillé peut donc nommer un partage, même s'il ne saura relire le nom
 *     qu'au prochain déverrouillage. C'est ce qui fait converger les appareils.
 *
 * CE QU'IL NE FAIT PAS, ET C'EST DÉLIBÉRÉ : CRÉER une paire de garde, ni la
 * ré-emballer. `PUT /account/custody-key` n'écrase pas une clé existante
 * (`INSERT … ON CONFLICT DO NOTHING` côté worker) et répond quand même 200 :
 * un bureau qui « créerait » une clé sur un compte qui en a déjà une garderait
 * une privée qui n'ouvre RIEN, sans qu'aucune erreur ne le dise. La création
 * reste où elle est née — le site (`VaultDialog`) et le mobile
 * (`SendCustodyScreen`), qui portent l'écran d'avertissement qui va avec.
 * Le bureau, lui, ADOPTE la clé du compte.
 */

import { openSealedWithCustodyKey, sealToCustodyKey } from '../sharing/custodySeal';
import {
  base64ToBytes,
  CUSTODY_KEK_LENGTH,
  ERR_CORRUPT_CUSTODY,
  ERR_WRONG_PASSPHRASE,
  parseWrappedKey,
  X25519_KEY_LENGTH,
  type CustodyKeyMaterial,
} from './custodyFormat';
import { custodyArgon2id } from './custodyKdf';

function pin(u: Uint8Array): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(u.length));
  out.set(u);
  return out;
}

/**
 * Déverrouille la clé privée depuis le secret qui l'a emballée — la phrase de
 * récupération (`passphrase-v1`) ou, pour une clé héritée, le mot de passe du
 * compte (`account-password-v1`). La dérivation est IDENTIQUE ; seul le secret
 * change, ce qui est exactement pourquoi une clé héritée s'ouvre sans changer
 * de paire.
 *
 * Rend les 32 octets BRUTS. LÈVE `WRONG_PASSPHRASE` sur échec d'étiquette —
 * jamais d'octets non authentifiés, et jamais de distinction entre « mauvaise
 * phrase » et « blob abîmé » : elle renseignerait un attaquant sans aider
 * personne.
 */
export async function unlockCustody(secret: string, key: CustodyKeyMaterial): Promise<Uint8Array> {
  let parts;
  try {
    parts = parseWrappedKey(key.wrappedPrivateKey);
  } catch {
    throw new Error(ERR_CORRUPT_CUSTODY);
  }
  let saltBytes: Uint8Array;
  try {
    saltBytes = base64ToBytes(key.kdfSalt);
  } catch {
    throw new Error(ERR_CORRUPT_CUSTODY);
  }
  const kek = await custodyArgon2id(secret, saltBytes, undefined, CUSTODY_KEK_LENGTH);
  let priv: Uint8Array;
  try {
    const kekKey = await crypto.subtle.importKey(
      'raw',
      pin(kek) as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    priv = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: pin(parts.iv) as BufferSource },
        kekKey,
        pin(parts.ciphertextWithTag) as BufferSource
      )
    );
  } catch {
    throw new Error(ERR_WRONG_PASSPHRASE);
  } finally {
    kek.fill(0);
  }
  if (priv.length !== X25519_KEY_LENGTH) {
    priv.fill(0);
    throw new Error(ERR_WRONG_PASSPHRASE);
  }
  return priv;
}

/** Ouvre un sceau avec la privée de garde. LÈVE `SEAL_DECRYPT_FAILED`. */
export async function openSecret(
  sealedBase64: string,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  return openSealedWithCustodyKey(sealedBase64, privateKey);
}

/** Scelle un objet JSON (libellé de partage) vers la publique de garde. */
export async function sealJson(value: unknown, custodyPublicKey: string): Promise<string> {
  return sealToCustodyKey(new TextEncoder().encode(JSON.stringify(value)), custodyPublicKey);
}

/**
 * Ouvre un sceau JSON. Rend `null` plutôt que de lever quand le sceau n'est
 * pas lisible ou ne porte pas du JSON : un libellé illisible — typiquement
 * scellé sous une clé de garde ANTÉRIEURE, après recréation du coffre — ne
 * doit pas emporter la ligne entière de la liste.
 */
export async function openJson<T>(sealedBase64: string, privateKey: Uint8Array): Promise<T | null> {
  try {
    const plain = await openSecret(sealedBase64, privateKey);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
