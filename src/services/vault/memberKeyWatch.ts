/**
 * memberKeyWatch (F11) — le contrôle des clés de TOUS les membres d'un coffre,
 * et la mémoire locale de ce qu'un humain a vérifié de vive voix.
 *
 * POURQUOI UN CONTRÔLE QUI NE SERT PAS UN GESTE. Jusqu'ici, la clé publique d'un
 * pair n'était confrontée à son journal qu'au MOMENT de lui sceller quelque
 * chose : une invitation, une rotation. Autrement dit, une substitution posée par
 * le courtier de clés restait invisible jusqu'au prochain partage — c'est-à-dire
 * peut-être jamais, et en tout cas pas avant que le mal soit fait. La page
 * « Gérer le coffre » regarde donc d'elle-même, à l'ouverture, et le dit avant
 * qu'on ait scellé quoi que ce soit.
 *
 * LE CONTRÔLE COÛTE DES LECTURES, DONC IL EST BORNÉ (§7, amplification de
 * lecture D1). Deux requêtes par membre — la clé servie, puis son journal — sur
 * un roster de deux cents personnes, à chaque ouverture de page, ferait quatre
 * cents lectures pour une information qui bouge une fois par an. D'où : des
 * PAGES de vingt, et un cache de VINGT-QUATRE HEURES par personne. Le cache est
 * un compromis assumé : une clé substituée après notre dernier contrôle reste
 * invisible jusqu'à un jour — bien moins longtemps qu'auparavant, où elle
 * l'était jusqu'au prochain partage.
 *
 * MAIS CE CACHE-LÀ NE VAUT QUE POUR UN CONTRÔLE QUI A ABOUTI. Un rapport
 * « illisible » (coupure, 500, 403) ou « pas de clé » n'a rien constaté ; lui
 * laisser la place des vingt-quatre heures reviendrait à ranger une ABSENCE
 * d'information à l'endroit d'un verdict — c'est-à-dire à rendre F11 aveugle
 * pour cette personne jusqu'au lendemain parce qu'une page a été ouverte hors
 * ligne. Ces rapports-là ne retiennent donc leur place que quelques minutes
 * (`KEY_WATCH_FAIL_TTL_MS`), et la prochaine ouverture de page regarde à
 * nouveau.
 *
 * LE CONTRÔLE ÉPINGLE, ET C'EST VOULU — MAIS SEULEMENT CE QUI N'ÉTAIT PAS
 * ÉPINGLÉ. `checkPeerKeyTransparency` pose la référence TOFU quand elle manque.
 * Passivement, donc : c'est ce qui donne un point de comparaison à la
 * substitution SUIVANTE ; sans cet épinglage-là, un courtier pourrait servir une
 * clé différente à chaque appel sans jamais rien déclencher. Ce que ce balayage
 * ne peut PAS faire, en revanche, c'est déplacer une référence existante : un
 * journal vide alors qu'une empreinte est déjà épinglée est traité comme une
 * TRONCATURE (un journal en ajout seul ne rétrécit pas), et rend « clé changée »
 * — pas « vu ». Cette garde vit dans `keyTransparency`, et c'est elle qui fait
 * qu'un contrôle de fond, répété à chaque ouverture de page et toutes les 24 h,
 * n'offre pas au courtier une façon de réinitialiser la base de comparaison en
 * cessant simplement de servir le journal.
 *
 * CE QUE CE MODULE RANGE SURVIT AU CHANGEMENT DE PROFIL, PAR CONVENTION. Les
 * trois clés (`filarr.kt.watch.`, `filarr.kt.verified.`, `filarr.kt.alerts.`)
 * restent dans le `localStorage` de l'appareil, comme l'épinglage TOFU
 * `filarr.kt.fp.` que personne n'efface non plus depuis toujours. Ce n'est pas
 * un oubli : une empreinte est le condensé d'une clé PUBLIQUE, et « j'ai comparé
 * ce numéro de vive voix » est une propriété de CET appareil, pas du profil qui
 * était ouvert ce jour-là. Les effacer ferait repartir la comparaison de zéro à
 * chaque changement de profil — c'est-à-dire perdre la mémoire qui sert
 * justement à repérer une substitution.
 *
 * LES MARQUES « VÉRIFIÉ » RESTENT LOCALES, ET C'EST UNE DÉCISION DE SÉCURITÉ.
 * Les ranger dans le bloc chiffré du coffre les rendrait lisibles par tout
 * membre et ÉCRITURABLES par tout administrateur, sans aucune signature : un
 * administrateur pourrait alors déclarer « vérifiée » une clé qu'il vient de
 * substituer, et l'écran de tous les autres le croirait. Elles vivent donc dans
 * le `localStorage` de CET appareil, sous
 * `filarr.kt.verified.<vaultId>.<userId>`, et l'écran dit « sur cet appareil ».
 * Elles ne satisfont jamais `needsConfirm` d'une cérémonie tenue ailleurs.
 *
 * CE MODULE NE DÉCIDE RIEN. Il lit, il range, il prévient ; le verdict affiché
 * (« vérifié / vu / clé changée / non publiée / inconnu ») est calculé par
 * `memberTrustModel`, qui est pur et éprouvé. C'est pour ça que le type des
 * statuts vient de LÀ-BAS : le vocabulaire appartient au modèle, pas au tuyau.
 */

