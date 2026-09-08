/**
 * « À qui appartiennent ces profils ? » — la question dont dépend tout le
 * parcours « ajouter un compte cloud ».
 *
 * Le défaut d'origine tenait en une ligne : après une connexion, l'assistant
 * prenait `profiles.find(isDefault) || profiles[0]` sur le manifeste LOCAL
 * ENTIER. Sur un appareil vierge, c'était juste. Depuis le sélecteur — le seul
 * endroit d'où ce bouton part —, la machine porte déjà des profils, et l'on
 * entrait chez quelqu'un d'autre.
 *
 * Ces cas verrouillent les deux sources qui, réunies, désignent le bon
 * ensemble, et le fait que `isDefault` ne décide de rien.
 */

import { describe, it, expect } from 'vitest';
import { profilesOfAccount, landingForAccount } from '../accountProfiles';

const p = (
  id: string,
  email?: string | null,
  isDefault = false
): { id: string; isDefault: boolean; cloudAccount?: { email?: string } | null } => ({
  id,
  isDefault,
  cloudAccount: email === undefined ? undefined : email === null ? null : { email },
});

describe('profilesOfAccount', () => {
  it("ignore les profils d'un AUTRE compte", () => {
    const profils = [p('a', 'moi@example.com'), p('b', 'autre@example.com')];

    expect(profilesOfAccount(profils, 'moi@example.com').map((x) => x.id)).toEqual(['a']);
  });

  it('ignore les profils purement locaux', () => {
    // Le cas exact du sélecteur : on travaillait hors ligne, on ajoute un
    // compte. Ce profil-là n'appartient à personne — l'assistant ne doit pas
    // s'en emparer au motif qu'il est là.
    const profils = [p('local'), p('autre-local', null), p('a', 'moi@example.com')];

    expect(profilesOfAccount(profils, 'moi@example.com').map((x) => x.id)).toEqual(['a']);
  });

  it('retient un profil que la restauration vient de rendre, même sans estampille', () => {
    // La liste d'identifiants et l'estampille n'arrivent pas toujours ensemble
    // (hors ligne, écriture du manifeste en retard) : l'une rattrape l'autre.
    const profils = [p('neuf'), p('vieux', 'moi@example.com')];

    expect(profilesOfAccount(profils, 'moi@example.com', ['neuf']).map((x) => x.id)).toEqual([
      'neuf',
      'vieux',
    ]);
  });

  it("retient un profil estampillé que la restauration N'A PAS rendu", () => {
    // `restoreProfileFromCloud` sort immédiatement sur un identifiant déjà
    // connu : le profil local rattaché au compte ne figure JAMAIS dans la liste
    // rendue. S'y fier seule le laisserait dehors — c'est-à-dire perdrait
    // précisément le profil sur lequel la personne travaillait.
    const profils = [p('deja-la', 'moi@example.com')];

    expect(profilesOfAccount(profils, 'moi@example.com', []).map((x) => x.id)).toEqual(['deja-la']);
  });

  it('ne compte pas deux fois un profil rendu ET estampillé', () => {
    const profils = [p('a', 'moi@example.com')];

    expect(profilesOfAccount(profils, 'moi@example.com', ['a'])).toHaveLength(1);
  });

  it('compare les adresses sans égard à la casse ni aux espaces', () => {
    const profils = [p('a', 'Moi@Example.COM')];

    expect(profilesOfAccount(profils, '  moi@example.com ').map((x) => x.id)).toEqual(['a']);
  });

  it('une adresse vide ne désigne AUCUN profil', () => {
    // Sinon `sameAccount(undefined, '')` ferait correspondre tous les profils
    // sans estampille : ne pas savoir à qui on parle deviendrait « ils sont
    // tous à moi ».
    const profils = [p('local'), p('a', 'moi@example.com')];

    expect(profilesOfAccount(profils, '')).toEqual([]);
  });
});

describe('landingForAccount', () => {
  it('aucun profil → création', () => {
    expect(landingForAccount([])).toEqual({ kind: 'create' });
  });

  it('un seul → on entre, sans rien demander', () => {
    expect(landingForAccount([p('a', 'moi@example.com')])).toEqual({
      kind: 'enter',
      profileId: 'a',
    });
  });

  it('plusieurs → on laisse choisir, et isDefault ne tranche PAS', () => {
    // `isDefault` désigne le profil par défaut de l'APPAREIL. Sur une machine
    // qui portait déjà un profil marqué ainsi, s'y fier ferait entrer dans le
    // mauvais — et sans que rien à l'écran ne l'explique.
    const mine = [p('a', 'moi@example.com'), p('b', 'moi@example.com', true)];

    expect(landingForAccount(mine)).toEqual({ kind: 'choose', profileIds: ['a', 'b'] });
  });
});
