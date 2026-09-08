/**
 * Dossiers personnalisables — LE MENU.
 *
 * ── IL NE COÛTE AUCUN PIXEL À UN DOSSIER AU REPOS ───────────────────────────
 *
 * Il est posé dans la barre d'actions de l'explorateur, à côté de « Upload » et
 * « Nouveau dossier ». C'est la seule place qui ne déplace RIEN : un en-tête
 * rétractable au-dessus de la liste (ce que fait l'accueil) aurait poussé le
 * premier fichier de vingt-huit pixels vers le bas dans les cinq mille dossiers
 * que personne ne personnalisera jamais.
 *
 * ── LA PORTÉE EST ÉCRITE, PAS DEVINÉE ───────────────────────────────────────
 *
 * Les trois états sont NOMMÉS et cochés dans le menu. C'est le point qui rend
 * l'héritage utilisable : un réglage hérité qu'on ne peut pas lire est un
 * réglage dont on ne comprend ni d'où il vient ni pourquoi le modifier change
 * douze autres dossiers. Chaque entrée dit ce qu'elle fait, et « Comme partout »
 * dit en clair que le dossier cesse d'avoir des réglages à lui.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Dropdown, type DropdownItem } from '../ui/Dropdown';
import type { FolderScope } from './folderLayout';
import './folder.css';

export interface FolderLayoutMenuProps {
  scope: FolderScope;
  /** Le document de mise en page est arrêté : on peut écrire dedans. */
  canEdit: boolean;
  /** La colonne est assez large pour ranger une grille en douze colonnes. */
  wideEnough: boolean;
  editing: boolean;
  hasReadme: boolean;
  hasBand: boolean;
  bandCollapsed: boolean;
  hasOwnDisplay: boolean;
  /** Nom du dossier dont ce dossier hérite, s'il y en a un. */
  inheritedFromName: string | null;

  onSetScope: (scope: FolderScope) => void;
  onAddReadme: () => void;
  /** Fait apparaître l’en-tête (icône + couverture) sur un dossier qui n’en a pas encore. */
  onAddHeader?: () => void;
  /** Couleur et emoji de la CARTE du dossier — la modale que tout le reste de l’app appelle « Personnaliser ». */
  onStyleFolder?: () => void;
  onOpenReadme: () => void;
  onDetachReadme: () => void;
  onToggleBand: () => void;
  onStartEditing: () => void;
  onFinishEditing: () => void;
  onToggleDisplayOverride: () => void;
}

const MoreIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="folder-menu__glyph"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
    />
  </svg>
);

export const FolderLayoutMenu: React.FC<FolderLayoutMenuProps> = ({
  scope,
  canEdit,
  wideEnough,
  editing,
  hasReadme,
  hasBand,
  bandCollapsed,
  hasOwnDisplay,
  inheritedFromName,
  onSetScope,
  onAddReadme,
  onAddHeader,
  onStyleFolder,
  onOpenReadme,
  onDetachReadme,
  onToggleBand,
  onStartEditing,
  onFinishEditing,
  onToggleDisplayOverride,
}) => {
  const { t } = useTranslation();

  const items = useMemo<DropdownItem[]>(() => {
    if (!canEdit) {
      // L'entrée reste, GRISÉE, avec la raison écrite. La faire disparaître
      // laisserait croire que la personnalisation n'existe pas.
      return [
        {
          label: t('folder.customize.unavailable', 'Personnalisation indisponible pour le moment'),
          disabled: true,
        },
      ];
    }

    const tick = (on: boolean, label: string) => `${on ? '✓ ' : ''}${label}`;
    const list: DropdownItem[] = [
      {
        label: tick(scope === 'global', t('folder.scope.global', 'Comme partout')),
        onClick: () => onSetScope('global'),
      },
      {
        label: tick(
          scope === 'inherit',
          inheritedFromName
            ? t('folder.scope.inheritFrom', 'Comme le dossier parent (« {{name}} »)', {
                name: inheritedFromName,
              })
            : t('folder.scope.inherit', 'Comme le dossier parent')
        ),
        onClick: () => onSetScope('inherit'),
      },
      {
        label: tick(scope === 'own', t('folder.scope.own', 'Propre à ce dossier')),
        onClick: () => onSetScope('own'),
        divider: true,
      },
    ];

    // ── La note d'accueil ──────────────────────────────────────────────────
    // Ce que « Personnaliser » veut dire partout ailleurs dans l’app (cartes,
    // accueil) : la couleur et l’emoji du dossier. Le bandeau de blocs, lui,
    // s’appelle par son nom plus bas.
    if (onStyleFolder) {
      list.push({
        label: t('folder.header.style', 'Couleur et icône du dossier…'),
        onClick: onStyleFolder,
      });
    }
    if (hasReadme) {
      list.push({ label: t('folder.readme.open', 'Ouvrir la description'), onClick: onOpenReadme });
      list.push({
        label: t('folder.readme.detach', 'Retirer'),
        onClick: onDetachReadme,
      });
    } else {
      list.push({
        label: t('folder.readme.add', 'Ajouter une description'),
        onClick: onAddReadme,
      });
    }
    // Une icône ou une couverture se pose depuis l’en-tête, qui ne s’affiche
    // que s’il a quelque chose à montrer : cette entrée le fait apparaître.
    if (onAddHeader) {
      list.push({
        label: t('folder.header.add', 'Ajouter une icône ou une couverture'),
        onClick: onAddHeader,
      });
    }
    list[list.length - 1].divider = true;

    // ── Le bandeau ─────────────────────────────────────────────────────────
    if (hasBand) {
      list.push({
        label: bandCollapsed
          ? t('folder.band.show', 'Afficher le bandeau')
          : t('folder.band.hide', 'Replier le bandeau'),
        onClick: onToggleBand,
      });
    }
    if (editing) {
      list.push({ label: t('home.customize.finish', 'Terminé'), onClick: onFinishEditing });
    } else if (!wideEnough) {
      list.push({
        label: t('folder.customize.tooNarrow', 'Réorganisez le bandeau sur une fenêtre plus large'),
        disabled: true,
      });
    } else {
      list.push({
        label: t('folder.customize.start', 'Modifier le bandeau de blocs'),
        onClick: onStartEditing,
      });
    }
    list[list.length - 1].divider = true;

    // ── Les préférences de liste ───────────────────────────────────────────
    list.push({
      label: tick(hasOwnDisplay, t('folder.display.own', 'Affichage propre à ce dossier')),
      onClick: onToggleDisplayOverride,
    });

    return list;
  }, [
    t,
    canEdit,
    scope,
    inheritedFromName,
    hasReadme,
    hasBand,
    bandCollapsed,
    hasOwnDisplay,
    editing,
    wideEnough,
    onSetScope,
    onAddReadme,
    onAddHeader,
    onStyleFolder,
    onOpenReadme,
    onDetachReadme,
    onToggleBand,
    onStartEditing,
    onFinishEditing,
    onToggleDisplayOverride,
  ]);

  const label = t('folder.customize.menu', 'Options du dossier');

  return (
    <Dropdown
      position="bottom-right"
      items={items}
      trigger={
        <span className="folder-menu__button" aria-label={label} title={label}>
          <MoreIcon />
        </span>
      }
    />
  );
};

export default FolderLayoutMenu;
