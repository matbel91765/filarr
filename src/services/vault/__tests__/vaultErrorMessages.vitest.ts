/**
 * A refusal the user can act on must say so — and must say so in both languages.
 *
 * The seat cap is the case that matters: the server answers 409 seat_limit_reached,
 * axios flattens that into "Request failed with status code 409", and if the code
 * doesn't survive the transport the user is told the network failed and buys
 * nothing. So both halves are checked here: the code survives, and it lands on a
 * key that exists in EN and FR and actually mentions upgrading.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  vaultErrorKey,
  joinErrorKey,
  isDeadInviteError,
  isVaultErrorRetryable,
  isVaultUpgradeError,
  VAULT_ERROR_KEYS,
  JOIN_ERROR_KEYS,
  VAULT_CODES_WITHOUT_OWN_MESSAGE,
} from '../vaultErrorMessages';
import { serverErrorCode, classifyVaultFailure } from '../vaultApi';
import en from '../../../i18n/locales/en/translation.json';
import fr from '../../../i18n/locales/fr/translation.json';

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
}

describe('serverErrorCode', () => {
  it('recovers the Worker code axios would otherwise flatten away', () => {
    const err = { response: { status: 409, data: { success: false, code: 'seat_limit_reached' } } };
    expect(serverErrorCode(err)).toBe('seat_limit_reached');
  });

  it('is null for a failure that carries no code (offline, 5xx, HTML gateway)', () => {
    expect(serverErrorCode(new Error('Network Error'))).toBeNull();
    expect(serverErrorCode({ response: { status: 502, data: '<html/>' } })).toBeNull();
    expect(serverErrorCode(undefined)).toBeNull();
  });
});

describe('vaultErrorKey', () => {
  it('routes the seat cap to the upgrade sentence, not the generic one', () => {
    expect(vaultErrorKey('seat_limit_reached', 'teamVaults.errors.invite')).toBe(
      'teamVaults.errors.seatLimit'
    );
    expect(vaultErrorKey('upgrade_required', 'teamVaults.errors.create')).toBe(
      'teamVaults.errors.upgradeRequired'
    );
  });

  it('falls back to the CALLER’s sentence for an unknown or absent code', () => {
    expect(vaultErrorKey('some_future_code', 'teamVaults.errors.create')).toBe(
      'teamVaults.errors.create'
    );
    expect(vaultErrorKey(null, 'teamVaults.errors.load')).toBe('teamVaults.errors.load');
    expect(vaultErrorKey('', 'teamVaults.errors.load')).toBe('teamVaults.errors.load');
  });

  it('strips the ":userId" suffix some thunks append', () => {
    expect(vaultErrorKey('member_no_key:u42', 'teamVaults.errors.remove')).toBe(
      'teamVaults.errors.noKey'
    );
  });

  it('has every mapped key translated in EN and FR', () => {
    for (const key of Object.values(VAULT_ERROR_KEYS)) {
      expect(typeof lookup(en, key), `EN ${key}`).toBe('string');
      expect(typeof lookup(fr, key), `FR ${key}`).toBe('string');
    }
  });

  it('offers the upgrade in the seat-cap sentence, in both languages', () => {
    expect(String(lookup(en, 'teamVaults.errors.seatLimit')).toLowerCase()).toContain('upgrade');
    expect(String(lookup(fr, 'teamVaults.errors.seatLimit')).toLowerCase()).toContain('offre');
  });

  it('never says "organization" to a personal user', () => {
    const surfaces = ['teamVaults.title', 'teamVaults.subtitle', 'teamVaults.empty'];
    for (const key of [
      ...surfaces,
      ...Object.values(VAULT_ERROR_KEYS),
      ...Object.values(JOIN_ERROR_KEYS),
    ]) {
      expect(String(lookup(en, key) ?? '').toLowerCase()).not.toContain('organization');
      expect(String(lookup(fr, key) ?? '').toLowerCase()).not.toContain('organisation');
    }
  });
});

// ── Classification: what actually went wrong ─────────────────────────────────

describe('classifyVaultFailure', () => {
  const axios = (over: Record<string, unknown>) =>
    Object.assign(new Error('boom'), { isAxiosError: true, ...over });

  it('prefers the Worker’s own code over any guess from the status', () => {
    expect(
      classifyVaultFailure(axios({ response: { status: 403, data: { code: 'upgrade_required' } } }))
    ).toBe('upgrade_required');
  });

  it('calls it a network failure ONLY when nothing came back', () => {
    expect(classifyVaultFailure(axios({ code: 'ERR_NETWORK' }))).toBe('network_unavailable');
    expect(classifyVaultFailure(axios({ code: 'ECONNABORTED' }))).toBe('network_unavailable');
    // A server that ANSWERED is not a connectivity problem, whatever it answered.
    for (const status of [401, 403, 404, 500, 502, 503]) {
      expect(classifyVaultFailure(axios({ response: { status } }))).not.toBe('network_unavailable');
    }
  });

  it('separates authorization, session and server fault', () => {
    expect(classifyVaultFailure(axios({ response: { status: 401 } }))).toBe('session_expired');
    expect(classifyVaultFailure(axios({ response: { status: 403 } }))).toBe('org_forbidden');
    expect(classifyVaultFailure(axios({ response: { status: 404 } }))).toBe('org_forbidden');
    expect(classifyVaultFailure(axios({ response: { status: 500 } }))).toBe('server_error');
    expect(classifyVaultFailure(axios({ response: { status: 502 } }))).toBe('server_error');
  });

  it('refuses to classify what it cannot read, rather than guessing', () => {
    // Our own thrown Errors (locked vault, no keypair) are NOT transport failures:
    // guessing "offline" here is exactly the lie this whole module exists to remove.
    expect(classifyVaultFailure(new Error('Vault is locked'))).toBeNull();
    expect(classifyVaultFailure(undefined)).toBeNull();
    expect(classifyVaultFailure(axios({ response: { status: 400 } }))).toBeNull();
  });
});

// ── The sentence has to match the failure ────────────────────────────────────

describe('the message tells the truth about the failure', () => {
  /** Sentences that send the user to their network settings. */
  const NETWORK_ADVICE = {
    en: ['connection', 'offline', 'reach the server'],
    fr: ['connexion', 'hors ligne', 'joindre le serveur'],
  };

  it('mentions the connection ONLY for the failure that is about the connection', () => {
    for (const [code, key] of Object.entries({ ...VAULT_ERROR_KEYS, ...JOIN_ERROR_KEYS })) {
      if (code === 'network_unavailable') continue;
      const enText = String(lookup(en, key) ?? '').toLowerCase();
      const frText = String(lookup(fr, key) ?? '').toLowerCase();
      for (const needle of NETWORK_ADVICE.en) {
        expect(enText, `EN ${code}`).not.toContain(needle);
      }
      for (const needle of NETWORK_ADVICE.fr) {
        expect(frText, `FR ${code}`).not.toContain(needle);
      }
    }
  });

  it('does say it for the one that IS, in both languages', () => {
    const key = VAULT_ERROR_KEYS.network_unavailable;
    expect(String(lookup(en, key)).toLowerCase()).toContain('connection');
    expect(String(lookup(fr, key)).toLowerCase()).toContain('connexion');
  });

  it('offers the upgrade when the plan is what refused', () => {
    for (const code of ['upgrade_required', 'seat_limit_reached', 'personal_seat_limit_reached']) {
      expect(isVaultUpgradeError(code), code).toBe(true);
      expect(String(lookup(en, VAULT_ERROR_KEYS[code])).toLowerCase()).toContain('upgrade');
      expect(String(lookup(fr, VAULT_ERROR_KEYS[code])).toLowerCase()).toContain('offre');
    }
    expect(isVaultUpgradeError('network_unavailable')).toBe(false);
    expect(isVaultUpgradeError(null)).toBe(false);
  });

  it('offers "Retry" only where retrying could plausibly work', () => {
    // A decision does not change because you pressed the button again.
    for (const code of [
      'upgrade_required',
      'org_forbidden',
      'org_insufficient_role',
      'org_read_only',
      'session_expired',
      'seat_limit_reached',
      'already_member',
    ]) {
      expect(isVaultErrorRetryable(code), code).toBe(false);
    }
    for (const code of [
      'network_unavailable',
      'server_error',
      'shared_vault_no_context',
      'vault_epoch_conflict',
      'rate_limited',
    ]) {
      expect(isVaultErrorRetryable(code), code).toBe(true);
    }
    // Unknown / absent: assume transient — a needless button beats a dead end.
    expect(isVaultErrorRetryable(null)).toBe(true);
    expect(isVaultErrorRetryable('some_future_code')).toBe(true);
  });

  it('gives the four required failures four DIFFERENT sentences', () => {
    const distinct = new Set(
      ['upgrade_required', 'org_forbidden', 'network_unavailable', 'server_error'].map((c) =>
        String(lookup(en, VAULT_ERROR_KEYS[c]))
      )
    );
    expect(distinct.size).toBe(4);
  });
});

