/**
 * Déchiffrement WebCrypto des CONTENEURS de synchronisation — palier M3.
 *
 * Trois formats distincts transitent par R2, tous relus ici avec les clés en
 * paramètre (fonctions pures, validées contre le pack de vecteurs dorés
 * `filarr-mobile/spec/golden-vectors.json`) :
 *
 *  1. MANIFESTE (`manifest.enc`) : marqueur ASCII 4 o (`fek:`/`fkz:`) ||
 *     IV(12) || AES-256-GCM sous la FEK BRUTE (pas de KDF, pas d'AAD).
 *     `fkz:` = clair passé par deflate (zlib) avant chiffrement.
 *
 *  2. CONTENEURS CLÉ MACHINE (`meta:{folderId}` → metadata.json,
 *     `meta:notes` → notes.enc) : préfixe 3 o `v2:`/`v1:`, PBKDF2-SHA-512
 *     (600k / 10k tours) sur les 32 OCTETS BRUTS de la clé machine (le
 *     manifeste la transporte en base64 : DÉCODER d'abord — piège documenté
 *     du pack), sel 16 o par objet, **IV de SEIZE octets** (pas 12 — l'autre
 *     piège documenté), AES-256-GCM sans AAD. Variante TEXTE (hex) pour le
 *     JSON, BINAIRE pour le contenu de fichier hérité.
 *
 *  3. BLOBS V3 (`FILARRENCV3\0`) : en-tête 50 o, fileKey =
 *     HKDF-SHA-256(FEK, salt, 'filarr-file-v3'), chunks AES-256-GCM
 *     indépendants (nonce = prefix||u32BE(i), AAD = magic||v||u64LE(size)||
 *     u32BE(i)), tag 16 o par chunk. Lecture whole-buffer (aperçus web) —
 *     le streaming OPFS viendra avec le cache local.
 */

import { deflate, inflate } from 'pako';

const FEK_MARKER = 'fek:';
const FKZ_MARKER = 'fkz:';
const MACHINE_IV_LENGTH = 16;
const MACHINE_SALT_LENGTH = 16;
const MACHINE_ITER_V2 = 600_000;
const MACHINE_ITER_V1 = 10_000;
/**
 * `v3:` — même disposition que `v2:`, clé dérivée par HKDF-SHA-256 (info
 * ci-dessous) au lieu de 600 000 tours de PBKDF2. Contrat gelé le 2026-09-05
 * (fiche conteneur-machine-v3-hkdf) ; vecteurs `test-vectors/machine-container-v3.json`.
 */
const MACHINE_V3_INFO = 'filarr-container-v3';

const V3_MAGIC = 'FILARRENCV3\0';
const V3_HEADER_SIZE = 50;
const V3_TAG_SIZE = 16;
const ERR_CORRUPT = 'Fichier chiffre corrompu - dechiffrement impossible';

const ascii = (s: string) => new TextEncoder().encode(s);

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

const hexToBytes = (h: string): Uint8Array =>
  new Uint8Array((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertextWithTag: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: iv as unknown as BufferSource,
    tagLength: 128,
    ...(aad ? { additionalData: aad as unknown as BufferSource } : {}),
  };
  const plain = await crypto.subtle.decrypt(
    params,
    key,
    ciphertextWithTag.buffer.slice(
      ciphertextWithTag.byteOffset,
      ciphertextWithTag.byteOffset + ciphertextWithTag.byteLength
    ) as ArrayBuffer
  );
  return new Uint8Array(plain);
}

// ── 1. Manifeste (fek:/fkz:) ────────────────────────────────────────────────

export function isFekContainer(bytes: Uint8Array): boolean {
  return startsWith(bytes, ascii(FEK_MARKER)) || startsWith(bytes, ascii(FKZ_MARKER));
}

export async function decryptFekContainer(
  bytes: Uint8Array,
  fekRaw: Uint8Array
): Promise<Uint8Array> {
  const compressed = startsWith(bytes, ascii(FKZ_MARKER));
  if (!compressed && !startsWith(bytes, ascii(FEK_MARKER))) {
    throw new Error('Conteneur manifeste invalide (marqueur absent)');
  }
  const iv = bytes.subarray(4, 16);
  const body = bytes.subarray(16);
  const key = await importAesKey(fekRaw);
  const payload = await aesGcmDecrypt(key, iv, body);
  return compressed ? inflate(payload) : payload;
}

