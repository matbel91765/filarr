/**
 * Bloc « Repartition par type » -- trois facons de lire la meme repartition.
 *
 * Le donut, les barres, la liste. MEME source (`useFileTypeDonut`), meme calcul
 * que le bandeau historique : deux repartitions nourries par deux calculs
 * finiraient par ne plus donner les memes parts pour les memes fichiers.
 *
 * Pourquoi trois et pas un : un donut est joli et se lit MAL. Comparer deux
 * parts voisines dans un camembert demande un effort qu'une barre ne demande
 * pas, et savoir le chiffre exact demande la liste. Les trois disent la meme
 * chose a trois distances de lecture differentes.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { DonutChart, useFileTypeDonut } from '../../views/Home/DashboardStats';
import { readEnumOption, type WidgetOptionSchema, type WidgetProps } from '../widgetOptions';
import { BlockEmpty } from './BlockEmpty';
import './blocks.css';

export const TYPE_DONUT_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'enum',
    key: 'chart',
    labelKey: 'home.widgets.opt.chartShape',
    fallback: 'donut',
    choices: [
      { value: 'donut', labelKey: 'home.widgets.opt.chartDonut' },
      { value: 'bars', labelKey: 'home.widgets.opt.chartBars' },
      { value: 'list', labelKey: 'home.widgets.opt.chartList' },
    ],
  },
];

export const TypeDonutWidget: React.FC<WidgetProps> = React.memo(function TypeDonutWidget({
  options,
}) {
  const { t } = useTranslation();
  const donutData = useFileTypeDonut();
  const chart = readEnumOption(TYPE_DONUT_OPTIONS, options, 'chart');

  // Le total sert de denominateur aux deux variantes. `|| 1` : sans fichier, la
  // liste est vide et la division n'a jamais lieu -- mais un denominateur nul
  // rendrait `NaN%` si un jour une part survivait a un total de zero.
  const total = donutData.reduce((sum, part) => sum + part.value, 0) || 1;

  return (
    <div className="h-full p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-auto">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
        {t('dashboard.typeDistribution')}
      </p>

      {chart === 'donut' && <DonutChart data={donutData} noFilesLabel={t('dashboard.noFiles')} />}

      {chart !== 'donut' && donutData.length === 0 && (
        <BlockEmpty glyph="file">{t('dashboard.noFiles')}</BlockEmpty>
      )}

      {chart === 'bars' && donutData.length > 0 && (
        <div className="blk-lines">
          {donutData.map((part) => (
            <div key={part.label} className="blk-bar">
              <span className="blk-bar__label">{part.label}</span>
              <span className="blk-bar__track">
                <span
                  className="blk-bar__fill"
                  style={{
                    width: `${Math.max(2, (part.value / total) * 100)}%`,
                    background: part.color,
                  }}
                />
              </span>
              <span className="blk-bar__value">{Math.round((part.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {chart === 'list' && donutData.length > 0 && (
        <div className="blk-lines">
          {donutData.map((part) => (
            <div key={part.label} className="blk-line blk-line--static">
              <span className="blk-line__title">
                <span className="blk-dot" style={{ background: part.color }} aria-hidden="true" />
                {part.label}
              </span>
              <span className="blk-line__meta">{part.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default TypeDonutWidget;
