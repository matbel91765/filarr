/**
 * Ce que l'écran d'acceptation CONCLUT, et ce qu'il FAIT — les décisions qui
 * coûtent un jeton d'invitation quand elles se trompent.
 *
 * RAPPEL DE LA MÉCANIQUE, qui donne son poids à chaque cas ci-dessous. L'écran a
 * DEUX questions à trancher, et les confondre était le défaut central :
 *   — « faut-il proposer Réessayer ? » → `isVaultErrorRetryable` ;
 *   — « cette invitation est-elle morte ? » → `shouldConsumeInvite`, et ELLE
 *     SEULE autorise à effacer le porteur.
 * Effacer sur la première revenait à détruire l'invitation sur une session
 * tombée ou un mauvais compte — c'est-à-dire sur les deux échecs les plus
 * probables du parcours, dont les messages promettent précisément l'inverse.
 *
 * L'ENCHAÎNEMENT EST TESTÉ AVEC. Une contre-épreuve a remis l'appel
 * d'acceptation dans sa forme défectueuse et la suite est restée verte : les
 * verdicts étaient épinglés, pas leur câblage. `runAcceptance` reçoit donc ses
 * effets de bord en paramètres, et c'est LUI qu'on exerce ici.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  acceptOrgCode,
  acceptOrgInvite,
  consumeOnClose,
  displayedInviteErrorCode,
  isWrongRecipientError,
  isForAnotherAccount,
  runAcceptance,
  settleAcceptance,
  shouldConsumeInvite,
  TRANSPORT_REJECTED_CODE,
  UNKNOWN_FAILURE_CODE,
  type AcceptanceDeps,
} from '../pendingInviteFlow';
import { isSameAccountAddress } from '../inviteAccountMatch';
import {
  isDeadInviteError,
  isVaultErrorRetryable,
  joinErrorKey,
  JOIN_ERROR_KEYS,
} from '../../../../services/vault/vaultErrorMessages';
import type { PendingInvite } from '../../../../services/invites/pendingInvite';

const TOKEN = 'a'.repeat(64);
const ORG_INVITE: PendingInvite = { kind: 'org', token: TOKEN };
const VAULT_INVITE: PendingInvite = { kind: 'vault', token: TOKEN, vaultId: 'v1', orgId: 'host' };

// ── 1. Un refus muet n'est pas un refus définitif ────────────────────────────

/**
 * LE DÉFAUT QUE CECI FERME. Le repli était `return res?.code ?? 'invite_invalid'`.
 * Or plusieurs échecs de TRANSPORT ne portent aucun `code` : `authService`
 * fabrique `{ error: 'Session expired' }`, `{ error: 'Refresh unavailable
 * (network)' }`, `{ error: 'Unexpected server response (HTTP …)' }`, et
 * l'enveloppe web fabriquait `{ error: 'HTTP 502' }`. Tous devenaient
 * `invite_invalid` — traduit « invitation retirée ou déjà utilisée », terminal,
 * et DESTRUCTEUR du jeton.
 */
describe('acceptOrgCode', () => {
  it('rend null quand c’est accepté', () => {
    expect(acceptOrgCode({ success: true, data: { orgId: 'host', role: 'viewer' } })).toBeNull();
  });

  it('laisse passer intact le code que le serveur a prononcé', () => {
    expect(acceptOrgCode({ success: false, code: 'invitation_email_mismatch' })).toBe(
      'invitation_email_mismatch'
    );
    // Y COMPRIS un vrai `invitation_not_found` : le défaut n'était pas le code,
    // c'était de l'INVENTER.
    expect(acceptOrgCode({ success: false, code: 'invitation_not_found' })).toBe(
      'invitation_not_found'
    );
  });

  it.each([
    ['une session tombée', { success: false, error: 'Session expired' }],
    ['un refresh injoignable', { success: false, error: 'Refresh unavailable (network)' }],
    ['un corps non-JSON', { success: false, error: 'Unexpected server response (HTTP 502)' }],
    ['une passerelle en panne', { success: false, error: 'HTTP 502' }],
    ['un canal muet', undefined],
  ])('ne prononce AUCUN verdict terminal sur %s', (_label, res) => {
    const code = acceptOrgCode(res);

    expect(code).not.toBe('invite_invalid');
    expect(code).toBe(UNKNOWN_FAILURE_CODE);
    expect(isVaultErrorRetryable(code)).toBe(true);
    // Et surtout : le jeton n'est pas consommé par un refus qui n'en était pas un.
    expect(shouldConsumeInvite(code)).toBe(false);
  });

  it('ne prétend rien savoir : la phrase reste celle de l’appelant', () => {
    // `request_failed` n'est dans aucune des deux tables, DÉLIBÉRÉMENT.
    expect(JOIN_ERROR_KEYS[UNKNOWN_FAILURE_CODE]).toBeUndefined();
    expect(joinErrorKey(UNKNOWN_FAILURE_CODE, 'teamVaults.join.errors.generic')).toBe(
      'teamVaults.join.errors.generic'
    );
  });
});