// ── The person JOINING is not the person who invited them ────────────────────

/**
 * The historical table was written with the host's voice, and read out to a
 * joiner seven of its sentences are false. Each `it` below pins one of them:
 * they are not stylistic preferences but statements that were untrue.
 */
describe('the refusal speaks to whoever is reading it', () => {
  const JOURNEY_CODES = [
    'invite_expired',
    'invite_invalid',
    'invite_email_mismatch',
    'invitation_email_mismatch',
    'invitation_expired',
    'invitation_not_found',
    'invitation_already_used',
    'personal_account',
    'already_member',
    'personal_seat_limit_reached',
    'invite_stale_epoch',
    'invite_vault_mismatch',
    'org_forbidden',
    'not_org_member',
    'vault_join_needs_space',
    'vault_join_space_unknown',
    'session_expired',
    'vault_not_found',
  ];

  it('answers EVERY refusal this journey can produce, in both languages', () => {
    for (const code of JOURNEY_CODES) {
      const key = joinErrorKey(code, 'teamVaults.join.errors.generic');
      expect(key, `${code} fell through to the generic sentence`).not.toBe(
        'teamVaults.join.errors.generic'
      );
      expect(typeof lookup(en, key), `EN ${code}`).toBe('string');
      expect(typeof lookup(fr, key), `FR ${code}`).toBe('string');
    }
  });

  it('has every joiner key translated in EN and FR', () => {
    for (const key of Object.values(JOIN_ERROR_KEYS)) {
      expect(typeof lookup(en, key), `EN ${key}`).toBe('string');
      expect(typeof lookup(fr, key), `FR ${key}`).toBe('string');
    }
  });

  it('says something DIFFERENT wherever the host-facing sentence would lie', () => {
    for (const code of [
      'personal_seat_limit_reached',
      'already_member',
      'personal_account',
      'invitation_email_mismatch',
      'invite_email_mismatch',
      'not_org_member',
      'org_forbidden',
    ]) {
      expect(joinErrorKey(code, 'fb'), code).not.toBe(vaultErrorKey(code, 'fb'));
    }
  });

  it('does not sell an upgrade for a ceiling that belongs to someone else', () => {
    // "Your plan is full — upgrade" is the host's truth. The guest's plan has
    // nothing to do with how many people fit in the space that invited them.
    const key = JOIN_ERROR_KEYS.personal_seat_limit_reached;
    expect(String(lookup(en, key)).toLowerCase()).not.toContain('upgrade');
    expect(String(lookup(fr, key)).toLowerCase()).not.toContain('passez à');
  });

  it('addresses the reader when the reader is the one who already has access', () => {
    const key = JOIN_ERROR_KEYS.already_member;
    expect(String(lookup(en, key)).toLowerCase()).toContain('you already have access');
    expect(String(lookup(fr, key)).toLowerCase()).toContain('vous avez déjà accès');
    expect(String(lookup(en, key)).toLowerCase()).not.toContain('this person');
    expect(String(lookup(fr, key)).toLowerCase()).not.toContain('cette personne');
  });

  it('sends a personal account to a work account, not back for another invitation', () => {
    // Re-inviting cannot help: strict account separation is enforced server-side.
    const key = JOIN_ERROR_KEYS.personal_account;
    expect(String(lookup(en, key)).toLowerCase()).toContain('work account');
    expect(String(lookup(fr, key)).toLowerCase()).toContain('professionnel');
    expect(String(lookup(en, key)).toLowerCase()).not.toContain('invite you again');
    expect(String(lookup(fr, key)).toLowerCase()).not.toContain('inviter à nouveau');
  });

  it('names the two-step order rather than a bare "you have no access"', () => {
    const key = JOIN_ERROR_KEYS.vault_join_needs_space;
    expect(String(lookup(en, key)).toLowerCase()).toContain('shared space first');
    expect(String(lookup(fr, key)).toLowerCase()).toContain("d'abord");
  });

  it('tells a mismatched address to change account, not to give up', () => {
    const key = JOIN_ERROR_KEYS.invite_email_mismatch;
    expect(String(lookup(en, key)).toLowerCase()).toContain('address');
    expect(String(lookup(fr, key)).toLowerCase()).toContain('adresse');
  });

  it('falls back to the host table, then to the caller, for anything else', () => {
    // A code with no joiner-specific sentence keeps the general one rather than
    // losing its meaning: the two tables complete each other, they don't compete.
    expect(joinErrorKey('pooled_quota_exceeded', 'teamVaults.join.errors.generic')).toBe(
      'teamVaults.errors.storageFull'
    );
    expect(joinErrorKey('some_future_code', 'teamVaults.join.errors.generic')).toBe(
      'teamVaults.join.errors.generic'
    );
    expect(joinErrorKey(null, 'teamVaults.join.errors.generic')).toBe(
      'teamVaults.join.errors.generic'
    );
    expect(joinErrorKey('member_no_key:u42', 'fb')).toBe('teamVaults.errors.noKey');
  });

  /**
   * LE DÉFAUT QUE CECI FERME. `upgrade_required` n'atteint un JOIGNANT que d'un
   * seul endroit : rbac.ts `personalFallback`, quand la requête est partie sans
   * X-Org-Id et que le compte gratuit n'avait pas d'espace personnel à
   * provisionner. Traduit avec la phrase de l'hôte — « les coffres partagés
   * exigent une offre payante » — on facture l'invité pour un espace que son
   * HÔTE paie, c'est-à-dire exactement le refus que la décision produit exclut.
   */
  it('ne vend pas un abonnement à qui n’a fait qu’accepter une invitation', () => {
    expect(joinErrorKey('upgrade_required', 'teamVaults.join.errors.generic')).toBe(
      'teamVaults.join.errors.acceptSpaceFirst'
    );
    expect(joinErrorKey('upgrade_required', 'fb')).not.toBe(
      vaultErrorKey('upgrade_required', 'fb')
    );
    for (const dict of [en, fr]) {
      const text = String(lookup(dict, JOIN_ERROR_KEYS.upgrade_required)).toLowerCase();
      expect(text).not.toContain('upgrade');
      expect(text).not.toContain('offre payante');
      expect(text).not.toContain('passez à');
    }
    // La table de l'hôte, elle, garde sa vérité : c'est bien SON offre.
    expect(vaultErrorKey('upgrade_required', 'fb')).toBe('teamVaults.errors.upgradeRequired');
  });

  /**
   * LE DÉFAUT QUE CECI FERME. Un jeton NU est indiscernable d'un jeton de coffre
   * (même alphabet, même longueur) et seul le lien porte l'identifiant du
   * coffre : un code collé à la main ne peut donc être présenté qu'à la route
   * des ESPACES, qui répond `invitation_not_found`. La phrase — « retirée ou
   * déjà utilisée » — est fausse ET terminale pour quelqu'un qui a simplement
   * recopié le mauvais morceau de son e-mail.
   */
  it('dit la vérité sur un code recopié depuis un lien de COFFRE', () => {
    const key = joinErrorKey('invite_code_not_a_space_invite', 'teamVaults.join.errors.generic');
    expect(key).toBe('teamVaults.join.errors.codeNotASpaceInvite');
    expect(key).not.toBe(JOIN_ERROR_KEYS.invitation_not_found);
    // La phrase doit nommer le COFFRE et renvoyer au LIEN : c'est la seule
    // action qui débloque la situation.
    expect(String(lookup(en, key)).toLowerCase()).toContain('vault');
    expect(String(lookup(en, key)).toLowerCase()).toContain('link');
    expect(String(lookup(fr, key)).toLowerCase()).toContain('coffre');
    expect(String(lookup(fr, key)).toLowerCase()).toContain('lien');
    // Recoller le même code donnera le même refus.
    expect(isVaultErrorRetryable('invite_code_not_a_space_invite')).toBe(false);
  });

  it('offers no "Retry" on an invitation that will never open again', () => {
    for (const code of [
      'invite_expired',
      'invite_invalid',
      'invite_email_mismatch',
      'invite_stale_epoch',
      'invite_vault_mismatch',
      'vault_join_needs_space',
      'personal_account',
      'already_member',
    ]) {
      expect(isVaultErrorRetryable(code), code).toBe(false);
    }
  });

  /**
   * LE DÉFAUT QUE CECI FERME. `joinVault` rendait `vault_join_needs_space` dès
   * que la liste des locataires était vide — et le sélecteur documente lui-même
   * l'ambiguïté (« Empty = no context yet — org list not loaded / offline »).
   * Une simple panne de LECTURE s'entendait donc dire « acceptez d'abord
   * l'invitation à l'espace », verdict faux ET terminal : plus de bouton
   * « Réessayer », alors qu'il suffisait d'attendre le réseau.
   */
  it('distingue « aucun espace » de « je n’ai pas pu lire la liste »', () => {
    expect(joinErrorKey('vault_join_space_unknown', 'fb')).not.toBe(
      joinErrorKey('vault_join_needs_space', 'fb')
    );
    // Le seul des deux sur lequel réessayer a un sens.
    expect(isVaultErrorRetryable('vault_join_needs_space')).toBe(false);
    expect(isVaultErrorRetryable('vault_join_space_unknown')).toBe(true);
    // Une panne de lecture n'affirme rien de l'invitation.
    expect(isDeadInviteError('vault_join_space_unknown')).toBe(false);
    // …et ne prescrit surtout pas d'accepter une invitation qu'on a peut-être
    // déjà acceptée : c'est ce que disait la phrase de l'autre code.
    for (const dict of [en, fr]) {
      const text = String(lookup(dict, JOIN_ERROR_KEYS.vault_join_space_unknown)).toLowerCase();
      expect(text).not.toContain('accept');
      expect(text).not.toContain('acceptez');
    }
  });

  /**
   * LE DÉFAUT QUE CECI FERME. `invite_vault_mismatch` est né avec la correction
   * précédente (vaults.ts) et n'était traduit NULLE PART : il tombait dans la
   * phrase générique, avec un bouton « Réessayer » sur un lien qui redonnera
   * éternellement le même refus. C'est un cas à part — l'invitation est VIVANTE,
   * c'est le lien qui est le mauvais — et la phrase doit le dire.
   */
  it('nomme le lien mélangé sans déclarer l’invitation morte', () => {
    const key = joinErrorKey('invite_vault_mismatch', 'teamVaults.join.errors.generic');
    expect(key).toBe('teamVaults.join.errors.vaultMismatch');
    expect(key).not.toBe(JOIN_ERROR_KEYS.invite_invalid);
    expect(String(lookup(en, key)).toLowerCase()).toContain('link');
    expect(String(lookup(fr, key)).toLowerCase()).toContain('lien');
    // Ni réessayable (le même lien redonnera le même refus), ni mortelle (le
    // BON lien la fera aboutir).
    expect(isVaultErrorRetryable('invite_vault_mismatch')).toBe(false);
    expect(isDeadInviteError('invite_vault_mismatch')).toBe(false);
  });
});

