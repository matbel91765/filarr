/**
 * Ces tests gardent un CONTRAT INTER-PLATEFORMES, pas une fonction.
 *
 * Le format du QR d'appairage v2 est lu par trois implémentations qui ne se
 * parlent jamais (bureau, mobile, worker). Un analyseur qui diverge d'un
 * cheveu ne produit pas une erreur : il produit un SECRET DIFFÉRENT, donc une
 * clé d'emballage fausse, donc un appairage qui échoue sans que rien
 * n'indique lequel des deux appareils a tort. Si quelqu'un « améliore » un
 * jour la charge utile — un paramètre en plus, un ordre différent, un
 * décodeur base64url plus tolérant — ces tests doivent tomber ICI.
 *
 * DEUX COPIES, UNE SEULE VÉRITÉ. `src/services/auth/pairingQr.ts` (renderer)
 * et `electron/pairingQr.ts` (process principal) sont des duplicatas assumés
 * — le `rootDir` d'electron ne peut pas remonter dans `src/`. Ce fichier
 * importe LES DEUX, compare leurs corps octet pour octet, et rejoue sur
 * CHACUNE la table de conformité §1.4. Une divergence ne peut donc pas être
 * livrée en silence.
 */

import * as fs from 'fs';
import * as path from 'path';

import * as rendererQr from '../pairingQr';
import * as mainQr from '../../../../electron/pairingQr';
import { describe, it, expect } from 'vitest';

/** Les deux copies, testées à l'identique. */
const COPIES: Array<[string, typeof rendererQr]> = [
  ['copie renderer (src/services/auth)', rendererQr],
  ['copie process principal (electron)', mainQr as unknown as typeof rendererQr],
];

const hex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** Vecteur doré V2-1 (§8.2) — le QR nominal. */
const V1 = {
  code: '482913',
  secretHex: 'd66da6043f6df5ec4f8721801cf4966a3da8cc2cff672a1322a7b92c83ffabad',
  s: '1m2mBD9t9exPhyGAHPSWaj2ozCz_ZyoTIqe5LIP_q60',
  qr: 'filarr://pair?v=2&code=482913&s=1m2mBD9t9exPhyGAHPSWaj2ozCz_ZyoTIqe5LIP_q60',
};

/** Vecteur doré V2-3 (§8.4) — secret quasi nul, bourrage à la limite. */
const V3 = {
  code: '999999',
  secretHex: '00000000000000000000000000000000000000000000000000000000000000ff',
  s: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8',
  qr: 'filarr://pair?v=2&code=999999&s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8',
};

// ── La duplication ne peut pas dériver ──────────────────────────────────────

describe('les deux copies du module', () => {
  it('ont un corps identique à l’octet près (seul l’en-tête diffère)', () => {
    const root = path.resolve(__dirname, '../../../..');
    const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
    // On coupe au premier `*/` : c'est la fin du bloc de commentaire d'en-tête,
    // le seul endroit où les deux fichiers ont le droit de différer.
    const bodyOf = (text: string) => text.slice(text.indexOf('*/') + 2);

    const rendererBody = bodyOf(read('src/services/auth/pairingQr.ts'));
    const mainBody = bodyOf(read('electron/pairingQr.ts'));

    expect(mainBody).toBe(rendererBody);
    // Garde-fou : si la découpe rate, la comparaison ci-dessus deviendrait
    // triviale (deux chaînes vides sont égales).
    expect(rendererBody.length).toBeGreaterThan(1000);
  });
});

// ── §1.4 — table de conformité de l'analyseur ───────────────────────────────

