/**
 * useNotification Hook
 *
 * Hook personnalisé pour utiliser le système de notifications
 */

import { useContext } from 'react';
import { NotificationContext, NotificationContextValue } from './NotificationProvider';

/**
 * Hook pour accéder au système de notifications
 *
 * @example
 * ```tsx
 * const { notify, success, error, warning, info } = useNotification();
 *
 * // Méthode 1: Utiliser les helpers
 * success('Fichier uploadé avec succès!');
 * error('Échec de la suppression du dossier');
 * warning('Attention: Espace disque faible');
 * info('Nouvelle mise à jour disponible');
 *
 * // Méthode 2: Utiliser notify avec options complètes
 * notify({
 *   type: 'success',
 *   message: 'Opération terminée',
 *   title: 'Succès',
 *   duration: 3000,
 *   action: {
 *     label: 'Voir',
 *     onClick: () => console.log('Action clicked')
 *   }
 * });
 * ```
 */
export const useNotification = (): NotificationContextValue => {
  const context = useContext(NotificationContext);

  if (context === undefined) {
    throw new Error(
      'useNotification must be used within a NotificationProvider. ' +
        'Wrap your app with <NotificationProvider> to use notifications.'
    );
  }

  return context;
};

export default useNotification;
