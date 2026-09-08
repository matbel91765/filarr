/**
 * Reminder Scheduler
 *
 * Replaces the previous hourly scan-and-fire approach with precise per-
 * reminder setTimeout scheduling. Granularity is one second; a reminder
 * for 14:30:00 fires at 14:30:00 (modulo OS scheduling jitter), not "some
 * time between 14:00 and 15:00 if we're lucky".
 *
 * Responsibilities:
 *   - Schedule a setTimeout for every active (non-completed, non-past-or-
 *     within-catch-up-window) reminder.
 *   - When a timer fires: show a native Notification, mark the reminder
 *     as completed if non-recurring, or push its `date` forward by the
 *     recurring interval and re-schedule.
 *   - Honor `snoozedUntil`: if set and in the future, schedule against
 *     that timestamp instead of `date`.
 *   - Catch-up: on init, fire one notification for any reminders whose
 *     date is in the past but within MISSED_WINDOW_MS (so the user gets
 *     a "Missed: …" notification when reopening the app, but we don't
 *     spam them with ancient missed reminders).
 *   - Long-delay safeguard: setTimeout caps at ~24.8 days (2^31 ms). For
 *     anything further out we re-arm via a periodic refresh.
 *
 * The renderer triggers a re-schedule whenever a reminder is created,
 * updated, or deleted via the existing addReminder/updateReminder/
 * deleteReminder IPC handlers (main.ts calls back into here).
 */

import { Notification, BrowserWindow } from 'electron';
import StorageService from './storageService';

// Minimal Reminder shape used internally. Tolerant of the historical
// naming drift between the renderer (`completed`, `message`) and the
// electron storage layer (`isCompleted`, `description`).
interface Reminder {
  id: string;
  itemId?: string;
  itemName?: string;
  itemType?: 'file' | 'folder' | string;
  date: string;
  message?: string;
  description?: string;
  completed?: boolean;
  isCompleted?: boolean;
  snoozedUntil?: string;
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly';
  updatedAt?: string;
}

function isDone(r: Reminder): boolean {
  return !!(r.completed || r.isCompleted);
}

function reminderItemId(r: Reminder): string | null {
  return typeof r.itemId === 'string' && r.itemId.length > 0 ? r.itemId : null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface BuildNotificationInput {
  title: string;
  body: string;
  silent: boolean;
  reminderId: string;
  itemId: string;
  itemType: string;
}

/**
 * Build a Notification with the right shape per platform.
 *
 * - macOS: native `actions:` array, fires the `action` event with the
 *   index of the clicked button.
 * - Windows: raw `toastXml` with <action> elements whose `arguments`
 *   are filarr:// URIs. When the user clicks an action, Windows tries
 *   to activate filarr:// via the registered protocol client (see
 *   app.setAsDefaultProtocolClient in main.ts) — the second-instance
 *   handler picks up the URI from argv and dispatches snooze/done.
 *   In dev mode protocol activation can be flaky (electron.exe + dev
 *   args), but the buttons themselves render and the body click still
 *   routes through the standard `click` event below.
 * - Linux / other: plain notification, no actions.
 */
function buildPlatformNotification(input: BuildNotificationInput): Notification {
  const base = {
    title: input.title,
    body: input.body,
    silent: input.silent,
  };

  if (process.platform === 'darwin') {
    return new Notification({
      ...base,
      actions: [
        { type: 'button', text: 'Snooze 10 min' },
        { type: 'button', text: 'Mark done' },
      ],
    });
  }

  if (process.platform === 'win32') {
    const rid = encodeURIComponent(input.reminderId);
    const item = encodeURIComponent(input.itemId);
    const type = encodeURIComponent(input.itemType);
    const baseArgs = `id=${rid}&item=${item}&type=${type}`;
    const launchUri = escapeXml(`filarr://reminder?action=open&${baseArgs}`);
    const snoozeUri = escapeXml(`filarr://reminder?action=snooze&min=10&${baseArgs}`);
    const doneUri = escapeXml(`filarr://reminder?action=done&${baseArgs}`);
    const titleXml = escapeXml(input.title);
    const bodyXml = escapeXml(input.body);

    const toastXml = `<toast launch="${launchUri}" activationType="protocol">
  <visual>
    <binding template="ToastGeneric">
      <text>${titleXml}</text>
      <text>${bodyXml}</text>
    </binding>
  </visual>
  <actions>
    <action content="Snooze 10 min" arguments="${snoozeUri}" activationType="protocol"/>
    <action content="Mark done" arguments="${doneUri}" activationType="protocol"/>
  </actions>
</toast>`;

    return new Notification({ ...base, toastXml });
  }

  return new Notification(base);
}

// Maximum delay for a single setTimeout call. Beyond this, V8/libuv clamps
// to 1 and fires immediately, which would spam notifications. Use a soft
// cap and re-schedule via the periodic refresh instead.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1; // ~24.8 days

// On init, fire a "missed" notification for reminders whose date is in
// the past but within this window. Older ones are silently marked as
// completed (or left alone if recurring — see recurring handling).
const MISSED_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Periodic refresh — covers cases where the OS suspended the process,
// the clock jumped, or a reminder was scheduled too far out for a single
// timer. Cheap operation (one storage read + a few setTimeout calls).
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

type Settings = { enabled: boolean; sound: boolean };
type FireExtras = {
  missed?: boolean;
};

interface RuntimeState {
  timers: Map<string, NodeJS.Timeout>;
  refreshTimer: NodeJS.Timeout | null;
  mainWindow: BrowserWindow | null;
  settings: Settings;
  getMissedTitle: () => string;
  getDueTitle: () => string;
}

const state: RuntimeState = {
  timers: new Map(),
  refreshTimer: null,
  mainWindow: null,
  settings: { enabled: true, sound: true },
  getMissedTitle: () => 'Missed reminder',
  getDueTitle: () => 'Reminder',
};

export interface InitOptions {
  mainWindow: BrowserWindow | null;
  settings: Settings;
  getDueTitle: () => string;
  getMissedTitle: () => string;
}

export function init(options: InitOptions): void {
  state.mainWindow = options.mainWindow;
  state.settings = options.settings;
  state.getDueTitle = options.getDueTitle;
  state.getMissedTitle = options.getMissedTitle;

  // Replace any existing timers and reschedule from a fresh storage read.
  void rescheduleAll();

  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    void rescheduleAll();
  }, REFRESH_INTERVAL_MS);
}

