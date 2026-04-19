# FolderView Component

Vue complète pour afficher le contenu d'un dossier dans Filarr avec toutes les fonctionnalités de gestion de fichiers.

## Fichiers créés

```
src/renderer/components/views/FolderView/
├── FolderView.jsx          (22 KB) - Composant principal
├── FolderView.css          (12 KB) - Styles complets
├── FolderView.stories.tsx  (6 KB)  - Stories Storybook
└── index.ts                - Exports
```

## Intégration dans l'application

### 1. Importer le composant dans App.js

```jsx
import { FolderView } from './renderer/components/views/FolderView';

// Dans les Routes
<Route path="/folder/:folderId" element={<FolderView />} />
```

### 2. Navigation vers FolderView

Depuis n'importe quel composant avec React Router :

```jsx
import { useNavigate } from 'react-router-dom';

function MyComponent() {
  const navigate = useNavigate();

  const handleOpenFolder = (folderId) => {
    navigate(`/folder/${folderId}`);
  };

  return (
    <button onClick={() => handleOpenFolder('123')}>
      Ouvrir le dossier
    </button>
  );
}
```

### 3. Exemple avec Link

```jsx
import { Link } from 'react-router-dom';

<Link to="/folder/123">Ouvrir Documents</Link>
```

## Fonctionnalités implémentées

### Navigation
- ✅ Bouton retour vers Home (/)
- ✅ Récupération du folderId depuis les params (useParams)
- ✅ Navigation vers sous-dossiers au clic

### Header
- ✅ Affichage du nom du dossier
- ✅ Bouton retour avec icône
- ✅ Bouton Upload avec modal
- ✅ Bouton Nouveau dossier

### Toolbar
- ✅ Recherche en temps réel avec icône
- ✅ Dropdown de tri (Nom, Date, Taille)
- ✅ Toggle vue grille/liste
- ✅ Design responsive

### Zone de contenu

#### Vue Grille
- ✅ Grille responsive auto-fill minmax(200px, 1fr)
- ✅ Cards pour fichiers et dossiers
- ✅ Icônes différentes selon le type
- ✅ Métadonnées (taille, date)
- ✅ Checkbox de sélection
- ✅ Menu actions (Dropdown)
- ✅ Hover effects

#### Vue Liste
- ✅ Layout table-like avec Grid CSS
- ✅ Colonnes : Checkbox, Icône, Nom, Taille, Date, Actions
- ✅ Header avec labels
- ✅ Checkbox "Tout sélectionner"
- ✅ Responsive (colonnes cachées sur mobile)

#### État vide
- ✅ Message personnalisé
- ✅ Icône illustrative
- ✅ Bouton CTA Upload
- ✅ Message différent si recherche active

### Sélection
- ✅ Sélection individuelle par checkbox
- ✅ Sélection multiple
- ✅ Tout sélectionner/Désélectionner
- ✅ Barre d'actions pour sélection
- ✅ Compteur d'éléments sélectionnés

### Actions
- ✅ Télécharger (disabled pour dossiers)
- ✅ Renommer
- ✅ Supprimer avec modal de confirmation
- ✅ Actions groupées (supprimer plusieurs)
- ✅ Dropdown menu par item

