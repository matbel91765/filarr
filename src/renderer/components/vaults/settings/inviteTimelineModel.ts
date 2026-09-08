/**
 * inviteTimelineModel — LA FRISE D'ÉTAT D'UNE INVITATION (F22), sans React,
 * sans réseau, sans traduction.
 *
 * CE QU'ELLE FERME. L'onglet Invitations disait DEUX choses d'une ligne en
 * attente : l'adresse et la date de péremption. Tout ce qui s'était passé entre
 * l'envoi et maintenant — une relance de l'hôte, deux, un rappel automatique du
 * serveur — n'existait nulle part à l'écran, alors que le worker le date depuis
 * 0078. L'hôte qui se demandait « ai-je déjà relancé Bob ? » n'avait qu'une
 * réponse : relancer encore, c'est-à-dire tuer un lien encore valide pour en
 * envoyer un identique.
 *
 * TROIS CRANS, ET LE QUATRIÈME EST REFUSÉ EXPRÈS. Envoyée → Relancée → réglée.
 * Il n'y a PAS de cran « Vue », et ce n'est pas une lacune : le parcours réel
 * passe par un lien cliqué, pas par le chargement d'une image dans une boîte de
 * réception. Un pixel de suivi mentirait la plupart du temps (clients qui
 * bloquent les images, proxys qui les préchargent) et poserait, dans un produit
 * dont le serveur ne sait rien du reste, une donnée comportementale sur un
 * tiers. Une frise honnête à trois crans vaut mieux qu'une frise à quatre dont
 * un est faux.
 *
 * DEUX AUTEURS, JAMAIS CONFONDUS. `resendCount` / `lastResentAt` comptent les
 * gestes de l'HÔTE ; `remindedAt` date le rappel du CRON (F21), qui n'a pas
 * d'acteur — le fil d'activité écrit d'ailleurs sa ligne sans auteur
 * (`member.invite.auto_resend`). On ne tranche PAS entre les deux quand les
 * deux ont eu lieu : on dit qu'il y a eu les deux. Écrire « relancée par
 * Filarr » à un hôte qui vient de cliquer lui ferait croire que son geste n'est
 * pas parti.
 *
 * RIEN N'EST INVENTÉ D'UNE ABSENCE. Un worker d'avant 0078 n'envoie aucun des
 * trois champs : le cran du milieu disparaît, au lieu d'afficher « relancée 0
 * fois », qui serait vrai par hasard et faux dès la première relance faite par
 * un autre client.
 */

import type { VaultInviteDTO } from '../../../../services/vault/vaultApi';
import { isLapsed, lapsedCause, parseInstant } from './inviteLifecycleModel';

/** Ce que la dernière case de la frise annonce. */
export type InviteTimelineOutcome = 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';

/**
 * Qui a relancé. `both` existe parce que l'alternative — désigner un seul
 * auteur en comparant deux horodatages — exige un ordre que les données ne
 * garantissent pas (un `lastResentAt` peut manquer alors que le compte est là),
 * et qu'un arbitrage faux efface le geste de quelqu'un.
 */
export type ResendAuthor = 'host' | 'filarr' | 'both';

export interface InviteResendFacts {
  /** Combien de fois l'HÔTE a relancé à la main. Jamais un compte de lectures. */
  count: number;
  /** Le serveur a-t-il envoyé son rappel J-2 (F21) ? */
  auto: boolean;
  author: ResendAuthor;
  /** Le plus récent des instants CONNUS. `null` si aucun n'est lisible. */
  atMs: number | null;
}

export interface InviteTimeline {
  /** L'émission. `null` quand `createdAt` est illisible — on n'invente pas. */
  sentAtMs: number | null;
  /** Le cran du milieu, ou `null` : personne n'a relancé, ou on n'en sait rien. */
  resend: InviteResendFacts | null;
  outcome: InviteTimelineOutcome;
  /**
   * L'instant du dernier cran : le RÈGLEMENT quand il a eu lieu, l'ÉCHÉANCE
   * tant que la ligne est en attente (c'est ce que la frise annonce alors) et
   * pour une expiration (le règlement, lui, n'est pas daté par le balayage).
   */
  outcomeAtMs: number | null;
}

