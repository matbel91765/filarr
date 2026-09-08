/**
 * Bloc « Ce qui traîne » — LA LIGNE DE PIED.
 *
 * ── UNE LIGNE, ET ELLE DISPARAÎT QUAND ELLE N'A RIEN À DIRE ─────────────────
 *
 * « 12 notes sans dossier · 3 rappels aujourd'hui ». C'est tout. Pas de carte,
 * pas d'icône d'alerte, pas de bouton « Ranger maintenant » : le rôle de cette
 * ligne est de RAPPELER, pas de réclamer. Une bannière colorée en haut de
 * l'accueil obtiendrait la même information en transformant chaque ouverture de
 * l'application en reproche.
 *
 * Et quand il n'y a rien à signaler, elle n'existe pas : `isQuietSummaryEmpty`
 * la retire de la grille, qui recompacte (voir le contrat `isEmpty` du
 * registre). Un accueil rangé ne doit pas garder une ligne vide qui dit « rien
 * à signaler » — c'est encore du bruit, juste plus poli.
 *
 * ── LES CHIFFRES QUI Y FIGURENT ONT UNE SUITE ───────────────────────────────
 *
 * Les notes sans dossier ouvrent la section Notes filtrée sur elles : le compte
 * est une PORTE, pas un constat. Les rappels du jour, eux, restent du texte —
 * l'accueil n'expose pas de chemin vers `/reminders` dans les actions
 * partagées, et en inventer un ici ferait un lien de moins au bon endroit.
 */

import React from 'react';
import { createSelector } from '@reduxjs/toolkit';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import type { Folder, Reminder } from '../../../../types';
import { useHomeActions } from '../HomeActionsContext';
import { selectUnfiledNotes } from '../homeSelectors';
import { readEnumOption, type WidgetOptionSchema, type WidgetProps } from '../widgetOptions';
import './blocks.css';
import '../presets/homePresets.css';

interface QuietSummary {
  unfiledNotes: number;
  remindersToday: number;
}

function isDone(reminder: Reminder): boolean {
  return reminder.completed === true || reminder.isCompleted === true;
}

/**
 * Le dérivé, mémoïsé AU NIVEAU DU MODULE (voir `homeSelectors`).
 *
 * ⚠ « Aujourd'hui » est lu au moment du calcul : le compte ne se recalcule donc
 * qu'au prochain changement de dossiers ou de notes. Une application laissée
 * ouverte à travers minuit peut afficher le compte de la veille jusqu'au geste
 * suivant — un minuteur qui réveillerait l'accueil toutes les minutes pour
 * corriger une ligne de pied coûterait bien plus qu'il ne rapporte.
 */
export const selectQuietSummary = createSelector(
  [selectUnfiledNotes, (state: RootState) => state.folders.byId],
  (unfiled, foldersById): QuietSummary => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + 24 * 60 * 60 * 1000;

    let remindersToday = 0;
    for (const folder of Object.values(foldersById) as Folder[]) {
      if (!folder || folder.deletedAt || !folder.reminders?.length) continue;
      for (const reminder of folder.reminders) {
        if (isDone(reminder)) continue;
        const fireAt = new Date(reminder.snoozedUntil ?? reminder.date).getTime();
        if (Number.isNaN(fireAt)) continue;
        if (fireAt >= start.getTime() && fireAt < end) remindersToday += 1;
      }
    }

    return { unfiledNotes: unfiled.length, remindersToday };
  }
);

/** Rien à signaler ⇒ pas de ligne. */
export function isQuietSummaryEmpty(state: RootState): boolean {
  const summary = selectQuietSummary(state);
  return summary.unfiledNotes === 0 && summary.remindersToday === 0;
}

/**
 * LE TON DE LA LIGNE.
 *
 * Ce bloc dit « trois notes sans dossier » sur le ton d'une note de bas de page.
 * C'est le bon ton par defaut -- ce n'est pas urgent. Mais quelqu'un qui s'en
 * sert justement pour ne rien laisser filer veut pouvoir le rendre VISIBLE, et
 * quelqu'un d'autre veut l'effacer encore davantage.
 *
 * Trois tons pour le meme contenu, donc, et aucun ne change ce qui est dit.
 */
export const QUIET_SUMMARY_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'enum',
    key: 'tone',
    labelKey: 'home.widgets.opt.summaryTone',
    fallback: 'plain',
    choices: [
      { value: 'plain', labelKey: 'home.widgets.opt.tonePlain' },
      { value: 'accent', labelKey: 'home.widgets.opt.toneAccent' },
      { value: 'quiet', labelKey: 'home.widgets.opt.toneQuiet' },
    ],
  },
];

export const QuietSummaryWidget: React.FC<WidgetProps> = React.memo(function QuietSummaryWidget({
  editing,
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const { unfiledNotes, remindersToday } = useSelector(selectQuietSummary);
  const tone = readEnumOption(QUIET_SUMMARY_OPTIONS, options, 'tone');

  const parts: React.ReactNode[] = [];

  if (unfiledNotes > 0) {
    parts.push(
      <button
        key="unfiled"
        type="button"
        onClick={actions.seeAllUnfiled}
        className="hover:text-[var(--color-text-secondary)] hover:underline transition-colors duration-150"
      >
        {t('home.summary.unfiledNotes', '{{count}} note sans dossier', { count: unfiledNotes })}
      </button>
    );
  }

  if (remindersToday > 0) {
    parts.push(
      <span key="reminders">
        {t('home.summary.remindersToday', '{{count}} rappel aujourd’hui', {
          count: remindersToday,
        })}
      </span>
    );
  }

  // En édition, le bloc reste saisissable même sans rien à dire : la grille le
  // montre toujours (voir `isEmpty`), il lui faut donc une ligne à afficher.
  if (parts.length === 0) {
    if (!editing) return null;
    parts.push(
      <span key="nothing">{t('home.summary.nothing', 'Rien à signaler aujourd’hui.')}</span>
    );
  }

  return (
    <div className={`home-column h-full flex items-center blk-summary blk-summary--${tone}`}>
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs">
        {parts.map((part, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span aria-hidden="true">·</span>}
            {part}
          </React.Fragment>
        ))}
      </p>
    </div>
  );
});

export default QuietSummaryWidget;
