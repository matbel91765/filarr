/**
 * Dossiers personnalisables — L'EN-TÊTE.
 *
 * ── ON NE RÉINVENTE PAS UN EN-TÊTE ──────────────────────────────────────────
 *
 * Tout ce qui est ici est du CÂBLAGE. La couverture, l'icône, les deux
 * sélecteurs et le geste « Ajouter une couverture » qui apparaît au survol
 * viennent de `PageCover`, celui des notes, dont les props étaient déjà
 * primitives. Un second en-tête aurait voulu dire un second sélecteur de
 * couverture, un second encodage d'icône, un second redimensionnement d'image —
 * et, six mois plus tard, deux comportements de survol différents selon qu'on
 * regarde une note ou un dossier.
 *
 * ── CE QUI CHANGE PAR RAPPORT À UNE NOTE, ET POURQUOI ───────────────────────
 *
 *   · 160 px de haut, contre 180+ sur une note. Une note se lit du haut vers le
 *     bas ; un dossier se PARCOURT, et sa première information utile est la
 *     liste. Vingt pixels de moins, ce n'est pas de la coquetterie : c'est une
 *     ligne de fichiers de plus au premier coup d'œil.
 *   · Le titre est DEVANT la couverture, en bas à gauche, à côté de l'icône —
 *     pas dessous. Posé dessous, il aurait ajouté sa propre ligne : l'en-tête
 *     aurait alors coûté 260 px avant le premier fichier, et personne n'aurait
 *     mis de couverture deux fois.
 *
 * ── SANS COUVERTURE, IL N'Y A PRESQUE RIEN ──────────────────────────────────
 *
 * Le défaut est : PAS de couverture. Il reste alors une ligne compacte avec
 * l'icône et le nom, et « Ajouter une couverture » n'apparaît qu'au survol —
 * exactement le geste des notes. Un dossier auquel personne n'a touché ne rend
 * même pas cet en-tête (voir `FolderView`) : il est rigoureusement identique à
 * ce qu'il était avant ce chantier.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { PageCover } from '../notes/PageCover';
import type { CoverChange } from '../notes/pickers/CoverSelector';
import type { FolderConfig } from './folderLayout';
import './folder.css';

export interface FolderHeaderProps {
  folderName: string;
  config: FolderConfig;
  /** Un correctif partiel de la configuration. `undefined` efface le champ. */
  onChange: (patch: Partial<FolderConfig>) => void;
  /** Aucun réglage possible ici (dossier en lecture, portée héritée…). */
  readOnly?: boolean;
}

export const FolderHeader: React.FC<FolderHeaderProps> = React.memo(function FolderHeader({
  folderName,
  config,
  onChange,
  readOnly,
}) {
  const { t } = useTranslation();

  const handleIconChange = useCallback(
    (icon: string | null) => onChange({ icon: icon ?? undefined }),
    [onChange]
  );

  /**
   * Les trois sources de couverture (image > modèle > couleur héritée) restent
   * MUTUELLEMENT EXCLUSIVES : c'est la même règle que l'éditeur de notes, et la
   * casser produirait une couverture dont l'affichage dépendrait de l'ordre de
   * lecture des champs.
   */
  const handleCoverChange = useCallback(
    (change: CoverChange) => {
      switch (change.type) {
        case 'preset':
          onChange({
            coverPresetId: change.presetId,
            coverImage: undefined,
            coverPosition: undefined,
            coverPositionX: undefined,
            coverScale: undefined,
          });
          break;
        case 'image':
          onChange({
            coverImage: change.dataUrl,
            coverPresetId: undefined,
            coverPosition: config.coverPosition ?? 50,
            coverPositionX: config.coverPositionX ?? 50,
            coverScale: config.coverScale ?? 100,
          });
          break;
        case 'position':
          onChange({ coverPosition: change.position });
          break;
        case 'positionX':
          onChange({ coverPositionX: change.positionX });
          break;
        case 'scale':
          onChange({ coverScale: change.scale });
          break;
        case 'clear':
          onChange({
            coverPresetId: undefined,
            coverImage: undefined,
            coverPosition: undefined,
            coverPositionX: undefined,
            coverScale: undefined,
          });
          break;
      }
    },
    [onChange, config.coverPosition, config.coverPositionX, config.coverScale]
  );

  const hasCover = !!config.coverPresetId || !!config.coverImage;

  return (
    <div
      className={['folder-header', hasCover ? 'folder-header--with-cover' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <PageCover
        icon={config.icon}
        coverPresetId={config.coverPresetId}
        coverImage={config.coverImage}
        coverPosition={config.coverPosition}
        coverPositionX={config.coverPositionX}
        coverScale={config.coverScale}
        onIconChange={handleIconChange}
        onCoverChange={handleCoverChange}
        readOnly={readOnly}
        // Les libellés disent « ce dossier », pas « la note » : c'est tout ce
        // que `PageCover` avait encore d'attaché aux notes.
        changeCoverLabel={t('folder.header.changeCover', 'Changer la couverture du dossier')}
        changeIconLabel={t('folder.header.changeIcon', 'Changer l’icône du dossier')}
        addCoverLabel={t('folder.header.addCover', 'Ajouter une couverture')}
      />
      {/* Le titre est un frère des éléments de `PageCover` (qui rend un
          fragment) : la feuille de style le pose DEVANT la couverture, aligné
          sur l'icône. Il n'est pas un `h1` — la page en a déjà un dans son
          fil d'Ariane, et deux titres de niveau 1 désorientent un lecteur
          d'écran plus qu'ils ne l'aident. */}
      <p className="folder-header__title">{folderName}</p>
    </div>
  );
});

export default FolderHeader;
