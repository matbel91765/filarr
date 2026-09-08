/**
 * Élection d'un onglet MENEUR pour la sync web — un seul onglet sonde, cycle et
 * pousse ; les autres délèguent.
 *
 * POURQUOI. L'ordonnanceur est une variable de MODULE : chaque onglet ouvert sur
 * l'application en fait tourner un exemplaire complet. Avec N onglets, c'était N
 * sondages toutes les 20 s (chacun coûte une authentification + une lecture D1
 * côté Worker, et `GET /sync/manifest/:profileId` n'est pas limité en débit) et,
 * bien pire, N cycles complets concurrents pouvant pousser en même temps — le
 * verrou de cycle de `readSync` est lui aussi par onglet, il ne les sérialise
 * pas entre eux.
 *
 * MÉCANIQUE. `navigator.locks` : le meneur prend `filarr-sync-leader` en
 * exclusif et le garde pour TOUTE la vie de l'onglet (la promesse rendue au
 * gestionnaire de verrous n'est résolue qu'à l'arrêt). C'est ce qui rend Web
 * Locks supérieur à un bail localStorage : le navigateur libère le verrou tout
 * seul à la fermeture de l'onglet, au plantage ou à la mise en veille du
 * processus — aucun bail à faire expirer, aucun meneur fantôme. Les autres
 * onglets restent en file d'attente ; dès que le meneur disparaît, l'un d'eux
 * est promu sans rien avoir à sonder.
 *
 * DIALOGUE (BroadcastChannel `filarr-sync`) : un suiveur n'est pas muet.
 *  - `wake` : « un onglet visible veut de la fraîcheur » — le meneur sonde (ou
 *    cycle si son dernier cycle est trop vieux). C'est ce qui garde la cadence
 *    de 20 s quand le meneur est un onglet CACHÉ et le suiveur celui qu'on
 *    regarde ;
 *  - `cycle` : « j'ai des modifications locales en attente » — le meneur lance
 *    un cycle complet (le registre des remontées est partagé, il poussera les
 *    nôtres avec les siennes). La demande porte un IDENTIFIANT et attend une
 *    réponse : accusé immédiat (`status` avec le même identifiant), puis `done`
 *    à la fin. Sans accusé, le demandeur sait que personne n'écoute et fait le
 *    travail lui-même, au lieu de laisser ses modifications en rade ;
 *  - `done` : verdict d'une demande identifiée — succès, ou l'erreur telle
 *    quelle. Sans lui, un suiveur ne saurait jamais si sa demande a abouti ;
 *  - `events` : le meneur annonce aux suiveurs ce que son cycle a changé, pour
 *    qu'ils rafraîchissent leur interface. Liste blanche stricte : le canal est
 *    ouvert à tout l'origine, on ne rejoue que des canaux internes connus ;
 *  - `status` : BATTEMENT DE CŒUR. Le meneur en émet un à chaque tic et en
 *    réponse immédiate à toute demande. Sans lui, un suiveur ne distingue pas
 *    « le meneur travaille » de « le meneur est mort » : il attendrait
 *    indéfiniment un cycle que personne ne fera. Deux périodes de silence et le
 *    suiveur journalise puis TENTE une promotion — par `ifAvailable`, donc sans
 *    jamais pouvoir créer un second meneur (le gestionnaire de verrous refuse).
 *
 * REPLI. Sans `navigator.locks` OU sans `BroadcastChannel` (environnement de
 * test, contexte non sécurisé, vieux navigateur), pas d'élection : chaque onglet
 * redevient son propre meneur, exactement comme avant. Les deux API sont exigées
 * ENSEMBLE — un onglet suiveur sans canal serait incapable de faire remonter ses
 * modifications, ce qui les perdrait jusqu'à sa promotion. Ce repli est
 * JOURNALISÉ BRUYAMMENT : c'est le mode où N onglets refont N cycles, et le
 * découvrir dans une console est le seul moyen de le voir venir.
 */

/** Nom du verrou — partagé par tous les onglets de l'origine. */
const LEADER_LOCK = 'filarr-sync-leader';
/** Nom du canal de dialogue meneur ↔ suiveurs. */
const CHANNEL_NAME = 'filarr-sync';

