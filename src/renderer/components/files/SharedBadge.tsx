/**
 * SharedBadge — « partagé avec N personnes », en deux formes.
 *
 * PAS ENCORE POSÉ : aucun consommateur dans ce commit. La pastille arrive
 * avant la donnée (le compte de personnes avec qui un élément est partagé) ;
 * la pose sur FileCard / SubfolderCard / la liste des coffres viendra avec
 * elle. On le dit ici pour ne pas refaire le coup d'« offlineStatus » — une
 * prop branchée nulle part que personne n'osait plus retirer parce qu'on ne
 * savait plus si elle attendait quelque chose. Celle-ci attend : le lot B,
 * étape 2.
 *
 * Présentationnel PUR : pas de store, pas d'i18n — le `title` (seule infobulle
 * possible ici, le dépôt n'a pas de composant Tooltip) est fourni traduit par
 * le consommateur, qui seul sait dire « partagé avec 3 personnes » dans la
 * bonne langue et avec le bon pluriel.
 *
 *  - `corner` : pastille ronde calquée sur celles que FileCard pose en absolu
 *    (rappel, cadenas) — même gabarit w-6 h-6, même ombre, teinte primaire,
 *    plus un liseré de la surface (patron SyncBadge) pour se détacher d'une
 *    vignette de n'importe quelle couleur.
 *    Le POSITIONNEMENT (absolute top-2 right-2…) est laissé au consommateur
 *    via `className` : la carte sait où sont ses autres pastilles, pas nous.
 *  - `inline` : pilule calquée sur le « Partagé » de VaultsList — même
 *    typographie, même couple primary-50 / primary-600.
 */

import type { CSSProperties, FC } from 'react';
import clsx from 'clsx';

export type SharedBadgeVariant = 'corner' | 'inline';

export interface SharedBadgeProps {
  /** Nombre de personnes avec qui l'élément est partagé. Affiché à partir de 2 : à 1, l'icône suffit. */
  count: number;
  variant: SharedBadgeVariant;
  /** Infobulle, déjà traduite (ex. « Partagé avec 3 personnes »). */
  title: string;
  /** Classe CSS additionnelle — c'est ici que `corner` reçoit sa position absolue. */
  className?: string;
}

/**
 * Silhouettes — même tracé que PeopleIcon (itemContextMenu.tsx, « Membres »),
 * recopié plutôt qu'importé : ce module ne doit pas tirer tout le menu
 * contextuel pour une icône, et PeopleIcon impose son gabarit de menu (16 px).
 */
const PEOPLE_PATH =
  'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z';

const PeopleGlyph: FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2.5}
    stroke="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={PEOPLE_PATH} />
  </svg>
);

/**
 * Les classes des deux formes, exportées pour être ÉPROUVÉES
 * (__tests__/sharedBadgeClasses.vitest.ts).
 *
 * Piège Tailwind à ne pas rejouer : une valeur arbitraire `bg-[var(--x)]`
 * suivie d'un modificateur d'opacité (`/90`). Tailwind ne sait pas décomposer
 * une variable CSS en canaux pour y appliquer l'opacité, alors il rejette la
 * classe ENTIÈRE, sans un mot — et la pastille se rendait sans fond, invisible
 * sur une vignette claire. La teinte se pose donc avec la variable opaque ; si
 * une opacité comptait vraiment, elle passerait par `color-mix()` en style,
 * comme folder.css le fait déjà.
 */
export const SHARED_BADGE_CORNER_CLASSES: readonly string[] = [
  // min-w plutôt que w : rond tant qu'il n'y a que l'icône (1.5rem = w-6),
  // il s'allonge en gélule dès qu'un compte s'ajoute.
  'inline-flex items-center justify-center gap-0.5 h-6 min-w-[1.5rem] px-1 rounded-full',
  'bg-[var(--color-primary-500)] text-white',
  'text-[10px] font-semibold leading-none tabular-nums select-none',
];

export const SHARED_BADGE_INLINE_CLASSES: readonly string[] = [
  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full',
  'text-[10px] font-medium uppercase tracking-wide leading-none tabular-nums select-none',
  'bg-[var(--color-primary-50)] text-[var(--color-primary-600)]',
];

/**
 * Liseré de la surface (patron SyncBadge) + l'ombre douce de `shadow-sm`,
 * recopiée ici parce qu'un `box-shadow` en style écraserait la classe. Le
 * liseré est ce qui détache la pastille d'une vignette : sans lui, une pastille
 * primaire posée sur une miniature bleue se fond dedans.
 */
export const SHARED_BADGE_CORNER_STYLE: CSSProperties = {
  boxShadow: '0 0 0 1.5px var(--color-surface), 0 1px 2px 0 rgb(0 0 0 / 0.05)',
};

/**
 * Composant SharedBadge
 */
export const SharedBadge: FC<SharedBadgeProps> = ({ count, variant, title, className }) => {
  // Rien à dire pour un élément partagé avec personne : plutôt que d'afficher
  // une pastille mensongère, on s'efface. Le consommateur n'a pas à le tester.
  if (count < 1) return null;

  const showCount = count > 1;

  if (variant === 'corner') {
    return (
      <span
        className={clsx(...SHARED_BADGE_CORNER_CLASSES, className)}
        style={SHARED_BADGE_CORNER_STYLE}
        title={title}
        role="img"
        aria-label={title}
      >
        <PeopleGlyph className="w-3 h-3 shrink-0" />
        {showCount && <span>{count}</span>}
      </span>
    );
  }

  return (
    <span
      className={clsx(...SHARED_BADGE_INLINE_CLASSES, className)}
      title={title}
      role="img"
      aria-label={title}
    >
      <PeopleGlyph className="w-3 h-3 shrink-0" />
      {showCount && <span>{count}</span>}
    </span>
  );
};

SharedBadge.displayName = 'SharedBadge';

export default SharedBadge;
