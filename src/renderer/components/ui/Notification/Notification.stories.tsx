/**
 * Notification Storybook Stories
 *
 * Stories pour le composant Notification et le système de notifications
 */

import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { NotificationProvider } from './NotificationProvider';
import { useNotification } from './useNotification';
import { NotificationPosition } from './NotificationContainer';

// Composant démo pour les stories interactives
const NotificationDemo = ({ position = 'top-right' }: { position?: NotificationPosition }) => {
  const { notify, success, error, warning, info, dismissAll } = useNotification();

  return (
    <div style={{ padding: '2rem' }}>
      <h2 style={{ marginBottom: '1.5rem', color: 'var(--color-text-primary)' }}>
        Notification System Demo
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '600px' }}>
        {/* Types de base */}
        <div>
          <h3 style={{ marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
            Types de base
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => success('Opération réussie avec succès!')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-success-600)',
                backgroundColor: 'var(--color-success-600)',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Success
            </button>
            <button
              onClick={() => error('Une erreur est survenue lors de l\'opération')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-error-600)',
                backgroundColor: 'var(--color-error-600)',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Error
            </button>
            <button
              onClick={() => warning('Attention: Cette action est irréversible')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-warning-600)',
                backgroundColor: 'var(--color-warning-600)',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Warning
            </button>
            <button
              onClick={() => info('Nouvelle mise à jour disponible')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-info-600)',
                backgroundColor: 'var(--color-info-600)',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Info
            </button>
          </div>
        </div>

        {/* Avec titres */}
        <div>
          <h3 style={{ marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
            Avec titres
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => success('Fichier uploadé avec succès', 'Upload terminé')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              Success avec titre
            </button>
            <button
              onClick={() => error('Impossible de se connecter au serveur', 'Erreur réseau')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              Error avec titre
            </button>
          </div>
        </div>

        {/* Avec actions */}
        <div>
          <h3 style={{ marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
            Avec actions
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() =>
                notify({
                  type: 'success',
                  message: 'Dossier créé avec succès',
                  title: 'Succès',
                  action: {
                    label: 'Voir',
                    onClick: () => alert('Action clicked!'),
                  },
                })
              }
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              Avec action
            </button>
            <button
              onClick={() =>
                notify({
                  type: 'info',
                  message: 'Voulez-vous activer les notifications?',
                  title: 'Notifications',
                  action: {
                    label: 'Activer',
                    variant: 'primary',
                    onClick: () => alert('Notifications activées!'),
                  },
                })
              }
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              Avec action primaire
            </button>
          </div>
        </div>

        {/* Durées personnalisées */}
        <div>
          <h3 style={{ marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
            Durées personnalisées
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => success('Disparaît après 2 secondes', undefined, 2000)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              2 secondes
            </button>
            <button
              onClick={() => info('Disparaît après 10 secondes', undefined, 10000)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              10 secondes
            </button>
            <button
              onClick={() =>
                notify({
                  type: 'warning',
                  message: 'Cette notification ne disparaît pas automatiquement',
                  title: 'Persistant',
                  duration: 0,
                })
              }
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              Persistant (sans auto-dismiss)
            </button>
          </div>
        </div>

        {/* Stack de notifications */}
        <div>
          <h3 style={{ marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
            Stack de notifications
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                success('Notification 1');
                setTimeout(() => error('Notification 2'), 200);
                setTimeout(() => warning('Notification 3'), 400);
                setTimeout(() => info('Notification 4'), 600);
              }}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              Afficher 4 notifications
            </button>
            <button
              onClick={dismissAll}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-error-600)',
                backgroundColor: 'transparent',
                color: 'var(--color-error-600)',
                cursor: 'pointer',
              }}
            >
              Fermer toutes
            </button>
          </div>
        </div>

        {/* Messages longs */}
        <div>
          <h3 style={{ marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
            Messages longs
          </h3>
          <button
            onClick={() =>
              notify({
                type: 'info',
                message:
                  'Ceci est un message très long pour tester le comportement du composant notification lorsque le contenu dépasse la largeur habituelle. Le texte devrait s\'adapter automatiquement et le bouton de fermeture rester accessible.',
                title: 'Message long',
              })
            }
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            Afficher message long
          </button>
        </div>
      </div>
    </div>
  );
};

const meta: Meta<typeof NotificationProvider> = {
  title: 'UI/Notification',
  component: NotificationProvider,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Système de notifications/toasts complet avec support des types (success, error, warning, info), auto-dismiss, actions et différentes positions.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: '100vh', padding: '2rem' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NotificationProvider>;

// Story par défaut (top-right)
export const Default: Story = {
  render: () => (
    <NotificationProvider position="top-right">
      <NotificationDemo position="top-right" />
    </NotificationProvider>
  ),
};

// Position top-left
export const TopLeft: Story = {
  render: () => (
    <NotificationProvider position="top-left">
      <NotificationDemo position="top-left" />
    </NotificationProvider>
  ),
};

// Position top-center
export const TopCenter: Story = {
  render: () => (
    <NotificationProvider position="top-center">
      <NotificationDemo position="top-center" />
    </NotificationProvider>
  ),
};

// Position bottom-right
export const BottomRight: Story = {
  render: () => (
    <NotificationProvider position="bottom-right">
      <NotificationDemo position="bottom-right" />
    </NotificationProvider>
  ),
};

// Position bottom-left
export const BottomLeft: Story = {
  render: () => (
    <NotificationProvider position="bottom-left">
      <NotificationDemo position="bottom-left" />
    </NotificationProvider>
  ),
};

// Position bottom-center
export const BottomCenter: Story = {
  render: () => (
    <NotificationProvider position="bottom-center">
      <NotificationDemo position="bottom-center" />
    </NotificationProvider>
  ),
};

// Max 3 notifications
export const LimitedStack: Story = {
  render: () => (
    <NotificationProvider position="top-right" maxNotifications={3}>
      <NotificationDemo position="top-right" />
    </NotificationProvider>
  ),
};

// Dark mode
export const DarkMode: Story = {
  render: () => (
    <div data-theme="dark" style={{ minHeight: '100vh', backgroundColor: '#0A0E1A' }}>
      <NotificationProvider position="top-right">
        <NotificationDemo position="top-right" />
      </NotificationProvider>
    </div>
  ),
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

// Types individuels
export const SuccessNotification: Story = {
  render: () => {
    const Demo = () => {
      const { success } = useNotification();
      React.useEffect(() => {
        success('Fichier uploadé avec succès!', 'Upload terminé');
      }, []);
      return <div style={{ padding: '2rem' }}>Notification de succès affichée automatiquement</div>;
    };

    return (
      <NotificationProvider>
        <Demo />
      </NotificationProvider>
    );
  },
};

export const ErrorNotification: Story = {
  render: () => {
    const Demo = () => {
      const { error } = useNotification();
      React.useEffect(() => {
        error('Impossible de se connecter au serveur', 'Erreur réseau');
      }, []);
      return <div style={{ padding: '2rem' }}>Notification d'erreur affichée automatiquement</div>;
    };

    return (
      <NotificationProvider>
        <Demo />
      </NotificationProvider>
    );
  },
};

export const WarningNotification: Story = {
  render: () => {
    const Demo = () => {
      const { warning } = useNotification();
      React.useEffect(() => {
        warning('Attention: Espace disque faible', 'Avertissement');
      }, []);
      return <div style={{ padding: '2rem' }}>Notification d'avertissement affichée automatiquement</div>;
    };

    return (
      <NotificationProvider>
        <Demo />
      </NotificationProvider>
    );
  },
};

export const InfoNotification: Story = {
  render: () => {
    const Demo = () => {
      const { info } = useNotification();
      React.useEffect(() => {
        info('Nouvelle mise à jour disponible', 'Information');
      }, []);
      return <div style={{ padding: '2rem' }}>Notification d'information affichée automatiquement</div>;
    };

    return (
      <NotificationProvider>
        <Demo />
      </NotificationProvider>
    );
  },
};
