/**
 * ThreadBadgeChip — « une discussion », et parfois « n ouverts ».
 *
 * Elle se lit dans ce que la liste tient DÉJÀ : le tampon `meta.threadStats`
 * déposé à chaque écriture de fil (`services/vault/threadStamp`). Aucun
 * sidecar n'est téléchargé pour l'afficher — c'est tout l'intérêt.
 *
 * ── TROIS ÉTATS, ET LE TROISIÈME EST LE PLUS IMPORTANT ──────────────────────
 *
 *   · `open > 0`   — pastille pleine, avec le nombre ;
 *   · `open === 0` — pastille SOURDE : la discussion existe, personne n'attend
 *     de réponse. Elle ne disparaît pas : un fil résolu reste un fil ;
 *   · `exact: false` — pastille SANS NOMBRE. Le tampon manque (fil écrit par
 *     une version qui l'ignore) ou il a vieilli. Mieux vaut une pastille muette
 *     qu'un « 3 ouverts » démenti à l'ouverture du fil.
 *
 * Présentationnel PUR, sur le patron de `SharedBadge` : pas de store, pas
 * d'i18n — le `title` arrive traduit, le consommateur seul sait dire
 * « 3 commentaires ouverts » avec le bon pluriel.
 */

import type { CSSProperties, FC } from 'react';
import clsx from 'clsx';

export type ThreadBadgeVariant = 'corner' | 'inline';

export interface ThreadBadgeChipProps {
  /** Racines non résolues. `0` = pastille sourde, jamais absente. */
  open: number;
  /**
   * Le compte est-il DIGNE DE FOI ? À faux, la pastille se dessine sans
   * nombre : voir l'en-tête.
   */
  exact: boolean;
  variant: ThreadBadgeVariant;
  /** Infobulle, déjà traduite. */
  title: string;
  className?: string;
}

/** Bulle de dialogue — même facture que `PeopleGlyph` de `SharedBadge`. */
const BUBBLE_PATH =
  'M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155';

const BubbleGlyph: FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2.2}
    stroke="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={BUBBLE_PATH} />
  </svg>
);

/**
 * Les classes, exportées pour être ÉPROUVÉES.
 *
 * ⚠ Le piège Tailwind de `SharedBadge` s'applique mot pour mot : une valeur
 * arbitraire `bg-[var(--x)]` suivie d'un modificateur d'opacité (`/90`) est
 * rejetée EN ENTIER, sans un mot, et la pastille se rend sans fond. Les teintes
 * sont donc opaques.
 */
export const THREAD_BADGE_CORNER_CLASSES: readonly string[] = [
  'inline-flex items-center justify-center gap-0.5 h-6 min-w-[1.5rem] px-1 rounded-full',
  'text-[10px] font-semibold leading-none tabular-nums select-none',
];

export const THREAD_BADGE_INLINE_CLASSES: readonly string[] = [
  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full',
  'text-[10px] font-medium uppercase tracking-wide leading-none tabular-nums select-none',
];

/** Fil OUVERT : teinte pleine. */
export const THREAD_BADGE_OPEN_CORNER: readonly string[] = [
  'bg-[var(--color-warning-500)] text-white',
];
export const THREAD_BADGE_OPEN_INLINE: readonly string[] = [
  'bg-[var(--color-warning-50)] text-[var(--color-warning-600)]',
];

/** Fil RÉSOLU (ou compte inconnu) : sourde, sur la teinte de surface. */
export const THREAD_BADGE_QUIET_CORNER: readonly string[] = [
  'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]',
];
export const THREAD_BADGE_QUIET_INLINE: readonly string[] = [
  'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]',
];

/** Liseré de la surface — sans lui, la pastille se fond dans une vignette. */
export const THREAD_BADGE_CORNER_STYLE: CSSProperties = {
  boxShadow: '0 0 0 1.5px var(--color-surface), 0 1px 2px 0 rgb(0 0 0 / 0.05)',
};

export const ThreadBadgeChip: FC<ThreadBadgeChipProps> = ({
  open,
  exact,
  variant,
  title,
  className,
}) => {
  // Un compte inconnu ne s'affiche PAS comme un zéro : zéro veut dire « tout
  // est résolu », ce qui est une affirmation qu'on n'est pas en état de faire.
  const showCount = exact && open > 0;
  const loud = exact && open > 0;

  const base = variant === 'corner' ? THREAD_BADGE_CORNER_CLASSES : THREAD_BADGE_INLINE_CLASSES;
  const tone =
    variant === 'corner'
      ? loud
        ? THREAD_BADGE_OPEN_CORNER
        : THREAD_BADGE_QUIET_CORNER
      : loud
        ? THREAD_BADGE_OPEN_INLINE
        : THREAD_BADGE_QUIET_INLINE;

  return (
    <span
      className={clsx(...base, ...tone, className)}
      style={variant === 'corner' ? THREAD_BADGE_CORNER_STYLE : undefined}
      title={title}
      role="img"
      aria-label={title}
    >
      <BubbleGlyph className="w-3 h-3 shrink-0" />
      {showCount && <span>{open}</span>}
    </span>
  );
};

ThreadBadgeChip.displayName = 'ThreadBadgeChip';

export default ThreadBadgeChip;
