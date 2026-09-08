#!/usr/bin/env node
/**
 * generate-golden-vectors.mjs — génère le pack de vecteurs dorés Filarr.
 *
 * OBJECTIF
 * --------
 * Produire un jeu de blobs chiffrés de référence (V0 / V1 / V2 / V3) que
 * TOUTES les plateformes (desktop, mobile) doivent savoir relire à l'octet
 * près. Ces vecteurs servent de contrat de format : si le mobile les rejoue
 * et retrouve les clairs attendus, son lecteur est compatible avec le coffre
 * desktop en production.
 *
 * RÈGLE FONDATRICE : LE CODE DE PRODUCTION EST LE SEUL GÉNÉRATEUR
 * ---------------------------------------------------------------
 * Aucun octet de ciphertext n'est fabriqué par ce script. Tous les blobs
 * sortent des modules de production du dépôt desktop, chargés tels quels :
 *
 *   - V1 / V2 : src/services/auth/hybridCrypto.ts  → encryptFileContent()
 *               (l'écrivain réel du renderer, WebCrypto + pako)
 *   - V3      : electron/streamCrypto.ts           → encryptBufferToFileV3()
 *               (l'écrivain réel du process main, node:crypto)
 *   - V0      : dérivé d'un V1 de production en RETIRANT le seul octet de
 *               marqueur (le marqueur n'entre ni dans l'IV ni dans l'AAD ;
 *               V0 = V1 moins son premier octet, par construction). Chaque
 *               blob V0 est ensuite REVALIDÉ par le lecteur de production
 *               (chemin de repli V0), donc rien n'est supposé.
 *   - MANIFESTES (section "manifests" du pack) :
 *               electron/storageService.ts → encryptWithFEK()
 *               (l'écrivain réel du manifeste de synchronisation :
 *               marqueur "fek:" / "fkz:", WebCrypto + zlib de node)
 *   - CONTENEURS CLÉ MACHINE (section "machineContainers" du pack) :
 *               electron/storageService.ts → encrypt()       (variante TEXTE,
 *               chaîne ASCII hexadécimale : {folderId}/metadata.json et
 *               notes.enc) et → encryptBinary() (variante BINAIRE, contenu de
 *               fichier de la voie tamponnée héritée). Famille "v2:" / "v1:" :
 *               PBKDF2-SHA512 où la CLÉ MACHINE sert de MOT DE PASSE.
 *
 * Chaque vecteur est vérifié par un aller-retour COMPLET avec les LECTEURS de
 * production avant d'entrer dans le pack :
 *   - electron/hybridBlobCrypto.ts → decryptHybridFekBlob()  (V0/V1/V2, Node)
 *   - src/services/auth/hybridCrypto.ts → decryptFileContent() (V0/V1/V2, WebCrypto)
 *   - electron/streamCrypto.ts → decryptFileToBufferV3() + statV3File() (V3)
 *   - electron/storageService.ts → decryptWithFEK() ET decryptManifestAuto()
 *     (manifestes ; decryptManifestAuto est le point d'entrée réellement
 *     appelé par electron/sync/syncService.ts au téléchargement)
 *   - electron/storageService.ts → decrypt() (variante TEXTE) et
 *     decryptBinary() (variante BINAIRE), instance NON modifiée, pour les
 *     conteneurs clé machine
 * Un cas qui ne fait pas ce tour complet fait ÉCHOUER le script : il n'entre
 * jamais dans le pack.
 *
 * CE QUI A DÛ ÊTRE ADAPTÉ (et pourquoi) — à lire avant de faire confiance
 * ----------------------------------------------------------------------
 * 1. ENTROPIE DÉTERMINISTE. Un vecteur doré doit être reproductible : les IV,
 *    sels et préfixes de nonce ne peuvent pas être aléatoires. Le script
 *    n'altère AUCUNE logique de format ; il remplace uniquement la SOURCE
 *    D'ENTROPIE vue par les modules de production :
 *      - `randomBytes` de node:crypto (streamCrypto) via un require interposé ;
 *      - `crypto.getRandomValues` global (hybridCrypto) via un proxy.
 *    Le flux déterministe est un compteur SHA-256 par cas (voir `makeRng`).
 *    Tout le reste — ordre des champs, offsets, AAD, HKDF, compression — est
 *    exécuté par le code de production, non reproduit.
 *
 * 2. TRANSPILATION À LA VOLÉE. Les modules de production sont en TypeScript et
 *    ne sont pas publiés en paquet Node. Ce script les transpile en mémoire
 *    avec le compilateur `typescript` du dépôt (ts.transpileModule, aucune
 *    vérification de types, aucune réécriture) et les exécute dans un require
 *    maison. Le code exécuté est donc le code source de production, ligne pour
 *    ligne. Aucun fichier du dépôt desktop n'est modifié.
 *
 * 3. TAILLE DE CHUNK V3 DE 64 KiB POUR LES CAS MULTI-CHUNKS. L'écrivain V3 de
 *    production utilise une constante de 8 MiB. Un vecteur multi-chunks à
 *    8 MiB pèserait plus de 22 Mo en base64 — inembarquable dans un pack de
 *    test mobile. Pour les seuls cas multi-chunks, le script charge une
 *    SECONDE instance de electron/streamCrypto.ts dont la ligne
 *    `const V3_CHUNK_SIZE: number = 8 * 1024 * 1024;` est remplacée par
 *    `= 65536;` (remplacement textuel unique, vérifié). 64 KiB est la borne
 *    BASSE que le lecteur de production accepte (MIN_CHUNK_SIZE), donc le
 *    conteneur produit reste 100 % légal. Aucune autre ligne n'est touchée :
 *    en-tête, AAD, nonce, HKDF, découpe et bornes restent le code d'origine.
 *    PREUVE : ces vecteurs sont relus par le lecteur V3 NON MODIFIÉ (première
 *    instance, 8 MiB), qui lit chunkSize dans l'en-tête. S'ils passent, c'est
 *    que le format est bien paramétré par l'en-tête et non par la constante.
 *    Effet de bord voulu : un lecteur mobile qui coderait 8 MiB en dur échoue
 *    sur ces vecteurs.
 *
 * 4. CONTRÔLE CROISÉ INDÉPENDANT (V3). En plus de l'aller-retour de
 *    production, le script redéchiffre CHAQUE chunk V3 avec une
 *    implémentation indépendante écrite depuis la spécification (HKDF-SHA256,
 *    nonce = préfixe || u32BE(index), AAD de 25 octets). Ce contrôle ne
 *    GÉNÈRE rien : il ne sert qu'à publier des champs de diagnostic
 *    (clé de fichier dérivée, nonce et AAD par chunk) sans risque de les
 *    publier faux. Si la spécification était mal comprise ici, le contrôle
 *    échouerait sur un ciphertext pourtant produit par la production, et le
 *    script s'arrêterait.
 *
 * 5. STUB DU MODULE `electron` POUR LES MANIFESTES. `storageService.ts` fait
 *    `import { app, safeStorage } from 'electron'`, et la fonction ciblée
 *    elle-même en dépend : `encryptWithFEK` appelle `loadFEKForPairing()`, qui
 *    lit `.fek_safe` via `safeStorage.decryptString` et construit sa liste de
 *    chemins candidats avec `app.getPath('userData')`. Ce n'est donc PAS une
 *    dépendance périphérique qu'on pourrait ignorer. Le script fournit :
 *      - `app.getPath()` → un répertoire temporaire ;
 *      - `safeStorage.isEncryptionAvailable()` → true ;
 *      - `safeStorage.encryptString/decryptString` → l'IDENTITÉ (utf8 ⇄ Buffer).
 *    CE QUE ÇA CHANGE, EXACTEMENT : rien du format sur le fil. safeStorage est
 *    un coffre OS (DPAPI/Keychain) qui protège le fichier `.fek_safe` AU REPOS ;
 *    sa seule sortie utile pour `encryptWithFEK` est la chaîne base64 des
 *    32 octets de la FEK. Le stub rend cette même chaîne. Aucun octet du
 *    conteneur `fek:`/`fkz:` ne traverse safeStorage. Le vrai DPAPI n'est donc
 *    pas exercé — voir la section "openPoints" du lot.
 *    De la même façon, la clé MACHINE est déposée dans `encryption.key.safe`
 *    avant `initialize()`, et le script VÉRIFIE ensuite que
 *    `getEncryptionKeyBase64()` (la fonction de production qui alimente le
 *    champ `encryptionKey` du manifeste, syncService.ts:616) rend bien cette
 *    valeur : le champ publié dans les vecteurs est donc celui de production.
 *
 * 6. SEUIL DE COMPRESSION FORCÉ POUR UN SEUL CAS DE MANIFESTE.
 *    `encryptWithFEK` choisit `fkz:` dès que le clair pèse au moins
 *    FEK_COMPRESS_MIN_BYTES (256) ET que deflate y gagne des octets. Un
 *    manifeste RÉALISTE (plusieurs fichiers, champs de clé) est donc toujours
 *    écrit en `fkz:` par le desktop. Or le mobile, lui, écrit TOUJOURS `fek:`
 *    quelle que soit la taille (`manifestCrypto.encryptManifestBytes`) : un
 *    gros conteneur `fek:` est un cas de production réel, que le desktop doit
 *    savoir relire. Pour l'obtenir depuis l'ÉCRIVAIN DE PRODUCTION, le script
 *    charge une seconde instance de `storageService.ts` dont la seule ligne
 *    `private static readonly FEK_COMPRESS_MIN_BYTES = 256;` devient
 *    `= Number.MAX_SAFE_INTEGER;` (remplacement textuel unique, vérifié).
 *    Aucune autre ligne n'est touchée : marqueur, IV, AES-GCM et cadrage
 *    restent le code d'origine. PREUVE que l'override a bien pris et que le
 *    cas est significatif : le MÊME clair, passé à l'instance NON modifiée,
 *    ressort en `fkz:` — les deux conteneurs sont publiés côte à côte et
 *    relus tous les deux par le lecteur NON modifié.
 *
 * 7. VARIANTE « v1: » DES CONTENEURS CLÉ MACHINE. Le desktop À JOUR n'écrit
 *    plus que du "v2:" (600 000 tours) : il n'existe AUCUN écrivain "v1:" en
 *    production. Or "v1:" (10 000 tours) est toujours LU par decrypt()
 *    (storageService.ts:434-436) et peut encore se trouver au cloud — la
 *    migration v1→v2 n'a lieu qu'à la LECTURE d'un dossier (getFolder
 *    :1448-1460), donc un dossier jamais rouvert depuis la hausse à 600k est
 *    poussé tel quel. Pour produire ce cas DEPUIS L'ÉCRIVAIN DE PRODUCTION, le
 *    script charge une troisième instance de storageService.ts dont DEUX
 *    lignes sont remplacées (remplacements textuels uniques, vérifiés) :
 *      `private readonly iterationCount: number = 600000;`      → `= 10000;`
 *      `public readonly ENCRYPTION_VERSION_2: string = 'v2:';`  → `= 'v1:';`
 *    Aucune autre ligne n'est touchée : cadrage, hex, AES-GCM, offsets et
 *    dérivation restent le code d'origine. PREUVE que le conteneur produit est
 *    un VRAI v1 : il est relu par l'instance NON modifiée, qui le route sur
 *    decryptV1 — une branche atteignable uniquement si le marqueur est bien
 *    "v1:", et qui dérive à legacyIterationCount (10 000). Un conteneur à
 *    600 000 tours y échouerait.
 *
 * 8. VARIANTE SANS MARQUEUR DES CONTENEURS CLÉ MACHINE. Même principe que les
 *    vecteurs V0 : le conteneur est un "v2:" de production amputé de ses TROIS
 *    caractères de marqueur. Le marqueur n'entre ni dans le sel, ni dans l'IV,
 *    ni dans une donnée associée — il est purement préfixé par concaténation
 *    de chaînes (storageService.ts:409) — donc « v2: moins le préfixe » est un
 *    conteneur nu exact. Il est ensuite REVALIDÉ par decrypt() de l'instance
 *    non modifiée, qui emprunte son chemin sans-marqueur (:437-447).
 *
 * USAGE
 * -----
 *   node scripts/generate-golden-vectors.mjs \
 *     --out ../filarr-mobile/spec/golden-vectors.json \
 *     --commit <sha desktop> --date <ISO 8601>
 *
 * Sans --commit / --date, le script prend `git rev-parse HEAD` et l'instant
 * courant. Sans --out, il écrit dans ../filarr-mobile/spec/golden-vectors.json
 * relativement à la racine du dépôt desktop.
 *
 * Le script est en LECTURE SEULE sur le dépôt desktop : sa seule écriture est
 * le fichier --out (plus un répertoire temporaire supprimé en fin de course).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import * as zlib from 'node:zlib';
import * as nodeCrypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const req = createRequire(path.join(REPO, 'package.json'));
const ts = req('typescript');

const PACK_VERSION = 1;
const HKDF_INFO = 'filarr-file-v3';
const V3_MAGIC_HEX = '46494c415252454e43563300';
const SMALL_CHUNK_SIZE = 65536; // borne basse acceptée par le lecteur V3

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const OUT_PATH = path.resolve(
  args.out ?? path.join(REPO, '..', 'filarr-mobile', 'spec', 'golden-vectors.json')
);
const COMMIT =
  args.commit ??
  (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    } catch {
      return 'inconnu';
    }
  })();
const DATE = args.date ?? new Date().toISOString();

// ---------------------------------------------------------------------------
// Entropie déterministe (voir note 1 en tête de fichier)
// ---------------------------------------------------------------------------

/**
 * Flux d'octets déterministe : concaténation de SHA-256(label || u32BE(n)).
 * Un flux distinct par cas de test, dérivé de son identifiant : ajouter un
 * cas ne change donc jamais les octets des cas existants.
 */
function makeRng(label) {
  let counter = 0;
  let pool = Buffer.alloc(0);
  return (n) => {
    while (pool.length < n) {
      const h = nodeCrypto.createHash('sha256');
      h.update(Buffer.from(label, 'utf8'));
      const c = Buffer.alloc(4);
      c.writeUInt32BE(counter++, 0);
      pool = Buffer.concat([pool, h.update(c).digest()]);
    }
    const outBuf = Buffer.from(pool.subarray(0, n));
    pool = pool.subarray(n);
    return outBuf;
  };
}

/** Générateur de clairs pseudo-aléatoires (incompressibles) et reproductibles. */
function prngBytes(label, n) {
  return makeRng(`filarr-golden-vectors/v${PACK_VERSION}/plaintext/${label}`)(n);
}

let currentRng = null;
function rngBytes(n) {
  if (!currentRng) {
    throw new Error(
      'Entropie non armée : un vecteur allait être généré avec de vrais aléas (non reproductible).'
    );
  }
  return currentRng(n);
}

/**
 * node:crypto vu par les modules de production : seules les DEUX sources
 * d'entropie sont déroutées.
 *   - `randomBytes` : utilisé par streamCrypto (sel et préfixe de nonce V3).
 *   - `getRandomValues` : utilisé par storageService#encryptWithFEK pour l'IV
 *     du conteneur de manifeste (storageService.ts:2869). Sans cette
 *     interception, les vecteurs de manifeste ne seraient pas reproductibles.
 * Les deux LÈVENT si l'entropie n'est pas armée : un vecteur ne peut pas être
 * produit par inadvertance avec de vrais aléas.
 */
const patchedNodeCrypto = new Proxy(nodeCrypto, {
  get(target, prop) {
    if (prop === 'randomBytes') {
      return (size) => rngBytes(size);
    }
    if (prop === 'getRandomValues') {
      return (arr) => {
        const bytes = rngBytes(arr.byteLength);
        new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(bytes);
        return arr;
      };
    }
    return Reflect.get(target, prop);
  },
});

// hybridCrypto.ts (renderer) touche `window` et `crypto.getRandomValues`.
globalThis.window = { electron: undefined };
const realWebCrypto = globalThis.crypto;
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: new Proxy(realWebCrypto, {
    get(target, prop) {
      if (prop === 'getRandomValues') {
        return (arr) => {
          const bytes = rngBytes(arr.byteLength);
          new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(bytes);
          return arr;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }),
});

// ---------------------------------------------------------------------------
// Chargeur TypeScript à la volée (voir note 2 en tête de fichier)
// ---------------------------------------------------------------------------

/**
 * Crée un espace de modules isolé. `transforms` associe un chemin absolu à une
 * fonction de réécriture de son SOURCE — utilisé uniquement pour la variante
 * 64 KiB de streamCrypto (note 3) et le seuil de compression du manifeste
 * (note 6). `moduleStubs` associe un spécificateur de module BARE (ex.
 * 'electron') à un objet d'exports — voir note 5.
 */
function createTsLoader(transforms = new Map(), moduleStubs = new Map()) {
  const cache = new Map();

  const resolveTs = (spec, fromDir) => {
    const base = path.resolve(fromDir, spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  };

  const load = (file) => {
    const abs = path.resolve(file);
    if (cache.has(abs)) return cache.get(abs).exports;

    let source = fs.readFileSync(abs, 'utf8');
    const transform = transforms.get(abs);
    if (transform) source = transform(source, abs);

    const js = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        allowJs: true,
      },
      fileName: abs,
    }).outputText;

    const mod = { exports: {} };
    cache.set(abs, mod);
    const dir = path.dirname(abs);
    const localRequire = (spec) => {
      if (spec === 'node:crypto' || spec === 'crypto') return patchedNodeCrypto;
      if (moduleStubs.has(spec)) return moduleStubs.get(spec);
      if (spec.startsWith('.')) {
        const resolved = resolveTs(spec, dir);
        if (resolved) return load(resolved);
      }
      return req(spec);
    };
    const fn = vm.compileFunction(js, ['exports', 'require', 'module', '__filename', '__dirname'], {
      filename: abs,
    });
    fn(mod.exports, localRequire, mod, abs, dir);
    return mod.exports;
  };

  return load;
}

const P_STREAM = path.join(REPO, 'electron', 'streamCrypto.ts');
const P_HYBRID_BLOB = path.join(REPO, 'electron', 'hybridBlobCrypto.ts');
const P_RENDERER = path.join(REPO, 'src', 'services', 'auth', 'hybridCrypto.ts');

