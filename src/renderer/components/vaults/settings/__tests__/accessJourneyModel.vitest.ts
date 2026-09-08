import { describe, it, expect } from 'vitest';
import {
  ACCESS_JOURNEY_STEPS,
  buildAccessJourneys,
  findAccessJourney,
  pendingAccessJourneys,
  type AccessJourneyInput,
} from '../accessJourneyModel';
import type {
  AwaitingSpaceIntentDTO,
  PendingGrantDTO,
  VaultMemberDTO,
} from '../../../../../services/vault/vaultApi';
import type { BlockedEntry } from '../../../../../services/vault/pendingGrantSweep';

/**
 * LE DÉFAUT QUE CE MODÈLE FERME (F04). « Dans mon espace mais pas dans le
 * coffre » n'était un état visible NULLE PART : l'hôte voyait une pastille
 * « 1 accès en attente de votre vérification » sans savoir de quoi elle parlait,
 * ni ce qui manquait, ni quoi faire. Cinq choses peuvent manquer, et elles
 * appellent CINQ gestes différents — dont trois consistent à ne rien faire.
 *
 * Ce qui se joue ici et qui ne se voit pas à la compilation :
 *   — l'ORDRE des crans (le premier non atteint porte l'action : proposer de
 *     vérifier une clé qui n'existe pas encore envoie chercher un problème qui
 *     n'existe pas) ;
 *   — le refus d'AFFIRMER : annuaire illisible ⇒ `unknown`, pas « elle n'est
 *     plus dans l'espace » ;
 *   — le fait que « Renvoyer l'invitation d'espace » n'est proposé qu'à qui peut
 *     le faire, et dit honnêtement à qui ne le peut pas.
 */

const grant = (o: Partial<PendingGrantDTO> = {}): PendingGrantDTO => ({
  inviteId: 'inv-space-1',
  email: 'zoe@x.io',
  userId: 'u-zoe',
  role: 'member',
  hasKey: true,
  ...o,
});

const blocked = (o: Partial<BlockedEntry> = {}): BlockedEntry => ({
  vaultId: 'v1',
  email: 'zoe@x.io',
  userId: 'u-zoe',
  reason: 'key_unverified',
  ...o,
});

const member = (o: Partial<VaultMemberDTO> = {}): VaultMemberDTO => ({
  userId: 'u-zoe',
  role: 'member',
  joinedAt: '2026-09-01T10:00:00.000Z',
  ...o,
});

const input = (o: Partial<AccessJourneyInput> = {}): AccessJourneyInput => ({
  vaultId: 'v1',
  grants: [grant()],
  awaitingSpace: [],
  blocked: [],
  directory: [{ userId: 'u-zoe', email: 'zoe@x.io' }],
  directoryState: 'ok',
  invites: [],
  members: [],
  canManageSpace: true,
  ...o,
});

/** L'état d'un cran nommé, pour lire les attentes sans compter les index. */
const stepState = (j: { steps: { id: string; state: string }[] }, id: string) =>
  j.steps.find((s) => s.id === id)?.state;

// ── 1. L’ORDRE DES CRANS EST UNE DÉCISION ────────────────────────────────────

describe('les cinq crans', () => {
  it('vont de l’invitation d’espace à l’arrivée, dans cet ordre', () => {
    expect(ACCESS_JOURNEY_STEPS).toEqual([
      'spaceInvited',
      'inSpace',
      'keyPublished',
      'accessSealed',
      'joined',
    ]);
  });

  it('sont tous rendus, même ceux qui sont franchis', () => {
    const [j] = buildAccessJourneys(input());
    expect(j.steps.map((s) => s.id)).toEqual([...ACCESS_JOURNEY_STEPS]);
  });
});

// ── 2. CHAQUE MANQUE PORTE SON GESTE, ET UN SEUL ─────────────────────────────

