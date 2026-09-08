/**
 * Le BALAYAGE DES INTENTIONS — ce qui remplace le second geste de l'hôte.
 *
 * POURQUOI CE MODULE EXISTE. Donner accès à un coffre partagé demandait deux
 * gestes humains séparés par une attente qu'aucun écran ne nommait : inviter la
 * personne dans l'espace, puis — plus tard, quand elle a accepté et publié sa
 * clé — revenir la choisir dans un sélecteur pour lui sceller K_vault. Rien ne
 * rappelait le second. Ici, l'app de l'hôte le fait d'elle-même.
 *
 * LES DEUX TEMPS RESTENT DEUX TEMPS, ET C'EST IRRÉDUCTIBLE. K_vault se scelle à
 * une clé publique ; un compte qui n'existe pas encore n'en a pas. Ce qui
 * disparaît, ce n'est pas l'attente — c'est l'obligation qu'un humain s'en
 * souvienne.
 *
 * CE QUI N'EST JAMAIS AUTOMATISÉ : la VÉRIFICATION DE CLÉ. Un scellement se fait
 * à une clé confrontée au journal de transparence, et trois verdicts sur six
 * disent « quelqu'un a peut-être substitué cette clé ». Les automatiser
 * reviendrait à transformer un scellement vérifié en scellement de confiance —
 * exactement ce que la transparence existe pour refuser. Ces cas-là REMONTENT à
 * l'hôte au lieu d'être exécutés, et le sélecteur manuel reste leur chemin.
 *
 * TESTABLE PAR CONSTRUCTION : tous les effets de bord entrent en paramètres. Ce
 * que ce fichier contient, ce sont des DÉCISIONS — quand on a le droit de
 * sceller sans demander — et se tromper là ne coûte pas un pixel.
 */

import type { PeerKeyStatus } from './keyTransparency';
import type { PendingGrantDTO } from './vaultApi';

/**
 * Les verdicts de transparence sous lesquels un scellement AUTOMATIQUE est
 * légitime.
 *
 * `ok` : chaîne valide, clé servie identique à celle épinglée. `first_seen` et
 * `no_log` : première rencontre — c'est exactement ce que fait le sélecteur
 * manuel, qui n'exige aucune confirmation pour un pair jamais vu (il n'y a rien
 * à comparer). Automatiser ne baisse donc AUCUNE garde ici ; ça reproduit la
 * même, sans l'attente.
 *
 * Tout le reste — `changed`, `served_not_latest`, `tampered_log` — demande un
 * humain, et le demande VRAIMENT : le sélecteur manuel bloque les deux derniers
 * et exige une confirmation hors bande pour le premier.
 */
const AUTO_SEALABLE: ReadonlySet<PeerKeyStatus> = new Set<PeerKeyStatus>([
  'ok',
  'first_seen',
  'no_log',
]);

export function mayAutoSeal(status: PeerKeyStatus | null | undefined): boolean {
  return !!status && AUTO_SEALABLE.has(status);
}

