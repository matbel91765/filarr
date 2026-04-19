/**
 * Service de gestion des thèmes
 *
 * Ce module gère les thèmes de l'application, incluant:
 * - Thèmes prédéfinis (Light, Dark, Blue, Green, Purple)
 * - Création de thèmes personnalisés
 * - Import/Export de thèmes en JSON
 * - Détection du thème système
 * - Persistance des préférences
 */

import { generateUniqueId } from '../../utils/idGenerator';

// ==================== TYPES ====================

export type ThemeMode = 'light' | 'dark' | 'system';
export type DensityMode = 'comfortable' | 'compact' | 'dense';
export type ViewType = 'list' | 'grid' | 'details';

export interface ThemeColors {
  primary: string;
  primaryHover: string;
  primaryActive: string;
  background: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  surface: string;
  surfaceHover: string;
  border: string;
  borderLight: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentHover: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: ThemeColors;
  isBuiltIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DensitySettings {
  mode: DensityMode;
  viewType: ViewType;
  listColumns: string[];
  gridItemSize: 'small' | 'medium' | 'large';
}

export interface ThemePreferences {
  activeThemeId: string;
  customThemes: Theme[];
  useSystemTheme: boolean;
  density: DensitySettings;
}

// ==================== BUILT-IN THEMES ====================

export const BUILT_IN_THEMES: Theme[] = [
  {
    id: 'light',
    name: 'Light',
    mode: 'light',
    isBuiltIn: true,
    colors: {
      primary: '#4682B4',
      primaryHover: '#3A6B94',
      primaryActive: '#2E5575',
      background: '#FFFFFF',
      backgroundSecondary: '#F8FAFC',
      backgroundTertiary: '#F1F5F9',
      surface: '#FFFFFF',
      surfaceHover: '#F8FAFC',
      border: '#E2E8F0',
      borderLight: '#F1F5F9',
      textPrimary: '#3A6B94',
      textSecondary: '#475569',
      textTertiary: '#64748B',
      accent: '#87CEEB',
      accentHover: '#5FB8E3',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      info: '#3B82F6',
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    mode: 'dark',
    isBuiltIn: true,
    colors: {
      primary: '#87CEEB',
      primaryHover: '#5FB8E3',
      primaryActive: '#38A3DC',
      background: '#0A0E1A',
      backgroundSecondary: '#10141F',
      backgroundTertiary: '#1A1F2E',
      surface: '#10141F',
      surfaceHover: '#1A1F2E',
      border: '#2A3142',
      borderLight: '#1E2433',
      textPrimary: '#F0F8FF',
      textSecondary: '#B8C5D6',
      textTertiary: '#8B98AC',
      accent: '#87CEEB',
      accentHover: '#5FB8E3',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      info: '#3B82F6',
    },
  },
  {
    id: 'blue',
    name: 'Blue',
    mode: 'light',
    isBuiltIn: true,
    colors: {
      primary: '#2563EB',
      primaryHover: '#1D4ED8',
      primaryActive: '#1E40AF',
      background: '#F0F9FF',
      backgroundSecondary: '#E0F2FE',
      backgroundTertiary: '#BAE6FD',
      surface: '#FFFFFF',
      surfaceHover: '#F0F9FF',
      border: '#93C5FD',
      borderLight: '#BFDBFE',
      textPrimary: '#1E40AF',
      textSecondary: '#1E3A5F',
      textTertiary: '#3B82F6',
      accent: '#3B82F6',
      accentHover: '#2563EB',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      info: '#0EA5E9',
    },
  },
  {
    id: 'green',
    name: 'Green',
    mode: 'light',
    isBuiltIn: true,
    colors: {
      primary: '#059669',
      primaryHover: '#047857',
      primaryActive: '#065F46',
      background: '#F0FDF4',
      backgroundSecondary: '#DCFCE7',
      backgroundTertiary: '#BBF7D0',
      surface: '#FFFFFF',
      surfaceHover: '#F0FDF4',
      border: '#86EFAC',
      borderLight: '#A7F3D0',
      textPrimary: '#065F46',
      textSecondary: '#14532D',
      textTertiary: '#166534',
      accent: '#10B981',
      accentHover: '#059669',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      info: '#3B82F6',
    },
  },
  {
    id: 'purple',
    name: 'Purple',
    mode: 'light',
    isBuiltIn: true,
    colors: {
      primary: '#7C3AED',
      primaryHover: '#6D28D9',
      primaryActive: '#5B21B6',
      background: '#FAF5FF',
      backgroundSecondary: '#F3E8FF',
      backgroundTertiary: '#E9D5FF',
      surface: '#FFFFFF',
      surfaceHover: '#FAF5FF',
      border: '#C4B5FD',
      borderLight: '#DDD6FE',
      textPrimary: '#5B21B6',
      textSecondary: '#4C1D95',
      textTertiary: '#6D28D9',
      accent: '#8B5CF6',
      accentHover: '#7C3AED',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      info: '#3B82F6',
    },
  },
];

// ==================== DEFAULT SETTINGS ====================

export const DEFAULT_DENSITY_SETTINGS: DensitySettings = {
  mode: 'comfortable',
  viewType: 'grid',
  listColumns: ['name', 'size', 'date', 'type'],
  gridItemSize: 'medium',
};

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  activeThemeId: 'light',
  customThemes: [],
  useSystemTheme: false,
  density: DEFAULT_DENSITY_SETTINGS,
};

// ==================== STORAGE KEYS ====================

const STORAGE_KEY_PREFERENCES = 'filarr-theme-preferences';
const STORAGE_KEY_DENSITY = 'filarr-density-settings';

// ==================== SERVICE FUNCTIONS ====================

/**
 * Charge les préférences de thème depuis localStorage
 */
export const loadThemePreferences = (): ThemePreferences => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PREFERENCES);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_THEME_PREFERENCES,
        ...parsed,
        density: {
          ...DEFAULT_DENSITY_SETTINGS,
          ...parsed.density,
        },
      };
    }
  } catch (error) {
    console.error('Erreur lors du chargement des préférences de thème:', error);
  }
  return DEFAULT_THEME_PREFERENCES;
};

