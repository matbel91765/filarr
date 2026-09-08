/**
 * Point d'entrée principal de l'application React
 *
 * Configure Redux, i18n, PWA et initialise le rendu de l'application
 */

// PREMIER import : installe le dispatcher web si window.electron est absent
// (navigateur). Sous Electron, no-op strict — le preload a déjà posé la façade.
import './platform/web/installWebPlatform';
// Juste après : la captation du lien d'invitation doit précéder redux-persist
// (importé par ./store) et le premier rendu, car l'URL /invite?token=… est
// invisible du HashRouter et disparaît au premier location.reload().
import './services/invites/pendingInvite';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import store from './store';
import { setupIpcListeners } from './store/middleware/electronMiddleware';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import { installChunkRecovery } from './renderer/components/ui/ErrorBoundary/chunkRecovery';
import './i18n/config'; // Initialiser i18n

// Un chunk qui ne se charge plus = un deploiement passe sous un onglet ouvert.
// Pose AVANT le premier rendu : les import() des effets partent tot, et un rejet
// non gere disparaitrait en console sans que l'action de l'utilisateur aboutisse.
installChunkRecovery();

// Initialiser les écouteurs IPC pour Electron
setupIpcListeners(store);

// Rendre l'application avec React 18
const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Sécurité : pas de Service Worker dans Electron.
// Un SW peut servir du JS obsolète après une mise à jour (l'utilisateur
// continue d'exécuter du code vulnérable même après patch) et persiste
// après désinstallation partielle. Cleanup défensif au démarrage : si un
// SW avait été enregistré par une version antérieure, on le désenregistre
// et on purge tous les Cache Storage contrôlés par le SW.
serviceWorkerRegistration.unregister();
if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
  caches
    .keys()
    .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    .catch(() => {
      /* ignore */
    });
}

// Si le module est dans un environnement de développement avec HMR
if (module.hot) {
  module.hot.accept('./App', () => {
    const NextApp = require('./App').default;
    root.render(
      <React.StrictMode>
        <NextApp />
      </React.StrictMode>
    );
  });
}