/** Les coffres où l'on a le droit de faire entrer quelqu'un. */
export function canGrantIn(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/** Une personne à qui l'accès vient d'être accordé, sans que l'hôte ait rien fait. */
export interface GrantedEntry {
  vaultId: string;
  email: string;
}

/**
 * Une personne que le balayage a REFUSÉ de servir tout seul, et pourquoi.
 *
 * `reason` n'est pas décoratif : c'est ce qui décide de la phrase à l'écran.
 * `key_unverified` réclame une comparaison hors bande, `no_key` ne réclame rien
 * du tout — la personne n'a simplement pas encore ouvert l'application — et
 * `seal_failed` est une panne qui se retentera au prochain passage.
 *
 * `userId` EST PORTÉ, et il n'est pas décoratif non plus. Sans lui, la fiche
 * « Où en est l'accès de X ? » ne pouvait ni lancer la cérémonie de clé (qui
 * s'adresse à un compte, pas à une adresse) ni retirer l'entrée après un
 * scellement manuel : la pastille survivait à sa propre cause jusqu'au prochain
 * déverrouillage.
 */
export interface BlockedEntry {
  vaultId: string;
  email: string;
  /** Le compte visé — celui dont la clé se vérifie et à qui K_vault se scelle. */
  userId: string;
  reason: 'key_unverified' | 'no_key' | 'seal_failed';
}

/**
 * Les refus qui disent que LA PROMESSE EST DÉJÀ TENUE, par un autre chemin.
 *
 * `already_member` : quelqu'un (l'hôte à la main, un autre appareil, un
 * balayage concurrent) a fait entrer la personne entre-temps. `already_invited`
 * : une invitation de coffre valide est dehors et porte le même scellé. Dans les
 * deux cas il n'y a plus rien à faire, et l'ancien message — « Filarr réessaiera
 * la prochaine fois » — décrivait une attente qui n'existe pas : il faisait
 * passer un succès pour une panne, indéfiniment, puisque chaque passage suivant
 * reproduisait le même refus. L'entrée est donc RETIRÉE : ni accordée (aucun
 * e-mail n'est parti, il n'y a rien à annoncer), ni bloquée.
 */
const ALREADY_SERVED: ReadonlySet<string> = new Set(['already_member', 'already_invited']);

export interface SweepResult {
  granted: GrantedEntry[];
  blocked: BlockedEntry[];
}

/** La clé servie pour un pair, telle que le scellement l'exige. */
export interface VerifiedPeer {
  status: PeerKeyStatus;
  /** Passée TELLE QUELLE au scellement : re-la chercher rouvrirait un TOCTOU. */
  peerKey: unknown;
}

/** Tout ce que le balayage fait AILLEURS qu'en lui-même. */
export interface SweepDeps {
  /** Les intentions mûres pour ce coffre. Une lecture qui échoue rend []. */
  listGrants: (vaultId: string) => Promise<PendingGrantDTO[]>;
  /**
   * Récupère la clé servie du pair ET la confronte à son journal. `null` quand
   * la clé est introuvable — un compte sans clé publiée, ce qui n'est pas une
   * erreur.
   */
  verify: (userId: string) => Promise<VerifiedPeer | null>;
  /**
   * Scelle K_vault et FAIT ENTRER la personne. Rend le code du refus, ou `null`.
   *
   * Depuis F06 c'est un AJOUT DIRECT, plus l'émission d'une invitation : une
   * intention mûre veut dire que la personne est déjà active dans l'espace de
   * l'hôte, et lui envoyer un jeton à sept jours n'ajoutait qu'une chose de plus
   * qui pouvait expirer. Ce module ne s'en aperçoit pas — c'est bien le sujet :
   * la DÉCISION de sceller (les verdicts de transparence) ne change pas d'un
   * cran, seul le chemin d'écriture change, et il vit chez l'appelant.
   */
  seal: (args: {
    vaultId: string;
    grant: PendingGrantDTO;
    peerKey: unknown;
  }) => Promise<string | null>;
}

/** Un coffre candidat, réduit à ce dont la décision dépend. */
export interface SweepCandidate {
  id: string;
  role: string;
  /** Seul un coffre DÉVERROUILLÉ porte K_vault en mémoire : sans elle, rien à sceller. */
  unlocked: boolean;
}

/**
 * Passe sur les coffres et scelle tout ce qui peut l'être.
 *
 * SÉQUENTIEL, ET DÉLIBÉRÉMENT. Chaque scellement est une écriture facturable
 * (un e-mail part) : les lancer tous de front sur une liste inconnue ferait un
 * pic de requêtes contre les seaux du Worker, et un refus `rate_limited` au
 * milieu laisserait la moitié des promesses non tenues, sans trace de laquelle.
 *
 * NE JETTE JAMAIS. Le balayage est un confort greffé sur le chargement des
 * coffres ; une exception ici ferait échouer un écran qui, lui, marche.
 */
export async function runGrantSweep(
  candidates: SweepCandidate[],
  deps: SweepDeps
): Promise<SweepResult> {
  const granted: GrantedEntry[] = [];
  const blocked: BlockedEntry[] = [];

  for (const vault of candidates) {
    if (!canGrantIn(vault.role) || !vault.unlocked) continue;

    let grants: PendingGrantDTO[];
    try {
      grants = await deps.listGrants(vault.id);
    } catch {
      continue; // ce coffre-ci ne dira rien aujourd'hui ; les autres, si
    }

    for (const grant of grants) {
      // Le serveur l'a déjà dit, mais l'épargne d'un aller-retour compte : c'est
      // le cas le PLUS fréquent au début (l'invitée a accepté par le lien mais
      // n'a pas encore ouvert l'application).
      const who = { vaultId: vault.id, email: grant.email, userId: grant.userId };
      if (!grant.hasKey) {
        blocked.push({ ...who, reason: 'no_key' });
        continue;
      }

      let peer: VerifiedPeer | null;
      try {
        peer = await deps.verify(grant.userId);
      } catch {
        peer = null;
      }
      if (!peer) {
        blocked.push({ ...who, reason: 'no_key' });
        continue;
      }
      if (!mayAutoSeal(peer.status)) {
        // Une clé qui a CHANGÉ, ou que le serveur ne sert pas telle que le
        // journal la porte. On ne scelle pas dans le dos de l'hôte : on le lui
        // dit, et le sélecteur manuel — qui sait montrer l'empreinte et demander
        // une confirmation hors bande — reprend la main.
        blocked.push({ ...who, reason: 'key_unverified' });
        continue;
      }

      let failure: string | null;
      try {
        failure = await deps.seal({ vaultId: vault.id, grant, peerKey: peer.peerKey });
      } catch {
        failure = 'seal_failed';
      }
      if (failure) {
        // « Déjà membre » / « déjà invitée » ne sont pas des pannes : voir
        // ALREADY_SERVED. L'entrée disparaît au lieu de promettre une reprise
        // qui ne pourrait que se refaire refuser.
        if (!ALREADY_SERVED.has(failure)) {
          blocked.push({ ...who, reason: 'seal_failed' });
        }
        continue;
      }
      granted.push({ vaultId: vault.id, email: grant.email });
    }
  }

  return { granted, blocked };
}
