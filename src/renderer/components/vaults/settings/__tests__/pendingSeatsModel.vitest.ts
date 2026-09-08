/**
 * pendingSeatsModel — LES INVITÉES DANS LA LISTE DES MEMBRES, éprouvées sans React.
 *
 * CE QUE CES TESTS DÉFENDENT, ET QU'AUCUNE COMPILATION NE VOIT :
 *
 *  · UNE PERSONNE, UNE LIGNE. Entre l'acceptation et la relecture des listes, la
 *    même adresse est un MEMBRE pour `/members` et une invitation VIVANTE pour
 *    `/invites`. L'afficher deux fois dans le même écran poserait à l'hôte une
 *    question sans réponse — laquelle des deux commande ? Le siège s'efface donc
 *    devant l'adhésion, jamais l'inverse.
 *
 *  · LA COMPARAISON D'ADRESSES EST TOLÉRANTE. Elles arrivent telles que l'hôte
 *    les a tapées : comparer les octets bruts laisserait « Alice@ex.com »
 *    invitée à côté d'« alice@ex.com » membre, c'est-à-dire la personne EN
 *    DOUBLE — exactement ce que la règle précédente cherche à empêcher.
 *
 *  · ON NE CONCLUT PAS D'UN SILENCE. Un membre dont l'adresse est inconnue
 *    (annuaire fermé aux invités, worker d'avant P2) n'écarte AUCUN siège :
 *    effacer sur cette base ferait disparaître de l'écran la seule ligne qui
 *    porte le geste, précisément chez l'hôte qui n'a pas l'annuaire.
 *
 *  · L'ORDRE EST CELUI DU TABLEAU. Les deux listes se lisent l'une après
 *    l'autre ; deux tris différents feraient chercher la même personne à deux
 *    endroits selon qu'elle est entrée ou non.
 */

import { describe, it, expect } from 'vitest';
import {
  intentSeatable,
  pendingSeats,
  seatBadgeKey,
  seatHintKey,
  seatLinkOffer,
  type PendingSeatsInput,
} from '../pendingSeatsModel';
import { groupInvites, type PendingInviteRow } from '../inviteLifecycleModel';
import type { VaultInviteDTO } from '../../../../../services/vault/vaultApi';
import type { AccessJourney } from '../accessJourneyModel';
import type { VaultMemberRow } from '../vaultManagementModel';
import en from '../../../../../i18n/locales/en/translation.json';
import fr from '../../../../../i18n/locales/fr/translation.json';

const NOW = Date.parse('2026-08-30T12:00:00Z');
const JOUR = 86_400_000;

function invite(o: Partial<VaultInviteDTO> = {}): VaultInviteDTO {
  return {
    id: 'inv-1',
    vaultId: 'v1',
    inviteeEmail: 'bob@x.com',
    role: 'member',
    status: 'pending',
    createdAt: '2026-08-25T09:00:00Z',
    expiresAt: new Date(NOW + 5 * JOUR).toISOString(),
    ...o,
  };
}

/** Les lignes en attente telles que la PAGE les groupe — jamais un second calcul. */
function pending(invites: VaultInviteDTO[], currentKeyEpoch = 1) {
  return groupInvites({
    invites,
    settled: [],
    lapsed: [],
    nowMs: NOW,
    currentKeyEpoch,
    directory: [],
    directoryState: 'ok',
  }).pending;
}

function member(o: Partial<VaultMemberRow> = {}): VaultMemberRow {
  return {
    userId: 'u1',
    role: 'member',
    joinedAt: '2026-08-01T09:00:00Z',
    label: 'u1',
    isSelf: false,
    removable: true,
    canChangeRole: true,
    transferable: false,
    ...o,
  } as VaultMemberRow;
}

/**
 * L'APPEL USUEL. `intents: []` par défaut : la plupart de ces cas n'éprouvent que
 * les invitations de COFFRE, et les répéter à chaque appel noierait ce que
 * chaque test dit vraiment. Les cas d'intention le passent explicitement.
 */
const sièges = (o: Partial<PendingSeatsInput> & { pending: readonly PendingInviteRow[] }) =>
  pendingSeats({ intents: [], members: [], ...o });

