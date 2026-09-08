/**
 * Correspondance résultat → colonnes.
 *
 * Ce que ces tests verrouillent, parce que c'est là que « ça remplit tout seul »
 * devient magique ou insupportable :
 *  - le NOM d'une colonne l'emporte sur son TYPE et sur son rang, et c'est le
 *    synonyme le PLUS SPÉCIFIQUE qui décide (« Nom de l'auteur » ≠ titre) ;
 *  - ce qui part en recherche est le titre, pas la colonne de remarques ;
 *  - une colonne de genres ne peut pas se remplir de dizaines d'options ;
 *  - on ne remplit QUE les cellules vides, et une colonne déjà remplie consomme
 *    son champ (le titre ne déborde jamais dans la colonne d'à côté) ;
 *  - 0 dans une colonne Évaluation vaut « pas de note » : c'est remplissable ;
 *  - les genres inconnus deviennent de VRAIES options (id neuf, couleur en
 *    rotation), sans jamais créer de doublon.
 */

import { describe, it, expect } from 'vitest';
import { CONNECTOR_MAX_QUERY_LENGTH } from '../../../../../../../platform/connectors/connectorSources';
import type { DbProperty } from '../../types';
import { DB_OPTION_COLORS } from '../../types';
import type { ConnectorResult } from '../index';
import {
  buildCellUpdates,
  hasCellUpdates,
  isCellEmpty,
  matchFieldByName,
  MAX_PROPERTY_OPTIONS,
  mergeNewOptions,
  normalize,
  rowSearchQuery,
} from '../index';
import { TV_FIXTURE } from '../__fixtures__/upstreamSamples';

const RESULT: ConnectorResult = {
  id: 'anime:16498',
  title: 'Attack on Titan',
  subtitle: 'Shingeki no Kyojin',
  year: 2013,
  imageUrl: 'https://s4.anilist.co/cover/b16498.jpg',
  url: 'https://anilist.co/anime/16498',
  description: 'Several hundred years ago, humans were nearly exterminated by titans.',
  rating: 4,
  genres: ['Action', 'Drama', 'Fantasy'],
  count: 25,
  extra: { releaseDate: '2013-04-07' },
};

const prop = (id: string, name: string, type: DbProperty['type'], rest: Partial<DbProperty> = {}) =>
  ({ id, name, type, ...rest }) as DbProperty;

describe('matchFieldByName — noms FR/EN, sans casse ni accents', () => {
  it('reconnaît les synonymes exacts dans les deux langues', () => {
    expect(matchFieldByName('Titre')).toBe('title');
    expect(matchFieldByName('name')).toBe('title');
    expect(matchFieldByName('ÉVALUATION')).toBe('rating');
    expect(matchFieldByName('score')).toBe('rating');
    expect(matchFieldByName('Genres')).toBe('genres');
    expect(matchFieldByName('Affiche')).toBe('imageUrl');
    expect(matchFieldByName('Lien')).toBe('url');
    expect(matchFieldByName('Synopsis')).toBe('description');
    expect(matchFieldByName('Auteur')).toBe('subtitle');
  });

  it('reconnaît un synonyme comme mot entier d’un intitulé', () => {
    expect(matchFieldByName('Année de sortie')).toBe('year');
    expect(matchFieldByName('Nombre d’épisodes')).toBe('count');
    expect(matchFieldByName('Image de couverture')).toBe('imageUrl');
    expect(matchFieldByName('Lien de la fiche')).toBe('url');
    expect(matchFieldByName('  genres   ')).toBe('genres');
  });

  it('ne matche pas un nom qui ne désigne rien', () => {
    expect(matchFieldByName('Statut')).toBeNull();
    expect(matchFieldByName('Priorité')).toBeNull();
    expect(matchFieldByName('')).toBeNull();
  });

  it('retient le synonyme LE PLUS SPÉCIFIQUE, pas le premier champ touché', () => {
    // `auteur` (6) bat `nom` (3) : sans spécificité, ce nom partait au titre
    expect(matchFieldByName('Nom de l’auteur')).toBe('subtitle');
    expect(matchFieldByName('Nom du studio')).toBe('subtitle');
    expect(matchFieldByName('Titre original')).toBe('subtitle');
    // `sortie` (6) bat `date` (4), mais les deux désignent l'année : pas de surprise
    expect(matchFieldByName('Date de sortie')).toBe('year');
    expect(matchFieldByName('Date de parution')).toBe('year');
    // `note` gagne sur un qualificatif qui ne désigne aucun champ
    expect(matchFieldByName('Note personnelle')).toBe('rating');
    // `nombre` (6) et `pages` (5) désignent tous deux le compte
    expect(matchFieldByName('Nombre de pages')).toBe('count');
    expect(matchFieldByName('Nombre d’épisodes')).toBe('count');
  });

  it('à longueur égale, l’ordre des champs départage (et l’égalité parfaite gagne)', () => {
    // `titre` et `genre` font 5 : title vient avant genres dans FIELD_ORDER
    expect(matchFieldByName('Titre du genre')).toBe('title');
    // Égalité parfaite : le synonyme est aussi long que le nom, rien ne peut le battre
    expect(matchFieldByName('Nom')).toBe('title');
    expect(matchFieldByName('Auteur')).toBe('subtitle');
  });
});

