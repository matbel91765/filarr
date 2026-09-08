/**
 * La recherche par expression régulière, vue de l'extérieur.
 *
 * LA RÉGRESSION GARDÉE ICI : `testRegexWithTimeout` rendait une `Promise`
 * castée en booléen, donc toujours vraie — TOUT document correspondait, quel
 * que soit le motif. Le premier test échouait sur l'ancienne implémentation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import searchService from '../searchService';
import type { Item } from '../../../types';

const fichier = (id: string, name: string): Item =>
  ({
    id,
    name,
    type: 'file',
    size: 1024,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as unknown as Item;

describe('searchService — recherche par expression régulière', () => {
  beforeEach(() => {
    searchService.clearIndex();
    searchService.regexBudgetMs = 250;
    searchService.indexItem(fichier('1', 'facture-2024.pdf'), 'Comptes');
    searchService.indexItem(fichier('2', 'contrat-bail.docx'), 'Juridique');
    searchService.indexItem(fichier('3', 'facture-2025.pdf'), 'Comptes');
    searchService.buildFuseIndex();
  });

  it('ne rend QUE les documents qui correspondent vraiment', () => {
    const results = searchService.search(
      '^facture-\\d{4}\\.pdf$',
      {},
      {
        caseSensitive: false,
        wholeWord: false,
        regex: true,
        includeContent: true,
      }
    );
    expect(results.map((r) => r.id).sort()).toEqual(['1', '3']);
  });

  it('rend une liste vide quand rien ne correspond', () => {
    const results = searchService.search(
      '^zzz',
      {},
      {
        caseSensitive: false,
        wholeWord: false,
        regex: true,
        includeContent: true,
      }
    );
    expect(results).toEqual([]);
  });

  it('refuse un motif explosif au lieu de le lancer', () => {
    expect(() =>
      searchService.search(
        '(a+)+$',
        {},
        {
          caseSensitive: false,
          wholeWord: false,
          regex: true,
          includeContent: true,
        }
      )
    ).toThrow();
    expect(searchService.lastRegexRejection).toBe('unsafe');
  });

  it('annonce des résultats partiels quand le budget est épuisé', () => {
    searchService.regexBudgetMs = -1; // budget déjà dépassé au premier document
    const results = searchService.search(
      'facture',
      {},
      {
        caseSensitive: false,
        wholeWord: false,
        regex: true,
        includeContent: true,
      }
    );
    expect(results).toEqual([]);
    expect(searchService.lastRegexTimedOut).toBe(true);
  });
});
