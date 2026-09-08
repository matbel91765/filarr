/**
 * Le bon compte, avant d'agir — les six verdicts, un par un.
 *
 * CE QUI SE JOUE ICI. Se tromper de verdict ne coûte pas un pixel : ça coûte un
 * conseil FAUX au moment précis où quelqu'un est bloqué. C'était le défaut
 * d'origine — l'écran envoyait « déconnectez-vous puis reconnectez-vous » à un
 * utilisateur de BUREAU, chez qui se déconnecter détache le compte du profil
 * courant au lieu d'ouvrir celui qui porte la bonne adresse.
 *
 * DEUX CAS MÉRITENT D'ÊTRE LUS EN PREMIER, parce qu'ils sont ceux qu'une
 * réécriture casse sans s'en apercevoir :
 *   — `unknownRecipient` : un aperçu MUET ne prouve rien, et surtout pas un
 *     écart. Le transformer en refus retirerait « Accepter » à quelqu'un qui a
 *     le bon compte mais une connexion coupée.
 *   — `signIn` avant tout le reste : sans session il n'y a rien à comparer, même
 *     quand l'adresse invitée est parfaitement connue.
 */

import { describe, it, expect } from 'vitest';
import {
  findProfileForAddress,
  inviteAccountMatch,
  isSameAccountAddress,
  verdictAllowsAccept,
  type InviteProfileRef,
} from '../inviteAccountMatch';

const PERSO: InviteProfileRef = { id: 'p1', name: 'Perso', cloudEmail: 'b@example.com' };
const PRO: InviteProfileRef = { id: 'p2', name: 'Pro', cloudEmail: 'a@example.com' };
const LOCAL: InviteProfileRef = { id: 'p3', name: 'Hors ligne', cloudEmail: null };

// ── 1. Comparer deux adresses ────────────────────────────────────────────────

describe('isSameAccountAddress', () => {
  it('ignore la casse et les espaces de bord — c’est la même personne', () => {
    expect(isSameAccountAddress('  Alice@Example.COM ', 'alice@example.com')).toBe(true);
  });

  it('distingue deux adresses différentes', () => {
    expect(isSameAccountAddress('a@example.com', 'b@example.com')).toBe(false);
  });

  /**
   * Une adresse ABSENTE n'est pas « égale à rien » : elle est inconnue. Rendre
   * `true` ici ferait conclure « c'est bien vous » à un écran qui n'a rien
   * appris, et rendre `false` ferait conclure « ce n'est pas vous ». Les deux
   * sont des affirmations tirées d'un silence ; l'appelant doit voir la
   * différence, et c'est `inviteAccountMatch` qui la porte.
   */
  it('ne conclut rien d’une adresse absente ou vide', () => {
    expect(isSameAccountAddress(null, 'a@example.com')).toBe(false);
    expect(isSameAccountAddress('a@example.com', undefined)).toBe(false);
    expect(isSameAccountAddress('   ', 'a@example.com')).toBe(false);
    expect(isSameAccountAddress(null, null)).toBe(false);
  });

  /**
   * On s'arrête à la casse et aux espaces. Les points de la partie locale et le
   * sous-adressage `+` sont des règles du FOURNISSEUR de messagerie, pas les
   * nôtres : les appliquer ferait dire à cet écran que deux comptes distincts
   * n'en sont qu'un — et l'acceptation, elle, serait refusée par le serveur.
   */
  it('ne normalise PAS au-delà : points et sous-adressage restent distincts', () => {
    expect(isSameAccountAddress('a.b@example.com', 'ab@example.com')).toBe(false);
    expect(isSameAccountAddress('a+coffre@example.com', 'a@example.com')).toBe(false);
  });
});

// ── 2. Retrouver le profil lié à une adresse ─────────────────────────────────

describe('findProfileForAddress', () => {
  it('trouve le profil lié, quelle que soit la casse', () => {
    expect(findProfileForAddress([PRO, PERSO, LOCAL], 'B@EXAMPLE.COM')).toBe(PERSO);
  });

  it('ignore les profils locaux, qui ne portent aucun compte', () => {
    expect(findProfileForAddress([LOCAL], 'b@example.com')).toBeNull();
  });

  it('ne trouve rien sans adresse à chercher', () => {
    expect(findProfileForAddress([PRO, PERSO], null)).toBeNull();
  });

  /**
   * Deux profils sur le même compte sont légitimes (travail / archives) : on
   * rend le PREMIER, et c'est suffisant — l'un ou l'autre ouvre la même session,
   * et c'est l'adresse qui décide de l'acceptation, pas le profil.
   */
  it('rend le premier quand deux profils partagent le compte', () => {
    const bis: InviteProfileRef = { id: 'p4', name: 'Archives', cloudEmail: 'b@example.com' };
    expect(findProfileForAddress([PERSO, bis], 'b@example.com')).toBe(PERSO);
  });
});

// ── 3. Pas de session : se connecter, et si possible dire OÙ ─────────────────

