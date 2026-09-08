/**
 * blockCodec.vitest.ts — Compression d'un bloc avant chiffrement.
 *
 * Ce qui est défendu ici :
 *  1. UN BLOC NE GROSSIT JAMAIS. Sur des octets déjà comprimés, deflate ajoute
 *     des marqueurs ; sans la règle d'utilité, la « compression » coûterait du
 *     stockage au lieu d'en rendre.
 *  2. LA TAILLE ATTENDUE EST VÉRIFIÉE. Sans ça, une bombe de décompression
 *     passerait pour un bloc légitime.
 *  3. LE DRAPEAU ET LA CHARGE UTILE SORTENT ENSEMBLE, donc ne peuvent pas se
 *     désynchroniser.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPRESS_RATIO_THRESHOLD,
  MIN_COMPRESS_SIZE,
  decodePayload,
  deflateRaw,
  inflateRaw,
  maybeCompress,
} from '../blockCodec';
import { ERR_CORRUPT } from '../blockFormat';

const TE = new TextEncoder();

/** Du JSON réaliste : c'est ce que contiennent les notes et les manifestes. */
function notesJson(n: number): Uint8Array {
  return TE.encode(
    JSON.stringify({
      notes: Array.from({ length: n }, (_, i) => ({
        id: `note-${i}`,
        title: `Réunion ${i}`,
        body: `Compte rendu de la réunion du ${i} septembre. Budget, planning, risques.`,
        tags: ['travail', 'reunion'],
        updatedAt: '2026-09-05T04:00:00Z',
      })),
    })
  );
}

