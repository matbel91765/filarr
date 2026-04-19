/**
 * Emoji Shortcodes Extension — Filarr Notes
 *
 * Shows a suggestion overlay when typing ":" followed by text.
 * Selecting an emoji inserts the character and removes the shortcode trigger.
 */

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';

export interface EmojiItem {
  shortcode: string;
  emoji: string;
}

export const EMOJI_MAP: Record<string, string> = {
  // Smileys
  smile: '😊', grin: '😁', laugh: '😂', joy: '🤣', wink: '😉',
  blush: '😊', heart_eyes: '😍', kissing: '😘', thinking: '🤔',
  neutral: '😐', unamused: '😒', roll_eyes: '🙄', grimace: '😬',
  cry: '😢', sob: '😭', angry: '😠', rage: '🤬', scream: '😱',
  sweat: '😅', cool: '😎', nerd: '🤓', clown: '🤡', skull: '💀',
  ghost: '👻', alien: '👽', robot: '🤖', poop: '💩', wave: '👋',
  // Gestures
  thumbsup: '👍', thumbsdown: '👎', clap: '👏', pray: '🙏',
  muscle: '💪', ok_hand: '👌', point_up: '☝️', point_down: '👇',
  point_left: '👈', point_right: '👉', raised_hands: '🙌', fist: '✊',
  v: '✌️', crossed_fingers: '🤞', handshake: '🤝',
  // Hearts
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚',
  blue_heart: '💙', purple_heart: '💜', black_heart: '🖤', broken_heart: '💔',
  sparkling_heart: '💖', fire_heart: '❤️‍🔥',
  // Nature
  sun: '☀️', moon: '🌙', star: '⭐', stars: '✨', cloud: '☁️',
  rain: '🌧️', rainbow: '🌈', snowflake: '❄️', fire: '🔥',
  droplet: '💧', wind: '💨', tornado: '🌪️', lightning: '⚡',
  // Animals
  dog: '🐕', cat: '🐈', bear: '🐻', panda: '🐼', fox: '🦊',
  unicorn: '🦄', butterfly: '🦋', bee: '🐝', bug: '🐛',
  // Objects
  rocket: '🚀', airplane: '✈️', car: '🚗', bike: '🚲',
  trophy: '🏆', medal: '🏅', crown: '👑', gem: '💎',
  bulb: '💡', lightbulb: '💡', bomb: '💣', key: '🔑', lock: '🔒',
  bell: '🔔', gift: '🎁', balloon: '🎈', tada: '🎉', confetti: '🎊',
  // Symbols
  check: '✅', x: '❌', warning: '⚠️', question: '❓', exclamation: '❗',
  plus: '➕', minus: '➖', infinity: '♾️', recycle: '♻️',
  // Tech
  computer: '💻', phone: '📱', email: '📧', link: '🔗',
  camera: '📷', video: '📹', microphone: '🎤', headphones: '🎧',
  // Food
  coffee: '☕', pizza: '🍕', burger: '🍔', beer: '🍺', wine: '🍷',
  cake: '🎂', cookie: '🍪', apple: '🍎', avocado: '🥑',
  // Flags & misc
  flag: '🚩', pin: '📌', pencil: '✏️', memo: '📝', book: '📖',
  calendar: '📅', clock: '🕐', hourglass: '⏳', magnifying: '🔍',
  chart: '📈', money: '💰', dollar: '💵', credit_card: '💳',
  // Arrows
  arrow_up: '⬆️', arrow_down: '⬇️', arrow_left: '⬅️', arrow_right: '➡️',
  // Status
  construction: '🚧', progress: '🔄', done: '✅', wip: '🚧',
  idea: '💡', important: '❗', note: '📝', tip: '💡',
};

const ALL_EMOJIS: EmojiItem[] = Object.entries(EMOJI_MAP).map(([shortcode, emoji]) => ({
  shortcode,
  emoji,
}));

export const EmojiSuggestionPluginKey = new PluginKey('emojiSuggestion');

export const EmojiShortcodesExtension = Extension.create({
  name: 'emojiShortcodes',

  addOptions() {
    return {
      suggestion: {
        char: ':',
        pluginKey: EmojiSuggestionPluginKey,
        allowSpaces: false,
        command: ({ editor, range, props }: { editor: any; range: any; props: EmojiItem }) => {
          editor.chain().focus().deleteRange(range).insertContent(props.emoji).run();
        },
        items: ({ query }: { query: string }): EmojiItem[] => {
          if (!query || query.length < 2) return [];
          const q = query.toLowerCase();
          return ALL_EMOJIS.filter((item) => item.shortcode.includes(q)).slice(0, 10);
        },
      } as Partial<SuggestionOptions<EmojiItem>>,
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
