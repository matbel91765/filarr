/**
 * Shortcuts Service
 *
 * Service de gestion des raccourcis clavier globaux pour l'application Filarr.
 * Permet la définition, la personnalisation et la gestion des raccourcis clavier.
 */

import i18n from '../../i18n/config';
import { isWebPlatform } from './isWebPlatform';

// Types pour les raccourcis clavier
export interface KeyboardShortcut {
  id: string;
  name: string;
  description: string;
  keys: string[];
  action: string;
  category: ShortcutCategory;
  enabled: boolean;
  customizable: boolean;
}

export type ShortcutCategory =
  | 'navigation'
  | 'file'
  | 'folder'
  | 'edit'
  | 'view'
  | 'search'
  | 'system';

export interface ShortcutEvent {
  shortcutId: string;
  action: string;
  timestamp: number;
}

export type ShortcutCallback = (event: ShortcutEvent) => void;

// Configuration par défaut des raccourcis
const BASE_DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  // Fichiers
  {
    id: 'new-file',
    name: i18n.t('shortcuts.names.newFile'),
    description: i18n.t('shortcuts.descriptions.newFile'),
    keys: ['Ctrl', 'N'],
    action: 'file:new',
    category: 'file',
    enabled: true,
    customizable: true,
  },
  {
    id: 'new-folder',
    name: i18n.t('shortcuts.names.newFolder'),
    description: i18n.t('shortcuts.descriptions.newFolder'),
    keys: ['Ctrl', 'Alt', 'N'],
    action: 'folder:new',
    category: 'folder',
    enabled: true,
    customizable: true,
  },
  {
    id: 'delete',
    name: i18n.t('shortcuts.names.delete'),
    description: i18n.t('shortcuts.descriptions.delete'),
    keys: ['Ctrl', 'D'],
    action: 'item:delete',
    category: 'edit',
    enabled: true,
    customizable: true,
  },
  {
    id: 'rename',
    name: i18n.t('shortcuts.names.rename'),
    description: i18n.t('shortcuts.descriptions.rename'),
    keys: ['Ctrl', 'R'],
    action: 'item:rename',
    category: 'edit',
    enabled: true,
    customizable: true,
  },

  // Navigation & Recherche
  {
    id: 'quick-search',
    name: i18n.t('shortcuts.names.quickSearch'),
    description: i18n.t('shortcuts.descriptions.quickSearch'),
    keys: ['Ctrl', 'K'],
    action: 'search:quick',
    category: 'search',
    enabled: true,
    customizable: true,
  },
  {
    id: 'command-palette',
    name: i18n.t('shortcuts.names.commandPalette'),
    description: i18n.t('shortcuts.descriptions.commandPalette'),
    keys: ['Ctrl', 'P'],
    action: 'palette:open',
    category: 'system',
    enabled: true,
    customizable: true,
  },

  // Favoris (Ctrl+1-9)
  {
    id: 'favorite-1',
    name: i18n.t('shortcuts.names.favorite', { number: 1 }),
    description: i18n.t('shortcuts.descriptions.accessFavorite', { number: 1 }),
    keys: ['Ctrl', '1'],
    action: 'favorite:1',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'favorite-2',
    name: i18n.t('shortcuts.names.favorite', { number: 2 }),
    description: i18n.t('shortcuts.descriptions.accessFavorite', { number: 2 }),
    keys: ['Ctrl', '2'],
    action: 'favorite:2',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'favorite-3',
    name: i18n.t('shortcuts.names.favorite', { number: 3 }),
    description: i18n.t('shortcuts.descriptions.accessFavorite', { number: 3 }),
    keys: ['Ctrl', '3'],
    action: 'favorite:3',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'favorite-4',
    name: i18n.t('shortcuts.names.favorite', { number: 4 }),
    description: i18n.t('shortcuts.descriptions.accessFavorite', { number: 4 }),
    keys: ['Ctrl', '4'],
    action: 'favorite:4',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'favorite-5',
    name: i18n.t('shortcuts.names.favorite', { number: 5 }),
    description: i18n.t('shortcuts.descriptions.accessFavorite', { number: 5 }),
    keys: ['Ctrl', '5'],
    action: 'favorite:5',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'favorite-6',
    name: i18n.t('shortcuts.names.favorite', { number: 6 }),
    description: i18n.t('shortcuts.descriptions.accessFavorite', { number: 6 }),
    keys: ['Ctrl', '6'],
    action: 'favorite:6',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'favorite-7',
    name: i18n.t('shortcuts.names.favorite', { number: 7 }),
    description: i18n.t('shortcuts.descriptions.accessFavorite', { number: 7 }),
    keys: ['Ctrl', '7'],
    action: 'favorite:7',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'favorite-8',
    name: i18n.t('shortcuts.names.favorite', { number: 8 }),
    description: i18n.t('shortcuts.descriptions.accessFavorite', { number: 8 }),
    keys: ['Ctrl', '8'],
    action: 'favorite:8',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'favorite-9',
    name: i18n.t('shortcuts.names.favorite', { number: 9 }),
    description: i18n.t('shortcuts.descriptions.accessFavorite', { number: 9 }),
    keys: ['Ctrl', '9'],
    action: 'favorite:9',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },

  // Vue
  {
    id: 'toggle-sidebar',
    name: i18n.t('shortcuts.names.toggleSidebar'),
    description: i18n.t('shortcuts.descriptions.toggleSidebar'),
    keys: ['Ctrl', 'B'],
    action: 'view:toggle-sidebar',
    category: 'view',
    enabled: true,
    customizable: true,
  },
  {
    id: 'toggle-focus-mode',
    name: i18n.t('shortcuts.names.toggleFocusMode'),
    description: i18n.t('shortcuts.descriptions.toggleFocusMode'),
    // Ctrl+Maj+F, vérifié libre dans ce registre. À ne pas confondre avec
    // Ctrl+Alt+F, que `desktopProtection` réserve au mini-coffre en raccourci
    // GLOBAL Electron — celui-là gagne sur toute la machine.
    keys: ['Ctrl', 'Shift', 'F'],
    action: 'view:toggle-focus',
    category: 'view',
    enabled: true,
    customizable: true,
  },
  {
    id: 'toggle-header',
    name: i18n.t('shortcuts.names.toggleHeader'),
    description: i18n.t('shortcuts.descriptions.toggleHeader'),
    keys: ['Ctrl', 'Shift', 'B'],
    action: 'view:toggle-header',
    category: 'view',
    enabled: true,
    customizable: true,
  },
  {
    id: 'toggle-view-mode',
    name: i18n.t('shortcuts.names.toggleViewMode'),
    description: i18n.t('shortcuts.descriptions.toggleViewMode'),
    keys: ['Ctrl', 'Shift', 'V'],
    action: 'view:toggle-mode',
    category: 'view',
    enabled: true,
    customizable: true,
  },

  // Édition
  {
    id: 'select-all',
    name: i18n.t('shortcuts.names.selectAll'),
    description: i18n.t('shortcuts.descriptions.selectAll'),
    keys: ['Ctrl', 'A'],
    action: 'edit:select-all',
    category: 'edit',
    enabled: true,
    customizable: false, // Standard shortcut, non-customizable
  },
  {
    id: 'copy',
    name: i18n.t('shortcuts.names.copy'),
    description: i18n.t('shortcuts.descriptions.copy'),
    keys: ['Ctrl', 'C'],
    action: 'edit:copy',
    category: 'edit',
    enabled: true,
    customizable: false,
  },
  {
    id: 'cut',
    name: i18n.t('shortcuts.names.cut'),
    description: i18n.t('shortcuts.descriptions.cut'),
    keys: ['Ctrl', 'X'],
    action: 'edit:cut',
    category: 'edit',
    enabled: true,
    customizable: false,
  },
  {
    id: 'paste',
    name: i18n.t('shortcuts.names.paste'),
    description: i18n.t('shortcuts.descriptions.paste'),
    keys: ['Ctrl', 'V'],
    action: 'edit:paste',
    category: 'edit',
    enabled: true,
    customizable: false,
  },
  {
    id: 'undo',
    name: i18n.t('shortcuts.names.undo'),
    description: i18n.t('shortcuts.descriptions.undo'),
    keys: ['Ctrl', 'Z'],
    action: 'edit:undo',
    category: 'edit',
    enabled: true,
    customizable: false,
  },
  {
    id: 'redo',
    name: i18n.t('shortcuts.names.redo'),
    description: i18n.t('shortcuts.descriptions.redo'),
    keys: ['Ctrl', 'Y'],
    action: 'edit:redo',
    category: 'edit',
    enabled: true,
    customizable: false,
  },

  // Navigation
  {
    id: 'go-back',
    name: i18n.t('shortcuts.names.back'),
    description: i18n.t('shortcuts.descriptions.back'),
    keys: ['Alt', 'Left'],
    action: 'navigation:back',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'go-forward',
    name: i18n.t('shortcuts.names.forward'),
    description: i18n.t('shortcuts.descriptions.forward'),
    keys: ['Alt', 'Right'],
    action: 'navigation:forward',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'go-parent',
    name: i18n.t('shortcuts.names.parentFolder'),
    description: i18n.t('shortcuts.descriptions.parentFolder'),
    keys: ['Alt', 'Up'],
    action: 'navigation:parent',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'go-home',
    name: i18n.t('tabs.home'),
    description: i18n.t('tabs.home'),
    keys: ['Alt', 'Home'],
    action: 'navigation:home',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },

  // Panneaux (split view)
  {
    id: 'panel-focus-other',
    name: i18n.t('shortcuts.names.switchPanel'),
    description: i18n.t('shortcuts.descriptions.switchPanel'),
    keys: ['Ctrl', '\\'],
    action: 'panel:focus-other',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'panel-close',
    name: i18n.t('shortcuts.names.mergePanels'),
    description: i18n.t('shortcuts.descriptions.mergePanels'),
    keys: ['Ctrl', 'Shift', '\\'],
    action: 'panel:close',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'panel-split-right',
    name: i18n.t('shortcuts.names.splitRight'),
    description: i18n.t('shortcuts.descriptions.splitRight'),
    keys: ['Ctrl', 'Shift', '\\'],
    action: 'panel:split-right',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },

  // Onglets
  {
    id: 'tab-new',
    name: i18n.t('shortcuts.names.newTab'),
    description: i18n.t('shortcuts.descriptions.newTab'),
    keys: ['Ctrl', 'T'],
    action: 'tab:new',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'tab-close',
    name: i18n.t('shortcuts.names.closeTab'),
    description: i18n.t('shortcuts.descriptions.closeTab'),
    keys: ['Ctrl', 'W'],
    action: 'tab:close',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'tab-next',
    name: i18n.t('shortcuts.names.nextTab'),
    description: i18n.t('shortcuts.descriptions.nextTab'),
    keys: ['Ctrl', 'Tab'],
    action: 'tab:next',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'tab-prev',
    name: i18n.t('shortcuts.names.prevTab'),
    description: i18n.t('shortcuts.descriptions.prevTab'),
    keys: ['Ctrl', 'Shift', 'Tab'],
    action: 'tab:prev',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },

  // Notes
  {
    id: 'note-new',
    name: 'New Note',
    description: 'Create a new note',
    keys: ['Ctrl', 'Shift', 'N'],
    action: 'note:new',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  {
    id: 'note-daily',
    name: 'Daily Note',
    description: "Open today's daily note",
    keys: ['Ctrl', 'Shift', 'D'],
    action: 'note:daily',
    category: 'navigation',
    enabled: true,
    customizable: true,
  },
  // Système
  {
    id: 'settings',
    name: i18n.t('shortcuts.names.settings'),
    description: i18n.t('shortcuts.descriptions.settings'),
    keys: ['Ctrl', ','],
    action: 'system:settings',
    category: 'system',
    enabled: true,
    customizable: true,
  },
  {
    id: 'help',
    name: i18n.t('shortcuts.names.help'),
    description: i18n.t('shortcuts.descriptions.help'),
    keys: ['F1'],
    action: 'system:help',
    category: 'system',
    enabled: true,
    customizable: true,
  },
  {
    id: 'refresh',
    name: i18n.t('shortcuts.names.refresh'),
    description: i18n.t('shortcuts.descriptions.refresh'),
    keys: ['F5'],
    action: 'system:refresh',
    category: 'system',
    enabled: true,
    customizable: true,
  },
];

