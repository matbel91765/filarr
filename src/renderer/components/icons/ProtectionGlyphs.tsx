/**
 * ProtectionGlyphs — hand-authored 24px action icons for the tray menu,
 * mini-mode and desktop-protection settings (Wave 1).
 *
 * They follow the app's existing inline-SVG convention (heroicons-style:
 * viewBox 0 0 24 24, stroke currentColor, strokeWidth 1.5, round caps/joins)
 * with the Filarr brand signature layered on: small filled dots at free stroke
 * terminals and keyholes, mirroring the r=44 joint dots of public/logo.svg.
 * Because they draw with currentColor they theme automatically (dark,
 * terracotta, and every other data-theme).
 *
 * All geometry is explicit and hand-placed — no generated artwork.
 */
import React from 'react';

interface GlyphProps {
  size?: number | string;
  className?: string;
  strokeWidth?: number;
}

const svgProps = (size: number | string, className: string, strokeWidth: number) =>
  ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    xmlns: 'http://www.w3.org/2000/svg',
    className,
    'aria-hidden': true,
  }) as const;

/** Protéger — shield with a plus (bring a file under protection). */
export const ShieldPlusIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M12 3.25C14.4 4.6 16.9 5.4 19.25 5.7V11.1C19.25 15.8 16.3 18.7 12 20.3C7.7 18.7 4.75 15.8 4.75 11.1V5.7C7.1 5.4 9.6 4.6 12 3.25Z" />
    <path d="M12 8.9V13.7" />
    <path d="M9.6 11.3H14.4" />
  </svg>
);

/** Verrouiller — closed padlock, brand keyhole dot. */
export const VaultLockIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M8.5 10.75V7.5A3.5 3.5 0 0 1 15.5 7.5V10.75" />
    <rect x="5" y="10.75" width="14" height="8.5" rx="2.25" />
    <circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

/** Déverrouiller — open padlock, dot on the shackle's free terminal. */
export const VaultUnlockIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M8.5 10.75V7.25A3.5 3.5 0 0 1 15.5 7.25" />
    <rect x="5" y="10.75" width="14" height="8.5" rx="2.25" />
    <circle cx="15.5" cy="7.25" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

/** Tout verrouiller — padlock inside a near-complete circle, dotted terminals. */
export const LockAllIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M15.49 4.52A8.25 8.25 0 1 1 8.51 4.52" />
    <circle cx="15.49" cy="4.52" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="8.51" cy="4.52" r="1.1" fill="currentColor" stroke="none" />
    <path d="M10.2 11.2V9.9A1.8 1.8 0 0 1 13.8 9.9V11.2" />
    <rect x="8.6" y="11.2" width="6.8" height="5.2" rx="1.5" />
    <circle cx="12" cy="13.8" r="0.95" fill="currentColor" stroke="none" />
  </svg>
);

/** Purger les fichiers temporaires — bin with residue dots being emptied. */
export const PurgeTempIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M5 6.4H19" />
    <path d="M9.5 6.4V5.2A1.3 1.3 0 0 1 10.8 3.9H13.2A1.3 1.3 0 0 1 14.5 5.2V6.4" />
    <path d="M6.9 6.4L7.65 18.7A2 2 0 0 0 9.65 20.6H14.35A2 2 0 0 0 16.35 18.7L17.1 6.4" />
    <circle cx="10.1" cy="11.4" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="13.9" cy="11.4" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="12" cy="15" r="1.05" fill="currentColor" stroke="none" />
  </svg>
);

/** Récents — history clock, counterclockwise arrow, brand dot at the pivot. */
export const RecentItemsIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M8.375 5.72A7.25 7.25 0 1 1 5.72 8.375" />
    <path d="M7.97 7.08L5.72 8.375L5.72 5.78" />
    <path d="M12 8.6V12L14.6 13.55" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

/** Ouvrir — arrow leaving the frame, brand dot at the arrow's tail. */
export const OpenExternalIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M10.5 5.25H7A2.25 2.25 0 0 0 4.75 7.5V17A2.25 2.25 0 0 0 7 19.25H16.5A2.25 2.25 0 0 0 18.75 17V13.5" />
    <path d="M13.75 4.75H19.25V10.25" />
    <path d="M19.25 4.75L12.6 11.4" />
    <circle cx="12.6" cy="11.4" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

