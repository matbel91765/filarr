/**
 * CE QUE LA BANNIÈRE DIT — et l'ordre dans lequel elle le décide.
 *
 * `custodyPhase` a un ordre de tests, pas une table de correspondance, et cet
 * ordre EST la règle : ce qui rend l'écran impossible passe avant ce qui le
 * rend seulement incomplet. Un `if` déplacé ne casse aucun type, ne lève
 * aucune erreur, et change ce que l'utilisateur lit — c'est précisément le
 * genre de régression qu'il faut un test pour tenir.
 *
 * Le cas le plus coûteux est `unavailable` contre `absent` : sur une panne
 * réseau la session reste `unknown`, et conclure « ce compte n'a pas de
 * coffre » ferait annoncer « vos noms resteront sur cette machine » à
 * quelqu'un dont les noms sont sur le serveur et lisibles cinq minutes plus
 * tard.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  custodyBannerVisible,
  custodyCanUnlock,
  custodyPhase,
  custodyPhaseKey,
  custodyUnlockErrorKey,
  custodyUnlockErrorOf,
  labelSyncReasonKey,
  type CustodyPhase,
  type CustodyPhaseInput,
  type CustodyUnlockError,
} from './custodyModel';
import {
  ERR_CORRUPT_CUSTODY,
  ERR_INVALID_CUSTODY_KEY,
  ERR_WRONG_PASSPHRASE,
} from './custodyFormat';

const BASE: CustodyPhaseInput = {
  signedIn: true,
  argon2Available: true,
  session: 'unknown',
  loading: false,
  fetchFailed: false,
};

describe('custodyPhase — l’ordre des tests est la règle', () => {
  it('sans compte, rien à dire : la clé de garde est un objet de COMPTE', () => {
    expect(custodyPhase({ ...BASE, signedIn: false, session: 'locked' })).toBe('signedOut');
  });

  it('sans Argon2, ne rien promettre — même si une clé est là', () => {
    expect(custodyPhase({ ...BASE, argon2Available: false, session: 'locked' })).toBe(
      'unsupported'
    );
  });

  it('une session OUVERTE prime sur un rechargement en cours : les noms sont déjà lisibles', () => {
    expect(custodyPhase({ ...BASE, session: 'unlocked', loading: true })).toBe('unlocked');
  });

  it('une clé connue et verrouillée prime sur le chargement : le bouton peut s’afficher', () => {
    expect(custodyPhase({ ...BASE, session: 'locked', loading: true })).toBe('locked');
  });

  it('`unknown` + chargement = `loading`', () => {
    expect(custodyPhase({ ...BASE, loading: true })).toBe('loading');
  });

  it('UNE PANNE N’EST PAS UNE ABSENCE : `unknown` + échec = `unavailable`, jamais `absent`', () => {
    expect(custodyPhase({ ...BASE, fetchFailed: true })).toBe('unavailable');
  });

  it('`absent` n’est atteint que sur une réponse AFFIRMATIVE du serveur', () => {
    expect(custodyPhase({ ...BASE, session: 'absent' })).toBe('absent');
  });

  it('l’état initial, avant toute réponse, se peint comme un chargement', () => {
    expect(custodyPhase(BASE)).toBe('loading');
  });
});

describe('ce que la bannière montre', () => {
  it('se tait quand tout va bien, ou quand il n’y a pas de compte', () => {
    expect(custodyBannerVisible('unlocked')).toBe(false);
    expect(custodyBannerVisible('signedOut')).toBe(false);
  });

  it('parle dans les cinq autres cas', () => {
    for (const p of ['unsupported', 'loading', 'unavailable', 'absent', 'locked'] as const) {
      expect(custodyBannerVisible(p)).toBe(true);
    }
  });

  it('n’offre « Déverrouiller » QUE là où il y a quelque chose à déverrouiller', () => {
    expect(custodyCanUnlock('locked')).toBe(true);
    for (const p of ['unlocked', 'absent', 'unavailable', 'loading', 'unsupported'] as const) {
      expect(custodyCanUnlock(p)).toBe(false);
    }
  });
});

describe('custodyUnlockErrorOf — des gestes différents, des causes différentes', () => {
  it('une phrase refusée appelle une RESSAISIE', () => {
    expect(custodyUnlockErrorOf(new Error(ERR_WRONG_PASSPHRASE))).toBe('wrongPassphrase');
  });

  it('un emballage abîmé n’appelle PAS une ressaisie — et se dit autrement', () => {
    expect(custodyUnlockErrorOf(new Error(ERR_CORRUPT_CUSTODY))).toBe('corrupt');
    expect(custodyUnlockErrorOf(new Error(ERR_INVALID_CUSTODY_KEY))).toBe('corrupt');
  });

  it('une primitive absente est un problème d’INSTALLATION, pas de secret', () => {
    expect(custodyUnlockErrorOf(new Error('ARGON2_UNAVAILABLE'))).toBe('unsupported');
    expect(custodyUnlockErrorOf(new Error('ARGON2_LENGTH_MISMATCH'))).toBe('unsupported');
  });

  it('tout le reste retombe sur `generic` plutôt que d’exposer un message interne', () => {
    expect(custodyUnlockErrorOf(new Error('ECONNRESET'))).toBe('generic');
    expect(custodyUnlockErrorOf(undefined)).toBe('generic');
    expect(custodyUnlockErrorOf('une chaîne nue')).toBe('generic');
  });
});

/**
 * CHAQUE CAS A SA PHRASE, DANS LES DEUX LANGUES.
 *
 * Les trois fabriques de clés existent pour que le namespace i18n vive à UN
 * endroit ; ce test vérifie l'autre moitié du contrat — que ce qu'elles
 * fabriquent existe réellement dans les arbres de traduction.
 *
 * Sans lui, ajouter une phase ou une raison passe tous les autres tests, et se
 * voit à l'écran sous la forme d'une clé brute (`custody.phase.frozen`) ou,
 * pire, du `defaultValue` anglais servi à un utilisateur francophone. Le
 * contrôle de parité EN/FR (`scripts/i18n-parity.cjs`) ne l'attrape pas : il
 * compare les deux langues entre elles, pas au CODE qui les consomme.
 */
