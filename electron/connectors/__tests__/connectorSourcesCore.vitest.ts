/**
 * Liste blanche des connecteurs côté DESKTOP — PARITÉ avec la source de vérité.
 *
 * Le portage `electron/connectors/connectorSourcesCore.ts` existe pour une
 * raison de compilation (racine `electron/`), pas pour diverger : la moindre
 * dérive de la table ferait que le desktop et le web n'interrogent plus les
 * mêmes hôtes avec les mêmes bornes. Ce test compare les deux implémentations
 * sur un jeu d'entrées partagé, succès ET rejets.
 */

import { describe, expect, it } from 'vitest';

import {
  buildConnectorRequest,
  CONNECTOR_MAX_API_KEY_LENGTH,
  CONNECTOR_MAX_QUERY_LENGTH,
  CONNECTOR_MAX_RESPONSE_BYTES,
  CONNECTOR_SOURCE_IDS,
  CONNECTOR_SOURCES,
  CONNECTOR_TIMEOUT_MS,
  isSelectableConnectorSourceId,
} from '../connectorSourcesCore';
import {
  buildConnectorRequest as buildOnWeb,
  CONNECTOR_MAX_API_KEY_LENGTH as WEB_MAX_API_KEY_LENGTH,
  CONNECTOR_MAX_QUERY_LENGTH as WEB_MAX_QUERY_LENGTH,
  CONNECTOR_MAX_RESPONSE_BYTES as WEB_MAX_RESPONSE_BYTES,
  CONNECTOR_SOURCE_IDS as WEB_SOURCE_IDS,
  CONNECTOR_SOURCES as WEB_SOURCES,
  CONNECTOR_TIMEOUT_MS as WEB_TIMEOUT_MS,
  isSelectableConnectorSourceId as isSelectableOnWeb,
} from '../../../src/platform/connectors/connectorSources';

const TMDB_KEY = '0123456789abcdef0123456789abcdef';

const cases: unknown[] = [
  { source: 'books', query: 'dune messiah' },
  { source: 'books', query: 'accents éàü & signes #?=' },
  { source: 'anime', query: 'frieren' },
  { source: 'tv', query: 'the wire' },
  { source: 'movies', query: 'blade runner', apiKey: TMDB_KEY, lang: 'fr-FR' },
  { source: 'movies', query: 'akira', apiKey: TMDB_KEY },
  { source: 'movieGenres', query: '', apiKey: TMDB_KEY, lang: 'fr' },
  { source: 'evil', query: 'x' },
  { source: 'http://127.0.0.1/admin', query: 'x' },
  { source: 'movies', query: 'akira' },
  { source: 'movies', query: 'akira', apiKey: 'bad key' },
  { source: 'movies', query: 'akira', apiKey: TMDB_KEY, lang: 'fr_FR' },
  { source: 'books', query: '' },
  { source: 'books', query: 'a'.repeat(CONNECTOR_MAX_QUERY_LENGTH + 1) },
  null,
  'books',
];

describe('connecteurs desktop — comportement', () => {
  it('construit un appel amont pour chaque source connue, https uniquement', () => {
    for (const id of CONNECTOR_SOURCE_IDS) {
      const built = buildConnectorRequest({ source: id, query: 'x', apiKey: TMDB_KEY });
      expect(built.ok, id).toBe(true);
      if (!built.ok) continue;
      expect(new URL(built.request.url).protocol, id).toBe('https:');
    }
  });

  it('refuse une source hors liste blanche et une requête hors bornes', () => {
    expect(buildConnectorRequest({ source: 'evil', query: 'x' })).toEqual({
      ok: false,
      error: 'unknown_source',
    });
    expect(
      buildConnectorRequest({
        source: 'books',
        query: 'a'.repeat(CONNECTOR_MAX_QUERY_LENGTH + 1),
      })
    ).toEqual({ ok: false, error: 'invalid_query' });
  });
});

describe('parité avec src/platform/connectors/connectorSources.ts', () => {
  it('mêmes identifiants', () => {
    expect([...CONNECTOR_SOURCE_IDS]).toEqual([...WEB_SOURCE_IDS]);
  });

  it('mêmes bornes', () => {
    expect(CONNECTOR_MAX_QUERY_LENGTH).toBe(WEB_MAX_QUERY_LENGTH);
    expect(CONNECTOR_MAX_API_KEY_LENGTH).toBe(WEB_MAX_API_KEY_LENGTH);
    expect(CONNECTOR_TIMEOUT_MS).toBe(WEB_TIMEOUT_MS);
    expect(CONNECTOR_MAX_RESPONSE_BYTES).toBe(WEB_MAX_RESPONSE_BYTES);
  });

  it('mêmes métadonnées de source', () => {
    for (const id of CONNECTOR_SOURCE_IDS) {
      expect({ ...CONNECTOR_SOURCES[id], build: undefined }, id).toEqual({
        ...WEB_SOURCES[id],
        build: undefined,
      });
    }
  });

  it('mêmes appels amont et mêmes rejets, cas par cas', () => {
    for (const input of cases) {
      expect(buildConnectorRequest(input), JSON.stringify(input)).toEqual(buildOnWeb(input));
    }
  });

  it('même notion de source choisissable', () => {
    for (const value of [...CONNECTOR_SOURCE_IDS, 'evil', '', null]) {
      expect(isSelectableConnectorSourceId(value), String(value)).toBe(isSelectableOnWeb(value));
    }
    expect(isSelectableConnectorSourceId('movieGenres')).toBe(false);
  });
});
