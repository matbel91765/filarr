/**
 * Source `tv` — TVMaze (`/search/shows`, sans clé).
 *
 * Forme amont : un TABLEAU de `{ score, show: { … } }` — l'objet utile est
 * imbriqué sous `.show`. `rating.average` est sur 10 et `summary` est du HTML
 * (`<p>…</p>`), donc dé-balisé sans exception.
 */

import type { ConnectorResult } from './connectorResult';
import {
  MAX_CONNECTOR_RESULTS,
  asArray,
  asPositiveInt,
  asRecord,
  asText,
  asHttpUrl,
  asIsoDate,
  cleanGenres,
  toDescription,
  toRating5,
  yearFromDate,
} from './connectorResult';

export function normalizeTv(raw: unknown): ConnectorResult[] {
  // TVMaze rend un tableau nu ; on tolère aussi `{ results: [...] }` par prudence
  const list = Array.isArray(raw) ? raw : asArray(asRecord(raw)?.results);
  const out: ConnectorResult[] = [];

  for (const entry of list) {
    if (out.length >= MAX_CONNECTOR_RESULTS) break;
    const wrapper = asRecord(entry);
    if (!wrapper) continue;
    // `/search/shows` emballe sous `.show` ; `/shows/{id}` rend l'objet nu
    const show = asRecord(wrapper.show) ?? wrapper;
    const title = asText(show.name);
    if (!title) continue;

    const premiered = asIsoDate(show.premiered);
    const status = asText(show.status, 40);
    // Diffuseur : chaîne hertzienne, sinon plateforme — meilleur sous-titre que le statut
    const network = asText(asRecord(show.network)?.name, 60);
    const webChannel = asText(asRecord(show.webChannel)?.name, 60);

    out.push({
      id: `tv:${asPositiveInt(show.id) ?? title}`,
      title,
      subtitle: network ?? webChannel ?? status,
      year: yearFromDate(show.premiered),
      imageUrl: asHttpUrl(asRecord(show.image)?.medium),
      url: asHttpUrl(show.url),
      description: toDescription(show.summary),
      rating: toRating5(asRecord(show.rating)?.average, 10),
      genres: cleanGenres(show.genres),
      extra: { status, releaseDate: premiered, network: network ?? webChannel },
    });
  }

  return out;
}