/** Un compte de relances CRÉDIBLE — sinon le cran n'existe pas. */
function resendCount(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/** Le plus récent de deux instants dont l'un ou l'autre peut manquer. */
function latest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * La frise d'une invitation, à un instant donné.
 *
 * `nowMs` est un PARAMÈTRE et non `Date.now()` : c'est ce qui rend le basculement
 * « en attente → expirée » éprouvable, et c'est aussi ce qui permet à l'onglet
 * de dater toutes ses lignes du même instant (une frise par ligne, chacune avec
 * sa propre horloge, se contredirait à la milliseconde près).
 */
export function inviteTimeline(invite: VaultInviteDTO, nowMs: number): InviteTimeline {
  const count = resendCount(invite.resendCount);
  const remindedAtMs = parseInstant(invite.remindedAt);
  const auto = remindedAtMs !== null || invite.remindedAt != null;
  const hostAtMs = parseInstant(invite.lastResentAt);
  /**
   * Le cran n'existe QUE si l'un des deux gestes a eu lieu. Un compte à zéro et
   * aucun rappel, c'est une invitation partie une fois : la frise le dit en ne
   * montrant que deux crans.
   *
   * LA DATE COMPTE AUTANT QUE LE COMPTE, et ce n'est pas de la ceinture-bretelle :
   * un `resendCount` manquant (ou non entier) à côté d'un `lastResentAt` posé
   * ferait disparaître le geste de l'hôte ENTIÈREMENT — pas « relancée 0 fois »,
   * aucun cran du tout. Le worker d'aujourd'hui ne peut pas produire ce couple,
   * mais lire une absence comme un zéro est exactement ce que le fichier voisin
   * (`isStaleEpoch`) refuse de faire, et l'auteur resterait juste : 'host'.
   */
  const relance = count > 0 || auto || hostAtMs !== null;

  const author: ResendAuthor = count > 0 && auto ? 'both' : auto ? 'filarr' : 'host';

  let outcome: InviteTimelineOutcome;
  let outcomeAtMs: number | null;
  if (invite.status === 'accepted' || invite.status === 'declined') {
    outcome = invite.status;
    outcomeAtMs = parseInstant(invite.settledAt);
  } else if (isLapsed(invite, nowMs)) {
    // LA MÊME RÈGLE QUE LES SECTIONS (`isLapsed`) et pas une seconde
    // comparaison : entre la péremption et le passage du cron, la ligne est
    // encore `pending` avec une date passée. Deux dérivations finiraient par
    // afficher « en attente » sous le titre « Échues », sur la même ligne.
    outcome = lapsedCause(invite);
    // Une révocation est datée par son règlement ; une expiration n'est datée
    // que par l'échéance qu'elle a franchie.
    outcomeAtMs = parseInstant(invite.settledAt) ?? parseInstant(invite.expiresAt);
  } else {
    outcome = 'pending';
    outcomeAtMs = parseInstant(invite.expiresAt);
  }

  return {
    sentAtMs: parseInstant(invite.createdAt),
    resend: relance ? { count, auto, author, atMs: latest(hostAtMs, remindedAtMs) } : null,
    outcome,
    outcomeAtMs,
  };
}

/** L'état visuel d'un cran : franchi, ou encore à venir. */
export type TimelineStepState = 'done' | 'todo';

export type InviteTimelineStep =
  | { id: 'sent'; state: TimelineStepState; atMs: number | null }
  | {
      id: 'resent';
      state: TimelineStepState;
      atMs: number | null;
      count: number;
      author: ResendAuthor;
    }
  | {
      id: 'outcome';
      state: TimelineStepState;
      atMs: number | null;
      outcome: InviteTimelineOutcome;
    };

/**
 * La frise, prête à rendre — le composant n'a plus qu'à traduire.
 *
 * LE CRAN DU MILIEU EST OMIS quand il n'a pas eu lieu, au lieu d'être rendu
 * « à venir » : une relance n'est pas une étape OBLIGATOIRE du parcours (la
 * plupart des invitations sont acceptées sans), et la dessiner en gris
 * suggérerait qu'il manque quelque chose à faire.
 */
export function timelineSteps(timeline: InviteTimeline): InviteTimelineStep[] {
  const steps: InviteTimelineStep[] = [
    // L'envoi a TOUJOURS eu lieu : une invitation qui n'existe pas n'a pas de
    // ligne. Une date illisible ne le remet pas en cause, elle reste muette.
    { id: 'sent', state: 'done', atMs: timeline.sentAtMs },
  ];
  if (timeline.resend) {
    steps.push({
      id: 'resent',
      state: 'done',
      atMs: timeline.resend.atMs,
      count: timeline.resend.count,
      author: timeline.resend.author,
    });
  }
  steps.push({
    id: 'outcome',
    state: timeline.outcome === 'pending' ? 'todo' : 'done',
    atMs: timeline.outcomeAtMs,
    outcome: timeline.outcome,
  });
  return steps;
}

/** Une clé i18n et, quand la phrase en a une, sa variable de pluriel. */
export interface TimelineStepLabel {
  key: string;
  params?: { count: number };
}

/**
 * LE CRAN, EN MOTS — la seule chose que le composant ne décide plus.
 *
 * POURQUOI CE N'EST PAS DANS LE RENDU. C'est ici que « Filarr a relancé » peut
 * se mettre à mentir : trois auteurs, trois clés, et un COMPTE qui ne doit pas
 * accompagner le rappel automatique (personne n'a cliqué — écrire « relancée 0
 * fois » ferait croire à un geste que l'hôte n'a pas fait). Dans un composant,
 * cette table n'était éprouvable que par un rendu ; ici, elle l'est en trois
 * lignes.
 */
export function stepLabel(step: InviteTimelineStep): TimelineStepLabel {
  if (step.id === 'sent') return { key: 'teamVaults.invites.timeline.sent' };
  if (step.id === 'outcome') return { key: `teamVaults.invites.timeline.${step.outcome}` };
  if (step.author === 'filarr') return { key: 'teamVaults.invites.timeline.resentByFilarr' };
  return {
    key:
      step.author === 'both'
        ? 'teamVaults.invites.timeline.resentBoth'
        : 'teamVaults.invites.timeline.resent',
    params: { count: step.count },
  };
}

/**
 * L'ÉCHÉANCE QU'UNE RELANCE POSERA — ou `null` quand on ne peut pas la promettre.
 *
 * POURQUOI CE CALCUL N'EST PAS « échéance + 7 jours ». Le worker ne PROLONGE
 * rien : il réécrit `expires_at = maintenant + inviteTtlDays` (route
 * `/invites/:id/resend`). Compter à partir de la date existante annoncerait
 * jusqu'à une semaine de plus que ce que le serveur écrit — sur le bouton même
 * dont l'objet est de dire ce qu'il fait.
 *
 * ET LA DURÉE VIENT DES RÉGLAGES DU COFFRE (F13), pas d'une constante : un coffre
 * réglé à deux jours ne « prolonge » pas d'une semaine. Quand les réglages n'ont
 * pas pu être lus, l'appelant passe `null` et le bouton se contente de dire
 * « Relancer » — un chiffre plausible et faux vaut moins que pas de chiffre.
 */
export function extendsUntilMs(nowMs: number, ttlDays: number | null): number | null {
  if (ttlDays === null || !Number.isFinite(ttlDays) || ttlDays <= 0) return null;
  return nowMs + Math.floor(ttlDays) * 86_400_000;
}
