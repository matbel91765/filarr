/**
 * VECTEURS DORÉS du protocole d'appairage v2 (spécification §8).
 *
 * Ce fichier n'est pas un test unitaire ordinaire : c'est le SEUL POINT DE
 * RENDEZ-VOUS entre trois implémentations qui ne se parlent jamais — le
 * bureau (ce dépôt), le mobile (`filarr-mobile`, RN) et le serveur
 * (`infra/cloudflare-worker`). Chacune peut être verte sur ses propres tests
 * et rester incompatible avec les deux autres ; seuls des octets partagés
 * tranchent. Une implémentation qui ne rejoue pas ces valeurs à l'octet près
 * n'est PAS conforme, quel que soit le résultat de ses autres tests.
 *
 * Les valeurs ci-dessous sont recopiées de la spécification, elle-même
 * produite par un générateur `node:crypto` de référence. Elles ne sont
 * JAMAIS régénérées depuis ce module : un vecteur qu'on régénère depuis le
 * code qu'il teste ne teste rien.
 *
 * Le module testé vit dans `electron/` : la cérémonie d'appairage se déroule
 * entièrement dans le process principal, et la FEK ne doit à aucun moment
 * exister dans le renderer. L'import traverse donc la frontière `src/` →
 * `electron/` — c'est délibéré, et c'est le seul moyen de tester le VRAI
 * chemin de production plutôt qu'une copie.
 */

import {
  buildSasInfo,
  buildWrapInfo,
  computeCommitA,
  computeSas,
  computeSharedSecret,
  deriveSessionMaterial,
  deriveWrapKey,
  deriveWrapKeyBits,
  formatSasDisplay,
  INFO_SAS_LENGTH,
  INFO_WRAP_LENGTH,
  modeFromSecret,
  saltForMode,
  unwrapFek,
  verifyCommitA,
  wrapFek,
  WRAPPED_FEK_LENGTH,
  type PairingMode,
  type WebCryptoKey,
} from '../../../../electron/pairingProtocol';
import { parsePairingQrV2 } from '../pairingQr';
import { describe, it, expect, vi } from 'vitest';
import * as nodeCrypto from 'crypto';

// `jest.requireActual` etait SYNCHRONE ; son equivalent vitest ne l'est pas.
// Ici on ne cherchait qu'a echapper aux doublures : un import direct suffit et
// dit la meme chose plus simplement.
const { webcrypto } = nodeCrypto;
const subtle = webcrypto.subtle;

// ── Aides ───────────────────────────────────────────────────────────────────

const hex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

/**
 * WebCrypto n'importe pas un scalaire privé P-256 brut : il faut un JWK.
 * On le reconstruit à partir du couple (priv, pub) doré — `x` et `y` sont les
 * deux moitiés des 64 octets qui suivent le marqueur `0x04`.
 */
async function importPrivateKey(privHex: string, pubHex: string): Promise<WebCryptoKey> {
  const pub = hex(pubHex);
  return subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: b64url(hex(privHex)),
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
      ext: true,
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  ) as Promise<WebCryptoKey>;
}

/** Importe une FEK dorée comme clé AES-GCM emballable (comme la vraie FEK). */
async function importFek(fekHex: string): Promise<WebCryptoKey> {
  return subtle.importKey('raw', hex(fekHex), { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]) as Promise<WebCryptoKey>;
}

async function exportRaw(key: WebCryptoKey): Promise<string> {
  return Buffer.from(await subtle.exportKey('raw', key)).toString('hex');
}

// ── Les vecteurs (§8.2 – §8.4) ──────────────────────────────────────────────

interface GoldenVector {
  name: string;
  code: string;
  mode: PairingMode;
  privA: string;
  pubA: string;
  privB: string;
  pubB: string;
  commitA: string;
  commitAB64: string;
  secret: string | null;
  qr: string | null;
  salt: string;
  z: string;
  wrapKey: string;
  sasInt: number;
  sasDigits: string;
  sasDisplay: string;
  fek: string;
  iv: string;
  wrappedFek: string;
  wrappedFekB64: string;
}

