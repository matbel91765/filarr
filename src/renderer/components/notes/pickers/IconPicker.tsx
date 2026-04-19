/**
 * IconPicker
 *
 * Lucide icon grid with category sections and keyword search. Mirrors
 * the structure of EmojiPicker so the hybrid parent can swap tabs with
 * the same feel.
 *
 * Selected value encoding: the raw id (e.g. `"Rocket"`). The parent is
 * responsible for prefixing with `lucide:` before persisting on a note.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ICON_CATEGORIES,
  searchIcons,
  type IconEntry,
} from '../../../../services/notes/iconCatalog';

interface IconPickerProps {
  /** Raw id (e.g. "Rocket") of the currently selected icon. */
  selected?: string;
  onSelect: (iconId: string) => void;
  onRemove?: () => void;
}

export const IconPicker: React.FC<IconPickerProps> = ({ selected, onSelect, onRemove }) => {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const results = useMemo(() => (query ? searchIcons(query) : []), [query]);
  const isFr = i18n.language?.startsWith('fr');

  return (
    <div className="picker-panel picker-panel--icon">
      <div className="picker-panel__search-row">
        <input
          ref={searchRef}
          type="text"
          className="picker-panel__search"
          placeholder={t('notes.pickers.searchIcon', 'Rechercher une icône…')}
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
            <IconGrid entries={results} selected={selected} onPick={onSelect} />
          )
        ) : (
          ICON_CATEGORIES.map((cat) => (
            <section key={cat.id} className="picker-panel__group">
              <h3 className="picker-panel__group-title">{isFr ? cat.labelFr : cat.labelEn}</h3>
              <IconGrid entries={cat.icons} selected={selected} onPick={onSelect} />
            </section>
          ))
        )}
      </div>
    </div>
  );
};

const IconGrid: React.FC<{
  entries: IconEntry[];
  selected?: string;
  onPick: (id: string) => void;
}> = ({ entries, selected, onPick }) => {
  return (
    <div className="picker-panel__grid picker-panel__grid--icon">
      {entries.map((e) => {
        const Cmp = e.Component;
        return (
          <button
            key={e.id}
            type="button"
            className={`picker-panel__cell picker-panel__cell--icon ${
              selected === e.id ? 'picker-panel__cell--active' : ''
            }`}
            onClick={() => onPick(e.id)}
            title={e.id}
          >
            <Cmp size={20} strokeWidth={1.8} />
          </button>
        );
      })}
    </div>
  );
};

export default IconPicker;
