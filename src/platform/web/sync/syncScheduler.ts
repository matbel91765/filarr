/**
 * Ordonnanceur de sync web — le pendant du démon desktop (5 min + debounce),
 * augmenté d'un quasi-temps-réel par GET conditionnel (décision DW-09).
 *
 * Démarre quand la FEK arrive en session (sync:setSessionKey), s'arrête au
 * verrouillage/logout. Cinq déclencheurs :
 *  - CANAL DE NOTIFICATION (webSyncChannel) : le serveur POUSSE la version du
 *    manifeste au moment où il l'incrémente, et le cycle part dans la seconde.
 *    C'est le seul déclencheur qui ne DEMANDE rien — les autres restent en
 *    place dessous et le rattrapent quand il est muet, non déployé ou gelé ;
 *  - SONDAGE 20 s (au moins un onglet visible) : GET conditionnel du manifeste
 *    avec `If-None-Match: W/"v{version connue}"`. 304 → rien à faire, coût
 *    quasi nul ; 200 → la version distante a bougé, on déclenche un cycle
 *    complet (le rapatriement reste dans pullFromCloud, pas dupliqué ici) ;
 *  - cycle périodique 5 min : filet de sécurité (couvre le sondage suspendu,
 *    l'onglet longtemps caché, et les versions jamais lues) ;
 *  - debounce 10 s après toute modification locale (événement interne
 *    `web:pending-marked` émis par pendingUploads) — même valeur que le
 *    DEBOUNCE_DELAY desktop ;
 *  - retour d'onglet (visibilitychange → visible) : sondage immédiat, et cycle
 *    complet seulement si le dernier date de plus d'une période.
 *
 * Cinquième déclencheur, à part : le BOUTON « Synchroniser » du renderer
 * (`sync:triggerSync` → `requestManualSync`). Il n'a pas de cadence, il a un
 * utilisateur qui attend — il conclut donc toujours, y compris dans un onglet
 * suiveur (délégation au meneur avec verdict) et pendant un cycle en vol (il le
 * rejoint au lieu de le refuser).
 *
 * UN SEUL ONGLET TRAVAILLE (voir syncLeader). Ces quatre déclencheurs sont
 * réservés au MENEUR élu : sinon N onglets ouverts = N sondages toutes les 20 s
 * et N cycles concurrents qui poussent en même temps. Un suiveur reste utile :
 *  - visible, il demande le sondage au meneur (tic de 20 s et retour d'onglet) —
 *    la cadence tient donc même quand le meneur est un onglet caché ;
 *  - modifié, il demande un cycle complet après le même debounce de 10 s ;
 *  - après chaque cycle, il rejoue les événements du meneur pour rafraîchir son
 *    interface, puisque c'est le meneur qui a écrit dans l'IndexedDB partagé.
 * Sans les API d'élection, chaque onglet redevient son propre meneur : le
 * comportement est exactement celui d'avant.
 *
 * LE MENEUR DOIT RESTER VÉRIFIABLE. Trois garde-fous, tous nés du même risque —
 * un meneur silencieux bloque TOUT LE MONDE, puisque lui seul travaille :
 *  - il diffuse une preuve de vie à chaque tic et en accusé de toute demande
 *    (voir syncLeader) ;
 *  - une demande de cycle refusée pour cause de verrou est MISE EN FILE, pas
 *    jetée ;
 *  - un verrou de cycle tenu au-delà de CYCLE_STUCK_MS est repris de force.
 *
 * Garde-fous du sondage : jamais pendant un cycle ni pendant un autre sondage,
 * jamais plus d'un par période (quel que soit le nombre de demandeurs), jamais
 * sans onglet visible, jamais sans FEK ni jeton (probeManifestChanged rend
 * `skipped`), suspension après 3 échecs consécutifs ou sur 401 — jusqu'au
 * prochain cycle complet RÉUSSI, qui seul prouve que session et réseau sont
 * revenus.
 */

import { emitWebEvent, subscribeWebEvent } from '../webEventBus';
import { getActiveProfileId } from '../webStore';
import { idbGet } from '../idb';
// Import STATIQUE (pas de cycle : authHandlers n'importe jamais l'ordonnanceur)
// — un import paresseux ici ajouterait une macrotâche entre `_running = true`
// et le tirage, et une demande de réveil arrivée dans cet intervalle ne serait
// plus coalescée avec le cycle de démarrage.
import { getSessionUser, isPendingRealmOpen } from '../handlers/authHandlers';