/**
 * Côté ÉCRITURE du manifeste — même règle que le desktop
 * (storageService.ts:3110-3147) : deflate si ≥ 256 o ET si ça paie, marqueur
 * `fkz:` dans ce cas, sinon `fek:`.
 */
export async function encryptFekContainer(
  payload: Uint8Array,
  fekRaw: Uint8Array
): Promise<Uint8Array> {
  let body = payload;
  let marker = FEK_MARKER;
  if (payload.byteLength >= 256) {
    const compressed = deflate(payload);
    if (compressed.byteLength < payload.byteLength) {
      body = compressed;
      marker = FKZ_MARKER;
    }
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    'raw',
    fekRaw.buffer.slice(fekRaw.byteOffset, fekRaw.byteOffset + fekRaw.byteLength) as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
    )
  );
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(ascii(marker), 0);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

// ── 2. Conteneurs clé machine (v2:/v1:) ─────────────────────────────────────

async function deriveMachineKey(
  machineKeyRaw: Uint8Array,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    machineKeyRaw.buffer.slice(
      machineKeyRaw.byteOffset,
      machineKeyRaw.byteOffset + machineKeyRaw.byteLength
    ) as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-512',
    },
    base,
    256
  );
  return importAesKey(new Uint8Array(bits));
}

async function deriveMachineKeyV3(machineKeyRaw: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    machineKeyRaw.buffer.slice(
      machineKeyRaw.byteOffset,
      machineKeyRaw.byteOffset + machineKeyRaw.byteLength
    ) as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      info: ascii(MACHINE_V3_INFO) as unknown as BufferSource,
    },
    base,
    256
  );
  return importAesKey(new Uint8Array(bits));
}

async function decryptMachineHexV3(
  hexBody: string,
  machineKeyRaw: Uint8Array
): Promise<Uint8Array> {
  const bytes = hexToBytes(hexBody);
  const salt = bytes.subarray(0, MACHINE_SALT_LENGTH);
  const iv = bytes.subarray(MACHINE_SALT_LENGTH, MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH);
  const body = bytes.subarray(MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH);
  return aesGcmDecrypt(await deriveMachineKeyV3(machineKeyRaw, salt), iv, body);
}

async function decryptMachineHex(
  hexBody: string,
  machineKeyRaw: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const bytes = hexToBytes(hexBody);
  const salt = bytes.subarray(0, MACHINE_SALT_LENGTH);
  const iv = bytes.subarray(MACHINE_SALT_LENGTH, MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH);
  const body = bytes.subarray(MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH);
  const key = await deriveMachineKey(machineKeyRaw, salt, iterations);
  return aesGcmDecrypt(key, iv, body);
}

/**
 * Variante TEXTE (metadata.json, notes.enc) : chaîne ASCII `v2:`+hex.
 * Retourne l'objet JSON. Replis : `v1:` (10k tours) puis legacy sans marqueur.
 */
export async function decryptMachineContainerText(
  container: string,
  machineKeyRaw: Uint8Array
): Promise<unknown> {
  let plain: Uint8Array;
  if (container.startsWith('v3:')) {
    plain = await decryptMachineHexV3(container.slice(3), machineKeyRaw);
  } else if (container.startsWith('v2:')) {
    plain = await decryptMachineHex(container.slice(3), machineKeyRaw, MACHINE_ITER_V2);
  } else if (container.startsWith('v1:')) {
    plain = await decryptMachineHex(container.slice(3), machineKeyRaw, MACHINE_ITER_V1);
  } else {
    // Héritage sans marqueur : tenter v1 (le repli du desktop coûte deux
    // dérivations pour un échec — même contrat ici).
    try {
      plain = await decryptMachineHex(container, machineKeyRaw, MACHINE_ITER_V1);
    } catch {
      plain = await decryptMachineHex(container, machineKeyRaw, MACHINE_ITER_V2);
    }
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * Côté ÉCRITURE des conteneurs machine TEXTE (metadata.json poussé par le
 * web) : même format `v2:` + hex que storageService.encrypt(), pour que le
 * desktop relise nos métadonnées sans rien changer.
 */
export async function encryptMachineContainerText(
  value: unknown,
  machineKeyRaw: Uint8Array
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(MACHINE_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(MACHINE_IV_LENGTH)); // SEIZE octets
  const base = await crypto.subtle.importKey(
    'raw',
    machineKeyRaw.buffer.slice(
      machineKeyRaw.byteOffset,
      machineKeyRaw.byteOffset + machineKeyRaw.byteLength
    ) as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: MACHINE_ITER_V2,
      hash: 'SHA-512',
    },
    base,
    256
  );
  const key = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt']);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ctWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 },
      key,
      plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer
    )
  );
  const hex = (u: Uint8Array) =>
    Array.from(u)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  return 'v2:' + hex(salt) + hex(iv) + hex(ctWithTag);
}

