/**
 * Socle réseau du dispatcher web : résolution de l'URL du Worker, identité
 * d'appareil, garde du jeton d'accès en mémoire, et fetch authentifié avec
 * un retry unique via le refresh-cookie HttpOnly (le flux navigateur que le
 * Worker implémente déjà — infra/cloudflare-worker/src/cookies.ts).
 *
 * Le jeton d'accès ne touche JAMAIS localStorage/sessionStorage : il vit en
 * mémoire module et se reconstruit via le cookie de refresh (ESW du dossier
 * avant-projet web — le refresh-cookie est HttpOnly, hors de portée du JS).
 */

const DEFAULT_API_BASE = 'https://api.filarr.com';
const SERVER_URL_OVERRIDE_KEY = 'filarr-server-url';
const DEVICE_ID_KEY = 'filarr-web-device-id';

let _accessToken: string | null = null;
let _cachedBase: string | null = null;

/**
 * Un override n'est honoré que s'il désigne un serveur Filarr plausible.
 * L'origine localhost:3000 traîne des années d'état de dev (constaté en
 * conditions réelles : un `filarr-server-url` fossile pointant sur l'ancien
 * backend Express) — une valeur non conforme est SUPPRIMÉE, pas seulement
 * ignorée, car apiClient.ts lit la même clé.
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

/** URL de base du Worker. Ordre : override localStorage VALIDE (convention de apiClient.ts) puis défaut. */
export function resolveApiBase(): string {
  if (_cachedBase) return _cachedBase;
  let base = DEFAULT_API_BASE;
  try {
    const saved = localStorage.getItem(SERVER_URL_OVERRIDE_KEY);
    if (saved) {
      if (isPlausibleFilarrServer(saved)) {
        base = saved;
      } else {
        localStorage.removeItem(SERVER_URL_OVERRIDE_KEY); // fossile : auto-nettoyage
      }
    }
  } catch {
    /* localStorage indisponible */
  }
  _cachedBase = base.replace(/\/$/, '');
  return _cachedBase;
}

/** Identité d'appareil stable pour ce navigateur (le Worker liste les appareils par deviceId). */
export function getWebDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return 'web-ephemeral';
  }
}

/**
 * Adopte l'identifiant CANONIQUE rendu par le serveur (0091) quand il differe
 * de celui envoye : ce compte avait deja un appareil sur cette « machine »
 * (ici, ce navigateur), c'est lui qui porte la session et c'est lui que
 * « Cet appareil » doit designer. Sur le web la machine EST le navigateur —
 * le meme identifiant sert aux deux roles ; ce que la liaison serveur
 * rattrape, c'est le stockage vide (fenetre privee, donnees effacees) : la
 * ligne d'avant ne revient pas, mais la nouvelle ne se multiplie plus.
 */
export function adoptWebDeviceId(canonical: unknown): void {
  if (typeof canonical !== 'string' || !canonical) return;
  try {
    if (localStorage.getItem(DEVICE_ID_KEY) !== canonical)
      localStorage.setItem(DEVICE_ID_KEY, canonical);
  } catch {
    /* localStorage indisponible */
  }
}

export function getWebDeviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Navigateur';
  return `${browser} (web)`;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string | null): void {
  _accessToken = token;
  _accessExpiresAt = decodeExpiry(token);
}

// ── Fraîcheur du jeton d'accès ──────────────────────────────────────────────
//
// PRÉSENT N'EST PAS VALIDE. Le jeton d'accès dure quinze minutes (Worker,
// jwt.ts) ; passé ce délai il reste en mémoire, parfaitement inutile, et TOUT
// appel qui le lit sans rien vérifier part se faire refuser. Les trois chemins
// qui ne passent pas par `apiFetch` (le manifeste de sync, le billet de salle
// collab, l'apiClient axios) bouclaient ainsi sur un 401 définitif jusqu'au
// rechargement de l'onglet, alors que le cookie de refresh, lui, valait encore
// quatre-vingt-dix jours. On lit donc l'échéance ANNONCÉE par le jeton et on
// re-frappe avant qu'elle tombe.

/**
 * Marge de sécurité : un jeton qui meurt dans moins d'une demi-minute est
 * traité comme mort — le temps du vol aller et du traitement serveur suffit
 * sinon à le périmer entre l'instant où on le lit et celui où il est vérifié.
 */
const TOKEN_FRESHNESS_SKEW_MS = 30_000;

/** Échéance du jeton en mémoire, en ms epoch. `null` = inconnue (voir plus bas). */
let _accessExpiresAt: number | null = null;
/** Un refresh en vol, partagé : vingt notes vivantes ne frappent pas vingt fois. */
const _refreshFlights = new Map<string, Promise<boolean>>();

/**
 * `exp` de la charge JWT, sans vérifier la signature — c'est le SERVEUR qui
 * fait foi, on ne lit ici qu'une date pour décider quand demander mieux. Un
 * jeton illisible rend `null`, donc « échéance inconnue », donc traité comme
 * frais : on ne casse pas un canal sur une lecture ratée.
 */
