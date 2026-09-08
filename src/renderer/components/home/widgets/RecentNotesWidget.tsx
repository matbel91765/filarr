/**
 * Bloc « Notes récentes ».
 *
 * L'accueil range tout par dossier : la note écrite il y a dix minutes n'y
 * apparaît nulle part tant qu'on ne sait pas dans quel dossier la chercher. Les
 * notes quotidiennes en sont exclues — elles remonteraient tous les jours et
 * cacheraient le reste.
 *
 * Le bloc ne dépend PAS d'avoir des notes récentes : il porte le raccourci vers
 * le tableau, et un raccourci qui n'apparaît qu'une fois qu'on a déjà écrit six
 * notes n'aide personne à démarrer. Sans note, l'entête reste et le corps
 * explique où aller.
 *
 * En revanche il suit toujours le réglage `homeRecentNotes` : quelqu'un qui
 * l'avait éteint dans les paramètres ne doit pas le voir revenir parce que
 * l'accueil a changé de moteur.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import { useHomeActions } from '../HomeActionsContext';
import { selectAuthoredNoteCount, selectAuthoredNotesByRecency } from '../homeSelectors';
import { readEnumOption, type WidgetOptionSchema, type WidgetProps } from '../widgetOptions';
import './blocks.css';
import { NoteCard } from './NoteCard';
import { SectionHeading } from './SectionHeading';

/** Le bloc est éteint par le réglage des paramètres, pas par l'absence de notes. */
export function isRecentNotesHidden(state: RootState): boolean {
  return state.ui.homeRecentNotes === false;
}

const ClockIcon: React.FC = () => (
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
      d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const BoardIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.8}
    stroke="currentColor"
    className="w-4 h-4"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z"
    />
  </svg>
);

/**
 * TROIS DISPOSITIONS POUR LA MEME LISTE.
 *
 * Les cartes sont belles et prennent de la place : trois par rangee, six notes,
 * deux rangees de grille au minimum. La LISTE tient le meme nombre de notes en
 * moitie moins de hauteur, et la COMPACTE en montre douze la ou les cartes en
 * montraient six.
 *
 * Ce n'est pas une preference esthetique : c'est ce qui decide si ce bloc peut
 * cohabiter avec autre chose sur une page d'accueil.
 */
export const RECENT_NOTES_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'enum',
    key: 'layout',
    labelKey: 'home.widgets.opt.notesLayout',
    fallback: 'cards',
    choices: [
      { value: 'cards', labelKey: 'home.widgets.opt.layoutCards' },
      { value: 'list', labelKey: 'home.widgets.opt.layoutList' },
      { value: 'compact', labelKey: 'home.widgets.opt.layoutCompact' },
    ],
  },
];

export const RecentNotesWidget: React.FC<WidgetProps> = React.memo(function RecentNotesWidget({
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const notes = useSelector(selectAuthoredNotesByRecency);
  const total = useSelector(selectAuthoredNoteCount);
  const layout = readEnumOption(RECENT_NOTES_OPTIONS, options, 'layout');

  // La liste en montre plus que les cartes : c'est tout l'interet d'y passer.
  const recentNotes = useMemo(
    () => notes.slice(0, layout === 'compact' ? 12 : layout === 'list' ? 8 : 6),
    [notes, layout]
  );

  return (
    <section>
      <SectionHeading
        icon={<ClockIcon />}
        label={t('home.recentNotes', 'Notes récentes')}
        count={total}
        actions={
          <div className="flex items-center gap-1">
            {/* Le libellé n'est pas décoratif : en icône seule, ce bouton était
                un carré gris de 16 px que personne n'ouvrait jamais — le tableau
                restait introuvable alors qu'un raccourci pointait dessus. */}
            <button
              onClick={actions.openNotesBoard}
              title={t('home.notesBoard', 'Tableau de notes')}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs
              text-[var(--color-text-tertiary)]
              hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]
              transition-colors duration-150"
            >
              <BoardIcon />
              {t('home.notesBoard', 'Tableau de notes')}
            </button>
            <button
              onClick={actions.seeAllNotes}
              className="text-xs text-[var(--color-primary-500)] hover:underline px-1"
            >
              {t('home.seeAllNotes', 'Toutes les notes')}
            </button>
          </div>
        }
      />
      {recentNotes.length === 0 && (
        <p className="text-xs text-[var(--color-text-tertiary)] m-0">
          {t(
            'home.noRecentNotes',
            'Aucune note pour le moment. Le tableau est l’endroit où les créer et les disposer.'
          )}
        </p>
      )}
      {layout === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {recentNotes.map((note) => (
            <NoteCard
              key={`recent-${note.id}`}
              noteId={note.id}
              title={note.title}
              excerpt={note.plainText?.trim().slice(0, 60) ?? ''}
              onOpen={actions.openNote}
            />
          ))}
        </div>
      ) : (
        <div className="blk-lines">
          {recentNotes.map((note) => (
            <button
              key={`recent-${note.id}`}
              type="button"
              className={`blk-line${layout === 'list' ? ' blk-line--rich' : ''}`}
              onClick={() => actions.openNote(note.id)}
            >
              <span className="blk-line__title">{note.title || '—'}</span>
              {/* L'extrait DISPARAIT en compact : c'est ce qui fait tenir douze
                  notes la ou huit tenaient. Le garder en le tronquant a vingt
                  caracteres n'aurait informe sur rien. */}
              {layout === 'list' && (
                <span className="blk-line__meta blk-line__meta--excerpt">
                  {note.plainText?.trim().slice(0, 60) ?? ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
});

export default RecentNotesWidget;