describe('pendingSeats — ce qui devient un siège', () => {
  it('rend l’invitation avec son rôle, son échéance et son identifiant', () => {
    const seats = sièges({
      pending: pending([invite({ role: 'viewer' })]),
      members: [],
    });
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({
      inviteId: 'inv-1',
      email: 'bob@x.com',
      role: 'viewer',
      staleEpoch: false,
      urgent: false,
    });
    expect(seats[0].expiresAtMs).toBe(NOW + 5 * JOUR);
  });

  it('reporte l’urgence et l’époque révolue, sans les recalculer', () => {
    const seats = sièges({
      pending: pending(
        [
          invite({
            expiresAt: new Date(NOW + 3600_000).toISOString(),
            wrappedVaultKeyEpoch: 0,
          }),
        ],
        2
      ),
      members: [],
    });
    expect(seats[0].urgent).toBe(true);
    expect(seats[0].staleEpoch).toBe(true);
  });

  it('n’invente pas d’échéance quand le serveur n’en a pas daté', () => {
    const seats = sièges({
      pending: pending([invite({ expiresAt: undefined })]),
      members: [],
    });
    expect(seats[0].expiresAtMs).toBeNull();
  });
});

describe('pendingSeats — une personne, une ligne', () => {
  it('efface le siège d’une adresse DÉJÀ membre', () => {
    const seats = sièges({
      pending: pending([invite({ inviteeEmail: 'bob@x.com' })]),
      members: [member({ userId: 'u9', email: 'bob@x.com', label: 'bob@x.com' })],
    });
    expect(seats).toEqual([]);
  });

  it('l’efface aussi quand la casse et les espaces diffèrent', () => {
    const seats = sièges({
      pending: pending([invite({ inviteeEmail: '  Bob@X.com ' })]),
      members: [member({ userId: 'u9', email: 'bob@x.com', label: 'bob@x.com' })],
    });
    expect(seats).toEqual([]);
  });

  it('l’efface quand l’adresse ne vient que de l’annuaire (label)', () => {
    // Le cas le PLUS courant : `/members` n'a pas porté l'adresse (worker d'avant
    // P2), c'est `buildMemberRows` qui l'a résolue dans le libellé. Ne lire que
    // `email` afficherait l'invitée une deuxième fois, à côté de son adhésion.
    const seats = sièges({
      pending: pending([invite({ inviteeEmail: 'bob@x.com' })]),
      members: [member({ userId: 'u9', email: undefined, label: 'Bob@X.com' })],
    });
    expect(seats).toEqual([]);
  });

  it('n’efface RIEN sur un membre dont l’adresse est inconnue', () => {
    // L'annuaire n'a pas pu être lu : « je ne connais pas son adresse » n'est
    // pas « ce n'est pas elle ». Le siège reste, avec son geste.
    const seats = sièges({
      pending: pending([invite()]),
      members: [member({ userId: 'u9', email: undefined, label: 'u9' })],
    });
    expect(seats.map((s) => s.email)).toEqual(['bob@x.com']);
  });

  it('ne rend qu’un siège pour deux invitations vivantes à la même adresse', () => {
    const seats = sièges({
      pending: pending([
        invite({ id: 'inv-1', inviteeEmail: 'bob@x.com' }),
        invite({ id: 'inv-2', inviteeEmail: 'BOB@x.com' }),
      ]),
      members: [],
    });
    expect(seats).toHaveLength(1);
    expect(seats[0].inviteId).toBe('inv-1');
  });

  it('écarte une invitation sans adresse lisible plutôt qu’un siège anonyme', () => {
    const seats = sièges({
      pending: pending([invite({ id: 'inv-x', inviteeEmail: '   ' }), invite({ id: 'inv-2' })]),
      members: [],
    });
    expect(seats.map((s) => s.inviteId)).toEqual(['inv-2']);
  });
});

describe('pendingSeats — l’ordre du tableau', () => {
  it('trie par adresse, sans se laisser trier par la casse', () => {
    const seats = sièges({
      pending: pending([
        invite({ id: 'a', inviteeEmail: 'zoe@x.com' }),
        invite({ id: 'b', inviteeEmail: 'Alice@x.com' }),
        invite({ id: 'c', inviteeEmail: 'bob@x.com' }),
      ]),
      members: [],
    });
    expect(seats.map((s) => s.email)).toEqual(['Alice@x.com', 'bob@x.com', 'zoe@x.com']);
  });
});