/**
 * `null` quand le profil peut être synchronisé par la session ouverte, sinon la
 * raison du refus (lisible : elle voyage avec l'état du bouton).
 */
async function profileMatchesSession(profileId: string): Promise<string | null> {
  if (isPendingRealmOpen()) return 'Connexion à un autre compte en cours';
  const session = getSessionUser()?.email?.trim().toLowerCase() ?? null;
  if (!session) return 'Non authentifié';
  const manifest = await idbGet<{
    profiles?: Array<{ id: string; cloudAccount?: { email?: string } | null }>;
  }>('profiles_manifest');
  const stampOf = (m: typeof manifest) =>
    m?.profiles
      ?.find((p) => p.id === profileId)
      ?.cloudAccount?.email?.trim()
      .toLowerCase();
  let stamp = stampOf(manifest);
  if (!stamp) {
    // Un profil d'avant l'estampille : c'est la restauration (portée au jeton)
    // qui dit s'il appartient au compte. Elle a pu échouer au moment de
    // l'installation de la clé (réseau) — on lui redonne sa chance ici plutôt
    // que de refuser tous les cycles de la session.
    try {
      const { restoreAccountProfiles } = await import('./readSync');
      await restoreAccountProfiles();
      stamp = stampOf(await idbGet<typeof manifest>('profiles_manifest'));
    } catch {
      /* le refus ci-dessous le dit */
    }
    /**
     * ⚠ CE MESSAGE EST LU DANS UNE BULLE ROUGE, ET IL DOIT DIRE QUOI FAIRE.
     *
     * Il énonçait un fait — « ce profil n'est rattaché à aucun compte » — et
     * s'arrêtait là. Or ce n'est ni une panne ni un accident : c'est l'état
     * NORMAL d'un profil local ouvert pendant qu'une session traîne, ce qui
     * arrive tout seul dès qu'on vient de filarr.com (le cookie de
     * rafraîchissement est posé pour le domaine).
     *
     * La personne voit alors son adresse dans les paramètres, « Synchronisation
     * activée », et cette phrase qui la contredit sans nommer de geste. Le
     * remède voyage donc avec le constat.
     *
     * ── CE QUI SERAIT MIEUX, ET POURQUOI CE N'EST PAS FAIT ICI ──────────────
     *
     * Un CODE plutôt qu'une phrase : l'écran pourrait alors présenter cet état
     * comme une configuration à corriger, et non comme « Échec de la
     * synchronisation ». Mais cette valeur traverse cinq relais, dont un canal
     * entre onglets qui ne transporte qu'une chaîne. Le faire proprement
     * demande de typer tout ce chemin — un vrai chantier, pas une ligne.
     */
    if (!stamp) {
      return 'Ce profil n’est rattaché à aucun compte : il reste local. Reconnectez-vous depuis ce profil pour le rattacher, ou désactivez la synchronisation dans les paramètres.';
    }
  }
  if (stamp !== session) {
    return 'Ce profil appartient à un autre compte que la session ouverte. Ouvrez le profil du compte connecté, ou connectez-vous au compte de ce profil.';
  }
  return null;
}
import { clearServerVersions } from './readSync';
import { refreshPendingCount } from './pendingUploads';
import { isSyncPaused } from './syncPause';
import { isStoreOutOfReachFromBrowser } from './localStoreGuard';
import {
  REPLAYABLE_CHANNELS,
  announceCycleDone,
  announceLeaderAlive,
  askLeaderToWake,
  broadcastCycleEvents,
  isSyncLeader,
  requestLeaderCycle,
  startSyncLeader,
  stopSyncLeader,
} from './syncLeader';
import type { SyncBroadcastEvent } from './syncLeader';

const CYCLE_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 10 * 1000;
const PROBE_MS = 20 * 1000;
/**
 * Écart minimal entre deux sondages, tous déclencheurs confondus (tic du meneur
 * ET demandes des suiveurs visibles, dont les périodes ne sont pas alignées).
 * Marge de 2 s sous la période : un `setInterval` livre parfois en retard, et
 * une fenêtre égale à PROBE_MS ferait alors sauter un tic sur deux.
 */
