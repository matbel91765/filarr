/**
 * memberTrustModel (F11) — « à quel point suis-je sûr que c'est bien cette
 * personne ? », en une fonction pure.
 *
 * CE QUE LA COLONNE « CONFIANCE » DIT VRAIMENT. Le serveur est un COURTIER de
 * clés publiques : c'est lui qui répond quand l'application demande « quelle est
 * la clé de Bob ? ». Deux défenses se superposent — l'empreinte comparée hors
 * bande (de vive voix, l'autre bout lisant sa propre carte « Vous ») et le
 * journal de clés chaîné (`services/vault/keyTransparency`). Ce modèle ne fait
 * que TRADUIRE leurs réponses en un état affichable ; il n'a le droit d'en
 * inventer aucun.
 *
 * TROIS RÈGLES, ET CE SONT DES GARDE-FOUS :
 *
 *  1. UNE MARQUE NE VAUT QUE POUR L'EMPREINTE QU'ELLE NOMME. « J'ai comparé ce
 *     numéro » porte sur un numéro précis, à une date précise. Si la clé servie
 *     n'est plus celle-là, la marque est périmée : elle ne vaut plus
 *     vérification. C'est mot pour mot la règle de `confirmedFingerprints` dans
 *     la rotation — sans elle, une confirmation devient un interrupteur qui
 *     ouvre tout ce qui suivra.
 *  2. AUCUNE MARQUE LOCALE NE LÈVE UNE SUBSTITUTION. `tampered_log` (le journal
 *     ne recalcule pas) et `served_not_latest` (la clé servie n'est pas la
 *     dernière du journal) sont des preuves côté serveur ; une case cochée sur
 *     cet appareil ne les efface pas. Même règle qu'`isBlockedStatus` dans la
 *     cérémonie d'invitation.
 *  3. UNE ABSENCE D'INFORMATION N'EST PAS UN VERDICT. Pas encore contrôlé, ou
 *     contrôle en échec, valent « on ne sait pas » : ni « tout va bien », ni une
 *     alerte rouge. Peindre une ligne en rouge sur une panne de réseau apprend à
 *     ignorer le rouge.
 *
 * LES MARQUES RESTENT LOCALES, ET C'EST UNE DÉCISION DE SÉCURITÉ (§3 F11). Les
 * ranger dans le bloc chiffré du coffre les rendrait lisibles par tout membre et
 * ÉCRITURABLES par tout administrateur, sans aucune signature : n'importe quel
 * admin pourrait alors déclarer « vérifié » une clé qu'il vient de substituer.
 * Elles vivent donc dans le `localStorage` de cet appareil (voir
 * `services/vault/memberKeyWatch`), et l'écran dit « sur cet appareil ».
 *
 * PORTÉE, DITE HONNÊTEMENT. Chaîne de hachages légère + TOFU, pas un journal
 * Merkle audité (CONIKS) : le TOFU n'élimine pas un intercepteur présent dès le
 * PREMIER contact. Les textes de l'écran le disent ; ce modèle ne prétend rien
 * de plus.
 */

import type { PeerKeyStatus } from '../../../../services/vault/keyTransparency';

/**
 * Ce que le contrôle d'un membre a pu rendre. Deux valeurs s'ajoutent à celles
 * de `keyTransparency`, parce qu'elles ne viennent pas de la vérification
 * elle-même mais de l'appel qui la précède :
 *   · `no_key`     : le serveur n'a AUCUNE clé publique pour cette personne ;
 *   · `unreadable` : la lecture a échoué (réseau, 403 hors espace) — on ne sait
 *                    pas, et c'est différent de « rien à savoir ».
 */
export type MemberKeyStatus = PeerKeyStatus | 'no_key' | 'unreadable';

/** La trace locale d'une comparaison faite de vive voix. */
export interface TrustMark {
  fingerprint: string;
  /** L'instant de la comparaison (ms) — l'écran affiche « vérifié le … ». */
  at: number;
}

export interface MemberKeyFacts {
  /** Le verdict du dernier contrôle, ou `null` : pas encore contrôlé. */
  status: MemberKeyStatus | null;
  /** L'empreinte servie lors de ce contrôle (`null` si aucune / illisible). */
  served: string | null;
  /**
   * L'empreinte épinglée (TOFU) pour ce pair, si on en a déjà vu une. Elle
   * n'entre PAS dans le verdict — c'est `status` qui la porte déjà, calculé par
   * `checkPeerKeyTransparency` — mais elle donne au tiroir le numéro d'AVANT,
   * sans lequel un changement de clé ne se vérifie contre rien.
   */
  pinned: string | null;
  /** La marque locale « j'ai comparé ce numéro », si elle existe. */
  mark: TrustMark | null;
}

/** Les cinq états de la colonne. */
export type MemberTrustState = 'verified' | 'seen' | 'changed' | 'unpublished' | 'unknown';

/**
 * POURQUOI cet état — le badge tient en un mot, la phrase du tiroir a besoin du
 * détail, et deux causes très différentes (une clé qui tourne, un journal
 * réécrit) ne se disent pas pareil.
 */
export type MemberTrustReason =
  | 'verified_out_of_band'
  | 'stale_mark'
  | 'tofu_seen'
  | 'first_seen'
  | 'no_log'
  | 'fingerprint_changed'
  | 'chain_broken'
  | 'served_not_latest'
  | 'no_published_key'
  | 'not_checked'
  | 'unreadable';

