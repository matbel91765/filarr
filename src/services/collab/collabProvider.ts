/**
 * Fournisseur Yjs maison, chiffré de bout en bout.
 *
 * Il fait exactement trois choses : chiffrer ce qui sort, déchiffrer ce qui
 * entre, et survivre au réseau. Il ne décide RIEN sur le document — le CRDT
 * converge sans autorité — et il n'écrit RIEN dans le magasin de notes.
 *
 * Le repli est la propriété la plus importante du fichier : coffre verrouillé,
 * hors ligne, 401, relais absent, drapeau éteint… chaque échec se solde par un
 * changement d'état et rien d'autre. L'édition locale continue par le chemin
 * habituel (Y.Doc + persistance IndexedDB + sync périodique).
 *
 * PROTOCOLE D'ENTRÉE EN SALLE
 *   1. à l'ouverture : SyncStep1 (notre vecteur d'état) ;
 *   2. le relais rejoue son journal, puis annonce Control/ReplayDone ;
 *   3. à la réception d'un SyncStep1 d'un pair : SyncStep2 (le différentiel
 *      calculé pour SON vecteur) — jamais de SyncStep1 en retour, c'est ce qui
 *      empêche le ping-pong infini entre deux pairs ;
 *   4. une fois à jour : UN instantané complet, qui propage nos éventuelles
 *      modifications hors ligne à tous les pairs ET donne au relais son point
 *      de compaction.
 *
 * RÈGLE DE COMPACTION — un client N'ÉMET JAMAIS d'instantané avant d'être à
 * jour. Sinon un relais qui oublie tout ce qui précède un instantané perdrait
 * l'historique au profit de l'état partiel d'un arrivant.
 */

import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import {
  COLLAB_MAX_SEND_BYTES,
  CollabControl,
  CollabFrameKind,
  decryptFrame,
  encryptFrame,
  KEEPALIVE_REQUEST,
  KEEPALIVE_RESPONSE,
  toBytes,
} from './collabProtocol';
import { getRoomKey } from './collabKeys';
import { closeDisposition, requestRoomTicket, type RoomTicket } from './collabTicket';

// ==================== Types ====================

export type CollabStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'synced'
  | 'offline'
  | 'unavailable'
  /**
   * La salle est PLEINE : le plafond de pairs simultanés est atteint.
   *
   * DISTINCT d'`offline`, qui dit « ça reviendra tout seul ». Ici la place ne
   * se libérera que si quelqu'un ferme la note ailleurs — ce qui peut ne jamais
   * arriver. On continue de réessayer, mais l'écran doit pouvoir le DIRE :
   * confondu avec une coupure réseau, ce refus faisait disparaître la frappe en
   * direct sans que rien ne l'explique.
   */
  | 'room-full'
  /**
   * Le serveur a refusé l'accès à la salle — on n'est plus membre du coffre.
   *
   * DISTINCT d'`unavailable`, qui dit « pas de clé pour l'instant » (coffre
   * verrouillé) et se répare tout seul au déverrouillage. Les confondre laissait
   * l'exclusion se lire comme un état passager : l'écran affichait « hors
   * ligne », la session comptait comme vivante, et l'enregistrement automatique
   * repartait toutes les six secondes contre un serveur qui refusait.
   */
  | 'denied'
  | 'destroyed';

