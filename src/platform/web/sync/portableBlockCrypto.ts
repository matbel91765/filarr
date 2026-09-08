/**
 * portableBlockCrypto.ts — Chiffrement et déchiffrement d'un bloc delta v2.
 * PORTABLE : bureau, application web, mobile.
 *
 * Lot 8 du chantier synchronisation. Le chemin de lecture des fichiers delta
 * doit exister sur les trois surfaces — c'est la rupture qu'on répare : un
 * fichier de plus de 64 Mio téléversé depuis le bureau n'est aujourd'hui
 * lisible ni sur le web ni sur le téléphone.
 *
 * ── WEBCRYPTO ICI ET SUR LE WEB — PAS SUR MOBILE ─────────────────────────────
 * `crypto.subtle` existe dans Node 18+ et dans tous les navigateurs modernes.
 * Il n'existe PAS dans le depot mobile : rien n'y installe de polyfill et Hermes
 * n'en fournit pas (verifie par la session mobile, qui n'a meme pas
 * `TextDecoder` sans polyfill maison). Le mobile passe donc par son
 * `CryptoProvider` (react-native-quick-crypto).
 *
 * Ce qui est impose n'est donc pas l'API mais le RESULTAT : AES-256-GCM, l'AAD
 * decrite ci-dessous, et les vecteurs croises de `test-vectors/delta-v2.json`.
 * Ce module est l'implementation du bureau et de l'app web ; le mobile a la
 * sienne, et les trois se verifient sur les memes octets.
 *
 * Pas de `node:crypto`, pas de `Buffer`, pas de types du DOM. Le jumeau bureau
 * `deltaChunkCrypto.ts` reste en place pour le chemin d'ECRITURE synchrone
 * existant.
 *
 * ── CE QUI EST AUTHENTIFIÉ ───────────────────────────────────────────────────
 * L'AAD lie : le magic de format, l'octet d'en-tête ENTIER (donc la version ET
 * le bit de compression), le fileId, un index CONSTANT, le hachage du clair et
 * la taille du clair. Conséquences, toutes voulues :
 *   - on ne peut pas recoller un bloc dans un autre fichier ;
 *   - on ne peut pas substituer un contenu ;
 *   - on ne peut pas tronquer ;
 *   - on ne peut pas retourner le bit de compression depuis le serveur ;
 *   - mais on PEUT référencer le même bloc à plusieurs positions, et le
 *     déplacer d'une version à l'autre sans le réécrire. C'est la déduplication.
 *
 * ── DOUBLE VÉRIFICATION APRÈS DÉCHIFFREMENT ──────────────────────────────────
 * Le tag GCM prouve que les octets sont ceux qu'on a écrits sous cette clé et
 * cet AAD. Il ne prouve PAS que le bloc est celui que le manifeste attend à
 * cette position — l'AAD ne porte pas la position, précisément pour permettre
 * la déduplication. On réaffirme donc, après coup, que
 * `SHA-256(clair) === blocks[i].h`. C'est ce qui referme le trou que l'index
 * constant ouvre volontairement.
 */

import {
  AAD_CONSTANT_INDEX,
  BLOCK_FORMAT_V2,
  ERR_CORRUPT,
  KEY_SIZE,
  NONCE_SIZE,
  TAG_SIZE,
  buildAadV2,
  bytesToHex,
  encodeHeader,
  frameBlockV2,
  parseBlockV2,
  type AadInput,
} from './blockFormat';
import { decodePayload, maybeCompress } from './blockCodec';

/**
 * Le sous-ensemble de WebCrypto dont ce module a besoin, decrit
 * STRUCTURELLEMENT et non par les types du DOM.
 *
 * `SubtleCrypto`, `Crypto` et `CryptoKey` ne sont des TYPES que si la
 * bibliotheque DOM est chargee. Le tsconfig du processus principal ne la charge
 * pas — et le mobile ne la chargera pas davantage. S y appuyer ferait echouer
 * la compilation la ou ce module est justement cense etre recopie.
 */
type CryptoKeyLike = unknown;

interface SubtleLike {
  importKey(
    format: 'raw',
    keyData: ArrayBuffer,
    algorithm: { name: string },
    extractable: boolean,
    usages: string[]
  ): Promise<CryptoKeyLike>;
  encrypt(
    algorithm: { name: string; iv: ArrayBuffer; additionalData: ArrayBuffer; tagLength: number },
    key: CryptoKeyLike,
    data: ArrayBuffer
  ): Promise<ArrayBuffer>;
  decrypt(
    algorithm: { name: string; iv: ArrayBuffer; additionalData: ArrayBuffer; tagLength: number },
    key: CryptoKeyLike,
    data: ArrayBuffer
  ): Promise<ArrayBuffer>;
  digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer>;
}

interface CryptoLike {
  subtle?: SubtleLike;
  getRandomValues?<T extends Uint8Array>(array: T): T;
}

function subtleOf(): SubtleLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c || !c.subtle) {
    // Message explicite : sur une plateforme sans WebCrypto, l'échec doit
    // désigner la plateforme, pas ressembler à une donnée corrompue.
    throw new Error('portableBlockCrypto: WebCrypto (crypto.subtle) indisponible sur cette plateforme');
  }
  return c.subtle;
}

function randomNonce(): Uint8Array {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('portableBlockCrypto: crypto.getRandomValues indisponible sur cette plateforme');
  }
  return c.getRandomValues(new Uint8Array(NONCE_SIZE));
}

/** SHA-256 hexadécimal minuscule — l'adresse de contenu d'un bloc. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await subtleOf().digest('SHA-256', toBufferSource(bytes));
  return bytesToHex(new Uint8Array(digest));
}

/**
 * WebCrypto veut un `ArrayBuffer` ou une vue. Une `Uint8Array` issue d'un
 * `subarray` porte un décalage : la passer telle quelle marche, mais la
 * recopier quand elle ne couvre pas tout son tampon évite une classe entière
 * de bogues de décalage silencieux selon l'implémentation.
 */
