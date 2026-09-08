/**
 * Scellement de K_share sur la clé de custody DU COMPTE.
 *
 * Pourquoi ce module existe
 * -------------------------
 * Un partage créé depuis l'app ne vivait que sur l'appareil créateur : sa
 * K_share n'existe nulle part ailleurs que dans son localStorage
 * (`filarr-shares-keys-v1`). Changement de machine, profil nettoyé, et le lien
 * — toujours vivant, toujours téléchargeable — devenait irrécupérable pour son
 * propre auteur, qui ne pouvait plus ni le repartager ni lire son nom.
 *
 * Filarr Send avait déjà résolu ça : à la création, K_share est scellée sur la
 * clé PUBLIQUE de custody du compte et stockée en `wrapped_secret`. Le serveur
 * n'en voit qu'un blob opaque ; seule la phrase de récupération — qui ne lui
 * est jamais transmise — l'ouvre, sur n'importe quel appareil. On applique le
 * même contrat aux partages de l'app.
 *
 * Compatibilité de format — la contrainte dure
 * --------------------------------------------
 * Le blob doit être ouvrable par `openSealedFileKey` du site
 * (src/lib/file-request-crypto.ts). C'est la MÊME construction que
 * `sealToPublicKey` de userKeypair.ts — X25519 éphémère × clé publique du
 * destinataire → HKDF-SHA-256 → AES-256-GCM, blob = ephPub(32)‖IV(12)‖ct — à
 * un détail près et un seul : le séparateur de domaine HKDF. Le coffre du site
 * utilise `filarr.filerequest.seal.v1` là où l'app utilise
 * `filarr.userkey.seal.v1`.
 *
 * On ne réutilise donc pas sealToPublicKey : sceller avec le mauvais
 * séparateur produirait un blob que le site accepterait de stocker et
 * n'ouvrirait jamais — exactement le piège silencieux que ce module existe
 * pour fermer. Le séparateur est ici en dur, et custodySeal.vitest.ts vérifie
 * le round-trip contre une réimplémentation fidèle du côté site.
 */

import { x25519 } from '@noble/curves/ed25519.js';

const IV_LENGTH = 12;
/** Doit rester identique à FR_SEAL_INFO du site. Ne pas « harmoniser ». */
const CUSTODY_SEAL_INFO = 'filarr.filerequest.seal.v1';

function pin(u: Uint8Array): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(u.length));
  out.set(u);
  return out;
}

function uint8ToBase64(data: Uint8Array): string {
  const CHUNK = 8192;
  let bin = '';
  for (let i = 0; i < data.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, data.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

function base64UrlToUint8(input: string): Uint8Array {
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

async function deriveSealKey(
  shared: Uint8Array,
  ephPub: Uint8Array,
  recipientPub: Uint8Array,
  usage: 'encrypt' | 'decrypt'
): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey('raw', pin(shared) as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  // Le sel lie la dérivation aux DEUX clés publiques (éphémère + destinataire).
  const salt = new Uint8Array(ephPub.length + recipientPub.length);
  salt.set(ephPub, 0);
  salt.set(recipientPub, ephPub.length);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode(CUSTODY_SEAL_INFO),
    },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

/**
 * Scelle un secret de 32 octets (K_share) sur la clé publique de custody
 * (base64url, 32 octets). Renvoie un blob base64 opaque pour le serveur.
 */
export async function sealToCustodyKey(
  secret: Uint8Array,
  custodyPublicKeyB64Url: string
): Promise<string> {
  const recipientPub = base64UrlToUint8(custodyPublicKeyB64Url);
  if (recipientPub.length !== 32) throw new Error('INVALID_CUSTODY_KEY');
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = pin(x25519.getPublicKey(ephPriv));
  const shared = pin(x25519.getSharedSecret(ephPriv, recipientPub));
  const key = await deriveSealKey(shared, ephPub, recipientPub, 'encrypt');
  const iv = new Uint8Array(new ArrayBuffer(IV_LENGTH));
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pin(secret) as BufferSource)
  );
  ephPriv.fill(0);
  const blob = new Uint8Array(ephPub.length + IV_LENGTH + ct.length);
  blob.set(ephPub, 0);
  blob.set(iv, ephPub.length);
  blob.set(ct, ephPub.length + IV_LENGTH);
  return uint8ToBase64(blob);
}

/**
 * Variante prenant K_share telle que la produit setupShareCrypto (base64url),
 * pour que l'appelant n'ait pas à trimballer son propre décodeur — un décodeur
 * en double est un décodeur qui divergera.
 */
export async function sealKShareToCustodyKey(
  kShareBase64Url: string,
  custodyPublicKeyB64Url: string
): Promise<string> {
  return sealToCustodyKey(base64UrlToUint8(kShareBase64Url), custodyPublicKeyB64Url);
}

/**
 * OUVRE un blob scellé, avec la clé PRIVÉE de custody (32 octets bruts).
 *
 * Pourquoi ici et pas dans un module à part : c'est la moitié manquante de
 * `sealToCustodyKey`, et les deux moitiés partagent `deriveSealKey`. Les
 * séparer signifierait deux copies du séparateur de domaine et du sel — deux
 * copies qui, un jour, divergeront. Le test de round-trip de ce fichier juge
 * les deux sens contre la réimplémentation du site.
 *
 * LA PUBLIQUE DU DESTINATAIRE EST RECALCULÉE depuis la privée, jamais lue dans
 * le blob : le sel du HKDF est `ephPub ‖ pubDestinataire`, et laisser un blob
 * hostile dicter la seconde moitié du sel reviendrait à lui laisser choisir la
 * dérivation. Le site (`openSealedFileKey`) fait exactement pareil.
 *
 * LÈVE `SEAL_DECRYPT_FAILED` sur TOUT échec — blob trop court, mauvaise clé,
 * étiquette invalide. Un sceau qui ne s'ouvre pas ne dit rien de plus, et
 * distinguer les causes ne renseignerait qu'un attaquant.
 */
export async function openSealedWithCustodyKey(
  sealedBase64: string,
  custodyPrivateKey: Uint8Array
): Promise<Uint8Array> {
  if (custodyPrivateKey.length !== 32) throw new Error('INVALID_CUSTODY_KEY');
  let blob: Uint8Array;
  try {
    blob = base64UrlToUint8(sealedBase64);
  } catch {
    throw new Error('SEAL_DECRYPT_FAILED');
  }
  // `<=` et non `<` : un blob réduit à l'en-tête ne porte même pas
  // d'étiquette. Même borne que le site.
  if (blob.length <= 32 + IV_LENGTH) throw new Error('SEAL_DECRYPT_FAILED');
  const ephPub = pin(blob.subarray(0, 32));
  const iv = pin(blob.subarray(32, 32 + IV_LENGTH));
  const ct = pin(blob.subarray(32 + IV_LENGTH));
  try {
    const priv = pin(custodyPrivateKey);
    const ownPub = pin(x25519.getPublicKey(priv));
    const shared = pin(x25519.getSharedSecret(priv, ephPub));
    const key = await deriveSealKey(shared, ephPub, ownPub, 'decrypt');
    shared.fill(0);
    priv.fill(0);
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ct as BufferSource
      )
    );
  } catch {
    throw new Error('SEAL_DECRYPT_FAILED');
  }
}