/** Variante BINAIRE (contenu de fichier hérité) : `v2:` en octets || sel || IV(16) || ct || tag. */
export async function decryptMachineContainerBinary(
  bytes: Uint8Array,
  machineKeyRaw: Uint8Array
): Promise<Uint8Array> {
  let iterations: number | 'hkdf-v3' = MACHINE_ITER_V2;
  let offset = 3;
  if (startsWith(bytes, ascii('v3:'))) {
    iterations = 'hkdf-v3';
  } else if (startsWith(bytes, ascii('v2:'))) {
    iterations = MACHINE_ITER_V2;
  } else if (startsWith(bytes, ascii('v1:'))) {
    iterations = MACHINE_ITER_V1;
  } else {
    offset = 0;
    iterations = MACHINE_ITER_V1;
  }
  const salt = bytes.subarray(offset, offset + MACHINE_SALT_LENGTH);
  const iv = bytes.subarray(
    offset + MACHINE_SALT_LENGTH,
    offset + MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH
  );
  const body = bytes.subarray(offset + MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH);
  const key =
    iterations === 'hkdf-v3'
      ? await deriveMachineKeyV3(machineKeyRaw, salt)
      : await deriveMachineKey(machineKeyRaw, salt, iterations);
  return aesGcmDecrypt(key, iv, body);
}

export function isMachineBinaryContainer(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, ascii('v3:')) ||
    startsWith(bytes, ascii('v2:')) ||
    startsWith(bytes, ascii('v1:'))
  );
}

// ── 3. Blobs V3 (whole-buffer) ──────────────────────────────────────────────

export function isV3Container(bytes: Uint8Array): boolean {
  return startsWith(bytes, ascii(V3_MAGIC));
}

export async function decryptV3Buffer(bytes: Uint8Array, fekRaw: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < V3_HEADER_SIZE || !isV3Container(bytes)) throw new Error(ERR_CORRUPT);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(12);
  const reserved = view.getUint8(13);
  if (version !== 3 || reserved !== 0) throw new Error(ERR_CORRUPT);
  const chunkSize = view.getUint32(14, true);
  const origSize = Number(view.getBigUint64(18, true));
  const salt = bytes.subarray(26, 42);
  const noncePrefix = bytes.subarray(42, 50);

  // fileKey = HKDF-SHA-256(ikm = FEK, salt, info 'filarr-file-v3', 32 o)
  const ikm = await crypto.subtle.importKey(
    'raw',
    fekRaw.buffer.slice(fekRaw.byteOffset, fekRaw.byteOffset + fekRaw.byteLength) as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );
  const fileKeyBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      info: ascii('filarr-file-v3') as unknown as BufferSource,
    },
    ikm,
    256
  );
  const fileKey = await importAesKey(new Uint8Array(fileKeyBits));

  const out = new Uint8Array(origSize);
  let written = 0;
  let index = 0;
  let pos = V3_HEADER_SIZE;
  // Cas fichier vide : un chunk 0 octet (tag seul) authentifie l'en-tête.
  do {
    const remainingPlain = origSize - written;
    const plainLen = Math.min(chunkSize, remainingPlain);
    const encLen = plainLen + V3_TAG_SIZE;
    if (pos + encLen > bytes.length) throw new Error(ERR_CORRUPT);
    const nonce = new Uint8Array(12);
    nonce.set(noncePrefix, 0);
    new DataView(nonce.buffer).setUint32(8, index, false);
    const aad = new Uint8Array(25);
    aad.set(ascii(V3_MAGIC), 0);
    aad[12] = 3;
    new DataView(aad.buffer).setBigUint64(13, BigInt(origSize), true);
    new DataView(aad.buffer).setUint32(21, index, false);
    let plain: Uint8Array;
    try {
      plain = await aesGcmDecrypt(fileKey, nonce, bytes.subarray(pos, pos + encLen), aad);
    } catch {
      throw new Error(ERR_CORRUPT);
    }
    if (plain.length !== plainLen) throw new Error(ERR_CORRUPT);
    out.set(plain, written);
    written += plain.length;
    pos += encLen;
    index += 1;
  } while (written < origSize);
  if (pos !== bytes.length) throw new Error(ERR_CORRUPT);
  return out;
}
