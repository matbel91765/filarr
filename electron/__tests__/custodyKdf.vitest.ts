/**
 * LE PROFIL ARGON2ID DE LA CLÉ DE GARDE — le contrat le plus facile à casser
 * en silence de tout le lot.
 *
 * Argon2 ne se vérifie pas « à l'œil ». Une mauvaise correspondance de champ
 * (`t` envoyé dans `memoryCost`), un paramètre par défaut qui reprend la main,
 * une longueur de sortie erronée : rien de tout cela ne produit d'ERREUR. Cela
 * produit une KEK DIFFÉRENTE. L'emballage se fait très bien, et c'est le site
 * — des semaines plus tard — qui n'arrive plus à le déverrouiller.
 *
 * LE JUGE EST UN VECTEUR EXTERNE. `VECTOR_KEK` a été dérivée hors de ce dépôt
 * avec le profil du site (`hash-wasm`, m=19456, t=2, p=1, 32 octets) sur la
 * phrase et le sel du même vecteur. C'est la MÊME constante que celle figée
 * dans `src/services/custody/custodyCrypto.vitest.ts`, où elle sert à déballer
 * la privée : les deux moitiés du même contrat, jugées chacune à son étage.
 *
 * LE PIÈGE PRÉCIS QUE CE FICHIER FERME. `crypto:argon2DeriveKey` existait déjà
 * et rend, lui aussi, 32 octets pour un mot de passe et un sel. Le réutiliser
 * pour la clé de garde aurait « marché » — avec le profil du PIN local
 * (m=65536, t=3, p=4), donc une autre KEK, donc une clé de garde que ni le
 * site ni le mobile n'ouvriraient jamais. Le test le vérifie explicitement.
 */

import { describe, expect, it } from 'vitest';

import { argon2DeriveKey, argon2RawDerive } from '../argon2Service';

/** Phrase du vecteur — accentuée à dessein : UTF-8, sans normalisation Unicode. */
const VECTOR_PASSPHRASE = 'phrasé de récupération d’essai';

/** Sel du vecteur, base64 (16 octets). */
const VECTOR_SALT = 'AQIDBAUGBwgJCgsMDQ4PEA==';

/** KEK attendue, dérivée hors dépôt avec le profil du site. */
const VECTOR_KEK = 'eUaBWN+2TTktV7o//0dMjKw/s5hW2LynwLiA9pBpYvE=';

/** Le profil du site et du mobile. Le changer orpheline toutes les clés publiées. */
const CUSTODY_PROFILE = { memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 };

describe('argon2RawDerive — le profil de la clé de garde', () => {
  it(
    'reproduit OCTET POUR OCTET la KEK du vecteur produit par le site',
    async () => {
      const kek = await argon2RawDerive({
        password: VECTOR_PASSPHRASE,
        saltBase64: VECTOR_SALT,
        ...CUSTODY_PROFILE,
      });

      expect(kek).toBe(VECTOR_KEK);
    },
    20_000
  );

  it(
    'le profil du PIN local donnerait une AUTRE KEK — d’où un canal séparé',
    async () => {
      // `argon2DeriveKey` prend son sel en HEX et rend de l'HEX : mêmes 16
      // octets, autre encodage, autre profil. On compare les octets.
      const parPin = Buffer.from(
        await argon2DeriveKey(VECTOR_PASSPHRASE, Buffer.from(VECTOR_SALT, 'base64').toString('hex')),
        'hex'
      ).toString('base64');

      expect(parPin).not.toBe(VECTOR_KEK);
    },
    30_000
  );

  it(
    'accepte un sel en base64 URL-SAFE : les deux formes circulent dans le même enregistrement',
    async () => {
      const urlSafe = VECTOR_SALT.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const kek = await argon2RawDerive({
        password: VECTOR_PASSPHRASE,
        saltBase64: urlSafe,
        ...CUSTODY_PROFILE,
      });

      expect(kek).toBe(VECTOR_KEK);
    },
    20_000
  );
});

describe('argon2RawDerive — les refus', () => {
  const base = { password: 'x', saltBase64: VECTOR_SALT, ...CUSTODY_PROFILE };

  it('refuse un sel trop court plutôt que de dériver sur presque rien', async () => {
    await expect(argon2RawDerive({ ...base, saltBase64: 'AAAA' })).rejects.toThrow(
      'INVALID_ARGON2_SALT'
    );
  });

  it('refuse un coût mémoire délirant : il allouerait vraiment, dans le processus principal', async () => {
    await expect(argon2RawDerive({ ...base, memoryCost: 8_000_000 })).rejects.toThrow(
      'INVALID_ARGON2_PARAMS'
    );
  });

  it('refuse une longueur de sortie hors bornes', async () => {
    await expect(argon2RawDerive({ ...base, hashLength: 4 })).rejects.toThrow(
      'INVALID_ARGON2_PARAMS'
    );
  });

  it('refuse des paramètres non entiers — un `t` fractionnaire n’est pas un profil', async () => {
    await expect(argon2RawDerive({ ...base, timeCost: 2.5 })).rejects.toThrow(
      'INVALID_ARGON2_PARAMS'
    );
  });

  it('refuse une requête sans mot de passe au lieu d’en dériver un vide', async () => {
    await expect(
      argon2RawDerive({ ...base, password: undefined as unknown as string })
    ).rejects.toThrow('INVALID_ARGON2_REQUEST');
  });
});
