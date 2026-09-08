/**
 * Connecteurs de bases inline — LISTE BLANCHE des sources amont (SOURCE DE VÉRITÉ).
 *
 * GARDE ANTI-SSRF, principe non négociable : le client n'envoie JAMAIS d'URL.
 * Il envoie `{ source, query, apiKey?, lang? }` et c'est CE module qui fabrique
 * l'appel amont à partir d'une table figée. Aucune URL arbitraire ne peut donc
 * être proxifiée, ni par le Worker, ni par le processus principal Electron.
 *
 * Deux transports, même table :
 *  - DESKTOP : appel direct depuis le processus principal (canal IPC
 *    `connectors:lookup`, `net.fetch`) — aucun tiers dans la boucle ;
 *  - WEB : `POST /meta/lookup` sur le Worker, car la CSP du client web épingle
 *    `connect-src` à api.filarr.com. Opt-in PROPRE aux connecteurs
 *    (`isConnectorProxyOptedIn`), distinct de celui des aperçus de liens : ce
 *    qui part n'est pas la même donnée, l'accord n'est donc pas le même.
 *
 * MIROIRS (le module est recopié à l'identique, en-tête excepté, parce que les
 * trois programmes ont des racines de compilation disjointes) :
 *  - `electron/connectors/connectorSourcesCore.ts` (racine electron/) ;
 *  - `infra/cloudflare-worker/src/connectorSources.ts` (racine du Worker).
 * Les tests de parité `src/platform/connectors/__tests__/connectorSources.vitest.ts`
 * et `electron/connectors/__tests__/connectorSourcesCore.vitest.ts` comparent les
 * copies à ce fichier sur un jeu d'entrées partagé : toute dérive se voit.
 *
 * PRIVACY : la requête de l'utilisateur et sa clé d'API ne sont jamais
 * journalisées, d'aucun côté. La clé TMDB est saisie dans les Paramètres et
 * stockée LOCALEMENT (jamais synchronisée) ; en desktop elle part directement
 * vers TMDB, en web elle TRANSITE par notre relais, qui ne la journalise ni ne
 * la conserve.
 */

/** Identifiants admis. Rien d'autre ne peut être proxifié. */
export const CONNECTOR_SOURCE_IDS = ['books', 'anime', 'tv', 'movies', 'movieGenres'] as const;

export type ConnectorSourceId = (typeof CONNECTOR_SOURCE_IDS)[number];

/** Requête reçue du client. Volontairement sans URL. */
export interface ConnectorLookupInput {
  source: string;
  query: string;
  apiKey?: string;
  lang?: string;
}

/** Appel amont fabriqué ici, seule forme que les transports acceptent d'émettre. */
export interface UpstreamRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export type ConnectorLookupError =
  | 'unknown_source'
  | 'invalid_query'
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'invalid_lang';

export interface ConnectorSource {
  id: ConnectorSourceId;
  /** Libellé de repli en anglais ; l'UI affiche sa traduction i18n. */
  label: string;
  /** Une clé d'API de l'utilisateur est-elle indispensable ? */
  requiresApiKey: boolean;
  /** Où l'obtenir gratuitement (affiché quand la clé manque). */
  apiKeyUrl?: string;
  /** `movieGenres` sert de table de correspondance, pas de source à choisir. */
  internal?: boolean;
  build(args: { query: string; apiKey: string; lang: string }): UpstreamRequest;
}

/** Bornes partagées par les deux transports. */
export const CONNECTOR_MAX_QUERY_LENGTH = 200;
export const CONNECTOR_MAX_API_KEY_LENGTH = 128;
export const CONNECTOR_TIMEOUT_MS = 8_000;
export const CONNECTOR_MAX_RESPONSE_BYTES = 512_000;

/** Préfixes d'images des sources — utiles à la normalisation côté client. */
export const OPENLIBRARY_COVER_BASE = 'https://covers.openlibrary.org/b/id/';
export const OPENLIBRARY_WORK_BASE = 'https://openlibrary.org';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';

const DEFAULT_LANG = 'en-US';

/** `fr`, `fr-FR`… — rien d'autre n'entre dans une URL amont. */
const LANG_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Charset d'une clé d'API : interdit toute injection dans la query string. */
const API_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

const JSON_ACCEPT = { Accept: 'application/json' };

/**
 * UA descriptif : OpenLibrary et TVMaze demandent poliment d'être identifiable.
 * Jamais émis depuis un navigateur (les deux transports sont hors navigateur).
 */
const USER_AGENT = 'Filarr/1.0 (+https://filarr.com)';

const OPENLIBRARY_FIELDS =
  'title,author_name,first_publish_year,cover_i,number_of_pages_median,subject,key';

const ANILIST_QUERY =
  'query($s:String){Page(perPage:5){media(search:$s,type:ANIME){id title{romaji english} seasonYear averageScore episodes status genres coverImage{medium} siteUrl description(asHtml:false)}}}';

