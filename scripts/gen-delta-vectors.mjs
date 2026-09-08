/**
 * gen-delta-vectors.mjs — Génère `test-vectors/delta-v2.json`.
 *
 * Les vecteurs croisés du format de blocs delta v2. Trois surfaces les
 * rejouent : le bureau (`electron/sync/__tests__/deltaVectors.vitest.ts`),
 * l'application web, et le mobile. Une surface qui ne les rejoue pas est
 * réputée non conforme, quel que soit l'état de son code.
 *
 * ── LES ENTRÉES SONT DES RECETTES, PAS DES OCTETS ────────────────────────────
 * Un vecteur qui embarquerait 2 Mio de clair en base64 serait illisible, lourd
 * à versionner, et impossible à étendre. Chaque entrée est donc décrite par une
 * recette que n'importe quelle plateforme réimplémente en cinq lignes :
 *
 *   zeros:N            N octets nuls
 *   lcg:N:SEED         N octets d'un générateur congruentiel (voir ci-dessous)
 *   lcgHead:N:SEED     idem, précédé d'un octet 0x42 — le cas de l'insertion
 *   repeat:N:TEXTE     TEXTE en UTF-8, répété puis tronqué à N octets
 *
 * Le générateur congruentiel, à reproduire À L'IDENTIQUE :
 *   s = seed >>> 0
 *   pour chaque octet : s = (s * 1664525 + 1013904223) mod 2^32 ; octet = (s >>> 24) & 0xFF
 * La multiplication doit se faire sur 32 bits (en JavaScript : `Math.imul`),
 * sans quoi les octets divergent au-delà du 2^21e et le vecteur devient faux.
 *
 * Usage : node scripts/gen-delta-vectors.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Recettes ─────────────────────────────────────────────────────────────────

function lcg(n, seed) {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

function materialize(recipe) {
  const [kind, ...rest] = recipe.split(':');
  if (kind === 'zeros') return new Uint8Array(Number(rest[0]));
  if (kind === 'lcg') return lcg(Number(rest[0]), Number(rest[1]));
  if (kind === 'lcgHead') {
    const body = lcg(Number(rest[0]), Number(rest[1]));
    const out = new Uint8Array(body.length + 1);
    out[0] = 0x42;
    out.set(body, 1);
    return out;
  }
  if (kind === 'repeat') {
    const n = Number(rest[0]);
    const text = rest.slice(1).join(':');
    const unit = new TextEncoder().encode(text);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = unit[i % unit.length];
    return out;
  }
  throw new Error(`recette inconnue : ${recipe}`);
}

// ── FastCDC, réimplémenté ici volontairement ─────────────────────────────────
//
// On NE réutilise PAS `electron/sync/cdc.ts`. Un vecteur généré par le code
// qu'il vérifie ne vérifie rien : il enregistrerait un bogue au lieu de le
// signaler. Cette réimplémentation part de la spécification écrite dans la
// fiche de parité, et si les deux divergent, c'est exactement ce que le vecteur
// existe pour attraper.

const GEAR = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    t[i] = createHash('sha256').update(`filarr-gear-v1|${i}`, 'utf8').digest().readUInt32BE(0);
  }
  return t;
})();

const highMask = (bits) => (0xffffffff << (32 - bits)) >>> 0;

function boundaries(buf, p) {
  const strict = highMask(p.maskBits + p.normalization);
  const lenient = highMask(p.maskBits - p.normalization);
  const cuts = [];
  let start = 0;
  while (start < buf.length) {
    const remaining = buf.length - start;
    let len;
    if (remaining <= p.min) {
      len = remaining;
    } else {
      const hardEnd = Math.min(remaining, p.max);
      const strictEnd = Math.min(remaining, p.avg);
      let hash = 0;
      let i = p.min;
      len = hardEnd;
      let found = false;
      for (; i < strictEnd; i++) {
        hash = ((hash << 1) + GEAR[buf[start + i]]) >>> 0;
        if ((hash & strict) === 0) { len = i + 1; found = true; break; }
      }
      if (!found) {
        for (; i < hardEnd; i++) {
          hash = ((hash << 1) + GEAR[buf[start + i]]) >>> 0;
          if ((hash & lenient) === 0) { len = i + 1; found = true; break; }
        }
      }
    }
    start += len;
    cuts.push(start);
  }
  return cuts;
}

// ── Paramètres des vecteurs ──────────────────────────────────────────────────

const SMALL = { min: 64, avg: 256, max: 1024, maskBits: 8, normalization: 2 };
const PROD = { min: 262144, avg: 1048576, max: 4194304, maskBits: 20, normalization: 2 };

const CDC_CASES = [
  { id: 'zeros-petit', recipe: 'zeros:10000', params: 'small' },
  { id: 'lcg-petit', recipe: 'lcg:50000:11', params: 'small' },
  { id: 'lcg-insertion', recipe: 'lcgHead:50000:11', params: 'small' },
  { id: 'texte-repetitif', recipe: 'repeat:40000:Filarr chiffre vos notes. ', params: 'small' },
  { id: 'sous-le-minimum', recipe: 'lcg:63:3', params: 'small' },
  { id: 'exactement-le-minimum', recipe: 'lcg:64:3', params: 'small' },
  { id: 'vide', recipe: 'zeros:0', params: 'small' },
  { id: 'production-2Mio', recipe: 'lcg:2097152:97', params: 'prod' },
];

// ── Blocs chiffrés ───────────────────────────────────────────────────────────

const hex = (b) => Buffer.from(b).toString('hex');
const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
const NONCE = Uint8Array.from({ length: 12 }, (_, i) => (i * 3 + 1) & 0xff);

async function deflateRaw(input) {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(input);
  w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

function buildAadV2(fileId, headerByte, hashHex, plaintextSize) {
  const magic = new TextEncoder().encode('FILRDLT5');
  const fid = new TextEncoder().encode(fileId);
  const hash = Buffer.from(hashHex, 'hex');
  const out = new Uint8Array(magic.length + 1 + 2 + fid.length + 4 + 32 + 4);
  const view = new DataView(out.buffer);
  let o = 0;
  out.set(magic, o); o += magic.length;
  out[o] = headerByte; o += 1;
  view.setUint16(o, fid.length, false); o += 2;
  out.set(fid, o); o += fid.length;
  view.setUint32(o, 0, false); o += 4; // index CONSTANT
  out.set(hash, o); o += 32;
  view.setUint32(o, plaintextSize, false);
  return out;
}

async function encryptCase({ id, recipe, fileId, forceNoCompress }) {
  const plain = materialize(recipe);
  const hashHex = createHash('sha256').update(plain).digest('hex');

  let payload = plain;
  let compressed = false;
  if (!forceNoCompress && plain.length >= 128) {
    const cand = await deflateRaw(plain);
    if (cand.length < Math.floor(plain.length * 0.95)) {
      payload = cand;
      compressed = true;
    }
  }
  const headerByte = 2 | (compressed ? 0x10 : 0);
  const aad = buildAadV2(fileId, headerByte, hashHex, plain.length);
  const key = await webcrypto.subtle.importKey('raw', KEY, { name: 'AES-GCM' }, false, ['encrypt']);
  const sealed = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv: NONCE, additionalData: aad, tagLength: 128 },
      key,
      payload
    )
  );
  const blob = new Uint8Array(1 + NONCE.length + sealed.length);
  blob[0] = headerByte;
  blob.set(NONCE, 1);
  blob.set(sealed, 1 + NONCE.length);

  return {
    id,
    recipe,
    fileId,
    plaintextHash: hashHex,
    plaintextSize: plain.length,
    compressed,
    headerByte,
    storedSize: blob.length,
    blobHex: hex(blob),
    /**
     * CE QUI EST OPPOSABLE POUR CE BLOC.
     *
     * 'bytes'   — le bloc n'est pas compresse : toute surface conforme doit
     *             reproduire `blobHex` OCTET POUR OCTET (a nonce impose), et
     *             doit aussi savoir le dechiffrer.
     * 'decrypt' — le bloc est compresse : seul le DECHIFFREMENT est opposable.
     *             La RFC 1951 specifie le DECODEUR, pas l'encodeur : le
     *             decoupage en blocs et le choix des arbres de Huffman sont
     *             libres, donc deux compresseurs conformes produisent deux
     *             encodages valides et differents du meme clair. Mesure : le
     *             meme clair rend 70 octets au niveau 1 et 53 au niveau 6 ;
     *             65 536 zeros rendent 78 octets via les flux et 79 via fflate.
     *             Exiger l'egalite binaire ici ferait echouer une surface
     *             PARFAITEMENT conforme.
     */
    conformance: compressed ? 'decrypt' : 'bytes',
  };
}