describe('isCellEmpty — 0 n’a pas le même sens partout', () => {
  it('traite 0 comme « pas de note » sur une colonne Évaluation', () => {
    expect(isCellEmpty(0, 'rating')).toBe(true);
    expect(isCellEmpty(3, 'rating')).toBe(false);
  });

  it('traite 0 comme une vraie valeur sur une colonne nombre', () => {
    expect(isCellEmpty(0, 'number')).toBe(false);
  });

  it('considère vides null, undefined, chaîne blanche et tableau vide', () => {
    expect(isCellEmpty(undefined, 'text')).toBe(true);
    expect(isCellEmpty(null, 'text')).toBe(true);
    expect(isCellEmpty('   ', 'text')).toBe(true);
    expect(isCellEmpty([], 'multiSelect')).toBe(true);
    expect(isCellEmpty(['o-1'], 'multiSelect')).toBe(false);
    expect(isCellEmpty(false, 'checkbox')).toBe(false);
  });
});

describe('buildCellUpdates — correspondance PAR TYPE (noms neutres)', () => {
  const properties = [
    prop('p-a', 'Colonne A', 'text'),
    prop('p-b', 'Colonne B', 'text'),
    prop('p-c', 'Colonne C', 'text'),
    prop('p-d', 'Colonne D', 'rating'),
    prop('p-e', 'Colonne E', 'url'),
    prop('p-f', 'Colonne F', 'url'),
    prop('p-g', 'Colonne G', 'date'),
    prop('p-h', 'Colonne H', 'number'),
    prop('p-i', 'Colonne I', 'multiSelect', { options: [] }),
    prop('p-j', 'Colonne J', 'checkbox'),
    prop('p-k', 'Colonne K', 'select', {
      options: [{ id: 'o-todo', label: 'À voir', color: 'gray' }],
    }),
  ];
  const updates = buildCellUpdates(RESULT, properties, {});

  it('place titre, sous-titre et résumé dans les colonnes texte, dans l’ordre', () => {
    expect(updates.cells['p-a']).toBe(RESULT.title);
    expect(updates.cells['p-b']).toBe(RESULT.subtitle);
    expect(updates.cells['p-c']).toBe(RESULT.description);
  });

  it('donne la note à la colonne Évaluation et le nombre à la colonne nombre', () => {
    expect(updates.cells['p-d']).toBe(4);
    expect(updates.cells['p-h']).toBe(25);
  });

  it('donne la fiche à la 1re colonne lien et l’image à la suivante', () => {
    expect(updates.cells['p-e']).toBe(RESULT.url);
    expect(updates.cells['p-f']).toBe(RESULT.imageUrl);
  });

  it('écrit une date complète dans la colonne date', () => {
    expect(updates.cells['p-g']).toBe('2013-04-07');
  });

  it('crée les options de genres et pose leurs identifiants dans la cellule', () => {
    const created = updates.newOptions['p-i'];
    expect(created.map((o) => o.label)).toEqual(['Action', 'Drama', 'Fantasy']);
    expect(updates.cells['p-i']).toEqual(created.map((o) => o.id));
  });

  it('ne touche NI aux cases à cocher NI aux colonnes à choix unique non nommées', () => {
    expect('p-j' in updates.cells).toBe(false);
    expect('p-k' in updates.cells).toBe(false);
  });

  it('annonce les champs remplis', () => {
    expect(new Set(updates.filled)).toEqual(
      new Set([
        'title',
        'subtitle',
        'description',
        'rating',
        'url',
        'imageUrl',
        'year',
        'count',
        'genres',
      ])
    );
    expect(hasCellUpdates(updates)).toBe(true);
  });
});

