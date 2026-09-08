/**
 * accessJourneyModel — « OÙ EN EST L'ACCÈS DE X ? », en cinq crans (F04).
 *
 * LE DÉFAUT QU'IL FERME. « Dans mon espace mais pas dans le coffre » n'était un
 * état visible NULLE PART. L'hôte lisait une pastille — « 1 accès en attente de
 * votre vérification » — sans savoir de qui elle parlait, ce qui manquait, ni
 * quoi faire ; et l'invitée, de son côté, ne voyait rien du tout. Or cinq choses
 * peuvent manquer, et elles appellent cinq gestes DIFFÉRENTS, dont trois
 * consistent à ne rien faire :
 *
 *   1. invitée à l'espace   → l'intention (0073) existe : quelqu'un a promis
 *   2. active dans l'espace → sinon : renvoyer l'invitation d'espace
 *   3. a publié sa clé      → sinon : attendre sa première ouverture de Filarr
 *   4. accès scellé         → sinon : vérifier sa clé et sceller, ici et maintenant
 *   5. a rejoint            → sinon : l'invitation dort, on peut couper court
 *
 * L'ORDRE EST LA DÉCISION PRINCIPALE. C'est le PREMIER cran non atteint qui
 * porte l'action : proposer de comparer une empreinte à quelqu'un qui n'a pas
 * encore ouvert l'application envoie chercher un problème qui n'existe pas, et
 * c'est ainsi qu'on fabrique la méfiance envers un écran.
 *
 * ON N'AFFIRME RIEN D'UNE ABSENCE D'INFORMATION. Un annuaire illisible rend une
 * liste vide, qui se lirait « elle n'est plus dans l'espace » — un verdict FAUX,
 * qui enverrait renvoyer une invitation à quelqu'un qui est déjà là. Le cran
 * vaut alors `unknown`, et aucune action ne s'appuie dessus.
 *
 * LE PREMIER CRAN A LONGTEMPS EU UN NOM SANS SOURCE (défaut du 30/08). Une
 * personne invitée qui n'avait pas encore répondu n'avait de ligne NULLE PART :
 * la liste des invitations de coffre est vide tant que rien n'est scellé (modèle
 * 0073, et il est juste), et les intentions MÛRES l'écartent à raison. Le cran
 * « invitée à l'espace » était donc posé « fait » par construction, pour des
 * fiches qui ne pouvaient naître que PLUS TARD — l'hôte, lui, lisait « aucune
 * invitation » après avoir invité quelqu'un. `awaitingSpace` le nourrit enfin,
 * avec sa date, et fait exister la fiche dès le premier instant.
 *
 * ZÉRO REACT, ZÉRO RÉSEAU : tout se raisonne à partir de ce que les écrans ont
 * déjà lu (intentions mûres, invitations d'espace sans réponse, blocages du
 * balayage, annuaire, invitations, membres), et se vérifie sous vitest-node.
 */

import type {
  AwaitingSpaceIntentDTO,
  PendingGrantDTO,
  SpaceDirectoryEntry,
  VaultInviteDTO,
  VaultMemberDTO,
} from '../../../../services/vault/vaultApi';
import type { BlockedEntry } from '../../../../services/vault/pendingGrantSweep';
import type { DirectoryState } from '../spaceDirectory';
import { isAssignableVaultRole, type AssignableVaultRole } from '../../sharing/shareDialogModel';

/** Les crans, DANS L'ORDRE — c'est lui qui décide quelle action est offerte. */
export const ACCESS_JOURNEY_STEPS = [
  'spaceInvited',
  'inSpace',
  'keyPublished',
  'accessSealed',
  'joined',
] as const;

export type AccessJourneyStepId = (typeof ACCESS_JOURNEY_STEPS)[number];

/**
 * `unknown` n'est pas un `pending` poli : c'est le refus d'affirmer. Un cran
 * inconnu ne porte JAMAIS d'action — agir sur une ignorance, c'est le défaut
 * qu'on ferme.
 */
export type AccessStepState = 'done' | 'pending' | 'unknown';

export interface AccessJourneyStep {
  id: AccessJourneyStepId;
  state: AccessStepState;
  /** L'instant du franchissement, quand on le connaît. Souvent `null`. */
  atMs: number | null;
}