const loadProd = createTsLoader();
const streamCrypto = loadProd(P_STREAM); // V3 : écrivain 8 MiB + LECTEUR DE RÉFÉRENCE
const hybridBlobCrypto = loadProd(P_HYBRID_BLOB); // V0/V1/V2 : lecteur main (Node)
const renderer = loadProd(P_RENDERER); // V0/V1/V2 : écrivain + lecteur renderer

// Variante 64 KiB : ÉCRIVAIN SEULEMENT (les vecteurs produits sont relus par
// `streamCrypto`, l'instance non modifiée).
const CHUNK_CONST_NEEDLE = 'const V3_CHUNK_SIZE: number = 8 * 1024 * 1024;';
const smallChunkTransform = (source, abs) => {
  const occurrences = source.split(CHUNK_CONST_NEEDLE).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${abs} : la constante de taille de chunk a changé (${occurrences} occurrence(s) de ` +
        `"${CHUNK_CONST_NEEDLE}"). Le script doit être remis à jour AVANT de régénérer le pack.`
    );
  }
  return source.replace(CHUNK_CONST_NEEDLE, `const V3_CHUNK_SIZE: number = ${SMALL_CHUNK_SIZE};`);
};
const loadSmallChunk = createTsLoader(new Map([[P_STREAM, smallChunkTransform]]));
const streamCryptoSmallChunk = loadSmallChunk(P_STREAM);

if (streamCryptoSmallChunk.V3_CHUNK_SIZE !== SMALL_CHUNK_SIZE) {
  throw new Error('La variante 64 KiB de streamCrypto n a pas pris : abandon.');
}
if (streamCrypto.V3_CHUNK_SIZE !== 8 * 1024 * 1024) {
  throw new Error('L instance de production de streamCrypto a été altérée : abandon.');
}

// ---------------------------------------------------------------------------
// Clé fixe du pack
// ---------------------------------------------------------------------------

/**
 * Clé maître de test, publique et fixe : sha256("filarr-golden-vectors/v1/key").
 * Elle joue le rôle de la FEK (V0/V1/V2 : clé AES brute ; V3 : IKM du HKDF).
 * Elle ne protège aucune donnée réelle — c'est un vecteur de test.
 */
const KEY = nodeCrypto
  .createHash('sha256')
  .update(`filarr-golden-vectors/v${PACK_VERSION}/key`)
  .digest();
const KEY_HEX = KEY.toString('hex');

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

const b64 = (buf) => Buffer.from(buf).toString('base64');
const sha256 = (buf) => nodeCrypto.createHash('sha256').update(buf).digest('hex');
const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

function assert(condition, message) {
  if (!condition) throw new Error(`ÉCHEC DE VÉRIFICATION — ${message}`);
}

let TMP_DIR = null;
function tmpFile(name) {
  if (!TMP_DIR) TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filarr-golden-'));
  return path.join(TMP_DIR, name);
}

// ---------------------------------------------------------------------------
// Contrôle croisé indépendant V3 (voir note 4 en tête de fichier)
// ---------------------------------------------------------------------------

function v3BuildNonce(noncePrefix, index) {
  const nonce = Buffer.alloc(12);
  noncePrefix.copy(nonce, 0);
  nonce.writeUInt32BE(index, 8);
  return nonce;
}

function v3BuildAad(origSize, index) {
  const aad = Buffer.alloc(25);
  Buffer.from(V3_MAGIC_HEX, 'hex').copy(aad, 0);
  aad.writeUInt8(3, 12);
  aad.writeBigUInt64LE(BigInt(origSize), 13);
  aad.writeUInt32BE(index, 21);
  return aad;
}

/**
 * Redéchiffre un conteneur V3 chunk par chunk depuis la spécification écrite,
 * SANS le code de production. Sert de contrôle croisé et de source des champs
 * de diagnostic publiés (clé de fichier, nonces, AAD). Ne génère aucun vecteur.
 */
function v3IndependentInspect(container, masterKey) {
  assert(container.length >= 50, 'conteneur V3 plus court que son en-tête');
  const magicHex = container.subarray(0, 12).toString('hex');
  assert(magicHex === V3_MAGIC_HEX, 'magic V3 inattendu');
  const version = container.readUInt8(12);
  const reserved = container.readUInt8(13);
  const chunkSize = container.readUInt32LE(14);
  const origSize = Number(container.readBigUInt64LE(18));
  const salt = Buffer.from(container.subarray(26, 42));
  const noncePrefix = Buffer.from(container.subarray(42, 50));
  const nChunks = origSize === 0 ? 1 : Math.ceil(origSize / chunkSize);
  assert(
    container.length === 50 + nChunks * 16 + origSize,
    'longueur totale V3 incohérente avec l en-tête'
  );

  const fileKey = Buffer.from(nodeCrypto.hkdfSync('sha256', masterKey, salt, HKDF_INFO, 32));
  const chunks = [];
  const parts = [];
  let pos = 50;
  for (let i = 0; i < nChunks; i++) {
    const plainLen = i < nChunks - 1 ? chunkSize : origSize - (nChunks - 1) * chunkSize;
    const ciphertext = container.subarray(pos, pos + plainLen);
    const tag = container.subarray(pos + plainLen, pos + plainLen + 16);
    const nonce = v3BuildNonce(noncePrefix, i);
    const aad = v3BuildAad(origSize, i);
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', fileKey, nonce, {
      authTagLength: 16,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    assert(plain.length === plainLen, `chunk ${i} : longueur de clair inattendue`);
    parts.push(plain);
    chunks.push({
      index: i,
      plaintextLength: plainLen,
      ciphertextOffset: pos,
      tagOffset: pos + plainLen,
      nonce: nonce.toString('hex'),
      aad: aad.toString('hex'),
    });
    pos += plainLen + 16;
  }
  return {
    header: {
      magic: magicHex,
      version,
      reserved,
      chunkSize,
      origSize,
      salt: salt.toString('hex'),
      noncePrefix: noncePrefix.toString('hex'),
      raw: container.subarray(0, 50).toString('hex'),
    },
    nChunks,
    derivedFileKey: fileKey.toString('hex'),
    chunks,
    plaintext: Buffer.concat(parts),
  };
}

// ---------------------------------------------------------------------------
// Générateurs de cas
// ---------------------------------------------------------------------------

const cases = [];
const negativeCases = [];
const byId = new Map();

function pushCase(entry) {
  assert(!byId.has(entry.id), `identifiant de cas dupliqué : ${entry.id}`);
  byId.set(entry.id, entry);
  cases.push(entry);
  return entry;
}

/**
 * Produit un blob V1 ou V2 avec l'ÉCRIVAIN DE PRODUCTION du renderer, puis le
 * revalide avec les DEUX lecteurs de production.
 * `rngLabel` fixe l'IV (déterminisme).
 */
async function produceMarkedBlob({ rngLabel, plaintext, options }) {
  currentRng = makeRng(`filarr-golden-vectors/v${PACK_VERSION}/iv/${rngLabel}`);
  try {
    await renderer.importFEKRaw(new Uint8Array(KEY));
    const blob = Buffer.from(await renderer.encryptFileContent(toArrayBuffer(plaintext), options));
    return blob;
  } finally {
    currentRng = null;
  }
}

/** Aller-retour obligatoire par les deux lecteurs de production V0/V1/V2. */
async function verifyMarkedBlob(blob, plaintext, label) {
  const viaMain = hybridBlobCrypto.decryptHybridFekBlob(blob, [KEY]);
  assert(
    Buffer.compare(viaMain, plaintext) === 0,
    `${label} : le lecteur main (decryptHybridFekBlob) ne retrouve pas le clair`
  );
  await renderer.importFEKRaw(new Uint8Array(KEY));
  const viaRenderer = Buffer.from(await renderer.decryptFileContent(new Uint8Array(blob)));
  assert(
    Buffer.compare(viaRenderer, plaintext) === 0,
    `${label} : le lecteur renderer (decryptFileContent) ne retrouve pas le clair`
  );
}

function markedParams(blob, expectedFormat) {
  const marker = expectedFormat === 'V0' ? null : blob[0];
  const ivOffset = expectedFormat === 'V0' ? 0 : 1;
  return {
    marker: marker === null ? null : `0x${marker.toString(16).padStart(2, '0')}`,
    ivOffset,
    ivLength: 12,
    iv: blob.subarray(ivOffset, ivOffset + 12).toString('hex'),
    ciphertextOffset: ivOffset + 12,
    ciphertextLength: blob.length - ivOffset - 12 - 16,
    tagOffset: blob.length - 16,
    tagLength: 16,
    deflated: expectedFormat === 'V2',
    innerPlaintextLength: null, // rempli pour V2
    aad: 'aucun — ni le marqueur ni l IV ne sont authentifiés comme données associées',
  };
}

async function addMarkedCase({ id, expectedFormat, description, plaintext, options, rngLabel }) {
  const blob = await produceMarkedBlob({
    rngLabel: rngLabel ?? id,
    plaintext,
    options: options ?? {},
  });
  const actualMarker = blob[0];
  const expectedMarker = expectedFormat === 'V1' ? 0x01 : 0x02;
  assert(
    actualMarker === expectedMarker,
    `${id} : l écrivain de production a choisi le marqueur 0x${actualMarker.toString(16)} ` +
      `au lieu de ${expectedFormat} — le cas ne teste pas ce qu il prétend`
  );
  await verifyMarkedBlob(blob, plaintext, id);

  const params = markedParams(blob, expectedFormat);
  if (expectedFormat === 'V2') {
    // Le clair interne (flux zlib) mesure ciphertextLength octets.
    params.innerPlaintextLength = params.ciphertextLength;
    params.innerEncoding = 'zlib RFC-1950 (pako.deflate niveau 5) — PAS deflate brut, PAS gzip';
  }

  return pushCase({
    id,
    format: expectedFormat,
    description,
    key: KEY_HEX,
    keyUsage: 'clé AES-256-GCM brute (FEK)',
    plaintext: b64(plaintext),
    plaintextLength: plaintext.length,
    plaintextSha256: sha256(plaintext),
    ciphertext: b64(blob),
    ciphertextLength: blob.length,
    sha256: sha256(blob),
    params,
    producedBy: 'src/services/auth/hybridCrypto.ts#encryptFileContent',
    verifiedBy: [
      'electron/hybridBlobCrypto.ts#decryptHybridFekBlob',
      'src/services/auth/hybridCrypto.ts#decryptFileContent',
    ],
  });
}

/**
 * V0 : un V1 de production amputé de son octet de marqueur. Le marqueur n'est
 * couvert par aucun AAD et l'IV le suit immédiatement, donc le retrait produit
 * un V0 exact — ce que le lecteur de production confirme ensuite.
 * `ivFirstByte` permet de forcer un IV commençant par 0x01/0x02 (cas de repli).
 */
async function addLegacyV0Case({ id, description, plaintext, ivFirstByte = null }) {
  let blob = null;
  let attempts = 0;
  for (let attempt = 0; attempt < 4096; attempt++) {
    const candidate = await produceMarkedBlob({
      rngLabel: `${id}#${attempt}`,
      plaintext,
      options: { compress: false },
    });
    attempts = attempt + 1;
    assert(candidate[0] === 0x01, `${id} : marqueur V1 attendu avant amputation`);
    if (ivFirstByte === null || candidate[1] === ivFirstByte) {
      blob = candidate.subarray(1);
      break;
    }
  }
  assert(blob !== null, `${id} : aucun IV commençant par 0x${ivFirstByte?.toString(16)} trouvé`);
  const v0 = Buffer.from(blob);
  await verifyMarkedBlob(v0, plaintext, id);

  return pushCase({
    id,
    format: 'V0',
    description,
    key: KEY_HEX,
    keyUsage: 'clé AES-256-GCM brute (FEK)',
    plaintext: b64(plaintext),
    plaintextLength: plaintext.length,
    plaintextSha256: sha256(plaintext),
    ciphertext: b64(v0),
    ciphertextLength: v0.length,
    sha256: sha256(v0),
    params: {
      ...markedParams(v0, 'V0'),
      firstByte: `0x${v0[0].toString(16).padStart(2, '0')}`,
      rngAttempts: attempts,
    },
    producedBy:
      'src/services/auth/hybridCrypto.ts#encryptFileContent (V1) moins l octet de marqueur',
    verifiedBy: [
      'electron/hybridBlobCrypto.ts#decryptHybridFekBlob',
      'src/services/auth/hybridCrypto.ts#decryptFileContent',
    ],
  });
}

/** V3 avec l'écrivain de production ; `small` bascule sur la variante 64 KiB. */
async function addV3Case({ id, description, plaintext, small = false }) {
  const writer = small ? streamCryptoSmallChunk : streamCrypto;
  const dest = tmpFile(`${id}.v3`);
  currentRng = makeRng(`filarr-golden-vectors/v${PACK_VERSION}/v3/${id}`);
  try {
    await writer.encryptBufferToFileV3(KEY, plaintext, dest);
  } finally {
    currentRng = null;
  }
  const container = fs.readFileSync(dest);

  // 1) Aller-retour par le LECTEUR DE PRODUCTION NON MODIFIÉ (chunkSize lu
  //    dans l en-tête, y compris pour les conteneurs 64 KiB).
  const stat = await streamCrypto.statV3File(dest);
  const decrypted = await streamCrypto.decryptFileToBufferV3(KEY, dest, 1024 * 1024 * 1024);
  assert(
    Buffer.compare(decrypted, plaintext) === 0,
    `${id} : le lecteur V3 de production ne retrouve pas le clair`
  );
  assert(stat.origSize === plaintext.length, `${id} : origSize incohérent`);
  assert(stat.encryptedSize === container.length, `${id} : taille chiffrée incohérente`);

  // 2) Contrôle croisé indépendant (diagnostic + garde-fou spécification).
  const inspected = v3IndependentInspect(container, KEY);
  assert(
    Buffer.compare(inspected.plaintext, plaintext) === 0,
    `${id} : le contrôle croisé indépendant ne retrouve pas le clair`
  );
  assert(inspected.nChunks === stat.nChunks, `${id} : nombre de chunks incohérent`);
  assert(
    inspected.header.chunkSize === (small ? SMALL_CHUNK_SIZE : 8 * 1024 * 1024),
    `${id} : chunkSize inattendu dans l en-tête`
  );

  fs.rmSync(dest, { force: true });

  return pushCase({
    id,
    format: 'V3',
    description,
    key: KEY_HEX,
    keyUsage: 'clé maître (IKM du HKDF-SHA256 par fichier) — jamais utilisée telle quelle en AES',
    plaintext: b64(plaintext),
    plaintextLength: plaintext.length,
    plaintextSha256: sha256(plaintext),
    ciphertext: b64(container),
    ciphertextLength: container.length,
    sha256: sha256(container),
    params: {
      header: inspected.header,
      headerSize: 50,
      tagLength: 16,
      nChunks: inspected.nChunks,
      expectedTotalLength: 50 + inspected.nChunks * 16 + plaintext.length,
      hkdf: { algorithm: 'HKDF-SHA256', info: HKDF_INFO, outputLength: 32, saltFrom: 'header.salt' },
      derivedFileKey: inspected.derivedFileKey,
      nonceLayout: 'noncePrefix(8) || u32BE(index)',
      aadLayout: 'magic(12) || 0x03 || u64LE(origSize) || u32BE(index) — 25 octets',
      chunks: inspected.chunks,
      writerChunkSizeOverridden: small,
    },
    producedBy: small
      ? 'electron/streamCrypto.ts#encryptBufferToFileV3 (V3_CHUNK_SIZE forcé à 65536 — cf. note 3 du générateur)'
      : 'electron/streamCrypto.ts#encryptBufferToFileV3',
    verifiedBy: [
      'electron/streamCrypto.ts#decryptFileToBufferV3 (instance NON modifiée)',
      'electron/streamCrypto.ts#statV3File (instance NON modifiée)',
      'contrôle croisé indépendant chunk par chunk',
    ],
  });
}

// ---------------------------------------------------------------------------
// Manifestes de synchronisation (section "manifests" du pack)
// ---------------------------------------------------------------------------
//
// Le conteneur de manifeste est un format DISTINCT des blobs de contenu :
// marqueur ASCII de 4 octets ("fek:" ou "fkz:"), puis IV(12), puis
// AES-256-GCM(clair) avec le tag collé en fin par WebCrypto. La FEK sert de
// clé AES BRUTE (aucun HKDF, aucun PBKDF2, aucun AAD).
//
// Ces vecteurs sortent de electron/storageService.ts#encryptWithFEK et sont
// relus par #decryptWithFEK ET #decryptManifestAuto (le point d'entrée
// réellement appelé par electron/sync/syncService.ts au téléchargement).

const P_STORAGE = path.join(REPO, 'electron', 'storageService.ts');

/**
 * Clé MACHINE de test (`StorageService.key`), distincte de la FEK.
 * C'est elle que le desktop publie en base64 dans le champ racine
 * `encryptionKey` du manifeste (syncService.ts:616), et c'est elle que le
 * mobile doit extraire pour alimenter sa liste de clés candidates : sous
 * 500 Mo, un conteneur V3 peut être chiffré sous cette clé et non sous la FEK.
 */
const MACHINE_KEY = nodeCrypto
  .createHash('sha256')
  .update(`filarr-golden-vectors/v${PACK_VERSION}/machine-key`)
  .digest();
const MACHINE_KEY_B64 = MACHINE_KEY.toString('base64');

const COMPRESS_MIN_NEEDLE = 'private static readonly FEK_COMPRESS_MIN_BYTES = 256;';

/**
 * Stub du module `electron` (note 5). safeStorage est réduit à l'identité :
 * son seul rôle sur le chemin de `encryptWithFEK` est de rendre la chaîne
 * base64 de la FEK stockée dans `.fek_safe`. Aucun octet du conteneur
 * `fek:`/`fkz:` ne le traverse.
 */