describe('l’action est celle du PREMIER cran non atteint', () => {
  it('clé pas encore publiée : on attend sa première ouverture, rien d’autre', () => {
    const [j] = buildAccessJourneys(input({ grants: [grant({ hasKey: false })] }));

    expect(stepState(j, 'keyPublished')).toBe('pending');
    expect(j.currentStep).toBe('keyPublished');
    expect(j.action).toBe('waitFirstOpen');
  });

  it('ne propose PAS de vérifier une clé qui n’existe pas encore', () => {
    // Le cran suivant (« accès scellé ») est lui aussi non atteint : c'est
    // l'ordre qui empêche d'envoyer l'hôte comparer une empreinte absente.
    const [j] = buildAccessJourneys(input({ grants: [grant({ hasKey: false })] }));
    expect(j.action).not.toBe('verifyKeyNow');
  });

  it('clé publiée mais accès non scellé : la cérémonie, ici et maintenant', () => {
    const [j] = buildAccessJourneys(input({ blocked: [blocked()] }));

    expect(stepState(j, 'keyPublished')).toBe('done');
    expect(j.currentStep).toBe('accessSealed');
    expect(j.action).toBe('verifyKeyNow');
  });

  it('un scellement qui a échoué se REPREND, il ne se re-vérifie pas', () => {
    const [j] = buildAccessJourneys(input({ blocked: [blocked({ reason: 'seal_failed' })] }));
    expect(j.action).toBe('retryNow');
  });

  it('sortie de l’espace : on renvoie l’invitation d’espace', () => {
    const [j] = buildAccessJourneys(
      input({ grants: [], blocked: [blocked({ reason: 'no_key' })], directory: [] })
    );

    expect(stepState(j, 'inSpace')).toBe('pending');
    expect(j.currentStep).toBe('inSpace');
    expect(j.action).toBe('resendSpaceInvite');
  });

  it('…mais seulement si j’ai le droit de le faire — sinon on le DIT', () => {
    // Un admin de coffre invité chez quelqu'un d'autre est org viewer : il ne
    // peut pas inviter dans cet espace. Lui offrir le bouton serait une porte
    // qui se referme au clic.
    const [j] = buildAccessJourneys(
      input({
        grants: [],
        blocked: [blocked({ reason: 'no_key' })],
        directory: [],
        canManageSpace: false,
      })
    );
    expect(j.action).toBe('explainOnly');
  });

  it('tout est fait : aucune action, et aucun cran courant', () => {
    const [j] = buildAccessJourneys(input({ members: [member()] }));

    expect(j.steps.every((s) => s.state === 'done')).toBe(true);
    expect(j.currentStep).toBeNull();
    expect(j.action).toBe('none');
  });
});

// ── 3. CE QU’ON REFUSE D’AFFIRMER ────────────────────────────────────────────

describe('une absence d’information n’est pas un verdict', () => {
  it('annuaire illisible ⇒ « on ne sait pas », jamais « elle n’est plus là »', () => {
    const [j] = buildAccessJourneys(
      input({ grants: [], blocked: [blocked()], directory: [], directoryState: 'forbidden' })
    );
    expect(stepState(j, 'inSpace')).toBe('unknown');
  });

  it('et n’offre alors aucun geste fondé sur cette ignorance', () => {
    const [j] = buildAccessJourneys(
      input({ grants: [], blocked: [blocked()], directory: [], directoryState: 'unavailable' })
    );
    expect(j.action).toBe('none');
  });

  it('une intention MÛRE vaut présence dans l’espace, annuaire ou pas', () => {
    // Le serveur ne rend une intention mûre que pour un membre ACTIF de
    // l'espace : c'est une affirmation plus fraîche que l'annuaire.
    const [j] = buildAccessJourneys(input({ directory: [], directoryState: 'unavailable' }));
    expect(stepState(j, 'inSpace')).toBe('done');
  });

  it('sans grant ni blocage connu, la clé reste « on ne sait pas »', () => {
    const [j] = buildAccessJourneys(input({ grants: [], blocked: [], invites: [], members: [] }));
    expect(j).toBeUndefined();
  });
});

// ── 4. UNE PERSONNE, UNE FICHE ───────────────────────────────────────────────