describe('buildCellUpdates — le NOM l’emporte sur le type et sur l’ordre', () => {
  const properties = [
    prop('p-resume', 'Résumé', 'text'),
    prop('p-titre', 'Titre', 'text'),
    prop('p-affiche', 'Affiche', 'url'),
    prop('p-lien', 'Lien de la fiche', 'url'),
    prop('p-annee', 'Année de sortie', 'number'),
    prop('p-episodes', 'Nombre d’épisodes', 'number'),
    prop('p-note', 'Note', 'rating'),
    prop('p-genres', 'Genres', 'multiSelect', { options: [] }),
  ];
  const updates = buildCellUpdates(RESULT, properties, {});

  it('met le titre dans « Titre » même si une autre colonne texte vient avant', () => {
    expect(updates.cells['p-titre']).toBe(RESULT.title);
    expect(updates.cells['p-resume']).toBe(RESULT.description);
  });

  it('inverse image et fiche quand les noms le disent', () => {
    expect(updates.cells['p-affiche']).toBe(RESULT.imageUrl);
    expect(updates.cells['p-lien']).toBe(RESULT.url);
  });

  it('distingue deux colonnes nombre par leur nom (année vs épisodes)', () => {
    expect(updates.cells['p-annee']).toBe(2013);
    expect(updates.cells['p-episodes']).toBe(25);
  });

  it('remplit la note et les genres', () => {
    expect(updates.cells['p-note']).toBe(4);
    expect(updates.newOptions['p-genres']).toHaveLength(3);
  });

  it('accepte une colonne texte nommée pour l’image ou la note', () => {
    const textOnly = [
      prop('t-affiche', 'Poster', 'text'),
      prop('t-genres', 'Tags', 'text'),
      prop('t-annee', 'Year', 'text'),
    ];
    const out = buildCellUpdates(RESULT, textOnly, {});
    expect(out.cells['t-affiche']).toBe(RESULT.imageUrl);
    expect(out.cells['t-genres']).toBe('Action, Drama, Fantasy');
    expect(out.cells['t-annee']).toBe('2013');
  });

  it('une colonne nommée mais d’un type incompatible ne bloque pas le champ', () => {
    const properties2 = [
      // « Note » sur une colonne de type note liée : incompatible, donc ignorée…
      prop('p-note-liee', 'Note', 'note'),
      // …et la note atterrit quand même sur la vraie colonne Évaluation
      prop('p-eval', 'Colonne Z', 'rating'),
    ];
    const out = buildCellUpdates(RESULT, properties2, {});
    expect('p-note-liee' in out.cells).toBe(false);
    expect(out.cells['p-eval']).toBe(4);
  });

  it('une colonne nommée ne reçoit jamais un AUTRE champ que le sien', () => {
    const properties2 = [prop('p-titre', 'Titre', 'text'), prop('p-titre2', 'Title', 'text')];
    const out = buildCellUpdates(RESULT, properties2, {});
    expect(out.cells['p-titre']).toBe(RESULT.title);
    expect('p-titre2' in out.cells).toBe(false);
  });
});

describe('buildCellUpdates — SEULEMENT les cellules vides', () => {
  const properties = [
    prop('p-titre', 'Titre', 'text'),
    prop('p-note', 'Note', 'rating'),
    prop('p-genres', 'Genres', 'multiSelect', {
      options: [{ id: 'o-x', label: 'Déjà', color: 'gray' }],
    }),
    prop('p-lien', 'Lien', 'url'),
  ];

  it('n’écrase aucune cellule déjà remplie', () => {
    const updates = buildCellUpdates(RESULT, properties, {
      'p-titre': 'Mon titre à moi',
      'p-note': 3,
      'p-genres': ['o-x'],
      'p-lien': 'https://exemple.test/fiche',
    });
    expect(updates.cells).toEqual({});
    expect(updates.newOptions).toEqual({});
    expect(updates.filled).toEqual([]);
    expect(hasCellUpdates(updates)).toBe(false);
  });

  it('remplit une colonne Évaluation à 0 (0 = pas de note)', () => {
    const updates = buildCellUpdates(RESULT, properties, { 'p-note': 0 });
    expect(updates.cells['p-note']).toBe(4);
  });

  it('remplit une cellule texte blanche et un multiSelect vide', () => {
    const updates = buildCellUpdates(RESULT, properties, { 'p-titre': '   ', 'p-genres': [] });
    expect(updates.cells['p-titre']).toBe(RESULT.title);
    expect(updates.cells['p-genres']).toHaveLength(3);
  });

  it('ne crée AUCUNE option quand la cellule genres est déjà remplie', () => {
    const updates = buildCellUpdates(RESULT, properties, { 'p-genres': ['o-x'] });
    expect(updates.newOptions).toEqual({});
  });

  it('un champ servi par une colonne remplie ne déborde pas sur la suivante', () => {
    const twoTexts = [prop('p-a', 'Colonne A', 'text'), prop('p-b', 'Colonne B', 'text')];
    const noSubtitle: ConnectorResult = { ...RESULT, subtitle: undefined };
    const updates = buildCellUpdates(noSubtitle, twoTexts, { 'p-a': 'Saisi à la main' });
    expect(updates.cells['p-b']).toBe(RESULT.description);
    expect(Object.values(updates.cells)).not.toContain(RESULT.title);
  });
});

