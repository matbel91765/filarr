/**
 * sandboxHost — l'iframe, le handshake, l'EditorInstance synthétique.
 *
 * LA MATRICE DE SURFACE — ce qu'un greffon malveillant PEUT ENCORE :
 *   · lire/garder en mémoire les octets du document OUVERT, les afficher ;
 *   · écrire un contenu arbitraire dans CE document via saveBytes — inévitable
 *     (c'est un éditeur) ; le verrou de version et le chiffrement restent à
 *     l'hôte, et les révisions E3-12 rendent l'écriture réversible ;
 *   · brûler CPU/mémoire dans SON iframe.
 * Ce qu'il NE PEUT PLUS :
 *   · parler au réseau — CSP de la page : default-src 'none' (fetch, XHR,
 *     WebSocket, sendBeacon, EventSource, img/font réseau) ET webrtc 'block'
 *     (RTCPeerConnection/DataChannel — la SEULE directive qui le couvre :
 *     connect-src ne régit pas WebRTC) ;
 *   · toucher le DOM/JS de l'hôte, lire cookies/localStorage/IndexedDB de
 *     l'app — origine OPAQUE (sandbox sans allow-same-origin) ;
 *   · obtenir jeton, URL d'API, itemId, vaultId, époque, clé — jamais
 *     transmis par le pont, par construction du message init ;
 *   · ouvrir d'autres documents (l'hôte ne pousse que celui ouvert) ;
 *   · naviguer son cadre vers l'extérieur — web : frame-src 'self' du parent
 *     revérifié à CHAQUE navigation du sous-cadre ; Electron : garde
 *     will-frame-navigate ;
 *   · ouvrir fenêtres/modales — sandbox sans allow-popups/allow-modals, et le
 *     setWindowOpenHandler global.
 *
 * allow-same-origin = FIN DE TOUT : combiné à allow-scripts sur une page
 * même-origine, l'iframe récupérerait l'origine de l'app (storage, parent,
 * retrait de son propre attribut sandbox). La chaîne est EXACTEMENT
 * 'allow-scripts' — toute autre valeur est un bug de sécurité.
 *
 * Aucun accès DOM top-level : ce module est importé transitivement par
 * pluginRegistry.ts, chargé en env vitest node.
 */

import { SANDBOX_BOOTSTRAP_TYPE } from './sandboxProtocol';
import { createSandboxBridgeCore, type SandboxBridgeCore } from './sandboxBridgeCore';

export interface SandboxMountParams {
  container: HTMLElement;
  /** Le bundle IIFE — une CHAÎNE côté hôte, exécutée uniquement dans l'iframe. */
  code: string;
  editorId: string;
  fileName: string;
  readOnly: boolean;
  initialBytes: Uint8Array;
  saveBytes(bytes: Uint8Array): Promise<void>;
  onDirty(dirty: boolean): void;
  onFatal(message: string): void;
}

export interface SandboxedEditorInstance {
  destroy(): void;
  getBytes(): Promise<Uint8Array>;
}

export async function mountSandboxedEditor(
  p: SandboxMountParams
): Promise<SandboxedEditorInstance> {
  const iframe = document.createElement('iframe');
  // JAMAIS allow-same-origin / allow-popups / allow-modals / allow-top-navigation.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.title = p.fileName;
  // Couvre localhost:3000 (dev) ET app://filarr.app (packagé) : même origine,
  // la page porte SA propre CSP (voir plugin-sandbox.html).
  iframe.src = new URL('plugin-sandbox.html', `${window.location.origin}/`).toString();

  let core: SandboxBridgeCore | null = null;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sandbox_page_timeout')), 10_000);
    iframe.addEventListener('load', () => {
      clearTimeout(timer);
      try {
        const win = iframe.contentWindow;
        if (!win) {
          reject(new Error('sandbox_page_unavailable'));
          return;
        }
        const canal = new MessageChannel();
        // targetOrigin '*' OBLIGATOIRE (origine opaque inmatchable) — donc ce
        // message ne contient RIEN d'autre que le type ; tout le contenu passe
        // par le port, privé par construction.
        win.postMessage({ type: SANDBOX_BOOTSTRAP_TYPE }, '*', [canal.port2]);
        core = createSandboxBridgeCore({
          port: canal.port1,
          callbacks: {
            onDirty: p.onDirty,
            saveBytes: p.saveBytes,
            onFatal: p.onFatal,
          },
        });
        canal.port1.onmessage = (ev) => core?.handleMessage(ev.data);
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error('sandbox_page_unavailable'));
      }
    });
    p.container.appendChild(iframe);
  });

  if (!core) throw new Error('sandbox_page_unavailable');
  const bridge: SandboxBridgeCore = core;

  await bridge.init({
    code: p.code,
    editorId: p.editorId,
    fileName: p.fileName,
    readOnly: p.readOnly,
    bytes: p.initialBytes,
  });

  return {
    destroy() {
      bridge.dispose();
      iframe.remove();
    },
    getBytes() {
      return bridge.requestBytes();
    },
  };
}
