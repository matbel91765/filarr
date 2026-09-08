/**
 * deltaFormat.vitest.ts — Le drapeau d'ÉCRITURE delta v5 : environnement OU
 * interrupteur serveur, jamais la lecture.
 *
 * Une application installée ne lit pas de variable d'environnement : l'allumage
 * en production passe par `/sync/capabilities` (`deltaV5Write`), que la sonde
 * de capacités recopie ici à chaque cycle. La variable reste le levier local.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DELTA_V5_ENV, isDeltaV5WriteEnabled, setServerDeltaV5Write } from '../deltaFormat';

describe('isDeltaV5WriteEnabled', () => {
  const avant = process.env[DELTA_V5_ENV];
  afterEach(() => {
    setServerDeltaV5Write(false);
    if (avant === undefined) delete process.env[DELTA_V5_ENV];
    else process.env[DELTA_V5_ENV] = avant;
  });

  it('éteint par défaut : ni variable, ni serveur', () => {
    delete process.env[DELTA_V5_ENV];
    expect(isDeltaV5WriteEnabled()).toBe(false);
  });

  it('la variable d’environnement allume sur "1" ou "true", rien d’autre', () => {
    for (const [v, attendu] of [
      ['1', true],
      ['true', true],
      ['0', false],
      ['oui', false],
      ['TRUE', false],
    ] as const) {
      process.env[DELTA_V5_ENV] = v;
      expect(isDeltaV5WriteEnabled(), v).toBe(attendu);
    }
  });

  it('l’interrupteur serveur allume sans variable, et s’éteint quand la sonde le rabat', () => {
    delete process.env[DELTA_V5_ENV];
    setServerDeltaV5Write(true);
    expect(isDeltaV5WriteEnabled()).toBe(true);
    setServerDeltaV5Write(false);
    expect(isDeltaV5WriteEnabled()).toBe(false);
  });
});