describe('les deux sources se rejoignent sans se dédoubler', () => {
  it('la même adresse vue en intention ET en blocage ne fait qu’une fiche', () => {
    const js = buildAccessJourneys(input({ blocked: [blocked()] }));
    expect(js).toHaveLength(1);
    // Et la fiche garde la raison du blocage, qui est ce qui explique l'attente.
    expect(js[0].blockedReason).toBe('key_unverified');
  });

  it('compare les adresses sans se laisser arrêter par la casse', () => {
    const js = buildAccessJourneys(input({ blocked: [blocked({ email: 'ZOE@X.io' })] }));
    expect(js).toHaveLength(1);
  });

  it('deux personnes font deux fiches', () => {
    const js = buildAccessJourneys(
      input({ blocked: [blocked({ email: 'bob@x.io', userId: 'u-bob' })] })
    );
    expect(js.map((j) => j.email).sort()).toEqual(['bob@x.io', 'zoe@x.io']);
  });

  it('ne garde que les blocages de CE coffre', () => {
    const js = buildAccessJourneys(
      input({
        grants: [],
        blocked: [blocked({ vaultId: 'v2', email: 'ailleurs@x.io', userId: 'u-a' })],
      })
    );
    expect(js).toHaveLength(0);
  });
});

// ── 5. CE QUE LA FICHE PORTE POUR AGIR ───────────────────────────────────────

describe('la fiche porte de quoi agir', () => {
  it('l’identifiant du compte et le rôle voulu — la cérémonie s’adresse à un compte', () => {
    const [j] = buildAccessJourneys(input({ grants: [grant({ role: 'viewer' })] }));
    expect(j.userId).toBe('u-zoe');
    expect(j.role).toBe('viewer');
  });

  it('l’identifiant de l’invitation d’espace, ce que « Annuler » vise', () => {
    const [j] = buildAccessJourneys(input());
    expect(j.inviteId).toBe('inv-space-1');
    expect(j.canCancelIntent).toBe(true);
  });

  it('n’offre pas d’annuler une intention déjà honorée', () => {
    const [j] = buildAccessJourneys(input({ members: [member()] }));
    expect(j.canCancelIntent).toBe(false);
  });

  it('ni une intention qu’on ne sait pas nommer (blocage d’un balayage passé)', () => {
    const [j] = buildAccessJourneys(input({ grants: [], blocked: [blocked()] }));
    expect(j.inviteId).toBeNull();
    expect(j.canCancelIntent).toBe(false);
  });

  it('retombe sur le rôle le moins privilégié quand personne ne l’a dit', () => {
    const [j] = buildAccessJourneys(input({ grants: [], blocked: [blocked()] }));
    expect(j.role).toBe('viewer');
  });
});

// ── 6. UNE INVITATION DE COFFRE DEHORS EST UN SCELLÉ QUI EXISTE ──────────────

describe('quand une invitation de coffre est déjà partie', () => {
  const withInvite = (over = {}) =>
    input({
      invites: [
        {
          id: 'inv-vault',
          vaultId: 'v1',
          inviteeEmail: 'zoe@x.io',
          role: 'member',
          status: 'pending',
          expiresAt: '2026-09-20T10:00:00.000Z',
          createdAt: '2026-09-05 10:00:00',
        },
      ],
      ...over,
    });

  it('l’accès est SCELLÉ — le porteur transporte K_vault chiffrée', () => {
    const [j] = buildAccessJourneys(withInvite());
    expect(stepState(j, 'accessSealed')).toBe('done');
    expect(stepState(j, 'joined')).toBe('pending');
  });

  it('et l’hôte peut couper court sans attendre les sept jours', () => {
    // C'est le cas rapporté du 28/08 : la personne est dans l'espace, un jeton
    // à sept jours dort dans sa boîte, et rien n'arrive. L'ajout direct (F06)
    // rend l'adhésion sur-le-champ ; le serveur reprend l'invitation lui-même.
    const [j] = buildAccessJourneys(withInvite());
    expect(j.action).toBe('verifyKeyNow');
  });
});

// ── 7. UNE FICHE ACHEVÉE SORT DE LA LISTE, SANS DISPARAÎTRE ─────────────────