### Recherche et Tri
- ✅ Filtre en temps réel
- ✅ Tri par nom (alphabétique)
- ✅ Tri par date (plus récent d'abord)
- ✅ Tri par taille (plus grand d'abord)
- ✅ Dropdown pour changer le tri

### Upload
- ✅ Modal d'upload
- ✅ ProgressBar avec pourcentage
- ✅ Bouton annuler
- ✅ Simulation de progression

### Drag & Drop
- ✅ Zone de drop visuelle
- ✅ Overlay au survol
- ✅ État drag-active
- ✅ Message "Déposez vos fichiers ici"
- ✅ Gestion des événements drag

### Footer
- ✅ Nombre total d'éléments
- ✅ Taille totale formatée
- ✅ Mise à jour dynamique

### Modals
- ✅ UploadModal avec ProgressBar
- ✅ DeleteConfirmModal avec warning
- ✅ Gestion des states
- ✅ Fermeture conditionnelle

## Actions disponibles

### Actions Header
1. **Retour** - Retour à la page d'accueil
2. **Upload** - Ouvre le modal d'upload
3. **Nouveau dossier** - Crée un nouveau sous-dossier

### Actions Toolbar
1. **Recherche** - Filtre les items en temps réel
2. **Tri** - Change l'ordre d'affichage (Nom/Date/Taille)
3. **Vue** - Toggle entre grille et liste

### Actions par Item
1. **Télécharger** - Télécharge le fichier (désactivé pour dossiers)
2. **Renommer** - Renomme l'item
3. **Supprimer** - Supprime l'item avec confirmation

### Actions Sélection Multiple
1. **Désélectionner tout** - Retire la sélection
2. **Supprimer** - Supprime tous les items sélectionnés

## Preview des composants

### FileCard (Vue Grille)
```
┌─────────────────┐
│ [✓]       [⋮]   │ ← Checkbox + Menu
│                 │
│      📄/📁      │ ← Icône
│                 │
│  Nom du fichier │ ← Titre
│  2.5 MB • 10/11 │ ← Métadonnées
└─────────────────┘
```

### ItemList (Vue Liste)
```
┌──────────────────────────────────────────────────────────┐
│ [✓] | Icône | Nom           | Taille  | Date       | [⋮] │
├──────────────────────────────────────────────────────────┤
│ [✓] | 📄   | Rapport.pdf    | 2.5 MB  | 10/11/2024 | [⋮] │
│ [ ] | 📁   | Photos         | -       | 12/11/2024 | [⋮] │
└──────────────────────────────────────────────────────────┘
```

### Layout Global
```
┌────────────────────────────────────────────────────┐
│ Header (80px)                                      │
│ [← Retour] Documents        [Upload] [+ Dossier]  │
├────────────────────────────────────────────────────┤
│ Toolbar (60px)                                     │
│ [🔍 Rechercher...] [Trier: Nom ▼] [Grid] [List]  │
├────────────────────────────────────────────────────┤
│ Selection Bar (si items sélectionnés)             │
│ 3 éléments sélectionnés  [Désélectionner] [Suppr]│
├────────────────────────────────────────────────────┤
│                                                    │
│ Content Area (flex: 1)                            │
│ [Grille de FileCards ou Liste]                   │
│                                                    │
├────────────────────────────────────────────────────┤
│ Footer (60px)                                      │
│ 12 éléments                    Taille: 45.2 MB    │
└────────────────────────────────────────────────────┘
```

## Design System

### Composants UI utilisés
- **Button** - Actions, navigation, toggles
- **Input** - Recherche
- **Card** - FileCards en vue grille
- **Modal** - Upload et confirmation
- **ProgressBar** - Upload progress
- **Dropdown** - Menus d'actions et tri

### Tokens CSS
- **Colors** - `--color-*` pour texte, background, borders
- **Spacing** - `--spacing-*` pour padding, gap, margin
- **Shadows** - `--shadow-*` pour cards et modals
- **Transitions** - Animations fluides

### Dark Mode
- ✅ Support natif avec `[data-theme="dark"]`
- ✅ Couleurs adaptées
- ✅ Contraste WCAG AA

## Responsive

### Desktop (> 1024px)
- Grille: 200px min par card
- Toolbar: ligne unique
- Toutes les colonnes en vue liste

### Tablet (768px - 1024px)
- Grille: 160px min par card
- Toolbar: 2 lignes
- Colonne Date cachée en liste

### Mobile (< 768px)
- Grille: 140px min par card
- Header: 2 lignes
- Liste: 3 colonnes (checkbox, nom, actions)
- Footer: 2 lignes

## Accessibilité (WCAG AA)

- ✅ Focus visible sur tous les éléments interactifs
- ✅ Labels ARIA pour les boutons icônes
- ✅ Rôles sémantiques (menu, menuitem, dialog)
- ✅ Support clavier complet
- ✅ Contraste de couleurs conforme
- ✅ Support prefers-reduced-motion
- ✅ Support prefers-contrast: high

## Hooks et State Management

### État local (useState)
```jsx
const [searchQuery, setSearchQuery] = useState('');
const [viewMode, setViewMode] = useState('grid');
const [sortBy, setSortBy] = useState('name');
const [selectedItems, setSelectedItems] = useState([]);
const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
const [uploadProgress, setUploadProgress] = useState(0);
const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
const [dragActive, setDragActive] = useState(false);
```

### Hooks Router
```jsx
const { folderId } = useParams();
const navigate = useNavigate();
```

### Hooks à intégrer (Redux)
```jsx
// À remplacer dans l'implémentation
const { folders, items, uploadFile, deleteItem, renameItem } = useFolder();
const folder = folders.find(f => f.id === folderId);
const folderItems = items.filter(i => i.folderId === folderId);
```

## Storybook

### Stories disponibles
- Default - Vue par défaut
- EmptyFolder - Dossier vide
- GridView - Vue grille
- ListView - Vue liste
- WithSelection - Avec sélection multiple
- UploadInProgress - Upload en cours
- ManyFiles - Beaucoup de fichiers
- WithSearch - Recherche active
- DragAndDropActive - Drag & drop
- DarkMode - Mode sombre
- MobilePortrait - Mobile
- Tablet - Tablette
- OnlyFolders - Uniquement dossiers
- OnlyFiles - Uniquement fichiers
- SortedByDate - Tri par date
- SortedBySize - Tri par taille
- DeleteConfirmation - Modal suppression
- LongFileNames - Noms longs
- SpecialCharacters - Caractères spéciaux
- Loading - Chargement
- LoadError - Erreur

### Lancer Storybook
```bash
npm run storybook
```

## Prochaines étapes

### Intégration Redux
1. Remplacer les mock data par useFolder hook
2. Connecter uploadFile action
3. Connecter deleteItem action
4. Connecter renameItem action

### Fonctionnalités avancées
1. Virtualisation pour grandes listes (react-window)
2. Prévisualisation de fichiers
3. Copier/Coller/Déplacer
4. Téléchargement multiple
5. Compression/Décompression
6. Favoris

### Optimisations
1. Lazy loading des thumbnails
2. Pagination ou infinite scroll
3. Cache des données
4. Optimistic updates

## Exemple d'utilisation complet

```jsx
import { FolderView } from './renderer/components/views/FolderView';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/folder/:folderId" element={<FolderView />} />
      </Routes>
    </BrowserRouter>
  );
}

// Navigation depuis un autre composant
function FolderCard({ folder }) {
  const navigate = useNavigate();

  return (
    <div onClick={() => navigate(`/folder/${folder.id}`)}>
      {folder.name}
    </div>
  );
}
```

## Notes importantes

- Le composant utilise des **chemins relatifs** (pas d'alias @/)
- Les **icônes SVG** sont inline pour éviter les dépendances
- Le design suit le **Design System Filarr** (bleu ciel #87CEEB)
- Tous les textes sont en **français**
- Support complet du **dark mode**
- **WCAG AA** compliant pour l'accessibilité
