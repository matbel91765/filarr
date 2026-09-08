/**
 * LA FILE DES RETOURS — envoyer, ou mettre de côté, puis REJOUER.
 *
 * ── CE QUI EXISTAIT, ET CE QUI MANQUAIT ─────────────────────────────────────
 * L'écran des réglages postait le retour sur `/feedback` et, en cas d'échec,
 * l'empilait dans `localStorage['filarr-feedback']`. Le repli est le bon choix :
 * un retour se rédige une fois, et le perdre parce que le réseau a hoqueté
 * apprend à ne plus en écrire.
 *
 * Mais RIEN NE DÉPILAIT JAMAIS. Les retours s'accumulaient sur le disque de
 * l'utilisateur, invisibles, et n'arrivaient nulle part — pendant que l'écran
 * affichait « Merci ! Votre feedback a été envoyé. » Deux mensonges pour le prix
 * d'un : le message, et la promesse implicite qu'écrire sert à quelque chose.
 *
 * Ce module ajoute les deux gestes qui manquaient, et rend l'écran honnête :
 *
 *  1. AU PROCHAIN ENVOI RÉUSSI. C'est le seul instant où l'on SAIT que le
 *     serveur répond — pas au chargement de la page, pas sur un minuteur. La
 *     file part dans la foulée, sans que l'utilisateur ait rien à faire.
 *  2. AU DÉMARRAGE. Parce qu'un utilisateur qui a envoyé un retour hors ligne
 *     et n'en enverra jamais d'autre existe, et que sa file ne doit pas
 *     l'attendre indéfiniment.
 *
 * ── MÊME FORME QUE LE MOBILE ────────────────────────────────────────────────
 * `filarr-mobile/src/services/feedback/feedbackService.ts` fait exactement
 * ceci, sur AsyncStorage. Les deux plateformes rendent le même verdict
 * (`'sent' | 'queued'`) et plafonnent la file au même nombre : une file sans fin
 * n'est plus une file, c'est une fuite.
 *
 * ── CE MODULE NE JETTE JAMAIS ───────────────────────────────────────────────
 * Ni sur un `localStorage` indisponible (mode privé, quota plein), ni sur un
 * réseau muet. Un retour est un cadeau de l'utilisateur : le plantage de
 * l'écran qui le remercie serait la pire réponse possible.
 */
import apiClient from '../network/apiClient';

/** La clé HISTORIQUE, inchangée : la file déjà sur les disques doit être lue. */
export const PENDING_FEEDBACK_KEY = 'filarr-feedback';

/**
 * Au-delà, on cesse d'empiler et on garde les PLUS RÉCENTS. Vingt, comme le
 * mobile. Garder les récents plutôt que les premiers n'est pas neutre : un
 * utilisateur qui a rempli sa file décrit probablement encore le même problème,
 * et sa dernière description est la mieux informée.
 */
export const PENDING_MAX = 20;

/** Ce qu'un retour porte. Forme ouverte : le serveur en accepte davantage. */
export interface FeedbackEntry {
  id: string;
  type: string;
  text: string;
  email?: string | null;
  version?: string;
  platform?: string;
  locale?: string;
  createdAt?: string;
  [key: string]: unknown;
}

/** Ce qui est arrivé au retour. L'écran doit pouvoir le DIRE, pas le deviner. */
export type FeedbackOutcome = 'sent' | 'queued';

function readPending(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(PENDING_FEEDBACK_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Une entrée qui n'est pas un objet ne se repostera jamais : on l'écarte
    // plutôt que de la faire échouer indéfiniment à chaque rejeu.
    return parsed.filter((e): e is FeedbackEntry => !!e && typeof e === 'object');
  } catch {
    return [];
  }
}

function writePending(entries: readonly FeedbackEntry[]): void {
  try {
    localStorage.setItem(PENDING_FEEDBACK_KEY, JSON.stringify(entries.slice(-PENDING_MAX)));
  } catch {
    /* une file qu'on ne sait pas écrire est une file perdue, pas un plantage */
  }
}

async function post(entry: FeedbackEntry): Promise<void> {
  const { data } = await apiClient.post('/feedback', entry);
  if (!data?.success) throw new Error(data?.error || 'feedback refusé');
}

/** Combien de retours attendent encore. Pour l'écran, rien d'autre. */
export function pendingFeedbackCount(): number {
  return readPending().length;
}

/**
 * REJOUE LA FILE. Silencieuse par construction : un échec laisse l'entrée en
 * place, exactement où elle était.
 *
 * S'ARRÊTE AU PREMIER ÉCHEC RÉSEAU plutôt que d'essayer les vingt : si la
 * première ne passe pas, les suivantes ne passeront pas non plus, et vingt
 * requêtes vouées à l'échec coûtent vingt délais d'attente à l'utilisateur.
 * L'entrée qui a échoué et toutes celles d'après restent dues, dans l'ordre.
 *
 * Rend le nombre de retours effectivement partis — utile aux tests et au
 * journal, jamais à une décision.
 */
export async function drainPendingFeedback(): Promise<number> {
  const pending = readPending();
  if (pending.length === 0) return 0;

  let sent = 0;
  for (let i = 0; i < pending.length; i += 1) {
    try {
      await post(pending[i]);
      sent += 1;
    } catch {
      // Le reste de la file, dans l'ordre, y compris celle qui vient d'échouer.
      writePending(pending.slice(i));
      return sent;
    }
  }
  writePending([]);
  return sent;
}

/**
 * ENVOIE, OU MET DE CÔTÉ. Ne jette jamais.
 *
 * `'queued'` n'est pas un échec : c'est une promesse tenue autrement, et
 * l'écran doit le dire dans ces termes plutôt que remercier pour un envoi qui
 * n'a pas eu lieu.
 */
export async function sendFeedback(entry: FeedbackEntry): Promise<FeedbackOutcome> {
  try {
    await post(entry);
    // Le succès est le SEUL instant où l'on sait que le serveur répond : c'est
    // là, et pas au hasard d'un minuteur, qu'on rejoue ce qui attendait.
    void drainPendingFeedback();
    return 'sent';
  } catch {
    writePending([...readPending(), entry]);
    return 'queued';
  }
}
