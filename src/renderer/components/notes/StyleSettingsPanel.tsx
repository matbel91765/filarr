/**
 * StyleSettingsPanel — Filarr Notes
 *
 * Two-column layout: settings (scrollable left) + live preview (fixed right).
 * Groups: Typography, Colors, Spacing, Editor.
 * Persists settings in localStorage and applies them as CSS custom properties.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './StyleSettingsPanel.css';

// ==================== Types ====================

export interface StyleSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  headingScale: number;
  accentColor: string;
  editorBg: string;
  textColor: string;
  editorPadding: number;
  contentMaxWidth: number;
  showLineNumbers: boolean;
  typewriterMode: boolean;
  spacingScale: number;
}

interface StyleSettingsPanelProps {
  onSettingsChange?: (settings: StyleSettings) => void;
}

// ==================== Constants ====================

const STORAGE_KEY = 'filarr-style-settings';

const DEFAULT_SETTINGS: StyleSettings = {
  fontFamily: 'system',
  fontSize: 16,
  lineHeight: 1.6,
  headingScale: 1.25,
  accentColor: '#3b82f6',
  editorBg: '#ffffff',
  textColor: '#1e293b',
  editorPadding: 48,
  contentMaxWidth: 720,
  showLineNumbers: false,
  typewriterMode: false,
  spacingScale: 1,
};

const FONT_OPTIONS: { value: string; label: string; css: string }[] = [
  { value: 'system', label: 'System Default', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { value: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", Times, serif' },
  { value: 'sans-serif', label: 'Sans-serif', css: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { value: 'monospace', label: 'Monospace', css: '"Fira Code", "JetBrains Mono", "Cascadia Code", Consolas, monospace' },
];

interface StylePreset {
  id: string;
  label: string;
  icon: string;
  settings: Partial<StyleSettings>;
}

const PRESETS: StylePreset[] = [
  {
    id: 'default', label: 'Default', icon: '📝',
    settings: { ...DEFAULT_SETTINGS },
  },
  {
    id: 'writer', label: 'Writer', icon: '✍️',
    settings: { fontFamily: 'serif', fontSize: 18, lineHeight: 1.8, editorPadding: 60, contentMaxWidth: 640, editorBg: '#fefcf7', textColor: '#2c2c2c' },
  },
  {
    id: 'developer', label: 'Developer', icon: '💻',
    settings: { fontFamily: 'monospace', fontSize: 14, lineHeight: 1.5, editorPadding: 24, contentMaxWidth: 900, showLineNumbers: true },
  },
  {
    id: 'compact', label: 'Compact', icon: '📋',
    settings: { fontSize: 13, lineHeight: 1.4, editorPadding: 16, contentMaxWidth: 1000 },
  },
  {
    id: 'focus', label: 'Focus', icon: '🎯',
    settings: { fontFamily: 'sans-serif', fontSize: 18, lineHeight: 1.8, editorPadding: 80, contentMaxWidth: 560, typewriterMode: true },
  },
];

// ==================== Helpers ====================

function loadSettings(): StyleSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: StyleSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

function getFontCss(family: string): string {
  const option = FONT_OPTIONS.find(o => o.value === family);
  return option ? option.css : family;
}

function getFontLabel(family: string): string {
  const option = FONT_OPTIONS.find(o => o.value === family);
  return option ? option.label : family;
}

// ==================== Component ====================

const StyleSettingsPanel: React.FC<StyleSettingsPanelProps> = ({ onSettingsChange }) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<StyleSettings>(loadSettings);
  const [isCollapsed, setIsCollapsed] = useState<Record<string, boolean>>({});

  // Persist and notify on change
  useEffect(() => {
    saveSettings(settings);
    onSettingsChange?.(settings);
  }, [settings, onSettingsChange]);

  const update = useCallback(<K extends keyof StyleSettings>(key: K, value: StyleSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetToDefaults = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  const toggleGroup = useCallback((group: string) => {
    setIsCollapsed(prev => ({ ...prev, [group]: !prev[group] }));
  }, []);

  return (
    <div className="style-settings">
      {/* Left column: controls */}
      <div className="style-settings__controls">
        <div className="style-settings__header">
          <span className="style-settings__subtitle">
            {t('notes.styleSettings.subtitle', 'Customize your writing environment')}
          </span>
          <button
            className="style-settings__reset-btn"
            onClick={resetToDefaults}
            title={t('notes.styleSettings.reset', 'Reset to defaults')}
          >
            {t('notes.styleSettings.reset', 'Reset')}
          </button>
        </div>

        {/* Quick Presets */}
        <div className="style-settings__presets">
          {PRESETS.map(preset => (
            <button
              key={preset.id}
              className={`style-settings__preset ${settings.fontFamily === (preset.settings.fontFamily ?? DEFAULT_SETTINGS.fontFamily) && settings.fontSize === (preset.settings.fontSize ?? DEFAULT_SETTINGS.fontSize) ? 'is-active' : ''}`}
              onClick={() => setSettings(prev => ({ ...prev, ...preset.settings }))}
              title={preset.label}
            >
              <span className="style-settings__preset-icon">{preset.icon}</span>
              <span className="style-settings__preset-label">{preset.label}</span>
            </button>
          ))}
        </div>

        {/* Typography Group */}
        <div className="style-settings__group">
          <button
            className="style-settings__group-header"
            onClick={() => toggleGroup('typography')}
          >
            <span className="style-settings__group-title">
              {t('notes.styleSettings.typography', 'Typography')}
            </span>
            <span className={`style-settings__chevron ${isCollapsed.typography ? 'style-settings__chevron--collapsed' : ''}`}>
              &#9662;
            </span>
          </button>
          {!isCollapsed.typography && (
            <div className="style-settings__group-body">
              <div className="style-settings__field">
                <label className="style-settings__label">
                  {t('notes.styleSettings.fontFamily', 'Font Family')}
                </label>
                <select
                  className="style-settings__select"
                  value={settings.fontFamily}
                  onChange={e => update('fontFamily', e.target.value)}
                >
                  {FONT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="style-settings__field">
                <label className="style-settings__label">
                  {t('notes.styleSettings.fontSize', 'Font Size')}
                  <span className="style-settings__value">{settings.fontSize}px</span>
                </label>
                <input
                  type="range"
                  className="style-settings__slider"
                  min={12} max={24} step={1}
                  value={settings.fontSize}
                  onChange={e => update('fontSize', Number(e.target.value))}
                />
              </div>

              <div className="style-settings__field">
                <label className="style-settings__label">
                  {t('notes.styleSettings.lineHeight', 'Line Height')}
                  <span className="style-settings__value">{settings.lineHeight.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  className="style-settings__slider"
                  min={1.2} max={2.0} step={0.1}
                  value={settings.lineHeight}
                  onChange={e => update('lineHeight', Number(e.target.value))}
                />
              </div>

              <div className="style-settings__field">
                <label className="style-settings__label">
                  {t('notes.styleSettings.headingScale', 'Heading Scale')}
                  <span className="style-settings__value">{settings.headingScale.toFixed(2)}x</span>
                </label>
                <input
                  type="range"
                  className="style-settings__slider"
                  min={1.0} max={1.5} step={0.05}
                  value={settings.headingScale}
                  onChange={e => update('headingScale', Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>

        {/* Colors Group */}
        <div className="style-settings__group">
          <button
            className="style-settings__group-header"
            onClick={() => toggleGroup('colors')}
          >
            <span className="style-settings__group-title">
              {t('notes.styleSettings.colors', 'Colors')}
            </span>
            <span className={`style-settings__chevron ${isCollapsed.colors ? 'style-settings__chevron--collapsed' : ''}`}>
              &#9662;
            </span>
          </button>
          {!isCollapsed.colors && (
            <div className="style-settings__group-body">
              <div className="style-settings__field style-settings__field--color">
                <label className="style-settings__label">
                  {t('notes.styleSettings.accentColor', 'Accent Color')}
                </label>
                <div className="style-settings__color-input">
                  <input type="color" value={settings.accentColor} onChange={e => update('accentColor', e.target.value)} />
                  <span className="style-settings__color-hex">{settings.accentColor}</span>
                </div>
              </div>

              <div className="style-settings__field style-settings__field--color">
                <label className="style-settings__label">
                  {t('notes.styleSettings.editorBg', 'Background')}
                </label>
                <div className="style-settings__color-input">
                  <input type="color" value={settings.editorBg} onChange={e => update('editorBg', e.target.value)} />
                  <span className="style-settings__color-hex">{settings.editorBg}</span>
                </div>
              </div>

              <div className="style-settings__field style-settings__field--color">
                <label className="style-settings__label">
                  {t('notes.styleSettings.textColor', 'Text Color')}
                </label>
                <div className="style-settings__color-input">
                  <input type="color" value={settings.textColor} onChange={e => update('textColor', e.target.value)} />
                  <span className="style-settings__color-hex">{settings.textColor}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Spacing Group */}
        <div className="style-settings__group">
          <button
            className="style-settings__group-header"
            onClick={() => toggleGroup('spacing')}
          >
            <span className="style-settings__group-title">
              {t('notes.styleSettings.spacing', 'Spacing')}
            </span>
            <span className={`style-settings__chevron ${isCollapsed.spacing ? 'style-settings__chevron--collapsed' : ''}`}>
              &#9662;
            </span>
          </button>
          {!isCollapsed.spacing && (
            <div className="style-settings__group-body">
              <div className="style-settings__field">
                <label className="style-settings__label">
                  {t('notes.styleSettings.editorPadding', 'Editor Padding')}
                  <span className="style-settings__value">{settings.editorPadding}px</span>
                </label>
                <input
                  type="range"
                  className="style-settings__slider"
                  min={16} max={80} step={4}
                  value={settings.editorPadding}
                  onChange={e => update('editorPadding', Number(e.target.value))}
                />
              </div>

              <div className="style-settings__field">
                <label className="style-settings__label">
                  {t('notes.styleSettings.contentMaxWidth', 'Content Max Width')}
                  <span className="style-settings__value">{settings.contentMaxWidth}px</span>
                </label>
                <input
                  type="range"
                  className="style-settings__slider"
                  min={600} max={1200} step={20}
                  value={settings.contentMaxWidth}
                  onChange={e => update('contentMaxWidth', Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>

        {/* Editor Group */}
        <div className="style-settings__group">
          <button
            className="style-settings__group-header"
            onClick={() => toggleGroup('editor')}
          >
            <span className="style-settings__group-title">
              {t('notes.styleSettings.editor', 'Editor')}
            </span>
            <span className={`style-settings__chevron ${isCollapsed.editor ? 'style-settings__chevron--collapsed' : ''}`}>
              &#9662;
            </span>
          </button>
          {!isCollapsed.editor && (
            <div className="style-settings__group-body">
              <div className="style-settings__field style-settings__field--toggle">
                <label className="style-settings__label">
                  {t('notes.styleSettings.showLineNumbers', 'Show Line Numbers')}
                </label>
                <button
                  className={`style-settings__toggle ${settings.showLineNumbers ? 'style-settings__toggle--on' : ''}`}
                  onClick={() => update('showLineNumbers', !settings.showLineNumbers)}
                  role="switch"
                  aria-checked={settings.showLineNumbers}
                >
                  <span className="style-settings__toggle-knob" />
                </button>
              </div>

              <div className="style-settings__field style-settings__field--toggle">
                <label className="style-settings__label">
                  {t('notes.styleSettings.typewriterMode', 'Typewriter Mode')}
                </label>
                <button
                  className={`style-settings__toggle ${settings.typewriterMode ? 'style-settings__toggle--on' : ''}`}
                  onClick={() => update('typewriterMode', !settings.typewriterMode)}
                  role="switch"
                  aria-checked={settings.typewriterMode}
                >
                  <span className="style-settings__toggle-knob" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right column: live preview */}
      <div className="style-settings__preview-panel">
        <div className="style-settings__preview-label">
          {t('notes.styleSettings.preview', 'Preview')}
        </div>
        <div
          className="style-settings__preview-box"
          style={{
            fontFamily: getFontCss(settings.fontFamily),
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            color: settings.textColor,
            backgroundColor: settings.editorBg,
            padding: `${Math.min(settings.editorPadding, 24)}px`,
            maxWidth: `${Math.min(settings.contentMaxWidth, 320)}px`,
          }}
        >
          <div style={{ fontSize: `${settings.fontSize * settings.headingScale}px`, fontWeight: 700, marginBottom: 8, color: settings.textColor }}>
            My Document
          </div>
          <div style={{ marginBottom: 8 }}>
            The quick brown fox jumps over the lazy dog. This is how your text will look with the current settings.
          </div>
          <div style={{ marginBottom: 8, borderLeft: `3px solid ${settings.accentColor}`, paddingLeft: 12, opacity: 0.8, fontStyle: 'italic' }}>
            A blockquote styled with your accent color.
          </div>
          <div style={{ fontSize: `${settings.fontSize * 0.85}px`, opacity: 0.5 }}>
            {getFontLabel(settings.fontFamily)} &middot; {settings.fontSize}px &middot; {settings.lineHeight.toFixed(1)} lh
          </div>
        </div>
        {/* Summary chips */}
        <div className="style-settings__preview-summary">
          <span className="style-settings__chip">
            <span className="style-settings__chip-dot" style={{ background: settings.accentColor }} />
            Accent
          </span>
          <span className="style-settings__chip">
            <span className="style-settings__chip-dot" style={{ background: settings.editorBg, border: '1px solid var(--color-border, #e2e8f0)' }} />
            Background
          </span>
          <span className="style-settings__chip">
            <span className="style-settings__chip-dot" style={{ background: settings.textColor }} />
            Text
          </span>
          {settings.showLineNumbers && (
            <span className="style-settings__chip style-settings__chip--active">Line #</span>
          )}
          {settings.typewriterMode && (
            <span className="style-settings__chip style-settings__chip--active">Typewriter</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default StyleSettingsPanel;
