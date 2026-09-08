import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MentionCandidate } from './extensions/mentionSuggestionExtension';

interface MentionSuggestionMenuProps {
  items: MentionCandidate[];
  command: (item: MentionCandidate) => void;
}

export interface MentionSuggestionMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

/** Même mécanique que le menu des emojis : flèches, Entrée, survol. */
const MentionSuggestionMenu = forwardRef<MentionSuggestionMenuRef, MentionSuggestionMenuProps>(
  ({ items, command }, ref) => {
    const { t } = useTranslation();
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1));
          return true;
        }
        if (event.key === 'Enter') {
          if (items[selectedIndex]) command(items[selectedIndex]);
          return true;
        }
        return false;
      },
    }));

    // Personne à proposer : rien à l’écran, et les touches restent à l’éditeur.
    if (items.length === 0) return null;

    return (
      <div className="suggestion-menu suggestion-menu--people" role="listbox">
        <div className="suggestion-menu__heading">{t('notes.mentionPeople', 'Personnes')}</div>
        {items.map((item, index) => (
          <button
            key={item.userId}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            className={`suggestion-menu__item ${index === selectedIndex ? 'is-selected' : ''}`}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="suggestion-menu__avatar" aria-hidden="true">
              {item.label.slice(0, 1).toUpperCase()}
            </span>
            <span className="suggestion-menu__label">@{item.label}</span>
            {item.secondary && <span className="suggestion-menu__secondary">{item.secondary}</span>}
          </button>
        ))}
      </div>
    );
  }
);

MentionSuggestionMenu.displayName = 'MentionSuggestionMenu';
export default MentionSuggestionMenu;