/** Surface minimale d'un WebSocket — permet d'en injecter un faux dans les tests. */
export interface CollabSocketLike {
  readyState: number;
  binaryType?: string;
  // `string` pour le seul battement de cœur : tout le reste du protocole est
  // binaire et chiffré, et le relais ferme le canal sur tout autre texte.
  send(data: ArrayBuffer | ArrayBufferView | string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface CollabStats {
  framesSent: number;
  framesReceived: number;
  /** Messages écartés : tag GCM invalide, en-tête inconnu, trame tronquée. */
  decryptFailures: number;
  /** Mises à jour locales perdues faute de canal ouvert (rattrapées à la reconnexion). */
  updatesDropped: number;
  reconnects: number;
  snapshotsSent: number;
  lastError: string | null;
}

export interface CollabProviderOptions {
  noteId: string;
  profileId: string;
  doc: Y.Doc;
  /** Présence. Le fournisseur ne la possède PAS : il ne la détruit jamais. */
  awareness?: Awareness;
  /**
   * Injection de test — par défaut `new WebSocket(url, protocols)` en binaire.
   * Les sous-protocoles portent le JETON : ils ne sont jamais optionnels.
   */
  createSocket?: (url: string, protocols: string[]) => CollabSocketLike;
  /** Injection de test — par défaut `requestRoomTicket`. */
  resolveTicket?: () => Promise<RoomTicket | 'denied' | null>;
  /** Injection de test — par défaut `getRoomKey(noteId)`. */
  resolveKey?: () => Promise<CryptoKey | null>;
  /**
   * Billet obtenu. Le seul intérêt côté client est le RÔLE que le relais y a
   * inscrit : il fait autorité sur ce que la salle relaiera. Appelé à chaque
   * ouverture, donc un changement de rôle en cours de route finit par arriver.
   */
  onTicket?: (ticket: RoomTicket) => void;
  onStatus?: (status: CollabStatus) => void;
  /** Regroupement des mises à jour locales (ms). 0 = envoi immédiat. */
  batchMs?: number;
  /** Période des instantanés complets (ms). */
  snapshotIntervalMs?: number;
  /** Délai au-delà duquel on se considère à jour sans Control/ReplayDone. */
  syncGraceMs?: number;
  reconnectBaseMs?: number;
  reconnectCapMs?: number;
  /**
   * Durée d'ouverture au-delà de laquelle une connexion compte comme
   * RÉELLEMENT établie (voir `_handleOpen`). Sert de repli quand le relais
   * n'annonce jamais la fin de son rejeu.
   */
  stableAfterMs?: number;
  /**
   * Période du battement de cœur (ms). 0 le désactive — utile en test.
   *
   * Vingt secondes : assez court pour qu'un canal à demi-ouvert soit détecté
   * bien avant les trente secondes de péremption d'`Awareness` (au-delà, les
   * autres auraient déjà élu quelqu'un d'autre pendant qu'on se croit encore
   * détenteur du stylo), assez long pour rester invisible sur la facture.
   */
  keepaliveMs?: number;
  /** Grâce de l'appel nominal après le départ d'un pair (ms). */
  rollCallGraceMs?: number;
}

const SOCKET_OPEN = 1;

const DEFAULTS = {
  batchMs: 40,
  snapshotIntervalMs: 45_000,
  syncGraceMs: 1_500,
  reconnectBaseMs: 1_000,
  reconnectCapMs: 30_000,
  stableAfterMs: 5_000,
  /**
   * Huit secondes, et pas douze. La coupure survient au bout de trois échéances
   * — deux pings sans réponse, puis le verdict — soit vingt-quatre secondes. La
   * contrainte n'est pas esthétique : `Awareness` périme un pair au bout de
   * TRENTE secondes, et un battement qui découvre la panne après cette échéance
   * ne devance plus rien. À douze secondes, le verdict tombait à trente-six.
   */
  keepaliveMs: 8_000,
  rollCallGraceMs: 1_500,
};

// ==================== Fournisseur ====================

export class CollabProvider {
  readonly noteId: string;
  readonly profileId: string;
  readonly doc: Y.Doc;
  readonly awareness: Awareness | null;

  private _status: CollabStatus = 'idle';
  private _socket: CollabSocketLike | null = null;
  private _key: CryptoKey | null = null;
  private _destroyed = false;
  private _synced = false;
  private _attempt = 0;
  /**
   * Jeton de génération d'ouverture. Une ouverture traverse deux `await` (clé
   * puis billet) : sans lui, une seconde ouverture démarrée entre-temps
   * laisserait le premier socket s'installer par-dessus et tuer le vivant.
   * Toute reprise après un `await` vérifie que sa génération est TOUJOURS la
   * courante, sinon elle abandonne — en refermant ce qu'elle a créé.
   */
  private _generation = 0;
  /**
   * Refus définitif du relais (signature fausse, mauvaise salle, autre compte…) :
   * plus aucune replanification, l'édition reste locale.
   */
  private _givenUp = false;
  /** Le document a-t-il bougé depuis le dernier instantané émis ? */
  private _snapshotDirty = false;

  /** Tous les minuteurs vivants, pour qu'AUCUN ne survive à `destroy()`. */
  private _timers = new Set<ReturnType<typeof setTimeout>>();
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _graceTimer: ReturnType<typeof setTimeout> | null = null;
  private _stableTimer: ReturnType<typeof setTimeout> | null = null;
  /** Battement de cœur : émetteur périodique et compteur d'échéances manquées. */
  private _keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private _missedPongs = 0;
  /** Échéance du billet courant, pour le renouveler AVANT que le relais ne coupe. */
  private _ticketExpiresAt: number | null = null;
  private _renewTimer: ReturnType<typeof setTimeout> | null = null;

  private _pending: Uint8Array[] = [];

  private readonly _opts: Required<
    Pick<
      CollabProviderOptions,
      | 'batchMs'
      | 'snapshotIntervalMs'
      | 'syncGraceMs'
      | 'reconnectBaseMs'
      | 'reconnectCapMs'
      | 'stableAfterMs'
      | 'keepaliveMs'
      | 'rollCallGraceMs'
    >
  >;
  private readonly _createSocket: (url: string, protocols: string[]) => CollabSocketLike;
  private readonly _resolveTicket: () => Promise<RoomTicket | 'denied' | null>;
  private readonly _resolveKey: () => Promise<CryptoKey | null>;
  private readonly _onTicket?: (ticket: RoomTicket) => void;
  private readonly _onStatus?: (status: CollabStatus) => void;

  readonly stats: CollabStats = {
    framesSent: 0,
    framesReceived: 0,
    decryptFailures: 0,
    updatesDropped: 0,
    reconnects: 0,
    snapshotsSent: 0,
    lastError: null,
  };

  constructor(options: CollabProviderOptions) {
    this.noteId = options.noteId;
    this.profileId = options.profileId;
    this.doc = options.doc;
    this.awareness = options.awareness ?? null;

    this._opts = {
      batchMs: options.batchMs ?? DEFAULTS.batchMs,
      snapshotIntervalMs: options.snapshotIntervalMs ?? DEFAULTS.snapshotIntervalMs,
      syncGraceMs: options.syncGraceMs ?? DEFAULTS.syncGraceMs,
      reconnectBaseMs: options.reconnectBaseMs ?? DEFAULTS.reconnectBaseMs,
      reconnectCapMs: options.reconnectCapMs ?? DEFAULTS.reconnectCapMs,
      stableAfterMs: options.stableAfterMs ?? DEFAULTS.stableAfterMs,
      keepaliveMs: options.keepaliveMs ?? DEFAULTS.keepaliveMs,
      rollCallGraceMs: options.rollCallGraceMs ?? DEFAULTS.rollCallGraceMs,
    };
    this._createSocket = options.createSocket ?? defaultSocketFactory;
    this._resolveTicket =
      options.resolveTicket ?? (() => requestRoomTicket(this.profileId, this.noteId));
    this._resolveKey = options.resolveKey ?? (() => getRoomKey(this.noteId));
    this._onTicket = options.onTicket;
    this._onStatus = options.onStatus;

    this.doc.on('update', this._onDocUpdate);
    this.awareness?.on('update', this._onAwarenessUpdate);

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', this._onOnline);
    }
  }

  get status(): CollabStatus {
    return this._status;
  }

  get synced(): boolean {
    return this._synced;
  }

  // ---------- Cycle de vie ----------

  /**
   * Ouvre le canal. Idempotent, et sans effet après `destroy()`.
   * N'échoue jamais bruyamment : un problème se traduit par un état.
   */
  connect(): void {
    if (this._destroyed || this._givenUp) return;
    if (this._socket || this._status === 'connecting') return;
    // Une reconnexion en attente doit céder la place, sinon deux ouvertures
    // partiraient en parallèle et laisseraient un socket orphelin.
    this._clearReconnect();
    this._attempt = 0;
    void this._openChannel();
  }

  /** Ferme le canal sans détruire le fournisseur (reconnectable via `connect()`). */
  disconnect(): void {
    this._clearReconnect();
    this._teardownSocket();
    if (!this._destroyed) this._setStatus('idle');
  }

  /**
   * Arrêt propre et définitif : adieux au réseau (dernier instantané + retrait
   * de la présence), observateurs retirés, TOUS les minuteurs éteints.
   * La présence, elle, appartient à l'appelant : on ne la détruit pas.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this.doc.off('update', this._onDocUpdate);
    this.awareness?.off('update', this._onAwarenessUpdate);
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this._onOnline);
    }

    const socket = this._socket;
    const key = this._key;
    this._clearAllTimers();
    this._pending = [];

    // Adieux au mieux : si le canal est encore ouvert on pousse un dernier
    // instantané et on efface notre présence, PUIS on ferme. Aucun minuteur
    // n'est impliqué — uniquement une chaîne de promesses.
    const farewell: Array<Promise<Uint8Array | null>> = [];
    if (socket && key && socket.readyState === SOCKET_OPEN) {
      // Rien n'a bougé depuis le dernier instantané : le relais a déjà l'état.
      if (this._synced && this._snapshotDirty) {
        farewell.push(
          encryptFrame(key, CollabFrameKind.Snapshot, Y.encodeStateAsUpdate(this.doc)).catch(
            () => null
          )
        );
      }
      if (this.awareness && this.awareness.meta.has(this.awareness.clientID)) {
        // `removeAwarenessStates` incrémente l'horloge et retire l'état : le
        // ré-encoder produit exactement le « je m'en vais » que les pairs
        // attendent, sans quoi notre curseur resterait affiché 30 s.
        const clientID = this.awareness.clientID;
        removeAwarenessStates(this.awareness, [clientID], this);
        const bye = encodeAwarenessUpdate(this.awareness, [clientID]);
        farewell.push(encryptFrame(key, CollabFrameKind.Awareness, bye).catch(() => null));
      }
    }

    const finish = () => {
      this._socket = null;
      this._key = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close(1000, 'destroy');
        } catch {
          /* déjà fermé */
        }
      }
      this._setStatus('destroyed');
    };

    if (farewell.length === 0) {
      finish();
      return;
    }
    void Promise.allSettled(farewell)
      .then((results) => {
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value && socket?.readyState === SOCKET_OPEN) {
            try {
              socket.send(sendable(r.value));
              this.stats.framesSent += 1;
            } catch {
              /* canal déjà parti */
            }
          }
        }
      })
      .finally(finish);
  }

  // ---------- Ouverture ----------

  private async _openChannel(): Promise<void> {
    if (this._givenUp) return;
    // Toute ouverture antérieure encore en vol est périmée à partir d'ici.
    const generation = ++this._generation;
    const stale = (): boolean => this._destroyed || generation !== this._generation;

    this._setStatus('connecting');

    const key = await this._resolveKey();
    if (stale()) return;
    if (!key) {
      // Coffre verrouillé ou FEK absente : état NORMAL, on réessaiera.
      this._key = null;
      this.stats.lastError = 'no-room-key';
      this._setStatus('unavailable');
      this._scheduleReconnect();
      return;
    }
    this._key = key;

    const ticket = await this._resolveTicket();
    if (stale()) return;
    if (ticket === 'denied') {
      /**
       * LE SERVEUR A RÉPONDU, ET IL DIT NON — on n'est plus membre du coffre.
       *
       * Réessayer ne peut RIEN produire : l'appartenance ne revient pas toute
       * seule. Sans cet arrêt, la session redemandait un jeton toutes les trente
       * secondes indéfiniment, en affichant le même « hors ligne » qu'une
       * coupure Wi-Fi passagère ; et comme `offline` compte comme un état
       * stabilisé, une fois les autres pairs périmés l'exclu se retrouvait SEUL
       * donc élu, à pousser un enregistrement refusé toutes les six secondes.
       *
       * `unavailable` est le mot juste : la collaboration ne peut pas avoir
       * lieu, et ce n'est pas un incident de réseau.
       */
      this.stats.lastError = 'room-access-denied';
      this._givenUp = true;
      this._setStatus('denied');
      return;
    }
    if (!ticket) {
      this.stats.lastError = 'no-ticket';
      this._setStatus('offline');
      this._scheduleReconnect();
      return;
    }
    try {
      this._onTicket?.(ticket);
    } catch {
      /* un abonné qui lève ne doit pas empêcher l'ouverture */
    }
    this._ticketExpiresAt = ticket.expiresAt ?? null;

    let socket: CollabSocketLike;
    try {
      // LE JETON EST DANS LE SOUS-PROTOCOLE, jamais dans l'URL.
      socket = this._createSocket(ticket.url, ticket.protocols ?? []);
    } catch (e) {
      this.stats.lastError = `socket-open:${errorName(e)}`;
      this._setStatus('offline');
      this._scheduleReconnect();
      return;
    }
    // La fabrique peut avoir rendu la main (elle est synchrone, mais une
    // ouverture concurrente a pu se glisser avant elle) : le socket qu'on vient
    // de créer ne doit pas survivre à sa propre génération.
    if (stale()) {
      closeQuietly(socket);
      return;
    }
    // Un socket antérieur qui traînerait encore serait le seul à pouvoir tuer
    // celui-ci en se refermant : on le congédie avant de s'installer.
    this._teardownSocket();

    this._socket = socket;
    socket.onopen = () => this._handleOpen(generation);
    socket.onmessage = (ev) => void this._handleMessage(ev?.data);
    socket.onclose = (ev) => this._handleClose(ev);
    socket.onerror = () => this._handleError();
  }

  private _handleOpen(generation: number): void {
    if (this._destroyed || generation !== this._generation) return;
    this._synced = false;
    this._setStatus('connected');

    // LE COMPTEUR DE DÉGRADATION NE SE REMET PAS À ZÉRO ICI. Le relais termine
    // délibérément la poignée de main avant de refuser : un refus produit donc
    // un 'open' suivi d'un 'close', et remettre le compteur à zéro sur 'open'
    // transformerait chaque refus en tempête de reconnexion. Il ne retombe à
    // zéro qu'à la fin du rejeu (`_markSynced`) ou après quelques secondes de
    // socket réellement ouvert.
    this._stableTimer = this._later(() => {
      this._stableTimer = null;
      this._attempt = 0;
    }, this._opts.stableAfterMs);

    // 0. LE BATTEMENT DE CŒUR, sans lequel rien ne détecte un canal à demi-ouvert.
    //
    // Le relais configure déjà `setWebSocketAutoResponse` avec le couple
    // ping/pong — le runtime répond donc sans même réveiller la salle hibernée,
    // pour un coût serveur nul — et AUCUN client n'émettait jamais la requête.
    // La moitié serveur d'un keepalive existait, la moitié client n'existait pas.
    //
    // Ce que ça coûtait : quand le chemin réseau meurt sans FIN TCP (VPN qui
    // saute, machine mise en veille puis réveillée ailleurs), aucun `onclose`
    // n'arrive, `readyState` reste OPEN, et le fournisseur reste « synced ». Le
    // pair continue d'afficher « Live », se croit détenteur du stylo, et tape
    // dans le vide — pendant que les autres le périment au bout de trente
    // secondes et élisent quelqu'un d'autre. Deux élus, deux versions attendues,
    // et un 409 à son retour.
    this._startKeepalive();
    this._scheduleTicketRenewal();

    // 1. notre vecteur d'état : « voilà ce que j'ai, complétez-moi ».
    void this._sendFrame(CollabFrameKind.SyncStep1, Y.encodeStateVector(this.doc));

    // 2. notre présence, si elle est déjà posée.
    if (this.awareness && this.awareness.getLocalState() !== null) {
      void this._sendFrame(
        CollabFrameKind.Awareness,
        encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])
      );
    }

    // 3. filet : si le relais n'annonce jamais la fin de son rejeu, on se
    //    déclare à jour au bout du délai de grâce plutôt que de ne jamais
    //    émettre d'instantané.
    this._graceTimer = this._later(() => {
      this._graceTimer = null;
      this._markSynced();
    }, this._opts.syncGraceMs);

    this._startSnapshotTimer();
  }

  /**
   * Le CODE de fermeture décide de la suite. Sans lui, un refus définitif
   * (jeton mal signé, salle d'un autre compte, relais non configuré) serait
   * réessayé indéfiniment.
   */
  private _handleClose(event: unknown): void {
    if (this._destroyed) return;
    const code = closeCodeOf(event);
    this._teardownSocket();

    const disposition = closeDisposition(code);
    if (code !== null) this.stats.lastError = `close:${code}`;

    if (disposition === 'give-up') {
      this._givenUp = true;
      this._clearReconnect();
      this._setStatus('unavailable');
      return;
    }
    /**
     * SALLE PLEINE : on réessaie — la place peut se libérer — mais on le DIT.
     * L'afficher comme « hors ligne » laissait croire à une panne de réseau
     * alors que c'est une limite assumée, et que la sortie (un coffre partagé)
     * est ailleurs.
     */
    if (disposition === 'room-full') {
      this._setStatus('room-full');
      this._scheduleReconnect();
      return;
    }
    // 'renew-ticket' : `_openChannel` redemande de toute façon un billet neuf
    // à chaque tentative — il suffit de ne pas abandonner.
    this._setStatus('offline');
    this._scheduleReconnect();
  }

  private _handleError(): void {
    if (this._destroyed) return;
    this.stats.lastError = 'socket-error';
    this._teardownSocket();
    this._setStatus('offline');
    this._scheduleReconnect();
  }

  // ---------- Réception ----------

  private async _handleMessage(data: unknown): Promise<void> {
    if (this._destroyed || !this._key) return;
    // Le pong du relais est le SEUL texte attendu : il n'a rien à faire dans le
    // compteur d'échecs de déchiffrement. Tout AUTRE texte reste hors protocole
    // et continue d'y être compté — le relais, lui, ferme le canal dessus.
    if (data === KEEPALIVE_RESPONSE) {
      this._missedPongs = 0;
      return;
    }

    const bytes = toBytes(data);
    if (!bytes) {
      this.stats.decryptFailures += 1;
      return;
    }
    this.stats.framesReceived += 1;

    const frame = await decryptFrame(this._key, bytes);
    if (!frame) {
      // Message indéchiffrable : on l'IGNORE. Jamais d'exception ici — un
      // octet corrompu ne doit pas emporter la session d'édition.
      this.stats.decryptFailures += 1;
      return;
    }
    if (this._destroyed) return;

    switch (frame.kind) {
      case CollabFrameKind.Control:
        if (frame.flags === CollabControl.ReplayDone) this._markSynced();
        // UN PAIR ARRIVE : on se réannonce. La présence n'est JAMAIS journalisée
        // par le relais (contrat privacy : les curseurs ne touchent pas le
        // stockage), donc un arrivant ne reçoit aucun rejeu de présence — il ne
        // nous verrait qu'au renouvellement périodique de `Awareness`, une
        // quinzaine de secondes plus tard. C'est trop tard pour deux choses : la
        // barre de présence, et surtout l'élection du pair qui enregistre, qui
        // se ferait à deux responsables pendant tout ce temps.
        else if (frame.flags === CollabControl.PeerJoined) this._announcePresence();
        // UN PAIR PART, et le relais est le seul à le savoir tout de suite.
        //
        // Un adieu propre n'existe qu'au `destroy()` : un onglet tué ou un
        // réseau coupé n'en émet aucun. Le relais, lui, voit la fermeture et
        // envoie cette trame — que le client jetait. La présence gardait donc
        // le fantôme pendant les trente secondes de péremption d'`Awareness`,
        // en continuant de le désigner comme responsable de l'enregistrement :
        // la bande affirmait « un autre membre enregistre » alors que plus
        // personne n'écrivait.
        //
        // On ne peut pas retirer « celui qui est parti » — la trame ne le nomme
        // pas, et c'est délibéré côté relais. On procède donc par appel
        // nominal : chacun se réannonce, et ce qui n'a pas répondu au bout
        // d'une courte grâce est retiré.
        else if (frame.flags === CollabControl.PeerLeft) this._rollCall();
        break;

      case CollabFrameKind.Update:
      case CollabFrameKind.SyncStep2:
      case CollabFrameKind.Snapshot:
        try {
          Y.applyUpdate(this.doc, frame.payload, this);
        } catch {
          // Une mise à jour Yjs malformée est écartée comme un message corrompu.
          this.stats.decryptFailures += 1;
          return;
        }
        if (frame.kind !== CollabFrameKind.Update) this._markSynced();
        break;

      case CollabFrameKind.SyncStep1:
        // Un pair annonce son vecteur d'état : on lui envoie ce qui lui manque.
        // Pas de SyncStep1 en retour — c'est la garde anti-ping-pong.
        try {
          const diff = Y.encodeStateAsUpdate(this.doc, frame.payload);
          void this._sendFrame(CollabFrameKind.SyncStep2, diff);
        } catch {
          this.stats.decryptFailures += 1;
        }
        break;

      case CollabFrameKind.Awareness:
        if (this.awareness) {
          try {
            applyAwarenessUpdate(this.awareness, frame.payload, this);
          } catch {
            this.stats.decryptFailures += 1;
          }
        }
        break;

      default:
        break;
    }
  }

  /** Réémet notre état de présence, s'il y en a un à émettre. */
  private _announcePresence(): void {
    if (this._destroyed || !this.awareness) return;
    const local = this.awareness.getLocalState();
    if (local === null) return;
    /**
     * RÉÉCRIRE L'ÉTAT AVANT DE L'ENVOYER, pour que l'horloge avance.
     *
     * `encodeAwarenessUpdate` embarque l'horloge courante ; si elle n'a pas
     * bougé, `applyAwarenessUpdate` chez le pair considère l'annonce comme un
     * doublon et ne rafraîchit rien. L'appel nominal, qui cherche justement à
     * distinguer « a répondu » de « ne répond plus », ne voyait donc AUCUNE
     * réponse — et retirait des pairs parfaitement vivants.
     */
    this.awareness.setLocalState({ ...local });
    void this._sendFrame(
      CollabFrameKind.Awareness,
      encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])
    );
  }

  private _markSynced(): void {
    if (this._synced || this._destroyed) return;
    this._synced = true;
    this._clearGrace();
    // Rejeu terminé : la connexion est RÉELLEMENT établie, le compteur de
    // dégradation peut retomber sans risque de tempête.
    this._attempt = 0;
    this._clearStable();
    this._setStatus('synced');
    // Notre état complet part maintenant, et pas avant : il subsume tout ce
    // que le relais a pu nous rejouer, donc il est sûr comme point de compaction.
    this._sendSnapshot(true);
  }

  // ---------- Émission ----------

  private _onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this._destroyed) return;
    // Le document a bougé : le prochain instantané périodique a de la matière.
    this._snapshotDirty = true;
    if (origin === this) return; // c'est nous qui venons de l'appliquer
    this._pending.push(update);
    if (this._opts.batchMs <= 0) {
      this._flushUpdates();
      return;
    }
    if (this._flushTimer === null) {
      this._flushTimer = this._later(() => {
        this._flushTimer = null;
        this._flushUpdates();
      }, this._opts.batchMs);
    }
  };

  private _flushUpdates(): void {
    if (this._destroyed || this._pending.length === 0) return;
    const batch = this._pending;
    this._pending = [];
    let merged: Uint8Array;
    try {
      merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
    } catch {
      merged = batch[batch.length - 1];
    }
    void this._sendFrame(CollabFrameKind.Update, merged);
  }

  private _onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (this._destroyed || !this.awareness) return;
    if (origin === this) return; // présence distante qu'on vient d'appliquer
    const clients = [...changes.added, ...changes.updated, ...changes.removed];
    if (clients.length === 0) return;
    void this._sendFrame(CollabFrameKind.Awareness, encodeAwarenessUpdate(this.awareness, clients));
  };

  private _startSnapshotTimer(): void {
    this._clearSnapshotTimer();
    if (this._opts.snapshotIntervalMs <= 0) return;
    this._snapshotTimer = setInterval(() => {
      this._sendSnapshot();
    }, this._opts.snapshotIntervalMs);
  }

  /**
   * Instantané complet. `force` n'est vrai qu'à l'entrée en salle : c'est le
   * point de compaction du relais, il part même si rien n'a bougé.
   *
   * Le reste du temps, deux appareils AU REPOS ne doivent pas réécrire l'état
   * complet dans le stockage du relais toutes les 45 s : sans modification
   * depuis le dernier instantané, il n'y a rien à compacter.
   */
  private _sendSnapshot(force = false): void {
    if (this._destroyed || !this._synced) return;
    if (!force && !this._snapshotDirty) return;
    if (!this._socket || this._socket.readyState !== SOCKET_OPEN) return;
    this._snapshotDirty = false;
    this.stats.snapshotsSent += 1;
    void this._sendFrame(CollabFrameKind.Snapshot, Y.encodeStateAsUpdate(this.doc));
  }

  private async _sendFrame(
    kind: Exclude<CollabFrameKind, typeof CollabFrameKind.Control>,
    payload: Uint8Array
  ): Promise<void> {
    const key = this._key;
    const socket = this._socket;
    if (!key || !socket || socket.readyState !== SOCKET_OPEN) {
      if (kind === CollabFrameKind.Update) this.stats.updatesDropped += 1;
      return;
    }
    let frame: Uint8Array;
    try {
      frame = await encryptFrame(key, kind, payload);
    } catch (e) {
      this.stats.lastError = `encrypt:${errorName(e)}`;
      return;
    }
    // Le canal a pu partir pendant le chiffrement.
    if (this._destroyed || this._socket !== socket || socket.readyState !== SOCKET_OPEN) {
      if (kind === CollabFrameKind.Update) this.stats.updatesDropped += 1;
      return;
    }
    // Trop grosse pour le relais : renoncer plutôt que se faire fermer en
    // boucle. Un instantané perdu n'empêche que la compaction du journal.
    if (frame.byteLength > COLLAB_MAX_SEND_BYTES) {
      this.stats.lastError = `frame-too-large:${kind}`;
      if (kind === CollabFrameKind.Update) this.stats.updatesDropped += 1;
      return;
    }
    try {
      socket.send(sendable(frame));
      this.stats.framesSent += 1;
    } catch (e) {
      this.stats.lastError = `send:${errorName(e)}`;
    }
  }

  // ---------- Reconnexion ----------

  /**
   * Dégradation exponentielle plafonnée, avec gigue pour ne pas se resynchroniser.
   *
   * ET UN PLANCHER QUAND LE NAVIGATEUR SE DIT HORS LIGNE. Chaque tentative
   * commence par un `POST /collab/token` ; sans réseau, la console du navigateur
   * y inscrit une ligne d'échec de chargement que le client ne peut pas taire,
   * et la rampe (1 s, 2, 4, 8, 16…) en produisait une demi-douzaine par minute.
   * Ce n'est pas une panne, c'est une reconnexion qui attend son heure — mais le
   * bruit, lui, ressemble à une panne, et il noie ce qui en serait vraiment une.
   *
   * `navigator.onLine` NE DÉCIDE DE RIEN ICI, et c'est ce qui rend son usage
   * sûr : il ne peut qu'ESPACER des tentatives qui continuent de partir. S'il
   * ment (portail captif qui se dit en ligne, configuration qui se dit hors
   * ligne), le pire est une reconnexion trouvée trente secondes plus tard — et
   * l'évènement `online`, lui, court-circuite l'attente. Un `return` à sa place
   * aurait été un pari sur une valeur qui ment.
   */
  private _scheduleReconnect(): void {
    if (this._destroyed || this._givenUp || this._reconnectTimer !== null) return;
    const exp = Math.min(
      this._opts.reconnectCapMs,
      this._opts.reconnectBaseMs * 2 ** this._attempt
    );
    const plancher = this._manifestlyOffline() ? this._opts.reconnectCapMs : 0;
    const delay = Math.max(plancher, Math.round(exp * (0.5 + Math.random() * 0.5)));
    this._attempt = Math.min(this._attempt + 1, 16);
    this._reconnectTimer = this._later(() => {
      this._reconnectTimer = null;
      if (this._destroyed) return;
      this.stats.reconnects += 1;
      void this._openChannel();
    }, delay);
  }

  /**
   * INDICE, JAMAIS VERDICT : le seul usage de `navigator.onLine` de ce fichier,
   * et il ne sert qu'à espacer (voir `_scheduleReconnect`). Absent d'un contexte
   * sans `navigator`, il vaut « on ne sait pas », donc « on ne change rien ».
   */
  private _manifestlyOffline(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.onLine === 'boolean' &&
      navigator.onLine === false
    );
  }

  private _onOnline = (): void => {
    if (this._destroyed || this._givenUp) return;
    // Un canal DÉJÀ ouvert n'a rien à retenter. En revanche, tester `_socket`
    // seul ne suffit pas : une ouverture peut être en vol (elle attend la clé
    // ou le billet) sans avoir encore posé son socket. Le jeton de génération
    // s'en charge — `_openChannel` l'incrémente, l'ouverture précédente
    // abandonne d'elle-même à sa prochaine reprise.
    if (this._socket && this._socket.readyState === SOCKET_OPEN) return;
    // Le réseau revient : on retente tout de suite au lieu d'attendre le palier.
    this._clearReconnect();
    this._attempt = 0;
    void this._openChannel();
  };

  // ---------- Minuteurs ----------

  private _later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const handle = setTimeout(() => {
      this._timers.delete(handle);
      if (this._destroyed) return;
      fn();
    }, ms);
    this._timers.add(handle);
    return handle;
  }

  private _clearGrace(): void {
    if (this._graceTimer !== null) {
      clearTimeout(this._graceTimer);
      this._timers.delete(this._graceTimer);
      this._graceTimer = null;
    }
  }

  private _clearStable(): void {
    if (this._stableTimer !== null) {
      clearTimeout(this._stableTimer);
      this._timers.delete(this._stableTimer);
      this._stableTimer = null;
    }
  }

  /**
   * Émet le battement toutes les `keepaliveMs`, et coupe après DEUX PINGS
   * réellement restés sans réponse.
   *
   * Deux et pas un : un pong peut se perdre sans que le chemin soit mort, et
   * couper une session vivante coûte plus cher que d'attendre un cycle de plus.
   * `_handleError` enclenche la reconnexion ordinaire — donc le pair repasse par
   * « hors ligne », ce qui est la VÉRITÉ, au lieu de rester « Live » à taper
   * dans un socket mort.
   *
   * LE COMPTE PORTE SUR DES PINGS ENVOYÉS, pas sur des échéances écoulées. Il
   * montait avant le premier envoi, si bien que « deux manqués » se produisait à
   * la TROISIÈME échéance. Avec l'ancienne période, la coupure tombait à
   * soixante secondes — soit APRÈS les trente secondes de péremption
   * d'`Awareness` que ce battement doit précisément devancer, ce qui lui retirait
   * sa seule raison d'être.
   */
  private _startKeepalive(): void {
    this._clearKeepalive();
    this._missedPongs = 0;
    const period = this._opts.keepaliveMs;
    if (!period || period <= 0) return;
    this._keepaliveTimer = setInterval(() => {
      const socket = this._socket;
      if (!socket || socket.readyState !== SOCKET_OPEN) return;
      // Deux pings ENVOYÉS et restés sans réponse : on coupe avant d'en émettre
      // un troisième. Un pong remet le compteur à zéro (`_onMessage`).
      if (this._missedPongs >= 2) {
        this._clearKeepalive();
        this._handleError();
        return;
      }
      this._missedPongs += 1;
      try {
        socket.send(KEEPALIVE_REQUEST);
      } catch {
        // Un envoi qui jette est déjà un canal mort : la reconnexion s'en charge.
      }
    }, period);
  }

  private _clearKeepalive(): void {
    if (this._keepaliveTimer !== null) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = null;
    }
    this._missedPongs = 0;
  }

  /**
   * Appel nominal après le départ d'un pair : on se réannonce, puis on retire
   * les présences qui n'ont pas répondu.
   *
   * `Awareness` horodate chaque état dans `meta.lastUpdated`. On note l'instant
   * du départ, on laisse une grâce, et tout état distant dont l'horodatage n'a
   * pas bougé pendant la fenêtre est retiré. La grâce est courte mais réelle :
   * plus courte, on retirerait des pairs vivants dont la réannonce est encore en
   * vol ; plus longue, on garderait le fantôme, ce qu'on cherche à éviter.
   */
  private _rollCall(): void {
    if (!this.awareness) return;
    this._announcePresence();
    const awareness = this.awareness;
    const localId = awareness.clientID;
    /**
     * On compare des HORLOGES, pas des horodatages.
     *
     * `meta.lastUpdated` est une heure locale que rien ne garantit de voir bouger
     * — une annonce dont l'horloge n'a pas avancé est écartée en amont comme un
     * doublon. L'horloge, elle, est la mesure que le protocole fait justement
     * avancer à chaque annonce : un pair qui répond l'incrémente, un pair
     * disparu ne peut pas.
     */
    const clocksAvant = new Map<number, number>();
    for (const [clientId] of awareness.getStates()) {
      if (clientId !== localId) clocksAvant.set(clientId, awareness.meta.get(clientId)?.clock ?? 0);
    }

    this._later(() => {
      if (this._destroyed || this.awareness !== awareness) return;
      const stale: number[] = [];
      for (const [clientId] of awareness.getStates()) {
        if (clientId === localId) continue;
        // Un pair APPARU pendant la fenêtre n'était pas dans l'instantané : on ne
        // le retire pas, il vient de se présenter.
        if (!clocksAvant.has(clientId)) continue;
        const maintenant = awareness.meta.get(clientId)?.clock ?? 0;
        if (maintenant <= (clocksAvant.get(clientId) ?? 0)) stale.push(clientId);
      }
      // `removeAwarenessStates` incrémente l'horloge : les autres pairs voient
      // le retrait, et le scrutin d'enregistrement se rejoue partout.
      if (stale.length > 0) removeAwarenessStates(awareness, stale, this);
    }, this._opts.rollCallGraceMs);
  }

  /**
   * Rouvre le canal AVANT que le relais ne coupe sur l'expiration du billet.
   *
   * Le billet vit quelques minutes ; le relais ferme en 4003 à la première trame
   * émise au-delà, et la présence se renouvelle toutes les quinze secondes — il
   * y a donc toujours une trame pour déclencher la coupure. Le client ne
   * l'anticipait pas : il l'apprenait par la fermeture, et chaque membre voyait
   * défiler « Hors ligne — édition locale », « Connexion… », « Synchronisation… »
   * puis « Live » quatre fois par heure, alors que RIEN n'avait été hors ligne.
   * Chaque reprise repoussait en prime un instantané complet qui écrase le
   * journal du relais.
   *
   * À 80 % de la durée de vie : assez tôt pour que la reprise ait le temps
   * d'aboutir, assez tard pour ne pas redemander un billet toutes les minutes.
   * La reconnexion passe par le chemin ordinaire — donc si elle échoue, l'état
   * `offline` apparaît alors, ce qui est vrai, au lieu d'apparaître à chaque
   * expiration programmée, ce qui ne l'était pas.
   */
  private _scheduleTicketRenewal(): void {
    this._clearRenew();
    const expiresAt = this._ticketExpiresAt;
    if (!expiresAt || !Number.isFinite(expiresAt)) return;
    const remaining = expiresAt - Date.now();
    // Une marge minimale : un billet déjà presque mort se renouvelle tout de
    // suite plutôt que de programmer un rendez-vous dans le passé.
    const delay = Math.max(1_000, Math.round(remaining * 0.8));
    this._renewTimer = this._later(() => {
      this._renewTimer = null;
      if (this._destroyed || this._givenUp) return;
      // Pas de `_setStatus('offline')` ici : le canal est encore vivant, on le
      // remplace. Le compteur de tentatives n'est pas touché non plus — ce
      // n'est pas une dégradation, c'est un renouvellement prévu.
      void this._openChannel();
    }, delay);
  }

  private _clearRenew(): void {
    if (this._renewTimer !== null) {
      clearTimeout(this._renewTimer);
      this._timers.delete(this._renewTimer);
      this._renewTimer = null;
    }
  }

  private _clearReconnect(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._timers.delete(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _clearSnapshotTimer(): void {
    if (this._snapshotTimer !== null) {
      clearInterval(this._snapshotTimer);
      this._snapshotTimer = null;
    }
  }

  private _clearAllTimers(): void {
    this._clearSnapshotTimer();
    this._clearKeepalive();
    this._clearRenew();
    for (const handle of this._timers) clearTimeout(handle);
    this._timers.clear();
    this._flushTimer = null;
    this._reconnectTimer = null;
    this._graceTimer = null;
    this._stableTimer = null;
  }

  private _teardownSocket(): void {
    const socket = this._socket;
    this._socket = null;
    this._synced = false;
    this._clearSnapshotTimer();
    this._clearKeepalive();
    this._clearRenew();
    this._clearGrace();
    this._clearStable();
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._timers.delete(this._flushTimer);
      this._flushTimer = null;
    }
    this._pending = [];
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      /* déjà fermé */
    }
  }

  private _setStatus(status: CollabStatus): void {
    if (this._status === status) return;
    this._status = status;
    try {
      this._onStatus?.(status);
    } catch {
      /* un abonné qui lève ne casse pas le transport */
    }
  }
}