describe('buildCellUpdates — options de genres', () => {
  it('réutilise une option existante sans regarder la casse ni les accents', () => {
    const properties = [
      prop('p-genres', 'Genres', 'multiSelect', {
        options: [
          { id: 'o-drama', label: 'drama', color: 'blue' },
          { id: 'o-com', label: 'Comédie', color: 'red' },
        ],
      }),
    ];
    const result: ConnectorResult = { ...RESULT, genres: ['Drama', 'comedie', 'Fantasy'] };
    const updates = buildCellUpdates(result, properties, {});
    const created = updates.newOptions['p-genres'];
    expect(created).toHaveLength(1);
    expect(created[0].label).toBe('Fantasy');
    expect(updates.cells['p-genres']).toEqual(['o-drama', 'o-com', created[0].id]);
  });

  it('prend les couleurs dans la palette en tournant depuis les options existantes', () => {
    const properties = [
      prop('p-genres', 'Genres', 'multiSelect', {
        options: [{ id: 'o-1', label: 'Existant', color: 'gray' }],
      }),
    ];
    const updates = buildCellUpdates(RESULT, properties, {});
    expect(updates.newOptions['p-genres'].map((o) => o.color)).toEqual([
      DB_OPTION_COLORS[1].id,
      DB_OPTION_COLORS[2].id,
      DB_OPTION_COLORS[3].id,
    ]);
  });

  it('boucle sur la palette quand les options dépassent son nombre de couleurs', () => {
    const options = DB_OPTION_COLORS.map((c, i) => ({
      id: `o-${i}`,
      label: `Existant ${i}`,
      color: c.id,
    }));
    const properties = [prop('p-genres', 'Genres', 'multiSelect', { options })];
    const updates = buildCellUpdates(RESULT, properties, {});
    expect(updates.newOptions['p-genres'][0].color).toBe(DB_OPTION_COLORS[0].id);
  });

  it('ne crée jamais deux options pour le même genre et donne des ids distincts', () => {
    const properties = [prop('p-genres', 'Genres', 'multiSelect', { options: [] })];
    const result: ConnectorResult = { ...RESULT, genres: ['Action', 'ACTION', 'action'] };
    const updates = buildCellUpdates(result, properties, {});
    expect(updates.newOptions['p-genres']).toHaveLength(1);
    expect(updates.cells['p-genres']).toHaveLength(1);

    const many = buildCellUpdates(
      { ...RESULT, genres: ['A', 'B', 'C', 'D', 'E', 'F'] },
      [prop('p-g', 'Genres', 'multiSelect', { options: [] })],
      {}
    );
    const ids = many.newOptions['p-g'].map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('une colonne à choix unique nommée genre ne prend que le premier', () => {
    const properties = [prop('p-genre', 'Genre principal', 'select', { options: [] })];
    const updates = buildCellUpdates(RESULT, properties, {});
    const created = updates.newOptions['p-genre'];
    expect(created).toHaveLength(1);
    expect(created[0].label).toBe('Action');
    expect(updates.cells['p-genre']).toBe(created[0].id);
  });

  it('mergeNewOptions rend un schéma prêt à committer en un seul changement', () => {
    const properties = [
      prop('p-genres', 'Genres', 'multiSelect', {
        options: [{ id: 'o-1', label: 'Existant', color: 'gray' }],
      }),
      prop('p-titre', 'Titre', 'text'),
    ];
    const updates = buildCellUpdates(RESULT, properties, {});
    const merged = mergeNewOptions(properties, updates.newOptions);
    expect(merged[0].options).toHaveLength(4);
    expect(merged[1]).toBe(properties[1]); // colonnes intactes non recopiées
    expect(properties[0].options).toHaveLength(1); // aucune mutation de l'entrée
    expect(mergeNewOptions(properties, {})).toBe(properties);
  });
});

describe('buildCellUpdates — dates et cas limites', () => {
  it('retombe sur le 1er janvier quand la source n’a que l’année', () => {
    const properties = [prop('p-date', 'Date de sortie', 'date')];
    const sansDate: ConnectorResult = { ...RESULT, extra: {} };
    expect(buildCellUpdates(sansDate, properties, {}).cells['p-date']).toBe('2013-01-01');
  });

  it('ignore une date exacte qui contredit l’année normalisée', () => {
    const properties = [prop('p-date', 'Date de sortie', 'date')];
    const incoherent: ConnectorResult = { ...RESULT, extra: { releaseDate: '1999-05-05' } };
    expect(buildCellUpdates(incoherent, properties, {}).cells['p-date']).toBe('2013-01-01');
  });

  it('n’écrit rien pour un résultat sans champ exploitable', () => {
    const properties = [
      prop('p-note', 'Note', 'rating'),
      prop('p-genres', 'Genres', 'multiSelect'),
    ];
    const nu: ConnectorResult = { id: 'x', title: 'Sans rien' };
    const updates = buildCellUpdates(nu, properties, {});
    expect(updates.cells).toEqual({});
    expect(hasCellUpdates(updates)).toBe(false);
  });

  it('supporte un schéma vide et des cellules absentes', () => {
    expect(buildCellUpdates(RESULT, [], {})).toEqual({
      cells: {},
      newOptions: {},
      filled: [],
      skipped: [],
    });
    expect(buildCellUpdates(RESULT, [prop('p-t', 'Titre', 'text')]).cells['p-t']).toBe(
      RESULT.title
    );
  });

  it('écarte une URL non http(s) plutôt que de la poser dans une colonne lien', () => {
    const properties = [prop('p-lien', 'Lien', 'url')];
    const piege: ConnectorResult = { ...RESULT, url: 'javascript:alert(1)' };
    expect(buildCellUpdates(piege, properties, {}).cells).toEqual({});
  });
});

describe('buildCellUpdates — « déjà rempli » ≠ « aucune colonne ne peut accueillir »', () => {
  it('signale les champs qu’une colonne aurait pris si elle avait été vide', () => {
    const properties = [prop('p-titre', 'Titre', 'text'), prop('p-note', 'Note', 'rating')];
    const updates = buildCellUpdates(RESULT, properties, {
      'p-titre': 'Mon titre à moi',
      'p-note': 3,
    });
    expect(hasCellUpdates(updates)).toBe(false);
    // Deux colonnes savaient accueillir : c'est « déjà rempli »
    expect(new Set(updates.skipped)).toEqual(new Set(['title', 'rating']));
  });

  it('ne signale RIEN quand aucune colonne ne sait accueillir le résultat', () => {
    const properties = [
      prop('p-fait', 'Fait', 'checkbox'),
      prop('p-statut', 'Statut', 'select', { options: [] }),
    ];
    const updates = buildCellUpdates(RESULT, properties, {});
    expect(hasCellUpdates(updates)).toBe(false);
    // Aucun champ n'a trouvé preneur : c'est « aucune colonne ne peut accueillir »
    expect(updates.skipped).toEqual([]);
  });

  it('un champ écrit n’est jamais compté comme ignoré', () => {
    const properties = [prop('p-titre', 'Titre', 'text'), prop('p-note', 'Note', 'rating')];
    const updates = buildCellUpdates(RESULT, properties, { 'p-note': 3 });
    expect(updates.filled).toEqual(['title']);
    expect(updates.skipped).toEqual(['rating']);
  });
});

describe('resolveGenreOptions — une colonne de genres ne peut pas exploser', () => {
  const manyOptions = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `o-${i}`,
      label: `Genre ${i}`,
      color: DB_OPTION_COLORS[i % DB_OPTION_COLORS.length].id,
    }));

  it('plafonne le nombre d’options créées sur une colonne', () => {
    const properties = [
      prop('p-genres', 'Genres', 'multiSelect', { options: manyOptions(MAX_PROPERTY_OPTIONS - 2) }),
    ];
    const updates = buildCellUpdates(RESULT, properties, {});
    // 3 genres proposés, 2 places restantes
    expect(updates.newOptions['p-genres']).toHaveLength(2);
    expect(updates.cells['p-genres']).toHaveLength(2);
  });

  it('au plafond, réutilise l’existant sans plus rien créer', () => {
    const options = manyOptions(MAX_PROPERTY_OPTIONS);
    options[0] = { ...options[0], label: 'Action' };
    const properties = [prop('p-genres', 'Genres', 'multiSelect', { options })];
    const updates = buildCellUpdates(RESULT, properties, {});
    // « Action » existe déjà : reconnu ; « Drama » et « Fantasy » ne sont pas inventés
    expect(updates.newOptions['p-genres']).toBeUndefined();
    expect(updates.cells['p-genres']).toEqual(['o-0']);
  });

  it('au plafond sans aucun genre connu, ne remplit pas la cellule', () => {
    const properties = [
      prop('p-genres', 'Genres', 'multiSelect', { options: manyOptions(MAX_PROPERTY_OPTIONS) }),
    ];
    const updates = buildCellUpdates(RESULT, properties, {});
    expect('p-genres' in updates.cells).toBe(false);
  });
});

