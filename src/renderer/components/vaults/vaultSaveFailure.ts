/**
 * POURQUOI UN ENREGISTREMENT A ÉCHOUÉ — et la seule distinction qui change la
 * phrase, le badge et la suite : LE COFFRE A-T-IL RÉPONDU ?
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Réseau coupé, clic sur « Enregistrer » : l'écran répondait « Impossible
 * d'enregistrer cette note. Rien n'a été modifié dans le coffre. » Chaque mot
 * est vrai, et l'ensemble est faux de sens. Le coffre n'a rien refusé — il n'a
 * pas été atteint ; le texte est intact à l'écran, et rien ne le disait ; et
 * aucune reprise n'était annoncée, alors qu'il n'y avait qu'une coupure à
 * attendre. On lisait un échec définitif là où il n'y avait qu'une absence de
 * ligne.
 *
 * ══ CE QUI FAIT PREUVE, ET CE QUI NE FAIT QU'INDICE ═════════════════════════
 *
 * LE FAIT, c'est L'ÉCHEC DE LA REQUÊTE : une erreur qui ne porte aucune réponse
 * du serveur n'a rencontré personne. C'est ce que `classifyVaultFailure` établit
 * en amont (pas d'objet `response` ⇒ `network_unavailable`), et c'est ce que ce
 * module lit en premier.
 *
 * `navigator.onLine` MENT DANS LES DEUX SENS — vrai derrière un portail captif
 * ou un DNS mort, faux sur des configurations parfaitement connectées. Il n'a
 * donc ici qu'un rôle, et un seul : trancher une IGNORANCE. Il ne peut jamais
 * contredire un verdict que le serveur a NOMMÉ (un coffre gelé reste gelé même
 * si le navigateur se croit hors ligne), ni annuler un échec de transport avéré
 * (une coupure reste une coupure même s'il se croit en ligne).
 *
 * ══ L'AUTORITÉ SUR « LE SERVEUR A NOMMÉ CE REFUS » ══════════════════════════
 *
 * C'est `VAULT_ERROR_KEYS`, appelée et non recopiée. Une seconde liste de codes
 * tenue à la main ici finirait par diverger de celle qui traduit les messages,
 * et la divergence se lirait à l'écran comme « hors ligne » sur un refus de
 * plan — exactement le mensonge inverse de celui qu'on ferme.
 */

import { VAULT_ERROR_KEYS } from '../../../services/vault/vaultErrorMessages';

/**
 * · `unreachable` — la requête n'a rencontré personne. Rien n'a été décidé, le
 *                   texte est intact, et une reprise a un sens.
 * · `read-only`   — le coffre a répondu NON à notre droit d'écrire.
 * · `epoch`       — la clé du coffre a tourné sous nos pieds.
 * · `refused`     — un autre refus nommé, ou une erreur qu'on ne sait pas lire.
 *                   Le repli générique de l'appelant est alors la seule phrase
 *                   honnête.
 */
export type VaultSaveFailure = 'unreachable' | 'read-only' | 'epoch' | 'refused';

/**
 * Les refus que le CLIENT prononce lui-même, avant tout aller-retour.
 *
 * Ils n'ont pas de code serveur et ne sont donc dans aucune table ; sans cette
 * liste, une coupure supposée (`navigator.onLine === false`) les aurait
 * requalifiés en « hors ligne, on réessaiera » — sur un coffre verrouillé, la
 * reprise n'aurait jamais rien pu écrire, et le badge aurait promis pour rien.
 */
const LOCAL_REFUSALS: ReadonlySet<string> = new Set([
  'Unknown vault',
  'Vault is locked',
  'Vault is locked for this item',
  // Le TOFU d'un destinataire a changé : une cérémonie de confirmation, pas une
  // panne — et sûrement pas quelque chose qu'une reprise silencieuse doit
  // rejouer toute seule.
  'grantee_key_changed',
  'grant_set_mismatch',
]);

/**
 * LA FORME D'UN TRANSPORT QUI N'A RENCONTRÉ PERSONNE, quand le code canonique
 * n'a pas pu être posé (une couche qui relaie l'erreur brute d'un `fetch`).
 *
 * C'est un FILET, pas la preuve principale : `network_unavailable` reste le
 * chemin normal. Il existe parce qu'une seule couche oubliée en amont suffisait
 * à faire retomber une coupure sur le message « le coffre a refusé ».
 */
const TRANSPORT_SHAPE =
  /failed to fetch|network\s*error|networkerror|err_network|err_name_not_resolved|err_internet_disconnected|err_connection|load failed|econnaborted|etimedout|enotfound|timeout|aborted/i;

export interface VaultSaveFailureInput {
  /** Le motif remonté par le thunk : un code canonique, ou un message brut. */
  reason: string;
  /**
   * `navigator.onLine`, ou `null` quand on ne peut pas le lire. INDICE, jamais
   * preuve : il ne sert qu'à trancher un motif qu'on ne sait pas lire.
   */
  onLine: boolean | null;
}