export const CONNECTOR_SOURCES: Record<ConnectorSourceId, ConnectorSource> = {
  books: {
    id: 'books',
    label: 'Books',
    requiresApiKey: false,
    build: ({ query }) => ({
      url:
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}` +
        `&limit=5&fields=${OPENLIBRARY_FIELDS}`,
      method: 'GET',
      headers: { ...JSON_ACCEPT, 'User-Agent': USER_AGENT },
    }),
  },

  anime: {
    id: 'anime',
    label: 'Anime',
    requiresApiKey: false,
    build: ({ query }) => ({
      url: 'https://graphql.anilist.co',
      method: 'POST',
      headers: { ...JSON_ACCEPT, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ query: ANILIST_QUERY, variables: { s: query } }),
    }),
  },

  tv: {
    id: 'tv',
    label: 'TV shows',
    requiresApiKey: false,
    build: ({ query }) => ({
      url: `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
      method: 'GET',
      headers: { ...JSON_ACCEPT, 'User-Agent': USER_AGENT },
    }),
  },

  movies: {
    id: 'movies',
    label: 'Movies',
    requiresApiKey: true,
    apiKeyUrl: 'https://www.themoviedb.org/settings/api',
    build: ({ query, apiKey, lang }) => ({
      url:
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}` +
        `&language=${encodeURIComponent(lang)}&api_key=${encodeURIComponent(apiKey)}`,
      method: 'GET',
      headers: { ...JSON_ACCEPT, 'User-Agent': USER_AGENT },
    }),
  },

  // Table des genres TMDB (genre_ids → noms). Mise en cache par le client, donc
  // appelée rarement : ce n'est pas une source proposée dans le sélecteur.
  movieGenres: {
    id: 'movieGenres',
    label: 'Movie genres',
    requiresApiKey: true,
    apiKeyUrl: 'https://www.themoviedb.org/settings/api',
    internal: true,
    build: ({ apiKey, lang }) => ({
      url:
        `https://api.themoviedb.org/3/genre/movie/list?language=${encodeURIComponent(lang)}` +
        `&api_key=${encodeURIComponent(apiKey)}`,
      method: 'GET',
      headers: { ...JSON_ACCEPT, 'User-Agent': USER_AGENT },
    }),
  },
};

export function isConnectorSourceId(value: unknown): value is ConnectorSourceId {
  return typeof value === 'string' && (CONNECTOR_SOURCE_IDS as readonly string[]).includes(value);
}

/**
 * Source CHOISISSABLE par l'utilisateur : `isConnectorSourceId` admet aussi les
 * auxiliaires internes (`movieGenres`), qui ne figurent pas dans le sélecteur.
 * C'est cette garde-ci que doit utiliser tout ce qui lit l'attribut `source`
 * d'un bloc — sinon un bloc bricolé afficherait une source fantôme.
 */
export function isSelectableConnectorSourceId(value: unknown): value is ConnectorSourceId {
  return isConnectorSourceId(value) && CONNECTOR_SOURCES[value].internal !== true;
}

/** Sources proposées à l'utilisateur (l'auxiliaire `movieGenres` est masquée). */
export function listConnectorSources(): ConnectorSource[] {
  return CONNECTOR_SOURCE_IDS.map((id) => CONNECTOR_SOURCES[id]).filter((s) => !s.internal);
}

export type BuildConnectorResult =
  | { ok: true; source: ConnectorSourceId; request: UpstreamRequest }
  | { ok: false; error: ConnectorLookupError };

/**
 * Seule porte d'entrée des deux transports : valide l'entrée client puis
 * fabrique l'appel amont. Ne journalise rien et ne reprend jamais la requête
 * ni la clé dans son code d'erreur.
 */
export function buildConnectorRequest(input: unknown): BuildConnectorResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'unknown_source' };
  }
  const { source, query, apiKey, lang } = input as Partial<ConnectorLookupInput>;

  if (!isConnectorSourceId(source)) {
    return { ok: false, error: 'unknown_source' };
  }
  const descriptor = CONNECTOR_SOURCES[source];

  const rawQuery = typeof query === 'string' ? query.trim() : '';
  if (rawQuery.length > CONNECTOR_MAX_QUERY_LENGTH) {
    return { ok: false, error: 'invalid_query' };
  }
  // `movieGenres` n'interroge rien : sa requête peut être vide.
  if (rawQuery.length === 0 && !descriptor.internal) {
    return { ok: false, error: 'invalid_query' };
  }

  let key = '';
  if (descriptor.requiresApiKey) {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return { ok: false, error: 'missing_api_key' };
    }
    key = apiKey.trim();
    if (key.length > CONNECTOR_MAX_API_KEY_LENGTH || !API_KEY_PATTERN.test(key)) {
      return { ok: false, error: 'invalid_api_key' };
    }
  }

  let language = DEFAULT_LANG;
  if (lang !== undefined && lang !== null && lang !== '') {
    if (typeof lang !== 'string' || !LANG_PATTERN.test(lang)) {
      return { ok: false, error: 'invalid_lang' };
    }
    language = lang;
  }

  return {
    ok: true,
    source,
    request: descriptor.build({ query: rawQuery, apiKey: key, lang: language }),
  };
}
