/**
 * deltaGcSweep.ts — Rattrapage du ramasse-miettes des blocs delta. PUR.
 *
 * Complement du lot 26. Le ramasse-miettes lui-meme EXISTE DEJA et il est bien
 * fait : `POST /sync/delta/gc` cote worker (garde de version, fenetre de grace
 * de 15 min, limite de debit, idempotent), appele par `deltaSync` apres chaque
 * commit de manifeste reussi.
 *
 * ── LE TROU QU'IL RESTE ──────────────────────────────────────────────────────
 * Cet appel est au mieux :
 *
 *     await transport.gc(...).catch(() => undefined);
 *
 * C'est le bon choix — un ramasse-miettes qui ferait echouer une synchronisation
 * reussie serait absurde. Mais la consequence est qu'un GC rate ne repasse
 * JAMAIS de lui-meme : les orphelins de ce fichier attendent son prochain
 * televersement complet. Pour un fichier ecrit une fois puis jamais retouche,
 * « prochain televersement » veut dire jamais, et les octets restent sur R2
 * indefiniment.
 *
 * Une coupure reseau, un 429 sur la limite de debit, une fermeture d'application
 * au mauvais moment suffisent. Ce n'est pas une hypothese : c'est le
 * comportement nominal du `.catch()`.
 *
 * ── CE QUE FAIT CE MODULE ────────────────────────────────────────────────────
 * Il DECIDE quels fichiers meritent une nouvelle tentative, et rien d'autre :
 * pas de reseau, pas d'horloge, pas d'E/S. Il est donc entierement testable, et
 * l'appelant reste libre de son ordonnancement.
 *
 * ── POURQUOI LE SERVEUR NE PEUT PAS LE FAIRE SEUL ────────────────────────────
 * Le manifeste est chiffre de bout en bout : le worker ne sait pas quels blocs
 * sont encore references. Seul le client connait l'ensemble vivant. Un balayage
 * cote serveur devrait ou bien dechiffrer (impossible, et contraire a la
 * promesse), ou bien supprimer a l'aveugle (destructeur). Le rattrapage est donc
 * necessairement client.
 */

/** Ce qu'on retient d'un fichier delta entre deux tentatives. */
export interface GcFileState {
  /** Identifiant opaque du fichier. */
  fileId: string;
  /** Version du manifeste au dernier commit reussi. La garde du serveur en depend. */
  committedVersion: number;
  /** Date du dernier essai de ramassage, en millisecondes. `null` = jamais essaye. */
  lastAttemptAt: number | null;
  /** Le dernier essai a-t-il abouti ? */
  lastAttemptOk: boolean;
  /** Essais consecutifs echoues — pilote le recul exponentiel. */
  consecutiveFailures: number;
}

export interface SweepOptions {
  /**
   * Nombre maximal de fichiers repris par passage.
   *
   * Le serveur limite le ramassage a 120 appels par tranche de 300 s. Un
   * rattrapage qui saturerait cette limite ferait echouer les GC NORMAUX, ceux
   * qui suivent un commit — on se mettrait a fabriquer les orphelins qu'on
   * essaie de ramasser. La valeur par defaut laisse une marge large.
   */
  budget?: number;
  /** Silence minimal entre deux tentatives pour un meme fichier. */
  minRetryMs?: number;
  /** Plafond du recul exponentiel. */
  maxBackoffMs?: number;
}

export const DEFAULT_SWEEP_BUDGET = 20;
export const DEFAULT_MIN_RETRY_MS = 60 * 60 * 1000; // 1 h
export const DEFAULT_MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // 1 jour

/**
 * Delai a respecter avant de retenter, apres `failures` echecs consecutifs.
 *
 * Recul exponentiel : un fichier dont le ramassage echoue systematiquement — un
 * bogue, un stockage tiers en panne — ne doit pas consommer le budget de tous
 * les autres a chaque passage.
 */
export function backoffFor(
  failures: number,
  minRetryMs = DEFAULT_MIN_RETRY_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS
): number {
  if (failures <= 0) return minRetryMs;
  const grown = minRetryMs * 2 ** Math.min(failures, 20);
  return Math.min(grown, maxBackoffMs);
}

/** Ce fichier merite-t-il une nouvelle tentative maintenant ? */
export function needsSweep(state: GcFileState, now: number, options: SweepOptions = {}): boolean {
  // Un ramassage REUSSI ne se refait pas : les orphelins de ce fichier sont
  // partis, et le prochain commit relancera un GC de toute facon.
  if (state.lastAttemptOk) return false;
  if (state.lastAttemptAt === null) return true;
  // Une date dans le futur signale une horloge qui a recule. On retente plutot
  // que d'attendre un delai qui pourrait ne jamais s'ecouler.
  if (state.lastAttemptAt > now) return true;
  const delai = backoffFor(
    state.consecutiveFailures,
    options.minRetryMs ?? DEFAULT_MIN_RETRY_MS,
    options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
  );
  return now - state.lastAttemptAt >= delai;
}

/**
 * Choisit les fichiers a reprendre, dans l'ordre le plus utile.
 *
 * Priorite aux fichiers jamais essayes, puis aux plus anciennement essayes :
 * un fichier dont le ramassage n'a jamais tourne porte, statistiquement, le
 * plus d'orphelins.
 */
export function selectForSweep(
  states: readonly GcFileState[],
  now: number,
  options: SweepOptions = {}
): GcFileState[] {
  const budget = Math.max(0, options.budget ?? DEFAULT_SWEEP_BUDGET);
  if (budget === 0) return [];
  return states
    .filter((s) => needsSweep(s, now, options))
    .sort((a, b) => {
      if (a.lastAttemptAt === null && b.lastAttemptAt !== null) return -1;
      if (b.lastAttemptAt === null && a.lastAttemptAt !== null) return 1;
      return (a.lastAttemptAt ?? 0) - (b.lastAttemptAt ?? 0);
    })
    .slice(0, budget);
}

/** Etat apres une tentative. Rend un NOUVEL objet — l'entree n'est pas mutee. */
export function afterAttempt(state: GcFileState, ok: boolean, now: number): GcFileState {
  return {
    ...state,
    lastAttemptAt: now,
    lastAttemptOk: ok,
    consecutiveFailures: ok ? 0 : state.consecutiveFailures + 1,
  };
}

/**
 * Enregistre un commit de manifeste.
 *
 * Un nouveau commit REOUVRE le besoin de ramassage : il vient de creer des
 * orphelins (les blocs de l'ancienne version), et il change la version dont la
 * garde du serveur depend. Conserver `lastAttemptOk = true` ferait sauter ce
 * fichier pour toujours.
 */
export function afterCommit(state: GcFileState, committedVersion: number): GcFileState {
  return {
    ...state,
    committedVersion,
    lastAttemptOk: false,
    consecutiveFailures: 0,
    lastAttemptAt: null,
  };
}

/** Etat initial d'un fichier qui vient d'etre televerse pour la premiere fois. */
export function initialState(fileId: string, committedVersion: number): GcFileState {
  return {
    fileId,
    committedVersion,
    lastAttemptAt: null,
    lastAttemptOk: false,
    consecutiveFailures: 0,
  };
}

/** Combien de fichiers attendent un ramassage — pour l'ecran de diagnostic. */
export function pendingCount(states: readonly GcFileState[], now: number, options: SweepOptions = {}): number {
  return states.filter((s) => needsSweep(s, now, options)).length;
}
