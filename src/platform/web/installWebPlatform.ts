/**
 * Installation du dispatcher web — import à effet de bord, PREMIER import de
 * src/index.js pour précéder tout module qui lirait window.electron.
 *
 * Sous Electron, le preload a déjà posé window.electron : no-op strict
 * (ETW-1002 — un seul renderer, zéro divergence de comportement desktop).
 * Dans un navigateur, on installe la même surface d'API que le preload
 * (electron/preload.ts:246-290), routée vers les implémentations web.
 */

import { webInvoke, webOn, webOnce, webRemoveAllListeners, webSend } from './dispatcher';
import { resolveApiBase } from './webApiBase';
import { getBuildVersion } from '../../services/platform/appVersion';

function installWebPlatform(): void {
  const electronLike = {
    ipcRenderer: {
      invoke: (channel: string, ...args: unknown[]) => webInvoke(channel, ...args),
      send: (channel: string, ...args: unknown[]) => webSend(channel, ...args),
      on: (channel: string, listener: (...args: unknown[]) => void) => webOn(channel, listener),
      once: (channel: string, listener: (...args: unknown[]) => void) => webOnce(channel, listener),
      removeListener: (_channel: string, _listener: (...args: unknown[]) => void) => {
        // Même contrat que le preload : seul le désabonnement retourné par on()
        // détache réellement (l'identité des fonctions n'est pas préservée).
      },
      removeAllListeners: (channel: string) => webRemoveAllListeners(channel),
    },
    // Les navigateurs n'exposent jamais de chemin OS réel (et n'en ont pas besoin :
    // les imports web passent par File/stream, pas par un chemin).
    getPathForFile: (_file: File) => '',
  };

  (window as unknown as { electron: typeof electronLike }).electron = electronLike;
  (window as unknown as { electronAPI: { getVersion: () => string } }).electronAPI = {
    // La version du bundle (package.json, injectée par config-overrides.js) —
    // plus `process.env.REACT_APP_VERSION`, que le build ne posait jamais :
    // app.filarr.com s'annonçait « dev-web » en production.
    getVersion: () => `${getBuildVersion() ?? 'dev'}-web`,
  };
  // Marqueur de plateforme : permet aux rares écarts d'UI web (ex. la case
  // « Rester déverrouillé ») de se gater sans deviner via l'user-agent.
  (window as unknown as { __FILARR_WEB__: boolean }).__FILARR_WEB__ = true;
  // Crochet de style : tout le CSS spécifique web se gate sur [data-platform='web'].
  document.documentElement.setAttribute('data-platform', 'web');
}

if (typeof window !== 'undefined' && !window.electron) {
  installWebPlatform();
  // Résolution immédiate : purge un éventuel `filarr-server-url` fossile AVANT
  // que apiClient (qui lit la même clé) n'exécute son corps de module.
  resolveApiBase();
}

export {};