// ── Assemblage ───────────────────────────────────────────────────────────────

const vectors = {
  format: 'filarr-delta-vectors',
  version: 1,
  generatedBy: 'scripts/gen-delta-vectors.mjs',
  note:
    "Vecteurs croises du format de blocs delta v2. Les entrees sont des RECETTES : " +
    "voir l'en-tete du script generateur pour les reimplementer. Ne pas editer a la main. " +
    "Chaque bloc porte un champ `conformance` : 'bytes' = reproductible octet pour octet, " +
    "'decrypt' = seul le dechiffrement est opposable (encodeur DEFLATE non deterministe).",
  gear: {
    name: 'filarr-gear-v1',
    derivation: 'GEAR[i] = 4 premiers octets gros-boutistes de SHA-256("filarr-gear-v1|" + i)',
    width: 32,
    sample: { 0: GEAR[0], 1: GEAR[1], 255: GEAR[255] },
  },
  cdcParams: { small: SMALL, prod: PROD },
  cdc: CDC_CASES.map((c) => {
    const buf = materialize(c.recipe);
    return {
      ...c,
      inputSize: buf.length,
      cuts: boundaries(buf, c.params === 'prod' ? PROD : SMALL),
    };
  }),
  blockKeyHex: hex(KEY),
  blockNonceHex: hex(NONCE),
  blocks: [],
  rejects: [
    { id: 'bit-reserve-0x20', mutate: 'header|=0x20', expect: 'refus' },
    { id: 'bit-reserve-0x40', mutate: 'header|=0x40', expect: 'refus' },
    { id: 'bit-reserve-0x80', mutate: 'header|=0x80', expect: 'refus' },
    { id: 'version-inconnue', mutate: 'header=(header&0xF0)|3', expect: 'refus' },
    { id: 'bit-compression-retourne', mutate: 'header^=0x10', expect: 'refus' },
    { id: 'octet-chiffre-modifie', mutate: 'blob[20]^=0x01', expect: 'refus' },
    { id: 'tronque', mutate: 'blob=blob.slice(0,-1)', expect: 'refus' },
    { id: 'mauvais-fileId', mutate: "fileId='autre'", expect: 'refus' },
    { id: 'mauvaise-taille-clair', mutate: 'plaintextSize-=1', expect: 'refus' },
  ],
};

