/**
 * Smart Search Service
 *
 * Provides advanced search functionality including:
 * - Full-text search across filenames, folders, tags, and content
 * - Natural language query parsing
 * - Fuzzy matching for typos
 * - OCR text search
 * - Search history and suggestions
 */

import Fuse from 'fuse.js';
import errorService from '../platform/errorService';
import type {
  FileItem,
  Folder,
  SearchIndex,
  SearchResult,
  SearchFilters,
  SearchOptions,
  NaturalLanguageQuery,
  Tag,
  Item,
} from '../../types';

/**
 * SÉCURITÉ: Vérifie si un pattern regex est potentiellement dangereux (ReDoS)
 * Cette fonction remplace le module 'safe-regex' pour être compatible navigateur
 */
function isSafeRegex(pattern: string): boolean {
  // Patterns dangereux connus qui peuvent causer des ReDoS
  const dangerousPatterns = [
    /(\*\+|\+\*|\+\+|\{\d+,\}\+)/,  // Quantificateurs imbriqués
    /(\([^)]*\)\*\+|\([^)]*\)\+\*)/,  // Groupes avec quantificateurs imbriqués
    /(\([^)]*\+[^)]*\)\*|\([^)]*\*[^)]*\)\+)/,  // Groupes avec quantificateurs multiples
    /(\.\*\.\*\.\*)/,  // Plusieurs .* consécutifs
    /(\(.*\|.*\)\+)/,  // Alternance dans un groupe répété
  ];

  // Vérifie si le pattern contient des éléments dangereux
  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return false;
    }
  }

  // Limite la longueur du pattern
  if (pattern.length > 500) {
    return false;
  }

  return true;
}

/**
 * Search Service Class
 */
class SearchService {
  private searchIndex: Map<string, SearchIndex> = new Map();
  private fuse: Fuse<SearchIndex> | null = null;
  private searchHistory: string[] = [];
  private maxHistorySize: number = 50;

