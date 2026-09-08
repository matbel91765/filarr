/**
 * Billet d'entrée en salle.
 *
 * Le WebSocket ne porte pas d'en-tête `Authorization` (l'API navigateur ne le
 * permet pas), donc on échange d'abord le jeton d'accès du compte contre un
 * jeton de salle court, vérifiable par le Durable Object sans toucher à la
 * base : `POST /collab/token` → `{ token }`, puis un socket vers la salle.
 *
 * DEUX SALLES, UN SEUL ÉCHANGE. Le corps du POST dit laquelle on demande :
 *   · `{ profileId, noteId }` → note personnelle, salle interne au compte ;
 *   · `{ vaultId, itemId }`   → élément de coffre, salle PARTAGÉE entre membres.
 * Dans le second cas le relais vérifie l'appartenance au coffre avant d'émettre,
 * et inscrit le rôle dans la charge signée — c'est lui, et pas le client, qui
 * empêche un lecteur de faire relayer ses écritures.
 *
 * LE JETON NE VOYAGE JAMAIS DANS L'URL. Une query string atterrit dans les
 * journaux d'infrastructure, dans le `Referer` et dans l'historique du
 * navigateur ; le jeton part donc en SOUS-PROTOCOLE WebSocket
 * (`filarr.token.<jeton>`), le seul canal d'authentification qu'un `WebSocket`
 * de navigateur puisse porter. C'est aussi ce que le relais lit.
 *
 * TOUT échec est silencieux et retourne `null` : hors ligne, 401, réponse
 * inattendue, dépassement du délai. Le fournisseur retombe alors sur le mode
 * actuel (sync périodique) — la collaboration est un bonus, jamais un prérequis
 * à l'édition.
 */

import { getConfig } from '../../config';
import { getOrgContextId } from '../network/apiClient';

const DEFAULT_API_BASE = 'https://api.filarr.com';
const SERVER_URL_OVERRIDE_KEY = 'filarr-server-url';

/** Un `fetch` sans échéance n'expire jamais de lui-même — on en pose une. */
const DEFAULT_TICKET_TIMEOUT_MS = 8000;

/** Sous-protocole d'identification du canal, annoncé puis réémis par la salle. */
export const COLLAB_SUBPROTOCOL = 'filarr.collab.v1';

/** Préfixe du sous-protocole PORTEUR DU JETON : `filarr.token.<jeton>`. */
export const COLLAB_TOKEN_SUBPROTOCOL_PREFIX = 'filarr.token.';

/**
 * Codes de fermeture applicatifs de la salle (plage 4000-4999), recopiés du
 * relais. Ils existent parce que le relais TERMINE la poignée de main avant de
 * refuser : sans lire le code, le client ne voit qu'une fermeture ordinaire et
 * repart en boucle contre un refus définitif.
 */
export const COLLAB_CLOSE = {
  TOKEN_MISSING: 4001,
  TOKEN_INVALID: 4002,
  TOKEN_EXPIRED: 4003,
  ROOM_MISMATCH: 4004,
  OWNER_MISMATCH: 4005,
  ROOM_FULL: 4006,
  FRAME_TOO_LARGE: 4007,
  PROTOCOL_ERROR: 4008,
  FLOODING: 4009,
  NOT_CONFIGURED: 4010,
} as const;

/**
 * Ce qu'il faut faire d'une fermeture :
 *   - `renew-ticket` : le jeton manquait ou a expiré — un billet neuf répare ;
 *   - `give-up`      : refus DÉFINITIF (signature fausse, mauvaise salle, autre
 *                      compte, erreur de protocole, fonctionnalité non
 *                      configurée). Réessayer ne changerait rien ;
 *   - `room-full`    : la salle est PLEINE. Réessayer marche — mais seulement
 *                      quand quelqu'un sera parti, ce qui peut ne jamais
 *                      arriver. Confondu avec `retry`, ce cas produisait une
 *                      reconnexion perpétuelle et SILENCIEUSE : l'utilisateur
 *                      voyait la frappe en direct s'arrêter sans que rien ne
 *                      lui dise pourquoi, ni que c'était volontaire ;
 *   - `retry`        : tout le reste (coupure réseau, cadence excessive) —
 *                      dégradation exponentielle habituelle.
 */
