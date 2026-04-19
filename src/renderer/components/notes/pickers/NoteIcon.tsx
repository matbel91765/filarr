/**
 * NoteIcon — render helper
 *
 * A Note's `icon` field supports three encodings (see `types/notes.ts`).
 * This component decodes the prefix and renders accordingly, falling
 * back to plain text if the prefix is unknown.
 *
 *   "📝"                    → unicode emoji
 *   "lucide:Rocket"         → Lucide icon via iconCatalog
 *   "img:data:image/png..." → user-uploaded image (data URL)
 */

import React from 'react';
import { LucideIcon } from '../../../../services/notes/iconCatalog';

interface NoteIconProps {
  icon?: string;
  size?: number;
  className?: string;
}

export const NoteIcon: React.FC<NoteIconProps> = ({ icon, size = 24, className }) => {
  if (!icon) return null;

  if (icon.startsWith('lucide:')) {
    const id = icon.slice('lucide:'.length);
    return (
      <span className={className} style={{ display: 'inline-flex', alignItems: 'center' }}>
        <LucideIcon id={id} size={size} />
      </span>
    );
  }

  if (icon.startsWith('img:')) {
    const dataUrl = icon.slice('img:'.length);
    return (
      <img
        className={className}
        src={dataUrl}
        alt=""
        style={{
          width: size,
          height: size,
          objectFit: 'cover',
          borderRadius: 4,
          display: 'inline-block',
        }}
      />
    );
  }

  // Legacy: raw emoji string
  return (
    <span
      className={className}
      style={{ fontSize: size * 0.85, lineHeight: 1, display: 'inline-block' }}
    >
      {icon}
    </span>
  );
};

export default NoteIcon;