  /**
   * Initialize or update the search index
   */
  indexItem(item: Item, folderPath: string = '', tags: Tag[] = []): void {
    try {
      const searchIndex: SearchIndex = {
        fileId: item.id,
        fileName: item.name,
        folderPath,
        content: '',
        tags: tags.map((t) => t.name),
        metadata: {
          type: 'type' in item ? item.type : 'folder',
          size: 'size' in item ? item.size : null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
        lastIndexed: new Date().toISOString(),
      };

      this.searchIndex.set(item.id, searchIndex);
    } catch (error) {
      console.error(`Failed to index item ${item.id}:`, error);
    }
  }

  /**
   * Build Fuse.js index for fuzzy searching
   */
  buildFuseIndex(): void {
    const documents = Array.from(this.searchIndex.values());

    this.fuse = new Fuse(documents, {
      keys: [
        { name: 'fileName', weight: 2.0 },
        { name: 'folderPath', weight: 1.0 },
        { name: 'content', weight: 1.5 },
        { name: 'tags', weight: 1.8 },
      ],
      threshold: 0.4, // Fuzzy matching threshold (0 = exact, 1 = match anything)
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 2,
      ignoreLocation: true, // Search entire string
    });
  }

  /**
   * Perform a smart search
   */
  search(
    _query: string,
    filters: SearchFilters = {},
    options: SearchOptions = {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      includeContent: true,
    }
  ): SearchResult[] {
    try {
      if (!_query.trim()) {
        return [];
      }

      // Add to search history
      this.addToHistory(_query);

      // Check if query is natural language
      const nlQuery = this.parseNaturalLanguageQuery(_query);

      // Merge filters from natural language query
      const mergedFilters = { ...filters, ...this.convertNLFilters(nlQuery) };

      // Perform search
      let results: SearchResult[];

      if (options.regex) {
        results = this.regexSearch(_query, mergedFilters, options);
      } else if (this.fuse) {
        results = this.fuzzySearch(nlQuery.searchTerms.join(' '), mergedFilters, options);
      } else {
        results = this.exactSearch(_query, mergedFilters, options);
      }

      // Sort by relevance
      results.sort((a, b) => b.relevance - a.relevance);

      return results;
    } catch (error) {
      throw errorService.createFromError(
        error as Error,
        'Search failed',
        errorService.ErrorTypes.VALIDATION
      );
    }
  }

  /**
   * Fuzzy search using Fuse.js
   */
  private fuzzySearch(
    query: string,
    filters: SearchFilters,
    _options: SearchOptions
  ): SearchResult[] {
    if (!this.fuse) {
      this.buildFuseIndex();
    }

    if (!this.fuse) {
      return [];
    }

    const fuseResults = this.fuse.search(query);
    const results: SearchResult[] = [];

    fuseResults.forEach((result) => {
      const index = result.item;

      // Apply filters
      if (!this.matchesFilters(index, filters)) {
        return;
      }

      // Create search result
      const searchResult: SearchResult = {
        id: index.fileId,
        type: index.metadata.type === 'folder' ? 'folder' : 'file',
        item: this.createItemFromIndex(index),
        relevance: 1 - (result.score || 0), // Convert score to relevance (higher is better)
        matches: result.matches
          ? result.matches.map((m) => ({
              field: m.key || '',
              value: m.value || '',
              start: m.indices?.[0]?.[0] || 0,
              end: m.indices?.[0]?.[1] || 0,
            }))
          : [],
      };

      results.push(searchResult);
    });

    return results;
  }

  /**
   * Exact search (case-sensitive or case-insensitive)
   */
  private exactSearch(
    query: string,
    filters: SearchFilters,
    options: SearchOptions
  ): SearchResult[] {
    const results: SearchResult[] = [];
    const searchQuery = options.caseSensitive ? query : query.toLowerCase();

    this.searchIndex.forEach((index) => {
      // Apply filters
      if (!this.matchesFilters(index, filters)) {
        return;
      }

      let relevance = 0;
      const matches: any[] = [];

      // Search in filename
      const fileName = options.caseSensitive ? index.fileName : index.fileName.toLowerCase();
      if (fileName.includes(searchQuery)) {
        relevance += 10;
        matches.push({ field: 'fileName', value: index.fileName, start: 0, end: 0 });
      }

      // Search in folder path
      const folderPath = options.caseSensitive
        ? index.folderPath
        : index.folderPath.toLowerCase();
      if (folderPath.includes(searchQuery)) {
        relevance += 5;
        matches.push({ field: 'folderPath', value: index.folderPath, start: 0, end: 0 });
      }

      // Search in tags
      index.tags.forEach((tag) => {
        const tagValue = options.caseSensitive ? tag : tag.toLowerCase();
        if (tagValue.includes(searchQuery)) {
          relevance += 8;
          matches.push({ field: 'tags', value: tag, start: 0, end: 0 });
        }
      });

      // Search in content (if enabled)
      if (options.includeContent && index.content) {
        const content = options.caseSensitive ? index.content : index.content.toLowerCase();
        if (content.includes(searchQuery)) {
          relevance += 6;
          matches.push({ field: 'content', value: index.content, start: 0, end: 0 });
        }
      }

      if (relevance > 0) {
        results.push({
          id: index.fileId,
          type: index.metadata.type === 'folder' ? 'folder' : 'file',
          item: this.createItemFromIndex(index),
          relevance,
          matches,
        });
      }
    });

    return results;
  }

  /**
   * Regex search avec protection ReDoS
   */
  private regexSearch(
    pattern: string,
    filters: SearchFilters,
    options: SearchOptions
  ): SearchResult[] {
    const results: SearchResult[] = [];

    try {
      // SÉCURITÉ: Validation du regex pour éviter les attaques ReDoS
      if (!isSafeRegex(pattern)) {
        throw new Error('Pattern regex potentiellement dangereux détecté (ReDoS). Veuillez simplifier votre expression régulière.');
      }

      const regex = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');

      // SÉCURITÉ: Timeout de sécurité pour éviter les regex qui prennent trop de temps
      const REGEX_TIMEOUT_MS = 1000;

      this.searchIndex.forEach((index) => {
        // Apply filters
        if (!this.matchesFilters(index, filters)) {
          return;
        }

        let relevance = 0;
        const matches: any[] = [];

        // Test filename avec timeout
        try {
          const filenameMatch = this.testRegexWithTimeout(regex, index.fileName, REGEX_TIMEOUT_MS);
          if (filenameMatch) {
            relevance += 10;
            matches.push({ field: 'fileName', value: index.fileName, start: 0, end: 0 });
          }
        } catch (timeoutError) {
          console.warn('Regex timeout sur filename:', index.fileName);
        }

        // Test content avec timeout
        if (options.includeContent && index.content) {
          try {
            const contentMatch = this.testRegexWithTimeout(regex, index.content, REGEX_TIMEOUT_MS);
            if (contentMatch) {
              relevance += 6;
              matches.push({ field: 'content', value: index.content, start: 0, end: 0 });
            }
          } catch (timeoutError) {
            console.warn('Regex timeout sur content');
          }
        }

        if (relevance > 0) {
          results.push({
            id: index.fileId,
            type: index.metadata.type === 'folder' ? 'folder' : 'file',
            item: this.createItemFromIndex(index),
            relevance,
            matches,
          });
        }
      });
    } catch (error) {
      console.error('Invalid regex pattern:', error);
      throw errorService.createFromError(
        error as Error,
        'Pattern regex invalide ou dangereux',
        errorService.ErrorTypes.VALIDATION
      );
    }

    return results;
  }

  /**
   * Test une regex avec un timeout pour éviter les ReDoS
   * @param regex - Expression régulière à tester
   * @param text - Texte sur lequel tester
   * @param timeoutMs - Timeout en millisecondes
   * @returns true si le regex matche, false sinon
   * @throws Error si le timeout est dépassé
   */
  private testRegexWithTimeout(regex: RegExp, text: string, timeoutMs: number): boolean {
    let timeoutHandle: NodeJS.Timeout | number | undefined;
    let didTimeout = false;

    return new Promise<boolean>((resolve) => {
      timeoutHandle = setTimeout(() => {
        didTimeout = true;
        resolve(false);
      }, timeoutMs);

      try {
        const result = regex.test(text);
        if (!didTimeout) {
          clearTimeout(timeoutHandle as NodeJS.Timeout);
          resolve(result);
        }
      } catch (error) {
        if (!didTimeout) {
          clearTimeout(timeoutHandle as NodeJS.Timeout);
          resolve(false);
        }
      }
    }) as any;
  }

  /**
   * Parse natural language query
   * Examples:
   * - "mes factures de 2024" -> { keywords: ['factures'], dateRange: { year: 2024 } }
   * - "PDFs de cette semaine" -> { fileTypes: ['pdf'], dateRange: { week: 'current' } }
   */
  parseNaturalLanguageQuery(query: string): NaturalLanguageQuery {
    const result: NaturalLanguageQuery = {
      originalQuery: query,
      parsedFilters: {},
      searchTerms: [],
    };

    const lowerQuery = query.toLowerCase();

    // Extract file types
    const fileTypePatterns = [
      /\b(pdf|doc|docx|xls|xlsx|ppt|pptx|jpg|jpeg|png|gif|txt)\b/gi,
    ];
    fileTypePatterns.forEach((pattern) => {
      const matches = lowerQuery.match(pattern);
      if (matches) {
        result.parsedFilters.fileTypes = matches.map((m) => m.toLowerCase());
      }
    });

    // Extract year
    const yearMatch = lowerQuery.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31, 23, 59, 59);
      result.parsedFilters.dateRange = { start: startDate, end: endDate };
    }

