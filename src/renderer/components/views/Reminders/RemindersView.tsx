/**
 * RemindersView — dedicated route for managing reminders
 *
 * Lives at `/reminders`. Lists all reminders across folders and files,
 * grouped by status (overdue / upcoming / done) with inline actions:
 * snooze (10min / 1h / 1d), mark done, open the source item.
 *
 * Data lives inside folders and files (Folder.reminders, FileItem
 * reminders). We don't have a dedicated remindersSlice — instead we
 * derive the full list by walking foldersById and filesById once, which
 * is cheap given typical vault sizes.
 */

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import type { RootState } from '../../../../store';
import type { Folder, FileItem, Reminder } from '../../../../types';
import './RemindersView.css';

type ReminderWithContext = Reminder & {
  // For folder/file reminders, the folder id to navigate to. Undefined
  // for note reminders (we use the note id + /notes/<id> route instead).
  parentFolderId?: string;
};

export const RemindersView: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const ipc = window.electron?.ipcRenderer;

  // Highlighted reminder id (from ?highlight=… query param, e.g. when the
  // user clicks an OS notification). We scroll the matching row into view
  // and flash it briefly, then clear so a re-render doesn't keep flashing.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('highlight');
    if (!id) return;
    setHighlightId(id);
    const clearTimer = setTimeout(() => setHighlightId(null), 2200);
    return () => clearTimeout(clearTimer);
  }, [location.search]);
  useEffect(() => {
    if (!highlightId) return;
    // Defer one frame so the row is rendered before we scroll
    const raf = requestAnimationFrame(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightId]);

  const foldersById = useSelector((s: RootState) => s.folders.byId);
  const filesById = useSelector((s: RootState) => s.files.byId);

  // Refresh trigger: bumped whenever main signals a reminder-fired event,
  // so the page reflects the freshly-completed reminder on next render.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (!ipc) return;
    const handler = () => setRefreshTick((n) => n + 1);
    ipc.on('reminder-fired', handler);
    return () => ipc.removeListener('reminder-fired', handler);
  }, [ipc]);

  // Source of truth: main process's getAllReminders walks folders, files,
  // calendar reminders AND note reminders (notes.enc lives in the
  // renderer so we can't walk note.reminders from main — they're kept
  // in a sibling noteReminders.json instead). We re-fetch whenever
  // Redux state changes (folders/files updated) or a reminder fires.
  const [allReminders, setAllReminders] = useState<ReminderWithContext[]>([]);
  useEffect(() => {
    if (!ipc) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = ((await ipc.invoke('getAllReminders')) as Reminder[]) || [];
        const mapped: ReminderWithContext[] = raw.map((r) => {
          if (r.itemType === 'folder') {
            return { ...r, parentFolderId: r.itemId };
          }
          if (r.itemType === 'file') {
            const parent = (Object.values(foldersById) as Folder[]).find((f) =>
              f.items.includes(r.itemId)
            );
            return { ...r, parentFolderId: parent?.id };
          }
          // note (or unknown) — no parent folder, openItem routes by id
          return { ...r };
        });
        if (!cancelled) setAllReminders(mapped);
      } catch (err) {
        console.warn('[RemindersView] getAllReminders failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ipc, refreshTick, foldersById, filesById]);

  const now = Date.now();
  const HORIZON_UPCOMING = 7 * 24 * 60 * 60 * 1000; // 7 days

  const { overdue, upcoming, later, done } = useMemo(() => {
    const overdue: ReminderWithContext[] = [];
    const upcoming: ReminderWithContext[] = [];
    const later: ReminderWithContext[] = [];
    const done: ReminderWithContext[] = [];
    for (const r of allReminders) {
      if (isDone(r)) {
        done.push(r);
        continue;
      }
      const fireAt = new Date(r.snoozedUntil ?? r.date).getTime();
      if (Number.isNaN(fireAt)) continue;
      if (fireAt < now) overdue.push(r);
      else if (fireAt - now <= HORIZON_UPCOMING) upcoming.push(r);
      else later.push(r);
    }
    const byFireAt = (a: ReminderWithContext, b: ReminderWithContext) =>
      new Date(a.snoozedUntil ?? a.date).getTime() - new Date(b.snoozedUntil ?? b.date).getTime();
    overdue.sort(byFireAt);
    upcoming.sort(byFireAt);
    later.sort(byFireAt);
    done.sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.date).getTime() - new Date(a.updatedAt ?? a.date).getTime()
    );
    return { overdue, upcoming, later, done };
  }, [allReminders, now]);

  const handleSnooze = useCallback(
    async (r: ReminderWithContext, minutes: number) => {
      if (!ipc) return;
      try {
        await ipc.invoke('snoozeReminder', {
          itemId: r.itemId,
          reminderId: r.id,
          minutes,
          itemType: r.itemType,
        });
        setRefreshTick((n) => n + 1);
      } catch (err) {
        console.warn('[RemindersView] snooze failed:', err);
      }
    },
    [ipc]
  );

  const updateReminderDispatch = useCallback(
    async (r: ReminderWithContext, updates: Partial<Reminder>) => {
      if (!ipc) return;
      if (r.itemType === 'note') {
        await ipc.invoke('updateReminderForNote', {
          noteId: r.itemId,
          reminderId: r.id,
          updates,
        });
      } else {
        await ipc.invoke('updateReminder', r.itemId, r.id, updates);
      }
    },
    [ipc]
  );

  const handleComplete = useCallback(
    async (r: ReminderWithContext) => {
      try {
        await updateReminderDispatch(r, {
          completed: true,
          isCompleted: true,
          updatedAt: new Date().toISOString(),
        });
        setRefreshTick((n) => n + 1);
      } catch (err) {
        console.warn('[RemindersView] complete failed:', err);
      }
    },
    [updateReminderDispatch]
  );

  const handleReopen = useCallback(
    async (r: ReminderWithContext) => {
      try {
        await updateReminderDispatch(r, {
          completed: false,
          isCompleted: false,
          updatedAt: new Date().toISOString(),
        });
        setRefreshTick((n) => n + 1);
      } catch (err) {
        console.warn('[RemindersView] reopen failed:', err);
      }
    },
    [updateReminderDispatch]
  );

  const handleMarkAllOverdueDone = useCallback(
    async (items: ReminderWithContext[]) => {
      if (!ipc) return;
      if (items.length === 0) return;
      const confirmMsg = t('reminders.confirmMarkAllDone', {
        defaultValue: 'Marquer {{count}} rappel(s) en retard comme fait(s) ?',
        count: items.length,
      }) as string;
      if (!confirm(confirmMsg)) return;
      const now = new Date().toISOString();
      for (const r of items) {
        try {
           
          await updateReminderDispatch(r, {
            completed: true,
            isCompleted: true,
            updatedAt: now,
          });
        } catch (err) {
          console.warn('[RemindersView] bulk complete failed for', r.id, err);
        }
      }
      setRefreshTick((n) => n + 1);
    },
    [ipc, t, updateReminderDispatch]
  );

  const handleClearCompleted = useCallback(
    async (items: ReminderWithContext[]) => {
      if (!ipc) return;
      if (items.length === 0) return;
      const confirmMsg = t('reminders.confirmClearCompleted', {
        defaultValue: 'Supprimer définitivement {{count}} rappel(s) terminé(s) ?',
        count: items.length,
      }) as string;
      if (!confirm(confirmMsg)) return;
      for (const r of items) {
        try {
           
          if (r.itemType === 'note') {
            await ipc.invoke('deleteReminderFromNote', {
              noteId: r.itemId,
              reminderId: r.id,
            });
          } else {
            await ipc.invoke('deleteReminder', r.itemId, r.id);
          }
        } catch (err) {
          console.warn('[RemindersView] bulk delete failed for', r.id, err);
        }
      }
      setRefreshTick((n) => n + 1);
    },
    [ipc, t]
  );

  const handleDelete = useCallback(
    async (r: ReminderWithContext) => {
      if (!ipc) return;
      if (!confirm(t('reminders.confirmDelete', 'Supprimer ce rappel ?') as string)) return;
      try {
        if (r.itemType === 'note') {
          await ipc.invoke('deleteReminderFromNote', {
            noteId: r.itemId,
            reminderId: r.id,
          });
        } else {
          await ipc.invoke('deleteReminder', r.itemId, r.id);
        }
        setRefreshTick((n) => n + 1);
      } catch (err) {
        console.warn('[RemindersView] delete failed:', err);
      }
    },
    [ipc, t]
  );

  const handleOpenItem = useCallback(
    (r: ReminderWithContext) => {
      if (r.itemType === 'note') {
        navigate(`/notes/${r.itemId}`);
        return;
      }
      if (r.parentFolderId) {
        navigate(`/folder/${r.parentFolderId}`);
      }
    },
    [navigate]
  );

  const totalActive = overdue.length + upcoming.length + later.length;

  return (
    <div className="reminders-view">
      <div className="reminders-view__container">
        <header className="reminders-view__header">
          <div className="reminders-view__icon" aria-hidden="true">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </div>
          <div>
            <h1 className="reminders-view__title">{t('reminders.pageTitle', 'Mes rappels')}</h1>
            <p className="reminders-view__subtitle">
              {t('reminders.pageSubtitle', {
                defaultValue: '{{count}} rappel(s) actif(s) · {{done}} terminé(s)',
                count: totalActive,
                done: done.length,
              })}
            </p>
          </div>
        </header>

        {totalActive === 0 && done.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {overdue.length > 0 && (
              <Section
                title={t('reminders.section.overdue', 'En retard')}
                tone="overdue"
                items={overdue}
                onSnooze={handleSnooze}
                onComplete={handleComplete}
                onDelete={handleDelete}
                onOpen={handleOpenItem}
                highlightId={highlightId}
                highlightRef={highlightRef}
                bulkAction={
                  overdue.length > 1
                    ? {
                        label: t('reminders.bulk.markAllDone', 'Tout marquer fait'),
                        onClick: () => handleMarkAllOverdueDone(overdue),
                      }
                    : undefined
                }
              />
            )}
            {upcoming.length > 0 && (
              <Section
                title={t('reminders.section.upcoming', 'À venir (7 jours)')}
                tone="upcoming"
                items={upcoming}
                onSnooze={handleSnooze}
                onComplete={handleComplete}
                onDelete={handleDelete}
                onOpen={handleOpenItem}
                highlightId={highlightId}
                highlightRef={highlightRef}
              />
            )}
            {later.length > 0 && (
              <Section
                title={t('reminders.section.later', 'Plus tard')}
                tone="later"
                items={later}
                onSnooze={handleSnooze}
                onComplete={handleComplete}
                onDelete={handleDelete}
                onOpen={handleOpenItem}
                highlightId={highlightId}
                highlightRef={highlightRef}
              />
            )}
            {done.length > 0 && (
              <DoneSection
                title={t('reminders.section.done', 'Terminés')}
                items={done}
                onReopen={handleReopen}
                onDelete={handleDelete}
                onOpen={handleOpenItem}
                bulkAction={
                  done.length > 1
                    ? {
                        label: t('reminders.bulk.clearCompleted', 'Effacer terminés'),
                        onClick: () => handleClearCompleted(done),
                      }
                    : undefined
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ───────────────────────── Sections ─────────────────────────

const Section: FC<{
  title: string;
  tone: 'overdue' | 'upcoming' | 'later';
  items: ReminderWithContext[];
  onSnooze: (r: ReminderWithContext, minutes: number) => void;
  onComplete: (r: ReminderWithContext) => void;
  onDelete: (r: ReminderWithContext) => void;
  onOpen: (r: ReminderWithContext) => void;
  highlightId?: string | null;
  highlightRef?: React.MutableRefObject<HTMLDivElement | null>;
  bulkAction?: { label: string; onClick: () => void };
}> = ({
  title,
  tone,
  items,
  onSnooze,
  onComplete,
  onDelete,
  onOpen,
  highlightId,
  highlightRef,
  bulkAction,
}) => {
  return (
    <section className="reminders-section">
      <h2 className={`reminders-section__title reminders-section__title--${tone}`}>
        {title}
        <span className="reminders-section__count">{items.length}</span>
        {bulkAction && (
          <button type="button" className="reminders-section__bulk" onClick={bulkAction.onClick}>
            {bulkAction.label}
          </button>
        )}
      </h2>
      <div className="reminders-section__list">
        {items.map((r) => (
          <ReminderRow
            key={r.id}
            r={r}
            tone={tone}
            onSnooze={onSnooze}
            onComplete={onComplete}
            onDelete={onDelete}
            onOpen={onOpen}
            isHighlighted={highlightId === r.id}
            rowRef={highlightId === r.id ? highlightRef : undefined}
          />
        ))}
      </div>
    </section>
  );
};

const DoneSection: FC<{
  title: string;
  items: ReminderWithContext[];
  onReopen: (r: ReminderWithContext) => void;
  onDelete: (r: ReminderWithContext) => void;
  onOpen: (r: ReminderWithContext) => void;
  bulkAction?: { label: string; onClick: () => void };
}> = ({ title, items, onReopen, onDelete, onOpen, bulkAction }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 5);
  return (
    <section className="reminders-section">
      <h2 className="reminders-section__title reminders-section__title--done">
        {title}
        <span className="reminders-section__count">{items.length}</span>
        {bulkAction && (
          <button type="button" className="reminders-section__bulk" onClick={bulkAction.onClick}>
            {bulkAction.label}
          </button>
        )}
      </h2>
      <div className="reminders-section__list">
        {visible.map((r) => (
          <DoneReminderRow
            key={r.id}
            r={r}
            onReopen={onReopen}
            onDelete={onDelete}
            onOpen={onOpen}
          />
        ))}
        {items.length > 5 && (
          <button
            type="button"
            className="reminders-section__expand"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '— Voir moins' : `+ ${items.length - 5} de plus`}
          </button>
        )}
      </div>
    </section>
  );
};

// ───────────────────────── Rows ─────────────────────────

const ReminderRow: FC<{
  r: ReminderWithContext;
  tone: 'overdue' | 'upcoming' | 'later';
  onSnooze: (r: ReminderWithContext, minutes: number) => void;
  onComplete: (r: ReminderWithContext) => void;
  onDelete: (r: ReminderWithContext) => void;
  onOpen: (r: ReminderWithContext) => void;
  isHighlighted?: boolean;
  rowRef?: React.MutableRefObject<HTMLDivElement | null>;
}> = ({ r, tone, onSnooze, onComplete, onDelete, onOpen, isHighlighted, rowRef }) => {
  const { t } = useTranslation();
  const fireAt = new Date(r.snoozedUntil ?? r.date);
  const isSnoozed = !!r.snoozedUntil && new Date(r.snoozedUntil).getTime() > Date.now();
  const message = (r.message || (r as any).description || '').trim();

  return (
    <div
      ref={rowRef}
      className={`reminder-row reminder-row--${tone}${isHighlighted ? ' reminder-row--flash' : ''}`}
    >
      <div className="reminder-row__main">
        <div className="reminder-row__name">
          <span className="reminder-row__type-badge" data-type={r.itemType}>
            {r.itemType === 'folder' ? '📁' : r.itemType === 'note' ? '📝' : '📄'}
          </span>
          <button
            type="button"
            className="reminder-row__item-link"
            onClick={() => onOpen(r)}
            title={t('reminders.openItem', "Ouvrir l'élément") as string}
          >
            {r.itemName}
          </button>
          {r.recurring && r.recurring !== 'none' && (
            <span className="reminder-row__recurring" title={r.recurring}>
              ↻ {r.recurring}
            </span>
          )}
          {isSnoozed && (
            <span className="reminder-row__snoozed">
              {t('reminders.snoozedUntil', 'Reporté jusque {{when}}', {
                when: formatRelative(fireAt),
              })}
            </span>
          )}
        </div>
        {message && <p className="reminder-row__message">{message}</p>}
        <p className="reminder-row__time">
          {formatAbsolute(fireAt)} · {formatRelative(fireAt)}
        </p>
      </div>
      <div className="reminder-row__actions">
        <button
          type="button"
          className="reminder-row__action"
          onClick={() => onSnooze(r, 10)}
          title={t('reminders.action.snooze10', 'Reporter 10 min') as string}
        >
          +10m
        </button>
        <button
          type="button"
          className="reminder-row__action"
          onClick={() => onSnooze(r, 60)}
          title={t('reminders.action.snooze1h', 'Reporter 1h') as string}
        >
          +1h
        </button>
        <button
          type="button"
          className="reminder-row__action"
          onClick={() => onSnooze(r, 24 * 60)}
          title={t('reminders.action.snooze1d', 'Reporter 1 jour') as string}
        >
          +1j
        </button>
        <button
          type="button"
          className="reminder-row__action reminder-row__action--primary"
          onClick={() => onComplete(r)}
          title={t('reminders.action.complete', 'Marquer comme fait') as string}
        >
          ✓
        </button>
        <button
          type="button"
          className="reminder-row__action reminder-row__action--danger"
          onClick={() => onDelete(r)}
          title={t('reminders.action.delete', 'Supprimer') as string}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

const DoneReminderRow: FC<{
  r: ReminderWithContext;
  onReopen: (r: ReminderWithContext) => void;
  onDelete: (r: ReminderWithContext) => void;
  onOpen: (r: ReminderWithContext) => void;
}> = ({ r, onReopen, onDelete, onOpen }) => {
  const { t } = useTranslation();
  const message = (r.message || (r as any).description || '').trim();
  return (
    <div className="reminder-row reminder-row--done">
      <div className="reminder-row__main">
        <div className="reminder-row__name">
          <span className="reminder-row__type-badge" data-type={r.itemType}>
            {r.itemType === 'folder' ? '📁' : r.itemType === 'note' ? '📝' : '📄'}
          </span>
          <button
            type="button"
            className="reminder-row__item-link reminder-row__item-link--done"
            onClick={() => onOpen(r)}
          >
            {r.itemName}
          </button>
        </div>
        {message && <p className="reminder-row__message reminder-row__message--done">{message}</p>}
        <p className="reminder-row__time">{formatAbsolute(new Date(r.updatedAt ?? r.date))}</p>
      </div>
      <div className="reminder-row__actions">
        <button
          type="button"
          className="reminder-row__action"
          onClick={() => onReopen(r)}
          title={t('reminders.action.reopen', 'Rouvrir') as string}
        >
          ↩
        </button>
        <button
          type="button"
          className="reminder-row__action reminder-row__action--danger"
          onClick={() => onDelete(r)}
          title={t('reminders.action.delete', 'Supprimer') as string}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

const EmptyState: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="reminders-empty">
      <p className="reminders-empty__title">
        {t('reminders.empty.title', 'Aucun rappel pour le moment')}
      </p>
      <p className="reminders-empty__hint">
        {t(
          'reminders.empty.hint',
          'Ajoutez un rappel sur un fichier ou un dossier via le menu contextuel (clic droit) pour le voir apparaître ici.'
        )}
      </p>
    </div>
  );
};

// ───────────────────────── Helpers ─────────────────────────

function isDone(r: Reminder): boolean {
  return !!(r.completed || (r as any).isCompleted);
}

function formatAbsolute(d: Date): string {
  try {
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

function formatRelative(d: Date): string {
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  const future = diff >= 0;
  let value: string;
  if (abs < min) value = future ? 'dans quelques secondes' : "à l'instant";
  else if (abs < hour) value = `${Math.round(abs / min)} min${future ? '' : ' passées'}`;
  else if (abs < day) value = `${Math.round(abs / hour)}h${future ? '' : ' passées'}`;
  else value = `${Math.round(abs / day)}j${future ? '' : ' passés'}`;
  return future ? `dans ${value}` : `il y a ${value}`;
}

export default RemindersView;
