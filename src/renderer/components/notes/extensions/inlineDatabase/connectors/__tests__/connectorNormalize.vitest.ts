/**
 * Normalisation des quatre sources — sur FIXTURES FIGÉES, zéro réseau.
 *
 * Ce que ces tests protègent, et qui casse silencieusement au refactor :
 *  - les échelles de notes (AniList /100, TVMaze et TMDB /10) et le fait qu'une
 *    note existante ne retombe JAMAIS à 0 (0 = « pas de note » dans nos colonnes) ;
 *  - le dé-balisage : aucune balise ne doit survivre, même encodée en entités ;
 *  - la tolérance : toute réponse inattendue rend `[]`, jamais d'exception.
 */

import { describe, it, expect } from 'vitest';
import {
  normalize,
  normalizeBooks,
  normalizeAnime,
  normalizeTv,
  normalizeMovies,
  normalizeMovieGenres,
  stripHtml,
  toRating5,
  cleanGenres,
  MAX_CONNECTOR_RESULTS,
  MAX_DESCRIPTION_LENGTH,
} from '../index';
import {
  ANIME_FIXTURE,
  BOOKS_FIXTURE,
  MOVIES_FIXTURE,
  MOVIE_GENRES_FIXTURE,
  TV_FIXTURE,
} from '../__fixtures__/upstreamSamples';

const genreTable = normalizeMovieGenres(MOVIE_GENRES_FIXTURE);

describe('toRating5 — conversion des échelles', () => {
  it('ramène AniList (/100) sur 0-5', () => {
    expect(toRating5(88, 100)).toBe(4);
    expect(toRating5(100, 100)).toBe(5);
    expect(toRating5(50, 100)).toBe(3); // 2,5 → arrondi supérieur
  });

  it('ramène TVMaze/TMDB (/10) sur 0-5', () => {
    expect(toRating5(6.5, 10)).toBe(3);
    expect(toRating5(8.8, 10)).toBe(4);
    expect(toRating5(7.8, 10)).toBe(4);
  });

  it('ne rend JAMAIS 0 quand la source a une note (0 = pas de note)', () => {
    expect(toRating5(0.2, 10)).toBe(1);
    expect(toRating5(1, 100)).toBe(1);
  });

  it('rend undefined quand la source n’a pas de note', () => {
    expect(toRating5(0, 10)).toBeUndefined();
    expect(toRating5(null, 10)).toBeUndefined();
    expect(toRating5(undefined, 100)).toBeUndefined();
    expect(toRating5(-4, 10)).toBeUndefined();
    expect(toRating5({}, 10)).toBeUndefined();
    expect(toRating5('pas un nombre', 10)).toBeUndefined();
  });

  it('borne à 5 une note aberrante et accepte une note en texte', () => {
    expect(toRating5(50, 10)).toBe(5);
    expect(toRating5('7.4', 10)).toBe(4);
  });
});

