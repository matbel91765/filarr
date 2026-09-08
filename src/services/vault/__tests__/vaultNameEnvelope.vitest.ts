/**
 * vaultNameEnvelope (F14) — l'apparence du coffre voyage DANS le nom chiffré.
 *
 * CE QUE CES TESTS GARDENT, ET POURQUOI ILS SONT ÉCRITS AVANT LE MODULE.
 *
 * `name_encrypted` est la seule colonne du coffre scellée sous K_vault que tout
 * membre sait ouvrir. Y ranger l'emoji, la couleur et l'icône évite une
 * deuxième colonne, une deuxième migration et une deuxième époque à resceller —
 * mais impose une contrainte dure : **tout ce qui a déjà été écrit dans cette
 * colonne est un nom NU**, et le restera pour tous les clients d'avant cette
 * fiche. Un décodeur qui lèverait, ou qui rendrait une chaîne vide, ferait
 * afficher « Verrouillé » sur des coffres parfaitement lisibles — le même
 * accident que P1, par l'autre bout.
 *
 * D'où les trois règles éprouvées ici :
 *   · décoder ne lève JAMAIS — quoi qu'on lui donne ;
 *   · ce qui n'est pas une enveloppe reconnue vaut comme NOM, en entier ;
 *   · encoder puis décoder rend exactement ce qu'on avait — y compris pour un
 *     nom qui RESSEMBLE à une enveloppe (quelqu'un a le droit d'appeler son
 *     coffre `{"v":1,"n":"x"}`).
 *
 * Et une quatrième, qui n'est pas cosmétique : les valeurs d'apparence sont
 * BORNÉES avant chiffrement. Le serveur ne les voit pas, donc personne ne les
 * validera à notre place ; une couleur libre, c'est du CSS venu d'un autre
 * membre, et un « emoji » libre, c'est un paragraphe entier dans un bandeau.
 *
 *   npx vitest run src/services/vault/__tests__/vaultNameEnvelope.vitest.ts
 */

import { describe, it, expect } from 'vitest';
import {
  VAULT_APPEARANCE_COLORS,
  VAULT_APPEARANCE_ICONS,
  decodeVaultName,
  encodeVaultName,
  normalizeVaultAppearance,
  resolveVaultAppearance,
  type VaultAppearance,
} from '../vaultNameEnvelope';

describe('décoder ne lève jamais, et ce qui n’est pas une enveloppe est un nom', () => {
  it('une chaîne nue est le nom, en entier', () => {
    expect(decodeVaultName('Contrats 2026')).toEqual({ name: 'Contrats 2026' });
  });

  it('une chaîne vide reste vide — c’est « je n’ai pas su déchiffrer », pas un nom', () => {
    expect(decodeVaultName('')).toEqual({ name: '' });
  });

  it('un JSON sans version connue vaut comme nom NU, tel quel', () => {
    const raw = '{"v":99,"n":"Futur"}';
    expect(decodeVaultName(raw)).toEqual({ name: raw });
  });

  it('un JSON qui n’est pas un objet vaut comme nom nu', () => {
    expect(decodeVaultName('[1,2,3]')).toEqual({ name: '[1,2,3]' });
    expect(decodeVaultName('42')).toEqual({ name: '42' });
    expect(decodeVaultName('null')).toEqual({ name: 'null' });
    expect(decodeVaultName('"juste une chaîne"')).toEqual({ name: '"juste une chaîne"' });
  });

  it('une enveloppe dont le nom n’est pas une chaîne vaut comme nom nu', () => {
    const raw = '{"v":1,"n":123}';
    expect(decodeVaultName(raw)).toEqual({ name: raw });
  });

  it('rien de ce qu’on lui donne ne le fait lever', () => {
    const monstres = [
      '{',
      '{"v":1',
      // Les octets de contrôle en ÉCHAPPEMENTS : écrits nus, ils classaient ce
      // fichier « binaire » pour git et grep — plus aucun diff lisible, plus
      // aucune recherche. La valeur testée est exactement la même.
      '\u0000\u0001',
      '{"v":1,"n":"ok","emoji":{"x":1}}',
      '{"v":1,"n":"ok","color":[]}',
      'undefined',
    ];
    for (const m of monstres) {
      expect(() => decodeVaultName(m)).not.toThrow();
      expect(typeof decodeVaultName(m).name).toBe('string');
    }
  });
});

