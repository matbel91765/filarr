/**
 * Source `books` — OpenLibrary (`/search.json`, sans clé).
 *
 * Forme amont : `{ numFound, docs: [{ title, author_name[], first_publish_year,
 * cover_i, number_of_pages_median, subject[], key }] }`.
 * La recherche ne renvoie AUCUN résumé ni note : `description` et `rating`
 * restent absents, ce qui laisse ces colonnes intactes côté correspondance.
 * Les `subject` sont du CATALOGAGE et non des genres : ils sont triés par
 * `isLikelyGenre` avant d'atteindre la colonne Genres (voir plus bas).
 */

import {
  OPENLIBRARY_COVER_BASE,
  OPENLIBRARY_WORK_BASE,
} from '../../../../../../platform/connectors/connectorSources';
import type { ConnectorResult } from './connectorResult';
import {
  MAX_CONNECTOR_RESULTS,
  asArray,
  asPositiveInt,
  asRecord,
  asText,
  asYear,
  cleanGenres,
} from './connectorResult';

/** Trois auteurs suffisent à identifier une édition ; au-delà c'est du bruit. */
const MAX_AUTHORS = 3;

/** Un genre tient en deux ou trois mots ; au-delà, c'est une notice. */
const MAX_SUBJECT_WORDS = 3;
const MAX_SUBJECT_LENGTH = 24;

/**
 * Mots de CATALOGAGE : leur seule présence disqualifie le sujet. Liste courte
 * et volontairement conservatrice — on ne cherche pas l'exhaustivité, juste à
 * écarter ce qui revient sur presque chaque notice OpenLibrary.
 */
const CATALOG_WORDS = [
  'general',
  'accessible book',
  'protected daisy',
  'in library',
  'internet archive',
  'open library',
  'overdrive',
  'large type',
  'lending library',
  'reading level',
  'bestseller',
  'juvenile',
  'specimens',
  'translations',
  'bibliography',
  'periodicals',
  'criticism',
  'early works',
];

/**
 * Sujet OpenLibrary → genre plausible ?
 *
 * Les `subject` d'OpenLibrary sont du catalogage, pas des genres : on y trouve
 * « Fiction, science fiction, general », « Accessible book », « History -- 20th
 * century », « New York Times bestseller »… Sans tri, une colonne Genres se
 * remplirait de dizaines d'options illisibles, une par livre. Heuristique
 * simple, assumée conservatrice (mieux vaut perdre un genre que polluer une
 * colonne dont l'utilisateur devra retirer les options à la main) :
 *  1. au plus 3 mots et 24 caractères — un genre, pas une phrase ;
 *  2. aucun chiffre (« 20th century », « Fiction 1990-1999 ») ;
 *  3. aucune ponctuation d'inversion de notice : virgule, « -- », deux-points,
 *     parenthèse ;
 *  4. aucun mot de catalogage (liste ci-dessus).
 * Les doublons de casse ou d'accents sont écartés ensuite par `cleanGenres`.
 */
function isLikelyGenre(subject: unknown): boolean {
  if (typeof subject !== 'string') return false;
  const label = subject.trim().replace(/\s+/g, ' ');
  if (label === '' || label.length > MAX_SUBJECT_LENGTH) return false;
  if (label.split(' ').length > MAX_SUBJECT_WORDS) return false;
  if (/\d/.test(label)) return false;
  if (/[,;:()[\]]|--|\//.test(label)) return false;
  const folded = label.toLowerCase();
  return !CATALOG_WORDS.some((word) => folded.includes(word));
}

export function normalizeBooks(raw: unknown): ConnectorResult[] {
  const root = asRecord(raw);
  if (!root) return [];
  const out: ConnectorResult[] = [];

  for (const entry of asArray(root.docs)) {
    if (out.length >= MAX_CONNECTOR_RESULTS) break;
    const doc = asRecord(entry);
    if (!doc) continue;
    const title = asText(doc.title);
    if (!title) continue;

    const authors = asArray(doc.author_name)
      .filter((a): a is string => typeof a === 'string')
      .map((a) => a.trim())
      .filter((a) => a !== '')
      .slice(0, MAX_AUTHORS);

    const key = typeof doc.key === 'string' && doc.key.startsWith('/') ? doc.key : undefined;
    const coverId = asPositiveInt(doc.cover_i);
    const year = asYear(doc.first_publish_year);

    out.push({
      id: `books:${key ?? title}`,
      title,
      subtitle: authors.length > 0 ? authors.join(', ') : undefined,
      year,
      imageUrl: coverId !== undefined ? `${OPENLIBRARY_COVER_BASE}${coverId}-M.jpg` : undefined,
      url: key !== undefined ? `${OPENLIBRARY_WORK_BASE}${key}` : undefined,
      // Sujets triés AVANT `cleanGenres` : la borne des 6 genres doit porter sur
      // des genres, pas être consommée par des mentions de notice
      genres: cleanGenres(asArray(doc.subject).filter(isLikelyGenre)),
      count: asPositiveInt(doc.number_of_pages_median),
      extra: { authors, key },
    });
  }

  return out;
}
