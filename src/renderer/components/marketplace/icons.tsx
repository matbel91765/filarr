/**
 * Les pictogrammes de la place de marché — dessinés à la main, en `currentColor`.
 *
 * Le produit n'embarque pas de bibliothèque d'icônes (même parti pris que
 * `home/WidgetFrame.tsx`). Chacun est purement décoratif : `aria-hidden`, jamais
 * porteur d'un sens que le texte voisin ne dirait pas. Un état signalé par la
 * seule couleur d'un glyphe serait invisible pour un lecteur d'écran comme pour
 * un daltonien — d'où la règle : le glyphe accompagne toujours un mot.
 */

import React from 'react';

interface GlyphProps {
  className?: string;
}

const base = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Le bouclier : signature vérifiée. */
export const ShieldGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M12 3l7 3v6c0 4.4-3 8.2-7 9-4-.8-7-4.6-7-9V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

/** Le bouclier barré : la confiance est rompue. */
export const ShieldAlertGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M12 3l7 3v6c0 4.4-3 8.2-7 9-4-.8-7-4.6-7-9V6l7-3z" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </svg>
);

/** La coche : c'est en place. */
export const CheckGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
);

/** La flèche descendante : une mise à jour attend. */
export const DownloadGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M12 4v11" />
    <path d="M7 11l5 5 5-5" />
    <path d="M5 20h14" />
  </svg>
);

/** Le triangle : quelque chose demande une décision. */
export const WarnGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M12 4l9 16H3l9-16z" />
    <path d="M12 10v4" />
    <path d="M12 17h.01" />
  </svg>
);

/** Le cercle « i » : une information de contexte. */
export const InfoGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </svg>
);

/** Le nuage barré : hors ligne. */
export const OfflineGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M17.5 18H7a4 4 0 01-.6-7.95" />
    <path d="M9 7.5A5 5 0 0118.9 9a3.5 3.5 0 011.6 6.4" />
    <path d="M3 3l18 18" />
  </svg>
);

/** La boîte : le catalogue, ou son absence. */
export const BoxGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M20 8l-8-4-8 4 8 4 8-4z" />
    <path d="M4 8v8l8 4 8-4V8" />
    <path d="M12 12v8" />
  </svg>
);

/** La loupe : une recherche qui ne rend rien. */
export const SearchGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.3-4.3" />
  </svg>
);

/** La croix : fermer la fiche. */
export const CloseGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);

/** L'interdiction : ce que le bac à sable refuse à une extension. */
export const BlockedGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </svg>
);

/** L'œil : ce qui deviendra public. */
export const EyeGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** Le fichier : le bundle à déposer. */
export const FileGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
    <path d="M14 3v5h5" />
  </svg>
);

/** L'utilisateur : votre propre clé. */
export const UserGlyph: React.FC<GlyphProps> = ({ className }) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20a7.5 7.5 0 0115 0" />
  </svg>
);