describe('encoder', () => {
  it('sans apparence, écrit le NOM NU — un client d’avant F14 doit le lire', () => {
    expect(encodeVaultName({ name: 'Contrats 2026' })).toBe('Contrats 2026');
  });

  it('une apparence vide de tout champ ne fabrique pas d’enveloppe', () => {
    expect(encodeVaultName({ name: 'Contrats', appearance: {} })).toBe('Contrats');
  });

  it('avec une apparence, écrit l’enveloppe versionnée', () => {
    const s = encodeVaultName({
      name: 'Contrats',
      appearance: { emoji: '📁', color: VAULT_APPEARANCE_COLORS[0] },
    });
    expect(JSON.parse(s)).toEqual({
      v: 1,
      n: 'Contrats',
      emoji: '📁',
      color: VAULT_APPEARANCE_COLORS[0],
    });
  });

  it('un nom qui RESSEMBLE à une enveloppe est forcé en enveloppe — sinon il se relirait de travers', () => {
    const piege = '{"v":1,"n":"autre chose"}';
    const encode = encodeVaultName({ name: piege });
    expect(decodeVaultName(encode).name).toBe(piege);
  });

  it('aller-retour : ce qu’on encode est ce qu’on relit', () => {
    const cas: Array<{ name: string; appearance?: VaultAppearance }> = [
      { name: 'Nu' },
      { name: 'Avec emoji', appearance: { emoji: '🔒' } },
      { name: 'Avec couleur', appearance: { color: VAULT_APPEARANCE_COLORS[3] } },
      { name: 'Avec icône', appearance: { icon: VAULT_APPEARANCE_ICONS[1] } },
      {
        name: 'Tout',
        appearance: {
          emoji: '🗄️',
          color: VAULT_APPEARANCE_COLORS[5],
          icon: VAULT_APPEARANCE_ICONS[0],
        },
      },
    ];
    for (const c of cas) expect(decodeVaultName(encodeVaultName(c))).toEqual(c);
  });
});

describe('les valeurs d’apparence sont bornées AVANT le chiffrement', () => {
  it('une couleur hors palette est refusée — pas de CSS libre venu d’un autre membre', () => {
    expect(normalizeVaultAppearance({ color: 'red' })).toBeUndefined();
    expect(normalizeVaultAppearance({ color: '#123456' })).toBeUndefined();
    expect(normalizeVaultAppearance({ color: 'var(--x)' })).toBeUndefined();
  });

  it('une couleur de la palette passe, quelle que soit sa casse', () => {
    const c = VAULT_APPEARANCE_COLORS[2];
    expect(normalizeVaultAppearance({ color: c.toUpperCase() })).toEqual({ color: c });
  });

  it('une icône inconnue est refusée', () => {
    expect(normalizeVaultAppearance({ icon: 'nope' })).toBeUndefined();
    expect(normalizeVaultAppearance({ icon: VAULT_APPEARANCE_ICONS[2] })).toEqual({
      icon: VAULT_APPEARANCE_ICONS[2],
    });
  });

  it('l’emoji est UN signe, pas un paragraphe', () => {
    expect(normalizeVaultAppearance({ emoji: '📁' })).toEqual({ emoji: '📁' });
    // Une famille (ZWJ) reste UN signe à l'écran.
    expect(normalizeVaultAppearance({ emoji: '👩‍👩‍👧' })).toEqual({ emoji: '👩‍👩‍👧' });
    expect(normalizeVaultAppearance({ emoji: '📁📁' })).toBeUndefined();
    expect(normalizeVaultAppearance({ emoji: 'Rapport annuel' })).toBeUndefined();
    expect(normalizeVaultAppearance({ emoji: '' })).toBeUndefined();
    expect(normalizeVaultAppearance({ emoji: ' ' })).toBeUndefined();
  });

  it('un champ refusé ne condamne pas les autres', () => {
    expect(
      normalizeVaultAppearance({ emoji: 'trop long', color: VAULT_APPEARANCE_COLORS[1] })
    ).toEqual({ color: VAULT_APPEARANCE_COLORS[1] });
  });

  it('ce qui n’est pas un objet ne rend rien', () => {
    expect(normalizeVaultAppearance(null)).toBeUndefined();
    expect(normalizeVaultAppearance('📁')).toBeUndefined();
    expect(normalizeVaultAppearance(undefined)).toBeUndefined();
  });

  it('une enveloppe portant des valeurs interdites se relit SANS elles, jamais en échec', () => {
    const raw = JSON.stringify({ v: 1, n: 'Coffre', emoji: 'beaucoup trop long', color: 'red' });
    expect(decodeVaultName(raw)).toEqual({ name: 'Coffre' });
  });
});

describe('les deux portées : « pour tout le monde » et « pour moi »', () => {
  it('le local l’emporte champ par champ, et le partagé reste le repli', () => {
    const partage: VaultAppearance = { emoji: '📁', color: VAULT_APPEARANCE_COLORS[0] };
    expect(resolveVaultAppearance(partage, { emoji: '🔥' })).toEqual({
      emoji: '🔥',
      color: VAULT_APPEARANCE_COLORS[0],
    });
  });

  it('sans local, c’est le partagé ; sans rien, ce n’est rien', () => {
    const partage: VaultAppearance = { color: VAULT_APPEARANCE_COLORS[4] };
    expect(resolveVaultAppearance(partage, undefined)).toEqual(partage);
    expect(resolveVaultAppearance(undefined, undefined)).toBeUndefined();
  });
});