const VECTORS: GoldenVector[] = [
  {
    name: 'V2-1 — mode QR, nominal',
    code: '482913',
    mode: 'qr',
    privA: '0060e85b6c4ca9aea9d6a2232629b02ac17c05437f940cb76c62430d2b47f19d',
    pubA:
      '040f25967e6ad705de3a8b52dcb42c2824d9bec18064c75efbd5c016e5bb5564' +
      '708639631dc79f3323a8627b868c6cb9526f52c69da6320dc2166024213913b43b',
    privB: '568ee76e14f2ea72e977711c3ade610d2eac34353b90df517fa479843907d992',
    pubB:
      '046e6f36e39e12080e1f8d349649084224f14369ee6e5560170abca89bdcd3c8' +
      '4c58aa2fdafff2da4ee079347c5a9bbad5a899a2ffabb6d927f9c770dbd30a1ff7',
    commitA: '910e30acab357eb9db0e96a0add2abc90f6678735d7b1746ca3089efd9cfade1',
    commitAB64: 'kQ4wrKs1frnbDpagrdKryQ9meHNdexdGyjCJ79nPreE=',
    secret: 'd66da6043f6df5ec4f8721801cf4966a3da8cc2cff672a1322a7b92c83ffabad',
    qr: 'filarr://pair?v=2&code=482913&s=1m2mBD9t9exPhyGAHPSWaj2ozCz_ZyoTIqe5LIP_q60',
    salt: 'd66da6043f6df5ec4f8721801cf4966a3da8cc2cff672a1322a7b92c83ffabad',
    z: '3db8236724916dfea24163aa8527be0d0eb21de6068908244d0b8547d6a6709c',
    wrapKey: '22286f174c65cf0d332416fff0c3931a0dc7c599780b9d84dac847de3252ef29',
    sasInt: 1644147386,
    sasDigits: '147386',
    sasDisplay: '14 73 86',
    fek: 'b2264ea8fd0ab9217dfe57c5c974907d04e1d5c2e20965cb5cf56ca30ea05c3d',
    iv: '000102030405060708090a0b',
    wrappedFek:
      '000102030405060708090a0b99717f45781bed88324ea9403551b2d65361e091' +
      '1765556f2e27b5a67323373380b25c12b88cc70d4f5504b433359038',
    wrappedFekB64:
      'AAECAwQFBgcICQoLmXF/RXgb7YgyTqlANVGy1lNh4JEXZVVvLie1pnMjNzOAslwSuIzHDU9VBLQzNZA4',
  },
  {
    name: 'V2-2 — mode MANUEL (aucun secret QR)',
    code: '100000',
    mode: 'manual',
    privA: 'ed75519fa331fe68b1be50fe52383b04701a458c6edfa076018755939ca87f42',
    pubA:
      '04f1308643c763ebaa2cfec3e4c096ee3b3fd0521027ed3205ed6327479ba58a' +
      'c4aeb6e55cba1f2c79102abc4159d0bc1adf80f447accfde5d4a76e15e1f20b7ad',
    privB: '0df484fac43ea99efdb50098a16881dffa68ccbf57a691e135f6b5137eaf5f22',
    pubB:
      '04cefdf7dfc72b328f3d423ab7813b6b19db01c119f5cff65ba427360b687db9' +
      '833c4dfb6301c00a948cbd80ce2b57b5714a3bab61b48d3e9370c4320b133c583a',
    commitA: 'c347b517b5cca766643df452f5ee987461933d24c3ae86a3d70a21b1f1ecf61f',
    commitAB64: 'w0e1F7XMp2ZkPfRS9e6YdGGTPSTDroaj1wohsfHs9h8=',
    secret: null,
    qr: null,
    salt: '0000000000000000000000000000000000000000000000000000000000000000',
    z: '16a99c45ea32f68efefa7ca9544297ecf285cb86846d1dfffae8d0aef54cce2f',
    wrapKey: '8cc8d8851e0cdb00c0518883c6b40e111074835211f63c6125bb917557d011e0',
    sasInt: 1560041827,
    // ZÉRO DE TÊTE : c'est le bug le plus probable de toute la série.
    sasDigits: '041827',
    sasDisplay: '04 18 27',
    fek: '0000000000000000000000000000000000000000000000000000000000000000',
    iv: 'aabbccddeeff001122334455',
    wrappedFek:
      'aabbccddeeff0011223344553451c4727ce6bec2dc04375b1a8f73dbd1579ea5' +
      '5420e13afb826d3f1fb9156e1a9e47e3f32bdfc21770cd1368f437fb',
    wrappedFekB64:
      'qrvM3e7/ABEiM0RVNFHEcnzmvsLcBDdbGo9z29FXnqVUIOE6+4JtPx+5FW4ankfj8yvfwhdwzRNo9Df7',
  },
  {
    name: 'V2-3 — mode QR, secret et bornes extrémales',
    code: '999999',
    mode: 'qr',
    privA: '0d7731725cc6c6c8dae393c2d03a8f580f86e31205b7cf96a1d53e15017df955',
    pubA:
      '04794dceb7284757f8507fce5a7279ff9997193077f9505fb32ad4baf4128ca3' +
      'b1a75a0e6dd1602e73b336b0193c799a9deab5f74d6bdf4f14ad44122689a00a30',
    privB: '68746664517654105a31d024569ca8d5742115fe99e4285b65d1ad4ce72b59c6',
    pubB:
      '0409abd00df950888b34c10fa54648089926a81348f6e8119906d162de46edd6' +
      '3e44ebdd019d85cfff4818c9899097f73996a944f416e7a3abe8cfa9e9dec3256e',
    commitA: '4240b345af84aa10c296726bf72be6139a19a224a1c5fa6bc9d0360e6a1131b1',
    commitAB64: 'QkCzRa+EqhDClnJr9yvmE5oZoiShxfprydA2DmoRMbE=',
    // Un `S` QUASI NUL, pour distinguer « sel de 32 zéros » (mode manuel) d'un
    // sel presque nul : une implémentation qui traiterait un `S` à zéros comme
    // « absent » divergerait exactement ici.
    secret: '00000000000000000000000000000000000000000000000000000000000000ff',
    qr: 'filarr://pair?v=2&code=999999&s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8',
    salt: '00000000000000000000000000000000000000000000000000000000000000ff',
    z: '4f851eac08e0cac3d83d29cd5ce54a28c57f363ae6498e4a9d83ed94b47e25fb',
    wrapKey: '9018b7c53f8fb3f47cf83f39ebb20807a160fcd1766b7cfb1c8f022b922becf9',
    sasInt: 3203184625,
    sasDigits: '184625',
    sasDisplay: '18 46 25',
    fek: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    iv: 'ffffffffffffffffffffffff',
    wrappedFek:
      'ffffffffffffffffffffffffcdc22fedb1062d195b1d0642b5559fadbccc9893' +
      '6d4f2764f681bb4078fdc5e0a03ea6209ea9f0f3618e03931ac4e2d7',
    wrappedFekB64:
      '////////////////zcIv7bEGLRlbHQZCtVWfrbzMmJNtTydk9oG7QHj9xeCgPqYgnqnw82GOA5MaxOLX',
  },
];