// ── « Terminal » ne veut pas dire « jetable » ────────────────────────────────

/**
 * LE DÉFAUT CENTRAL QUE CETTE SECTION FERME. L'écran d'acceptation effaçait
 * l'invitation sur tout refus TERMINAL. Or terminal ne répond qu'à une question
 * — faut-il proposer « Réessayer » ? — et pas du tout à l'autre : cette
 * invitation est-elle morte ? Les deux échecs les plus probables du parcours
 * étaient terminaux ET réparables, et leurs propres phrases promettaient que
 * l'invitation attendrait.
 */
describe('isDeadInviteError', () => {
  /** Les seuls refus par lesquels le serveur affirme un fait sur l'invitation. */
  const DEAD = [
    'invitation_not_found',
    'invitation_expired',
    'invitation_already_used',
    'invite_expired',
    'invite_invalid',
    'already_member',
    'invite_stale_epoch',
  ];

  it('reconnaît les refus où l’invitation elle-même a disparu', () => {
    for (const code of DEAD) {
      expect(isDeadInviteError(code), code).toBe(true);
    }
    expect(isDeadInviteError('already_member:u42')).toBe(true);
  });

  it.each([
    'session_expired',
    'invitation_email_mismatch',
    'invite_email_mismatch',
    'invitee_mismatch',
    'org_forbidden',
    'org_enterprise_only',
    'org_insufficient_role',
    'personal_account',
    'vault_join_needs_space',
    'vault_join_space_unknown',
    'not_org_member',
    // Le jeton est VIVANT : le Worker dit lui-même que c'est le coffre porté par
    // le LIEN qui ne lui correspond pas. Le bon lien la fera aboutir.
    'invite_vault_mismatch',
    'seat_limit_reached',
    'personal_seat_limit_reached',
    'upgrade_required',
    'network_unavailable',
    'server_error',
    'request_failed',
    'vault_not_found',
  ])('laisse VIVRE l’invitation sur %s', (code) => {
    expect(isDeadInviteError(code)).toBe(false);
  });

  it('ne conclut rien d’un code absent', () => {
    expect(isDeadInviteError(null)).toBe(false);
    expect(isDeadInviteError(undefined)).toBe(false);
    expect(isDeadInviteError('')).toBe(false);
  });

  /**
   * LE DÉFAUT QUE CECI FERME. `invite_stale_epoch` était conservé : le jeton
   * restait, la fenêtre revenait à chaque démarrage pendant sept jours, et
   * aucune reprise ne pouvait aboutir. L'époque de la clé d'un coffre ne fait
   * que MONTER (`rotateVaultKey` : `newEpoch = prevEpoch + 1`, posé par un
   * compare-and-set sur l'époque précédente) tandis que celle du scellé est
   * figée à l'émission : une fois séparées, elles ne se rejoignent jamais.
   */
  it('range la rotation de clé parmi les morts, et elle seule de sa famille', () => {
    expect(isDeadInviteError('invite_stale_epoch')).toBe(true);
    // Les voisines de la même route restent VIVANTES : une action de
    // l'utilisateur — le bon lien, la bonne adresse — les fait aboutir.
    expect(isDeadInviteError('invite_vault_mismatch')).toBe(false);
    expect(isDeadInviteError('invite_email_mismatch')).toBe(false);
  });

  it('est STRICTEMENT plus étroit que « terminal »', () => {
    // C'est la propriété qui empêche le défaut de revenir : élargir l'ensemble
    // des morts jusqu'à celui des terminaux, c'est le défaut d'origine.
    const terminalButAlive = [
      'session_expired',
      'invitation_email_mismatch',
      'org_forbidden',
      'personal_account',
    ];
    for (const code of terminalButAlive) {
      expect(isVaultErrorRetryable(code), code).toBe(false);
      expect(isDeadInviteError(code), code).toBe(false);
    }
  });

  /**
   * LA VÉRIFICATION QUI COMPTE VRAIMENT : aucune phrase ne doit promettre que
   * l'invitation attendra si son code la fait détruire. Les deux messages visés
   * disaient exactement le contraire de ce que le code faisait.
   */
  it('aucune phrase promettant que l’invitation attend n’est prononcée sur un refus mortel', () => {
    /** Ce qu'on ne peut dire que d'une invitation qui SURVIT au refus. */
    const PROMISES = {
      en: ['will still be waiting', 'sign back in', 'open this vault invitation again'],
      fr: ['vous attendra', 'reconnectez-vous', 'rouvrez cette invitation'],
    };

    for (const [code, key] of Object.entries(JOIN_ERROR_KEYS)) {
      if (!isDeadInviteError(code)) continue;
      const enText = String(lookup(en, key) ?? '').toLowerCase();
      const frText = String(lookup(fr, key) ?? '').toLowerCase();
      for (const needle of PROMISES.en) {
        expect(enText, `EN ${code}`).not.toContain(needle);
      }
      for (const needle of PROMISES.fr) {
        expect(frText, `FR ${code}`).not.toContain(needle);
      }
    }
  });

  it('et les phrases qui promettent l’attente portent bien sur des refus survivables', () => {
    for (const code of ['session_expired', 'invitation_email_mismatch']) {
      expect(isDeadInviteError(code), code).toBe(false);
    }
    expect(String(lookup(fr, JOIN_ERROR_KEYS.session_expired))).toContain('vous attendra');

    /**
     * LE MAUVAIS COMPTE A CHANGÉ DE FORME, PAS DE PROMESSE (F29).
     *
     * `errors.wrongAccount` ne prescrit plus de geste : « déconnectez-vous puis
     * reconnectez-vous » est le conseil du WEB, où il n'y a qu'une session par
     * navigateur, et un CONTRESENS sur le bureau, où chaque profil porte son
     * compte — s'y déconnecter détache le compte du profil courant au lieu
     * d'ouvrir celui qui a déjà la bonne adresse. Le geste est désormais dit par
     * la ligne d'à côté, choisie selon la plateforme.
     *
     * CE QUI NE DOIT PAS SE PERDRE DANS LE DÉPLACEMENT : la promesse que
     * l'invitation attend. C'est le refus le PLUS PROBABLE du parcours, son
     * jeton est délibérément conservé, et sans cette phrase l'écran laisserait
     * croire que l'invitation vient d'être perdue. Les deux conseils doivent
     * donc la porter — c'est ce que cette épreuve tient.
     */
    expect(String(lookup(fr, JOIN_ERROR_KEYS.invitation_email_mismatch))).not.toContain(
      'reconnectez-vous'
    );
    for (const key of [
      'teamVaults.join.wrongAccountAdviceWeb',
      'teamVaults.join.wrongAccountAdviceDesktop',
    ]) {
      expect(String(lookup(fr, key)), `FR ${key}`).toContain('attendra');
      expect(String(lookup(en, key)).toLowerCase(), `EN ${key}`).toContain('waiting');
    }
  });
});