/**
 * Le geste utile, et lui seul.
 *
 * `explainOnly` est le JUMEAU HONNÊTE de `resendSpaceInvite` : un administrateur
 * de coffre reçu dans l'espace d'autrui y est org `viewer` et ne peut inviter
 * personne. Lui montrer le bouton serait une porte qui se referme au clic ; la
 * fiche dit alors à qui s'adresser.
 *
 * `none` couvre deux situations opposées et c'est assumé : tout est fait, ou on
 * ne sait pas assez pour proposer quoi que ce soit. Dans les deux cas il n'y a
 * rien à cliquer, et la fiche dit laquelle des deux par l'état des crans.
 */
export type AccessJourneyAction =
  | 'resendSpaceInvite'
  | 'explainOnly'
  | 'waitFirstOpen'
  | 'verifyKeyNow'
  | 'retryNow'
  | 'none';

export interface AccessJourney {
  vaultId: string;
  email: string;
  /** Le compte visé — la cérémonie de clé s'adresse à un compte, pas à une adresse. */
  userId: string | null;
  /** L'invitation d'ESPACE porteuse de l'intention : ce que « Annuler » vise. */
  inviteId: string | null;
  /**
   * TOUTES les invitations d'espace qui portent cette promesse, pas seulement la
   * première. « Renvoyer l'invitation d'espace » POSTE UNE INVITATION NEUVE — il
   * n'existe pas de relance côté espace — donc deux porteurs vivants pour une
   * seule promesse, et deux intentions à éteindre. N'en annuler qu'une laisserait
   * la ligne revenir à la lecture suivante, et l'hôte croirait son geste sans
   * effet : le pire des retours, celui qui ne dit rien.
   */
  intentInviteIds: readonly string[];
  /** Le rôle de coffre promis — celui sous lequel on scellera. */
  role: AssignableVaultRole;
  /** Ce que le balayage a laissé comme raison, quand il en a laissé une. */
  blockedReason: BlockedEntry['reason'] | null;
  /**
   * L'invitation d'espace est PARTIE, et personne n'a répondu — à distinguer de
   * « n'est plus dans l'espace », l'autre façon d'échouer au MÊME cran. Le geste
   * est le même, les mots sont opposés : dire « n'est plus dans votre espace
   * partagé » à quelqu'un qu'on vient d'inviter enverrait l'hôte chercher un
   * problème qui n'existe pas. L'écran choisit sa phrase là-dessus.
   */
  awaitingSpaceReply: boolean;
  /**
   * L'ACCÈS PROMIS A ÉTÉ RETIRÉ, MAIS L'INVITATION D'ESPACE EST TOUJOURS LÀ.
   *
   * Le cas réel du 30/08 : « Annuler l'accès promis » ne fermait que l'intention
   * et laissait le porteur d'espace vivant — il occupait une place, son lien
   * ouvrait toujours l'espace, et plus aucune liste ne le montrait. Le serveur
   * le rend désormais quel que soit le sort de la promesse ; ici on le NOMME,
   * parce que « en attente de sa réponse » serait faux : même si elle répond,
   * aucun accès à ce coffre n'arrivera au bout.
   *
   * Faux quand on ne sait pas (worker d'avant le correctif) : une absence
   * d'information n'est pas une annulation.
   */
  intentCanceled: boolean;
  /** L'échéance du porteur d'espace, quand on la connaît — jamais NaN. */
  spaceInviteExpiresAtMs: number | null;
  steps: AccessJourneyStep[];
  /** Le premier cran non atteint — `null` quand tout l'est. */
  currentStep: AccessJourneyStepId | null;
  action: AccessJourneyAction;
  canCancelIntent: boolean;
}