/**
 * Sauvegarde les préférences de thème dans localStorage
 */
export const saveThemePreferences = (preferences: ThemePreferences): void => {
  try {
    localStorage.setItem(STORAGE_KEY_PREFERENCES, JSON.stringify(preferences));
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des préférences de thème:', error);
  }
};

/**
 * Obtient un thème par son ID
 */
export const getThemeById = (themeId: string, customThemes: Theme[] = []): Theme | undefined => {
  const builtInTheme = BUILT_IN_THEMES.find((t) => t.id === themeId);
  if (builtInTheme) return builtInTheme;
  return customThemes.find((t) => t.id === themeId);
};

/**
 * Obtient tous les thèmes disponibles
 */
export const getAllThemes = (customThemes: Theme[] = []): Theme[] => {
  return [...BUILT_IN_THEMES, ...customThemes];
};

/**
 * Crée un nouveau thème personnalisé
 */
export const createCustomTheme = (
  name: string,
  baseThemeId: string,
  colorOverrides: Partial<ThemeColors>,
  customThemes: Theme[] = []
): Theme => {
  const baseTheme = getThemeById(baseThemeId, customThemes) || BUILT_IN_THEMES[0];

  const newTheme: Theme = {
    id: generateUniqueId(),
    name,
    mode: baseTheme.mode,
    isBuiltIn: false,
    colors: {
      ...baseTheme.colors,
      ...colorOverrides,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return newTheme;
};

/**
 * Met à jour un thème personnalisé
 */
export const updateCustomTheme = (
  themeId: string,
  updates: Partial<Omit<Theme, 'id' | 'isBuiltIn'>>,
  customThemes: Theme[]
): Theme[] => {
  return customThemes.map((theme) => {
    if (theme.id === themeId) {
      return {
        ...theme,
        ...updates,
        colors: {
          ...theme.colors,
          ...(updates.colors || {}),
        },
        updatedAt: new Date().toISOString(),
      };
    }
    return theme;
  });
};

/**
 * Supprime un thème personnalisé
 */
export const deleteCustomTheme = (themeId: string, customThemes: Theme[]): Theme[] => {
  return customThemes.filter((t) => t.id !== themeId);
};

/**
 * Exporte un thème en JSON
 */
export const exportTheme = (theme: Theme): string => {
  const exportData = {
    ...theme,
    exportedAt: new Date().toISOString(),
    version: '1.0',
  };
  return JSON.stringify(exportData, null, 2);
};

/**
 * Importe un thème depuis JSON
 */
export const importTheme = (jsonString: string): Theme | null => {
  try {
    const parsed = JSON.parse(jsonString);

    // Valider la structure du thème
    if (!parsed.name || !parsed.colors) {
      throw new Error('Structure de thème invalide');
    }

    // Créer un nouveau thème avec un nouvel ID
    const importedTheme: Theme = {
      id: generateUniqueId(),
      name: parsed.name + ' (Importé)',
      mode: parsed.mode || 'light',
      isBuiltIn: false,
      colors: {
        ...BUILT_IN_THEMES[0].colors,
        ...parsed.colors,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return importedTheme;
  } catch (error) {
    console.error("Erreur lors de l'import du thème:", error);
    return null;
  }
};

/**
 * Détecte le thème système (clair/sombre)
 */
export const detectSystemTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
};

/**
 * Écoute les changements de thème système
 */
export const onSystemThemeChange = (callback: (isDark: boolean) => void): (() => void) => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => callback(e.matches);

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }
  return () => {};
};

/**
 * Applique un thème au document
 */
export const applyTheme = (theme: Theme): void => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  // Set theme mode
  root.setAttribute('data-theme', theme.mode === 'dark' ? 'dark' : 'light');
  root.setAttribute('data-theme-id', theme.id);

  // Apply theme colors as CSS variables
  const colorMapping: Record<keyof ThemeColors, string> = {
    primary: '--theme-primary',
    primaryHover: '--theme-primary-hover',
    primaryActive: '--theme-primary-active',
    background: '--theme-background',
    backgroundSecondary: '--theme-background-secondary',
    backgroundTertiary: '--theme-background-tertiary',
    surface: '--theme-surface',
    surfaceHover: '--theme-surface-hover',
    border: '--theme-border',
    borderLight: '--theme-border-light',
    textPrimary: '--theme-text-primary',
    textSecondary: '--theme-text-secondary',
    textTertiary: '--theme-text-tertiary',
    accent: '--theme-accent',
    accentHover: '--theme-accent-hover',
    success: '--theme-success',
    warning: '--theme-warning',
    error: '--theme-error',
    info: '--theme-info',
  };

  Object.entries(theme.colors).forEach(([key, value]) => {
    const cssVar = colorMapping[key as keyof ThemeColors];
    if (cssVar) {
      root.style.setProperty(cssVar, value);
    }
  });
};