function makeElectronStub(userDataDir) {
  return {
    app: {
      getPath: (name) => {
        if (name !== 'userData') {
          throw new Error(`stub electron : app.getPath("${name}") inattendu`);
        }
        return userDataDir;
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(text, 'utf8'),
      decryptString: (buf) => Buffer.from(buf).toString('utf8'),
    },
  };
}

/**
 * Prépare un répertoire de profil (clé machine + FEK déjà en place, donc
 * aucun aléa n'est tiré à l'initialisation) et rend le singleton de
 * production de storageService, initialisé dessus.
 *
 * `sourceTransform` permet de charger la variante à seuil de compression
 * neutralisé (note 6) dans un espace de modules SÉPARÉ.
 */
async function initStorageService(dirName, sourceTransform = null) {
  const userDataDir = tmpFile(dirName);
  const profileDir = path.join(userDataDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(path.join(userDataDir, 'FilarData'), { recursive: true });

  // safeStorage est stubbé en identité : ces fichiers contiennent donc
  // exactement ce que decryptString rendra, c'est-à-dire du base64.
  fs.writeFileSync(path.join(profileDir, 'encryption.key.safe'), Buffer.from(MACHINE_KEY_B64, 'utf8'));
  fs.writeFileSync(path.join(profileDir, '.fek_safe'), Buffer.from(KEY.toString('base64'), 'utf8'));

  const transforms = new Map();
  if (sourceTransform) transforms.set(P_STORAGE, sourceTransform);
  const load = createTsLoader(transforms, new Map([['electron', makeElectronStub(userDataDir)]]));
  const svc = load(P_STORAGE).default;

  await svc.initialize(profileDir);

  // La clé machine chargée est-elle bien la nôtre ? C'est la fonction de
  // production qui répond — celle qui alimente le champ `encryptionKey`.
  assert(
    svc.getEncryptionKeyBase64() === MACHINE_KEY_B64,
    'storageService n a pas chargé la clé machine attendue (le stub safeStorage a dérivé ?)'
  );
  return svc;
}

/**
 * Redécode un conteneur de manifeste DEPUIS LA SPÉCIFICATION ÉCRITE, sans le
 * code de production (même rôle que v3IndependentInspect, note 4). Ne génère
 * rien : il ne sert qu'à garantir que les offsets publiés dans `params` sont
 * exacts. Si la spécification était mal comprise ici, ce contrôle échouerait
 * sur un conteneur pourtant produit par la production, et le script
 * s'arrêterait.
 */
function manifestIndependentInspect(container, fek) {
  assert(container.length >= 32, 'conteneur de manifeste plus court que son cadrage minimal');
  const marker = container.subarray(0, 4).toString('ascii');
  assert(marker === 'fek:' || marker === 'fkz:', `marqueur de manifeste inattendu : ${marker}`);
  const iv = container.subarray(4, 16);
  const body = container.subarray(16);
  const ciphertext = body.subarray(0, body.length - 16);
  const tag = body.subarray(body.length - 16);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', fek, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const inner = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (marker === 'fek:') return inner;
  // zlib RFC-1950 : l en-tête doit être présent (inflateSync, pas inflateRawSync).
  assert(
    inner.length >= 2 && inner[0] === 0x78,
    'le clair d un conteneur fkz: ne commence pas par un en-tête zlib RFC-1950'
  );
  return zlib.inflateSync(inner);
}

const manifestCases = [];
const manifestNegativeCases = [];
const manifestById = new Map();

/**
 * Produit un conteneur de manifeste avec l'ÉCRIVAIN DE PRODUCTION, puis le
 * revalide par les DEUX lecteurs de production (strict et auto).
 */
async function addManifestCase({
  id,
  description,
  payload,
  payloadKind,
  expectedMarker,
  writer,
  producedBy,
  extra = {},
}) {
  currentRng = makeRng(`filarr-golden-vectors/v${PACK_VERSION}/manifest/${id}`);
  let container;
  try {
    container = await writer.encryptWithFEK(payload);
  } finally {
    currentRng = null;
  }

  const marker = container.subarray(0, 4).toString('ascii');
  assert(
    marker === expectedMarker,
    `${id} : l écrivain de production a choisi le marqueur "${marker}" au lieu de ` +
      `"${expectedMarker}" — le cas ne teste pas ce qu il prétend`
  );

  // Aller-retour 1 : le lecteur strict.
  const viaStrict = await writer.decryptWithFEK(container);
  assert(
    Buffer.compare(viaStrict, payload) === 0,
    `${id} : decryptWithFEK ne retrouve pas le clair`
  );
  // Aller-retour 2 : le point d entrée réellement appelé par syncService.
  const viaAuto = await writer.decryptManifestAuto(container);
  assert(
    Buffer.compare(viaAuto, payload) === 0,
    `${id} : decryptManifestAuto ne retrouve pas le clair`
  );
  // Contrôle croisé indépendant : les offsets publiés dans `params` sont-ils
  // exactement ceux qu un lecteur écrit depuis la spécification utiliserait ?
  assert(
    Buffer.compare(manifestIndependentInspect(container, KEY), payload) === 0,
    `${id} : le contrôle croisé indépendant ne retrouve pas le clair`
  );

  // Disposition binaire, mesurée sur le conteneur produit (jamais supposée).
  const ivLength = 12;
  const params = {
    marker,
    markerHex: container.subarray(0, 4).toString('hex'),
    markerLength: 4,
    ivOffset: 4,
    ivLength,
    iv: container.subarray(4, 4 + ivLength).toString('hex'),
    ciphertextOffset: 4 + ivLength,
    ciphertextLength: container.length - 4 - ivLength - 16,
    tagOffset: container.length - 16,
    tagLength: 16,
    deflated: marker === 'fkz:',
    innerEncoding:
      marker === 'fkz:'
        ? 'zlib RFC-1950 (zlib.deflate de node) — PAS deflate brut, PAS gzip'
        : 'aucune — le clair chiffré est le JSON brut',
    // Longueur des octets réellement passés à AES-GCM : le JSON pour "fek:",
    // le flux zlib pour "fkz:". AES-GCM préserve la longueur, donc c est aussi
    // ciphertextLength — mais ce N EST PAS la longueur du clair final en "fkz:".
    encryptedPayloadLength: container.length - 4 - ivLength - 16,
    encryptedPayloadIs: marker === 'fkz:' ? 'flux zlib' : 'clair final',
    aad: 'aucun — ni le marqueur ni l IV ne sont authentifiés comme données associées',
    keyUsage: 'clé AES-256-GCM brute (FEK) — aucun HKDF, aucun PBKDF2',
  };

  const entry = {
    id,
    description,
    payloadKind,
    key: KEY_HEX,
    plaintext: b64(payload),
    plaintextLength: payload.length,
    plaintextSha256: sha256(payload),
    ciphertext: b64(container),
    ciphertextLength: container.length,
    sha256: sha256(container),
    params,
    producedBy,
    verifiedBy: [
      'electron/storageService.ts#decryptWithFEK',
      'electron/storageService.ts#decryptManifestAuto',
      'contrôle croisé indépendant (offsets relus depuis la spécification)',
    ],
    ...extra,
  };

  assert(!manifestById.has(id), `identifiant de cas de manifeste dupliqué : ${id}`);
  manifestById.set(id, entry);
  manifestCases.push(entry);
  return entry;
}

/** Un manifeste JSON : le clair est la sérialisation exacte publiée. */
async function addManifestJsonCase({ id, description, manifest, expectedMarker, writer, producedBy, extra = {} }) {
  const json = JSON.stringify(manifest);
  const payload = Buffer.from(json, 'utf8');
  const entry = await addManifestCase({
    id,
    description,
    payload,
    payloadKind: 'json',
    expectedMarker,
    writer,
    producedBy,
    extra: { plaintextUtf8: json, ...extra },
  });
  // Le clair est-il bien du JSON qui redonne le manifeste d origine ?
  assert(
    JSON.stringify(JSON.parse(json)) === json,
    `${id} : la sérialisation JSON n est pas stable`
  );
  return entry;
}

/** Cas négatif par MUTATION d un cas de manifeste existant : doit être rejeté. */
async function addManifestNegativeMutation({ id, baseCase, description, mutations, writer }) {
  const base = manifestById.get(baseCase);
  assert(base, `${id} : cas de manifeste de base introuvable (${baseCase})`);
  const mutated = applyMutations(Buffer.from(base.ciphertext, 'base64'), mutations);

  let strictError = null;
  try {
    await writer.decryptWithFEK(mutated);
  } catch (error) {
    strictError = error.message;
  }
  assert(
    strictError !== null,
    `${id} : decryptWithFEK a ACCEPTÉ un conteneur altéré — le cas négatif est invalide`
  );

  // decryptManifestAuto est ce que syncService appelle réellement : sur un
  // marqueur détruit il retombe sur decryptBinary (clé MACHINE, deux PBKDF2)
  // et échoue à son tour, mais avec une autre erreur et un autre coût.
  let autoError = null;
  try {
    await writer.decryptManifestAuto(mutated);
  } catch (error) {
    autoError = error.message;
  }
  assert(
    autoError !== null,
    `${id} : decryptManifestAuto a ACCEPTÉ un conteneur altéré — le cas négatif est invalide`
  );

  manifestNegativeCases.push({
    id,
    kind: 'mutation',
    baseCase,
    description,
    key: KEY_HEX,
    mutations,
    expect: 'reject',
    mutatedSha256: sha256(mutated),
    mutatedLength: mutated.length,
    expectedErrorDesktopStrict: strictError,
    expectedErrorDesktopAuto: autoError,
    verifiedBy: [
      'electron/storageService.ts#decryptWithFEK',
      'electron/storageService.ts#decryptManifestAuto',
    ],
  });
}

/**
 * Cas négatif AUTONOME : le conteneur est parfaitement valide et
 * s'authentifie, mais son clair n'est pas du JSON. C'est le second vecteur
 * d'empoisonnement du desktop (JSON.parse, syncService.ts:507) et il ne peut
 * pas être obtenu par mutation — muter le ciphertext casserait le tag GCM.
 */
async function addManifestNegativeInvalidJson({ id, description, payload, expectedMarker, writer }) {
  currentRng = makeRng(`filarr-golden-vectors/v${PACK_VERSION}/manifest/${id}`);
  let container;
  try {
    container = await writer.encryptWithFEK(payload);
  } finally {
    currentRng = null;
  }
  const marker = container.subarray(0, 4).toString('ascii');
  assert(marker === expectedMarker, `${id} : marqueur ${marker} au lieu de ${expectedMarker}`);

  // Le conteneur DOIT se déchiffrer : c'est tout l'intérêt du cas.
  const plain = await writer.decryptManifestAuto(container);
  assert(Buffer.compare(plain, payload) === 0, `${id} : le clair rendu diffère du clair chiffré`);

  let parseError = null;
  try {
    JSON.parse(plain.toString('utf8'));
  } catch (error) {
    parseError = error.message;
  }
  assert(parseError !== null, `${id} : le clair est du JSON valide — le cas négatif est invalide`);

  manifestNegativeCases.push({
    id,
    kind: 'standalone',
    description,
    key: KEY_HEX,
    expect: 'decrypt-ok-json-invalid',
    plaintext: b64(payload),
    plaintextUtf8: payload.toString('utf8'),
    plaintextLength: payload.length,
    ciphertext: b64(container),
    ciphertextLength: container.length,
    sha256: sha256(container),
    expectedJsonErrorDesktop: parseError,
    verifiedBy: ['electron/storageService.ts#decryptManifestAuto', 'JSON.parse'],
  });
}

// ---------------------------------------------------------------------------
// Conteneurs CLÉ MACHINE — famille "v2:" / "v1:" (section "machineContainers")
// ---------------------------------------------------------------------------
//
// TROISIÈME format du coffre, distinct des blobs de contenu ET du manifeste.
// C'est celui des MÉTADONNÉES : {folderId}/metadata.json (entrées
// `meta:{folderId}` du manifeste) et notes.enc (`meta:notes`). Sans lui, ni
// l'arborescence ni les notes d'un compte desktop ne sont atteignables.
//
// DEUX VARIANTES, MÊME PRÉFIXE ASCII de TROIS octets :
//   · TEXTE   — encrypt() (storageService.ts:389-419) rend une CHAÎNE
//               'v2:' + hex(sel 16) + hex(IV 16) + hex(ct) + hex(tag 16),
//               écrite en UTF-8 sur disque (:1311-1313, main.ts:6186-6187) et
//               poussée VERBATIM au cloud (meta: est exclu de la voie delta,
//               syncService.ts:899). C'est ce que le mobile reçoit.
//   · BINAIRE — encryptBinary() (:532-554) rend
//               'v2:' || sel(16) || IV(16) || ct || tag(16), réservée au
//               contenu de fichier de la voie tamponnée héritée.
//
// DÉRIVATION : PBKDF2-SHA512, 600 000 tours (10 000 pour "v1:"), 32 octets ;
// AES-256-GCM ; IV de SEIZE octets (ivLength = 16, :160) — pas douze ; aucune
// AAD. Le MOT DE PASSE est constitué des 32 OCTETS BRUTS de la clé machine,
// PAS de sa chaîne base64 : `crypto.pbkdf2(this.key as Buffer, …)` (:399).

/** Constantes mesurées sur storageService.ts (lignes 157-172). */
const MACHINE_SALT_LENGTH = 16;
const MACHINE_IV_LENGTH = 16;
const MACHINE_TAG_LENGTH = 16;
const MACHINE_KEY_LENGTH = 32;
const MACHINE_ITERATIONS_V2 = 600000;
const MACHINE_ITERATIONS_V1 = 10000;
const MACHINE_MARKER_LENGTH = 3;
/** Longueur minimale du CORPS acceptée par decryptV2 (:455). */
const MACHINE_MIN_BODY_CHARS =
  (MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH + MACHINE_TAG_LENGTH) * 2 + 2;

const ITERATION_COUNT_NEEDLE = 'private readonly iterationCount: number = 600000;';
const VERSION_2_NEEDLE = "public readonly ENCRYPTION_VERSION_2: string = 'v2:';";

const machineCases = [];
const machineNegativeCases = [];
const machineById = new Map();

/**
 * Redécode un conteneur clé-machine TEXTE depuis la spécification écrite, sans
 * le code de production (même rôle que v3IndependentInspect et
 * manifestIndependentInspect). Ne génère rien : il garantit que les offsets et
 * la clé dérivée publiés dans `params` sont exacts, et il PROUVE par exécution
 * que le mot de passe PBKDF2 est bien constitué des 32 octets bruts.
 */
function machineTextIndependentInspect(containerAscii, passwordBytes, { marker, iterations }) {
  const body = marker === null ? containerAscii : containerAscii.slice(marker.length);
  assert(
    body.length >= MACHINE_MIN_BODY_CHARS,
    `corps de ${body.length} caractères, minimum ${MACHINE_MIN_BODY_CHARS}`
  );
  assert(body.length % 2 === 0, 'longueur de corps impaire : ce n est pas de l hexadécimal');
  assert(/^[0-9a-f]+$/.test(body), 'le corps n est pas intégralement hexadécimal minuscule');

  const saltHex = body.slice(0, MACHINE_SALT_LENGTH * 2);
  const ivHex = body.slice(
    MACHINE_SALT_LENGTH * 2,
    (MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH) * 2
  );
  const tagHex = body.slice(-MACHINE_TAG_LENGTH * 2);
  const ctHex = body.slice((MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH) * 2, -MACHINE_TAG_LENGTH * 2);

  const derivedKey = nodeCrypto.pbkdf2Sync(
    passwordBytes,
    Buffer.from(saltHex, 'hex'),
    iterations,
    MACHINE_KEY_LENGTH,
    'sha512'
  );
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', derivedKey, Buffer.from(ivHex, 'hex'), {
    authTagLength: MACHINE_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return { body, saltHex, ivHex, tagHex, ctHex, derivedKey, plain };
}

/** Même contrôle croisé pour la variante BINAIRE (offsets en OCTETS). */
function machineBinaryIndependentInspect(container, passwordBytes, { marker, iterations }) {
  const offset = marker === null ? 0 : MACHINE_MARKER_LENGTH;
  const body = container.subarray(offset);
  assert(
    body.length >= MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH + MACHINE_TAG_LENGTH,
    'conteneur binaire plus court que son cadrage minimal'
  );
  const salt = body.subarray(0, MACHINE_SALT_LENGTH);
  const iv = body.subarray(MACHINE_SALT_LENGTH, MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH);
  const tag = body.subarray(body.length - MACHINE_TAG_LENGTH);
  const ct = body.subarray(
    MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH,
    body.length - MACHINE_TAG_LENGTH
  );
  const derivedKey = nodeCrypto.pbkdf2Sync(
    passwordBytes,
    salt,
    iterations,
    MACHINE_KEY_LENGTH,
    'sha512'
  );
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', derivedKey, iv, {
    authTagLength: MACHINE_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return { salt, iv, tag, ct, derivedKey, plain, bodyOffset: offset };
}

function pushMachineCase(entry) {
  assert(!machineById.has(entry.id), `identifiant de conteneur machine dupliqué : ${entry.id}`);
  machineById.set(entry.id, entry);
  machineCases.push(entry);
  return entry;
}

/**
 * Produit un conteneur clé-machine TEXTE avec l'ÉCRIVAIN DE PRODUCTION
 * (`encrypt()`, qui sérialise lui-même en JSON), puis le revalide par le
 * LECTEUR DE PRODUCTION de l'instance NON modifiée (`decrypt()`) et par le
 * contrôle croisé indépendant.
 *
 * `stripMarker` reproduit le cas des très vieux profils : le conteneur publié
 * est le "v2:" de production amputé de son préfixe (cf. note 8 de l'en-tête).
 */
async function addMachineTextCase({
  id,
  description,
  contentKind,
  value,
  writer,
  verifier,
  expectedWriterMarker,
  iterations,
  producedBy,
  stripMarker = false,
  extra = {},
}) {
  currentRng = makeRng(`filarr-golden-vectors/v${PACK_VERSION}/machine/${id}`);
  let written;
  try {
    written = await writer.encrypt(value);
  } finally {
    currentRng = null;
  }
  assert(typeof written === 'string', `${id} : encrypt() n a pas rendu une chaîne`);

  // Le marqueur est une ASSERTION sur ce que l'écrivain a produit, jamais une
  // consigne : si la production change d'avis, le script s'arrête.
  const writerMarker = written.slice(0, MACHINE_MARKER_LENGTH);
  assert(
    writerMarker === expectedWriterMarker,
    `${id} : l écrivain de production a produit le marqueur "${writerMarker}" au lieu de ` +
      `"${expectedWriterMarker}" — le cas ne teste pas ce qu il prétend`
  );

  const containerAscii = stripMarker ? written.slice(MACHINE_MARKER_LENGTH) : written;
  const marker = stripMarker ? null : writerMarker;
  const bytes = Buffer.from(containerAscii, 'utf8');
  assert(
    bytes.length === containerAscii.length,
    `${id} : le conteneur texte n est pas purement ASCII — l hypothèse « UTF-8 == ASCII » tombe`
  );

  const json = JSON.stringify(value);
  const payload = Buffer.from(json, 'utf8');

  // Aller-retour 1 : le LECTEUR DE PRODUCTION de l'instance NON modifiée.
  // Pour un "v1:" il emprunte decryptV1 (10 000 tours) ; sans marqueur, le
  // chemin de repli (:437-447). Ces branches ne sont pas atteignables
  // autrement : c'est ce qui prouve la nature réelle du conteneur.
  const back = await verifier.decrypt(containerAscii);
  assert(
    JSON.stringify(back) === json,
    `${id} : decrypt() de production ne retrouve pas le clair`
  );

  // Aller-retour 2 : contrôle croisé indépendant (offsets, clé dérivée, et
  // preuve que le mot de passe est bien les 32 OCTETS BRUTS).
  const inspected = machineTextIndependentInspect(containerAscii, MACHINE_KEY, {
    marker,
    iterations,
  });
  assert(
    Buffer.compare(inspected.plain, payload) === 0,
    `${id} : le contrôle croisé indépendant ne retrouve pas le clair`
  );

  const bodyOffset = marker === null ? 0 : MACHINE_MARKER_LENGTH;
  return pushMachineCase({
    id,
    family: 'machine-key',
    variant: 'text-hex',
    marker,
    iterations,
    contentKind,
    description,
    key: MACHINE_KEY.toString('hex'),
    keyBase64: MACHINE_KEY_B64,
    keyUsage:
      'MOT DE PASSE PBKDF2-SHA512 — les 32 OCTETS BRUTS de la clé machine, JAMAIS sa chaîne base64, et JAMAIS une clé AES directe',
    keySameAs: 'manifests.candidateKeys.machineKeyOfThisPack',
    plaintext: b64(payload),
    plaintextUtf8: json,
    plaintextLength: payload.length,
    plaintextSha256: sha256(payload),
    ciphertext: b64(bytes),
    ciphertextLength: bytes.length,
    sha256: sha256(bytes),
    params: {
      encoding:
        'ASCII hexadécimal minuscule — le conteneur EST une chaîne ; `ciphertext` en base64 porte ses octets UTF-8, qui sont aussi ses octets ASCII',
      markerAscii: marker,
      markerHex: marker === null ? null : Buffer.from(marker, 'ascii').toString('hex'),
      markerLength: bodyOffset,
      bodyOffsetChars: bodyOffset,
      bodyLengthChars: inspected.body.length,
      minBodyLengthChars: MACHINE_MIN_BODY_CHARS,
      saltOffsetChars: bodyOffset,
      saltLengthChars: MACHINE_SALT_LENGTH * 2,
      saltLengthBytes: MACHINE_SALT_LENGTH,
      salt: inspected.saltHex,
      ivOffsetChars: bodyOffset + MACHINE_SALT_LENGTH * 2,
      ivLengthChars: MACHINE_IV_LENGTH * 2,
      ivLengthBytes: MACHINE_IV_LENGTH,
      iv: inspected.ivHex,
      ciphertextOffsetChars: bodyOffset + (MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH) * 2,
      ciphertextLengthChars: inspected.ctHex.length,
      ciphertextLengthBytes: inspected.ctHex.length / 2,
      tagOffsetChars: containerAscii.length - MACHINE_TAG_LENGTH * 2,
      tagLengthChars: MACHINE_TAG_LENGTH * 2,
      tagLengthBytes: MACHINE_TAG_LENGTH,
      tag: inspected.tagHex,
      tagTakenFromEnd:
        'le tag se prend PAR LA FIN (slice(-32)), pas par un champ de longueur — decryptV2 storageService.ts:462',
      kdf: {
        algorithm: 'PBKDF2-SHA512',
        iterations,
        outputLength: MACHINE_KEY_LENGTH,
        saltFrom: 'params.salt',
        password:
          'les 32 octets BRUTS de la clé machine. Une API pbkdf2(password: string) qui encode en UTF-8 donne un autre mot de passe et échoue au tag GCM.',
      },
      derivedKey: inspected.derivedKey.toString('hex'),
      cipher: 'AES-256-GCM',
      aad: 'aucun — ni le marqueur ni l IV ne sont authentifiés comme données associées',
      innerEncoding: 'aucune — le clair chiffré est le JSON UTF-8 brut (|ct| == |clair|)',
    },
    producedBy,
    verifiedBy: [
      'electron/storageService.ts#decrypt (instance NON modifiée)',
      'contrôle croisé indépendant (offsets et clé dérivée relus depuis la spécification)',
    ],
    ...extra,
  });
}

/** Variante BINAIRE : `encryptBinary()` / `decryptBinary()` de production. */
async function addMachineBinaryCase({
  id,
  description,
  contentKind,
  plaintext,
  writer,
  verifier,
  expectedWriterMarker,
  iterations,
  producedBy,
  extra = {},
}) {
  currentRng = makeRng(`filarr-golden-vectors/v${PACK_VERSION}/machine/${id}`);
  let container;
  try {
    container = await writer.encryptBinary(plaintext);
  } finally {
    currentRng = null;
  }
  const writerMarker = container.subarray(0, MACHINE_MARKER_LENGTH).toString('ascii');
  assert(
    writerMarker === expectedWriterMarker,
    `${id} : marqueur binaire "${writerMarker}" au lieu de "${expectedWriterMarker}"`
  );

  const back = await verifier.decryptBinary(container);
  assert(
    Buffer.compare(back, plaintext) === 0,
    `${id} : decryptBinary() de production ne retrouve pas le clair`
  );

  const inspected = machineBinaryIndependentInspect(container, MACHINE_KEY, {
    marker: writerMarker,
    iterations,
  });
  assert(
    Buffer.compare(inspected.plain, plaintext) === 0,
    `${id} : le contrôle croisé indépendant ne retrouve pas le clair`
  );

  return pushMachineCase({
    id,
    family: 'machine-key',
    variant: 'binary',
    marker: writerMarker,
    iterations,
    contentKind,
    description,
    key: MACHINE_KEY.toString('hex'),
    keyBase64: MACHINE_KEY_B64,
    keyUsage:
      'MOT DE PASSE PBKDF2-SHA512 — les 32 OCTETS BRUTS de la clé machine, JAMAIS sa chaîne base64, et JAMAIS une clé AES directe',
    keySameAs: 'manifests.candidateKeys.machineKeyOfThisPack',
    plaintext: b64(plaintext),
    plaintextLength: plaintext.length,
    plaintextSha256: sha256(plaintext),
    ciphertext: b64(container),
    ciphertextLength: container.length,
    sha256: sha256(container),
    params: {
      encoding: 'octets bruts — aucun hexadécimal',
      markerAscii: writerMarker,
      markerHex: Buffer.from(writerMarker, 'ascii').toString('hex'),
      markerLength: MACHINE_MARKER_LENGTH,
      saltOffset: MACHINE_MARKER_LENGTH,
      saltLength: MACHINE_SALT_LENGTH,
      salt: inspected.salt.toString('hex'),
      ivOffset: MACHINE_MARKER_LENGTH + MACHINE_SALT_LENGTH,
      ivLength: MACHINE_IV_LENGTH,
      iv: inspected.iv.toString('hex'),
      ciphertextOffset: MACHINE_MARKER_LENGTH + MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH,
      ciphertextLength: inspected.ct.length,
      tagOffset: container.length - MACHINE_TAG_LENGTH,
      tagLength: MACHINE_TAG_LENGTH,
      tag: inspected.tag.toString('hex'),
      tagTakenFromEnd:
        'le tag se prend PAR LA FIN (slice(-16)) — decryptBinaryV2 storageService.ts:586',
      kdf: {
        algorithm: 'PBKDF2-SHA512',
        iterations,
        outputLength: MACHINE_KEY_LENGTH,
        saltFrom: 'params.salt',
        password: 'les 32 octets BRUTS de la clé machine',
      },
      derivedKey: inspected.derivedKey.toString('hex'),
      cipher: 'AES-256-GCM',
      aad: 'aucun',
      innerEncoding: 'aucune — |ct| == |clair|',
    },
    producedBy,
    verifiedBy: [
      'electron/storageService.ts#decryptBinary (instance NON modifiée)',
      'contrôle croisé indépendant (offsets et clé dérivée relus depuis la spécification)',
    ],
    ...extra,
  });
}

/**
 * Remplace un caractère hexadécimal par un AUTRE caractère hexadécimal valide.
 *
 * Sur la variante TEXTE, écrire un octet quelconque produirait de l'hexadécimal
 * INVALIDE, que `Buffer.from(x, 'hex')` tronque silencieusement : le cas
 * négatif testerait alors le décodage, pas l'authentification. Ici le
 * conteneur reste parfaitement bien formé — seule sa valeur change.
 */
function flipHexCharMutation(container, offset) {
  const c = String.fromCharCode(container[offset]);
  assert(/[0-9a-f]/.test(c), `l offset ${offset} n est pas un caractère hexadécimal (${c})`);
  const replacement = c === '0' ? '1' : '0';
  return { op: 'setByte', offset, value: replacement.charCodeAt(0) };
}

/** Cas négatif par MUTATION d'un conteneur clé-machine : doit être rejeté. */
async function addMachineNegativeMutation({ id, baseCase, description, mutations, verifier }) {
  const base = machineById.get(baseCase);
  assert(base, `${id} : conteneur clé-machine de base introuvable (${baseCase})`);
  const mutated = applyMutations(Buffer.from(base.ciphertext, 'base64'), mutations);

  let observedError = null;
  try {
    if (base.variant === 'text-hex') {
      await verifier.decrypt(mutated.toString('utf8'));
    } else {
      await verifier.decryptBinary(mutated);
    }
  } catch (error) {
    observedError = error.message;
  }
  assert(
    observedError !== null,
    `${id} : le lecteur de production a ACCEPTÉ un conteneur altéré — le cas négatif est invalide`
  );

  machineNegativeCases.push({
    id,
    kind: 'mutation',
    baseCase,
    variant: base.variant,
    description,
    key: MACHINE_KEY.toString('hex'),
    mutations,
    expect: 'reject',
    mutatedSha256: sha256(mutated),
    mutatedLength: mutated.length,
    expectedErrorDesktop: observedError,
    verifiedBy:
      base.variant === 'text-hex'
        ? 'electron/storageService.ts#decrypt'
        : 'electron/storageService.ts#decryptBinary',
  });
}

// ---------------------------------------------------------------------------
// Cas négatifs (recettes de mutation, sans octets supplémentaires)
// ---------------------------------------------------------------------------

function applyMutations(buffer, mutations) {
  let out = Buffer.from(buffer);
  for (const m of mutations) {
    if (m.op === 'setByte') {
      out[m.offset] = m.value;
    } else if (m.op === 'truncate') {
      out = out.subarray(0, m.length);
    } else if (m.op === 'swapRanges') {
      const a = Buffer.from(out.subarray(m.a.offset, m.a.offset + m.a.length));
      const b = Buffer.from(out.subarray(m.b.offset, m.b.offset + m.b.length));
      b.copy(out, m.a.offset);
      a.copy(out, m.b.offset);
    } else {
      throw new Error(`mutation inconnue : ${m.op}`);
    }
  }
  return Buffer.from(out);
}

async function addNegativeCase({ id, baseCase, description, mutations, reader }) {
  const base = byId.get(baseCase);
  assert(base, `${id} : cas de base introuvable (${baseCase})`);
  const mutated = applyMutations(Buffer.from(base.ciphertext, 'base64'), mutations);

  let rejected = false;
  let observedError = null;
  try {
    if (reader === 'marked') {
      hybridBlobCrypto.decryptHybridFekBlob(mutated, [KEY]);
    } else {
      const dest = tmpFile(`${id}.v3`);
      fs.writeFileSync(dest, mutated);
      try {
        await streamCrypto.decryptFileToBufferV3(KEY, dest, 1024 * 1024 * 1024);
      } finally {
        fs.rmSync(dest, { force: true });
      }
    }
  } catch (error) {
    rejected = true;
    observedError = error.message;
  }
  assert(
    rejected,
    `${id} : le lecteur de production a ACCEPTÉ un blob altéré — le cas négatif est invalide`
  );

  negativeCases.push({
    id,
    baseCase,
    description,
    key: KEY_HEX,
    mutations,
    expect: 'reject',
    expectedErrorDesktop: observedError,
    mutatedSha256: sha256(mutated),
    mutatedLength: mutated.length,
    verifiedBy:
      reader === 'marked'
        ? 'electron/hybridBlobCrypto.ts#decryptHybridFekBlob'
        : 'electron/streamCrypto.ts#decryptFileToBufferV3',
  });
}

// ---------------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------------

async function main() {
  const utf8 = (s) => Buffer.from(s, 'utf8');

  // ── V1 : marqueur 0x01, clair non compressé ──────────────────────────────
  await addMarkedCase({
    id: 'v1-empty',
    expectedFormat: 'V1',
    description:
      'Fichier de 0 octet en V1. Blob de 29 octets = marqueur(1) + IV(12) + tag(16), aucun ciphertext.',
    plaintext: Buffer.alloc(0),
  });
  await addMarkedCase({
    id: 'v1-short-text',
    expectedFormat: 'V1',
    description:
      'Texte UTF-8 court (accents inclus) sous le seuil de compression de 1024 octets : écrit en V1.',
    plaintext: utf8('Bonjour, coffre-fort. Éàü — 0123456789'),
  });
  await addMarkedCase({
    id: 'v1-single-byte',
    expectedFormat: 'V1',
    description: 'Clair d un seul octet (0x00) : borne basse non vide.',
    plaintext: Buffer.from([0x00]),
  });
  await addMarkedCase({
    id: 'v1-compression-loses',
    expectedFormat: 'V1',
    description:
      'Clair pseudo-aléatoire de 4096 octets (incompressible) : au-dessus du seuil, l écrivain tente deflate, constate que deflate(x)+1 >= x et retombe en V1.',
    plaintext: prngBytes('v1-compression-loses', 4096),
  });
  await addMarkedCase({
    id: 'v1-precompressed-magic',
    expectedFormat: 'V1',
    description:
      'Clair très compressible mais préfixé du magic PNG (89 50 4E 47) : la détection de contenu déjà compressé bloque la compression, donc V1 malgré 4096 octets répétitifs.',
    plaintext: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(4088, 0x41),
    ]),
  });
  await addMarkedCase({
    id: 'v1-compression-disabled',
    expectedFormat: 'V1',
    description:
      'Clair très compressible de 4096 octets avec compress:false : l appelant désactive la compression, donc V1.',
    plaintext: Buffer.alloc(4096, 0x5a),
    options: { compress: false },
  });

  // ── V2 : marqueur 0x02, clair déflaté (flux zlib RFC-1950) ───────────────
  await addMarkedCase({
    id: 'v2-highly-compressible',
    expectedFormat: 'V2',
    description:
      'Clair de 4096 octets identiques : deflate gagne largement, écrit en V2. Le ciphertext est bien plus court que le clair — piège classique si le lecteur suppose |ct| == |clair|.',
    plaintext: Buffer.alloc(4096, 0x41),
  });
  await addMarkedCase({
    id: 'v2-repetitive-text',
    expectedFormat: 'V2',
    description:
      'Texte JSON répétitif réaliste au-dessus du seuil de 1024 octets : écrit en V2 (zlib RFC-1950, niveau 5).',
    plaintext: utf8('{"note":"contenu de test Filarr","index":0,"tags":["a","b","c"]}\n'.repeat(40)),
  });
  await addMarkedCase({
    id: 'v2-just-above-threshold',
    expectedFormat: 'V2',
    description:
      'Clair de 1024 octets exactement (COMPRESSION_MIN_BYTES) et compressible : borne basse d activation de la compression.',
    plaintext: utf8('filarr'.repeat(171)).subarray(0, 1024),
  });
  await addMarkedCase({
    id: 'v2-large-mixed',
    expectedFormat: 'V2',
    description:
      'Clair de 65536 octets mêlant texte répétitif et zones nulles : V2 sur une charge non triviale.',
    plaintext: Buffer.concat([
      utf8('ligne de journal filarr — sync ok\n'.repeat(1000)).subarray(0, 32768),
      Buffer.alloc(32768, 0x00),
    ]),
  });

  // ── V0 : héritée, sans marqueur (le mobile écrit encore ce format) ───────
  await addLegacyV0Case({
    id: 'v0-empty',
    description:
      'Fichier de 0 octet en V0 : 28 octets exactement (IV 12 + tag 16), soit la longueur minimale acceptée par le lecteur.',
    plaintext: Buffer.alloc(0),
  });
  await addLegacyV0Case({
    id: 'v0-short-text',
    description: 'Texte UTF-8 court en V0 : IV à l offset 0, aucun marqueur.',
    plaintext: utf8('Bonjour, coffre-fort. Éàü — 0123456789'),
  });
  await addLegacyV0Case({
    id: 'v0-binary-seeded',
    description: 'Clair binaire pseudo-aléatoire de 3000 octets en V0.',
    plaintext: prngBytes('v0-binary-seeded', 3000),
  });
  await addLegacyV0Case({
    id: 'v0-iv-starts-with-0x01',
    description:
      'V0 dont l IV commence par 0x01 : le premier octet ressemble au marqueur V1. Le lecteur DOIT tenter la lecture marquée, échouer à l authentification GCM, puis se rabattre sur V0. Sans ce repli, ~0,4 % des V0 deviennent illisibles.',
    plaintext: utf8('repli V0 obligatoire — IV commencant par 0x01'),
    ivFirstByte: 0x01,
  });
  await addLegacyV0Case({
    id: 'v0-iv-starts-with-0x02',
    description:
      'V0 dont l IV commence par 0x02 : le lecteur tente la lecture marquée V2 (donc GCM puis inflate) et doit se rabattre sur V0. Un lecteur qui remonte l erreur d inflate au lieu de continuer casse ce cas.',
    plaintext: utf8('repli V0 obligatoire — IV commencant par 0x02'),
    ivFirstByte: 0x02,
  });

  // ── V3 : conteneur FILARRENCV3, chunkSize de production (8 MiB) ──────────
  await addV3Case({
    id: 'v3-empty',
    description:
      'Fichier V3 vide : origSize = 0 mais UN chunk vide authentifié, donc 66 octets exactement (50 + 16). Une boucle "for i in 0..ceil(0/chunkSize)" ne ferait aucun tour et accepterait un fichier tronqué.',
    plaintext: Buffer.alloc(0),
  });
  await addV3Case({
    id: 'v3-single-byte',
    description: 'Fichier V3 d un seul octet : 67 octets (50 + 16 + 1), un chunk.',
    plaintext: Buffer.from([0x2a]),
  });
  await addV3Case({
    id: 'v3-small-text',
    description:
      'Texte UTF-8 en V3, très en dessous du chunk : chunkSize de l en-tête = 8388608 (valeur de production), un seul chunk.',
    plaintext: utf8('Contenu V3 de reference — accents : éèàùç — fin.'),
  });
  await addV3Case({
    id: 'v3-seeded-binary-5000',
    description:
      'Clair binaire pseudo-aléatoire de 5000 octets en V3 (V3 ne compresse jamais : |ciphertext| == |clair| par chunk).',
    plaintext: prngBytes('v3-seeded-binary-5000', 5000),
  });

  // ── V3 : chunkSize de 64 KiB (multi-chunks, cf. note 3) ──────────────────
  await addV3Case({
    id: 'v3-cs64k-exactly-one-chunk',
    description:
      'chunkSize = 65536 et origSize = 65536 : exactement UN chunk plein (ceil(65536/65536) = 1). Total 65602 octets.',
    plaintext: prngBytes('v3-cs64k-exactly-one-chunk', 65536),
    small: true,
  });
  await addV3Case({
    id: 'v3-cs64k-one-byte-over',
    description:
      'chunkSize = 65536 et origSize = 65537 : deux chunks, le dernier ne fait qu un octet. Vérifie l indexation et la longueur du dernier chunk.',
    plaintext: prngBytes('v3-cs64k-one-byte-over', 65537),
    small: true,
  });
  await addV3Case({
    id: 'v3-cs64k-exact-multiple',
    description:
      'chunkSize = 65536 et origSize = 131072 (multiple exact non nul) : DEUX chunks dont le dernier fait chunkSize entier, PAS zéro. Un calcul en modulo naïf donne 0 et désynchronise toutes les positions.',
    plaintext: prngBytes('v3-cs64k-exact-multiple', 131072),
    small: true,
  });
  await addV3Case({
    id: 'v3-cs64k-three-chunks',
    description:
      'chunkSize = 65536 et origSize = 131079 : TROIS chunks (65536, 65536, 7). Le seul cas du pack où l index de chunk dépasse 1 dans le nonce et l AAD — il attrape les erreurs de boutisme sur l index.',
    plaintext: prngBytes('v3-cs64k-three-chunks', 131079),
    small: true,
  });
  // ── Cas négatifs : le lecteur doit REJETER, pas rendre des octets faux ───
  const v1Short = byId.get('v1-short-text');
  await addNegativeCase({
    id: 'neg-v1-tampered-tag',
    baseCase: 'v1-short-text',
    description:
      'Dernier octet du tag GCM inversé : l authentification doit échouer, puis le repli V0 échouer aussi, et le lecteur lever une erreur.',
    mutations: [
      {
        op: 'setByte',
        offset: v1Short.ciphertextLength - 1,
        value: Buffer.from(v1Short.ciphertext, 'base64')[v1Short.ciphertextLength - 1] ^ 0xff,
      },
    ],
    reader: 'marked',
  });
  await addNegativeCase({
    id: 'neg-v1-marker-flipped-to-v2',
    baseCase: 'v1-compression-loses',
    description:
      'Marqueur 0x01 remplacé par 0x02 : le GCM authentifie (le marqueur n est couvert par aucun AAD) mais le clair obtenu n est pas un flux zlib. Le lecteur doit alors CONTINUER vers la tentative suivante (repli V0), qui échoue à son tour, et lever une erreur. Un lecteur qui remonterait l erreur d inflate immédiatement rendrait illisibles les vrais V0 dont l IV commence par 0x02.',
    mutations: [{ op: 'setByte', offset: 0, value: 0x02 }],
    reader: 'marked',
  });
  await addNegativeCase({
    id: 'neg-v3-truncated-one-byte',
    baseCase: 'v3-small-text',
    description:
      'Conteneur V3 amputé d un octet : la longueur totale attendue (50 + n*16 + origSize) n est plus une égalité stricte, le lecteur doit rejeter AVANT toute allocation ou déchiffrement.',
    mutations: [
      { op: 'truncate', length: byId.get('v3-small-text').ciphertextLength - 1 },
    ],
    reader: 'v3',
  });
  await addNegativeCase({
    id: 'neg-v3-bad-version',
    baseCase: 'v3-small-text',
    description:
      'Octet de version de l en-tête V3 porté à 4 : le lecteur doit rejeter (seule la valeur 3 est acceptée).',
    mutations: [{ op: 'setByte', offset: 12, value: 4 }],
    reader: 'v3',
  });
  await addNegativeCase({
    id: 'neg-v3-reserved-not-zero',
    baseCase: 'v3-small-text',
    description:
      'Octet réservé de l en-tête V3 porté à 1 : le lecteur doit rejeter (le champ réservé DOIT valoir 0).',
    mutations: [{ op: 'setByte', offset: 13, value: 1 }],
    reader: 'v3',
  });
  await addNegativeCase({
    id: 'neg-v3-swapped-chunks',
    baseCase: 'v3-cs64k-exact-multiple',
    description:
      'Chunks 0 et 1 échangés (ciphertext + tag) : l AAD lie l index du chunk, donc l authentification doit échouer. Un lecteur qui ignorerait l index dans l AAD ou le nonce rendrait un fichier mélangé sans erreur.',
    mutations: [
      {
        op: 'swapRanges',
        a: { offset: 50, length: SMALL_CHUNK_SIZE + 16 },
        b: { offset: 50 + SMALL_CHUNK_SIZE + 16, length: SMALL_CHUNK_SIZE + 16 },
      },
    ],
    reader: 'v3',
  });

  // ── Contrôle hors pack : V3 multi-chunks à la taille de production ───────
  // Non embarqué (plus de 22 Mo en base64) mais EXÉCUTÉ à chaque génération,
  // pour prouver que la variante 64 KiB ne masque pas un comportement propre
  // au chunkSize de 8 MiB.
  const bigSize = 8 * 1024 * 1024 + 1;
  const bigPlain = Buffer.alloc(bigSize);
  prngBytes('oversized-8mib-plus-1', 65536).copy(bigPlain, 0);
  bigPlain[bigSize - 1] = 0xff;
  const bigDest = tmpFile('oversized.v3');
  currentRng = makeRng(`filarr-golden-vectors/v${PACK_VERSION}/v3/oversized-8mib-plus-1`);
  try {
    await streamCrypto.encryptBufferToFileV3(KEY, bigPlain, bigDest);
  } finally {
    currentRng = null;
  }
  const bigContainer = fs.readFileSync(bigDest);
  const bigStat = await streamCrypto.statV3File(bigDest);
  const bigBack = await streamCrypto.decryptFileToBufferV3(KEY, bigDest, 64 * 1024 * 1024);
  assert(Buffer.compare(bigBack, bigPlain) === 0, 'contrôle hors pack : aller-retour V3 8 MiB');
  const bigInspected = v3IndependentInspect(bigContainer, KEY);
  assert(
    Buffer.compare(bigInspected.plaintext, bigPlain) === 0,
    'contrôle hors pack : contrôle croisé indépendant 8 MiB'
  );
  assert(bigStat.nChunks === 2, 'contrôle hors pack : 2 chunks attendus');
  assert(
    bigContainer.length === 50 + 2 * 16 + bigSize,
    'contrôle hors pack : longueur totale inattendue'
  );
  fs.rmSync(bigDest, { force: true });

  const oversizedRoundTrip = {
    id: 'v3-8mib-plus-1-two-chunks',
    embedded: false,
    reason:
      'Un vecteur multi-chunks à la taille de chunk de production (8 MiB) pèserait plus de 22 Mo en base64 dans ce fichier. Il est régénéré et vérifié à CHAQUE exécution du générateur, mais pas embarqué. Les cas v3-cs64k-* couvrent la même logique multi-chunks avec un chunkSize légal de 65536.',
    chunkSize: bigStat.chunkSize,
    origSize: bigSize,
    nChunks: bigStat.nChunks,
    ciphertextLength: bigContainer.length,
    ciphertextSha256: sha256(bigContainer),
    plaintextSha256: sha256(bigPlain),
    plaintextRecipe:
      'Buffer de 8388609 octets à zéro ; les 65536 premiers octets remplacés par prng("oversized-8mib-plus-1", 65536) ; dernier octet = 0xff.',
    header: bigInspected.header,
    verified: true,
  };

  // ── Manifestes de synchronisation ────────────────────────────────────────
  // Écrivain de production, instance NON modifiée.
  const storage = await initStorageService('manifest-prod');
  // Instance à seuil de compression neutralisé (note 6) : sert UNIQUEMENT à
  // produire le pendant `fek:` du manifeste réaliste.
  const storagePlainOnly = await initStorageService('manifest-plain', (source, abs) => {
    const occurrences = source.split(COMPRESS_MIN_NEEDLE).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `${abs} : le seuil de compression du manifeste a changé (${occurrences} occurrence(s) de ` +
          `"${COMPRESS_MIN_NEEDLE}"). Le script doit être remis à jour AVANT de régénérer le pack.`
      );
    }
    return source.replace(
      COMPRESS_MIN_NEEDLE,
      'private static readonly FEK_COMPRESS_MIN_BYTES = Number.MAX_SAFE_INTEGER;'
    );
  });

  const PROFILE_ID = 'a3f1c9d2-0000-4000-8000-0123456789ab';

  // 1. Manifeste vide — exactement ce que syncManifest.createEmpty() produit
  //    pour un profil neuf : pas de fichiers, pas de notes, PAS de clé.
  await addManifestJsonCase({
    id: 'manifest-fek-empty',
    description:
      'Manifeste vide (profil neuf) : files et notes à {}, aucun champ encryptionKey. Sous le seuil de 256 octets, donc marqueur "fek:" et clair non compressé. Cas de dégradation obligatoire : le mobile doit fonctionner SANS clé candidate supplémentaire.',
    manifest: {
      version: 0,
      profileId: PROFILE_ID,
      lastSyncAt: '2026-08-06T09:15:30.000Z',
      files: {},
      notes: {},
    },
    expectedMarker: 'fek:',
    writer: storage,
    producedBy: 'electron/storageService.ts#encryptWithFEK',
    extra: {
      encryptionKeyPresent: false,
      candidateKeys: [KEY_HEX],
      candidateKeysNote:
        'encryptionKey absent : la seule clé candidate est la FEK. Le mobile doit dégrader proprement (lister le fichier, marquer « clé indisponible »), jamais afficher d octets non authentifiés.',
    },
  });

  // 2. Manifeste minimal PORTEUR DE LA CLÉ CANDIDATE.
  await addManifestJsonCase({
    id: 'manifest-fek-minimal',
    description:
      'Manifeste minimal mais porteur du champ racine encryptionKey (base64 des 32 octets de la clé MACHINE, posé par syncService.ts:616). Toujours sous le seuil de 256 octets, donc "fek:". C est LE cas qui alimente la liste de clés candidates du mobile.',
    manifest: {
      version: 1,
      profileId: PROFILE_ID,
      lastSyncAt: '2026-08-06T09:15:30.000Z',
      files: {},
      notes: {},
      encryptionKey: MACHINE_KEY_B64,
    },
    expectedMarker: 'fek:',
    writer: storage,
    producedBy: 'electron/storageService.ts#encryptWithFEK',
    extra: {
      encryptionKeyPresent: true,
      encryptionKeyBase64: MACHINE_KEY_B64,
      candidateKeys: [KEY_HEX, MACHINE_KEY.toString('hex')],
      candidateKeysNote:
        'Ordre attendu côté mobile : FEK d abord, clé machine ensuite (le contenu lu est du contenu CLOUD, majoritairement FEK). L ordre ne joue que sur la latence : une mauvaise clé échoue le tag GCM, jamais de sortie corrompue.',
    },
  });

  // 3/4. Manifeste RÉALISTE, publié dans ses DEUX conteneurs sur le même clair.
  const realisticManifest = {
    version: 187,
    profileId: PROFILE_ID,
    lastSyncAt: '2026-08-06T09:15:30.000Z',
    files: {
      // Fichier normal : fileId = sha256(`${folderId}/${fileName}`).hex.slice(0,32)
      '1f0a2b3c4d5e6f708192a3b4c5d6e7f8': {
        checksum: 'b8f1c0a9d3e2f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3',
        size: 1048608,
        updatedAt: '2026-08-05T18:22:11.000Z',
        syncedAt: '2026-08-05T18:22:14.000Z',
        chunks: ['users/u-1/profiles/p-1/files/1f0a2b3c4d5e6f708192a3b4c5d6e7f8'],
        status: 'synced',
        localPath: 'fld-photos/vacances-2026.jpg',
        plaintextChecksum: '0011223344556677889900aabbccddeeff00112233445566778899aabbccddee',
      },
      // Fichier stocké en blocs adressables par contenu : chunks vide + delta.
      'aa11bb22cc33dd44ee55ff6677889900': {
        checksum: '99aabbccddeeff00112233445566778899aabbccddeeff001122334455667788',
        size: 268435552,
        updatedAt: '2026-08-04T07:00:00.000Z',
        syncedAt: '2026-08-04T07:03:42.000Z',
        chunks: [],
        status: 'synced',
        localPath: 'fld-archives/sauvegarde.tar',
        plaintextChecksum: 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100',
        delta: { version: 4, blockCount: 512 },
      },
      // Entrée supprimée : le desktop pousse aussi les 'deleted'.
      'cc99dd88ee77ff6655443322110099aa': {
        checksum: '',
        size: 0,
        updatedAt: '2026-08-03T12:00:00.000Z',
        syncedAt: '2026-08-03T12:00:05.000Z',
        chunks: [],
        status: 'deleted',
        localPath: 'fld-photos/ancienne.png',
      },
      // Métadonnées de dossier : le chunk est un `{folderId}/metadata.json`
      // chiffré par StorageService.encrypt() — famille 'v2:' PBKDF2-SHA512
      // sous la CLÉ MACHINE, hors périmètre du lecteur de blobs.
      'meta:fld-photos': {
        checksum: '4455667788990011aabbccddeeff00112233445566778899aabbccddeeff0011',
        size: 812,
        updatedAt: '2026-08-05T18:22:12.000Z',
        syncedAt: '2026-08-05T18:22:15.000Z',
        chunks: ['users/u-1/profiles/p-1/files/meta:fld-photos'],
        status: 'synced',
        localPath: 'fld-photos/metadata.json',
      },
      // Bundle de notes : le chunk est `notes.enc`, même famille 'v2:'.
      'meta:notes': {
        checksum: '778899aabbccddeeff00112233445566778899aabbccddeeff001122334455667',
        size: 5310,
        updatedAt: '2026-08-05T20:41:03.000Z',
        syncedAt: '2026-08-05T20:41:07.000Z',
        chunks: ['users/u-1/profiles/p-1/files/meta:notes'],
        status: 'synced',
        localPath: 'notes.enc',
      },
    },
    // CHAMP MORT côté desktop : déclaré, initialisé à {}, jamais écrit.
    notes: {},
    profileMeta: {
      id: PROFILE_ID,
      name: 'Perso',
      avatarColor: '#c96f4a',
      avatarEmoji: '🦊',
      isDefault: true,
      order: 0,
      createdAt: '2026-01-12T08:00:00.000Z',
      pinHash: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
      pinSalt: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
      allowPinReset: true,
      pinUpdatedAt: '2026-06-30T21:10:00.000Z',
    },
    encryptionKey: MACHINE_KEY_B64,
  };

  const realisticExtra = {
    encryptionKeyPresent: true,
    encryptionKeyBase64: MACHINE_KEY_B64,
    candidateKeys: [KEY_HEX, MACHINE_KEY.toString('hex')],
    candidateKeysNote:
      'Le mobile doit décoder encryptionKey en base64 et l ajouter APRÈS la FEK dans la liste passée à decryptBlobSync / decryptV3Stream. Sous 500 Mo, un conteneur V3 part au cloud sans sonde de portabilité : sans cette clé, une part inconnue des fichiers est illisible.',
  };

  await addManifestJsonCase({
    id: 'manifest-fkz-realistic',
    description:
      'Manifeste réaliste (5 entrées : fichier normal, fichier delta, entrée supprimée, metadata de dossier, bundle de notes) avec profileMeta et encryptionKey. Au-dessus du seuil de 256 octets ET compressible : l écrivain de production choisit "fkz:" et le clair chiffré est un flux zlib RFC-1950. C est le format qu un compte desktop actif présente réellement.',
    manifest: realisticManifest,
    expectedMarker: 'fkz:',
    writer: storage,
    producedBy: 'electron/storageService.ts#encryptWithFEK',
    extra: realisticExtra,
  });

  await addManifestJsonCase({
    id: 'manifest-fek-realistic',
    description:
      'EXACTEMENT le même clair que manifest-fkz-realistic, mais écrit en "fek:" (clair non compressé). C est ce que le MOBILE produit : manifestCrypto.encryptManifestBytes écrit toujours "fek:", quelle que soit la taille. Ce vecteur prouve que le desktop relit un gros "fek:" et donne au mobile sa cible de conformité en écriture.',
    manifest: realisticManifest,
    expectedMarker: 'fek:',
    writer: storagePlainOnly,
    producedBy:
      'electron/storageService.ts#encryptWithFEK (FEK_COMPRESS_MIN_BYTES neutralisé — cf. note 6 du générateur)',
    extra: {
      ...realisticExtra,
      samePlaintextAs: 'manifest-fkz-realistic',
      writerCompressionThresholdOverridden: true,
    },
  });

  // Les deux conteneurs réalistes portent-ils bien le MÊME clair ?
  assert(
    manifestById.get('manifest-fkz-realistic').plaintextSha256 ===
      manifestById.get('manifest-fek-realistic').plaintextSha256,
    'les deux conteneurs réalistes ne portent pas le même clair'
  );
  // Le conteneur `fek:` est-il bien relu par l instance NON modifiée ?
  {
    const forced = Buffer.from(manifestById.get('manifest-fek-realistic').ciphertext, 'base64');
    const back = await storage.decryptManifestAuto(forced);
    assert(
      sha256(back) === manifestById.get('manifest-fek-realistic').plaintextSha256,
      'le conteneur fek: forcé n est pas relu par le lecteur de production non modifié'
    );
  }

  // 5-7. Règle de choix du marqueur, mesurée aux bornes (charges utiles BRUTES,
  //      pas des manifestes : elles ne servent qu à figer la règle de l écrivain).
  await addManifestCase({
    id: 'manifest-fek-threshold-255',
    description:
      'Charge utile de 255 octets identiques (0x41), donc très compressible mais SOUS FEK_COMPRESS_MIN_BYTES (256) : deflate n est même pas tenté, marqueur "fek:".',
    payload: Buffer.alloc(255, 0x41),
    payloadKind: 'raw',
    expectedMarker: 'fek:',
    writer: storage,
    producedBy: 'electron/storageService.ts#encryptWithFEK',
  });
  await addManifestCase({
    id: 'manifest-fkz-threshold-256',
    description:
      'Charge utile de 256 octets identiques (0x41) : au seuil exact, deflate est tenté, il gagne, marqueur "fkz:". Borne basse d activation de la compression.',
    payload: Buffer.alloc(256, 0x41),
    payloadKind: 'raw',
    expectedMarker: 'fkz:',
    writer: storage,
    producedBy: 'electron/storageService.ts#encryptWithFEK',
  });
  await addManifestCase({
    id: 'manifest-fek-256-incompressible',
    description:
      'Charge utile de 256 octets pseudo-aléatoires : au-dessus du seuil, deflate est tenté mais PERD des octets, donc "fkz:" n est pas retenu et le marqueur reste "fek:". Un lecteur qui déduirait le marqueur de la seule taille se trompe.',
    payload: prngBytes('manifest-fek-256-incompressible', 256),
    payloadKind: 'raw',
    expectedMarker: 'fek:',
    writer: storage,
    producedBy: 'electron/storageService.ts#encryptWithFEK',
  });

  // ── Cas négatifs de manifeste ────────────────────────────────────────────
  const minimalContainer = Buffer.from(manifestById.get('manifest-fek-minimal').ciphertext, 'base64');

  await addManifestNegativeMutation({
    id: 'neg-manifest-prefix-altered',
    baseCase: 'manifest-fek-minimal',
    description:
      'Quatrième octet du marqueur altéré : "fek:" devient "fek!". Aucun marqueur connu ne correspond. Le lecteur strict lève immédiatement ; decryptManifestAuto, lui, retombe sur le chemin hérité clé-machine (deux PBKDF2-SHA512, 600k puis 10k) et échoue plus tard et plus cher. Côté mobile, le repli sur la forme nue décale l IV de 0 et le GCM échoue : rejet attendu.',
    mutations: [{ op: 'setByte', offset: 3, value: 0x21 }],
    writer: storage,
  });

  await addManifestNegativeMutation({
    id: 'neg-manifest-tag-altered',
    baseCase: 'manifest-fek-minimal',
    description:
      'Dernier octet du tag GCM inversé : le marqueur reste valide, l authentification doit échouer. Le lecteur doit lever, JAMAIS rendre le clair partiel.',
    mutations: [
      {
        op: 'setByte',
        offset: minimalContainer.length - 1,
        value: minimalContainer[minimalContainer.length - 1] ^ 0xff,
      },
    ],
    writer: storage,
  });

  await addManifestNegativeMutation({
    id: 'neg-manifest-marker-flipped-to-fkz',
    baseCase: 'manifest-fek-minimal',
    description:
      'Marqueur "fek:" réécrit en "fkz:" : le marqueur n est couvert par aucun AAD, donc le GCM AUTHENTIFIE et rend le JSON brut — mais l inflate zlib échoue derrière. Le lecteur doit continuer vers la tentative suivante puis lever ; il ne doit JAMAIS rendre les octets non inflatés, sinon un manifeste nu dont l IV commence par "fkz:" devient illisible pour toujours.',
    mutations: [
      { op: 'setByte', offset: 1, value: 0x6b },
      { op: 'setByte', offset: 2, value: 0x7a },
    ],
    writer: storage,
  });

  await addManifestNegativeMutation({
    id: 'neg-manifest-truncated-to-marker',
    baseCase: 'manifest-fek-minimal',
    description:
      'Conteneur tronqué à ses 4 octets de marqueur : plus d IV, plus de ciphertext, plus de tag. Le lecteur doit rejeter sur la longueur, avant toute tentative de déchiffrement.',
    mutations: [{ op: 'truncate', length: 4 }],
    writer: storage,
  });

  await addManifestNegativeInvalidJson({
    id: 'neg-manifest-inner-json-invalid',
    description:
      'Conteneur "fek:" PARFAITEMENT VALIDE dont le clair n est pas du JSON (objet tronqué). C est le second vecteur d empoisonnement du desktop : syncService.ts:506 déchiffre sans erreur puis JSON.parse (507) lève, le cycle est avorté et le manifeste n est jamais réécrit. Contrat attendu du mobile : le déchiffrement RÉUSSIT et rend exactement ces octets ; c est l analyse JSON qui doit lever, avec une erreur DISTINCTE de « manifeste illisible ».',
    payload: Buffer.from('{"version":1,"profileId":"p-json-casse","files":{', 'utf8'),
    expectedMarker: 'fek:',
    writer: storage,
  });

  const manifestCasesDigest = sha256(
    Buffer.from(manifestCases.map((c) => `${c.id}:${c.sha256}`).join('\n'), 'utf8')
  );

  // ── Conteneurs CLÉ MACHINE (famille "v2:" / "v1:") ───────────────────────
  //
  // `storage` est l'instance de production NON modifiée : elle écrit ET relit
  // tous ces cas, sauf le "v1:" hérité, écrit par une troisième instance dont
  // deux constantes sont neutralisées (note 7) et relu par `storage`.

  const storageLegacyV1 = await initStorageService('machine-v1', (source, abs) => {
    for (const needle of [ITERATION_COUNT_NEEDLE, VERSION_2_NEEDLE]) {
      const occurrences = source.split(needle).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `${abs} : la constante de la famille clé-machine a changé (${occurrences} occurrence(s) ` +
            `de "${needle}"). Le script doit être remis à jour AVANT de régénérer le pack.`
        );
      }
    }
    return source
      .replace(ITERATION_COUNT_NEEDLE, `private readonly iterationCount: number = ${MACHINE_ITERATIONS_V1};`)
      .replace(VERSION_2_NEEDLE, "public readonly ENCRYPTION_VERSION_2: string = 'v1:';");
  });

  // Le clair de {folderId}/metadata.json : JSON.stringify(Folder), interface
  // storageService.ts:33-45 (items :50-67, reminders :72-91).
  const realisticFolder = {
    id: 'fld-photos',
    name: 'Photos',
    color: '#c96f4a',
    parentId: null,
    protected: false,
    createdAt: '2026-01-12T08:00:00.000Z',
    updatedAt: '2026-08-05T18:22:11.000Z',
    items: [
      {
        id: 'itm-7f21a0c4',
        name: 'vacances-2026.jpg',
        type: 'file',
        size: 1048576,
        date: '2026-08-05T18:22:11.000Z',
        description: 'Panorama — col du Galibier',
        priority: 'normal',
        protected: false,
        parentId: 'fld-photos',
        createdAt: '2026-07-30T14:02:00.000Z',
        updatedAt: '2026-08-05T18:22:11.000Z',
      },
      {
        // Suppression DOUCE : présente dans le JSON, à filtrer à la lecture
        // (getFolder storageService.ts:1470).
        id: 'itm-3c88b512',
        name: 'ancienne.png',
        type: 'file',
        size: 40960,
        parentId: 'fld-photos',
        createdAt: '2026-02-04T10:11:00.000Z',
        updatedAt: '2026-08-03T12:00:00.000Z',
        deletedAt: '2026-08-03T12:00:00.000Z',
      },
      {
        // Sous-dossier imbriqué : `items` récursif, et `color` ABSENT — la
        // couleur du dossier parent est héritée à la lecture (:1474-1477).
        id: 'itm-fld-2026',
        name: 'Rushes 2026',
        type: 'folder',
        parentId: 'fld-photos',
        createdAt: '2026-03-19T09:30:00.000Z',
        updatedAt: '2026-08-01T21:45:00.000Z',
        items: [
          {
            id: 'itm-9ad10f33',
            name: 'sequence-01.mov',
            type: 'file',
            size: 734003200,
            parentId: 'itm-fld-2026',
            createdAt: '2026-08-01T21:45:00.000Z',
            updatedAt: '2026-08-01T21:45:00.000Z',
          },
        ],
      },
    ],
    reminders: [
      {
        id: 'rem-01j8xk',
        description: 'Trier les photos du Galibier',
        date: '2026-08-20T09:00:00.000Z',
        isRead: false,
        isCompleted: false,
        itemId: 'itm-7f21a0c4',
        itemName: 'vacances-2026.jpg',
        itemType: 'file',
        priority: 'high',
        recurring: 'none',
        createdAt: '2026-08-05T18:23:00.000Z',
        updatedAt: '2026-08-05T18:23:00.000Z',
      },
    ],
  };

  await addMachineTextCase({
    id: 'machine-v2-folder-metadata',
    description:
      'CE QUE LE MOBILE REÇOIT POUR UNE ENTRÉE meta:{folderId}. Contenu réaliste de {folderId}/metadata.json : sous-dossier imbriqué, item en suppression DOUCE (deletedAt, à filtrer), item sans `color` (héritée du dossier), et un rappel. Conteneur TEXTE : chaîne ASCII "v2:" + hexadécimal, poussée VERBATIM au cloud (meta: est exclu de la voie delta, syncService.ts:899).',
    contentKind: 'folder-metadata',
    value: realisticFolder,
    writer: storage,
    verifier: storage,
    expectedWriterMarker: 'v2:',
    iterations: MACHINE_ITERATIONS_V2,
    producedBy: 'electron/storageService.ts#encrypt',
    extra: {
      manifestKeyExample: 'meta:fld-photos',
      localPathExample: 'fld-photos/metadata.json',
      writtenBy: 'electron/storageService.ts:1311-1313 (saveFolder → fs.writeFile)',
      readBy: 'electron/storageService.ts:1445-1450 (getFolder → fs.readFile utf8 → decrypt)',
    },
  });

  await addMachineTextCase({
    id: 'machine-v2-folder-no-items',
    description:
      'Dossier SANS champ `items` : forme tolérée par la production, qui la répare à la lecture (getFolder storageService.ts:1463 : `folder.items = folder.items || []`). Un lecteur mobile qui exigerait `items` casserait sur un dossier réel.',
    contentKind: 'folder-metadata',
    value: {
      id: 'fld-vide',
      name: 'Dossier vide',
      parentId: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
    writer: storage,
    verifier: storage,
    expectedWriterMarker: 'v2:',
    iterations: MACHINE_ITERATIONS_V2,
    producedBy: 'electron/storageService.ts#encrypt',
    extra: {
      manifestKeyExample: 'meta:fld-vide',
      localPathExample: 'fld-vide/metadata.json',
    },
  });

  // Le clair de notes.enc : JSON.stringify({ byId, allIds, templates }),
  // signature exacte du handler notes:save (electron/main.ts:6155). Note et
  // NoteTemplate : src/types/notes.ts:9 et :154.
  await addMachineTextCase({
    id: 'machine-v2-notes-bundle',
    description:
      'CE QUE LE MOBILE REÇOIT POUR meta:notes. Bundle réaliste de notes.enc : deux notes (dont une quotidienne), liens sortants, contenu TipTap sérialisé, et un modèle avec ses variables. Même conteneur TEXTE "v2:" que les métadonnées de dossier.',
    contentKind: 'notes-bundle',
    value: {
      byId: {
        'note-1a2b3c': {
          id: 'note-1a2b3c',
          title: 'Plan de sauvegarde',
          content:
            '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Vérifier le coffre chaque dimanche."}]}]}',
          plainText: 'Vérifier le coffre chaque dimanche.',
          parentId: 'fld-photos',
          linkedNoteIds: ['note-4d5e6f'],
          linkedFileIds: ['itm-7f21a0c4'],
          linkedFolderIds: ['fld-photos'],
          isDaily: false,
          icon: 'lucide:ShieldCheck',
          createdAt: '2026-07-02T07:45:00.000Z',
          updatedAt: '2026-08-05T20:40:59.000Z',
        },
        'note-4d5e6f': {
          id: 'note-4d5e6f',
          title: '2026-08-05',
          content:
            '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Journal du jour — rien à signaler."}]}]}',
          plainText: 'Journal du jour — rien à signaler.',
          parentId: null,
          linkedNoteIds: [],
          linkedFileIds: [],
          linkedFolderIds: [],
          isDaily: true,
          dailyDate: '2026-08-05',
          icon: '🗓️',
          createdAt: '2026-08-05T06:00:00.000Z',
          updatedAt: '2026-08-05T20:41:03.000Z',
        },
      },
      allIds: ['note-1a2b3c', 'note-4d5e6f'],
      templates: [
        {
          id: 'tpl-daily',
          name: 'Note quotidienne',
          description: 'Squelette de journal',
          icon: 'lucide:CalendarDays',
          content:
            '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"{{date}}"}]}]}',
          variables: [{ name: 'date', label: 'Date', type: 'date', defaultValue: '' }],
          isBuiltIn: true,
          createdAt: '2026-01-12T08:00:00.000Z',
          updatedAt: '2026-01-12T08:00:00.000Z',
        },
      ],
    },
    writer: storage,
    verifier: storage,
    expectedWriterMarker: 'v2:',
    iterations: MACHINE_ITERATIONS_V2,
    producedBy: 'electron/storageService.ts#encrypt',
    extra: {
      manifestKeyExample: 'meta:notes',
      localPathExample: 'notes.enc',
      writtenBy: 'electron/main.ts:6186-6187 (StorageService.encrypt → fs.writeFile utf-8)',
      readBy: 'electron/main.ts:6255-6261 (fs.readFile utf-8 → StorageService.decrypt)',
    },
  });

  await addMachineTextCase({
    id: 'machine-v2-notes-empty',
    description:
      'Bundle de notes VIDE mais légitime : {byId:{},allIds:[],templates:[]}. Le desktop refuse d écraser un notes.enc de plus de 200 octets par un état vide (main.ts:6168-6184) ; ce conteneur est donc la borne basse réelle d un notes.enc valide, pas une corruption.',
    contentKind: 'notes-bundle',
    value: { byId: {}, allIds: [], templates: [] },
    writer: storage,
    verifier: storage,
    expectedWriterMarker: 'v2:',
    iterations: MACHINE_ITERATIONS_V2,
    producedBy: 'electron/storageService.ts#encrypt',
    extra: { manifestKeyExample: 'meta:notes', localPathExample: 'notes.enc' },
  });

  await addMachineTextCase({
    id: 'machine-v2-empty-object',
    description:
      'Clair minimal absolu : l objet vide, soit DEUX octets de JSON ("{}"). Le corps fait 100 caractères hexadécimaux, à peine au-dessus du minimum de 98 imposé par decryptV2 (storageService.ts:455). Borne basse du cadrage : un lecteur qui exigerait un ciphertext non vide le refuserait.',
    contentKind: 'raw-json',
    value: {},
    writer: storage,
    verifier: storage,
    expectedWriterMarker: 'v2:',
    iterations: MACHINE_ITERATIONS_V2,
    producedBy: 'electron/storageService.ts#encrypt',
  });

  await addMachineTextCase({
    id: 'machine-v1-legacy-folder',
    description:
      'Conteneur HÉRITÉ "v1:" (10 000 tours au lieu de 600 000), même cadrage octet pour octet. Il peut encore se trouver au cloud : la migration v1→v2 n a lieu qu à la LECTURE d un dossier (getFolder storageService.ts:1448-1460), donc un dossier jamais rouvert depuis la hausse à 600k est poussé tel quel. Un lecteur mobile qui ne gérerait que "v2:" laisserait ces dossiers inatteignables.',
    contentKind: 'folder-metadata',
    value: {
      id: 'fld-archives',
      name: 'Archives',
      parentId: null,
      items: [
        {
          id: 'itm-legacy-01',
          name: 'sauvegarde.tar',
          type: 'file',
          size: 268435456,
          parentId: 'fld-archives',
        },
      ],
      createdAt: '2024-11-02T10:00:00.000Z',
      updatedAt: '2024-11-02T10:00:00.000Z',
    },
    writer: storageLegacyV1,
    verifier: storage,
    expectedWriterMarker: 'v1:',
    iterations: MACHINE_ITERATIONS_V1,
    producedBy:
      'electron/storageService.ts#encrypt (iterationCount et ENCRYPTION_VERSION_2 neutralisés — cf. note 7 du générateur)',
    extra: {
      manifestKeyExample: 'meta:fld-archives',
      localPathExample: 'fld-archives/metadata.json',
      writerConstantsOverridden: true,
      whyOverridden:
        'Aucun écrivain "v1:" n existe plus en production ; la branche de LECTURE, elle, est vivante (decrypt storageService.ts:434-436). Le conteneur est relu par l instance NON modifiée, qui le route sur decryptV1 (10 000 tours) — une branche inatteignable autrement.',
    },
  });

  await addMachineTextCase({
    id: 'machine-nomarker-legacy-folder',
    description:
      'Conteneur SANS AUCUN MARQUEUR : un "v2:" de production amputé de ses trois caractères de préfixe (cf. note 8 du générateur). Le desktop le lit toujours (decrypt storageService.ts:437-447 tente V2 puis retombe sur V1). Coût du repli : DEUX dérivations pour un échec, à borner explicitement côté mobile.',
    contentKind: 'folder-metadata',
    value: {
      id: 'fld-tres-ancien',
      name: 'Très ancien',
      items: [],
      createdAt: '2023-05-14T12:00:00.000Z',
      updatedAt: '2023-05-14T12:00:00.000Z',
    },
    writer: storage,
    verifier: storage,
    expectedWriterMarker: 'v2:',
    iterations: MACHINE_ITERATIONS_V2,
    stripMarker: true,
    producedBy:
      'electron/storageService.ts#encrypt, moins les trois caractères de marqueur (le marqueur est concaténé après coup, storageService.ts:409, et n entre ni dans le sel, ni dans l IV, ni dans une AAD)',
    extra: {
      fallbackOrderDesktop:
        'decrypt() essaie decryptV2 (600 000 tours) PUIS decryptV1 (10 000) — storageService.ts:437-447',
    },
  });

  // ── Variante BINAIRE : contenu de fichier de la voie tamponnée héritée ───
  await addMachineBinaryCase({
    id: 'machine-v2-binary-file-content',
    description:
      'Variante BINAIRE de la même famille : "v2:" || sel(16) || IV(16) || ct || tag(16), sans aucun hexadécimal. Produite par encryptBinary (storageService.ts:532-554) pour du CONTENU DE FICHIER sur la voie tamponnée héritée (main.ts:4074, 4228…). Ces blobs montent au cloud tels quels sous 500 Mo : le mobile peut en recevoir, et doit soit les lire, soit les refuser avec un libellé honnête — jamais les confondre avec un fichier corrompu.',
    contentKind: 'file-content',
    plaintext: prngBytes('machine-v2-binary-file-content', 2048),
    writer: storage,
    verifier: storage,
    expectedWriterMarker: 'v2:',
    iterations: MACHINE_ITERATIONS_V2,
    producedBy: 'electron/storageService.ts#encryptBinary',
    extra: {
      ambiguityNote:
        'Les deux variantes partagent le préfixe "v2:" et RIEN dans le format ne les distingue. La discrimination se fait par le CONTEXTE (une clé meta: du manifeste ⇒ variante texte), pas par le contenu. L heuristique « le corps est-il intégralement hexadécimal ? » fonctionne ici mais reste une heuristique.',
    },
  });

  await addMachineBinaryCase({
    id: 'machine-v2-binary-empty',
    description:
      'Variante BINAIRE d un contenu de ZÉRO octet : 51 octets exactement = 3 + 16 + 16 + 0 + 16. Le ciphertext est vide et le tag colle à l IV — un lecteur qui calculerait la fin du ciphertext autrement que « longueur − 16 » se décale.',
    contentKind: 'file-content',
    plaintext: Buffer.alloc(0),
    writer: storage,
    verifier: storage,
    expectedWriterMarker: 'v2:',
    iterations: MACHINE_ITERATIONS_V2,
    producedBy: 'electron/storageService.ts#encryptBinary',
  });

  // ── Cas négatifs clé-machine ─────────────────────────────────────────────
  const metaContainer = Buffer.from(
    machineById.get('machine-v2-folder-metadata').ciphertext,
    'base64'
  );
  const binContainer = Buffer.from(
    machineById.get('machine-v2-binary-file-content').ciphertext,
    'base64'
  );

  await addMachineNegativeMutation({
    id: 'neg-machine-v2-salt-altered',
    baseCase: 'machine-v2-folder-metadata',
    description:
      'Premier caractère hexadécimal du SEL remplacé par un autre caractère hexadécimal valide : le conteneur reste parfaitement bien formé, mais PBKDF2 dérive une autre clé et le tag GCM échoue. Coût du rejet : une dérivation complète de 600 000 tours.',
    mutations: [flipHexCharMutation(metaContainer, MACHINE_MARKER_LENGTH)],
    verifier: storage,
  });

  await addMachineNegativeMutation({
    id: 'neg-machine-v2-iv-altered',
    baseCase: 'machine-v2-folder-metadata',
    description:
      'Premier caractère hexadécimal de l IV altéré (offset 35 : 3 de marqueur + 32 de sel). La clé dérivée est la bonne, l IV ne l est pas : le tag GCM échoue. Vérifie au passage que l IV fait bien SEIZE octets et commence après le sel, pas avant.',
    mutations: [
      flipHexCharMutation(metaContainer, MACHINE_MARKER_LENGTH + MACHINE_SALT_LENGTH * 2),
    ],
    verifier: storage,
  });

  await addMachineNegativeMutation({
    id: 'neg-machine-v2-tag-altered',
    baseCase: 'machine-v2-folder-metadata',
    description:
      'Premier caractère hexadécimal du TAG altéré (32 derniers caractères du conteneur). Le lecteur doit LEVER, jamais rendre le clair partiel que le déchiffrement AES-GCM a pourtant déjà produit en mémoire.',
    mutations: [
      flipHexCharMutation(metaContainer, metaContainer.length - MACHINE_TAG_LENGTH * 2),
    ],
    verifier: storage,
  });

  await addMachineNegativeMutation({
    id: 'neg-machine-v2-marker-altered',
    baseCase: 'machine-v2-folder-metadata',
    description:
      'Troisième caractère du marqueur altéré : "v2:" devient "v2!". Plus aucun marqueur connu ne correspond, donc le desktop emprunte son chemin SANS MARQUEUR et paie DEUX dérivations (600 000 puis 10 000 tours) avant de renoncer. Le mobile doit borner ce repli, pas le rejouer indéfiniment.',
    mutations: [{ op: 'setByte', offset: 2, value: 0x21 }],
    verifier: storage,
  });

  await addMachineNegativeMutation({
    id: 'neg-machine-v2-body-too-short',
    baseCase: 'machine-v2-folder-metadata',
    description:
      'Conteneur tronqué à 3 + 97 caractères : le corps passe SOUS le minimum de 98 imposé par decryptV2 (storageService.ts:455). Le rejet doit intervenir sur la LONGUEUR, avant la moindre dérivation PBKDF2 — c est la seule erreur de cette famille qui ne doit rien coûter.',
    mutations: [{ op: 'truncate', length: MACHINE_MARKER_LENGTH + MACHINE_MIN_BODY_CHARS - 1 }],
    verifier: storage,
  });

  await addMachineNegativeMutation({
    id: 'neg-machine-v2-binary-tag-altered',
    baseCase: 'machine-v2-binary-file-content',
    description:
      'Variante BINAIRE, dernier octet du tag inversé : l authentification doit échouer et le lecteur lever.',
    mutations: [
      {
        op: 'setByte',
        offset: binContainer.length - 1,
        value: binContainer[binContainer.length - 1] ^ 0xff,
      },
    ],
    verifier: storage,
  });

  await addMachineNegativeMutation({
    id: 'neg-machine-v2-binary-salt-altered',
    baseCase: 'machine-v2-binary-file-content',
    description:
      'Variante BINAIRE, premier octet du SEL inversé (offset 3, juste après le marqueur) : PBKDF2 dérive une autre clé et le tag échoue.',
    mutations: [
      {
        op: 'setByte',
        offset: MACHINE_MARKER_LENGTH,
        value: binContainer[MACHINE_MARKER_LENGTH] ^ 0xff,
      },
    ],
    verifier: storage,
  });

  await addMachineNegativeMutation({
    id: 'neg-machine-v2-binary-truncated',
    baseCase: 'machine-v2-binary-file-content',
    description:
      'Variante BINAIRE tronquée à 20 octets : il ne reste ni ciphertext ni cadrage cohérent. Le desktop laisse `slice` produire des tranches vides ou négatives et échoue au tag ; un lecteur mobile doit rejeter dès la vérification de longueur (minimum 3 + 16 + 16 + 16 = 51 octets).',
    mutations: [{ op: 'truncate', length: 20 }],
    verifier: storage,
  });

  const machineCasesDigest = sha256(
    Buffer.from(machineCases.map((c) => `${c.id}:${c.sha256}`).join('\n'), 'utf8')
  );

  // ── Assemblage du pack ───────────────────────────────────────────────────
  const sourceFiles = [P_STREAM, P_HYBRID_BLOB, P_RENDERER, P_STORAGE, path.join(HERE, 'generate-golden-vectors.mjs')];
  const sources = sourceFiles.map((file) => ({
    path: path.relative(REPO, file).replace(/\\/g, '/'),
    sha256: sha256(fs.readFileSync(file)),
    bytes: fs.statSync(file).size,
  }));

  const casesDigest = sha256(
    Buffer.from(cases.map((c) => `${c.id}:${c.sha256}`).join('\n'), 'utf8')
  );

  const pack = {
    version: PACK_VERSION,
    generator: 'scripts/generate-golden-vectors.mjs (dépôt desktop filarg)',
    doNotEdit:
      'Fichier GÉNÉRÉ. Ne jamais éditer à la main : chaque octet vient du code de production desktop et a été revalidé par un aller-retour. Une retouche manuelle produirait un contrat de format faux, donc des coffres illisibles. Régénérer avec le script (voir spec/README.md).',
    generatedFrom: {
      repo: 'filarg (desktop, référence des formats)',
      commit: COMMIT,
      date: DATE,
      nodeVersion: process.version,
      sources,
      producers: {
        'V0/V1/V2': 'src/services/auth/hybridCrypto.ts#encryptFileContent',
        V3: 'electron/streamCrypto.ts#encryptBufferToFileV3',
        manifests: 'electron/storageService.ts#encryptWithFEK',
        machineContainers:
          'electron/storageService.ts#encrypt (variante texte) et #encryptBinary (variante binaire)',
      },
      verifiers: {
        'V0/V1/V2': [
          'electron/hybridBlobCrypto.ts#decryptHybridFekBlob',
          'src/services/auth/hybridCrypto.ts#decryptFileContent',
        ],
        V3: ['electron/streamCrypto.ts#decryptFileToBufferV3', 'electron/streamCrypto.ts#statV3File'],
        manifests: [
          'electron/storageService.ts#decryptWithFEK',
          'electron/storageService.ts#decryptManifestAuto',
        ],
        machineContainers: [
          'electron/storageService.ts#decrypt (instance NON modifiée)',
          'electron/storageService.ts#decryptBinary (instance NON modifiée)',
        ],
      },
      determinism: {
        note: 'Les modules de production sont exécutés tels quels ; seule leur SOURCE D ENTROPIE est remplacée par un flux déterministe, pour que les vecteurs soient reproductibles.',
        stream: 'concat(SHA-256(label || u32BE(compteur)))',
        ivLabel: 'filarr-golden-vectors/v1/iv/<id du cas>',
        v3Label: 'filarr-golden-vectors/v1/v3/<id du cas>',
        manifestLabel: 'filarr-golden-vectors/v1/manifest/<id du cas>',
        machineLabel: 'filarr-golden-vectors/v1/machine/<id du cas>',
        plaintextLabel: 'filarr-golden-vectors/v1/plaintext/<label>',
        keyDerivation: 'clé du pack = SHA-256("filarr-golden-vectors/v1/key")',
        machineKeyDerivation:
          'clé machine du pack = SHA-256("filarr-golden-vectors/v1/machine-key")',
      },
      adaptations: [
        'Les modules TypeScript de production sont transpilés en mémoire (ts.transpileModule) et exécutés — aucune réécriture de logique, aucun fichier du dépôt desktop modifié.',
        'Les vecteurs V0 sont obtenus en retirant l octet de marqueur d un V1 de production (le marqueur n est couvert par aucun AAD), puis revalidés par les lecteurs de production.',
        'Les cas v3-cs64k-* sont écrits par une seconde instance de streamCrypto.ts dont la seule constante V3_CHUNK_SIZE vaut 65536 (borne basse légale du lecteur), afin de tenir des vecteurs multi-chunks dans un fichier raisonnable. Ils sont relus par l instance NON modifiée.',
        'Le module `electron` est stubbé pour charger storageService.ts : app.getPath rend un répertoire temporaire et safeStorage est réduit à l identité (utf8 <-> Buffer). safeStorage protège .fek_safe AU REPOS ; sa seule sortie utile pour encryptWithFEK est le base64 de la FEK, que le stub rend à l identique. Aucun octet du conteneur fek:/fkz: ne traverse safeStorage. Le vrai DPAPI n est donc pas exercé.',
        'Le cas manifest-fek-realistic est écrit par une seconde instance de storageService.ts dont la seule constante FEK_COMPRESS_MIN_BYTES vaut Number.MAX_SAFE_INTEGER, afin d obtenir depuis l écrivain de production un gros conteneur fek: (ce que le mobile écrit toujours). Il est relu par l instance NON modifiée, et son clair est identique à celui de manifest-fkz-realistic.',
        'Le cas machine-v1-legacy-folder est écrit par une troisième instance de storageService.ts dont DEUX constantes sont neutralisées (iterationCount -> 10000, ENCRYPTION_VERSION_2 -> "v1:"), parce qu il n existe plus aucun écrivain "v1:" en production alors que la branche de LECTURE est vivante. Le conteneur est relu par l instance NON modifiée, qui le route sur decryptV1 (10 000 tours) — branche inatteignable si le marqueur ou le nombre de tours n étaient pas ceux d un vrai v1.',
        'Le cas machine-nomarker-legacy-folder est un "v2:" de production amputé de ses trois caractères de marqueur (le marqueur est concaténé après coup et n entre ni dans le sel, ni dans l IV, ni dans une AAD), puis revalidé par le chemin sans-marqueur du lecteur de production.',
      ],
    },
    key: {
      hex: KEY_HEX,
      length: 32,
      note: 'Clé de test publique, fixe et sans valeur. Rôle de FEK : clé AES-256-GCM brute pour V0/V1/V2, IKM du HKDF par fichier pour V3.',
    },
    constants: {
      IV_LENGTH: 12,
      TAG_LENGTH: 16,
      MIN_BLOB_LENGTH: 28,
      FORMAT_V1_PLAIN: '0x01',
      FORMAT_V2_DEFLATE: '0x02',
      V2_INNER_ENCODING: 'zlib RFC-1950',
      V3_MAGIC_HEX,
      V3_HEADER_SIZE: 50,
      V3_VERSION: 3,
      V3_CHUNK_SIZE_DEFAULT: 8388608,
      V3_CHUNK_SIZE_MIN: 65536,
      V3_CHUNK_SIZE_MAX: 67108864,
      V3_MAX_FILE_SIZE: 5368709120,
      V3_HKDF_INFO: HKDF_INFO,
      V3_AAD_SIZE: 25,
      KEY_LENGTH: 32,
    },
    readerContract: {
      detectionOrder: [
        '1. longueur >= 12 et octets [0..12) == magic V3 -> V3 : valider l en-tête (version 3, réservé 0, 65536 <= chunkSize <= 67108864, origSize <= 5 Gio) puis l ÉGALITÉ STRICTE longueur == 50 + nChunks*16 + origSize, avant toute allocation.',
        '2. sinon longueur < 28 -> rejeter.',
        '3. sinon si octet 0 == 0x01 : tenter {ivOffset:1, deflated:false} ; si octet 0 == 0x02 : tenter {ivOffset:1, deflated:true} ; puis TOUJOURS ajouter la tentative de repli {ivOffset:0, deflated:false}.',
        '4. exécuter les tentatives dans l ordre ; un échec GCM passe à la suivante ; sur une tentative deflated, un échec d INFLATE doit AUSSI passer à la suivante (ne jamais rendre les octets non inflatés).',
        '5. avec plusieurs clés candidates : boucler CLÉ-MAJEUR (pour chaque clé { pour chaque disposition }).',
        '6. aucune tentative ne réussit -> erreur explicite.',
      ],
      writeScope:
        'Cette vague est en LECTURE seule côté mobile : le mobile continue d écrire en V0 (IV(12) || ciphertext || tag), relu par le desktop via son repli.',
    },
    cases,
    negativeCases,
    oversizedRoundTrip,

    // ── Section MANIFESTES ────────────────────────────────────────────────
    // Volontairement SÉPARÉE de `cases` / `negativeCases` : le manifeste est
    // un autre conteneur (marqueur ASCII de 4 octets, pas d octet de version),
    // et l empreinte `integrity.casesDigest` des blobs ne doit pas bouger
    // quand cette section évolue. Les deux sections ont chacune la leur.
    manifests: {
      note:
        'Conteneur du manifeste de synchronisation cloud (objet R2 users/{userId}/profiles/{profileId}/manifest.enc). Format DISTINCT des blobs de contenu : marqueur ASCII de 4 octets, IV de 12 octets, AES-256-GCM sous la FEK BRUTE (aucun HKDF, aucun PBKDF2, aucun AAD), tag de 16 octets collé en fin de ciphertext par WebCrypto.',
      layout: {
        'fek:': '"fek:"(4) || IV(12) || AES-256-GCM(JSON UTF-8 brut) || tag(16)',
        'fkz:': '"fkz:"(4) || IV(12) || AES-256-GCM(zlib.deflate(JSON UTF-8)) || tag(16)',
        nu: 'IV(12) || ciphertext || tag(16) — forme héritée SANS marqueur, écrite par les anciennes versions du mobile. Le desktop ne sait PAS la lire (decryptManifestAuto retombe sur le chemin clé-machine). Le mobile doit continuer à la LIRE en repli, et ne plus jamais l ÉCRIRE.',
      },
      markers: {
        FEK_MARKER: 'fek:',
        FEK_MARKER_HEX: '66656b3a',
        FEK_ZLIB_MARKER: 'fkz:',
        FEK_ZLIB_MARKER_HEX: '666b7a3a',
        MARKER_LENGTH: 4,
        IV_LENGTH: 12,
        TAG_LENGTH: 16,
        FEK_COMPRESS_MIN_BYTES: 256,
        MIN_CONTAINER_LENGTH: 32,
      },
      writerRule:
        'L écrivain desktop tente deflate SI ET SEULEMENT SI le clair pèse au moins FEK_COMPRESS_MIN_BYTES (256), et ne retient "fkz:" que si le résultat compressé est STRICTEMENT plus court que l original. Sinon "fek:". Voir les cas manifest-*-threshold-* et manifest-fek-256-incompressible.',
      writeContractMobile:
        'Le mobile doit ÉCRIRE "fek:" (marqueur + clair non compressé) quelle que soit la taille : decryptWithFEK accepte les deux marqueurs indifféremment, donc c est légal et lisible par tout desktop. Écrire la forme nue est interdit : elle avorte le cycle de synchronisation desktop à chaque tour, et le manifeste empoisonné n est jamais réécrit (l étape qui le réécrirait n est jamais atteinte).',
      readerContract: [
        '1. si les 4 premiers octets valent "fkz:" -> tentative { markerLength: 4, deflated: true }.',
        '2. sinon si les 4 premiers octets valent "fek:" -> tentative { markerLength: 4, deflated: false }.',
        '3. TOUJOURS ajouter en dernier la tentative de repli { markerLength: 0, deflated: false } (forme nue héritée). Ce repli n est jamais optionnel : il couvre les manifestes déjà poussés par le mobile ET la collision d un IV aléatoire commençant par "fek:"/"fkz:".',
        '4. un échec GCM passe à la tentative suivante ; sur une tentative déflatée, un échec d INFLATE doit AUSSI passer à la suivante — ne jamais rendre les octets non inflatés.',
        '5. aucune tentative n authentifie -> erreur explicite « manifeste illisible ». DISTINGUER ce cas de l échec de JSON.parse qui suit (cf. neg-manifest-inner-json-invalid) : le second signifie que la clé était bonne et que le contenu est corrompu.',
        '6. le troisième format historique (manifeste binaire "v2:" chiffré sous la clé MACHINE, encore accepté par decryptManifestAuto) est structurellement illisible pour le mobile : la clé machine est DANS le manifeste qu on cherche à lire. Le détecter par son préfixe et remonter une erreur explicite, sans boucle de retry coûteuse.',
      ],
      candidateKeys: {
        field: 'encryptionKey',
        location: 'racine du manifeste déchiffré (SyncManifest.encryptionKey), pas par fichier',
        encoding: 'base64 des 32 octets BRUTS de la clé MACHINE (StorageService.key)',
        wrapped: false,
        producedBy:
          'electron/sync/syncService.ts:616 <- electron/storageService.ts#getEncryptionKeyBase64',
        machineKeyOfThisPack: {
          hex: MACHINE_KEY.toString('hex'),
          base64: MACHINE_KEY_B64,
          length: 32,
        },
        order: [
          'FEK (contenu CLOUD, majoritairement chiffré sous la FEK)',
          'clé machine décodée depuis encryptionKey',
        ],
        orderNote:
          'L ordre ne joue que sur la LATENCE, jamais sur la correction : une mauvaise clé échoue le tag GCM du premier chunk et la tentative suivante prend le relais. Le desktop sonde dans l autre sens (masterKey puis fek) sur ses lectures LOCALES, majoritairement clé-machine.',
        whyRequired:
          'La sonde de portabilité du desktop ne s applique qu au-dessus de 500 Mo (MAX_SYNC_FILE_SIZE). En dessous, un conteneur V3 chiffré sous la clé machine part au cloud verbatim : sans encryptionKey, une part inconnue des fichiers du cloud est définitivement illisible.',
        absentWhen:
          'this.key non chargé côté émetteur -> getEncryptionKeyBase64() rend null -> le champ disparaît du JSON. Cas couvert par manifest-fek-empty : dégrader proprement, ne jamais afficher d octets non authentifiés.',
        neverPersistInClear:
          'Ces 32 octets ouvrent metadata.json et tous les blobs machine. Sur mobile : Keychain / Keystore, jamais AsyncStorage en clair, jamais dans un log.',
        outOfScope:
          'Ces clés candidates ne suffisent PAS pour les entrées meta:{folderId} et meta:notes : ces chunks sont de la famille "v2:" (PBKDF2-SHA512 600000 itérations, IV de 16 octets, encodage hexadécimal), où la clé machine est un MOT DE PASSE PBKDF2 et non une clé AES. Le lecteur de blobs ne les couvre pas.',
      },
      cases: manifestCases,
      negativeCases: manifestNegativeCases,
      integrity: {
        casesDigest: manifestCasesDigest,
        casesDigestInput:
          'SHA-256 de la concaténation, séparée par des sauts de ligne, de "<id>:<sha256 du ciphertext>" dans l ordre du tableau manifests.cases.',
        caseCount: manifestCases.length,
        negativeCaseCount: manifestNegativeCases.length,
      },
    },

    // ── Section CONTENEURS CLÉ MACHINE ────────────────────────────────────
    // Troisième format du coffre, SÉPARÉ des deux autres pour la même raison :
    // son évolution ne doit faire bouger ni `integrity.casesDigest` ni
    // `integrity.manifestCasesDigest`. Il a sa propre empreinte.
    machineContainers: {
      note:
        'Conteneurs desktop scellés sous la CLÉ MACHINE. C est le format des MÉTADONNÉES du coffre : {folderId}/metadata.json (entrées meta:{folderId} du manifeste) et notes.enc (meta:notes). Format DISTINCT des blobs de contenu ET du manifeste : préfixe ASCII de TROIS octets, sel de 16 octets, IV de SEIZE octets, AES-256-GCM sous une clé DÉRIVÉE par PBKDF2-SHA512 dont le MOT DE PASSE est la clé machine. Aucune clé candidate ne suffit : il faut un lecteur dédié.',
      appliesTo: {
        'meta:{folderId}':
          '{folderId}/metadata.json — variante TEXTE. Clé de manifeste posée par syncService.ts:1551, localPath `${folderId}/metadata.json` (:1556).',
        'meta:notes':
          'notes.enc — variante TEXTE. Clé de manifeste posée par syncService.ts:1520, localPath "notes.enc" (:1525).',
        'contenu de fichier hérité':
          'variante BINAIRE, voie tamponnée (main.ts:4074, 4129, 4228, 4493, 4524, 5133) et protectedRegistry.ts:41. Monte au cloud verbatim sous MAX_SYNC_FILE_SIZE (500 Mo).',
      },
      uploadedVerbatim:
        'L objet R2 d une entrée meta: EST le fichier local octet pour octet : aucun ré-enveloppement, et meta: est explicitement exclu de la voie delta (syncService.ts:899). Une seule couche à peler.',
      layout: {
        'texte (v2:)':
          '"v2:" + hex(sel 16) + hex(IV 16) + hex(ciphertext) + hex(tag 16) — chaîne ASCII minuscule, écrite en UTF-8. |corps| = 96 + 2*|clair| caractères.',
        'texte (v1:)': 'idem, préfixe "v1:" et 10 000 tours de PBKDF2 au lieu de 600 000.',
        'texte (nu)':
          'le même corps SANS préfixe, hérité des très vieux profils. decrypt() essaie V2 puis retombe sur V1 (storageService.ts:437-447).',
        'binaire (v2:)': '"v2:" || sel(16) || IV(16) || ciphertext || tag(16) — octets bruts.',
      },
      markers: {
        MARKER_V2: 'v2:',
        MARKER_V2_HEX: '76323a',
        MARKER_V1: 'v1:',
        MARKER_V1_HEX: '76313a',
        MARKER_LENGTH: MACHINE_MARKER_LENGTH,
        SALT_LENGTH: MACHINE_SALT_LENGTH,
        IV_LENGTH: MACHINE_IV_LENGTH,
        TAG_LENGTH: MACHINE_TAG_LENGTH,
        KEY_LENGTH: MACHINE_KEY_LENGTH,
        ITERATIONS_V2: MACHINE_ITERATIONS_V2,
        ITERATIONS_V1: MACHINE_ITERATIONS_V1,
        MIN_BODY_LENGTH_CHARS: MACHINE_MIN_BODY_CHARS,
        MIN_BINARY_CONTAINER_LENGTH:
          MACHINE_MARKER_LENGTH + MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH + MACHINE_TAG_LENGTH,
      },
      derivation: {
        kdf: 'PBKDF2-SHA512',
        iterations: MACHINE_ITERATIONS_V2,
        legacyIterations: MACHINE_ITERATIONS_V1,
        outputLength: MACHINE_KEY_LENGTH,
        password:
          'les 32 OCTETS BRUTS de la clé machine (this.key est un Buffer, storageService.ts:399) — PAS sa chaîne base64. Le manifeste transporte cette clé en base64 (manifest.encryptionKey) : il faut la DÉCODER, puis utiliser les octets tels quels.',
        passwordTrap:
          'Une API pbkdf2(password: string) qui fait Buffer.from(password, "utf8") produit un AUTRE mot de passe : 32 octets aléatoires passés par une chaîne latin1 puis ré-encodés en UTF-8 donnent 49 octets. La dérivation est alors silencieusement fausse — l échec, lui, est bruyant (tag GCM), jamais un faux clair. Il faut une surcharge acceptant des octets.',
        cipher: 'AES-256-GCM',
        ivLength: MACHINE_IV_LENGTH,
        ivTrap:
          'IV de SEIZE octets, alors que TOUT le reste de la crypto Filarr (V0-V3, fek:/fkz:) utilise DOUZE. Une constante IV_LENGTH=12 réutilisée par réflexe donne un échec systématique difficile à diagnostiquer. AES-GCM à IV de 16 octets est légal (J0 calculé par GHASH) : WebCrypto et OpenSSL l acceptent.',
        aad: 'aucune',
        saltPerObject:
          'Sel de 16 octets TIRÉ À CHAQUE ÉCRITURE (crypto.randomBytes) : deux dossiers n ont jamais le même. Aucune mise en cache de clé dérivée n est possible entre objets.',
      },
      cost: {
        derivationsPerObject: 1,
        note:
          'Une dérivation de 600 000 tours de PBKDF2-SHA512 PAR OBJET, sans mise en cache possible (sel distinct). Un profil de 50 dossiers plus notes.enc = 51 dérivations. Le repli sans marqueur en coûte DEUX pour un échec.',
        noMobileMeasurement:
          'Ce pack ne publie AUCUN chiffre de latence : une mesure varierait d une exécution à l autre et casserait la reproductibilité à l octet. Le coût réel doit être instrumenté sur APPAREIL avant d afficher la moindre estimation à l utilisateur.',
      },
      keyOfThisPack: {
        hex: MACHINE_KEY.toString('hex'),
        base64: MACHINE_KEY_B64,
        length: 32,
        sameAs: 'manifests.candidateKeys.machineKeyOfThisPack',
        note:
          'STRICTEMENT la même clé que celle publiée par la section manifests, et celle que porte le champ encryptionKey de manifest-fek-minimal / manifest-*-realistic. Le self-test peut donc enchaîner la production : déchiffrer le manifeste avec la FEK, en extraire encryptionKey, le décoder en base64, et ouvrir ces conteneurs avec les octets obtenus.',
        chainFromManifest: [
          '1. decryptManifest(manifests.cases["manifest-fek-minimal"].ciphertext, FEK) -> JSON',
          '2. base64 -> octets de JSON.encryptionKey (32 octets)',
          '3. ces 32 octets sont le MOT DE PASSE PBKDF2 de machineContainers.cases[*]',
        ],
        neverPersistInClear:
          'Ces 32 octets ouvrent toute l arborescence et toutes les notes. Sur mobile : Keychain / Keystore, jamais AsyncStorage en clair, jamais dans un journal ni dans un message d erreur.',
        absentWhen:
          'Le champ encryptionKey peut MANQUER du manifeste (clé enveloppée par un autre OS, syncService.ts:132-135). C est un état explicite — « métadonnées scellées par un autre ordinateur » — pas une erreur de déchiffrement. Cf. manifest-fek-empty.',
      },
      readerContract: [
        '1. Discriminer par le CONTEXTE, pas par le contenu : une entrée meta: du manifeste est TOUJOURS la variante texte. Les deux variantes partagent le préfixe et rien dans le format ne les sépare.',
        '2. Détecter le préfixe sur les OCTETS : "v2:" = 76 32 3a, "v1:" = 76 31 3a. Il vaut pour les deux variantes.',
        '3. Variante texte : vérifier que le corps est intégralement hexadécimal minuscule, de longueur PAIRE et >= 98 caractères, AVANT toute dérivation. C est le seul rejet qui doit être gratuit.',
        '4. Découper le corps : sel = [0,32), IV = [32,64), tag = les 32 DERNIERS caractères, ciphertext = le reste. Le tag se prend PAR LA FIN, jamais par un champ de longueur.',
        '5. Dériver PBKDF2-SHA512(32 octets BRUTS de la clé machine, sel, 600 000 pour "v2:" / 10 000 pour "v1:", 32 octets), puis AES-256-GCM avec un IV de SEIZE octets et aucune AAD.',
        '6. Sans marqueur : essayer 600 000 PUIS 10 000 tours (ordre du desktop, storageService.ts:437-447). Ce repli coûte DEUX dérivations pour un échec — le borner explicitement.',
        '7. Le clair est du JSON UTF-8. Un échec de JSON.parse APRÈS une authentification réussie est un diagnostic DIFFÉRENT de « illisible » : la clé était bonne.',
        '8. Clé machine absente du manifeste -> état explicite « scellé par un autre ordinateur », jamais « corrompu ».',
      ],
      writeContractMobile:
        'LECTURE SEULE, sans exception tant que l écriture n est pas prouvée octet pour octet. getFolder (storageService.ts:1496-1504) RÉINITIALISE un dossier dont les métadonnées sont illisibles : sur « Invalid IV length », « Encrypted data too short » ou ERR_CRYPTO_INVALID_IV, il écrase par un Folder VIDE et le sauvegarde. Un v2: mal formé écrit par le mobile ferait donc DÉTRUIRE le dossier par le desktop au prochain accès.',
      schemas: {
        'metadata.json':
          'JSON.stringify(Folder) — interface storageService.ts:33-45 { id; name; items: Item[]; color?; parentId?; protected?; password?; createdAt?; updatedAt?; reminders?; deletedAt? }. Item :50-67, Reminder :72-91. `items` peut être ABSENT (réparé à la lecture, :1463) ; les items porteurs de `deletedAt` sont des suppressions douces à filtrer (:1470) ; `item.color` absent hérite de `folder.color` (:1474-1477).',
        'notes.enc':
          'JSON.stringify({ byId: Record<string, Note>; allIds: string[]; templates: NoteTemplate[] }) — signature exacte du handler notes:save (main.ts:6155). Note : src/types/notes.ts:9. NoteTemplate : :154.',
      },
      cases: machineCases,
      negativeCases: machineNegativeCases,
      integrity: {
        casesDigest: machineCasesDigest,
        casesDigestInput:
          'SHA-256 de la concaténation, séparée par des sauts de ligne, de "<id>:<sha256 du ciphertext>" dans l ordre du tableau machineContainers.cases.',
        caseCount: machineCases.length,
        negativeCaseCount: machineNegativeCases.length,
      },
    },

    integrity: {
      casesDigest,
      casesDigestInput: 'SHA-256 de la concaténation, séparée par des sauts de ligne, de "<id>:<sha256 du ciphertext>" dans l ordre du tableau cases.',
      caseCount: cases.length,
      negativeCaseCount: negativeCases.length,
      // Empreinte de la section manifestes, calculée par la MÊME recette sur
      // `manifests.cases`. Volontairement séparée : ajouter un manifeste ne
      // doit jamais faire bouger casesDigest, et inversement.
      manifestCasesDigest,
      manifestCaseCount: manifestCases.length,
      manifestNegativeCaseCount: manifestNegativeCases.length,
      // Idem pour les conteneurs clé machine : troisième empreinte, troisième
      // section, aucune interférence avec les deux autres.
      machineCasesDigest,
      machineCaseCount: machineCases.length,
      machineNegativeCaseCount: machineNegativeCases.length,
    },
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');

  const totals = cases.reduce(
    (acc, c) => {
      acc[c.format] = (acc[c.format] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const manifestTotals = manifestCases.reduce((acc, c) => {
    const marker = c.params.marker;
    acc[marker] = (acc[marker] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Pack écrit : ${OUT_PATH}`);
  console.log(`  cas positifs : ${cases.length} (${JSON.stringify(totals)})`);
  console.log(`  cas négatifs : ${negativeCases.length}`);
  console.log(`  empreinte des cas : ${casesDigest}`);
  console.log(`  manifestes : ${manifestCases.length} (${JSON.stringify(manifestTotals)})`);
  console.log(`  manifestes négatifs : ${manifestNegativeCases.length}`);
  console.log(`  empreinte des manifestes : ${manifestCasesDigest}`);
  const machineTotals = machineCases.reduce((acc, c) => {
    const label = `${c.marker ?? 'nu'}/${c.variant}`;
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  conteneurs machine : ${machineCases.length} (${JSON.stringify(machineTotals)})`);
  console.log(`  conteneurs machine négatifs : ${machineNegativeCases.length}`);
  console.log(`  empreinte des conteneurs machine : ${machineCasesDigest}`);
  console.log(`  taille : ${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} Kio`);
}

main()
  .catch((error) => {
    console.error(`\nGÉNÉRATION INTERROMPUE : ${error.message}`);
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(() => {
    if (TMP_DIR) fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });
