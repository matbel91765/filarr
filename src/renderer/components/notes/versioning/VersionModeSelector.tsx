/**
 * VersionModeSelector
 *
 * Small pill-style switcher that lets the user flip between the
 * three (soon four) version-history UI modes without leaving the
 * view. Designed to sit in the header of each mode.
 *
 * The current mode is persisted in localStorage by the parent hub
 * so the user's preference sticks across sessions.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { VersionHistoryMode } from './useVersionHistoryMode';

interface VersionModeSelectorProps {
  mode: VersionHistoryMode;
  onChange: (mode: VersionHistoryMode) => void;
}

const MODES: Array<{ id: VersionHistoryMode; labelKey: string; defaultLabel: string }> = [
  { id: 'sidebar', labelKey: 'notes.versionModes.sidebar', defaultLabel: 'Liste' },
  { id: 'scrapbook', labelKey: 'notes.versionModes.scrapbook', defaultLabel: 'Scrapbook' },
  { id: 'scrubber', labelKey: 'notes.versionModes.scrubber', defaultLabel: 'Timeline' },
  // 'palette' reserved for the command-palette mode (Option 5).
];

export const VersionModeSelector: React.FC<VersionModeSelectorProps> = ({ mode, onChange }) => {
  const { t } = useTranslation();

  return (
    <div
      className="version-mode-selector"
      role="radiogroup"
      aria-label={t('notes.versionModes.ariaLabel', 'Style d’historique')}
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={mode === m.id}
          className={`version-mode-selector__option ${
            mode === m.id ? 'version-mode-selector__option--active' : ''
          }`}
          onClick={() => onChange(m.id)}
        >
          {t(m.labelKey, m.defaultLabel)}
        </button>
      ))}
    </div>
  );
};

export default VersionModeSelector;