export interface AccessJourneyInput {
  vaultId: string;
  /** Les intentions MÛRES de ce coffre (`GET /:id/pending-grants`). */
  grants: readonly PendingGrantDTO[];
  /**
   * Les intentions qui attendent encore une RÉPONSE — la seconde moitié de la
   * MÊME route, donc du même instant. Sans elles, le premier cran n'a aucune
   * source et la personne qu'on vient d'inviter n'apparaît nulle part.
   */
  awaitingSpace: readonly AwaitingSpaceIntentDTO[];
  /** Les blocages du dernier balayage — tous coffres confondus, filtrés ici. */
  blocked: readonly BlockedEntry[];
  directory: readonly SpaceDirectoryEntry[];
  directoryState: DirectoryState;
  /** Les invitations de COFFRE encore vivantes. */
  invites: readonly VaultInviteDTO[];
  members: readonly VaultMemberDTO[];
  /** Suis-je propriétaire ou administrateur de l'ESPACE de ce coffre ? */
  canManageSpace: boolean;
}

const canon = (email: string): string => email.trim().toLowerCase();

/** Une personne vue par l'une des trois sources, avant qu'on ne la situe. */
interface Candidate {
  email: string;
  userId: string | null;
  inviteId: string | null;
  role: AssignableVaultRole | null;
  hasKey: boolean | null;
  blockedReason: BlockedEntry['reason'] | null;
  /** Le serveur vient d'affirmer qu'elle est ACTIVE dans l'espace. */
  fromGrant: boolean;
  /** Le serveur vient d'affirmer l'INVERSE : invitée, pas encore entrée. */
  awaitingSpaceReply: boolean;
  /** La promesse d'accès a été retirée, mais l'invitation d'espace vit encore. */
  intentCanceled: boolean;
  /** Quand la promesse a été faite, et quand le porteur vivant meurt. */
  invitedAtMs: number | null;
  spaceInviteExpiresAtMs: number | null;
  /** Toutes les invitations d'espace portant la promesse — voir plus haut. */
  intentInviteIds: string[];
}

/**
 * Une date de serveur, ou RIEN.
 *
 * `created_at` sort d'un DEFAULT SQLite et n'est pas un ISO8601 garanti :
 * `Date.parse` rend alors NaN, qui s'affiche « Invalid Date » à côté d'une
 * adresse et se lit comme une donnée corrompue. On préfère ne rien dire — c'est
 * la même règle que partout ici, ne jamais affirmer sur une lecture ratée.
 */
const instant = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Les fiches d'accès en préparation de ce coffre, une par personne.
 *
 * TROIS SOURCES, ET ELLES DISENT TROIS CHOSES DIFFÉRENTES. Une intention mûre
 * est une affirmation FRAÎCHE du serveur (« cette personne est active dans votre
 * espace et attend son scellé ») ; une intention en attente de réponse est
 * l'affirmation INVERSE, tout aussi fraîche (« elle est invitée, elle n'est pas
 * encore entrée ») ; un blocage est le souvenir de ce que le dernier balayage
 * n'a pas su faire, avec la RAISON — la seule chose qui explique l'attente. On
 * les fusionne par adresse : une même personne apparaît souvent dans deux
 * d'entre elles, et deux lignes pour un fait unique reproduiraient exactement la
 * confusion qu'on ferme.
 *
 * L'ORDRE DE FUSION EST L'ORDRE D'AVANCEMENT, et c'est délibéré : le serveur
 * rend les deux premières listes EXCLUSIVES (c'est l'invariant de
 * `listAwaitingSpaceVaultAccessIntents`), mais l'écran ne parie pas dessus. Si
 * les deux arrivaient, l'affirmation la plus avancée gagne — l'inverse
 * afficherait « en attente de sa réponse » pour quelqu'un que l'hôte peut
 * sceller sur-le-champ.
 */