export function updateSettings(settings: Settings): void {
  state.settings = settings;
}

export function attachWindow(window: BrowserWindow | null): void {
  state.mainWindow = window;
}

export function shutdown(): void {
  for (const timer of state.timers.values()) clearTimeout(timer);
  state.timers.clear();
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

/**
 * Re-read all reminders from storage and (re)schedule timers. Called
 * automatically by init() and the periodic refresh, and by the IPC
 * handlers whenever the renderer creates/updates/deletes a reminder.
 */
export async function rescheduleAll(): Promise<void> {
  try {
    const reminders = await StorageService.getAllReminders();
    const now = Date.now();
    const wanted = new Set<string>();

    for (const reminder of reminders) {
      if (isDone(reminder)) continue;

      const fireAt = computeFireAt(reminder);
      if (fireAt === null) continue;

      wanted.add(reminder.id);
      scheduleOne(reminder, fireAt, now);
    }

    // Clear timers for reminders that disappeared / got completed
    for (const [id, timer] of state.timers) {
      if (!wanted.has(id)) {
        clearTimeout(timer);
        state.timers.delete(id);
      }
    }
  } catch (err) {
    console.error('[reminderScheduler] rescheduleAll failed:', err);
  }
}

function computeFireAt(reminder: Reminder): number | null {
  // Snooze wins over the base date when set and still in the future
  if (reminder.snoozedUntil) {
    const snooze = new Date(reminder.snoozedUntil).getTime();
    if (!Number.isNaN(snooze)) return snooze;
  }
  const base = new Date(reminder.date).getTime();
  if (Number.isNaN(base)) return null;
  return base;
}

function scheduleOne(reminder: Reminder, fireAt: number, now: number): void {
  // Drop any existing timer for this reminder before re-arming
  const existing = state.timers.get(reminder.id);
  if (existing) {
    clearTimeout(existing);
    state.timers.delete(reminder.id);
  }

  const delay = fireAt - now;

  if (delay <= 0) {
    // In the past. Only fire as "missed" if still inside the catch-up
    // window — older reminders are silently dropped (the user already
    // knows they missed those, no point notifying days later).
    const isRecentMiss = delay > -MISSED_WINDOW_MS;
    if (isRecentMiss) {
      // Defer slightly so init() can return before we fire (avoids
      // racing the renderer's IPC bridge setup).
      const timer = setTimeout(() => {
        void fireReminder(reminder, { missed: true });
      }, 100);
      state.timers.set(reminder.id, timer);
    }
    return;
  }

  if (delay > MAX_TIMER_DELAY_MS) {
    // Too far out for a single timer. The periodic refresh will pick it
    // up later when the delay is below the cap.
    return;
  }

  const timer = setTimeout(() => {
    void fireReminder(reminder, {});
  }, delay);
  state.timers.set(reminder.id, timer);
}

async function fireReminder(reminder: Reminder, extras: FireExtras): Promise<void> {
  state.timers.delete(reminder.id);

  if (state.settings.enabled) {
    try {
      const title = extras.missed ? state.getMissedTitle() : state.getDueTitle();
      const body =
        (reminder.message || reminder.description || '').trim() ||
        reminder.itemName ||
        'Reminder';

      const itemId = reminderItemId(reminder) || '';
      const itemType = reminder.itemType || '';
      const fullTitle = `Filarr — ${title}`;

      const notif = buildPlatformNotification({
        title: fullTitle,
        body,
        silent: !state.settings.sound,
        reminderId: reminder.id,
        itemId,
        itemType,
      });

      const focusAndJump = () => {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          if (state.mainWindow.isMinimized()) state.mainWindow.restore();
          state.mainWindow.show();
          state.mainWindow.focus();
          state.mainWindow.webContents.send('reminder-clicked', {
            reminderId: reminder.id,
            itemId: reminder.itemId,
            itemType: reminder.itemType,
          });
        }
      };

      notif.on('click', focusAndJump);

      // macOS only — the `action` event fires when the user clicks one
      // of the buttons in the notification. `index` matches the order
      // of `actions` above (0 = snooze, 1 = mark done).
      notif.on('action', (_evt, index) => {
        const itemId = reminderItemId(reminder);
        if (!itemId) return;
        if (index === 0) {
          void snoozeReminder(itemId, reminder.id, 10);
        } else if (index === 1) {
          void StorageService.updateReminder(itemId, reminder.id, {
            completed: true,
            isCompleted: true,
            updatedAt: new Date().toISOString(),
          }).then(() => rescheduleAll());
        }
      });

      notif.show();
    } catch (err) {
      console.error('[reminderScheduler] failed to show notification:', err);
    }
  }

  // Notify the renderer regardless so the in-app badge / list refreshes
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('reminder-fired', {
      reminderId: reminder.id,
      missed: !!extras.missed,
    });
  }

  // Recurring: push the date forward and re-arm. Non-recurring: mark
  // completed so it doesn't fire again on next refresh.
  const itemId = reminderItemId(reminder);
  if (!itemId) return;
  try {
    if (reminder.recurring && reminder.recurring !== 'none') {
      const nextDate = computeNextRecurrence(reminder);
      if (nextDate) {
        await StorageService.updateReminder(itemId, reminder.id, {
          date: nextDate,
          snoozedUntil: undefined,
          updatedAt: new Date().toISOString(),
        });
        // Re-arm via full reschedule so the storage truth wins
        void rescheduleAll();
        return;
      }
    }
    // Set both old and new completion flag names to keep legacy callers
    // (electron-side) and the renderer side in agreement during the
    // transitional period.
    const update = {
      completed: true,
      isCompleted: true,
      updatedAt: new Date().toISOString(),
    };
    if (reminder.itemType === 'note') {
      await StorageService.updateNoteReminder(itemId, reminder.id, update);
    } else {
      await StorageService.updateReminder(itemId, reminder.id, update);
    }
  } catch (err) {
    console.error('[reminderScheduler] post-fire update failed:', err);
  }
}

