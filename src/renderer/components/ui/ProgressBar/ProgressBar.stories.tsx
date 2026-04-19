/**
 * ProgressBar Stories
 * Documentation et exemples d'utilisation des composants ProgressBar et CircularProgress
 */

import type { Meta, StoryObj } from '@storybook/react';
import React, { useState, useEffect } from 'react';
import { ProgressBar } from './ProgressBar';
import { CircularProgress } from './CircularProgress';

const meta: Meta<typeof ProgressBar> = {
  title: 'UI/ProgressBar',
  component: ProgressBar,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Composants de progression pour indiquer l\'avancement d\'une tâche. Disponibles en version linéaire et circulaire, avec modes déterminé et indéterminé.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

/* ===== Linear Progress ===== */

export const LinearDefault: Story = {
  name: 'Linear - Valeurs de base',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <ProgressBar value={0} label="0%" />
      <ProgressBar value={25} label="25%" />
      <ProgressBar value={50} label="50%" />
      <ProgressBar value={75} label="75%" />
      <ProgressBar value={100} label="100%" />
    </div>
  ),
};

export const LinearWithValue: Story = {
  name: 'Linear - Avec affichage du pourcentage',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <ProgressBar value={25} label="Téléchargement en cours" showValue />
      <ProgressBar value={50} label="Traitement des fichiers" showValue />
      <ProgressBar value={75} label="Compression" showValue />
    </div>
  ),
};

export const LinearVariants: Story = {
  name: 'Linear - Variantes de couleur',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <ProgressBar value={60} variant="default" label="Default (Primary)" showValue />
      <ProgressBar value={60} variant="success" label="Success" showValue />
      <ProgressBar value={60} variant="warning" label="Warning" showValue />
      <ProgressBar value={60} variant="error" label="Error" showValue />
    </div>
  ),
};

export const LinearSizes: Story = {
  name: 'Linear - Tailles',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <ProgressBar value={70} size="sm" label="Small (4px)" showValue />
      <ProgressBar value={70} size="md" label="Medium (8px)" showValue />
      <ProgressBar value={70} size="lg" label="Large (12px)" showValue />
    </div>
  ),
};

export const LinearIndeterminate: Story = {
  name: 'Linear - Mode indéterminé',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <ProgressBar indeterminate label="Chargement..." />
      <ProgressBar indeterminate variant="success" label="Synchronisation..." />
      <ProgressBar indeterminate variant="warning" label="Traitement..." />
      <ProgressBar indeterminate variant="error" label="Échec - Nouvelle tentative..." />
    </div>
  ),
};

/* ===== Circular Progress ===== */

export const CircularDefault: Story = {
  name: 'Circular - Valeurs de base',
  render: () => (
    <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <CircularProgress value={0} />
      <CircularProgress value={25} />
      <CircularProgress value={50} />
      <CircularProgress value={75} />
      <CircularProgress value={100} />
    </div>
  ),
};

export const CircularWithValue: Story = {
  name: 'Circular - Avec affichage du pourcentage',
  render: () => (
    <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <CircularProgress value={25} showValue />
      <CircularProgress value={50} showValue />
      <CircularProgress value={75} showValue />
      <CircularProgress value={100} showValue />
    </div>
  ),
};

export const CircularVariants: Story = {
  name: 'Circular - Variantes de couleur',
  render: () => (
    <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={60} variant="default" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Default</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={60} variant="success" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Success</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={60} variant="warning" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Warning</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={60} variant="error" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Error</div>
      </div>
    </div>
  ),
};

export const CircularSizes: Story = {
  name: 'Circular - Tailles',
  render: () => (
    <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={70} size="sm" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Small (32px)</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={70} size="md" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Medium (48px)</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={70} size="lg" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Large (64px)</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={70} size="xl" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Extra Large (96px)</div>
      </div>
    </div>
  ),
};

export const CircularThickness: Story = {
  name: 'Circular - Épaisseurs',
  render: () => (
    <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={70} size="lg" thickness="fine" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Fine (2px)</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={70} size="lg" thickness="normal" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Normal (4px)</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress value={70} size="lg" thickness="bold" showValue />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Bold (6px)</div>
      </div>
    </div>
  ),
};

export const CircularIndeterminate: Story = {
  name: 'Circular - Mode indéterminé',
  render: () => (
    <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress indeterminate variant="default" />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Default</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress indeterminate variant="success" />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Success</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress indeterminate variant="warning" />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Warning</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <CircularProgress indeterminate variant="error" />
        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Error</div>
      </div>
    </div>
  ),
};

/* ===== Use Cases ===== */

/**
 * Simulation d'upload de fichier avec ProgressBar linéaire
 */
