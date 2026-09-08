/**
 * LE TAMPON D'UN FIL — « n ouverts », SANS TÉLÉCHARGER LE FIL.
 *
 * ── LE DÉFAUT QUE CE MODULE FERME ───────────────────────────────────────────
 *
 * Le bureau compte les commentaires ouverts DANS le panneau
 * (`VaultCommentsPanel` : `view.roots.filter((c) => !c.resolved).length`), une
 * fois le fil déchiffré et posé à l'écran. Il peut se le permettre : le panneau
 * n'apparaît qu'à côté d'un aperçu déjà ouvert.
 *
 * Une LISTE, elle, n'ouvre rien. Afficher « 3 ouverts » sur trente lignes
 * imposerait trente déchiffrements de sidecars. Le téléphone a donc posé un
 * TAMPON dans la méta — `meta.threadStats` — à chaque écriture de fil, et lit
 * sa pastille dans ce que la liste tient déjà (`encryptedMeta` est déchiffré au
 * chargement, sans un octet de plus).
 *
 * Et le bureau, lui, PÉRIMAIT ce tampon sans le savoir : `saveFileThread`
 * repart de `{ ...existing.meta }` et le recopiait tel quel, écriture après
 * écriture. Le chiffre restait celui du jour où un téléphone avait écrit, et
 * rien ne le signalait. C'est corrigé ici : le bureau POSE le tampon comme le
 * mobile, et la lecture retombe sur « on ne sait pas » plutôt que sur un
 * chiffre faux.
 *
 * ── LE TAMPON N'EST PAS LA VÉRITÉ, IL EN EST LE RÉSUMÉ ──────────────────────
 *
 * La vérité reste le contenu du fil, que le panneau recalcule à l'ouverture.
 *
 * ── TROIS FAITS QUI EMPÊCHENT DE MENTIR ─────────────────────────────────────
 *
 *   1. UN FIL SANS TAMPON (écrit par une version qui l'ignore) ⇒ `exact: false`
 *      — on sait qu'un fil EXISTE, on ne prétend pas savoir combien. La
 *      pastille se dessine sans nombre.
 *   2. UN TAMPON PÉRIMÉ ⇒ on le compare à la date de mise à jour du PORTEUR.
 *      Si le porteur a bougé après le tampon, le compte n'est plus garanti :
 *      `exact` retombe à faux.
 *   3. UN FIL VIDE N'EST PAS UN FIL : `total === 0` ⇒ pas de pastille du tout,
 *      et la clé est RETIRÉE de la méta plutôt qu'écrite à zéro (la méta est
 *      bornée, et un `{open:0,total:0}` traînant est un fil fantôme que rien ne
 *      nettoie).
 *
 * Format IDENTIQUE À CELUI DU MOBILE
 * (`filarr-mobile/src/services/vaults/sharing/threadBadge.ts`), au nom de clé
 * et au champ près : les deux applications lisent le même tampon.
 *
 * MODULE PUR : aucun réseau, aucun chiffrement, aucun React.
 */

import { THREAD_FOR_META } from './fileThread';
import { visibleComments, type VaultComment } from './vaultComments';

/** La clé de méta qui porte le résumé d'un fil. */
export const THREAD_STATS_META = 'threadStats';

/**
 * Le résumé d'un fil, tel qu'il voyage dans la méta chiffrée.
 *
 * `at` est l'horodatage du DERNIER commentaire vivant (ISO 8601), pas celui de
 * l'écriture : c'est ce que la ligne affiche (« dernier il y a 20 min »), et
 * une date d'écriture bougerait à chaque résolution sans qu'un mot ait été dit.
 */
export interface ThreadStamp {
  /** Racines NON résolues — le même compte que le panneau. */
  open: number;
  /** Commentaires vivants, réponses comprises. `0` ⇒ il n'y a pas de fil. */
  total: number;
  /** ISO 8601 du dernier commentaire vivant, ou `null` si le fil est vide. */
  at: string | null;
}