const BLOCK_CASES = [
  { id: 'compressible', recipe: 'repeat:4000:Compte rendu de reunion. ', fileId: 'fichier-1' },
  { id: 'incompressible', recipe: 'lcg:4000:5', fileId: 'fichier-1' },
  { id: 'sous-le-seuil-de-compression', recipe: 'repeat:100:abc', fileId: 'fichier-1' },
  { id: 'vide', recipe: 'zeros:0', fileId: 'fichier-1' },
  { id: 'zeros-tres-compressible', recipe: 'zeros:65536', fileId: 'fichier-1' },
  { id: 'fileId-non-ascii', recipe: 'repeat:2000:donnees ', fileId: 'dossier-éé/note' },
];

for (const c of BLOCK_CASES) {
  vectors.blocks.push(await encryptCase(c));
}

mkdirSync(join(ROOT, 'test-vectors'), { recursive: true });
const out = join(ROOT, 'test-vectors', 'delta-v2.json');
writeFileSync(out, `${JSON.stringify(vectors, null, 2)}\n`, 'utf8');

console.log(`ecrit : ${out}`);
console.log(`  ${vectors.cdc.length} cas de decoupage, ${vectors.blocks.length} blocs, ${vectors.rejects.length} refus`);
for (const c of vectors.cdc) {
  console.log(`  cdc/${c.id.padEnd(24)} ${String(c.inputSize).padStart(8)} octets -> ${c.cuts.length} blocs`);
}
for (const b of vectors.blocks) {
  console.log(`  bloc/${b.id.padEnd(23)} ${String(b.plaintextSize).padStart(8)} octets -> ${b.storedSize} stockes, compresse=${b.compressed}`);
}
