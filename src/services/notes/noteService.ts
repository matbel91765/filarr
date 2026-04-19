/**
 * Note Service — Filarr Notes
 *
 * CRUD operations, search indexing, and link resolution for notes.
 * Notes are stored in Redux (persisted via redux-persist) following
 * the same local-first pattern as files/folders.
 */

import type { Note, NoteTemplate, Backlink, LinkSuggestion, WikiLinkType } from '../../types/notes';
import { extractNoteLinks, extractFileLinks, extractFolderLinks } from './noteLinkParser';

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

  const noteIndex = new Map<string, string>();
  Object.values(notesById).forEach((n) => noteIndex.set(n.title.toLowerCase(), n.id));

  const fileIndex = new Map<string, string>();
  Object.values(filesById).forEach((f) => fileIndex.set(f.name.toLowerCase(), f.id));

  const folderIndex = new Map<string, string>();
  Object.values(foldersById).forEach((f) => folderIndex.set(f.name.toLowerCase(), f.id));

  return {
    linkedNoteIds: [...new Set(noteNames.map((n) => noteIndex.get(n.toLowerCase())).filter(Boolean))] as string[],
    linkedFileIds: [...new Set(fileNames.map((n) => fileIndex.get(n.toLowerCase())).filter(Boolean))] as string[],
    linkedFolderIds: [...new Set(folderNames.map((n) => folderIndex.get(n.toLowerCase())).filter(Boolean))] as string[],
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
      const context = idx >= 0
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

/** Helper: create a paragraph with text */
const p = (text: string) => text
  ? { type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }
  : { type: 'paragraph' as const };

/** Helper: create a heading */
const h = (level: number, text: string) => ({
  type: 'heading' as const, attrs: { level }, content: [{ type: 'text' as const, text }],
});

/** Helper: create a bold + normal text paragraph */
const boldP = (bold: string, text: string) => ({
  type: 'paragraph' as const,
  content: [
    { type: 'text' as const, marks: [{ type: 'bold' as const }], text: bold },
    { type: 'text' as const, text },
  ],
});

/** Helper: create a bullet list with items */
const bullets = (...items: string[]) => ({
  type: 'bulletList' as const,
  content: items.map((t) => ({
    type: 'listItem' as const,
    content: [p(t)],
  })),
});

/** Helper: create a task list with items */
const tasks = (...items: string[]) => ({
  type: 'taskList' as const,
  content: items.map((t) => ({
    type: 'taskItem' as const,
    attrs: { checked: false },
    content: [p(t)],
  })),
});

const doc = (...content: any[]) => JSON.stringify({ type: 'doc', content });

const BUILT_IN_TEMPLATES: NoteTemplate[] = [
  {
    id: 'tpl-meeting',
    name: 'Meeting Notes',
    description: 'Template for meeting notes with agenda and action items',
    icon: '\uD83E\uDD1D', // 🤝
    content: doc(
      h(1, '{{title}}'),
      boldP('Date: ', '{{date}}'),
      h(2, 'Participants'),
      bullets('Participant 1', 'Participant 2'),
      h(2, 'Agenda'),
      bullets('Topic 1', 'Topic 2'),
      h(2, 'Notes'),
      p(''),
      h(2, 'Action Items'),
      tasks('Action item 1', 'Action item 2'),
    ),
    variables: [
      { name: 'title', label: 'Meeting Title', type: 'text', defaultValue: 'Meeting' },
      { name: 'date', label: 'Date', type: 'date' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-project',
    name: 'Project Brief',
    description: 'Template for project planning and documentation',
    icon: '\uD83D\uDCCB', // 📋
    content: doc(
      h(1, '{{title}}'),
      h(2, 'Objective'),
      p('Describe the project goal here.'),
      h(2, 'Key Results'),
      tasks('Key result 1', 'Key result 2', 'Key result 3'),
      h(2, 'Resources'),
      bullets('Resource 1'),
      h(2, 'Timeline'),
      p('Start: TBD | End: TBD'),
    ),
    variables: [
      { name: 'title', label: 'Project Name', type: 'text', defaultValue: 'New Project' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-review',
    name: 'File Review',
    description: 'Template for reviewing and annotating a document',
    icon: '\uD83D\uDD0D', // 🔍
    content: doc(
      h(1, 'Review: {{title}}'),
      boldP('Document: ', '{{title}}'),
      boldP('Date: ', '{{date}}'),
      h(2, 'Summary'),
      p('Brief overview of the document.'),
      h(2, 'Key Points'),
      bullets('Point 1', 'Point 2'),
      h(2, 'Questions / Concerns'),
      bullets('Question 1'),
      h(2, 'Action Items'),
      tasks('Follow-up item 1'),
    ),
    variables: [
      { name: 'title', label: 'Document Name', type: 'text' },
      { name: 'date', label: 'Date', type: 'date' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-decision',
    name: 'Decision Log',
    description: 'Record and track important decisions',
    icon: '\u2696\uFE0F', // ⚖️
    content: doc(
      h(1, 'Decision: {{title}}'),
      boldP('Date: ', '{{date}}'),
      boldP('Status: ', 'Pending'),
      h(2, 'Context'),
      p('What situation or problem prompted this decision?'),
      h(2, 'Options Considered'),
      bullets('Option A: ...', 'Option B: ...', 'Option C: ...'),
      h(2, 'Decision'),
      p('Which option was chosen and why.'),
      h(2, 'Consequences'),
      bullets('Expected outcome 1', 'Expected outcome 2'),
      h(2, 'Follow-up'),
      tasks('Implement decision', 'Communicate to stakeholders', 'Review in 2 weeks'),
    ),
    variables: [
      { name: 'title', label: 'Decision Title', type: 'text', defaultValue: 'Decision' },
      { name: 'date', label: 'Date', type: 'date' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-weekly',
    name: 'Weekly Review',
    description: 'End-of-week reflection and planning',
    icon: '\uD83D\uDCC6', // 📆
    content: doc(
      h(1, 'Week of {{date}}'),
      h(2, 'Accomplishments'),
      tasks('Completed item 1', 'Completed item 2'),
      h(2, 'Challenges'),
      bullets('Challenge 1'),
      h(2, 'Lessons Learned'),
      p('What went well? What could improve?'),
      h(2, 'Next Week Goals'),
      tasks('Goal 1', 'Goal 2', 'Goal 3'),
      h(2, 'Notes'),
      p(''),
    ),
    variables: [
      { name: 'date', label: 'Week Start', type: 'date' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-brainstorm',
    name: 'Brainstorm',
    description: 'Capture and organize ideas freely',
    icon: '\uD83D\uDCA1', // 💡
    content: doc(
      h(1, '{{title}}'),
      boldP('Date: ', '{{date}}'),
      h(2, 'Problem / Topic'),
      p('What are we brainstorming about?'),
      h(2, 'Ideas'),
      bullets('Idea 1', 'Idea 2', 'Idea 3'),
      h(2, 'Promising Ideas'),
      tasks('Explore idea X further', 'Prototype idea Y'),
      h(2, 'Next Steps'),
      p(''),
    ),
    variables: [
      { name: 'title', label: 'Topic', type: 'text', defaultValue: 'Brainstorm' },
      { name: 'date', label: 'Date', type: 'date' },
    ],
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

export function getBuiltInTemplates(): NoteTemplate[] {
  return BUILT_IN_TEMPLATES;
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
