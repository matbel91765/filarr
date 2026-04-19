/**
 * Tag Service
 *
 * Service de gestion des tags hierarchiques.
 * Permet de creer, modifier, supprimer des tags avec support
 * des relations parent-enfant, couleurs, alias et heritage de tags.
 */

import type { HierarchicalTag, TagStatistics, BulkTagOperation } from '../../types';

// ==================== STORAGE KEYS ====================

const TAGS_STORAGE_KEY = 'filarr_hierarchical_tags';
const TAG_MAPPINGS_STORAGE_KEY = 'filarr_tag_file_mappings';
const TAG_STATISTICS_STORAGE_KEY = 'filarr_tag_statistics';

// ==================== TYPES ====================

/**
 * Mapping entre fichiers et tags
 */
export interface TagFileMapping {
  fileId: string;
  tagIds: string[];
  inheritedTagIds: string[]; // Tags herites des parents
  addedAt: string;
  updatedAt: string;
}

/**
 * Options de creation de tag
 */
export interface CreateTagOptions {
  name: string;
  parentId?: string | null;
  color?: string;
  icon?: string;
  aliases?: string[];
  description?: string;
}

/**
 * Options de mise a jour de tag
 */
export interface UpdateTagOptions {
  name?: string;
  parentId?: string | null;
  color?: string;
  icon?: string;
  aliases?: string[];
  description?: string;
}

/**
 * Resultat de recherche de tags
 */
export interface TagSearchResult {
  tag: HierarchicalTag;
  matchType: 'name' | 'alias';
  matchedText: string;
}

// ==================== PREDEFINED COLORS ====================

export const TAG_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#84CC16', // Lime
  '#6366F1', // Indigo
  '#14B8A6', // Teal
  '#A855F7', // Violet
];

// ==================== SERVICE CLASS ====================

class TagService {
  private tags: Map<string, HierarchicalTag> = new Map();
  private fileMappings: Map<string, TagFileMapping> = new Map();
  private statistics: Map<string, TagStatistics> = new Map();
  private initialized: boolean = false;

  constructor() {
    this.loadFromStorage();
  }

  // ===== INITIALIZATION =====

  /**
   * Charger les donnees depuis localStorage
   */
  private loadFromStorage(): void {
    try {
      // Charger les tags
      const tagsData = localStorage.getItem(TAGS_STORAGE_KEY);
      if (tagsData) {
        const parsed: HierarchicalTag[] = JSON.parse(tagsData);
        parsed.forEach(tag => {
          this.tags.set(tag.id, tag);
        });
      }

      // Charger les mappings fichier-tag
      const mappingsData = localStorage.getItem(TAG_MAPPINGS_STORAGE_KEY);
      if (mappingsData) {
        const parsed: TagFileMapping[] = JSON.parse(mappingsData);
        parsed.forEach(mapping => {
          this.fileMappings.set(mapping.fileId, mapping);
        });
      }

      // Charger les statistiques
      const statsData = localStorage.getItem(TAG_STATISTICS_STORAGE_KEY);
      if (statsData) {
        const parsed: TagStatistics[] = JSON.parse(statsData);
        parsed.forEach(stat => {
          this.statistics.set(stat.tagId, stat);
        });
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to load tags from storage:', error);
      this.initialized = true;
    }
  }

  /**
   * Sauvegarder les tags dans localStorage
   */
  private saveTagsToStorage(): void {
    try {
      const tagsArray = Array.from(this.tags.values());
      localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(tagsArray));
    } catch (error) {
      console.error('Failed to save tags to storage:', error);
    }
  }

  /**
   * Sauvegarder les mappings dans localStorage
   */
  private saveMappingsToStorage(): void {
    try {
      const mappingsArray = Array.from(this.fileMappings.values());
      localStorage.setItem(TAG_MAPPINGS_STORAGE_KEY, JSON.stringify(mappingsArray));
    } catch (error) {
      console.error('Failed to save tag mappings to storage:', error);
    }
  }