import { apiGetKeyLog, apiGetMemberPublicKey } from './vaultApi';
import {
  checkPeerKeyTransparency,
  getTofuFingerprint,
  acceptPeerKeyChange,
} from './keyTransparency';
import type {
  MemberKeyStatus,
  TrustMark,
} from '../../renderer/components/vaults/settings/memberTrustModel';

/** Ce qu'un contrôle a trouvé pour une personne. */
export interface MemberKeyReport {
  userId: string;
  status: MemberKeyStatus;
  /** L'empreinte SERVIE — `null` quand il n'y a pas de clé, ou qu'on n'a pas lu. */
  fingerprint: string | null;
  /** L'épinglage TOFU tel que ce contrôle l'a laissé. */
  pinned: string | null;
  checkedAt: number;
}

// ── Les trois espaces de rangement ───────────────────────────────────────────
// Tous sous le préfixe `filarr.kt.`, celui de la transparence des clés.

/** Le dernier contrôle, par PERSONNE : une clé de compte est globale. */
const REPORT_PREFIX = 'filarr.kt.watch.';
/** La marque « comparé de vive voix », par COFFRE et par personne. */
const MARK_PREFIX = 'filarr.kt.verified.';
/** Ce que le point rouge de l'explorateur lit sans rien demander au réseau. */
const ALERT_PREFIX = 'filarr.kt.alerts.';

/** Vingt-quatre heures — voir l'en-tête pour ce que ce choix coûte. */
export const KEY_WATCH_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * CINQ MINUTES — la place que garde un contrôle QUI N'A PAS EU LIEU.
 *
 * `unreadable` et `no_key` ne disent rien de la clé de la personne : le premier
 * est une panne, le second l'absence de matière à comparer. C'est la règle 3 de
 * `memberTrustModel` — « une absence d'information n'est pas un verdict » — et
 * la mettre en cache pour un jour la traiterait précisément comme un verdict.
 * Une page ouverte hors ligne, ou un seul hoquet du réseau, suffirait alors à
 * ce qu'une substitution posée dans les heures qui suivent ne lève NI le
 * bandeau rouge de la page, NI le point rouge du bouton « Gérer », NI le filtre
 * « Clé changée » : exactement la détection pour laquelle F11 existe. Rien à
 * l'écran ne réclamerait « Revérifier » — un badge gris « Inconnu » parmi
 * d'autres ne se remarque pas.
 *
 * Cinq minutes, et pas zéro, parce qu'une panne DURABLE ne doit pas relancer
 * deux lectures par membre à chaque rendu de la page ; c'est le même compromis
 * que ci-dessus, mais dosé pour ce qu'il garde : rien.
 */
export const KEY_WATCH_FAIL_TTL_MS = 5 * 60 * 1000;
/** La taille d'une page de contrôle (§7 : « contrôle des clés par page »). */
export const KEY_WATCH_PAGE = 20;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Pas de `localStorage` (tests, contexte non navigateur) ou JSON abîmé : on
    // se comporte comme si on ne savait rien, ce qui est exact.
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* pas de localStorage : le contrôle vaut alors pour cette session */
  }
}

// ── L'abonnement : un écran qui affiche un point rouge doit le voir bouger ────

const listeners = new Set<() => void>();
/** Change à chaque écriture — la graine de `useSyncExternalStore`. */
let version = 0;

function notify(): void {
  version += 1;
  for (const l of listeners) l();
}

