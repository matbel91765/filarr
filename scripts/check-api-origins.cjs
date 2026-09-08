#!/usr/bin/env node
/**
 * check-api-origins — empêche de recoller l'hôte workers.dev de l'API
 * (filarr-api.filarr-app.workers.dev) dans le code de production.
 *
 * Cet hôte a déjà servi de plan de contrôle : le processus principal y
 * poste des mots de passe, sans CSP. Un littéral « oublié » est un
 * vol de session en une PR.
 *
 * Sortie 0 = rien à signaler. Sortie 1 = fichiers + lignes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FORBIDDEN = 'filarr-api.filarr-app.workers.dev';
const SCAN_DIRS = ['electron', 'src', 'infra/web-app', 'public'];
const SKIP_DIR = new Set(['node_modules', 'dist', 'dist-electron', 'coverage', 'build']);
const SKIP_EXT = new Set(['.md', '.map', '.png', '.jpg', '.webp', '.ico', '.woff', '.woff2']);

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR.has(ent.name)) continue;
      walk(full, out);
      continue;
    }
    const ext = path.extname(ent.name);
    if (SKIP_EXT.has(ext)) continue;
    out.push(full);
  }
}

function stripComments(src, ext) {
  if (ext === '.json') return src;
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return s;
}

const hits = [];
for (const rel of SCAN_DIRS) {
  const files = [];
  walk(path.join(ROOT, rel), files);
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const src = stripComments(raw, path.extname(file));
    if (!src.includes(FORBIDDEN)) continue;
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes(FORBIDDEN)) {
        hits.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}`);
      }
    });
  }
}

const originFile = path.join(ROOT, 'electron', 'apiOrigin.ts');
const originSrc = fs.readFileSync(originFile, 'utf8');
if (!originSrc.includes("export const API_ORIGIN = 'https://api.filarr.com'")) {
  hits.push('electron/apiOrigin.ts: API_ORIGIN must be https://api.filarr.com');
}

if (hits.length) {
  console.error('check-api-origins: hôte API interdit ou origine non épinglée :');
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}

console.log('check-api-origins: ok');
