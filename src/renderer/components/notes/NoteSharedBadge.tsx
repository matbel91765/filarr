/**
 * NoteSharedBadge — « une copie de cette note est partie dans un coffre ».
 *
 * CONNECTÉ (prop `noteId`, lecture de `selectShareInfoByNoteId` en interne) et
 * mémoïsé, POURQUOI : `NoteCard` et `TreeNodeRow` sont des `React.memo` dont
 * la mémoïsation tient à la stabilité de leurs props. Leur passer un objet
 * d'état de partage recalculé par le parent casserait cette mémoïsation à
 * chaque rendu de liste ; ici chaque badge s'abonne à SON entrée de la table
 * mémoïsée (référence stable tant que notes × coffres ne bougent pas) et le
 * parent n'a rien à savoir. Rend `null` sans dépôt — et en mode local, où le
 * partage n'existe pas (règle du dépôt : hors nuage, tout ce qui touche au
 * partage se rend null).
 *
 * Ce que le badge DIT et OÙ il MÈNE est décidé dans `noteSharedBadgeModel`
 * (pur, testé) ; ce fichier ne fait que traduire et poser dans le DOM.
 *
 * Le clic (états `live`/`locked`) ouvre le coffre — via `vaultShareDestination`,
 * seul point à retoucher pour un futur lien profond vers l'élément. Il ARRÊTE
 * la propagation : la carte et la ligne d'arbre sélectionnent la note au clic
 * (et à Entrée), ce n'est pas ce que l'utilisateur a demandé.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { RootState } from '../../../store';
import { selectShareInfoByNoteId } from '../../../store/selectors/noteShareSelectors';
import {
  isShareBadgeNavigable,
  primaryShareEntry,
  shareBadgeChipLabel,
  shareBadgeDestination,
  shareBadgeExtraCount,
  shareBadgeLabel,
  shareBadgeMoreTooltip,
  shareBadgeTooltip,
  type NoteSharedBadgeVariant,
  type ShareBadgeText,
} from './noteSharedBadgeModel';
import './NoteSharedBadge.css';

interface NoteSharedBadgeProps {
  noteId: string;
  variant?: NoteSharedBadgeVariant;
}

const ICON_SIZE: Record<NoteSharedBadgeVariant, number> = { dot: 10, chip: 10, full: 14 };

/** Un coffre (porte à cadran), dans le trait des autres glyphes des notes. */
const VaultIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 8.5V6.5M12 17.5v-2M8.5 12h-2M17.5 12h-2" />
  </svg>
);

export const NoteSharedBadge: React.FC<NoteSharedBadgeProps> = React.memo(function NoteSharedBadge({
  noteId,
  variant = 'dot',
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const info = useSelector((s: RootState) => selectShareInfoByNoteId(s)[noteId]);

  const destination = info ? shareBadgeDestination(info) : null;
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (destination) navigate(destination);
    },
    [destination, navigate]
  );

  if (accountMode !== 'cloud' || !info) return null;

  const tr = (text: ShareBadgeText): string => t(text.key, text.fallback, text.params);
  const primary = primaryShareEntry(info);
  const more = shareBadgeMoreTooltip(info);
  const tooltip = [tr(shareBadgeTooltip(primary, i18n.language)), more ? tr(more) : '']
    .filter(Boolean)
    .join('\n');
  const navigable = isShareBadgeNavigable(info.badge);
  const extra = shareBadgeExtraCount(info);
  const size = ICON_SIZE[variant];

  const className = [
    'note-shared-badge',
    `note-shared-badge--${variant}`,
    `note-shared-badge--${info.badge}`,
    navigable && 'note-shared-badge--navigable',
  ]
    .filter(Boolean)
    .join(' ');

  const body =
    variant === 'dot' ? (
      <VaultIcon size={size} />
    ) : variant === 'chip' ? (
      <>
        <VaultIcon size={size} />
        <span className="note-shared-badge__text">{tr(shareBadgeChipLabel(primary))}</span>
        {extra > 0 && <span className="note-shared-badge__more">+{extra}</span>}
      </>
    ) : (
      <>
        <VaultIcon size={size} />
        <span className="note-shared-badge__text">{tr(shareBadgeLabel(info.badge))}</span>
        {extra > 0 && <span className="note-shared-badge__more">+{extra}</span>}
      </>
    );

  // Un vrai bouton quand il mène quelque part (focusable, Entrée = clic), un
  // simple span sinon — un « bouton » qui ne fait rien tromperait le clavier.
  if (navigable) {
    return (
      <button
        type="button"
        className={className}
        title={tooltip}
        aria-label={variant === 'dot' ? tooltip : undefined}
        onClick={handleClick}
        onKeyDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {body}
      </button>
    );
  }
  return (
    <span
      className={className}
      title={tooltip}
      aria-label={variant === 'dot' ? tooltip : undefined}
    >
      {body}
    </span>
  );
});

export default NoteSharedBadge;