describe('pendingAccessJourneys', () => {
  it('écarte celles dont les cinq crans sont franchis', () => {
    // Un blocage laissé par un balayage précédent SURVIT à sa propre cause : la
    // personne a pu devenir membre entre-temps, à la main ou depuis un autre
    // appareil. « En préparation » ne doit plus la contenir.
    const js = buildAccessJourneys(input({ blocked: [blocked()], members: [member()] }));
    expect(js).toHaveLength(1);
    expect(pendingAccessJourneys(js)).toEqual([]);
  });

  it('mais la fiche reste ouvrable — un lien profond doit répondre', () => {
    const js = buildAccessJourneys(input({ blocked: [blocked()], members: [member()] }));
    expect(findAccessJourney(js, 'u-zoe')?.currentStep).toBeNull();
  });

  it('garde celles qui attendent encore', () => {
    const js = buildAccessJourneys(input({ blocked: [blocked()] }));
    expect(pendingAccessJourneys(js)).toHaveLength(1);
  });
});

// ── 8. LE LIEN PROFOND OUVRE LA BONNE FICHE ──────────────────────────────────

describe('findAccessJourney', () => {
  const js = buildAccessJourneys(
    input({ blocked: [blocked({ email: 'bob@x.io', userId: 'u-bob' })] })
  );

  it('trouve par identifiant de compte', () => {
    expect(findAccessJourney(js, 'u-bob')?.email).toBe('bob@x.io');
  });

  it('trouve par adresse, quelle que soit la casse', () => {
    expect(findAccessJourney(js, 'ZOE@x.IO')?.userId).toBe('u-zoe');
  });

  it('ne rend rien plutôt que la première venue', () => {
    expect(findAccessJourney(js, 'inconnu@x.io')).toBeNull();
    expect(findAccessJourney(js, undefined)).toBeNull();
    expect(findAccessJourney(js, '')).toBeNull();
  });
});

// ── 8. INVITÉE À L'ESPACE, EN ATTENTE DE RÉPONSE ─────────────────────────────
//
// LE DÉFAUT QUE CECI FERME (rapporté le 30/08). L'hôte invite quelqu'un depuis
// la ligne d'invitation d'un coffre. L'invitation existe côté serveur, avec son
// intention. Et l'onglet Invitations du coffre ne montre RIEN : la liste des
// invitations de coffre est vide (rien n'est scellé avant l'arrivée dans
// l'espace — c'est le modèle 0073, et il est juste) et les intentions MÛRES
// l'écartent à raison. Le premier cran de cette fiche — « invitée à l'espace » —
// existait dans le modèle depuis le début, et n'avait AUCUNE source de données.
//
// Le voici nourri, et avec lui la seule chose qui manquait à l'écran : une ligne.

