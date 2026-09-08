/**
 * gen-machine-container-v3-vectors.mjs — Génère `test-vectors/machine-container-v3.json`.
 *
 * ═══ LE CONTRAT QUE CE SCRIPT INCARNE (gelé le 2026-09-05, fiche
 *     `.filarr-parity/ledger/2026-09-05-conteneur-machine-v3-hkdf.md`) ═══
 *
 * Conteneur « clé machine » version 3 — même disposition que `v2:`, seule la
 * dérivation change :
 *
 *   texte    : "v3:" + hex(sel 16 o) + hex(IV 16 o) + hex(chiffré) + hex(tag 16 o)
 *   binaire  : "v3:" || sel(16) || IV(16) || chiffré || tag(16)
 *   clé      : HKDF-SHA-256(ikm = clé machine (32 o), salt = sel, info = "filarr-container-v3", L = 32)
 *   chiffre  : AES-256-GCM, IV 16 octets, tag 16 octets, AUCUNE donnée additionnelle (AAD)
 *   clair    : JSON en UTF-8 (texte) ou octets bruts (binaire)
 *
 * La clé machine est celle que le manifeste transporte déjà (`encryptionKey`,
 * base64) : rien de nouveau ne voyage. `v2:` dérivait la même clé par
 * PBKDF2-SHA-512 à 600 000 tours — 265 ms par fichier pour une clé qui est déjà
 * aléatoire, donc pour rien. HKDF coûte quelques microsecondes.
 *
 * Pourquoi 16 octets d'IV et pas 12 : la disposition reste celle de `v2:`,
 * donc chaque lecteur (bureau, web, mobile) ne change QUE la branche de
 * dérivation. AES-GCM accepte un IV de 16 octets sur les trois plateformes.
 *
 * Pourquoi pas d'AAD : un `v2:` relabellisé `v3:` dérive une autre clé et
 * échoue au tag, et réciproquement — le marqueur est déjà lié par la
 * dérivation. Une AAD serait une source de divergence de plus entre trois
 * implémentations, sans gain.
 *
 * Les vecteurs sont DÉTERMINISTES (sel et IV fixés) : chaque surface doit
 * reproduire le conteneur À L'OCTET, pas seulement le déchiffrer.
 *
 *   node scripts/gen-machine-container-v3-vectors.mjs
 */
import { createCipheriv, hkdfSync, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'v3:';
const INFO = 'filarr-container-v3';

const hex = (b) => Buffer.from(b).toString('hex');
const fromHex = (h) => Buffer.from(h, 'hex');

/** Clé machine de test : SHA-256 d'une phrase, pour être reproductible sans être triviale. */
const machineKey = createHash('sha256').update('filarr machine key — vecteurs v3 — 2026-09-05').digest();

function derive(salt) {
  return Buffer.from(hkdfSync('sha256', machineKey, salt, INFO, 32));
}

function sealBytes(plain, salt, iv) {
  const key = derive(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { key, ct, tag, binary: Buffer.concat([Buffer.from(MARKER, 'utf8'), salt, iv, ct, tag]) };
}

function sealText(json, salt, iv) {
  const { key, ct, tag } = sealBytes(Buffer.from(json, 'utf8'), salt, iv);
  return { key, text: MARKER + hex(salt) + hex(iv) + hex(ct) + hex(tag) };
}

const salt1 = fromHex('000102030405060708090a0b0c0d0e0f');
const iv1 = fromHex('101112131415161718191a1b1c1d1e1f');
const json1 = JSON.stringify({ filarr: 'conteneur v3', n: 1, accents: 'été — « guillemets »' });
const t1 = sealText(json1, salt1, iv1);

const salt2 = fromHex('ffeeddccbbaa99887766554433221100');
const iv2 = fromHex('0f0e0d0c0b0a09080706050403020100');
const bytes2 = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff));
const b2 = sealBytes(bytes2, salt2, iv2);

const vide = sealText('{}', salt1, iv2);

const out = {
  format: 'filarr-machine-container-v3-vectors',
  version: 1,
  generatedBy: 'scripts/gen-machine-container-v3-vectors.mjs',
  contract: {
    marker: MARKER,
    text: 'marker + hex(salt16) + hex(iv16) + hex(ciphertext) + hex(tag16)',
    binary: 'marker || salt16 || iv16 || ciphertext || tag16',
    kdf: 'HKDF-SHA-256(ikm = machine key 32 bytes, salt = salt16, info = "filarr-container-v3", L = 32)',
    cipher: 'AES-256-GCM, iv 16 bytes, tag 16 bytes, no AAD',
    plaintext: 'UTF-8 JSON (text) or raw bytes (binary)',
  },
  machineKeyHex: hex(machineKey),
  info: INFO,
  vectors: [
    {
      name: 'texte json',
      kind: 'text',
      saltHex: hex(salt1),
      ivHex: hex(iv1),
      derivedKeyHex: hex(t1.key),
      plaintext: json1,
      container: t1.text,
      conformance: 'bytes',
    },
    {
      name: 'binaire 64 octets',
      kind: 'binary',
      saltHex: hex(salt2),
      ivHex: hex(iv2),
      derivedKeyHex: hex(b2.key),
      plaintextHex: hex(bytes2),
      containerHex: hex(b2.binary),
      conformance: 'bytes',
    },
    {
      name: 'texte json vide',
      kind: 'text',
      saltHex: hex(salt1),
      ivHex: hex(iv2),
      derivedKeyHex: hex(vide.key),
      plaintext: '{}',
      container: vide.text,
      conformance: 'bytes',
    },
  ],
  negatives: [
    {
      name: 'v3 relabellisé v2 — la dérivation PBKDF2 donne une autre clé, le tag échoue',
      container: 'v2:' + t1.text.slice(3),
      expect: 'reject',
    },
    {
      name: 'tag altéré (dernier octet)',
      container: t1.text.slice(0, -2) + (t1.text.endsWith('00') ? '01' : '00'),
      expect: 'reject',
    },
    {
      name: 'trop court',
      container: MARKER + hex(salt1) + hex(iv1),
      expect: 'reject',
    },
  ],
};

mkdirSync(join(ROOT, 'test-vectors'), { recursive: true });
const file = join(ROOT, 'test-vectors', 'machine-container-v3.json');
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`écrit ${file} — ${out.vectors.length} vecteurs, ${out.negatives.length} négatifs`);
