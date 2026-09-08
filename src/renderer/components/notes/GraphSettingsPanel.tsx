/**
 * GraphSettingsPanel — Filarr Notes
 *
 * Panneau flottant de réglages de la vue graphe, parité Obsidian :
 * Filtres / Groupes / Affichage / Forces + section « Filarr » pour les
 * fonctions maison (clusters, heat map, time travel, carnets).
 *
 * Le panneau ne possède AUCUN état de réglage : il reçoit `settings` et
 * remonte des patches via `onChange`, pour que GraphView reste la seule
 * source de vérité (persistance + mise à jour en direct de la simulation).
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from '../ui';
import type { GraphSettings } from '../../../services/notes/graphSettings';
import './GraphSettingsPanel.css';

// Palette cyclée pour les nouveaux groupes — reprend les couleurs de types
// existantes pour rester cohérent avec la légende.
const GROUP_COLOR_CYCLE = ['#4a9eed', '#34d399', '#fbbf24', '#a855f7', '#ec4899', '#2dd4bf'];

interface GraphSettingsPanelProps {
  settings: GraphSettings;
  onChange: (patch: Partial<GraphSettings>) => void;
  showTimeTravel: boolean;
  onToggleTimeTravel: () => void;
  /** Le graphe local n'a de sens que si une note est ouverte. */
  hasSelectedNote: boolean;
  onClose: () => void;
}

// ---- Section repliable (locale : pas de composant partagé dans ui/) ----

const Section: React.FC<{
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, collapsed, onToggle, children }) => (
  <div className="graph-settings__section">
    <button type="button" className="graph-settings__section-header" onClick={onToggle}>
      <span className="graph-settings__section-title">{title}</span>
      <span
        className={`graph-settings__chevron ${collapsed ? 'graph-settings__chevron--collapsed' : ''}`}
      >
        &#9662;
      </span>
    </button>
    {!collapsed && <div className="graph-settings__section-body">{children}</div>}
  </div>
);

// ---- Ligne toggle (libellé à gauche, switch du design system à droite) ----

const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  title?: string;
}> = ({ label, checked, onChange, title }) => (
  <div className="graph-settings__row" title={title}>
    <span className="graph-settings__row-label">{label}</span>
    <Toggle
      size="sm"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
    />
  </div>
);

// ---- Ligne slider (valeur courante affichée, mise à jour en direct) ----

const SliderRow: React.FC<{
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display?: string;
  onChange: (value: number) => void;
}> = ({ label, min, max, step, value, display, onChange }) => (
  <div className="graph-settings__field">
    <label className="graph-settings__label">
      {label}
      <span className="graph-settings__value">{display ?? String(value)}</span>
    </label>
    <input
      type="range"
      className="graph-settings__slider"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
    />
  </div>
);

// ==================== Composant ====================

