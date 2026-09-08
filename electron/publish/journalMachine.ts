/**
 * La MACHINE À ÉTATS de la migration, et les deux décisions qui protègent les
 * données : « puis-je basculer ? » et « que faire au redémarrage ? ».
 *
 * TOUT EST PUR ICI. Ce module ne lit ni n'écrit rien : il prend un journal et
 * rend un verdict. C'est délibéré — la règle qui décide d'abandonner la clé
 * d'un coffre doit être testable sans process principal, sans disque, et sans
 * qu'un mock puisse la contourner.
 */

import type { PublishJournal, PublishState } from './types';

// ── Transitions légales ─────────────────────────────────────────────────────

/**
 * Le graphe, en entier. Ce qui n'y figure pas est refusé.
 *
 * LA CLAUSE QUI COMPTE : `PUBLISHING` ne mène PAS à `DONE`. Il n'existe aucun
 * chemin de la publication à la fin qui ne passe pas par `VERIFYING` puis
 * `SWITCHING` — autrement dit, aucune bascule sans preuve. C'est [R1], et c'est
 * verrouillé ici plutôt que dans l'orchestrateur, parce qu'un orchestrateur se
 * réécrit et qu'une table se relit.
 *
 * `PUBLISHING → READY` est la PAUSE (« Interrompre »), pas l'abandon : rien
 * n'est nettoyé, tout se reprend d'un bouton.
 * `VERIFYING → PUBLISHING` est la republication unique d'un élément échantillonné
 * dont le hachage a divergé (§6.3).
 * `SWITCHING → PUBLISHING` est le RETOUR EN ARRIÈRE d'avant le pivot.
 */
const LEGAL_TRANSITIONS: Readonly<Record<PublishState, readonly PublishState[]>> = {
  PREPARING: ['READY', 'FAILED', 'ABANDONED'],
  READY: ['PREPARING', 'PUBLISHING', 'FAILED', 'ABANDONED'],
  PUBLISHING: ['VERIFYING', 'READY', 'FAILED', 'ABANDONED'],
  VERIFYING: ['SWITCHING', 'PUBLISHING', 'FAILED', 'ABANDONED'],
  SWITCHING: ['DONE', 'PUBLISHING', 'FAILED'],
  DONE: [],
  FAILED: ['PUBLISHING', 'VERIFYING', 'ABANDONED'],
  ABANDONED: [],
};

