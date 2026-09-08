/**
 * Transclusion Extension — Filarr Notes
 *
 * Custom TipTap Node for `![[note]]` embeds. Supports:
 * - `![[NoteTitle]]`                full note embed
 * - `![[NoteTitle#Section]]`        embed a heading + its content
 * - `![[NoteTitle^blockId]]`        embed a single block by id
 * - `![[NoteTitle|alias]]`          override the displayed header text
 *
 * Rendering goes through {@link TransclusionNodeView}, which subscribes to
 * the target note in Redux so renames + content edits propagate live.
 *
 * Resolution from a title to a note id is done at input-rule time (the user
 * just typed the title), not at render time — once inserted, the node holds
 * a stable `noteId` so subsequent renames don't break the link (the
 * `selectAllNotes` / byId lookup keeps the title display fresh).
 */

import { Node, mergeAttributes, InputRule, PasteRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TransclusionNodeView } from './TransclusionNodeView';
import { transclusionIndexText } from './indexText';

export interface TransclusionAttributes {
  noteId: string;
  noteTitle: string;
  section: string | null;
  blockId: string | null;
  alias: string | null;
  preview: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    transclusion: {
      insertTransclusion: (attrs: Partial<TransclusionAttributes>) => ReturnType;
    };
  }
}

/**
 * Parse `Target[#Section|^blockId][|alias]` into its parts.
 * Mirrors the shape produced by {@link parseWikiLinks} but also splits
 * the section/block fragment from the title.
 */
function parseTarget(raw: string): {
  title: string;
  section: string | null;
  blockId: string | null;
  alias: string | null;
} {
  const [head, alias] = raw.split('|', 2);
  // Block id (`^abc`) wins over section (`#name`); the regex is non-greedy so
  // a `#` inside a block id would never happen anyway (block ids are alnum).
  const blockMatch = head.match(/^(.*?)\^([A-Za-z0-9_-]+)$/);
  if (blockMatch) {
    return {
      title: blockMatch[1].trim(),
      section: null,
      blockId: blockMatch[2],
      alias: alias?.trim() || null,
    };
  }
  const sectionMatch = head.match(/^(.*?)#(.+)$/);
  if (sectionMatch) {
    return {
      title: sectionMatch[1].trim(),
      section: sectionMatch[2].trim(),
      blockId: null,
      alias: alias?.trim() || null,
    };
  }
  return {
    title: head.trim(),
    section: null,
    blockId: null,
    alias: alias?.trim() || null,
  };
}

/**
 * Build the extension. We accept callbacks rather than pulling the store
 * directly so the extension stays decoupled from Redux internals (input
 * rules run inside ProseMirror's tx flow and shouldn't import store).
 */
export interface TransclusionExtensionOptions {
  /**
   * Resolve a (case-insensitive) note title to a `{id, title}` pair, or
   * undefined if no match. Backed by a memoised selector in the editor host
   * so this is O(1) regardless of how many notes the user has.
   */
  resolveByTitle: (title: string) => { id: string; title: string } | undefined;
}

export const TransclusionExtension = Node.create<TransclusionExtensionOptions>({
  name: 'transclusion',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      resolveByTitle: () => undefined,
    };
  },

  addAttributes() {
    return {
      noteId: { default: '' },
      noteTitle: { default: '' },
      section: { default: null },
      blockId: { default: null },
      alias: { default: null },
      preview: { default: '' },
    };
  },

  /**
   * Nœud atomique : la référence (titre visé, alias, ancre) doit rester
   * trouvable par la recherche locale. L'APERÇU n'y va pas — voir
   * `transclusionIndexText`.
   */
  renderText({ node }) {
    return transclusionIndexText(node.attrs);
  },

  parseHTML() {
    return [{ tag: 'div[data-transclusion]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Static fallback shown by `generateHTML` (used when this node is rendered
    // inside another transclusion, or when exporting). The NodeView replaces
    // this in the live editor.
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-transclusion': '', class: 'transclusion' }),
      [
        'div',
        { class: 'transclusion__header' },
        [
          'span',
          { class: 'transclusion__title' },
          HTMLAttributes.alias || HTMLAttributes.noteTitle || 'Untitled',
        ],
      ],
      ['div', { class: 'transclusion__content transclusion__content--nested' }, '…'],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TransclusionNodeView as never);
  },

  addCommands() {
    return {
      insertTransclusion:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              noteId: attrs.noteId ?? '',
              noteTitle: attrs.noteTitle ?? '',
              section: attrs.section ?? null,
              blockId: attrs.blockId ?? null,
              alias: attrs.alias ?? null,
              preview: attrs.preview ?? '',
            },
          });
        },
    };
  },

  /**
   * InputRule: typing `![[NoteTitle]]` (or with `#Section` / `^blockId` /
   * `|alias`) followed by the closing `]]` rewrites the typed text into a
   * transclusion node. Resolution from title → noteId happens here so the
   * node stays bound to a stable id even if the user later renames the note.
   */
  addInputRules() {
    const nodeType = this.type;
    const resolveByTitle = () => this.options.resolveByTitle;
    return [
      new InputRule({
        find: /!\[\[([^\]\n]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const tr = buildTransclusionTr(state, range, match[1], resolveByTitle(), nodeType);
          if (!tr) return;
        },
      }),
    ];
  },

  /**
   * PasteRule: same conversion when the `![[…]]` markup is pasted (e.g. the
   * user copied a block link via right-click). InputRules don't fire on
   * paste in TipTap, so without this the pasted text stays inert.
   */
  addPasteRules() {
    const nodeType = this.type;
    const resolveByTitle = () => this.options.resolveByTitle;
    return [
      new PasteRule({
        find: /!\[\[([^\]\n]+)\]\]/g,
        handler: ({ state, range, match }) => {
          buildTransclusionTr(state, range, match[1], resolveByTitle(), nodeType);
        },
      }),
    ];
  },
});

/**
 * Shared rewriting logic between `addInputRules` and `addPasteRules`. Parses
 * the captured target, resolves the title, and mutates the supplied
 * transaction in-place. Returns `false` when no match was found (caller can
 * decide whether to leave the typed text alone).
 */
function buildTransclusionTr(
  state: import('@tiptap/pm/state').EditorState,
  range: { from: number; to: number },
  raw: string,
  resolver: TransclusionExtensionOptions['resolveByTitle'],
  nodeType: import('@tiptap/pm/model').NodeType
): boolean {
  const { title, section, blockId, alias } = parseTarget(raw);
  const target = resolver(title);
  if (!target) return false;
  const tr = state.tr;
  tr.replaceWith(
    range.from,
    range.to,
    nodeType.create({
      noteId: target.id,
      noteTitle: target.title,
      section,
      blockId,
      alias,
      preview: '',
    })
  );
  return true;
}
