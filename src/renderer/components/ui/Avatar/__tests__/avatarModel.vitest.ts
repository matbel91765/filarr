/**
 * Avatar — initiales et teinte stable.
 *
 * Ce qui est verrouillé ici, c'est ce qui se casse sans bruit : des initiales
 * qui changent de règle selon la forme du libellé (e-mail ou nom), un
 * caractère hors BMP coupé en deux, et surtout une teinte qui bougerait entre
 * deux rendus ou deux appareils — la couleur d'une personne est un repère,
 * elle doit être aussi stable que son nom.
 */

import { describe, it, expect } from 'vitest';
import { AVATAR_HUE_COUNT, avatarHueIndex, avatarInitials, fnv1a32 } from '../avatarModel';

describe('avatarInitials', () => {
  it('prend les deux premiers segments du local-part d’un e-mail', () => {
    expect(avatarInitials('jean.dupont@exemple.fr')).toBe('JD');
    expect(avatarInitials('jean_dupont@exemple.fr')).toBe('JD');
    expect(avatarInitials('jean-pierre.dupont@exemple.fr')).toBe('JP');
    expect(avatarInitials('jean+tag@exemple.fr')).toBe('JT');
  });

  it('ignore le domaine même quand il contient des points', () => {
    expect(avatarInitials('alice@mail.exemple.co.uk')).toBe('AL');
  });

  it('donne les deux premières lettres d’un local-part sans séparateur', () => {
    expect(avatarInitials('alice@exemple.fr')).toBe('AL');
    expect(avatarInitials('a@exemple.fr')).toBe('A');
  });

  it('traite un nom affiché comme un local-part : initiales des deux premiers mots', () => {
    expect(avatarInitials('Jean Dupont')).toBe('JD');
    expect(avatarInitials('Jean  Dupont   Martin')).toBe('JD');
    expect(avatarInitials('Bob')).toBe('BO');
  });

  it('met en majuscules et tolère les espaces autour', () => {
    expect(avatarInitials('  élodie.martin@exemple.fr  ')).toBe('ÉM');
    expect(avatarInitials('ÉLODIE')).toBe('ÉL');
  });

  it('ne coupe pas un caractère hors BMP en deux', () => {
    // Un emoji est une paire de substitution en UTF-16 : slice(0, 2) sur la
    // chaîne brute rendrait une moitié illisible.
    expect(avatarInitials('😀 Smiley')).toBe('😀S');
    expect(avatarInitials('😀😀')).toBe('😀😀');
  });

  it('répond « ? » à un libellé vide ou fait de séparateurs', () => {
    expect(avatarInitials('')).toBe('?');
    expect(avatarInitials('   ')).toBe('?');
    expect(avatarInitials('...')).toBe('?');
    expect(avatarInitials(undefined as unknown as string)).toBe('?');
  });

  it('retombe sur la chaîne entière quand le local-part est vide', () => {
    // Libellé dégénéré : la chaîne entière se découpe comme un nom, d'où
    // « @exemple » + « fr ». L'important est de ne pas répondre « ? ».
    expect(avatarInitials('@exemple.fr')).toBe('@F');
  });
});

describe('fnv1a32', () => {
  it('reproduit les vecteurs de référence FNV-1a 32 bits', () => {
    // Vecteurs publics (Landon Curt Noll) : chaîne vide et « a ».
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('reste dans les entiers non signés 32 bits', () => {
    for (const s of ['', 'x', 'jean.dupont@exemple.fr', '🙂', 'a'.repeat(1000)]) {
      const h = fnv1a32(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('avatarHueIndex', () => {
  it('est stable : même graine, même index, à chaque appel', () => {
    const seed = 'member-7f3a';
    const first = avatarHueIndex(seed);
    for (let i = 0; i < 20; i++) expect(avatarHueIndex(seed)).toBe(first);
  });

  it('reste dans [0, AVATAR_HUE_COUNT)', () => {
    const seeds = Array.from({ length: 500 }, (_, i) => `seed-${i}`);
    for (const s of seeds) {
      const idx = avatarHueIndex(s);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(AVATAR_HUE_COUNT);
      expect(Number.isInteger(idx)).toBe(true);
    }
  });

  it('couvre toutes les teintes sur un échantillon raisonnable', () => {
    // Pas un test de distribution uniforme (ce n'est pas ce que FNV promet),
    // mais une garantie que les 8 classes CSS servent toutes.
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(avatarHueIndex(`user-${i}@exemple.fr`));
    expect(seen.size).toBe(AVATAR_HUE_COUNT);
  });

  it('distingue des graines proches', () => {
    // Deux comptes qui ne diffèrent que d'un caractère ne doivent pas être
    // condamnés à la même teinte par construction — ici on vérifie au moins
    // que le hachage ne les confond pas.
    expect(fnv1a32('alice@exemple.fr')).not.toBe(fnv1a32('alicf@exemple.fr'));
  });

  it('valeurs figées : changer le hachage ou le nombre de teintes casse ce test volontairement', () => {
    // Ces valeurs sont un contrat : un membre garde sa couleur d'une version à
    // l'autre. Si elles bougent, c'est que l'apparence de tous les avatars
    // existants change — à décider, pas à subir.
    expect(AVATAR_HUE_COUNT).toBe(8);
    expect(avatarHueIndex('')).toBe(0x811c9dc5 % 8);
    expect(avatarHueIndex('a')).toBe(0xe40c292c % 8);
    expect(avatarHueIndex('jean.dupont@exemple.fr')).toBe(fnv1a32('jean.dupont@exemple.fr') % 8);
  });
});
