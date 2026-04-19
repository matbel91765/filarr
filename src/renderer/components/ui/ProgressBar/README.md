# ProgressBar Components

Composants de progression pour indiquer l'avancement d'une tâche dans l'application Filarr.

## Composants

### ProgressBar (Linear)
Barre de progression linéaire avec support des modes déterminé et indéterminé.

### CircularProgress
Indicateur de progression circulaire avec animation SVG.

## Features

- **Modes**: Déterminé (0-100%) et indéterminé (animation de chargement)
- **Variantes**: default (primary), success (vert), warning (orange), error (rouge)
- **Tailles**: 
  - Linear: sm (4px), md (8px), lg (12px)
  - Circular: sm (32px), md (48px), lg (64px), xl (96px)
- **Épaisseurs (circulaire)**: fine (2px), normal (4px), bold (6px)
- **Accessibilité**: Support complet ARIA (role="progressbar", aria-valuenow, aria-valuemin, aria-valuemax)
- **Dark mode**: Support natif du thème sombre
- **Animations**: Transitions smooth et animations shimmer/spin
- **Reduced motion**: Respect des préférences utilisateur
- **Value clamping**: Valeur automatiquement limitée entre 0 et 100

## Usage

### ProgressBar linéaire

```tsx
import { ProgressBar } from '@/renderer/components/ui/ProgressBar';

// Simple
<ProgressBar value={50} />

// Avec label et pourcentage
<ProgressBar 
  value={75} 
  label="Téléchargement en cours"
  showValue 
/>

// Variantes de couleur
<ProgressBar value={60} variant="success" />
<ProgressBar value={40} variant="warning" />
<ProgressBar value={20} variant="error" />

// Tailles
<ProgressBar value={50} size="sm" />
<ProgressBar value={50} size="md" />
<ProgressBar value={50} size="lg" />

// Mode indéterminé
<ProgressBar indeterminate label="Chargement..." />
```

### CircularProgress

```tsx
import { CircularProgress } from '@/renderer/components/ui/ProgressBar';

// Simple
<CircularProgress value={70} />

// Avec valeur affichée
<CircularProgress value={70} showValue />

// Variantes
<CircularProgress value={80} variant="success" showValue />
<CircularProgress value={60} variant="warning" showValue />
<CircularProgress value={30} variant="error" showValue />

// Tailles
<CircularProgress value={70} size="sm" />
<CircularProgress value={70} size="md" />
<CircularProgress value={70} size="lg" />
<CircularProgress value={70} size="xl" />

// Épaisseurs
<CircularProgress value={70} thickness="fine" />
<CircularProgress value={70} thickness="normal" />
<CircularProgress value={70} thickness="bold" />

// Mode indéterminé
<CircularProgress indeterminate />
```

### Exemple: Upload de fichier

```tsx
import { useState, useEffect } from 'react';
import { ProgressBar } from '@/renderer/components/ui/ProgressBar';

function FileUpload() {
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (file) => {
    setIsUploading(true);
    setProgress(0);

    // Simuler l'upload
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsUploading(false);
          return 100;
        }
        return prev + 10;
      });
    }, 500);
  };

  return (
    <div>
      <ProgressBar
        value={progress}
        variant={progress === 100 ? 'success' : 'default'}
        label="Upload de document.pdf"
        showValue
        size="md"
      />
      <button onClick={() => handleUpload(file)} disabled={isUploading}>
        {isUploading ? 'Upload en cours...' : 'Uploader'}
      </button>
    </div>
  );
}
```

### Exemple: Traitement avec CircularProgress

```tsx
import { useState } from 'react';
import { CircularProgress } from '@/renderer/components/ui/ProgressBar';

function ProcessingTask() {
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const startProcessing = async () => {
    setIsProcessing(true);
    // Logique de traitement...
    // Mise à jour de setProgress(newValue)
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <CircularProgress
        value={progress}
        variant={progress === 100 ? 'success' : 'default'}
        size="xl"
        thickness="bold"
        showValue
      />
      <div>{isProcessing ? 'Traitement...' : 'Terminé'}</div>
    </div>
  );
}
```

## Props

### ProgressBar

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| value | number | 0 | Valeur actuelle (0-100) |
| max | number | 100 | Valeur maximale |
| variant | 'default' \| 'success' \| 'warning' \| 'error' | 'default' | Variante de couleur |
| size | 'sm' \| 'md' \| 'lg' | 'md' | Taille de la barre |
| label | string | - | Label affiché au-dessus |
| showValue | boolean | false | Afficher le pourcentage |
| indeterminate | boolean | false | Mode indéterminé (animation) |
| className | string | '' | Classes CSS additionnelles |

### CircularProgress

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| value | number | 0 | Valeur actuelle (0-100) |
| size | 'sm' \| 'md' \| 'lg' \| 'xl' | 'md' | Taille du cercle |
| variant | 'default' \| 'success' \| 'warning' \| 'error' | 'default' | Variante de couleur |
| thickness | 'fine' \| 'normal' \| 'bold' | 'normal' | Épaisseur du trait |
| showValue | boolean | false | Afficher le pourcentage au centre |
| indeterminate | boolean | false | Mode indéterminé (rotation) |
| className | string | '' | Classes CSS additionnelles |

## Design Tokens utilisés

- Colors: `--color-primary-*`, `--color-success-*`, `--color-warning-*`, `--color-error-*`, `--color-neutral-*`
- Spacing: `--spacing-2`
- Transitions: `--duration-normal`, `--ease-out`
- Radius: `--radius-full`

## Accessibilité

- Role ARIA `progressbar` avec attributs appropriés
- Support du mode high contrast
- Animations respectant `prefers-reduced-motion`
- Visibilité optimale en dark mode
