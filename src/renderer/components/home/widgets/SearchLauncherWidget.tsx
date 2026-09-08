/**
 * Bloc « Chercher ou ouvrir… » — le champ qui ouvre la palette de commandes.
 *
 * ── LE MEILLEUR RAPPORT DE TOUT L'ACCUEIL ───────────────────────────────────
 *
 * La palette sait déjà tout faire : ouvrir un fichier, un dossier, une note,
 * lancer une action, changer un réglage. Elle existe, elle est bonne, et elle
 * est INVISIBLE — il faut connaître Ctrl+P pour la trouver. Une ligne sur
 * l'accueil suffit à la rendre découvrable, et elle ne coûte qu'une rangée.
 *
 * ── CE N'EST PAS UN CHAMP DE SAISIE, ET C'EST DÉLIBÉRÉ ──────────────────────
 *
 * Un vrai `<input>` ici demanderait de recopier la recherche floue, la liste de
 * résultats, la navigation au clavier et l'historique de la palette — ou, pire,
 * de faire semblant : on tape trois lettres, la palette s'ouvre par-dessus, et
 * les trois lettres sont perdues. Le bloc est donc un BOUTON qui ressemble à un
 * champ : un seul geste, aucune saisie orpheline, et la palette reçoit le focus
 * dans son propre champ.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

import shortcutsService from '../../../../services/platform/shortcutsService';
import { openModal } from '../../../../store/slices/uiSlice';
import type { AppDispatch } from '../../../../store';
import type { WidgetProps } from '../widgetOptions';
import '../presets/homePresets.css';

const SearchIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.8}
    stroke="currentColor"
    className="w-5 h-5 shrink-0"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
    />
  </svg>
);

export const SearchLauncherWidget: React.FC<WidgetProps> = React.memo(
  function SearchLauncherWidget({ editing }) {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    /**
     * Le raccourci AFFICHÉ est celui qui est réellement armé : il est
     * personnalisable, et annoncer « Ctrl P » à quelqu'un qui l'a remappé serait
     * pire que ne rien annoncer.
     */
    const keys = useMemo(
      () => shortcutsService.getShortcut('command-palette')?.keys ?? ['Ctrl', 'P'],
      []
    );

    const open = useCallback(() => {
      // En édition, le clic appartient à la sélection du bloc : ouvrir la
      // palette par-dessus la grille qu'on est en train de ranger masquerait
      // exactement ce qu'on regarde.
      if (editing) return;
      dispatch(openModal({ type: 'commandPalette', props: {} }));
    }, [dispatch, editing]);

    const label = t('home.search.placeholder', 'Chercher ou ouvrir…');

    return (
      <div className="home-column h-full flex items-center">
        <button
          type="button"
          onClick={open}
          aria-label={label}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
          bg-[var(--color-surface)] border border-[var(--color-border)]
          text-[var(--color-text-tertiary)]
          hover:border-[var(--color-primary-400)] hover:text-[var(--color-text-secondary)]
          transition-colors duration-150"
        >
          <SearchIcon />
          <span className="flex-1 text-left text-sm truncate">{label}</span>
          <span className="hidden sm:flex items-center gap-1 shrink-0">
            {keys.map((key) => (
              <kbd
                key={key}
                className="px-1.5 py-0.5 rounded-md text-[11px] leading-none
                bg-[var(--color-background-secondary)] border border-[var(--color-border)]
                text-[var(--color-text-tertiary)]"
              >
                {key}
              </kbd>
            ))}
          </span>
        </button>
      </div>
    );
  }
);

export default SearchLauncherWidget;