export interface MemberTrustVerdict {
  state: MemberTrustState;
  reason: MemberTrustReason;
  /** La date de la marque, UNIQUEMENT quand elle vaut encore (`verified`). */
  verifiedAt: number | null;
  /**
   * Cette ligne doit-elle lever le bandeau rouge de la page et le point rouge
   * du bouton « Gérer » ? Seules les trois preuves d'un changement non acquitté
   * comptent — jamais une absence d'information.
   */
  alerts: boolean;
  /** L'empreinte servie, pour que le tiroir ait un numéro à montrer. */
  fingerprint: string | null;
  /**
   * L'empreinte qu'on avait épinglée, quand elle DIFFÈRE de celle servie — le
   * tiroir montre « avant » et « maintenant » côte à côte. Un changement de clé
   * annoncé sans le numéro d'avant ne se vérifie contre rien : la personne au
   * bout du fil ne peut confirmer que « oui, j'ai changé d'appareil » si elle
   * voit de quoi vers quoi.
   */
  previousFingerprint: string | null;
}

/** La marque nomme-t-elle l'empreinte qu'on vient de recevoir ? (règle 1) */
function markMatches(facts: MemberKeyFacts): boolean {
  if (!facts.mark) return false;
  // Sans empreinte servie, on ne peut RIEN confronter : une marque seule ne
  // prouve pas que la clé d'aujourd'hui est celle qu'on avait comparée.
  if (facts.served === null) return false;
  return facts.mark.fingerprint === facts.served;
}

function verdict(
  state: MemberTrustState,
  reason: MemberTrustReason,
  facts: MemberKeyFacts,
  extra?: { verifiedAt?: number; alerts?: boolean }
): MemberTrustVerdict {
  return {
    state,
    reason,
    verifiedAt: extra?.verifiedAt ?? null,
    alerts: extra?.alerts ?? false,
    fingerprint: facts.served,
    previousFingerprint:
      facts.pinned && facts.served && facts.pinned !== facts.served ? facts.pinned : null,
  };
}

/**
 * L'état d'un membre, à partir de ce que le contrôle a rendu et de ce que cet
 * appareil se souvient. L'ORDRE des cas est le modèle : les substitutions
 * d'abord (aucune marque ne les lève), l'absence d'information ensuite, la
 * marque en dernier.
 */
export function memberTrust(facts: MemberKeyFacts): MemberTrustVerdict {
  // — Les preuves de substitution : elles priment sur tout le reste (règle 2).
  if (facts.status === 'tampered_log') {
    return verdict('changed', 'chain_broken', facts, { alerts: true });
  }
  if (facts.status === 'served_not_latest') {
    return verdict('changed', 'served_not_latest', facts, { alerts: true });
  }

  // — Ce qu'on ne sait pas (règle 3).
  if (facts.status === null) return verdict('unknown', 'not_checked', facts);
  if (facts.status === 'unreadable') return verdict('unknown', 'unreadable', facts);
  if (facts.status === 'no_key') return verdict('unpublished', 'no_published_key', facts);

  // — La marque locale, qui ne vaut que pour l'empreinte qu'elle nomme (règle 1).
  //   Elle est consultée AVANT `changed` : la cérémonie pose la marque et
  //   ré-épingle dans le même geste, alors que le rapport en mémoire dit encore
  //   « changed » jusqu'au contrôle suivant. Sans cela, la ligne resterait rouge
  //   juste après qu'un humain vient de comparer le numéro.
  if (markMatches(facts)) {
    return verdict('verified', 'verified_out_of_band', facts, {
      verifiedAt: facts.mark?.at,
    });
  }

  if (facts.status === 'changed') {
    return verdict('changed', 'fingerprint_changed', facts, { alerts: true });
  }

  // — Vu, mais jamais comparé de vive voix. La marque périmée est DITE : c'est
  //   ce qui distingue « on n'a jamais vérifié » de « on avait vérifié, et la
  //   clé a tourné depuis ».
  if (facts.mark) return verdict('seen', 'stale_mark', facts);
  if (facts.status === 'first_seen') return verdict('seen', 'first_seen', facts);
  if (facts.status === 'no_log') return verdict('seen', 'no_log', facts);
  return verdict('seen', 'tofu_seen', facts);
}

/**
 * « N vérifiés sur M ». Ne compte que les VRAIES vérifications hors bande : un
 * « Vu » (TOFU) n'en est pas une, et les confondre transformerait « personne n'a
 * jamais comparé un numéro » en « tout le monde est vérifié ».
 */
export function trustCounter(verdicts: Readonly<Record<string, MemberTrustVerdict>>): {
  verified: number;
  total: number;
} {
  const rows = Object.values(verdicts);
  return {
    verified: rows.filter((v) => v.state === 'verified').length,
    total: rows.length,
  };
}

/**
 * Les membres qui alertent — la matière du bandeau rouge, du point rouge sur
 * « Gérer », et du filtre « Clé changée » de F09. Rendus dans l'ordre des clés,
 * pour que deux lectures successives nomment les mêmes gens dans le même ordre.
 */
export function alertingMembers(verdicts: Readonly<Record<string, MemberTrustVerdict>>): string[] {
  return Object.keys(verdicts).filter((id) => verdicts[id].alerts);
}

export default memberTrust;
