/**
 * ssoLogin.ts (E5-1, côté bureau) — connexion par le fournisseur d’identité
 * de l'organisation.
 *
 * CE QUI MANQUAIT. Le Worker savait tout faire : `/auth/sso/start` envoie chez
 * l'IdP, `/callback` valide l'id_token et frappe des jetons Filarr, puis les
 * remet à « l'application native » par une adresse de boucle locale
 * (`http://127.0.0.1:<port>/…`, RFC 8252). Mais aucune application native
 * n'écoutait : pas de serveur local, pas de canal IPC, pas de bouton. Le SSO
 * était une porte avec une serrure et sans poignée.
 *
 * COMMENT ÇA MARCHE. On ouvre un serveur HTTP sur 127.0.0.1, port choisi par
 * l'OS, le temps d'UNE connexion. Le navigateur système fait l'aller-retour
 * chez l'IdP ; le Worker redirige enfin vers notre port avec un CODE à usage
 * unique dans le FRAGMENT de l'URL (`#code=…`) — pas des jetons : un fragment
 * reste dans l'historique du navigateur, et si l'application est morte entre
 * temps il y resterait avec une session valide dedans. Le code, lui, meurt en
 * deux minutes et ne vaut rien sans l'échange. La page servie ici le lit en
 * JavaScript et le renvoie en POST sur la même boucle ; `adoptSsoCode`
 * l'échange contre des jetons en déclarant l'appareil, comme /auth/login. Le serveur se ferme dès le premier résultat, ou au bout de
 * cinq minutes.
 *
 * CE QUE LE SSO NE FAIT PAS. Il fédère la SESSION, jamais la clé : l'IdP ne
 * voit ni mot de passe de coffre ni FEK. Après cette connexion, le coffre
 * s'ouvre soit par la clé d'appareil (E5-4, si ce poste est enrôlé), soit en
 * demandant une fois le mot de passe du coffre. C'est l'écran qui s'en charge.
 */

import http from 'http';
import { AddressInfo } from 'net';
import { shell } from 'electron';
import log from 'electron-log';
import { API_BASE } from './apiOrigin';
import * as authService from './authService';

const TIMEOUT_MS = 5 * 60 * 1000;

// La page servie sur la boucle : elle lit le fragment et le renvoie en POST.
// Aucune ressource externe, aucun script tiers — elle tourne dans le
// navigateur système, hors de notre CSP.
const LANDING = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Filarr</title>
<style>body{margin:0;background:#0a0e1a;color:#f0f8ff;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
div{max-width:420px;padding:28px 32px;background:#10141f;border:1px solid #2a3142;border-radius:16px}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#b8c5d6}</style></head>
<body><div><h1 id="t">Connexion en cours…</h1><p id="m">Vous pouvez revenir dans Filarr.</p></div>
<script>(function(){var h=location.hash.replace(/^#/,"");var p=new URLSearchParams(h);var k=p.get("code");
history.replaceState(null,"",location.pathname);
if(!k){document.getElementById("t").textContent="Connexion refusée";document.getElementById("m").textContent="Le fournisseur d’identité n’a pas rendu de session. Réessayez depuis Filarr.";return;}
fetch("/sso/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:k})})
.then(function(x){return x.ok?x.json():Promise.reject()}).then(function(j){if(j&&j.success){document.getElementById("t").textContent="Vous êtes connecté";document.getElementById("m").textContent="Cette page peut être fermée. Filarr a repris la main.";}else{throw 0}})
.catch(function(){document.getElementById("t").textContent="Connexion refusée";document.getElementById("m").textContent="Filarr n’a pas accepté la session. Réessayez depuis l’application.";});})();</script></body></html>`;

let current: { server: http.Server; settle: (r: SsoResult) => void } | null = null;

export interface SsoResult {
  success: boolean;
  user?: unknown;
  error?: string;
  /** `sso_timeout` | `sso_cancelled` | `sso_rejected` */
  code?: string;
}

/**
 * Démarre une connexion SSO pour l'organisation `orgId` et attend le résultat.
 * Une seule à la fois : une nouvelle demande annule la précédente.
 */
export function startSsoLogin(orgId: string): Promise<SsoResult> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) {
    return Promise.resolve({ success: false, error: 'Invalid org id', code: 'sso_rejected' });
  }
  cancelSsoLogin();

  return new Promise<SsoResult>((resolve) => {
    let settled = false;
    const settle = (r: SsoResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* déjà fermé */
      }
      if (current && current.server === server) current = null;
      resolve(r);
    };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      // Rien d'autre que la boucle elle-même ne doit pouvoir nous parler : un
      // site ouvert dans le même navigateur pourrait tenter un POST vers notre
      // port. Sans Origin (navigation) ou avec le nôtre : accepté. Sinon : non.
      const origin = req.headers.origin;
      const host = req.headers.host ?? '';
      if (origin && new URL(origin).host !== host) {
        res.writeHead(403).end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/sso') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(LANDING);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/sso/complete') {
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 16_384) req.destroy();
        });
        req.on('end', async () => {
          try {
            const { code } = JSON.parse(body) as { code?: string };
            const r = await authService.adoptSsoCode(code ?? '');
            res.writeHead(r.success ? 200 : 401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: r.success }));
            settle(r.success ? { success: true, user: r.user } : { success: false, error: r.error, code: 'sso_rejected' });
          } catch {
            res.writeHead(400).end();
          }
        });
        return;
      }
      res.writeHead(404).end();
    });

    const timer = setTimeout(() => settle({ success: false, error: 'SSO timed out', code: 'sso_timeout' }), TIMEOUT_MS);
    current = { server, settle };

    server.on('error', (e) => {
      log.error('[sso] loopback server error:', e.message);
      settle({ success: false, error: e.message, code: 'sso_rejected' });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      const redirect = `http://127.0.0.1:${port}/sso`;
      const start = `${API_BASE}/auth/sso/start?org=${encodeURIComponent(orgId)}&redirect=${encodeURIComponent(redirect)}`;
      log.info('[sso] loopback listening on', port);
      void shell.openExternal(start);
    });
  });
}

/** Abandonne la connexion SSO en cours, s’il y en a une. */
export function cancelSsoLogin(): void {
  if (!current) return;
  current.settle({ success: false, error: 'Cancelled', code: 'sso_cancelled' });
}
