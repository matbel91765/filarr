#!/usr/bin/env node
/**
 * Release script — works on Windows, macOS, Linux
 *
 * Usage: npm run release -- 1.4.0
 * Does: ask platforms → bump version → commit → tag → push → triggers GitHub Actions
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const VERSION = process.argv[2];

function run(cmd) {
  console.log(`  > ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: path.resolve(__dirname, '..') }).toString().trim();
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  if (!VERSION) {
    console.error('Usage: npm run release -- <version>');
    console.error('Example: npm run release -- 1.4.0');
    process.exit(1);
  }

  if (!/^\d+\.\d+\.\d+$/.test(VERSION)) {
    console.error('Error: version must be semver (e.g. 1.4.0)');
    process.exit(1);
  }

  // Check clean working tree
  const status = runCapture('git status --porcelain');
  if (status) {
    console.error('Error: working tree is not clean. Commit or stash changes first.');
    console.error(status);
    process.exit(1);
  }

  const pkg = require('../package.json');
  console.log(`\nCurrent version: ${pkg.version}`);
  console.log(`New version:     ${VERSION}\n`);

  // Ask which platforms to build
  console.log('Quelles plateformes builder ?');
  console.log('  1) Windows + Linux          (~13 min facturées)');
  console.log('  2) Windows + Linux + macOS  (~63 min facturées)');
  console.log('  3) Windows uniquement       (~10 min facturées)');
  console.log('  4) Toutes + choix custom\n');

  const platformChoice = await ask('Choix [1/2/3/4] (défaut: 1): ') || '1';

  let buildWindows = false;
  let buildLinux = false;
  let buildMac = false;

  switch (platformChoice) {
    case '1':
      buildWindows = true;
      buildLinux = true;
      break;
    case '2':
      buildWindows = true;
      buildLinux = true;
      buildMac = true;
      break;
    case '3':
      buildWindows = true;
      break;
    case '4':
      buildWindows = (await ask('  Windows ? [Y/n] ')).toLowerCase() !== 'n';
      buildLinux = (await ask('  Linux ? [Y/n] ')).toLowerCase() !== 'n';
      buildMac = (await ask('  macOS ? [y/N] ')).toLowerCase() === 'y';
      break;
    default:
      buildWindows = true;
      buildLinux = true;
  }

  if (!buildWindows && !buildLinux && !buildMac) {
    console.error('Error: au moins une plateforme doit être sélectionnée.');
    process.exit(1);
  }

  const platforms = [
    buildWindows && 'Windows',
    buildLinux && 'Linux',
    buildMac && 'macOS',
  ].filter(Boolean);

  console.log(`\nRelease v${VERSION} → ${platforms.join(' + ')}`);
  const confirm = await ask('Confirmer ? [y/N] ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  // 1. Bump package.json
  run(`npm version ${VERSION} --no-git-tag-version`);
  console.log(`✓ package.json bumped to ${VERSION}`);

  // 2. Update Cloudflare Worker
  const wranglerPath = path.resolve(__dirname, '..', 'infra', 'cloudflare-worker', 'wrangler.toml');
  if (fs.existsSync(wranglerPath)) {
    let content = fs.readFileSync(wranglerPath, 'utf8');
    content = content.replace(/LATEST_VERSION = ".*?"/, `LATEST_VERSION = "${VERSION}"`);
    fs.writeFileSync(wranglerPath, content);
    console.log('✓ Cloudflare Worker LATEST_VERSION updated');
  }

  // 3. Commit + tag
  // Include platform selection in tag message for the workflow
  const platformsJson = JSON.stringify({ win: buildWindows, linux: buildLinux, mac: buildMac });
  run('git add -A');
  run(`git commit --no-verify -m "chore: bump version to ${VERSION}"`);
  // Use execFileSync to avoid shell escaping issues with JSON in tag message
  const { execFileSync } = require('child_process');
  execFileSync('git', ['tag', '-a', `v${VERSION}`, '-m', platformsJson], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });
  console.log(`✓ Committed and tagged v${VERSION}`);

  // 4. Push
  const branch = runCapture('git rev-parse --abbrev-ref HEAD');
  run(`git push origin ${branch} --tags`);
  console.log(`✓ Pushed to origin/${branch} with tag v${VERSION}`);

  // 5. Deploy Cloudflare Worker (best effort)
  if (fs.existsSync(wranglerPath)) {
    console.log('\nDeploying Cloudflare Worker...');
    try {
      run('cd infra/cloudflare-worker && npx wrangler deploy');
      console.log('✓ Worker deployed');
    } catch {
      console.log('⚠ Worker deploy failed (run manually: cd infra/cloudflare-worker && npx wrangler deploy)');
    }
  }

  console.log('');
  console.log(`Done! GitHub Actions will build: ${platforms.join(', ')}`);
  console.log('Check: https://github.com/matbel91765/filarg/actions');

  // Estimate factored minutes
  let estimate = 0;
  if (buildWindows) estimate += 10;
  if (buildLinux) estimate += 3;
  if (buildMac) estimate += 50;
  console.log(`Estimation: ~${estimate} min GitHub Actions facturées`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