export function buildAccessJourneys(input: AccessJourneyInput): AccessJourney[] {
  const byEmail = new Map<string, Candidate>();

  for (const g of input.grants) {
    byEmail.set(canon(g.email), {
      email: g.email,
      userId: g.userId,
      inviteId: g.inviteId,
      role: isAssignableVaultRole(g.role) ? g.role : null,
      hasKey: g.hasKey,
      blockedReason: null,
      fromGrant: true,
      awaitingSpaceReply: false,
      intentCanceled: false,
      invitedAtMs: null,
      spaceInviteExpiresAtMs: null,
      intentInviteIds: [g.inviteId],
    });
  }

  for (const a of input.awaitingSpace) {
    const key = canon(a.email);
    const known = byEmail.get(key);
    if (known) {
      // DÉJÀ VUE PLUS LOIN DANS LE PARCOURS (intention mûre) : on ne rétrograde
      // pas son cran. On ne garde de celle-ci que l'identifiant, pour que
      // « Annuler » n'oublie aucune promesse ouverte.
      if (!known.intentInviteIds.includes(a.inviteId)) known.intentInviteIds.push(a.inviteId);
      // Une invitation d'espace ORPHELINE (promesse retirée, porteur vivant)
      // reste un fait à dire, même sur une fiche déjà plus avancée : c'est elle
      // qui tient une place, et elle ne se révoque que d'ici.
      if (a.intentStatus === 'canceled') known.intentCanceled = true;
      // Deux porteurs vivants pour une seule promesse (le renvoi en crée un
      // second) : on date la fiche du PREMIER engagement — c'est de lui que
      // l'hôte se souvient — et on affiche l'échéance la PLUS LOINTAINE, la
      // seule à laquelle une réponse est encore possible.
      if (known.awaitingSpaceReply) {
        const pose = instant(a.createdAt);
        if (pose !== null && (known.invitedAtMs === null || pose < known.invitedAtMs)) {
          known.invitedAtMs = pose;
        }
        const fin = instant(a.expiresAt);
        if (
          fin !== null &&
          (known.spaceInviteExpiresAtMs === null || fin > known.spaceInviteExpiresAtMs)
        ) {
          known.spaceInviteExpiresAtMs = fin;
        }
      }
      continue;
    }
    byEmail.set(key, {
      email: a.email,
      // Aucun compte : il n'en existe généralement pas encore, et c'est l'état
      // nominal des premières heures. On n'en fabrique pas.
      userId: null,
      inviteId: a.inviteId,
      role: isAssignableVaultRole(a.intendedRole) ? a.intendedRole : null,
      // On ne l'a JAMAIS vue : ni « elle a une clé », ni « elle n'en a pas ».
      hasKey: null,
      blockedReason: null,
      fromGrant: false,
      awaitingSpaceReply: true,
      // « Annulée » se lit sur ce qui est ÉCRIT, jamais sur ce qui manque : un
      // worker d'avant le correctif ne rend pas ce champ, et l'absence ne dit
      // rien. Voir `AccessJourney.intentCanceled`.
      intentCanceled: a.intentStatus === 'canceled',
      invitedAtMs: instant(a.createdAt),
      spaceInviteExpiresAtMs: instant(a.expiresAt),
      intentInviteIds: [a.inviteId],
    });
  }

  for (const b of input.blocked) {
    if (b.vaultId !== input.vaultId) continue;
    const key = canon(b.email);
    const known = byEmail.get(key);
    if (known) {
      // La raison complète l'intention : c'est elle qui distingue « pas encore
      // ouvert Filarr » de « sa clé a changé » de « le scellement a échoué ».
      known.blockedReason = b.reason;
      known.userId = known.userId ?? b.userId;
      continue;
    }
    byEmail.set(key, {
      email: b.email,
      userId: b.userId,
      // Un blocage ne porte pas l'invitation d'espace : on ne fabrique pas un
      // identifiant qu'« Annuler l'intention » enverrait au serveur.
      inviteId: null,
      role: null,
      hasKey: null,
      blockedReason: b.reason,
      fromGrant: false,
      awaitingSpaceReply: false,
      intentCanceled: false,
      invitedAtMs: null,
      spaceInviteExpiresAtMs: null,
      intentInviteIds: [],
    });
  }

  const memberIds = new Set(input.members.map((m) => m.userId));
  const invitedEmails = new Set(
    input.invites.filter((i) => i.status === 'pending').map((i) => canon(i.inviteeEmail))
  );
  const directoryIds = new Set(input.directory.map((e) => e.userId));
  const directoryEmails = new Set(input.directory.map((e) => canon(e.email)));

  return [...byEmail.values()].map((c) =>
    situate(c, input, {
      memberIds,
      invitedEmails,
      directoryIds,
      directoryEmails,
    })
  );
}

interface Lookups {
  memberIds: Set<string>;
  invitedEmails: Set<string>;
  directoryIds: Set<string>;
  directoryEmails: Set<string>;
}