/**
 * Applique les paramètres de densité au document
 */
export const applyDensity = (density: DensitySettings): void => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  // Set density mode attribute
  root.setAttribute('data-density', density.mode);
  root.setAttribute('data-view-type', density.viewType);

  // Apply density-specific spacing values
  const densityValues = {
    comfortable: {
      spacing: '1rem',
      itemPadding: '12px 16px',
      itemGap: '12px',
      fontSize: '14px',
      iconSize: '20px',
      rowHeight: '48px',
      gridItemWidth: '180px',
    },
    compact: {
      spacing: '0.75rem',
      itemPadding: '8px 12px',
      itemGap: '8px',
      fontSize: '13px',
      iconSize: '18px',
      rowHeight: '40px',
      gridItemWidth: '150px',
    },
    dense: {
      spacing: '0.5rem',
      itemPadding: '4px 8px',
      itemGap: '4px',
      fontSize: '12px',
      iconSize: '16px',
      rowHeight: '32px',
      gridItemWidth: '120px',
    },
  };

  const values = densityValues[density.mode];

  root.style.setProperty('--density-spacing', values.spacing);
  root.style.setProperty('--density-item-padding', values.itemPadding);
  root.style.setProperty('--density-item-gap', values.itemGap);
  root.style.setProperty('--density-font-size', values.fontSize);
  root.style.setProperty('--density-icon-size', values.iconSize);
  root.style.setProperty('--density-row-height', values.rowHeight);
  root.style.setProperty('--density-grid-item-width', values.gridItemWidth);

  // Grid item size
  const gridSizeValues = {
    small: '100px',
    medium: '150px',
    large: '200px',
  };
  root.style.setProperty('--density-grid-size', gridSizeValues[density.gridItemSize]);
};

