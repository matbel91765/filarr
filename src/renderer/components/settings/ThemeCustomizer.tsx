/**
 * Theme Customizer Component
 *
 * Composant de personnalisation des thèmes permettant:
 * - Sélection de thèmes prédéfinis
 * - Création de thèmes personnalisés
 * - Choix de couleur d'accent
 * - Import/Export de thèmes en JSON
 * - Détection du thème système
 */

import { FC, useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Card, { CardHeader, CardBody } from '../ui/Card/Card';
import Button from '../ui/Button/Button';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import Input from '../ui/Input/Input';
import { useNotification } from '../ui/Notification';
import {
  setTheme,
  setCustomTheme,
  setActiveThemeId,
  setUseSystemTheme,
  addCustomTheme,
  removeCustomTheme,
  updateCustomThemeInStore
} from '../../../store/slices/uiSlice';
import {
  Theme,
  ThemeColors,
  BUILT_IN_THEMES,
  getAllThemes,
  createCustomTheme,
  exportTheme,
  importTheme,
  applyTheme,
  detectSystemTheme,
  onSystemThemeChange,
  getThemeById
} from '../../../services/platform/themeService';
import type { RootState, AppDispatch } from '../../../store';
import './ThemeCustomizer.css';

// ==================== ICONS ====================

const SunIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

const MoonIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const MonitorIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const PaletteIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="13.5" cy="6.5" r="2.5" />
    <circle cx="19" cy="11.5" r="2.5" />
    <circle cx="17" cy="18.5" r="2.5" />
    <circle cx="8.5" cy="17.5" r="2.5" />
    <circle cx="6" cy="10" r="2.5" />
    <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5.19-3.19A4 4 0 0 1 12 2z" />
  </svg>
);

const PlusIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const DownloadIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const UploadIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const CheckIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ==================== COMPONENT ====================

interface ThemeCustomizerProps {
  className?: string;
}

