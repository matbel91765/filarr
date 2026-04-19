/**
 * ContextMenu Stories
 *
 * Exemples d'utilisation du composant ContextMenu
 */

import type { Meta, StoryObj } from '@storybook/react';
import { ContextMenu } from './ContextMenu';
import { useState } from 'react';

// Icônes SVG pour les exemples
const FolderOpenIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
  </svg>
);

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const meta: Meta<typeof ContextMenu> = {
  title: 'UI/ContextMenu',
  component: ContextMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Menu contextuel qui s\'affiche au clic droit sur un élément.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ContextMenu>;

// Wrapper pour tester le menu contextuel
const ContextMenuDemo = ({ menuItems }: { menuItems: any[] }) => {
  const [contextMenu, setContextMenu] = useState({ isOpen: false, x: 0, y: 0 });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ isOpen: true, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => {
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  return (
    <div style={{ padding: '100px', textAlign: 'center' }}>
      <div
        onContextMenu={handleContextMenu}
        style={{
          padding: '40px',
          border: '2px dashed #ccc',
          borderRadius: '8px',
          cursor: 'context-menu',
          background: '#f9fafb',
        }}
      >
        Faites un clic droit ici pour ouvrir le menu contextuel
      </div>

      {contextMenu.isOpen && (
        <ContextMenu
          items={menuItems}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
};

export const FolderMenu: Story = {
  render: () => (
    <ContextMenuDemo
      menuItems={[
        {
          label: 'Ouvrir',
          icon: <FolderOpenIcon />,
          onClick: () => alert('Ouvrir le dossier'),
        },
        {
          label: 'Renommer',
          icon: <EditIcon />,
          onClick: () => alert('Renommer le dossier'),
        },
        { divider: true },
        {
          label: 'Supprimer',
          icon: <TrashIcon />,
          onClick: () => alert('Supprimer le dossier'),
          danger: true,
          shortcut: 'Suppr',
        },
      ]}
    />
  ),
};

export const FileMenu: Story = {
  render: () => (
    <ContextMenuDemo
      menuItems={[
        {
          label: 'Télécharger',
          icon: <DownloadIcon />,
          onClick: () => alert('Télécharger le fichier'),
        },
        {
          label: 'Renommer',
          icon: <EditIcon />,
          onClick: () => alert('Renommer le fichier'),
        },
        { divider: true },
        {
          label: 'Supprimer',
          icon: <TrashIcon />,
          onClick: () => alert('Supprimer le fichier'),
          danger: true,
          shortcut: 'Suppr',
        },
      ]}
    />
  ),
};

export const WithDisabledItems: Story = {
  render: () => (
    <ContextMenuDemo
      menuItems={[
        {
          label: 'Ouvrir',
          icon: <FolderOpenIcon />,
          onClick: () => alert('Ouvrir'),
        },
        {
          label: 'Modifier',
          icon: <EditIcon />,
          onClick: () => alert('Modifier'),
          disabled: true,
        },
        { divider: true },
        {
          label: 'Supprimer',
          icon: <TrashIcon />,
          onClick: () => alert('Supprimer'),
          danger: true,
        },
      ]}
    />
  ),
};

export const WithShortcuts: Story = {
  render: () => (
    <ContextMenuDemo
      menuItems={[
        {
          label: 'Copier',
          onClick: () => alert('Copier'),
          shortcut: 'Ctrl+C',
        },
        {
          label: 'Coller',
          onClick: () => alert('Coller'),
          shortcut: 'Ctrl+V',
        },
        {
          label: 'Couper',
          onClick: () => alert('Couper'),
          shortcut: 'Ctrl+X',
        },
        { divider: true },
        {
          label: 'Supprimer',
          onClick: () => alert('Supprimer'),
          danger: true,
          shortcut: 'Suppr',
        },
      ]}
    />
  ),
};
