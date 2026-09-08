/**
 * CLIENT WEB DU CANAL DE NOTIFICATION — le jumeau navigateur de
 * `electron/sync/syncChannelClient.ts`.
 *
 * Même contrat, même protocole, mêmes garanties : le serveur pousse UN ENTIER
 * (la version du manifeste), le client se contente de déclencher un cycle, et
 * si le canal n'est pas là tout continue comme avant — sondage conditionnel de
 * 20 s et cycle de 5 min restent en place dessous.
 *
 * DEUX DIFFÉRENCES AVEC LE BUREAU, toutes deux propres au navigateur :
 *
 *  1. SEUL LE MENEUR OUVRE LE CANAL. Un onglet par socket, ce serait N sockets
 *     et N cycles concurrents pour un seul utilisateur ; l'élection qui existe
 *     déjà (`syncLeader`) tranche, exactement comme pour le sondage.
 *  2. ON SE FERME QUAND L'ONGLET DISPARAÎT. Un navigateur peut geler un onglet
 *     caché sans prévenir : le socket resterait ouvert côté serveur, à occuper
 *     une place du canal pour personne. `visibilitychange` n'est pas fiable
 *     pour ça — c'est `pagehide` qui l'est.
 *
 * `WebSocket` du navigateur ne sait pas porter d'en-tête `Authorization` : le
 * billet voyage donc en sous-protocole, comme pour la collaboration.
 */

import { apiFetch, resolveApiBase } from '../webApiBase';

/** Miroirs de `SYNC_CHANNEL_SUBPROTOCOL` / `SYNC_CHANNEL_TOKEN_PREFIX` (Worker). */
const SUBPROTOCOL = 'filarr.sync.v1';
const TOKEN_PREFIX = 'filarr.synctoken.';

/** Le billet vit 300 s côté serveur ; on se renouvelle à 240. */
const RENEW_BEFORE_MS = 240 * 1000;
const RECONNECT_MIN_MS = 2 * 1000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
const PING_INTERVAL_MS = 45 * 1000;

const CLOSE_TOKEN_EXPIRED = 4103;
const CLOSE_TOKEN_INVALID = 4102;
const CLOSE_CHANNEL_MISMATCH = 4104;

type VersionHandler = (version: number) => void;

let socket: WebSocket | null = null;
let activeProfileId: string | null = null;
let onVersion: VersionHandler | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let renewTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let attempt = 0;
let lastSeenVersion: number | null = null;
/** Le serveur a répondu 503 : le canal n'est pas déployé, on n'insiste pas. */
let unavailable = false;
let pagehideBound = false;

function wsBase(): string {
  return resolveApiBase()
    .replace(/^http:/, 'ws:')
    .replace(/^https:/, 'wss:');
}

function clearTimers(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (renewTimer) {
    clearTimeout(renewTimer);
    renewTimer = null;
  }
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function closeSocket(): void {
  const s = socket;
  socket = null;
  if (!s) return;
  try {
    // Les gestionnaires sont retirés AVANT la fermeture : sinon notre propre
    // `close()` reprogrammerait une reconnexion.
    s.onopen = null;
    s.onmessage = null;
    s.onclose = null;
    s.onerror = null;
    s.close();
  } catch {
    /* déjà mort */
  }
}

function backoffMs(): number {
  const base = Math.min(RECONNECT_MIN_MS * 2 ** attempt, RECONNECT_MAX_MS);
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

function scheduleReconnect(profileId: string, immediate = false): void {
  if (activeProfileId !== profileId || unavailable || reconnectTimer) return;
  const delay = immediate ? 0 : backoffMs();
  attempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect(profileId);
  }, delay);
}

async function fetchTicket(profileId: string): Promise<{ token: string } | null> {
  const res = await apiFetch<{ data?: { token?: string; version?: number } }>(
    '/sync/channel/token',
    { method: 'POST', body: { profileId } }
  );
  if (res.status === 503) {
    unavailable = true;
    console.info('[webSync] canal non déployé — on reste sur le sondage');
    return null;
  }
  const token = res.body?.data?.token;
  if (!res.body?.success || typeof token !== 'string') return null;
  return { token };
}