export function subscribeMemberKeyWatch(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function memberKeyWatchVersion(): number {
  return version;
}

// ── Les rapports ─────────────────────────────────────────────────────────────

/**
 * Le cache mémoire double le `localStorage` : la page relit ces rapports à
 * chaque rendu (une ligne de tableau par personne), et repasser par
 * `JSON.parse` à chaque fois pour vingt lignes n'apprendrait rien de plus.
 */
const reports = new Map<string, MemberKeyReport>();

export function getMemberKeyReport(userId: string): MemberKeyReport | null {
  const enMémoire = reports.get(userId);
  if (enMémoire) return enMémoire;
  const rangé = readJson<MemberKeyReport>(REPORT_PREFIX + userId);
  if (rangé) reports.set(userId, rangé);
  return rangé;
}

function putReport(report: MemberKeyReport): void {
  reports.set(report.userId, report);
  writeJson(REPORT_PREFIX + report.userId, report);
}

/**
 * Un contrôle qui n'a rien conclu — panne de lecture, ou personne sans clé
 * publiée. Il occupe la même case qu'un verdict, mais il n'en est pas un.
 */
function estNonConcluant(status: MemberKeyStatus): boolean {
  return status === 'unreadable' || status === 'no_key';
}

/**
 * Ce contrôle est-il assez frais pour qu'on s'épargne deux requêtes ?
 *
 * DEUX DURÉES, ET C'EST LE GARDE-FOU. Un contrôle ABOUTI tient la journée (la
 * lecture a eu lieu, la clé a été confrontée à son journal) ; un contrôle qui a
 * échoué ne tient que quelques minutes, sans quoi il occuperait la place d'un
 * verdict qu'il n'a jamais rendu (`KEY_WATCH_FAIL_TTL_MS`).
 */
function isFresh(userId: string, now: number): boolean {
  const r = getMemberKeyReport(userId);
  if (!r) return false;
  const ttl = estNonConcluant(r.status) ? KEY_WATCH_FAIL_TTL_MS : KEY_WATCH_TTL_MS;
  return now - r.checkedAt < ttl;
}

// ── Les marques locales ──────────────────────────────────────────────────────

export function getVerifiedMark(vaultId: string, userId: string): TrustMark | null {
  const m = readJson<TrustMark>(`${MARK_PREFIX}${vaultId}.${userId}`);
  // Une marque sans empreinte ne vaut rien : elle ne pourrait être confrontée à
  // aucune clé servie, donc elle dirait « vérifié » pour n'importe laquelle.
  return m && typeof m.fingerprint === 'string' && m.fingerprint ? m : null;
}

/**
 * « J'ai comparé ce numéro ». DEUX gestes en un, et c'est voulu :
 *
 *  1. la marque locale, datée, qui nomme l'empreinte comparée — elle ne vaudra
 *     que pour celle-là (`memberTrustModel`, règle 1) ;
 *  2. `acceptPeerKeyChange`, LA MÊME primitive que la cérémonie d'invitation :
 *     l'épinglage suit la clé qu'un humain vient de reconnaître, si bien que le
 *     prochain contrôle rend « ok » au lieu de crier au changement, et que la
 *     prochaine substitution ressort.
 *
 * Ce qu'elle NE fait pas : elle n'efface pas une chaîne rompue ni une clé servie
 * qui n'est pas la dernière du journal. Ces deux-là sont des preuves côté
 * serveur ; aucune case cochée sur cet appareil ne les lève.
 */
export function markMemberVerified(vaultId: string, userId: string, fingerprint: string): void {
  const mark: TrustMark = { fingerprint, at: Date.now() };
  writeJson(`${MARK_PREFIX}${vaultId}.${userId}`, mark);
  acceptPeerKeyChange(userId, fingerprint);
  const r = getMemberKeyReport(userId);
  // L'épinglage vient de bouger : le rapport en mémoire doit le refléter, sinon
  // le tiroir montrerait encore « avant / maintenant » pour un changement
  // qu'on vient d'accepter.
  if (r) putReport({ ...r, pinned: fingerprint });
  notify();
}

// ── Les alertes d'un coffre, pour l'explorateur ──────────────────────────────

export interface VaultKeyAlerts {
  /** Quand ce constat a été fait — l'écran ne prétend pas qu'il est de maintenant. */
  at: number;
  userIds: string[];
}

/**
 * Ce que le point rouge du bouton « Gérer » lit. Il n'est PAS calculé ici : le
 * verdict appartient à `memberTrustModel`, et la page qui vient de contrôler
 * dépose son résultat. L'explorateur, lui, ne déclenche aucun réseau — un
 * badge qui lancerait deux cents lectures à chaque ouverture d'un dossier
 * coûterait exactement ce que la fiche cherche à éviter.
 */
export function getVaultKeyAlerts(vaultId: string): VaultKeyAlerts | null {
  return readJson<VaultKeyAlerts>(ALERT_PREFIX + vaultId);
}

export function setVaultKeyAlerts(vaultId: string, userIds: readonly string[]): void {
  const avant = getVaultKeyAlerts(vaultId);
  const même =
    avant &&
    avant.userIds.length === userIds.length &&
    avant.userIds.every((id, i) => id === userIds[i]);
  // Rien de neuf : pas de réveil des abonnés. Un `notify()` à chaque passage
  // ferait re-rendre l'explorateur pour un fait qui n'a pas bougé.
  if (même) return;
  writeJson(ALERT_PREFIX + vaultId, { at: Date.now(), userIds: [...userIds] });
  notify();
}

// ── Le contrôle lui-même ─────────────────────────────────────────────────────

/** 404 `no_public_key` : cette personne n'a PAS de clé — ce n'est pas une panne. */
function isNoPublicKey(e: unknown): boolean {
  const err = e as { response?: { status?: number; data?: { code?: string } } };
  return err?.response?.status === 404 || err?.response?.data?.code === 'no_public_key';
}

async function checkOne(userId: string): Promise<MemberKeyReport> {
  const checkedAt = Date.now();
  let served: { encPublicKey: string; fingerprint: string };
  try {
    const pub = await apiGetMemberPublicKey(userId);
    served = { encPublicKey: pub.encPublicKey, fingerprint: pub.fingerprint };
  } catch (e) {
    // « Pas de clé » et « je n'ai pas su lire » sont deux états DIFFÉRENTS : le
    // premier se dit (« clé non publiée »), le second reste « on ne sait pas ».
    // Les confondre ferait annoncer une absence de clé sur une coupure réseau.
    return {
      userId,
      status: isNoPublicKey(e) ? 'no_key' : 'unreadable',
      fingerprint: null,
      pinned: getTofuFingerprint(userId),
      checkedAt,
    };
  }
  try {
    const log = await apiGetKeyLog(userId);
    const status = await checkPeerKeyTransparency(userId, served, log);
    return {
      userId,
      status,
      fingerprint: served.fingerprint,
      pinned: getTofuFingerprint(userId),
      checkedAt,
    };
  } catch {
    // Journal illisible : on ne CONCLUT pas — la même règle que la rotation, qui
    // refuse de sceller à l'aveugle plutôt que de supposer que tout va bien.
    return {
      userId,
      status: 'unreadable',
      fingerprint: served.fingerprint,
      pinned: getTofuFingerprint(userId),
      checkedAt,
    };
  }
}

export interface WatchOptions {
  /** Ignorer le cache — le bouton « Revérifier » du tiroir. */
  force?: boolean;
  /**
   * L'écran est-il encore là ? Consulté ENTRE deux pages : quitter la page ne
   * doit pas laisser deux cents requêtes en vol pour un tableau démonté.
   */
  cancelled?: () => boolean;
}

/**
 * Contrôler les membres d'un coffre, par pages, en respectant le cache.
 *
 * Les abonnés sont prévenus APRÈS CHAQUE PAGE et non à la fin : sur un gros
 * roster, la colonne « Confiance » se remplit par blocs de vingt au lieu de
 * rester vide une minute puis de tout afficher d'un coup.
 */
export async function watchVaultMemberKeys(
  userIds: readonly string[],
  opts: WatchOptions = {}
): Promise<void> {
  const now = Date.now();
  const àFaire = opts.force ? [...userIds] : userIds.filter((id) => !isFresh(id, now));
  if (àFaire.length === 0) return;
  for (let i = 0; i < àFaire.length; i += KEY_WATCH_PAGE) {
    if (opts.cancelled?.()) return;
    const page = àFaire.slice(i, i + KEY_WATCH_PAGE);
    // La page est menée de front (vingt personnes, deux lectures chacune) ; ce
    // sont les PAGES qui se suivent, pas les personnes — sinon un roster de deux
    // cents tiendrait la colonne vide pendant une minute.
    const rapports = await Promise.all(page.map((id) => checkOne(id)));
    for (const r of rapports) putReport(r);
    notify();
  }
}
