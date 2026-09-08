/**
 * Handlers web des canaux de métadonnées de page (QW-13 v1) et des connecteurs
 * de bases inline — miroir des handlers ipcMain 'fetchPageTitle',
 * 'fetchPageMetadata' et 'connectors:lookup' (electron/main.ts), que le
 * navigateur ne peut pas rejouer lui-même : le web passe par les endpoints
 * proxy POST /meta/page et POST /meta/lookup du Worker (l'URL ou la requête
 * voyagent dans le corps, hors des logs d'infrastructure, du Referer et des
 * caches d'URL).
 *
 * Pourquoi un proxy alors que le desktop appelle en direct : la CSP du client
 * web épingle `connect-src` à api.filarr.com, et on ne l'élargit PAS — une
 * origine tierce joignable depuis la page serait une surface d'exfiltration.
 *
 * Contrat privacy (posture actée, commun aux deux endpoints) :
 *  - proxy OPT-IN : tant que l'utilisateur ne l'a pas activé explicitement,
 *    retour null et ZÉRO requête réseau — l'opt-in est le geste explicite ;
 *  - DEUX consentements SÉPARÉS, parce que ce n'est pas la même donnée qui
 *    part : `filarr-web-meta-proxy` couvre les aperçus de liens (l'URL des
 *    pages que vous ouvrez), `filarr-web-connectors` couvre les connecteurs
 *    (les quelques mots cherchés, et la clé TMDB si elle est configurée).
 *    Accepter l'un n'active JAMAIS l'autre, dans aucun des deux sens ;
 *  - ni l'URL, ni la requête de recherche, ni la clé d'API ne sont JAMAIS
 *    journalisées côté serveur (contrat des endpoints) ;
 *  - seule l'URL du lien (ou les quelques mots cherchés) transite — le contenu
 *    des notes ne quitte jamais le client.
 *
 * Contrat d'échec : les consommateurs desktop (bookmarkExtension,
 * autoLinkTitleExtension) attendent null, jamais un throw.
 */

import { buildConnectorRequest } from '../../connectors/connectorSources';
import { apiFetch } from '../webApiBase';

/** Aperçus de liens : ce qui part est l'URL des pages ouvertes. */
const OPT_IN_KEY = 'filarr-web-meta-proxy';

/**
 * Connecteurs : ce qui part est ce que l'utilisateur CHERCHE (et sa clé TMDB).
 * Clé distincte à dessein — accepter les aperçus de liens ne doit jamais
 * envoyer un terme de recherche, ni l'inverse.
 */
const CONNECTOR_OPT_IN_KEY = 'filarr-web-connectors';

function readOptIn(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeOptIn(key: string, v: boolean): void {
  try {
    if (v) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* localStorage indisponible : reste non opté */
  }
}

/** L'utilisateur a-t-il explicitement activé le proxy de métadonnées ? */
export function isMetaProxyOptedIn(): boolean {
  return readOptIn(OPT_IN_KEY);
}

export function setMetaProxyOptIn(v: boolean): void {
  writeOptIn(OPT_IN_KEY, v);
}

/** L'utilisateur a-t-il explicitement activé le relais des connecteurs ? */
export function isConnectorProxyOptedIn(): boolean {
  return readOptIn(CONNECTOR_OPT_IN_KEY);
}

export function setConnectorProxyOptIn(v: boolean): void {
  writeOptIn(CONNECTOR_OPT_IN_KEY, v);
}

/** Forme de retour du handler desktop 'fetchPageMetadata' — miroir exact. */
interface PageMetadata {
  title: string;
  description: string;
  image: string;
  favicon: string;
  domain: string;
}

async function fetchMetaViaProxy(url: unknown): Promise<PageMetadata | null> {
  // Mêmes gardes d'entrée que le desktop (elles évitent aussi un appel inutile).
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  if (!isMetaProxyOptedIn()) return null;
  try {
    const res = await apiFetch<{ data?: Partial<PageMetadata> }>('/meta/page', {
      method: 'POST',
      body: { url },
    });
    const data = res.body?.data;
    if (res.status !== 200 || !res.body?.success || !data) return null;
    let domain = data.domain ?? '';
    if (!domain) {
      try {
        domain = new URL(url).hostname;
      } catch {
        /* URL déjà validée — improbable */
      }
    }
    return {
      title: data.title ?? '',
      description: data.description ?? '',
      image: data.image ?? '',
      favicon: data.favicon ?? '',
      domain,
    };
  } catch {
    return null;
  }
}

/**
 * Connecteurs de bases inline. Le client n'envoie JAMAIS d'URL : le corps est
 * `{ source, query, apiKey?, lang? }` et c'est le Worker qui fabrique l'appel
 * amont depuis la liste blanche partagée. La même validation est rejouée ici,
 * en amont du réseau : une source inconnue ou une requête hors bornes n'a
 * aucune raison de coûter un aller-retour.
 *
 * Retour : le JSON amont BRUT (la normalisation vit chez l'appelant, partagée
 * avec le chemin desktop), ou null.
 */
async function lookupViaProxy(input: unknown): Promise<unknown> {
  // Opt-in PROPRE aux connecteurs : celui des aperçus de liens ne l'ouvre pas.
  if (!isConnectorProxyOptedIn()) return null;
  const built = buildConnectorRequest(input);
  if (!built.ok) return null;
  const { source, query, apiKey, lang } = input as {
    source: string;
    query: string;
    apiKey?: string;
    lang?: string;
  };
  try {
    const res = await apiFetch<{ data?: unknown }>('/meta/lookup', {
      method: 'POST',
      body: { source, query, apiKey, lang },
    });
    if (res.status !== 200 || !res.body?.success) return null;
    return res.body.data ?? null;
  } catch {
    return null;
  }
}

export const metaHandlers: Record<string, (...args: unknown[]) => unknown> = {
  // Desktop : string (jamais vide) | null.
  fetchPageTitle: async (url: unknown) => {
    const meta = await fetchMetaViaProxy(url);
    return meta?.title || null;
  },

  fetchPageMetadata: (url: unknown) => fetchMetaViaProxy(url),

  'connectors:lookup': (input: unknown) => lookupViaProxy(input),
};
