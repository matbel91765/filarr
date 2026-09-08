/**
 * LE JOURNAL DU MINUTEUR — une fonction pure, deux compteurs.
 *
 * ── CE QUE CE MODULE AJOUTE ─────────────────────────────────────────────────
 *
 * Le bureau ne comptait QUE les sessions de concentration : une pause terminée
 * ne laissait aucune trace. Le téléphone compte les deux
 * (`filarr-mobile/src/services/pomodoro/pomodoroModel.ts`, `breakCount`) et
 * l'affiche — « Pauses 2 ». Le champ est ADDITIF et purement local : ce
 * journal vit dans le stockage de profil (`filarr_pomodoro`), aucune route ne
 * le transporte, aucun autre appareil ne le lit. L'ajouter ne peut donc rien
 * casser nulle part.
 *
 * ── POURQUOI C'EST UNE FONCTION PURE, ET PAS UN BOUT DE RÉDUCTEUR ───────────
 *
 * L'ancien `recordFocusCompletion` mutait le brouillon Immer sur place :
 * intestable sans monter un magasin, donc jamais testé. Les deux règles qui
 * comptent vraiment — « une entrée par jour » et « la borne s'applique à
 * l'écriture » — méritaient des vecteurs.
 *
 * La BORNE s'applique à l'écriture et non à la lecture : un journal qui grossit
 * sans fin finirait dans l'état persisté, relu et réécrit à chaque démarrage.
 */

export interface PomodoroHistoryEntry {
  /** Jour civil `AAAA-MM-JJ`, fuseau de l'appareil. */
  date: string;
  focusCount: number;
  totalFocusMinutes: number;
  /**
   * Pauses terminées ce jour-là. ABSENT sur toute entrée écrite avant que ce
   * compteur existe — il se lit donc toujours avec un `?? 0`, jamais comme un
   * nombre garanti. Aucune migration : une entrée d'hier reste valide.
   */
  breakCount?: number;
}

/** Le journal ne garde que les quatre-vingt-dix derniers jours. */
export const HISTORY_MAX_DAYS = 90;

/** `AAAA-MM-JJ` dans le fuseau de l'appareil — le jour tel que l'humain le vit. */
export function pomodoroDayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Le journal APRÈS une phase terminée — tableau NEUF, entrées neuves.
 *
 * Même contrat que `recordCompletion` du mobile, aux mêmes conditions :
 * une seule entrée par jour, les minutes ne comptent que la concentration, et
 * une pause n'incrémente que `breakCount`.
 */
export function recordPomodoroCompletion(
  history: readonly PomodoroHistoryEntry[],
  input: { day: string; isFocus: boolean; minutes: number }
): PomodoroHistoryEntry[] {
  const { day, isFocus } = input;
  const minutes = isFocus ? Math.max(0, input.minutes) : 0;

  const next = history.map((entry) =>
    entry.date === day
      ? {
          ...entry,
          focusCount: entry.focusCount + (isFocus ? 1 : 0),
          totalFocusMinutes: entry.totalFocusMinutes + minutes,
          breakCount: (entry.breakCount ?? 0) + (isFocus ? 0 : 1),
        }
      : entry
  );

  if (!next.some((entry) => entry.date === day)) {
    next.push({
      date: day,
      focusCount: isFocus ? 1 : 0,
      totalFocusMinutes: minutes,
      breakCount: isFocus ? 0 : 1,
    });
  }

  return next.length > HISTORY_MAX_DAYS ? next.slice(next.length - HISTORY_MAX_DAYS) : next;
}

/** Ce qu'un jour raconte, `0` partout quand il ne s'est rien passé. */
export function pomodoroDayStats(
  history: readonly PomodoroHistoryEntry[],
  day: string
): { focusCount: number; focusMinutes: number; breakCount: number } {
  const entry = history.find((h) => h.date === day);
  if (!entry) return { focusCount: 0, focusMinutes: 0, breakCount: 0 };
  return {
    focusCount: entry.focusCount,
    focusMinutes: entry.totalFocusMinutes,
    breakCount: entry.breakCount ?? 0,
  };
}