// ── §8.8 — ce que chaque implémentation DOIT affirmer ───────────────────────

describe.each(VECTORS.map((v) => [v.name, v] as const))('%s', (_name, v) => {
  const pubA = () => hex(v.pubA);
  const pubB = () => hex(v.pubB);
  const secret = () => (v.secret === null ? null : hex(v.secret));

  it('1. ECDH(privA,pubB) === ECDH(privB,pubA) === Z', async () => {
    const zFromA = await computeSharedSecret(await importPrivateKey(v.privA, v.pubA), pubB());
    const zFromB = await computeSharedSecret(await importPrivateKey(v.privB, v.pubB), pubA());
    expect(toHex(zFromA)).toBe(v.z);
    expect(toHex(zFromB)).toBe(v.z);
  });

  it('2. commitA = SHA-256(étiquette ‖ pubA), et se vérifie', () => {
    const commit = computeCommitA(pubA());
    expect(toHex(commit)).toBe(v.commitA);
    expect(Buffer.from(commit).toString('base64')).toBe(v.commitAB64);
    expect(verifyCommitA(pubA(), commit)).toBe(true);
    // Une clé publique substituée ne satisfait PAS l'engagement : c'est tout
    // l'objet de l'engagement, et c'est le contrôle qui interdit le broyage
    // hors ligne du SAS.
    expect(verifyCommitA(pubB(), commit)).toBe(false);
  });

  it('3. K_wrap identique, dérivée par le chemin de A ET par celui de B', async () => {
    const info = buildWrapInfo(v.mode, v.code, pubA(), pubB());
    const salt = saltForMode(v.mode, secret());
    expect(toHex(salt)).toBe(v.salt);

    const zFromA = await computeSharedSecret(await importPrivateKey(v.privA, v.pubA), pubB());
    const zFromB = await computeSharedSecret(await importPrivateKey(v.privB, v.pubB), pubA());

    expect(toHex(await deriveWrapKeyBits(zFromA, salt, info))).toBe(v.wrapKey);
    expect(toHex(await deriveWrapKeyBits(zFromB, salt, info))).toBe(v.wrapKey);
  });

  it('4. et 5. SAS : les quatre octets, les six chiffres, et l’affichage', async () => {
    const info = buildSasInfo(v.mode, v.code, pubA(), pubB());
    const salt = saltForMode(v.mode, secret());
    const z = await computeSharedSecret(await importPrivateKey(v.privA, v.pubA), pubB());

    const sas = await computeSas(z, salt, info);
    // L'entier gros-boutiste épingle les quatre octets de sortie HKDF.
    expect(sas.int).toBe(v.sasInt);
    // Caractère pour caractère — zéros de tête et espaces compris.
    expect(sas.digits).toBe(v.sasDigits);
    expect(sas.display).toBe(v.sasDisplay);
    expect(sas.display).toHaveLength(8);
  });

  it('6. emballage : le chemin `deriveKey` de production produit le chiffré doré', async () => {
    const info = buildWrapInfo(v.mode, v.code, pubA(), pubB());
    const salt = saltForMode(v.mode, secret());
    const z = await computeSharedSecret(await importPrivateKey(v.privA, v.pubA), pubB());

    // On emballe avec la clé NON EXTRACTIBLE réellement utilisée en
    // production : si `deriveKey` et `deriveBits` divergeaient d'un seul bit,
    // le chiffré ne tomberait pas juste.
    const wrapKey = await deriveWrapKey(z, salt, info, ['wrapKey']);
    const wrapped = await wrapFek(await importFek(v.fek), wrapKey, hex(v.iv));

    expect(wrapped).toHaveLength(WRAPPED_FEK_LENGTH);
    expect(toHex(wrapped)).toBe(v.wrappedFek);
    expect(Buffer.from(wrapped).toString('base64')).toBe(v.wrappedFekB64);
  });

  it('6bis. déballage : B retrouve exactement la FEK', async () => {
    const info = buildWrapInfo(v.mode, v.code, pubA(), pubB());
    const salt = saltForMode(v.mode, secret());
    const z = await computeSharedSecret(await importPrivateKey(v.privB, v.pubB), pubA());

    const unwrapKey = await deriveWrapKey(z, salt, info, ['unwrapKey']);
    const fek = await unwrapFek(hex(v.wrappedFek), unwrapKey);
    expect(await exportRaw(fek)).toBe(v.fek);
  });

  it('7. le QR doré se relit et rend {code, S} exacts', () => {
    if (v.qr === null) {
      // Vecteur manuel : il n'y a pas de QR, et c'est le point du vecteur.
      expect(v.secret).toBeNull();
      expect(modeFromSecret(null)).toBe('manual');
      return;
    }
    const parsed = parsePairingQrV2(v.qr);
    expect(parsed).not.toBeNull();
    expect(parsed?.code).toBe(v.code);
    expect(toHex(parsed?.secret as Uint8Array)).toBe(v.secret);
    expect(modeFromSecret(parsed?.secret ?? null)).toBe('qr');
  });

  /**
   * Les assertions précédentes valident les primitives une par une. Celle-ci
   * valide la COMPOSITION réellement appelée en production — la même fonction,
   * avec les mêmes arguments, depuis chacun des deux rôles. Un vecteur peut
   * tomber juste sur chaque brique et faux sur l'assemblage : c'est même le
   * défaut le plus courant (inverser `pubA`/`pubB` du point de vue de B,
   * passer le mauvais `remotePublicKeyRaw`).
   */
  it('composition : A et B obtiennent le MÊME SAS et des clés interopérables', async () => {
    const fromA = await deriveSessionMaterial({
      privateKey: await importPrivateKey(v.privA, v.pubA),
      remotePublicKeyRaw: pubB(),
      publicKeyARaw: pubA(),
      publicKeyBRaw: pubB(),
      mode: v.mode,
      secret: secret(),
      code: v.code,
      usages: ['wrapKey'],
    });
    const fromB = await deriveSessionMaterial({
      privateKey: await importPrivateKey(v.privB, v.pubB),
      // Du point de vue de B, le pair distant est A — mais l'ORDRE du
      // transcript reste `pubA` puis `pubB`, fixé par les rôles et jamais par
      // « local d'abord ».
      remotePublicKeyRaw: pubA(),
      publicKeyARaw: pubA(),
      publicKeyBRaw: pubB(),
      mode: v.mode,
      secret: secret(),
      code: v.code,
      usages: ['unwrapKey'],
    });

    // Même nombre affiché des deux côtés : c'est ce que l'utilisateur compare.
    expect(fromA.sas.digits).toBe(v.sasDigits);
    expect(fromB.sas.digits).toBe(v.sasDigits);
    expect(fromA.sas.display).toBe(fromB.sas.display);

    // Et les clés s'accordent : ce que A emballe, B le déballe.
    const wrapped = await wrapFek(await importFek(v.fek), fromA.wrapKey, hex(v.iv));
    expect(toHex(wrapped)).toBe(v.wrappedFek);
    expect(await exportRaw(await unwrapFek(wrapped, fromB.wrapKey))).toBe(v.fek);
  });

  it('8. |INFO_WRAP| = 159 et |INFO_SAS| = 158', () => {
    expect(buildWrapInfo(v.mode, v.code, pubA(), pubB())).toHaveLength(INFO_WRAP_LENGTH);
    expect(buildSasInfo(v.mode, v.code, pubA(), pubB())).toHaveLength(INFO_SAS_LENGTH);
    expect(INFO_WRAP_LENGTH).toBe(159);
    expect(INFO_SAS_LENGTH).toBe(158);
  });
});

