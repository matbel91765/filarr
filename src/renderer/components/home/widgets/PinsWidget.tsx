/**
 * Bloc « Épingles » — jusqu'à huit raccourcis, en grille 4×2.
 *
 * ── CE QU'IL MONTRE EXISTE DÉJÀ, AILLEURS ───────────────────────────────────
 *
 * Les épingles vivent dans la barre latérale, où elles sont excellentes… et
 * larges de 200 px, tronquées, sans couleur ni emoji. L'accueil a la place de
 * les montrer telles qu'elles sont : la pastille du dossier (sa couleur ET son
 * emoji, ceux que l'utilisateur a choisis lui-même dans « Personnaliser »), et
 * le nom en entier.
 *
 * C'est le même jeu de données (`favorites`), pas une copie : épingler ailleurs
 * met ce bloc à jour, et le clic droit ouvre le MÊME menu que partout ailleurs.
 *
 * ── HUIT, ET PAS PLUS ───────────────────────────────────────────────────────
 *
 * Quatre par rangée, deux rangées. Au-delà, la grille devient une deuxième liste
 * de dossiers — or le bloc « Tous les dossiers » existe et fait ça mieux. Les
 * épingles au-delà de la huitième restent dans la barre latérale, où l'ordre est
 * réglable.
 */

import React, { useCallback } from 'react';
import { createSelector } from '@reduxjs/toolkit';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import type { Folder } from '../../../../types';
import { useHomeActions } from '../HomeActionsContext';
import { readEnumOption, type WidgetOptionSchema, type WidgetProps } from '../widgetOptions';
import './blocks.css';
import '../presets/homePresets.css';

/** Quatre colonnes, deux rangées. */
const PINS_LIMIT = 8;

interface PinEntry {
  key: string;
  /** Dossier épinglé : on ouvre le dossier. Fichier : on ouvre son dossier. */
  folderId: string;
  name: string;
  color?: string;
  emoji?: string;
  /** Le dossier lui-même, quand l'épingle en désigne un — pour le clic droit. */
  folder?: Folder;
}

/**
 * Le dérivé, mémoïsé AU NIVEAU DU MODULE (voir `homeSelectors`). Les épingles
 * dont la cible n'existe plus sont écartées : une pastille qui n'ouvre rien est
 * pire que pas de pastille.
 */
export const selectPinEntries = createSelector(
  [
    (state: RootState) => state.favorites.favorites,
    (state: RootState) => state.folders.byId,
    (state: RootState) => state.files.byId,
  ],
  (favorites, foldersById, filesById): PinEntry[] => {
    const entries: PinEntry[] = [];

    for (const favorite of [...favorites].sort((a, b) => a.order - b.order)) {
      if (entries.length >= PINS_LIMIT) break;

      if (favorite.itemType === 'folder') {
        const folder = foldersById[favorite.itemId] as Folder | undefined;
        if (!folder || folder.deletedAt) continue;
        entries.push({
          key: favorite.id,
          folderId: folder.id,
          name: folder.name || favorite.name,
          // La couleur de l'épingle a pu être figée à l'ajout : celle du dossier
          // fait foi, sinon repeindre un dossier ne repeindrait pas son épingle.
          color: folder.color || favorite.color,
          emoji: folder.emoji,
          folder,
        });
        continue;
      }

      const file = filesById[favorite.itemId];
      if (!file || file.deletedAt) continue;
      const parent = (Object.values(foldersById) as Folder[]).find(
        (candidate) => !candidate.deletedAt && candidate.items?.includes(favorite.itemId)
      );
      if (!parent) continue;
      entries.push({
        key: favorite.id,
        folderId: parent.id,
        name: file.name || favorite.name,
        color: favorite.color,
      });
    }

    return entries;
  }
);

/** Aucune épingle utilisable ⇒ aucun bloc. */
export function isPinsEmpty(state: RootState): boolean {
  return selectPinEntries(state).length === 0;
}

