/**
 * Slash Command Extension — Filarr Notes
 *
 * TipTap extension that triggers a command palette when "/" is typed.
 * Uses @tiptap/suggestion for positioning and keyboard handling.
 */

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { SLASH_COMMANDS } from './SlashCommandMenu';
import type { SlashCommandItem } from './SlashCommandMenu';

export const SlashCommandPluginKey = new PluginKey('slashCommand');

export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        pluginKey: SlashCommandPluginKey,
        command: ({ editor, range, props }: { editor: any; range: any; props: SlashCommandItem }) => {
          // Delete the "/" trigger and any query text
          editor.chain().focus().deleteRange(range).run();
          // Execute the command
          props.action(editor);
        },
        items: ({ query }: { query: string }): SlashCommandItem[] => {
          if (!query) return SLASH_COMMANDS;
          const q = query.toLowerCase();
          return SLASH_COMMANDS.filter(
            (item) =>
              item.label.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q) ||
              item.aliases?.some((a) => a.includes(q))
          );
        },
      } as Partial<SuggestionOptions<SlashCommandItem>>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