const FileUploadSimulation: React.FC = () => {
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const startUpload = () => {
    setProgress(0);
    setIsUploading(true);
  };

  useEffect(() => {
    if (!isUploading) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsUploading(false);
          return 100;
        }
        return prev + 1;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [isUploading]);

  const getVariant = () => {
    if (progress < 100) return 'default';
    return 'success';
  };

  return (
    <div style={{ maxWidth: '500px' }}>
      <ProgressBar
        value={progress}
        variant={getVariant()}
        label="Upload de document.pdf"
        showValue
        size="md"
      />
      <button
        onClick={startUpload}
        disabled={isUploading}
        style={{
          marginTop: '1rem',
          padding: '0.5rem 1rem',
          cursor: isUploading ? 'not-allowed' : 'pointer',
          opacity: isUploading ? 0.5 : 1,
        }}
      >
        {isUploading ? 'Upload en cours...' : 'Démarrer l\'upload'}
      </button>
    </div>
  );
};

export const FileUploadExample: Story = {
  name: 'Exemple - Upload de fichier',
  render: () => <FileUploadSimulation />,
};

/**
 * Simulation de traitement avec CircularProgress
 */
const ProcessingSimulation: React.FC = () => {
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const startProcessing = () => {
    setProgress(0);
    setIsProcessing(true);
  };

  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsProcessing(false);
          return 100;
        }
        return prev + 2;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isProcessing]);

  const getVariant = () => {
    if (progress === 100) return 'success';
    if (progress > 75) return 'warning';
    return 'default';
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <CircularProgress
        value={progress}
        variant={getVariant()}
        size="xl"
        thickness="bold"
        showValue
      />
      <div style={{ marginTop: '1rem' }}>
        {isProcessing && <div>Traitement en cours...</div>}
        {!isProcessing && progress === 100 && <div>Traitement terminé !</div>}
        {!isProcessing && progress === 0 && <div>Prêt à démarrer</div>}
      </div>
      <button
        onClick={startProcessing}
        disabled={isProcessing}
        style={{
          marginTop: '1rem',
          padding: '0.5rem 1rem',
          cursor: isProcessing ? 'not-allowed' : 'pointer',
          opacity: isProcessing ? 0.5 : 1,
        }}
      >
        {isProcessing ? 'En cours...' : 'Démarrer le traitement'}
      </button>
    </div>
  );
};

export const ProcessingExample: Story = {
  name: 'Exemple - Traitement circulaire',
  render: () => <ProcessingSimulation />,
};

/* ===== Dark Mode ===== */

export const DarkMode: Story = {
  name: 'Dark Mode',
  parameters: {
    backgrounds: { default: 'dark' },
  },
  render: () => (
    <div data-theme="dark" style={{ padding: '2rem' }}>
      <h3 style={{ color: '#fff', marginBottom: '2rem' }}>Linear Progress</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginBottom: '3rem' }}>
        <ProgressBar value={60} variant="default" label="Default" showValue />
        <ProgressBar value={60} variant="success" label="Success" showValue />
        <ProgressBar value={60} variant="warning" label="Warning" showValue />
        <ProgressBar value={60} variant="error" label="Error" showValue />
        <ProgressBar indeterminate label="Indeterminate" />
      </div>

      <h3 style={{ color: '#fff', marginBottom: '2rem' }}>Circular Progress</h3>
      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <CircularProgress value={70} variant="default" size="lg" showValue />
        <CircularProgress value={70} variant="success" size="lg" showValue />
        <CircularProgress value={70} variant="warning" size="lg" showValue />
        <CircularProgress value={70} variant="error" size="lg" showValue />
        <CircularProgress indeterminate size="lg" />
      </div>
    </div>
  ),
};

/* ===== All States ===== */

export const AllStates: Story = {
  name: 'Tous les états',
  render: () => (
    <div style={{ maxWidth: '600px' }}>
      <section style={{ marginBottom: '3rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Linear Progress - Toutes les variantes</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <ProgressBar value={0} label="Pas commencé" showValue />
          <ProgressBar value={33} label="En cours" showValue />
          <ProgressBar value={100} variant="success" label="Terminé" showValue />
          <ProgressBar value={50} variant="warning" label="Attention" showValue />
          <ProgressBar value={25} variant="error" label="Erreur" showValue />
          <ProgressBar indeterminate label="Chargement indéterminé" />
        </div>
      </section>

      <section>
        <h3 style={{ marginBottom: '1rem' }}>Circular Progress - Toutes les tailles</h3>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <CircularProgress value={80} size="sm" variant="default" showValue />
          <CircularProgress value={80} size="md" variant="success" showValue />
          <CircularProgress value={80} size="lg" variant="warning" showValue />
          <CircularProgress value={80} size="xl" variant="error" showValue />
          <CircularProgress indeterminate size="md" />
        </div>
      </section>
    </div>
  ),
};
