/**
 * Source `movies` — TMDB (`/search/movie`, clé de l'utilisateur).
 *
 * Forme amont : `{ results: [{ id, title, release_date, poster_path,
 * vote_average, overview, genre_ids }] }`. `vote_average` est sur 10 et les
 * genres n'arrivent QUE sous forme d'identifiants : c'est la source auxiliaire
 * `movieGenres` (`/genre/movie/list`, mise en cache par l'appelant) qui les
 * nomme. Sans cette table, les identifiants sont conservés dans `extra` et
 * aucun genre n'est proposé — jamais de numéro affiché comme un genre.
 */

import { TMDB_IMAGE_BASE } from '../../../../../../platform/connectors/connectorSources';
import type { ConnectorResult } from './connectorResult';
import {
  MAX_CONNECTOR_RESULTS,
  asArray,
  asPositiveInt,
  asRecord,
  asText,
  asIsoDate,
  cleanGenres,
  toDescription,
  toRating5,
  yearFromDate,
} from './connectorResult';

const TMDB_MOVIE_PAGE = 'https://www.themoviedb.org/movie/';

/** Table `genre_ids → nom` issue de la source `movieGenres`. */
export type MovieGenreNames = Record<number, string>;

/** `{ genres: [{ id, name }] }` → table de correspondance (jamais d'exception). */
export function normalizeMovieGenres(raw: unknown): MovieGenreNames {
  const table: MovieGenreNames = {};
  for (const entry of asArray(asRecord(raw)?.genres)) {
    const genre = asRecord(entry);
    if (!genre) continue;
    const id = asPositiveInt(genre.id);
    const name = asText(genre.name, 40);
    if (id === undefined || !name) continue;
    table[id] = name;
  }
  return table;
}

export function normalizeMovies(raw: unknown, genreNames?: MovieGenreNames): ConnectorResult[] {
  const root = asRecord(raw);
  if (!root) return [];
  const out: ConnectorResult[] = [];

  for (const entry of asArray(root.results)) {
    if (out.length >= MAX_CONNECTOR_RESULTS) break;
    const movie = asRecord(entry);
    if (!movie) continue;
    const title = asText(movie.title) ?? asText(movie.name);
    if (!title) continue;

    const id = asPositiveInt(movie.id);
    const poster = typeof movie.poster_path === 'string' ? movie.poster_path.trim() : '';
    const genreIds = asArray(movie.genre_ids)
      .map((g) => asPositiveInt(g))
      .filter((g): g is number => g !== undefined);
    const named = genreNames
      ? genreIds.map((gid) => genreNames[gid]).filter((n): n is string => typeof n === 'string')
      : [];

    out.push({
      id: `movies:${id ?? title}`,
      title,
      subtitle: asText(movie.original_title) === title ? undefined : asText(movie.original_title),
      year: yearFromDate(movie.release_date),
      // `poster_path` arrive en chemin relatif : le préfixe vient de la liste blanche
      imageUrl: /^\/[\w./-]+$/.test(poster) ? `${TMDB_IMAGE_BASE}${poster}` : undefined,
      url: id !== undefined ? `${TMDB_MOVIE_PAGE}${id}` : undefined,
      description: toDescription(movie.overview),
      rating: toRating5(movie.vote_average, 10),
      genres: cleanGenres(named),
      extra: { genreIds, releaseDate: asIsoDate(movie.release_date) },
    });
  }

  return out;
}