describe('inviteAccountMatch — sans session', () => {
  it('rend signIn en nommant le profil lié à l’adresse invitée (bureau)', () => {
    const verdict = inviteAccountMatch({
      invitedEmail: 'b@example.com',
      connectedEmail: null,
      platform: 'desktop',
      profiles: [PRO, PERSO, LOCAL],
    });
    expect(verdict).toEqual({ kind: 'signIn', profile: PERSO });
  });

  it('rend signIn sans profil quand aucun n’est lié à cette adresse', () => {
    const verdict = inviteAccountMatch({
      invitedEmail: 'inconnue@example.com',
      connectedEmail: null,
      platform: 'desktop',
      profiles: [PRO, PERSO],
    });
    expect(verdict).toEqual({ kind: 'signIn', profile: null });
  });

  /**
   * LE CAS QU'UNE RÉÉCRITURE INVERSE. Sans session il n'y a rien à comparer,
   * même quand l'adresse invitée est connue : tester l'écart d'abord ferait
   * afficher « changez de compte » à quelqu'un qui n'en a aucun.
   */
  it('rend signIn même quand l’adresse invitée est inconnue', () => {
    expect(
      inviteAccountMatch({
        invitedEmail: null,
        connectedEmail: null,
        platform: 'web',
        profiles: [],
      })
    ).toEqual({ kind: 'signIn', profile: null });
  });

  it('n’attache jamais de profil sur le web, même si on lui en passe', () => {
    const verdict = inviteAccountMatch({
      invitedEmail: 'b@example.com',
      connectedEmail: null,
      platform: 'web',
      profiles: [PERSO],
    });
    expect(verdict).toEqual({ kind: 'signIn', profile: null });
  });
});

// ── 4. Le bon compte : accepter ──────────────────────────────────────────────

describe('inviteAccountMatch — le bon compte', () => {
  it('rend accept quand les deux adresses sont la même', () => {
    expect(
      inviteAccountMatch({
        invitedEmail: ' B@Example.com ',
        connectedEmail: 'b@example.com',
        platform: 'desktop',
        profiles: [PERSO],
      })
    ).toEqual({ kind: 'accept' });
  });

  it('rend accept sur le web aussi', () => {
    expect(
      inviteAccountMatch({
        invitedEmail: 'b@example.com',
        connectedEmail: 'b@example.com',
        platform: 'web',
        profiles: [],
      })
    ).toEqual({ kind: 'accept' });
  });
});

// ── 5. L'aperçu n'a rien dit ─────────────────────────────────────────────────

/**
 * LE CAS LE PLUS FACILE À CASSER. L'aperçu est un ORNEMENT : hors ligne, sous
 * plafond de requêtes (429) ou sur une invitation que le serveur ne reconnaît
 * pas, il ne rend rien. Traiter ce silence comme un écart retirerait « Accepter »
 * à quelqu'un qui a exactement le bon compte — et l'enfermerait, puisque le seul
 * geste offert serait de changer d'un compte qui est déjà le bon.
 */
describe('inviteAccountMatch — aperçu muet', () => {
  it('rend unknownRecipient plutôt que d’affirmer un écart (web)', () => {
    expect(
      inviteAccountMatch({
        invitedEmail: null,
        connectedEmail: 'a@example.com',
        platform: 'web',
        profiles: [],
      })
    ).toEqual({ kind: 'unknownRecipient' });
  });

  it('rend unknownRecipient sur le bureau aussi, profils ou pas', () => {
    expect(
      inviteAccountMatch({
        invitedEmail: '',
        connectedEmail: 'a@example.com',
        platform: 'desktop',
        profiles: [PRO, PERSO],
      })
    ).toEqual({ kind: 'unknownRecipient' });
  });

  it('laisse « Accepter » debout, comme le fait « accept »', () => {
    expect(verdictAllowsAccept({ kind: 'unknownRecipient' })).toBe(true);
    expect(verdictAllowsAccept({ kind: 'accept' })).toBe(true);
  });
});

// ── 6. L'écart, et le conseil qui dépend de la plateforme ────────────────────

describe('inviteAccountMatch — écart d’adresse', () => {
  /**
   * LE DÉFAUT QUE CECI FERME, côté bureau. L'écran envoyait « déconnectez-vous
   * puis reconnectez-vous » : sur un poste à plusieurs profils, ce geste détache
   * le compte du profil COURANT au lieu d'ouvrir celui qui porte déjà la bonne
   * adresse. Le verdict nomme donc le profil à ouvrir.
   */
  it('bureau : rend switchProfile en nommant le profil lié', () => {
    expect(
      inviteAccountMatch({
        invitedEmail: 'b@example.com',
        connectedEmail: 'a@example.com',
        platform: 'desktop',
        profiles: [PRO, PERSO, LOCAL],
      })
    ).toEqual({ kind: 'switchProfile', profile: PERSO });
  });

  it('bureau : rend noProfileForAddress quand rien n’est lié à l’adresse', () => {
    expect(
      inviteAccountMatch({
        invitedEmail: 'c@example.com',
        connectedEmail: 'a@example.com',
        platform: 'desktop',
        profiles: [PRO, PERSO, LOCAL],
      })
    ).toEqual({ kind: 'noProfileForAddress' });
  });

  it('bureau : un profil LOCAL ne compte pas comme un profil lié', () => {
    expect(
      inviteAccountMatch({
        invitedEmail: 'b@example.com',
        connectedEmail: 'a@example.com',
        platform: 'desktop',
        profiles: [LOCAL],
      })
    ).toEqual({ kind: 'noProfileForAddress' });
  });

  /** Une seule session par navigateur : changer de compte, c'est se déconnecter. */
  it('web : rend switchAccount', () => {
    expect(
      inviteAccountMatch({
        invitedEmail: 'b@example.com',
        connectedEmail: 'a@example.com',
        platform: 'web',
        profiles: [],
      })
    ).toEqual({ kind: 'switchAccount' });
  });

  it('aucun verdict d’écart ne laisse « Accepter » debout', () => {
    expect(verdictAllowsAccept({ kind: 'switchAccount' })).toBe(false);
    expect(verdictAllowsAccept({ kind: 'switchProfile', profile: PERSO })).toBe(false);
    expect(verdictAllowsAccept({ kind: 'noProfileForAddress' })).toBe(false);
    expect(verdictAllowsAccept({ kind: 'signIn', profile: null })).toBe(false);
  });
});