/**
 * Les seuls canaux internes qu'un meneur peut faire rejouer à un suiveur. Sert
 * aussi de liste de capture côté meneur : une seule source de vérité.
 */
export const REPLAYABLE_CHANNELS: readonly string[] = [
  'folders-updated',
  'files-updated',
  'notes-updated',
  'profiles-updated',
  'sync-file-status-changed',
  'sync-status-changed',
];

/** Un événement du bus interne tel qu'il voyage sur le canal. */
export interface SyncBroadcastEvent {
  channel: string;
  args: unknown[];
}

type LeaderMessage =
  | { type: 'wake'; reason: string }
  | { type: 'cycle'; reason: string; id?: string }
  | { type: 'events'; events: SyncBroadcastEvent[] }
  | { type: 'status'; busy: boolean; id?: string }
  | { type: 'done'; id: string; ok: boolean; error?: string; queued?: boolean };

export interface SyncLeaderHandlers {
  /** Ce onglet vient de prendre le rôle : il doit démarrer ses minuteries. */
  onBecomeLeader(): void;
  /** Un suiveur visible réclame de la fraîcheur (sondage, ou cycle si vieux). */
  onWakeRequest(reason: string): void;
  /**
   * Un suiveur a des modifications en attente : cycle complet. `id` présent =
   * demande IDENTIFIÉE : le demandeur attend un verdict (`announceCycleDone`).
   */
  onCycleRequest(reason: string, id?: string): void;
  /** Le meneur a fini un cycle : rejouer ses événements chez le suiveur. */
  onLeaderEvents(events: SyncBroadcastEvent[]): void;
}

/** Verdict rendu par le meneur à une demande identifiée. */
export interface LeaderCycleAnswer {
  /** Le meneur a tranché. `false` = personne n'a répondu (à l'appelant d'agir). */
  answered: boolean;
  /**
   * Un meneur a au moins ACCUSÉ RÉCEPTION. Sans accusé, il n'y a personne au
   * bout du canal : l'appelant doit faire le travail lui-même. Avec accusé mais
   * sans verdict, quelqu'un travaille — doubler le cycle n'aiderait pas.
   */
  acked: boolean;
  ok: boolean;
  error?: string;
  /** Le meneur avait un cycle en vol : le nôtre est MIS EN FILE, pas perdu. */
  queued?: boolean;
}

/** Période nominale du battement de cœur, alignée sur le tic de sondage. */
const DEFAULT_HEARTBEAT_MS = 20_000;

let _handlers: SyncLeaderHandlers | null = null;
let _channel: BroadcastChannel | null = null;
/** Résout la promesse tenue par le gestionnaire de verrous = rend le rôle. */
let _release: (() => void) | null = null;
let _leader = false;
/**
 * Jeton d'instance, incrémenté à chaque arrêt. Un verrou accordé APRÈS l'arrêt
 * (l'attente peut durer des heures) voit son jeton périmé et se retire aussitôt,
 * au lieu de promouvoir un ordonnanceur éteint.
 */
let _generation = 0;
/**
 * Annule la demande de verrou EN ATTENTE à l'arrêt. Sans elle, un onglet qui
 * verrouille/déverrouille son coffre dix fois laisse dix demandes vivantes dans
 * la file du navigateur — et la première accordée réveillerait un ordonnanceur
 * dont plus personne ne tient les rênes.
 */
let _abort: AbortController | null = null;
/** Battement de cœur : dernier signe de vie du meneur reçu par CE suiveur. */
let _lastLeaderSignal = 0;
let _heartbeatMs = DEFAULT_HEARTBEAT_MS;
let _watchdog: ReturnType<typeof setInterval> | null = null;
/** Épisode de silence déjà journalisé — sinon le message part à chaque tic. */
let _silenceLogged = false;

/**
 * Demandes de cycle IDENTIFIÉES encore sans verdict, par identifiant. Un bouton
 * « Synchroniser » cliqué dans un suiveur attend ici : sans cette table, le
 * clic partait sur le canal et personne ne revenait jamais dire ce qu'il en
 * était.
 */