// Combos que le navigateur se réserve (preventDefault sans effet — Ctrl+W
// fermerait l'onglet du NAVIGATEUR) : sur le web, les défauts concernés
// basculent sur Alt. Ne touche que la couche défaut ; les personnalisations
// sauvegardées s'appliquent par-dessus, et diff/reset se font contre ces
// mêmes défauts.
const WEB_SHORTCUT_OVERRIDES: Record<string, string[]> = {
  'new-file': ['Alt', 'N'],
  'note-new': ['Alt', 'Shift', 'N'],
  'tab-new': ['Alt', 'T'],
  'tab-close': ['Alt', 'W'],
  'tab-next': ['Alt', 'PageDown'],
  'tab-prev': ['Alt', 'PageUp'],
  'favorite-1': ['Alt', '1'],
  'favorite-2': ['Alt', '2'],
  'favorite-3': ['Alt', '3'],
  'favorite-4': ['Alt', '4'],
  'favorite-5': ['Alt', '5'],
  'favorite-6': ['Alt', '6'],
  'favorite-7': ['Alt', '7'],
  'favorite-8': ['Alt', '8'],
  'favorite-9': ['Alt', '9'],
};

const DEFAULT_SHORTCUTS: KeyboardShortcut[] = isWebPlatform()
  ? BASE_DEFAULT_SHORTCUTS.map((shortcut) => {
      const keys = WEB_SHORTCUT_OVERRIDES[shortcut.id];
      return keys ? { ...shortcut, keys } : shortcut;
    })
  : BASE_DEFAULT_SHORTCUTS;

