/**
 * Icônes des TYPES de propriété.
 *
 * Extraites de la table pour que l'en-tête de colonne, le menu de colonne et la
 * grille de sélection montrent EXACTEMENT le même dessin. Trois jeux d'icônes
 * pour la même chose, c'est trois occasions de diverger — et l'utilisateur
 * n'apprend plus à reconnaître un type d'un coup d'œil.
 *
 * Dessinées à la main, dans le trait du reste de l'application (24×24, contour,
 * jamais de fond) : chacune dit ce que la colonne CONTIENT, pas une forme
 * générique interchangeable.
 */

import React from 'react';
import type { PropertyType } from './types';

export const svgProps = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function typeIcon(type: PropertyType): React.ReactNode {
  switch (type) {
    case 'text':
      return (
        <svg {...svgProps}>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="16" y2="12" />
          <line x1="4" y1="17" x2="12" y2="17" />
        </svg>
      );
    case 'number':
      return (
        <svg {...svgProps}>
          <line x1="9" y1="4" x2="7" y2="20" />
          <line x1="17" y1="4" x2="15" y2="20" />
          <line x1="4" y1="9" x2="20" y2="9" />
          <line x1="4" y1="15" x2="20" y2="15" />
        </svg>
      );
    case 'select':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="9 11 12 14 15 11" />
        </svg>
      );
    case 'multiSelect':
      return (
        <svg {...svgProps}>
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="4.5" cy="6" r="1" />
          <circle cx="4.5" cy="12" r="1" />
          <circle cx="4.5" cy="18" r="1" />
        </svg>
      );
    case 'checkbox':
      return (
        <svg {...svgProps}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <polyline points="8 12 11 15 16 9" />
        </svg>
      );
    case 'date':
      return (
        <svg {...svgProps}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="8" y1="3" x2="8" y2="7" />
          <line x1="16" y1="3" x2="16" y2="7" />
        </svg>
      );
    case 'url':
      return (
        <svg {...svgProps}>
          <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
          <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
        </svg>
      );
    case 'email':
      return (
        <svg {...svgProps}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <polyline points="3 7 12 13 21 7" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...svgProps}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case 'rating':
      return (
        <svg {...svgProps}>
          <polygon points="12 2.5 15.09 8.76 22 9.77 17 14.64 18.18 21.52 12 18.27 5.82 21.52 7 14.64 2 9.77 8.91 8.76" />
        </svg>
      );
    case 'progress':
      return (
        <svg {...svgProps}>
          <rect x="2.5" y="9" width="19" height="6" rx="3" />
          <line x1="5.5" y1="12" x2="11" y2="12" strokeWidth={3} />
        </svg>
      );
    case 'note':
      return (
        <svg {...svgProps}>
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case 'relation':
      return (
        <svg {...svgProps}>
          <path d="M4 7h7" />
          <path d="M4 17h7" />
          <path d="M11 7l4 5-4 5" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      );
    case 'rollup':
      return (
        <svg {...svgProps}>
          <polyline points="18 5 6 5 12 12 6 19 18 19" />
        </svg>
      );
    case 'person':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
        </svg>
      );
    case 'formula':
      return (
        <svg {...svgProps}>
          <path d="M6 19c2 0 3-1 3-4V9c0-3 1-4 3-4" />
          <line x1="5" y1="12" x2="12" y2="12" />
          <line x1="15" y1="9" x2="21" y2="15" />
          <line x1="21" y1="9" x2="15" y2="15" />
        </svg>
      );
    case 'createdTime':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15.5 14" />
        </svg>
      );
    case 'updatedTime':
      return (
        <svg {...svgProps}>
          <polyline points="3 4 3 10 9 10" />
          <path d="M3.5 15a9 9 0 1 0 2.1-9.4L3 10" />
        </svg>
      );
    default:
      return null;
  }
}