export type CollabCloseDisposition = 'renew-ticket' | 'give-up' | 'retry' | 'room-full';

export function closeDisposition(code: number | null | undefined): CollabCloseDisposition {
  switch (code) {
    case COLLAB_CLOSE.TOKEN_MISSING:
    case COLLAB_CLOSE.TOKEN_EXPIRED:
      return 'renew-ticket';
    case COLLAB_CLOSE.TOKEN_INVALID:
    case COLLAB_CLOSE.ROOM_MISMATCH:
    case COLLAB_CLOSE.OWNER_MISMATCH:
    case COLLAB_CLOSE.PROTOCOL_ERROR:
    case COLLAB_CLOSE.NOT_CONFIGURED:
      return 'give-up';
    case COLLAB_CLOSE.ROOM_FULL:
      return 'room-full';
    default:
      return 'retry';
  }
}

/** Liste de sous-protocoles à offrir à l'ouverture du socket. */
export function roomSubprotocols(token: string): string[] {
  return [COLLAB_SUBPROTOCOL, `${COLLAB_TOKEN_SUBPROTOCOL_PREFIX}${token}`];
}

export interface RoomTicket {
  token: string;
  /** URL WebSocket de la salle — SANS jeton, par construction. */
  url: string;
  /** Sous-protocoles à passer à `new WebSocket(url, protocols)`. */
  protocols: string[];
  /** Expiration annoncée par le Worker, en ms epoch (indicative). */
  expiresAt: number | null;
  /**
   * Rôle que le relais a inscrit dans le jeton (régime coffre uniquement).
   *
   * C'est le SEUL rôle qui compte pour ce que la salle relaie : elle refuse de
   * rediffuser l'écriture d'un lecteur, quoi que le client en pense. Côté
   * client il ne sert qu'à corriger notre propre affichage et notre
   * éligibilité à l'enregistrement quand notre vue locale du rôle est en
   * retard — jamais à AUTORISER quoi que ce soit (le serveur le fait).
   * `null` quand le relais ne le renseigne pas.
   */
  role: string | null;
}

/**
 * Même règle de plausibilité que le socle réseau web : un override fossile
 * (l'ancien backend Express en localhost:3000) ne doit pas détourner le canal.
 */
function isPlausibleFilarrServer(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      return (
        u.hostname === 'filarr.com' ||
        u.hostname.endsWith('.filarr.com') ||
        u.hostname.endsWith('.workers.dev')
      );
    }
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** URL de base du Worker : override localStorage VALIDE, sinon la config. */
export function resolveCollabApiBase(): string {
  let base = DEFAULT_API_BASE;
  try {
    base = getConfig().cloudStorageUrl || DEFAULT_API_BASE;
  } catch {
    /* config non initialisée — le défaut fait l'affaire */
  }
  try {
    const saved =
      typeof localStorage !== 'undefined' && localStorage.getItem(SERVER_URL_OVERRIDE_KEY);
    if (saved && isPlausibleFilarrServer(saved)) base = saved;
  } catch {
    /* localStorage indisponible */
  }
  return base.replace(/\/$/, '');
}

/** `https:` → `wss:`, `http:` → `ws:` (dev local). */
export function toWebSocketBase(httpBase: string): string {
  if (httpBase.startsWith('https://')) return `wss://${httpBase.slice('https://'.length)}`;
  if (httpBase.startsWith('http://')) return `ws://${httpBase.slice('http://'.length)}`;
  return httpBase;
}

/** URL de la salle. Aucun paramètre de requête : le jeton passe ailleurs. */
export function buildRoomUrl(
  profileId: string,
  noteId: string,
  apiBase = resolveCollabApiBase()
): string {
  const wsBase = toWebSocketBase(apiBase);
  return `${wsBase}/collab/room/${encodeURIComponent(profileId)}/${encodeURIComponent(noteId)}`;
}

