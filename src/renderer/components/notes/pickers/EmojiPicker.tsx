/**
 * EmojiPicker
 *
 * Grid picker with sticky category navigation and fuzzy keyword search.
 * Recently-used emojis are persisted in localStorage and shown first so
 * the common choices are always one click away.
 *
 * Controlled component: parent owns the `selected` value and receives
 * changes via `onSelect`. No visibility state — the popover that hosts
 * it is responsible for open/close.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EMOJI_CATEGORIES,
  searchEmojis,
  type EmojiEntry,
} from '../../../../services/notes/emojiCatalog';
// The picker-panel styles live in IconSelector.css. Import them here so the
// EmojiPicker is styled wherever it is used standalone (e.g. FolderStyleModal),
// not only inside IconSelector/CoverSelector.
import './IconSelector.css';

import * as profileStorage from '../../../../services/core/profileStorage';
const RECENTS_KEY = 'filarr.emoji.recents';
const MAX_RECENTS = 18;

interface EmojiPickerProps {
  selected?: string;
  onSelect: (emoji: string) => void;
  /** Optional: called when the Remove action is clicked. */
  onRemove?: () => void;
}

function readRecents(): string[] {
  try {
    const raw = profileStorage.getItemWithLegacyFallback(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function pushRecent(emoji: string): void {
  try {
    const current = readRecents();
    const next = [emoji, ...current.filter((e) => e !== emoji)].slice(0, MAX_RECENTS);
    profileStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota exceeded or unavailable — silently ignore */
  }
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ selected, onSelect, onRemove }) => {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>(readRecents);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Autofocus the search — users usually know what they want.
    searchRef.current?.focus();
  }, []);

  const results = useMemo(() => (query ? searchEmojis(query) : []), [query]);

  const handlePick = (emoji: string) => {
    pushRecent(emoji);
    setRecents(readRecents());
    onSelect(emoji);
  };

  const isFr = i18n.language?.startsWith('fr');

  return (
    <div className="picker-panel picker-panel--emoji">
      <div className="picker-panel__search-row">
        <input
          ref={searchRef}
          type="text"
          className="picker-panel__search"
          placeholder={t('notes.pickers.searchEmoji', 'Rechercher un emoji…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {selected && onRemove && (
          <button type="button" className="picker-panel__remove" onClick={onRemove}>
            {t('notes.removeIcon', 'Retirer')}
          </button>
        )}
      </div>

      <div className="picker-panel__body">
        {query.trim().length >= 2 ? (
          results.length === 0 ? (
            <div className="picker-panel__empty">
              {t('notes.pickers.noResults', 'Aucun résultat')}
            </div>
          ) : (
            <EmojiGrid entries={results} selected={selected} onPick={handlePick} />
          )
        ) : (
          <>
            {recents.length > 0 && (
              <section className="picker-panel__group">
                <h3 className="picker-panel__group-title">
                  {t('notes.pickers.recent', 'Récents')}
                </h3>
                <EmojiGrid
                  entries={recents.map((char) => ({ char, keywords: [] }))}
                  selected={selected}
                  onPick={handlePick}
                />
              </section>
            )}
            {EMOJI_CATEGORIES.map((cat) => (
              <section key={cat.id} className="picker-panel__group">
                <h3 className="picker-panel__group-title">{isFr ? cat.labelFr : cat.labelEn}</h3>
                <EmojiGrid entries={cat.emojis} selected={selected} onPick={handlePick} />
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

// ── Grid ────────────────────────────────────────────────────────────────────

const EmojiGrid: React.FC<{
  entries: EmojiEntry[];
  selected?: string;
  onPick: (emoji: string) => void;
}> = ({ entries, selected, onPick }) => {
  return (
    <div className="picker-panel__grid picker-panel__grid--emoji">
      {entries.map((e, i) => (
        <button
          key={`${e.char}-${i}`}
          type="button"
          className={`picker-panel__cell ${
            selected === e.char ? 'picker-panel__cell--active' : ''
          }`}
          onClick={() => onPick(e.char)}
          title={e.keywords[0]}
        >
          {e.char}
        </button>
      ))}
    </div>
  );
};

export default EmojiPicker;
