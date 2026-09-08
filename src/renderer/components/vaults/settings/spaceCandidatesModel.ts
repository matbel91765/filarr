/**
 * spaceCandidatesModel — LES GENS DE L'ESPACE DE CE COFFRE QUI N'Y ONT PAS
 * ACCÈS. Sans React, sans réseau, sans traduction.
 *
 * « DE CE COFFRE », ET PAS « LE VÔTRE » : l'annuaire qui alimente ce modèle est
 * celui de `GET /vaults/:id/directory`, c'est-à-dire l'espace QUI POSSÈDE le
 * coffre — la route existe pour qu'un administrateur de coffre invité chez
 * quelqu'un d'autre puisse la lire (P2). Nommer cet espace « le vôtre » se
 * tromperait précisément sur le cas qu'elle sert.
 *
 * LE DÉFAUT QUE CE FICHIER FERME. La ligne d'invitation attend qu'on TAPE une
 * adresse. Elle sait admirablement dire ce qui va se passer une fois l'adresse
 * écrite — mais elle ne nomme personne, et rien à l'écran ne montre les gens
 * qui sont déjà dans l'espace sans avoir accès au coffre. L'ancien
 * `InviteMemberModal` avait au moins son sélecteur « Person » ; en le
 * supprimant, on a supprimé la seule surface qui répondait à la question
 * réellement posée par l'hôte : « il est dans mon espace, pourquoi ne le
 * vois-je pas ? » (PLAN §1, défaut 3). Le rapport du fondateur est littéral :
 * « je ne vois toujours pas matbel ».
 *
 * POURQUOI C'EST PUR, ET SÉPARÉ DES DEUX ÉCRANS QUI S'EN SERVENT. Une liste de
 * candidats se casse en silence de quatre façons qui compilent toutes :
 *   · on s'y propose soi-même (ridicule, et le scellement échouerait) ;
 *   · on y laisse quelqu'un qui a déjà accès (le geste rendrait `already_member`) ;
 *   · on perd la personne cherchée sur une différence de casse — et c'est
 *     précisément le symptôme qu'on essaie de faire disparaître ;
 *   · on affirme « personne » à partir d'un annuaire qu'on n'a PAS su lire.
 * La quatrième n'est pas gardée ici mais chez l'appelant, et c'est délibéré :
 * ce module ne reçoit que des entrées, il ne peut pas distinguer « vide » de
 * « illisible ». C'est `directoryState === 'ok'` qui décide d'afficher quoi que
 * ce soit — même règle que `outsidersInSpace` et que `inviteRouteWithDirectory`
 * (« terminal ≠ jetable » : on ne tire pas de verdict d'une absence
 * d'information).
 *
 * CE QU'IL AJOUTE À `outsidersInSpace`, QUI VIT À CÔTÉ. Celui-là répond à une
 * question de comptage pour l'Aperçu : qui n'est pas membre. Il ignore l'hôte
 * lui-même, ne sait rien des invitations déjà parties, ne filtre pas et ne trie
 * pas. Une liste qu'on PARCOURT et dans laquelle on TAPE a besoin des quatre.
 */

import type {
  SpaceDirectoryEntry,
  VaultInviteDTO,
  VaultMemberDTO,
} from '../../../../services/vault/vaultApi';
import { isLapsed } from './inviteLifecycleModel';

/**
 * Combien de suggestions la liste déroulante montre au plus.
 *
 * Huit, parce qu'une liste sous un champ doit rester lisible d'un regard sans
 * pousser le reste de la ligne hors de l'écran ; au-delà, c'est la frappe qui
 * réduit — et le compte des laissés-pour-compte le dit (`hidden`) plutôt que de
 * faire croire qu'on a tout vu.
 */
export const CANDIDATE_SUGGESTION_LIMIT = 8;

