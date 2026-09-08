/**
 * LA MACHINE À ÉTATS DE LA SESSION DE GARDE.
 *
 * Quatre états, et les transitions entre eux décident de ce que l'écran
 * affiche. Trois d'entre elles ont un coût si on les rate, et ce sont
 * exactement celles que ce fichier épingle :
 *
 *   · `unknown` ≠ `absent`. La première dit « je n'ai pas pu demander », la
 *     seconde « ce compte n'a pas de clé ». Les confondre ferait annoncer
 *     « vos noms resteront sur cette machine » sur une simple coupure réseau.
 *   · UNE PUBLIQUE QUI CHANGE tue la session. Une privée qui n'ouvre plus rien
 *     laisserait l'écran se croire déverrouillé et afficher des lignes vides.
 *   · LA PRIVÉE EST ÉCRASÉE avant d'être oubliée. C'est le seul geste
 *     d'hygiène mémoire disponible en JavaScript, et il est invisible : rien
 *     ne casse s'il disparaît, donc seul un test le retient.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCustodySession,
  custodyPrivateKey,
  custodyPublicKeyForSealing,
  getCustodySession,
  lockCustody,
  resetCustodySessionForTests,
  setCustodyKey,
  setCustodyUnlocked,
  subscribeCustodySession,
} from './custodySession';
import type { CustodyKeyMaterial } from './custodyFormat';

const KEY_A: CustodyKeyMaterial = {
  custodyPublicKey: 'AAAA',
  wrappedPrivateKey: 'wrapA',
  kdfSalt: 'saltA',
  kdfScheme: 'passphrase-v1',
};

const KEY_B: CustodyKeyMaterial = { ...KEY_A, custodyPublicKey: 'BBBB' };

function priv(fill = 7): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

beforeEach(() => {
  resetCustodySessionForTests();
});

describe('les quatre états, et l’ordre dans lequel on les traverse', () => {
  it('part de `unknown` : rien n’a encore été demandé au serveur', () => {
    expect(getCustodySession()).toEqual({ status: 'unknown' });
  });

  it('une clé annoncée par le serveur passe en `locked`, jamais en `unlocked`', () => {
    setCustodyKey(KEY_A);

    expect(getCustodySession()).toEqual({ status: 'locked', key: KEY_A });
    expect(custodyPrivateKey()).toBeNull();
  });

  it('`null` — une réponse AFFIRMATIVE — passe en `absent`, qui n’est pas `unknown`', () => {
    setCustodyKey(null);

    expect(getCustodySession().status).toBe('absent');
  });

  it('le déverrouillage range la privée pour la session', () => {
    setCustodyKey(KEY_A);
    const p = priv();

    setCustodyUnlocked(KEY_A, p);

    expect(getCustodySession().status).toBe('unlocked');
    expect(custodyPrivateKey()).toBe(p);
  });
});

describe('sceller ne demande pas la privée — c’est tout l’intérêt du schéma', () => {
  it('la publique est disponible dès `locked`, sans phrase de récupération', () => {
    setCustodyKey(KEY_A);

    expect(custodyPublicKeyForSealing()).toBe('AAAA');
  });

  it('elle ne l’est ni en `unknown` ni en `absent` : il n’y a rien vers quoi sceller', () => {
    expect(custodyPublicKeyForSealing()).toBeNull();
    setCustodyKey(null);
    expect(custodyPublicKeyForSealing()).toBeNull();
  });
});

describe('la privée est ÉCRASÉE, pas seulement oubliée', () => {
  it('le verrouillage remplit le tampon de zéros avant de lâcher la référence', () => {
    setCustodyKey(KEY_A);
    const p = priv();
    setCustodyUnlocked(KEY_A, p);

    lockCustody();

    expect(getCustodySession().status).toBe('locked');
    expect([...p]).toEqual(new Array(32).fill(0));
  });

  it('l’oubli total écrase aussi, et repart de `unknown` — pas de `absent`', () => {
    setCustodyKey(KEY_A);
    const p = priv();
    setCustodyUnlocked(KEY_A, p);

    clearCustodySession();

    expect(getCustodySession()).toEqual({ status: 'unknown' });
    expect([...p]).toEqual(new Array(32).fill(0));
  });

  it('remplacer la privée écrase l’ancienne : deux copies vivantes seraient une de trop', () => {
    setCustodyKey(KEY_A);
    const ancienne = priv(1);
    setCustodyUnlocked(KEY_A, ancienne);

    setCustodyUnlocked(KEY_A, priv(2));

    expect([...ancienne]).toEqual(new Array(32).fill(0));
  });
});

describe('la garde d’identité — une clé qui change tue la session', () => {
  it('une AUTRE publique reverrouille et écrase la privée devenue inutile', () => {
    setCustodyKey(KEY_A);
    const p = priv();
    setCustodyUnlocked(KEY_A, p);

    setCustodyKey(KEY_B);

    expect(getCustodySession()).toEqual({ status: 'locked', key: KEY_B });
    expect([...p]).toEqual(new Array(32).fill(0));
  });

  it('la MÊME publique garde la session ouverte, même si le matériel est rafraîchi', () => {
    setCustodyKey(KEY_A);
    const p = priv();
    setCustodyUnlocked(KEY_A, p);

    // Un ré-emballage fait ailleurs change le sel, pas la paire.
    setCustodyKey({ ...KEY_A, kdfSalt: 'nouveauSel', wrappedPrivateKey: 'nouvelEmballage' });

    expect(getCustodySession().status).toBe('unlocked');
    expect(custodyPrivateKey()).toBe(p);
    expect([...p]).not.toEqual(new Array(32).fill(0));
  });

  it('le serveur qui affirme « plus de clé » reverrouille aussi', () => {
    setCustodyKey(KEY_A);
    const p = priv();
    setCustodyUnlocked(KEY_A, p);

    setCustodyKey(null);

    expect(getCustodySession().status).toBe('absent');
    expect([...p]).toEqual(new Array(32).fill(0));
  });
});

describe('l’observable', () => {
  it('notifie à chaque transition, avec l’état COURANT', () => {
    const vu: string[] = [];
    subscribeCustodySession((s) => vu.push(s.status));

    setCustodyKey(KEY_A);
    setCustodyUnlocked(KEY_A, priv());
    lockCustody();
    clearCustodySession();

    expect(vu).toEqual(['locked', 'unlocked', 'locked', 'unknown']);
  });

  it('cesse de notifier après désabonnement', () => {
    const espion = vi.fn();
    const stop = subscribeCustodySession(espion);

    stop();
    setCustodyKey(KEY_A);

    expect(espion).not.toHaveBeenCalled();
  });

  it('un abonné qui se désabonne PENDANT sa notification ne casse pas la boucle', () => {
    const vu: string[] = [];
    const stop = subscribeCustodySession(() => {
      vu.push('premier');
      stop();
    });
    subscribeCustodySession(() => vu.push('second'));

    setCustodyKey(KEY_A);
    setCustodyKey(null);

    // Le second reste servi aux deux transitions ; le premier part après la
    // sienne. Sans la copie de la liste, l'itération sauterait le second.
    expect(vu).toEqual(['premier', 'second', 'second']);
  });

  it('`lockCustody` sur une session déjà verrouillée ne notifie personne', () => {
    setCustodyKey(KEY_A);
    const espion = vi.fn();
    subscribeCustodySession(espion);

    lockCustody();

    expect(espion).not.toHaveBeenCalled();
  });
});
