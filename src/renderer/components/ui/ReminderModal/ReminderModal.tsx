/**
 * ReminderModal Component
 *
 * Modal pour ajouter un rappel à un dossier ou fichier
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../Modal/Modal';
import { Button } from '../Button/Button';

interface ReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reminder: ReminderData) => void;
  defaultReminder?: Partial<ReminderData>;
  title?: string;
  itemName?: string;
}

export interface ReminderData {
  date: string;
  time: string;
  message: string;
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly';
  priority?: 'low' | 'normal' | 'high';
  datetime?: string;
}

// Icons
const FolderIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
    />
  </svg>
);

const BellIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
    />
  </svg>
);

const PRIORITY_COLORS = {
  low: 'bg-[var(--color-neutral-200)] text-[var(--color-neutral-700)]',
  normal: 'bg-[var(--color-primary-100)] text-[var(--color-primary-700)]',
  high: 'bg-red-100 text-red-700',
};

const RECURRING_VALUES = ['none', 'daily', 'weekly', 'monthly'] as const;

const QUICK_TIMES = [
  { label: '08:00', value: '08:00' },
  { label: '09:00', value: '09:00' },
  { label: '10:00', value: '10:00' },
  { label: '12:00', value: '12:00' },
  { label: '14:00', value: '14:00' },
  { label: '16:00', value: '16:00' },
  { label: '18:00', value: '18:00' },
  { label: '20:00', value: '20:00' },
];

// Quick presets that pre-fill date + time + recurring in one click. Each
// preset computes the next occurrence from now, so "weekly Friday" with
// today as Friday afternoon picks next Friday (not today, already late).
const RECURRING_PRESETS = [
  {
    key: 'dailyMorning',
    recurring: 'daily' as const,
    compute: () => {
      const d = new Date();
      d.setHours(9, 0, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      return d;
    },
  },
  {
    key: 'weeklyFriday',
    recurring: 'weekly' as const,
    compute: () => {
      const d = new Date();
      d.setHours(17, 0, 0, 0);
      const dow = d.getDay(); // 0=Sun..5=Fri..6=Sat
      const daysUntilFriday = (5 - dow + 7) % 7 || (d.getTime() < Date.now() ? 7 : 0);
      d.setDate(d.getDate() + daysUntilFriday);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 7);
      return d;
    },
  },
  {
    key: 'monthlyFirst',
    recurring: 'monthly' as const,
    compute: () => {
      const d = new Date();
      d.setHours(10, 0, 0, 0);
      d.setDate(1);
      if (d.getTime() < Date.now()) d.setMonth(d.getMonth() + 1);
      return d;
    },
  },
];

// User-defined presets stored in localStorage. Each one captures the
// current draft (time of day + recurring + optional weekday/dayOfMonth)
// so a click recreates an equivalent "next occurrence" reminder.
const USER_PRESETS_STORAGE_KEY = 'filarr-reminder-user-presets';

export interface UserReminderPreset {
  id: string;
  label: string;
  /** "HH:MM" 24h */
  time: string;
  recurring: 'none' | 'daily' | 'weekly' | 'monthly';
  /** 0..6 (0=Sun) for weekly presets */
  weekday?: number;
  /** 1..31 for monthly presets */
  dayOfMonth?: number;
}

function loadUserPresets(): UserReminderPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(USER_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

function saveUserPresets(presets: UserReminderPreset[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage may be unavailable (private mode / quota)
  }
}

/** Resolve a user preset to a concrete next-occurrence Date. */
function computeFromUserPreset(p: UserReminderPreset): Date {
  const [hh, mm] = p.time.split(':').map((s) => parseInt(s, 10));
  const d = new Date();
  d.setHours(hh || 0, mm || 0, 0, 0);
  if (p.recurring === 'weekly' && typeof p.weekday === 'number') {
    const dow = d.getDay();
    const delta = (p.weekday - dow + 7) % 7;
    d.setDate(d.getDate() + delta);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 7);
  } else if (p.recurring === 'monthly' && typeof p.dayOfMonth === 'number') {
    d.setDate(p.dayOfMonth);
    if (d.getTime() < Date.now()) d.setMonth(d.getMonth() + 1);
  } else {
    // daily / none
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  }
  return d;
}

