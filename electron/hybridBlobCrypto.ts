/**
 * Renderer-format hybrid FEK blob decryption — main-process side.
 *
 * Hybrid (synced) profiles encrypt SMALL files RENDERER-side with the account
 * FEK via hybridCrypto.encryptFileContent (WebCrypto). Those blobs are neither
 * V3 containers nor machine-key V1/V2 blobs, so the main process could not
 * read them — which broke "Déplacer dans le coffre" verification for every
 * hybrid file under the streaming threshold (verify failed → original kept).
 *
 * On-disk layouts produced by the renderer (see encryptFileContent /
 * decryptFileContent in src/services/auth/hybridCrypto.ts):
 *   - V1 (marker 0x01): marker(1) || IV(12) || AES-256-GCM ciphertext+tag
 *   - V2 (marker 0x02): same, plaintext deflated (pako zlib stream) first
 *   - V0 (legacy, no marker): IV(12) || ciphertext+tag
 * WebCrypto appends the 16-byte GCM tag to the ciphertext; pako's default
 * deflate emits an RFC-1950 zlib stream, which Node's zlib.inflate reads.
 *
 * Detection mirrors the renderer exactly: try the marker interpretation when
 * byte 0 matches a known marker (a random V0 IV starts with 0x01/0x02 ~0.8%
 * of the time — GCM auth fails and we fall back to V0), then try V0.
 *
 * Pure Node module (no Electron imports) — unit-testable standalone.
 */

import * as crypto from 'crypto';
import * as zlib from 'zlib';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const FORMAT_V1_PLAIN = 0x01;
const FORMAT_V2_DEFLATE = 0x02;
const KEY_LENGTH = 32;

export const ERR_HYBRID_BLOB_UNREADABLE =
  'Fichier chiffre corrompu - dechiffrement impossible';

function gcmDecrypt(key: Buffer, iv: Buffer, ciphertextWithTag: Buffer): Buffer {
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - TAG_LENGTH);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv) as crypto.DecipherGCM;
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Decrypts a renderer-encrypted hybrid FEK blob with any of the candidate
 * 32-byte FEKs. Tries the tagged formats (V1 plain / V2 deflate) when the
 * first byte matches a marker, then legacy V0 — exactly the renderer's own
 * detection order. Throws ERR_HYBRID_BLOB_UNREADABLE when no candidate key
 * authenticates any layout (callers treat that as a failed verification and
 * PRESERVE the original file).
 */
export function decryptHybridFekBlob(blob: Buffer, candidateKeys: Buffer[]): Buffer {
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error(ERR_HYBRID_BLOB_UNREADABLE);
  }
  const keys = candidateKeys.filter((k) => Buffer.isBuffer(k) && k.length === KEY_LENGTH);

  const marker = blob[0];
  const attempts: Array<{ ivStart: number; deflated: boolean }> = [];
  if (marker === FORMAT_V1_PLAIN) attempts.push({ ivStart: 1, deflated: false });
  else if (marker === FORMAT_V2_DEFLATE) attempts.push({ ivStart: 1, deflated: true });
  attempts.push({ ivStart: 0, deflated: false }); // legacy V0 fallback

  for (const key of keys) {
    for (const attempt of attempts) {
      if (blob.length < attempt.ivStart + IV_LENGTH + TAG_LENGTH) continue;
      const iv = blob.subarray(attempt.ivStart, attempt.ivStart + IV_LENGTH);
      const body = blob.subarray(attempt.ivStart + IV_LENGTH);
      let plain: Buffer;
      try {
        plain = gcmDecrypt(key, iv, body);
      } catch {
        continue; // wrong key or wrong layout — next attempt
      }
      if (!attempt.deflated) return plain;
      try {
        return zlib.inflateSync(plain);
      } catch {
        // GCM authenticated but the payload is not a zlib stream — the blob
        // is a V0 whose random IV started with 0x02 AND whose decrypt
        // authenticated (practically impossible), or it is corrupt. Keep
        // trying the remaining layouts rather than returning wrong bytes.
        continue;
      }
    }
  }
  throw new Error(ERR_HYBRID_BLOB_UNREADABLE);
}

/**
 * Re-encrypts a plaintext buffer into the renderer's V1 layout
 * (marker 0x01 || IV(12) || AES-256-GCM ciphertext+tag).
 *
 * Existe pour « Publier ce coffre sur le compte » : un petit fichier de profil
 * hybride est scellé RENDERER-side dans ce format, et la migration doit le
 * rechiffrer sous la clé du compte SANS changer de format. Le convertir en
 * conteneur V3 le rendrait illisible par le renderer, qui décide du format sur
 * le premier octet — on aurait « migré » un fichier en le rendant inouvrable
 * par l'application elle-même.
 *
 * On écrit la variante NON déflatée : le renderer l'accepte (marqueur 0x01).
 * On renonce à la compression parce que ces blobs sont PETITS (sous le seuil du
 * streaming) et souvent dans des formats déjà compacts — l'économie éventuelle
 * ne vaut pas une variante de plus à maintenir dans le chemin de migration.
 */
export function encryptHybridFekBlobV1(plain: Buffer, key: Buffer): Buffer {
  if (key.length !== KEY_LENGTH) {
    throw new Error(ERR_HYBRID_BLOB_UNREADABLE);
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv) as crypto.CipherGCM;
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_V1_PLAIN]), iv, body, cipher.getAuthTag()]);
}
