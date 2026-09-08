/**
 * FIXTURES FIGÉES des quatre amonts — copies réduites de vraies réponses.
 *
 * Aucun test des connecteurs n'appelle le réseau : ces objets SONT le contrat
 * d'entrée. Le dossier est volontairement hors de `__tests__/` pour qu'aucun
 * lanceur ne le prenne pour une suite de tests.
 *
 * Chaque fixture porte quelques cas pénibles exprès : champ absent, HTML dans
 * le résumé, note nulle, 6e résultat au-delà de la limite, sujet à rallonge.
 */

/** OpenLibrary — `/search.json?q=dune&limit=5&fields=…` */
export const BOOKS_FIXTURE = {
  numFound: 1204,
  start: 0,
  docs: [
    {
      key: '/works/OL893415W',
      title: 'Dune',
      author_name: ['Frank Herbert'],
      first_publish_year: 1965,
      cover_i: 8231990,
      number_of_pages_median: 604,
      subject: [
        'Science fiction',
        'Fiction',
        'science fiction',
        'Ecology',
        'Fiction, science fiction, action & adventure, general, dystopian tales',
        '',
        'Desert life',
        'Politics',
        'Nobility',
      ],
    },
    {
      key: '/works/OL27448W',
      title: 'Dune Messiah',
      author_name: ['Frank Herbert', 'Brian Herbert', 'Kevin J. Anderson', 'Someone Else'],
      first_publish_year: 1969,
      number_of_pages_median: 331,
      subject: ['Science fiction'],
    },
    // Sans titre : ignoré (une ligne sans titre n'a rien à proposer)
    { key: '/works/OL1W', author_name: ['Anonyme'], first_publish_year: 1900 },
    { key: '/works/OL2W', title: 'Dune, tome 3', first_publish_year: 'pas une année' },
    { key: '/works/OL3W', title: 'Le Messie de Dune', cover_i: 42 },
    { key: '/works/OL4W', title: 'Les Enfants de Dune' },
    { key: '/works/OL5W', title: 'Un sixième au-delà de la limite' },
  ],
} as const;

/** AniList — POST graphql, `Page.media` */
export const ANIME_FIXTURE = {
  data: {
    Page: {
      media: [
        {
          id: 21,
          title: { romaji: 'ONE PIECE', english: 'ONE PIECE' },
          seasonYear: 1999,
          averageScore: 88,
          episodes: 1122,
          status: 'RELEASING',
          genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Supernatural', 'Mystery'],
          coverImage: { medium: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/21.jpg' },
          siteUrl: 'https://anilist.co/anime/21',
          description:
            'Gol D. Roger, a man referred to as the "King of the Pirates," is set to be executed.<br>\n<br>\n<i>Note: contient &lt;script&gt;alert(1)&lt;/script&gt; encodé — doit ressortir en texte nu.</i>',
        },
        {
          id: 16498,
          title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan' },
          seasonYear: 2013,
          averageScore: 84,
          episodes: 25,
          status: 'FINISHED',
          genres: ['Action', 'Drama', 'Fantasy', 'Mystery'],
          coverImage: {
            medium: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/b16498.jpg',
          },
          siteUrl: 'https://anilist.co/anime/16498',
          description: 'Several hundred years ago, humans were nearly exterminated by titans.',
        },
        {
          id: 999999,
          title: { romaji: 'Sans note ni saison', english: null },
          seasonYear: null,
          averageScore: null,
          episodes: null,
          status: 'NOT_YET_RELEASED',
          genres: [],
          coverImage: { medium: null },
          siteUrl: 'javascript:alert(1)',
          description: null,
        },
      ],
    },
  },
} as const;

/** TVMaze — `/search/shows?q=…` (tableau nu, objet utile sous `.show`) */
export const TV_FIXTURE = [
  {
    score: 0.9,
    show: {
      id: 1,
      name: 'Under the Dome',
      premiered: '2013-06-24',
      status: 'Ended',
      genres: ['Drama', 'Science-Fiction', 'Thriller'],
      rating: { average: 6.5 },
      network: { id: 2, name: 'CBS' },
      webChannel: null,
      image: { medium: 'https://static.tvmaze.com/uploads/images/medium_portrait/81/202627.jpg' },
      url: 'https://www.tvmaze.com/shows/1/under-the-dome',
      summary:
        '<p><b>Under the Dome</b> is the story of a small town that is suddenly &amp; inexplicably sealed off from the rest of the world by an enormous transparent dome.</p><script>alert(1)</script>',
    },
  },
  {
    score: 0.7,
    show: {
      id: 2,
      name: 'Person of Interest',
      premiered: '2011-09-22',
      status: 'Ended',
      genres: ['Action', 'Crime', 'Science-Fiction'],
      rating: { average: 8.8 },
      network: null,
      webChannel: { id: 5, name: 'Netflix' },
      image: { medium: 'https://static.tvmaze.com/uploads/images/medium_portrait/163/407679.jpg' },
      url: 'https://www.tvmaze.com/shows/2/person-of-interest',
      summary: '<p>You are being watched.</p>',
    },
  },
  {
    score: 0.1,
    show: {
      id: 3,
      name: 'Note nulle et sans date',
      premiered: null,
      status: 'Running',
      genres: [],
      rating: { average: null },
      image: null,
      url: 'https://www.tvmaze.com/shows/3/note-nulle',
      summary: null,
    },
  },
] as const;

/** TMDB — `/search/movie?query=…` */
export const MOVIES_FIXTURE = {
  page: 1,
  results: [
    {
      id: 438631,
      title: 'Dune',
      original_title: 'Dune',
      release_date: '2021-09-15',
      poster_path: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
      vote_average: 7.8,
      genre_ids: [878, 12],
      overview:
        'Paul Atreides, a brilliant and gifted young man born into a great destiny beyond his understanding.',
    },
    {
      id: 693134,
      title: 'Dune, deuxième partie',
      original_title: 'Dune: Part Two',
      release_date: '2024-02-27',
      poster_path: '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
      vote_average: 8.2,
      genre_ids: [878, 12, 28],
      overview: 'Paul Atreides s’unit à Chani et aux Fremen.',
    },
    {
      id: 841,
      title: 'Dune (1984)',
      release_date: '',
      poster_path: null,
      vote_average: 0,
      genre_ids: [],
      overview: '',
    },
  ],
} as const;

/** TMDB — `/genre/movie/list` (source auxiliaire `movieGenres`) */
export const MOVIE_GENRES_FIXTURE = {
  genres: [
    { id: 28, name: 'Action' },
    { id: 12, name: 'Aventure' },
    { id: 878, name: 'Science-Fiction' },
    { id: 0, name: 'Identifiant invalide' },
    { id: 99, name: '' },
  ],
} as const;
