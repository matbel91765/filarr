# Dropdown Components

Système complet de composants Dropdown/Select pour l'application Filarr.

## Composants

- **Select** - Select classique avec support single/multi-select
- **Dropdown** - Menu dropdown pour actions
- **Combobox** - Select avec recherche avancée, async et création d'options

## Installation

```tsx
import { Select, Dropdown, Combobox } from '@/renderer/components/ui/Dropdown';
```

## Exemples d'utilisation

### Select simple

```tsx
import { Select } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function Example() {
  const [value, setValue] = useState('');

  const options = [
    { value: 'documents', label: 'Documents' },
    { value: 'images', label: 'Images' },
    { value: 'videos', label: 'Vidéos' },
  ];

  return (
    <Select
      label="Catégorie"
      options={options}
      value={value}
      onChange={setValue}
      placeholder="Sélectionner une catégorie"
    />
  );
}
```

### Multi-select avec recherche

```tsx
import { Select } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function Example() {
  const [values, setValues] = useState(['react', 'vue']);

  const options = [
    { value: 'react', label: 'React' },
    { value: 'vue', label: 'Vue.js' },
    { value: 'angular', label: 'Angular' },
    { value: 'svelte', label: 'Svelte' },
  ];

  return (
    <Select
      label="Frameworks"
      options={options}
      value={values}
      onChange={setValues}
      placeholder="Rechercher des frameworks..."
      multiple
      searchable
    />
  );
}
```

### Dropdown menu d'actions

```tsx
import { Dropdown } from '@/renderer/components/ui/Dropdown';

const EditIcon = () => <svg>...</svg>;
const TrashIcon = () => <svg>...</svg>;
const MoreIcon = () => <svg>...</svg>;

function Example() {
  return (
    <Dropdown
      trigger={
        <button>
          <MoreIcon />
        </button>
      }
      items={[
        {
          label: 'Modifier',
          icon: <EditIcon />,
          onClick: () => console.log('Modifier')
        },
        {
          label: 'Partager',
          icon: <ShareIcon />,
          onClick: () => console.log('Partager'),
          divider: true
        },
        {
          label: 'Supprimer',
          icon: <TrashIcon />,
          onClick: () => console.log('Supprimer'),
          danger: true
        },
      ]}
      position="bottom-right"
    />
  );
}
```

### Combobox avec recherche asynchrone

```tsx
import { Combobox } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function Example() {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState([]);

  const handleSearch = async (query: string) => {
    setLoading(true);
    try {
      const results = await searchAPI(query);
      setOptions(results);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Combobox
      label="Rechercher"
      options={options}
      value={value}
      onChange={setValue}
      onSearch={handleSearch}
      loading={loading}
      placeholder="Rechercher..."
    />
  );
}
```

### Combobox créable

```tsx
import { Combobox } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function Example() {
  const [value, setValue] = useState('');
  const [options, setOptions] = useState([
    { value: 'tag1', label: 'Tag 1' },
    { value: 'tag2', label: 'Tag 2' },
  ]);

  const handleCreate = (newTag: string) => {
    const newOption = {
      value: newTag.toLowerCase(),
      label: newTag,
    };
    setOptions([...options, newOption]);
    setValue(newOption.value);
  };

  return (
    <Combobox
      label="Tags"
      options={options}
      value={value}
      onChange={setValue}
      onCreate={handleCreate}
      creatable
      placeholder="Rechercher ou créer..."
    />
  );
}
```

## Props

### Select Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `SelectOption[]` | - | Options disponibles |
| `value` | `string \| string[]` | - | Valeur sélectionnée |
| `onChange` | `(value: string \| string[]) => void` | - | Callback lors du changement |
| `placeholder` | `string` | `'Sélectionner...'` | Placeholder |
| `label` | `string` | - | Label du champ |
| `error` | `string` | - | Message d'erreur |
| `helperText` | `string` | - | Message d'aide |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Taille |
| `variant` | `'default' \| 'filled' \| 'outlined'` | `'default'` | Variante |
| `disabled` | `boolean` | `false` | Désactivé |
| `required` | `boolean` | `false` | Requis |
| `multiple` | `boolean` | `false` | Multi-select |
| `searchable` | `boolean` | `false` | Activer la recherche |
| `fullWidth` | `boolean` | `false` | Pleine largeur |

### Dropdown Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `trigger` | `ReactNode` | - | Élément déclencheur |
| `items` | `DropdownItem[]` | - | Items du menu |
| `position` | `'bottom-left' \| 'bottom-right' \| 'top-left' \| 'top-right'` | `'bottom-left'` | Position |
| `closeOnSelect` | `boolean` | `true` | Fermer au clic |
| `disabled` | `boolean` | `false` | Désactivé |

### Combobox Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `ComboboxOption[]` | - | Options disponibles |
| `value` | `string \| string[]` | - | Valeur sélectionnée |
| `onChange` | `(value: string \| string[]) => void` | - | Callback lors du changement |
| `onSearch` | `(query: string) => void` | - | Callback lors de la recherche |
| `placeholder` | `string` | `'Rechercher...'` | Placeholder |
| `label` | `string` | - | Label du champ |
| `error` | `string` | - | Message d'erreur |
| `loading` | `boolean` | `false` | État de chargement |
| `creatable` | `boolean` | `false` | Permettre la création |
| `onCreate` | `(value: string) => void` | - | Callback lors de la création |
| `multiple` | `boolean` | `false` | Multi-select |

## Features

- **Keyboard Navigation** - Navigation complète au clavier (Arrow Up/Down, Enter, Esc, Tab)
- **Click Outside** - Fermeture automatique au clic extérieur
- **Portal Rendering** - Dropdown rendu via portal pour éviter les problèmes de z-index
- **Accessibility** - Support complet ARIA (role, aria-expanded, aria-selected, etc.)
- **Dark Mode** - Support natif du mode sombre
- **Responsive** - Adaptatif aux petits écrans
- **Animations** - Transitions fluides et animées
- **Customizable** - Variantes et tailles multiples
- **Icons Support** - Support des icônes dans les options
- **Disabled Options** - Support des options désactivées
- **Loading State** - État de chargement pour async
- **Creatable** - Création de nouvelles options
- **Multi-select** - Support multi-sélection avec tags
- **Search** - Recherche/filtre intégré

## Raccourcis clavier

### Select / Combobox

- `Enter` / `Space` - Ouvrir le dropdown / Sélectionner l'option focusée
- `Escape` - Fermer le dropdown
- `Arrow Down` - Naviguer vers le bas
- `Arrow Up` - Naviguer vers le haut
- `Tab` - Fermer et passer au champ suivant
- `Backspace` (Combobox multi) - Supprimer le dernier tag

### Dropdown

- `Enter` / `Space` - Ouvrir le menu
- `Escape` - Fermer le menu

## Styles

Les composants utilisent les tokens CSS du design system :

- **Colors** - `--color-primary-*`, `--color-surface-*`, `--color-text-*`
- **Spacing** - `--spacing-*`
- **Shadows** - `--shadow-dropdown`, `--shadow-focus`
- **Transitions** - `--transition-dropdown`, `--transition-color`
- **Radius** - `--radius-dropdown`, `--radius-input`
- **Z-index** - `--z-index-dropdown`

## Accessibilité

- Attributs ARIA appropriés
- Support complet du clavier
- Focus visible
- Labels associés
- Messages d'erreur annoncés
- Disabled states
- Required fields

## Dark Mode

Les composants s'adaptent automatiquement au thème sombre via `[data-theme="dark"]`.