// ── LE SECOND GENRE DE SIÈGE : L'INTENTION D'ACCÈS (0073) ────────────────────
//
// LE DÉFAUT QUE CETTE MOITIÉ FERME, RAPPORTÉ APRÈS UN ESSAI RÉEL. L'hôte invite
// quelqu'un depuis le coffre, et Membres reste VIDE. En production,
// `vault_invites` ne contenait aucune ligne : la personne n'étant pas encore dans
// l'espace, le geste avait produit une INTENTION, pas une invitation de coffre.
// Le premier correctif ne lisait que les invitations de coffre — il ne pouvait
// donc rien montrer, et le rang promis restait incorrigible.
//
// CE QUE CES TESTS DÉFENDENT :
//
//  · UNE INTENTION VIVANTE DEVIENT UN SIÈGE, avec son genre (c'est lui qui
//    choisit la route du PATCH) et son échéance d'ESPACE.
//
//  · ON NE REND CORRIGIBLE QUE CE QUI EST ENCORE UNE PROMESSE. Une promesse
//    RETIRÉE, une fiche née d'un blocage de balayage, une personne DÉJÀ entrée :
//    aucune des trois n'a de rang à corriger, et le serveur refuserait.
//
//  · UNE PERSONNE, UNE LIGNE, ENTRE LES DEUX GENRES AUSSI — et dans le bon
//    sens : l'invitation de coffre l'emporte, parce qu'elle est le cran suivant
//    du même parcours et qu'elle seule porte un lien à retransmettre.

const journey = (o: Partial<AccessJourney> = {}): AccessJourney =>
  ({
    vaultId: 'v1',
    email: 'zoe@x.com',
    userId: null,
    inviteId: 'org-inv-1',
    intentInviteIds: ['org-inv-1'],
    role: 'member',
    blockedReason: null,
    awaitingSpaceReply: true,
    intentCanceled: false,
    spaceInviteExpiresAtMs: NOW + 7 * JOUR,
    steps: [],
    currentStep: 'inSpace',
    action: 'resendSpaceInvite',
    canCancelIntent: true,
    ...o,
  }) as AccessJourney;

describe('pendingSeats — l’intention d’accès est un siège, elle aussi', () => {
  it('rend l’intention avec son genre, son rôle et l’échéance de l’invitation d’ESPACE', () => {
    const seats = sièges({ pending: [], intents: [journey()] });
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({
      kind: 'accessIntent',
      inviteId: 'org-inv-1',
      email: 'zoe@x.com',
      role: 'member',
      awaitingSpaceReply: true,
      // Rien n'est scellé : il n'y a pas d'époque à comparer, donc jamais de lien
      // de coffre à réémettre depuis cette ligne.
      staleEpoch: false,
    });
    expect(seats[0].expiresAtMs).toBe(NOW + 7 * JOUR);
  });

  it('n’affirme PAS d’urgence sur une intention', () => {
    // La trancher ici demanderait un second instant de référence, et deux
    // verdicts « expire bientôt » nés d'instants différents feraient clignoter la
    // même personne d'une section à l'autre. L'échéance, elle, est affichée.
    const seats = sièges({
      pending: [],
      intents: [journey({ spaceInviteExpiresAtMs: NOW + 1000 })],
    });
    expect(seats[0].urgent).toBe(false);
  });

  it('distingue « pas encore répondu » de « dans l’espace, reste à sceller »', () => {
    const [attente] = sièges({ pending: [], intents: [journey({ awaitingSpaceReply: true })] });
    const [àSceller] = sièges({
      pending: [],
      intents: [journey({ awaitingSpaceReply: false, currentStep: 'accessSealed' })],
    });
    expect(attente.awaitingSpaceReply).toBe(true);
    expect(àSceller.awaitingSpaceReply).toBe(false);
  });
});

describe('pendingSeats — on ne rend corrigible que ce qui est encore une promesse', () => {
  it('écarte une intention dont l’accès a été ANNULÉ', () => {
    // `intent_status = 'canceled'` : le serveur borne son UPDATE à 'pending' et
    // refuserait. Et il aurait raison — plus aucun accès à ce coffre n'arrivera
    // au bout, il n'y a donc plus de rang à corriger. Sa ligne reste à l'onglet
    // Invitations, où le seul geste qui vaille (reprendre l'invitation d'espace,
    // qui occupe encore une place) est offert.
    expect(sièges({ pending: [], intents: [journey({ intentCanceled: true })] })).toEqual([]);
  });

  it('écarte une fiche née d’un BLOCAGE de balayage — elle ne porte aucune invitation', () => {
    // Son rôle est un repli « lecteur » que personne n'a choisi : l'afficher dans
    // un menu le présenterait comme une décision de l'hôte, et le PATCH n'aurait
    // aucun identifiant à envoyer.
    expect(sièges({ pending: [], intents: [journey({ inviteId: null })] })).toEqual([]);
  });

  it('écarte une fiche dont tous les crans sont franchis — la personne est ENTRÉE', () => {
    expect(sièges({ pending: [], intents: [journey({ currentStep: null })] })).toEqual([]);
  });

  it('la règle est nommée une fois, et vaut pour les deux surfaces', () => {
    expect(intentSeatable(journey())).toBe(true);
    expect(intentSeatable(journey({ inviteId: null }))).toBe(false);
    expect(intentSeatable(journey({ intentCanceled: true }))).toBe(false);
    expect(intentSeatable(journey({ currentStep: null }))).toBe(false);
  });
});

