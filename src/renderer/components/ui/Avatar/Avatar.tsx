/**
 * Avatar Component
 *
 * Pastille d'initiales à teinte stable, et empilement d'avatars (AvatarStack).
 *
 * PAS ENCORE POSÉ : aucun consommateur dans ce commit. La brique arrive avant
 * la donnée (la liste des personnes avec qui un élément est partagé) ; la pose
 * viendra avec elle. On le dit ici pour ne pas refaire le coup d'« offlineStatus »
 * — une prop branchée nulle part que personne n'osait plus retirer parce
 * qu'on ne savait plus si elle attendait quelque chose. Celle-ci attend :
 * le lot B, étape 2.
 *
 * Toute la logique (initiales, graine → index de teinte) vit dans
 * avatarModel.ts, sans JSX, pour être testée sous vitest-node. Ici on ne fait
 * que la traduire en classes ; les couleurs elles-mêmes sont dans Avatar.css,
 * exprimées en jetons du thème.
 */

import type { FC } from 'react';
import clsx from 'clsx';
import { avatarHueIndex, avatarInitials } from './avatarModel';
import './Avatar.css';

export type AvatarSize = 'xs' | 'sm' | 'md';

export interface AvatarProps {
  /** Ce qui identifie la personne aux yeux de l'utilisateur : e-mail ou nom affiché. Sert aux initiales et, à défaut de `seed`, à la teinte. */
  label: string;
  /**
   * Graine de la teinte (identifiant stable : id de membre, e-mail normalisé…).
   * À fournir dès qu'on l'a : un nom affiché peut changer, une couleur qui
   * saute au renommage désoriente. Défaut : `label`.
   */
  seed?: string;
  /** xs = 20 px, sm = 24 px, md = 32 px */
  size?: AvatarSize;
  /**
   * Infobulle. Défaut : `label`. `null` = aucun attribut title — c'est ce que
   * fait AvatarStack, qui pose UNE infobulle sur le groupe : un title vide sur
   * l'enfant masquerait celui du parent au lieu d'y retomber.
   */
  title?: string | null;
  /** Classe CSS additionnelle */
  className?: string;
}

/**
 * Composant Avatar
 */
export const Avatar: FC<AvatarProps> = ({ label, seed, size = 'sm', title, className }) => {
  const hue = avatarHueIndex(seed ?? label);
  const classes = clsx('avatar', `avatar--${size}`, `avatar--hue-${hue}`, className);
  const tooltip = title === undefined ? label : title;

  return (
    <span className={classes} role="img" aria-label={label} title={tooltip ?? undefined}>
      {avatarInitials(label)}
    </span>
  );
};

Avatar.displayName = 'Avatar';

export interface AvatarStackItem {
  label: string;
  seed?: string;
}

export interface AvatarStackProps {
  /** Dans l'ordre d'affichage : le premier est posé dessus. */
  items: AvatarStackItem[];
  /** Taille commune à toutes les pastilles */
  size?: AvatarSize;
  /** Nombre de pastilles visibles avant la pastille « +N ». Défaut : 3. */
  max?: number;
  /** Classe CSS additionnelle */
  className?: string;
}

/**
 * Empilement d'avatars : chevauchement, au plus `max` visibles, puis une
 * pastille « +N ». L'infobulle du groupe liste TOUS les libellés, y compris
 * ceux repliés dans « +N » — c'est le seul endroit où on peut les lire.
 */
export const AvatarStack: FC<AvatarStackProps> = ({ items, size = 'sm', max = 3, className }) => {
  if (items.length === 0) return null;

  // max ≥ 1 : un empilement qui ne montrerait que « +N » n'aurait aucun sens.
  const visibleCount = Math.max(1, Math.floor(max));
  const visible = items.slice(0, visibleCount);
  const hidden = items.length - visible.length;
  const allLabels = items.map((item) => item.label).join(', ');

  return (
    <span
      className={clsx('avatar-stack', className)}
      role="group"
      aria-label={allLabels}
      title={allLabels}
    >
      {visible.map((item, index) => (
        <Avatar
          // Le libellé n'est pas forcément unique (deux invités sans nom) :
          // l'index lève l'ambiguïté, et la liste ne se réordonne pas en place.
          key={`${item.seed ?? item.label}-${index}`}
          label={item.label}
          seed={item.seed}
          size={size}
          title={null}
        />
      ))}
      {hidden > 0 && (
        <span
          className={clsx('avatar', `avatar--${size}`, 'avatar-stack__overflow')}
          aria-hidden="true"
        >
          +{hidden}
        </span>
      )}
    </span>
  );
};

AvatarStack.displayName = 'AvatarStack';

export default Avatar;