// ── 2. Une acceptation se referme toujours ───────────────────────────────────

/**
 * LE DÉFAUT QUE CECI FERME. `run()` n'avait aucun try/catch, et l'invoke PEUT
 * rejeter : `apiFetch` part sur un `fetch` nu côté web, `fetchWithTimeout`
 * traverse `ipcMain.handle` côté bureau, et un `fetch` hors ligne ou abandonné
 * REJETTE au lieu de rendre une enveloppe. La modale restait alors sur
 * « Acceptation… », les deux boutons désactivés — donc ni « Plus tard », ni
 * « Fermer », ni aucune sortie — avec un rejet non géré par-dessus.
 */
describe('settleAcceptance', () => {
  it('rend le verdict de l’étape quand elle en produit un', async () => {
    await expect(settleAcceptance(async () => null)).resolves.toBeNull();
    await expect(settleAcceptance(async () => 'invite_expired')).resolves.toBe('invite_expired');
  });

  it('rend un verdict même quand l’étape JETTE', async () => {
    const code = await settleAcceptance(async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(code).toBe(UNKNOWN_FAILURE_CODE);
    expect(isVaultErrorRetryable(code)).toBe(true);
  });

  it('absorbe aussi un rejet non-Error', async () => {
    // Un `ipcMain.handle` qui explose sérialise ce qu'il peut ; rien ne garantit
    // une Error à l'arrivée.
    const notAnError: unknown = 'boom';
    await expect(settleAcceptance(() => Promise.reject(notAnError))).resolves.toBe(
      UNKNOWN_FAILURE_CODE
    );
  });

  it('rejette hors ligne sur un code transitoire, jamais terminal', () => {
    expect(isVaultErrorRetryable(TRANSPORT_REJECTED_CODE)).toBe(true);
    expect(shouldConsumeInvite(TRANSPORT_REJECTED_CODE)).toBe(false);
  });
});

// ── 3. L'ENCHAÎNEMENT lui-même, pas seulement ses verdicts ───────────────────

/**
 * LE DÉFAUT QUE CECI FERME. La contre-épreuve a remis `acceptOrg` dans sa forme
 * défectueuse — sans try/catch, repli `invite_invalid` — dans le COMPOSANT :
 * `tsc` à zéro et toute la suite verte, parce que rien ne montait le composant.
 * L'appel entre donc ici, l'invoke passé en paramètre : le même retour en
 * arrière rougit maintenant.
 */
describe('runAcceptance', () => {
  /** Des effets de bord inertes, que chaque cas surcharge à sa guise. */
  function deps(over: Partial<AcceptanceDeps> = {}): AcceptanceDeps {
    return {
      invoke: vi.fn(async () => ({ success: true })),
      joinVault: vi.fn(async () => null),
      refreshOrgs: vi.fn(async () => undefined),
      publishOwnKey: vi.fn(async () => undefined),
      loadVaults: vi.fn(async () => undefined),
      onAccepted: vi.fn(),
      sessionRetried: { current: false },
      ...over,
    };
  }

  it('accepte un ESPACE : rafraîchit, publie la clé, charge, puis consomme', async () => {
    const d = deps();
    await expect(runAcceptance(ORG_INVITE, d)).resolves.toBeNull();

    expect(d.invoke).toHaveBeenCalledWith('org:acceptInvitation', TOKEN);
    // L'ordre compte : sans la relecture des espaces, l'entrée « Coffres
    // partagés » d'un invité gratuit n'existe pas encore quand on y navigue.
    expect(d.refreshOrgs).toHaveBeenCalled();
    expect(d.publishOwnKey).toHaveBeenCalled();
    expect(d.loadVaults).toHaveBeenCalled();
    expect(d.onAccepted).toHaveBeenCalledWith(ORG_INVITE);
  });

  it('n’annonce RIEN quand le serveur a refusé', async () => {
    const d = deps({ invoke: vi.fn(async () => ({ success: false, code: 'invitation_expired' })) });
    await expect(runAcceptance(ORG_INVITE, d)).resolves.toBe('invitation_expired');

    expect(d.onAccepted).not.toHaveBeenCalled();
    expect(d.refreshOrgs).not.toHaveBeenCalled();
  });

  /**
   * LE CŒUR DE LA CONTRE-ÉPREUVE. Un invoke qui JETTE — `fetch` hors ligne des
   * deux côtés — ne doit produire ni verdict terminal, ni destruction du jeton.
   */
  it('ne détruit rien quand l’invoke JETTE', async () => {
    const d = deps({
      invoke: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });

    const code = await runAcceptance(ORG_INVITE, d);

    expect(code).toBe(TRANSPORT_REJECTED_CODE);
    expect(code).not.toBe('invite_invalid');
    expect(isVaultErrorRetryable(code)).toBe(true);
    expect(shouldConsumeInvite(code)).toBe(false);
    expect(d.onAccepted).not.toHaveBeenCalled();
  });

  it('ne détruit rien quand le canal est absent (façade non installée)', async () => {
    const code = await runAcceptance(ORG_INVITE, deps({ invoke: undefined }));
    expect(shouldConsumeInvite(code)).toBe(false);
    expect(isVaultErrorRetryable(code)).toBe(true);
  });

  it('ne détruit rien quand l’enveloppe est muette', async () => {
    const code = await runAcceptance(ORG_INVITE, deps({ invoke: vi.fn(async () => undefined) }));
    expect(code).toBe(UNKNOWN_FAILURE_CODE);
    expect(shouldConsumeInvite(code)).toBe(false);
  });

  it('reprend UNE fois après une session tombée, jamais deux', async () => {
    // Sur le web le jeton d'accès ne se re-frappe qu'une fois par chargement :
    // un onglet resté ouvert échoue en session_expired avec un cookie de
    // refresh encore bon.
    const calls: string[] = [];
    const invoke = vi.fn(async (channel: string) => {
      calls.push(channel);
      if (channel !== 'org:acceptInvitation') return { success: true };
      return calls.filter((c) => c === 'org:acceptInvitation').length === 1
        ? { success: false, code: 'session_expired' }
        : { success: true };
    });
    const d = deps({ invoke });

    await expect(runAcceptance(ORG_INVITE, d)).resolves.toBeNull();
    expect(calls).toEqual(['org:acceptInvitation', 'auth:getMe', 'org:acceptInvitation']);
    expect(d.sessionRetried.current).toBe(true);

    // Une seconde acceptation sur la MÊME invitation ne rejoue pas la reprise :
    // sans quoi une session réellement finie boucle.
    calls.length = 0;
    const stillExpired = vi.fn(async () => ({ success: false, code: 'session_expired' }));
    const code = await runAcceptance(
      ORG_INVITE,
      deps({ invoke: stillExpired, sessionRetried: d.sessionRetried })
    );
    expect(code).toBe('session_expired');
    expect(stillExpired).toHaveBeenCalledTimes(1);
  });

  it('une session tombée laisse l’invitation en place, comme sa phrase le promet', async () => {
    const d = deps({ invoke: vi.fn(async () => ({ success: false, code: 'session_expired' })) });
    const code = await runAcceptance(ORG_INVITE, d);

    expect(code).toBe('session_expired');
    expect(shouldConsumeInvite(code)).toBe(false);
  });

  it('accepte un COFFRE par la jointure, puis relit les espaces', async () => {
    const d = deps();
    await expect(runAcceptance(VAULT_INVITE, d)).resolves.toBeNull();

    expect(d.joinVault).toHaveBeenCalledWith(VAULT_INVITE);
    expect(d.invoke).not.toHaveBeenCalled();
    expect(d.refreshOrgs).toHaveBeenCalled();
    expect(d.onAccepted).toHaveBeenCalledWith(VAULT_INVITE);
  });

  it('remonte le refus de la jointure sans rien annoncer', async () => {
    const d = deps({ joinVault: vi.fn(async () => 'vault_join_needs_space') });
    await expect(runAcceptance(VAULT_INVITE, d)).resolves.toBe('vault_join_needs_space');
    expect(d.onAccepted).not.toHaveBeenCalled();
  });

  it('une clé publique impubliable n’empêche pas d’avoir rejoint', async () => {
    // Le garde de /vaults redemande le mot de passe et reprend la main : refuser
    // l'acceptation ici perdrait une adhésion déjà acquise côté serveur.
    const d = deps({
      publishOwnKey: vi.fn(async () => {
        throw new Error('locked');
      }),
    });

    await expect(runAcceptance(ORG_INVITE, d)).resolves.toBeNull();
    expect(d.onAccepted).toHaveBeenCalled();
  });
});

// ── 4. Terminal ≠ jetable ────────────────────────────────────────────────────

/**
 * LE DÉFAUT CENTRAL QUE CECI FERME. L'écran faisait `close(!retryable)` : tout ce
 * qui était TERMINAL détruisait l'invitation. Or « terminal » ne répond qu'à la
 * question du bouton « Réessayer ». Les deux échecs les plus probables du
 * parcours — session tombée, mauvais compte — sont terminaux et parfaitement
 * réparables, et leurs messages promettent l'un et l'autre que l'invitation
 * attendra.
 */
describe('shouldConsumeInvite', () => {
  it.each([
    ['une session tombée', 'session_expired'],
    ['un compte qui n’est pas le destinataire', 'invitation_email_mismatch'],
    ['la même chose côté coffre', 'invite_email_mismatch'],
    ['un espace pas encore rejoint', 'org_forbidden'],
    ['l’ordre en deux temps', 'vault_join_needs_space'],
    ['un compte personnel devant un espace d’entreprise', 'personal_account'],
    ['un lien qui désigne un autre coffre', 'invite_vault_mismatch'],
    ['une liste d’espaces illisible', 'vault_join_space_unknown'],
    ['un espace hôte complet', 'personal_seat_limit_reached'],
    ['une panne classée en refus d’accès', 'server_error'],
    ['un inconnu', UNKNOWN_FAILURE_CODE],
  ])('CONSERVE le jeton sur %s', (_label, code) => {
    expect(shouldConsumeInvite(code)).toBe(false);
  });

  it.each([
    'invitation_not_found',
    'invitation_expired',
    'invitation_already_used',
    'invite_expired',
    'invite_invalid',
    'already_member',
    // L'époque de la clé d'un coffre ne fait que MONTER (`newEpoch = prevEpoch
    // + 1`, posé par compare-and-set) : une invitation scellée sous une époque
    // révolue ne peut plus JAMAIS aboutir. La conserver faisait revenir la même
    // fenêtre à chaque démarrage pendant sept jours, sans aucune issue.
    'invite_stale_epoch',
  ])('efface le jeton sur %s, où le serveur affirme un fait sur l’invitation', (code) => {
    expect(shouldConsumeInvite(code)).toBe(true);
    expect(isDeadInviteError(code)).toBe(true);
  });

  it('efface aussi un code nu qu’aucune route ne peut plus recevoir', () => {
    // Il a été présenté à la seule route à laquelle il pouvait l'être ; la
    // suite passe par le lien complet, qui remplacera le porteur.
    expect(shouldConsumeInvite('invite_code_not_a_space_invite')).toBe(true);
  });

  it('ne conclut rien d’une absence de code', () => {
    expect(shouldConsumeInvite(null)).toBe(false);
  });

  /**
   * LA RÈGLE, ÉPINGLÉE. Un repli d'INCONNU est ce qu'une couche produit quand
   * elle renonce à classifier. Aucun ne doit être terminal, et aucun ne doit
   * détruire l'invitation : les deux branches du parcours en fabriquent un, et
   * la branche COFFRE avait gardé `invite_invalid`, un verdict du serveur.
   */
  it('aucun repli d’inconnu atteignable depuis ce parcours n’est terminal', () => {
    for (const code of [UNKNOWN_FAILURE_CODE, TRANSPORT_REJECTED_CODE]) {
      expect(isVaultErrorRetryable(code), code).toBe(true);
      expect(shouldConsumeInvite(code), code).toBe(false);
      expect(isDeadInviteError(code), code).toBe(false);
    }
  });
});

// ── 4 bis. Toutes les façons de fermer font la même chose ────────────────────

/**
 * LE DÉFAUT QUE CECI FERME. Le bouton de pied appliquait le verdict — `close(
 * shouldConsumeInvite(code))` — tandis que la croix, Échap et le clic hors de la
 * fenêtre passaient tous par `close(false)`. Sur une invitation réellement morte
 * (`invitation_not_found`, `invite_stale_epoch`…), sortir par la croix laissait
 * donc un porteur incapable de produire quoi que ce soit, qui rouvrait la même
 * fenêtre à chaque démarrage pendant sept jours. La décision appartient au
 * VERDICT, pas au geste.
 */
describe('consumeOnClose', () => {
  it.each(['invitation_not_found', 'invite_expired', 'already_member', 'invite_stale_epoch'])(
    'efface sur %s, quelle que soit la sortie employée',
    (code) => {
      expect(consumeOnClose('failed', code)).toBe(true);
      // Le bouton de pied et la croix appellent LA MÊME fonction : ce test dit
      // qu'il n'y a plus qu'une réponse à donner.
      expect(consumeOnClose('failed', code)).toBe(shouldConsumeInvite(code));
    }
  );

  it.each(['session_expired', 'invitation_email_mismatch', 'org_forbidden', UNKNOWN_FAILURE_CODE])(
    'conserve sur %s, quelle que soit la sortie employée',
    (code) => {
      expect(consumeOnClose('failed', code)).toBe(false);
    }
  );

  it('ne détruit RIEN tant qu’aucun verdict n’est tombé', () => {
    // « Plus tard » avant d'avoir rien demandé, ou pendant l'attente : il n'y a
    // pas de refus, donc rien à conclure.
    for (const code of [null, 'invitation_not_found', 'invite_expired']) {
      expect(consumeOnClose('confirm', code), `confirm/${code}`).toBe(false);
      expect(consumeOnClose('working', code), `working/${code}`).toBe(false);
    }
  });
});

// ── 5. Un code nu n'est pas forcément une invitation d'espace ────────────────

/**
 * LE DÉFAUT QUE CECI FERME. L'interface invite à coller « le lien ou le code »,
 * et les deux sortes de jeton sont indiscernables — même alphabet, même
 * longueur. Seul le lien porte l'identifiant du coffre, donc un code nu ne peut
 * être présenté qu'à la route des ESPACES, qui répond `invitation_not_found`.
 * Recopier le code d'un lien de COFFRE donnait ainsi « invitation retirée ».
 */
describe('displayedInviteErrorCode', () => {
  const bare: PendingInvite = { kind: 'org', token: TOKEN, bare: true };
  const fromLink: PendingInvite = { kind: 'org', token: TOKEN };

  it('nomme l’ambiguïté quand le jeton a été recopié à la main', () => {
    expect(displayedInviteErrorCode(bare, 'invitation_not_found')).toBe(
      'invite_code_not_a_space_invite'
    );
    // La phrase change réellement — ce n'est pas un alias de « retirée ».
    expect(joinErrorKey('invite_code_not_a_space_invite', 'fb')).not.toBe(
      joinErrorKey('invitation_not_found', 'fb')
    );
  });

  it('laisse « inconnu » vouloir dire « retirée » quand le LIEN a été ouvert', () => {
    expect(displayedInviteErrorCode(fromLink, 'invitation_not_found')).toBe('invitation_not_found');
  });

  it.each([
    'invitation_email_mismatch',
    'already_member',
    'personal_account',
    'session_expired',
    UNKNOWN_FAILURE_CODE,
  ])('ne touche pas à %s, qui garde son sens sur un jeton nu', (code) => {
    expect(displayedInviteErrorCode(bare, code)).toBe(code);
  });
});

// ── 6. Poste partagé ─────────────────────────────────────────────────────────

/**
 * LE DÉFAUT QUE CECI FERME. Le porteur est durable et partagé par tous les
 * comptes du même navigateur. Alice ouvre son lien et ne se connecte jamais ;
 * Bob se connecte, et l'invitation d'Alice lui est proposée — avec le nom de
 * l'espace. Le serveur refuse, mais on a montré à Bob quelque chose qui ne le
 * regarde pas.
 */
describe('isForAnotherAccount', () => {
  it('reconnaît un compte qui n’est pas le destinataire', () => {
    expect(isForAnotherAccount('alice@example.com', 'bob@example.com')).toBe(true);
  });

  it('ignore la casse et les espaces — c’est la même personne', () => {
    expect(isForAnotherAccount('Alice@Example.COM', '  alice@example.com ')).toBe(false);
  });

  it('ne conclut RIEN quand l’adresse invitée est inconnue', () => {
    // L'aperçu est un ORNEMENT : hors ligne, sous plafond de requêtes ou derrière
    // un défi d'infrastructure, il ne rend rien. Le serveur reste l'autorité, et
    // son refus ne détruit plus rien.
    expect(isForAnotherAccount(undefined, 'bob@example.com')).toBe(false);
    expect(isForAnotherAccount(null, 'bob@example.com')).toBe(false);
    expect(isForAnotherAccount('alice@example.com', null)).toBe(false);
  });

  /**
   * LE DEUXIÈME DÉFAUT QUE CECI FERME, et il visait le parcours le plus courant.
   * Ce prédicat n'a jamais rien eu de spécifique à l'espace, mais il ne pouvait
   * s'appliquer qu'à lui : seule l'invitation d'ESPACE avait un aperçu public,
   * donc pour un COFFRE l'adresse invitée restait nulle, la garde ne se
   * déclenchait jamais, et le refus n'arrivait qu'APRÈS « Accepter ». L'aperçu de
   * coffre existe désormais et fournit exactement la même adresse ; le prédicat
   * n'a pas à savoir de quelle sorte d'invitation elle vient.
   */
  it('protège aussi l’invitation de COFFRE, dont l’aperçu nomme maintenant l’adresse', () => {
    // Ce que l'aperçu de coffre rend : { invitedEmail, role }.
    const vaultPreview = { invitedEmail: 'alice@example.com', role: 'member' };
    expect(isForAnotherAccount(vaultPreview.invitedEmail, 'bob@example.com')).toBe(true);
    expect(isForAnotherAccount(vaultPreview.invitedEmail, 'ALICE@example.com ')).toBe(false);
  });

  /**
   * UNE SEULE RÈGLE DE COMPARAISON, et cette épreuve est ce qui l'y tient. Ce
   * prédicat et le verdict qui habille l'écran (`inviteAccountMatch`) parlent de
   * la même paire d'adresses : deux normalisations qui divergeraient d'un cheveu
   * feraient dire aux deux moitiés de l'écran des choses contraires — la phrase
   * « envoyée à une autre adresse » au-dessus d'un bouton « Accepter » toujours
   * debout, ou l'inverse.
   */
  it('reste l’exacte négation de la comparaison du verdict', () => {
    const pairs: Array<[string, string]> = [
      ['alice@example.com', 'bob@example.com'],
      ['Alice@Example.COM', '  alice@example.com '],
      ['a.b@example.com', 'ab@example.com'],
      ['a+coffre@example.com', 'a@example.com'],
    ];
    for (const [invited, account] of pairs) {
      expect(isForAnotherAccount(invited, account)).toBe(!isSameAccountAddress(invited, account));
    }
  });
});

/**
 * Une invitation de COFFRE n'a pas d'aperçu public — son nom est chiffré de bout
 * en bout — donc `invitedEmail` reste nul, `isForAnotherAccount` rend faux, et la
 * branche « poste partagé » qui portait l'unique bouton « Ne plus me la proposer »
 * n'était JAMAIS montée pour un coffre. Quelqu'un qui ouvrait le lien d'un
 * collègue acceptait, se voyait refuser — à juste titre sans destruction du
 * jeton, qui appartient à son vrai destinataire — et revoyait la même fenêtre à
 * chaque démarrage pendant sept jours. Le refus du serveur dit ce que l'aperçu ne
 * pouvait pas dire.
 */
describe('isWrongRecipientError — la sourdine rendue atteignable pour un coffre', () => {
  it('reconnaît les trois refus où le serveur nomme le destinataire', () => {
    expect(isWrongRecipientError('invite_email_mismatch')).toBe(true);
    expect(isWrongRecipientError('invitation_email_mismatch')).toBe(true);
    expect(isWrongRecipientError('invitee_mismatch')).toBe(true);
  });

  it('ignore les refus qui ne disent RIEN du destinataire', () => {
    // Proposer d'y faire taire l'invitation inviterait à jeter la sienne sur un
    // incident passager, ou sur un lien simplement mélangé.
    expect(isWrongRecipientError('session_expired')).toBe(false);
    expect(isWrongRecipientError('invite_vault_mismatch')).toBe(false);
    expect(isWrongRecipientError('vault_join_needs_space')).toBe(false);
    expect(isWrongRecipientError('server_error')).toBe(false);
    expect(isWrongRecipientError(null)).toBe(false);
    expect(isWrongRecipientError(undefined)).toBe(false);
  });

  it('tolère un code suffixé, comme les autres prédicats', () => {
    expect(isWrongRecipientError('invite_email_mismatch:vault1')).toBe(true);
  });

  it('ne consomme jamais le jeton — la sourdine et l’effacement sont disjoints', () => {
    // La garantie qui rend le bouton acceptable : l'invitation reste entière
    // pour la personne qu'elle vise.
    expect(consumeOnClose('failed', 'invite_email_mismatch')).toBe(false);
    expect(consumeOnClose('failed', 'invitation_email_mismatch')).toBe(false);
  });
});