describe('pendingSeats — une personne, une ligne, quel que soit le genre', () => {
  it('l’invitation de COFFRE l’emporte sur l’intention pour la même adresse', () => {
    // L'intention a été honorée, l'invitation de coffre est partie, la liste des
    // intentions n'a pas encore été relue. Deux lignes poseraient à l'hôte une
    // question sans réponse ; c'est l'invitation de coffre qui commande, parce
    // qu'elle est le cran SUIVANT et qu'elle seule porte un lien.
    const seats = sièges({
      pending: pending([invite({ id: 'inv-coffre', inviteeEmail: 'Zoe@X.com' })]),
      intents: [journey({ email: 'zoe@x.com' })],
    });
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ kind: 'vaultInvite', inviteId: 'inv-coffre' });
  });

  it('une intention s’efface devant une ADHÉSION, comme une invitation', () => {
    const seats = sièges({
      pending: [],
      intents: [journey({ email: 'zoe@x.com' })],
      members: [member({ userId: 'u9', email: 'ZOE@x.com', label: 'zoe' })],
    });
    expect(seats).toEqual([]);
  });

  it('deux intentions pour la même adresse ne font qu’un siège', () => {
    const seats = sièges({
      pending: [],
      intents: [
        journey({ inviteId: 'org-a', email: 'zoe@x.com' }),
        journey({ inviteId: 'org-b', email: 'Zoe@x.com' }),
      ],
    });
    expect(seats.map((s) => s.inviteId)).toEqual(['org-a']);
  });

  it('les deux genres sont MÊLÉS dans le même tri alphabétique', () => {
    // L'hôte cherche une personne, pas la moitié du produit dont elle relève :
    // deux blocs séparés le feraient chercher deux fois.
    const seats = sièges({
      pending: pending([
        invite({ id: 'a', inviteeEmail: 'bob@x.com' }),
        invite({ id: 'b', inviteeEmail: 'zoe@x.com' }),
      ]),
      intents: [journey({ inviteId: 'org-1', email: 'alice@x.com' })],
    });
    expect(seats.map((s) => s.email)).toEqual(['alice@x.com', 'bob@x.com', 'zoe@x.com']);
    expect(seats.map((s) => s.kind)).toEqual(['accessIntent', 'vaultInvite', 'vaultInvite']);
  });
});

describe('ce que la ligne dit qu’elle attend', () => {
  const TROIS = [
    { kind: 'vaultInvite' as const, awaitingSpaceReply: false },
    { kind: 'accessIntent' as const, awaitingSpaceReply: true },
    { kind: 'accessIntent' as const, awaitingSpaceReply: false },
  ];

  it('trois attentes, trois phrases — jamais un « en attente » qui vaut pour tout', () => {
    expect(new Set(TROIS.map(seatBadgeKey)).size).toBe(3);
    expect(new Set(TROIS.map(seatHintKey)).size).toBe(3);
  });

  it('les six phrases existent en EN et en FR', () => {
    // Une clé manquante s'affiche telle quelle à l'écran — « teamVaults.settings.
    // pendingSeats.badgeToSeal » à côté d'une adresse — et rien ne le signale.
    for (const seat of TROIS) {
      for (const clé of [seatBadgeKey(seat), seatHintKey(seat)]) {
        for (const [nom, dict] of [
          ['EN', en],
          ['FR', fr],
        ] as const) {
          const phrase = clé
            .split('.')
            .reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], dict);
          expect(typeof phrase, `${nom} ${clé}`).toBe('string');
        }
      }
    }
  });

  it('« Retrouver le lien » n’est PAS offert sur une intention', () => {
    // Elle n'a jamais émis de porteur de COFFRE : c'est le lien d'ESPACE qui
    // circule, et il se relance depuis l'onglet Invitations. Le bouton enverrait
    // un identifiant d'`org_invitations` à la route des invitations de coffre.
    expect(seatLinkOffer({ kind: 'accessIntent', staleEpoch: false })).toBe('none');
    expect(seatLinkOffer({ kind: 'vaultInvite', staleEpoch: false })).toBe('regenerate');
    expect(seatLinkOffer({ kind: 'vaultInvite', staleEpoch: true })).toBe('reissueFirst');
  });
});