describe.each(COPIES)('%s', (_name, qr) => {
  describe('construction (§1.2)', () => {
    it('produit exactement la chaîne dorée V2-1', () => {
      expect(qr.buildPairingQrPayloadV2(V1.code, hex(V1.secretHex))).toBe(V1.qr);
    });

    it('produit exactement la chaîne dorée V2-3 (bourrage à la limite)', () => {
      expect(qr.buildPairingQrPayloadV2(V3.code, hex(V3.secretHex))).toBe(V3.qr);
    });

    it("place `v`, puis `code`, puis `s` — l'ordre est FIXE", () => {
      const payload = qr.buildPairingQrPayloadV2(V1.code, hex(V1.secretHex)) as string;
      expect(payload.indexOf('v=2')).toBeLessThan(payload.indexOf('code='));
      expect(payload.indexOf('code=')).toBeLessThan(payload.indexOf('s='));
    });

    it('refuse un code qui n’est pas six chiffres', () => {
      const s = hex(V1.secretHex);
      expect(qr.buildPairingQrPayloadV2('12345', s)).toBeNull();
      expect(qr.buildPairingQrPayloadV2('1234567', s)).toBeNull();
      expect(qr.buildPairingQrPayloadV2('', s)).toBeNull(); // état React avant la réponse IPC
      expect(qr.buildPairingQrPayloadV2('12345a', s)).toBeNull();
      expect(qr.buildPairingQrPayloadV2('123 456', s)).toBeNull();
      // Ancrage réel, pas un simple `test` : un code gravé sur deux lignes
      // serait tronqué à l'analyse et jumellerait avec un AUTRE code.
      expect(qr.buildPairingQrPayloadV2('123456\n', s)).toBeNull();
      expect(qr.buildPairingQrPayloadV2('\n123456', s)).toBeNull();
      // Tentative d'injection d'un second paramètre par le code.
      expect(qr.buildPairingQrPayloadV2('123456&next=https://evil.example', s)).toBeNull();
    });

    it('refuse un secret qui ne fait pas exactement 32 octets', () => {
      // Un secret tronqué serait accepté par l'autre appareil sans broncher :
      // c'est le sel HKDF, personne ne vérifie son entropie en aval.
      expect(qr.buildPairingQrPayloadV2(V1.code, new Uint8Array(31))).toBeNull();
      expect(qr.buildPairingQrPayloadV2(V1.code, new Uint8Array(33))).toBeNull();
      expect(qr.buildPairingQrPayloadV2(V1.code, new Uint8Array(0))).toBeNull();
    });
  });

  describe('analyse — lignes ACCEPTE de §1.4', () => {
    it('accepte le QR nominal et rend {code, S} exacts', () => {
      const parsed = qr.parsePairingQrV2(V1.qr);
      expect(parsed?.code).toBe(V1.code);
      expect(toHex(parsed?.secret as Uint8Array)).toBe(V1.secretHex);
    });

    it('accepte un schéma en capitales (RFC 3986 §3.1 : schéma insensible à la casse)', () => {
      const upper = `FILARR://PAIR?v=2&code=${V1.code}&s=${V1.s}`;
      const parsed = qr.parsePairingQrV2(upper);
      expect(parsed?.code).toBe(V1.code);
      expect(toHex(parsed?.secret as Uint8Array)).toBe(V1.secretHex);
    });

    it('accepte un `s` de casse différente — mais c’est un AUTRE secret', () => {
      // La casse de `s` est SIGNIFIANTE : `M` et `m` sont deux valeurs
      // base64url distinctes. La chaîne est donc valide, et elle échouera au
      // SAS — ce qui est le comportement voulu, pas un bug d'analyse.
      const other = `filarr://pair?v=2&code=${V1.code}&s=1M2mBD9t9exPhyGAHPSWaj2ozCz_ZyoTIqe5LIP_q60`;
      const parsed = qr.parsePairingQrV2(other);
      expect(parsed).not.toBeNull();
      expect(toHex(parsed?.secret as Uint8Array)).not.toBe(V1.secretHex);
    });

    it('tolère les espaces en bordure (un scanner en ajoute parfois)', () => {
      expect(qr.parsePairingQrV2(`  ${V1.qr}\n`)?.code).toBe(V1.code);
    });
  });

  describe('analyse — lignes REFUSE de §1.4', () => {
    const REFUSED: Array<[string, string]> = [
      ['ordre des paramètres inversé', `filarr://pair?code=${V1.code}&v=2&s=${V1.s}`],
      [
        'paramètre supplémentaire (surface de redirection)',
        `filarr://pair?v=2&code=${V1.code}&s=${V1.s}&next=evil`,
      ],
      ['marqueur de version absent', `filarr://pair?code=${V1.code}&s=${V1.s}`],
      ['QR v1 — aiguillé vers le refus fermé §7', `filarr://pair?code=${V1.code}`],
      ['six chiffres nus — c’est une SAISIE MANUELLE, pas un QR', V1.code],
      ['code à cinq chiffres', `filarr://pair?v=2&code=48291&s=${V1.s}`],
      ['code à sept chiffres', `filarr://pair?v=2&code=4829130&s=${V1.s}`],
      ['secret de 42 caractères', `filarr://pair?v=2&code=${V1.code}&s=${V1.s.slice(0, 42)}`],
      ['secret de 44 caractères', `filarr://pair?v=2&code=${V1.code}&s=${V1.s}A`],
      [
        'base64 standard au lieu de base64url',
        `filarr://pair?v=2&code=${V1.code}&s=1m2mBD9t9exPhyGAHPSWaj2ozCz/ZyoTIqe5LIP/q60`,
      ],
      ['version 3', `filarr://pair?v=3&code=${V1.code}&s=${V1.s}`],
      ['hôte différent', `filarr://join?v=2&code=${V1.code}&s=${V1.s}`],
      ['schéma différent', `https://pair?v=2&code=${V1.code}&s=${V1.s}`],
      ['pas de requête', 'filarr://pair'],
      ['chaîne vide', ''],
      ['saut de ligne interne (ancrage)', `filarr://pair?v=2&code=${V1.code}&s=${V1.s}\nevil`],
    ];

    it.each(REFUSED)('refuse : %s', (_label, input) => {
      expect(qr.parsePairingQrV2(input)).toBeNull();
      expect(qr.isPairingQrV2(input)).toBe(false);
    });

    it('refuse `null` et `undefined` sans lever', () => {
      expect(qr.parsePairingQrV2(null)).toBeNull();
      expect(qr.parsePairingQrV2(undefined)).toBeNull();
    });
  });

  describe('canonicité base64url — le piège le moins évident', () => {
    /**
     * 43 caractères base64url portent 258 bits pour 256 bits utiles : les DEUX
     * BITS DE POIDS FAIBLE du dernier caractère sont structurellement nuls.
     * `…q60` est canonique ; `…q61`, `…q62`, `…q63` décodent aux mêmes 32
     * octets chez un décodeur laxiste. Deux implémentations qui ne s'accordent
     * pas ici obtiennent des `S` différents et un échec MUET.
     */
    it('accepte la seule forme canonique', () => {
      expect(qr.parsePairingQrV2(V1.qr)).not.toBeNull();
      expect(V1.s.endsWith('q60')).toBe(true);
    });

    it.each(['q61', 'q62', 'q63'])(
      'refuse un dernier caractère dont les bits de bourrage ne sont pas nuls (%s)',
      (tail) => {
        const s = `${V1.s.slice(0, -3)}${tail}`;
        expect(s).toHaveLength(43);
        expect(qr.parsePairingQrV2(`filarr://pair?v=2&code=${V1.code}&s=${s}`)).toBeNull();
      }
    );

    it('refuse aussi côté V2-3, dont le dernier caractère est `8`', () => {
      // `P8` : l'index base64 de `8` vaut 60, dont les 2 bits bas sont nuls.
      // `P9` (61) ne l'est pas.
      expect(V3.s.endsWith('P8')).toBe(true);
      const s = `${V3.s.slice(0, -1)}9`;
      expect(qr.parsePairingQrV2(`filarr://pair?v=2&code=${V3.code}&s=${s}`)).toBeNull();
    });
  });

  describe('aller-retour', () => {
    it('tout secret de 32 octets se reconstruit à l’identique', () => {
      for (let seed = 0; seed < 16; seed++) {
        const secret = new Uint8Array(32);
        for (let i = 0; i < 32; i++) secret[i] = (seed * 31 + i * 17 + 7) & 0xff;
        const payload = qr.buildPairingQrPayloadV2('314159', secret) as string;
        const parsed = qr.parsePairingQrV2(payload);
        expect(parsed?.code).toBe('314159');
        expect(toHex(parsed?.secret as Uint8Array)).toBe(toHex(secret));
      }
    });

    it('le secret est absent des chemins non-QR : il n’y a pas d’autre porteur', () => {
      // Rappel de contrat : `S` ne transite QUE par l'image. Aucune fonction
      // de ce module ne le sérialise ailleurs, et aucune route serveur ne
      // l'accepte. Le seul champ qui le porte est `s`.
      const payload = qr.buildPairingQrPayloadV2(V1.code, hex(V1.secretHex)) as string;
      expect(payload.split('&')).toHaveLength(3);
      expect(payload).not.toMatch(/token|key|fek|secret=/i);
    });
  });
});

