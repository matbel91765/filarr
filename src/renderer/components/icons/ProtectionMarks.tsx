/**
 * ProtectionMarks — hand-authored brand-scale marks (512 grid) for the desktop
 * protection surface (Wave 1): lock / unlocked / shield.
 *
 * Visual grammar is inherited from public/logo.svg (the F glyph): 24px strokes,
 * round caps and joins, filled r=44 dots at stroke joints and free terminals,
 * brand blue #52A1ED. Every coordinate is explicit and hand-placed; the ink of
 * each mark is optically centered in the 512 viewBox (lock body 116..396 on x,
 * shackle semicircle r=80, ink spans y 64..448).
 *
 * SVG masters (same geometry) live in buildResources/icon-sources/*.svg and feed the
 * tray / file-type rasters via buildResources/icon-sources/generate-rasters.cjs.
 */
import React from 'react';

interface MarkProps {
  size?: number | string;
  className?: string;
  /** Defaults to the theme accent so the mark follows dark/terracotta themes. */
  color?: string;
}

/** Closed padlock in the Filarr dot-and-stroke vocabulary ("coffre verrouillé"). */
export const FilarrLockMark: React.FC<MarkProps> = ({
  size = 48,
  className = '',
  color = 'var(--color-primary-500, #52A1ED)',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M176 226V156A80 80 0 0 1 336 156V226"
      stroke={color}
      strokeWidth="24"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect
      x="116"
      y="226"
      width="280"
      height="210"
      rx="48"
      stroke={color}
      strokeWidth="24"
      strokeLinejoin="round"
    />
    <circle cx="176" cy="226" r="44" fill={color} />
    <circle cx="336" cy="226" r="44" fill={color} />
    <circle cx="256" cy="308" r="44" fill={color} />
    <path d="M256 308V368" stroke={color} strokeWidth="24" strokeLinecap="round" />
  </svg>
);

/** Open padlock — the shackle's free terminal carries a brand dot ("coffre déverrouillé"). */
export const FilarrUnlockedMark: React.FC<MarkProps> = ({
  size = 48,
  className = '',
  color = 'var(--color-primary-500, #52A1ED)',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M176 226V156A80 80 0 0 1 336 156"
      stroke={color}
      strokeWidth="24"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect
      x="116"
      y="226"
      width="280"
      height="210"
      rx="48"
      stroke={color}
      strokeWidth="24"
      strokeLinejoin="round"
    />
    <circle cx="176" cy="226" r="44" fill={color} />
    <circle cx="336" cy="156" r="44" fill={color} />
    <circle cx="256" cy="308" r="44" fill={color} />
    <path d="M256 308V368" stroke={color} strokeWidth="24" strokeLinecap="round" />
  </svg>
);

/** Shield containing the simplified dot-and-stroke F (protection + identity). */
export const FilarrShieldMark: React.FC<MarkProps> = ({
  size = 48,
  className = '',
  color = 'var(--color-primary-500, #52A1ED)',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M256 60C306 92 362 110 414 116V262C414 364 336 422 256 452C176 422 98 364 98 262V116C150 110 206 92 256 60Z"
      stroke={color}
      strokeWidth="24"
      strokeLinejoin="round"
    />
    <circle cx="206" cy="180" r="28" fill={color} />
    <circle cx="330" cy="180" r="28" fill={color} />
    <circle cx="206" cy="262" r="28" fill={color} />
    <circle cx="306" cy="262" r="28" fill={color} />
    <circle cx="206" cy="338" r="28" fill={color} />
    <path d="M206 180V338" stroke={color} strokeWidth="24" strokeLinecap="round" />
    <path d="M206 180H330" stroke={color} strokeWidth="24" strokeLinecap="round" />
    <path d="M206 262H306" stroke={color} strokeWidth="24" strokeLinecap="round" />
  </svg>
);