/** Le code nu, sans le suffixe `:qui` que certains thunks accolent. */
function bareCode(reason: string): string {
  return reason.split(':')[0].trim();
}

export function classifyVaultSaveFailure(input: VaultSaveFailureInput): VaultSaveFailure {
  const reason = input.reason.trim();
  const bare = bareCode(reason);

  // 1. LE TRANSPORT D'ABORD, et sans consulter `onLine` : la requête est
  //    revenue sans réponse, ce fait-là ne se discute pas.
  if (bare === 'network_unavailable') return 'unreachable';

  // 2. LE SERVEUR A NOMMÉ SON REFUS — il a donc répondu, et `onLine` n'a rien à
  //    en dire. `network_unavailable` est déjà sorti au-dessus, sinon il serait
  //    lu ici comme un refus (il est dans la même table).
  if (VAULT_ERROR_KEYS[bare] !== undefined || LOCAL_REFUSALS.has(reason)) {
    if (/epoch/i.test(bare)) return 'epoch';
    if (bare === 'org_read_only' || bare === 'vault_frozen') return 'read-only';
    if (/forbidden|not_a_member|insufficient_role/i.test(bare)) return 'read-only';
    return 'refused';
  }

  // 3. LES DEUX FORMES QUE LE CODE CANONIQUE A PU MANQUER — le vocabulaire des
  //    couches qui n'ont pas de table.
  if (/epoch/i.test(reason)) return 'epoch';
  if (/forbidden|\b403\b/i.test(reason)) return 'read-only';
  if (TRANSPORT_SHAPE.test(reason)) return 'unreachable';

  // 4. ET SEULEMENT ICI, L'INDICE. On ne sait pas lire ce motif — ni verdict
  //    nommé, ni forme de transport, ni même le repli d'ignorance. Si le
  //    navigateur affirme qu'il n'y a pas de ligne, c'est la seule information
  //    disponible, et elle vaut mieux que le silence.
  if (input.onLine === false) return 'unreachable';
  return 'refused';
}

// ─────────────────────────────────────────────────────────────────────────────
// LA REPRISE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LES PALIERS, ET POURQUOI ILS SONT BORNÉS EN NOMBRE AUTANT QU'EN DURÉE.
 *
 * Une reprise sans fin est une boucle : elle rebat la même requête contre un
 * réseau absent, remplit la console, et — pire — laisse le badge promettre
 * indéfiniment un enregistrement qui n'arrive pas. Cinq tentatives, recul
 * progressif, un peu moins de quatre minutes en tout ; passé ce compte, on
 * ARRÊTE et l'écran redescend à « rien ne l'enregistrera tout seul », avec son
 * bouton. Se taire est un mensonge ; renoncer bruyamment n'en est pas un.
 */
export const VAULT_SAVE_RETRY_STEPS_MS: readonly number[] = [
  5_000, 15_000, 30_000, 60_000, 120_000,
];

/**
 * Le délai avant la reprise, après `attempts` échecs CONSÉCUTIFS imputés au
 * réseau (le premier échec vaut 1) — `null` quand il n'y en a plus : la reprise
 * automatique s'arrête là, et l'écran le dit au lieu de continuer à promettre.
 */
export function vaultSaveRetryDelay(attempts: number): number | null {
  if (attempts < 1) return null;
  return VAULT_SAVE_RETRY_STEPS_MS[attempts - 1] ?? null;
}

/** Reste-t-il une tentative automatique à jouer ? La question du badge. */
export function vaultSaveRetryLives(attempts: number): boolean {
  return vaultSaveRetryDelay(attempts) !== null;
}

/**
 * LES QUATRE RAISONS D'ARRÊTER NET, et elles ne sont pas négociables : une
 * reprise qui survit à la fermeture de la note, au verrouillage du coffre, à un
 * conflit ouvert ou à une révocation écrirait derrière quelqu'un qui n'est plus
 * là, ou repartirait contre un refus certain.
 *
 * `hasConflict` mérite son rang : l'écran d'arbitrage bloc par bloc porte le
 * geste, et une reprise qui renverrait la même version périmée ne récolterait
 * qu'un second 409 — sans écran pour le dire, cette fois.
 */
export interface VaultSaveRetryGate {
  /** La note est encore ouverte et son corps monté. */
  open: boolean;
  /** Le coffre accepte encore une écriture de notre part. */
  mayWrite: boolean;
  /** Un conflit non résolu possède l'écran. */
  hasConflict: boolean;
  /** La version de garde est connue — sans elle, rien ne peut partir. */
  guardVersion: number | null;
  /** Un envoi est déjà en vol : on n'en empile pas un second. */
  saving: boolean;
  /** Il reste vraiment quelque chose à écrire. */
  dirty: boolean;
}

/** Une reprise a-t-elle encore le droit de partir ? */
export function vaultSaveRetryMayFire(gate: VaultSaveRetryGate): boolean {
  return (
    gate.open &&
    gate.mayWrite &&
    !gate.hasConflict &&
    !gate.saving &&
    gate.dirty &&
    gate.guardVersion !== null
  );
}
