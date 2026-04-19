/**
 * Calendar Block Extension — Filarr Notes
 *
 * Inline interactive calendar widget embedded in note content.
 * Notion-style: click a date cell to add events inline.
 * Events are stored as JSON in the node attrs.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CalendarBlockNodeView } from './CalendarBlockNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    calendarBlock: {
      insertCalendarBlock: () => ReturnType;
    };
  }
}

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  text: string;
  color: string;
}

export const CalendarBlockExtension = Node.create({
  name: 'calendarBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      title: { default: '' },
      view: { default: 'month' as 'month' | 'week' },
      startDay: { default: 1 }, // 0=Sun, 1=Mon
      year: { default: new Date().getFullYear() },
      month: { default: new Date().getMonth() }, // 0-indexed
      events: { default: '[]' }, // JSON array of CalendarEvent
      showNotes: { default: true },
      cellHeight: { default: 120 }, // resizable cell height in px
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-calendar-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-calendar-block': '',
        class: 'calendar-block',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalendarBlockNodeView as any);
  },

  addCommands() {
    return {
      insertCalendarBlock:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              year: new Date().getFullYear(),
              month: new Date().getMonth(),
            },
          });
        },
    };
  },
});