/**
 * URL de la salle d'un ÉLÉMENT DE COFFRE — repli quand le relais n'annonce pas
 * lui-même le chemin. Le compte n'y figure pas, volontairement : deux membres du
 * même coffre doivent atterrir dans LA MÊME salle. Ce qui les garde chez eux,
 * c'est l'appartenance vérifiée à l'émission du jeton, pas le nom de la pièce.
 */
export function buildVaultRoomUrl(
  vaultId: string,
  itemId: string,
  apiBase = resolveCollabApiBase()
): string {
  const wsBase = toWebSocketBase(apiBase);
  return `${wsBase}/collab/vault/${encodeURIComponent(vaultId)}/${encodeURIComponent(itemId)}`;
}

/**
 * Chemin de salle ANNONCÉ par le relais, quand il en annonce un.
 *
 * Le Worker renvoie déjà `data.path` avec le jeton. S'y fier plutôt que de
 * recopier une route en dur évite au client de se désynchroniser du relais à la
 * moindre évolution d'adressage. Deux gardes, parce que cette valeur vient du
 * réseau : le chemin doit être absolu, et ne doit pas être PROTOCOL-RELATIVE
 * (`//autre-hote/…`), qui détournerait le socket vers un autre serveur.
 */
export function roomUrlFromPath(apiBase: string, path: unknown, fallback: string): string {
  if (typeof path !== 'string') return fallback;
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  return `${toWebSocketBase(apiBase)}${path}`;
}

/** Jeton d'accès du compte — même canal sous Electron et sur le web. */
async function getAccessToken(): Promise<string | null> {
  try {
    const ipc = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
    if (!ipc) return null;
    const token = (await ipc.invoke('auth:getAccessToken')) as string | null;
    return token ?? null;
  } catch {
    return null;
  }
}

export interface TicketOptions {
  timeoutMs?: number;
  apiBase?: string;
  /** Injection de test — par défaut le `fetch` global. */
  fetchImpl?: typeof fetch;
}

interface TokenResponseData {
  token?: unknown;
  expiresIn?: unknown;
  expiresAt?: unknown;
  path?: unknown;
  role?: unknown;
}

/**
 * Échange contre le Worker. `body` porte l'identité de la salle demandée —
 * `{profileId, noteId}` pour une note personnelle, `{vaultId, itemId}` pour un
 * élément de coffre. Le reste (échéance, silence à l'échec) est commun.
 */