function situate(c: Candidate, input: AccessJourneyInput, l: Lookups): AccessJourney {
  const isMember = !!c.userId && l.memberIds.has(c.userId);
  const hasLiveInvite = l.invitedEmails.has(canon(c.email));

  /**
   * 1. INVITÉE À L'ESPACE. Toujours franchi, et ce n'est pas une facilité : une
   * entrée n'existe ici QUE parce qu'une invitation portant l'intention (0073)
   * est partie, ou parce qu'un balayage a trouvé cette intention mûre.
   *
   * LA DATE, ELLE, N'ARRIVE QUE PAR UNE SOURCE. Elle est servie avec les
   * intentions en attente de réponse, jamais avec les mûres (le scellement les
   * consomme) ni avec un blocage. `null` reste donc la réponse ordinaire, et
   * c'est un refus d'inventer, pas un oubli.
   */
  const spaceInvited: AccessStepState = 'done';

  /**
   * 2. ACTIVE DANS L'ESPACE. Une intention MÛRE fait foi : le serveur ne la rend
   * que pour un membre actif, et c'est plus frais que l'annuaire.
   *
   * UNE INTENTION EN ATTENTE DE RÉPONSE FAIT FOI DE MÊME, en sens inverse, et
   * c'est la SEULE affirmation négative que ce modèle s'autorise sans annuaire.
   * Elle est légitime : le serveur vient de dire que cette personne n'est pas
   * membre active — c'est le prédicat même qui l'a mise dans cette liste, et il
   * est plus frais que tout annuaire. La faire retomber sur `unknown` quand
   * l'annuaire est illisible n'offrirait AUCUN geste, c'est-à-dire redonnerait à
   * l'écran le silence qu'on vient de lui retirer.
   *
   * UNE INVITATION ORPHELINE NE PROUVE PLUS RIEN, elle, et c'est pourquoi elle
   * est exclue de cette affirmation. Depuis le siège perdu du 30/08, cette liste
   * rend AUSSI les invitations d'espace vivantes dont la promesse a été retirée
   * — et celles-là ne sont plus servies par le prédicat « pas membre active » :
   * la personne PEUT être entrée entre-temps. On retombe donc sur l'annuaire,
   * qui sait, plutôt que d'affirmer une absence qu'on ne lit plus nulle part.
   *
   * Sinon on lit l'annuaire — et son échec de lecture reste un `unknown`, jamais
   * un « non ».
   */
  const inSpace: AccessStepState = c.fromGrant
    ? 'done'
    : c.awaitingSpaceReply && !c.intentCanceled
      ? 'pending'
      : input.directoryState !== 'ok'
        ? 'unknown'
        : (c.userId && l.directoryIds.has(c.userId)) || l.directoryEmails.has(canon(c.email))
          ? 'done'
          : 'pending';

  /**
   * 3. A PUBLIÉ SA CLÉ. `hasKey` quand l'intention est là ; sinon la raison du
   * blocage le dit indirectement — `no_key` signifie précisément que non, les
   * deux autres qu'une clé a bien été trouvée. Sans ni l'un ni l'autre, on ne
   * sait pas.
   */
  const keyPublished: AccessStepState =
    c.hasKey !== null
      ? c.hasKey
        ? 'done'
        : 'pending'
      : c.blockedReason === 'no_key'
        ? 'pending'
        : c.blockedReason
          ? 'done'
          : 'unknown';

  /**
   * 4. ACCÈS SCELLÉ. Être membre le prouve ; une invitation de coffre vivante
   * aussi — elle TRANSPORTE K_vault déjà chiffrée pour son destinataire, c'est
   * un scellé qui existe et qui n'attend qu'un consentement.
   */
  const accessSealed: AccessStepState = isMember || hasLiveInvite ? 'done' : 'pending';

  /** 5. A REJOINT. L'adhésion, et rien d'autre. */
  const joined: AccessStepState = isMember ? 'done' : 'pending';

  const states: Record<AccessJourneyStepId, AccessStepState> = {
    spaceInvited,
    inSpace,
    keyPublished,
    accessSealed,
    joined,
  };
  const joinedAt = isMember
    ? (Date.parse(input.members.find((m) => m.userId === c.userId)?.joinedAt ?? '') ?? null)
    : null;

  const steps: AccessJourneyStep[] = ACCESS_JOURNEY_STEPS.map((id) => ({
    id,
    state: states[id],
    atMs:
      id === 'joined'
        ? joinedAt !== null && !Number.isNaN(joinedAt)
          ? joinedAt
          : null
        : id === 'spaceInvited'
          ? c.invitedAtMs
          : null,
  }));

  const currentStep = ACCESS_JOURNEY_STEPS.find((id) => states[id] !== 'done') ?? null;

  return {
    vaultId: input.vaultId,
    email: c.email,
    userId: c.userId,
    inviteId: c.inviteId,
    intentInviteIds: c.intentInviteIds,
    // Moindre privilège quand personne ne l'a dit : donner « lecteur » se
    // corrige d'un menu, donner « administrateur » accorde des droits que
    // personne n'a demandés.
    role: c.role ?? 'viewer',
    blockedReason: c.blockedReason,
    awaitingSpaceReply: c.awaitingSpaceReply,
    intentCanceled: c.intentCanceled,
    spaceInviteExpiresAtMs: c.spaceInviteExpiresAtMs,
    steps,
    currentStep,
    action: actionFor(currentStep, states, c, input.canManageSpace),
    // Annuler une intention déjà honorée n'a plus d'objet (le serveur répondrait
    // 404), et on n'annule pas ce qu'on ne sait pas nommer.
    canCancelIntent: !!c.inviteId && !isMember,
  };
}