describe('une personne invitée qui n’a pas encore répondu', () => {
  const attente = (o: Partial<AwaitingSpaceIntentDTO> = {}): AwaitingSpaceIntentDTO => ({
    inviteId: 'inv-space-9',
    email: 'test+1@exemple.fr',
    intendedRole: 'viewer',
    createdAt: '2026-08-30T09:00:00.000Z',
    expiresAt: '2026-09-06T09:00:00.000Z',
    ...o,
  });

  const seule = (o: Partial<AccessJourneyInput> = {}) =>
    buildAccessJourneys(input({ grants: [], directory: [], awaitingSpace: [attente()], ...o }));

  it('a désormais une fiche — c’est tout le défaut', () => {
    const fiches = seule();
    expect(fiches).toHaveLength(1);
    expect(fiches[0].email).toBe('test+1@exemple.fr');
  });

  it('le premier cran est enfin NOURRI : franchi, et daté de l’envoi', () => {
    // Le modèle le posait « fait » depuis le début, mais sans date : elle
    // n'était pas servie côté coffre. Elle l'est.
    const [j] = seule();
    const cran = j.steps.find((s) => s.id === 'spaceInvited');
    expect(cran?.state).toBe('done');
    expect(cran?.atMs).toBe(Date.parse('2026-08-30T09:00:00.000Z'));
  });

  it('« active dans l’espace » vaut NON, et non pas « on ne sait pas »', () => {
    // C'est la seule affirmation négative que ce modèle s'autorise sans
    // annuaire, et elle est légitime : le serveur vient de dire que cette
    // personne n'est PAS membre active — c'est le prédicat même qui l'a mise
    // dans cette liste, et il est plus frais que tout annuaire.
    const [j] = seule();
    expect(stepState(j, 'inSpace')).toBe('pending');
    expect(j.currentStep).toBe('inSpace');
  });

  it('…y compris quand l’annuaire est illisible', () => {
    // Sans cette priorité, l'écran retomberait sur `unknown` et n'offrirait
    // AUCUN geste — c'est-à-dire qu'il redeviendrait muet sur le cas nominal.
    const [j] = seule({ directoryState: 'forbidden' });
    expect(stepState(j, 'inSpace')).toBe('pending');
    expect(j.action).toBe('resendSpaceInvite');
  });

  it('on ne prétend pas savoir si elle a publié une clé — on ne l’a jamais vue', () => {
    const [j] = seule();
    expect(stepState(j, 'keyPublished')).toBe('unknown');
  });

  it('le geste est de renvoyer l’invitation d’espace — si j’en ai le droit', () => {
    expect(seule()[0].action).toBe('resendSpaceInvite');
  });

  it('…et sinon la phrase honnête, jamais un bouton qui se refermerait au clic', () => {
    // Un administrateur de COFFRE reçu dans l'espace d'autrui y est org
    // 'viewer' : il ne peut inviter personne. Le modèle décidait déjà cela pour
    // les sorties d'espace ; on le RÉUTILISE, on ne le refait pas.
    expect(seule({ canManageSpace: false })[0].action).toBe('explainOnly');
  });

  it('se distingue de « n’est plus dans l’espace » — ce ne sont pas les mêmes mots', () => {
    // Même cran, même geste, deux situations OPPOSÉES : l'une n'a jamais
    // répondu, l'autre est partie. Dire « n'est plus dans votre espace » à
    // quelqu'un qui vient d'être invité serait faux, et enverrait l'hôte
    // chercher un problème qui n'existe pas.
    expect(seule()[0].awaitingSpaceReply).toBe(true);
    const [partie] = buildAccessJourneys(
      input({ grants: [], awaitingSpace: [], blocked: [blocked()], directory: [] })
    );
    expect(partie.awaitingSpaceReply).toBe(false);
  });

  it('porte l’échéance du porteur : la ligne peut dire jusqu’à quand', () => {
    const [j] = seule();
    expect(j.spaceInviteExpiresAtMs).toBe(Date.parse('2026-09-06T09:00:00.000Z'));
  });

  it('une date illisible ne devient pas NaN — elle devient « rien »', () => {
    // `created_at` sort d'un DEFAULT SQLite, pas d'un ISO8601 garanti. Une
    // date invalide affichée telle quelle donne « Invalid Date » à côté d'une
    // adresse, ce qui ressemble à une donnée corrompue.
    const [j] = seule({ awaitingSpace: [attente({ createdAt: 'jamais', expiresAt: '' })] });
    expect(j.steps.find((s) => s.id === 'spaceInvited')?.atMs).toBeNull();
    expect(j.spaceInviteExpiresAtMs).toBeNull();
  });

  it('l’onglet Invitations n’est donc plus vide — elle attend encore quelque chose', () => {
    // La conséquence directe : `invitationsEmptyState` compte les fiches « en
    // préparation », et l'écran cesse de dire « aucune invitation » à un hôte
    // qui vient d'en envoyer une.
    expect(pendingAccessJourneys(seule())).toHaveLength(1);
  });

  it('« Annuler l’intention » est offert : la promesse n’est pas encore tenue', () => {
    expect(seule()[0].canCancelIntent).toBe(true);
    expect(seule()[0].inviteId).toBe('inv-space-9');
  });

  it('un RENVOI crée une seconde invitation : annuler doit les éteindre TOUTES', () => {
    // « Renvoyer l'invitation d'espace » poste une invitation NEUVE (il n'existe
    // pas de relance côté espace) : deux porteurs vivants pour une seule
    // promesse. N'en annuler qu'un laisserait la ligne revenir à la prochaine
    // lecture, et l'hôte croirait le geste sans effet.
    const [j] = seule({
      awaitingSpace: [attente(), attente({ inviteId: 'inv-space-10' })],
    });
    expect(j.intentInviteIds).toEqual(['inv-space-9', 'inv-space-10']);
  });

  it('une seule fiche par personne, même vue par deux sources', () => {
    const [j, ...reste] = seule({ blocked: [blocked({ email: 'TEST+1@exemple.fr' })] });
    expect(reste).toHaveLength(0);
    expect(j.blockedReason).toBe('key_unverified');
  });

  it('une intention MÛRE l’emporte : elle est là, il n’y a plus rien à attendre', () => {
    // Le serveur rend les deux listes exclusives (c'est l'invariant de
    // `listAwaitingSpaceVaultAccessIntents`). L'écran ne PARIE pas dessus : si
    // les deux arrivaient, l'affirmation la plus avancée gagne — l'inverse
    // afficherait « en attente de sa réponse » pour quelqu'un que l'hôte peut
    // sceller sur-le-champ.
    const [j] = buildAccessJourneys(
      input({
        grants: [grant({ email: 'test+1@exemple.fr', userId: 'u-t1' })],
        awaitingSpace: [attente()],
        directory: [],
      })
    );
    expect(stepState(j, 'inSpace')).toBe('done');
    expect(j.awaitingSpaceReply).toBe(false);
    expect(j.action).toBe('verifyKeyNow');
  });
});

