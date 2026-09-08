/**
 * CLIENT DU CANAL DE NOTIFICATION — « le nuage vient de passer en version N ».
 *
 * CE QUE ÇA REMPLACE. Le démon demandait : toutes les cinq minutes un cycle
 * complet, et depuis peu un GET conditionnel toutes les dix secondes. Les deux
 * restent — mais quand ce canal est ouvert, ils ne servent plus qu'à rattraper
 * ce qu'il aurait manqué. La latence perçue passe de « la prochaine fois qu'on
 * demandera » à « tout de suite ».
 *
 * CE QUI TRANSITE : un entier. Le serveur ne dit pas ce qui a changé, et il ne
 * le sait pas — il n'a jamais vu que du chiffré. Contrat complet en tête de
 * `infra/cloudflare-worker/src/syncChannel.ts`.
 *
 * ═══ CE MODULE NE DÉCIDE RIEN ═══
 *
 * Il ne lit pas le manifeste, n'écrit rien, ne compare rien d'autre qu'un
 * entier à celui qu'il a déjà vu. Sur notification, il APPELLE — et c'est
 * `syncService` qui décide, avec ses gardes habituelles. Un canal compromis ou
 * bavard ne peut donc obtenir qu'une chose : des cycles de synchronisation
 * inutiles. Jamais une écriture, jamais une lecture de contenu.
 *
 * ═══ TROIS RÈGLES QUI ÉVITENT LES PANNES CLASSIQUES ═══
 *
 * 1. LE CANAL N'EST JAMAIS UNE SOURCE DE VÉRITÉ. S'il tombe, se tait, ou n'est
 *    pas déployé (503), tout continue comme avant. On ne signale même pas
 *    d'erreur à l'utilisateur : il n'y a rien à réparer de son côté.
 * 2. LA RECONNEXION EST TEMPORISÉE ET PLAFONNÉE. Un serveur qui refuse ne doit
 *    pas se faire marteler : 2 s, puis doublement jusqu'à cinq minutes, avec du
 *    bruit pour ne pas synchroniser tous les appareils du monde sur la même
 *    seconde après une panne.
 * 3. LE BILLET EST RENOUVELÉ AVANT DE PÉRIMER. Il vit cinq minutes ; on se
 *    reconnecte à quatre. Sans cela le serveur fermerait le canal (4103) et on
 *    passerait son temps à découvrir l'expiration par une panne.
 */

import log from 'electron-log';
import { WebSocket } from 'ws';

import { API_BASE } from '../apiOrigin';
import { getAccessToken } from '../authService';

/** Sous-protocole du canal — miroir de `SYNC_CHANNEL_SUBPROTOCOL` côté Worker. */
const SUBPROTOCOL = 'filarr.sync.v1';
/** Préfixe porteur du billet — miroir de `SYNC_CHANNEL_TOKEN_PREFIX`. */
const TOKEN_PREFIX = 'filarr.synctoken.';

/** Le billet vit 300 s côté serveur ; on se renouvelle avant. */
const RENEW_BEFORE_MS = 240 * 1000;
const RECONNECT_MIN_MS = 2 * 1000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
/** Battement de cœur : garde le canal ouvert à travers les intermédiaires réseau. */
const PING_INTERVAL_MS = 45 * 1000;
const CONNECT_TIMEOUT_MS = 15 * 1000;

/** Fermeture « billet périmé » côté serveur : se reconnecter TOUT DE SUITE. */
const CLOSE_TOKEN_EXPIRED = 4103;
/** Fermetures qui disent « n'insiste pas avec ce billet-là », mais un neuf ira. */
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
/** Dernière version reçue — évite de relancer un cycle pour une redite. */
let lastSeenVersion: number | null = null;
/** Le serveur a dit 503 : inutile de retenter en boucle cette session. */
let unavailable = false;

/** `https://api.filarr.com` → `wss://api.filarr.com`. Dérivé, jamais réécrit en dur. */
function wsBase(): string {
  return API_BASE.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
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
    // On retire les écouteurs AVANT de fermer : sinon notre propre fermeture
    // déclencherait le `close` qui reprogramme une reconnexion.
    s.removeAllListeners();
    s.close();
  } catch {
    /* déjà mort */
  }
}

/** Temporisation exponentielle bruitée, plafonnée. */
function backoffMs(): number {
  const base = Math.min(RECONNECT_MIN_MS * 2 ** attempt, RECONNECT_MAX_MS);
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

function scheduleReconnect(profileId: string, immediate = false): void {
  if (activeProfileId !== profileId || unavailable) return;
  if (reconnectTimer) return;
  const delay = immediate ? 0 : backoffMs();
  attempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect(profileId);
  }, delay);
  reconnectTimer.unref?.();
}

/**
 * Demande un billet. `null` = pas de canal cette fois-ci (non authentifié,
 * réseau, ou canal non déployé — le 503 est mémorisé pour la session).
 */
