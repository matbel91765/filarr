/**
 * Filter Service
 *
 * Service de gestion des filtres sauvegardes.
 * Permet de creer, sauvegarder, et appliquer des filtres complexes
 * avec logique AND/OR et criteres multiples.
 */

import type { FileItem, Folder, Item, SearchFilters } from '../../types';

// ==================== TYPES ====================

/**
 * Type de critere de filtre
 */
export type FilterCriteriaType =
  | 'type'        // file, folder
  | 'extension'   // .pdf, .doc, etc.
  | 'name'        // nom contient/commence/termine
  | 'size'        // taille min/max
  | 'date'        // date creation/modification
  | 'tag'         // tags associes
  | 'color'       // couleur du dossier
  | 'protected'   // protege par mot de passe
  | 'path';       // chemin contient

/**
 * Operateur de comparaison
 */
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'lessThan'
  | 'between'
  | 'in'
  | 'notIn'
  | 'exists'
  | 'notExists';

/**
 * Logique de combinaison des criteres
 */
export type FilterLogic = 'AND' | 'OR';

/**
 * Critere de filtre individuel
 */
export interface FilterCriteria {
  id: string;
  type: FilterCriteriaType;
  operator: FilterOperator;
  value: any;
  secondValue?: any; // Pour l'operateur 'between'
}

/**
 * Groupe de criteres (pour logique imbriquee)
 */
export interface FilterGroup {
  id: string;
  logic: FilterLogic;
  criteria: (FilterCriteria | FilterGroup)[];
}

/**
 * Filtre sauvegarde complet
 */
export interface SavedFilter {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  isPreset: boolean;
  isPinned: boolean;
  group: FilterGroup;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
}

/**
 * Resultat d'application de filtre
 */
export interface FilterResult {
  filterId: string;
  filterName: string;
  matchedItems: Item[];
  totalScanned: number;
  executionTimeMs: number;
}

// ==================== STORAGE KEYS ====================

const FILTERS_STORAGE_KEY = 'filarr_saved_filters';

// ==================== DEFAULT PRESETS ====================

/**
 * Filtres predefinis
 */