/**
 * Combien de candidats la SECTION de l'onglet Membres montre au plus.
 *
 * ELLE ÉTAIT SANS LIMITE, ET C'ÉTAIT UN PARI SUR LA TAILLE DES ESPACES. Le motif
 * écrit était « l'annuaire d'un espace est borné par ses sièges » : vrai d'un
 * espace personnel partagé (dix, vingt-cinq), faux d'un espace d'entreprise à
 * plusieurs centaines de sièges, où la section rendait autant de lignes d'un
 * coup et repoussait le trombinoscope sous l'horizon.
 *
 * Vingt-cinq, parce que c'est déjà plus qu'on ne parcourt à l'œil : au-delà, on
 * ne cherche plus, on TAPE — et le champ juste au-dessus filtre. Le reste est
 * DIT (`hidden`), avec le geste qui y mène : une section qui s'arrête en silence
 * ferait conclure que la personne cherchée n'est pas dans l'espace, c'est-à-dire
 * le défaut même que cette section répare.
 */
export const CANDIDATE_SECTION_LIMIT = 25;

/** Une personne de l'espace à qui l'on peut donner l'accès sur-le-champ. */
export interface SpaceCandidate {
  userId: string;
  /** Son adresse, telle que l'annuaire la rend — c'est elle qu'on pré-remplit. */
  email: string;
  /**
   * Une invitation DE COFFRE est encore dehors à son nom. Elle ne l'empêche pas
   * de recevoir l'accès directement (F06 : plus rien n'expire pour quelqu'un
   * qui est déjà là), mais le taire ferait passer un hôte pour n'ayant rien
   * fait, et l'inviterait à recommencer.
   */
  pendingInvite: boolean;
}

export interface SpaceCandidatesQuery {
  /** L'annuaire de l'espace DU COFFRE (P2) — des actifs, adresse comprise. */
  directory: readonly SpaceDirectoryEntry[];
  /** Le trombinoscope du coffre : eux ont déjà accès. */
  members: readonly Pick<VaultMemberDTO, 'userId'>[];
  /** Les invitations de coffre connues — absentes pour un rôle sans la route. */
  invites?: readonly VaultInviteDTO[];
  /** Mon identifiant de compte cloud ; `null` quand on ne le connaît pas encore. */
  myUserId?: string | null;
  /** Ce qui est tapé dans le champ, s'il y a lieu de réduire la liste. */
  filter?: string;
  /** Le maximum d'entrées rendues ; absent = toutes. */
  limit?: number;
  /** L'instant de référence, pour juger de la vie d'une invitation. */
  nowMs?: number;
}

export interface SpaceCandidates {
  /** Ce qu'on affiche : trié, filtré, tronqué. */
  items: SpaceCandidate[];
  /** Combien il y en a APRÈS le filtre et AVANT la troncature. */
  total: number;
  /** Ce que la troncature laisse de côté — 0 quand tout tient. */
  hidden: number;
}

/** La même normalisation que le serveur à l'invitation : bords rognés, minuscules. */
const canon = (email: string): string => email.trim().toLowerCase();

/**
 * Les candidats, dans l'ordre où on veut les lire.
 *
 * L'ORDRE N'EST PAS DÉCORATIF. Sans filtre, c'est l'alphabet : une liste qui se
 * réordonne d'un rendu à l'autre oblige à relire à chaque frappe. Avec un
 * filtre, ce qui COMMENCE par ce qu'on tape passe devant ce qui le contient
 * seulement — taper « mat » doit poser `matbel…` en tête, pas `zoe.mat…` ;
 * l'alphabet départage à l'intérieur de chaque rang, si bien que l'ordre reste
 * entièrement déterminé par l'entrée (aucun tri instable à l'écran).
 */
