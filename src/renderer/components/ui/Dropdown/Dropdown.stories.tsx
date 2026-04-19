/**
 * Dropdown Stories
 *
 * Storybook stories pour les composants Select, Dropdown et Combobox
 */

import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Select } from './Select';
import { Dropdown } from './Dropdown';
import { Combobox } from './Combobox';

// Icons pour les exemples
const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M2 4.5C2 3.67157 2.67157 3 3.5 3H6L7 5H12.5C13.3284 5 14 5.67157 14 6.5V11.5C14 12.3284 13.3284 13 12.5 13H3.5C2.67157 13 2 12.3284 2 11.5V4.5Z" fill="currentColor"/>
  </svg>
);

const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M9 2H4C3.44772 2 3 2.44772 3 3V13C3 13.5523 3.44772 14 4 14H12C12.5523 14 13 13.5523 13 13V6L9 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 2V6H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M3 13C3 10.7909 4.79086 9 7 9H9C11.2091 9 13 10.7909 13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10Z" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M13 8C13 8.34 12.98 8.67 12.94 9L14.46 10.17C14.59 10.27 14.62 10.46 14.54 10.61L13.12 13.39C13.04 13.54 12.85 13.6 12.69 13.54L10.93 12.8C10.57 13.07 10.18 13.3 9.75 13.47L9.5 15.36C9.47 15.52 9.33 15.64 9.17 15.64H6.33C6.17 15.64 6.03 15.52 6 15.36L5.75 13.47C5.32 13.3 4.93 13.07 4.57 12.8L2.81 13.54C2.65 13.6 2.46 13.54 2.38 13.39L0.96 10.61C0.88 10.46 0.91 10.27 1.04 10.17L2.56 9C2.52 8.67 2.5 8.34 2.5 8C2.5 7.66 2.52 7.33 2.56 7L1.04 5.83C0.91 5.73 0.88 5.54 0.96 5.39L2.38 2.61C2.46 2.46 2.65 2.4 2.81 2.46L4.57 3.2C4.93 2.93 5.32 2.7 5.75 2.53L6 0.64C6.03 0.48 6.17 0.36 6.33 0.36H9.17C9.33 0.36 9.47 0.48 9.5 0.64L9.75 2.53C10.18 2.7 10.57 2.93 10.93 3.2L12.69 2.46C12.85 2.4 13.04 2.46 13.12 2.61L14.54 5.39C14.62 5.54 14.59 5.73 14.46 5.83L12.94 7C12.98 7.33 13 7.66 13 8Z" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M11.5 2L14 4.5L5.5 13H3V10.5L11.5 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M3 4H13M5 4V3C5 2.44772 5.44772 2 6 2H10C10.5523 2 11 2.44772 11 3V4M6.5 7V11M9.5 7V11M4 4H12V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 3V11M8 11L11 8M8 11L5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M5 8C5 8 5 6 8 6C11 6 11 8 11 8C11 8 11 10 8 10C5 10 5 8 5 8Z" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M11 8L14 6V10L11 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 8L2 6V10L5 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const MoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="4" r="1.5" fill="currentColor"/>
    <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
    <circle cx="10" cy="16" r="1.5" fill="currentColor"/>
  </svg>
);

// Options pour les exemples
const sampleOptions = [
  { value: 'react', label: 'React', icon: <FileIcon /> },
  { value: 'vue', label: 'Vue.js', icon: <FileIcon /> },
  { value: 'angular', label: 'Angular', icon: <FileIcon /> },
  { value: 'svelte', label: 'Svelte', icon: <FileIcon /> },
  { value: 'solid', label: 'SolidJS', icon: <FileIcon /> },
];

const categoryOptions = [
  { value: 'documents', label: 'Documents', icon: <FolderIcon /> },
  { value: 'images', label: 'Images', icon: <FolderIcon /> },
  { value: 'videos', label: 'Vidéos', icon: <FolderIcon /> },
  { value: 'music', label: 'Musique', icon: <FolderIcon /> },
  { value: 'archives', label: 'Archives', icon: <FolderIcon /> },
];

const userOptions = [
  { value: 'alice', label: 'Alice Martin', icon: <UserIcon /> },
  { value: 'bob', label: 'Bob Dupont', icon: <UserIcon /> },
  { value: 'charlie', label: 'Charlie Bernard', icon: <UserIcon /> },
  { value: 'diana', label: 'Diana Petit', icon: <UserIcon />, disabled: true },
  { value: 'evan', label: 'Evan Moreau', icon: <UserIcon /> },
];

// ===== Select Stories =====

