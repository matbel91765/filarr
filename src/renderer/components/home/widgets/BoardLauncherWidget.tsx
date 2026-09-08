/**
 * Bloc « Atelier » — la porte du canevas.
 *
 * ── CE BLOC EST UNE BASCULE, PAS UN CANEVAS ─────────────────────────────────
 *
 * Le modèle « Atelier » visait le canevas spatial monté DANS l'accueil. Il n'y
 * est pas, et ce bloc ne fait pas semblant de l'y mettre : il ouvre `/board`,
 * qui EST le canevas complet, à sa taille, avec son zoom, sa minimap et ses
 * gestes.
 *
 * La raison est dans `presets/homePresets.ts` (gabarit « Atelier ») : deux
 * moteurs de gestes — celui du canevas et celui de la grille — se disputeraient
 * le même pointeur dans une case redimensionnable. Un demi-canevas instable
 * aurait été pire que cette porte franche.
 *
 * Il n'a donc AUCUN état à lui, aucune donnée à lire, et ne re-rend jamais.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeActions } from '../HomeActionsContext';
import type { WidgetProps } from '../widgetOptions';
import '../presets/homePresets.css';

const BoardIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.6}
    stroke="currentColor"
    className="w-6 h-6"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z"
    />
  </svg>
);

const ArrowIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.8}
    stroke="currentColor"
    className="w-5 h-5 shrink-0"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
  </svg>
);

export const BoardLauncherWidget: React.FC<WidgetProps> = React.memo(function BoardLauncherWidget({
  editing,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();

  return (
    <div className="home-column h-full flex items-center">
      <button
        type="button"
        // En édition, le clic appartient à la sélection du bloc : changer de
        // page au milieu d'un rangement perdrait la session.
        onClick={editing ? undefined : actions.openNotesBoard}
        className="w-full h-full flex items-center gap-4 px-5 py-4 rounded-xl text-left
        bg-[var(--color-surface)] border border-[var(--color-border)] shadow-sm
        hover:border-[var(--color-primary-400)] transition-colors duration-150"
      >
        <span
          className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center
          bg-[var(--color-primary-50)] text-[var(--color-primary-600)]"
          aria-hidden="true"
        >
          <BoardIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base text-[var(--color-text-primary)]">
            {t('home.board.title', 'Ouvrir l’Atelier')}
          </span>
          <span className="block text-xs text-[var(--color-text-tertiary)]">
            {t(
              'home.board.subtitle',
              'Vos notes sur une surface libre : déplacez-les, groupez-les, reliez-les.'
            )}
          </span>
        </span>
        <span className="text-[var(--color-text-tertiary)]">
          <ArrowIcon />
        </span>
      </button>
    </div>
  );
});

export default BoardLauncherWidget;