/**
 * Le geste du cran courant. `unknown` ne donne JAMAIS d'action : c'est la règle
 * qui empêche l'écran d'agir sur ce qu'il n'a pas su lire.
 */
function actionFor(
  current: AccessJourneyStepId | null,
  states: Record<AccessJourneyStepId, AccessStepState>,
  c: Candidate,
  canManageSpace: boolean
): AccessJourneyAction {
  if (!current || states[current] === 'unknown') return 'none';
  switch (current) {
    case 'inSpace':
      return canManageSpace ? 'resendSpaceInvite' : 'explainOnly';
    case 'keyPublished':
      return 'waitFirstOpen';
    case 'accessSealed':
      // Une panne de scellement se REPREND ; tout le reste demande la cérémonie.
      return c.blockedReason === 'seal_failed' ? 'retryNow' : 'verifyKeyNow';
    case 'joined':
      /**
       * L'invitation dort dans une boîte et personne ne l'ouvre — le cas
       * rapporté du 28/08. L'ajout direct (F06) rend l'adhésion sur-le-champ
       * sans attendre les sept jours, et le serveur reprend lui-même
       * l'invitation en attente. C'est la même cérémonie : on ne scelle jamais
       * sans avoir vérifié la clé.
       */
      return 'verifyKeyNow';
    default:
      return 'none';
  }
}

/**
 * Celles qui ATTENDENT ENCORE quelque chose — ce que la section « Accès en
 * préparation » et la carte « À traiter » comptent.
 *
 * POURQUOI FILTRER PLUTÔT QUE DE NE PAS CONSTRUIRE. Un blocage laissé par un
 * balayage précédent survit à sa propre cause : la personne peut être devenue
 * membre entre-temps (à la main, depuis un autre appareil). Sa fiche reste
 * CONSTRUITE — un lien profond doit pouvoir l'ouvrir et montrer cinq crans
 * franchis, ce qui répond à la question posée — mais elle n'a plus rien à faire
 * dans une liste intitulée « en préparation ».
 */
export function pendingAccessJourneys(journeys: readonly AccessJourney[]): AccessJourney[] {
  return journeys.filter((j) => j.currentStep !== null);
}

/**
 * La fiche visée par `?focus=` — par identifiant de compte OU par adresse,
 * parce que selon l'écran d'origine (bandeau d'accueil, carte « À traiter »,
 * lien copié) c'est l'un OU l'autre qu'on sait nommer.
 *
 * Rend `null` plutôt que la première venue : ouvrir la fiche de quelqu'un
 * d'autre serait pire que n'en ouvrir aucune.
 */
export function findAccessJourney(
  journeys: readonly AccessJourney[],
  focus: string | null | undefined
): AccessJourney | null {
  if (!focus) return null;
  const target = canon(focus);
  return journeys.find((j) => j.userId === focus || canon(j.email) === target) ?? null;
}