interface PendingCycleRequest {
  settle: (answer: LeaderCycleAnswer) => void;
  /** Le meneur a-t-il accusé réception ? Sans accusé, nul ne travaille pour nous. */
  acked: boolean;
}
const _pendingRequests = new Map<string, PendingCycleRequest>();

let _requestSeq = 0;

function newRequestId(): string {
  const rnd =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${++_requestSeq}-${rnd}`;
}

/** L'API Web Locks est-elle réellement utilisable ici ? */
function lockManager(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

function channelCtor(): typeof BroadcastChannel | null {
  const g = globalThis as { BroadcastChannel?: typeof BroadcastChannel };
  return typeof g.BroadcastChannel === 'function' ? g.BroadcastChannel : null;
}

function isReplayable(event: unknown): event is SyncBroadcastEvent {
  if (!event || typeof event !== 'object') return false;
  const { channel, args } = event as SyncBroadcastEvent;
  return (
    typeof channel === 'string' && REPLAYABLE_CHANNELS.includes(channel) && Array.isArray(args)
  );
}

function onMessage(gen: number, data: unknown): void {
  if (gen !== _generation || !_handlers) return;
  if (!data || typeof data !== 'object') return;
  const message = data as LeaderMessage;
  if (message.type === 'wake' || message.type === 'cycle') {
    // Seul le meneur exécute : les autres suiveurs ignorent la demande.
    if (!_leader) return;
    const reason = typeof message.reason === 'string' ? message.reason : 'suiveur';
    const id = message.type === 'cycle' && typeof message.id === 'string' ? message.id : undefined;
    // ACCUSÉ IMMÉDIAT, avant de travailler : le demandeur doit savoir tout de
    // suite que quelqu'un a entendu, même si le cycle prend une minute.
    post({ type: 'status', busy: true, id });
    if (message.type === 'wake') _handlers.onWakeRequest(reason);
    else _handlers.onCycleRequest(reason, id);
    return;
  }
  if (message.type === 'status') {
    if (_leader) return;
    _lastLeaderSignal = Date.now();
    _silenceLogged = false;
    if (typeof message.id === 'string') {
      const pending = _pendingRequests.get(message.id);
      if (pending) pending.acked = true;
    }
    return;
  }
  if (message.type === 'done') {
    if (_leader || typeof message.id !== 'string') return;
    _lastLeaderSignal = Date.now();
    _silenceLogged = false;
    _pendingRequests.get(message.id)?.settle({
      answered: true,
      acked: true,
      ok: message.ok === true,
      error: typeof message.error === 'string' ? message.error : undefined,
      queued: message.queued === true,
    });
    return;
  }
  if (message.type === 'events') {
    // Le meneur ne rejoue pas ce qu'il vient lui-même d'émettre.
    if (_leader) return;
    // Des événements valent preuve de vie autant qu'un battement.
    _lastLeaderSignal = Date.now();
    _silenceLogged = false;
    const events = Array.isArray(message.events) ? message.events.filter(isReplayable) : [];
    if (events.length > 0) _handlers.onLeaderEvents(events);
  }
}

function post(message: LeaderMessage): void {
  if (!_channel) return;
  try {
    _channel.postMessage(message);
  } catch {
    /* canal fermé ou charge non clonable : la demande sera refaite au tic suivant */
  }
}

/** Prend le rôle : arrête la veille de suiveur et démarre les devoirs du meneur. */
function assumeLeadership(gen: number, release: (() => void) | null): boolean {
  if (gen !== _generation || _leader) return false;
  stopWatchdog();
  _release = release;
  _leader = true;
  _handlers?.onBecomeLeader();
  return true;
}

function stopWatchdog(): void {
  if (_watchdog) clearInterval(_watchdog);
  _watchdog = null;
}

/** Un onglet caché ne juge pas la santé du meneur — voir `startWatchdog`. */
function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * Veille du suiveur : deux périodes sans le moindre signe du meneur et on agit.
 * La tentative de promotion passe par `ifAvailable` — le gestionnaire de verrous
 * refuse net si le verrou est tenu, donc DEUX MENEURS SONT IMPOSSIBLES par
 * construction. Le meneur figé garde le verrou (le navigateur ne le rend qu'à la
 * mort de l'onglet) : le journal reste alors la seule action utile, et c'est
 * précisément lui qui manquait pour diagnostiquer un onglet muet.
 */
function startWatchdog(gen: number): void {
  if (_watchdog || typeof setInterval !== 'function') return;
  _lastLeaderSignal = Date.now();
  _silenceLogged = false;
  _watchdog = setInterval(() => {
    if (gen !== _generation || _leader) return;
    // CACHÉ = on ne juge pas. Nos minuteries sont bridées par le navigateur (et
    // celles du meneur aussi), et un onglet caché ne réclame rien, donc
    // n'attend rien : crier au meneur mort serait un faux positif systématique.
    // On repousse l'échéance pour ne pas se réveiller en accusant à tort.
    if (!isVisible()) {
      _lastLeaderSignal = Date.now();
      return;
    }
    if (Date.now() - _lastLeaderSignal < _heartbeatMs * 2) return;
    if (!_silenceLogged) {
      _silenceLogged = true;
      console.warn(
        `[webSync] aucun signe du meneur depuis plus de ${Math.round((_heartbeatMs * 2) / 1000)} s — ` +
          'cet onglet tente une promotion (le verrou reste seul juge).'
      );
    }
    tryPromote(gen);
  }, _heartbeatMs);
}

/** Promotion opportuniste, refusée d'office si le verrou est déjà tenu. */
function tryPromote(gen: number): void {
  const locks = lockManager();
  if (!locks) return;
  void Promise.resolve(
    locks.request(LEADER_LOCK, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      // `null` = verrou tenu par un meneur bien vivant : on ne force RIEN.
      if (!lock) return undefined;
      return new Promise<void>((resolve) => {
        if (!assumeLeadership(gen, resolve)) resolve();
      });
    })
  ).catch(() => {
    /* abandon ou API indisponible : le suiveur reste suiveur */
  });
}

/**
 * Entre dans l'élection. `onBecomeLeader` est appelé au plus une fois par
 * démarrage — tout de suite en mode repli, plus tard (voire jamais) sinon.
 */
export function startSyncLeader(
  handlers: SyncLeaderHandlers,
  options: { heartbeatMs?: number } = {}
): void {
  if (_handlers) return; // déjà en course
  _handlers = handlers;
  const beat = options.heartbeatMs ?? 0;
  _heartbeatMs = beat > 0 ? beat : DEFAULT_HEARTBEAT_MS;
  const gen = ++_generation;

  const locks = lockManager();
  const Channel = channelCtor();
  if (locks && Channel) {
    try {
      _channel = new Channel(CHANNEL_NAME);
    } catch (err) {
      console.warn('[webSync] canal de dialogue inutilisable :', err);
      _channel = null;
    }
  }
  if (!locks || !_channel) {
    console.warn(
      '[webSync] élection impossible (navigator.locks: ' +
        `${locks ? 'ok' : 'absent'}, BroadcastChannel: ${_channel ? 'ok' : 'absent'}) — ` +
        'cet onglet redevient son propre meneur. Avec plusieurs onglets ouverts, ' +
        'chacun sondera et cyclera pour son compte.'
    );
    _leader = true;
    handlers.onBecomeLeader();
    return;
  }

  _channel.onmessage = (event: MessageEvent) => onMessage(gen, event?.data);
  _abort = new AbortController();
  startWatchdog(gen);
  void locks
    .request(
      LEADER_LOCK,
      { mode: 'exclusive', signal: _abort.signal },
      () =>
        new Promise<void>((resolve) => {
          // Accordé après l'arrêt : rendre le verrou immédiatement.
          if (!assumeLeadership(gen, resolve)) resolve();
        })
    )
    .catch((err: unknown) => {
      // ANNULATION VOLONTAIRE (stopSyncLeader) ≠ ÉCHEC : se promouvoir sur un
      // arrêt ferait repartir un ordonnanceur qu'on vient d'éteindre.
      const aborted =
        (err instanceof Error && err.name === 'AbortError') || _abort?.signal.aborted === true;
      if (aborted || gen !== _generation || _leader) return;
      console.warn(
        '[webSync] demande de verrou de meneur refusée — cet onglet se promeut seul :',
        err
      );
      // Mieux vaut un meneur solitaire qu'un onglet muet, qui ne pousserait
      // jamais ses modifications.
      assumeLeadership(gen, null);
    });
}

export function isSyncLeader(): boolean {
  return _leader;
}

/** Suiveur visible → « sonde pour nous ». Sans effet en mode repli (pas de canal). */
export function askLeaderToWake(reason: string): void {
  post({ type: 'wake', reason });
}

/**
 * Demande IDENTIFIÉE : « fais un cycle et DIS-MOI ce qu'il en est ». C'est le
 * chemin du bouton « Synchroniser » dans un onglet suiveur — un suiveur ne peut
 * pas cycler lui-même (il pousserait en même temps que le meneur, les deux se
 * battraient sur le CAS du manifeste), mais l'utilisateur, lui, attend un
 * verdict. C'est aussi celui du debounce d'un suiveur qui a écrit : sans accusé,
 * ses modifications resteraient dans son navigateur pour toujours.
 *
 * Deux échéances : l'ACCUSÉ prouve qu'un meneur écoute (sinon on rend la main
 * tout de suite, l'appelant se rabattra sur un cycle local plutôt que de laisser
 * le bouton sans effet), le VERDICT peut prendre le temps d'un vrai cycle.
 * `answered: false` ne dit jamais « échec » : il dit « personne n'a répondu ».
 */
export function requestLeaderCycle(
  reason: string,
  options: { ackMs: number; answerMs: number }
): Promise<LeaderCycleAnswer> {
  if (!_channel || _leader) return Promise.resolve({ answered: false, acked: false, ok: false });
  const id = newRequestId();
  return new Promise<LeaderCycleAnswer>((resolve) => {
    let done = false;
    const settle = (answer: LeaderCycleAnswer): void => {
      if (done) return;
      done = true;
      _pendingRequests.delete(id);
      resolve(answer);
    };
    const entry: PendingCycleRequest = { settle, acked: false };
    _pendingRequests.set(id, entry);
    if (typeof setTimeout === 'function') {
      setTimeout(() => {
        if (!entry.acked) settle({ answered: false, acked: false, ok: false });
      }, options.ackMs);
      setTimeout(
        () => settle({ answered: false, acked: entry.acked, ok: false }),
        options.answerMs
      );
    }
    post({ type: 'cycle', reason, id });
  });
}

/** Meneur → demandeur : verdict de la demande identifiée. */
export function announceCycleDone(id: string, ok: boolean, error?: string, queued?: boolean): void {
  if (!_leader) return;
  post({ type: 'done', id, ok, error, queued });
}

/** Meneur → suiveurs : voilà ce que le cycle vient de changer. */
export function broadcastCycleEvents(events: SyncBroadcastEvent[]): void {
  if (!_leader || events.length === 0) return;
  post({ type: 'events', events });
}

/**
 * Meneur → suiveurs : « je suis vivant ». À appeler à chaque tic. Sans ce
 * signal, un suiveur ne peut pas distinguer un meneur occupé d'un meneur mort.
 */
export function announceLeaderAlive(busy: boolean): void {
  if (!_leader) return;
  post({ type: 'status', busy });
}

/**
 * Quitte l'élection : annule la demande de verrou EN ATTENTE, rend le verrou
 * TENU (un onglet en file est promu dans la foulée) et ferme le canal.
 */
export function stopSyncLeader(): void {
  // Périme d'abord : une promotion en vol ne doit plus rien réveiller.
  _generation += 1;
  stopWatchdog();
  // Un clic en attente de verdict ne doit pas rester pendu à un canal qu'on
  // ferme : il rend la main, l'appelant tranchera.
  for (const pending of [..._pendingRequests.values()]) {
    pending.settle({ answered: false, acked: pending.acked, ok: false });
  }
  _pendingRequests.clear();
  const release = _release;
  _release = null;
  _leader = false;
  _handlers = null;
  release?.();
  if (_abort) {
    try {
      _abort.abort();
    } catch {
      /* AbortController déjà consommé */
    }
    _abort = null;
  }
  if (_channel) {
    _channel.onmessage = null;
    try {
      _channel.close();
    } catch {
      /* déjà fermé */
    }
    _channel = null;
  }
}
