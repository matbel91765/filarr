/**
 * PropertyEditor — Filarr Notes
 *
 * Corps du popover d'édition d'une propriété : renommage, changement de
 * type (conversion douce : les cellules incompatibles restent stockées
 * mais s'affichent vides), options select/multiSelect, suppression.
 * Le positionnement et la fermeture (Escape/clic extérieur) sont gérés
 * par la vue table.
 */

import React, { useEffect, useRef, useState } from 'react';
import { checkFormula } from './formulaEngine';
import { typeIcon } from './typeIcons';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '../../../ui/Checkbox';
import type {
  DbAggregate,
  DbCatalogEntry,
  DbProperty,
  DbRelationDirection,
  DbSelectOption,
  PropertyType,
} from './types';
import {
  aggregateNeedsTarget,
  DB_AGGREGATES,
  DB_OPTION_COLORS,
  newId,
  optionColorValue,
} from './types';
import { backlinkSourcesFor } from './relations';

export interface PropertyEditorProps {
  property: DbProperty;
  /** Propriétés VOISINES : un agrégat y choisit la relation qu'il suit */
  properties: DbProperty[];
  /** Bases visables par une relation (index du coffre + la base courante) */
  catalog: DbCatalogEntry[];
  /** Identité de CETTE base — les rétroliens n'existent que par rapport à elle */
  selfDbId?: string;
  /** Lignes portant plus d'un lien sur cette relation (bouton « garder le premier ») */
  multiLinkRowCount?: number;
  /**
   * État de la colonne miroir dans la base visée : peut-on la poser d'ici ?
   * Calculé par la vue, qui seule connaît les notes (cf. `backlinkColumnState`).
   */
  backlinkColumn?: 'none' | 'exists' | 'blocked' | 'available';
  onChange: (next: DbProperty) => void;
  /** Réduction EXPLICITE à un seul lien par ligne (jamais automatique) */
  onKeepFirstLinkOnly?: () => void;
  /** Pose la colonne de rétroliens dans la base visée (écriture chez le voisin) */
  onCreateBacklinkColumn?: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const TYPES: PropertyType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'checkbox',
  'date',
  'url',
  'email',
  'phone',
  'rating',
  'progress',
  'note',
  'relation',
  'rollup',
  'createdTime',
  'updatedTime',
  'formula',
  'person',
];

interface OptionRowProps {
  option: DbSelectOption;
  paletteOpen: boolean;
  isDefault: boolean;
  onTogglePalette: () => void;
  onRename: (label: string) => void;
  onRecolor: (color: string) => void;
  onToggleDefault: () => void;
  onDelete: () => void;
}

