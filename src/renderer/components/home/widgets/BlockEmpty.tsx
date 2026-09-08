/**
 * CE QU'UN BLOC MONTRE QUAND IL N'A RIEN À MONTRER.
 *
 * ── POURQUOI CES BLOCS NE DISPARAISSENT PLUS ────────────────────────────────
 *
 * Les blocs historiques s'effacent quand ils sont vides : la grille recompacte,
 * et un bandeau « Coffres partagés (0) » ne reste pas en travers de l'accueil
 * de quelqu'un qui n'en a aucun. C'était le bon choix à une époque où l'état
 * vide était une ligne grise de douze pixels — autant ne rien montrer.
 *
 * Un état vide qui a une FORME change la réponse. Cacher le bloc revient alors
 * à trouer une composition que quelqu'un a dessinée, et à montrer une page à
 * moitié absente à qui vient d'installer un modèle. Un bloc vide qui a l'air
 * délibérément vide vaut mieux qu'un trou.
 *
 * ── LE GLYPHE DIT DE QUOI CE BLOC PARLERA ───────────────────────────────────
 *
 * Il n'est pas décoratif : c'est lui qui distingue « la corbeille est vide » de
 * « aucun favori » avant même qu'on lise la phrase, sur une page qui peut en
 * afficher quatre le premier jour. Une pastille générique les rendrait tous
 * identiques — c'est-à-dire tous illisibles d'un coup d'œil.
 */

import React from 'react';

export type BlockEmptyGlyph =
  | 'trash'
  | 'tag'
  | 'star'
  | 'file'
  | 'note'
  | 'vault'
  | 'link'
  | 'collection';

/** Les tracés, écrits une fois. Tous sur la même grille de 24, même graisse. */
const PATHS: Record<BlockEmptyGlyph, React.ReactNode> = {
  trash: (
    <>
      <path d="M4 7h16" strokeLinecap="round" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
    </>
  ),
  tag: (
    <>
      <path d="M4 11V5a1 1 0 0 1 1-1h6l9 9-7 7-9-9z" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.2" />
    </>
  ),
  star: (
    <path
      d="M12 4l2.4 5 5.6.7-4 3.9 1 5.4-5-2.7-5 2.7 1-5.4-4-3.9 5.6-.7z"
      strokeLinejoin="round"
    />
  ),
  file: (
    <>
      <path d="M6 3h7l5 5v13H6z" strokeLinejoin="round" />
      <path d="M13 3v5h5" strokeLinejoin="round" />
    </>
  ),
  note: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8.5 9h7M8.5 13h7M8.5 17h4" strokeLinecap="round" />
    </>
  ),
  vault: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L11 7.5" strokeLinecap="round" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0L6.5 13a3.5 3.5 0 0 0 5 5l1.5-1.5" strokeLinecap="round" />
    </>
  ),
  collection: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M8 3.5h8M4 10h16" strokeLinecap="round" />
    </>
  ),
};

export interface BlockEmptyProps {
  glyph: BlockEmptyGlyph;
  children: React.ReactNode;
}

export const BlockEmpty: React.FC<BlockEmptyProps> = ({ glyph, children }) => (
  <div className="blk-empty">
    <span className="blk-empty__glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}>
        {PATHS[glyph]}
      </svg>
    </span>
    <span>{children}</span>
  </div>
);

export default BlockEmpty;