/**
 * Génère une couleur accent à partir d'une couleur de base
 */
export const generateAccentColors = (
  baseColor: string
): { accent: string; accentHover: string } => {
  // Simple color manipulation - could be enhanced with a color library
  const hex = baseColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Darken for hover
  const darken = (value: number) => Math.max(0, Math.floor(value * 0.85));

  const accentHover = `#${darken(r).toString(16).padStart(2, '0')}${darken(g).toString(16).padStart(2, '0')}${darken(b).toString(16).padStart(2, '0')}`;

  return {
    accent: baseColor,
    accentHover,
  };
};

/**
 * Sauvegarde les paramètres de densité
 */
export const saveDensitySettings = (settings: DensitySettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY_DENSITY, JSON.stringify(settings));
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des paramètres de densité:', error);
  }
};

/**
 * Charge les paramètres de densité
 */
export const loadDensitySettings = (): DensitySettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_DENSITY);
    if (stored) {
      return {
        ...DEFAULT_DENSITY_SETTINGS,
        ...JSON.parse(stored),
      };
    }
  } catch (error) {
    console.error('Erreur lors du chargement des paramètres de densité:', error);
  }
  return DEFAULT_DENSITY_SETTINGS;
};

/**
 * Réinitialise les préférences aux valeurs par défaut
 */
export const resetToDefaults = (): ThemePreferences => {
  saveThemePreferences(DEFAULT_THEME_PREFERENCES);
  applyTheme(BUILT_IN_THEMES[0]);
  applyDensity(DEFAULT_DENSITY_SETTINGS);
  return DEFAULT_THEME_PREFERENCES;
};

// ==================== AVAILABLE COLUMNS FOR LIST VIEW ====================

export const AVAILABLE_LIST_COLUMNS = [
  { id: 'name', label: 'Nom', required: true },
  { id: 'size', label: 'Taille', required: false },
  { id: 'date', label: 'Date de modification', required: false },
  { id: 'type', label: 'Type', required: false },
  { id: 'createdAt', label: 'Date de création', required: false },
  { id: 'description', label: 'Description', required: false },
];

// ==================== ACCENT COLOR PALETTES ====================