export const ThemeCustomizer: FC<ThemeCustomizerProps> = ({ className = '' }) => {
  const dispatch = useDispatch<AppDispatch>();
  const { success, error, info } = useNotification();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Redux state
  const {
    activeThemeId,
    customThemes,
    useSystemTheme
  } = useSelector((state: RootState) => state.ui);

  // Local state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
  const [newThemeName, setNewThemeName] = useState('');
  const [baseThemeId, setBaseThemeId] = useState('light');
  const [accentColor, setAccentColor] = useState('#87CEEB');
  const [customColors, setCustomColors] = useState<Partial<ThemeColors>>({});

  // Get all available themes
  const allThemes = getAllThemes(customThemes);
  const activeTheme = getThemeById(activeThemeId, customThemes) || BUILT_IN_THEMES[0];

  // System theme detection
  useEffect(() => {
    if (useSystemTheme) {
      const systemTheme = detectSystemTheme();
      const themeToApply = systemTheme === 'dark'
        ? BUILT_IN_THEMES.find(t => t.id === 'dark')
        : BUILT_IN_THEMES.find(t => t.id === 'light');

      if (themeToApply) {
        applyTheme(themeToApply);
      }
    }

    const unsubscribe = onSystemThemeChange((isDark) => {
      if (useSystemTheme) {
        const themeToApply = isDark
          ? BUILT_IN_THEMES.find(t => t.id === 'dark')
          : BUILT_IN_THEMES.find(t => t.id === 'light');

        if (themeToApply) {
          applyTheme(themeToApply);
        }
      }
    });

    return unsubscribe;
  }, [useSystemTheme]);

  // Apply theme on change
  useEffect(() => {
    if (!useSystemTheme && activeTheme) {
      applyTheme(activeTheme);
    }
  }, [activeTheme, useSystemTheme]);

  // Handle theme selection
  const handleSelectTheme = useCallback((theme: Theme) => {
    dispatch(setActiveThemeId(theme.id));
    dispatch(setUseSystemTheme(false));
    dispatch(setTheme(theme.mode === 'dark' ? 'dark' : 'light'));
    applyTheme(theme);
    success(`Theme "${theme.name}" applied`);
  }, [dispatch, success]);

  // Handle system theme toggle
  const handleSystemThemeToggle = useCallback(() => {
    const newValue = !useSystemTheme;
    dispatch(setUseSystemTheme(newValue));

    if (newValue) {
      const systemTheme = detectSystemTheme();
      const themeToApply = systemTheme === 'dark'
        ? BUILT_IN_THEMES.find(t => t.id === 'dark')
        : BUILT_IN_THEMES.find(t => t.id === 'light');

      if (themeToApply) {
        dispatch(setTheme(themeToApply.mode === 'dark' ? 'dark' : 'light'));
        applyTheme(themeToApply);
      }
      info('System theme detection enabled');
    } else {
      info('System theme detection disabled');
    }
  }, [useSystemTheme, dispatch, info]);

  // Handle create theme
  const handleCreateTheme = useCallback(() => {
    if (!newThemeName.trim()) {
      error('Please enter a theme name');
      return;
    }

    const newTheme = createCustomTheme(
      newThemeName.trim(),
      baseThemeId,
      {
        ...customColors,
        accent: accentColor,
        primary: accentColor
      },
      customThemes
    );

    dispatch(addCustomTheme(newTheme));
    dispatch(setActiveThemeId(newTheme.id));
    applyTheme(newTheme);

    setIsCreateModalOpen(false);
    setNewThemeName('');
    setCustomColors({});
    success(`Theme "${newTheme.name}" created`);
  }, [newThemeName, baseThemeId, customColors, accentColor, customThemes, dispatch, success, error]);

  // Handle edit theme
  const handleEditTheme = useCallback((theme: Theme) => {
    if (theme.isBuiltIn) {
      error('Built-in themes cannot be edited');
      return;
    }
    setEditingTheme(theme);
    setNewThemeName(theme.name);
    setAccentColor(theme.colors.accent);
    setCustomColors(theme.colors);
    setIsEditModalOpen(true);
  }, [error]);

  // Handle save edit
  const handleSaveEdit = useCallback(() => {
    if (!editingTheme || !newThemeName.trim()) return;

    const updatedTheme: Theme = {
      ...editingTheme,
      name: newThemeName.trim(),
      colors: {
        ...editingTheme.colors,
        ...customColors,
        accent: accentColor,
        primary: accentColor
      },
      updatedAt: new Date().toISOString()
    };

    dispatch(updateCustomThemeInStore(updatedTheme));

    if (activeThemeId === editingTheme.id) {
      applyTheme(updatedTheme);
    }

    setIsEditModalOpen(false);
    setEditingTheme(null);
    success(`Theme "${updatedTheme.name}" updated`);
  }, [editingTheme, newThemeName, customColors, accentColor, activeThemeId, dispatch, success]);

  // Handle delete theme
  const handleDeleteTheme = useCallback((theme: Theme) => {
    if (theme.isBuiltIn) {
      error('Built-in themes cannot be deleted');
      return;
    }

    dispatch(removeCustomTheme(theme.id));

    if (activeThemeId === theme.id) {
      const defaultTheme = BUILT_IN_THEMES[0];
      dispatch(setActiveThemeId(defaultTheme.id));
      applyTheme(defaultTheme);
    }

    success(`Theme "${theme.name}" deleted`);
  }, [activeThemeId, dispatch, success, error]);

  // Handle export theme
  const handleExportTheme = useCallback((theme: Theme) => {
    const jsonString = exportTheme(theme);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `filarr-theme-${theme.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
    success(`Theme "${theme.name}" exported`);
  }, [success]);

  // Handle import theme
  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileImport = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const importedTheme = importTheme(content);

      if (importedTheme) {
        dispatch(addCustomTheme(importedTheme));
        success(`Theme "${importedTheme.name}" imported successfully`);
      } else {
        error('Failed to import theme. Invalid format.');
      }
    };
    reader.readAsText(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [dispatch, success, error]);

  // Color picker handler
  const handleColorChange = useCallback((colorKey: keyof ThemeColors, value: string) => {
    setCustomColors(prev => ({
      ...prev,
      [colorKey]: value
    }));
  }, []);

  return (
    <div className={`theme-customizer ${className}`}>
      <Card variant="outlined" padding="md">
        <CardHeader>
          <div className="theme-customizer__header">
            <PaletteIcon />
            <h3>Theme Settings</h3>
          </div>
        </CardHeader>
        <CardBody>
          {/* System Theme Toggle */}
          <div className="theme-customizer__system-toggle">
            <div className="theme-customizer__toggle-info">
              <MonitorIcon />
              <div>
                <span className="theme-customizer__toggle-label">Use System Theme</span>
                <span className="theme-customizer__toggle-description">
                  Automatically switch between light and dark based on your system settings
                </span>
              </div>
            </div>
            <button
              className={`theme-customizer__toggle-switch ${useSystemTheme ? 'active' : ''}`}
              onClick={handleSystemThemeToggle}
              aria-pressed={useSystemTheme}
            >
              <span className="theme-customizer__toggle-track">
                <span className="theme-customizer__toggle-thumb" />
              </span>
            </button>
          </div>

          {/* Theme Grid */}
          <div className="theme-customizer__section">
            <h4 className="theme-customizer__section-title">Available Themes</h4>
            <div className="theme-customizer__grid">
              {allThemes.map((theme) => (
                <div
                  key={theme.id}
                  className={`theme-customizer__card ${activeThemeId === theme.id && !useSystemTheme ? 'active' : ''}`}
                  onClick={() => handleSelectTheme(theme)}
                >
                  <div
                    className="theme-customizer__card-preview"
                    style={{
                      background: theme.colors.background,
                      borderColor: theme.colors.border
                    }}
                  >
                    <div
                      className="theme-customizer__card-preview-header"
                      style={{ background: theme.colors.primary }}
                    />
                    <div className="theme-customizer__card-preview-content">
                      <div
                        className="theme-customizer__card-preview-sidebar"
                        style={{ background: theme.colors.backgroundSecondary }}
                      />
                      <div className="theme-customizer__card-preview-main">
                        <div
                          className="theme-customizer__card-preview-item"
                          style={{ background: theme.colors.surface }}
                        />
                        <div
                          className="theme-customizer__card-preview-item"
                          style={{ background: theme.colors.accent }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="theme-customizer__card-info">
                    <span className="theme-customizer__card-name">{theme.name}</span>
                    <div className="theme-customizer__card-mode">
                      {theme.mode === 'dark' ? <MoonIcon /> : <SunIcon />}
                    </div>
                  </div>
                  {activeThemeId === theme.id && !useSystemTheme && (
                    <div className="theme-customizer__card-check">
                      <CheckIcon />
                    </div>
                  )}
                  {!theme.isBuiltIn && (
                    <div className="theme-customizer__card-actions">
                      <button
                        className="theme-customizer__card-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditTheme(theme);
                        }}
                        title="Edit theme"
                      >
                        <PaletteIcon />
                      </button>
                      <button
                        className="theme-customizer__card-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExportTheme(theme);
                        }}
                        title="Export theme"
                      >
                        <DownloadIcon />
                      </button>
                      <button
                        className="theme-customizer__card-action theme-customizer__card-action--danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTheme(theme);
                        }}
                        title="Delete theme"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="theme-customizer__actions">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<PlusIcon />}
              onClick={() => setIsCreateModalOpen(true)}
            >
              Create Theme
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<UploadIcon />}
              onClick={handleImportClick}
            >
              Import Theme
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileImport}
              style={{ display: 'none' }}
            />
          </div>

          {/* Accent Color Picker */}
          <div className="theme-customizer__section">
            <h4 className="theme-customizer__section-title">Quick Accent Color</h4>
            <p className="theme-customizer__section-description">
              Change the accent color for the current theme
            </p>
            <div className="theme-customizer__color-picker">
              <input
                type="color"
                value={activeTheme.colors.accent}
                onChange={(e) => {
                  if (activeTheme.isBuiltIn) {
                    // Create a new custom theme with the new accent
                    const newTheme = createCustomTheme(
                      `${activeTheme.name} Custom`,
                      activeTheme.id,
                      { accent: e.target.value, primary: e.target.value },
                      customThemes
                    );
                    dispatch(addCustomTheme(newTheme));
                    dispatch(setActiveThemeId(newTheme.id));
                    applyTheme(newTheme);
                  } else {
                    // Update the custom theme
                    const updatedTheme: Theme = {
                      ...activeTheme,
                      colors: {
                        ...activeTheme.colors,
                        accent: e.target.value,
                        primary: e.target.value
                      }
                    };
                    dispatch(updateCustomThemeInStore(updatedTheme));
                    applyTheme(updatedTheme);
                  }
                }}
                className="theme-customizer__color-input"
              />
              <span className="theme-customizer__color-value">{activeTheme.colors.accent}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Create Theme Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Theme"
        size="md"
      >
        <ModalBody>
          <div className="theme-customizer__modal-form">
            <div className="theme-customizer__form-group">
              <label htmlFor="theme-name">Theme Name</label>
              <Input
                id="theme-name"
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
                placeholder="My Custom Theme"
              />
            </div>

            <div className="theme-customizer__form-group">
              <label htmlFor="base-theme">Base Theme</label>
              <select
                id="base-theme"
                value={baseThemeId}
                onChange={(e) => setBaseThemeId(e.target.value)}
                className="theme-customizer__select"
              >
                {BUILT_IN_THEMES.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="theme-customizer__form-group">
              <label>Primary/Accent Color</label>
              <div className="theme-customizer__color-picker">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="theme-customizer__color-input"
                />
                <span className="theme-customizer__color-value">{accentColor}</span>
              </div>
            </div>

            <div className="theme-customizer__form-group">
              <label>Advanced Colors (Optional)</label>
              <div className="theme-customizer__color-grid">
                {(['background', 'surface', 'textPrimary', 'border'] as const).map((colorKey) => {
                  const baseTheme = getThemeById(baseThemeId, customThemes) || BUILT_IN_THEMES[0];
                  return (
                    <div key={colorKey} className="theme-customizer__color-item">
                      <label>{colorKey}</label>
                      <input
                        type="color"
                        value={customColors[colorKey] || baseTheme.colors[colorKey]}
                        onChange={(e) => handleColorChange(colorKey, e.target.value)}
                        className="theme-customizer__color-input-small"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreateTheme}>
            Create Theme
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Theme Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingTheme(null);
        }}
        title="Edit Theme"
        size="md"
      >
        <ModalBody>
          <div className="theme-customizer__modal-form">
            <div className="theme-customizer__form-group">
              <label htmlFor="edit-theme-name">Theme Name</label>
              <Input
                id="edit-theme-name"
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
                placeholder="Theme Name"
              />
            </div>

            <div className="theme-customizer__form-group">
              <label>Primary/Accent Color</label>
              <div className="theme-customizer__color-picker">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="theme-customizer__color-input"
                />
                <span className="theme-customizer__color-value">{accentColor}</span>
              </div>
            </div>

            <div className="theme-customizer__form-group">
              <label>Theme Colors</label>
              <div className="theme-customizer__color-grid">
                {editingTheme && Object.entries(editingTheme.colors).map(([colorKey, colorValue]) => (
                  <div key={colorKey} className="theme-customizer__color-item">
                    <label>{colorKey}</label>
                    <input
                      type="color"
                      value={customColors[colorKey as keyof ThemeColors] || colorValue}
                      onChange={(e) => handleColorChange(colorKey as keyof ThemeColors, e.target.value)}
                      className="theme-customizer__color-input-small"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setIsEditModalOpen(false);
              setEditingTheme(null);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveEdit}>
            Save Changes
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default ThemeCustomizer;