const OptionRow: React.FC<OptionRowProps> = ({
  option,
  paletteOpen,
  isDefault,
  onTogglePalette,
  onRename,
  onRecolor,
  onToggleDefault,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(option.label);
  const cancelRef = useRef(false);
  useEffect(() => {
    setDraft(option.label);
  }, [option.label]);

  return (
    <li className="inline-db__pe-option-wrap">
      <div className="inline-db__pe-option">
        <button
          type="button"
          className="inline-db__pe-color-dot"
          style={{ background: optionColorValue(option.color) }}
          aria-label={t('notes.inlineDb.pickColor', 'Choose a color')}
          aria-expanded={paletteOpen}
          onClick={onTogglePalette}
        />
        <input
          className="inline-db__pe-input"
          value={draft}
          placeholder={t('notes.inlineDb.optionPlaceholder', 'Option name')}
          aria-label={t('notes.inlineDb.optionPlaceholder', 'Option name')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (cancelRef.current) {
              cancelRef.current = false;
              setDraft(option.label);
              return;
            }
            const v = draft.trim();
            if (v !== option.label) onRename(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              cancelRef.current = true;
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {/* Nom stable + aria-pressed : l'état passe par l'attribut, pas par un
            libellé qui décrirait l'action inverse (APG) */}
        <button
          type="button"
          className={`inline-db__pe-icon-btn inline-db__pe-default-btn ${
            isDefault ? 'inline-db__pe-default-btn--active' : ''
          }`}
          aria-pressed={isDefault}
          aria-label={t('notes.inlineDb.defaultOption', 'Default value')}
          title={t('notes.inlineDb.defaultOption', 'Default value')}
          onClick={onToggleDefault}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill={isDefault ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="12 2 15.1 8.6 22 9.6 17 14.6 18.2 21.5 12 18.2 5.8 21.5 7 14.6 2 9.6 8.9 8.6 12 2" />
          </svg>
        </button>
        <button
          type="button"
          className="inline-db__pe-icon-btn"
          aria-label={t('notes.inlineDb.deleteOption', 'Delete option')}
          onClick={onDelete}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
      {paletteOpen && (
        <div className="inline-db__pe-palette">
          {DB_OPTION_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`inline-db__pe-swatch ${
                c.id === option.color ? 'inline-db__pe-swatch--active' : ''
              }`}
              style={{ background: c.value }}
              aria-label={t('notes.inlineDb.colorNamed', 'Color {{color}}', { color: c.id })}
              aria-pressed={c.id === option.color}
              onClick={() => onRecolor(c.id)}
            />
          ))}
        </div>
      )}
    </li>
  );
};

export const PropertyEditor: React.FC<PropertyEditorProps> = ({
  property,
  properties,
  catalog,
  selfDbId = '',
  multiLinkRowCount = 0,
  backlinkColumn = 'none',
  onChange,
  onKeepFirstLinkOnly,
  onCreateBacklinkColumn,
  onDelete,
  onClose,
}) => {
  const { t } = useTranslation();
  const nameRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  /** Recherche de la grille de types — la meme que dans le menu de colonne. */
  const [typeQuery, setTypeQuery] = useState('');

  const [nameDraft, setNameDraft] = useState(property.name);
  const [paletteFor, setPaletteFor] = useState<string | null>(null);

  useEffect(() => {
    setNameDraft(property.name);
  }, [property.name]);

  // À l'ouverture (ou au passage à une autre propriété) : focus du nom
  useEffect(() => {
    setPaletteFor(null);
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [property.id]);

  const isSelectType = property.type === 'select' || property.type === 'multiSelect';
  const options = property.options ?? [];
  const defaultOption = options.find((o) => o.id === property.defaultOptionId);

  /* ---- Relation : sens, base visée, cardinalité ---- */
  const direction: DbRelationDirection = property.direction === 'in' ? 'in' : 'out';
  const targetDbId = property.targetDbId ?? '';
  // Cible absente du catalogue (note fermée, base supprimée) : on l'ajoute à la
  // liste telle quelle. Sans cela, le sélecteur afficherait la première base du
  // coffre et le premier geste de l'utilisateur redirigerait la relation.
  const targetKnown = catalog.some((c) => c.dbId === targetDbId);
  const targetEntry = catalog.find((c) => c.dbId === targetDbId);
  const catalogLabel = (entry: DbCatalogEntry): string => {
    const label = entry.label || t('notes.inlineDb.untitled', 'Untitled');
    if (entry.self) return `${label} — ${t('notes.inlineDb.thisDatabase', 'This database')}`;
    const note = (entry.noteTitle ?? '').trim();
    // Le nom de la note départage deux bases de même titre
    return note !== '' && note !== label ? `${label} — ${note}` : label;
  };

  /* ---- Rétroliens : les relations du coffre qui pointent ICI ---- */
  const backSources = backlinkSourcesFor(catalog, selfDbId);
  const backIndex = backSources.findIndex(
    (s) => s.dbId === targetDbId && s.propertyId === (property.sourcePropertyId ?? '')
  );
  const backSourceLabel = (dbId: string, propertyId: string): string => {
    const entry = catalog.find((c) => c.dbId === dbId);
    const prop = entry?.properties.find((p) => p.id === propertyId);
    const dbLabel = entry
      ? catalogLabel(entry)
      : t('notes.inlineDb.relationUnavailable', 'Database unavailable');
    const propName = prop?.name || t('notes.inlineDb.untitled', 'Untitled');
    return `${dbLabel} · ${propName}`;
  };

  /* ---- Agrégat : relation suivie, propriété agrégée ---- */
  const relationProps = properties.filter((p) => p.type === 'relation' && p.id !== property.id);
  const via = relationProps.find((p) => p.id === property.viaPropertyId);
  const viaTarget = via?.targetDbId ? catalog.find((c) => c.dbId === via.targetDbId) : undefined;
  const aggregate: DbAggregate = property.aggregate ?? 'count';
  // Un agrégat d'agrégat n'aurait pas de valeur à lire (rien n'est stocké)
  const aggregatableProps = (viaTarget?.properties ?? []).filter((p) => p.type !== 'rollup');

  const aggregateLabels: Record<DbAggregate, string> = {
    count: t('notes.inlineDb.aggCount', 'Count'),
    sum: t('notes.inlineDb.aggSum', 'Sum'),
    avg: t('notes.inlineDb.aggAvg', 'Average'),
    min: t('notes.inlineDb.aggMin', 'Minimum'),
    max: t('notes.inlineDb.aggMax', 'Maximum'),
    checked: t('notes.inlineDb.aggChecked', 'Checked'),
    percentChecked: t('notes.inlineDb.aggPercentChecked', 'Percent checked'),
    notEmpty: t('notes.inlineDb.aggNotEmpty', 'Not empty'),
    list: t('notes.inlineDb.aggList', 'List of values'),
  };

  const typeLabels: Record<PropertyType, string> = {
    text: t('notes.inlineDb.typeText', 'Text'),
    number: t('notes.inlineDb.typeNumber', 'Number'),
    select: t('notes.inlineDb.typeSelect', 'Select'),
    multiSelect: t('notes.inlineDb.typeMultiSelect', 'Multi-select'),
    checkbox: t('notes.inlineDb.typeCheckbox', 'Checkbox'),
    date: t('notes.inlineDb.typeDate', 'Date'),
    url: t('notes.inlineDb.typeUrl', 'URL'),
    email: t('notes.inlineDb.typeEmail', 'Email'),
    phone: t('notes.inlineDb.typePhone', 'Phone'),
    rating: t('notes.inlineDb.typeRating', 'Rating'),
    progress: t('notes.inlineDb.typeProgress', 'Progress'),
    note: t('notes.inlineDb.typeNote', 'Note'),
    relation: t('notes.inlineDb.typeRelation', 'Relation'),
    rollup: t('notes.inlineDb.typeRollup', 'Rollup'),
    createdTime: t('notes.inlineDb.typeCreatedTime', 'Created time'),
    updatedTime: t('notes.inlineDb.typeUpdatedTime', 'Last edited time'),
    formula: t('notes.inlineDb.typeFormula', 'Formula'),
    person: t('notes.inlineDb.typePerson', 'Person'),
  };

  return (
    <div className="inline-db__pe">
      <div className="inline-db__pe-head">
        {/* Icone du type ET nom de la colonne : ce panneau s'ouvre depuis le
            menu d'UNE colonne, il doit dire laquelle sans faire relire. */}
        <span className="inline-db__pe-headicon" aria-hidden="true">
          {typeIcon(property.type)}
        </span>
        <span className="inline-db__pe-title">
          {property.name || t('notes.inlineDb.propertyTitle', 'Property')}
        </span>
        <button
          type="button"
          className="inline-db__pe-icon-btn"
          aria-label={t('notes.inlineDb.close', 'Close')}
          onClick={onClose}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>

      <div className="inline-db__pe-field">
        <label className="inline-db__pe-label" htmlFor={`db-pe-name-${property.id}`}>
          {t('notes.inlineDb.propertyName', 'Name')}
        </label>
        <input
          id={`db-pe-name-${property.id}`}
          ref={nameRef}
          className="inline-db__pe-input"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (cancelRef.current) {
              cancelRef.current = false;
              setNameDraft(property.name);
              return;
            }
            const v = nameDraft.trim();
            if (v && v !== property.name) onChange({ ...property, name: v });
            else setNameDraft(property.name);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              cancelRef.current = true;
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>

      <div className="inline-db__pe-field">
        <span className="inline-db__pe-label">{t('notes.inlineDb.propertyType', 'Type')}</span>
        <input
          type="search"
          className="inline-db__colmenu-search"
          value={typeQuery}
          placeholder={t('notes.inlineDb.searchType', 'Search a type…')}
          aria-label={t('notes.inlineDb.searchType', 'Search a type…')}
          onChange={(e) => setTypeQuery(e.target.value)}
        />
        {/* La MEME grille que le menu de colonne : un select natif ne montre ni
            icone ni recherche, et ne ressemble a rien d'autre dans l'app. */}
        <div className="inline-db__typegrid">
          {TYPES.filter(
            (tp) =>
              typeQuery.trim() === '' ||
              typeLabels[tp].toLowerCase().includes(typeQuery.trim().toLowerCase())
          ).map((tp) => (
            <button
              key={tp}
              type="button"
              className={`inline-db__typeitem ${tp === property.type ? 'is-on' : ''}`}
              aria-pressed={tp === property.type}
              onClick={() => {
                if (tp === property.type) return;
                const next: DbProperty = { ...property, type: tp };
                // conversion douce : cellules et options conservees telles quelles
                if (tp === 'select' || tp === 'multiSelect') {
                  if (!next.options) next.options = [];
                } else {
                  // un type sans options ne peut plus porter de valeur d'office
                  next.defaultOptionId = undefined;
                }
                // Reglages propres a une relation : laches ICI, au seul endroit
                // ou un type change — sinon une colonne redevenue relation
                // ressortirait avec la configuration d'avant.
                if (tp !== 'relation') {
                  next.direction = undefined;
                  next.sourcePropertyId = undefined;
                  next.single = undefined;
                }
                onChange(next);
              }}
            >
              <span className="inline-db__typeitem-icon" aria-hidden="true">
                {typeIcon(tp)}
              </span>
              <span className="inline-db__typeitem-label">{typeLabels[tp]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* FORMULE : l'expression est saisie ici, sa valeur n'est jamais stockee
          dans les cellules — elle se recalcule a l'affichage. */}
      {property.type === 'formula' && (
        <div className="inline-db__pe-field">
          <span className="inline-db__pe-label">{t('notes.inlineDb.formulaLabel', 'Formula')}</span>
          <textarea
            className="inline-db__pe-formula"
            rows={3}
            spellCheck={false}
            value={property.formula ?? ''}
            placeholder={'prop("Quantite") * prop("Prix")'}
            onChange={(e) => onChange({ ...property, formula: e.target.value })}
          />
          {(() => {
            // Le motif s'affiche PENDANT la saisie : une faute de frappe dans
            // un nom de colonne se voit ici, et pas ligne par ligne ensuite.
            const problem = checkFormula(property.formula ?? '', properties);
            return problem ? (
              <span className="inline-db__pe-formula-error">{problem.message}</span>
            ) : (
              <span className="inline-db__pe-formula-hint">
                {t(
                  'notes.inlineDb.formulaHint',
                  'prop("Column"), + - * /, if(test, a, b), round(), concat(), today(), dateDiff()'
                )}
              </span>
            );
          })()}
        </div>
      )}

      {property.type === 'relation' && (
        <div className="inline-db__pe-field">
          <label className="inline-db__pe-label" htmlFor={`db-pe-dir-${property.id}`}>
            {t('notes.inlineDb.relationDirection', 'Direction')}
          </label>
          <select
            id={`db-pe-dir-${property.id}`}
            className="inline-db__pe-select"
            value={direction}
            onChange={(e) => {
              const next: DbRelationDirection = e.target.value === 'in' ? 'in' : 'out';
              if (next === direction) return;
              // Changer de sens change la NATURE de la cible (base visée ↔ base
              // qui pointe ici) : la configuration repart de zéro. Les liens
              // stockés, eux, ne sont jamais touchés — revenir en arrière les
              // retrouve tous.
              onChange({
                ...property,
                direction: next === 'in' ? 'in' : undefined,
                targetDbId: undefined,
                sourcePropertyId: undefined,
                single: next === 'in' ? undefined : property.single,
              });
            }}
          >
            <option value="out">{t('notes.inlineDb.relationDirectionOut', 'Links to…')}</option>
            <option value="in">
              {t('notes.inlineDb.relationDirectionIn', 'Backlinks (computed)')}
            </option>
          </select>

          {direction === 'out' ? (
            <>
              <label className="inline-db__pe-label" htmlFor={`db-pe-target-${property.id}`}>
                {t('notes.inlineDb.relationTarget', 'Related database')}
              </label>
              {catalog.length === 0 ? (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.relationNoDatabase',
                    'No other database in this vault yet — create one in a note, then come back.'
                  )}
                </p>
              ) : (
                <select
                  id={`db-pe-target-${property.id}`}
                  className="inline-db__pe-select"
                  value={targetDbId}
                  onChange={(e) =>
                    onChange({ ...property, targetDbId: e.target.value || undefined })
                  }
                >
                  <option value="">{t('notes.inlineDb.relationPickTarget', 'Choose…')}</option>
                  {catalog.map((c) => (
                    <option key={c.dbId} value={c.dbId}>
                      {catalogLabel(c)}
                    </option>
                  ))}
                  {targetDbId !== '' && !targetKnown && (
                    <option value={targetDbId}>
                      {t('notes.inlineDb.relationUnavailable', 'Database unavailable')}
                    </option>
                  )}
                </select>
              )}
              {targetDbId !== '' && !targetKnown && (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.relationUnavailableHint',
                    'This database is not readable right now — the existing links are kept untouched.'
                  )}
                </p>
              )}
              {targetEntry && (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.relationTitleHint',
                    'Rows show up with their first text column.'
                  )}
                </p>
              )}
              <Checkbox
                size="sm"
                containerClassName="inline-db__pe-check"
                checked={property.single === true}
                label={t('notes.inlineDb.relationSingle', 'One link at a time')}
                onChange={(e) =>
                  onChange({ ...property, single: e.target.checked ? true : undefined })
                }
              />
              {/* Expliqué quand c'est actif : sinon le popover s'allonge d'une
                  ligne pour une option décochée */}
              {property.single === true && (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.relationSingleHint',
                    'The next row you pick replaces the current one instead of being added.'
                  )}
                </p>
              )}
              {/* Réduction proposée, jamais imposée : cocher « un seul lien »
                  ne doit pas effacer en silence des liens déjà posés */}
              {property.single === true && multiLinkRowCount > 0 && onKeepFirstLinkOnly && (
                <button
                  type="button"
                  className="inline-db__pe-inline-action"
                  onClick={onKeepFirstLinkOnly}
                >
                  {t(
                    'notes.inlineDb.relationKeepFirst',
                    'Keep only the first link ({{count}} rows)',
                    { count: multiLinkRowCount }
                  )}
                </button>
              )}
              {/* L'AUTRE CÔTÉ DU LIEN, en un clic. La colonne posée là-bas ne
                  stocke rien : elle se recalcule depuis cette relation-ci, donc
                  les deux côtés ne peuvent pas diverger. */}
              {backlinkColumn === 'available' && onCreateBacklinkColumn && (
                <button
                  type="button"
                  className="inline-db__pe-inline-action"
                  onClick={onCreateBacklinkColumn}
                >
                  {t(
                    'notes.inlineDb.relationAddReverse',
                    'Add the backlinks column in « {{db}} »',
                    {
                      db: targetEntry
                        ? targetEntry.label || t('notes.inlineDb.untitled', 'Untitled')
                        : t('notes.inlineDb.relationUnavailable', 'Database unavailable'),
                    }
                  )}
                </button>
              )}
              {backlinkColumn === 'exists' && (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.relationReverseExists',
                    'The target database already shows the other side of this link.'
                  )}
                </p>
              )}
              {backlinkColumn === 'blocked' && (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.relationReverseBlocked',
                    'The target database is in the note you have open — add the Backlinks column from its own block.'
                  )}
                </p>
              )}
              {targetEntry && backlinkColumn !== 'exists' && (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.relationReverseHint',
                    'The other side is computed: nothing is stored twice, and removing that column loses nothing.'
                  )}
                </p>
              )}
            </>
          ) : (
            <>
              <label className="inline-db__pe-label" htmlFor={`db-pe-source-${property.id}`}>
                {t('notes.inlineDb.relationBacklinkSource', 'Backlinks from')}
              </label>
              {backSources.length === 0 ? (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.relationNoBacklinkSource',
                    'No column points to this database yet — add a Relation column somewhere else and aim it here.'
                  )}
                </p>
              ) : (
                <select
                  id={`db-pe-source-${property.id}`}
                  className="inline-db__pe-select"
                  value={backIndex >= 0 ? String(backIndex) : ''}
                  onChange={(e) => {
                    const picked = backSources[Number(e.target.value)];
                    onChange({
                      ...property,
                      targetDbId: picked ? picked.dbId : undefined,
                      sourcePropertyId: picked ? picked.propertyId : undefined,
                    });
                  }}
                >
                  <option value="">{t('notes.inlineDb.relationPickTarget', 'Choose…')}</option>
                  {backSources.map((s, i) => (
                    <option key={`${s.dbId}-${s.propertyId}`} value={String(i)}>
                      {backSourceLabel(s.dbId, s.propertyId)}
                    </option>
                  ))}
                </select>
              )}
              {/* Source choisie mais absente de la liste : la relation d'en face
                  a été supprimée, re-dirigée, ou sa note n'est pas lisible */}
              {backIndex < 0 && (property.sourcePropertyId ?? '') !== '' && (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.relationBacklinkLost',
                    'The column this one mirrors no longer points here — pick another one.'
                  )}
                </p>
              )}
              <p className="inline-db__pe-hint">
                {t(
                  'notes.inlineDb.relationBacklinkHint',
                  'Computed on the fly from the other database — nothing is written on this side, and this column cannot be edited.'
                )}
              </p>
            </>
          )}
        </div>
      )}

      {property.type === 'rollup' && (
        <div className="inline-db__pe-field">
          <label className="inline-db__pe-label" htmlFor={`db-pe-via-${property.id}`}>
            {t('notes.inlineDb.rollupVia', 'Through relation')}
          </label>
          {relationProps.length === 0 ? (
            <p className="inline-db__pe-hint">
              {t(
                'notes.inlineDb.rollupNoRelation',
                'Add a Relation column first — a rollup follows one.'
              )}
            </p>
          ) : (
            <select
              id={`db-pe-via-${property.id}`}
              className="inline-db__pe-select"
              value={property.viaPropertyId ?? ''}
              onChange={(e) =>
                // Changer de relation change de base visée : la propriété
                // agrégée d'avant ne veut plus rien dire
                onChange({
                  ...property,
                  viaPropertyId: e.target.value || undefined,
                  targetPropertyId: undefined,
                })
              }
            >
              <option value="">{t('notes.inlineDb.relationPickTarget', 'Choose…')}</option>
              {relationProps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || t('notes.inlineDb.untitled', 'Untitled')}
                </option>
              ))}
            </select>
          )}

          <label className="inline-db__pe-label" htmlFor={`db-pe-agg-${property.id}`}>
            {t('notes.inlineDb.rollupAggregate', 'Calculate')}
          </label>
          <select
            id={`db-pe-agg-${property.id}`}
            className="inline-db__pe-select"
            value={aggregate}
            onChange={(e) => onChange({ ...property, aggregate: e.target.value as DbAggregate })}
          >
            {DB_AGGREGATES.map((a) => (
              <option key={a} value={a}>
                {aggregateLabels[a]}
              </option>
            ))}
          </select>

          {aggregateNeedsTarget(aggregate) && (
            <>
              <label className="inline-db__pe-label" htmlFor={`db-pe-tprop-${property.id}`}>
                {t('notes.inlineDb.rollupTargetProperty', 'Property')}
              </label>
              {via && !viaTarget ? (
                <p className="inline-db__pe-hint">
                  {t(
                    'notes.inlineDb.rollupTargetUnavailable',
                    'The related database is not readable right now.'
                  )}
                </p>
              ) : (
                <select
                  id={`db-pe-tprop-${property.id}`}
                  className="inline-db__pe-select"
                  value={property.targetPropertyId ?? ''}
                  disabled={!via}
                  onChange={(e) =>
                    onChange({ ...property, targetPropertyId: e.target.value || undefined })
                  }
                >
                  <option value="">{t('notes.inlineDb.relationPickTarget', 'Choose…')}</option>
                  {aggregatableProps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || t('notes.inlineDb.untitled', 'Untitled')}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <p className="inline-db__pe-hint">
            {t(
              'notes.inlineDb.rollupComputedHint',
              'Computed on the fly — this column is never stored and cannot be edited.'
            )}
          </p>
        </div>
      )}

      {isSelectType && (
        <div className="inline-db__pe-field">
          <span className="inline-db__pe-label">{t('notes.inlineDb.options', 'Options')}</span>
          <ul className="inline-db__pe-options">
            {options.map((opt) => (
              <OptionRow
                key={opt.id}
                option={opt}
                paletteOpen={paletteFor === opt.id}
                isDefault={property.defaultOptionId === opt.id}
                onTogglePalette={() => setPaletteFor((cur) => (cur === opt.id ? null : opt.id))}
                onToggleDefault={() =>
                  onChange({
                    ...property,
                    defaultOptionId: property.defaultOptionId === opt.id ? undefined : opt.id,
                  })
                }
                onRename={(label) =>
                  onChange({
                    ...property,
                    options: options.map((o) => (o.id === opt.id ? { ...o, label } : o)),
                  })
                }
                onRecolor={(color) => {
                  onChange({
                    ...property,
                    options: options.map((o) => (o.id === opt.id ? { ...o, color } : o)),
                  });
                  setPaletteFor(null);
                }}
                onDelete={() =>
                  onChange({ ...property, options: options.filter((o) => o.id !== opt.id) })
                }
              />
            ))}
          </ul>
          <button
            type="button"
            className="inline-db__pe-add-option"
            onClick={() =>
              onChange({
                ...property,
                options: [
                  ...options,
                  {
                    id: newId(),
                    label: '',
                    color: DB_OPTION_COLORS[options.length % DB_OPTION_COLORS.length].id,
                  },
                ],
              })
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('notes.inlineDb.addOption', 'Add an option')}
          </button>
          {defaultOption && (
            <p className="inline-db__pe-hint">
              {t('notes.inlineDb.defaultOptionHint', 'New rows default to "{{option}}".', {
                option: defaultOption.label || t('notes.inlineDb.untitled', 'Untitled'),
              })}
            </p>
          )}
        </div>
      )}

      <div className="inline-db__pe-divider" role="presentation" />
      <button type="button" className="inline-db__pe-delete" onClick={onDelete}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
        {t('notes.inlineDb.deleteProperty', 'Delete property')}
      </button>
    </div>
  );
};