const DEFAULT_PRESETS: Omit<SavedFilter, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'preset_images',
    name: 'Images',
    description: 'Tous les fichiers image (JPG, PNG, GIF, etc.)',
    icon: 'image',
    color: '#10B981',
    isPreset: true,
    isPinned: true,
    useCount: 0,
    group: {
      id: 'group_images',
      logic: 'AND',
      criteria: [
        {
          id: 'crit_images_type',
          type: 'type',
          operator: 'equals',
          value: 'file',
        },
        {
          id: 'crit_images_ext',
          type: 'extension',
          operator: 'in',
          value: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'],
        },
      ],
    },
  },
  {
    id: 'preset_documents',
    name: 'Documents',
    description: 'Documents texte et bureautique',
    icon: 'document',
    color: '#3B82F6',
    isPreset: true,
    isPinned: true,
    useCount: 0,
    group: {
      id: 'group_docs',
      logic: 'AND',
      criteria: [
        {
          id: 'crit_docs_type',
          type: 'type',
          operator: 'equals',
          value: 'file',
        },
        {
          id: 'crit_docs_ext',
          type: 'extension',
          operator: 'in',
          value: ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx'],
        },
      ],
    },
  },
  {
    id: 'preset_recent',
    name: 'Fichiers recents',
    description: 'Fichiers modifies dans les 7 derniers jours',
    icon: 'clock',
    color: '#F59E0B',
    isPreset: true,
    isPinned: true,
    useCount: 0,
    group: {
      id: 'group_recent',
      logic: 'AND',
      criteria: [
        {
          id: 'crit_recent_date',
          type: 'date',
          operator: 'greaterThan',
          value: 'last7days',
        },
      ],
    },
  },
  {
    id: 'preset_large',
    name: 'Gros fichiers',
    description: 'Fichiers de plus de 100 MB',
    icon: 'scale',
    color: '#EF4444',
    isPreset: true,
    isPinned: false,
    useCount: 0,
    group: {
      id: 'group_large',
      logic: 'AND',
      criteria: [
        {
          id: 'crit_large_type',
          type: 'type',
          operator: 'equals',
          value: 'file',
        },
        {
          id: 'crit_large_size',
          type: 'size',
          operator: 'greaterThan',
          value: 100 * 1024 * 1024, // 100 MB
        },
      ],
    },
  },
  {
    id: 'preset_videos',
    name: 'Videos',
    description: 'Fichiers video (MP4, AVI, MKV, etc.)',
    icon: 'video',
    color: '#8B5CF6',
    isPreset: true,
    isPinned: false,
    useCount: 0,
    group: {
      id: 'group_videos',
      logic: 'AND',
      criteria: [
        {
          id: 'crit_videos_type',
          type: 'type',
          operator: 'equals',
          value: 'file',
        },
        {
          id: 'crit_videos_ext',
          type: 'extension',
          operator: 'in',
          value: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'],
        },
      ],
    },
  },
  {
    id: 'preset_audio',
    name: 'Audio',
    description: 'Fichiers audio (MP3, WAV, FLAC, etc.)',
    icon: 'music',
    color: '#EC4899',
    isPreset: true,
    isPinned: false,
    useCount: 0,
    group: {
      id: 'group_audio',
      logic: 'AND',
      criteria: [
        {
          id: 'crit_audio_type',
          type: 'type',
          operator: 'equals',
          value: 'file',
        },
        {
          id: 'crit_audio_ext',
          type: 'extension',
          operator: 'in',
          value: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'],
        },
      ],
    },
  },
  {
    id: 'preset_archives',
    name: 'Archives',
    description: 'Fichiers compresses (ZIP, RAR, 7Z, etc.)',
    icon: 'archive',
    color: '#6366F1',
    isPreset: true,
    isPinned: false,
    useCount: 0,
    group: {
      id: 'group_archives',
      logic: 'AND',
      criteria: [
        {
          id: 'crit_archives_type',
          type: 'type',
          operator: 'equals',
          value: 'file',
        },
        {
          id: 'crit_archives_ext',
          type: 'extension',
          operator: 'in',
          value: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
        },
      ],
    },
  },
];

// ==================== SERVICE CLASS ====================

class FilterService {
  private filters: Map<string, SavedFilter> = new Map();
  private initialized: boolean = false;

  constructor() {
    this.loadFromStorage();
  }

  // ===== INITIALIZATION =====