export interface AccentColorPalette {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

export const ACCENT_COLOR_PALETTES: Record<string, AccentColorPalette> = {
  '#87CEEB': {
    50: '#F0F9FF',
    100: '#E0F2FE',
    200: '#BAE6FD',
    300: '#87CEEB',
    400: '#5FB8E3',
    500: '#38A3DC',
    600: '#4682B4',
    700: '#3A6B94',
    800: '#2E5575',
    900: '#1E3A4F',
  },
  '#6366f1': {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
  },
  '#8b5cf6': {
    50: '#f5f3ff',
    100: '#ede9fe',
    200: '#ddd6fe',
    300: '#c4b5fd',
    400: '#a78bfa',
    500: '#8b5cf6',
    600: '#7c3aed',
    700: '#6d28d9',
    800: '#5b21b6',
    900: '#4c1d95',
  },
  '#ec4899': {
    50: '#fdf2f8',
    100: '#fce7f3',
    200: '#fbcfe8',
    300: '#f9a8d4',
    400: '#f472b6',
    500: '#ec4899',
    600: '#db2777',
    700: '#be185d',
    800: '#9d174d',
    900: '#831843',
  },
  '#ef4444': {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
  },
  '#f97316': {
    50: '#fff7ed',
    100: '#ffedd5',
    200: '#fed7aa',
    300: '#fdba74',
    400: '#fb923c',
    500: '#f97316',
    600: '#ea580c',
    700: '#c2410c',
    800: '#9a3412',
    900: '#7c2d12',
  },
  '#10b981': {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
  },
  '#06b6d4': {
    50: '#ecfeff',
    100: '#cffafe',
    200: '#a5f3fc',
    300: '#67e8f9',
    400: '#22d3ee',
    500: '#06b6d4',
    600: '#0891b2',
    700: '#0e7490',
    800: '#155e75',
    900: '#164e63',
  },
};

export const PRESET_ACCENT_COLORS = [
  // Blues
  { name: 'Ciel', value: '#87CEEB' },
  { name: 'Dodger', value: '#3B82F6' },
  { name: 'Royal', value: '#2563EB' },
  { name: 'Navy', value: '#1D4ED8' },
  { name: 'Sky', value: '#0EA5E9' },
  // Indigos / Violets
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Iris', value: '#7C3AED' },
  { name: 'Amethyste', value: '#A855F7' },
  { name: 'Lavande', value: '#818CF8' },
  // Pinks / Reds
  { name: 'Rose', value: '#ec4899' },
  { name: 'Fuchsia', value: '#D946EF' },
  { name: 'Corail', value: '#F43F5E' },
  { name: 'Rouge', value: '#ef4444' },
  { name: 'Cerise', value: '#DC2626' },
  // Oranges / Yellows
  { name: 'Orange', value: '#f97316' },
  { name: 'Ambre', value: '#F59E0B' },
  { name: 'Mandarine', value: '#FB923C' },
  { name: 'Or', value: '#EAB308' },
  { name: 'Peche', value: '#F97171' },
  // Greens
  { name: 'Emeraude', value: '#10b981' },
  { name: 'Foret', value: '#16A34A' },
  { name: 'Menthe', value: '#34D399' },
  { name: 'Sauge', value: '#059669' },
  { name: 'Lime', value: '#84CC16' },
  // Teals / Cyans
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Turquoise', value: '#14B8A6' },
  { name: 'Sarcelle', value: '#0D9488' },
  // Neutrals
  { name: 'Ardoise', value: '#64748B' },
  { name: 'Zinc', value: '#71717A' },
  { name: 'Pierre', value: '#78716C' },
];

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function generateAccentPaletteFromHex(hex: string): AccentColorPalette {
  const { h, s } = hexToHSL(hex);
  return {
    50: hslToHex(h, Math.min(s, 100), 97),
    100: hslToHex(h, Math.min(s, 95), 93),
    200: hslToHex(h, Math.min(s, 90), 85),
    300: hslToHex(h, Math.min(s, 85), 74),
    400: hslToHex(h, Math.min(s, 80), 62),
    500: hslToHex(h, Math.min(s, 75), 50),
    600: hslToHex(h, Math.min(s, 70), 42),
    700: hslToHex(h, Math.min(s, 65), 34),
    800: hslToHex(h, Math.min(s, 60), 26),
    900: hslToHex(h, Math.min(s, 55), 20),
  };
}

/** Apply an accent color palette to CSS custom properties */
export function applyAccentColorPalette(hex: string): void {
  const palette = ACCENT_COLOR_PALETTES[hex] || generateAccentPaletteFromHex(hex);
  const root = document.documentElement;
  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
  for (const shade of shades) {
    root.style.setProperty(`--color-primary-${shade}`, palette[shade]);
  }
}

/** Reset accent color palette to defaults */
export function resetAccentColorPalette(): void {
  const root = document.documentElement;
  for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
    root.style.removeProperty(`--color-primary-${shade}`);
  }
}

// Export default object for convenience
export default {
  BUILT_IN_THEMES,
  DEFAULT_DENSITY_SETTINGS,
  DEFAULT_THEME_PREFERENCES,
  AVAILABLE_LIST_COLUMNS,
  loadThemePreferences,
  saveThemePreferences,
  getThemeById,
  getAllThemes,
  createCustomTheme,
  updateCustomTheme,
  deleteCustomTheme,
  exportTheme,
  importTheme,
  detectSystemTheme,
  onSystemThemeChange,
  applyTheme,
  applyDensity,
  generateAccentColors,
  saveDensitySettings,
  loadDensitySettings,
  resetToDefaults,
};