/**
 * Le tampon d'une carte de commentaires.
 *
 * `open` COMPTE LES RACINES, PAS LES RÉPONSES — c'est exactement le compte que
 * `VaultCommentsPanel` affiche. Compter les réponses ferait dire « 7 ouverts »
 * à la liste là où le panneau annonce « 2 » pour le même fil.
 */
export function threadStampOf(comments: Record<string, VaultComment>): ThreadStamp {
  const view = visibleComments(comments);
  const alive = [...view.roots, ...[...view.repliesByParent.values()].flat()];
  let at: string | null = null;
  for (const c of alive) if (at === null || c.createdAt > at) at = c.createdAt;
  return {
    open: view.roots.filter((c) => !c.resolved).length,
    total: alive.length,
    at,
  };
}

/**
 * Le tampon rangé dans une méta, ASSAINI — `null` si absent ou inexploitable.
 *
 * Un tampon vient d'octets déchiffrés qu'un autre client a écrits : il se
 * valide champ par champ, comme un commentaire. Un nombre négatif ou un
 * `open > total` est REFUSÉ EN BLOC plutôt que corrigé — une pastille tirée
 * d'une donnée incohérente vaut moins que pas de pastille.
 */
export function readThreadStamp(meta: Record<string, unknown> | undefined): ThreadStamp | null {
  const raw = meta?.[THREAD_STATS_META];
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const { open, total } = r;
  if (typeof open !== 'number' || typeof total !== 'number') return null;
  if (!Number.isInteger(open) || !Number.isInteger(total)) return null;
  if (open < 0 || total < 0 || open > total) return null;
  return { open, total, at: typeof r.at === 'string' && r.at ? r.at : null };
}

/**
 * La méta AVEC le tampon — jamais une mutation sur place.
 *
 * Un fil VIDE retire la clé : voir l'en-tête.
 */
export function writeThreadStamp<M extends Record<string, unknown>>(
  meta: M,
  stamp: ThreadStamp
): M {
  const next = { ...meta } as Record<string, unknown>;
  if (stamp.total === 0) delete next[THREAD_STATS_META];
  else next[THREAD_STATS_META] = { open: stamp.open, total: stamp.total, at: stamp.at };
  return next as M;
}

/** Le raccourci de l'écriture : la méta d'origine, tamponnée par le fil. */
export function metaWithThreadStamp<M extends Record<string, unknown>>(
  meta: M,
  comments: Record<string, VaultComment>
): M {
  return writeThreadStamp(meta, threadStampOf(comments));
}

/** Ce qu'il faut savoir d'un élément pour en tirer une pastille. */
export interface ThreadBadgeSource {
  id: string;
  meta: Record<string, unknown>;
  /** ISO 8601 — l'autorité de fraîcheur quand le tampon manque ou a vieilli. */
  updatedAt: string;
}

/**
 * Ce que la ligne dessine.
 *
 * `exact` DÉCIDE DE L'AFFICHAGE DU NOMBRE, et c'est le seul champ qui compte
 * vraiment : à faux, la ligne montre qu'une discussion existe sans avancer de
 * chiffre. Mieux vaut une pastille muette qu'un « 3 ouverts » démenti à
 * l'ouverture du fil.
 */
export interface ThreadBadge {
  /** L'élément COMMENTÉ (le fichier ou la note), jamais le sidecar. */
  itemId: string;
  open: number;
  total: number;
  /** ISO 8601 du dernier message connu — le tampon d'abord, sinon l'élément. */
  at: string | null;
  exact: boolean;
}

/**
 * Un tampon est-il encore digne de foi ?
 *
 * Il l'est tant que le porteur du fil n'a pas été réécrit APRÈS lui. Un porteur
 * mis à jour par un client qui ignore `threadStats` garde l'ancien tampon : sa
 * date de mise à jour est alors POSTÉRIEURE au dernier commentaire que le
 * tampon connaît, et c'est ce signal-là qu'on lit.
 *
 * TOLÉRANCE D'UNE MINUTE : l'écriture qui pose le tampon met elle-même à jour
 * l'élément, une fraction de seconde après le commentaire, et les horloges de
 * deux appareils ne sont jamais exactement d'accord. Sans marge, chaque fil
 * fraîchement écrit se déclarerait périmé. Même valeur que le mobile.
 */