// ─── Wave 2 « Protéger sur place » — conteneurs .filarr ──────────────────────
// Même vocabulaire : trou de serrure = point de marque plein + tige courte.

/** Conteneur .filarr FICHIER — feuille de document au trou de serrure. */
export const BoxFileIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M13.5 3.25H7.25A2 2 0 0 0 5.25 5.25V18.75A2 2 0 0 0 7.25 20.75H16.75A2 2 0 0 0 18.75 18.75V8.5Z" />
    <path d="M13.5 3.25V8.5H18.75" />
    <circle cx="12" cy="13.4" r="1.5" fill="currentColor" stroke="none" />
    <path d="M12 13.4V16.1" />
  </svg>
);

/** Conteneur .filarr DOSSIER — dossier au trou de serrure (mini-coffre). */
export const BoxFolderIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M3.75 6.75A2 2 0 0 1 5.75 4.75H9.4L11.4 6.9H18.25A2 2 0 0 1 20.25 8.9V17.25A2 2 0 0 1 18.25 19.25H5.75A2 2 0 0 1 3.75 17.25Z" />
    <circle cx="12" cy="11.9" r="1.5" fill="currentColor" stroke="none" />
    <path d="M12 11.9V14.6" />
  </svg>
);

/** Protéger sur place — bouclier ancré au sol, points aux extrémités du sol. */
export const ProtectInPlaceIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M12 2.9C14.2 4.1 16.4 4.8 18.5 5.1V9.9C18.5 14.1 15.9 16.7 12 18.15C8.1 16.7 5.5 14.1 5.5 9.9V5.1C7.6 4.8 9.8 4.1 12 2.9Z" />
    <circle cx="12" cy="9.4" r="1.5" fill="currentColor" stroke="none" />
    <path d="M12 9.4V11.9" />
    <path d="M4.75 21.25H19.25" />
    <circle cx="4.75" cy="21.25" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="19.25" cy="21.25" r="1.05" fill="currentColor" stroke="none" />
  </svg>
);

/** Extraire — flèche sortant du bac du conteneur, point à la naissance. */
export const ExtractIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M4.75 14.5V17A2.25 2.25 0 0 0 7 19.25H17A2.25 2.25 0 0 0 19.25 17V14.5" />
    <path d="M12 14.25V5.5" />
    <path d="M8.75 8.75L12 5.5L15.25 8.75" />
    <circle cx="12" cy="14.25" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

/** Afficher dans l'explorateur — dossier fouillé à la loupe, point au manche. */
export const RevealLocationIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M20.25 10.4V8.65A2 2 0 0 0 18.25 6.65H11.3L9.3 4.5H5.75A2 2 0 0 0 3.75 6.5V16.75A2 2 0 0 0 5.75 18.75H9.6" />
    <circle cx="14.9" cy="14.9" r="3.4" />
    <path d="M17.35 17.35L19.7 19.7" />
    <circle cx="19.7" cy="19.7" r="1.15" fill="currentColor" stroke="none" />
  </svg>
);

/** Localiser un conteneur déplacé — loupe seule, point au bout du manche. */
export const LocateIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <circle cx="11" cy="11" r="6.25" />
    <path d="M15.6 15.6L19.7 19.7" />
    <circle cx="19.7" cy="19.7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="11" cy="11" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

/** Retirer de la liste — liste au point de marque + moins cerclé. */
export const ForgetItemIcon: React.FC<GlyphProps> = ({
  size = 20,
  className = '',
  strokeWidth = 1.5,
}) => (
  <svg {...svgProps(size, className, strokeWidth)}>
    <path d="M4.75 6.25H19.25" />
    <path d="M4.75 11.5H11.4" />
    <circle cx="11.4" cy="11.5" r="1.05" fill="currentColor" stroke="none" />
    <path d="M4.75 16.75H9.5" />
    <circle cx="16.6" cy="16.35" r="3.9" />
    <path d="M14.6 16.35H18.6" />
  </svg>
);
