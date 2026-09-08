/**
 * LES SUITES D'UNE VERSION — pourquoi c'est une liste et pas un champ.
 *
 * Republier demandait de taper un numéro, en partant du défaut `1.0.0` : le
 * numéro DÉJÀ publié, refusé par le serveur après tout le formulaire. Et rien
 * n'interdisait de saisir une version plus ANCIENNE — le worker l'aurait prise
 * si elle était inédite, et le catalogue aurait annoncé une régression comme
 * une nouveauté.
 *
 * Ce que ces tests gardent tient en une phrase : les trois suites proposées
 * sont TOUJOURS strictement supérieures à la dernière publiée. Le retour en
 * arrière devient alors impossible par construction, et non par un contrôle
 * qu'on peut oublier de rappeler.
 */

import { describe, it, expect } from 'vitest';

import { nextVersions } from '../layoutPublishValidation';

/** Compare deux versions comme le ferait un tri semver. */
function isGreater(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

describe('nextVersions — trois suites, jamais un retour en arrière', () => {
  it('propose le correctif, la mineure et la majeure, dans cet ordre', () => {
    expect(nextVersions('1.1.0')).toEqual([
      { kind: 'patch', value: '1.1.1' },
      { kind: 'minor', value: '1.2.0' },
      { kind: 'major', value: '2.0.0' },
    ]);
  });

  it('LA GARDE : les trois sont strictement supérieures à la dernière publiée', () => {
    // Le seul invariant qui compte. S'il tombe, l'écran laisse publier une
    // régression sous l'apparence d'une nouveauté.
    for (const latest of ['0.0.1', '1.0.0', '1.1.0', '2.9.9', '10.0.7', '0.9.12']) {
      for (const { kind, value } of nextVersions(latest)) {
        expect(isGreater(value, latest), `${kind} de ${latest} = ${value}`).toBe(true);
      }
    }
  });

  it('une mineure remet le correctif à zéro, une majeure remet les deux', () => {
    // `1.1.7` → `1.2.7` ferait un numéro qui se lit comme un correctif ancien.
    expect(nextVersions('1.1.7')[1].value).toBe('1.2.0');
    expect(nextVersions('1.1.7')[2].value).toBe('2.0.0');
  });

  it('les nombres à deux chiffres s’incrémentent, ils ne se concatènent pas', () => {
    // Le piège classique d'une implémentation par chaînes : `9` + 1 = `91`.
    expect(nextVersions('1.9.9')[0].value).toBe('1.9.10');
    expect(nextVersions('1.9.9')[1].value).toBe('1.10.0');
  });

  it('une version illisible ne fait pas planter l’écran', () => {
    // La colonne vient de D1 ; rien ne garantit sa forme côté client. Un plan
    // dégradé vaut mieux qu'un formulaire qui ne s'ouvre pas.
    expect(nextVersions('')).toEqual([
      { kind: 'patch', value: '0.0.1' },
      { kind: 'minor', value: '0.1.0' },
      { kind: 'major', value: '1.0.0' },
    ]);
    expect(nextVersions('bricole')[0].value).toBe('0.0.1');
  });
});