export function stampStillTrusted(stamp: ThreadStamp, carrierUpdatedAt: string): boolean {
  if (stamp.at === null) return true;
  const stamped = Date.parse(stamp.at);
  const updated = Date.parse(carrierUpdatedAt);
  if (Number.isNaN(stamped) || Number.isNaN(updated)) return true;
  return updated - stamped <= 60_000;
}

function badgeFrom(itemId: string, carrier: ThreadBadgeSource): ThreadBadge | null {
  const stamp = readThreadStamp(carrier.meta);
  if (!stamp) {
    // Un porteur SANS tampon : on sait qu'un fil existe (le sidecar n'existe
    // que pour ça), on ne sait pas ce qu'il contient.
    return { itemId, open: 0, total: 0, at: carrier.updatedAt, exact: false };
  }
  if (stamp.total === 0) return null;
  const trusted = stampStillTrusted(stamp, carrier.updatedAt);
  return {
    itemId,
    open: stamp.open,
    total: stamp.total,
    at: trusted ? stamp.at : carrier.updatedAt,
    exact: trusted,
  };
}

/**
 * Les pastilles de TOUTE une liste, indexées par élément commenté.
 *
 * Deux porteurs, parce que deux transports :
 *   · un FICHIER est commenté par un sidecar (`meta.threadFor`) — c'est le
 *     SIDECAR qui porte le tampon, et la clé de la carte est le FICHIER ;
 *   · une NOTE porte son fil dans son propre corps — c'est donc SA méta qui
 *     porte le tampon.
 *
 * UN SIDECAR ORPHELIN NE PRODUIT RIEN : son fichier a été purgé, la ligne
 * n'existe plus, et la pastille n'aurait rien à décorer.
 */
export function threadBadges(items: readonly ThreadBadgeSource[]): Map<string, ThreadBadge> {
  const known = new Set(items.map((i) => i.id));
  const out = new Map<string, ThreadBadge>();
  for (const item of items) {
    const threadFor = item.meta[THREAD_FOR_META];
    if (typeof threadFor === 'string') {
      if (!known.has(threadFor)) continue;
      const badge = badgeFrom(threadFor, item);
      if (badge) out.set(threadFor, badge);
      continue;
    }
    // Une note ne porte un tampon que si elle a déjà été commentée ; sans
    // tampon, rien ne la distingue d'une note sans fil, et on n'invente pas
    // de pastille.
    const stamp = readThreadStamp(item.meta);
    if (!stamp || stamp.total === 0) continue;
    const badge = badgeFrom(item.id, item);
    if (badge) out.set(item.id, badge);
  }
  return out;
}

/** La pastille d'UN élément, ou `null`. */
export function threadBadgeFor(
  items: readonly ThreadBadgeSource[],
  itemId: string
): ThreadBadge | null {
  return threadBadges(items).get(itemId) ?? null;
}

/**
 * La clé de phrase de l'info-bulle — trois états, trois phrases, jamais une
 * concaténation.
 *
 * « 3 commentaires ouverts », « tout est résolu » et « une discussion existe »
 * ne se disent pas avec le même squelette : les fabriquer par interpolation
 * donnerait « 0 commentaires ouverts », qui est une phrase que personne
 * n'écrit.
 */
export function threadBadgeKey(badge: ThreadBadge | null): string {
  if (!badge) return 'teamVaults.comments.threadNone';
  if (!badge.exact) return 'teamVaults.comments.threadUnknown';
  return badge.open > 0 ? 'teamVaults.comments.threadOpen' : 'teamVaults.comments.threadResolved';
}
