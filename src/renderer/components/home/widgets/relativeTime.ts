/**
 * « il y a 3 heures », dans la langue de l'utilisateur.
 *
 * ── PAS UNE TABLE DE CHAÎNES ────────────────────────────────────────────────
 *
 * Écrire « {{n}} h » en anglais et en français dans les fichiers de traduction
 * paraît plus simple, mais c'est la même erreur que le produit a déjà commise
 * dans la liste des notes (`formatRelativeDate`, en anglais en dur pour tout le
 * monde) : chaque nouvelle langue rouvre le fichier, et les formes plurielles ne
 * se devinent pas depuis le français.
 *
 * `Intl.RelativeTimeFormat` sait tout ça, il est dans le moteur, et il rend
 * « à l'instant » / « hier » tout seuls grâce à `numeric: 'auto'`.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Une minute, une heure, un jour, en millisecondes. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Rend un formateur STABLE pour une langue donnée : il est mémoïsé, donc il ne
 * casse pas la mémoïsation des blocs qui le prennent en dépendance.
 *
 * Une date illisible rend la chaîne vide plutôt qu'« Invalid Date » : une ligne
 * sans horodatage se lit encore, une ligne qui affiche « NaN » fait douter de
 * tout le reste.
 */
export function useRelativeTime(): (iso: string | undefined | null) => string {
  const { i18n } = useTranslation();
  const language = i18n.language;

  return useMemo(() => {
    let formatter: Intl.RelativeTimeFormat;
    try {
      formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    } catch {
      // Étiquette de langue exotique : le moteur retombe sur sa locale par
      // défaut plutôt que de laisser l'exception remonter dans un rendu.
      formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    }
    const dateFormatter = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' });

    return (iso) => {
      if (!iso) return '';
      const time = new Date(iso).getTime();
      if (Number.isNaN(time)) return '';
      const elapsed = Date.now() - time;
      if (elapsed < MINUTE) return formatter.format(0, 'second');
      if (elapsed < HOUR) return formatter.format(-Math.floor(elapsed / MINUTE), 'minute');
      if (elapsed < DAY) return formatter.format(-Math.floor(elapsed / HOUR), 'hour');
      // Au-delà d'une semaine, « il y a 34 jours » ne dit plus rien à personne :
      // une date courte est plus courte à lire ET plus précise.
      if (elapsed < 7 * DAY) return formatter.format(-Math.floor(elapsed / DAY), 'day');
      return dateFormatter.format(time);
    };
  }, [language]);
}

/**
 * Le pendant tourné vers l'AVENIR : « dans 2 heures », « demain ». Les rappels
 * en retard passent par le même chemin (`elapsed` positif) et se disent « il y a
 * 20 minutes » — ce qui est exactement ce qu'un rappel manqué doit dire.
 */
export function useUpcomingTime(): (iso: string | undefined | null) => string {
  const { i18n } = useTranslation();
  const language = i18n.language;

  return useMemo(() => {
    let formatter: Intl.RelativeTimeFormat;
    try {
      formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    } catch {
      formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    }
    const dateFormatter = new Intl.DateTimeFormat(language, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    return (iso) => {
      if (!iso) return '';
      const time = new Date(iso).getTime();
      if (Number.isNaN(time)) return '';
      const delta = time - Date.now();
      const absolute = Math.abs(delta);
      const sign = delta < 0 ? -1 : 1;
      if (absolute < MINUTE) return formatter.format(0, 'second');
      if (absolute < HOUR) return formatter.format(sign * Math.floor(absolute / MINUTE), 'minute');
      if (absolute < DAY) return formatter.format(sign * Math.floor(absolute / HOUR), 'hour');
      if (absolute < 7 * DAY) return formatter.format(sign * Math.floor(absolute / DAY), 'day');
      return dateFormatter.format(time);
    };
  }, [language]);
}
