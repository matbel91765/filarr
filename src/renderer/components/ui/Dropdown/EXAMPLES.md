# Exemples d'utilisation - Dropdown Components

## Table des matières
- [Select Simple](#select-simple)
- [Select Multi](#select-multi)
- [Dropdown Menu](#dropdown-menu)
- [Combobox avec Recherche](#combobox-avec-recherche)
- [Exemples Avancés](#exemples-avancés)

---

## Select Simple

### Exemple basique
```tsx
import { Select } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function CategorySelect() {
  const [category, setCategory] = useState('');

  return (
    <Select
      label="Catégorie"
      placeholder="Sélectionner une catégorie"
      options={[
        { value: 'docs', label: 'Documents' },
        { value: 'images', label: 'Images' },
        { value: 'videos', label: 'Vidéos' },
        { value: 'music', label: 'Musique' },
      ]}
      value={category}
      onChange={setCategory}
    />
  );
}
```

### Avec icônes et validation
```tsx
import { Select } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

const FolderIcon = () => <svg>...</svg>;

function FolderSelect() {
  const [folder, setFolder] = useState('');
  const [error, setError] = useState('');

  const handleChange = (value: string) => {
    setFolder(value);
    setError(''); // Clear error on change
  };

  const handleSubmit = () => {
    if (!folder) {
      setError('Veuillez sélectionner un dossier');
      return;
    }
    // Process...
  };

  return (
    <div>
      <Select
        label="Dossier de destination"
        placeholder="Choisir un dossier"
        options={[
          { value: 'personal', label: 'Personnel', icon: <FolderIcon /> },
          { value: 'work', label: 'Travail', icon: <FolderIcon /> },
          { value: 'shared', label: 'Partagé', icon: <FolderIcon /> },
        ]}
        value={folder}
        onChange={handleChange}
        error={error}
        required
      />
      <button onClick={handleSubmit}>Valider</button>
    </div>
  );
}
```

---

## Select Multi

### Multi-sélection avec tags
```tsx
import { Select } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function TagsSelect() {
  const [selectedTags, setSelectedTags] = useState<string[]>(['urgent', 'work']);

  return (
    <Select
      label="Tags"
      placeholder="Sélectionner des tags"
      options={[
        { value: 'urgent', label: 'Urgent' },
        { value: 'work', label: 'Travail' },
        { value: 'personal', label: 'Personnel' },
        { value: 'archive', label: 'Archive' },
        { value: 'shared', label: 'Partagé' },
      ]}
      value={selectedTags}
      onChange={setSelectedTags}
      multiple
      searchable
      helperText="Utilisez la recherche pour filtrer les tags"
    />
  );
}
```

### Multi-select avec limite
```tsx
import { Select } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function LimitedSelect() {
  const [members, setMembers] = useState<string[]>([]);
  const MAX_MEMBERS = 3;

  const handleChange = (newValue: string[]) => {
    if (newValue.length <= MAX_MEMBERS) {
      setMembers(newValue);
    }
  };

  return (
    <Select
      label="Membres de l'équipe"
      placeholder="Sélectionner jusqu'à 3 membres"
      options={[
        { value: 'alice', label: 'Alice Martin' },
        { value: 'bob', label: 'Bob Dupont' },
        { value: 'charlie', label: 'Charlie Bernard' },
        { value: 'diana', label: 'Diana Petit' },
      ]}
      value={members}
      onChange={handleChange}
      multiple
      helperText={`${members.length}/${MAX_MEMBERS} membres sélectionnés`}
    />
  );
}
```

---

## Dropdown Menu

### Menu d'actions simple
```tsx
import { Dropdown } from '@/renderer/components/ui/Dropdown';

const EditIcon = () => <svg width="16" height="16">...</svg>;
const DownloadIcon = () => <svg width="16" height="16">...</svg>;
const ShareIcon = () => <svg width="16" height="16">...</svg>;
const TrashIcon = () => <svg width="16" height="16">...</svg>;
const MoreIcon = () => <svg width="20" height="20">...</svg>;

function FileActions({ fileId }: { fileId: string }) {
  const handleEdit = () => console.log('Edit', fileId);
  const handleDownload = () => console.log('Download', fileId);
  const handleShare = () => console.log('Share', fileId);
  const handleDelete = () => {
    if (confirm('Supprimer ce fichier ?')) {
      console.log('Delete', fileId);
    }
  };

  return (
    <Dropdown
      trigger={
        <button className="icon-button">
          <MoreIcon />
        </button>
      }
      items={[
        { label: 'Modifier', icon: <EditIcon />, onClick: handleEdit },
        { label: 'Télécharger', icon: <DownloadIcon />, onClick: handleDownload },
        { label: 'Partager', icon: <ShareIcon />, onClick: handleShare, divider: true },
        { label: 'Supprimer', icon: <TrashIcon />, onClick: handleDelete, danger: true },
      ]}
      position="bottom-right"
    />
  );
}
```

### Menu avec sous-groupes
```tsx
import { Dropdown } from '@/renderer/components/ui/Dropdown';

function ContextMenu() {
  return (
    <Dropdown
      trigger={<button>Options</button>}
      items={[
        // Groupe 1: Actions principales
        { label: 'Ouvrir', onClick: () => {} },
        { label: 'Ouvrir dans un nouvel onglet', onClick: () => {}, divider: true },

        // Groupe 2: Actions d'édition
        { label: 'Couper', onClick: () => {} },
        { label: 'Copier', onClick: () => {} },
        { label: 'Coller', onClick: () => {}, disabled: true, divider: true },

        // Groupe 3: Actions dangereuses
        { label: 'Supprimer', onClick: () => {}, danger: true },
      ]}
    />
  );
}
```

---

## Combobox avec Recherche

### Recherche simple
```tsx
import { Combobox } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function SearchableSelect() {
  const [value, setValue] = useState('');

  return (
    <Combobox
      label="Rechercher un framework"
      placeholder="Tapez pour rechercher..."
      options={[
        { value: 'react', label: 'React' },
        { value: 'vue', label: 'Vue.js' },
        { value: 'angular', label: 'Angular' },
        { value: 'svelte', label: 'Svelte' },
        { value: 'solid', label: 'SolidJS' },
        { value: 'preact', label: 'Preact' },
        { value: 'qwik', label: 'Qwik' },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}
```

### Recherche asynchrone (API)
```tsx
import { Combobox } from '@/renderer/components/ui/Dropdown';
import { useState, useCallback } from 'react';

function AsyncSearch() {
  const [value, setValue] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async (query: string) => {
    if (!query) {
      setOptions([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${query}`);
      const data = await response.json();
      setOptions(data.results.map(item => ({
        value: item.id,
        label: item.name,
      })));
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Combobox
      label="Rechercher un utilisateur"
      placeholder="Tapez pour rechercher..."
      options={options}
      value={value}
      onChange={setValue}
      onSearch={handleSearch}
      loading={loading}
    />
  );
}
```

### Combobox créable (tags)
```tsx
import { Combobox } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function TagInput() {
  const [tags, setTags] = useState<string[]>(['react', 'typescript']);
  const [options, setOptions] = useState([
    { value: 'react', label: 'React' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'nodejs', label: 'Node.js' },
  ]);

  const handleCreate = (newTag: string) => {
    const newOption = {
      value: newTag.toLowerCase().replace(/\s+/g, '-'),
      label: newTag,
    };

    // Ajouter l'option à la liste
    setOptions([...options, newOption]);

    // Sélectionner automatiquement le nouveau tag
    setTags([...tags, newOption.value]);
  };

  return (
    <Combobox
      label="Technologies"
      placeholder="Rechercher ou créer..."
      options={options}
      value={tags}
      onChange={setTags}
      onCreate={handleCreate}
      multiple
      creatable
      helperText="Tapez et appuyez sur Entrée pour créer un nouveau tag"
    />
  );
}
```

---

## Exemples Avancés

### Select avec groupes d'options
```tsx
import { Select } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

function GroupedSelect() {
  const [value, setValue] = useState('');

  // Note: Pour implémenter les groupes, vous devrez étendre le composant
  // ou utiliser les dividers pour séparer visuellement les groupes

  const options = [
    // Frontend Frameworks
    { value: 'react', label: '⚛️ React' },
    { value: 'vue', label: '💚 Vue.js' },
    { value: 'angular', label: '🔴 Angular' },

    // Backend Frameworks
    { value: 'express', label: '🚂 Express' },
    { value: 'nestjs', label: '🐱 NestJS' },
    { value: 'fastify', label: '⚡ Fastify' },
  ];

  return (
    <Select
      label="Framework"
      placeholder="Sélectionner un framework"
      options={options}
      value={value}
      onChange={setValue}
      searchable
    />
  );
}
```

### Form complet avec validation
```tsx
import { Select, Combobox } from '@/renderer/components/ui/Dropdown';
import { useState } from 'react';

interface FormData {
  category: string;
  tags: string[];
  assignee: string;
}

function CompleteForm() {
  const [formData, setFormData] = useState<FormData>({
    category: '',
    tags: [],
    assignee: '',
  });

  const [errors, setErrors] = useState<Partial<FormData>>({});

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.category) {
      newErrors.category = 'La catégorie est requise';
    }

    if (formData.tags.length === 0) {
      newErrors.tags = 'Sélectionnez au moins un tag';
    }

    if (!formData.assignee) {
      newErrors.assignee = 'L\'assignation est requise';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (validate()) {
      console.log('Form submitted:', formData);
      // Process form...
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Select
        label="Catégorie"
        placeholder="Sélectionner une catégorie"
        options={[
          { value: 'bug', label: 'Bug' },
          { value: 'feature', label: 'Feature' },
          { value: 'improvement', label: 'Amélioration' },
        ]}
        value={formData.category}
        onChange={(val) => setFormData({ ...formData, category: val as string })}
        error={errors.category}
        required
      />

      <Select
        label="Tags"
        placeholder="Sélectionner des tags"
        options={[
          { value: 'urgent', label: 'Urgent' },
          { value: 'frontend', label: 'Frontend' },
          { value: 'backend', label: 'Backend' },
          { value: 'design', label: 'Design' },
        ]}
        value={formData.tags}
        onChange={(val) => setFormData({ ...formData, tags: val as string[] })}
        error={errors.tags}
        multiple
        searchable
      />

      <Combobox
        label="Assigné à"
        placeholder="Rechercher un membre..."
        options={[
          { value: 'alice', label: 'Alice Martin' },
          { value: 'bob', label: 'Bob Dupont' },
          { value: 'charlie', label: 'Charlie Bernard' },
        ]}
        value={formData.assignee}
        onChange={(val) => setFormData({ ...formData, assignee: val as string })}
        error={errors.assignee}
        required
      />

      <button type="submit">Soumettre</button>
    </form>
  );
}
```

### Utilisation avec React Hook Form
```tsx
import { Select } from '@/renderer/components/ui/Dropdown';
import { useForm, Controller } from 'react-hook-form';

interface FormInputs {
  category: string;
  priority: string;
}

function HookFormExample() {
  const { control, handleSubmit, formState: { errors } } = useForm<FormInputs>();

  const onSubmit = (data: FormInputs) => {
    console.log('Form data:', data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Controller
        name="category"
        control={control}
        rules={{ required: 'La catégorie est requise' }}
        render={({ field }) => (
          <Select
            label="Catégorie"
            placeholder="Sélectionner"
            options={[
              { value: 'docs', label: 'Documents' },
              { value: 'images', label: 'Images' },
            ]}
            value={field.value}
            onChange={field.onChange}
            error={errors.category?.message}
            required
          />
        )}
      />

      <Controller
        name="priority"
        control={control}
        rules={{ required: 'La priorité est requise' }}
        render={({ field }) => (
          <Select
            label="Priorité"
            placeholder="Sélectionner"
            options={[
              { value: 'low', label: 'Basse' },
              { value: 'medium', label: 'Moyenne' },
              { value: 'high', label: 'Haute' },
            ]}
            value={field.value}
            onChange={field.onChange}
            error={errors.priority?.message}
            required
          />
        )}
      />

      <button type="submit">Valider</button>
    </form>
  );
}
```

---

## Tips & Best Practices

### 1. Performance avec grandes listes
Pour de grandes listes d'options (>100 items), utilisez la recherche:
```tsx
<Select
  options={largeOptionsList}
  searchable  // Active la recherche pour filtrer
  value={value}
  onChange={setValue}
/>
```

### 2. Gestion des erreurs
Toujours afficher des messages d'erreur clairs:
```tsx
<Select
  label="Champ requis"
  error={fieldError}
  value={value}
  onChange={(val) => {
    setValue(val);
    clearError(); // Clear error on change
  }}
/>
```

### 3. Accessibilité
Les composants sont accessibles par défaut, mais assurez-vous de:
- Toujours fournir un `label`
- Marquer les champs requis avec `required`
- Fournir des messages d'erreur descriptifs

### 4. Mobile
Les composants sont responsive, mais pour mobile:
- Utilisez la taille `md` ou `lg` pour une meilleure UX tactile
- Activez `searchable` pour faciliter la sélection

### 5. Dark Mode
Les composants supportent automatiquement le dark mode via `data-theme="dark"`.