async function connect(profileId: string): Promise<void> {
  if (activeProfileId !== profileId || unavailable || socket) return;

  let ticket: { token: string } | null = null;
  try {
    ticket = await fetchTicket(profileId);
  } catch {
    /* absence de billet */
  }
  if (!ticket) {
    scheduleReconnect(profileId);
    return;
  }
  if (activeProfileId !== profileId) return;

  let ws: WebSocket;
  try {
    ws = new WebSocket(`${wsBase()}/sync/channel/ws/${encodeURIComponent(profileId)}`, [
      SUBPROTOCOL,
      `${TOKEN_PREFIX}${ticket.token}`,
    ]);
  } catch {
    scheduleReconnect(profileId);
    return;
  }
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return;
    attempt = 0;
    console.info('[webSync] canal ouvert — notifications en direct');
    renewTimer = setTimeout(() => {
      if (socket !== ws) return;
      closeSocket();
      clearTimers();
      scheduleReconnect(profileId, true);
    }, RENEW_BEFORE_MS);
    pingTimer = setInterval(() => {
      if (socket !== ws) return;
      try {
        ws.send(JSON.stringify({ t: 'ping' }));
      } catch {
        /* le `close` suivra */
      }
    }, PING_INTERVAL_MS);
  };

  ws.onmessage = (event: MessageEvent) => {
    if (socket !== ws) return;
    let parsed: { t?: unknown; v?: unknown };
    try {
      parsed = JSON.parse(String(event.data)) as { t?: unknown; v?: unknown };
    } catch {
      return;
    }
    if (parsed?.t !== 'v' || typeof parsed.v !== 'number' || !Number.isFinite(parsed.v)) return;
    // Le serveur envoie la version courante à l'ouverture : sans cette
    // comparaison, chaque renouvellement de billet (toutes les 4 min)
    // déclencherait un cycle complet pour rien.
    if (lastSeenVersion !== null && parsed.v <= lastSeenVersion) return;
    lastSeenVersion = parsed.v;
    console.info(`[webSync] le nuage annonce la version ${parsed.v} — cycle`);
    try {
      onVersion?.(parsed.v);
    } catch {
      /* le gestionnaire se débrouille */
    }
  };

  ws.onclose = (event: CloseEvent) => {
    if (socket !== ws) return;
    socket = null;
    clearTimers();
    if (activeProfileId !== profileId) return;
    const urgent =
      event.code === CLOSE_TOKEN_EXPIRED ||
      event.code === CLOSE_TOKEN_INVALID ||
      event.code === CLOSE_CHANNEL_MISMATCH;
    if (urgent) attempt = 0;
    scheduleReconnect(profileId, urgent);
  };

  ws.onerror = () => {
    // `close` suit toujours : tout est traité là-bas.
  };
}

/** Un onglet qui disparaît ne doit pas laisser un socket ouvert derrière lui. */
function bindPagehide(): void {
  if (pagehideBound || typeof window === 'undefined') return;
  pagehideBound = true;
  window.addEventListener('pagehide', () => {
    closeSocket();
    clearTimers();
  });
}

/**
 * Ouvre le canal pour ce profil. RÉSERVÉ AU MENEUR (voir `syncLeader`) :
 * un socket par onglet ferait N cycles concurrents pour un seul utilisateur.
 */
export function startWebSyncChannel(profileId: string, handler: VersionHandler): void {
  if (activeProfileId === profileId && socket) return;
  stopWebSyncChannel();
  activeProfileId = profileId;
  onVersion = handler;
  attempt = 0;
  lastSeenVersion = null;
  bindPagehide();
  void connect(profileId);
}

/** Referme tout. Idempotent. */
export function stopWebSyncChannel(): void {
  activeProfileId = null;
  onVersion = null;
  lastSeenVersion = null;
  attempt = 0;
  clearTimers();
  closeSocket();
}

export function isWebSyncChannelConnected(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}

/** Un redéploiement du Worker peut ajouter le binding : on redonne sa chance. */
export function resetWebSyncChannelAvailability(): void {
  unavailable = false;
}