describe('rowSearchQuery — ce qui part réellement en recherche', () => {
  const properties = [
    prop('p-notes', 'Remarques', 'text'),
    prop('p-titre', 'Titre', 'text'),
    prop('p-note', 'Note', 'rating'),
  ];

  it('préfère la colonne dont le NOM désigne le titre, même placée après', () => {
    expect(
      rowSearchQuery(properties, { 'p-notes': 'à relire, prêté à Léa', 'p-titre': 'Dune' })
    ).toBe('Dune');
  });

  it('retombe sur la 1re colonne texte non vide quand aucun titre n’est nommé', () => {
    const neutres = [prop('p-a', 'Colonne A', 'text'), prop('p-b', 'Colonne B', 'text')];
    expect(rowSearchQuery(neutres, { 'p-a': '  Akira ', 'p-b': 'autre' })).toBe('Akira');
  });

  it('retombe aussi quand la colonne titre est vide', () => {
    expect(rowSearchQuery(properties, { 'p-notes': 'prêté à Léa', 'p-titre': '   ' })).toBe(
      'prêté à Léa'
    );
  });

  it('ignore les colonnes non textuelles et rend une chaîne vide à défaut', () => {
    expect(rowSearchQuery(properties, { 'p-note': 4 })).toBe('');
    expect(rowSearchQuery(properties, {})).toBe('');
    expect(rowSearchQuery([], {})).toBe('');
  });

  it('borne la requête à la longueur admise par la liste blanche', () => {
    const long = 'a'.repeat(500);
    expect(rowSearchQuery(properties, { 'p-titre': long })).toHaveLength(
      CONNECTOR_MAX_QUERY_LENGTH
    );
  });
});