function decodeExpiry(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
    const json = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Le jeton en mémoire tiendra-t-il le temps de l'aller-retour ?
 *
 * Absent → non. Échéance inconnue → OUI : sans date on ne peut rien affirmer,
 * et le chemin 401 reste là pour rattraper. Ne jamais inverser ce défaut — il
 * ferait passer une horloge locale fantaisiste pour une session morte.
 */
export function isAccessTokenFresh(): boolean {
  if (!_accessToken) return false;
  if (_accessExpiresAt === null) return true;
  return _accessExpiresAt - Date.now() > TOKEN_FRESHNESS_SKEW_MS;
}

/**
 * Le jeton d'accès à donner à un appel sortant, renouvelé s'il est périmé.
 *
 * DEUX RÈGLES, chacune contre une panne vue en vrai :
 *  · aucun jeton en mémoire → on rend `null` SANS frapper `/auth/refresh` ;
 *    la restauration au boot (authHandlers.restoreSessionOnce) est seule
 *    responsable de ce cas, sinon un onglet purement local frapperait le
 *    Worker à chaque appel ;
 *  · le refresh échoue → on rend quand même le jeton périmé, exactement comme
 *    avant ce correctif. Un réseau coupé ou une horloge en avance ne doit pas
 *    produire une panne PIRE que celle qu'on répare.
 */
export async function ensureAccessToken(): Promise<string | null> {
  if (!_accessToken) return null;
  if (isAccessTokenFresh()) return _accessToken;
  await refreshViaCookie();
  return _accessToken;
}

/**
 * LE COMPTE DE CET ONGLET — l'indice ambiant des refresh.
 *
 * Le Worker tient désormais un cookie de refresh PAR COMPTE ; sans indice, il
 * sert le legacy, c'est-à-dire « le dernier connecté DANS CE NAVIGATEUR » —
 * qui peut être un autre compte, changé depuis un autre onglet. Chaque refresh
 * de cet onglet nomme donc son compte : la session suit le PROFIL, plus la
 * chronologie des connexions. Posé par authHandlers à chaque changement de
 * `_user` (restauration, connexion, adoption, déconnexion).
 */
let _sessionAccountHintProvider: (() => string | null) | null = null;

/**
 * Enregistré UNE fois par authHandlers (`() => _user?.id ?? null`) : l'indice
 * suit `_user` sans qu'aucun site d'affectation n'ait à y penser.
 */
export function registerSessionAccountHintProvider(provider: () => string | null): void {
  _sessionAccountHintProvider = provider;
}

interface ApiResult<T> {
  status: number;
  body: (T & { success?: boolean; error?: string }) | null;
}

/**
 * Tente de re-frapper un jeton d'accès via le refresh-cookie HttpOnly.
 * Retourne true si un nouveau jeton est en place.
 *
 * PARTAGÉ ENTRE APPELANTS CONCURRENTS. Un jeton qui expire les réveille tous en
 * même temps — le cycle de sync, la surveillance des coffres et un billet de
 * salle par note ouverte. Sans mise en commun, c'est une salve de `/auth/refresh`
 * dont chaque réponse ROTE le cookie : les dernières arrivées présentent alors
 * un refresh déjà consommé et se font jeter, ce qui déconnecte une session
 * parfaitement valide. Un seul vol, tout le monde attend le même.
 */
export async function refreshViaCookie(userIdHint?: string): Promise<boolean> {
  // L'indice explicite (adoption d'un profil d'un AUTRE compte) prime sur
  // l'ambiant (le compte de cet onglet). Deux indices différents ne partagent
  // JAMAIS un vol : la réponse de l'un poserait le jeton de l'autre.
  const hint = userIdHint ?? _sessionAccountHintProvider?.() ?? undefined;
  const flightKey = hint ?? '';
  const inFlight = _refreshFlights.get(flightKey);
  if (inFlight) return inFlight;
  const attempt = (async () => {
    try {
      const res = await fetch(`${resolveApiBase()}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hint ? { userId: hint } : {}),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as {
        success?: boolean;
        data?: { accessToken?: string };
      };
      const token = json?.data?.accessToken;
      if (json?.success && token) {
        // Par le setter : lui seul tient l'échéance à jour, et un jeton frais
        // dont on garderait l'ancienne date relancerait un refresh sans fin.
        setAccessToken(token);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  })();
  const tracked = attempt.finally(() => {
    _refreshFlights.delete(flightKey);
  });
  _refreshFlights.set(flightKey, tracked);
  return tracked;
}

/**
 * Fetch JSON vers le Worker. `credentials: 'include'` systématique : le cookie
 * de refresh est posé/roté par le Worker pour les origines navigateur
 * allowlistées. Sur 401 avec jeton en place, UN retry après refresh-cookie.
 *
 * `signal` : un appelant qui ne peut pas se permettre d'attendre indéfiniment
 * (le cycle de sync, dont le verrou resterait fermé à vie) passe son échéance.
 * Un `fetch` sans signal n'expire jamais de lui-même.
 */
export async function apiFetch<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
  _retried = false
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.auth !== false) {
    // Renouvellement AVANT le vol quand l'échéance est passée : le retry sur
    // 401 reste la ceinture, mais il coûte un aller-retour refusé à chaque
    // appel d'une session simplement trop longue.
    const token = _retried ? _accessToken : await ensureAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${resolveApiBase()}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (res.status === 401 && !_retried && init.auth !== false) {
    if (await refreshViaCookie()) {
      return apiFetch<T>(path, init, true);
    }
  }
  let body: ApiResult<T>['body'] = null;
  try {
    body = (await res.json()) as ApiResult<T>['body'];
  } catch {
    /* réponse non-JSON */
  }
  return { status: res.status, body };
}
