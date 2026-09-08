/**
 * VaultGlyph (F14) — le signe d'un coffre, écrit UNE fois.
 *
 * TROIS ÉTATS, DANS CET ORDRE : l'emoji choisi s'il y en a un, sinon l'icône
 * choisie, sinon le cadenas — celui d'avant la fiche, au trait près. Un coffre
 * qui n'a pas été personnalisé doit être EXACTEMENT ce qu'il était : la fiche
 * ajoute une possibilité, elle ne change pas l'aspect de ce que personne n'a
 * touché.
 *
 * LA COULEUR VIENT DE LA PALETTE, JAMAIS D'UNE CHAÎNE LIBRE. Elle est bornée à
 * l'écriture ET relue bornée (`normalizeVaultAppearance`), parce qu'elle finit
 * dans du CSS : ce qui est écrit dans l'enveloppe d'un coffre partagé vient
 * d'un autre membre, et une valeur libre serait une injection de style dans
 * notre fenêtre. Sans couleur, le glyphe garde la teinte primaire du thème.
 */

import React from 'react';
import type {
  VaultAppearance,
  VaultAppearanceIcon,
} from '../../../services/vault/vaultNameEnvelope';

/**
 * Le cadenas historique — le glyphe par défaut d'un coffre partagé, repris tel
 * quel des cartes pour que rien ne bouge sur un coffre non personnalisé.
 */
export const VaultLockGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.8}
    stroke="currentColor"
    className={className ?? 'w-5 h-5'}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z"
    />
  </svg>
);

/**
 * Les tracés des icônes connues. La liste est fermée côté modèle
 * (`VAULT_APPEARANCE_ICONS`) précisément pour que ce tableau soit exhaustif :
 * un nom inconnu ne dessinerait rien, et un trou à la place du glyphe se lit
 * comme un coffre cassé.
 */
const ICON_PATHS: Record<VaultAppearanceIcon, React.ReactNode> = {
  lock: (
    <path d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z" />
  ),
  folder: (
    <path d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
  ),
  briefcase: (
    <path d="M20.25 14.15v4.073a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a9.75 9.75 0 0 1-5.396 0l-1.32-.377a2.25 2.25 0 0 1-1.632-2.163V14.15M3.75 9.349v4.073a2.25 2.25 0 0 0 1.632 2.163l1.32.377M16.5 6.75V5.25a2.25 2.25 0 0 0-2.25-2.25h-4.5A2.25 2.25 0 0 0 7.5 5.25v1.5m9 0h3a2.25 2.25 0 0 1 2.25 2.25v2.507a2.25 2.25 0 0 1-1.591 2.152l-6.16 1.76a4.5 4.5 0 0 1-2.498 0l-6.16-1.76A2.25 2.25 0 0 1 2.25 11.507V9a2.25 2.25 0 0 1 2.25-2.25h12Z" />
  ),
  star: (
    <path d="M11.48 3.5a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .32-.988l5.519-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
  ),
  shield: (
    <path d="M12 3 4.5 6v6c0 5.25 7.5 9 7.5 9s7.5-3.75 7.5-9V6L12 3Zm-2.25 9 1.5 1.5 3-3.75" />
  ),
  heart: (
    <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.098 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
  ),
  archive: (
    <path d="M20.25 7.5 19.5 19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5L3.75 7.5m6 3h4.5M3 7.5h18v-3a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 4.5v3Z" />
  ),
  document: (
    <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
  ),
};

export interface VaultGlyphProps {
  /** L'apparence effective — partagée, recouverte par le repère personnel. */
  appearance?: VaultAppearance;
  /** Les classes de taille du glyphe (le même vocabulaire qu'avant). */
  className?: string;
}

/**
 * Le glyphe seul, sans fond. Il prend la couleur choisie ; sans couleur, il
 * hérite de celle de son conteneur (donc du thème), comme avant.
 */
export const VaultGlyph: React.FC<VaultGlyphProps> = ({ appearance, className }) => {
  if (appearance?.emoji) {
    return (
      <span
        className={`${className ?? 'w-5 h-5'} inline-flex items-center justify-center leading-none`}
        // L'emoji EST le dessin : il ne prend pas la couleur, sinon il
        // deviendrait un carré teinté sur les polices monochromes.
        aria-hidden="true"
        style={{ fontSize: '1em' }}
      >
        {appearance.emoji}
      </span>
    );
  }
  const icone = appearance?.icon;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'w-5 h-5'}
      aria-hidden="true"
      style={appearance?.color ? { color: appearance.color } : undefined}
    >
      {icone ? ICON_PATHS[icone] : ICON_PATHS.lock}
    </svg>
  );
};

/**
 * La couleur de FOND d'une vignette de coffre — la teinte choisie, très
 * diluée, ou le fond primaire du thème quand rien n'a été choisi.
 *
 * `color-mix` plutôt qu'un suffixe d'opacité en hexadécimal : la teinte reste
 * lisible dans les deux thèmes, et c'est déjà le procédé du design system
 * (`settings/enterprise`).
 */
export function vaultTintStyle(appearance: VaultAppearance | undefined): React.CSSProperties {
  if (!appearance?.color) return {};
  return {
    backgroundColor: `color-mix(in srgb, ${appearance.color} 14%, transparent)`,
    color: appearance.color,
  };
}

export default VaultGlyph;
