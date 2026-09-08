/**
 * Note Service — Filarr Notes
 *
 * CRUD operations, search indexing, and link resolution for notes.
 * Notes are stored in Redux (persisted via redux-persist) following
 * the same local-first pattern as files/folders.
 */

import type { Note, NoteTemplate, Backlink, LinkSuggestion, WikiLinkType } from '../../types/notes';
import { extractNoteLinks, extractFileLinks, extractFolderLinks } from './noteLinkParser';
import { getProjectTemplates } from './projectTemplates';
import { getGeneralTemplates } from './generalTemplates';
import i18n from '../../i18n/config';

// ==================== ID GENERATION ====================

export function generateNoteId(): string {
  // crypto.randomUUID is available in Electron
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ==================== NOTE FACTORY ====================

export function createNote(overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  return {
    id: generateNoteId(),
    title: '',
    content: '',
    plainText: '',
    parentId: null,
    linkedNoteIds: [],
    linkedFileIds: [],
    linkedFolderIds: [],
    isDaily: false,
    tagIds: [],
    wordCount: 0,
    isPinned: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createDailyNote(date: string): Note {
  const formatted = new Date(date).toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return createNote({
    title: formatted,
    isDaily: true,
    dailyDate: date,
    icon: '\uD83D\uDCC5', // 📅 calendar emoji
  });
}

// ==================== LINK RESOLUTION ====================

/**
 * Clé canonique de résolution d'un lien wiki : `toLowerCase()` brut.
 *
 * POURQUOI une fonction pour une ligne : cette clé est le SEUL contrat qui
 * dit « [[cible]] désigne-t-il cette note ? ». La vue graphe doit poser
 * exactement la même question pour décider si une cible est un fantôme ;
 * dès que les deux normalisations divergent, un lien peut tomber dans
 * l'angle mort — resolveLinks échoue (pas d'arête) alors que le graphe le
 * croit résolu (pas de nœud fantôme) : le lien DISPARAÎT silencieusement.
 * Une seule définition partagée rend cette divergence impossible.
 *
 * Volontairement NON normalisante au-delà de la casse : ni repli des
 * espaces, ni retrait du fragment `#ancre`. C'est le comportement
 * historique, et il est cohérent avec les autres consommateurs de liens
 * (ouverture d'un [[lien]] dans l'éditeur, aperçu au survol, propagation
 * de renommage) qui comparent tous `title.toLowerCase()`. Élargir ici
 * seulement rendrait le graphe plus permissif que le reste de l'app.
 */
export function linkResolutionKey(nameOrTarget: string): string {
  return nameOrTarget.toLowerCase();
}

/**
 * Index « clé canonique → id de note », construit avec `linkResolutionKey`.
 *
 * Exporté pour que la vue graphe teste l'existence d'une cible avec
 * EXACTEMENT l'index de `resolveLinks` (même fonction, même construction)
 * au lieu de réimplémenter une normalisation parallèle.
 *
 * Prend un itérable plutôt qu'un `Record` : le service passe
 * `Object.values(byId)`, le graphe passe sa liste de notes visibles
 * (hors corbeille) sans allocation intermédiaire.
 */
export function buildNoteTitleIndex(notes: Iterable<Note>): Map<string, string> {
  const index = new Map<string, string>();
  for (const note of notes) {
    const key = linkResolutionKey(note.title || '');
    // CHANGEMENT DE COMPORTEMENT ASSUMÉ de resolveLinks (avant, toutes les
    // notes étaient indexées, titre vide compris). Une note sans titre ne
    // peut être la cible d'aucun [[lien]], et l'indexer sous la clé vide
    // ouvrait un vrai piège : `parseWikiLinks` fait `target.trim()`, donc
    // `[[ ]]` produit une cible VIDE qui résolvait alors vers la dernière
    // note sans titre rencontrée — une arête vers une note au hasard.
    if (key) index.set(key, note.id);
  }
  return index;
}

/**
 * Resolve outgoing links from a note's plain text.
 * Returns arrays of IDs found by matching names against known items.
 */
export function resolveLinks(
  plainText: string,
  notesById: Record<string, Note>,
  filesById: Record<string, { id: string; name: string }>,
  foldersById: Record<string, { id: string; name: string }>
): { linkedNoteIds: string[]; linkedFileIds: string[]; linkedFolderIds: string[] } {
  const noteNames = extractNoteLinks(plainText);
  const fileNames = extractFileLinks(plainText);
  const folderNames = extractFolderLinks(plainText);

  const noteIndex = buildNoteTitleIndex(Object.values(notesById));

  const fileIndex = new Map<string, string>();
  Object.values(filesById).forEach((f) => fileIndex.set(f.name.toLowerCase(), f.id));

  const folderIndex = new Map<string, string>();
  Object.values(foldersById).forEach((f) => folderIndex.set(f.name.toLowerCase(), f.id));

  return {
    linkedNoteIds: [
      ...new Set(noteNames.map((n) => noteIndex.get(linkResolutionKey(n))).filter(Boolean)),
    ] as string[],
    linkedFileIds: [
      ...new Set(fileNames.map((n) => fileIndex.get(n.toLowerCase())).filter(Boolean)),
    ] as string[],
    linkedFolderIds: [
      ...new Set(folderNames.map((n) => folderIndex.get(n.toLowerCase())).filter(Boolean)),
    ] as string[],
  };
}

/**
 * Find all backlinks — notes that link to a given note.
 */
export function findBacklinks(targetNoteId: string, notesById: Record<string, Note>): Backlink[] {
  const backlinks: Backlink[] = [];

  for (const note of Object.values(notesById)) {
    if (note.id === targetNoteId) continue;
    if (note.linkedNoteIds.includes(targetNoteId)) {
      // Extract context around the link
      const targetNote = notesById[targetNoteId];
      const linkText = targetNote?.title || '';
      const idx = note.plainText.toLowerCase().indexOf(linkText.toLowerCase());
      const contextStart = Math.max(0, idx - 40);
      const contextEnd = Math.min(note.plainText.length, idx + linkText.length + 40);
      const context =
        idx >= 0
          ? '...' + note.plainText.slice(contextStart, contextEnd).trim() + '...'
          : note.plainText.slice(0, 80) + '...';

      backlinks.push({
        sourceNoteId: note.id,
        sourceNoteTitle: note.title,
        context,
      });
    }
  }

  return backlinks;
}

/**
 * Find all notes that link to a given file.
 */
export function findFileBacklinks(fileId: string, notesById: Record<string, Note>): Backlink[] {
  return Object.values(notesById)
    .filter((note) => note.linkedFileIds.includes(fileId))
    .map((note) => ({
      sourceNoteId: note.id,
      sourceNoteTitle: note.title,
      context: note.plainText.slice(0, 80) + '...',
    }));
}

// ==================== SEARCH / SUGGESTIONS ====================

/**
 * Build link suggestions from all available items.
 */
export function buildLinkSuggestions(
  query: string,
  notesById: Record<string, Note>,
  filesById: Record<string, { id: string; name: string; type?: string }>,
  foldersById: Record<string, { id: string; name: string; color?: string }>
): LinkSuggestion[] {
  const q = query.toLowerCase();
  const suggestions: LinkSuggestion[] = [];

  // Notes
  for (const note of Object.values(notesById)) {
    if (note.title.toLowerCase().includes(q)) {
      suggestions.push({
        id: note.id,
        title: note.title,
        type: 'note',
        subtitle: note.isDaily ? 'Journal' : undefined,
        icon: note.icon || 'note',
      });
    }
  }

  // Files
  for (const file of Object.values(filesById)) {
    if (file.name.toLowerCase().includes(q)) {
      suggestions.push({
        id: file.id,
        title: file.name,
        type: 'file',
        subtitle: file.type,
        icon: 'file',
      });
    }
  }

  // Folders
  for (const folder of Object.values(foldersById)) {
    if (folder.name.toLowerCase().includes(q)) {
      suggestions.push({
        id: folder.id,
        title: folder.name,
        type: 'folder',
        icon: 'folder',
      });
    }
  }

  // Sort: exact matches first, then by type priority (note > file > folder)
  const typePriority: Record<WikiLinkType, number> = { note: 0, file: 1, folder: 2 };
  suggestions.sort((a, b) => {
    const aExact = a.title.toLowerCase() === q ? 0 : 1;
    const bExact = b.title.toLowerCase() === q ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return typePriority[a.type] - typePriority[b.type];
  });

  return suggestions.slice(0, 20);
}

// ==================== WORD COUNT ====================

export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

// ==================== TEMPLATES ====================

/**
 * Nom AFFICHE d'un modele.
 *
 * Les modeles integres portent deja un libelle traduit (i18n a la
 * construction) ; cette cle-ci permet en plus a un changement de langue en
 * cours de session de se voir sans redemarrer. Un modele fait par
 * l'utilisateur porte le nom QU'IL a choisi : le repli rend exactement
 * `template.name`, donc rien ne bouge pour lui.
 */
export function getTemplateName(template: NoteTemplate): string {
  if (!template.isBuiltIn) return template.name;
  return i18n.t(`notes.templates.${template.id}.name`, { defaultValue: template.name });
}

export function getTemplateDescription(template: NoteTemplate): string {
  if (!template.isBuiltIn) return template.description;
  return i18n.t(`notes.templates.${template.id}.description`, {
    defaultValue: template.description,
  });
}

/**
 * Les modeles integres, CONSTRUITS a l'appel.
 *
 * Ils l'etaient autrefois a l'evaluation du module, en anglais fige : un
 * utilisateur francais se retrouvait avec « Meeting Notes » et « Action
 * Items » dans ses notes. Ils passent desormais tous par i18n, et se servent
 * des blocs que l'editeur sait faire (encadres, colonnes, tableaux, blocs
 * depliables) au lieu d'une suite de titres et de puces.
 */
export function getBuiltInTemplates(): NoteTemplate[] {
  return [...getGeneralTemplates(), ...getProjectTemplates()];
}

/**
 * Apply template variables to content.
 */
export function applyTemplateVariables(
  templateContent: string,
  variables: Record<string, string>
): string {
  let result = templateContent;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Get today's date string in YYYY-MM-DD format.
 */
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}
