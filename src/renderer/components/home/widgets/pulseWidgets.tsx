/**
 * LES BLOCS DU POULS — ce que l'application SAIT sur elle-même.
 *
 * ── DEUX FAMILLES QUI N'ONT RIEN À VOIR ─────────────────────────────────────
 *
 * Trois de ces blocs racontent CE QU'ON A FAIT (activité, écriture, horloge) ;
 * deux racontent DANS QUEL ÉTAT EST LA MACHINE (synchronisation, coffres).
 *
 * Les seconds sont les seuls blocs de tout le catalogue qui peuvent annoncer
 * une MAUVAISE nouvelle. Ils suivent donc une règle que les autres n'ont pas :
 * ils ne se taisent JAMAIS quand quelque chose ne va pas. Un bloc « Synchro »
 * qui disparaît parce qu'il n'a rien de gai à dire est exactement le bloc qu'on
 * accusera, à raison, de nous avoir caché la panne.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import {
  computeRemainingMs,
  selectTodayPomodoroStats,
  showWidget as showPomodoroWidget,
} from '../../../../store/slices/pomodoroSlice';
import { selectAuthoredNotesByRecency } from '../homeSelectors';
import {
  readEnumOption,
  readTextOption,
  type WidgetOptionSchema,
  type WidgetProps,
} from '../widgetOptions';
import { frameOf, FRAME_OPTION, WidgetSurface } from './WidgetSurface';
import { useRelativeTime } from './relativeTime';
import { BlockEmpty } from './BlockEmpty';
import './blocks.css';

/** La date locale au format `YYYY-MM-DD`. */
function localDay(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// ==================== 16. Carte d'activité ====================

export const ACTIVITY_OPTIONS: WidgetOptionSchema = [
  FRAME_OPTION,
  {
    kind: 'enum',
    key: 'span',
    labelKey: 'home.widgets.opt.activitySpan',
    fallback: 'quarter',
    choices: [
      { value: 'month', labelKey: 'home.widgets.opt.activityMonth' },
      { value: 'quarter', labelKey: 'home.widgets.opt.activityQuarter' },
      { value: 'year', labelKey: 'home.widgets.opt.activityYear' },
    ],
  },
];

/**
 * Une case par jour, teintée par le nombre de notes touchées.
 *
 * ── LES CINQ NIVEAUX NE SONT PAS LINÉAIRES ──────────────────────────────────
 *
 * Répartir la couleur proportionnellement au maximum donne une carte presque
 * entièrement vide dès qu'UN SEUL jour sort du lot — une journée à trente notes
 * écrase les cent quatre-vingts autres à la nuance la plus pâle. Les seuils
 * sont donc FIXES (1, 3, 6, 10) : ils décrivent une habitude d'écriture, pas un
 * rapport au record.
 *
 * ⚠ Le jour se calcule en heure LOCALE. `toISOString()` bascule à minuit UTC,
 * donc une note écrite à 23 h à Paris compterait pour le lendemain — et la
 * dernière case, celle d'aujourd'hui, resterait vide juste après qu'on ait
 * écrit.
 */
export const ActivityWidget: React.FC<WidgetProps> = React.memo(function ActivityWidget({
  options,
}) {
  const { t, i18n } = useTranslation();
  const notes = useSelector(selectAuthoredNotesByRecency);
  const span = readEnumOption(ACTIVITY_OPTIONS, options, 'span');
  const weeks = span === 'month' ? 5 : span === 'year' ? 52 : 13;

  /**
   * Les cases, alignées sur des SEMAINES ENTIÈRES.
   *
   * ⚠ On ne part pas « il y a N jours » : la première colonne serait alors une
   * semaine tronquée, et les lignes horizontales ne correspondraient plus à un
   * jour de la semaine — ce que la colonne d'initiales promet pourtant. On
   * remonte donc au lundi de la première semaine.
   */
  const { cells, months, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      const day = note.updatedAt ? localDay(new Date(note.updatedAt)) : null;
      if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
    }

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    // `getDay()` rend 0 pour dimanche : on ramène la semaine au lundi, qui est
    // le premier jour affiché par la colonne d'initiales.
    const offsetToMonday = (today.getDay() + 6) % 7;
    const start = new Date(today);
    start.setDate(today.getDate() - offsetToMonday - (weeks - 1) * 7);

    const out: { day: string; count: number; date: Date; future: boolean }[] = [];
    const monthRuns: { label: string; span: number }[] = [];
    for (let i = 0; i < weeks * 7; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const day = localDay(date);
      out.push({ day, count: counts.get(day) ?? 0, date, future: date > today });

      // Une étiquette de mois par COLONNE (le lundi), fusionnée avec la
      // précédente quand c'est le même mois : douze « août » côte à côte ne
      // diraient rien de plus qu'un seul.
      if (i % 7 === 0) {
        const label = date.toLocaleDateString(i18n.language, { month: 'short' });
        const last = monthRuns[monthRuns.length - 1];
        if (last && last.label === label) last.span += 1;
        else monthRuns.push({ label, span: 1 });
      }
    }

    return {
      cells: out,
      months: monthRuns,
      total: out.reduce((sum, cell) => sum + cell.count, 0),
    };
  }, [notes, weeks, i18n.language]);

  const level = (count: number): number =>
    count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;

  /** Les initiales des jours, une ligne sur deux — sept d'affilée font du bruit. */
  const dayInitials = useMemo(() => {
    const monday = new Date(2026, 0, 5); // un lundi, peu importe lequel
    return Array.from({ length: 7 }, (_, i) => {
      if (i % 2 === 1) return '';
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.toLocaleDateString(i18n.language, { weekday: 'narrow' });
    });
  }, [i18n.language]);

  return (
    <WidgetSurface
      frame={frameOf(options)}
      label={t('home.widgets.activity')}
      actions={
        <span className="blk-line__meta">{t('home.blocks.activityTotal', { count: total })}</span>
      }
    >
      <div className="blk-heat-wrap">
        <div className="blk-heat-days" aria-hidden="true">
          {dayInitials.map((initial, i) => (
            <span key={i}>{initial}</span>
          ))}
        </div>
        <div>
          <div className="blk-heat-months" aria-hidden="true">
            {months.map((run, i) => (
              // 14 px = une case de 11 px plus la gouttière de 3.
              <span key={`${run.label}-${i}`} style={{ width: run.span * 14 }}>
                {run.label}
              </span>
            ))}
          </div>
          <div
            className="blk-heat"
            role="img"
            aria-label={t('home.blocks.activityTotal', { count: total })}
          >
            {cells.map((cell) => (
              <span
                key={cell.day}
                className={`blk-heat__cell blk-heat__cell--${cell.future ? 0 : level(cell.count)}`}
                style={cell.future ? { opacity: 0.35 } : undefined}
                title={`${cell.date.toLocaleDateString(i18n.language, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })} · ${t('home.blocks.activityDay', { count: cell.count })}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* LA LÉGENDE. Sans elle, la couleur ne veut rien dire -- et c'est
          exactement ce que ce bloc s'entendait reprocher. */}
      <div className="blk-heat-legend">
        <span>{t('home.blocks.heatLess')}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`blk-heat__cell blk-heat__cell--${l}`} />
        ))}
        <span>{t('home.blocks.heatMore')}</span>
      </div>
    </WidgetSurface>
  );
});

// ==================== 17. Chiffres d'écriture ====================

export const WRITING_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

export const WritingStatsWidget: React.FC<WidgetProps> = React.memo(function WritingStatsWidget({
  options,
}) {
  const { t } = useTranslation();
  const notes = useSelector(selectAuthoredNotesByRecency);

  const stats = useMemo(() => {
    const today = localDay(new Date());
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    let words = 0;
    let todayCount = 0;
    let weekCount = 0;
    for (const note of notes) {
      words += note.wordCount ?? 0;
      const updated = note.updatedAt ? new Date(note.updatedAt) : null;
      if (updated && localDay(updated) === today) todayCount += 1;
      if (updated && updated >= weekAgo) weekCount += 1;
    }
    return {
      words,
      todayCount,
      weekCount,
      // La moyenne se calcule sur les notes NON VIDES : compter les brouillons
      // à zéro mot ferait chuter le chiffre sans que rien ne l'explique.
      average: (() => {
        const written = notes.filter((n) => (n.wordCount ?? 0) > 0);
        return written.length ? Math.round(words / written.length) : 0;
      })(),
    };
  }, [notes]);

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.writingStats')}>
      <div className="blk-figures">
        <div className="blk-figure">
          <strong>{stats.words.toLocaleString()}</strong>
          <span>{t('home.blocks.words')}</span>
        </div>
        <div className="blk-figure">
          <strong>{stats.todayCount}</strong>
          <span>{t('home.blocks.touchedToday')}</span>
        </div>
        <div className="blk-figure">
          <strong>{stats.weekCount}</strong>
          <span>{t('home.blocks.touchedWeek')}</span>
        </div>
        <div className="blk-figure">
          <strong>{stats.average}</strong>
          <span>{t('home.blocks.averageWords')}</span>
        </div>
      </div>
    </WidgetSurface>
  );
});

// ==================== 18. État de la synchronisation ====================

export const SYNC_STATUS_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

/**
 * ⚠ CE BLOC NE DISPARAÎT JAMAIS — voir l'en-tête du fichier.
 *
 * Il n'a délibérément AUCUN `isEmpty`. Un bloc d'état qui s'efface quand tout
 * va bien s'efface aussi la première fois qu'on aurait eu besoin de lui, et son
 * absence se lit alors comme « rien à signaler ».
 */
export const SyncStatusWidget: React.FC<WidgetProps> = React.memo(function SyncStatusWidget({
  options,
}) {
  const { t } = useTranslation();
  const relative = useRelativeTime();
  const sync = useSelector((state: RootState) => state.sync);

  const tone =
    sync.state === 'error' ? 'danger' : sync.conflicts > 0 || sync.failedItems > 0 ? 'warn' : 'ok';

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.syncStatus')}>
      <div className="blk-stack">
        <p className={`blk-status blk-status--${tone}`}>
          {t(`home.blocks.sync.${tone}`)}
          {sync.lastSyncAt && (
            <span className="blk-line__meta"> · {relative(sync.lastSyncAt)}</span>
          )}
        </p>
        <div className="blk-figures blk-figures--tight">
          <div className="blk-figure">
            <strong>{sync.pendingItems}</strong>
            <span>{t('home.blocks.pending')}</span>
          </div>
          <div className="blk-figure">
            <strong>{sync.conflicts}</strong>
            <span>{t('home.blocks.conflicts')}</span>
          </div>
          <div className="blk-figure">
            <strong>{sync.failedItems}</strong>
            <span>{t('home.blocks.failed')}</span>
          </div>
        </div>
        {/* La raison BRUTE du dernier échec. La cacher au profit d'un « erreur »
            générique est précisément ce qui rendait ce diagnostic impossible
            à faire depuis l'écran. */}
        {sync.lastError && <p className="blk-status__detail">{sync.lastError}</p>}
      </div>
    </WidgetSurface>
  );
});

// ==================== 19. Les coffres ====================

export const VAULT_STATUS_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

export const VaultStatusWidget: React.FC<WidgetProps> = React.memo(function VaultStatusWidget({
  options,
}) {
  const { t } = useTranslation();
  const vaultIds = useSelector((state: RootState) => state.vaults.vaultIds);
  const vaults = useSelector((state: RootState) => state.vaults.vaults);
  const itemsByVault = useSelector((state: RootState) => state.vaults.itemsByVault);

  const rows = useMemo(
    () =>
      vaultIds
        .map((id) => vaults[id])
        .filter(Boolean)
        .slice(0, 8)
        .map((vault) => ({
          vault,
          count: itemsByVault[vault.id]?.length ?? 0,
          /**
           * LA CLÉ RESTÉE EN ARRIÈRE.
           *
           * Une rotation est passée sans que personne ne nous ait re-scellé la
           * clé du coffre : on en est membre, on le voit, et on ne peut pas
           * lire ce qui y a été écrit depuis. `vaultsSlice` note lui-même que
           * l'écran confondait cet état avec un coffre simplement verrouillé —
           * c'est exactement le genre de mauvaise nouvelle que ce bloc existe
           * pour dire.
           */
          stale: vault.wrappedVaultKeyEpoch < vault.currentKeyEpoch,
          // Un nom vide signifie que le coffre n'a PAS pu être déchiffré. Le
          // rendre par un tiret laisserait croire à un coffre sans nom.
          unreadable: !vault.name,
        })),
    [vaultIds, vaults, itemsByVault]
  );

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.vaultStatus')}>
      {rows.length > 0 ? (
        <div className="blk-lines">
          {rows.map(({ vault, count, stale, unreadable }) => (
            <div key={vault.id} className="blk-line blk-line--static">
              <span className="blk-line__title">
                {unreadable ? t('home.blocks.vaultUnreadable') : vault.name}
              </span>
              <span className={`blk-line__meta${stale ? ' blk-line__meta--warn' : ''}`}>
                {stale ? t('home.blocks.vaultStale') : count}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <BlockEmpty glyph="vault">{t('home.blocks.noVaults')}</BlockEmpty>
      )}
    </WidgetSurface>
  );
});

export function isVaultStatusEmpty(state: RootState): boolean {
  return state.vaults.vaultIds.length === 0;
}

// ==================== 20. Horloge ====================

export const CLOCK_OPTIONS: WidgetOptionSchema = [
  FRAME_OPTION,
  {
    kind: 'enum',
    key: 'mode',
    labelKey: 'home.widgets.opt.clockMode',
    fallback: 'time',
    choices: [
      { value: 'time', labelKey: 'home.widgets.opt.clockTime' },
      { value: 'date', labelKey: 'home.widgets.opt.clockDate' },
      { value: 'both', labelKey: 'home.widgets.opt.clockBoth' },
      { value: 'countdown', labelKey: 'home.widgets.opt.clockCountdown' },
    ],
  },
  {
    kind: 'text',
    key: 'target',
    labelKey: 'home.widgets.opt.clockTarget',
    fallback: '',
    maxLength: 10,
    placeholderKey: 'home.widgets.opt.clockTargetPlaceholder',
  },
  {
    kind: 'text',
    key: 'caption',
    labelKey: 'home.widgets.opt.clockCaption',
    fallback: '',
    maxLength: 40,
  },
];

/**
 * L'heure, la date, ou le nombre de jours qui restent.
 *
 * ── LE MINUTEUR NE BAT QUE SI QUELQU'UN LE REGARDE ──────────────────────────
 *
 * Un `setInterval` d'une seconde qui vit tant que l'application est ouverte,
 * c'est un rendu React par seconde, indéfiniment, pour un bloc que personne ne
 * fixe. On bat donc à la MINUTE — la seule granularité que ce bloc affiche —
 * et l'intervalle est démonté avec le bloc.
 */
export const ClockWidget: React.FC<WidgetProps> = React.memo(function ClockWidget({ options }) {
  const { t, i18n } = useTranslation();
  const mode = readEnumOption(CLOCK_OPTIONS, options, 'mode');
  const target = readTextOption(CLOCK_OPTIONS, options, 'target');
  const caption = readTextOption(CLOCK_OPTIONS, options, 'caption');

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Un compte à rebours en JOURS n'a aucune raison de battre à la minute,
    // mais le coût d'un réveil par minute est nul devant celui d'un second
    // chemin de code à maintenir.
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const time = now.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  let primary = time;
  let secondary = caption;

  if (mode === 'date') {
    primary = date;
  } else if (mode === 'both') {
    primary = time;
    secondary = caption || date;
  } else if (mode === 'countdown') {
    // Une date illisible n'affiche PAS « NaN » : elle dit ce qu'il faut faire.
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(target) ? new Date(`${target}T00:00:00`) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      primary = '—';
      secondary = caption || t('home.blocks.countdownUnset');
    } else {
      const days = Math.ceil((parsed.getTime() - now.getTime()) / 86_400_000);
      primary = String(Math.abs(days));
      secondary =
        caption ||
        (days >= 0
          ? t('home.blocks.daysLeft', { count: days })
          : t('home.blocks.daysSince', { count: -days }));
    }
  }

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.clock')}>
      <div className="blk-clock">
        <p className="blk-clock__primary">{primary}</p>
        {secondary && <p className="blk-clock__secondary">{secondary}</p>}
      </div>
    </WidgetSurface>
  );
});

// ==================== Minuteur (Pomodoro) ====================

export const POMODORO_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

/** `MM:SS` — la même lecture que la fenêtre flottante, au caractère près. */
function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * LE MINUTEUR, EN BLOC D'ACCUEIL.
 *
 * ── POURQUOI IL EXISTE ──────────────────────────────────────────────────────
 *
 * Le minuteur du bureau n'était QU'une fenêtre flottante : le catalogue de
 * l'accueil n'avait rien qui lui corresponde. Le téléphone, lui, en a fait un
 * bloc (`filarr-mobile/src/services/layout/widgetCatalog.ts`, type `pomodoro`,
 * inscrit dans `MOBILE_ONLY_WIDGET_TYPES`). Conséquence : une disposition
 * d'accueil rangée sur le téléphone s'ouvrait ici avec un emplacement
 * « indisponible dans cette version » — le format le prévoit, l'emplacement
 * était gardé, mais le bloc ne revenait jamais. Il revient maintenant.
 *
 * MÊME IDENTIFIANT QUE LE MOBILE (`pomodoro`), mêmes bornes, même rôle par
 * défaut : c'est la condition pour qu'une disposition traverse. Un identifiant
 * différent aurait fait deux blocs jumeaux qui ne se reconnaissent pas.
 *
 * ── LE BLOC NE BAT QUE SI LE MINUTEUR COURT ─────────────────────────────────
 *
 * Un `setInterval` d'une seconde en permanence, c'est un rendu par seconde pour
 * un minuteur à l'arrêt — son état quatre-vingt-dix-neuf pour cent du temps. Le
 * battement est donc conditionné au statut, et démonté avec le bloc.
 *
 * ── IL N'EST PAS UNE SECONDE SOURCE DE VÉRITÉ ───────────────────────────────
 *
 * Rien n'est calculé ici : `computeRemainingMs` est celui du magasin, et le
 * clic ouvre la fenêtre flottante plutôt que d'ajouter des commandes qui
 * pourraient diverger d'elle. Deux minuteurs qui se commandent l'un l'autre,
 * c'est un état à réconcilier ; un minuteur et sa vitrine, non.
 */
export const PomodoroWidget: React.FC<WidgetProps> = React.memo(function PomodoroWidget({
  options,
  editing,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const pomodoro = useSelector((state: RootState) => state.pomodoro);
  const today = useSelector(selectTodayPomodoroStats);

  const [, setTick] = useState(0);
  useEffect(() => {
    if (pomodoro.status !== 'running') return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [pomodoro.status]);

  const remaining = computeRemainingMs(pomodoro);
  const phase = t(
    pomodoro.mode === 'focus'
      ? 'pomodoro.modeFocus'
      : pomodoro.mode === 'shortBreak'
        ? 'pomodoro.modeShortBreak'
        : 'pomodoro.modeLongBreak'
  );

  // À L'ARRÊT, le bloc dit ce qu'on a FAIT ; en marche, ce qu'on est en train
  // de faire. Un « Concentration » figé sur un minuteur arrêté ferait croire
  // qu'une session tourne. (Même règle que le bloc du téléphone.)
  const caption =
    pomodoro.status === 'idle'
      ? `${today.focusCount} ${t('pomodoro.statSessions', { count: today.focusCount })}`
      : phase;

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.pomodoro')}>
      <button
        type="button"
        className="blk-pomodoro"
        disabled={editing}
        onClick={() => dispatch(showPomodoroWidget())}
        aria-label={t('pomodoro.widgetLabel')}
      >
        <p
          className={
            pomodoro.status === 'running' ? 'blk-clock__primary is-running' : 'blk-clock__primary'
          }
        >
          {formatRemaining(remaining)}
        </p>
        <p className="blk-clock__secondary">{caption}</p>
      </button>
    </WidgetSurface>
  );
});
