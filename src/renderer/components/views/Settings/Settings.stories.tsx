/**
 * Settings Stories
 *
 * Stories Storybook pour le composant Settings
 */

import type { Meta, StoryObj } from '@storybook/react';
import Settings from './Settings';
import { BrowserRouter } from 'react-router-dom';
import '../../ui/Button/Button.css';
import '../../ui/Card/Card.css';
import '../../ui/Modal/Modal.css';
import '../../ui/ProgressBar/ProgressBar.css';
import './Settings.css';

const meta: Meta<typeof Settings> = {
  title: 'Views/Settings',
  component: Settings,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <BrowserRouter>
        <div style={{ height: '100vh', padding: '20px' }}>
          <Story />
        </div>
      </BrowserRouter>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
Le composant Settings est une vue complète pour la configuration de l'application Filarr.

## Sections

### 1. Apparence
- **Toggle thème** : Basculer entre le mode clair et sombre
- **Couleur principale** : Sélectionner une couleur personnalisée pour l'interface

### 2. Langue
- **Sélection de langue** : Choisir entre Français et English
- Utilise i18next pour l'internationalisation

### 3. Notifications
- **Notifications desktop** : Activer/désactiver les notifications du système
- **Sons** : Activer/désactiver les sons de notification

### 4. Stockage
- **Barre de progression** : Affiche l'utilisation du stockage
- **Chemin de stockage** : Affiche l'emplacement des données
- **Vider le cache** : Supprime les fichiers temporaires avec confirmation

### 5. À propos
- **Version** : Affiche la version de l'application
- **Crédits** : Informations sur l'équipe de développement
- **Licence** : Informations de licence

## Fonctionnalités

- **Sauvegarde automatique** : Les paramètres sont sauvegardés dans localStorage
- **Effet immédiat** : Le changement de thème est appliqué instantanément
- **Confirmation** : Modal de confirmation pour les actions critiques
- **Responsive** : Layout adaptatif (2 colonnes desktop, 1 colonne mobile)
- **Dark mode** : Support complet avec tokens CSS
- **Accessibilité** : Navigation clavier, focus visible, labels appropriés

## Interactions Redux

Le composant utilise le hook \`useUI\` pour gérer le thème :
- \`theme\` : Thème actuel ('light' ou 'dark')
- \`changeTheme(newTheme)\` : Changer le thème

## Persistence

Les paramètres sont persistés dans localStorage sous la clé \`filarr-settings\` :
\`\`\`json
{
  "theme": "dark",
  "primaryColor": "#87CEEB",
  "language": "fr",
  "notificationsEnabled": true,
  "soundEnabled": true,
  "storagePath": "C:/Users/Username/AppData/Local/Filarr",
  "storageUsed": 450,
  "storageTotal": 1000
}
\`\`\`
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Settings>;

/**
 * Vue par défaut des paramètres
 */
export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Vue par défaut des paramètres avec toutes les sections.',
      },
    },
  },
};

/**
 * Paramètres en mode sombre
 */
export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <div data-theme="dark">
        <BrowserRouter>
          <div style={{ height: '100vh', padding: '20px', backgroundColor: '#0A0E1A' }}>
            <Story />
          </div>
        </BrowserRouter>
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Paramètres en mode sombre avec palette de couleurs adaptée.',
      },
    },
    backgrounds: {
      default: 'dark',
    },
  },
};

/**
 * Vue mobile des paramètres
 */
export const Mobile: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        story: 'Vue responsive des paramètres sur mobile (375px). Layout passe en 1 colonne, les contrôles s\'empilent.',
      },
    },
  },
};

/**
 * Vue tablet des paramètres
 */
export const Tablet: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
    },
    docs: {
      description: {
        story: 'Vue responsive des paramètres sur tablette (768px).',
      },
    },
  },
};

/**
 * Paramètres avec stockage presque plein
 */
export const StorageAlmostFull: Story = {
  decorators: [
    (Story) => {
      // Modifier le localStorage pour simuler un stockage presque plein
      const mockSettings = {
        theme: 'light',
        primaryColor: '#87CEEB',
        language: 'fr',
        notificationsEnabled: true,
        soundEnabled: true,
        storagePath: 'C:/Users/Username/AppData/Local/Filarr',
        storageUsed: 850,
        storageTotal: 1000
      };
      localStorage.setItem('filarr-settings', JSON.stringify(mockSettings));

      return (
        <BrowserRouter>
          <div style={{ height: '100vh', padding: '20px' }}>
            <Story />
          </div>
        </BrowserRouter>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story: 'Paramètres avec barre de progression du stockage en orange (85% utilisé).',
      },
    },
  },
};

/**
 * Paramètres avec stockage critique
 */
export const StorageCritical: Story = {
  decorators: [
    (Story) => {
      // Modifier le localStorage pour simuler un stockage critique
      const mockSettings = {
        theme: 'light',
        primaryColor: '#87CEEB',
        language: 'fr',
        notificationsEnabled: true,
        soundEnabled: true,
        storagePath: 'C:/Users/Username/AppData/Local/Filarr',
        storageUsed: 950,
        storageTotal: 1000
      };
      localStorage.setItem('filarr-settings', JSON.stringify(mockSettings));

      return (
        <BrowserRouter>
          <div style={{ height: '100vh', padding: '20px' }}>
            <Story />
          </div>
        </BrowserRouter>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story: 'Paramètres avec barre de progression du stockage en rouge (95% utilisé).',
      },
    },
  },
};

/**
 * Paramètres avec notifications désactivées
 */
export const NotificationsDisabled: Story = {
  decorators: [
    (Story) => {
      const mockSettings = {
        theme: 'light',
        primaryColor: '#87CEEB',
        language: 'fr',
        notificationsEnabled: false,
        soundEnabled: false,
        storagePath: 'C:/Users/Username/AppData/Local/Filarr',
        storageUsed: 450,
        storageTotal: 1000
      };
      localStorage.setItem('filarr-settings', JSON.stringify(mockSettings));

      return (
        <BrowserRouter>
          <div style={{ height: '100vh', padding: '20px' }}>
            <Story />
          </div>
        </BrowserRouter>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story: 'Paramètres avec notifications et sons désactivés.',
      },
    },
  },
};

/**
 * Paramètres en mode high contrast
 */
export const HighContrast: Story = {
  parameters: {
    a11y: {
      config: {
        rules: [
          {
            id: 'color-contrast',
            enabled: true,
          },
        ],
      },
    },
    docs: {
      description: {
        story: 'Paramètres avec contraste élevé pour l\'accessibilité. Les bordures sont plus épaisses.',
      },
    },
  },
};

/**
 * Paramètres sans animation (prefers-reduced-motion)
 */
export const ReducedMotion: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Paramètres sans animations pour les utilisateurs qui préfèrent un mouvement réduit.',
      },
    },
  },
};

/**
 * Interaction avec le thème
 */
export const ThemeInteraction: Story = {
  parameters: {
    docs: {
      description: {
        story: `
Démonstration de l'interaction avec le thème :

1. Cliquez sur le bouton "Clair" ou "Sombre" dans la section Apparence
2. Le thème change instantanément dans toute l'application
3. Le changement est persisté dans localStorage
4. Au prochain chargement, le thème choisi sera restauré
        `,
      },
    },
  },
};

/**
 * Interaction avec la couleur
 */
export const ColorInteraction: Story = {
  parameters: {
    docs: {
      description: {
        story: `
Démonstration de l'interaction avec la couleur principale :

1. Cliquez sur le sélecteur de couleur
2. Choisissez une nouvelle couleur
3. La couleur est appliquée à l'interface (custom property CSS)
4. Le changement est persisté dans localStorage
        `,
      },
    },
  },
};

/**
 * Interaction avec le cache
 */
export const ClearCacheInteraction: Story = {
  parameters: {
    docs: {
      description: {
        story: `
Démonstration de l'interaction pour vider le cache :

1. Cliquez sur le bouton "Vider le cache" dans la section Stockage
2. Une modal de confirmation apparaît
3. Cliquez sur "Vider le cache" pour confirmer ou "Annuler" pour abandonner
4. Si confirmé, le stockage utilisé est réinitialisé à 0 Mo
        `,
      },
    },
  },
};
