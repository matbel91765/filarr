/**
 * Bloc « Tuile de chiffre » — UNE valeur, UN libellé.
 *
 * ── POURQUOI UN SEUL COMPOSANT POUR QUATRE TUILES ───────────────────────────
 *
 * La rangée du haut de « Tableau de bord » aligne quatre tuiles : fichiers,
 * dossiers, espace utilisé, notes. Quatre composants séparés auraient fini avec
 * quatre typographies, quatre paddings et quatre façons d'écrire un libellé —
 * c'est exactement comme ça qu'un tableau de bord se dégrade, un bloc à la fois,
 * sans qu'aucun ne paraisse fautif isolément.
 *
 * Il y a donc UN composant, un réglage `metric`, et les règles de cohérence
 * tiennent dans deux classes (`.home-metric`, `.home-card__label`) : même
 * graisse et même taille pour toutes les valeurs, petites majuscules espacées
 * pour tous les libellés.
 *
 * Les chiffres eux-mêmes viennent des mêmes crochets que le bandeau historique
 * (`DashboardStats`) : deux calculs pour le même compte finiraient par ne plus
 * donner le même nombre au même moment.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useFormatSize, useStatCardFigures } from '../../views/Home/DashboardStats';
import { selectAuthoredNoteCount } from '../homeSelectors';
import { readEnumOption, type WidgetOptionSchema, type WidgetProps } from '../widgetOptions';
import '../presets/homePresets.css';
import './blocks.css';

/**
 * LES VARIANTES DE LA TUILE.
 *
 * Quatre tuiles identiques alignees en haut de l'accueil, c'est un bandeau
 * d'aeroport. La MEME rangee avec une tuile en accent et trois en contour
 * devient une hierarchie : on sait ce qu'on est cense regarder.
 *
 * Ces variantes ne changent QUE l'habillage. La valeur, son calcul et son
 * libelle restent les memes -- c'est la difference entre proposer un choix
 * visuel et fabriquer quatre blocs qui divergeront.
 */
export const STAT_TILE_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'enum',
    key: 'tone',
    labelKey: 'home.widgets.opt.tileTone',
    fallback: 'plain',
    choices: [
      { value: 'plain', labelKey: 'home.widgets.opt.tonePlain' },
      { value: 'accent', labelKey: 'home.widgets.opt.toneAccent' },
      { value: 'outline', labelKey: 'home.widgets.opt.toneOutline' },
      { value: 'gradient', labelKey: 'home.widgets.opt.toneGradient' },
    ],
  },
  {
    kind: 'enum',
    key: 'align',
    labelKey: 'home.widgets.opt.tileAlign',
    fallback: 'center',
    choices: [
      { value: 'center', labelKey: 'home.widgets.opt.alignCenter' },
      { value: 'start', labelKey: 'home.widgets.opt.alignStart' },
    ],
  },
  {
    kind: 'enum',
    key: 'metric',
    labelKey: 'home.widgets.opt.metric',
    fallback: 'files',
    choices: [
      { value: 'files', labelKey: 'home.stats.files' },
      { value: 'folders', labelKey: 'home.stats.folders' },
      { value: 'storage', labelKey: 'home.stats.storage' },
      { value: 'notes', labelKey: 'home.stats.notes' },
    ],
  },
];

export const StatTileWidget: React.FC<WidgetProps> = React.memo(function StatTileWidget({
  options,
}) {
  const { t } = useTranslation();
  const { fileCount, folderCount, totalSize } = useStatCardFigures();
  const noteCount = useSelector(selectAuthoredNoteCount);
  const formatSize = useFormatSize();

  // Une valeur hors des choix DÉCLARÉS (gabarit d'une version plus récente,
  // fichier trafiqué) retombe sur le repli du schéma — jamais sur un `undefined`
  // affiché tel quel.
  const metric = readEnumOption(STAT_TILE_OPTIONS, options, 'metric');
  const tone = readEnumOption(STAT_TILE_OPTIONS, options, 'tone');
  const align = readEnumOption(STAT_TILE_OPTIONS, options, 'align');

  const value =
    metric === 'folders'
      ? String(folderCount)
      : metric === 'storage'
        ? formatSize(totalSize)
        : metric === 'notes'
          ? String(noteCount)
          : String(fileCount);

  const label =
    metric === 'folders'
      ? t('home.stats.folders', 'Dossiers')
      : metric === 'storage'
        ? t('home.stats.storage', 'Espace utilisé')
        : metric === 'notes'
          ? t('home.stats.notes', 'Notes')
          : t('home.stats.files', 'Fichiers');

  return (
    <div className={`home-card justify-center gap-1 blk-tile blk-tile--${tone} blk-tile--${align}`}>
      <p className="home-metric">{value}</p>
      <p className="home-card__label">{label}</p>
    </div>
  );
});

export default StatTileWidget;