async function postRoomToken(
  // `string | number` parce que l'époque de salle est un ENTIER côté Worker : la
  // sérialiser en chaîne la ferait retomber sur le nom de salle historique, sans
  // erreur ni signal — exactement le genre de panne muette qu'on ferme ici.
  body: Record<string, string | number>,
  options: TicketOptions,
  orgId?: string | null
): Promise<{ data: TokenResponseData; apiBase: string } | 'denied' | null> {
  const apiBase = options.apiBase ?? resolveCollabApiBase();
  const doFetch = options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return null;

  const accessToken = await getAccessToken();
  if (!accessToken) return null;

  // Une échéance dure, sinon un Worker qui ne répond pas gèle la reconnexion.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TICKET_TIMEOUT_MS
  );

  try {
    const res = await doFetch(`${apiBase}/collab/token`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        // Une salle de COFFRE est résolue dans son espace : sans en-tête, le Worker
        // retombe sur l'espace personnel du demandeur — le bon pour ses propres
        // coffres, pas pour celui d'un espace où il est invité.
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // UN REFUS N'EST PAS UNE PANNE. 401/403/404 disent que le serveur a répondu
    // et qu'il dit non : on n'est plus membre du coffre, ou l'élément n'existe
    // plus. Le confondre avec une coupure faisait boucler la session à l'infini
    // sur le même refus, en affichant « hors ligne » comme pour un Wi-Fi
    // capricieux — et, une fois les autres pairs périmés, l'exclu se retrouvait
    // seul donc élu, à pousser un enregistrement refusé toutes les six secondes.
    // 401 EXCLU, et la distinction est celle qui compte : un 401 dit que le JETON
    // D'ACCÈS a expiré — ce qui arrive à toute session assez longue — pas qu'on
    // n'est plus membre. Le classer 'denied' tuait définitivement la
    // collaboration d'un membre parfaitement légitime, et il n'en serait sorti
    // qu'en rechargeant. Seuls 403 et 404 disent quelque chose sur
    // l'APPARTENANCE ; 401 retombe sur le chemin « panne, on réessaie », où le
    // rafraîchissement de session fera son travail.
    if (res.status === 403 || res.status === 404) return 'denied';
    if (!res.ok) return null;

    const json = (await res.json()) as { success?: boolean; data?: TokenResponseData };
    if (!json?.data || typeof json.data.token !== 'string' || !json.data.token) return null;
    return { data: json.data, apiBase };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function expiryOf(data: TokenResponseData): number | null {
  if (typeof data.expiresAt === 'number') return data.expiresAt;
  if (typeof data.expiresIn === 'number') return Date.now() + data.expiresIn * 1000;
  return null;
}

/**
 * Demande un billet de salle PERSONNELLE. `null` = pas de canal, on reste en
 * mode actuel.
 */
export async function requestRoomTicket(
  profileId: string,
  noteId: string,
  options: TicketOptions = {}
): Promise<RoomTicket | null> {
  const result = await postRoomToken({ profileId, noteId }, options);
  // Salle PERSONNELLE : le nom contient le compte, donc un refus ne peut pas
  // vouloir dire « vous n'êtes plus membre ». On le traite comme une panne.
  if (!result || result === 'denied') return null;
  const token = result.data.token as string;
  return {
    token,
    url: buildRoomUrl(profileId, noteId, result.apiBase),
    protocols: roomSubprotocols(token),
    expiresAt: expiryOf(result.data),
    role: null,
  };
}

/**
 * Demande un billet pour la salle d'un ÉLÉMENT DE COFFRE.
 *
 * Le Worker vérifie l'appartenance au coffre AVANT d'émettre, et inscrit
 * `vaultId`, `itemId` et le rôle dans la charge signée : un non-membre n'obtient
 * pas de jeton, et un lecteur en obtient un qui ne lui donne pas l'écriture. Le
 * client, lui, ne fait qu'échouer en silence — comme partout ailleurs ici, un
 * refus se solde par « pas de collaboration », jamais par « pas d'édition ».
 */
export async function requestVaultRoomTicket(
  vaultId: string,
  itemId: string,
  options: TicketOptions = {},
  /**
   * L'époque de K_vault sous laquelle NOUS avons ouvert l'élément.
   *
   * Elle entre dans le nom de la salle côté relais, et c'est ce qui empêche deux
   * membres légitimes du même élément de se retrouver dans le même Durable
   * Object avec des clés différentes — ce qui arrivait après une rotation, sans
   * le moindre signal : chacun se croyait seul, chacun s'élisait semeur, et
   * chacun effaçait le journal de l'autre pendant que les deux écrans
   * affichaient « Live ».
   */
  epoch?: number
): Promise<RoomTicket | 'denied' | null> {
  const result = await postRoomToken(
    {
      vaultId,
      itemId,
      // Le Worker borne la valeur par l'époque de l'élément et retombe sur le
      // nom historique si elle est absente : envoyer un nombre est sans risque.
      ...(Number.isInteger(epoch) ? { epoch: epoch as number } : {}),
    },
    options,
    getOrgContextId(vaultId)
  );
  // 'denied' remonte tel quel : c'est la SEULE façon pour un membre retiré
  // d'apprendre qu'il l'est. Sans lui, sa session redemandait un jeton toutes
  // les trente secondes, indéfiniment, en affichant « hors ligne ».
  if (!result || result === 'denied') return result === 'denied' ? 'denied' : null;
  const token = result.data.token as string;
  return {
    token,
    // Le chemin annoncé par le relais fait foi ; le nôtre n'est qu'un repli.
    url: roomUrlFromPath(
      result.apiBase,
      result.data.path,
      buildVaultRoomUrl(vaultId, itemId, result.apiBase)
    ),
    protocols: roomSubprotocols(token),
    expiresAt: expiryOf(result.data),
    role: typeof result.data.role === 'string' ? result.data.role : null,
  };
}