const QUICK_DATE_CONFIGS = [
  { key: 'today', getValue: () => new Date() },
  {
    key: 'tomorrow',
    getValue: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d;
    },
  },
  {
    key: 'in3Days',
    getValue: () => {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      return d;
    },
  },
  {
    key: 'nextWeek',
    getValue: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d;
    },
  },
];

const toDateString = (d: Date) => d.toISOString().split('T')[0];
const toTimeString = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export const ReminderModal: React.FC<ReminderModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultReminder,
  title,
  itemName,
}) => {
  const { t } = useTranslation();
  const resolvedTitle = title || t('reminder.addReminder');
  const now = new Date();
  const defaultDate = toDateString(now);
  const defaultTime = toTimeString(now);

  const [date, setDate] = useState(defaultReminder?.date || defaultDate);
  const [time, setTime] = useState(defaultReminder?.time || defaultTime);
  const [message, setMessage] = useState(defaultReminder?.message || '');
  const [recurring, setRecurring] = useState<'none' | 'daily' | 'weekly' | 'monthly'>(
    defaultReminder?.recurring || 'none'
  );
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>(
    defaultReminder?.priority || 'normal'
  );

  useEffect(() => {
    if (isOpen && !defaultReminder) {
      const now = new Date();
      setDate(toDateString(now));
      setTime(toTimeString(now));
      setMessage('');
      setRecurring('none');
      setPriority('normal');
    }
  }, [isOpen, defaultReminder]);

  const handleSubmit = useCallback(() => {
    if (!date || !time || !message.trim()) return;

    const datetime = new Date(`${date}T${time}`).toISOString();

    onSubmit({
      date,
      time,
      message: message.trim(),
      recurring,
      priority,
      datetime,
    });

    const now = new Date();
    setDate(toDateString(now));
    setTime(toTimeString(now));
    setMessage('');
    setRecurring('none');
    setPriority('normal');
    onClose();
  }, [date, time, message, recurring, priority, onSubmit, onClose]);

  const handleCancel = useCallback(() => {
    const now = new Date();
    setDate(defaultReminder?.date || toDateString(now));
    setTime(defaultReminder?.time || toTimeString(now));
    setMessage(defaultReminder?.message || '');
    setRecurring(defaultReminder?.recurring || 'none');
    setPriority(defaultReminder?.priority || 'normal');
    onClose();
  }, [defaultReminder, onClose]);

  const isFormValid = date && time && message.trim();

  const inputClasses = `
    h-10 px-3 rounded-lg border-2 border-[var(--color-border)]
    bg-[var(--color-background)] text-sm text-[var(--color-text-primary)]
    cursor-pointer
    hover:border-[var(--color-primary-400)]
    focus:outline-none focus:border-[var(--color-primary-500)] focus:ring-2 focus:ring-[var(--color-primary-100)]
    transition-all duration-150
  `;

  const selectClasses = `
    ${inputClasses}
    appearance-none
    bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%20stroke%3D%22%23666%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%222%22%20d%3D%22M19%209l-7%207-7-7%22/%3E%3C/svg%3E')]
    bg-no-repeat bg-[length:16px] bg-[right_12px_center]
    pr-10
  `;

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} size="md">
      <ModalHeader onClose={handleCancel}>{resolvedTitle}</ModalHeader>
      <ModalBody>
        <div className="flex flex-col gap-5">
          {/* Item Info */}
          {itemName && (
            <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-background-secondary)] rounded-lg border border-[var(--color-border)] border-l-4 border-l-[var(--color-primary-500)]">
              <span className="text-[var(--color-primary-500)] shrink-0">
                <FolderIcon />
              </span>
              <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                {itemName}
              </span>
            </div>
          )}

          {/* Message */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="reminder-message"
              className="text-sm font-semibold text-[var(--color-text-primary)]"
            >
              {t('reminder.messageLabel')} *
            </label>
            <textarea
              id="reminder-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="
                w-full px-3 py-2.5 rounded-lg border-2 border-[var(--color-border)]
                bg-[var(--color-background)] text-sm text-[var(--color-text-primary)]
                placeholder:text-[var(--color-text-tertiary)]
                resize-none font-[inherit] min-h-[80px]
                hover:border-[var(--color-primary-400)]
                focus:outline-none focus:border-[var(--color-primary-500)] focus:ring-2 focus:ring-[var(--color-primary-100)]
                transition-all duration-150
              "
              placeholder={t('reminder.messagePlaceholder')}
              rows={3}
              maxLength={200}
              autoFocus
            />
            <span className="text-[11px] text-[var(--color-text-tertiary)] text-right">
              {message.length}/200
            </span>
          </div>

          {/* Date & Time Section */}
          <div className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4">
            {/* Quick date buttons */}
            <div className="mb-3">
              <p className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2 font-medium">
                {t('reminder.quickDate')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_DATE_CONFIGS.map((qd) => {
                  const val = toDateString(qd.getValue());
                  return (
                    <button
                      key={qd.key}
                      type="button"
                      onClick={() => setDate(val)}
                      className={`
                        px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150
                        ${
                          date === val
                            ? 'bg-[var(--color-primary-500)] text-white'
                            : 'bg-[var(--color-background)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:border-[var(--color-primary-300)] hover:text-[var(--color-primary-600)]'
                        }
                      `}
                    >
                      {t(`reminder.quickDates.${qd.key}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date & Time inputs */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="reminder-date"
                  className="text-sm font-semibold text-[var(--color-text-primary)]"
                >
                  {t('reminder.date')} *
                </label>
                <input
                  id="reminder-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClasses}
                  min={toDateString(new Date())}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="reminder-time"
                  className="text-sm font-semibold text-[var(--color-text-primary)]"
                >
                  {t('reminder.time')} *
                </label>
                <input
                  id="reminder-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>

            {/* Quick time slots */}
            <div className="mt-3 pt-3 border-t border-[var(--color-border-light)]">
              <p className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2 font-medium">
                {t('reminder.quickTime')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_TIMES.map((slot) => (
                  <button
                    key={slot.value}
                    type="button"
                    onClick={() => setTime(slot.value)}
                    className={`
                      px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150
                      ${
                        time === slot.value
                          ? 'bg-[var(--color-primary-500)] text-white'
                          : 'bg-[var(--color-background)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:border-[var(--color-primary-300)] hover:text-[var(--color-primary-600)]'
                      }
                    `}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Priority & Recurring */}
          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('reminder.priority')}
              </label>
              <div className="flex gap-1.5">
                {(['low', 'normal', 'high'] as const).map((p) => {
                  const colorClass = PRIORITY_COLORS[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`
                        flex-1 py-2 rounded-lg text-xs font-medium text-center transition-all duration-150
                        border-2
                        ${
                          priority === p
                            ? `${colorClass} border-current shadow-sm`
                            : 'bg-[var(--color-background)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                        }
                      `}
                    >
                      {t(`reminder.priorities.${p}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recurring */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="reminder-recurring"
                className="text-sm font-semibold text-[var(--color-text-primary)]"
              >
                {t('reminder.recurrence')}
              </label>
              <select
                id="reminder-recurring"
                value={recurring}
                onChange={(e) => setRecurring(e.target.value as any)}
                className={selectClasses}
              >
                {RECURRING_VALUES.map((val) => (
                  <option key={val} value={val}>
                    {t(`reminder.recurring.${val}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Recurring presets — built-in + user-defined */}
          <PresetsSection
            t={t}
            currentDate={date}
            currentTime={time}
            currentRecurring={recurring}
            onApply={(d, rec) => {
              setDate(toDateString(d));
              setTime(
                `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
              );
              setRecurring(rec);
            }}
          />

          {/* Preview */}
          {date && time && message.trim() && (
            <div className="flex items-start gap-3 p-3.5 rounded-lg bg-[var(--color-primary-50)] border border-[var(--color-primary-200)]">
              <span className="text-[var(--color-primary-500)] shrink-0 mt-0.5">
                <BellIcon />
              </span>
              <p className="text-sm text-[var(--color-text-secondary)] m-0 leading-relaxed">
                {t('reminder.scheduledOn')}{' '}
                <strong className="text-[var(--color-text-primary)]">
                  {new Date(date).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </strong>{' '}
                {t('reminder.at')}{' '}
                <strong className="text-[var(--color-text-primary)]">{time}</strong>
                {recurring !== 'none' && (
                  <span className="text-[var(--color-primary-600)]">
                    {' '}
                    ({t(`reminder.recurringShort.${recurring}`)})
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={handleCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={!isFormValid}>
          {t('reminder.addReminder')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

// ──────────── PresetsSection ────────────
// Renders the built-in presets + the user's saved ones, and lets the
// user save the current draft as a new named preset.

interface PresetsSectionProps {
  t: (key: string, opts?: any) => string;
  currentDate: string;
  currentTime: string;
  currentRecurring: 'none' | 'daily' | 'weekly' | 'monthly';
  onApply: (date: Date, recurring: 'none' | 'daily' | 'weekly' | 'monthly') => void;
}

const PresetsSection: React.FC<PresetsSectionProps> = ({
  t,
  currentDate,
  currentTime,
  currentRecurring,
  onApply,
}) => {
  const [userPresets, setUserPresets] = useState<UserReminderPreset[]>(() => loadUserPresets());
  const [namingPreset, setNamingPreset] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');

  const canSave = !!currentDate && !!currentTime && currentRecurring !== 'none';

  const handleSave = () => {
    const label = draftLabel.trim();
    if (!label || !canSave) return;
    const d = new Date(`${currentDate}T${currentTime}`);
    const preset: UserReminderPreset = {
      id: `up-${Date.now().toString(36)}`,
      label,
      time: currentTime,
      recurring: currentRecurring,
      weekday: currentRecurring === 'weekly' ? d.getDay() : undefined,
      dayOfMonth: currentRecurring === 'monthly' ? d.getDate() : undefined,
    };
    const next = [...userPresets, preset];
    setUserPresets(next);
    saveUserPresets(next);
    setNamingPreset(false);
    setDraftLabel('');
  };

  const handleDelete = (id: string) => {
    const next = userPresets.filter((p) => p.id !== id);
    setUserPresets(next);
    saveUserPresets(next);
  };

  return (
    <div className="rounded-lg border-2 border-dashed border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider font-medium">
          {t('reminder.recurringPresets', 'Presets récurrents')}
        </p>
        <button
          type="button"
          onClick={() => {
            if (!canSave) return;
            setNamingPreset((v) => !v);
            setDraftLabel('');
          }}
          disabled={!canSave}
          title={
            canSave
              ? (t('reminder.savePresetHint', 'Sauvegarder ce rappel comme preset') as string)
              : (t(
                  'reminder.savePresetDisabledHint',
                  'Choisissez une récurrence avant de sauvegarder un preset'
                ) as string)
          }
          className="text-[11px] font-medium text-[var(--color-primary-600)] hover:text-[var(--color-primary-700)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed"
        >
          {namingPreset
            ? t('common.cancel', 'Annuler')
            : `＋ ${t('reminder.savePreset', 'Sauvegarder')}`}
        </button>
      </div>

      {namingPreset && (
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder={
              t('reminder.savePresetPlaceholder', 'Nom du preset (ex: Daily standup)') as string
            }
            autoFocus
            className="flex-1 h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-text-primary)]"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!draftLabel.trim()}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50"
          >
            {t('common.save', 'Enregistrer')}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {RECURRING_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onApply(preset.compute(), preset.recurring)}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--color-background)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:border-[var(--color-primary-300)] hover:text-[var(--color-primary-600)] transition-all duration-150"
          >
            {t(`reminder.recurringPresetLabel.${preset.key}`)}
          </button>
        ))}
        {userPresets.map((preset) => (
          <span
            key={preset.id}
            className="group inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] transition-all duration-150 hover:border-[var(--color-primary-300)]"
          >
            <button
              type="button"
              onClick={() => onApply(computeFromUserPreset(preset), preset.recurring)}
              className="pl-2.5 pr-1 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary-600)]"
            >
              {preset.label}
            </button>
            <button
              type="button"
              onClick={() => handleDelete(preset.id)}
              title={t('reminder.deletePreset', 'Supprimer ce preset') as string}
              className="pr-1.5 pl-0.5 text-xs text-[var(--color-text-tertiary)] hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
};

export default ReminderModal;
