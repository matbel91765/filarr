/**
 * Bloc « Notes sans dossier ».
 *
 * Une note dont `parentId` est nul n'apparaît sous aucun dossier : depuis
 * l'accueil elle est donc invisible, quel que soit son carnet. Ce bloc est le
 * seul endroit d'où on peut la retrouver sans passer par la section Notes.
 *
 * Comme avant, il DISPARAÎT quand il n'y a rien à montrer : un bandeau vide
 * « Notes sans dossier (0) » serait un reproche permanent adressé à quelqu'un
 * qui n'a rien fait de mal. En édition, le cadre le rend visible malgré tout —
 * sinon on ne pourrait ni le déplacer ni le retirer.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useHomeActions } from '../HomeActionsContext';
import { selectUnfiledNotes } from '../homeSelectors';
import type { WidgetProps } from '../widgetOptions';
import { NoteCard } from './NoteCard';
import { SectionHeading } from './SectionHeading';

const UnfiledIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-4 h-4"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5A3.375 3.375 0 0010.125 2.25H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
    />
  </svg>
);

export const UnfiledNotesWidget: React.FC<WidgetProps> = React.memo(function UnfiledNotesWidget({
  editing,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const unfiledAll = useSelector(selectUnfiledNotes);

  // Une rangée de cartes : l'accueil reste un survol, pas une liste complète.
  const shown = useMemo(() => unfiledAll.slice(0, 4), [unfiledAll]);
  const total = unfiledAll.length;

  if (total === 0 && !editing) return null;

  return (
    <section>
      <SectionHeading
        icon={<UnfiledIcon />}
        label={t('home.unfiledNotes', 'Notes sans dossier')}
        count={total}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {shown.map((note) => (
          <NoteCard
            key={`unfiled-${note.id}`}
            noteId={note.id}
            title={note.title}
            excerpt={note.plainText?.trim().slice(0, 60) ?? ''}
            onOpen={actions.openNote}
          />
        ))}
      </div>
      {total > shown.length && (
        <button
          onClick={actions.seeAllUnfiled}
          className="mt-3 text-xs text-[var(--color-primary-500)] hover:underline"
        >
          {t('home.seeAllUnfiled', 'Voir les {{count}} notes sans dossier', { count: total })}
        </button>
      )}
    </section>
  );
});

export default UnfiledNotesWidget;