  /**
   * Sauvegarder les statistiques dans localStorage
   */
  private saveStatisticsToStorage(): void {
    try {
      const statsArray = Array.from(this.statistics.values());
      localStorage.setItem(TAG_STATISTICS_STORAGE_KEY, JSON.stringify(statsArray));
    } catch (error) {
      console.error('Failed to save tag statistics to storage:', error);
    }
  }

  // ===== TAG CRUD OPERATIONS =====

  /**
   * Generer un ID unique pour un tag
   */
  private generateTagId(): string {
    return `tag_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Obtenir tous les tags
   */
  getAllTags(): HierarchicalTag[] {
    return Array.from(this.tags.values()).map(tag => ({
      ...tag,
      children: [...tag.children],
      aliases: [...tag.aliases],
    }));
  }

  /**
   * Obtenir les tags racines (sans parent)
   */
  getRootTags(): HierarchicalTag[] {
    return this.getAllTags().filter(tag => !tag.parentId);
  }

  /**
   * Obtenir un tag par ID
   */
  getTag(id: string): HierarchicalTag | undefined {
    return this.tags.get(id);
  }

  /**
   * Obtenir les enfants directs d'un tag
   */
  getChildTags(parentId: string): HierarchicalTag[] {
    return this.getAllTags().filter(tag => tag.parentId === parentId);
  }

  /**
   * Obtenir tous les descendants d'un tag (recursif)
   */
  getDescendantTags(tagId: string): HierarchicalTag[] {
    const descendants: HierarchicalTag[] = [];
    const children = this.getChildTags(tagId);

    for (const child of children) {
      descendants.push(child);
      descendants.push(...this.getDescendantTags(child.id));
    }

    return descendants;
  }

  /**
   * Obtenir tous les ancetres d'un tag (du parent jusqu'a la racine)
   */
  getAncestorTags(tagId: string): HierarchicalTag[] {
    const ancestors: HierarchicalTag[] = [];
    let currentTag = this.getTag(tagId);

    while (currentTag && currentTag.parentId) {
      const parent = this.getTag(currentTag.parentId);
      if (parent) {
        ancestors.push(parent);
        currentTag = parent;
      } else {
        break;
      }
    }

    return ancestors;
  }

  /**
   * Obtenir le chemin complet d'un tag (de la racine au tag)
   */
  getTagPath(tagId: string): HierarchicalTag[] {
    const ancestors = this.getAncestorTags(tagId);
    const tag = this.getTag(tagId);
    if (!tag) return [];

    return [...ancestors.reverse(), tag];
  }

  /**
   * Obtenir le chemin textuel d'un tag
   */
  getTagPathString(tagId: string): string {
    return this.getTagPath(tagId)
      .map(t => t.name)
      .join(' > ');
  }

  /**
   * Creer un nouveau tag
   */
  createTag(options: CreateTagOptions): HierarchicalTag {
    const now = new Date().toISOString();
    const id = this.generateTagId();

    // Verifier que le parent existe si specifie
    if (options.parentId && !this.tags.has(options.parentId)) {
      throw new Error('Parent tag not found');
    }

    const tag: HierarchicalTag = {
      id,
      name: options.name.trim(),
      parentId: options.parentId || null,
      color: options.color || TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)],
      icon: options.icon,
      aliases: options.aliases || [],
      description: options.description,
      usageCount: 0,
      children: [],
      createdAt: now,
      updatedAt: now,
    };

    // Ajouter le tag
    this.tags.set(id, tag);

    // Mettre a jour le parent
    if (tag.parentId) {
      const parent = this.tags.get(tag.parentId);
      if (parent) {
        parent.children.push(id);
        parent.updatedAt = now;
      }
    }

    // Initialiser les statistiques
    this.statistics.set(id, {
      tagId: id,
      totalFiles: 0,
      recentUsage: 0,
      averageConfidence: 0,
      topCoTags: [],
      lastUsedAt: now,
    });

    this.saveTagsToStorage();
    this.saveStatisticsToStorage();

    return tag;
  }

  /**
   * Mettre a jour un tag
   */
  updateTag(id: string, updates: UpdateTagOptions): HierarchicalTag | null {
    const tag = this.tags.get(id);
    if (!tag) return null;

    const now = new Date().toISOString();

    // Gerer le changement de parent
    if (updates.parentId !== undefined && updates.parentId !== tag.parentId) {
      // Verifier qu'on ne cree pas de cycle
      if (updates.parentId) {
        const newParent = this.getTag(updates.parentId);
        if (!newParent) {
          throw new Error('New parent tag not found');
        }

        // Verifier que le nouveau parent n'est pas un descendant
        const descendants = this.getDescendantTags(id);
        if (descendants.some(d => d.id === updates.parentId)) {
          throw new Error('Cannot set a descendant as parent (would create cycle)');
        }
      }

      // Retirer de l'ancien parent
      if (tag.parentId) {
        const oldParent = this.tags.get(tag.parentId);
        if (oldParent) {
          oldParent.children = oldParent.children.filter(childId => childId !== id);
          oldParent.updatedAt = now;
        }
      }

      // Ajouter au nouveau parent
      if (updates.parentId) {
        const newParent = this.tags.get(updates.parentId);
        if (newParent) {
          newParent.children.push(id);
          newParent.updatedAt = now;
        }
      }
    }

    // Appliquer les mises a jour
    const updatedTag: HierarchicalTag = {
      ...tag,
      name: updates.name?.trim() ?? tag.name,
      parentId: updates.parentId !== undefined ? updates.parentId : tag.parentId,
      color: updates.color ?? tag.color,
      icon: updates.icon !== undefined ? updates.icon : tag.icon,
      aliases: updates.aliases ?? tag.aliases,
      description: updates.description !== undefined ? updates.description : tag.description,
      updatedAt: now,
    };

    this.tags.set(id, updatedTag);
    this.saveTagsToStorage();

    return updatedTag;
  }

  /**
   * Supprimer un tag
   */
  deleteTag(id: string, reassignChildrenTo?: string | null): boolean {
    const tag = this.tags.get(id);
    if (!tag) return false;

    const now = new Date().toISOString();
    const children = this.getChildTags(id);

    // Gerer les enfants
    for (const child of children) {
      if (reassignChildrenTo === null) {
        // Les enfants deviennent des racines
        child.parentId = null;
        child.updatedAt = now;
      } else if (reassignChildrenTo && this.tags.has(reassignChildrenTo)) {
        // Reassigner au tag specifie
        child.parentId = reassignChildrenTo;
        child.updatedAt = now;

        const newParent = this.tags.get(reassignChildrenTo);
        if (newParent) {
          newParent.children.push(child.id);
          newParent.updatedAt = now;
        }
      } else {
        // Par defaut, les enfants deviennent des racines
        child.parentId = null;
        child.updatedAt = now;
      }
    }

    // Retirer du parent
    if (tag.parentId) {
      const parent = this.tags.get(tag.parentId);
      if (parent) {
        parent.children = parent.children.filter(childId => childId !== id);
        parent.updatedAt = now;
      }
    }

    // Retirer le tag de tous les fichiers
    this.fileMappings.forEach(mapping => {
      if (mapping.tagIds.includes(id)) {
        mapping.tagIds = mapping.tagIds.filter(tagId => tagId !== id);
        mapping.inheritedTagIds = mapping.inheritedTagIds.filter(tagId => tagId !== id);
        mapping.updatedAt = now;
      }
    });

    // Supprimer le tag et ses statistiques
    this.tags.delete(id);
    this.statistics.delete(id);

    this.saveTagsToStorage();
    this.saveMappingsToStorage();
    this.saveStatisticsToStorage();

    return true;
  }

  /**
   * Fusionner plusieurs tags en un seul
   */
  mergeTags(sourceIds: string[], targetId: string): boolean {
    const target = this.tags.get(targetId);
    if (!target) return false;

    const now = new Date().toISOString();

    for (const sourceId of sourceIds) {
      if (sourceId === targetId) continue;

      const source = this.tags.get(sourceId);
      if (!source) continue;

      // Fusionner les alias
      target.aliases = [...new Set([...target.aliases, source.name, ...source.aliases])];

      // Transferer les associations de fichiers
      this.fileMappings.forEach(mapping => {
        if (mapping.tagIds.includes(sourceId)) {
          mapping.tagIds = mapping.tagIds.filter(id => id !== sourceId);
          if (!mapping.tagIds.includes(targetId)) {
            mapping.tagIds.push(targetId);
          }
          mapping.updatedAt = now;
        }
      });

      // Transferer les enfants au tag cible
      const children = this.getChildTags(sourceId);
      for (const child of children) {
        child.parentId = targetId;
        child.updatedAt = now;
        target.children.push(child.id);
      }

      // Ajouter le usageCount
      target.usageCount += source.usageCount;

      // Supprimer le tag source
      if (source.parentId) {
        const parent = this.tags.get(source.parentId);
        if (parent) {
          parent.children = parent.children.filter(childId => childId !== sourceId);
        }
      }
      this.tags.delete(sourceId);
      this.statistics.delete(sourceId);
    }

    target.updatedAt = now;
    target.children = [...new Set(target.children)]; // Remove duplicates

    this.saveTagsToStorage();
    this.saveMappingsToStorage();
    this.saveStatisticsToStorage();

    return true;
  }

  // ===== FILE-TAG ASSOCIATIONS =====

  /**
   * Ajouter un tag a un fichier
   */
  addTagToFile(fileId: string, tagId: string): boolean {
    const tag = this.tags.get(tagId);
    if (!tag) return false;

    const now = new Date().toISOString();

    let mapping = this.fileMappings.get(fileId);
    if (!mapping) {
      mapping = {
        fileId,
        tagIds: [],
        inheritedTagIds: [],
        addedAt: now,
        updatedAt: now,
      };
      this.fileMappings.set(fileId, mapping);
    }

    // Ajouter le tag s'il n'est pas deja present
    if (!mapping.tagIds.includes(tagId)) {
      mapping.tagIds.push(tagId);
      mapping.updatedAt = now;

      // Ajouter les tags ancetres comme herites
      const ancestors = this.getAncestorTags(tagId);
      for (const ancestor of ancestors) {
        if (!mapping.inheritedTagIds.includes(ancestor.id) && !mapping.tagIds.includes(ancestor.id)) {
          mapping.inheritedTagIds.push(ancestor.id);
        }
      }

      // Mettre a jour le compteur d'utilisation
      tag.usageCount += 1;
      tag.updatedAt = now;

      // Mettre a jour les statistiques
      this.updateTagStatistics(tagId);

      this.saveTagsToStorage();
      this.saveMappingsToStorage();
    }

    return true;
  }

  /**
   * Retirer un tag d'un fichier
   */
  removeTagFromFile(fileId: string, tagId: string): boolean {
    const mapping = this.fileMappings.get(fileId);
    if (!mapping) return false;

    const tag = this.tags.get(tagId);
    if (!tag) return false;

    const now = new Date().toISOString();

    const index = mapping.tagIds.indexOf(tagId);
    if (index !== -1) {
      mapping.tagIds.splice(index, 1);
      mapping.updatedAt = now;

      // Recalculer les tags herites
      this.recalculateInheritedTags(mapping);

      // Mettre a jour le compteur d'utilisation
      tag.usageCount = Math.max(0, tag.usageCount - 1);
      tag.updatedAt = now;

      this.saveTagsToStorage();
      this.saveMappingsToStorage();
    }

    return true;
  }

  /**
   * Obtenir tous les tags d'un fichier (directs et herites)
   */
  getFileTags(fileId: string): { direct: HierarchicalTag[]; inherited: HierarchicalTag[] } {
    const mapping = this.fileMappings.get(fileId);
    if (!mapping) {
      return { direct: [], inherited: [] };
    }

    const direct = mapping.tagIds
      .map(id => this.tags.get(id))
      .filter((tag): tag is HierarchicalTag => tag !== undefined);

    const inherited = mapping.inheritedTagIds
      .map(id => this.tags.get(id))
      .filter((tag): tag is HierarchicalTag => tag !== undefined);

    return { direct, inherited };
  }

  /**
   * Obtenir tous les mappings fichier -> tagIds (directs)
   */
  getAllFileTagMappings(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    this.fileMappings.forEach((mapping, fileId) => {
      result[fileId] = [...mapping.tagIds];
    });
    return result;
  }

  /**
   * Obtenir tous les fichiers avec un tag specifique
   */
  getFilesByTag(tagId: string, includeInherited: boolean = true): string[] {
    const fileIds: string[] = [];

    this.fileMappings.forEach((mapping, fileId) => {
      if (mapping.tagIds.includes(tagId)) {
        fileIds.push(fileId);
      } else if (includeInherited && mapping.inheritedTagIds.includes(tagId)) {
        fileIds.push(fileId);
      }
    });

    return fileIds;
  }

  /**
   * Recalculer les tags herites pour un mapping
   */
  private recalculateInheritedTags(mapping: TagFileMapping): void {
    const inheritedSet = new Set<string>();

    for (const tagId of mapping.tagIds) {
      const ancestors = this.getAncestorTags(tagId);
      for (const ancestor of ancestors) {
        if (!mapping.tagIds.includes(ancestor.id)) {
          inheritedSet.add(ancestor.id);
        }
      }
    }

    mapping.inheritedTagIds = Array.from(inheritedSet);
  }

  // ===== SEARCH =====

  /**
   * Rechercher des tags par nom ou alias
   */
  searchTags(query: string): TagSearchResult[] {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();
    const results: TagSearchResult[] = [];

    this.tags.forEach(tag => {
      // Recherche dans le nom
      if (tag.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          tag,
          matchType: 'name',
          matchedText: tag.name,
        });
        return;
      }

      // Recherche dans les alias
      for (const alias of tag.aliases) {
        if (alias.toLowerCase().includes(lowerQuery)) {
          results.push({
            tag,
            matchType: 'alias',
            matchedText: alias,
          });
          return;
        }
      }
    });

    // Trier par pertinence (correspondance exacte d'abord)
    return results.sort((a, b) => {
      const aExact = a.matchedText.toLowerCase() === lowerQuery;
      const bExact = b.matchedText.toLowerCase() === lowerQuery;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.tag.name.localeCompare(b.tag.name);
    });
  }

  // ===== STATISTICS =====

  /**
   * Mettre a jour les statistiques d'un tag
   */
  private updateTagStatistics(tagId: string): void {
    const tag = this.tags.get(tagId);
    if (!tag) return;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Compter les fichiers
    const fileIds = this.getFilesByTag(tagId, false);
    let recentUsage = 0;

    // Compter les co-tags
    const coTagCounts = new Map<string, number>();

    for (const fileId of fileIds) {
      const mapping = this.fileMappings.get(fileId);
      if (mapping) {
        // Compter l'utilisation recente
        if (new Date(mapping.updatedAt) > thirtyDaysAgo) {
          recentUsage++;
        }

        // Compter les co-tags
        for (const otherTagId of mapping.tagIds) {
          if (otherTagId !== tagId) {
            coTagCounts.set(otherTagId, (coTagCounts.get(otherTagId) || 0) + 1);
          }
        }
      }
    }

    // Trouver les top co-tags
    const topCoTags = Array.from(coTagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => this.tags.get(id)?.name || '')
      .filter(name => name);

    const stats: TagStatistics = {
      tagId,
      totalFiles: fileIds.length,
      recentUsage,
      averageConfidence: 1, // Pour les tags manuels, la confiance est de 100%
      topCoTags,
      lastUsedAt: now.toISOString(),
    };

    this.statistics.set(tagId, stats);
    this.saveStatisticsToStorage();
  }

  /**
   * Obtenir les statistiques d'un tag
   */
  getTagStatistics(tagId: string): TagStatistics | undefined {
    return this.statistics.get(tagId);
  }

  /**
   * Obtenir toutes les statistiques
   */
  getAllStatistics(): TagStatistics[] {
    return Array.from(this.statistics.values()).map(stat => ({
      ...stat,
      topCoTags: [...stat.topCoTags],
    }));
  }

  // ===== BULK OPERATIONS =====

  /**
   * Executer une operation en masse
   */
  executeBulkOperation(
    operation: Omit<BulkTagOperation, 'id' | 'createdAt' | 'completedAt' | 'result'>
  ): BulkTagOperation {
    const now = new Date().toISOString();
    const id = `bulk_${Date.now()}`;

    const result: BulkTagOperation = {
      id,
      ...operation,
      status: 'processing',
      progress: 0,
      createdAt: now,
    };

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    const totalOperations = operation.fileIds.length * operation.sourceTagIds.length;
    let completed = 0;

    for (const fileId of operation.fileIds) {
      for (const tagId of operation.sourceTagIds) {
        try {
          switch (operation.type) {
            case 'add':
              this.addTagToFile(fileId, tagId);
              successCount++;
              break;
            case 'remove':
              this.removeTagFromFile(fileId, tagId);
              successCount++;
              break;
            case 'replace':
              if (operation.targetTagId) {
                this.removeTagFromFile(fileId, tagId);
                this.addTagToFile(fileId, operation.targetTagId);
                successCount++;
              }
              break;
          }
        } catch (error) {
          failureCount++;
          errors.push(`Failed for file ${fileId}, tag ${tagId}: ${(error as Error).message}`);
        }

        completed++;
        result.progress = Math.round((completed / totalOperations) * 100);
      }
    }

    result.status = failureCount > 0 ? (successCount > 0 ? 'completed' : 'failed') : 'completed';
    result.completedAt = new Date().toISOString();
    result.result = {
      successCount,
      failureCount,
      errors,
    };

    return result;
  }

  // ===== IMPORT/EXPORT =====

  /**
   * Exporter tous les tags
   */
  exportTags(): string {
    const data = {
      tags: this.getAllTags(),
      mappings: Array.from(this.fileMappings.values()),
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Importer des tags
   */
  importTags(jsonString: string): number {
    try {
      const data = JSON.parse(jsonString);
      let count = 0;

      if (data.tags && Array.isArray(data.tags)) {
        const now = new Date().toISOString();

        for (const tag of data.tags as HierarchicalTag[]) {
          // Generer un nouvel ID pour eviter les conflits
          const newId = this.generateTagId();
          const newTag: HierarchicalTag = {
            ...tag,
            id: newId,
            createdAt: now,
            updatedAt: now,
            usageCount: 0,
            children: [],
          };

          this.tags.set(newId, newTag);
          count++;
        }
      }

      this.saveTagsToStorage();
      return count;
    } catch (error) {
      console.error('Failed to import tags:', error);
      return 0;
    }
  }

  /**
   * Effacer toutes les donnees
   */
  clearAll(): void {
    this.tags.clear();
    this.fileMappings.clear();
    this.statistics.clear();
    this.saveTagsToStorage();
    this.saveMappingsToStorage();
    this.saveStatisticsToStorage();
  }
}

// ==================== EXPORT ====================

const tagService = new TagService();
export default tagService;

// Export types
export type { HierarchicalTag, TagStatistics, BulkTagOperation } from '../../types';