/** Octets incompressibles et reproductibles. */
function incompressible(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

describe('aller-retour brut', () => {
  it('rend exactement les octets d\'origine', async () => {
    for (const data of [notesJson(50), incompressible(10_000), new Uint8Array(5000)]) {
      const back = await inflateRaw(await deflateRaw(data));
      expect(Array.from(back)).toEqual(Array.from(data));
    }
  });

  it('gère un tampon vide', async () => {
    expect((await inflateRaw(await deflateRaw(new Uint8Array(0)))).length).toBe(0);
  });

  it('lève ERR_CORRUPT sur des octets qui ne sont pas du deflate', async () => {
    // Même message que le reste de la chaîne : un bloc abîmé donne toujours la
    // même erreur, quelle que soit l'étape où il casse.
    await expect(inflateRaw(TE.encode('ceci n\'est pas du deflate du tout'))).rejects.toThrow(ERR_CORRUPT);
  });
});

describe('règle d\'utilité — un bloc ne grossit jamais', () => {
  it('compresse du JSON et annonce le drapeau', async () => {
    const data = notesJson(200);
    const r = await maybeCompress(data);
    expect(r.compressed).toBe(true);
    expect(r.payload.length).toBeLessThan(data.length * 0.2);
  });

  it('REFUSE de compresser des octets incompressibles', async () => {
    // Mesuré : 65 536 octets aléatoires ressortent à 65 558 en deflate. Sans
    // cette règle, la « compression » coûterait du stockage.
    const data = incompressible(65_536);
    const r = await maybeCompress(data);
    expect(r.compressed).toBe(false);
    expect(r.payload).toBe(data);
  });

  it('ne rend JAMAIS une charge utile plus grande que le clair', async () => {
    const cas = [
      notesJson(1), notesJson(10), notesJson(500),
      incompressible(200), incompressible(5000), incompressible(100_000),
      new Uint8Array(50_000), TE.encode('a'.repeat(30_000)),
    ];
    for (const data of cas) {
      const r = await maybeCompress(data);
      expect(r.payload.length, `taille ${data.length}`).toBeLessThanOrEqual(data.length);
    }
  });

  it('ne tente rien sous le seuil de taille', async () => {
    const petit = TE.encode('x'.repeat(MIN_COMPRESS_SIZE - 1));
    const r = await maybeCompress(petit);
    expect(r.compressed).toBe(false);
    expect(r.payload).toBe(petit);
  });

  it('exige un gain FRANC, pas marginal', async () => {
    // Un bloc qui ne gagne que quelques pourcents ne vaut pas le coût de
    // décompression à chaque lecture, sur chaque appareil, pour toujours.
    expect(COMPRESS_RATIO_THRESHOLD).toBeLessThan(1);
    const presqueAleatoire = incompressible(20_000, 99);
    const r = await maybeCompress(presqueAleatoire);
    if (r.compressed) {
      expect(r.payload.length).toBeLessThan(presqueAleatoire.length * COMPRESS_RATIO_THRESHOLD);
    }
  });
});

describe('décodage', () => {
  it('rétablit un bloc compressé', async () => {
    const data = notesJson(120);
    const { payload, compressed } = await maybeCompress(data);
    expect(compressed).toBe(true);
    const back = await decodePayload(payload, compressed, data.length);
    expect(Array.from(back)).toEqual(Array.from(data));
  });

  it('rétablit un bloc non compressé', async () => {
    const data = incompressible(9000);
    const { payload, compressed } = await maybeCompress(data);
    expect(compressed).toBe(false);
    const back = await decodePayload(payload, compressed, data.length);
    expect(Array.from(back)).toEqual(Array.from(data));
  });

  it('REFUSE une décompression qui ne rend pas la taille annoncée', async () => {
    // La défense contre la bombe de décompression. La taille attendue vient du
    // manifeste, authentifié par la FEK : elle ne peut pas être falsifiée par
    // qui stocke les octets.
    const data = notesJson(100);
    const { payload } = await maybeCompress(data);
    await expect(decodePayload(payload, true, data.length + 1)).rejects.toThrow(ERR_CORRUPT);
    await expect(decodePayload(payload, true, 1)).rejects.toThrow(ERR_CORRUPT);
  });

  it('REFUSE un bloc non compressé dont la taille ne colle pas', async () => {
    const data = incompressible(500);
    await expect(decodePayload(data, false, 499)).rejects.toThrow(ERR_CORRUPT);
  });

  it('une bombe de décompression est arrêtée par la taille attendue', async () => {
    // 4 Mio de zéros compressent en quelques kilo-octets. Un serveur qui
    // remplacerait un petit bloc par celui-ci ferait allouer 4 Mio au client —
    // et bien plus avec des blocs plus gros. La taille annoncée l'interdit.
    const bombe = await deflateRaw(new Uint8Array(4 * 1024 * 1024));
    expect(bombe.length).toBeLessThan(20_000);
    await expect(decodePayload(bombe, true, 1024)).rejects.toThrow(ERR_CORRUPT);
  });

  it('le drapeau menti dans un sens comme dans l\'autre est rejeté', async () => {
    const data = notesJson(80);
    const { payload } = await maybeCompress(data);
    // « pas compressé » alors que ça l'est : la taille ne colle pas.
    await expect(decodePayload(payload, false, data.length)).rejects.toThrow(ERR_CORRUPT);
    // « compressé » alors que ça ne l'est pas : ce ne sont pas des octets deflate.
    await expect(decodePayload(data, true, data.length)).rejects.toThrow(ERR_CORRUPT);
  });
});

describe('le codec est un ALGORITHME, pas une API — interopérabilité', () => {
  /**
   * LE test qui rend le lot 8 possible.
   *
   * Les trois surfaces n'utiliseront PAS le même moteur : Web Streams sur le
   * bureau et sur le web, `fflate` en React Native (où ni `CompressionStream`
   * ni `DecompressionStream` n'existent — vérifié par la session mobile, et
   * Hermes n'a même pas `TextDecoder`). Le contrat ne peut donc pas dire
   * « produit par `CompressionStream('deflate-raw')` » : il dit « DEFLATE brut
   * au sens de la RFC 1951 », et n'importe quelle implémentation conforme fait
   * l'affaire.
   *
   * On le PROUVE ici en faisant relire notre sortie par un moteur totalement
   * distinct (`node:zlib`), et en relisant la sienne. Si un jour quelqu'un
   * remplace l'implémentation par quelque chose qui n'est pas de la RFC 1951 —
   * du zlib avec en-tête, du gzip — cette suite tombe, et elle tombe AVANT que
   * le mobile ne découvre qu'il ne sait plus lire les blocs du bureau.
   */
  it('notre sortie est relue par un moteur indépendant', async () => {
    const zlib = await import('node:zlib');
    const data = notesJson(30);
    const nous = await deflateRaw(data);
    expect(Array.from(zlib.inflateRawSync(nous))).toEqual(Array.from(data));
  });

  it('nous relisons la sortie d\'un moteur indépendant', async () => {
    const zlib = await import('node:zlib');
    const data = notesJson(30);
    const eux = new Uint8Array(zlib.deflateRawSync(data));
    expect(Array.from(await inflateRaw(eux))).toEqual(Array.from(data));
  });

  it('le flux ne porte PAS d\'en-tête zlib', async () => {
    // Un en-tête zlib commence par 0x78. Sa présence signifierait qu'on a
    // produit du `deflate` et non du `deflate-raw` — lisible par `zlib` mais
    // pas par un lecteur qui attend du brut, donc une rupture silencieuse
    // entre surfaces.
    const sortie = await deflateRaw(notesJson(30));
    expect(sortie[0]).not.toBe(0x78);
  });
});

describe('plafond de sortie — la bombe est refusee AVANT d etre materialisee', () => {
  it('abandonne la lecture des que la sortie depasse le plafond', async () => {
    // 4 Mio de zeros tiennent dans quelques kilo-octets compresses. Sans
    // plafond, on materialise les 4 Mio puis on refuse ; avec, on s arrete des
    // le depassement. La difference est un plantage memoire contre un refus.
    const bombe = await deflateRaw(new Uint8Array(4 * 1024 * 1024));
    expect(bombe.length).toBeLessThan(20_000);
    await expect(inflateRaw(bombe, 1024)).rejects.toThrow(ERR_CORRUPT);
  });

  it('NE TRONQUE PAS — le depassement est constate, jamais devine', async () => {
    // Le piege signale par la session mobile apres mesure sur `fflate` : une
    // borne de sortie qui tronque au lieu de lever est PIRE que pas de borne,
    // parce que le controle de longueur voit alors la bonne taille et le
    // mauvais contenu. On verifie qu on leve, et qu on ne rend jamais un
    // prefixe silencieux.
    const clair = new Uint8Array(10_000).fill(7);
    const comprime = await deflateRaw(clair);
    await expect(inflateRaw(comprime, 9_999)).rejects.toThrow(ERR_CORRUPT);
    await expect(inflateRaw(comprime, 1)).rejects.toThrow(ERR_CORRUPT);
  });

  it('laisse passer un clair qui remplit exactement le plafond', async () => {
    const clair = new Uint8Array(10_000).fill(7);
    const comprime = await deflateRaw(clair);
    const relu = await inflateRaw(comprime, 10_000);
    expect(relu.length).toBe(10_000);
  });

  it('decodePayload pose le plafond a la taille attendue', async () => {
    const bombe = await deflateRaw(new Uint8Array(4 * 1024 * 1024));
    await expect(decodePayload(bombe, true, 1024)).rejects.toThrow(ERR_CORRUPT);
  });
});

describe("l encodeur DEFLATE n est pas deterministe, et c est conforme", () => {
  /**
   * LA limite que la session mobile a trouvee, et que mes 40 tests de
   * conformite ne pouvaient PAS voir : mon generateur de vecteurs et mon
   * implementation partagent le meme moteur de compression. L independance de
   * `gen-delta-vectors.mjs` couvre FastCDC, l en-tete et l AAD — pas le
   * compresseur.
   *
   * On fige donc la limite ici, pour que personne ne reecrive un jour un
   * vecteur « octet pour octet » sur un bloc compresse.
   */
  it('deux niveaux conformes produisent des octets differents du meme clair', async () => {
    const zlib = await import('node:zlib');
    const clair = TE.encode('Compte rendu de reunion. '.repeat(160));
    const n1 = new Uint8Array(zlib.deflateRawSync(clair, { level: 1 }));
    const n6 = new Uint8Array(zlib.deflateRawSync(clair, { level: 6 }));
    expect(n1.length).not.toBe(n6.length);
    // ... et pourtant les deux se relisent vers le MEME clair.
    expect(Array.from(await inflateRaw(n1))).toEqual(Array.from(clair));
    expect(Array.from(await inflateRaw(n6))).toEqual(Array.from(clair));
  });

  it('ce qui est opposable entre surfaces, c est le DECHIFFREMENT, pas le rechiffrement', async () => {
    // Formulation executable du §5.2 de la fiche : quelle que soit la maniere
    // dont une surface compresse, son resultat doit se relire partout vers le
    // meme clair. C est cela que les vecteurs lient pour les blocs compresses.
    const zlib = await import('node:zlib');
    const clair = TE.encode('donnees '.repeat(250));
    for (const level of [1, 6, 9]) {
      const parEux = new Uint8Array(zlib.deflateRawSync(clair, { level }));
      expect(Array.from(await inflateRaw(parEux)), `niveau ${level}`).toEqual(Array.from(clair));
    }
  });
});

describe('gain mesuré sur des données réalistes', () => {
  it('dépasse largement les 38 % annoncés sur du JSON de notes', async () => {
    const data = notesJson(300);
    const { payload, compressed } = await maybeCompress(data);
    expect(compressed).toBe(true);
    const gain = 1 - payload.length / data.length;
    // Le dossier annonçait −38 % en moyenne sur le corpus complet, binaires
    // incompressibles inclus. Sur du JSON pur, c'est bien plus.
    expect(gain).toBeGreaterThan(0.9);
  });
});
