/**
 * Bloc « Rappels à venir » — les cinq prochaines échéances.
 *
 * ── CE QU'IL VOIT, ET CE QU'IL NE VOIT PAS ──────────────────────────────────
 *
 * Les rappels du produit vivent à trois endroits : sur les dossiers (dans le
 * store, ici), sur les fichiers et sur les notes (hors du store — le processus
 * principal les tient, et `RemindersView` les demande par `getAllReminders`).
 *
 * Ce bloc ne lit QUE ce que le store porte, c'est-à-dire les rappels de
 * dossiers, et c'est un choix assumé : un bloc d'affichage n'a pas à lancer un
 * aller-retour IPC à chaque montage de l'accueil (c'est la règle déjà posée par
 * « Quota de stockage »), et un rappel manquant se rattrape sur `/reminders`,
 * qui reste la vue COMPLÈTE. Le libellé du bloc ne promet donc rien d'autre que
 * ce qu'il montre, et le lien « Tous les rappels » y mène.
 *
 * ── LES RAPPELS EN RETARD RESTENT ───────────────────────────────────────────
 *
 * Un rappel dont l'heure est passée mais qui n'est pas terminé est le plus
 * actionnable de tous : il arrive en tête, et son horodatage relatif dit « il y
 * a vingt minutes ». Le masquer parce qu'il n'est plus « à venir » ferait
 * disparaître exactement ce qu'on a raté.
 */

import React, { useCallback } from 'react';
import { createSelector } from '@reduxjs/toolkit';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import type { Folder, Reminder } from '../../../../types';
import { useHomeActions } from '../HomeActionsContext';
import type { WidgetOptionSchema, WidgetProps } from '../widgetOptions';
import { FRAME_OPTION, WidgetSurface, frameOf } from './WidgetSurface';
import { useUpcomingTime } from './relativeTime';

export const UPCOMING_REMINDERS_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

/** Cinq : la hauteur d'un bloc de trois rangées, listes de la vue rappels comprises. */
const REMINDERS_LIMIT = 5;

interface ReminderEntry {
  id: string;
  folderId: string;
  title: string;
  /** L'heure à laquelle il se déclenche VRAIMENT (report compris). */
  fireAt: string;
  message?: string;
}

/**
 * Terminé ? Les deux champs sont écrits à la complétion (l'un est l'ancien nom,
 * gardé pour les lecteurs plus vieux) : lire un seul des deux ferait
 * réapparaître des rappels réglés selon l'appareil qui les a réglés.
 */
function isDone(reminder: Reminder): boolean {
  return reminder.completed === true || reminder.isCompleted === true;
}

/** Le dérivé, mémoïsé AU NIVEAU DU MODULE (voir `homeSelectors`). */
export const selectUpcomingReminders = createSelector(
  [(state: RootState) => state.folders.byId],
  (foldersById): ReminderEntry[] => {
    const entries: ReminderEntry[] = [];

    for (const folder of Object.values(foldersById) as Folder[]) {
      if (!folder || folder.deletedAt || !folder.reminders?.length) continue;
      for (const reminder of folder.reminders) {
        if (isDone(reminder)) continue;
        // Un rappel reporté se déclenche à `snoozedUntil` : trier sur `date`
        // le remonterait en tête chaque fois qu'on vient de le repousser.
        const fireAt = reminder.snoozedUntil ?? reminder.date;
        if (!fireAt || Number.isNaN(new Date(fireAt).getTime())) continue;
        entries.push({
          id: reminder.id,
          folderId: folder.id,
          title: reminder.itemName || folder.name,
          fireAt,
          message: reminder.message ?? reminder.description,
        });
      }
    }

    return entries
      .sort((a, b) => new Date(a.fireAt).getTime() - new Date(b.fireAt).getTime())
      .slice(0, REMINDERS_LIMIT);
  }
);

/** Aucune échéance ouverte ⇒ aucun bloc. */
export function isUpcomingRemindersEmpty(state: RootState): boolean {
  return selectUpcomingReminders(state).length === 0;
}

const BellIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.6}
    stroke="currentColor"
    className="w-4 h-4"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
    />
  </svg>
);

/** Une ligne, isolée pour que son rappel ait une identité stable par échéance. */
const ReminderLine: React.FC<{
  entry: ReminderEntry;
  when: string;
  onOpen: (folderId: string) => void;
}> = React.memo(function ReminderLine({ entry, when, onOpen }) {
  const open = useCallback(() => onOpen(entry.folderId), [onOpen, entry.folderId]);

  return (
    <button type="button" className="home-line" onClick={open} title={entry.message || entry.title}>
      <span
        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
        bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]"
        aria-hidden="true"
      >
        <BellIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-[var(--color-text-primary)] truncate">
          {entry.title}
        </span>
        {entry.message && (
          <span className="block text-xs text-[var(--color-text-tertiary)] truncate">
            {entry.message}
          </span>
        )}
      </span>
      <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{when}</span>
    </button>
  );
});

export const UpcomingRemindersWidget: React.FC<WidgetProps> = React.memo(
  function UpcomingRemindersWidget({ options }) {
    const { t } = useTranslation();
    const actions = useHomeActions();
    const entries = useSelector(selectUpcomingReminders);
    const upcoming = useUpcomingTime();
    const frame = frameOf(options);

    return (
      <WidgetSurface frame={frame} label={t('home.reminders.title', 'Rappels à venir')}>
        {entries.length === 0 ? (
          <p className="text-xs text-[var(--color-text-tertiary)] m-0">
            {t('home.reminders.empty', 'Aucune échéance en attente.')}
          </p>
        ) : (
          <div className="flex flex-col">
            {entries.map((entry) => (
              <ReminderLine
                key={entry.id}
                entry={entry}
                when={upcoming(entry.fireAt)}
                onOpen={actions.openFolder}
              />
            ))}
          </div>
        )}
      </WidgetSurface>
    );
  }
);

export default UpcomingRemindersWidget;