describe('bout en bout — fixture TVMaze vers un vrai schéma de suivi', () => {
  it('remplit une ligne vierge comme l’utilisateur s’y attend', () => {
    const properties = [
      prop('p-titre', 'Titre', 'text'),
      prop('p-statut', 'Statut', 'select', {
        options: [{ id: 'o-todo', label: 'À voir', color: 'gray' }],
        defaultOptionId: 'o-todo',
      }),
      prop('p-note', 'Note', 'rating'),
      prop('p-annee', 'Année', 'date'),
      prop('p-genres', 'Genres', 'multiSelect', { options: [] }),
      prop('p-affiche', 'Affiche', 'url'),
      prop('p-fiche', 'Fiche', 'url'),
      prop('p-resume', 'Résumé', 'text'),
    ];
    const [show] = normalize('tv', TV_FIXTURE);
    const updates = buildCellUpdates(show, properties, { 'p-statut': 'o-todo' });

    expect(updates.cells['p-titre']).toBe('Under the Dome');
    expect(updates.cells['p-note']).toBe(3);
    expect(updates.cells['p-annee']).toBe('2013-06-24');
    expect(updates.cells['p-affiche']).toBe(show.imageUrl);
    expect(updates.cells['p-fiche']).toBe(show.url);
    expect(updates.cells['p-resume']).toContain('small town');
    expect(updates.newOptions['p-genres'].map((o) => o.label)).toEqual([
      'Drama',
      'Science-Fiction',
      'Thriller',
    ]);
    // La colonne Statut reste celle de l'utilisateur
    expect('p-statut' in updates.cells).toBe(false);
  });
});
