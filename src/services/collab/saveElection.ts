/**
 * QUI ENREGISTRE — la règle qui empêche la tempête de conflits.
 *
 * ============================ LE PROBLÈME ============================
 *
 * Un élément de coffre n'est pas une note personnelle. Sa vérité durable est un
 * OBJET NUAGE unique, et son écriture est protégée par un contrôle de version
 * (`expectedVersion` → 409 `item_version_conflict`). Le CRDT, lui, converge chez
 * tout le monde : à la fin d'une frappe, les N pairs de la salle tiennent le
 * MÊME document et voudraient tous l'enregistrer.
 *
 * Si chacun le fait, voilà ce qui se passe, à chaque frappe :
 *   · le premier écrit et fait passer l'élément de v3 à v4 ;
 *   · les N-1 autres écrivent avec `expectedVersion: 3` → 409 chacun ;
 *   · chaque 409 relance un rafraîchissement de liste, une bannière « une autre
 *     version est arrivée », et un nouvel essai — qui repart en 409.
 * Ce n'est pas une perte de données (la garde fait son travail), c'est pire à
 * l'usage : une salle de trois personnes fabrique un conflit permanent sur un
 * document où PERSONNE n'est réellement en conflit.
 *
 * ============================= LA RÈGLE ==============================
 *
 * UN SEUL pair enregistre. Il est ÉLU, sans négociation, sans message, sans
 * verrou serveur :
 *
 *   le responsable est le pair AUTORISÉ À ÉCRIRE dont le `clientId` Yjs est le
 *   PLUS PETIT, parmi ceux que la présence de la salle donne à voir.
 *
 * Trois propriétés, et c'est tout ce qu'on lui demande :
 *
 *  1. DÉTERMINISTE — tous les pairs voient la même liste de présence et
 *     appliquent la même comparaison, donc ils désignent le même responsable.
 *     Aucun échange n'est nécessaire : personne ne « demande le jeton ».
 *  2. REPRISE AUTOMATIQUE — quand le responsable ferme la note, sa présence
 *     disparaît de l'awareness (et le relais annonce son départ). Le
 *     `clientId` suivant devient mécaniquement le plus petit : la relève est
 *     immédiate et ne demande, là encore, aucune négociation.
 *  3. UN LECTEUR N'ENREGISTRE JAMAIS — il n'entre même pas dans le scrutin. Ce
 *     n'est pas qu'une politesse d'interface : le serveur refuse son écriture
 *     (403), donc l'élire reviendrait à ne plus jamais enregistrer.
 *
 * ========================= CE QU'ELLE N'EST PAS =======================
 *
 * Ce n'est PAS un verrou distribué, et elle ne prétend pas l'être. Deux fenêtres
 * peuvent se croire responsables pendant le temps qu'une présence met à se
 * propager (typiquement à l'ouverture, avant d'avoir vu les autres). Ce cas est
 * couvert en aval, pas ici : la garde de version côté serveur reste la dernière
 * ligne, elle transforme la course en un 409 que l'interface sait montrer. Le
 * rôle de l'élection est de rendre ce 409 RARE — au lieu d'en faire le régime
 * normal. C'est aussi pourquoi l'appelant doit attendre que la salle soit
 * STABILISÉE (`settled`) avant d'écrire quoi que ce soit.
 *
 * Elle ne se défend pas non plus contre un pair MENTEUR : un lecteur qui
 * s'annoncerait « membre » dans sa présence se ferait élire et n'écrirait rien
 * (403). Il ne peut donc pas corrompre le document, seulement retarder son
 * enregistrement — et le contenu vit entre-temps dans le CRDT de chacun, plus le
 * journal du relais. Le prochain pair capable d'écrire qui ouvrira l'élément
 * enregistrera. Une élection prouvée par signature demanderait un tour de
 * protocole pour un gain qui, ici, n'existe pas.
 */

/** Rôles d'un membre de coffre, tels que le serveur les nomme. */
export type CollabRole = 'owner' | 'admin' | 'member' | 'viewer';

/** Seul un lecteur ne peut pas écrire ; un rôle inconnu est traité comme tel. */
export function roleCanWrite(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'member';
}

export interface SaveCandidate {
  /** `clientID` Yjs — unique dans la salle, opaque pour le relais. */
  clientId: number;
  /** Le rôle annoncé par ce pair l'autorise-t-il à écrire ? */
  canWrite: boolean;
}

/**
 * Le `clientId` du responsable, ou `null` quand PERSONNE dans la salle ne peut
 * écrire (une salle de lecteurs : le document vit, il ne s'enregistre pas).
 *
 * La liste doit contenir le pair local : l'élection se fait sur la salle
 * entière, pas sur « les autres ».
 */
export function electSaveResponsible(candidates: readonly SaveCandidate[]): number | null {
  let elected: number | null = null;
  for (const candidate of candidates) {
    if (!candidate.canWrite) continue;
    if (!Number.isFinite(candidate.clientId)) continue;
    if (elected === null || candidate.clientId < elected) elected = candidate.clientId;
  }
  return elected;
}

export interface SaveResponsibilityInput {
  localClientId: number;
  /** Salle entière, pair local compris. */
  candidates: readonly SaveCandidate[];
  /**
   * Notre rôle RÉEL, lu de notre propre état (Redux / jeton), jamais du réseau.
   * Un `false` ici interdit l'écriture quoi que dise l'élection : c'est la
   * garde qui tient la promesse « un lecteur n'enregistre jamais » même si la
   * présence d'un autre pair est absente, corrompue ou mensongère.
   */
  localCanWrite: boolean;
  /**
   * La salle est-elle stabilisée ? Faux tant que le rejeu du relais n'est pas
   * terminé, ou tant que la présence n'a pas eu le temps d'arriver. Écrire
   * avant, c'est écrire à N responsables.
   */
  settled: boolean;
}

/** Sommes-nous LE pair qui enregistre ? La seule question que pose l'éditeur. */
export function isSaveResponsible(input: SaveResponsibilityInput): boolean {
  if (!input.localCanWrite) return false;
  if (!input.settled) return false;
  return electSaveResponsible(input.candidates) === input.localClientId;
}

/**
 * Délai de stabilisation de la présence après un changement de composition.
 *
 * Une salle qui vient de perdre son responsable, ou qui vient d'accueillir un
 * pair, ne doit pas déclencher d'écriture dans la seconde : les présences
 * arrivent en ordre dispersé, et le vainqueur pourrait changer deux fois. On
 * laisse la liste se poser — c'est du confort, pas de la correction : la garde
 * de version reste derrière.
 */
export const SAVE_ELECTION_SETTLE_MS = 2_500;