// ==================== Utilitaires ====================

function defaultSocketFactory(url: string, protocols: string[]): CollabSocketLike {
  // Le second argument porte le JETON (`filarr.token.<jeton>`) : c'est le seul
  // canal d'authentification d'un WebSocket de navigateur qui n'atterrisse ni
  // dans les journaux d'infrastructure, ni dans le Referer, ni dans l'historique.
  const ws = protocols.length > 0 ? new WebSocket(url, protocols) : new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  return ws as unknown as CollabSocketLike;
}

/** Code de fermeture d'un événement `close`, quand il y en a un. */
function closeCodeOf(event: unknown): number | null {
  if (event && typeof event === 'object' && 'code' in event) {
    const code = (event as { code?: unknown }).code;
    if (typeof code === 'number' && Number.isFinite(code)) return code;
  }
  return null;
}

/**
 * NOM de l'erreur, jamais son message : un message d'exception réseau contient
 * l'URL complète, et une URL ne doit jamais atterrir dans un journal de
 * diagnostic — c'est exactement ce qu'on refuse au relais.
 */
function errorName(e: unknown): string {
  if (e instanceof Error) return e.name || 'Error';
  return typeof e;
}

/** Ferme un socket orphelin sans réveiller le moindre gestionnaire. */
function closeQuietly(socket: CollabSocketLike): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  try {
    socket.close();
  } catch {
    /* déjà fermé */
  }
}

/** Envoie une copie compacte : `send` n'aime pas les vues décalées. */
function sendable(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Point d'entrée de l'éditeur, réexporté ici parce que c'est le module que le
 * crochet React importe. L'implémentation vit dans `collabSession.ts` (elle a
 * besoin du gestionnaire de documents) ; ce n'est qu'un renvoi, il ne crée
 * aucune dépendance à l'évaluation.
 */
export { createCollabSession, releaseCollabSession } from './collabSession';
export type { CollabSession, SessionStatus } from './collabSession';