export function spaceCandidates(q: SpaceCandidatesQuery): SpaceCandidates {
  const nowMs = q.nowMs ?? Date.now();
  const inVault = new Set(q.members.map((m) => m.userId));
  const needle = canon(q.filter ?? '');

  /**
   * Les adresses dont une invitation de coffre est encore DEHORS.
   *
   * DEUX CONDITIONS, ET LES DEUX COMPTENT. `pending` écarte ce qui s'est déjà
   * réglé (acceptée, refusée) : le drapeau dit « la personne a un lien en main
   * qu'elle n'a pas utilisé », pas « il s'est passé quelque chose un jour ».
   * `isLapsed` — le même verdict que la section « Échues » — écarte en plus ce
   * que le serveur n'a pas encore balayé : le cron ne repasse les lignes en
   * `expired` qu'à son passage, et sans cette dérivation côté client une
   * invitation périmée depuis une heure porterait encore « en attente », donc
   * dissuaderait l'hôte d'agir précisément quand il le faut.
   */
  const stillOut = new Set(
    (q.invites ?? [])
      .filter((inv) => inv.status === 'pending' && !isLapsed(inv, nowMs))
      .map((inv) => canon(inv.inviteeEmail ?? ''))
      .filter(Boolean)
  );

  const ranked: { rank: number; candidate: SpaceCandidate }[] = [];
  for (const entry of q.directory) {
    // Sans adresse, il n'y aurait rien à poser dans le champ : la ligne serait
    // un bouton qui ne fait rien. Un vieux Worker peut rendre une entrée nue.
    const email = (entry.email ?? '').trim();
    if (!email) continue;
    // Moi : je suis forcément déjà dans le coffre (ou je n'y serais pas en train
    // d'inviter), et me proposer mon propre nom n'a aucun sens. La garde tient
    // même si le trombinoscope n'est pas encore arrivé.
    if (q.myUserId && entry.userId === q.myUserId) continue;
    if (inVault.has(entry.userId)) continue;

    const key = canon(email);
    if (needle) {
      const at = key.indexOf(needle);
      if (at < 0) continue;
      ranked.push({ rank: at === 0 ? 0 : 1, candidate: candidate(entry, email, stillOut) });
    } else {
      ranked.push({ rank: 0, candidate: candidate(entry, email, stillOut) });
    }
  }

  ranked.sort((a, b) =>
    a.rank !== b.rank ? a.rank - b.rank : a.candidate.email.localeCompare(b.candidate.email)
  );

  const all = ranked.map((r) => r.candidate);
  const items = typeof q.limit === 'number' ? all.slice(0, Math.max(0, q.limit)) : all;
  return { items, total: all.length, hidden: all.length - items.length };
}

function candidate(
  entry: SpaceDirectoryEntry,
  email: string,
  stillOut: ReadonlySet<string>
): SpaceCandidate {
  return { userId: entry.userId, email, pendingInvite: stillOut.has(canon(email)) };
}

/**
 * Où va la flèche dans la liste de suggestions.
 *
 * `-1` N'EST PAS « RIEN » : c'est LE TEXTE QUE L'HÔTE A TAPÉ, et c'est une
 * position à part entière du cycle. Sans elle, quelqu'un qui descend d'un cran
 * par erreur ne pourrait plus revenir à l'adresse inconnue qu'il est en train
 * d'écrire sans effacer sa saisie — or inviter un nouveau venu est l'autre
 * moitié du geste, et la liste ne doit jamais la gêner.
 *
 * Le cycle boucle, comme la barre d'onglets du design système : une flèche qui
 * ne fait soudain plus rien se lit comme une panne. Un index hors bornes (la
 * liste a rétréci sous la frappe pendant qu'on la parcourait) retombe sur le
 * texte plutôt que d'insister sur une ligne qui n'existe plus.
 */
export function nextCandidateIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current >= count || current < -1) return -1;
  // Décalage de 1 : les positions vont de 0 (le texte tapé) à `count`.
  const slots = count + 1;
  const slot = (((current + 1 + delta) % slots) + slots) % slots;
  return slot - 1;
}