export function canTransition(from: PublishState, to: PublishState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Lève sur une transition illégale. On lève au lieu de rendre `false` :
 * l'appelant qui l'ignorerait ferait exactement le geste qu'on veut interdire.
 */
export function assertTransition(from: PublishState, to: PublishState): void {
  if (!canTransition(from, to)) {
    throw new Error(`[publish] Transition interdite ${from} -> ${to}`);
  }
}

// ── Les trois verrous de la bascule ─────────────────────────────────────────

export type SwitchRefusal =
  | 'items-incomplete'
  | 'blockers'
  | 'verify-failed'
  | 'verify-not-run'
  | 'bad-state';

export type SwitchVerdict = { ok: true } | { ok: false; reason: SwitchRefusal };

/**
 * La bascule est-elle autorisée ?
 *
 * Trois verrous, tous nécessaires — chacun ferme une manière DIFFÉRENTE de
 * perdre des données :
 *
 *  1. tout élément est traité (`done` + `damaged` == total). Un élément resté
 *     en attente, c'est un élément qui n'existe QUE sous l'ancienne clé ;
 *     abandonner la clé le condamnerait.
 *  2. aucun blocage (`blockers`). Un fichier trop volumineux est parfaitement
 *     lisible aujourd'hui : le détruire par une bascule serait détruire ce que
 *     l'utilisateur peut ouvrir sous ses yeux.
 *  3. aucune preuve en échec (`verify.failed`). On ne bascule pas sur un
 *     manifeste qu'on ne reconnaît pas.
 *
 * Et un quatrième, implicite mais réel : la preuve doit avoir COURU. Un plan
 * de vérification vide alors qu'il reste des éléments montés signifierait
 * qu'on n'a rien constaté du tout — c'est le cas « supposé » que [R1]
 * interdit précisément.
 */
export function canSwitch(journal: PublishJournal): SwitchVerdict {
  if (journal.state !== 'VERIFYING' && journal.state !== 'SWITCHING') {
    return { ok: false, reason: 'bad-state' };
  }
  const { doneItems, damagedItems, totalItems } = journal.counters;
  if (doneItems + damagedItems < totalItems) {
    return { ok: false, reason: 'items-incomplete' };
  }
  if (journal.blockers.length > 0) {
    return { ok: false, reason: 'blockers' };
  }
  if (journal.verify.failed.length > 0) {
    return { ok: false, reason: 'verify-failed' };
  }
  if (journal.verify.plan.length > 0 && journal.verify.ok < journal.verify.plan.length) {
    return { ok: false, reason: 'verify-not-run' };
  }
  if (journal.verify.plan.length === 0 && doneItems > 0) {
    return { ok: false, reason: 'verify-not-run' };
  }
  return { ok: true };
}

// ── Reprise après une mort de l'application ─────────────────────────────────

export type ResumeAction =
  | 'none'
  | 'rebuild-inventory'
  | 'resume-publish'
  | 'restart-verify'
  | 'resume-switch'
  | 'purge-receipt'
  | 'keep-receipt'
  | 'show-failed'
  | 'resume-cleanup'
  | 'abandon-foreign-account';

/** Sept jours : le reçu est consultable, puis il disparaît de lui-même. */
export const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Le reçu d'une migration terminée a-t-il fait son temps ? Sans cette borne,
 * un journal `DONE` deviendrait un déchet permanent dans `FilarData/`.
 */
export function isReceiptExpired(journal: PublishJournal, nowMs: number): boolean {
  const stamp = Date.parse(journal.doneAt ?? journal.updatedAt);
  if (!Number.isFinite(stamp)) return true;
  return nowMs - stamp >= RECEIPT_TTL_MS;
}

/**
 * Que faire au démarrage, AVANT tout déverrouillage de coffre ?
 *
 * C'est le journal qui dit s'il faut reprendre, et la reprise décide de la
 * clé : lire cet état après avoir chargé une clé serait lire trop tard.
 *
 * Une migration ouverte pour un AUTRE compte est traitée comme abandonnée, sans
 * discussion : on ne publie rien chez quelqu'un d'autre, et le contenu monté
 * là-bas n'est pas le nôtre à finir.
 */
export function decideResume(
  journal: PublishJournal | null,
  currentAccountUserId: string | null,
  nowMs: number
): { action: ResumeAction; nextState?: PublishState } {
  if (!journal) return { action: 'none' };

  if (journal.state !== 'DONE' && journal.accountUserId && currentAccountUserId) {
    if (journal.accountUserId !== currentAccountUserId) {
      return { action: 'abandon-foreign-account', nextState: 'ABANDONED' };
    }
  }

  switch (journal.state) {
    case 'PREPARING':
    case 'READY':
      // Rien n'a été monté (PREPARING), ou le coffre a pu changer depuis
      // (READY). Reconstruire coûte peu ; hériter d'un inventaire partiel
      // coûterait un profil oublié, donc une bascule destructrice.
      return { action: 'rebuild-inventory', nextState: 'PREPARING' };

    case 'PUBLISHING':
      return { action: 'resume-publish', nextState: 'PUBLISHING' };

    case 'VERIFYING':
      // On recommence la preuve depuis zéro : elle est en lecture seule, bornée,
      // et son plan est déterministe. Raisonner sur une preuve à moitié faite
      // coûterait plus cher que la refaire — et vaudrait moins.
      return { action: 'restart-verify', nextState: 'VERIFYING' };

    case 'SWITCHING':
      return { action: 'resume-switch', nextState: 'SWITCHING' };

    case 'DONE':
      return isReceiptExpired(journal, nowMs)
        ? { action: 'purge-receipt' }
        : { action: 'keep-receipt' };

    case 'FAILED':
      return { action: 'show-failed', nextState: 'FAILED' };

    case 'ABANDONED':
      return { action: 'resume-cleanup', nextState: 'ABANDONED' };
  }
}

// ── La reprise de la BASCULE — la seule décision non triviale ───────────────

export type SwitchResumeAction = 'rollback' | 'forward' | 'promote-from-root' | 'fail';

/**
 * Reprise en `SWITCHING`. La règle est décidée par `switch.staged`, et par RIEN
 * D'AUTRE — surtout pas par ce qu'on trouve sur le disque.
 *
 *  - `staged === false` → RETOUR EN ARRIÈRE. La promotion (S4) est APRÈS le
 *    pivot (S3) : aucune n'a pu commencer, la clé active n'a pas bougé. On
 *    supprime les `*.next` et le coffre se retrouve exactement dans son état
 *    antérieur.
 *  - `staged === true` → MARCHE AVANT, inconditionnelle et idempotente. Chaque
 *    emplacement est réécrit depuis le MÊME matériel entrant : un ensemble à
 *    moitié promu converge, et l'opération se répète sans dommage.
 *  - `staged === true` mais la clé entrante a disparu (trousseau purgé par
 *    l'OS, déconnexion concurrente) : la RACINE fait autorité. Si elle porte
 *    déjà la nouvelle clé, on réécrit tout depuis elle ; si elle porte encore
 *    l'ancienne, on s'arrête en `FAILED` et RIEN n'est promu — l'ancienne clé
 *    reste partout et le coffre fonctionne.
 */
export function decideSwitchResume(params: {
  staged: boolean;
  incomingKeyPresent: boolean;
  /** VRAI quand `{racine}/wrapped_fek.json` porte déjà le matériel entrant. */
  rootHoldsIncoming: boolean;
}): SwitchResumeAction {
  if (!params.staged) return 'rollback';
  if (params.incomingKeyPresent) return 'forward';
  return params.rootHoldsIncoming ? 'promote-from-root' : 'fail';
}

// ── Suspension du cycle ordinaire ───────────────────────────────────────────

/**
 * Le cycle ordinaire de synchronisation doit-il être suspendu pour cet état de
 * journal ?
 *
 * VRAI pour toute migration VIVANTE (`PREPARING` → `SWITCHING`, `FAILED`
 * compris : un `FAILED` attend une reprise, pas un enterrement). FAUX pour les
 * deux états terminaux : après `DONE` le cycle reprend sous la clé promue, et
 * après `ABANDONED` le seul travail restant est le ménage distant du profil
 * CIBLE — suspendre le cycle pendant ses heures de suppressions au
 * compte-gouttes (120 appels / 300 s) le priverait de synchronisation sans
 * protéger quoi que ce soit.
 *
 * Le drapeau lui-même vit dans `syncService` (`setPublishSuspended`) ; cette
 * fonction est la TABLE DE DÉCISION qui dit quand le poser. Elle existe en
 * module pur pour être testable — et parce que la panne constatée sur mobile
 * était précisément une table écrite puis jamais consultée : le cycle a tourné
 * en pleine migration et la découverte de profils a adopté les profils cibles
 * en douce. `resumeOnStartup` DOIT la consulter sur chaque chemin qui rend la
 * main avec un journal encore présent.
 */
export function isOrdinarySyncSuspended(state: PublishState): boolean {
  return state !== 'DONE' && state !== 'ABANDONED';
}

// ── Fabrique de journal ─────────────────────────────────────────────────────

export function createJournal(params: {
  migrationId: string;
  accountUserId: string;
  accountKeyDigest: string;
  wrappedDigest: string;
  now: string;
}): PublishJournal {
  return {
    schema: 1,
    migrationId: params.migrationId,
    state: 'PREPARING',
    startedAt: params.now,
    updatedAt: params.now,
    accountUserId: params.accountUserId,
    accountKeyDigest: params.accountKeyDigest,
    wrappedDigest: params.wrappedDigest,
    targetProfiles: [],
    abandonedProfiles: [],
    blockers: [],
    counters: {
      totalItems: 0,
      doneItems: 0,
      damagedItems: 0,
      totalBytes: 0,
      doneBytes: 0,
    },
    verify: { plan: [], ok: 0, failed: [], full: false },
    switch: { plannedAt: null, staged: false, promoted: [] },
    cleanup: { pendingDeletes: 0, lastAttemptAt: null },
    lastError: null,
  };
}

/**
 * Le seuil de corruption massive.
 *
 * Un élément abîmé isolé ne condamne rien — il était déjà perdu. Mais au-delà
 * de 5 % ou de 50 éléments, l'hypothèse « des octets sont abîmés » devient
 * moins probable que l'hypothèse « la clé active n'est pas celle qu'on croit ».
 * Poursuivre transformerait alors un problème de clé en perte de coffre, donc
 * on s'arrête.
 */
export function exceedsDamageThreshold(damagedItems: number, totalItems: number): boolean {
  if (damagedItems > 50) return true;
  if (totalItems <= 0) return false;
  return damagedItems / totalItems > 0.05;
}