// Clé de stockage pour les raccourcis personnalisés
const STORAGE_KEY = 'filarr_keyboard_shortcuts';

/**
 * Classe de gestion des raccourcis clavier
 */
class ShortcutsService {
  private shortcuts: Map<string, KeyboardShortcut>;
  private listeners: Map<string, Set<ShortcutCallback>>;
  private globalListeners: Set<ShortcutCallback>;
  private isInitialized: boolean;

  constructor() {
    this.shortcuts = new Map();
    this.listeners = new Map();
    this.globalListeners = new Set();
    this.isInitialized = false;
  }

  /**
   * Initialise le service avec les raccourcis par défaut et personnalisés
   */
  initialize(): void {
    if (this.isInitialized) return;

    // Charger les raccourcis par défaut
    DEFAULT_SHORTCUTS.forEach((shortcut) => {
      this.shortcuts.set(shortcut.id, { ...shortcut });
    });

    // Charger les personnalisations depuis le localStorage
    this.loadCustomShortcuts();

    this.isInitialized = true;
  }

  /**
   * Charge les raccourcis personnalisés depuis le stockage local
   */
  private loadCustomShortcuts(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const customShortcuts: Partial<KeyboardShortcut>[] = JSON.parse(saved);
        customShortcuts.forEach((custom) => {
          if (custom.id && this.shortcuts.has(custom.id)) {
            const existing = this.shortcuts.get(custom.id)!;
            if (existing.customizable) {
              this.shortcuts.set(custom.id, { ...existing, ...custom });
            }
          }
        });
      }
    } catch (error) {
      console.error('Erreur lors du chargement des raccourcis personnalisés:', error);
    }
  }

  /**
   * Sauvegarde les raccourcis personnalisés dans le stockage local
   */
  private saveCustomShortcuts(): void {
    try {
      const customShortcuts: Partial<KeyboardShortcut>[] = [];
      this.shortcuts.forEach((shortcut, id) => {
        const defaultShortcut = DEFAULT_SHORTCUTS.find((s) => s.id === id);
        if (defaultShortcut && shortcut.customizable) {
          // Ne sauvegarder que les différences par rapport aux valeurs par défaut
          const diff: Partial<KeyboardShortcut> = { id };
          if (JSON.stringify(shortcut.keys) !== JSON.stringify(defaultShortcut.keys)) {
            diff.keys = shortcut.keys;
          }
          if (shortcut.enabled !== defaultShortcut.enabled) {
            diff.enabled = shortcut.enabled;
          }
          if (Object.keys(diff).length > 1) {
            customShortcuts.push(diff);
          }
        }
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customShortcuts));
    } catch (error) {
      console.error('Erreur lors de la sauvegarde des raccourcis personnalisés:', error);
    }
  }

  /**
   * Récupère tous les raccourcis
   */
  getAllShortcuts(): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * Récupère un raccourci par son ID
   */
  getShortcut(id: string): KeyboardShortcut | undefined {
    return this.shortcuts.get(id);
  }

  /**
   * Récupère les raccourcis par catégorie
   */
  getShortcutsByCategory(category: ShortcutCategory): KeyboardShortcut[] {
    return this.getAllShortcuts().filter((s) => s.category === category);
  }

  /**
   * Met à jour les touches d'un raccourci
   */
  updateShortcutKeys(id: string, keys: string[]): boolean {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut || !shortcut.customizable) {
      return false;
    }

    // Vérifier si les nouvelles touches ne sont pas déjà utilisées
    const keysString = this.normalizeKeys(keys).join('+');
    for (const [otherId, otherShortcut] of this.shortcuts) {
      if (otherId !== id && otherShortcut.enabled) {
        const otherKeysString = this.normalizeKeys(otherShortcut.keys).join('+');
        if (keysString === otherKeysString) {
          return false; // Conflit de touches
        }
      }
    }

    shortcut.keys = this.normalizeKeys(keys);
    this.saveCustomShortcuts();
    return true;
  }

  /**
   * Active ou désactive un raccourci
   */
  toggleShortcut(id: string, enabled: boolean): boolean {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut) {
      return false;
    }

    shortcut.enabled = enabled;
    this.saveCustomShortcuts();
    return true;
  }

  /**
   * Réinitialise un raccourci à sa valeur par défaut
   */
  resetShortcut(id: string): boolean {
    const defaultShortcut = DEFAULT_SHORTCUTS.find((s) => s.id === id);
    if (!defaultShortcut) {
      return false;
    }

    this.shortcuts.set(id, { ...defaultShortcut });
    this.saveCustomShortcuts();
    return true;
  }

  /**
   * Réinitialise tous les raccourcis aux valeurs par défaut
   */
  resetAllShortcuts(): void {
    this.shortcuts.clear();
    DEFAULT_SHORTCUTS.forEach((shortcut) => {
      this.shortcuts.set(shortcut.id, { ...shortcut });
    });
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Normalise les touches (ordre standard: Ctrl, Alt, Shift, puis la touche)
   */
  private normalizeKeys(keys: string[]): string[] {
    const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'];
    const mods: string[] = [];
    const others: string[] = [];

    keys.forEach((key) => {
      const normalized = this.normalizeKeyName(key);
      if (modifiers.includes(normalized)) {
        if (!mods.includes(normalized)) {
          mods.push(normalized);
        }
      } else {
        others.push(normalized);
      }
    });

    // Trier les modificateurs dans l'ordre standard
    mods.sort((a, b) => modifiers.indexOf(a) - modifiers.indexOf(b));

    return [...mods, ...others];
  }

  /**
   * Normalise le nom d'une touche
   */
  private normalizeKeyName(key: string): string {
    const keyMap: Record<string, string> = {
      control: 'Ctrl',
      ctrl: 'Ctrl',
      alt: 'Alt',
      shift: 'Shift',
      meta: 'Meta',
      cmd: 'Meta',
      command: 'Meta',
      escape: 'Escape',
      esc: 'Escape',
      enter: 'Enter',
      return: 'Enter',
      space: 'Space',
      ' ': 'Space',
      arrowup: 'Up',
      arrowdown: 'Down',
      arrowleft: 'Left',
      arrowright: 'Right',
      backspace: 'Backspace',
      delete: 'Delete',
      tab: 'Tab',
      home: 'Home',
      end: 'End',
      pageup: 'PageUp',
      pagedown: 'PageDown',
    };

    const lower = key.toLowerCase();
    if (keyMap[lower]) {
      return keyMap[lower];
    }

    // Capitaliser la première lettre pour les touches simples
    return key.length === 1 ? key.toUpperCase() : key;
  }

  /**
   * Touche principale d'un événement. Quand Alt participe au combo, event.key
   * est composé par la disposition (Option macOS → '∑', AZERTY → 'é') : on
   * repasse par le code physique pour que Alt+lettre/chiffre matche partout.
   */
  mainKeyFromEvent(event: KeyboardEvent): string {
    if (event.altKey) {
      const { code } = event;
      if (code.startsWith('Key')) return code.slice(3);
      if (code.startsWith('Digit')) return code.slice(5);
    }
    return this.normalizeKeyName(event.key);
  }

  /**
   * Vérifie si un événement clavier correspond à un raccourci
   */
  matchShortcut(event: KeyboardEvent): KeyboardShortcut | undefined {
    const pressedKeys: string[] = [];

    if (event.ctrlKey || event.metaKey) pressedKeys.push('Ctrl');
    if (event.altKey) pressedKeys.push('Alt');
    if (event.shiftKey) pressedKeys.push('Shift');

    // Ajouter la touche principale
    const key = this.mainKeyFromEvent(event);
    if (!['Ctrl', 'Alt', 'Shift', 'Meta', 'Control'].includes(key)) {
      pressedKeys.push(key);
    }

    const pressedString = pressedKeys.join('+');

    for (const shortcut of this.shortcuts.values()) {
      if (!shortcut.enabled) continue;

      const shortcutString = this.normalizeKeys(shortcut.keys).join('+');
      if (pressedString === shortcutString) {
        return shortcut;
      }
    }

    return undefined;
  }

  /**
   * Ajoute un écouteur pour un raccourci spécifique
   */
  on(shortcutId: string, callback: ShortcutCallback): () => void {
    if (!this.listeners.has(shortcutId)) {
      this.listeners.set(shortcutId, new Set());
    }
    this.listeners.get(shortcutId)!.add(callback);

    // Retourner une fonction de nettoyage
    return () => {
      this.listeners.get(shortcutId)?.delete(callback);
    };
  }

  /**
   * Ajoute un écouteur global pour tous les raccourcis
   */
  onAny(callback: ShortcutCallback): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /**
   * Déclenche les callbacks pour un raccourci
   */
  trigger(shortcut: KeyboardShortcut): void {
    const event: ShortcutEvent = {
      shortcutId: shortcut.id,
      action: shortcut.action,
      timestamp: Date.now(),
    };

    // Déclencher les écouteurs spécifiques
    const listeners = this.listeners.get(shortcut.id);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error(`Erreur dans le callback du raccourci ${shortcut.id}:`, error);
        }
      });
    }

    // Déclencher les écouteurs globaux
    this.globalListeners.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error('Erreur dans un callback global de raccourci:', error);
      }
    });
  }

  /**
   * Formate les touches pour l'affichage
   */
  formatKeys(keys: string[]): string {
    return keys
      .map((key) => {
        // Symboles spéciaux pour certaines touches
        const symbols: Record<string, string> = {
          Ctrl: '⌃',
          Alt: '⌥',
          Shift: '⇧',
          Meta: '⌘',
          Enter: '↵',
          Escape: 'Esc',
          Backspace: '⌫',
          Delete: 'Del',
          Up: '↑',
          Down: '↓',
          Left: '←',
          Right: '→',
          Space: '␣',
        };

        return symbols[key] || key;
      })
      .join(' + ');
  }

  /**
   * Récupère les catégories disponibles
   */
  getCategories(): { id: ShortcutCategory; name: string }[] {
    return [
      { id: 'navigation', name: i18n.t('shortcuts.categories.navigation') },
      { id: 'file', name: i18n.t('shortcuts.categories.file') },
      { id: 'folder', name: i18n.t('shortcuts.categories.folder') },
      { id: 'edit', name: i18n.t('shortcuts.categories.edit') },
      { id: 'view', name: i18n.t('shortcuts.categories.view') },
      { id: 'search', name: i18n.t('shortcuts.categories.search') },
      { id: 'system', name: i18n.t('shortcuts.categories.system') },
    ];
  }

  /**
   * Vérifie s'il y a un conflit avec un autre raccourci
   */
  hasConflict(id: string, keys: string[]): KeyboardShortcut | undefined {
    const keysString = this.normalizeKeys(keys).join('+');

    for (const [otherId, otherShortcut] of this.shortcuts) {
      if (otherId !== id && otherShortcut.enabled) {
        const otherKeysString = this.normalizeKeys(otherShortcut.keys).join('+');
        if (keysString === otherKeysString) {
          return otherShortcut;
        }
      }
    }

    return undefined;
  }
}

// Instance singleton du service
const shortcutsService = new ShortcutsService();

// Initialiser le service
shortcutsService.initialize();

export default shortcutsService;
export { shortcutsService, DEFAULT_SHORTCUTS };