// ── Compatibilité descendante : le refus est FERMÉ, des deux côtés ──────────

describe('frontière v1 / v2', () => {
  /** Motif que le mobile v1 applique au scan. Copie littérale. */
  const V1_MOBILE_PATTERN = /^filarr:\/\/pair\?code=(\d{6})$/i;

  it('un QR v2 est REFUSÉ par l’analyseur v1 du mobile', () => {
    // Un vieux mobile ne peut donc pas « réussir » un appairage v2 en
    // ignorant le secret : il échoue à l'analyse, avant tout réseau.
    expect(V1_MOBILE_PATTERN.test(V1.qr)).toBe(false);
  });

  it('un QR v1 est REFUSÉ par l’analyseur v2', () => {
    // Et réciproquement. Aucun repli silencieux n'est possible dans un sens
    // ni dans l'autre : un repli vers v1 serait un repli vers « le serveur
    // peut lire la FEK », et l'attaquant qui manipule le réseau choisirait
    // toujours v1.
    expect(rendererQr.parsePairingQrV2(`filarr://pair?code=${V1.code}`)).toBeNull();
  });

  it('la version portée par le module est bien 2', () => {
    expect(rendererQr.PAIRING_PROTOCOL_VERSION).toBe(2);
    expect(mainQr.PAIRING_PROTOCOL_VERSION).toBe(2);
  });
});
