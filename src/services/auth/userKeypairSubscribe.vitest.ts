/**
 * subscribeUserKeypair — l'observation de la PRÉSENCE de la paire de clés.
 *
 * Ce qui se prouve : un abonné est prévenu à la pose (true) et à l'effacement
 * (false), pas à chaque affectation redondante ; le désabonnement est
 * effectif ; un abonné qui jette n'empêche ni la pose de la clé ni les autres
 * abonnés. La pose passe par la vraie crypto (`generateAndWrapKeypair`,
 * `unwrapPrivateKey`) — c'est le chemin réel du gate, pas un setter de test.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateAndWrapKeypair,
  unwrapPrivateKey,
  clearUserKeypair,
  hasUserKeypair,
  subscribeUserKeypair,
} from './userKeypair';

describe('subscribeUserKeypair', () => {
  beforeEach(() => clearUserKeypair());

  it('prévient à la pose (true) et à l’effacement (false), pas aux affectations redondantes', async () => {
    const seen: boolean[] = [];
    const off = subscribeUserKeypair((p) => seen.push(p));
    try {
      clearUserKeypair(); // déjà absente : aucun changement, rien à dire
      expect(seen).toEqual([]);

      await generateAndWrapKeypair('pw');
      expect(hasUserKeypair()).toBe(true);
      expect(seen).toEqual([true]);

      clearUserKeypair();
      expect(seen).toEqual([true, false]);
    } finally {
      off();
    }
  });

  it('la pose par déballage (mot de passe / gate) prévient aussi', async () => {
    const kp = await generateAndWrapKeypair('pw');
    clearUserKeypair();
    const seen: boolean[] = [];
    const off = subscribeUserKeypair((p) => seen.push(p));
    try {
      await unwrapPrivateKey('pw', kp, kp.keyAlgo);
      expect(seen).toEqual([true]);
    } finally {
      off();
    }
  });

  it('le désabonnement est effectif', async () => {
    const seen: boolean[] = [];
    const off = subscribeUserKeypair((p) => seen.push(p));
    off();
    await generateAndWrapKeypair('pw');
    clearUserKeypair();
    expect(seen).toEqual([]);
  });

  it('un abonné qui jette n’empêche ni la pose de la clé ni les autres abonnés', async () => {
    const seen: boolean[] = [];
    const offBad = subscribeUserKeypair(() => {
      throw new Error('abonné défaillant');
    });
    const offGood = subscribeUserKeypair((p) => seen.push(p));
    try {
      await expect(generateAndWrapKeypair('pw')).resolves.toBeTruthy();
      expect(hasUserKeypair()).toBe(true);
      expect(seen).toEqual([true]);
      expect(() => clearUserKeypair()).not.toThrow();
      expect(seen).toEqual([true, false]);
    } finally {
      offBad();
      offGood();
    }
  });
});
