/**
 * MemberSelectionBar (F09) — la barre d'actions d'une sélection de MEMBRES, sur
 * le patron de `VaultSelectionBar` (l'explorateur de coffre) : flottante, collée
 * en bas, présente seulement quand quelque chose est coché.
 *
 * DEUX GESTES, ET C'EST TOUT — parce que ce sont les deux seuls qui aient un
 * sens sur un lot : changer le rôle, et retirer. Tout le reste (transférer la
 * propriété, ouvrir un numéro de sécurité, copier un identifiant) porte sur UNE
 * personne et vit sur sa ligne.
 *
 * ELLE NE DÉCIDE RIEN. Comme sa sœur de l'explorateur, elle ne fait que rendre
 * ce que l'hôte lui pose : la sélection est déjà nettoyée par
 * `memberRosterModel` (jamais le propriétaire, jamais soi-même, jamais une ligne
 * qu'un filtre cache), et les deux gestes sont fournis par l'onglet. Une action
 * absente est RETIRÉE, pas grisée — un bouton grisé invite à chercher pourquoi.
 *
 * LE COMPTE EST CELUI DE L'ÉCRAN. « Retirer (3) » doit désigner trois lignes
 * qu'on voit : c'est la seule façon de relire la barre contre le tableau avant
 * de lancer une rotation de clé qu'on ne peut pas défaire.
 *
 * Briques du design system uniquement (`Button`) et jetons de couleur du thème :
 * la barre de l'explorateur personnel est peinte en dur sur un gris sombre, ce
 * qui la rend illisible sur les thèmes clairs — on ne reproduit pas ce défaut.
 *
 * F28 — ELLE REMONTE AU-DESSUS DU CLAVIER VIRTUEL. Sur un téléphone, ouvrir un
 * clavier ne change NI la hauteur de la fenêtre ni celle de la mise en page : le
 * clavier se pose PAR-DESSUS. Une barre collée en bas se retrouve donc dessous,
 * c'est-à-dire invisible, au moment précis où l'on cherche à valider ce qu'on
 * vient de taper. Seule la « fenêtre visuelle » (`visualViewport`) connaît ce
 * recouvrement : on lui demande de combien, et on remonte d'autant.
 *
 * L'API PEUT MANQUER, et la barre doit alors rester exactement où elle était :
 * Electron n'a pas de clavier virtuel, et l'écart y vaut zéro de toute façon.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui';

export interface MemberSelectionBarProps {
  selectedCount: number;
  /** Combien de lignes une case à cocher peut atteindre — pour « Tout cocher ». */
  selectableCount: number;
  /** Un lot est en vol : la barre se gèle et dit où il en est. */
  progress?: { done: number; total: number; label: string } | null;
  disabled?: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onChangeRole: () => void;
  onRemove: () => void;
}

export const MemberSelectionBar: React.FC<MemberSelectionBarProps> = ({
  selectedCount,
  selectableCount,
  progress,
  disabled,
  onSelectAll,
  onClear,
  onChangeRole,
  onRemove,
}) => {
  const { t } = useTranslation();

  /**
   * DE COMBIEN LE CLAVIER RECOUVRE-T-IL LE BAS DE LA FENÊTRE ?
   *
   * `window.innerHeight` est la fenêtre de MISE EN PAGE : elle ignore le clavier.
   * La différence avec la fenêtre VISUELLE (hauteur + décalage vertical) donne
   * exactement la bande masquée. On la borne à zéro : pendant l'élan d'un
   * défilement, le navigateur rend des valeurs légèrement négatives, et une barre
   * qui descendrait en dessous du bord serait pire que le défaut qu'on corrige.
   *
   * L'état vit ici et non dans un hook partagé : c'est la seule barre flottante
   * de cette page, et le jour où il y en aura une seconde ce sera le bon moment
   * pour en extraire un hook — pas avant.
   */
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    // Un cleanup rendu DANS TOUS LES CAS (TS7030).
    if (!vv) return () => {};
    const mesurer = () => {
      setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    mesurer();
    vv.addEventListener('resize', mesurer);
    vv.addEventListener('scroll', mesurer);
    return () => {
      vv.removeEventListener('resize', mesurer);
      vv.removeEventListener('scroll', mesurer);
    };
  }, []);

  if (selectedCount === 0) return null;
  const busy = !!progress || !!disabled;
  const tout = selectedCount >= selectableCount;

  return (
    <div
      role="toolbar"
      aria-label={t('teamVaults.settings.bulk.toolbar')}
      className="sticky bottom-4 mx-auto w-fit max-w-full z-40 flex items-center gap-1 flex-wrap px-3 py-2 rounded-xl
        bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl"
      style={keyboardInset > 0 ? { transform: `translateY(-${keyboardInset}px)` } : undefined}
    >
      <span className="text-sm font-medium pr-2 mr-1 border-r border-[var(--color-border)] text-[var(--color-text-primary)] whitespace-nowrap">
        {t('teamVaults.settings.bulk.count', { count: selectedCount })}
      </span>

      {progress ? (
        // Un lot en vol DIT où il en est : un changement de rôle sur dix
        // personnes est dix allers-retours, et une barre figée sans un mot
        // ferait cliquer une seconde fois.
        <span
          className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap px-2"
          aria-live="polite"
        >
          {progress.label} {progress.done}/{progress.total}
        </span>
      ) : (
        <Button variant="ghost" size="sm" onClick={tout ? onClear : onSelectAll}>
          {tout ? t('teamVaults.settings.bulk.clear') : t('teamVaults.settings.bulk.selectAll')}
        </Button>
      )}

      <div className="w-px h-5 bg-[var(--color-border)] mx-1" aria-hidden="true" />

      <Button variant="secondary" size="sm" disabled={busy} onClick={onChangeRole}>
        {t('teamVaults.settings.bulk.role', { count: selectedCount })}
      </Button>
      <Button variant="danger" size="sm" disabled={busy} onClick={onRemove}>
        {t('teamVaults.settings.bulk.remove', { count: selectedCount })}
      </Button>
    </div>
  );
};

export default MemberSelectionBar;
