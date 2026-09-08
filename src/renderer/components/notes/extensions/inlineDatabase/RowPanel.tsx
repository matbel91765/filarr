/**
 * RowPanel — une ligne de base ouverte COMME UNE FICHE.
 *
 * C'est ce qui manquait dès qu'une base sert vraiment : une ligne n'existait
 * qu'en tant que rangée, lisible seulement à travers les colonnes que la vue
 * laisse voir. Trois conséquences qu'on payait tous les jours :
 *  - une colonne masquée devenait INACCESSIBLE (la donnée est là, rien ne
 *    permet de la lire ni de la corriger) ;
 *  - une base large obligeait à défiler horizontalement pour saisir une ligne ;
 *  - le kanban et le calendrier n'affichent qu'un titre, sans aucune issue vers
 *    le reste de la ligne.
 *
 * La fiche montre donc TOUTES les propriétés, masquées comprises, et le dit.
 *
 * Les types dérivés (agrégat) et les liens (relation, note) s'affichent en
 * lecture seule plutôt que d'être absents : mieux vaut voir une valeur qu'on ne
 * peut pas changer ici que croire qu'elle n'existe pas.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { propertyTypeLabel } from './types';
import type { DbProperty, DbRow, InlineDbData } from './types';
import { selectedOptionIds } from './cellValues';
import { initialsOf, knownPeople, peopleOf, personColorIndex, writePeople } from './people';
import { eligibleParents, parentIdOf } from './rowTree';

interface RowPanelProps {
  data: InlineDbData;
  row: DbRow;
  /** Propriétés que la vue affiche : le reste est signalé comme masqué. */
  visiblePropertyIds: Set<string>;
  onChange: (next: InlineDbData) => void;
  onClose: () => void;
  /** Navigation d'une ligne à l'autre sans repasser par la table. */
  onStep?: (delta: -1 | 1) => void;
  /** Fige cette ligne comme modèle réutilisable. */
  onSaveAsTemplate?: (name: string) => void;
  /** Crée un sous-élément rattaché à cette ligne. */
  onAddSubRow?: () => void;
  /** Rattache cette ligne à une autre (ou la détache avec `undefined`). */
  onSetParent?: (parentId: string | undefined) => void;
}

const EDITABLE_TEXT = new Set(['text', 'url', 'email', 'phone']);