describe('stripHtml — texte nu, jamais de HTML', () => {
  it('retire les balises et garde le texte', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('supprime le contenu des scripts et des styles', () => {
    expect(stripHtml('<script>alert(1)</script>Texte')).toBe('Texte');
    expect(stripHtml('<style>p{}</style>Texte')).toBe('Texte');
  });

  it('décode les entités courantes', () => {
    expect(stripHtml('a &amp; b &#39;c&#39;&nbsp;d &hellip;')).toBe("a & b 'c' d …");
  });

  it('re-débalise ce qu’une entité cachait (aucune injection possible)', () => {
    const out = stripHtml('avant &lt;img src=x onerror=alert(1)&gt; apres');
    expect(out).toBe('avant apres');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  it('rend une chaîne vide sur entrée non textuelle', () => {
    expect(stripHtml(42)).toBe('');
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });
});

describe('cleanGenres', () => {
  it('déduplique sans casse ni accents, écarte le bruit et borne la liste', () => {
    expect(cleanGenres(['Action', 'action', '  ', 'Comédie', 'comedie', 12, 'Drame'])).toEqual([
      'Action',
      'Comédie',
      'Drame',
    ]);
  });

  it('rend undefined quand il ne reste rien', () => {
    expect(cleanGenres([])).toBeUndefined();
    expect(cleanGenres(null)).toBeUndefined();
    expect(cleanGenres(['x'.repeat(80)])).toBeUndefined();
  });
});

describe('normalize — books (OpenLibrary)', () => {
  const results = normalize('books', BOOKS_FIXTURE);

  it('borne à 5 et écarte les documents sans titre', () => {
    expect(results).toHaveLength(MAX_CONNECTOR_RESULTS);
    expect(results.map((r) => r.title)).toEqual([
      'Dune',
      'Dune Messiah',
      'Dune, tome 3',
      'Le Messie de Dune',
      'Les Enfants de Dune',
    ]);
  });

  it('compose couverture, fiche, auteurs et pages', () => {
    expect(results[0]).toMatchObject({
      id: 'books:/works/OL893415W',
      title: 'Dune',
      subtitle: 'Frank Herbert',
      year: 1965,
      imageUrl: 'https://covers.openlibrary.org/b/id/8231990-M.jpg',
      url: 'https://openlibrary.org/works/OL893415W',
      count: 604,
    });
  });

  it('limite les auteurs du sous-titre et nettoie les sujets', () => {
    expect(results[1].subtitle).toBe('Frank Herbert, Brian Herbert, Kevin J. Anderson');
    expect(results[0].genres).toEqual([
      'Science fiction',
      'Fiction',
      'Ecology',
      'Desert life',
      'Politics',
      'Nobility',
    ]);
  });

  it('écarte le CATALOGAGE des sujets OpenLibrary, pas les genres', () => {
    const [book] = normalizeBooks({
      docs: [
        {
          key: '/works/OLxW',
          title: 'Un livre catalogué',
          subject: [
            // Gardés : deux ou trois mots, sans chiffre ni ponctuation de notice
            'Science fiction',
            'Fantasy',
            'Detective stories',
            // Écartés : phrase de notice, inversion, chiffres, mots de catalogage
            'Fiction, science fiction, general',
            'History -- 20th century',
            'English literature 1900-1945',
            'Accessible book',
            'Protected DAISY',
            'New York Times bestseller',
            'General fiction',
            'Juvenile fiction',
            'Translations into French',
            'History and criticism',
            'Large type books',
            'Detective and mystery stories, English',
            'Ecology (Biology)',
            'Man-woman relationships in literature and art',
            // Doublon de casse : écarté plus loin par cleanGenres
            'science FICTION',
          ],
        },
      ],
    });
    expect(book.genres).toEqual(['Science fiction', 'Fantasy', 'Detective stories']);
  });

  it('ne rend AUCUN genre quand les sujets ne sont que du catalogage', () => {
    const [book] = normalizeBooks({
      docs: [
        {
          key: '/works/OLyW',
          title: 'Notice pure',
          subject: ['Accessible book', 'In library', 'Fiction, general', '20th century'],
        },
      ],
    });
    expect(book.genres).toBeUndefined();
  });

  it('n’invente ni note ni résumé (la recherche OpenLibrary n’en a pas)', () => {
    for (const r of results) {
      expect(r.rating).toBeUndefined();
      expect(r.description).toBeUndefined();
    }
  });

  it('laisse vides les champs absents ou incohérents', () => {
    expect(results[2].year).toBeUndefined();
    expect(results[4].imageUrl).toBeUndefined();
    expect(results[4].count).toBeUndefined();
  });
});

describe('normalize — anime (AniList)', () => {
  const results = normalize('anime', ANIME_FIXTURE);

  it('préfère le titre anglais et met le romaji en sous-titre', () => {
    expect(results[1].title).toBe('Attack on Titan');
    expect(results[1].subtitle).toBe('Shingeki no Kyojin');
  });

  it('retombe sur le romaji et le statut lisible quand l’anglais manque', () => {
    expect(results[2].title).toBe('Sans note ni saison');
    expect(results[2].subtitle).toBe('Not yet released');
  });

  it('convertit averageScore (/100) et reprend épisodes, genres, image', () => {
    expect(results[0]).toMatchObject({
      id: 'anime:21',
      year: 1999,
      rating: 4,
      count: 1122,
      url: 'https://anilist.co/anime/21',
      imageUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/21.jpg',
    });
    expect(results[0].genres).toHaveLength(6); // 7 genres amont, liste bornée
  });

  it('rend une description SANS aucune balise, entités comprises', () => {
    const description = results[0].description ?? '';
    expect(description).toContain('King of the Pirates');
    expect(description).not.toMatch(/[<>]/);
    expect(description).not.toContain('<br>');
    expect(description).not.toContain('script');
  });

  it('écarte une URL non http(s) et une note absente', () => {
    expect(results[2].url).toBeUndefined();
    expect(results[2].rating).toBeUndefined();
    expect(results[2].genres).toBeUndefined();
    expect(results[2].imageUrl).toBeUndefined();
  });
});

describe('normalize — tv (TVMaze)', () => {
  const results = normalize('tv', TV_FIXTURE);

  it('déballe `.show`, convertit la note (/10) et l’année', () => {
    expect(results[0]).toMatchObject({
      id: 'tv:1',
      title: 'Under the Dome',
      year: 2013,
      rating: 3,
      subtitle: 'CBS',
      url: 'https://www.tvmaze.com/shows/1/under-the-dome',
    });
    expect(results[1].rating).toBe(4);
  });

  it('retient la plateforme quand il n’y a pas de chaîne, le statut sinon', () => {
    expect(results[1].subtitle).toBe('Netflix');
    expect(results[2].subtitle).toBe('Running');
  });

  it('dé-balise le résumé et jette le contenu des scripts', () => {
    expect(results[0].description).toBe(
      'Under the Dome is the story of a small town that is suddenly & inexplicably sealed off from the rest of the world by an enormous transparent dome.'
    );
    expect(results[0].description).not.toContain('alert');
  });

  it('garde la date de sortie complète dans extra (colonnes date)', () => {
    expect(results[0].extra?.releaseDate).toBe('2013-06-24');
    expect(results[2].extra?.releaseDate).toBeUndefined();
  });

  it('laisse tomber note, année et image absentes', () => {
    expect(results[2].rating).toBeUndefined();
    expect(results[2].year).toBeUndefined();
    expect(results[2].imageUrl).toBeUndefined();
    expect(results[2].description).toBeUndefined();
  });
});

describe('normalize — movies (TMDB)', () => {
  it('construit affiche, fiche, année et note', () => {
    const results = normalize('movies', MOVIES_FIXTURE, { movieGenres: genreTable });
    expect(results[0]).toMatchObject({
      id: 'movies:438631',
      title: 'Dune',
      year: 2021,
      rating: 4,
      imageUrl: 'https://image.tmdb.org/t/p/w200/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
      url: 'https://www.themoviedb.org/movie/438631',
    });
    expect(results[0].extra?.releaseDate).toBe('2021-09-15');
  });

  it('nomme les genres via la table movieGenres', () => {
    const results = normalize('movies', MOVIES_FIXTURE, { movieGenres: genreTable });
    expect(results[1].genres).toEqual(['Science-Fiction', 'Aventure', 'Action']);
  });

  it('sans table de genres, ne propose AUCUN genre (jamais d’identifiant brut)', () => {
    const results = normalizeMovies(MOVIES_FIXTURE);
    expect(results[0].genres).toBeUndefined();
    expect(results[0].extra?.genreIds).toEqual([878, 12]);
  });

  it('ne met le titre original en sous-titre que s’il diffère', () => {
    const results = normalize('movies', MOVIES_FIXTURE);
    expect(results[0].subtitle).toBeUndefined();
    expect(results[1].subtitle).toBe('Dune: Part Two');
  });

  it('traite vote_average 0 comme « pas de note » et ignore une affiche absente', () => {
    const results = normalize('movies', MOVIES_FIXTURE);
    expect(results[2].rating).toBeUndefined();
    expect(results[2].imageUrl).toBeUndefined();
    expect(results[2].year).toBeUndefined();
    expect(results[2].description).toBeUndefined();
  });

  it('normalizeMovieGenres écarte les entrées inexploitables', () => {
    expect(genreTable).toEqual({ 28: 'Action', 12: 'Aventure', 878: 'Science-Fiction' });
    expect(normalizeMovieGenres(null)).toEqual({});
  });
});

describe('normalize — tolérance (contrat : jamais d’exception)', () => {
  const junk: unknown[] = [
    null,
    undefined,
    0,
    'oops',
    [],
    {},
    { docs: 'pas un tableau' },
    { results: 42 },
    { data: null },
    { data: { Page: { media: null } } },
    [{ show: 'pas un objet' }],
    { docs: [1, 'deux', null, []] },
  ];

  it('rend [] sur toute forme inattendue, pour les quatre sources', () => {
    for (const source of ['books', 'anime', 'tv', 'movies'] as const) {
      for (const raw of junk) {
        expect(() => normalize(source, raw)).not.toThrow();
        expect(normalize(source, raw)).toEqual([]);
      }
    }
  });

  it('rend [] pour la source auxiliaire movieGenres', () => {
    expect(normalize('movieGenres', MOVIE_GENRES_FIXTURE)).toEqual([]);
  });

  it('avale même une réponse piégée qui lève à la lecture', () => {
    const hostile = {
      get docs(): unknown {
        throw new Error('boom');
      },
    };
    expect(() => normalize('books', hostile)).not.toThrow();
    expect(normalize('books', hostile)).toEqual([]);
  });

  it('les normaliseurs directs sont tolérants eux aussi', () => {
    expect(normalizeBooks(null)).toEqual([]);
    expect(normalizeAnime({ data: {} })).toEqual([]);
    expect(normalizeTv('nope')).toEqual([]);
    expect(normalizeMovies({ results: [null, 3] })).toEqual([]);
  });

  it('écrête un résumé à rallonge sans le tronquer au milieu d’un mot', () => {
    const long = `${'mot '.repeat(600)}fin`;
    const results = normalizeTv([{ show: { id: 9, name: 'Long', summary: `<p>${long}</p>` } }]);
    const description = results[0].description ?? '';
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH + 1);
    expect(description.endsWith('…')).toBe(true);
  });
});
