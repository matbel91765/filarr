/**
 * MarkBadges — deux pastilles de MARQUAGE, sur le patron de SharedBadge.
 *
 *  · FavoriteBadge (★) — « dans MES favoris » : personnel, scellé, suit la
 *    personne d'un appareil à l'autre (useVaultFavorites). Jamais de compte :
 *    c'est soi ou pas.
 *  · MentionBadge (@N) — « N mentions non lues vous visent ici » : dérivée de
 *    la boîte de la cloche, disparaît quand on marque lu (mentionInbox).
 *
 * Présentationnelles PURES, comme SharedBadge : pas de store, pas d'i18n — le
 * `title` arrive traduit. Deux formes, `corner` (vue liste, pastille ronde) et
 * `inline` (vue grille, pilule), avec les mêmes classes que le partage pour
 * qu'elles se lisent ensemble dans le même coin.
 */

import type { FC } from 'react';
import clsx from 'clsx';
import {
  SHARED_BADGE_CORNER_CLASSES,
  SHARED_BADGE_CORNER_STYLE,
  SHARED_BADGE_INLINE_CLASSES,
  type SharedBadgeVariant,
} from './SharedBadge';

const StarGlyph: FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M11.48 3.5a.56.56 0 011.04 0l2.13 5.11a.56.56 0 00.47.34l5.52.44c.5.04.7.66.32.99l-4.2 3.6a.56.56 0 00-.18.56l1.28 5.38a.56.56 0 01-.84.61l-4.73-2.89a.56.56 0 00-.58 0l-4.73 2.89a.56.56 0 01-.84-.61l1.28-5.38a.56.56 0 00-.18-.56l-4.2-3.6a.56.56 0 01.32-.99l5.52-.44a.56.56 0 00.47-.34L11.48 3.5z" />
  </svg>
);

/** Teinte ambre pour le favori : la même famille que le rappel, qui est aussi un marquage. */
const FAVORITE_CORNER = ['bg-amber-500 text-white'];
const FAVORITE_INLINE = ['bg-amber-50 text-amber-700'];

export const FavoriteBadge: FC<{
  variant: SharedBadgeVariant;
  title: string;
  className?: string;
}> = ({ variant, title, className }) => {
  if (variant === 'corner') {
    return (
      <span
        className={clsx(
          ...SHARED_BADGE_CORNER_CLASSES.filter((c) => !c.startsWith('bg-')),
          ...FAVORITE_CORNER,
          className
        )}
        style={SHARED_BADGE_CORNER_STYLE}
        title={title}
        aria-label={title}
        data-testid="favorite-badge"
      >
        <StarGlyph className="w-3.5 h-3.5" />
      </span>
    );
  }
  return (
    <span
      className={clsx(
        ...SHARED_BADGE_INLINE_CLASSES.filter((c) => !c.startsWith('bg-')),
        ...FAVORITE_INLINE,
        className
      )}
      title={title}
      aria-label={title}
      data-testid="favorite-badge"
    >
      <StarGlyph className="w-3 h-3" />
    </span>
  );
};

export const MentionBadge: FC<{
  count: number;
  variant: SharedBadgeVariant;
  title: string;
  className?: string;
}> = ({ count, variant, title, className }) => {
  // Zéro mention non lue = rien à dire : on s'efface, le consommateur n'a pas à tester.
  if (count < 1) return null;
  if (variant === 'corner') {
    return (
      <span
        className={clsx(...SHARED_BADGE_CORNER_CLASSES, className)}
        style={SHARED_BADGE_CORNER_STYLE}
        title={title}
        aria-label={title}
        data-testid="mention-badge"
      >
        <span aria-hidden="true">@</span>
        {count > 1 && <span>{count}</span>}
      </span>
    );
  }
  return (
    <span
      className={clsx(...SHARED_BADGE_INLINE_CLASSES, className)}
      title={title}
      aria-label={title}
      data-testid="mention-badge"
    >
      <span aria-hidden="true">@</span>
      {count > 1 && <span>{count}</span>}
    </span>
  );
};
