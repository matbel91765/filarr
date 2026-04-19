/**
 * VersionHistoryHub
 *
 * Routes the "show version history" intent to one of several UI modes
 * based on the user's persisted preference. Each mode is a standalone
 * component with the same props contract; the hub just chooses which
 * one to mount.
 *
 * Why a hub instead of putting the switch in NoteEditor:
 *   - Keeps NoteEditor.tsx thin — it only cares that "history is open",
 *     not which style is showing.
 *   - Lets us add/remove modes (e.g. the future command-palette mode)
 *     without editing the editor.
 *   - Allows each mode to render at different depths in the DOM
 *     (inline sidebar vs fullscreen portal) transparently.
 */

import React from 'react';
import { NoteVersionHistory } from '../NoteVersionHistory';
import { VersionScrapbook } from './VersionScrapbook';
import { VersionScrubber } from './VersionScrubber';
import { useVersionHistoryMode, type VersionHistoryMode } from './useVersionHistoryMode';

interface VersionHistoryHubProps {
  noteId: string;
  currentContent: string;
  currentPlainText: string;
  onClose: () => void;
}

export const VersionHistoryHub: React.FC<VersionHistoryHubProps> = (props) => {
  const [mode, setMode] = useVersionHistoryMode();
  const commonProps = { ...props, mode, onModeChange: setMode as (m: VersionHistoryMode) => void };

  switch (mode) {
    case 'scrapbook':
      return <VersionScrapbook {...commonProps} />;
    case 'scrubber':
      return <VersionScrubber {...commonProps} />;
    case 'palette':
      // Reserved for Option 5 — fall through to sidebar until implemented.
      return <NoteVersionHistory {...commonProps} />;
    case 'sidebar':
    default:
      return <NoteVersionHistory {...commonProps} />;
  }
};

export default VersionHistoryHub;
