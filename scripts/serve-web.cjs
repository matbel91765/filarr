/**
 * Serveur de dev pour le build web — `node scripts/serve-web.cjs` puis
 * http://localhost:3000. Le port 3000 est OBLIGATOIRE : c'est la seule origine
 * locale allowlistée par le Worker (CORS + cookie, infra/cloudflare-worker).
 * Zéro dépendance ; fallback SPA vers index.html.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'build');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
};

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('build/index.html introuvable — lancer `npm run build` d\'abord.');
  process.exit(1);
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(ROOT, urlPath);
    if (!path.normalize(file).startsWith(path.normalize(ROOT))) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    });
    fs.createReadStream(file)
      .on('error', () => res.end())
      .pipe(res);
  })
  .listen(3000, () => {
    console.log('Filarr Web (build local) : http://localhost:3000');
  });