const meta: Meta<typeof Select> = {
  title: 'UI/Dropdown/Select',
  component: Select,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState<string>('');
    return (
      <div style={{ width: '300px' }}>
        <Select
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
          placeholder="Sélectionner un framework"
        />
      </div>
    );
  },
};

export const WithLabel: Story = {
  render: () => {
    const [value, setValue] = useState<string>('react');
    return (
      <div style={{ width: '300px' }}>
        <Select
          label="Framework préféré"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
          placeholder="Sélectionner un framework"
          required
        />
      </div>
    );
  },
};

export const WithError: Story = {
  render: () => {
    const [value, setValue] = useState<string>('');
    return (
      <div style={{ width: '300px' }}>
        <Select
          label="Framework"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
          placeholder="Sélectionner un framework"
          error="Veuillez sélectionner un framework"
          required
        />
      </div>
    );
  },
};

export const WithHelperText: Story = {
  render: () => {
    const [value, setValue] = useState<string>('');
    return (
      <div style={{ width: '300px' }}>
        <Select
          label="Catégorie"
          options={categoryOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
          placeholder="Sélectionner une catégorie"
          helperText="Choisissez la catégorie du fichier"
        />
      </div>
    );
  },
};

export const Searchable: Story = {
  render: () => {
    const [value, setValue] = useState<string>('');
    return (
      <div style={{ width: '300px' }}>
        <Select
          label="Rechercher un framework"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
          placeholder="Rechercher..."
          searchable
        />
      </div>
    );
  },
};

export const MultiSelect: Story = {
  render: () => {
    const [value, setValue] = useState<string[]>(['react', 'vue']);
    return (
      <div style={{ width: '400px' }}>
        <Select
          label="Frameworks"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string[])}
          placeholder="Sélectionner des frameworks"
          multiple
        />
      </div>
    );
  },
};

export const MultiSelectSearchable: Story = {
  render: () => {
    const [value, setValue] = useState<string[]>(['alice', 'bob']);
    return (
      <div style={{ width: '400px' }}>
        <Select
          label="Membres de l'équipe"
          options={userOptions}
          value={value}
          onChange={(val) => setValue(val as string[])}
          placeholder="Rechercher des membres..."
          multiple
          searchable
        />
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => {
    return (
      <div style={{ width: '300px' }}>
        <Select
          label="Framework"
          options={sampleOptions}
          value="react"
          placeholder="Sélectionner un framework"
          disabled
        />
      </div>
    );
  },
};

export const Sizes: Story = {
  render: () => {
    const [value, setValue] = useState<string>('react');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '300px' }}>
        <Select
          label="Small"
          size="sm"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
        />
        <Select
          label="Medium (default)"
          size="md"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
        />
        <Select
          label="Large"
          size="lg"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
        />
      </div>
    );
  },
};

export const Variants: Story = {
  render: () => {
    const [value, setValue] = useState<string>('react');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '300px' }}>
        <Select
          label="Default"
          variant="default"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
        />
        <Select
          label="Filled"
          variant="filled"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
        />
        <Select
          label="Outlined"
          variant="outlined"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
        />
      </div>
    );
  },
};

// ===== Dropdown Stories =====