const PROBE_MIN_GAP_MS = PROBE_MS - 2000;
const PROBE_MAX_FAILURES = 3;
/** Un cycle de notes v2 en vol : jamais deux à la fois (il est détaché). */
let _notesCycleRunning = false;
/** Plafond de la charge diffusée après un cycle (un push massif la gonflerait). */
const MAX_BROADCAST_EVENTS = 200;
/**
 * CHIEN DE GARDE du verrou de cycle. `_running` n'est relâché que par le
 * `finally` du cycle : un `await` qui ne rend JAMAIS la main (fetch sans délai
 * maximal sur un réseau qui décroche) le laissait à `true` à vie — le meneur
 * refusait alors tout travail et les suiveurs attendaient un cycle que personne
 * ne ferait plus, sans le moindre signal. Passé ce plafond, le verrou est
 * considéré comme abandonné : on le reprend et on le dit. Les délais maximaux
 * de readSync rendent le cas très improbable ; ceci est la ceinture.
 */
const CYCLE_STUCK_MS = 3 * 60 * 1000;
/**
 * Cycle MANUEL délégué au meneur (bouton « Synchroniser » dans un suiveur).
 * Sans accusé sous `ACK_MS`, on considère qu'aucun meneur n'écoute et cet onglet
 * fait le travail lui-même : un bouton sans effet est pire qu'un cycle de trop.
 * Le verdict, lui, a droit au temps d'un vrai cycle.
 */
const MANUAL_ACK_MS = 3 * 1000;
const MANUAL_ANSWER_MS = 90 * 1000;

let _started = false;
let _interval: ReturnType<typeof setInterval> | null = null;
let _probeInterval: ReturnType<typeof setInterval> | null = null;
let _followerInterval: ReturnType<typeof setInterval> | null = null;
let _debounce: ReturnType<typeof setTimeout> | null = null;
let _unsubscribe: (() => void) | null = null;
let _lastCycleAt = 0;
let _lastProbeAt = 0;
let _running = false;
/** Instant de prise du verrou de cycle — sert au chien de garde. */
let _runningSince = 0;
/**
 * Jeton du cycle qui TIENT le verrou. Un cycle déclaré abandonné par le chien de
 * garde peut très bien finir plus tard : sans ce jeton, son `finally` rendrait
 * un verrou qui appartient désormais à un autre cycle.
 */
let _runToken = 0;
/**
 * Demande de cycle refusée pour cause de verrou — rejouée à la sortie du cycle
 * en cours. Une demande de suiveur perdue, c'est une modification qui reste dans
 * son navigateur jusqu'au prochain périodique (5 min), voire jamais s'il ferme.
 */
let _queuedCycle: string | null = null;
let _probing = false;
let _probeFailures = 0;
let _probeSuspended = false;
/**
 * Jeton de session de l'ordonnanceur, incrémenté à chaque arrêt. Un sondage ou
 * un cycle DÉJÀ PARTI voit son jeton périmé au retour de chaque `await` et se
 * retire : sans lui, la réponse arrivée après un verrouillage / logout /
 * changement de profil relançait un cycle sur une session morte.
 */
let _generation = 0;

/** `busy` = rien tenté (verrou ou session périmée) — surtout pas un échec. */
type CycleOutcome = 'ok' | 'busy' | 'failed' | 'paused';

/** Le verdict d'un cycle, avec la raison de l'échec quand il y en a une. */
interface CycleReport {
  outcome: CycleOutcome;
  error?: string;
}

/**
 * Compte rendu d'un cycle MANUEL, tel que le bouton « Synchroniser » le rend au
 * renderer. Toujours conclusif : succès, échec nommé, ou « c'était déjà en
 * cours » — jamais un silence.
 */