const FolderGlyph: React.FC<{ color?: string }> = ({ color }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill={color || 'var(--color-primary-500)'}
    viewBox="0 0 24 24"
    className="w-5 h-5"
    aria-hidden="true"
  >
    <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

/** Une épingle, isolée pour que ses rappels aient une identité stable. */
const PinCard: React.FC<{
  entry: PinEntry;
  onOpen: (folderId: string) => void;
  onMenu: (event: React.MouseEvent<HTMLElement>, folder: Folder) => void;
}> = React.memo(function PinCard({ entry, onOpen, onMenu }) {
  const open = useCallback(() => onOpen(entry.folderId), [onOpen, entry.folderId]);
  const menu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      // Une épingle de FICHIER n'a pas de menu de dossier : le menu partagé
      // attend un dossier entier, et lui donner autre chose ouvrirait neuf
      // actions qui ne s'appliquent pas.
      if (!entry.folder) return;
      onMenu(event, entry.folder);
    },
    [onMenu, entry.folder]
  );

  return (
    <button
      type="button"
      onClick={open}
      onContextMenu={menu}
      title={entry.name}
      className="flex flex-col items-center gap-2 p-2 rounded-xl
      hover:bg-[var(--color-surface-hover)] transition-colors duration-150"
    >
      <span
        className="w-11 h-11 rounded-xl flex items-center justify-center"
        style={{
          backgroundColor: entry.color
            ? `color-mix(in srgb, ${entry.color} 18%, transparent)`
            : 'var(--color-primary-50)',
        }}
        aria-hidden="true"
      >
        {entry.emoji ? (
          <span className="text-xl leading-none">{entry.emoji}</span>
        ) : (
          <FolderGlyph color={entry.color} />
        )}
      </span>
      <span className="w-full text-xs text-[var(--color-text-secondary)] text-center truncate">
        {entry.name}
      </span>
    </button>
  );
});

/**
 * TROIS DISPOSITIONS POUR LES EPINGLES.
 *
 * La grille de vignettes est ce qu'on veut quand on a huit epingles. A vingt,
 * elle devient un mur d'icones dans lequel on ne retrouve rien -- et c'est
 * exactement quand on a vingt epingles qu'on a besoin de les retrouver.
 */
export const PINS_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'enum',
    key: 'layout',
    labelKey: 'home.widgets.opt.pinsLayout',
    fallback: 'grid',
    choices: [
      { value: 'grid', labelKey: 'home.widgets.opt.layoutGrid' },
      { value: 'list', labelKey: 'home.widgets.opt.layoutList' },
      { value: 'compact', labelKey: 'home.widgets.opt.layoutCompact' },
    ],
  },
];

export const PinsWidget: React.FC<WidgetProps> = React.memo(function PinsWidget({
  editing,
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const entries = useSelector(selectPinEntries);
  const layout = readEnumOption(PINS_OPTIONS, options, 'layout');

  if (entries.length === 0 && !editing) return null;

  return (
    <section className="home-column h-full flex flex-col min-h-0 gap-3 py-2">
      <h2 className="home-card__label">{t('home.pins.title', 'Épingles')}</h2>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {entries.length === 0 ? (
          <p className="text-xs text-[var(--color-text-tertiary)] m-0">
            {t('home.pins.empty', 'Épinglez un dossier pour le retrouver ici.')}
          </p>
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-4 gap-2">
            {entries.map((entry) => (
              <PinCard
                key={entry.key}
                entry={entry}
                onOpen={actions.openFolder}
                onMenu={actions.folderContextMenu}
              />
            ))}
          </div>
        ) : (
          <div className="blk-lines">
            {entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="blk-line"
                onClick={() => actions.openFolder(entry.folderId)}
                onContextMenu={(event) =>
                  entry.folder && actions.folderContextMenu(event, entry.folder)
                }
                title={entry.name}
              >
                <span className="blk-line__title">
                  {/* La pastille de couleur survit en COMPACT alors que la
                      vignette disparait : c'est elle qui porte la
                      reconnaissance a l'oeil, pas l'icone de dossier. */}
                  {entry.emoji ? (
                    <span aria-hidden="true">{entry.emoji} </span>
                  ) : (
                    <span
                      className="blk-dot"
                      style={{ background: entry.color || 'var(--color-primary-400)' }}
                      aria-hidden="true"
                    />
                  )}
                  {entry.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});

export default PinsWidget;