describe('les clés fabriquées existent dans les deux langues', () => {
  const arbre = (locale: 'en' | 'fr'): Record<string, unknown> =>
    JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', 'i18n', 'locales', locale, 'translation.json'),
        'utf8'
      )
    ) as Record<string, unknown>;

  const résout = (tree: Record<string, unknown>, key: string): unknown =>
    key.split('.').reduce<unknown>((n, part) => (n as Record<string, unknown>)?.[part], tree);

  const PHASES: CustodyPhase[] = [
    'signedOut',
    'unsupported',
    'loading',
    'unavailable',
    'absent',
    'locked',
    'unlocked',
  ];
  const ERREURS: CustodyUnlockError[] = ['wrongPassphrase', 'corrupt', 'unsupported', 'generic'];
  // Les quatre raisons de `shareLabels.LabelSyncReason`, recopiées : ce module
  // ne dépend pas de `sharing/`, et c'est bien ainsi — mais la liste doit
  // rester jumelle, ce que ce test rend visible si elle diverge.
  const RAISONS = ['no-vault', 'app-origin', 'not-found', 'network'];

  for (const locale of ['en', 'fr'] as const) {
    it(`${locale} : phases, erreurs de déverrouillage et raisons d’abstention`, () => {
      const tree = arbre(locale);
      for (const p of PHASES) expect(résout(tree, custodyPhaseKey(p)), p).toBeTypeOf('string');
      for (const e of ERREURS) {
        expect(résout(tree, custodyUnlockErrorKey(e)), e).toBeTypeOf('string');
      }
      for (const r of RAISONS) {
        expect(résout(tree, labelSyncReasonKey(r)), r).toBeTypeOf('string');
      }
    });
  }
});
