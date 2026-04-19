/**
 * Natural Language Dates Extension — Filarr Notes
 *
 * Converts @today, @demain, @lundi, etc. into inlineDate nodes.
 * Date keywords are integrated into the existing @ wiki-link popup
 * (handled in NoteEditor.tsx), NOT via a separate suggestion plugin.
 *
 * This file exports the date keyword data for use in the wiki-link popup.
 */

function getNextDayOfWeek(dayIndex: number): Date {
  const today = new Date();
  const diff = (dayIndex - today.getDay() + 7) % 7;
  const result = new Date(today);
  result.setDate(today.getDate() + (diff === 0 ? 7 : diff));
  return result;
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DateKeywordItem {
  keyword: string;
  resolve: () => string;
  label: string;
}

export const DATE_KEYWORDS: DateKeywordItem[] = [
  // English
  { keyword: 'today', resolve: () => addDays(0), label: 'Today' },
  { keyword: 'tomorrow', resolve: () => addDays(1), label: 'Tomorrow' },
  { keyword: 'yesterday', resolve: () => addDays(-1), label: 'Yesterday' },
  { keyword: 'monday', resolve: () => toISO(getNextDayOfWeek(1)), label: 'Monday' },
  { keyword: 'tuesday', resolve: () => toISO(getNextDayOfWeek(2)), label: 'Tuesday' },
  { keyword: 'wednesday', resolve: () => toISO(getNextDayOfWeek(3)), label: 'Wednesday' },
  { keyword: 'thursday', resolve: () => toISO(getNextDayOfWeek(4)), label: 'Thursday' },
  { keyword: 'friday', resolve: () => toISO(getNextDayOfWeek(5)), label: 'Friday' },
  { keyword: 'saturday', resolve: () => toISO(getNextDayOfWeek(6)), label: 'Saturday' },
  { keyword: 'sunday', resolve: () => toISO(getNextDayOfWeek(0)), label: 'Sunday' },
  { keyword: 'next week', resolve: () => toISO(getNextDayOfWeek(1)), label: 'Next week' },
  { keyword: 'next month', resolve: () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return toISO(d); }, label: 'Next month' },
  // French
  { keyword: "aujourd'hui", resolve: () => addDays(0), label: "Aujourd'hui" },
  { keyword: 'demain', resolve: () => addDays(1), label: 'Demain' },
  { keyword: 'hier', resolve: () => addDays(-1), label: 'Hier' },
  { keyword: 'lundi', resolve: () => toISO(getNextDayOfWeek(1)), label: 'Lundi' },
  { keyword: 'mardi', resolve: () => toISO(getNextDayOfWeek(2)), label: 'Mardi' },
  { keyword: 'mercredi', resolve: () => toISO(getNextDayOfWeek(3)), label: 'Mercredi' },
  { keyword: 'jeudi', resolve: () => toISO(getNextDayOfWeek(4)), label: 'Jeudi' },
  { keyword: 'vendredi', resolve: () => toISO(getNextDayOfWeek(5)), label: 'Vendredi' },
  { keyword: 'samedi', resolve: () => toISO(getNextDayOfWeek(6)), label: 'Samedi' },
  { keyword: 'dimanche', resolve: () => toISO(getNextDayOfWeek(0)), label: 'Dimanche' },
  { keyword: 'semaine prochaine', resolve: () => toISO(getNextDayOfWeek(1)), label: 'Semaine prochaine' },
  { keyword: 'mois prochain', resolve: () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return toISO(d); }, label: 'Mois prochain' },
];