// ── No server code may ship without a decided message ────────────────────────

describe('parity with the Worker', () => {
  /**
   * Read the shared-vault Worker modules and pull out every `code: '…'` they can
   * answer with. A code that is neither translated NOR explicitly listed as
   * "the caller's fallback says it better" fails here — which is the point: the
   * decision about what a user is told must be taken by a person, once, rather than
   * defaulted into a sentence about their router.
   */
  const WORKER_SRC = join(__dirname, '../../../../infra/cloudflare-worker/src');

  function workerCodes(...files: string[]): string[] {
    const found = new Set<string>();
    for (const f of files) {
      const src = readFileSync(join(WORKER_SRC, f), 'utf8');
      for (const m of src.matchAll(/code:\s*'([a-z_]+)'/g)) found.add(m[1]);
    }
    return [...found].sort();
  }

  it('has a decision recorded for every code the vault path can return', () => {
    // `org.ts` belongs here as much as `vaults.ts`: the shared-vault journey does not
    // stop at the vault routes. Inviting by email, reading the roster and removing a
    // member all land on org endpoints marked `allowPersonalOrg`, and their refusals
    // (domain_blocked, owner_only, invitation_not_found…) reach the very same screens.
    // Scanning only the vault modules made the guarantee narrower than its own name.
    const codes = workerCodes('vaults.ts', 'rbac.ts', 'personalOrg.ts', 'org.ts');
    // Guard the guard: if the extraction silently stops working, say so loudly.
    expect(codes.length).toBeGreaterThan(20);
    expect(codes).toContain('upgrade_required');

    // JOIN_ERROR_KEYS compte comme une décision PRISE : certains refus ne
    // s'adressent qu'au joignant (`invite_vault_mismatch` n'existe que sur
    // POST /vaults/:id/join), et n'ont donc rien à dire à l'hôte. Sans cette
    // ligne, la garde exigeait une phrase côté hôte pour un écran que l'hôte ne
    // voit jamais — ou pire, laissait tomber le code dans le générique.
    const undecided = codes.filter(
      (c) =>
        !(c in VAULT_ERROR_KEYS) &&
        !(c in JOIN_ERROR_KEYS) &&
        !VAULT_CODES_WITHOUT_OWN_MESSAGE.has(c)
    );
    expect(undecided, `undecided Worker codes: ${undecided.join(', ')}`).toEqual([]);
  });

  it('keeps the two tables disjoint — a code is translated or it is not', () => {
    for (const c of VAULT_CODES_WITHOUT_OWN_MESSAGE) {
      expect(VAULT_ERROR_KEYS[c], c).toBeUndefined();
    }
  });
});

