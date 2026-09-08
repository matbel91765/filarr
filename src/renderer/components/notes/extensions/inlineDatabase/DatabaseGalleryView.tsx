/**
 * Vue GALERIE d'une base inline.
 *
 * Quatrième régime, après la table, le kanban et le calendrier : une grille de
 * fiches. Elle sert là où une table est illisible — peu de lignes, beaucoup de
 * champs courts (contacts, ouvrages, candidatures).
 *
 * PAS D'IMAGE DE COUVERTURE, et c'est délibéré : la CSP du renderer bloque
 * toute image distante, et les images de Filarr vivent DANS les notes (en
 * data-URI chiffrée), jamais dans les cellules d'une base. Une vignette ne
 * pourrait donc afficher qu'un cadre vide — mieux vaut des fiches qui disent
 * quelque chose que des vignettes qui ne chargent jamais.
 *
 * Ce que la fiche montre est ce que la VUE laisse voir : masquer une colonne
 * dans les options la retire des cartes, exactement comme d'une table.
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveLocale } from './cellFormats';
import { orderedVisibleProperties } from './viewEngine';
import { evaluateFormula, formatFormulaValue } from './formulaEngine';
import { newRow } from './types';
import { RowPanel } from './RowPanel';
import type { DatabaseViewProps, DbProperty, DbRow } from './types';

/** Texte lisible d'une cellule, pour une carte (jamais un identifiant brut). */
function cellText(prop: DbProperty, row: DbRow, properties: DbProperty[], locale: string): string {
  if (prop.type === 'formula') {
    return formatFormulaValue(evaluateFormula(prop.formula ?? '', { properties, row }), locale);
  }

  const value = row.cells[prop.id];
  if (value === undefined || value === null || value === '') return '';

  if (prop.type === 'select' || prop.type === 'multiSelect') {
    const ids = Array.isArray(value) ? value : [value];
    return ids
      .map((id) => prop.options?.find((option) => option.id === id)?.label)
      .filter((label): label is string => typeof label === 'string')
      .join(', ');
  }

  if (prop.type === 'checkbox') return value === true ? '✓' : '';
  if (Array.isArray(value)) return String(value.length);
  return String(value);
}

export const DatabaseGalleryView: React.FC<DatabaseViewProps> = ({
  data,
  visibleRows,
  rowDefaults,
  activeView,
  onChange,
}) => {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const [panelRowId, setPanelRowId] = useState<string | null>(null);

  const shown = useMemo(
    () => orderedVisibleProperties(data.properties, activeView ?? null),
    [data.properties, activeView]
  );

  // La première colonne affichée fait le titre de la carte ; les suivantes en
  // font le corps. Sans elle, une carte n'aurait rien pour se nommer.
  const [titleProp, ...fieldProps] = shown;
  const untitled = t('notes.inlineDb.untitled', 'Untitled');

  return (
    <div className="inline-db__gallery">
      <div className="inline-db__gal-grid">
        {visibleRows.map((row) => (
          <button
            key={row.id}
            type="button"
            className="inline-db__gal-card"
            onClick={() => setPanelRowId(row.id)}
          >
            <span className="inline-db__gal-title">
              {(titleProp && cellText(titleProp, row, data.properties, locale)) || untitled}
            </span>
            {fieldProps.map((prop) => {
              const text = cellText(prop, row, data.properties, locale);
              if (text === '') return null;
              return (
                <span key={prop.id} className="inline-db__gal-field">
                  <span className="inline-db__gal-field-name">{prop.name}</span>
                  <span className="inline-db__gal-field-value">{text}</span>
                </span>
              );
            })}
          </button>
        ))}

        <button
          type="button"
          className="inline-db__gal-add"
          onClick={() =>
            onChange({ ...data, rows: [...data.rows, newRow(data.properties, rowDefaults)] })
          }
        >
          + {t('notes.inlineDb.newRow', 'New row')}
        </button>
      </div>

      {visibleRows.length === 0 && (
        <p className="inline-db__gal-empty">
          {t('notes.inlineDb.galleryEmpty', 'Nothing to show with the current filters.')}
        </p>
      )}

      {panelRowId &&
        (() => {
          const row = data.rows.find((candidate) => candidate.id === panelRowId);
          if (!row) return null;
          return (
            <RowPanel
              data={data}
              row={row}
              visiblePropertyIds={new Set(shown.map((prop) => prop.id))}
              onChange={onChange}
              onClose={() => setPanelRowId(null)}
            />
          );
        })()}
    </div>
  );
};