function computeNextRecurrence(reminder: Reminder): string | null {
  const base = new Date(reminder.date);
  if (Number.isNaN(base.getTime())) return null;
  const now = new Date();
  // Advance forward past `now` so a long-missed daily reminder doesn't
  // fire 14 times to catch up
  const next = new Date(base.getTime());
  const advance = (n: number) => {
    if (reminder.recurring === 'daily') next.setDate(next.getDate() + n);
    else if (reminder.recurring === 'weekly') next.setDate(next.getDate() + 7 * n);
    else if (reminder.recurring === 'monthly') next.setMonth(next.getMonth() + n);
  };
  // Add one interval as a minimum, then keep adding until strictly future
  advance(1);
  while (next <= now) advance(1);
  return next.toISOString();
}

/**
 * Snooze the given reminder by `minutes` minutes from now and re-arm.
 * itemType is needed because note reminders live in a separate file
 * (noteReminders.json) and need a different update path.
 */
export async function snoozeReminder(
  itemId: string,
  reminderId: string,
  minutes: number,
  itemType?: string
): Promise<void> {
  const update = {
    snoozedUntil: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (itemType === 'note') {
    await StorageService.updateNoteReminder(itemId, reminderId, update);
  } else {
    await StorageService.updateReminder(itemId, reminderId, update);
  }
  void rescheduleAll();
}
