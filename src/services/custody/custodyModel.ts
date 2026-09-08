/**
 * Ce que l'écran des partages DIT de la clé de garde — modèle PUR.
 *
 * Toute la décision est ici : quelle phase peindre, et quelle phrase porter.
 * Rien n'est décidé dans le composant, et rien n'est décidé sur une supposition
 * — chaque phase correspond à un fait vérifié (le serveur a répondu, la
 * primitive existe, la session est ouverte).
 *
 * DEUX SECRETS DIFFÉRENTS, et c'est le piège que l'écran doit fermer : le mot
 * de passe du COMPTE ouvre la session ; la phrase de RÉCUPÉRATION emballe la
 * clé de garde et n'est JAMAIS transmise. Le bureau ne sait ici que
 * déverrouiller, jamais créer — il n'a donc pas à arbitrer la confusion à la
 * création (c'est le site et le mobile qui portent cet avertissement), mais il
 * doit nommer la bonne phrase dans son champ de saisie, sans quoi l'utilisateur
 * essaiera son mot de passe et conclura que « ça ne marche pas ».
 */

import {
  ERR_CORRUPT_CUSTODY,
  ERR_INVALID_CUSTODY_KEY,
  ERR_WRONG_PASSPHRASE,
} from './custodyFormat';

/** Phases de la bannière de garde, dans l'ordre où on les rencontre. */
export type CustodyPhase =
  /** Pas de compte : la clé de garde est un objet de COMPTE, rien à dire. */
  | 'signedOut'
  /** Argon2id introuvable sur cette installation — ne rien promettre. */
  | 'unsupported'
  /** Le serveur n'a pas encore répondu. */
  | 'loading'
  /** Le serveur n'a pas pu être joint : ne PAS conclure « pas de coffre ». */
  | 'unavailable'
  /** Le compte n'a pas de clé : les libellés resteront locaux. */
  | 'absent'
  /** Une clé existe, verrouillée sur cette machine. */
  | 'locked'
  /** Déverrouillée pour cette session : les noms s'affichent. */
  | 'unlocked';

export interface CustodyPhaseInput {
  signedIn: boolean;
  argon2Available: boolean;
  /** État de la session tel que `custodySession` le rend. */
  session: 'unknown' | 'absent' | 'locked' | 'unlocked';
  /** Vrai tant qu'un aller serveur est en cours. */
  loading: boolean;
  /** Vrai quand le dernier aller serveur a ÉCHOUÉ (panne, 5xx). */
  fetchFailed: boolean;
}

/**
 * Phase de la bannière. L'ORDRE DES TESTS EST LA RÈGLE : ce qui rend l'écran
 * IMPOSSIBLE passe avant ce qui le rend seulement incomplet.
 *
 * `unavailable` mérite son cas propre. Sur une panne réseau la session reste
 * `unknown`, et confondre ce silence avec « ce compte n'a pas de clé » ferait
 * afficher « vos noms resteront sur cette machine » à quelqu'un dont les noms
 * sont, en réalité, déjà sur le serveur et parfaitement lisibles cinq minutes
 * plus tard.
 */
export function custodyPhase(input: CustodyPhaseInput): CustodyPhase {
  if (!input.signedIn) return 'signedOut';
  if (!input.argon2Available) return 'unsupported';
  if (input.session === 'unlocked') return 'unlocked';
  if (input.session === 'locked') return 'locked';
  if (input.loading) return 'loading';
  if (input.fetchFailed) return 'unavailable';
  if (input.session === 'absent') return 'absent';
  return 'loading';
}

/**
 * Vrai quand la bannière doit s'afficher. `unlocked` et `signedOut` ne disent
 * rien d'utile : dans le premier cas les noms sont là, dans le second il n'y a
 * pas de compte. Une bannière permanente qui annonce que tout va bien est du
 * bruit, et le bruit finit par masquer l'avertissement qui compte.
 */
export function custodyBannerVisible(phase: CustodyPhase): boolean {
  return phase !== 'unlocked' && phase !== 'signedOut';
}

/** Vrai quand un bouton « Déverrouiller » a un sens. */
export function custodyCanUnlock(phase: CustodyPhase): boolean {
  return phase === 'locked';
}

// ── Traduction des erreurs de service ───────────────────────────────────

/** Résultat d'une tentative de déverrouillage, du point de vue de l'écran. */
export type CustodyUnlockError = 'wrongPassphrase' | 'corrupt' | 'unsupported' | 'generic';

/**
 * Traduit l'erreur levée par `unlockCustody` en cause affichable.
 *
 * Les messages du service sont des CODES stables (`WRONG_PASSPHRASE`,
 * `CORRUPT_CUSTODY`) : les faire correspondre ici garde l'écran muet sur les
 * détails cryptographiques tout en distinguant ce qui appelle des gestes
 * DIFFÉRENTS — ressaisir sa phrase, contre « cette clé est abîmée, la
 * ressaisie n'y changera rien ».
 */
export function custodyUnlockErrorOf(error: unknown): CustodyUnlockError {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message === ERR_WRONG_PASSPHRASE) return 'wrongPassphrase';
  if (message === ERR_CORRUPT_CUSTODY || message === ERR_INVALID_CUSTODY_KEY) return 'corrupt';
  if (message.startsWith('ARGON2_') || message.includes('argon2')) return 'unsupported';
  return 'generic';
}

/** Clé i18n de la phrase d'une phase. */
export function custodyPhaseKey(phase: CustodyPhase): string {
  return `custody.phase.${phase}`;
}

/** Clé i18n d'une erreur de déverrouillage. */
export function custodyUnlockErrorKey(error: CustodyUnlockError): string {
  return `custody.unlockError.${error}`;
}

/** Clé i18n de la raison pour laquelle un libellé n'a pas été synchronisé. */
export function labelSyncReasonKey(reason: string): string {
  return `custody.labelReason.${reason}`;
}
