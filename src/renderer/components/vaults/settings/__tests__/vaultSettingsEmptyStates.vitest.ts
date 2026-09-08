/**
 * vaultSettingsEmptyStates — un écran qui ne sait pas lire ne dit JAMAIS qu'il
 * n'y a rien.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/vaultSettingsEmptyStates.vitest.ts
 *
 * Ces cas-là ne se rejouent pas à la main : personne ne débranche le réseau pour
 * vérifier qu'un onglet dit « impossible de lire » plutôt que « aucune
 * invitation », et personne n'ouvre un coffre à 3 personnes sur 3 pour voir si
 * le bouton d'offre supérieure apparaît. C'est exactement pour ça qu'ils sont ici.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAccessJourneys, pendingAccessJourneys } from '../accessJourneyModel';
import {
  PERSONAL_TIER_LIMITS,
  VAULT_EMPTY_KEYS,
  activityEmptyState,
  buildTodoRows,
  invitationsEmptyState,
  loadFailureState,
  membersEmptyState,
  seatUpgradeOffers,
  seatsFullState,
  todoEmptyState,
  vaultSettingsEmptyStates,
  type VaultSettingsEmptyInput,
} from '../vaultSettingsEmptyStates';

const VIDE = { members: 1, pending: 0, settled: 0, lapsed: 0, preparing: 0, todo: 0 };

const entree = (over: Partial<VaultSettingsEmptyInput> = {}): VaultSettingsEmptyInput => ({
  counts: { ...VIDE },
  load: { loading: false, error: null },
  canManage: true,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// La règle qui vaut pour tout l'écran
// ─────────────────────────────────────────────────────────────────────────────

describe('une erreur de chargement n’est jamais un état vide', () => {
  it.each([
    ['members', membersEmptyState],
    ['invitations', invitationsEmptyState],
    ['todo', todoEmptyState],
  ])('%s : panne de lecture → error + Retry, malgré des compteurs à zéro', (_nom, fn) => {
    const etat = fn(entree({ load: { loading: false, error: 'network_unavailable' } }));
    expect(etat.kind).toBe('error');
    expect(etat.action).toBe('retry');
    // La panne est CLASSIFIÉE : « le réseau a hoqueté » et « votre offre est
    // pleine » n'appellent pas la même réaction.
    expect(etat.key).toBe('teamVaults.errors.offline');
  });

  it('un code inconnu retombe sur la phrase générique de l’effectif, sans inventer de verdict', () => {
    expect(loadFailureState('request_failed')).toEqual({
      kind: 'error',
      key: VAULT_EMPTY_KEYS.loadFailed,
      action: 'retry',
    });
  });

  it('l’erreur passe AVANT le chargement : une relance en vol n’efface pas le refus précédent', () => {
    const etat = membersEmptyState(entree({ load: { loading: true, error: 'server_error' } }));
    expect(etat.kind).toBe('error');
  });

  it('pas d’erreur → pas d’état d’erreur', () => {
    expect(loadFailureState(null)).toBeNull();
    expect(loadFailureState('')).toBeNull();
  });
});

describe('un chargement n’est jamais un état vide non plus', () => {
  it.each([
    ['members', membersEmptyState],
    ['invitations', invitationsEmptyState],
    ['todo', todoEmptyState],
  ])('%s : lecture en vol → content (la section rend son chargeur)', (_nom, fn) => {
    const etat = fn(
      entree({ counts: { ...VIDE, members: 0 }, load: { loading: true, error: null } })
    );
    expect(etat).toEqual({ kind: 'content', key: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Membres
// ─────────────────────────────────────────────────────────────────────────────

describe('l’onglet Membres', () => {
  it('seul dans le coffre → « vous êtes seul », avec le focus vers la ligne d’invitation', () => {
    expect(membersEmptyState(entree())).toEqual({
      kind: 'empty',
      key: VAULT_EMPTY_KEYS.membersAlone,
      action: 'focusInvite',
    });
  });

  it('un effectif à ZÉRO rend le même état : « aucun membre » ne décrit aucune situation atteignable', () => {
    const etat = membersEmptyState(entree({ counts: { ...VIDE, members: 0 } }));
    expect(etat.key).toBe(VAULT_EMPTY_KEYS.membersAlone);
    expect(etat.kind).toBe('empty');
  });

  it('deux membres → du contenu, pas d’état vide', () => {
    expect(membersEmptyState(entree({ counts: { ...VIDE, members: 2 } })).kind).toBe('content');
  });

  it('qui ne gère pas le coffre n’a pas la ligne d’invitation, donc pas de bouton', () => {
    const etat = membersEmptyState(entree({ canManage: false }));
    expect(etat.kind).toBe('empty');
    expect(etat.action).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invitations
// ─────────────────────────────────────────────────────────────────────────────

describe('l’onglet Invitations', () => {
  it('les quatre sections vides → un seul état vide, qui mène à la ligne d’invitation', () => {
    expect(invitationsEmptyState(entree())).toEqual({
      kind: 'empty',
      key: VAULT_EMPTY_KEYS.invitations,
      action: 'goToInviteRow',
    });
  });

  it.each([
    ['pending', 'pending'],
    ['accès en préparation', 'preparing'],
    ['récentes', 'settled'],
    ['échues', 'lapsed'],
  ] as const)(
    'une seule ligne dans « %s » suffit à garder l’écran : le vide ne remplace jamais une liste',
    (_nom, champ) => {
      const etat = invitationsEmptyState(entree({ counts: { ...VIDE, [champ]: 1 } }));
      expect(etat.kind).toBe('content');
    }
  );

  it('sans droit de gestion, l’état vide n’offre pas un geste qu’on ne pourrait pas faire', () => {
    expect(invitationsEmptyState(entree({ canManage: false })).action).toBeUndefined();
  });

  /**
   * LE DÉFAUT DU 30/08, DE BOUT EN BOUT.
   *
   * L'hôte invite quelqu'un depuis la ligne d'invitation du coffre, et l'onglet
   * Invitations répond « aucune invitation ». Les compteurs sont pourtant tous à
   * zéro À BON DROIT : rien n'est scellé avant l'arrivée dans l'espace (modèle
   * 0073), donc pas d'invitation de coffre ; et l'intention n'est pas encore
   * mûre, donc pas d'accès en préparation. Ce test relie les deux modèles pour
   * que la chaîne entière soit épinglée : une invitation d'espace sans réponse
   * fait une fiche, la fiche fait un « accès en préparation », et l'écran cesse
   * de mentir. Éprouver les deux moitiés séparément laissait passer exactement
   * ce vide-là.
   */
  it('une personne invitée qui n’a pas répondu suffit à ce que l’écran cesse de dire « aucune invitation »', () => {
    const fiches = pendingAccessJourneys(
      buildAccessJourneys({
        vaultId: 'v1',
        grants: [],
        awaitingSpace: [
          {
            inviteId: 'inv-space-9',
            email: 'test+1@exemple.fr',
            intendedRole: 'viewer',
            createdAt: '2026-08-30T09:00:00.000Z',
            expiresAt: '2026-09-06T09:00:00.000Z',
          },
        ],
        blocked: [],
        directory: [],
        directoryState: 'ok',
        invites: [],
        members: [],
        canManageSpace: true,
      })
    );
    expect(fiches).toHaveLength(1);
    expect(
      invitationsEmptyState(entree({ counts: { ...VIDE, preparing: fiches.length } })).kind
    ).toBe('content');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// « À traiter »
// ─────────────────────────────────────────────────────────────────────────────

describe('la carte « À traiter » de l’Aperçu', () => {
  it('rien à traiter → une ligne, et rien à cliquer', () => {
    expect(todoEmptyState(entree())).toEqual({ kind: 'empty', key: VAULT_EMPTY_KEYS.todo });
  });

  it('des entrées → la liste', () => {
    expect(todoEmptyState(entree({ counts: { ...VIDE, todo: 2 } })).kind).toBe('content');
  });

  it('la carte n’existe pas pour qui ne gère pas le coffre — même en panne de lecture', () => {
    const base = { canManage: false };
    expect(todoEmptyState(entree(base)).kind).toBe('content');
    expect(
      todoEmptyState(entree({ ...base, load: { loading: false, error: 'server_error' } })).kind
    ).toBe('content');
  });
});

describe('les lignes de « À traiter », construites une seule fois', () => {
  const plein = {
    canManage: true,
    preparing: 2,
    expiringSoon: 1,
    toReissue: 0,
    lapsed: 3,
    outOfSpace: 0,
  };

  it('une ligne à zéro n’existe pas : quatre zéros apprendraient à ne plus lire la carte', () => {
    expect(buildTodoRows(plein)).toEqual([
      { key: 'accessInPreparation', count: 2, tab: 'invitations' },
      { key: 'expiringSoon', count: 1, tab: 'invitations' },
      { key: 'lapsed', count: 3, tab: 'invitations' },
    ]);
  });

  it('rien nulle part → aucune ligne, et c’est ce zéro que l’état vide compte', () => {
    const rows = buildTodoRows({ ...plein, preparing: 0, expiringSoon: 0, lapsed: 0 });
    expect(rows).toEqual([]);
    // LE POINT DE LA FONCTION : le verdict « vide » et le contenu de la carte
    // sortent du MÊME calcul. Deux calculs finiraient par afficher « rien à
    // traiter » au-dessus d'une liste de trois entrées.
    expect(todoEmptyState(entree({ counts: { ...VIDE, todo: rows.length } })).kind).toBe('empty');
    expect(
      todoEmptyState(entree({ counts: { ...VIDE, todo: buildTodoRows(plein).length } })).kind
    ).toBe('content');
  });

  it('qui ne gère pas le coffre n’a pas de carte du tout', () => {
    expect(buildTodoRows({ ...plein, canManage: false })).toEqual([]);
  });

  it('chaque ligne ouvre l’onglet où le geste existe déjà — la carte n’en reproduit aucun', () => {
    const onglet: Record<string, string> = {
      outOfSpace: 'members',
      accessInPreparation: 'invitations',
      expiringSoon: 'invitations',
      toReissue: 'invitations',
      lapsed: 'invitations',
    };
    for (const row of buildTodoRows({ ...plein, outOfSpace: 1 })) {
      expect(row.tab).toBe(onglet[row.key]);
    }
  });

  /**
   * F08 — « quelqu'un détient encore la clé de ce coffre sans être dans
   * l'espace » passe EN TÊTE de l'index : c'est le seul état de cette carte qui
   * porte sur un accès en cours plutôt que sur une invitation qui attend, et
   * c'est le seul dont le geste réparateur vit dans l'onglet Membres.
   */
  it('les membres hors de l’espace ouvrent Membres, et passent avant les invitations', () => {
    const rows = buildTodoRows({ ...plein, outOfSpace: 2 });
    expect(rows[0]).toEqual({ key: 'outOfSpace', count: 2, tab: 'members' });
  });

  it('aucun membre hors de l’espace → aucune ligne (le silence d’un vieux worker vaut zéro ici)', () => {
    expect(buildTodoRows(plein).some((r) => r.key === 'outOfSpace')).toBe(false);
  });
});

describe('l’agrégat de la page', () => {
  it('rend les trois sections d’un coup, sur la même lecture', () => {
    expect(vaultSettingsEmptyStates(entree())).toEqual({
      members: { kind: 'empty', key: VAULT_EMPTY_KEYS.membersAlone, action: 'focusInvite' },
      invitations: { kind: 'empty', key: VAULT_EMPTY_KEYS.invitations, action: 'goToInviteRow' },
      todo: { kind: 'empty', key: VAULT_EMPTY_KEYS.todo },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Activité
// ─────────────────────────────────────────────────────────────────────────────

describe('le fil d’activité — trois vides, trois faits différents', () => {
  const fil = (over: Partial<Parameters<typeof activityEmptyState>[0]> = {}) =>
    activityEmptyState({ loading: false, error: null, recorded: true, events: 0, ...over });

  it('non journalisé sur ce plan → l’offre supérieure, pas un « aucune activité »', () => {
    expect(fil({ recorded: false })).toEqual({
      kind: 'empty',
      key: VAULT_EMPTY_KEYS.activityNotRecorded,
      action: 'upgrade',
    });
  });

  it('journalisé mais rien à raconter → aucun geste : un coffre neuf n’est pas en panne', () => {
    expect(fil()).toEqual({ kind: 'empty', key: VAULT_EMPTY_KEYS.activityEmpty });
  });

  it('« non journalisé » et « rien encore » ne partagent PAS la même clé', () => {
    expect(fil({ recorded: false }).key).not.toBe(fil().key);
  });

  it('`recorded` inconnu n’est pas « non » : un vieux worker ne fait pas dire au plan ce qu’il ne dit pas', () => {
    expect(fil({ recorded: null }).key).toBe(VAULT_EMPTY_KEYS.activityEmpty);
    expect(fil({ recorded: null, events: 3 }).kind).toBe('content');
  });

  it('des événements → le fil', () => {
    expect(fil({ events: 1 }).kind).toBe('content');
  });

  it('un échec de lecture garde son Retry, et ne devient jamais « aucune activité »', () => {
    const etat = fil({ error: 'activity_load_failed', recorded: false });
    expect(etat.kind).toBe('error');
    expect(etat.action).toBe('retry');
    expect(etat.key).toBe(VAULT_EMPTY_KEYS.activityFailed);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Le plafond de l'espace personnel
// ─────────────────────────────────────────────────────────────────────────────

describe('le plafond de l’espace, dit avant qu’une invitation ne soit brûlée', () => {
  it('les plafonds sont ceux du serveur (personalOrg.ts) : solo 3, pro 10, teams 25', () => {
    expect(PERSONAL_TIER_LIMITS).toEqual([
      { tier: 'solo', limit: 3 },
      { tier: 'pro', limit: 10 },
      { tier: 'teams', limit: 25 },
    ]);
  });

  it('3 sur 3 dans un espace personnel → « retirez quelqu’un ou passez à Pro (10) / Teams (25) »', () => {
    expect(seatsFullState({ memberLimit: 3, membersUsed: 3, isPersonal: true })).toEqual({
      kind: 'empty',
      key: VAULT_EMPTY_KEYS.seatsFull,
      action: 'upgrade',
      offers: [
        { tier: 'pro', limit: 10 },
        { tier: 'teams', limit: 25 },
      ],
    });
  });

  it('plein AVEC une invitation en attente → la phrase propose D’ABORD de l’annuler', () => {
    // LE CAS DU FONDATEUR. « Passez à l'offre supérieure » était la seule sortie
    // nommée alors qu'une place se libérait d'un clic, sur un écran voisin :
    // proposer de payer quand il suffit d'annuler, c'est la pire des impasses.
    const etat = seatsFullState({
      memberLimit: 3,
      membersUsed: 3,
      activeMembers: 2,
      pendingInvites: 1,
      isPersonal: true,
    });
    expect(etat.key).toBe(VAULT_EMPTY_KEYS.seatsFullPending);
    // La montée d'offre reste offerte — c'est l'AUTRE sortie, pas la seule.
    expect(etat.action).toBe('upgrade');
    expect(etat.offers).toEqual([
      { tier: 'pro', limit: 10 },
      { tier: 'teams', limit: 25 },
    ]);
  });

  it('plein, au sommet, avec une invitation en attente → annuler reste la sortie', () => {
    const etat = seatsFullState({
      memberLimit: 25,
      membersUsed: 25,
      activeMembers: 24,
      pendingInvites: 1,
      isPersonal: true,
    });
    expect(etat.key).toBe(VAULT_EMPTY_KEYS.seatsFullTopPending);
    expect(etat.action).toBeUndefined();
  });

  it('plein SANS invitation en attente → la phrase d’avant, inchangée', () => {
    // Annuler une invitation qui n'existe pas n'est pas une sortie : la nommer
    // enverrait l'hôte chercher une ligne absente de l'onglet Invitations.
    const etat = seatsFullState({
      memberLimit: 3,
      membersUsed: 3,
      activeMembers: 3,
      pendingInvites: 0,
      isPersonal: true,
    });
    expect(etat.key).toBe(VAULT_EMPTY_KEYS.seatsFull);
  });

  it('déjà au sommet (25 sur 25) → on ne promet pas une offre qui n’existe pas', () => {
    const etat = seatsFullState({ memberLimit: 25, membersUsed: 25, isPersonal: true });
    expect(etat.key).toBe(VAULT_EMPTY_KEYS.seatsFullTop);
    expect(etat.action).toBeUndefined();
    expect(etat.offers).toEqual([]);
  });

  it('espace personnel inconnu (vieux worker) → la phrase générique, sans bouton', () => {
    const etat = seatsFullState({ memberLimit: 3, membersUsed: 3 });
    expect(etat.key).toBe(VAULT_EMPTY_KEYS.seatsFullUnknown);
    expect(etat.action).toBeUndefined();
  });

  it('de la place, ou des sièges inconnus → aucune phrase de plafond', () => {
    expect(seatsFullState({ memberLimit: 3, membersUsed: 2, isPersonal: true }).kind).toBe(
      'content'
    );
    expect(seatsFullState({ memberLimit: null, membersUsed: null, isPersonal: false }).kind).toBe(
      'content'
    );
    // Une VRAIE org : le worker ne rend ni plafond ni occupation.
    expect(seatsFullState(null).kind).toBe('content');
    // Un worker plus ancien n'envoie AUCUN des trois champs : `undefined` se lit
    // « je ne sais pas », jamais « zéro ».
    expect(seatsFullState({}).kind).toBe('content');
  });

  it('dépassé (une place reprise ailleurs) compte comme plein', () => {
    expect(seatsFullState({ memberLimit: 3, membersUsed: 4, isPersonal: true }).kind).toBe('empty');
  });

  it('les offres partent du plafond REÇU, jamais du nom de l’offre', () => {
    expect(seatUpgradeOffers(3)).toEqual([
      { tier: 'pro', limit: 10 },
      { tier: 'teams', limit: 25 },
    ]);
    expect(seatUpgradeOffers(10)).toEqual([{ tier: 'teams', limit: 25 }]);
    expect(seatUpgradeOffers(25)).toEqual([]);
    expect(seatUpgradeOffers(null)).toEqual([]);
    // Un plafond inconnu du client (offre future) se voit quand même proposer
    // tout ce qui est plus grand que lui.
    expect(seatUpgradeOffers(5)).toEqual([
      { tier: 'pro', limit: 10 },
      { tier: 'teams', limit: 25 },
    ]);
  });
});

/**
 * LE PANNEAU D'ACTIVITÉ, CONFRONTÉ À SA SOURCE.
 *
 * `activityEmptyState` est pur et testé plus haut ; les deux endroits qui
 * DÉCIDENT quand l'appliquer ne le sont pas, et c'est là que les deux mensonges
 * possibles vivent. Vitest ne monte pas de composant (environnement `node`), on
 * lit donc le fichier — la seule autorité disponible ici.
 *
 *  · UN FILTRE, C'EST QUATRE BORNES. Le prédicat du chargement les listait
 *    toutes ; celui de l'état vide oubliait `until`. Aucun appelant ne pose
 *    aujourd'hui de borne haute seule (`periodRange` n'ancre que `since`), donc
 *    le défaut est inerte — jusqu'au jour où quelqu'un en pose une, et où un
 *    filtre sans résultat se lira « aucune activité pour l'instant » au lieu de
 *    « aucun événement ne correspond ». Deux listes parallèles finissent
 *    toujours par diverger : on garde qu'elles ne l'ont pas fait.
 *
 *  · UNE LECTURE QUI ÉCHOUE NE COMPTE RIEN. Un échec garde volontairement la
 *    page précédente (pour pouvoir réessayer sans repartir de rien), si bien que
 *    l'en-tête de l'onglet annonçait « N événements chargés » juste au-dessus
 *    d'un panneau disant « impossible de lire ».
 */
describe('VaultActivityPanel : quand l’écran décide qu’il n’y a « rien »', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../VaultActivityPanel.tsx'), 'utf8');

  it('les DEUX prédicats de filtre listent les quatre bornes, `until` comprise', () => {
    const predicats = source.split('const filtre =').slice(1);
    expect(predicats).toHaveLength(2);
    for (const p of predicats) {
      const corps = p.split(';')[0];
      for (const borne of ['query.types', 'query.actor', 'query.since', 'query.until']) {
        expect(corps, borne).toContain(borne);
      }
    }
  });

  it('un échec de lecture ne rapporte NI compte NI suite à l’onglet', () => {
    const rapport = source.split('onPage?.({')[1]?.split('});')[0];
    expect(rapport).toBeDefined();
    expect(rapport).toContain('count: loadError ? 0 : events.length');
    expect(rapport).toContain('hasMore: !loadError &&');
  });
});