// ── §8.5 — V2-4 : la rétrogradation de mode DOIT diverger ───────────────────

describe('V2-4 — rétrogradation qr → manual (DOIT diverger)', () => {
  const v = VECTORS[0];
  const A_WRAP_KEY = '11b37db82a937aae7d16011b060b02e170a67a53e94ad6461d12d3b611376a45';
  const A_SAS_DIGITS = '239525';
  const A_SAS_DISPLAY = '23 95 25';

  /**
   * Mise en situation : le serveur réécrit `mode` de `qr` à `manual` sur le
   * chemin de A. A dérive donc avec le sel nul et l'octet `0x4D` ; B, qui a
   * scanné, dérive avec `S` et `0x51`. Le `Z` est le MÊME des deux côtés — la
   * substitution ne porte que sur le mode.
   */
  it('A (croit manuel) et B (sait QR) obtiennent des K_wrap et des SAS différents', async () => {
    const pubA = hex(v.pubA);
    const pubB = hex(v.pubB);
    const z = hex(v.z);

    const aSalt = saltForMode('manual', null);
    const aWrap = await deriveWrapKeyBits(z, aSalt, buildWrapInfo('manual', v.code, pubA, pubB));
    const aSas = await computeSas(z, aSalt, buildSasInfo('manual', v.code, pubA, pubB));

    const bSalt = saltForMode('qr', hex(v.secret as string));
    const bWrap = await deriveWrapKeyBits(z, bSalt, buildWrapInfo('qr', v.code, pubA, pubB));
    const bSas = await computeSas(z, bSalt, buildSasInfo('qr', v.code, pubA, pubB));

    // Valeurs dorées des deux côtés.
    expect(toHex(aWrap)).toBe(A_WRAP_KEY);
    expect(aSas.digits).toBe(A_SAS_DIGITS);
    expect(aSas.display).toBe(A_SAS_DISPLAY);
    expect(toHex(bWrap)).toBe(v.wrapKey);
    expect(bSas.digits).toBe(v.sasDigits);

    // CE QUE LE TEST AFFIRME VRAIMENT : les deux écrans montrent des nombres
    // différents, donc l'humain refuse, donc la FEK n'est JAMAIS emballée.
    // Une implémentation où ces valeurs coïncident a retiré l'octet de mode
    // ou le sel du transcript : la rétrogradation y serait silencieuse.
    expect(toHex(aWrap)).not.toBe(toHex(bWrap));
    expect(aSas.digits).not.toBe(bSas.digits);
  });
});