async function fetchTicket(
  profileId: string
): Promise<{ token: string; version: number } | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  const res = await fetch(`${API_BASE}/sync/channel/token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ profileId }),
    signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
  });
  if (res.status === 503) {
    unavailable = true;
    log.info('[syncChannel] Canal non déployé côté serveur — on reste sur le sondage');
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as {
    success?: boolean;
    data?: { token?: string; version?: number };
  };
  const token = body?.data?.token;
  if (!body?.success || typeof token !== 'string') return null;
  const version = typeof body.data?.version === 'number' ? body.data.version : -1;
  return { token, version };
}

async function connect(profileId: string): Promise<void> {
  if (activeProfileId !== profileId || unavailable || socket) return;

  let ticket: { token: string; version: number } | null = null;
  try {
    ticket = await fetchTicket(profileId);
  } catch {
    /* traité comme une absence de billet */
  }
  if (!ticket) {
    scheduleReconnect(profileId);
    return;
  }
  if (activeProfileId !== profileId) return;

  const url = `${wsBase()}/sync/channel/ws/${encodeURIComponent(profileId)}`;
  let ws: WebSocket;
  try {
    // Le billet voyage en SOUS-PROTOCOLE, pas en query string : une query
    // string atterrit dans les journaux d'infrastructure, pas un en-tête.
    ws = new WebSocket(url, [SUBPROTOCOL, `${TOKEN_PREFIX}${ticket.token}`]);
  } catch (err) {
    log.warn(`[syncChannel] Ouverture impossible : ${(err as Error).message}`);
    scheduleReconnect(profileId);
    return;
  }
  socket = ws;

  ws.on('open', () => {
    if (socket !== ws) return;
    attempt = 0;
    log.info('[syncChannel] Canal ouvert — notifications en direct');
    // Renouvellement AVANT péremption : une reconnexion propre coûte moins
    // cher qu'une fermeture 4103 suivie d'une reconnexion d'urgence.
    renewTimer = setTimeout(() => {
      if (socket !== ws) return;
      log.info('[syncChannel] Renouvellement du billet');
      closeSocket();
      clearTimers();
      scheduleReconnect(profileId, true);
    }, RENEW_BEFORE_MS);
    renewTimer.unref?.();
    pingTimer = setInterval(() => {
      if (socket !== ws) return;
      try {
        ws.send(JSON.stringify({ t: 'ping' }));
      } catch {
        /* le `close` suivra */
      }
    }, PING_INTERVAL_MS);
    pingTimer.unref?.();
  });

  ws.on('message', (raw) => {
    if (socket !== ws) return;
    let parsed: { t?: unknown; v?: unknown };
    try {
      parsed = JSON.parse(String(raw)) as { t?: unknown; v?: unknown };
    } catch {
      return;
    }
    if (parsed?.t !== 'v' || typeof parsed.v !== 'number' || !Number.isFinite(parsed.v)) return;
    const version = parsed.v;
    /**
     * ON NE RELANCE QUE SUR DU NEUF. Le serveur envoie aussi la version
     * courante à l'ouverture (pour combler une diffusion manquée) : sans cette
     * comparaison, chaque reconnexion — donc chaque renouvellement de billet,
     * toutes les quatre minutes — déclencherait un cycle complet pour rien.
     */
    if (lastSeenVersion !== null && version <= lastSeenVersion) return;
    lastSeenVersion = version;
    log.info(`[syncChannel] Le nuage annonce la version ${version} — cycle`);
    try {
      onVersion?.(version);
    } catch (err) {
      log.warn(`[syncChannel] Le gestionnaire a jeté : ${(err as Error).message}`);
    }
  });

  ws.on('close', (code: number) => {
    if (socket !== ws) return;
    socket = null;
    clearTimers();
    if (activeProfileId !== profileId) return;
    // Un billet périmé ou refusé n'est pas une panne : on en redemande un.
    const urgent =
      code === CLOSE_TOKEN_EXPIRED || code === CLOSE_TOKEN_INVALID || code === CLOSE_CHANNEL_MISMATCH;
    if (urgent) attempt = 0;
    log.info(`[syncChannel] Canal fermé (${code}) — reconnexion`);
    scheduleReconnect(profileId, urgent);
  });

  ws.on('error', () => {
    // `ws` émet toujours `close` derrière `error` : tout est traité là-bas.
    // Sans cet écouteur, Node transformerait l'erreur en exception non gérée.
  });
}

/**
 * Ouvre le canal pour ce profil. Idempotent : rappeler avec le même profil ne
 * fait rien, avec un autre referme le précédent.
 *
 * `handler` reçoit la version annoncée. Il doit se contenter de déclencher un
 * cycle : ce module ne lui confie aucune autorité.
 */
export function start(profileId: string, handler: VersionHandler): void {
  if (activeProfileId === profileId && socket) return;
  stop();
  activeProfileId = profileId;
  onVersion = handler;
  attempt = 0;
  lastSeenVersion = null;
  void connect(profileId);
}

/** Referme tout. Idempotent. */
export function stop(): void {
  activeProfileId = null;
  onVersion = null;
  lastSeenVersion = null;
  attempt = 0;
  clearTimers();
  closeSocket();
}

/** Le canal est-il ouvert ? Sert au journal et aux tests, à rien d'autre. */
export function isConnected(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}

/**
 * Remise à zéro du verdict « non déployé ». Un redéploiement du Worker qui
 * ajoute le binding doit pouvoir être pris en compte sans redémarrer l'app :
 * appelé au changement de profil.
 */
export function resetAvailability(): void {
  unavailable = false;
}