// ── L'INVITATION D'ESPACE SURVIT À LA PROMESSE ───────────────────────────────
//
// LE CAS RÉEL DU 30/08. L'hôte clique « Annuler l'accès promis » : l'intention
// se ferme, mais l'invitation d'ESPACE reste vivante — elle occupe une place et
// son lien ouvre toujours l'espace. Le serveur la rend désormais quel que soit
// l'état de la promesse (`intentStatus`), parce qu'aucun autre écran ne peut la
// révoquer. Reste à ce que l'écran ne la fasse pas passer pour ce qu'elle n'est
// pas : « on attend sa réponse » est faux — rien n'arrivera jamais au bout.

describe('une invitation d’espace dont l’accès promis a été retiré', () => {
  const orpheline = (o: Partial<AwaitingSpaceIntentDTO> = {}): AwaitingSpaceIntentDTO => ({
    inviteId: 'inv-space-9',
    email: 'test+1@exemple.fr',
    intendedRole: 'viewer',
    createdAt: '2026-08-30T09:00:00.000Z',
    expiresAt: '2026-09-06T09:00:00.000Z',
    intentStatus: 'canceled',
    ...o,
  });

  const fiche = (o: Partial<AccessJourneyInput> = {}) =>
    buildAccessJourneys(
      input({ grants: [], directory: [], awaitingSpace: [orpheline()], ...o })
    )[0];

  it('a une fiche, et se distingue d’une invitation qu’on attend encore', () => {
    expect(fiche().intentCanceled).toBe(true);
    // Une invitation ordinaire ne porte pas ce drapeau : sans `intentStatus`
    // (worker d'avant le correctif), on n'affirme rien.
    expect(fiche({ awaitingSpace: [orpheline({ intentStatus: 'pending' })] }).intentCanceled).toBe(
      false
    );
    expect(fiche({ awaitingSpace: [orpheline({ intentStatus: undefined })] }).intentCanceled).toBe(
      false
    );
  });

  it('reste RÉVOCABLE depuis la page du coffre — c’est la seule porte', () => {
    // La console d'organisation est fermée (`ENTERPRISE_ACCESSIBLE === false`)
    // et le client n'appelle nulle part la révocation d'invitation d'espace :
    // si ce bouton disparaît, la place est perdue jusqu'à l'échéance.
    const j = fiche();
    expect(j.canCancelIntent).toBe(true);
    expect(j.intentInviteIds).toEqual(['inv-space-9']);
  });

  it('n’est pas confondue avec une promesse en cours quand l’annuaire la connaît', () => {
    // Elle a beau porter une invitation vivante, l'annuaire fait foi sur
    // l'appartenance : dire « pas encore entrée » de quelqu'un qui est là serait
    // envoyer l'hôte chercher un problème qui n'existe pas.
    const j = fiche({ directory: [{ userId: 'u-t1', email: 'test+1@exemple.fr' }] });
    expect(stepState(j, 'inSpace')).toBe('done');
  });
});