  /**
   * Charger les filtres depuis localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (stored) {
        const parsed: SavedFilter[] = JSON.parse(stored);
        parsed.forEach(filter => {
          this.filters.set(filter.id, filter);
        });
      }

      // Ajouter les presets manquants
      this.ensurePresets();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to load filters from storage:', error);
      this.ensurePresets();
      this.initialized = true;
    }
  }

  /**
   * S'assurer que les presets sont presents
   */
  private ensurePresets(): void {
    const now = new Date().toISOString();

    DEFAULT_PRESETS.forEach(preset => {
      if (!this.filters.has(preset.id)) {
        this.filters.set(preset.id, {
          ...preset,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    this.saveToStorage();
  }

  /**
   * Sauvegarder les filtres dans localStorage
   */
  private saveToStorage(): void {
    try {
      const filtersArray = Array.from(this.filters.values());
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filtersArray));
    } catch (error) {
      console.error('Failed to save filters to storage:', error);
    }
  }

  // ===== CRUD OPERATIONS =====

  /**
   * Obtenir tous les filtres
   */
  getAllFilters(): SavedFilter[] {
    return Array.from(this.filters.values());
  }

  /**
   * Obtenir les filtres predefinis
   */
  getPresetFilters(): SavedFilter[] {
    return this.getAllFilters().filter(f => f.isPreset);
  }

  /**
   * Obtenir les filtres personnalises
   */
  getCustomFilters(): SavedFilter[] {
    return this.getAllFilters().filter(f => !f.isPreset);
  }

  /**
   * Obtenir les filtres epingles
   */
  getPinnedFilters(): SavedFilter[] {
    return this.getAllFilters().filter(f => f.isPinned);
  }

  /**
   * Obtenir un filtre par ID
   */
  getFilter(id: string): SavedFilter | undefined {
    return this.filters.get(id);
  }

  /**
   * Creer un nouveau filtre
   */
  createFilter(data: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    group: FilterGroup;
  }): SavedFilter {
    const now = new Date().toISOString();
    const id = `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const filter: SavedFilter = {
      id,
      name: data.name,
      description: data.description,
      icon: data.icon,
      color: data.color,
      isPreset: false,
      isPinned: false,
      group: data.group,
      createdAt: now,
      updatedAt: now,
      useCount: 0,
    };

    this.filters.set(id, filter);
    this.saveToStorage();

    return filter;
  }

  /**
   * Mettre a jour un filtre
   */
  updateFilter(id: string, updates: Partial<Omit<SavedFilter, 'id' | 'isPreset' | 'createdAt'>>): SavedFilter | null {
    const filter = this.filters.get(id);
    if (!filter) return null;

    // Ne pas permettre la modification des presets (sauf pinned)
    if (filter.isPreset && Object.keys(updates).some(k => k !== 'isPinned')) {
      console.warn('Cannot modify preset filters');
      return null;
    }

    const updatedFilter: SavedFilter = {
      ...filter,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.filters.set(id, updatedFilter);
    this.saveToStorage();

    return updatedFilter;
  }

  /**
   * Supprimer un filtre
   */
  deleteFilter(id: string): boolean {
    const filter = this.filters.get(id);
    if (!filter) return false;

    // Ne pas permettre la suppression des presets
    if (filter.isPreset) {
      console.warn('Cannot delete preset filters');
      return false;
    }

    this.filters.delete(id);
    this.saveToStorage();

    return true;
  }

  /**
   * Dupliquer un filtre
   */
  duplicateFilter(id: string, newName?: string): SavedFilter | null {
    const filter = this.filters.get(id);
    if (!filter) return null;

    return this.createFilter({
      name: newName || `${filter.name} (copie)`,
      description: filter.description,
      icon: filter.icon,
      color: filter.color,
      group: JSON.parse(JSON.stringify(filter.group)), // Deep copy
    });
  }

  /**
   * Epingler/desepingler un filtre
   */
  togglePinned(id: string): boolean {
    const filter = this.filters.get(id);
    if (!filter) return false;

    filter.isPinned = !filter.isPinned;
    filter.updatedAt = new Date().toISOString();
    this.saveToStorage();

    return filter.isPinned;
  }

  // ===== FILTER APPLICATION =====

  /**
   * Appliquer un filtre a une liste d'items
   */
  applyFilter(filterId: string, items: Item[]): FilterResult {
    const startTime = performance.now();
    const filter = this.filters.get(filterId);

    if (!filter) {
      return {
        filterId,
        filterName: 'Unknown',
        matchedItems: [],
        totalScanned: items.length,
        executionTimeMs: performance.now() - startTime,
      };
    }

    // Mettre a jour les statistiques d'utilisation
    filter.lastUsedAt = new Date().toISOString();
    filter.useCount += 1;
    this.saveToStorage();

    const matchedItems = items.filter(item => this.evaluateGroup(filter.group, item));

    return {
      filterId,
      filterName: filter.name,
      matchedItems,
      totalScanned: items.length,
      executionTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Appliquer un groupe de filtres (FilterGroup) directement
   */
  applyFilterGroup(group: FilterGroup, items: Item[]): Item[] {
    return items.filter(item => this.evaluateGroup(group, item));
  }

  /**
   * Evaluer un groupe de criteres
   */
  private evaluateGroup(group: FilterGroup, item: Item): boolean {
    if (group.criteria.length === 0) return true;

    const results = group.criteria.map(criterion => {
      if ('logic' in criterion) {
        // C'est un sous-groupe
        return this.evaluateGroup(criterion, item);
      } else {
        // C'est un critere simple
        return this.evaluateCriteria(criterion, item);
      }
    });

    if (group.logic === 'AND') {
      return results.every(r => r);
    } else {
      return results.some(r => r);
    }
  }

  /**
   * Evaluer un critere individuel
   */
  private evaluateCriteria(criteria: FilterCriteria, item: Item): boolean {
    const isFile = !('items' in item);
    const isFolder = 'items' in item;

    switch (criteria.type) {
      case 'type':
        return this.evaluateType(criteria, isFile, isFolder);

      case 'extension':
        return isFile ? this.evaluateExtension(criteria, item as FileItem) : false;

      case 'name':
        return this.evaluateName(criteria, item);

      case 'size':
        return isFile ? this.evaluateSize(criteria, item as FileItem) : false;

      case 'date':
        return this.evaluateDate(criteria, item);

      case 'tag':
        return this.evaluateTag(criteria, item);

      case 'color':
        return isFolder ? this.evaluateColor(criteria, item as Folder) : false;

      case 'protected':
        return this.evaluateProtected(criteria, item);

      case 'path':
        return this.evaluatePath(criteria, item);

      default:
        return true;
    }
  }

  private evaluateType(criteria: FilterCriteria, isFile: boolean, isFolder: boolean): boolean {
    const value = criteria.value;

    switch (criteria.operator) {
      case 'equals':
        return (value === 'file' && isFile) || (value === 'folder' && isFolder);
      case 'notEquals':
        return !((value === 'file' && isFile) || (value === 'folder' && isFolder));
      default:
        return true;
    }
  }

  private evaluateExtension(criteria: FilterCriteria, file: FileItem): boolean {
    const ext = this.getFileExtension(file.name).toLowerCase();

    switch (criteria.operator) {
      case 'equals':
        return ext === criteria.value.toLowerCase();
      case 'notEquals':
        return ext !== criteria.value.toLowerCase();
      case 'in':
        return Array.isArray(criteria.value) &&
          criteria.value.map((v: string) => v.toLowerCase()).includes(ext);
      case 'notIn':
        return Array.isArray(criteria.value) &&
          !criteria.value.map((v: string) => v.toLowerCase()).includes(ext);
      default:
        return true;
    }
  }

  private evaluateName(criteria: FilterCriteria, item: Item): boolean {
    const name = item.name.toLowerCase();
    const value = String(criteria.value).toLowerCase();

    switch (criteria.operator) {
      case 'equals':
        return name === value;
      case 'notEquals':
        return name !== value;
      case 'contains':
        return name.includes(value);
      case 'notContains':
        return !name.includes(value);
      case 'startsWith':
        return name.startsWith(value);
      case 'endsWith':
        return name.endsWith(value);
      default:
        return true;
    }
  }

  private evaluateSize(criteria: FilterCriteria, file: FileItem): boolean {
    const size = file.size || 0;
    const value = Number(criteria.value);

    switch (criteria.operator) {
      case 'equals':
        return size === value;
      case 'notEquals':
        return size !== value;
      case 'greaterThan':
        return size > value;
      case 'lessThan':
        return size < value;
      case 'between': {
        const min = value;
        const max = Number(criteria.secondValue);
        return size >= min && size <= max;
      }
      default:
        return true;
    }
  }

  private evaluateDate(criteria: FilterCriteria, item: Item): boolean {
    const itemDate = new Date(item.updatedAt || item.createdAt || '');
    if (isNaN(itemDate.getTime())) return false;

    let compareDate: Date;
    const now = new Date();

    // Gerer les valeurs relatives
    if (typeof criteria.value === 'string') {
      switch (criteria.value) {
        case 'today':
          compareDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'yesterday':
          compareDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          break;
        case 'last7days':
          compareDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'last30days':
          compareDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'thisMonth':
          compareDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'thisYear':
          compareDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          compareDate = new Date(criteria.value);
      }
    } else {
      compareDate = new Date(criteria.value);
    }

    if (isNaN(compareDate.getTime())) return false;

    switch (criteria.operator) {
      case 'equals':
        return itemDate.toDateString() === compareDate.toDateString();
      case 'greaterThan':
        return itemDate > compareDate;
      case 'lessThan':
        return itemDate < compareDate;
      case 'between': {
        const endDate = new Date(criteria.secondValue);
        return itemDate >= compareDate && itemDate <= endDate;
      }
      default:
        return true;
    }
  }


  /**
   * Evaluer un critere de tag.
   * Tag service has been removed — tag filtering is currently a no-op.
   */
  private evaluateTag(_criteria: FilterCriteria, _item: Item): boolean {
    // Tag service removed — always pass tag criteria for now
    return true;
  }

  /**
   * Evaluer un critere de chemin (path).
   * Utilise le parentId de l'item pour construire un chemin de base.
   *
   * Operateurs supportes:
   * - equals: le chemin correspond exactement
   * - contains: le chemin contient la valeur
   * - startsWith: le chemin commence par la valeur
   * - endsWith: le chemin se termine par la valeur
   * - notContains: le chemin ne contient pas la valeur
   */
  private evaluatePath(criteria: FilterCriteria, item: Item): boolean {
    const parentId = item.parentId || '';
    const itemPath = parentId ? parentId + '/' + item.name : item.name;
    const path = itemPath.toLowerCase();
    const value = String(criteria.value).toLowerCase();

    switch (criteria.operator) {
      case 'equals':
        return path === value;
      case 'notEquals':
        return path !== value;
      case 'contains':
        return path.includes(value);
      case 'notContains':
        return !path.includes(value);
      case 'startsWith':
        return path.startsWith(value);
      case 'endsWith':
        return path.endsWith(value);
      default:
        return true;
    }
  }

  private evaluateColor(criteria: FilterCriteria, folder: Folder): boolean {
    const color = folder.color?.toLowerCase() || '';
    const value = String(criteria.value).toLowerCase();

    switch (criteria.operator) {
      case 'equals':
        return color === value;
      case 'notEquals':
        return color !== value;
      case 'in':
        return Array.isArray(criteria.value) &&
          criteria.value.map((v: string) => v.toLowerCase()).includes(color);
      default:
        return true;
    }
  }

  private evaluateProtected(criteria: FilterCriteria, item: Item): boolean {
    const isProtected = (item as any).protected === true;

    switch (criteria.operator) {
      case 'equals':
        return isProtected === criteria.value;
      case 'exists':
        return isProtected;
      case 'notExists':
        return !isProtected;
      default:
        return true;
    }
  }

  // ===== UTILITIES =====

  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }

  /**
   * Convertir en SearchFilters pour compatibilite
   */
  toSearchFilters(filterId: string): SearchFilters | null {
    const filter = this.filters.get(filterId);
    if (!filter) return null;

    const searchFilters: SearchFilters = {};

    // Extraire les criteres simples du premier niveau
    filter.group.criteria.forEach(criterion => {
      if ('type' in criterion && !('logic' in criterion)) {
        const c = criterion as FilterCriteria;

        switch (c.type) {
          case 'type':
            if (c.operator === 'equals') {
              searchFilters.type = c.value as 'file' | 'folder' | 'all';
            }
            break;
          case 'date':
            if (c.operator === 'greaterThan') {
              searchFilters.dateFrom = this.resolveDateValue(c.value);
            } else if (c.operator === 'lessThan') {
              searchFilters.dateTo = this.resolveDateValue(c.value);
            }
            break;
          case 'size':
            if (c.operator === 'greaterThan') {
              searchFilters.sizeMin = Number(c.value);
            } else if (c.operator === 'lessThan') {
              searchFilters.sizeMax = Number(c.value);
            }
            break;
          case 'tag':
            if (c.operator === 'in' && Array.isArray(c.value)) {
              searchFilters.tags = c.value;
            }
            break;
          case 'protected':
            searchFilters.protected = c.value === true;
            break;
        }
      }
    });

    return searchFilters;
  }

  private resolveDateValue(value: any): string {
    const now = new Date();

    if (typeof value === 'string') {
      switch (value) {
        case 'today':
          return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        case 'yesterday':
          return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
        case 'last7days':
          return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        case 'last30days':
          return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        case 'thisMonth':
          return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        case 'thisYear':
          return new Date(now.getFullYear(), 0, 1).toISOString();
        default:
          return value;
      }
    }

    return new Date(value).toISOString();
  }

  /**
   * Creer un filtre a partir de SearchFilters
   */
  createFromSearchFilters(name: string, filters: SearchFilters): SavedFilter {
    const criteria: FilterCriteria[] = [];
    let criteriaIndex = 0;

    if (filters.type && filters.type !== 'all') {
      criteria.push({
        id: `crit_${criteriaIndex++}`,
        type: 'type',
        operator: 'equals',
        value: filters.type,
      });
    }

    if (filters.dateFrom) {
      criteria.push({
        id: `crit_${criteriaIndex++}`,
        type: 'date',
        operator: 'greaterThan',
        value: filters.dateFrom,
      });
    }

    if (filters.dateTo) {
      criteria.push({
        id: `crit_${criteriaIndex++}`,
        type: 'date',
        operator: 'lessThan',
        value: filters.dateTo,
      });
    }

    if (filters.sizeMin !== undefined) {
      criteria.push({
        id: `crit_${criteriaIndex++}`,
        type: 'size',
        operator: 'greaterThan',
        value: filters.sizeMin,
      });
    }

    if (filters.sizeMax !== undefined) {
      criteria.push({
        id: `crit_${criteriaIndex++}`,
        type: 'size',
        operator: 'lessThan',
        value: filters.sizeMax,
      });
    }

    if (filters.tags && filters.tags.length > 0) {
      criteria.push({
        id: `crit_${criteriaIndex++}`,
        type: 'tag',
        operator: 'in',
        value: filters.tags,
      });
    }

    if (filters.protected !== undefined) {
      criteria.push({
        id: `crit_${criteriaIndex++}`,
        type: 'protected',
        operator: 'equals',
        value: filters.protected,
      });
    }

    return this.createFilter({
      name,
      group: {
        id: 'root_group',
        logic: 'AND',
        criteria,
      },
    });
  }

  /**
   * Exporter les filtres personnalises
   */
  exportFilters(): string {
    const customFilters = this.getCustomFilters();
    return JSON.stringify(customFilters, null, 2);
  }

  /**
   * Importer des filtres
   */
  importFilters(jsonString: string): number {
    try {
      const imported: SavedFilter[] = JSON.parse(jsonString);
      let count = 0;

      imported.forEach(filter => {
        // Generer un nouvel ID pour eviter les conflits
        const newId = `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date().toISOString();

        this.filters.set(newId, {
          ...filter,
          id: newId,
          isPreset: false,
          createdAt: now,
          updatedAt: now,
        });
        count++;
      });

      this.saveToStorage();
      return count;
    } catch (error) {
      console.error('Failed to import filters:', error);
      return 0;
    }
  }
}

// ==================== EXPORT ====================

const filterService = new FilterService();
export default filterService;