export const RowPanel: React.FC<RowPanelProps> = ({
  data,
  row,
  visiblePropertyIds,
  onChange,
  onClose,
  onStep,
  onSaveAsTemplate,
  onAddSubRow,
  onSetParent,
}) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  /** Nom en cours de saisie pour « enregistrer comme modèle » ; `null` = fermé. */
  const [templateName, setTemplateName] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Échap ferme, et le focus part sur le premier champ : une fiche qui s'ouvre
  // sans focus oblige à attraper la souris pour la moindre correction.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    firstFieldRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const setCell = useCallback(
    (propertyId: string, value: unknown) => {
      onChange({
        ...data,
        rows: data.rows.map((candidate) =>
          candidate.id === row.id
            ? {
                ...candidate,
                cells: { ...candidate.cells, [propertyId]: value },
                updatedAt: new Date().toISOString(),
              }
            : candidate
        ),
      });
    },
    [data, onChange, row.id]
  );

  const titleProp = data.properties.find((prop) => prop.type === 'text') ?? data.properties[0];
  const titleValue = titleProp ? row.cells[titleProp.id] : '';
  const title =
    typeof titleValue === 'string' && titleValue.trim() !== ''
      ? titleValue
      : t('notes.inlineDb.untitled', 'Untitled');

  const renderField = (prop: DbProperty, index: number) => {
    const value = row.cells[prop.id];
    const isHidden = !visiblePropertyIds.has(prop.id);

    const field = (() => {
      if (EDITABLE_TEXT.has(prop.type)) {
        return (
          <input
            ref={index === 0 ? (el) => (firstFieldRef.current = el) : undefined}
            className="inline-db__rp-input"
            type={prop.type === 'email' ? 'email' : prop.type === 'url' ? 'url' : 'text'}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setCell(prop.id, e.target.value || undefined)}
          />
        );
      }

      if (prop.type === 'number' || prop.type === 'rating' || prop.type === 'progress') {
        return (
          <input
            className="inline-db__rp-input"
            type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => {
              const parsed = e.target.value === '' ? undefined : Number(e.target.value);
              setCell(prop.id, Number.isFinite(parsed as number) ? parsed : undefined);
            }}
          />
        );
      }

      if (prop.type === 'checkbox') {
        return (
          <input
            className="inline-db__rp-check"
            type="checkbox"
            checked={value === true}
            onChange={(e) => setCell(prop.id, e.target.checked || undefined)}
          />
        );
      }

      if (prop.type === 'date') {
        return (
          <input
            className="inline-db__rp-input"
            type="date"
            value={typeof value === 'string' ? value.slice(0, 10) : ''}
            onChange={(e) => setCell(prop.id, e.target.value || undefined)}
          />
        );
      }

      if (prop.type === 'person') {
        const names = peopleOf(value);
        // Les noms deja saisis dans la colonne servent de suggestions : c'est
        // le seul « annuaire » honnete hors ligne (cf. people.ts).
        const suggestions = knownPeople(data.rows, prop).filter(
          (candidate) => !names.some((name) => name.toLowerCase() === candidate.toLowerCase())
        );
        return (
          <div className="inline-db__rp-people">
            <span className="inline-db__rp-options">
              {names.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="inline-db__rp-option is-on"
                  title={t('notes.inlineDb.removePerson', 'Remove {{name}}', { name })}
                  onClick={() =>
                    setCell(prop.id, writePeople(names.filter((kept) => kept !== name)))
                  }
                >
                  <span
                    className={`inline-db__person inline-db__person--c${personColorIndex(name, 8)}`}
                    aria-hidden="true"
                  >
                    {initialsOf(name)}
                  </span>
                  {name}
                </button>
              ))}
            </span>
            <input
              className="inline-db__rp-input"
              placeholder={t('notes.inlineDb.addPerson', 'Add a name and press Enter')}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const raw = (e.target as HTMLInputElement).value;
                if (raw.trim() === '') return;
                e.preventDefault();
                setCell(prop.id, writePeople([...names, ...raw.split(',')]));
                (e.target as HTMLInputElement).value = '';
              }}
            />
            {suggestions.length > 0 && (
              <span className="inline-db__rp-options">
                {suggestions.slice(0, 6).map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="inline-db__rp-option"
                    onClick={() => setCell(prop.id, writePeople([...names, name]))}
                  >
                    {name}
                  </button>
                ))}
              </span>
            )}
          </div>
        );
      }

      if (prop.type === 'select' || prop.type === 'multiSelect') {
        const selected = new Set(selectedOptionIds(prop, value));
        return (
          <div className="inline-db__rp-options">
            {(prop.options ?? []).map((option) => {
              const on = selected.has(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`inline-db__rp-option ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    if (prop.type === 'select') {
                      // Re-cliquer l'option choisie la retire : sans ça, une
                      // cellule de choix ne peut plus jamais redevenir vide.
                      setCell(prop.id, on ? undefined : option.id);
                      return;
                    }
                    const next = new Set(selected);
                    if (on) next.delete(option.id);
                    else next.add(option.id);
                    setCell(prop.id, next.size > 0 ? Array.from(next) : undefined);
                  }}
                >
                  {option.label}
                </button>
              );
            })}
            {(prop.options ?? []).length === 0 && (
              <span className="inline-db__rp-readonly">
                {t('notes.inlineDb.rowPanelNoOption', 'No option defined for this column yet.')}
              </span>
            )}
          </div>
        );
      }

      // Agrégats, relations, notes liées : lisibles ici, modifiables dans la
      // table, où vivent leurs sélecteurs.
      return (
        <span className="inline-db__rp-readonly">
          {Array.isArray(value)
            ? t('notes.inlineDb.rowPanelLinked', '{{count}} linked', { count: value.length })
            : value === undefined || value === null || value === ''
              ? t('notes.inlineDb.rowPanelEmptyValue', 'Empty')
              : String(value)}
        </span>
      );
    })();

    return (
      <div className="inline-db__rp-field" key={prop.id}>
        <span className="inline-db__rp-label">
          <span className="inline-db__rp-name">{prop.name}</span>
          <span className="inline-db__rp-type">{propertyTypeLabel(prop.type)}</span>
          {isHidden && (
            <span
              className="inline-db__rp-hidden"
              title={t(
                'notes.inlineDb.rowPanelHiddenHint',
                'Hidden in this view — its data is still here.'
              )}
            >
              {t('notes.inlineDb.rowPanelHidden', 'hidden')}
            </span>
          )}
        </span>
        {field}
      </div>
    );
  };

  return (
    <>
      {/* Le voile ferme au clic : une fiche modale sans issue au clic dehors
          est le premier réflexe qu'on prend en défaut. */}
      <div className="inline-db__rp-veil" onMouseDown={onClose} />
      <div
        className="inline-db__rp"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="inline-db__rp-head">
          <span className="inline-db__rp-title">{title}</span>
          {onStep && (
            <span className="inline-db__rp-steps">
              <button
                type="button"
                className="inline-db__rp-icon"
                aria-label={t('notes.inlineDb.rowPanelPrev', 'Previous row')}
                onClick={() => onStep(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="inline-db__rp-icon"
                aria-label={t('notes.inlineDb.rowPanelNext', 'Next row')}
                onClick={() => onStep(1)}
              >
                ↓
              </button>
            </span>
          )}
          {onSaveAsTemplate && (
            <button
              type="button"
              className="inline-db__rp-tpl"
              title={t('notes.inlineDb.saveAsTemplateHint', 'Reuse these values for new rows')}
              // PAS de `window.prompt` : Electron ne l'implémente pas, le
              // bouton serait mort. Le nom se saisit dans la fiche même.
              onClick={() => setTemplateName((cur) => (cur === null ? title : null))}
            >
              {t('notes.inlineDb.saveAsTemplate', 'Save as template')}
            </button>
          )}
          <button
            type="button"
            className="inline-db__rp-icon"
            aria-label={t('notes.inlineDb.close', 'Close')}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {templateName !== null && onSaveAsTemplate && (
          <div className="inline-db__rp-tplbar">
            <input
              className="inline-db__rp-input"
              autoFocus
              value={templateName}
              placeholder={t('notes.inlineDb.saveAsTemplatePrompt', 'Name for this row template')}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && templateName.trim() !== '') {
                  onSaveAsTemplate(templateName.trim());
                  setTemplateName(null);
                }
                if (e.key === 'Escape') setTemplateName(null);
              }}
            />
            <button
              type="button"
              className="inline-db__rp-tpl"
              disabled={templateName.trim() === ''}
              onClick={() => {
                onSaveAsTemplate(templateName.trim());
                setTemplateName(null);
              }}
            >
              {t('notes.inlineDb.save', 'Save')}
            </button>
          </div>
        )}

        <div className="inline-db__rp-body">
          {data.properties.map((prop, index) => renderField(prop, index))}

          {onSetParent && (
            <div className="inline-db__rp-field">
              <span className="inline-db__rp-label">
                <span className="inline-db__rp-name">
                  {t('notes.inlineDb.subItemOf', 'Sub-item of')}
                </span>
              </span>
              <select
                className="inline-db__rp-input"
                value={parentIdOf(row) ?? ''}
                onChange={(e) => onSetParent(e.target.value === '' ? undefined : e.target.value)}
              >
                <option value="">{t('notes.inlineDb.noParent', '— none —')}</option>
                {/* Ni elle-même, ni sa descendance : un cycle est exclu AVANT
                    d'être écrit, pas rattrapé ensuite. */}
                {eligibleParents(data.rows, row.id).map((candidate) => {
                  const label = titleProp ? candidate.cells[titleProp.id] : '';
                  return (
                    <option key={candidate.id} value={candidate.id}>
                      {typeof label === 'string' && label.trim() !== ''
                        ? label
                        : t('notes.inlineDb.untitled', 'Untitled')}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        {onAddSubRow && (
          <div className="inline-db__rp-foot">
            <button type="button" className="inline-db__rp-tpl" onClick={onAddSubRow}>
              + {t('notes.inlineDb.addSubItem', 'Add a sub-item')}
            </button>
          </div>
        )}
      </div>
    </>
  );
};
