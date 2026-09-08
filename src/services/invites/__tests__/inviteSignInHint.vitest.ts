/**
 * Le repère d'adresse — un passe-plat, et rien de plus.
 *
 * CE QU'IL SERT. L'écran d'invitation vient de dire « cette invitation a été
 * envoyée à b@… ». Le formulaire de connexion, lui, s'ouvrait vide : il fallait
 * retenir l'adresse et la retaper sans faute, et une faute de frappe ramenait au
 * même refus. Ce module la porte de l'un à l'autre.
 *
 * CE QU'IL NE DOIT PAS DEVENIR, et c'est ce que ces épreuves tiennent : une
 * MÉMOIRE. Un repère qui survivrait à l'onglet, ou qui resservirait une seconde
 * fois, pré-remplirait un jour une connexion qui n'a rien à voir — avec
 * l'adresse d'un tiers, sur un poste partagé. D'où sessionStorage, la
 * consommation à la lecture et la péremption courte.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearInviteSignInHint,
  setInviteSignInHint,
  takeInviteSignInHint,
} from '../inviteSignInHint';

/** sessionStorage minimal, remplaçable par un stockage hostile. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

function install(storage: Storage | null): void {
  const win: Record<string, unknown> = {};
  Object.defineProperty(win, 'sessionStorage', {
    get() {
      if (!storage) throw new Error('stockage refusé');
      return storage;
    },
  });
  vi.stubGlobal('window', win);
}

beforeEach(() => {
  install(fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('setInviteSignInHint / takeInviteSignInHint', () => {
  it('rend l’adresse mise de côté', () => {
    setInviteSignInHint('b@example.com');
    expect(takeInviteSignInHint()).toBe('b@example.com');
  });

  it('coupe les espaces de bord — le champ ne doit pas s’ouvrir sur une adresse invalide', () => {
    setInviteSignInHint('  b@example.com  ');
    expect(takeInviteSignInHint()).toBe('b@example.com');
  });

  /**
   * LE POINT CENTRAL. Le repère sert UNE fois — celle qu'on vient de demander.
   * Sans cela, tout formulaire de connexion monté plus tard dans la même session
   * s'ouvrirait pré-rempli avec une adresse que personne ne lui a demandée.
   */
  it('se consomme à la lecture', () => {
    setInviteSignInHint('b@example.com');
    expect(takeInviteSignInHint()).toBe('b@example.com');
    expect(takeInviteSignInHint()).toBeNull();
  });

  it('rend null quand rien n’a été mis de côté', () => {
    expect(takeInviteSignInHint()).toBeNull();
  });

  /**
   * Une adresse vide EFFACE plutôt que d'écrire un repère creux : c'est ce que
   * fait un appelant dont l'aperçu n'a pas répondu, et il ne doit pas avoir à
   * traiter ce cas à part — ni ressusciter le repère du geste précédent.
   */
  it('une adresse vide efface le repère existant', () => {
    setInviteSignInHint('b@example.com');
    setInviteSignInHint(null);
    expect(takeInviteSignInHint()).toBeNull();

    setInviteSignInHint('b@example.com');
    setInviteSignInHint('   ');
    expect(takeInviteSignInHint()).toBeNull();
  });

  it('clearInviteSignInHint oublie sans lire', () => {
    setInviteSignInHint('b@example.com');
    clearInviteSignInHint();
    expect(takeInviteSignInHint()).toBeNull();
  });

  /**
   * PÉREMPTION. Le repère décrit une intention COURANTE ; passé une demi-heure il
   * ne décrit plus qu'un souvenir, et pré-remplir sur un souvenir est une
   * surprise, pas un service.
   */
  it('périme au-delà de trente minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'));
    setInviteSignInHint('b@example.com');

    vi.setSystemTime(new Date('2026-08-28T10:29:00Z'));
    // Relu à 29 minutes : encore bon — et consommé au passage.
    expect(takeInviteSignInHint()).toBe('b@example.com');

    // Reposé à 10 h 29, relu à 11 h 00 : trente et une minutes, c'est trop.
    setInviteSignInHint('b@example.com');
    vi.setSystemTime(new Date('2026-08-28T11:00:00Z'));
    expect(takeInviteSignInHint()).toBeNull();
  });

  /**
   * UN STOCKAGE HOSTILE NE DOIT RIEN CASSER. Navigation privée, cookies bloqués,
   * contexte restreint : la propriété elle-même jette. Un formulaire qui lit ce
   * repère au montage ne doit pas pouvoir échouer à s'afficher pour autant — il
   * s'ouvre vide, ce qui est exactement l'ancien comportement.
   */
  it('ne jette jamais quand le stockage est refusé', () => {
    install(null);
    expect(() => setInviteSignInHint('b@example.com')).not.toThrow();
    expect(takeInviteSignInHint()).toBeNull();
  });

  it('ne jette jamais sur une entrée abîmée', () => {
    const s = fakeStorage();
    install(s);
    s.setItem('filarr.invite-signin-hint', '{ pas du json');
    expect(takeInviteSignInHint()).toBeNull();
  });

  it('ignore une entrée sans adresse lisible', () => {
    const s = fakeStorage();
    install(s);
    s.setItem('filarr.invite-signin-hint', JSON.stringify({ savedAt: Date.now() }));
    expect(takeInviteSignInHint()).toBeNull();
  });
});
