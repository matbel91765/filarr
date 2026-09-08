/**
 * Les glyphes de l'en-tête de l'explorateur — UN tracé par geste.
 *
 * La vue dossier (`views/FolderView`, en 20 px) et la vue de coffre partagé
 * (`vaults/VaultFolderView`, en 16 px) recopiaient chacune ces SVG. Deux copies
 * d'un même dessin finissent toujours par diverger, et l'explorateur d'un coffre
 * doit ressembler trait pour trait à celui d'un dossier : c'est tout le sens du
 * lot A. Le tracé vit donc ici, et chaque vue ne choisit que sa taille.
 *
 * `size` pose `width`/`height` (16 par défaut) ; `className` prend le relais
 * quand l'appelant dimensionne par classes utilitaires. Les deux formes
 * existaient déjà dans les vues : on ne change le rendu de personne.
 */

import React from 'react';

export interface ExplorerIconProps {
  /** Côté en pixels, posé en attributs `width`/`height` (16 par défaut). */
  size?: number;
  /** Classes utilitaires (ex. `w-4 h-4`) — remplace `size` quand présent. */
  className?: string;
}

const Glyph: React.FC<ExplorerIconProps & { d: string }> = ({ d, size = 16, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    {...(className ? { className } : { width: size, height: size })}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

/** « Importer » — la flèche qui sort du plateau. */
export const UploadIcon: React.FC<ExplorerIconProps> = (props) => (
  <Glyph
    {...props}
    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
  />
);

/** « Nouveau dossier » — un dossier avec un plus. */
export const FolderPlusIcon: React.FC<ExplorerIconProps> = (props) => (
  <Glyph
    {...props}
    d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
  />
);

/** « Nouveau document » — une page à coin plié avec un plus. */
export const DocumentPlusIcon: React.FC<ExplorerIconProps> = (props) => (
  <Glyph
    {...props}
    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3 13.5v-3m0 0v-3m0 3h3m-3 0h-3"
  />
);

/** Tri croissant. */
export const SortAscIcon: React.FC<ExplorerIconProps> = (props) => (
  <Glyph
    {...props}
    d="M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75L17.25 9m0 0L21 12.75M17.25 9v12"
  />
);

/** Tri décroissant. */
export const SortDescIcon: React.FC<ExplorerIconProps> = (props) => (
  <Glyph
    {...props}
    d="M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0l-3.75-3.75M17.25 21L21 17.25"
  />
);

/** Vue en liste — trois lignes. */
export const ListIcon: React.FC<ExplorerIconProps> = (props) => (
  <Glyph {...props} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
);

/** Vue en grille — quatre cases. */
export const GridIcon: React.FC<ExplorerIconProps> = (props) => (
  <Glyph
    {...props}
    d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
  />
);
