/**
 * Graph Time Travel — Filarr Notes
 *
 * Filters graph nodes/edges to show state at a target date.
 * Notes created after the target date are hidden.
 * Links to hidden notes are removed.
 */

import type { Note } from '../../types/notes';

export interface TimeTravelResult {
  visibleNoteIds: Set<string>;
  /** ISO date string: earliest note date */
  minDate: string;
  /** ISO date string: latest note date */
  maxDate: string;
}

/**
 * Filter notes to show only those created on or before targetDate.
 */
export function filterNotesByDate(
  notesById: Record<string, Note>,
  targetDate: string
): TimeTravelResult {
  const target = new Date(targetDate).getTime();
  const visibleNoteIds = new Set<string>();

  let minDate = '';
  let maxDate = '';

  for (const note of Object.values(notesById)) {
    if (note.deletedAt) continue;
    const created = note.createdAt;

    // Track min/max
    if (!minDate || created < minDate) minDate = created;
    if (!maxDate || created > maxDate) maxDate = created;

    // Include if created on or before target
    if (new Date(created).getTime() <= target) {
      visibleNoteIds.add(note.id);
    }
  }

  return { visibleNoteIds, minDate, maxDate };
}

/**
 * Convert a normalized slider value (0–1) to an ISO date string
 * within the min-max range.
 */
export function sliderToDate(value: number, minDate: string, maxDate: string): string {
  const min = new Date(minDate).getTime();
  const max = new Date(maxDate).getTime();
  const target = min + value * (max - min);
  return new Date(target).toISOString();
}

/**
 * Convert an ISO date to a normalized slider value (0–1).
 */
export function dateToSlider(date: string, minDate: string, maxDate: string): number {
  const min = new Date(minDate).getTime();
  const max = new Date(maxDate).getTime();
  if (max === min) return 1;
  return (new Date(date).getTime() - min) / (max - min);
}
