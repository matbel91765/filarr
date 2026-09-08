/**
 * API Client Service
 *
 * Real axios client with JWT interceptor, refresh token, and error handling.
 * Uses the app config for base URL and auth token.
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getConfig } from '../../config';

let authToken: string | null = null;
let refreshToken: string | null = null;
let activeProfileId: string | null = null;
let activeOrgId: string | null = null;
let implicitOrgId: string | null = null;
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}> = [];

/**
 * Endpoints whose tenant is resolved from X-Org-Id. The IMPLICIT context (the
 * user's personal org, used by shared vaults in personal space) is attached to
 * these paths only — never to /sync, /share, /send or any other personal route,
 * so opening shared vaults to paid personal plans cannot change how one single
 * pre-existing request is handled.
 *
 * `/org/:id/...` reads its tenant from the path parameter first, so the header is
 * redundant there; it is listed for consistency with the explicit context.
 */
const ORG_SCOPED_PREFIXES = ['/vaults', '/org', '/account/public-key', '/account/keys/log'];

function pathOf(url: string | undefined): string {
  // Interceptor URLs are relative to baseURL; tolerate an absolute one anyway.
  return (url ?? '').replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
}

function isOrgScopedPath(path: string): boolean {
  return !!path && ORG_SCOPED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Les routes qui refuseront à coup sûr une requête sans jeton — celles où partir
 * anonyme ne peut produire qu'un 401, jamais un résultat.
 *
 * Volontairement calqué sur les préfixes org, et pas plus large : les routes
 * publiques (aperçu d'invitation, vérification d'adresse) doivent continuer de
 * partir sans jeton, et une liste trop large les casserait.
 */
/**
 * `/me` exige le jeton mais ne porte JAMAIS X-Org-Id : la liste des invitations
 * traverse les locataires par construction — un contexte d'org collé dessus
 * mentirait sur la portée de la requête.
 */
/**
 * `/marketplace` exige le jeton (ressource de COMPTE, comme /me) mais peut
 * recevoir un X-Org-Id AMBIANT en espace entreprise (resolveOrgHeader attache
 * activeOrgId à toutes les requêtes de cet espace) — le worker l'ignore sans
 * dommage, même contrat que /shared-with-me (sharedWithMe.ts). Il n'entre
 * PAS dans ORG_SCOPED_PREFIXES : aucun implicitOrgId ne doit s'y coller.
 */
const AUTH_REQUIRED_PREFIXES = [...ORG_SCOPED_PREFIXES, '/me', '/shared-with-me', '/marketplace'];

/**
 * Les routes PUBLIQUES qui vivent SOUS un préfixe authentifié — et que le garde
 * ci-dessus refusait donc localement, sans jamais les envoyer.
 *
 * LE DÉFAUT QUE CECI FERME. Les deux aperçus d'invitation sont publics côté
 * Worker (le jeton EST l'autorité : qui le tient tient déjà l'invitation), et
 * leur seul usage sérieux est justement celui où AUCUN jeton n'existe — le
 * sélecteur de profils du bureau, avant toute activation, et l'écran
 * d'acceptation d'un visiteur pas encore connecté. Or ils habitent `/org/…` et
 * `/vaults/…`, donc `requiresAuth` les rejetait sur place en
 * `network_unavailable` : la ligne « Envoyée à b@… » ne pouvait structurellement
 * pas s'afficher là où elle sert le plus, et rien ne le disait — un aperçu
 * absent ressemble en tout point à un aperçu qui n'a pas répondu.
 *
 * DES MOTIFS EXACTS, PAS DES PRÉFIXES : `/org/invitations/:token/accept` et
 * `/vaults/invites` (la création d'invitation) exigent bel et bien une session,
 * et une liste large les laisserait partir anonymes pour se faire refuser par le
 * serveur avec un code que l'écran lirait de travers. Porter un jeton quand il y
 * en a un reste sans effet : ces routes ne le regardent pas.
 */
const PUBLIC_PATHS: readonly RegExp[] = [
  /^\/org\/invitations\/[^/]+$/,
  /^\/vaults\/invites\/[^/]+\/preview$/,
];

/**
 * Exportée pour être ÉPINGLÉE : c'est elle qui décide qu'une requête ne partira
 * pas du tout. Une liste trop large casse en silence des routes publiques (la
 * ligne « Envoyée à b@… » disparaît sans un mot) ; une liste trop étroite laisse
 * partir anonymes des routes qui exigent une session, dont le 401 se lit
 * `session_expired` — TERMINAL — sur ce qui n'est qu'un jeton manquant.
 */
export function requiresAuth(url: string | undefined): boolean {
  const path = pathOf(url);
  if (!path) return false;
  if (PUBLIC_PATHS.some((re) => re.test(path))) return false;
  return AUTH_REQUIRED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Which tenant each known vault lives in.
 *
 * A user can stand in several personal spaces at once — their own, plus one per
 * person who invited them — and every /vaults/:id/… route resolves the vault
 * WITHIN its org: ask for a guest vault under our own space and the honest answer
 * is 404 vault_not_found. Rather than thread an orgId through twenty call
 * signatures, the vault listing records where each vault was found and every
 * later call to it is scoped from here. Unknown id → fall through to the ambient
 * context, which is the right answer for creation and for a single-space user.
 */
const vaultOrgIndex = new Map<string, string>();

export function rememberVaultOrg(vaultId: string, orgId: string | null | undefined): void {
  if (vaultId && orgId) vaultOrgIndex.set(vaultId, orgId);
}

/** Drop the index (profile switch / sign-out) — a stale tenant is a wrong tenant. */
export function forgetVaultOrgs(): void {
  vaultOrgIndex.clear();
}

/**
 * Dépunaise UN coffre. Rejoindre un coffre qu'on ne connaît pas encore oblige à
 * essayer les locataires plausibles ; une hypothèse démentie doit être retirée
 * sans emporter les coffres déjà listés, ce que `forgetVaultOrgs()` ferait.
 */
export function forgetVaultOrg(vaultId: string): void {
  vaultOrgIndex.delete(vaultId);
}

/**
 * Le locataire indexé pour ce coffre, SANS repli sur le contexte ambiant (ce que
 * `getOrgContextId` fait, lui). Sert à RESTAURER l'entrée d'origine après un
 * sondage : écraser puis supprimer dépunaiserait un coffre déjà listé, dont tous
 * les appels ultérieurs repartiraient contre le mauvais espace — 404 jusqu'au
 * prochain `loadVaults()`.
 */
export function getRememberedVaultOrg(vaultId: string): string | null {
  return vaultOrgIndex.get(vaultId) ?? null;
}

function vaultOrgForPath(path: string): string | null {
  const m = /^\/vaults\/([^/]+)/.exec(path);
  return m ? (vaultOrgIndex.get(m[1]) ?? null) : null;
}

/**
 * The X-Org-Id a request to `url` should carry, or null for none.
 *
 * Most specific first: the vault's own tenant, then the org explicitly chosen in
 * enterprise space, then the implicit personal one — and that last step ONLY on
 * org-scoped paths, so no personal route (/sync, /share, /send…) starts carrying
 * a tenant it never carried before.
 */
export function resolveOrgHeader(url: string | undefined): string | null {
  const path = pathOf(url);
  return vaultOrgForPath(path) ?? activeOrgId ?? (isOrgScopedPath(path) ? implicitOrgId : null);
}

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

function createClient(): AxiosInstance {
  const config = getConfig();

  // TODO Phase 5 : migrer vers nouveau Cloudflare Worker (api.filarr.com)
  // On first load, getConfig() returns the default dev/prod config.
  // But the user may have a saved server URL that hasn't been loaded yet (async).
  // Check localStorage synchronously to avoid hitting the wrong URL on startup.
  let baseURL = config.cloudStorageUrl;
  try {
    const savedUrl = localStorage.getItem('filarr-server-url');
    if (savedUrl) {
      baseURL = savedUrl;
    }
  } catch {
    // localStorage may not be available
  }

  const client = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor — attach JWT + profile ID
  client.interceptors.request.use(
    async (reqConfig: InternalAxiosRequestConfig) => {
      // The cloud access token is owned by the MAIN process (authService, persisted
      // to safeStorage with auto-refresh). The renderer apiClient never held its own
      // token, so org/vault calls went out unauthenticated → 401. Pull the current
      // (auto-refreshed) token from main per request — single source of truth. The
      // module-level `authToken` stays as a test/override hook.
      let token = authToken || config.authToken;
      if (!token && typeof window !== 'undefined' && window.electron?.ipcRenderer) {
        try {
          token = (await window.electron.ipcRenderer.invoke('auth:getAccessToken')) as
            | string
            | null;
        } catch {
          token = null;
        }
      }
      if (token && reqConfig.headers) {
        reqConfig.headers.Authorization = `Bearer ${token}`;
      } else if (!token && requiresAuth(reqConfig.url)) {
        /**
         * PAS DE JETON SUR UNE ROUTE QUI EN EXIGE UN : échouer ICI, localement.
         *
         * `getAccessToken` rend `null` sans détruire la session quand le
         * rafraîchissement échoue sur une panne réseau — c'est délibéré, la
         * session est intacte. Mais la requête partait quand même, ANONYME, et
         * le Worker répondait 401 sans code applicatif : `classifyVaultFailure`
         * le traduisait en `session_expired`, qui est TERMINAL. L'écran
         * d'acceptation affichait donc « votre session s'est terminée,
         * reconnectez-vous » SANS bouton « Réessayer », sur ce qui n'était
         * qu'une coupure de quelques secondes.
         *
         * Une panne doit se lire comme une panne. `network_unavailable` est
         * transitoire, et rend le bouton « Réessayer » que la situation mérite.
         */
        return Promise.reject(
          Object.assign(new Error('No access token available'), {
            code: 'network_unavailable',
            isAxiosError: false,
          })
        );
      }
      if (activeProfileId && reqConfig.headers) {
        reqConfig.headers['X-Profile-Id'] = activeProfileId;
      }
      // Org context (E1-6) — a header the caller set itself always wins, so a call
      // can pin its own tenant; otherwise resolveOrgHeader decides.
      if (reqConfig.headers && !reqConfig.headers['X-Org-Id']) {
        const orgId = resolveOrgHeader(reqConfig.url);
        if (orgId) reqConfig.headers['X-Org-Id'] = orgId;
      }
      return reqConfig;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor — handle 401 with token refresh
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      /**
       * 401 SUR LE WEB : UN retry après refresh-cookie, comme `apiFetch`.
       *
       * Le web ne pose jamais le `refreshToken` module (son refresh vit dans un
       * cookie HttpOnly roté par le Worker) : la branche axios ci-dessous lui
       * était donc inaccessible. Or `ensureAccessToken` rend VOLONTAIREMENT le
       * jeton périmé quand un refresh échoue sur une panne passagère — c'est
       * `apiFetch` qui rattrape au 401 suivant. Tout ce qui passe par axios
       * (coffres, orgs, facturation) n'avait PAS ce rattrapage : le 401 se
       * lisait `session_expired`, TERMINAL, et l'accueil perdait ses coffres
       * pour toute la session d'onglet — selon l'âge du jeton au chargement.
       */
      if (error.response?.status === 401 && !originalRequest._retry && !refreshToken) {
        try {
          const { isWebPlatform } = await import('../platform/isWebPlatform');
          if (isWebPlatform()) {
            const { refreshViaCookie, ensureAccessToken } =
              await import('../../platform/web/webApiBase');
            if (await refreshViaCookie()) {
              const fresh = await ensureAccessToken();
              if (fresh && originalRequest.headers) {
                originalRequest._retry = true;
                originalRequest.headers.Authorization = `Bearer ${fresh}`;
                return client(originalRequest);
              }
            }
          }
        } catch {
          /* refresh impossible : le 401 d'origine reste la réponse honnête */
        }
      }

      if (error.response?.status === 401 && !originalRequest._retry && refreshToken) {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }).then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return client(originalRequest);
          });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          const { data } = await axios.post(`${client.defaults.baseURL}/auth/refresh`, {
            refreshToken,
          });

          authToken = data.data?.token || data.token;
          refreshToken = data.data?.refreshToken || data.refreshToken;

          processQueue(null, authToken);

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${authToken}`;
          }
          return client(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError, null);
          authToken = null;
          refreshToken = null;
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }

      // Handle 429 Too Many Requests — retry up to 2 times, but never on auth routes
      if (error.response?.status === 429) {
        const url = originalRequest.url || '';
        const isAuthRoute = url.includes('/auth/');
        const retryCount = (originalRequest as any)._retryCount || 0;

        if (isAuthRoute || retryCount >= 2) {
          return Promise.reject(error);
        }

        (originalRequest as any)._retryCount = retryCount + 1;
        const retryAfter = error.response.headers['retry-after'];
        const delayMs = retryAfter
          ? isNaN(Number(retryAfter))
            ? 5000
            : Number(retryAfter) * 1000
          : 5000;

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return client(originalRequest);
      }

      return Promise.reject(error);
    }
  );

  return client;
}

const apiClient = createClient();

/**
 * Set authentication tokens
 */
export function setAuthTokens(token: string, refresh?: string): void {
  authToken = token;
  if (refresh) refreshToken = refresh;
  apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

/**
 * Clear authentication tokens
 */
export function clearAuthTokens(): void {
  authToken = null;
  refreshToken = null;
  delete apiClient.defaults.headers.common['Authorization'];
}

/**
 * Check if client has a valid token
 */
export function hasAuthToken(): boolean {
  return !!authToken;
}

/**
 * Update the base URL of the API client at runtime.
 * Call this whenever the cloud storage URL is changed in settings.
 */
export function updateApiClientBaseURL(url: string): void {
  apiClient.defaults.baseURL = url;
}

/**
 * Set the active profile ID for X-Profile-Id header.
 */
export function setActiveProfile(profileId: string | null): void {
  activeProfileId = profileId;
}

/**
 * Get the current active profile ID.
 */
export function getActiveProfile(): string | null {
  return activeProfileId;
}

/**
 * Set the active org ID for the X-Org-Id header (null = personal context).
 */
export function setActiveOrg(orgId: string | null): void {
  activeOrgId = orgId;
}

/**
 * Get the current active org ID.
 */
export function getActiveOrg(): string | null {
  return activeOrgId;
}

/**
 * Set the IMPLICIT org context — the user's auto-provisioned personal org, used
 * as the tenant of shared vaults while in personal space. Never surfaced in the
 * UI; it only fills in when no org was explicitly chosen.
 */
export function setImplicitOrg(orgId: string | null): void {
  implicitOrgId = orgId;
}

/**
 * The implicit tenant — MY personal space. Exposed so a caller building its own
 * request (the collab room ticket, a raw fetch) can scope it the same way.
 */
export function getImplicitOrg(): string | null {
  return implicitOrgId;
}

/**
 * The tenant an org-scoped call will actually carry, for `vaultId` when given.
 * Callers that build their own request (the collab room ticket, which is a raw
 * fetch) MUST use this rather than getActiveOrg(), or they lose both the
 * personal-space context and the per-vault one.
 */
export function getOrgContextId(vaultId?: string): string | null {
  const fromVault = vaultId ? vaultOrgIndex.get(vaultId) : undefined;
  return fromVault ?? activeOrgId ?? implicitOrgId;
}

/**
 * Check if the API is reachable
 */
export async function isApiReachable(): Promise<boolean> {
  try {
    await apiClient.get('/health', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export default apiClient;