export const DropdownBasic: StoryObj<typeof Dropdown> = {
  render: () => {
    return (
      <Dropdown
        trigger={
          <button style={{ padding: '8px', border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <MoreIcon />
          </button>
        }
        items={[
          { label: 'Modifier', icon: <EditIcon />, onClick: () => alert('Modifier') },
          { label: 'Télécharger', icon: <DownloadIcon />, onClick: () => alert('Télécharger') },
          { label: 'Partager', icon: <ShareIcon />, onClick: () => alert('Partager'), divider: true },
          { label: 'Supprimer', icon: <TrashIcon />, onClick: () => alert('Supprimer'), danger: true },
        ]}
      />
    );
  },
};

export const DropdownPositions: StoryObj<typeof Dropdown> = {
  render: () => {
    return (
      <div style={{ display: 'flex', gap: '48px', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
          <Dropdown
            position="bottom-left"
            trigger={<button style={{ padding: '8px 16px' }}>Bottom Left</button>}
            items={[
              { label: 'Option 1', onClick: () => {} },
              { label: 'Option 2', onClick: () => {} },
              { label: 'Option 3', onClick: () => {} },
            ]}
          />
          <Dropdown
            position="top-left"
            trigger={<button style={{ padding: '8px 16px' }}>Top Left</button>}
            items={[
              { label: 'Option 1', onClick: () => {} },
              { label: 'Option 2', onClick: () => {} },
              { label: 'Option 3', onClick: () => {} },
            ]}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
          <Dropdown
            position="bottom-right"
            trigger={<button style={{ padding: '8px 16px' }}>Bottom Right</button>}
            items={[
              { label: 'Option 1', onClick: () => {} },
              { label: 'Option 2', onClick: () => {} },
              { label: 'Option 3', onClick: () => {} },
            ]}
          />
          <Dropdown
            position="top-right"
            trigger={<button style={{ padding: '8px 16px' }}>Top Right</button>}
            items={[
              { label: 'Option 1', onClick: () => {} },
              { label: 'Option 2', onClick: () => {} },
              { label: 'Option 3', onClick: () => {} },
            ]}
          />
        </div>
      </div>
    );
  },
};

export const DropdownWithIcons: StoryObj<typeof Dropdown> = {
  render: () => {
    return (
      <Dropdown
        trigger={<button style={{ padding: '8px 16px' }}>Actions</button>}
        items={[
          { label: 'Paramètres', icon: <SettingsIcon />, onClick: () => {} },
          { label: 'Profil', icon: <UserIcon />, onClick: () => {} },
          { label: 'Fichiers', icon: <FileIcon />, onClick: () => {}, divider: true },
          { label: 'Déconnexion', icon: <TrashIcon />, onClick: () => {}, danger: true },
        ]}
      />
    );
  },
};

export const DropdownDisabled: StoryObj<typeof Dropdown> = {
  render: () => {
    return (
      <Dropdown
        trigger={<button style={{ padding: '8px 16px' }}>Actions</button>}
        items={[
          { label: 'Option 1', onClick: () => {} },
          { label: 'Option 2 (disabled)', onClick: () => {}, disabled: true },
          { label: 'Option 3', onClick: () => {} },
        ]}
      />
    );
  },
};

// ===== Combobox Stories =====

export const ComboboxBasic: StoryObj<typeof Combobox> = {
  render: () => {
    const [value, setValue] = useState<string>('');
    return (
      <div style={{ width: '300px' }}>
        <Combobox
          label="Rechercher un framework"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
          placeholder="Rechercher..."
        />
      </div>
    );
  },
};

export const ComboboxWithLoading: StoryObj<typeof Combobox> = {
  render: () => {
    const [value, setValue] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [options, setOptions] = useState(sampleOptions);

    const handleSearch = (query: string) => {
      setLoading(true);
      // Simuler un appel API
      setTimeout(() => {
        setOptions(
          sampleOptions.filter(opt =>
            opt.label.toLowerCase().includes(query.toLowerCase())
          )
        );
        setLoading(false);
      }, 500);
    };

    return (
      <div style={{ width: '300px' }}>
        <Combobox
          label="Recherche asynchrone"
          options={options}
          value={value}
          onChange={(val) => setValue(val as string)}
          onSearch={handleSearch}
          placeholder="Rechercher..."
          loading={loading}
        />
      </div>
    );
  },
};

export const ComboboxCreatable: StoryObj<typeof Combobox> = {
  render: () => {
    const [value, setValue] = useState<string>('');
    const [options, setOptions] = useState(sampleOptions);

    const handleCreate = (newValue: string) => {
      const newOption = {
        value: newValue.toLowerCase().replace(/\s+/g, '-'),
        label: newValue,
        icon: <FileIcon />,
      };
      setOptions([...options, newOption]);
      setValue(newOption.value);
      alert(`Créé: ${newValue}`);
    };

    return (
      <div style={{ width: '300px' }}>
        <Combobox
          label="Framework (créable)"
          options={options}
          value={value}
          onChange={(val) => setValue(val as string)}
          onCreate={handleCreate}
          placeholder="Rechercher ou créer..."
          creatable
          helperText="Tapez pour créer une nouvelle option"
        />
      </div>
    );
  },
};

export const ComboboxMultiple: StoryObj<typeof Combobox> = {
  render: () => {
    const [value, setValue] = useState<string[]>(['react', 'vue']);
    return (
      <div style={{ width: '400px' }}>
        <Combobox
          label="Frameworks (multiple)"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string[])}
          placeholder="Rechercher..."
          multiple
        />
      </div>
    );
  },
};

export const ComboboxWithError: StoryObj<typeof Combobox> = {
  render: () => {
    const [value, setValue] = useState<string>('');
    return (
      <div style={{ width: '300px' }}>
        <Combobox
          label="Framework"
          options={sampleOptions}
          value={value}
          onChange={(val) => setValue(val as string)}
          placeholder="Rechercher..."
          error="Veuillez sélectionner un framework"
          required
        />
      </div>
    );
  },
};
