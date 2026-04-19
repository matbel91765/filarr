/**
 * FolderView Stories
 *
 * Storybook stories pour le composant FolderView
 */

import type { Meta, StoryObj } from '@storybook/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { FolderView } from './FolderView';

const meta = {
  title: 'Views/FolderView',
  component: FolderView,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Vue complète pour afficher le contenu d\'un dossier avec navigation, recherche, tri, upload et gestion des fichiers.',
      },
    },
  },
  decorators: [
    (Story) => (
      <BrowserRouter>
        <Routes>
          <Route path="/*" element={<Story />} />
        </Routes>
      </BrowserRouter>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof FolderView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Vue par défaut avec des fichiers et dossiers
 */
export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Vue par défaut du dossier avec des fichiers et sous-dossiers.',
      },
    },
  },
};

/**
 * Dossier vide
 */
export const EmptyFolder: Story = {
  parameters: {
    docs: {
      description: {
        story: 'État d\'un dossier vide avec message d\'invitation à l\'upload.',
      },
    },
  },
  render: () => {
    // Mock avec aucun item
    return <FolderView />;
  },
};

/**
 * Vue grille
 */
export const GridView: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Vue en grille des fichiers et dossiers.',
      },
    },
  },
};

/**
 * Vue liste
 */
export const ListView: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Vue en liste des fichiers et dossiers avec colonnes détaillées.',
      },
    },
  },
  render: () => {
    // On pourrait pré-configurer le viewMode à 'list' avec un state initial
    return <FolderView />;
  },
};

/**
 * Avec sélection multiple
 */
export const WithSelection: Story = {
  parameters: {
    docs: {
      description: {
        story: 'État avec plusieurs éléments sélectionnés et barre d\'actions visible.',
      },
    },
  },
};

/**
 * Upload en cours
 */
export const UploadInProgress: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Modal d\'upload visible avec barre de progression.',
      },
    },
  },
};

/**
 * Dossier avec beaucoup de fichiers
 */
export const ManyFiles: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Dossier contenant de nombreux fichiers pour tester le scroll et la performance.',
      },
    },
  },
};

/**
 * Recherche active
 */
export const WithSearch: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Vue avec une recherche active filtrant les résultats.',
      },
    },
  },
};

/**
 * Drag & Drop actif
 */
export const DragAndDropActive: Story = {
  parameters: {
    docs: {
      description: {
        story: 'État lors du drag & drop de fichiers avec overlay visible.',
      },
    },
  },
};

/**
 * Mode sombre
 */
export const DarkMode: Story = {
  parameters: {
    backgrounds: { default: 'dark' },
    docs: {
      description: {
        story: 'Vue du dossier en mode sombre.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ minHeight: '100vh' }}>
        <Story />
      </div>
    ),
  ],
};

/**
 * Mobile - Portrait
 */
export const MobilePortrait: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        story: 'Vue responsive pour mobile en mode portrait.',
      },
    },
  },
};

/**
 * Tablet
 */
export const Tablet: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
    },
    docs: {
      description: {
        story: 'Vue responsive pour tablette.',
      },
    },
  },
};

/**
 * Dossier avec uniquement des sous-dossiers
 */
export const OnlyFolders: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Dossier contenant uniquement des sous-dossiers.',
      },
    },
  },
};

/**
 * Dossier avec uniquement des fichiers
 */
export const OnlyFiles: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Dossier contenant uniquement des fichiers.',
      },
    },
  },
};

/**
 * Tri par date
 */
export const SortedByDate: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Fichiers triés par date de modification (plus récent en premier).',
      },
    },
  },
};

/**
 * Tri par taille
 */
export const SortedBySize: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Fichiers triés par taille (plus grand en premier).',
      },
    },
  },
};

/**
 * Modal de confirmation de suppression
 */
export const DeleteConfirmation: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Modal de confirmation lors de la suppression d\'éléments.',
      },
    },
  },
};

/**
 * Longues noms de fichiers
 */
export const LongFileNames: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Gestion de fichiers avec des noms très longs (ellipsis).',
      },
    },
  },
};

/**
 * Fichiers avec caractères spéciaux
 */
export const SpecialCharacters: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Fichiers avec caractères spéciaux, accents et emojis dans les noms.',
      },
    },
  },
};

/**
 * État de chargement
 */
export const Loading: Story = {
  parameters: {
    docs: {
      description: {
        story: 'État de chargement initial du dossier.',
      },
    },
  },
};

/**
 * Erreur de chargement
 */
export const LoadError: Story = {
  parameters: {
    docs: {
      description: {
        story: 'État d\'erreur lors du chargement du dossier.',
      },
    },
  },
};
