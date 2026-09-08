/**
 * LES BLOCS QUI PARLENT AUX NOTES.
 *
 * ── CE QUI MANQUAIT, ET POURQUOI ÇA MANQUAIT ────────────────────────────────
 *
 * L'accueil savait montrer les notes RÉCENTES, ÉPINGLÉES et SANS DOSSIER. Trois
 * façons de dire « les dernières », c'est-à-dire trois façons de ne jamais
 * revoir ce qu'on a écrit il y a six mois.
 *
 * Les cinq blocs d'ici répondent tous à la même question, par des chemins
 * différents : COMMENT REVIENT-ON À CE QU'ON A OUBLIÉ ?
 *
 *   · au HASARD — la méthode qui marche vraiment, et la seule qui ne demande
 *     rien à personne ;
 *   · en le CHOISISSANT une fois pour toutes (vitrine) ;
 *   · par le JOUR (note quotidienne) ;
 *   · par les CARREFOURS — les notes vers lesquelles tout pointe ;
 *   · par les ORPHELINES — celles vers lesquelles rien ne pointe, donc celles
 *     qu'on ne retrouvera jamais autrement. C'est le bloc le plus utile des
 *     cinq, et le plus désagréable : il montre exactement ce qu'on a laissé
 *     tomber.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import type { Note } from '../../../../types/notes';
import { useHomeActions } from '../HomeActionsContext';
import { selectAuthoredNotesByRecency } from '../homeSelectors';
import { readEnumOption, type WidgetOptionSchema, type WidgetProps } from '../widgetOptions';
import { frameOf, FRAME_OPTION, WidgetSurface } from './WidgetSurface';
import { BlockEmpty } from './BlockEmpty';
import './blocks.css';

/** L'extrait d'une note, coupé net. */
function excerpt(note: Note, max = 180): string {
  const text = (note.plainText || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Une ligne cliquable, la même pour les cinq blocs. */
const NoteLine: React.FC<{ note: Note; onOpen: () => void; meta?: string }> = ({
  note,
  onOpen,
  meta,
}) => (
  <button type="button" className="blk-line" onClick={onOpen}>
    <span className="blk-line__title">{note.title || '—'}</span>
    {meta && <span className="blk-line__meta">{meta}</span>}
  </button>
);

// ==================== 6. Une note au hasard ====================

export const RANDOM_NOTE_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

/**
 * ⚠ LE TIRAGE NE SE FAIT PAS PENDANT LE RENDU.
 *
 * Un `Math.random()` posé dans le corps du composant rendrait une note
 * différente à CHAQUE rendu — donc au moindre changement d'état ailleurs dans
 * l'accueil. La note changerait sous les yeux, sans qu'on ait rien demandé, et
 * cliquer dessus ouvrirait parfois une autre note que celle qu'on visait.
 *
 * La graine est donc un ÉTAT, et elle ne bouge que sur le bouton.
 */
export const RandomNoteWidget: React.FC<WidgetProps> = React.memo(function RandomNoteWidget({
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const notes = useSelector(selectAuthoredNotesByRecency);
  const [seed, setSeed] = useState(() => Math.random());

  const note = useMemo(() => {
    if (notes.length === 0) return null;
    return notes[Math.floor(seed * notes.length) % notes.length];
  }, [notes, seed]);

  const reroll = useCallback(() => setSeed(Math.random()), []);

  return (
    <WidgetSurface
      frame={frameOf(options)}
      label={t('home.widgets.randomNote')}
      actions={
        <button type="button" className="blk-action" onClick={reroll}>
          {t('home.blocks.reroll')}
        </button>
      }
    >
      {note ? (
        <div className="blk-stack blk-stack--center">
          <button
            type="button"
            className="blk-note-title"
            onClick={() => actions.openNote(note.id)}
          >
            {note.title || '—'}
          </button>
          <p className="blk-excerpt">{excerpt(note)}</p>
        </div>
      ) : (
        <BlockEmpty glyph="note">{t('home.blocks.emptyNotes')}</BlockEmpty>
      )}
    </WidgetSurface>
  );
});

export function isRandomNoteEmpty(state: RootState): boolean {
  return selectAuthoredNotesByRecency(state).length === 0;
}

// ==================== 7. Note en vitrine ====================

export const NOTE_SPOTLIGHT_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

/**
 * UNE note, choisie une fois, toujours là.
 *
 * L'attache (`binding.note`) est LOCALE : elle désigne une note de CET appareil.
 * Un gabarit exporté la perd — c'est voulu, et c'est déjà la règle pour les
 * blocs de dossier. Publier une disposition qui pointe vers sa propre note
 * privée ferait, chez l'autre, un bloc qui montre une note qui n'existe pas
 * — ou pire, une note à lui, prise par hasard sur un identifiant qui collerait.
 */
export const NoteSpotlightWidget: React.FC<WidgetProps> = React.memo(function NoteSpotlightWidget({
  options,
  binding,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const noteId = binding?.note;
  const note = useSelector((state: RootState) => (noteId ? state.notes.byId[noteId] : undefined));

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.noteSpotlight')}>
      {note && !note.deletedAt ? (
        <div className="blk-stack blk-stack--center">
          <button
            type="button"
            className="blk-note-title"
            onClick={() => actions.openNote(note.id)}
          >
            {note.title || '—'}
          </button>
          <p className="blk-excerpt blk-excerpt--long">{excerpt(note, 600)}</p>
        </div>
      ) : (
        // Un message qui DIT QUOI FAIRE. « Aucune note » laisserait croire à une
        // panne alors qu'il manque simplement un choix.
        <BlockEmpty glyph="note">{t('home.blocks.spotlightUnset')}</BlockEmpty>
      )}
    </WidgetSurface>
  );
});

// ==================== 8. La note du jour ====================

export const DAILY_NOTE_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

export const DailyNoteWidget: React.FC<WidgetProps> = React.memo(function DailyNoteWidget({
  options,
}) {
  const { t, i18n } = useTranslation();
  const actions = useHomeActions();

  // La date locale au format ISO court. ⚠ `toISOString()` est en UTC : passé
  // 20 h à Paris il rend DEMAIN, et le bloc ouvrirait la note du lendemain.
  const today = useMemo(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }, []);

  const note = useSelector((state: RootState) =>
    state.notes.allIds
      .map((id) => state.notes.byId[id])
      .find((n) => n && !n.deletedAt && n.isDaily && n.dailyDate === today)
  );

  const long = useMemo(
    () =>
      new Date(`${today}T12:00:00`).toLocaleDateString(i18n.language, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    [today, i18n.language]
  );

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.dailyNote')}>
      <div className="blk-stack blk-stack--center">
        <p className="blk-daily-date">{long}</p>
        {note ? (
          <>
            <p className="blk-excerpt">{excerpt(note) || t('home.blocks.dailyEmpty')}</p>
            <button
              type="button"
              className="blk-action blk-action--start"
              onClick={() => actions.openDailyNote(today)}
            >
              {t('home.blocks.dailyOpen')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="blk-action blk-action--start"
            onClick={() => actions.openDailyNote(today)}
          >
            {t('home.blocks.dailyCreate')}
          </button>
        )}
      </div>
    </WidgetSurface>
  );
});

// ==================== 9. Les carrefours ====================

export const NOTE_HUBS_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

/**
 * Les notes vers lesquelles le plus d'autres notes pointent.
 *
 * ⚠ On compte les liens ENTRANTS, pas les sortants. Une note qui cite trente
 * autres notes n'est pas un carrefour : c'est un sommaire. Un carrefour, c'est
 * ce vers quoi on revient — et cela ne se lit que dans les liens des AUTRES.
 */
export const NoteHubsWidget: React.FC<WidgetProps> = React.memo(function NoteHubsWidget({
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const notes = useSelector(selectAuthoredNotesByRecency);

  const hubs = useMemo(() => {
    const incoming = new Map<string, number>();
    for (const note of notes) {
      for (const target of note.linkedNoteIds ?? []) {
        incoming.set(target, (incoming.get(target) ?? 0) + 1);
      }
    }
    return notes
      .map((note) => ({ note, count: incoming.get(note.id) ?? 0 }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [notes]);

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.noteHubs')}>
      {hubs.length > 0 ? (
        <div className="blk-lines">
          {hubs.map(({ note, count }) => (
            <NoteLine
              key={note.id}
              note={note}
              meta={t('home.blocks.linkCount', { count })}
              onOpen={() => actions.openNote(note.id)}
            />
          ))}
        </div>
      ) : (
        <BlockEmpty glyph="link">{t('home.blocks.noHubs')}</BlockEmpty>
      )}
    </WidgetSurface>
  );
});

export function isNoteHubsEmpty(state: RootState): boolean {
  const notes = selectAuthoredNotesByRecency(state);
  return !notes.some((note) => (note.linkedNoteIds ?? []).length > 0);
}

// ==================== 10. Les orphelines ====================

export const ORPHAN_NOTES_OPTIONS: WidgetOptionSchema = [
  FRAME_OPTION,
  {
    kind: 'enum',
    key: 'scope',
    labelKey: 'home.widgets.opt.orphanScope',
    fallback: 'isolated',
    choices: [
      { value: 'isolated', labelKey: 'home.widgets.opt.orphanIsolated' },
      { value: 'unlinked', labelKey: 'home.widgets.opt.orphanUnlinked' },
    ],
  },
];

/**
 * Les notes que rien ne relie — donc celles qu'on ne retrouvera jamais.
 *
 * Deux portées, et la distinction n'est pas cosmétique :
 *   · ISOLÉE — ni lien entrant NI lien sortant. La note vraiment perdue.
 *   · SANS RETOUR — aucun lien ENTRANT, même si elle cite d'autres notes. Une
 *     note qui pointe partout et vers laquelle rien ne pointe est un cul-de-sac
 *     qu'on a écrit puis quitté.
 */
export const OrphanNotesWidget: React.FC<WidgetProps> = React.memo(function OrphanNotesWidget({
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const notes = useSelector(selectAuthoredNotesByRecency);
  const scope = readEnumOption(ORPHAN_NOTES_OPTIONS, options, 'scope');

  const orphans = useMemo(() => {
    const linkedTo = new Set<string>();
    for (const note of notes) for (const id of note.linkedNoteIds ?? []) linkedTo.add(id);
    return notes
      .filter((note) => {
        const hasIncoming = linkedTo.has(note.id);
        if (scope === 'unlinked') return !hasIncoming;
        return !hasIncoming && (note.linkedNoteIds ?? []).length === 0;
      })
      .slice(0, 8);
  }, [notes, scope]);

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.orphanNotes')}>
      {orphans.length > 0 ? (
        <div className="blk-lines">
          {orphans.map((note) => (
            <NoteLine key={note.id} note={note} onOpen={() => actions.openNote(note.id)} />
          ))}
        </div>
      ) : (
        // Une félicitation, pas un vide. Zéro orpheline est un RÉSULTAT.
        <BlockEmpty glyph="link">{t('home.blocks.noOrphans')}</BlockEmpty>
      )}
    </WidgetSurface>
  );
});