export const GraphSettingsPanel: React.FC<GraphSettingsPanelProps> = ({
  settings,
  onChange,
  showTimeTravel,
  onToggleTimeTravel,
  hasSelectedNote,
  onClose,
}) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ---- Groupes : ajout / édition / réordonnancement / suppression ----

  const addGroup = useCallback(() => {
    const color = GROUP_COLOR_CYCLE[settings.colorGroups.length % GROUP_COLOR_CYCLE.length];
    onChange({ colorGroups: [...settings.colorGroups, { query: '', color }] });
  }, [settings.colorGroups, onChange]);

  const updateGroup = useCallback(
    (index: number, patch: Partial<{ query: string; color: string }>) => {
      onChange({
        colorGroups: settings.colorGroups.map((g, i) => (i === index ? { ...g, ...patch } : g)),
      });
    },
    [settings.colorGroups, onChange]
  );

  const removeGroup = useCallback(
    (index: number) => {
      onChange({ colorGroups: settings.colorGroups.filter((_, i) => i !== index) });
    },
    [settings.colorGroups, onChange]
  );

  const moveGroup = useCallback(
    (index: number, delta: -1 | 1) => {
      const next = [...settings.colorGroups];
      const target = index + delta;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target], next[index]];
      onChange({ colorGroups: next });
    },
    [settings.colorGroups, onChange]
  );

  return (
    <div
      className="graph-settings"
      role="dialog"
      aria-label={t('notes.graphSettings', 'Graph settings')}
    >
      <header className="graph-settings__header">
        <h3 className="graph-settings__title">{t('notes.graphSettings', 'Graph settings')}</h3>
        <button
          type="button"
          className="graph-settings__close"
          onClick={onClose}
          aria-label={t('common.close', 'Close')}
        >
          ×
        </button>
      </header>

      <div className="graph-settings__body">
        {/* ==================== Filtres ==================== */}
        <Section
          title={t('notes.graphSettingsSectionFilters', 'Filters')}
          collapsed={!!collapsed.filters}
          onToggle={() => toggleSection('filters')}
        >
          <input
            type="text"
            className="graph-settings__search"
            value={settings.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder={t('notes.graphFilterPlaceholder', 'Filter nodes...')}
            aria-label={t('notes.graphFilterPlaceholder', 'Filter nodes...')}
          />
          <ToggleRow
            label={t('notes.graphShowTags', 'Tags')}
            checked={settings.showTags}
            onChange={(v) => onChange({ showTags: v })}
          />
          <ToggleRow
            label={t('notes.graphShowAttachments', 'Attachments')}
            checked={settings.showAttachments}
            onChange={(v) => onChange({ showAttachments: v })}
          />
          <ToggleRow
            label={t('notes.graphExistingOnly', 'Existing files only')}
            checked={settings.hideUnresolved}
            onChange={(v) => onChange({ hideUnresolved: v })}
          />
          <ToggleRow
            label={t('notes.graphShowOrphans', 'Orphans')}
            checked={settings.showOrphans}
            onChange={(v) => onChange({ showOrphans: v })}
          />
          <ToggleRow
            label={t('notes.graphLocal', 'Local graph')}
            checked={settings.localMode}
            onChange={(v) => onChange({ localMode: v })}
            title={
              hasSelectedNote
                ? undefined
                : t('notes.graphLocalHint', 'Open a note to display its local graph')
            }
          />
          {settings.localMode && (
            <SliderRow
              label={t('notes.graphLocalJumps', 'Jumps')}
              min={1}
              max={5}
              step={1}
              value={settings.localJumps}
              onChange={(v) => onChange({ localJumps: v })}
            />
          )}
        </Section>

        {/* ==================== Groupes ==================== */}
        <Section
          title={t('notes.graphSettingsSectionGroups', 'Groups')}
          collapsed={!!collapsed.groups}
          onToggle={() => toggleSection('groups')}
        >
          {settings.colorGroups.map((group, i) => (
            <div key={i} className="graph-settings__group-row">
              <input
                type="color"
                className="graph-settings__group-color"
                value={group.color}
                onChange={(e) => updateGroup(i, { color: e.target.value })}
                aria-label={t('notes.graphSettingsSectionGroups', 'Groups')}
              />
              <input
                type="text"
                className="graph-settings__group-query"
                value={group.query}
                onChange={(e) => updateGroup(i, { query: e.target.value })}
                placeholder={t('notes.graphGroupQueryPlaceholder', 'Title, tag:#x, notebook:name')}
              />
              <button
                type="button"
                className="graph-settings__group-btn"
                onClick={() => moveGroup(i, -1)}
                disabled={i === 0}
                aria-label={t('notes.graphGroupMoveUp', 'Move up')}
                title={t('notes.graphGroupMoveUp', 'Move up')}
              >
                ↑
              </button>
              <button
                type="button"
                className="graph-settings__group-btn"
                onClick={() => moveGroup(i, 1)}
                disabled={i === settings.colorGroups.length - 1}
                aria-label={t('notes.graphGroupMoveDown', 'Move down')}
                title={t('notes.graphGroupMoveDown', 'Move down')}
              >
                ↓
              </button>
              <button
                type="button"
                className="graph-settings__group-btn graph-settings__group-btn--danger"
                onClick={() => removeGroup(i)}
                aria-label={t('notes.graphGroupRemove', 'Remove group')}
                title={t('notes.graphGroupRemove', 'Remove group')}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="graph-settings__add-group" onClick={addGroup}>
            + {t('notes.graphGroupAdd', 'New group')}
          </button>
          {(settings.showClusters || settings.showHeatMap) && settings.colorGroups.length > 0 && (
            // Priorité de coloration : groupes > heatmap > clusters > type.
            // Les groupes gagnent toujours ; on explique ce que deviennent
            // les autres nœuds pour que le mélange ne surprenne pas.
            <p className="graph-settings__hint">
              {t(
                'notes.graphGroupsHint',
                'Nodes without a group follow the clusters / heat map coloring'
              )}
            </p>
          )}
        </Section>

        {/* ==================== Affichage ==================== */}
        <Section
          title={t('notes.graphSettingsSectionDisplay', 'Display')}
          collapsed={!!collapsed.display}
          onToggle={() => toggleSection('display')}
        >
          <ToggleRow
            label={t('notes.graphShowArrows', 'Arrows')}
            checked={settings.showArrow}
            onChange={(v) => onChange({ showArrow: v })}
          />
          <SliderRow
            label={t('notes.graphTextFade', 'Text fade threshold')}
            min={-3}
            max={3}
            step={0.1}
            value={settings.textFadeMultiplier}
            display={settings.textFadeMultiplier.toFixed(1)}
            onChange={(v) => onChange({ textFadeMultiplier: v })}
          />
          <SliderRow
            label={t('notes.graphNodeSize', 'Node size')}
            min={0.1}
            max={5}
            step={0.1}
            value={settings.nodeSizeMultiplier}
            display={settings.nodeSizeMultiplier.toFixed(1)}
            onChange={(v) => onChange({ nodeSizeMultiplier: v })}
          />
          <SliderRow
            label={t('notes.graphLineSize', 'Link thickness')}
            min={0.1}
            max={5}
            step={0.1}
            value={settings.lineSizeMultiplier}
            display={settings.lineSizeMultiplier.toFixed(1)}
            onChange={(v) => onChange({ lineSizeMultiplier: v })}
          />
        </Section>

        {/* ==================== Forces ==================== */}
        <Section
          title={t('notes.graphSettingsSectionForces', 'Forces')}
          collapsed={!!collapsed.forces}
          onToggle={() => toggleSection('forces')}
        >
          <SliderRow
            label={t('notes.graphCenterForce', 'Center force')}
            min={0}
            max={1}
            step={0.01}
            value={settings.centerStrength}
            display={settings.centerStrength.toFixed(2)}
            onChange={(v) => onChange({ centerStrength: v })}
          />
          <SliderRow
            label={t('notes.graphRepelForce', 'Repel force')}
            min={0}
            max={20}
            step={0.1}
            value={settings.repelStrength}
            display={settings.repelStrength.toFixed(1)}
            onChange={(v) => onChange({ repelStrength: v })}
          />
          <SliderRow
            label={t('notes.graphLinkForce', 'Link force')}
            min={0}
            max={1}
            step={0.01}
            value={settings.linkStrength}
            display={settings.linkStrength.toFixed(2)}
            onChange={(v) => onChange({ linkStrength: v })}
          />
          <SliderRow
            label={t('notes.graphLinkDistance', 'Link distance')}
            min={30}
            max={500}
            step={1}
            value={settings.linkDistance}
            display={String(Math.round(settings.linkDistance))}
            onChange={(v) => onChange({ linkDistance: v })}
          />
        </Section>

        {/* ==================== Filarr ==================== */}
        <Section
          title={t('notes.graphSettingsSectionFilarr', 'Filarr')}
          collapsed={!!collapsed.filarr}
          onToggle={() => toggleSection('filarr')}
        >
          <ToggleRow
            label={t('notes.graphClusters', 'Show Clusters')}
            checked={settings.showClusters}
            // Clusters et heat map sont mutuellement exclusifs (comportement
            // historique de la barre de toggles) — activer l'un coupe l'autre.
            onChange={(v) =>
              onChange(v ? { showClusters: true, showHeatMap: false } : { showClusters: false })
            }
          />
          <ToggleRow
            label={t('notes.graphHeatMap', 'Heat Map')}
            checked={settings.showHeatMap}
            onChange={(v) =>
              onChange(v ? { showHeatMap: true, showClusters: false } : { showHeatMap: false })
            }
          />
          <ToggleRow
            label={t('notes.graphTimeTravel', 'Time Travel')}
            checked={showTimeTravel}
            onChange={onToggleTimeTravel}
          />
          <ToggleRow
            label={t('notes.graphShowNotebooks', 'Show notebooks')}
            checked={settings.showNotebooks}
            onChange={(v) => onChange({ showNotebooks: v })}
          />
        </Section>
      </div>
    </div>
  );
};

export default GraphSettingsPanel;