// ── Invariants transverses ──────────────────────────────────────────────────

describe('invariants du transcript', () => {
  const v = VECTORS[0];

  it("l'ordre pubA puis pubB n'est JAMAIS trié : inverser change le SAS", async () => {
    const pubA = hex(v.pubA);
    const pubB = hex(v.pubB);
    const z = hex(v.z);
    const salt = hex(v.secret as string);

    const correct = await computeSas(z, salt, buildSasInfo('qr', v.code, pubA, pubB));
    const swapped = await computeSas(z, salt, buildSasInfo('qr', v.code, pubB, pubA));

    // Un tri par valeur d'octets rendrait le transcript invariant par échange
    // des rôles et masquerait une confusion de rôle. La divergence attendue
    // ici est la preuve que rien ne trie.
    expect(correct.digits).toBe(v.sasDigits);
    expect(swapped.digits).not.toBe(correct.digits);
  });

  it('le sel du mode manuel est 32 octets nuls explicites', () => {
    const salt = saltForMode('manual', null);
    expect(salt).toHaveLength(32);
    expect(toHex(salt)).toBe('00'.repeat(32));
    // Même si un secret traîne, le mode manuel l'ignore : c'est ce qui rend
    // la rétrogradation détectable au lieu d'être absorbée en silence.
    expect(toHex(saltForMode('manual', hex(v.secret as string)))).toBe('00'.repeat(32));
  });

  it('le mode QR sans secret est une erreur, pas un repli silencieux', () => {
    expect(() => saltForMode('qr', null)).toThrow();
    expect(() => saltForMode('qr', new Uint8Array(31))).toThrow();
  });

  it('le mode se déduit MÉCANIQUEMENT de la présence du secret', () => {
    expect(modeFromSecret(null)).toBe('manual');
    expect(modeFromSecret(new Uint8Array(32))).toBe('qr');
  });

  it('une clé publique mal formée fait échouer la session, sans `Z` de repli', async () => {
    const priv = await importPrivateKey(v.privA, v.pubA);
    // Longueur correcte mais marqueur de point compressé.
    const compressed = hex(v.pubB);
    compressed[0] = 0x02;
    await expect(computeSharedSecret(priv, compressed)).rejects.toThrow();
    // Longueur incorrecte.
    await expect(computeSharedSecret(priv, hex(v.pubB).subarray(0, 64))).rejects.toThrow();
  });

  it('un emballage de mauvaise longueur est refusé AVANT tout appel crypto', async () => {
    const info = buildWrapInfo(v.mode, v.code, hex(v.pubA), hex(v.pubB));
    const key = await deriveWrapKey(hex(v.z), hex(v.secret as string), info, ['unwrapKey']);
    await expect(unwrapFek(hex(v.wrappedFek).subarray(0, 59), key)).rejects.toThrow(
      /Invalid wrapped FEK length/
    );
  });

  it('un tag GCM qui ne tombe pas juste fait échouer le déballage', async () => {
    const info = buildWrapInfo(v.mode, v.code, hex(v.pubA), hex(v.pubB));
    const key = await deriveWrapKey(hex(v.z), hex(v.secret as string), info, ['unwrapKey']);
    const tampered = hex(v.wrappedFek);
    tampered[tampered.length - 1] ^= 0x01;
    await expect(unwrapFek(tampered, key)).rejects.toThrow();
  });

  it("l'affichage groupe en NN NN NN, y compris avec des zéros de tête", () => {
    expect(formatSasDisplay('041827')).toBe('04 18 27');
    expect(formatSasDisplay('000000')).toBe('00 00 00');
    expect(formatSasDisplay('999999')).toBe('99 99 99');
  });
});