describe('une panne de rafraîchissement se lit comme une panne, pas comme une session finie', () => {
  it('classe le refus LOCAL de l’intercepteur en network_unavailable', () => {
    // `getAccessToken` rend null sans détruire la session quand le
    // rafraîchissement échoue sur un incident réseau. La requête partait quand
    // même, anonyme, et son 401 — sans code applicatif — devenait
    // `session_expired`, TERMINAL : l'écran disait « votre session s'est
    // terminée » et retirait « Réessayer », sur une coupure de quelques secondes.
    const refused = Object.assign(new Error('No access token available'), {
      code: 'network_unavailable',
      isAxiosError: false,
    });

    expect(classifyVaultFailure(refused)).toBe('network_unavailable');
    // Et donc : réessayer est honnête, et le jeton d'invitation est conservé.
    expect(isVaultErrorRetryable('network_unavailable')).toBe(true);
    expect(isDeadInviteError('network_unavailable')).toBe(false);
  });

  it('un vrai 401 du serveur reste session_expired', () => {
    const unauthorized = { isAxiosError: true, response: { status: 401, data: {} } };
    expect(classifyVaultFailure(unauthorized)).toBe('session_expired');
  });

  it('le code du serveur garde la priorité sur le nôtre', () => {
    const withBody = {
      isAxiosError: true,
      code: 'network_unavailable',
      response: { status: 403, data: { code: 'host_plan_lapsed' } },
    };
    expect(classifyVaultFailure(withBody)).toBe('host_plan_lapsed');
  });
});
