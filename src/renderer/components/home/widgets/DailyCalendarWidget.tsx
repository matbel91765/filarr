/**
 * Bloc « Calendrier » — le calendrier des notes quotidiennes, sur l'accueil.
 *
 * Le composant est celui du bandeau latéral des notes, IMPORTÉ tel quel : il
 * sait déjà lire les notes quotidiennes, poser une pastille sur les jours
 * écrits, et se replier dans une colonne étroite. En recopier une variante
 * « pour l'accueil » aurait garanti deux calendriers qui divergent.
 *
 * Le choix d'un jour remonte à la page (`openDailyNote`) : ouvrir la note du
 * jour, ou la créer si elle n'existe pas, réclame `dispatch` et la navigation —
 * exactement ce qu'un widget mémoïsé ne doit pas porter.
 */

import React from 'react';

import { CalendarWidget } from '../../notes/CalendarWidget';
import { useHomeActions } from '../HomeActionsContext';
import type { WidgetProps } from '../widgetOptions';

export const DailyCalendarWidget: React.FC<WidgetProps> = React.memo(
  function DailyCalendarWidget() {
    const actions = useHomeActions();

    return (
      <div className="h-full p-2 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-auto">
        <CalendarWidget onSelectDate={actions.openDailyNote} />
      </div>
    );
  }
);

export default DailyCalendarWidget;
