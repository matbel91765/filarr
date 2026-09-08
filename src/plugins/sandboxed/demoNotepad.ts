/**
 * Le greffon de DÉMONSTRATION du bac à sable — un bloc-notes .sbx, et surtout
 * l'AUTO-TEST D'ISOLATION : la matrice de surface cesse d'être une promesse de
 * document, elle s'exécute sous les yeux du testeur — chaque canal tenté
 * s'affiche BLOQUÉ (vert) ou FUITE (rouge). La sonde RTCPeerConnection y est :
 * c'est le seul canal réseau que connect-src ne régit pas (directive webrtc).
 *
 * Le `code` est une CHAÎNE : il ne s'exécute JAMAIS ici — uniquement dans
 * l'iframe d'origine opaque (registerSandboxedPlugin → sandboxHost).
 */

import type { SandboxedPluginSource } from '../../services/plugins/pluginTypes';

const CODE = String.raw`(() => {
  globalThis.filarrSandboxedPlugin = {
    editors: [
      {
        id: 'notepad',
        mount(host) {
          const root = host.container;
          root.innerHTML = '';
          const wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;font:13px system-ui;background:#fff;color:#111';

          const bar = document.createElement('div');
          bar.style.cssText = 'display:flex;gap:8px;align-items:center;padding:6px;border-bottom:1px solid #ddd';
          const save = document.createElement('button');
          save.textContent = 'Enregistrer';
          save.style.cssText = 'font:12px system-ui;padding:4px 10px';
          const status = document.createElement('span');
          status.style.cssText = 'font-size:11px;color:#666';
          bar.append(save, status);

          const ta = document.createElement('textarea');
          ta.style.cssText = 'flex:1;border:0;outline:none;padding:10px;font:14px/1.5 monospace;resize:none';
          ta.value = new TextDecoder().decode(host.initialBytes);
          ta.readOnly = host.readOnly;
          ta.addEventListener('input', () => { host.onDirty(true); status.textContent = 'modifié'; });

          save.addEventListener('click', () => {
            status.textContent = 'enregistrement…';
            host.saveBytes(new TextEncoder().encode(ta.value)).then(
              () => { status.textContent = 'enregistré'; host.onDirty(false); },
              (e) => { status.textContent = 'échec : ' + (e && e.message ? e.message : '?'); }
            );
          });

          // ── L'AUTO-TEST D'ISOLATION ─────────────────────────────────────
          const panel = document.createElement('div');
          panel.style.cssText = 'border-top:1px solid #ddd;padding:8px;max-height:40%;overflow:auto;background:#fafafa';
          const title = document.createElement('div');
          title.textContent = 'Auto-test d’isolation du bac à sable';
          title.style.cssText = 'font-weight:600;margin-bottom:6px';
          panel.appendChild(title);

          const line = (label, blocked, detail) => {
            const el = document.createElement('div');
            el.style.cssText = 'display:flex;gap:8px;align-items:baseline;padding:2px 0';
            const badge = document.createElement('span');
            badge.textContent = blocked ? 'BLOQUÉ' : 'FUITE';
            badge.style.cssText = 'font:11px monospace;font-weight:700;color:' + (blocked ? '#15803d' : '#b91c1c');
            const txt = document.createElement('span');
            txt.textContent = label + (detail ? ' — ' + detail : '');
            el.append(badge, txt);
            panel.appendChild(el);
          };

          // 1. fetch — CSP default-src 'none'.
          fetch('https://example.com').then(
            () => line('fetch(https://example.com)', false, 'la requête est partie'),
            () => line('fetch(https://example.com)', true)
          );
          // 2. WebSocket.
          try {
            const ws = new WebSocket('wss://example.com');
            ws.addEventListener('open', () => line('new WebSocket(wss://…)', false, 'connecté'));
            ws.addEventListener('error', () => line('new WebSocket(wss://…)', true));
          } catch (e) {
            line('new WebSocket(wss://…)', true);
          }
          // 3. localStorage — origine opaque.
          try {
            localStorage.getItem('x');
            line('localStorage', false, 'accessible');
          } catch (e) {
            line('localStorage', true);
          }
          // 4. window.parent.document — cross-origin.
          try {
            void window.parent.document;
            line('window.parent.document', false, 'lisible');
          } catch (e) {
            line('window.parent.document', true);
          }
          // 5. sendBeacon.
          try {
            const sent = navigator.sendBeacon && navigator.sendBeacon('https://example.com', 'x');
            line('navigator.sendBeacon', !sent);
          } catch (e) {
            line('navigator.sendBeacon', true);
          }
          // 6. window.open — sandbox sans allow-popups.
          try {
            const w = window.open('https://example.com');
            line('window.open', w === null);
            if (w) w.close();
          } catch (e) {
            line('window.open', true);
          }
          // 7. RTCPeerConnection — le canal que connect-src NE couvre PAS ;
          //    seul webrtc 'block' le ferme.
          try {
            const pc = new RTCPeerConnection();
            pc.createDataChannel('x');
            pc.createOffer().then(
              (offer) => {
                const sdp = String(offer && offer.sdp || '');
                // Sous webrtc 'block', pas de candidats réseau exploitables.
                const leaky = /candidate/.test(sdp);
                line('RTCPeerConnection/DataChannel', !leaky);
                pc.close();
              },
              () => { line('RTCPeerConnection/DataChannel', true); pc.close(); }
            );
          } catch (e) {
            line('RTCPeerConnection/DataChannel', true);
          }

          wrap.append(bar, ta, panel);
          root.appendChild(wrap);

          return {
            destroy() { root.innerHTML = ''; },
            getBytes() { return new TextEncoder().encode(ta.value); },
          };
        },
      },
    ],
  };
})();`;

export const demoNotepadPlugin: SandboxedPluginSource = {
  manifest: {
    id: 'sandbox-demo',
    name: 'Bloc-notes (bac à sable)',
    version: '0.1.0',
    trust: 'sandboxed',
    provides: {
      editors: [{ id: 'notepad', extensions: ['sbx'], displayName: 'Ouvrir (bac à sable)' }],
    },
  },
  code: CODE,
};
