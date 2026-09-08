/**
 * Connecteurs de bases inline — POINT D'ENTRÉE.
 *
 * Tout est PUR : ce dossier ne fait aucun appel réseau et ne commite rien. Le
 * transport (`connectors:lookup`, desktop ou proxy web) rend le JSON amont brut,
 * `normalize()` le ramène au contrat commun `ConnectorResult`, et
 * `buildCellUpdates()` dit quelles cellules écrire dans la ligne visée.
 *
 * Chaîne complète côté appelant :
 *   const raw = await window.electron.ipcRenderer.invoke('connectors:lookup', { source, query });
 *   const results = normalize(source, raw, { movieGenres });
 *   const updates = buildCellUpdates(results[i], data.properties, row.cells);
 *   // → commiter d'un bloc : mergeNewOptions(data.properties, updates.newOptions) + updates.cells
 */

import type { ConnectorSourceId } from '../../../../../../platform/connectors/connectorSources';
import type { ConnectorResult } from './connectorResult';
import { normalizeBooks } from './books';
import { normalizeAnime } from './anime';
import { normalizeTv } from './tv';
import { normalizeMovies, type MovieGenreNames } from './movies';

export type { ConnectorResult } from './connectorResult';
export {
  MAX_CONNECTOR_RESULTS,
  MAX_DESCRIPTION_LENGTH,
  MAX_GENRES,
  cleanGenres,
  foldLabel,
  stripHtml,
  toRating5,
} from './connectorResult';
export { normalizeBooks } from './books';
export { normalizeAnime } from './anime';
export { normalizeTv } from './tv';
export { normalizeMovies, normalizeMovieGenres, type MovieGenreNames } from './movies';
export {
  buildCellUpdates,
  hasCellUpdates,
  isCellEmpty,
  matchFieldByName,
  MAX_PROPERTY_OPTIONS,
  mergeNewOptions,
  rowSearchQuery,
  type ConnectorCellUpdates,
  type ConnectorField,
} from './cellMapping';

export interface NormalizeOptions {
  /** Table TMDB `genre_ids → noms` (source auxiliaire `movieGenres`, mise en cache). */
  movieGenres?: MovieGenreNames;
}

/**
 * JSON amont brut → résultats normalisés (5 au plus).
 *
 * TOLÉRANT PAR CONTRAT : une réponse inattendue, tronquée, `null` ou d'une
 * autre forme rend `[]`. Cette fonction ne lève JAMAIS — l'UI n'a donc qu'un
 * seul cas d'échec à traiter : « aucun résultat ».
 */
export function normalize(
  source: ConnectorSourceId,
  raw: unknown,
  options: NormalizeOptions = {}
): ConnectorResult[] {
  try {
    switch (source) {
      case 'books':
        return normalizeBooks(raw);
      case 'anime':
        return normalizeAnime(raw);
      case 'tv':
        return normalizeTv(raw);
      case 'movies':
        return normalizeMovies(raw, options.movieGenres);
      // Table de correspondance, pas une source de résultats (voir normalizeMovieGenres)
      case 'movieGenres':
        return [];
      default:
        return [];
    }
  } catch {
    return [];
  }
}
