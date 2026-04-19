/**
 * EmojiSuggestionMenu — Filarr Notes
 *
 * Suggestion popup for emoji shortcode insertion (:rocket:, :fire:, etc.).
 */

import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { EmojiItem } from './extensions/emojiShortcodesExtension';

interface EmojiSuggestionMenuProps {
  items: EmojiItem[];
  command: (item: EmojiItem) => void;
}

export interface EmojiSuggestionMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const EmojiSuggestionMenu = forwardRef<EmojiSuggestionMenuRef, EmojiSuggestionMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1));
          return true;
        }
        if (event.key === 'Enter') {
          if (items[selectedIndex]) {
            command(items[selectedIndex]);
          }
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    return (
      <div className="suggestion-menu suggestion-menu--emojis">
        {items.map((item, index) => (
          <button
            key={item.shortcode}
            className={`suggestion-menu__item ${index === selectedIndex ? 'is-selected' : ''}`}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="suggestion-menu__emoji">{item.emoji}</span>
            <span className="suggestion-menu__label">:{item.shortcode}:</span>
          </button>
        ))}
      </div>
    );
  }
);

EmojiSuggestionMenu.displayName = 'EmojiSuggestionMenu';

export default EmojiSuggestionMenu;