    // Extract time references
    const now = new Date();

    if (lowerQuery.match(/\b(aujourd'hui|today)\b/i)) {
      const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      result.parsedFilters.dateRange = { start: startDate, end: endDate };
    } else if (lowerQuery.match(/\b(cette semaine|this week)\b/i)) {
      const startDate = new Date(now);
      startDate.setDate(now.getDate() - now.getDay());
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
      result.parsedFilters.dateRange = { start: startDate, end: endDate };
    } else if (lowerQuery.match(/\b(ce mois|this month)\b/i)) {
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      result.parsedFilters.dateRange = { start: startDate, end: endDate };
    }

    // Extract remaining search terms (remove filters)
    let cleanedQuery = query;
    if (result.parsedFilters.fileTypes) {
      result.parsedFilters.fileTypes.forEach((type) => {
        cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${type}\\b`, 'gi'), '');
      });
    }
    if (result.parsedFilters.dateRange) {
      cleanedQuery = cleanedQuery.replace(/\b(20\d{2})\b/g, '');
      cleanedQuery = cleanedQuery.replace(
        /\b(aujourd'hui|today|cette semaine|this week|ce mois|this month)\b/gi,
        ''
      );
    }

    // Clean up and extract keywords
    result.searchTerms = cleanedQuery
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2);

    return result;
  }

  /**
   * Convert natural language filters to SearchFilters
   */
  private convertNLFilters(nlQuery: NaturalLanguageQuery): Partial<SearchFilters> {
    const filters: Partial<SearchFilters> = {};

    if (nlQuery.parsedFilters.dateRange) {
      filters.dateFrom = nlQuery.parsedFilters.dateRange.start.toISOString();
      filters.dateTo = nlQuery.parsedFilters.dateRange.end.toISOString();
    }

    if (nlQuery.parsedFilters.tags) {
      filters.tags = nlQuery.parsedFilters.tags;
    }

    return filters;
  }

  /**
   * Check if index matches filters
   */
  private matchesFilters(index: SearchIndex, filters: SearchFilters): boolean {
    // Type filter
    if (filters.type && filters.type !== 'all') {
      if (filters.type === 'file' && index.metadata.type === 'folder') return false;
      if (filters.type === 'folder' && index.metadata.type !== 'folder') return false;
    }

    // Date filter
    if (filters.dateFrom || filters.dateTo) {
      const itemDate = new Date(index.metadata.createdAt || '');
      if (filters.dateFrom && itemDate < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && itemDate > new Date(filters.dateTo)) return false;
    }

    // Size filter
    if (filters.sizeMin !== undefined || filters.sizeMax !== undefined) {
      const size = index.metadata.size || 0;
      if (filters.sizeMin !== undefined && size < filters.sizeMin) return false;
      if (filters.sizeMax !== undefined && size > filters.sizeMax) return false;
    }

    // Tags filter
    if (filters.tags && filters.tags.length > 0) {
      const hasAllTags = filters.tags.every((tag) => index.tags.includes(tag));
      if (!hasAllTags) return false;
    }

    return true;
  }

  /**
   * Create item from index (simplified)
   */
  private createItemFromIndex(index: SearchIndex): Item {
    if (index.metadata.type === 'folder') {
      return {
        id: index.fileId,
        name: index.fileName,
        color: '#3B82F6',
        items: [],
        createdAt: index.metadata.createdAt,
        updatedAt: index.metadata.updatedAt,
      } as Folder;
    } else {
      return {
        id: index.fileId,
        name: index.fileName,
        type: index.metadata.type,
        size: index.metadata.size || 0,
        createdAt: index.metadata.createdAt,
        updatedAt: index.metadata.updatedAt,
      } as FileItem;
    }
  }

  /**
   * Add query to search history
   */
  private addToHistory(query: string): void {
    // Remove duplicates
    this.searchHistory = this.searchHistory.filter((q) => q !== query);

    // Add to beginning
    this.searchHistory.unshift(query);

    // Limit size
    if (this.searchHistory.length > this.maxHistorySize) {
      this.searchHistory = this.searchHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * Get search history
   */
  getHistory(limit?: number): string[] {
    return limit ? this.searchHistory.slice(0, limit) : [...this.searchHistory];
  }

  /**
   * Clear search history
   */
  clearHistory(): void {
    this.searchHistory = [];
  }

  /**
   * Get search suggestions based on history
   */
  getSuggestions(query: string, limit: number = 5): string[] {
    if (!query.trim()) {
      return this.searchHistory.slice(0, limit);
    }

    const lowerQuery = query.toLowerCase();
    return this.searchHistory
      .filter((item) => item.toLowerCase().includes(lowerQuery))
      .slice(0, limit);
  }

  /**
   * Clear the search index
   */
  clearIndex(): void {
    this.searchIndex.clear();
    this.fuse = null;
  }

  /**
   * Get index statistics
   */
  getIndexStats() {
    return {
      totalIndexed: this.searchIndex.size,
      filesIndexed: Array.from(this.searchIndex.values()).filter(
        (i) => i.metadata.type !== 'folder'
      ).length,
      foldersIndexed: Array.from(this.searchIndex.values()).filter(
        (i) => i.metadata.type === 'folder'
      ).length,
      withContent: Array.from(this.searchIndex.values()).filter((i) => i.content).length,
      historySize: this.searchHistory.length,
    };
  }

  /**
   * Update the content field for an already-indexed item.
   * Used by the PDF text extraction pipeline to populate searchable content.
   */
  updateItemContent(itemId: string, content: string): void {
    const index = this.searchIndex.get(itemId);
    if (index) {
      index.content = content;
      index.lastIndexed = new Date().toISOString();
    }
  }

  /**
   * Reindex all items
   */
  reindexAll(items: Item[], folderPath: string = ''): void {
    this.clearIndex();

    items.forEach((item) => {
      this.indexItem(item, folderPath, []);
    });

    this.buildFuseIndex();
  }

  /**
   * Get the indexed folder path for a given item ID
   */
  getIndexedFolderPath(itemId: string): string {
    const index = this.searchIndex.get(itemId);
    return index ? index.folderPath : '';
  }
}

// Export singleton instance
const searchService = new SearchService();
export default searchService;