export interface ManualSyncResult {
  state: 'idle' | 'error';
  error?: string;
  /** Un cycle tournait déjà : celui-ci l'a REJOINT au lieu d'en ouvrir un second. */
  alreadyRunning?: boolean;
  /** Exécuté par l'onglet MENEUR à notre demande (cet onglet est un suiveur). */
  delegated?: boolean;
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * Enregistre ce que le cycle émet sur le bus interne, pour le rejouer chez les
 * suiveurs — leur interface lit le même IndexedDB, mais rien ne les prévient que
 * le meneur vient d'y écrire. On capture au lieu de deviner à partir du
 * `PullResult` : les émissions viennent de readSync (installMetadata,
 * installNotes, push…), le compte rendu du cycle ne dit pas lesquelles.
 */
function captureCycleEvents(): { stop: () => SyncBroadcastEvent[] } {
  const seen = new Map<string, SyncBroadcastEvent>();
  const offs = REPLAYABLE_CHANNELS.map((channel) =>
    subscribeWebEvent(channel, (...args) => {
      if (seen.size >= MAX_BROADCAST_EVENTS) return;
      let key: string;
      try {
        key = args.length === 0 ? channel : `${channel}:${JSON.stringify(args)}`;
      } catch {
        return; // charge non sérialisable : elle ne passerait pas le canal
      }
      if (!seen.has(key)) seen.set(key, { channel, args });
    })
  );
  return {
    stop: () => {
      for (const off of offs) off();
      return [...seen.values()];
    },
  };
}

/**
 * Le verrou de cycle est-il tenu par un cycle encore CRÉDIBLE ? Un cycle plus
 * vieux que le plafond est déclaré abandonné : on relâche et on journalise,
 * plutôt que de laisser l'onglet muet pour toujours.
 */
function cycleLocked(): boolean {
  if (!_running) return false;
  if (Date.now() - _runningSince < CYCLE_STUCK_MS) return true;
  console.warn(
    `[webSync] cycle figé depuis ${Math.round((Date.now() - _runningSince) / 1000)} s — ` +
      'verrou relâché (réseau bloqué ?), la sync repart.'
  );
  _running = false;
  return false;
}

/**
 * `requeueIfBusy` : la demande porte des modifications qui doivent partir (un
 * suiveur qui a écrit, notre propre debounce). Refusée pour cause de verrou,
 * elle est MÉMORISÉE et rejouée par le `finally` du cycle en cours — la mise en
 * file est synchrone, il n'y a donc pas de fenêtre où le cycle sortant l'aurait
 * déjà manquée.
 */
async function runCycle(
  reason: string,
  requeueIfBusy = false,
  manual = false
): Promise<CycleReport> {
  if (cycleLocked()) {
    if (requeueIfBusy) _queuedCycle = reason;
    return { outcome: 'busy' };
  }
  // Sync en pause : seuls les cycles AUTOMATIQUES s'abstiennent. Un clic
  // explicite passe outre (voir syncPause.ts).
  if (!manual && isSyncPaused(await getActiveProfileId())) {
    return { outcome: 'paused' };
  }
  const gen = _generation;
  const token = ++_runToken;
  _running = true;
  _runningSince = Date.now();
  _lastCycleAt = Date.now();
  console.info(`[webSync] cycle (${reason})`);
  const capture = captureCycleEvents();
  try {
    const profileId = await getActiveProfileId();
    if (gen !== _generation) return { outcome: 'busy' };
    if (!profileId) return { outcome: 'failed', error: 'Aucun profil actif' };
    /**
     * LE PROFIL QU'ON SYNCHRONISE DOIT ÊTRE CELUI DU COMPTE CONNECTÉ.
     *
     * La session web est celle du navigateur, pas du profil : pendant « + Ajouter
     * un compte », ou après avoir ouvert le profil d'un autre compte, le profil
     * actif n'est pas celui de la session — pousser son contenu irait remplir
     * le mauvais compte, et tirer le manifeste du mauvais compte le mélangerait
     * au sien. Un profil SANS compte ne se synchronise pas non plus : la
     * restauration (sync:setSessionKey) estampille ceux qui appartiennent au
     * compte avant le premier cycle, et un rattachement passe par une connexion
     * explicite dans le profil.
     */
    const guard = await profileMatchesSession(profileId);
    if (guard) return { outcome: 'failed', error: guard };
    /*
      MAGASIN SUR LE RÉSEAU DE L'UTILISATEUR : ON NE TENTE PAS.

      La cible de stockage est un réglage de COMPTE : elle a pu être déclarée
      depuis l'ordinateur, et ce navigateur ne joindra jamais un NAS. Partir
      quand même produirait des erreurs réseau à chaque cycle, toutes les vingt
      secondes, sans jamais dire à l'utilisateur ce qui se passe réellement.

      On sort avec une raison LISIBLE plutôt qu'avec un échec de transport.
    */
    if (await isStoreOutOfReachFromBrowser(profileId)) {
      return {
        outcome: 'failed',
        error:
          'Ce compte utilise un magasin sur votre réseau local, hors de portée depuis un navigateur. La synchronisation se fait depuis l’application de bureau.',
      };
    }
    const { pullFromCloud } = await import('./readSync');
    if (gen !== _generation) return { outcome: 'busy' };
    // `pullFromCloud` porte en plus le verrou de cycle PARTAGÉ (readSync) : un
    // « Synchroniser maintenant » parti d'ailleurs est REJOINT, jamais doublé.
    const result = await pullFromCloud(profileId);
    if (gen !== _generation) return { outcome: 'busy' };
    if (result.error) {
      console.warn(`[webSync] cycle (${reason}) :`, result.error);
      return { outcome: 'failed', error: result.error };
    }
    /**
     * LES NOTES, QUAND CE PROFIL EST EN v2.
     *
     * Étape à part, APRÈS le cycle ordinaire : en v2 les notes ne sont pas des
     * entrées de manifeste, leur index est leur manifeste (voir
     * `webNotesCycleV2`). Rend `ran: false` — au prix d'une lecture de clé
     * absente — tant qu'aucun ordinateur n'a migré ce profil, c'est-à-dire
     * pour tout le monde aujourd'hui.
     *
     * NE JETTE PAS : un cycle de notes en échec ne doit pas faire échouer celui
     * des fichiers, qui n'a rien à voir avec ça.
     */
    /**
     * ⚠ DÉTACHÉ, POUR LA MÊME RAISON QUE LE CANAL. Le cycle des notes v2 est
     * une unité de travail INDÉPENDANTE de celle des fichiers : l'attendre
     * allongeait la chaîne d'`await` de `runCycle` et décalait la séquence que
     * les contrats du meneur observent. Un verrou d'exclusion l'empêche de se
     * chevaucher lui-même.
     */
    if (!_notesCycleRunning) {
      _notesCycleRunning = true;
      const tache = setTimeout(() => {
        void (async () => {
          try {
            const { runWebNotesCycleV2 } = await import('./webNotesCycleV2');
            const notes = await runWebNotesCycleV2(profileId);
            if (notes.contentChanged) {
              // Le renderer tient son coffre en mémoire : sans ce signal, ce
              // qui vient d'arriver n'apparaîtrait qu'au prochain chargement.
              emitWebEvent('notes-updated');
            }
          } catch (err) {
            console.error('[webSync] cycle des notes v2 échoué (non bloquant) :', err);
          } finally {
            _notesCycleRunning = false;
          }
        })();
      }, 0);
      tache.unref?.();
    }

    // Un cycle complet réussi rétablit session, réseau ET version connue :
    // le sondage peut repartir.
    _probeFailures = 0;
    _probeSuspended = false;
    return { outcome: 'ok' };
  } catch (err) {
    console.warn(`[webSync] cycle (${reason}) échoué :`, err);
    const message = err instanceof Error ? err.message : String(err);
    return gen === _generation ? { outcome: 'failed', error: message } : { outcome: 'busy' };
  } finally {
    // Une session repartie a son propre verrou : ne pas le lui ouvrir. Un cycle
    // déjà déclaré abandonné (chien de garde) non plus — le jeton le dit.
    const mine = gen === _generation && _runToken === token;
    if (mine) _running = false;
    // Un tour de microtâche avant la récolte : `emitWebEvent` livre ses
    // abonnés en microtâche, les dernières émissions du cycle sont encore en
    // vol au moment où l'on sort d'ici.
    void Promise.resolve().then(() => {
      const events = capture.stop();
      if (gen !== _generation) return;
      broadcastCycleEvents(events);
      // La demande mise en file pendant qu'on travaillait : consommée ICI, une
      // seule fois, et sans se remettre en file (pas de boucle possible).
      const queued = _queuedCycle;
      _queuedCycle = null;
      if (mine && queued !== null) void runCycle(queued);
    });
  }
}

function noteProbeFailure(): void {
  if (++_probeFailures >= PROBE_MAX_FAILURES) _probeSuspended = true;
}

// ── Cycle manuel (bouton « Synchroniser ») ──────────────────────────────────

/** Rejoint le cycle en vol par le verrou PARTAGÉ de readSync, et rend son sort. */
async function joinInFlight(profileId: string): Promise<ManualSyncResult> {
  const { pullFromCloud } = await import('./readSync');
  const result = await pullFromCloud(profileId);
  return result.error
    ? { state: 'error', error: result.error, alreadyRunning: true }
    : { state: 'idle', alreadyRunning: true };
}

/**
 * Cycle manuel exécuté PAR CET ONGLET. Un cycle déjà en vol est REJOINT (le
 * verrou de readSync rend sa promesse) plutôt que refusé : l'utilisateur qui
 * clique veut un résultat, pas un « occupé ».
 */
async function runManualHere(reason: string, profileId?: string): Promise<ManualSyncResult> {
  const join = async (): Promise<ManualSyncResult> => {
    const pid = profileId ?? (await getActiveProfileId());
    if (!pid) return { state: 'error', error: 'Aucun profil actif' };
    return joinInFlight(pid);
  };
  if (cycleLocked()) return join();
  const report = await runCycle(reason, false, true);
  if (report.outcome === 'ok') return { state: 'idle' };
  // `busy` = le verrou a été pris entre-temps, ou la session a tourné : le
  // cycle en vol fait foi, on attend le sien plutôt que de rendre un échec.
  if (report.outcome === 'busy') return join();
  return { state: 'error', error: report.error ?? 'Synchronisation impossible' };
}

/**
 * LE BOUTON « Synchroniser » (canal `sync:triggerSync`). Doit conclure DANS TOUS
 * LES CAS, et surtout dans un onglet SUIVEUR : celui-ci ne peut pas cycler pour
 * son compte sans pousser en même temps que le meneur, mais il ne doit pas non
 * plus rester muet. Il délègue donc, et se rabat sur un cycle local si personne
 * ne lui répond.
 */
export async function requestManualSync(explicitProfileId?: string): Promise<ManualSyncResult> {
  const active = await getActiveProfileId();
  const profileId = explicitProfileId || active;
  if (!profileId) return { state: 'error', error: 'Aucun profil actif' };

  const suiveur = _started && !isSyncLeader() && profileId === active;
  if (suiveur) {
    // Retour visible immédiat : le meneur travaille, mais c'est ICI qu'on a
    // cliqué. Le verdict (et le vrai `lastSyncAt`) arrivent ensuite.
    emitWebEvent('sync-status-changed', { state: 'syncing' });
    const answer = await requestLeaderCycle('manuel-suiveur', {
      ackMs: MANUAL_ACK_MS,
      answerMs: MANUAL_ANSWER_MS,
    });
    if (answer.answered) {
      emitWebEvent(
        'sync-status-changed',
        answer.ok
          ? { state: 'idle' }
          : { state: 'error', error: answer.error ?? 'Synchronisation impossible' }
      );
      if (!answer.ok) {
        return {
          state: 'error',
          delegated: true,
          error: answer.error ?? 'Synchronisation impossible',
        };
      }
      return answer.queued
        ? { state: 'idle', delegated: true, alreadyRunning: true }
        : { state: 'idle', delegated: true };
    }
    console.warn(
      '[webSync] cycle manuel : aucun meneur n’a répondu — cet onglet s’en charge lui-même.'
    );
  }
  return runManualHere('manuel', profileId);
}

/**
 * Demande de cycle d'un SUIVEUR qui porte des modifications, avec filet : si
 * personne n'accuse réception (meneur gelé — le navigateur ne lui reprend son
 * verrou qu'à la mort de l'onglet), ce sont NOS modifications qui resteraient
 * dans ce navigateur pour toujours. On les pousse alors nous-mêmes.
 */
async function askLeaderOrRunHere(reason: string): Promise<void> {
  const answer = await requestLeaderCycle(reason, {
    ackMs: MANUAL_ACK_MS,
    answerMs: MANUAL_ANSWER_MS,
  });
  if (answer.acked) return; // quelqu'un a entendu : il cycle, ou l'a mis en file
  console.warn(
    `[webSync] cycle (${reason}) : aucun meneur n’a accusé réception — ` +
      'cet onglet pousse ses modifications lui-même.'
  );
  await runCycle(reason, true);
}

/**
 * `pourSuiveurVisible` : la demande vient d'un AUTRE onglet, celui-là visible —
 * la garde de visibilité de CET onglet-ci n'a alors rien à dire.
 */
async function probeRemote(reason: string, pourSuiveurVisible = false): Promise<void> {
  if (cycleLocked() || _probing || _probeSuspended) return;
  if (!pourSuiveurVisible && !isVisible()) return;
  if (Date.now() - _lastProbeAt < PROBE_MIN_GAP_MS) return;
  _lastProbeAt = Date.now();
  const gen = _generation;
  _probing = true;
  try {
    const profileId = await getActiveProfileId();
    if (gen !== _generation || !profileId) return;
    const { probeManifestChanged } = await import('./readSync');
    if (gen !== _generation) return;
    const verdict = await probeManifestChanged(profileId);
    if (gen !== _generation) return; // session morte : verdict sans valeur
    if (verdict === 'unauthorized') {
      // La restauration de session a son propre chemin : ne pas boucler dessus.
      _probeSuspended = true;
      return;
    }
    if (verdict === 'error') {
      noteProbeFailure();
      return;
    }
    _probeFailures = 0;
    if (verdict !== 'changed') return;
    console.info(`[webSync] changement distant détecté (${reason})`);
    // Seul un VRAI échec compte pour le back-off : un cycle qui rend `busy`
    // n'a rien tenté (verrou), le prendre pour un échec suspendait le sondage
    // sur une simple contention.
    if ((await runCycle('changement-distant')).outcome === 'failed') noteProbeFailure();
  } catch {
    if (gen === _generation) noteProbeFailure();
  } finally {
    if (gen === _generation) _probing = false;
  }
}

/**
 * Demande de fraîcheur, la nôtre ou celle d'un suiveur visible. Le sondage est
 * bien moins cher qu'un cycle : il passe devant. Le cycle complet ne reprend la
 * main que si le périodique a été étranglé pendant que l'onglet dormait (les
 * navigateurs bornent setInterval en arrière-plan).
 */
function handleWake(reason: string): void {
  if (Date.now() - _lastCycleAt > CYCLE_MS) {
    void runCycle(reason);
    return;
  }
  void probeRemote(reason, true);
}

function onVisibility(): void {
  if (document.visibilityState !== 'visible') return;
  if (!isSyncLeader()) {
    askLeaderToWake('retour-onglet-suiveur');
    return;
  }
  handleWake('retour-onglet');
}

function onPendingMarked(): void {
  if (_debounce) clearTimeout(_debounce);
  _debounce = setTimeout(() => {
    if (isSyncLeader()) {
      // Des modifications attendent : si un cycle tient le verrou, la demande
      // est mise en file plutôt que jetée.
      void runCycle('modification', true);
      return;
    }
    // Le registre des remontées est PARTAGÉ (IndexedDB) : le meneur poussera
    // nos modifications avec les siennes, il suffit de le réveiller — mais on
    // vérifie qu'il y a bien quelqu'un au bout du canal.
    void askLeaderOrRunHere('modification-suiveur');
  }, DEBOUNCE_MS);
}

function replayLeaderEvents(events: SyncBroadcastEvent[]): void {
  for (const event of events) emitWebEvent(event.channel, ...event.args);
  // Le meneur vient peut-être de vider des entrées en attente : sans cela, le
  // garde-fou de fermeture d'onglet réclamerait des modifications déjà parties.
  void refreshPendingCount();
}

function startLeaderDuties(): void {
  if (_interval) return;
  console.info('[webSync] onglet meneur (cycle 5 min, sondage 20 s, debounce 10 s)');
  stopFollowerDuties();
  _interval = setInterval(() => void runCycle('périodique'), CYCLE_MS);
  _probeInterval = setInterval(() => {
    // PREUVE DE VIE à chaque tic, AVANT le sondage : un suiveur doit pouvoir
    // distinguer « le meneur travaille » de « le meneur est mort », y compris
    // quand le meneur est caché et que son propre sondage se tait.
    announceLeaderAlive(_running);
    void probeRemote('sondage');
  }, PROBE_MS);
  announceLeaderAlive(false);
  /**
   * LE CANAL EST UN DEVOIR DE MENEUR, comme le sondage et pour la même raison :
   * un socket par onglet, ce serait N cycles concurrents pour un utilisateur.
   * Il DEVANCE les deux horloges sans les remplacer — canal muet, non déployé
   * ou onglet gelé, et tout se comporte exactement comme avant.
   */
  /**
   * ⚠ DÉTACHÉ SUR UNE MACROTÂCHE, ET CE N'EST PAS UN DÉTAIL DE STYLE.
   *
   * L'ouverture du canal est du travail de fond : elle ne doit ni retarder, ni
   * réordonner ce que fait le meneur en prenant ses fonctions. Accrochée à la
   * chaîne de promesses de `startLeaderDuties`, elle décalait la séquence
   * observable — battement de cœur, premier cycle — et faisait tomber quinze
   * contrats de `syncLeader` qui ne parlent pourtant ni de canal, ni de réseau.
   *
   * L'import est PARESSEUX pour la même raison : `webSyncChannel` tire
   * `webApiBase`, donc toute la couche réseau, dans le graphe de module de
   * l'ordonnanceur. Le fichier fait déjà ça pour `readSync`.
   */
  const demarrerCanal = setTimeout(() => {
    void (async () => {
      const profileId = await getActiveProfileId();
      // Le meneur a pu changer (ou l'ordonnanceur s'arrêter) entre-temps.
      if (!profileId || !_interval) return;
      const { resetWebSyncChannelAvailability, startWebSyncChannel } =
        await import('./webSyncChannel');
      resetWebSyncChannelAvailability();
      startWebSyncChannel(profileId, () => {
        void runCycle('canal');
      });
    })();
  }, 0);
  demarrerCanal.unref?.();
  void runCycle('démarrage');
}

function stopLeaderDuties(): void {
  if (_interval) clearInterval(_interval);
  if (_probeInterval) clearInterval(_probeInterval);
  _interval = null;
  _probeInterval = null;
  // Cesser d'être meneur, c'est aussi rendre le canal : le nouveau meneur
  // l'ouvrira. Deux sockets pour un même profil se partageraient les cycles.
  // Détaché et paresseux comme l'ouverture — voir plus haut.
  void import('./webSyncChannel').then((m) => m.stopWebSyncChannel());
}

function startFollowerDuties(): void {
  if (_followerInterval) return;
  // Tant qu'on regarde CET onglet, la cadence de 20 s doit tenir même si le
  // meneur est caché : sa propre garde de visibilité le tairait.
  _followerInterval = setInterval(() => {
    if (isVisible()) askLeaderToWake('sondage-suiveur');
  }, PROBE_MS);
}

function stopFollowerDuties(): void {
  if (_followerInterval) clearInterval(_followerInterval);
  _followerInterval = null;
}

export function startSyncScheduler(): void {
  if (_started) return; // déjà démarré
  _started = true;
  console.info('[webSync] scheduler démarré');
  _unsubscribe = subscribeWebEvent('web:pending-marked', onPendingMarked);
  document.addEventListener('visibilitychange', onVisibility);
  // Amorce le compteur synchrone du garde-fou beforeunload (registre possiblement
  // non vide d'une session précédente ; l'écouteur vit dans pendingUploads).
  void refreshPendingCount();
  // Suiveur d'abord : l'élection peut promouvoir sur-le-champ (mode repli), et
  // `startLeaderDuties` remplace alors ces devoirs par les siens.
  startFollowerDuties();
  startSyncLeader(
    {
      onBecomeLeader: startLeaderDuties,
      onWakeRequest: handleWake,
      // Le suiveur a des modifications en attente : sa demande ne se perd pas
      // si un cycle tient déjà le verrou. Une demande IDENTIFIÉE (un clic sur
      // « Synchroniser ») attend en plus un verdict : elle rejoint le cycle en
      // vol au lieu d'être mise en file, pour pouvoir répondre.
      onCycleRequest: (reason, id) => {
        if (id === undefined) {
          void runCycle(reason, true);
          return;
        }
        // Même mise en file (une demande porte des modifications qui doivent
        // partir), mais avec un compte rendu : le demandeur attend un verdict.
        void runCycle(reason, true).then(
          (report) => {
            if (report.outcome === 'busy') {
              announceCycleDone(id, true, undefined, true);
              return;
            }
            announceCycleDone(id, report.outcome === 'ok', report.error);
          },
          (err: unknown) =>
            announceCycleDone(id, false, err instanceof Error ? err.message : String(err))
        );
      },
      onLeaderEvents: replayLeaderEvents,
    },
    { heartbeatMs: PROBE_MS }
  );
}

export function stopSyncScheduler(): void {
  // Périme sondages et cycles EN VOL avant tout le reste.
  _generation += 1;
  stopLeaderDuties();
  stopFollowerDuties();
  if (_debounce) clearTimeout(_debounce);
  _unsubscribe?.();
  _debounce = null;
  _unsubscribe = null;
  _started = false;
  _running = false;
  _runningSince = 0;
  _queuedCycle = null;
  _probing = false;
  _probeFailures = 0;
  _probeSuspended = false;
  _lastProbeAt = 0;
  // La carte des versions connues appartient à la session : la laisser vivre
  // ferait juger le prochain profil (ou le prochain compte) sur des ETags
  // qui ne sont pas les siens.
  clearServerVersions();
  document.removeEventListener('visibilitychange', onVisibility);
  // Rend le rôle en dernier : un onglet en attente est promu dans la foulée.
  stopSyncLeader();
}