function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKeyLike> {
  if (raw.length !== KEY_SIZE) {
    throw new Error(`portableBlockCrypto: cle de ${KEY_SIZE} octets requise`);
  }
  return subtleOf().importKey('raw', toBufferSource(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export interface EncryptOptions {
  /**
   * Nonce imposé. RÉSERVÉ AUX VECTEURS DE TEST.
   *
   * En production le nonce est tiré au hasard à chaque chiffrement : deux
   * appels sur le même clair produisent deux objets différents, ce qui est
   * voulu. Les vecteurs croisés, eux, ont besoin d'un résultat reproductible
   * octet pour octet pour que trois plateformes puissent se comparer.
   *
   * ⚠ Réutiliser un nonce sous la même clé casse AES-GCM. Ne jamais passer ce
   * paramètre depuis du code de production.
   */
  nonce?: Uint8Array;
}

export interface EncryptedBlock {
  /** L'objet stocké : `flags || nonce || chiffre || tag`. */
  blob: Uint8Array;
  /** SHA-256 du CLAIR — l'adresse de contenu, jamais celle du compressé. */
  hash: string;
  /** Taille du clair, avant compression. */
  plaintextSize: number;
  /** Taille réelle de l'objet stocké, à écrire dans `blocks[].e` du manifeste. */
  storedSize: number;
  /** Le clair a-t-il été compressé ? Reporté dans le bit 4 de l'en-tête. */
  compressed: boolean;
}

/**
 * Chiffre un bloc de clair en objet stocké v2.
 *
 * L'ordre est imposé : hacher le CLAIR, puis compresser, puis chiffrer. Hacher
 * après compression donnerait une adresse de contenu qui dépend du codec — deux
 * surfaces avec des réglages différents ne dédupliqueraient plus, en silence.
 */
export async function encryptBlockV2(
  key: Uint8Array,
  fileId: string,
  plain: Uint8Array,
  options: EncryptOptions = {}
): Promise<EncryptedBlock> {
  const hash = await sha256Hex(plain);
  const { payload, compressed } = await maybeCompress(plain);
  const headerByte = encodeHeader({ version: BLOCK_FORMAT_V2, compressed });
  const aad: AadInput = { fileId, plaintextHash: hash, plaintextSize: plain.length };
  const aadBytes = buildAadV2(aad, headerByte);

  const nonce = options.nonce ?? randomNonce();
  if (nonce.length !== NONCE_SIZE) throw new Error(ERR_CORRUPT);

  const cryptoKey = await importAesKey(key);
  const sealed = new Uint8Array(
    await subtleOf().encrypt(
      { name: 'AES-GCM', iv: toBufferSource(nonce), additionalData: toBufferSource(aadBytes), tagLength: TAG_SIZE * 8 },
      cryptoKey,
      toBufferSource(payload)
    )
  );

  const blob = frameBlockV2(headerByte, nonce, sealed);
  return { blob, hash, plaintextSize: plain.length, storedSize: blob.length, compressed };
}

export interface DecryptExpectation {
  /** `blocks[i].h` du manifeste — le contenu attendu à cette position. */
  hash: string;
  /** `blocks[i].s` du manifeste — la taille du clair attendue. */
  plaintextSize: number;
}

/**
 * Déchiffre un objet stocké v2 et rend le clair.
 *
 * Trois barrières, dans cet ordre :
 *   1. l'en-tête est valide (version connue, aucun bit réservé allumé) ;
 *   2. le tag GCM vérifie l'AAD — donc le fichier, le contenu attendu, la
 *      taille et le bit de compression ;
 *   3. le clair obtenu re-hache bien vers `expected.hash`.
 *
 * La troisième n'est pas redondante : l'AAD ne lie pas la POSITION du bloc,
 * pour permettre la déduplication. Sans ce contrôle final, un serveur pourrait
 * servir un bloc légitime du même fichier à la mauvaise position, et le
 * fichier reconstitué serait faux sans qu'aucune vérification cryptographique
 * ne bronche.
 */
export async function decryptBlockV2(
  key: Uint8Array,
  fileId: string,
  blob: Uint8Array,
  expected: DecryptExpectation
): Promise<Uint8Array> {
  const parsed = parseBlockV2(blob);
  const aad: AadInput = {
    fileId,
    plaintextHash: expected.hash,
    plaintextSize: expected.plaintextSize,
  };
  const aadBytes = buildAadV2(aad, parsed.headerByte);

  const cryptoKey = await importAesKey(key);
  let payload: Uint8Array;
  try {
    payload = new Uint8Array(
      await subtleOf().decrypt(
        {
          name: 'AES-GCM',
          iv: toBufferSource(parsed.nonce),
          additionalData: toBufferSource(aadBytes),
          tagLength: TAG_SIZE * 8,
        },
        cryptoKey,
        toBufferSource(parsed.ciphertextAndTag)
      )
    );
  } catch {
    // WebCrypto ne dit jamais POURQUOI une vérification GCM échoue, et c'est
    // délibéré de sa part. On rend le message unique de la chaîne.
    throw new Error(ERR_CORRUPT);
  }

  const plain = await decodePayload(payload, parsed.header.compressed, expected.plaintextSize);

  const actual = await sha256Hex(plain);
  if (actual !== expected.hash) {
    throw new Error(ERR_CORRUPT);
  }
  return plain;
}

/** Exporté pour que les suites de conformité puissent l'affirmer explicitement. */
export const AAD_INDEX_USED = AAD_CONSTANT_INDEX;
