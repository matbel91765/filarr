/**
 * Source `anime` — AniList (GraphQL, sans clé).
 *
 * Forme amont : `{ data: { Page: { media: [{ id, title:{romaji,english},
 * seasonYear, averageScore, episodes, status, genres[], coverImage:{medium},
 * siteUrl, description }] } } }`.
 * `averageScore` est sur 100. `description` contient du balisage (`<br>`,
 * `<i>`) MÊME avec `asHtml:false` : elle passe obligatoirement par stripHtml.
 */

import type { ConnectorResult } from './connectorResult';
import {
  MAX_CONNECTOR_RESULTS,
  asArray,
  asPositiveInt,
  asRecord,
  asText,
  asYear,
  asHttpUrl,
  cleanGenres,
  toDescription,
  toRating5,
} from './connectorResult';

/** `NOT_YET_RELEASED` → `Not yet released` (l'amont crie en SCREAMING_CASE). */
function humanStatus(value: unknown): string | undefined {
  const raw = asText(value, 40);
  if (!raw) return undefined;
  const words = raw.toLowerCase().replace(/_/g, ' ').trim();
  return words === '' ? undefined : words.charAt(0).toUpperCase() + words.slice(1);
}

export function normalizeAnime(raw: unknown): ConnectorResult[] {
  const page = asRecord(asRecord(asRecord(raw)?.data)?.Page);
  if (!page) return [];
  const out: ConnectorResult[] = [];

  for (const entry of asArray(page.media)) {
    if (out.length >= MAX_CONNECTOR_RESULTS) break;
    const media = asRecord(entry);
    if (!media) continue;

    const titles = asRecord(media.title);
    const english = asText(titles?.english);
    const romaji = asText(titles?.romaji);
    const title = english ?? romaji;
    if (!title) continue;

    const status = humanStatus(media.status);
    // Le titre romaji fait un sous-titre utile quand l'anglais l'a emporté
    const alternate = title === romaji ? undefined : romaji;

    out.push({
      id: `anime:${asPositiveInt(media.id) ?? title}`,
      title,
      subtitle: alternate ?? status,
      year: asYear(media.seasonYear),
      imageUrl: asHttpUrl(asRecord(media.coverImage)?.medium),
      url: asHttpUrl(media.siteUrl),
      description: toDescription(media.description),
      rating: toRating5(media.averageScore, 100),
      genres: cleanGenres(media.genres),
      count: asPositiveInt(media.episodes),
      extra: { status, romaji, english },
    });
  }

  return out;
}
